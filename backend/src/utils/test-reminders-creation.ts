import http from 'http';
import { URL } from 'url';
import { pool } from '../config/db';
import { issueToken } from './jwt';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function request(
  method: string,
  url: string,
  headers: Record<string, string> = {},
  body?: any
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const options = {
      method,
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      headers: {
        ...headers,
        ...(body ? { 'Content-Type': 'application/json' } : {})
      }
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({ status: res.statusCode || 0, body: data });
      });
    });
    req.on('error', reject);
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

const userAId = 'a0000000-0000-0000-0000-000000000001';
const tokenA = issueToken(userAId);
const authHeadersA = { 'Authorization': `Bearer ${tokenA}` };

async function runNormalTests() {
  console.log('Running Reminder Record Creation on Task Lifecycle Integration Tests...');

  const dbClient = await pool.connect();

  try {
    // 1. Prepare database test user
    console.log('Inserting test user...');
    await dbClient.query(
      `INSERT INTO users (id, email, device_timezone) 
       VALUES ($1, $2, $3) 
       ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email`,
      [userAId, 'usera@example.com', 'UTC']
    );

    // Clean prior tasks, templates, and reminders
    await dbClient.query('DELETE FROM reminders WHERE task_id IN (SELECT id FROM tasks WHERE user_id = $1)', [userAId]);
    await dbClient.query('DELETE FROM tasks WHERE user_id = $1', [userAId]);
    await dbClient.query('DELETE FROM recurrence_templates WHERE user_id = $1', [userAId]);

    // ==========================================
    // Test Case 1: Unbounded Task Creation (3 Reminders)
    // ==========================================
    console.log('\n--- Test Case 1: Unbounded Task Creation (3 Reminders) ---');
    const deadline30Hours = new Date(Date.now() + 30 * 60 * 60 * 1000);
    const taskRes1 = await request('POST', 'http://localhost:3000/tasks', authHeadersA, {
      title: 'Task with long deadline',
      timezone_snapshot: 'UTC',
      deadline_at: deadline30Hours.toISOString()
    });
    assert(taskRes1.status === 201, `Failed to create task: ${taskRes1.body}`);
    const task1 = JSON.parse(taskRes1.body);

    const remindersRes1 = await dbClient.query('SELECT * FROM reminders WHERE task_id = $1 ORDER BY trigger_at ASC', [task1.id]);
    assert(remindersRes1.rows.length === 3, `Expected 3 reminders, got ${remindersRes1.rows.length}`);
    
    const [remAdvance, remApproaching, remDueNow] = remindersRes1.rows;
    assert(remAdvance.tier === 'advance', 'Expected tier advance');
    assert(remApproaching.tier === 'approaching', 'Expected tier approaching');
    assert(remDueNow.tier === 'due_now', 'Expected tier due_now');

    // Assert correct trigger_at values
    const diffAdvance = Math.abs(new Date(remAdvance.trigger_at).getTime() - (deadline30Hours.getTime() - 24 * 60 * 60 * 1000));
    const diffApproaching = Math.abs(new Date(remApproaching.trigger_at).getTime() - (deadline30Hours.getTime() - 60 * 60 * 1000));
    const diffDueNow = Math.abs(new Date(remDueNow.trigger_at).getTime() - deadline30Hours.getTime());
    
    assert(diffAdvance < 1000, `Advance reminder trigger_at calculation mismatch by ${diffAdvance}ms`);
    assert(diffApproaching < 1000, `Approaching reminder trigger_at calculation mismatch by ${diffApproaching}ms`);
    assert(diffDueNow < 1000, `Due Now reminder trigger_at calculation mismatch by ${diffDueNow}ms`);

    // Assert bullmq_job_id is set
    assert(remAdvance.bullmq_job_id !== null, 'Expected non-null bullmq_job_id for advance');
    assert(remApproaching.bullmq_job_id !== null, 'Expected non-null bullmq_job_id for approaching');
    assert(remDueNow.bullmq_job_id !== null, 'Expected non-null bullmq_job_id for due_now');

    console.log('Unbounded Task Creation (3 Reminders) PASSED.');

    // ==========================================
    // Test Case 2: Partially Bounded Task Creation (Skipping past tiers)
    // ==========================================
    console.log('\n--- Test Case 2: Partially Bounded Task Creation (Skipping past tiers) ---');
    const deadline30Minutes = new Date(Date.now() + 30 * 60 * 1000);
    const taskRes2 = await request('POST', 'http://localhost:3000/tasks', authHeadersA, {
      title: 'Task with short deadline',
      timezone_snapshot: 'UTC',
      deadline_at: deadline30Minutes.toISOString()
    });
    assert(taskRes2.status === 201, `Failed to create task: ${taskRes2.body}`);
    const task2 = JSON.parse(taskRes2.body);

    const remindersRes2 = await dbClient.query('SELECT * FROM reminders WHERE task_id = $1 ORDER BY trigger_at ASC', [task2.id]);
    assert(remindersRes2.rows.length === 1, `Expected exactly 1 reminder, got ${remindersRes2.rows.length}`);
    assert(remindersRes2.rows[0].tier === 'due_now', `Expected only due_now tier, got ${remindersRes2.rows[0].tier}`);
    assert(remindersRes2.rows[0].bullmq_job_id !== null, 'Expected non-null bullmq_job_id');
    
    console.log('Partially Bounded Task Creation (Skipping past tiers) PASSED.');

    // ==========================================
    // Test Case 3: Instance Generation Reminders
    // ==========================================
    console.log('\n--- Test Case 3: Instance Generation Reminders ---');
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const tomorrowStr = tomorrow.toISOString().substring(0, 10);

    const templateRes = await request('POST', 'http://localhost:3000/templates', authHeadersA, {
      title: 'Daily Template',
      recurrence_type: 'daily',
      time_of_day: '12:00:00',
      timezone_snapshot: 'UTC',
      anchor_date: tomorrowStr
    });
    assert(templateRes.status === 201, `Failed to create template: ${templateRes.body}`);
    const template = JSON.parse(templateRes.body);

    // Trigger instance generation
    const genRes = await request('POST', 'http://localhost:3000/admin/generate-instances', authHeadersA);
    assert(genRes.status === 200, `Failed to trigger instance generation: ${genRes.body}`);
    
    // Retrieve generated tasks
    const tasksRes = await dbClient.query('SELECT * FROM tasks WHERE recurrence_template_id = $1', [template.id]);
    assert(tasksRes.rows.length > 0, 'No task instances generated for template');

    for (const row of tasksRes.rows) {
      const remindersRes = await dbClient.query('SELECT * FROM reminders WHERE task_id = $1', [row.id]);
      assert(remindersRes.rows.length > 0, `Expected reminders to be created for generated task ${row.id}, but got none`);
      for (const r of remindersRes.rows) {
        assert(r.bullmq_job_id !== null, `Expected non-null bullmq_job_id for reminder ${r.id}`);
      }
      console.log(`- Template Instance: "${row.title}" (Deadline: ${row.deadline_at.toISOString()}) created ${remindersRes.rows.length} reminder(s)`);
    }

    console.log('Instance Generation Reminders PASSED.');

    // ==========================================
    // Test Case 4: Google Calendar Exclude
    // ==========================================
    console.log('\n--- Test Case 4: Google Calendar Exclude ---');
    const mockGoogleEventId = 'mock_google_event_12345';
    const insertGoogleTaskRes = await dbClient.query(
      `INSERT INTO tasks (user_id, title, deadline_at, timezone_snapshot, status, google_event_id)
       VALUES ($1, $2, $3, $4, 'pending', $5)
       RETURNING *`,
      [userAId, 'Google Calendar Sync Task', deadline30Hours, 'UTC', mockGoogleEventId]
    );
    const googleTask = insertGoogleTaskRes.rows[0];

    const { createRemindersForTask } = require('../services/reminderService');
    const remindersCreated = await createRemindersForTask(googleTask);
    assert(remindersCreated.length === 0, `Expected 0 reminders created for Google Sync Task, got ${remindersCreated.length}`);

    const dbGoogleReminders = await dbClient.query('SELECT * FROM reminders WHERE task_id = $1', [googleTask.id]);
    assert(dbGoogleReminders.rows.length === 0, `Expected 0 reminders in DB for Google Sync Task, got ${dbGoogleReminders.rows.length}`);

    console.log('Google Calendar Exclude PASSED.');

    // ==========================================
    // Test Case 5: Delayed Trigger Firing (5 Seconds)
    // ==========================================
    console.log('\n--- Test Case 5: Delayed Trigger Firing (5 Seconds) ---');
    const deadline5Seconds = new Date(Date.now() + 5 * 1000);
    const taskRes5 = await request('POST', 'http://localhost:3000/tasks', authHeadersA, {
      title: 'Fast Firing Task',
      timezone_snapshot: 'UTC',
      deadline_at: deadline5Seconds.toISOString()
    });
    assert(taskRes5.status === 201, `Failed to create fast firing task: ${taskRes5.body}`);
    const task5 = JSON.parse(taskRes5.body);

    // Get the reminder id
    const remindersRes5 = await dbClient.query('SELECT * FROM reminders WHERE task_id = $1 AND tier = \'due_now\'', [task5.id]);
    assert(remindersRes5.rows.length === 1, 'Expected 1 due_now reminder');
    const reminderId5 = remindersRes5.rows[0].id;

    console.log(`Waiting 6 seconds for reminder ${reminderId5} to fire...`);
    await new Promise((resolve) => setTimeout(resolve, 6000));

    // Assert reminder status has transitioned to 'sent'
    const checkReminderRes = await dbClient.query('SELECT * FROM reminders WHERE id = $1', [reminderId5]);
    const reminderCheck = checkReminderRes.rows[0];
    assert(reminderCheck.status === 'sent', `Expected reminder status to be 'sent', got '${reminderCheck.status}'`);
    assert(reminderCheck.sent_at !== null, 'Expected non-null sent_at date');

    // ==========================================
    // Test Case 6: Cancellation on Completion (Standard)
    // ==========================================
    console.log('\n--- Test Case 6: Cancellation on Completion (Standard) ---');
    const deadlineLater = new Date(Date.now() + 30 * 60 * 60 * 1000);
    const taskRes6 = await request('POST', 'http://localhost:3000/tasks', authHeadersA, {
      title: 'Task to be Cancelled',
      timezone_snapshot: 'UTC',
      deadline_at: deadlineLater.toISOString()
    });
    assert(taskRes6.status === 201, `Failed to create task to cancel: ${taskRes6.body}`);
    const task6 = JSON.parse(taskRes6.body);

    // Complete the task
    const completeRes6 = await request('PATCH', `http://localhost:3000/tasks/${task6.id}`, authHeadersA, {
      status: 'completed'
    });
    assert(completeRes6.status === 200, `Failed to complete task: ${completeRes6.body}`);

    // Verify all reminders are marked as cancelled
    const checkRemindersRes6 = await dbClient.query('SELECT * FROM reminders WHERE task_id = $1', [task6.id]);
    assert(checkRemindersRes6.rows.length === 3, 'Expected 3 reminders');
    for (const r of checkRemindersRes6.rows) {
      assert(r.status === 'cancelled', `Expected reminder status 'cancelled', got '${r.status}'`);
    }
    console.log('Cancellation on Completion (Standard) PASSED.');

    // ==========================================
    // Test Case 7: Race-Condition Handling
    // ==========================================
    console.log('\n--- Test Case 7: Race-Condition Handling ---');
    const deadline2Seconds = new Date(Date.now() + 2 * 1000);
    const taskRes7 = await request('POST', 'http://localhost:3000/tasks', authHeadersA, {
      title: 'Race Condition Task',
      timezone_snapshot: 'UTC',
      deadline_at: deadline2Seconds.toISOString()
    });
    assert(taskRes7.status === 201, `Failed to create race task: ${taskRes7.body}`);
    const task7 = JSON.parse(taskRes7.body);

    // Wait 1.5 seconds (almost trigger time) and complete
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const completeRes7 = await request('PATCH', `http://localhost:3000/tasks/${task7.id}`, authHeadersA, {
      status: 'completed'
    });
    assert(completeRes7.status === 200, `Failed to complete race task: ${completeRes7.body}`);

    // Query DB to verify final state
    const checkRemindersRes7 = await dbClient.query('SELECT * FROM reminders WHERE task_id = $1', [task7.id]);
    assert(checkRemindersRes7.rows.length === 1, 'Expected 1 reminder');
    const r7 = checkRemindersRes7.rows[0];
    console.log(`Race task reminder final status is '${r7.status}'`);
    assert(r7.status === 'cancelled' || r7.status === 'sent', 'Reminder status should be either cancelled or sent cleanly');

    // ==========================================
    // Test Case 8: Deadline Update (Rescheduling)
    // ==========================================
    console.log('\n--- Test Case 8: Deadline Update (Rescheduling) ---');
    const deadline30h = new Date(Date.now() + 30 * 60 * 60 * 1000);
    const taskRes8 = await request('POST', 'http://localhost:3000/tasks', authHeadersA, {
      title: 'Task to Reschedule',
      timezone_snapshot: 'UTC',
      deadline_at: deadline30h.toISOString()
    });
    assert(taskRes8.status === 201, `Failed to create task: ${taskRes8.body}`);
    const task8 = JSON.parse(taskRes8.body);

    const reminders8Res1 = await dbClient.query('SELECT * FROM reminders WHERE task_id = $1 ORDER BY trigger_at ASC', [task8.id]);
    assert(reminders8Res1.rows.length === 3, 'Expected 3 reminders initially');
    const oldReminderIds = reminders8Res1.rows.map((r: any) => r.id);

    // Update deadline to 40 hours in the future
    const deadline40h = new Date(Date.now() + 40 * 60 * 60 * 1000);
    const updateRes8 = await request('PATCH', `http://localhost:3000/tasks/${task8.id}`, authHeadersA, {
      deadline_at: deadline40h.toISOString()
    });
    assert(updateRes8.status === 200, `Failed to patch task deadline: ${updateRes8.body}`);

    // Verify old reminders are cancelled
    const oldRemindersCheck = await dbClient.query('SELECT * FROM reminders WHERE id = ANY($1)', [oldReminderIds]);
    for (const r of oldRemindersCheck.rows) {
      assert(r.status === 'cancelled', `Expected old reminder ${r.id} to be cancelled, got ${r.status}`);
    }

    // Verify 3 new reminders exist
    const newRemindersCheck = await dbClient.query('SELECT * FROM reminders WHERE task_id = $1 AND status = \'scheduled\' ORDER BY trigger_at ASC', [task8.id]);
    assert(newRemindersCheck.rows.length === 3, `Expected 3 new scheduled reminders, got ${newRemindersCheck.rows.length}`);
    for (const r of newRemindersCheck.rows) {
      assert(!oldReminderIds.includes(r.id), `Expected new reminder ID, got old ID ${r.id}`);
      assert(r.bullmq_job_id !== null, 'Expected non-null bullmq_job_id for rescheduled reminder');
    }
    console.log('Deadline Update (Rescheduling) PASSED.');

    // ==========================================
    // Test Case 9: Deadline No-Op Update
    // ==========================================
    console.log('\n--- Test Case 9: Deadline No-Op Update ---');
    const deadline50h = new Date(Date.now() + 50 * 60 * 60 * 1000);
    const taskRes9 = await request('POST', 'http://localhost:3000/tasks', authHeadersA, {
      title: 'Task No-Op Deadline',
      timezone_snapshot: 'UTC',
      deadline_at: deadline50h.toISOString()
    });
    const task9 = JSON.parse(taskRes9.body);

    const reminders9Res1 = await dbClient.query('SELECT * FROM reminders WHERE task_id = $1 ORDER BY trigger_at ASC', [task9.id]);
    const originalJobIds = reminders9Res1.rows.map((r: any) => r.bullmq_job_id);

    // Patch with the EXACT SAME deadline_at string
    const updateRes9 = await request('PATCH', `http://localhost:3000/tasks/${task9.id}`, authHeadersA, {
      deadline_at: deadline50h.toISOString()
    });
    assert(updateRes9.status === 200, `Patch failed: ${updateRes9.body}`);

    const reminders9Res2 = await dbClient.query('SELECT * FROM reminders WHERE task_id = $1 ORDER BY trigger_at ASC', [task9.id]);
    const afterJobIds = reminders9Res2.rows.map((r: any) => r.bullmq_job_id);

    assert(JSON.stringify(originalJobIds) === JSON.stringify(afterJobIds), 'Job IDs changed on no-op deadline update');
    console.log('Deadline No-Op Update PASSED.');

    // ==========================================
    // Test Case 10: Status Complete Precedence
    // ==========================================
    console.log('\n--- Test Case 10: Status Complete Precedence ---');
    const deadline60h = new Date(Date.now() + 60 * 60 * 60 * 1000);
    const taskRes10 = await request('POST', 'http://localhost:3000/tasks', authHeadersA, {
      title: 'Task Precedence Test',
      timezone_snapshot: 'UTC',
      deadline_at: deadline60h.toISOString()
    });
    const task10 = JSON.parse(taskRes10.body);

    // Patch status to completed AND update deadline in same payload
    const updateRes10 = await request('PATCH', `http://localhost:3000/tasks/${task10.id}`, authHeadersA, {
      status: 'completed',
      deadline_at: new Date(Date.now() + 70 * 60 * 60 * 1000).toISOString()
    });
    assert(updateRes10.status === 200, `Patch failed: ${updateRes10.body}`);

    // Verify all reminders are cancelled and zero are scheduled
    const reminders10Res = await dbClient.query('SELECT * FROM reminders WHERE task_id = $1', [task10.id]);
    assert(reminders10Res.rows.length > 0, 'Expected reminder rows to exist');
    for (const r of reminders10Res.rows) {
      assert(r.status === 'cancelled', `Expected reminder status to be cancelled, got ${r.status}`);
    }

    // ==========================================
    // Test Case 11: Successful Push Dispatch & Logging
    // ==========================================
    console.log('\n--- Test Case 11: Successful Push Dispatch & Logging ---');
    const testFcmToken = 'mock_fcm_token_value_for_testing';
    await dbClient.query('UPDATE users SET fcm_token = $1 WHERE id = $2', [testFcmToken, userAId]);

    const deadline3Seconds11 = new Date(Date.now() + 3 * 1000);
    const taskRes11 = await request('POST', 'http://localhost:3000/tasks', authHeadersA, {
      title: 'FCM Dispatch Test Task',
      timezone_snapshot: 'UTC',
      deadline_at: deadline3Seconds11.toISOString()
    });
    assert(taskRes11.status === 201, `Failed to create task: ${taskRes11.body}`);
    const task11 = JSON.parse(taskRes11.body);

    const remindersRes11 = await dbClient.query('SELECT * FROM reminders WHERE task_id = $1 AND tier = \'due_now\'', [task11.id]);
    assert(remindersRes11.rows.length === 1, 'Expected 1 reminder');
    const reminderId11 = remindersRes11.rows[0].id;

    console.log('Waiting 5 seconds for FCM reminder to fire...');
    await new Promise((resolve) => setTimeout(resolve, 5000));

    const checkReminder11 = await dbClient.query('SELECT * FROM reminders WHERE id = $1', [reminderId11]);
    assert(checkReminder11.rows[0].status === 'sent', 'Expected reminder status to be sent');

    const logCheck11 = await dbClient.query('SELECT * FROM notification_log WHERE reminder_id = $1', [reminderId11]);
    assert(logCheck11.rows.length === 1, 'Expected 1 notification log row');
    const log11 = logCheck11.rows[0];
    assert(log11.channel === 'push', 'Expected channel push');
    assert(log11.notification_type === 'reminder', 'Expected type reminder');
    assert(log11.delivery_status === 'failed', 'Expected status failed (due to mock token)');
    assert(log11.failure_reason !== null, 'Expected non-null failure_reason');
    console.log('FCM Dispatch & Log PASSED.');

    // ==========================================
    // Test Case 12: Null Token Skip & Logging
    // ==========================================
    console.log('\n--- Test Case 12: Null Token Skip & Logging ---');
    await dbClient.query('UPDATE users SET fcm_token = NULL WHERE id = $1', [userAId]);

    const deadline3Seconds12 = new Date(Date.now() + 3 * 1000);
    const taskRes12 = await request('POST', 'http://localhost:3000/tasks', authHeadersA, {
      title: 'Null FCM Token Test Task',
      timezone_snapshot: 'UTC',
      deadline_at: deadline3Seconds12.toISOString()
    });
    assert(taskRes12.status === 201, `Failed to create task: ${taskRes12.body}`);
    const task12 = JSON.parse(taskRes12.body);

    const remindersRes12 = await dbClient.query('SELECT * FROM reminders WHERE task_id = $1 AND tier = \'due_now\'', [task12.id]);
    assert(remindersRes12.rows.length === 1, 'Expected 1 reminder');
    const reminderId12 = remindersRes12.rows[0].id;

    console.log('Waiting 5 seconds for Null Token reminder to fire...');
    await new Promise((resolve) => setTimeout(resolve, 5000));

    const checkReminder12 = await dbClient.query('SELECT * FROM reminders WHERE id = $1', [reminderId12]);
    assert(checkReminder12.rows[0].status === 'sent', 'Expected reminder status to be sent');

    const logCheck12 = await dbClient.query('SELECT * FROM notification_log WHERE reminder_id = $1', [reminderId12]);
    assert(logCheck12.rows.length === 1, 'Expected 1 notification log row');
    const log12 = logCheck12.rows[0];
    assert(log12.channel === 'push', 'Expected channel push');
    assert(log12.notification_type === 'reminder', 'Expected type reminder');
    assert(log12.delivery_status === 'failed', 'Expected status failed');
    assert(log12.failure_reason === 'no_fcm_token_registered', 'Expected failure_reason no_fcm_token_registered');
    console.log('Null Token Skip & Log PASSED.');

    console.log('\nALL STANDARD REMINDER AND JOB SCHEDULING TESTS PASSED!');
  } finally {
    dbClient.release();
  }
}

async function stageRestart() {
  const dbClient = await pool.connect();
  try {
    // Schedule a reminder 15 seconds in the future
    const deadline15Seconds = new Date(Date.now() + 15 * 1000);
    const taskRes = await request('POST', 'http://localhost:3000/tasks', authHeadersA, {
      title: 'Restart Test Task',
      timezone_snapshot: 'UTC',
      deadline_at: deadline15Seconds.toISOString()
    });
    assert(taskRes.status === 201, `Failed to create restart test task: ${taskRes.body}`);
    const task = JSON.parse(taskRes.body);

    const remindersRes = await dbClient.query('SELECT * FROM reminders WHERE task_id = $1 AND tier = \'due_now\'', [task.id]);
    assert(remindersRes.rows.length === 1, 'Expected 1 due_now reminder');
    const reminder = remindersRes.rows[0];
    assert(reminder.status === 'scheduled', 'Expected reminder status to be scheduled initially');
    assert(reminder.bullmq_job_id !== null, 'Expected non-null bullmq_job_id');

    console.log(`STAGE_SUCCESS:${reminder.id}`);
  } finally {
    dbClient.release();
  }
}

async function verifyRestart(reminderId: string) {
  const dbClient = await pool.connect();
  try {
    console.log(`Verifying reminder ${reminderId} after restart...`);
    // Query reminder row status
    const res = await dbClient.query('SELECT * FROM reminders WHERE id = $1', [reminderId]);
    assert(res.rows.length === 1, 'Reminder not found');
    const reminder = res.rows[0];
    assert(reminder.status === 'sent', `Expected reminder status to be 'sent' after restart, but got '${reminder.status}'`);
    assert(reminder.sent_at !== null, 'Expected non-null sent_at after restart');
    console.log('VERIFY_SUCCESS');
  } finally {
    dbClient.release();
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--stage-restart') {
    await stageRestart();
  } else if (args[0] === '--verify-restart') {
    if (!args[1]) {
      throw new Error('Missing reminder ID for verify-restart');
    }
    await verifyRestart(args[1]);
  } else {
    await runNormalTests();
  }
}

main().catch((err) => {
  console.error('Test run failed:', err);
  process.exit(1);
});

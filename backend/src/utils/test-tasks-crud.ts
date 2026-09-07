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

async function run() {
  console.log('Running Task CRUD Integration Tests...');

  const userAId = 'a0000000-0000-0000-0000-000000000001';
  const userBId = 'b0000000-0000-0000-0000-000000000002';

  const tokenA = issueToken(userAId);
  const tokenB = issueToken(userBId);

  const authHeadersA = { 'Authorization': `Bearer ${tokenA}` };
  const authHeadersB = { 'Authorization': `Bearer ${tokenB}` };

  const dbClient = await pool.connect();

  try {
    // 1. Prepare database test users
    console.log('Inserting test users...');
    await dbClient.query(
      `INSERT INTO users (id, email, device_timezone) 
       VALUES ($1, $2, $3) 
       ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email`,
      [userAId, 'usera@example.com', 'UTC']
    );
    await dbClient.query(
      `INSERT INTO users (id, email, device_timezone) 
       VALUES ($1, $2, $3) 
       ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email`,
      [userBId, 'userb@example.com', 'UTC']
    );

    // Clean prior tasks for testing clean-slate
    await dbClient.query('DELETE FROM tasks WHERE user_id IN ($1, $2)', [userAId, userBId]);

    // 2. Test Input Validation
    console.log('\n--- Testing Input Validation ---');
    const valRes1 = await request('POST', 'http://localhost:3000/tasks', authHeadersA, {
      title: '',
      timezone_snapshot: 'UTC'
    });
    assert(valRes1.status === 400, 'Expected 400 for empty title');
    console.log('Empty title validated.');

    const valRes2 = await request('POST', 'http://localhost:3000/tasks', authHeadersA, {
      title: 'Valid Task',
      timezone_snapshot: '',
    });
    assert(valRes2.status === 400, 'Expected 400 for empty timezone');
    console.log('Empty timezone validated.');

    const valRes3 = await request('POST', 'http://localhost:3000/tasks', authHeadersA, {
      title: 'Valid Task',
      timezone_snapshot: 'UTC',
      deadline_at: 'not-a-date'
    });
    assert(valRes3.status === 400, 'Expected 400 for invalid ISO 8601 deadline');
    console.log('Invalid deadline_at validated.');

    // 3. Test Standalone Task Creation
    console.log('\n--- Testing Standalone Task Creation ---');
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    const createRes1 = await request('POST', 'http://localhost:3000/tasks', authHeadersA, {
      title: 'Task A1',
      timezone_snapshot: 'America/New_York',
      deadline_at: tomorrow.toISOString()
    });
    assert(createRes1.status === 201, `Expected 201, got ${createRes1.status}`);
    const taskA1 = JSON.parse(createRes1.body);
    assert(taskA1.title === 'Task A1', 'Title mismatch');
    assert(taskA1.status === 'pending', 'Status should default to pending');
    assert(taskA1.google_event_id === null, 'Google Event ID must be null');
    assert(taskA1.recurrence_template_id === null, 'Recurrence template ID must be null');
    console.log('Task A1 created:', taskA1.id);

    const nextWeek = new Date();
    nextWeek.setDate(nextWeek.getDate() + 7);
    const createRes2 = await request('POST', 'http://localhost:3000/tasks', authHeadersA, {
      title: 'Task A2',
      timezone_snapshot: 'America/New_York',
      deadline_at: nextWeek.toISOString()
    });
    const taskA2 = JSON.parse(createRes2.body);
    console.log('Task A2 created:', taskA2.id);

    // Create a task belonging to User B
    const createResB = await request('POST', 'http://localhost:3000/tasks', authHeadersB, {
      title: 'Task B1',
      timezone_snapshot: 'UTC'
    });
    const taskB1 = JSON.parse(createResB.body);
    console.log('Task B1 created:', taskB1.id);

    // 4. Test Scoping / Ownership checks on Single Fetch, Patch, and Delete
    console.log('\n--- Testing Scoping & Ownership ---');
    // User A trying to fetch User B's task (should get 404)
    const getScoping = await request('GET', `http://localhost:3000/tasks/${taskB1.id}`, authHeadersA);
    assert(getScoping.status === 404, `Expected 404 for unauthorized single fetch, got ${getScoping.status}`);
    console.log('Unauthorized single fetch correctly returned 404.');

    // User A trying to update User B's task (should get 404)
    const patchScoping = await request('PATCH', `http://localhost:3000/tasks/${taskB1.id}`, authHeadersA, {
      title: 'Hacked Title'
    });
    assert(patchScoping.status === 404, `Expected 404 for unauthorized update, got ${patchScoping.status}`);
    console.log('Unauthorized PATCH correctly returned 404.');

    // User A trying to delete User B's task (should get 404)
    const deleteScoping = await request('DELETE', `http://localhost:3000/tasks/${taskB1.id}`, authHeadersA);
    assert(deleteScoping.status === 404, `Expected 404 for unauthorized delete, got ${deleteScoping.status}`);
    console.log('Unauthorized DELETE correctly returned 404.');

    // 5. Test Unified Get /tasks list (Google-sourced + User-created)
    console.log('\n--- Testing Unified GET /tasks ---');
    // Simulate a Google Sync event task directly in DB for User A
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    await dbClient.query(
      `INSERT INTO tasks (user_id, title, google_event_id, deadline_at, timezone_snapshot, status)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userAId, 'Google Calendar Event', 'google_id_9999', yesterday, 'Europe/London', 'pending']
    );

    const getTasksRes = await request('GET', 'http://localhost:3000/tasks', authHeadersA);
    assert(getTasksRes.status === 200, 'Expected 200 for fetching tasks list');
    const tasksList = JSON.parse(getTasksRes.body);
    
    // Check that we got 3 tasks (Google Calendar Event, Task A1, Task A2)
    assert(tasksList.length === 3, `Expected 3 tasks, got ${tasksList.length}`);
    
    // Assert ordering (yesterday < tomorrow < next week)
    assert(tasksList[0].title === 'Google Calendar Event', 'First task should be Google Event (yesterday)');
    assert(tasksList[1].title === 'Task A1', 'Second task should be Task A1 (tomorrow)');
    assert(tasksList[2].title === 'Task A2', 'Third task should be Task A2 (next week)');
    console.log('GET /tasks unified list verified sorting and size.');

    // Test status filter
    const getPendingTasks = await request('GET', 'http://localhost:3000/tasks?status=pending', authHeadersA);
    const pendingTasks = JSON.parse(getPendingTasks.body);
    assert(pendingTasks.length === 3, 'Expected 3 pending tasks');

    const getCompletedTasks = await request('GET', 'http://localhost:3000/tasks?status=completed', authHeadersA);
    const completedTasks = JSON.parse(getCompletedTasks.body);
    assert(completedTasks.length === 0, 'Expected 0 completed tasks');
    console.log('Query filtering validated.');

    // 6. Test Status Completion Transitions (completed_at verification)
    console.log('\n--- Testing Completion State Transitions ---');
    // Update Task A1 to completed
    const completeRes = await request('PATCH', `http://localhost:3000/tasks/${taskA1.id}`, authHeadersA, {
      status: 'completed'
    });
    assert(completeRes.status === 200, `Expected 200, got ${completeRes.status}`);
    const completedA1 = JSON.parse(completeRes.body);
    assert(completedA1.status === 'completed', 'Status should be completed');
    assert(completedA1.completed_at !== null, 'completed_at should be set');
    console.log('Task A1 set to completed. completed_at:', completedA1.completed_at);

    // Revert Task A1 back to pending
    const revertRes = await request('PATCH', `http://localhost:3000/tasks/${taskA1.id}`, authHeadersA, {
      status: 'pending'
    });
    assert(revertRes.status === 200, `Expected 200, got ${revertRes.status}`);
    const revertedA1 = JSON.parse(revertRes.body);
    assert(revertedA1.status === 'pending', 'Status should be reverted to pending');
    assert(revertedA1.completed_at === null, 'completed_at should be cleared to null');
    console.log('Task A1 reverted back to pending. completed_at is null.');

    // 7. Test Deletion
    console.log('\n--- Testing Deletion ---');
    const deleteRes = await request('DELETE', `http://localhost:3000/tasks/${taskA1.id}`, authHeadersA);
    assert(deleteRes.status === 200, `Expected 200 on delete, got ${deleteRes.status}`);

    const singleRes = await request('GET', `http://localhost:3000/tasks/${taskA1.id}`, authHeadersA);
    assert(singleRes.status === 404, `Expected 404 for deleted task, got ${singleRes.status}`);
    console.log('Task A1 deleted and confirmed missing.');

    console.log('\nAll Task CRUD integration tests PASSED successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Integration tests FAILED:', error);
    process.exit(1);
  } finally {
    console.log('Cleaning up database test data...');
    try {
      await dbClient.query('DELETE FROM tasks WHERE user_id IN ($1, $2)', [userAId, userBId]);
      await dbClient.query('DELETE FROM users WHERE id IN ($1, $2)', [userAId, userBId]);
    } catch (cleanupErr) {
      console.error('Failed to cleanup test data:', cleanupErr);
    }
    dbClient.release();
  }
}

run();

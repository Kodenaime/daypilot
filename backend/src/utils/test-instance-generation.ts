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
  console.log('Running Instance Generation Job Integration Tests...');

  const userAId = 'a0000000-0000-0000-0000-000000000001';
  const tokenA = issueToken(userAId);
  const authHeadersA = { 'Authorization': `Bearer ${tokenA}` };

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

    // Clean prior templates and tasks
    await dbClient.query('DELETE FROM tasks WHERE user_id = $1', [userAId]);
    await dbClient.query('DELETE FROM recurrence_templates WHERE user_id = $1', [userAId]);

    // Determine today's weekday in UTC to anchor weekly template correctly
    const today = new Date();
    // Tomorrow is anchor day
    const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
    const tomorrowWeekday = tomorrow.getUTCDay(); // 0 = Sun, 3 = Wed, etc
    const tomorrowDayOfMonth = tomorrow.getUTCDate();

    console.log(`Today UTC Date: ${today.toISOString().substring(0,10)}, Day of Week: ${today.getUTCDay()}`);
    console.log(`Tomorrow UTC Date: ${tomorrow.toISOString().substring(0,10)}, Day of Week: ${tomorrowWeekday}, Day of Month: ${tomorrowDayOfMonth}`);

    // 2. Create the 4 template types
    console.log('\nCreating templates of all 4 recurrence types...');

    // A. Daily
    const tDailyRes = await request('POST', 'http://localhost:3000/templates', authHeadersA, {
      title: 'Daily Task',
      recurrence_type: 'daily',
      time_of_day: '08:00:00',
      timezone_snapshot: 'UTC'
    });
    assert(tDailyRes.status === 201, 'Failed to create daily template');
    const tDaily = JSON.parse(tDailyRes.body);

    // B. Weekly (on tomorrow's weekday)
    const tWeeklyRes = await request('POST', 'http://localhost:3000/templates', authHeadersA, {
      title: 'Weekly Task',
      recurrence_type: 'weekly',
      days_of_week: [tomorrowWeekday],
      time_of_day: '09:00:00',
      timezone_snapshot: 'UTC'
    });
    assert(tWeeklyRes.status === 201, 'Failed to create weekly template');
    const tWeekly = JSON.parse(tWeeklyRes.body);

    // C. Monthly (on tomorrow's day of month)
    const tMonthlyRes = await request('POST', 'http://localhost:3000/templates', authHeadersA, {
      title: 'Monthly Task',
      recurrence_type: 'monthly',
      day_of_month: tomorrowDayOfMonth,
      time_of_day: '10:00:00',
      timezone_snapshot: 'UTC'
    });
    assert(tMonthlyRes.status === 201, 'Failed to create monthly template');
    const tMonthly = JSON.parse(tMonthlyRes.body);

    // D. Custom Interval (every 3 days)
    const tCustomRes = await request('POST', 'http://localhost:3000/templates', authHeadersA, {
      title: 'Custom Interval Task',
      recurrence_type: 'custom_interval',
      interval_days: 3,
      time_of_day: '11:00:00',
      timezone_snapshot: 'UTC'
    });
    assert(tCustomRes.status === 201, 'Failed to create custom_interval template');
    const tCustom = JSON.parse(tCustomRes.body);

    // 3. Trigger manual instance generation (First Run)
    console.log('\nTriggering manual instance generation (First Run)...');
    const genRes1 = await request('POST', 'http://localhost:3000/admin/generate-instances', authHeadersA);
    assert(genRes1.status === 200, `Generation failed: ${genRes1.body}`);
    const body1 = JSON.parse(genRes1.body);
    console.log('Results:', body1.results);

    // Assert that instances were created
    const dailyGen = body1.results.find((r: any) => r.templateId === tDaily.id);
    assert(dailyGen && dailyGen.generatedCount > 0, 'Daily template should generate instances');

    const weeklyGen = body1.results.find((r: any) => r.templateId === tWeekly.id);
    assert(weeklyGen && weeklyGen.generatedCount > 0, 'Weekly template should generate instances');

    const monthlyGen = body1.results.find((r: any) => r.templateId === tMonthly.id);
    assert(monthlyGen && monthlyGen.generatedCount > 0, 'Monthly template should generate instances');

    const customGen = body1.results.find((r: any) => r.templateId === tCustom.id);
    assert(customGen && customGen.generatedCount > 0, 'Custom template should generate instances');

    // Retrieve tasks from DB to verify exact dates and properties
    const tasksRes = await dbClient.query('SELECT * FROM tasks WHERE user_id = $1 ORDER BY deadline_at ASC', [userAId]);
    console.log(`\nCreated ${tasksRes.rowCount} task instances:`);
    for (const task of tasksRes.rows) {
      console.log(`- Task: "${task.title}", Deadline: ${task.deadline_at.toISOString()}, TemplateID: ${task.recurrence_template_id}`);
    }

    // Verify Anchor rule: no task generated for today
    const todayISOStr = today.toISOString().substring(0, 10);
    const hasTodayInstance = tasksRes.rows.some((task: any) => task.deadline_at.toISOString().startsWith(todayISOStr));
    assert(!hasTodayInstance, 'Anchor Day rule failed: generated instance on creation day (today) itself');
    console.log('\nAnchor Day rule PASSED: No instances created for today (creation day).');

    // Save total count of instances
    const initialTaskCount = tasksRes.rowCount || 0;

    // 4. Trigger manual instance generation (Second Run - Idempotency check)
    console.log('\nTriggering manual instance generation (Second Run)...');
    const genRes2 = await request('POST', 'http://localhost:3000/admin/generate-instances', authHeadersA);
    assert(genRes2.status === 200, 'Second run failed');
    const body2 = JSON.parse(genRes2.body);
    
    // Assert 0 new instances were generated
    for (const r of body2.results) {
      assert(r.generatedCount === 0, `Idempotency failed: template ${r.templateId} generated ${r.generatedCount} instances on second run.`);
    }
    console.log('Results (all should be 0):', body2.results);

    const tasksRes2 = await dbClient.query('SELECT count(*) FROM tasks WHERE user_id = $1', [userAId]);
    const finalTaskCount = parseInt(tasksRes2.rows[0].count, 10);
    assert(finalTaskCount === initialTaskCount, `Idempotency count mismatch: first run created ${initialTaskCount}, second run count is ${finalTaskCount}`);
    console.log('Idempotency PASSED: Row count remains identical.');

    console.log('\nAll Instance Generation Job integration tests PASSED successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Integration tests FAILED:', error);
    process.exit(1);
  } finally {
    console.log('Cleaning up database test data...');
    try {
      await dbClient.query('DELETE FROM tasks WHERE user_id = $1', [userAId]);
      await dbClient.query('DELETE FROM recurrence_templates WHERE user_id = $1', [userAId]);
      await dbClient.query('DELETE FROM users WHERE id = $1', [userAId]);
    } catch (cleanupErr) {
      console.error('Failed to cleanup test data:', cleanupErr);
    }
    dbClient.release();
  }
}

run();

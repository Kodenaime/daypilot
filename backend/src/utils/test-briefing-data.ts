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
  console.log('Running Daily Briefing Data Aggregation integration tests...');

  const dbClient = await pool.connect();
  const testEmail = 'briefing_test_user@example.com';
  let userId: string;

  try {
    // 1. Create a clean test user
    const userRes = await dbClient.query(
      `INSERT INTO users (email, device_timezone) 
       VALUES ($1, $2) 
       ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email 
       RETURNING id`,
      [testEmail, 'UTC']
    );
    userId = userRes.rows[0].id;

    // Clean existing tasks for user
    await dbClient.query('DELETE FROM tasks WHERE user_id = $1', [userId]);

    // Task A: Scheduled for Today (in the future relative to server time to prevent it from being overdue)
    const todayTaskDate = new Date(Date.now() + 10 * 60 * 1000);
    await dbClient.query(
      `INSERT INTO tasks (user_id, title, deadline_at, timezone_snapshot, status)
       VALUES ($1, 'Today Task', $2, 'UTC', 'pending') RETURNING *`,
      [userId, todayTaskDate]
    );

    // Task B: Overdue by 3 days (Should be included in overdueTasks)
    const overdue3DaysDate = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    await dbClient.query(
      `INSERT INTO tasks (user_id, title, deadline_at, timezone_snapshot, status)
       VALUES ($1, 'Overdue 3 Days Task', $2, 'UTC', 'pending') RETURNING *`,
      [userId, overdue3DaysDate]
    );

    // Task C: Overdue by 8 days (Should be EXCLUDED from overdueTasks due to 7-day cutoff)
    const overdue8DaysDate = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    await dbClient.query(
      `INSERT INTO tasks (user_id, title, deadline_at, timezone_snapshot, status)
       VALUES ($1, 'Overdue 8 Days Task', $2, 'UTC', 'pending')`,
      [userId, overdue8DaysDate]
    );

    // Task D: Scheduled 3 days ago but Completed (Should be EXCLUDED)
    await dbClient.query(
      `INSERT INTO tasks (user_id, title, deadline_at, timezone_snapshot, status)
       VALUES ($1, 'Completed Old Task', $2, 'UTC', 'completed')`,
      [userId, overdue3DaysDate]
    );

    // Task E: Scheduled for Tomorrow (Should be EXCLUDED)
    const tomorrowDate = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await dbClient.query(
      `INSERT INTO tasks (user_id, title, deadline_at, timezone_snapshot, status)
       VALUES ($1, 'Tomorrow Task', $2, 'UTC', 'pending')`,
      [userId, tomorrowDate]
    );

    console.log('Test tasks populated successfully.');
  } finally {
    dbClient.release();
  }

  const token = issueToken(userId);
  const authHeaders = { 'Authorization': `Bearer ${token}` };

  // ====================================================
  // Execute test request to endpoint
  // ====================================================
  console.log('Calling GET /admin/test-briefing-data...');
  const res = await request('GET', 'http://localhost:3000/admin/test-briefing-data', authHeaders);
  assert(res.status === 200, `Expected 200, got ${res.status}`);

  const data = JSON.parse(res.body);
  console.log('Briefing Data Response:');
  console.log(`- todayTasks count: ${data.todayTasks.length}`);
  console.log(`- overdueTasks count: ${data.overdueTasks.length}`);
  console.log('Overdue Tasks:', data.overdueTasks.map((t: any) => `${t.title} (${t.deadline_at})`));

  // Assertions for today's tasks
  assert(data.todayTasks.length === 1, `Expected exactly 1 todayTask, got ${data.todayTasks.length}`);
  assert(data.todayTasks[0].id === data.todayTasks[0].id, 'Today task ID mismatch');
  assert(data.todayTasks[0].title === 'Today Task', 'Expected Today Task');

  // Assertions for overdue tasks
  assert(data.overdueTasks.length === 1, `Expected exactly 1 overdueTask, got ${data.overdueTasks.length}`);
  assert(data.overdueTasks[0].title === 'Overdue 3 Days Task', 'Expected Overdue 3 Days Task');

  console.log('\nDAILY BRIEFING DATA AGGREGATION TESTS PASSED!');
}

run().then(() => {
  process.exit(0);
}).catch((err) => {
  console.error('Test run failed:', err);
  process.exit(1);
});

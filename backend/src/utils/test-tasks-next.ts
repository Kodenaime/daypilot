import http from 'http';
import { URL } from 'url';
import { pool } from '../config/db';

function request(method: string, url: string, headers: Record<string, string> = {}, body?: any): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const options = {
      method,
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    };
    const req = http.request(options, (res) => {
      let responseBody = '';
      res.on('data', (chunk) => { responseBody += chunk; });
      res.on('end', () => {
        resolve({ status: res.statusCode || 0, body: responseBody });
      });
    });
    req.on('error', reject);
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function runTests() {
  console.log('--- Testing GET /tasks/next ---');
  let testUserId: string | null = null;
  try {
    // 1. Create a clean temporary user
    console.log('Creating clean temporary user...');
    const userInsertRes = await pool.query(
      "INSERT INTO users (email, device_timezone) VALUES ($1, $2) RETURNING id",
      [`testfocus_${Date.now()}@example.com`, 'UTC']
    );
    testUserId = userInsertRes.rows[0].id;
    console.log('Temporary test userId:', testUserId);

    const tokenRes = await request('GET', `http://localhost:3000/auth/test-token/${testUserId}`);
    const token = JSON.parse(tokenRes.body).token;
    const authHeaders = { 'Authorization': `Bearer ${token}` };

    // Test Case 1: No tasks -> should return task: null
    console.log('Test Case 1: Checking empty return (no tasks)...');
    const resEmpty1 = await request('GET', 'http://localhost:3000/tasks/next', authHeaders);
    console.log('GET /tasks/next (Empty) Status:', resEmpty1.status);
    console.log('GET /tasks/next (Empty) Body:', resEmpty1.body);
    const emptyPayload1 = JSON.parse(resEmpty1.body);
    if (emptyPayload1.task !== null) {
      throw new Error('Expected task to be null for clean user with zero tasks');
    }

    // Test Case 1b: Undated tasks only -> should return task: null
    console.log('Test Case 1b: Checking empty return (undated tasks only)...');
    await pool.query(
      'INSERT INTO tasks (user_id, title, deadline_at, status, timezone_snapshot) VALUES ($1, \'TestFocus Undated\', NULL, \'pending\', \'UTC\')',
      [testUserId]
    );
    const resEmpty2 = await request('GET', 'http://localhost:3000/tasks/next', authHeaders);
    console.log('GET /tasks/next (Undated Only) Body:', resEmpty2.body);
    const emptyPayload2 = JSON.parse(resEmpty2.body);
    if (emptyPayload2.task !== null) {
      throw new Error('Expected task to be null when only undated tasks exist');
    }

    // Test Case 2: Overdue task vs Future task -> overdue should outrank future
    console.log('Test Case 2: Checking overdue outranking future...');
    const overdueDeadline = new Date();
    overdueDeadline.setHours(overdueDeadline.getHours() - 2); // 2 hours overdue
    await pool.query(
      'INSERT INTO tasks (user_id, title, deadline_at, status, timezone_snapshot) VALUES ($1, \'TestFocus Overdue\', $2, \'pending\', \'UTC\')',
      [testUserId, overdueDeadline]
    );

    const futureDeadline = new Date();
    futureDeadline.setHours(futureDeadline.getHours() + 5); // 5 hours in future
    await pool.query(
      'INSERT INTO tasks (user_id, title, deadline_at, status, timezone_snapshot) VALUES ($1, \'TestFocus Future\', $2, \'pending\', \'UTC\')',
      [testUserId, futureDeadline]
    );

    const resNext1 = await request('GET', 'http://localhost:3000/tasks/next', authHeaders);
    console.log('GET /tasks/next (Overdue vs Future) Body:', resNext1.body);
    const payload1 = JSON.parse(resNext1.body);
    if (!payload1.task || payload1.task.title !== 'TestFocus Overdue') {
      throw new Error('Expected "TestFocus Overdue" to outrank future task');
    }

    // Test Case 3: Multiple overdue tasks -> oldest overdue should be returned (smallest/most-in-the-past deadline)
    console.log('Test Case 3: Checking oldest overdue priority...');
    const oldestOverdueDeadline = new Date();
    oldestOverdueDeadline.setHours(oldestOverdueDeadline.getHours() - 10); // 10 hours overdue
    await pool.query(
      'INSERT INTO tasks (user_id, title, deadline_at, status, timezone_snapshot) VALUES ($1, \'TestFocus Oldest Overdue\', $2, \'pending\', \'UTC\')',
      [testUserId, oldestOverdueDeadline]
    );

    const resNext2 = await request('GET', 'http://localhost:3000/tasks/next', authHeaders);
    console.log('GET /tasks/next (Multiple Overdue) Body:', resNext2.body);
    const payload2 = JSON.parse(resNext2.body);
    if (!payload2.task || payload2.task.title !== 'TestFocus Oldest Overdue') {
      throw new Error('Expected "TestFocus Oldest Overdue" (10 hours overdue) to take priority over "TestFocus Overdue" (2 hours overdue)');
    }

    // Clean up temporary user and tasks cascaded
    if (testUserId) {
      console.log('Cleaning up temporary test user...');
      await pool.query('DELETE FROM users WHERE id = $1', [testUserId]);
    }

    console.log('\nGET /tasks/next Focus Mode Endpoint Tests PASS!');
    process.exit(0);
  } catch (error) {
    console.error('GET /tasks/next Verification FAIL:', error);
    // Cleanup if failed
    if (testUserId) {
      await pool.query('DELETE FROM users WHERE id = $1', [testUserId]);
    }
    process.exit(1);
  }
}

runTests();

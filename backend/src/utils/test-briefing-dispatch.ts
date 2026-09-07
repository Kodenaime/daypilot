import http from 'http';
import { URL } from 'url';
import { pool } from '../config/db';
import { issueToken } from './jwt';
import { encrypt } from './encryption';

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
  console.log('Running Payload Composition & Dispatch Integration Tests...');

  const dbClient = await pool.connect();
  const testEmail = 'briefing_dispatch_user@example.com';
  let userId: string;

  try {
    // Setup test user & valid tokens and mock FCM token
    const userRes = await dbClient.query(
      `INSERT INTO users (email, device_timezone, fcm_token) 
       VALUES ($1, $2, $3) 
       ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email, fcm_token = EXCLUDED.fcm_token
       RETURNING id`,
      [testEmail, 'UTC', 'mock_briefing_fcm_token']
    );
    userId = userRes.rows[0].id;

    // Clean existing tasks & accounts
    await dbClient.query('DELETE FROM tasks WHERE user_id = $1', [userId]);
    await dbClient.query('DELETE FROM google_accounts WHERE user_id = $1', [userId]);

    const validAccess = encrypt('mock-access-token');
    const validRefresh = encrypt('mock-refresh-token');
    await dbClient.query(
      `INSERT INTO google_accounts (user_id, access_token, refresh_token, token_expires_at, sync_status)
       VALUES ($1, $2, $3, $4, 'healthy')`,
      [userId, validAccess, validRefresh, new Date(Date.now() + 3600000)]
    );
  } finally {
    dbClient.release();
  }

  const token = issueToken(userId);
  const authHeaders = { 'Authorization': `Bearer ${token}` };

  // ====================================================
  // Case 1: Healthy Dispatch with active today + overdue tasks
  // ====================================================
  console.log('\n--- Test Case 1: Healthy Dispatch with Active Tasks ---');
  
  const mockDateBeforeCutoff = new Date();
  mockDateBeforeCutoff.setHours(5, 0, 0, 0);

  // ====================================================
  // Case 1: Healthy Dispatch with active today + overdue tasks
  // ====================================================
  
  // Populate tasks
  const dbClient1 = await pool.connect();
  try {
    const today = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2 hours in future, still today
    await dbClient1.query(
      `INSERT INTO tasks (user_id, title, deadline_at, timezone_snapshot, status)
       VALUES ($1, 'Active Today Task', $2, 'UTC', 'pending')`,
      [userId, today]
    );

    const overdue = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000); // 2 days overdue
    await dbClient1.query(
      `INSERT INTO tasks (user_id, title, deadline_at, timezone_snapshot, status)
       VALUES ($1, 'Overdue Task', $2, 'UTC', 'pending')`,
      [userId, overdue]
    );
  } finally {
    dbClient1.release();
  }

  // Verify the manual trigger endpoint returns successful outcome
  const res1 = await request('POST', 'http://localhost:3000/admin/trigger-briefing', authHeaders, {
    mockDate: mockDateBeforeCutoff.toISOString()
  });
  assert(res1.status === 200, `Expected 200, got ${res1.status}`);
  const body1 = JSON.parse(res1.body);
  console.log('Outcome:', body1.outcome);
  assert(body1.outcome === 'success', 'Expected success outcome');

  // Verify notification_log has briefing entries for both push & email channels
  const dbClientLog1 = await pool.connect();
  try {
    const logRes = await dbClientLog1.query(
      `SELECT * FROM notification_log WHERE user_id = $1 AND notification_type = 'briefing' ORDER BY channel ASC`,
      [userId]
    );
    assert(logRes.rows.length === 2, `Expected 2 logs, got ${logRes.rows.length}`);
    const [emailLog, pushLog] = logRes.rows;
    assert(emailLog.channel === 'email', 'Expected email log');
    assert(pushLog.channel === 'push', 'Expected push log');
    console.log('FCM and Resend briefing logs successfully registered.');
  } finally {
    dbClientLog1.release();
  }

  // ====================================================
  // Case 2: Healthy Dispatch with Zero Tasks (Empty State)
  // ====================================================
  console.log('\n--- Test Case 2: Healthy Dispatch with Zero Tasks (Empty State) ---');
  
  // Clear tasks
  const dbClient2 = await pool.connect();
  try {
    await dbClient2.query('DELETE FROM tasks WHERE user_id = $1', [userId]);
    // Clear log rows to ensure we test freshly generated empty state logs
    await dbClient2.query('DELETE FROM notification_log WHERE user_id = $1', [userId]);
  } finally {
    dbClient2.release();
  }

  const res2 = await request('POST', 'http://localhost:3000/admin/trigger-briefing', authHeaders, {
    mockDate: mockDateBeforeCutoff.toISOString()
  });
  assert(res2.status === 200, `Expected 200, got ${res2.status}`);
  const body2 = JSON.parse(res2.body);
  console.log('Outcome (empty state):', body2.outcome);
  assert(body2.outcome === 'success', 'Expected success outcome');

  // Verify notification_log has empty state briefing entries
  const dbClientLog2 = await pool.connect();
  try {
    const logRes = await dbClientLog2.query(
      `SELECT * FROM notification_log WHERE user_id = $1 AND notification_type = 'briefing'`,
      [userId]
    );
    assert(logRes.rows.length === 2, `Expected 2 logs, got ${logRes.rows.length}`);
    console.log('Empty state logs successfully registered.');
  } finally {
    dbClientLog2.release();
  }

  // ====================================================
  // Case 3: Health Check Failure (Fixed Fallback Dispatch)
  // ====================================================
  console.log('\n--- Test Case 3: Health Check Failure (Fixed Fallback Dispatch) ---');
  
  // Corrupt refresh token in DB
  const dbClient3 = await pool.connect();
  try {
    await dbClient3.query(
      `UPDATE google_accounts SET refresh_token = 'corrupted-refresh-token' WHERE user_id = $1`,
      [userId]
    );
    await dbClient3.query('DELETE FROM notification_log WHERE user_id = $1', [userId]);
  } finally {
    dbClient3.release();
  }

  const res3 = await request('POST', 'http://localhost:3000/admin/trigger-briefing', authHeaders);
  assert(res3.status === 200, `Expected 200, got ${res3.status}`);
  const body3 = JSON.parse(res3.body);
  console.log('Outcome (fallback):', body3.outcome);
  assert(body3.outcome === 'fallback', 'Expected fallback outcome');

  // Verify notification_log has system_fallback logs
  const dbClientLog3 = await pool.connect();
  try {
    const logRes = await dbClientLog3.query(
      `SELECT * FROM notification_log WHERE user_id = $1 AND notification_type = 'system_fallback'`,
      [userId]
    );
    assert(logRes.rows.length === 2, `Expected 2 fallback logs, got ${logRes.rows.length}`);
    console.log('Fallback logs successfully registered under system_fallback.');
  } finally {
    dbClientLog3.release();
  }

  console.log('\nALL BRIEFING COMPOSITION AND DISPATCH INTEGRATION TESTS PASSED!');
}

run().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('Test run failed:', err);
  process.exit(1);
});

import http from 'http';
import { URL } from 'url';
import { pool } from '../config/db';
import { issueToken } from './jwt';
import { encrypt } from './encryption';

import { runHealthCheck } from '../services/healthCheckService';

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
  console.log('Running health check route and service tests...');
  
  const testEmail = 'healthcheck_test@example.com';
  
  // 1. Create a test user in the database
  const dbClient = await pool.connect();
  let userId: string;
  try {
    const userRes = await dbClient.query(
      `INSERT INTO users (email, device_timezone) 
       VALUES ($1, $2) 
       ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email 
       RETURNING id`,
      [testEmail, 'UTC']
    );
    userId = userRes.rows[0].id;
    
    // Clean prior tokens
    await dbClient.query('DELETE FROM google_accounts WHERE user_id = $1', [userId]);

    // Insert a valid encrypted token configuration
    const validAccess = encrypt('mock-access-token');
    const validRefresh = encrypt('mock-refresh-token');
    const expiresAt = new Date(Date.now() + 3600 * 1000); // 1 hour in the future (no refresh needed)

    await dbClient.query(
      `INSERT INTO google_accounts (user_id, access_token, refresh_token, token_expires_at, sync_status)
       VALUES ($1, $2, $3, $4, 'healthy')`,
      [userId, validAccess, validRefresh, expiresAt]
    );
  } finally {
    dbClient.release();
  }

  const token = issueToken(userId);
  const authHeaders = { 'Authorization': `Bearer ${token}` };

  // ====================================================
  // Test Case 1: Healthy Status Check
  // ====================================================
  console.log('\n--- Test Case 1: Healthy Status Check ---');
  const res1 = await request('GET', 'http://localhost:3000/admin/test-health-check', authHeaders);
  assert(res1.status === 200, `Expected 200, got ${res1.status}`);
  
  const body1 = JSON.parse(res1.body);
  console.log('Response:', body1);
  assert(body1.healthy === true, 'Expected healthy to be true');
  assert(body1.details.database === true, 'Expected database: true');
  assert(body1.details.googleToken === true, 'Expected googleToken: true');
  console.log('Test Case 1 passed.');

  // ====================================================
  // Test Case 2: Corrupted Token Check
  // ====================================================
  console.log('\n--- Test Case 2: Corrupted Token Check ---');
  const dbClient2 = await pool.connect();
  try {
    // Write invalid/corrupt refresh token value
    await dbClient2.query(
      `UPDATE google_accounts SET refresh_token = 'completely-invalid-corrupted-ciphertext' WHERE user_id = $1`,
      [userId]
    );
  } finally {
    dbClient2.release();
  }

  const res2 = await request('GET', 'http://localhost:3000/admin/test-health-check', authHeaders);
  assert(res2.status === 200, `Expected 200, got ${res2.status}`);
  
  const body2 = JSON.parse(res2.body);
  console.log('Response:', body2);
  assert(body2.healthy === false, 'Expected healthy to be false');
  assert(body2.details.database === true, 'Expected database to still be true');
  assert(body2.details.googleToken === false, 'Expected googleToken to be false');
  assert(body2.failureReason.includes('Google token invalid or expired'), 'Expected Google token error in failureReason');

  // Verify that database state of sync_status updated to 'token_expired'
  const checkDb = await pool.query('SELECT sync_status FROM google_accounts WHERE user_id = $1', [userId]);
  assert(checkDb.rows[0].sync_status === 'token_expired', `Expected sync_status to be 'token_expired', got '${checkDb.rows[0].sync_status}'`);
  console.log('Test Case 2 passed.');

  // ====================================================
  // Test Case 3: Database Connection Failure Check
  // ====================================================
  console.log('\n--- Test Case 3: Database Connection Failure Check ---');
  
  // Restore valid token so we only test database failure
  const dbClient3 = await pool.connect();
  try {
    const validRefresh = encrypt('mock-refresh-token');
    await dbClient3.query(
      `UPDATE google_accounts SET refresh_token = $1, sync_status = 'healthy' WHERE user_id = $2`,
      [validRefresh, userId]
    );
  } finally {
    dbClient3.release();
  }

  // Stub pool.query to simulate connection/query failure
  const originalQuery = pool.query;
  pool.query = (async (text: any, params?: any): Promise<any> => {
    // Only fail SELECT 1 (our DB ping) to avoid breaking auth/jwt db lookups if any occur
    if (typeof text === 'string' && text.trim() === 'SELECT 1') {
      throw new Error('Simulated database connection failure');
    }
    return (originalQuery as any).apply(pool, [text, params]);
  }) as any;

  try {
    const body3 = await runHealthCheck(userId);
    console.log('Response:', body3);
    assert(body3.healthy === false, 'Expected healthy to be false');
    assert(body3.details.database === false, 'Expected database: false');
    assert(body3.details.googleToken === true, 'Expected googleToken: true');
    assert(body3.failureReason?.includes('Database connection failed') === true, 'Expected database failure in failureReason');
    console.log('Test Case 3 passed.');
  } finally {
    // Restore original pool query
    pool.query = originalQuery;
  }

  console.log('\nALL HEALTH CHECK INTEGRATION TESTS PASSED!');
}

run().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('Test run failed:', err);
  process.exit(1);
});

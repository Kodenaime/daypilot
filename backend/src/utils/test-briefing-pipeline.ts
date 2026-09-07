import { pool } from '../config/db';
import { runBriefingPipeline } from '../services/briefingOrchestrator';
import { encrypt } from './encryption';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function run() {
  console.log('Running Daily Briefing Pipeline Orchestrator Integration Tests...');

  const dbClient = await pool.connect();
  const testEmail = 'pipeline_test_user@example.com';
  let userId: string;

  try {
    // Setup test user & valid tokens
    const userRes = await dbClient.query(
      `INSERT INTO users (email, device_timezone) 
       VALUES ($1, $2) 
       ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email 
       RETURNING id`,
      [testEmail, 'UTC']
    );
    userId = userRes.rows[0].id;

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

  // Pre-define a mock date well before 6:30 AM (e.g. 5:00 AM)
  const mockDateBeforeCutoff = new Date();
  mockDateBeforeCutoff.setUTCHours(5);
  mockDateBeforeCutoff.setUTCMinutes(0);

  // Preserve original pool.query
  const originalQuery = pool.query;

  // ====================================================
  // Case 1: Healthy First-Attempt Success
  // ====================================================
  console.log('\n--- Test Case 1: Healthy First-Attempt Success ---');
  const res1 = await runBriefingPipeline(userId, { mockDate: mockDateBeforeCutoff, retryDelayMs: 1 });
  console.log('Outcome:', res1.outcome);
  assert(res1.outcome === 'success', 'Expected success outcome');
  assert(res1.data !== undefined, 'Expected data to be populated');
  console.log('Case 1 passed.');

  // ====================================================
  // Case 2: Health Check Failure (Immediate Fallback)
  // ====================================================
  console.log('\n--- Test Case 2: Health Check Failure (Immediate Fallback) ---');
  // Corrupt the token in database
  const dbClient2 = await pool.connect();
  try {
    await dbClient2.query(
      `UPDATE google_accounts SET refresh_token = 'corrupted-refresh-token' WHERE user_id = $1`,
      [userId]
    );
  } finally {
    dbClient2.release();
  }

  const res2 = await runBriefingPipeline(userId, { mockDate: mockDateBeforeCutoff, retryDelayMs: 1 });
  console.log('Outcome:', res2.outcome);
  assert(res2.outcome === 'fallback', 'Expected fallback outcome');
  assert(res2.data === undefined, 'Expected no data');
  console.log('Case 2 passed.');

  // Restore valid token
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

  // ====================================================
  // Case 3: Temporary Aggregation Failure (Recovers on Attempt 3)
  // ====================================================
  console.log('\n--- Test Case 3: Temporary Aggregation Failure (Recovers on Attempt 3) ---');
  let failCount = 0;
  const maxFailures = 2; // Succeeded on attempt 3
  
  pool.query = (async (text: any, params?: any): Promise<any> => {
    // Only fail the "today tasks" query specifically to count attempts accurately
    if (typeof text === 'string' && text.includes('deadline_at >= ($2 ||')) {
      if (failCount < maxFailures) {
        failCount++;
        throw new Error(`Simulated database query failure attempt ${failCount}`);
      }
    }
    return (originalQuery as any).apply(pool, [text, params]);
  }) as any;

  try {
    const res3 = await runBriefingPipeline(userId, { mockDate: mockDateBeforeCutoff, retryDelayMs: 10 });
    console.log('Outcome:', res3.outcome);
    assert(res3.outcome === 'success', 'Expected eventual success outcome');
    assert(failCount === 2, `Expected exactly 2 query failures, got ${failCount}`);
    console.log('Case 3 passed.');
  } finally {
    pool.query = originalQuery;
  }

  // ====================================================
  // Case 4: Persistent Aggregation Failure (Fallback after 10 attempts)
  // ====================================================
  console.log('\n--- Test Case 4: Persistent Aggregation Failure ---');
  let attemptCount = 0;
  pool.query = (async (text: any, params?: any): Promise<any> => {
    if (typeof text === 'string' && text.includes('deadline_at >= ($2 ||')) {
      attemptCount++;
      throw new Error('Simulated persistent DB query failure');
    }
    return (originalQuery as any).apply(pool, [text, params]);
  }) as any;

  try {
    const res4 = await runBriefingPipeline(userId, { mockDate: mockDateBeforeCutoff, retryDelayMs: 1 });
    console.log('Outcome:', res4.outcome);
    assert(res4.outcome === 'fallback', 'Expected fallback outcome due to exhaustion');
    assert(attemptCount === 10, `Expected exactly 10 attempts, got ${attemptCount}`);
    console.log('Case 4 passed.');
  } finally {
    pool.query = originalQuery;
  }

  // ====================================================
  // Case 5: Time Cutoff Abandonment (6:30 AM Cutoff)
  // ====================================================
  console.log('\n--- Test Case 5: Time Cutoff Abandonment ---');
  // Mock current time to 6:30 AM exactly
  const mockCutoffDate = new Date();
  mockCutoffDate.setUTCHours(6);
  mockCutoffDate.setUTCMinutes(30);

  const res5 = await runBriefingPipeline(userId, { mockDate: mockCutoffDate, retryDelayMs: 1 });
  console.log('Outcome:', res5.outcome);
  assert(res5.outcome === 'fallback', 'Expected fallback outcome due to time cutoff');
  console.log('Case 5 passed.');

  console.log('\nALL BRIEFING PIPELINE ORCHESTRATOR TESTS PASSED!');
}

run().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('Test run failed:', err);
  process.exit(1);
});

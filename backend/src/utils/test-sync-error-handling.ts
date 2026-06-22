// Set NODE_ENV to 'test' so backoff delay is short
process.env.NODE_ENV = 'test';

import { pool } from '../config/db';
import { encrypt } from './encryption';
import { OAuth2Client } from 'google-auth-library';
import { performIncrementalSync } from '../services/googleCalendar';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

// Keep a reference to the original request function
const originalRequest = OAuth2Client.prototype.request;

// Mutable stub that we can change dynamically
let requestStub: (...args: any[]) => Promise<any> = async () => {
  throw new Error('No stub defined');
};

// Override the request method
OAuth2Client.prototype.request = function (...args: any[]) {
  return requestStub.apply(this, args);
};

async function run() {
  console.log('Starting Google Calendar sync error handling integration tests...');
  const client = await pool.connect();

  const testEmail = 'sync_error_test_user@example.com';
  const testUserId = 'f05042e9-4417-4509-86bb-aab4a6b6c446';

  try {

    // 1. Setup test user and google account
    console.log('Inserting test user and google account...');
    await client.query(
      `INSERT INTO users (id, email, device_timezone) 
       VALUES ($1, $2, $3) 
       ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email`,
      [testUserId, testEmail, 'UTC']
    );

    const encryptedAccess = encrypt('dummy_access_token');
    const encryptedRefresh = encrypt('dummy_refresh_token');

    // Clean any prior data
    await client.query('DELETE FROM tasks WHERE user_id = $1', [testUserId]);
    await client.query('DELETE FROM google_accounts WHERE user_id = $1', [testUserId]);

    await client.query(
      `INSERT INTO google_accounts (user_id, access_token, refresh_token, token_expires_at, sync_status, sync_token)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [testUserId, encryptedAccess, encryptedRefresh, new Date(Date.now() + 3600000), 'healthy', 'initial_sync_token']
    );

    // ==========================================
    // Test Case 1: HTTP 410 (syncToken invalid)
    // ==========================================
    console.log('\n--- Test Case 1: HTTP 410 syncToken invalid (Should perform full resync) ---');
    let requestCount = 0;
    requestStub = async (_options: any) => {
      requestCount++;
      if (requestCount === 1) {
        // First request is performIncrementalSync's events.list call using syncToken
        assert(_options.params.syncToken === 'initial_sync_token', 'Should have sent the initial_sync_token');
        const err: any = new Error('Sync token invalid');
        err.status = 410;
        throw err;
      } else {
        // Second request is the resync (performInitialSync's events.list call)
        assert(_options.params.syncToken === undefined, 'Resync should not pass syncToken');
        return {
          data: {
            items: [
              {
                id: 'event_after_410_resync',
                summary: 'Event After 410 Resync',
                status: 'confirmed',
                start: { dateTime: new Date().toISOString() }
              }
            ],
            nextSyncToken: 'new_valid_sync_token'
          }
        };
      }
    };

    console.log('Running performIncrementalSync expecting HTTP 410 -> initial resync recovery...');
    const res1 = await performIncrementalSync(testUserId);
    console.log('Result:', res1);

    assert(res1.upsertedCount === 1, 'Should have imported 1 event during resync');
    
    // Check DB state
    const accRes1 = await client.query('SELECT sync_token, sync_status FROM google_accounts WHERE user_id = $1', [testUserId]);
    assert(accRes1.rows[0].sync_token === 'new_valid_sync_token', `Expected sync_token to be 'new_valid_sync_token', got ${accRes1.rows[0].sync_token}`);
    assert(accRes1.rows[0].sync_status === 'healthy', `Expected sync_status to be 'healthy', got ${accRes1.rows[0].sync_status}`);

    const taskRes1 = await client.query('SELECT title FROM tasks WHERE user_id = $1', [testUserId]);
    assert(taskRes1.rowCount === 1 && taskRes1.rows[0].title === 'Event After 410 Resync', 'Expected task from full resync to be in database');
    console.log('Test Case 1 PASSED!');

    // ==========================================
    // Test Case 2: HTTP 429 Quota limit with single retry success
    // ==========================================
    console.log('\n--- Test Case 2: HTTP 429 Quota with retry-then-success ---');
    requestCount = 0;
    requestStub = async (_options: any) => {
      requestCount++;
      if (requestCount === 1) {
        console.log('Simulating first request failing with HTTP 429...');
        const err: any = new Error('Rate limit exceeded');
        err.status = 429;
        throw err;
      } else {
        console.log('Simulating retry request succeeding...');
        return {
          data: {
            items: [
              {
                id: 'event_after_quota_retry',
                summary: 'Event After Quota Retry',
                status: 'confirmed',
                start: { dateTime: new Date().toISOString() }
              }
            ],
            nextSyncToken: 'sync_token_after_quota'
          }
        };
      }
    };

    const res2 = await performIncrementalSync(testUserId);
    console.log('Result:', res2);
    assert(res2.upsertedCount === 1, 'Should have upserted 1 event after retry');
    assert(requestCount === 2, 'Should have made exactly 2 requests due to retry');
    
    const accRes2 = await client.query('SELECT sync_status FROM google_accounts WHERE user_id = $1', [testUserId]);
    assert(accRes2.rows[0].sync_status === 'healthy', 'sync_status should be healthy');
    console.log('Test Case 2 PASSED!');

    // ==========================================
    // Test Case 3: HTTP 429 Quota limit with double failure (Skip)
    // ==========================================
    console.log('\n--- Test Case 3: HTTP 429 Quota with double failure (Skip) ---');
    requestCount = 0;
    requestStub = async (_options: any) => {
      requestCount++;
      const err: any = new Error('Rate limit exceeded permanently');
      err.status = 429;
      throw err;
    };

    // First ensure status in DB is healthy
    await client.query("UPDATE google_accounts SET sync_status = 'healthy' WHERE user_id = $1", [testUserId]);

    let didThrow = false;
    try {
      await performIncrementalSync(testUserId);
    } catch (err: any) {
      didThrow = true;
      assert(err.status === 429, 'Expected 429 error to be thrown');
    }
    assert(didThrow, 'Expected performIncrementalSync to throw on double quota failure');
    assert(requestCount === 2, 'Should have retried once (total 2 requests)');

    // Verify sync_status is NOT 'sync_error' because it's a quota failure (handled case)
    const accRes3 = await client.query('SELECT sync_status FROM google_accounts WHERE user_id = $1', [testUserId]);
    assert(accRes3.rows[0].sync_status === 'healthy', `Expected sync_status to remain 'healthy', got ${accRes3.rows[0].sync_status}`);
    console.log('Test Case 3 PASSED!');

    // ==========================================
    // Test Case 4: Generic Error (HTTP 500)
    // ==========================================
    console.log('\n--- Test Case 4: Generic Error HTTP 500 (sync_status to sync_error) ---');
    requestStub = async (_options: any) => {
      const err: any = new Error('Internal Server Error');
      err.status = 500;
      throw err;
    };

    didThrow = false;
    try {
      await performIncrementalSync(testUserId);
    } catch (err: any) {
      didThrow = true;
      assert(err.status === 500, 'Expected 500 error to be thrown');
    }
    assert(didThrow, 'Expected performIncrementalSync to throw on generic failure');

    // Verify sync_status is updated to 'sync_error'
    const accRes4 = await client.query('SELECT sync_status FROM google_accounts WHERE user_id = $1', [testUserId]);
    assert(accRes4.rows[0].sync_status === 'sync_error', `Expected sync_status to be 'sync_error', got ${accRes4.rows[0].sync_status}`);
    console.log('Test Case 4 PASSED!');

    // ==========================================
    // Test Case 5: Recover from sync_error back to healthy
    // ==========================================
    console.log('\n--- Test Case 5: Recover back to healthy ---');
    requestStub = async (_options: any) => {
      return {
        data: {
          items: [],
          nextSyncToken: 'final_recovered_sync_token'
        }
      };
    };

    const res5 = await performIncrementalSync(testUserId);
    console.log('Result:', res5);
    const accRes5 = await client.query('SELECT sync_status, sync_token FROM google_accounts WHERE user_id = $1', [testUserId]);
    assert(accRes5.rows[0].sync_status === 'healthy', `Expected sync_status to recover to 'healthy', got ${accRes5.rows[0].sync_status}`);
    assert(accRes5.rows[0].sync_token === 'final_recovered_sync_token', 'Expected new sync token to be saved');
    console.log('Test Case 5 PASSED!');

    console.log('\nAll Google Calendar sync error handling integration tests PASSED successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Integration tests FAILED:', error);
    process.exit(1);
  } finally {
    try {
      console.log('Cleaning up database test data...');
      await client.query('DELETE FROM tasks WHERE user_id = $1', [testUserId]);
      await client.query('DELETE FROM google_accounts WHERE user_id = $1', [testUserId]);
      await client.query('DELETE FROM users WHERE id = $1', [testUserId]);
    } catch (cleanupErr) {
      console.error('Failed to cleanup test data:', cleanupErr);
    }
    // Restore original request function
    OAuth2Client.prototype.request = originalRequest;
    client.release();
  }
}

run();

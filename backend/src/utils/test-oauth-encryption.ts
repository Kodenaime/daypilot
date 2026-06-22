import { pool } from '../config/db';
import { encrypt, decrypt } from './encryption';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function run() {
  console.log('Running Google Accounts OAuth Encryption integration tests...');
  const client = await pool.connect();
  
  const testEmail = 'oauth_test_user@example.com';
  const rawAccessToken = 'ya29.access_token_plaintext_value_12345';
  const rawRefreshToken = '1//refresh_token_plaintext_value_67890';

  try {
    await client.query('BEGIN');

    // 1. Create a dummy test user
    console.log('Creating test user...');
    const userRes = await client.query(
      "INSERT INTO users (email, device_timezone) VALUES ($1, $2) ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email RETURNING id",
      [testEmail, 'UTC']
    );
    const userId = userRes.rows[0].id;
    console.log(`Test User ID: ${userId}`);

    // 2. Encrypt tokens and save to db
    console.log('Encrypting tokens...');
    const encryptedAccess = encrypt(rawAccessToken);
    const encryptedRefresh = encrypt(rawRefreshToken);

    console.log(`Encrypted Access Token: ${encryptedAccess}`);
    console.log(`Encrypted Refresh Token: ${encryptedRefresh}`);

    assert(encryptedAccess !== rawAccessToken, 'Access token cipher text should not match plain text');
    assert(encryptedRefresh !== rawRefreshToken, 'Refresh token cipher text should not match plain text');

    // Clean any prior account for this user
    await client.query('DELETE FROM google_accounts WHERE user_id = $1', [userId]);

    console.log('Inserting encrypted values into google_accounts...');
    await client.query(
      `INSERT INTO google_accounts (user_id, access_token, refresh_token, token_expires_at, sync_status)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, encryptedAccess, encryptedRefresh, new Date(Date.now() + 3600000), 'healthy']
    );

    // 3. Query the database to retrieve stored values
    console.log('Retrieving stored credentials from database...');
    const dbRes = await client.query(
      'SELECT access_token, refresh_token FROM google_accounts WHERE user_id = $1',
      [userId]
    );
    assert(dbRes.rowCount === 1, 'Credentials should be retrieved');

    const storedAccess = dbRes.rows[0].access_token;
    const storedRefresh = dbRes.rows[0].refresh_token;

    console.log('Verifying stored data is encrypted...');
    assert(storedAccess === encryptedAccess, 'Stored access token should match encrypted payload');
    assert(storedRefresh === encryptedRefresh, 'Stored refresh token should match encrypted payload');
    assert(!storedAccess.includes('ya29.access_token'), 'Stored access token should not contain plaintext substrings');

    // 4. Decrypt and check round-trip integrity
    console.log('Decrypting retrieved database records...');
    const decryptedAccess = decrypt(storedAccess);
    const decryptedRefresh = decrypt(storedRefresh);

    console.log(`Decrypted Access Token: ${decryptedAccess}`);
    console.log(`Decrypted Refresh Token: ${decryptedRefresh}`);

    assert(decryptedAccess === rawAccessToken, 'Decrypted access token must match original plaintext');
    assert(decryptedRefresh === rawRefreshToken, 'Decrypted refresh token must match original plaintext');

    console.log('Cleaning up database test logs...');
    await client.query('ROLLBACK'); // Rollback so we don't pollute the dev db

    console.log('Google Accounts Encryption integration tests PASSED successfully!');
    process.exit(0);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Integration test failed:', error);
    process.exit(1);
  } finally {
    client.release();
  }
}

run();

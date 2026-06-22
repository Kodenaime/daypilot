import { pool } from '../config/db';

async function check() {
  const users = await pool.query('SELECT * FROM users');
  console.log('Users:', users.rows);
  const accounts = await pool.query('SELECT user_id, last_synced_at, sync_status, sync_token FROM google_accounts');
  console.log('Google Accounts:', accounts.rows);
  process.exit(0);
}

check();

import fs from 'fs';
import path from 'path';
import { pool } from '../config/db';
import { logInfo, logError } from '../utils/logger';

export async function runMigrations(): Promise<void> {
  const client = await pool.connect();
  try {
    // 1. Create migration tracking table if it doesn't exist
    await client.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) UNIQUE NOT NULL,
        applied_at TIMESTAMPTZ DEFAULT now()
      );
    `);

    // 2. Identify the migrations to run
    const migrationName = '001_initial_schema.sql';
    
    // Check if already applied
    const res = await client.query('SELECT 1 FROM migrations WHERE name = $1', [migrationName]);
    if (res.rowCount && res.rowCount > 0) {
      logInfo('migrations', `Migration ${migrationName} is already applied.`, { migrationName });
      return;
    }

    // 3. Resolve the path of the SQL migration file
    let sqlPath = path.join(__dirname, migrationName);
    if (!fs.existsSync(sqlPath)) {
      // Fallback for compiled dist directory running
      sqlPath = path.join(__dirname, '../../src/migrations', migrationName);
    }

    if (!fs.existsSync(sqlPath)) {
      throw new Error(`Migration file not found at: ${sqlPath}`);
    }

    logInfo('migrations', `Running migration: ${migrationName}...`, { migrationName });
    const sql = fs.readFileSync(sqlPath, 'utf8');

    // 4. Run migration in a transaction
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('INSERT INTO migrations (name) VALUES ($1)', [migrationName]);
    await client.query('COMMIT');
    
    logInfo('migrations', `Migration ${migrationName} applied successfully.`, { migrationName });
  } catch (error) {
    await client.query('ROLLBACK');
    logError('migrations', 'Migration failed, rolled back changes', {
      migrationName: '001_initial_schema.sql',
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  } finally {
    client.release();
  }
}

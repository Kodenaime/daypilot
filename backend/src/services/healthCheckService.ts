import { pool } from '../config/db';
import { getAuthenticatedCalendarClient } from './googleCalendar';
import { withTimeout } from '../utils/withTimeout';

export interface HealthCheckResult {
  healthy: boolean;
  details: {
    database: boolean;
    googleToken: boolean;
  };
  failureReason?: string;
}

/**
 * Runs a health check for the daily briefing, verifying database connectivity
 * and Google Calendar API token validity. Both checks are protected by timeouts.
 */
export async function runHealthCheck(userId: string): Promise<HealthCheckResult> {
  let database = false;
  let googleToken = false;
  const errors: string[] = [];

  // 1. Check Database Connectivity
  try {
    await withTimeout(
      pool.query('SELECT 1'),
      5000,
      'Database query timed out'
    );
    database = true;
  } catch (err: any) {
    console.error('Health check database check failed:', err);
    errors.push(`Database connection failed: ${err.message || String(err)}`);
  }

  // 2. Check Google Calendar API Token Validity
  try {
    await withTimeout(
      getAuthenticatedCalendarClient(userId),
      5000,
      'Google Token check timed out'
    );
    googleToken = true;
  } catch (err: any) {
    console.error(`Health check Google token check failed for user ${userId}:`, err);
    errors.push(`Google token invalid or expired: ${err.message || String(err)}`);
    
    // Ensure sync_status is set to token_expired on failure (e.g. decryption error or refresh error)
    try {
      await pool.query(
        "UPDATE google_accounts SET sync_status = 'token_expired' WHERE user_id = $1",
        [userId]
      );
    } catch (dbErr) {
      console.error('Failed to update sync_status in database:', dbErr);
    }
  }

  const healthy = database && googleToken;

  return {
    healthy,
    details: {
      database,
      googleToken
    },
    ...(healthy ? {} : { failureReason: errors.join('; ') })
  };
}

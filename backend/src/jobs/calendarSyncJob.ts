import { Queue, Worker } from 'bullmq';
import { pool } from '../config/db';
import { performIncrementalSync } from '../services/googleCalendar';
import dotenv from 'dotenv';
import { logInfo, logWarn, logError } from '../utils/logger';

dotenv.config();

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// Safe Redis URL parser for ConnectionOptions properties
let host = 'localhost';
let port = 6379;
let password: string | undefined = undefined;

try {
  const parsed = new URL(REDIS_URL);
  host = parsed.hostname || 'localhost';
  port = parsed.port ? parseInt(parsed.port, 10) : 6379;
  if (parsed.password) {
    password = decodeURIComponent(parsed.password);
  }
} catch (e) {
  logWarn('jobs', 'Failed to parse REDIS_URL, falling back to localhost:6379 defaults');
}

const connection = {
  host,
  port,
  password,
  maxRetriesPerRequest: null
};

const QUEUE_NAME = 'calendar-sync';

export const calendarSyncQueue = new Queue(QUEUE_NAME, { connection });

// Initialize Worker logic
const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    if (job.name === 'sync-all-users') {
      logInfo('jobs', 'Calendar sync job started...');
      
      let processedCount = 0;
      let errorCount = 0;

      try {
        // Retrieve all users who have Google accounts connected
        const accountsRes = await pool.query('SELECT user_id FROM google_accounts');
        const accounts = accountsRes.rows;

        for (const account of accounts) {
          const userId = account.user_id;
          try {
            logInfo('jobs', `Job processing: incremental sync for user ${userId}`, { userId });
            const result = await performIncrementalSync(userId);
            logInfo('jobs', `User ${userId} sync complete. Upserted: ${result.upsertedCount}, Deleted: ${result.deletedCount}`, {
              userId,
              upsertedCount: result.upsertedCount,
              deletedCount: result.deletedCount
            });
            processedCount++;
          } catch (err) {
            logError('jobs', `Error processing sync for user ${userId}`, {
              userId,
              error: err instanceof Error ? err.message : String(err)
            });
            errorCount++;
          }
        }
      } catch (dbErr) {
        logError('jobs', 'Database query failed in calendar sync job worker', {
          error: dbErr instanceof Error ? dbErr.message : String(dbErr)
        });
        throw dbErr;
      }

      logInfo('jobs', `Calendar sync job completed: ${processedCount} user(s) processed, ${errorCount} error(s)`, {
        processedCount,
        errorCount
      });
    }
  },
  { connection }
);

worker.on('error', (err) => {
  logError('jobs', 'Calendar sync worker crashed', {
    error: err instanceof Error ? err.message : String(err)
  });
});

/**
 * Bootstraps and schedules the repeatable 5-minute calendar sync job.
 */
export async function setupCalendarSyncJob(): Promise<void> {
  try {
    // Clear legacy repeatable jobs to avoid duplicates on restarts
    const repeatableJobs = await calendarSyncQueue.getRepeatableJobs();
    for (const job of repeatableJobs) {
      await calendarSyncQueue.removeRepeatableByKey(job.key);
    }

    // Schedule repeatable task to execute every 5 minutes
    await calendarSyncQueue.add(
      'sync-all-users',
      {},
      {
        repeat: {
          every: 5 * 60 * 1000 // 5 minutes in milliseconds
        }
      }
    );
    logInfo('jobs', 'Repeatable calendar sync job successfully scheduled to run every 5 minutes.');
  } catch (error) {
    logError('jobs', 'Failed to schedule repeatable calendar sync job', {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

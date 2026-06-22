import { Queue, Worker } from 'bullmq';
import { pool } from '../config/db';
import { performIncrementalSync } from '../services/googleCalendar';
import dotenv from 'dotenv';

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
  console.warn('Failed to parse REDIS_URL, falling back to localhost:6379 defaults');
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
      console.log('Calendar sync job started...');
      
      let processedCount = 0;
      let errorCount = 0;

      try {
        // Retrieve all users who have Google accounts connected
        const accountsRes = await pool.query('SELECT user_id FROM google_accounts');
        const accounts = accountsRes.rows;

        for (const account of accounts) {
          const userId = account.user_id;
          try {
            console.log(`Job processing: incremental sync for user ${userId}`);
            const result = await performIncrementalSync(userId);
            console.log(
              `User ${userId} sync complete. Upserted: ${result.upsertedCount}, Deleted: ${result.deletedCount}`
            );
            processedCount++;
          } catch (err) {
            console.error(`Error processing sync for user ${userId}:`, err);
            errorCount++;
          }
        }
      } catch (dbErr) {
        console.error('Database query failed in calendar sync job worker:', dbErr);
        throw dbErr;
      }

      console.log(`Calendar sync job completed: ${processedCount} user(s) processed, ${errorCount} error(s)`);
    }
  },
  { connection }
);

worker.on('error', (err) => {
  console.error('Calendar sync worker crashed:', err);
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
    console.log('Repeatable calendar sync job successfully scheduled to run every 5 minutes.');
  } catch (error) {
    console.error('Failed to schedule repeatable calendar sync job:', error);
  }
}

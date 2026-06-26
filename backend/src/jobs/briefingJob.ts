import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { pool } from '../config/db';
import { runBriefingPipeline } from '../services/briefingOrchestrator';
import dotenv from 'dotenv';

dotenv.config();

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

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

// Create a standalone Redis client for our safeguard checks
const redisClient = new Redis(REDIS_URL, { maxRetriesPerRequest: null });

const QUEUE_NAME = 'briefing-scheduler';

export const briefingSchedulerQueue = new Queue(QUEUE_NAME, { connection });

/**
 * Checks if the current time in the given timezone is 5:55 AM.
 * We match 5:55 AM to 5:59 AM to catch any 5-minute interval trigger window.
 */
export function isBriefingTriggerTime(timezone: string, now: Date): { matches: boolean; localDateStr: string } {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      minute: 'numeric',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour12: false
    });
    const parts = formatter.formatToParts(now);
    const hourPart = parts.find((p) => p.type === 'hour');
    const minutePart = parts.find((p) => p.type === 'minute');
    const yearPart = parts.find((p) => p.type === 'year');
    const monthPart = parts.find((p) => p.type === 'month');
    const dayPart = parts.find((p) => p.type === 'day');

    if (!hourPart || !minutePart || !yearPart || !monthPart || !dayPart) {
      return { matches: false, localDateStr: '' };
    }

    const hour = parseInt(hourPart.value, 10);
    const minute = parseInt(minutePart.value, 10);
    const localDateStr = `${yearPart.value}-${monthPart.value}-${dayPart.value}`;

    // Target is exactly 5:55 AM (or within the 5:55 to 5:59 AM 5-minute bucket)
    const matches = hour === 5 && minute >= 55 && minute <= 59;
    return { matches, localDateStr };
  } catch (error) {
    console.warn(`Timezone lookup failed for briefing trigger calculation: "${timezone}"`, error);
    return { matches: false, localDateStr: '' };
  }
}

// Initialize Worker logic
const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    if (job.name === 'check-and-trigger-briefings') {
      console.log('[Briefing Scheduler Job] Checking for user daily briefings to trigger...');
      const now = new Date();

      try {
        const usersRes = await pool.query('SELECT id, device_timezone, briefing_enabled FROM users');
        const users = usersRes.rows;

        for (const user of users) {
          const userId = user.id;
          if (!user.briefing_enabled) {
            console.log(`[Briefing Scheduler Job] Daily briefing is disabled for user ${userId}. Skipping.`);
            continue;
          }
          const timezone = user.device_timezone || 'UTC';

          const { matches, localDateStr } = isBriefingTriggerTime(timezone, now);
          if (matches) {
            const safeguardKey = `briefing:sent:${userId}:${localDateStr}`;

            // Check if briefing was already triggered for this user on this local day
            const alreadySent = await redisClient.get(safeguardKey);
            if (alreadySent) {
              console.log(`[Briefing Scheduler Job] Briefing already triggered today for user ${userId} (${localDateStr}). Skipping.`);
              continue;
            }

            // Set the safeguard key with an 24 hour expiry to prevent double trigger
            await redisClient.set(safeguardKey, '1', 'EX', 24 * 60 * 60);

            console.log(`[Briefing Scheduler Job] Local time is 5:55 AM (or within 5:55-5:59 AM range) in timezone "${timezone}" for user ${userId}. Triggering pipeline...`);
            // Run briefing pipeline in background context safely
            runBriefingPipeline(userId).catch((err) => {
              console.error(`[Briefing Scheduler Job] Error running briefing pipeline for user ${userId}:`, err);
            });
          }
        }
      } catch (err) {
        console.error('[Briefing Scheduler Job] Error in check-and-trigger worker:', err);
        throw err;
      }
    }
  },
  { connection }
);

worker.on('error', (err) => {
  console.error('Briefing scheduler worker crashed:', err);
});

/**
 * Bootstraps and schedules the repeatable 5-minute briefing trigger check job.
 */
export async function setupBriefingJob(): Promise<void> {
  try {
    const repeatableJobs = await briefingSchedulerQueue.getRepeatableJobs();
    for (const job of repeatableJobs) {
      await briefingSchedulerQueue.removeRepeatableByKey(job.key);
    }

    // Check once every 5 minutes to see if any user is at 5:55 AM
    await briefingSchedulerQueue.add(
      'check-and-trigger-briefings',
      {},
      {
        repeat: {
          every: 5 * 60 * 1000
        }
      }
    );
    console.log('Repeatable briefing scheduler check job successfully scheduled (every 5 minutes).');
  } catch (error) {
    console.error('Failed to schedule repeatable briefing scheduler job:', error);
  }
}

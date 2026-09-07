import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { pool } from '../config/db';
import { runBriefingPipeline } from '../services/briefingOrchestrator';
import dotenv from 'dotenv';
import { logInfo, logWarn, logError } from '../utils/logger';

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
  logWarn('jobs', 'Failed to parse REDIS_URL, falling back to localhost:6379 defaults');
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
 * Checks if the current time in the given timezone matches the user's custom briefingTime.
 * We match the custom briefingTime to up to 4 minutes after it to catch any 5-minute interval trigger window.
 */
export function isBriefingTriggerTime(timezone: string, now: Date, briefingTime: string = '05:55'): { matches: boolean; localDateStr: string } {
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

    // Parse custom briefingTime (HH:MM)
    const [tHourStr, tMinuteStr] = briefingTime.split(':');
    const tHour = parseInt(tHourStr, 10);
    const tMinute = parseInt(tMinuteStr, 10);
    const targetMinutes = tHour * 60 + tMinute;

    const currentMinutes = hour * 60 + minute;
    let diff = currentMinutes - targetMinutes;
    if (diff < 0) {
      diff += 1440;
    }

    const matches = diff >= 0 && diff < 5;
    return { matches, localDateStr };
  } catch (error) {
    logWarn('jobs', `Timezone lookup failed for briefing trigger calculation: "${timezone}"`, {
      timezone,
      error: error instanceof Error ? error.message : String(error)
    });
    return { matches: false, localDateStr: '' };
  }
}

// Initialize Worker logic
const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    if (job.name === 'check-and-trigger-briefings') {
      logInfo('jobs', '[Briefing Scheduler Job] Checking for user daily briefings to trigger...');
      const now = new Date();

      try {
        const usersRes = await pool.query('SELECT id, device_timezone, briefing_enabled, briefing_time FROM users');
        const users = usersRes.rows;

        for (const user of users) {
          const userId = user.id;
          if (!user.briefing_enabled) {
            logInfo('jobs', `[Briefing Scheduler Job] Daily briefing is disabled for user ${userId}. Skipping.`, { userId });
            continue;
          }
          const timezone = user.device_timezone || 'UTC';
          const userBriefingTime = user.briefing_time && typeof user.briefing_time === 'string'
            ? user.briefing_time.substring(0, 5)
            : '05:55';

          const { matches, localDateStr } = isBriefingTriggerTime(timezone, now, userBriefingTime);
          if (matches) {
            const safeguardKey = `briefing:sent:${userId}:${localDateStr}`;

            // Check if briefing was already triggered for this user on this local day
            const alreadySent = await redisClient.get(safeguardKey);
            if (alreadySent) {
              logInfo('jobs', `[Briefing Scheduler Job] Briefing already triggered today for user ${userId} (${localDateStr}). Skipping.`, { userId, localDateStr });
              continue;
            }

            // Set the safeguard key with an 24 hour expiry to prevent double trigger
            await redisClient.set(safeguardKey, '1', 'EX', 24 * 60 * 60);

            logInfo('jobs', `[Briefing Scheduler Job] Triggering briefing pipeline for user ${userId} in timezone "${timezone}" using scheduled time ${userBriefingTime}`, {
              userId,
              timezone,
              briefingTime: userBriefingTime
            });
            // Run briefing pipeline in background context safely
            runBriefingPipeline(userId).catch((err) => {
              logError('jobs', `[Briefing Scheduler Job] Error running briefing pipeline for user ${userId}`, {
                userId,
                error: err instanceof Error ? err.message : String(err)
              });
            });
          }
        }
      } catch (err) {
        logError('jobs', '[Briefing Scheduler Job] Error in check-and-trigger worker', {
          error: err instanceof Error ? err.message : String(err)
        });
        throw err;
      }
    }
  },
  { connection }
);

worker.on('error', (err) => {
  logError('jobs', 'Briefing scheduler worker crashed', {
    error: err instanceof Error ? err.message : String(err)
  });
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
    logInfo('jobs', 'Repeatable briefing scheduler check job successfully scheduled (every 5 minutes).');
  } catch (error) {
    logError('jobs', 'Failed to schedule repeatable briefing scheduler job', {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

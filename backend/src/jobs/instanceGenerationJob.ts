import { Queue, Worker } from 'bullmq';
import { runInstanceGenerationForAllActiveTemplates } from '../services/instanceGenerationService';
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

const QUEUE_NAME = 'instance-generation';

export const instanceGenerationQueue = new Queue(QUEUE_NAME, { connection });

// Initialize Worker logic
const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    if (job.name === 'generate-instances-daily') {
      console.log('Daily instance generation job started...');
      try {
        const results = await runInstanceGenerationForAllActiveTemplates();
        console.log(`Daily instance generation job completed. Templates processed: ${results.length}`);
      } catch (err) {
        console.error('Error running daily instance generation job:', err);
        throw err;
      }
    }
  },
  { connection }
);

worker.on('error', (err) => {
  console.error('Instance generation worker crashed:', err);
});

/**
 * Bootstraps and schedules the repeatable daily instance generation job.
 */
export async function setupInstanceGenerationJob(): Promise<void> {
  try {
    // Clear legacy repeatable jobs to avoid duplicates on restarts
    const repeatableJobs = await instanceGenerationQueue.getRepeatableJobs();
    for (const job of repeatableJobs) {
      await instanceGenerationQueue.removeRepeatableByKey(job.key);
    }

    // Schedule repeatable task to execute daily at midnight
    await instanceGenerationQueue.add(
      'generate-instances-daily',
      {},
      {
        repeat: {
          pattern: '0 0 * * *' // Once daily at midnight server time
        }
      }
    );
    console.log('Repeatable daily instance generation job successfully scheduled (0 0 * * *).');
  } catch (error) {
    console.error('Failed to schedule repeatable daily instance generation job:', error);
  }
}

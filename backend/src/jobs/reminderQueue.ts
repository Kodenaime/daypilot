import { Queue, Worker } from 'bullmq';
import { pool } from '../config/db';
import dotenv from 'dotenv';
import { sendPushNotification } from '../services/fcmService';

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

const QUEUE_NAME = 'reminders';

export const reminderQueue = new Queue(QUEUE_NAME, { connection });

// Initialize Worker logic
const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const { reminderId } = job.data;
    if (!reminderId) {
      console.warn(`Job ${job.id} fired with no reminderId.`);
      return;
    }

    const client = await pool.connect();
    try {
      // Look up reminder row, task details, and user's fcm_token
      const reminderRes = await client.query(
        `SELECT r.*, t.title, t.user_id, u.fcm_token 
         FROM reminders r 
         JOIN tasks t ON r.task_id = t.id 
         JOIN users u ON t.user_id = u.id 
         WHERE r.id = $1`,
        [reminderId]
      );

      if (reminderRes.rows.length === 0) {
        console.warn(`Reminder ${reminderId} not found in database.`);
        return;
      }

      const reminder = reminderRes.rows[0];

      // If reminder's status is no longer 'scheduled', exit cleanly.
      if (reminder.status !== 'scheduled') {
        console.log(`Reminder ${reminderId} is not status "scheduled" (current status: ${reminder.status}). Exiting cleanly.`);
        return;
      }

      // Update reminder status to 'sent' and sent_at to now
      await client.query(
        "UPDATE reminders SET status = 'sent', sent_at = NOW() WHERE id = $1",
        [reminderId]
      );

      // Perform push dispatch checks
      if (!reminder.fcm_token) {
        console.log(`Skipping push dispatch for user ${reminder.user_id} - no FCM token registered.`);
        await client.query(
          `INSERT INTO notification_log (user_id, reminder_id, channel, notification_type, delivery_status, failure_reason)
           VALUES ($1, $2, 'push', 'reminder', 'failed', 'no_fcm_token_registered')`,
          [reminder.user_id, reminder.id]
        );
      } else {
        // Construct notification message based on tier
        let body = '';
        if (reminder.tier === 'advance') {
          body = `Reminder: '${reminder.title}' is due tomorrow`;
        } else if (reminder.tier === 'approaching') {
          body = `'${reminder.title}' is due in 1 hour`;
        } else {
          body = `'${reminder.title}' is due now`;
        }

        const title = 'Task Reminder';

        const result = await sendPushNotification(reminder.fcm_token, title, body);

        if (result.success) {
          await client.query(
            `INSERT INTO notification_log (user_id, reminder_id, channel, notification_type, delivery_status)
             VALUES ($1, $2, 'push', 'reminder', 'success')`,
            [reminder.user_id, reminder.id]
          );
        } else {
          await client.query(
            `INSERT INTO notification_log (user_id, reminder_id, channel, notification_type, delivery_status, failure_reason)
             VALUES ($1, $2, 'push', 'reminder', 'failed', $3)`,
            [reminder.user_id, reminder.id, result.error]
          );
        }
      }
    } catch (err) {
      console.error(`Error processing reminder job ${job.id}:`, err);
      throw err;
    } finally {
      client.release();
    }
  },
  { connection }
);

worker.on('error', (err) => {
  console.error('Reminders worker crashed:', err);
});

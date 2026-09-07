import { pool } from '../config/db';
import { Task } from './taskService';
import { reminderQueue } from '../jobs/reminderQueue';

export interface Reminder {
  id: string;
  task_id: string;
  tier: 'advance' | 'approaching' | 'due_now';
  trigger_at: Date;
  bullmq_job_id: string | null;
  status: 'scheduled' | 'sent' | 'cancelled';
  sent_at: Date | null;
}

/**
 * Creates 3-tier reminders ('advance', 'approaching', 'due_now') for a task if it has a deadline_at.
 * Skips trigger times that are in the past.
 */
export async function createRemindersForTask(task: Task): Promise<Reminder[]> {
  if (!task.deadline_at || task.google_event_id) {
    return [];
  }

  const deadline = new Date(task.deadline_at);
  const now = new Date();

  // Define the 3 tiers
  const tiers = [
    {
      name: 'advance' as const,
      triggerAt: new Date(deadline.getTime() - 24 * 60 * 60 * 1000)
    },
    {
      name: 'approaching' as const,
      triggerAt: new Date(deadline.getTime() - 60 * 60 * 1000)
    },
    {
      name: 'due_now' as const,
      triggerAt: deadline
    }
  ];

  const createdReminders: Reminder[] = [];

  for (const tier of tiers) {
    if (tier.triggerAt.getTime() < now.getTime()) {
      console.log(
        `Skipping reminder tier "${tier.name}" for task "${task.title}" (${task.id}) because trigger time ${tier.triggerAt.toISOString()} is in the past (now is ${now.toISOString()}).`
      );
      continue;
    }

    const query = `
      INSERT INTO reminders (task_id, tier, trigger_at, status)
      VALUES ($1, $2, $3, 'scheduled')
      RETURNING *
    `;
    const res = await pool.query(query, [task.id, tier.name, tier.triggerAt]);
    const reminderRow = res.rows[0];

    const delay = tier.triggerAt.getTime() - now.getTime();
    const job = await reminderQueue.add(
      `reminder-${reminderRow.id}`,
      { reminderId: reminderRow.id },
      { delay: Math.max(0, delay) }
    );

    const updateRes = await pool.query(
      `UPDATE reminders SET bullmq_job_id = $1 WHERE id = $2 RETURNING *`,
      [job.id, reminderRow.id]
    );

    createdReminders.push(updateRes.rows[0]);
  }

  return createdReminders;
}

export async function cancelPendingRemindersForTask(taskId: string): Promise<void> {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT * FROM reminders WHERE task_id = $1 AND status = 'scheduled'`,
      [taskId]
    );

    for (const reminder of res.rows) {
      if (reminder.bullmq_job_id) {
        try {
          const job = await reminderQueue.getJob(reminder.bullmq_job_id);
          if (job) {
            await job.remove();
          } else {
            console.log(`BullMQ job ${reminder.bullmq_job_id} not found in queue (might have already fired).`);
          }
        } catch (jobErr) {
          console.warn(`Failed to remove BullMQ job ${reminder.bullmq_job_id} for reminder ${reminder.id}:`, jobErr);
        }
      }

      await client.query(
        `UPDATE reminders SET status = 'cancelled' WHERE id = $1`,
        [reminder.id]
      );
    }
  } finally {
    client.release();
  }
}

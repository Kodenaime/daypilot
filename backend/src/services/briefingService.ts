import { pool } from '../config/db';
import { Task, getOverdueTasks } from './taskService';
import { withTimeout } from '../utils/withTimeout';

/**
 * Helper to compute today's date string YYYY-MM-DD in the target timezone context.
 */
export function getTodayDateInTimezone(timezone: string): string {
  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric'
    });
    const formattedStr = formatter.format(now); // e.g. "6/23/2026"
    
    const parts = formattedStr.split('/');
    const month = String(parts[0]).padStart(2, '0');
    const day = String(parts[1]).padStart(2, '0');
    const year = parts[2];
    return `${year}-${month}-${day}`;
  } catch (error) {
    console.warn(`Invalid timezone "${timezone}" provided. Falling back to UTC today calculation.`, error);
    const todayUTC = new Date();
    const yyyy = todayUTC.getUTCFullYear();
    const mm = String(todayUTC.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(todayUTC.getUTCDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
}

/**
 * Gathers today's tasks and overdue tasks (up to 7 days) for the daily briefing.
 * Queries are executed in parallel and protected by a 10-second timeout.
 */
export async function gatherBriefingData(
  userId: string,
  deviceTimezone: string
): Promise<{ todayTasks: Task[]; overdueTasks: Task[] }> {
  const todayStr = getTodayDateInTimezone(deviceTimezone);

  const todayTasksPromise = pool.query(
    `SELECT * FROM tasks
     WHERE user_id = $1
       AND deadline_at >= ($2 || ' 00:00:00')::timestamp AT TIME ZONE $3
       AND deadline_at <= ($2 || ' 23:59:59.999')::timestamp AT TIME ZONE $3
     ORDER BY deadline_at ASC`,
    [userId, todayStr, deviceTimezone]
  ).then((res) => res.rows as Task[]);

  const overdueTasksPromise = getOverdueTasks(userId, 7);

  // Wrap both queries in a single Promise.all inside withTimeout
  const [todayTasks, overdueTasks] = await withTimeout(
    Promise.all([todayTasksPromise, overdueTasksPromise]),
    10000,
    'Briefing data aggregation query timed out'
  );

  return {
    todayTasks,
    overdueTasks
  };
}

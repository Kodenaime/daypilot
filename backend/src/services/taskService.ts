import { pool } from '../config/db';
import { withTimeout } from '../utils/withTimeout';

export interface CreateTaskData {
  title: string;
  deadline_at?: string;
  timezone_snapshot: string;
}

export interface UpdateTaskData {
  title?: string;
  deadline_at?: string | null;
  status?: 'pending' | 'completed';
}

export interface Task {
  id: string;
  user_id: string;
  recurrence_template_id: string | null;
  google_event_id: string | null;
  title: string;
  deadline_at: Date | null;
  timezone_snapshot: string;
  status: 'pending' | 'completed';
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * Creates a standalone task (recurrence_template_id and google_event_id are null).
 */
export async function createStandaloneTask(userId: string, data: CreateTaskData): Promise<Task> {
  const { title, deadline_at, timezone_snapshot } = data;
  const deadlineDate = deadline_at ? new Date(deadline_at) : null;

  const query = `
    INSERT INTO tasks (user_id, title, deadline_at, timezone_snapshot, status)
    VALUES ($1, $2, $3, $4, 'pending')
    RETURNING *
  `;
  const res = await pool.query(query, [userId, title, deadlineDate, timezone_snapshot]);
  return res.rows[0];
}

/**
 * Retrieves all tasks for a user, sorted by deadline_at ascending (nulls last).
 * Can be filtered optionally by status ('pending' or 'completed').
 */
export async function getTasksForUser(userId: string, status?: 'pending' | 'completed'): Promise<Task[]> {
  let query = `
    SELECT * FROM tasks 
    WHERE user_id = $1
  `;
  const params: any[] = [userId];

  if (status) {
    query += ` AND status = $2`;
    params.push(status);
  }

  // Sort by deadline_at ascending, nulls last
  query += ` ORDER BY deadline_at ASC NULLS LAST`;

  const res = await pool.query(query, params);
  return res.rows;
}

/**
 * Retrieves a single task for a user. Returns null if task does not exist or does not belong to the user.
 */
export async function getTaskById(userId: string, taskId: string): Promise<Task | null> {
  const query = `
    SELECT * FROM tasks 
    WHERE id = $1 AND user_id = $2
  `;
  const res = await pool.query(query, [taskId, userId]);
  if (res.rowCount === 0) {
    return null;
  }
  return res.rows[0];
}

/**
 * Updates a task. Handles completed_at logic based on status transition:
 * - If status is set to 'completed', completed_at is set to the current timestamp.
 * - If status is set to 'pending', completed_at is set to null.
 * Returns the updated task, or null if the task was not found or not owned.
 */
export async function patchTask(userId: string, taskId: string, updates: UpdateTaskData): Promise<Task | null> {
  // First, verify the task exists and is owned by this user
  const existing = await getTaskById(userId, taskId);
  if (!existing) {
    return null;
  }

  const { title, deadline_at, status } = updates;
  const setClauses: string[] = [];
  const params: any[] = [taskId, userId];
  let paramIdx = 3;

  if (title !== undefined) {
    setClauses.push(`title = $${paramIdx++}`);
    params.push(title);
  }

  if (deadline_at !== undefined) {
    const deadlineVal = deadline_at ? new Date(deadline_at) : null;
    setClauses.push(`deadline_at = $${paramIdx++}`);
    params.push(deadlineVal);
  }

  if (status !== undefined) {
    setClauses.push(`status = $${paramIdx++}`);
    params.push(status);

    if (status === 'completed') {
      setClauses.push(`completed_at = NOW()`);
    } else {
      setClauses.push(`completed_at = NULL`);
    }
  }

  if (setClauses.length === 0) {
    return existing;
  }

  setClauses.push(`updated_at = NOW()`);

  const query = `
    UPDATE tasks
    SET ${setClauses.join(', ')}
    WHERE id = $1 AND user_id = $2
    RETURNING *
  `;

  const res = await pool.query(query, params);
  return res.rows[0];
}

/**
 * Deletes a task. Returns true if deleted, false if not found or not owned.
 */
export async function deleteTask(userId: string, taskId: string): Promise<boolean> {
  const query = `
    DELETE FROM tasks 
    WHERE id = $1 AND user_id = $2
  `;
  const res = await pool.query(query, [taskId, userId]);
  return (res.rowCount !== null && res.rowCount > 0);
}

/**
 * Retrieves all overdue tasks for a user (status = 'pending' AND deadline_at < NOW()).
 * Supports limiting age of overdue tasks to maxDaysOverdue.
 */
export async function getOverdueTasks(userId: string, maxDaysOverdue?: number): Promise<Task[]> {
  let query = `
    SELECT * FROM tasks 
    WHERE user_id = $1 
      AND status = 'pending' 
      AND deadline_at IS NOT NULL 
      AND deadline_at < NOW()
  `;
  const params: any[] = [userId];

  if (maxDaysOverdue !== undefined) {
    query += ` AND deadline_at >= NOW() - ($2 || ' day')::INTERVAL`;
    params.push(maxDaysOverdue);
  }

  query += ` ORDER BY deadline_at ASC`;

  const res = await pool.query(query, params);
  return res.rows;
}

/**
 * Retrieves the single most urgent pending task for focus mode.
 * - Prioritizes overdue tasks (oldest first).
 * - Otherwise retrieves the soonest upcoming task.
 * - Otherwise returns null.
 * - Excludes tasks with null deadlines.
 */
export async function getNextFocusTask(userId: string): Promise<Task | null> {
  const query = `
    SELECT * FROM tasks
    WHERE user_id = $1
      AND status = 'pending'
      AND deadline_at IS NOT NULL
    ORDER BY
      CASE WHEN deadline_at < NOW() THEN 0 ELSE 1 END ASC,
      deadline_at ASC
    LIMIT 1
  `;
  
  // Wrap db query in withTimeout (5-second default limit is standard in the codebase)
  const res = await withTimeout(
    pool.query(query, [userId]),
    5000,
    'Database query timeout in getNextFocusTask'
  );
  
  if (res.rowCount === 0) {
    return null;
  }
  return res.rows[0];
}

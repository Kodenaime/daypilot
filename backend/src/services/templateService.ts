import { pool } from '../config/db';

export interface CreateTemplateData {
  title: string;
  recurrence_type: 'daily' | 'weekly' | 'monthly' | 'custom_interval';
  interval_days?: number | null;
  days_of_week?: number[] | null;
  day_of_month?: number | null;
  time_of_day: string;
  timezone_snapshot: string;
}

export interface UpdateTemplateData {
  title?: string;
  interval_days?: number | null;
  days_of_week?: number[] | null;
  day_of_month?: number | null;
  time_of_day?: string;
}

export interface RecurrenceTemplate {
  id: string;
  user_id: string;
  title: string;
  recurrence_type: 'daily' | 'weekly' | 'monthly' | 'custom_interval';
  interval_days: number | null;
  days_of_week: number[] | null;
  day_of_month: number | null;
  time_of_day: string;
  timezone_snapshot: string;
  anchor_date: string; // DATE format, returns as ISO string or YYYY-MM-DD
  is_active: boolean;
  created_at: Date;
}

/**
 * Calculates tomorrow's date YYYY-MM-DD in the target timezone context relative to server now.
 */
export function getTomorrowDateInTimezone(timezone: string): string {
  try {
    const now = new Date();
    // Get formatted local date string in target timezone
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric'
    });
    const formattedStr = formatter.format(now); // e.g. "6/23/2026"
    
    const parts = formattedStr.split('/');
    const month = parseInt(parts[0], 10);
    const day = parseInt(parts[1], 10);
    const year = parseInt(parts[2], 10);

    // Create a local Date for today in target timezone
    const targetDate = new Date(year, month - 1, day);
    
    // Add 1 day to find tomorrow
    targetDate.setDate(targetDate.getDate() + 1);

    const yyyy = targetDate.getFullYear();
    const mm = String(targetDate.getMonth() + 1).padStart(2, '0');
    const dd = String(targetDate.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  } catch (error) {
    console.warn(`Invalid timezone "${timezone}" provided. Falling back to UTC tomorrow calculation.`, error);
    const tomorrowUTC = new Date();
    tomorrowUTC.setUTCDate(tomorrowUTC.getUTCDate() + 1);
    const yyyy = tomorrowUTC.getUTCFullYear();
    const mm = String(tomorrowUTC.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(tomorrowUTC.getUTCDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
}

/**
 * Creates a new recurrence template, calculating the anchor_date server-side.
 */
export async function createTemplate(userId: string, data: CreateTemplateData): Promise<RecurrenceTemplate> {
  const {
    title,
    recurrence_type,
    interval_days,
    days_of_week,
    day_of_month,
    time_of_day,
    timezone_snapshot
  } = data;

  const anchor_date = getTomorrowDateInTimezone(timezone_snapshot);

  const query = `
    INSERT INTO recurrence_templates (
      user_id, title, recurrence_type, interval_days, days_of_week, day_of_month, time_of_day, timezone_snapshot, anchor_date, is_active
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true)
    RETURNING *
  `;

  const values = [
    userId,
    title,
    recurrence_type,
    interval_days || null,
    days_of_week || null,
    day_of_month || null,
    time_of_day,
    timezone_snapshot,
    anchor_date
  ];

  const res = await pool.query(query, values);
  return res.rows[0];
}

/**
 * Retrieves all recurrence templates for a user. Supports optional is_active filter.
 */
export async function getTemplatesForUser(userId: string, isActive?: boolean): Promise<RecurrenceTemplate[]> {
  let query = `
    SELECT * FROM recurrence_templates 
    WHERE user_id = $1
  `;
  const params: any[] = [userId];

  if (isActive !== undefined) {
    query += ` AND is_active = $2`;
    params.push(isActive);
  }

  query += ` ORDER BY created_at DESC`;

  const res = await pool.query(query, params);
  return res.rows;
}

/**
 * Retrieves a single template by ID. Returns null if not found or unauthorized.
 */
export async function getTemplateById(userId: string, templateId: string): Promise<RecurrenceTemplate | null> {
  const query = `
    SELECT * FROM recurrence_templates 
    WHERE id = $1 AND user_id = $2
  `;
  const res = await pool.query(query, [templateId, userId]);
  if (res.rowCount === 0) {
    return null;
  }
  return res.rows[0];
}

/**
 * Updates an existing template. Blocks changing recurrence_type.
 */
export async function patchTemplate(
  userId: string,
  templateId: string,
  updates: UpdateTemplateData
): Promise<RecurrenceTemplate | null> {
  const existing = await getTemplateById(userId, templateId);
  if (!existing) {
    return null;
  }

  const { title, interval_days, days_of_week, day_of_month, time_of_day } = updates;
  const setClauses: string[] = [];
  const params: any[] = [templateId, userId];
  let paramIdx = 3;

  if (title !== undefined) {
    setClauses.push(`title = $${paramIdx++}`);
    params.push(title);
  }

  if (interval_days !== undefined) {
    setClauses.push(`interval_days = $${paramIdx++}`);
    params.push(interval_days);
  }

  if (days_of_week !== undefined) {
    setClauses.push(`days_of_week = $${paramIdx++}`);
    params.push(days_of_week);
  }

  if (day_of_month !== undefined) {
    setClauses.push(`day_of_month = $${paramIdx++}`);
    params.push(day_of_month);
  }

  if (time_of_day !== undefined) {
    setClauses.push(`time_of_day = $${paramIdx++}`);
    params.push(time_of_day);
  }

  if (setClauses.length === 0) {
    return existing;
  }

  const query = `
    UPDATE recurrence_templates
    SET ${setClauses.join(', ')}
    WHERE id = $1 AND user_id = $2
    RETURNING *
  `;

  const res = await pool.query(query, params);
  return res.rows[0];
}

/**
 * Sets is_active = false for a template. No hard delete.
 */
export async function deactivateTemplate(userId: string, templateId: string): Promise<RecurrenceTemplate | null> {
  const query = `
    UPDATE recurrence_templates
    SET is_active = false
    WHERE id = $1 AND user_id = $2
    RETURNING *
  `;
  const res = await pool.query(query, [templateId, userId]);
  if (res.rowCount === 0) {
    return null;
  }
  return res.rows[0];
}

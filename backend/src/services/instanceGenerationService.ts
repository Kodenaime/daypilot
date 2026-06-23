import { pool } from '../config/db';
import { RecurrenceTemplate } from './templateService';

export interface GenerationResult {
  templateId: string;
  generatedCount: number;
}

/**
 * Translates a calendar date and time in a target timezone into the correct UTC date.
 * Server-timezone-independent implementation.
 */
export function getUTCDateForLocalTime(dateStr: string, timeStr: string, timezone: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  const [hour, minute, second = 0] = timeStr.split(':').map(Number);

  // Create a Date object in UTC with these local components
  const candidate = new Date(Date.UTC(year, month - 1, day, hour, minute, second));

  // Format candidate in the target timezone to see what local time it is
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false
  });

  const partsList = formatter.formatToParts(candidate);
  const p: Record<string, number> = {};
  for (const part of partsList) {
    if (part.type !== 'literal') {
      p[part.type] = parseInt(part.value, 10);
    }
  }

  // Adjust for cases where hour is returned as 24 instead of 00
  let targetHour = p.hour === 24 ? 0 : p.hour;

  const targetLocalTime = Date.UTC(p.year, p.month - 1, p.day, targetHour, p.minute, p.second);
  const diff = candidate.getTime() - targetLocalTime;

  // Adjust candidate by the difference to get the exact UTC time
  return new Date(candidate.getTime() + diff);
}

/**
 * Pure function to calculate all calendar dates in a range on which a template should fire.
 * Unaffected by database operations and server timezone offsets.
 */
export function getMatchingDatesInRange(
  template: {
    recurrence_type: 'daily' | 'weekly' | 'monthly' | 'custom_interval';
    days_of_week?: number[] | null;
    day_of_month?: number | null;
    interval_days?: number | null;
  },
  anchorStr: string,
  startDateStr: string,
  endDateStr: string
): string[] {
  const startDate = new Date(startDateStr);
  const endDate = new Date(endDateStr);
  const matchedDates: string[] = [];

  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const dateStr = `${yyyy}-${mm}-${dd}`;

    let shouldFire = false;
    const [year, month, day] = dateStr.split('-').map(Number);

    if (template.recurrence_type === 'daily') {
      shouldFire = true;
    } else if (template.recurrence_type === 'weekly') {
      const weekday = new Date(year, month - 1, day).getDay(); // 0 = Sunday, 6 = Saturday
      if (template.days_of_week && template.days_of_week.includes(weekday)) {
        shouldFire = true;
      }
    } else if (template.recurrence_type === 'monthly') {
      const parsedDate = new Date(year, month - 1, template.day_of_month || 1);
      // Confirms day of month exists in this specific month (prevents JS roll-over, e.g. Nov 31 -> Dec 1)
      if (parsedDate.getDate() === template.day_of_month && day === template.day_of_month) {
        shouldFire = true;
      }
    } else if (template.recurrence_type === 'custom_interval') {
      const [anchorY, anchorM, anchorD] = anchorStr.split('-').map(Number);
      const aUTC = Date.UTC(anchorY, anchorM - 1, anchorD);
      const dUTC = Date.UTC(year, month - 1, day);
      const diffDays = Math.round((dUTC - aUTC) / (1000 * 60 * 60 * 24));
      const interval = template.interval_days || 1;
      if (diffDays >= 0 && diffDays % interval === 0) {
        shouldFire = true;
      }
    }

    if (shouldFire) {
      matchedDates.push(dateStr);
    }
  }

  return matchedDates;
}

/**
 * Generates task instances for a single recurrence template within the window [max(anchor_date, today), windowEndDate].
 * Safe to run repeatedly (idempotent).
 */
export async function generateInstancesForTemplate(
  template: RecurrenceTemplate,
  windowEndDate: string
): Promise<number> {
  const timezone = template.timezone_snapshot;
  
  // Calculate today's date in target timezone
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric'
  });
  const parts = formatter.format(now).split('/');
  const todayStr = `${parts[2]}-${parts[0].padStart(2, '0')}-${parts[1].padStart(2, '0')}`;

  // Start date is max(anchor_date, today)
  // Let's parse template.anchor_date (which is in YYYY-MM-DD format)
  let anchorStr = '';
  if ((template.anchor_date as any) instanceof Date) {
    const y = (template.anchor_date as any).getFullYear();
    const m = String((template.anchor_date as any).getMonth() + 1).padStart(2, '0');
    const d = String((template.anchor_date as any).getDate()).padStart(2, '0');
    anchorStr = `${y}-${m}-${d}`;
  } else {
    // String (slice first 10 chars to support timestamp output format if any)
    anchorStr = String(template.anchor_date).substring(0, 10);
  }

  const startDateStr = anchorStr > todayStr ? anchorStr : todayStr;

  console.log(
    `Generating instances for template "${template.title}" (${template.id}) in range [${startDateStr}, ${windowEndDate}] (timezone: ${timezone})`
  );

  const matchedDates = getMatchingDatesInRange(template, anchorStr, startDateStr, windowEndDate);
  let generatedCount = 0;

  for (const dateStr of matchedDates) {
    // Calculate deadline_at UTC Date
    const deadlineAt = getUTCDateForLocalTime(dateStr, template.time_of_day, timezone);

    // Idempotency check: check if task already exists for this template & deadline_at
    const checkRes = await pool.query(
      `SELECT id FROM tasks 
       WHERE recurrence_template_id = $1 
         AND deadline_at = $2`,
      [template.id, deadlineAt]
    );

    if (checkRes.rowCount && checkRes.rowCount > 0) {
      // Instance already exists
      continue;
    }

    // Insert task instance
    await pool.query(
      `INSERT INTO tasks (user_id, recurrence_template_id, title, deadline_at, timezone_snapshot, status)
       VALUES ($1, $2, $3, $4, $5, 'pending')`,
      [template.user_id, template.id, template.title, deadlineAt, timezone]
    );

    generatedCount++;
  }

  return generatedCount;
}

/**
 * Runs generation for all is_active = true templates.
 * Defines the window endpoint as today's date + 7 days in UTC.
 */
export async function runInstanceGenerationForAllActiveTemplates(): Promise<GenerationResult[]> {
  console.log('Running instance generation for all active recurrence templates...');

  // Target window end date: 7 days from today.
  // Today's date relative to UTC
  const now = new Date();
  const end = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const endY = end.getUTCFullYear();
  const endM = String(end.getUTCMonth() + 1).padStart(2, '0');
  const endD = String(end.getUTCDate()).padStart(2, '0');
  const windowEndDate = `${endY}-${endM}-${endD}`;

  const templatesRes = await pool.query(
    'SELECT * FROM recurrence_templates WHERE is_active = true'
  );
  const templates: RecurrenceTemplate[] = templatesRes.rows;

  const results: GenerationResult[] = [];

  for (const template of templates) {
    try {
      const generatedCount = await generateInstancesForTemplate(template, windowEndDate);
      results.push({
        templateId: template.id,
        generatedCount
      });
    } catch (error) {
      console.error(`Failed to generate instances for template ${template.id}:`, error);
    }
  }

  console.log(`Instance generation run complete. Processed ${templates.length} template(s).`);
  return results;
}

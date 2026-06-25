import { pool } from '../config/db';
import { runHealthCheck } from './healthCheckService';
import { gatherBriefingData } from './briefingService';
import { Task } from './taskService';
import { sendPushNotification } from './fcmService';
import { sendReminderEmail } from './emailService';
import { logNotification } from './notificationLogService';

export interface BriefingPipelineResult {
  outcome: 'success' | 'fallback';
  data?: {
    todayTasks: Task[];
    overdueTasks: Task[];
  };
}

/**
 * Checks if the given date/time is at or after 6:30 AM in the specified timezone.
 */
export function isAfterCutoff(timezone: string, now: Date): boolean {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      minute: 'numeric',
      hour12: false
    });
    const parts = formatter.formatToParts(now);
    const hourPart = parts.find((p) => p.type === 'hour');
    const minutePart = parts.find((p) => p.type === 'minute');
    if (!hourPart || !minutePart) return false;
    const hour = parseInt(hourPart.value, 10);
    const minute = parseInt(minutePart.value, 10);

    // Cutoff is 6:30 AM
    if (hour > 6) return true;
    if (hour === 6 && minute >= 30) return true;
    return false;
  } catch (error) {
    console.warn(`Timezone calculation failed for "${timezone}". Skipping cutoff check.`, error);
    return false;
  }
}

function formatLocalTime(date: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      minute: 'numeric',
      hour12: true
    }).format(date);
  } catch (err) {
    return date.toLocaleTimeString();
  }
}

function getDaysOverdue(date: Date): number {
  const diffMs = Date.now() - date.getTime();
  const days = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  return Math.max(1, days);
}

/**
 * Runs the briefing pipeline. Employs retry logic for database queries, checks
 * cutoff limits, and dispatches the compiled briefing (or fallback) via both
 * FCM and Resend email channels.
 */
export async function runBriefingPipeline(
  userId: string,
  options?: { mockDate?: Date; retryDelayMs?: number }
): Promise<BriefingPipelineResult> {
  const retryDelayMs = options?.retryDelayMs ?? 60000;

  // 1. Fetch user's details (device_timezone, email, fcm_token)
  const userRes = await pool.query('SELECT email, device_timezone, fcm_token FROM users WHERE id = $1', [userId]);
  if (userRes.rowCount === 0) {
    console.error(`runBriefingPipeline: User ${userId} not found.`);
    return { outcome: 'fallback' };
  }
  const user = userRes.rows[0];
  const deviceTimezone = user.device_timezone || 'UTC';
  const email = user.email;
  const fcmToken = user.fcm_token;

  let outcome: 'success' | 'fallback' = 'fallback';
  let briefingData: { todayTasks: Task[]; overdueTasks: Task[] } | undefined;

  // 2. Pre-flight Health Check
  console.log(`[Briefing Orchestrator] Running health check pre-condition for user ${userId}...`);
  const health = await runHealthCheck(userId);
  if (!health.healthy) {
    console.warn(`[Briefing Orchestrator] Health check failed for user ${userId}: ${health.failureReason}. Aborting pipeline and triggering fallback.`);
    outcome = 'fallback';
  } else {
    console.log(`[Briefing Orchestrator] Health check passed for user ${userId}. Starting data aggregation loops...`);

    // 3. Retry loop for gathering briefing data
    const maxAttempts = 10;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const activeNow = options?.mockDate ?? new Date();

      // Check 6:30 AM abandonment constraint
      if (isAfterCutoff(deviceTimezone, activeNow)) {
        console.warn(`[Briefing Orchestrator] Abandonment cutoff reached (current time is at or after 6:30 AM in ${deviceTimezone}). Stopping retries and triggering fallback.`);
        outcome = 'fallback';
        break;
      }

      try {
        console.log(`[Briefing Orchestrator] Attempting briefing data aggregation ${attempt}/${maxAttempts} for user ${userId}...`);
        briefingData = await gatherBriefingData(userId, deviceTimezone);
        console.log(`[Briefing Orchestrator] Successfully aggregated briefing data on attempt ${attempt} for user ${userId}.`);
        outcome = 'success';
        break;
      } catch (err: any) {
        console.warn(`[Briefing Orchestrator] Briefing aggregation attempt ${attempt}/${maxAttempts} failed: ${err.message || String(err)}.`);
        
        if (attempt === maxAttempts) {
          console.error(`[Briefing Orchestrator] Exhausted all ${maxAttempts} aggregation attempts. Triggering fallback.`);
          outcome = 'fallback';
          break;
        }

        console.log(`[Briefing Orchestrator] Retrying in ${retryDelayMs / 1000} seconds...`);
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
    }
  }

  // 4. Payload composition & dispatch
  let bodyText = '';
  let pushTitle = 'Daily Briefing';
  let notificationType: 'briefing' | 'system_fallback' = 'briefing';

  if (outcome === 'success' && briefingData) {
    notificationType = 'briefing';
    const { todayTasks, overdueTasks } = briefingData;

    if (todayTasks.length === 0 && overdueTasks.length === 0) {
      bodyText = 'Nothing on your plate today — enjoy the calm.';
    } else {
      const parts: string[] = [];
      parts.push(`Good morning!`);
      
      if (todayTasks.length > 0) {
        parts.push(`You have ${todayTasks.length} thing(s) today:`);
        for (const t of todayTasks) {
          const timeStr = t.deadline_at ? ` (${formatLocalTime(t.deadline_at, deviceTimezone)})` : '';
          parts.push(`- ${t.title}${timeStr}`);
        }
      } else {
        parts.push('Nothing scheduled for today.');
      }

      if (overdueTasks.length > 0) {
        parts.push(`\nYou also have ${overdueTasks.length} overdue task(s):`);
        for (const t of overdueTasks) {
          const days = t.deadline_at ? getDaysOverdue(t.deadline_at) : 0;
          const agoStr = days === 1 ? '1 day ago' : `${days} days ago`;
          parts.push(`- ${t.title} (due ${agoStr})`);
        }
      }

      bodyText = parts.join('\n');
    }
  } else {
    // Fallback path
    notificationType = 'system_fallback';
    pushTitle = 'System Fallback Alert';
    bodyText = "Your daily briefing couldn't be generated — please open the app to reconnect.";
  }

  console.log(`[Briefing Orchestrator] Dispatching briefing (${outcome}) to user ${userId} via Push & Email...`);

  // Dispatch Push
  if (!fcmToken) {
    console.log(`[Briefing Orchestrator] Skipping push dispatch for user ${userId} - no FCM token registered.`);
    await logNotification({
      userId,
      channel: 'push',
      notificationType,
      deliveryStatus: 'failed',
      failureReason: 'no_fcm_token_registered'
    });
  } else {
    const pushResult = await sendPushNotification(fcmToken, pushTitle, bodyText);
    await logNotification({
      userId,
      channel: 'push',
      notificationType,
      deliveryStatus: pushResult.success ? 'success' : 'failed',
      failureReason: pushResult.success ? null : pushResult.error
    });
  }

  // Dispatch Email
  if (!email) {
    console.log(`[Briefing Orchestrator] Skipping email dispatch for user ${userId} - no email registered.`);
    await logNotification({
      userId,
      channel: 'email',
      notificationType,
      deliveryStatus: 'failed',
      failureReason: 'no_email_registered'
    });
  } else {
    const emailResult = await sendReminderEmail(email, pushTitle, bodyText);
    await logNotification({
      userId,
      channel: 'email',
      notificationType,
      deliveryStatus: emailResult.success ? 'success' : 'failed',
      failureReason: emailResult.success ? null : emailResult.error
    });
  }

  return { outcome, data: briefingData };
}

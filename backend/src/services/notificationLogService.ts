import { pool } from '../config/db';

export interface LogNotificationParams {
  userId: string;
  reminderId?: string | null;
  channel: 'push' | 'email';
  notificationType: 'reminder' | 'briefing' | 'system_fallback';
  deliveryStatus: 'success' | 'failed';
  failureReason?: string | null;
}

/**
 * Inserts a record into the notification_log table for auditing delivery.
 */
export async function logNotification(params: LogNotificationParams): Promise<void> {
  const { userId, reminderId, channel, notificationType, deliveryStatus, failureReason } = params;
  await pool.query(
    `INSERT INTO notification_log (user_id, reminder_id, channel, notification_type, delivery_status, failure_reason)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [userId, reminderId || null, channel, notificationType, deliveryStatus, failureReason || null]
  );
}

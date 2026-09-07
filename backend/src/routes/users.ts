import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth';
import { pool } from '../config/db';

const router = Router();

// GET /users/me - Get current user profile and notification/sync settings
router.get('/me', authMiddleware, async (req: Request, res: Response) => {
  const userId = req.userId;
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized: User ID context missing.' });
    return;
  }

  try {
    const userRes = await pool.query(
      `SELECT email, briefing_enabled, push_enabled, email_enabled, briefing_time 
       FROM users 
       WHERE id = $1`,
      [userId]
    );

    if (userRes.rowCount === 0) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }

    const user = userRes.rows[0];

    const googleAccountRes = await pool.query(
      `SELECT sync_status 
       FROM google_accounts 
       WHERE user_id = $1`,
      [userId]
    );

    const syncStatus = (googleAccountRes.rows.length > 0) ? googleAccountRes.rows[0].sync_status : 'disconnected';

    // Format briefing_time (TIME) from HH:MM:SS to HH:MM
    const formattedBriefingTime = user.briefing_time && typeof user.briefing_time === 'string'
      ? user.briefing_time.substring(0, 5)
      : '05:55';

    res.status(200).json({
      email: user.email,
      briefing_enabled: user.briefing_enabled,
      push_enabled: user.push_enabled,
      email_enabled: user.email_enabled,
      sync_status: syncStatus,
      briefing_time: formattedBriefingTime,
    });
  } catch (error) {
    console.error('Error fetching GET /users/me:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// PATCH /users/me - Update user notification/briefing preferences
router.patch('/me', authMiddleware, async (req: Request, res: Response) => {
  const userId = req.userId;
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized: User ID context missing.' });
    return;
  }

  const { briefing_enabled, push_enabled, email_enabled, briefingTime } = req.body;

  // Validate briefingTime if provided
  if (briefingTime !== undefined) {
    const timeRegex = /^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$/;
    if (typeof briefingTime !== 'string' || !timeRegex.test(briefingTime)) {
      res.status(400).json({
        error: 'Validation Error: briefingTime must be a string in strict 24-hour HH:MM format (e.g., "07:30").'
      });
      return;
    }
  }

  const updates: string[] = [];
  const values: any[] = [userId];
  let valCounter = 2;

  if (briefing_enabled !== undefined) {
    updates.push(`briefing_enabled = $${valCounter}`);
    values.push(Boolean(briefing_enabled));
    valCounter++;
  }

  if (push_enabled !== undefined) {
    updates.push(`push_enabled = $${valCounter}`);
    values.push(Boolean(push_enabled));
    valCounter++;
  }

  if (email_enabled !== undefined) {
    updates.push(`email_enabled = $${valCounter}`);
    values.push(Boolean(email_enabled));
    valCounter++;
  }

  if (briefingTime !== undefined) {
    updates.push(`briefing_time = $${valCounter}`);
    values.push(briefingTime); // PG automatically parses HH:MM to TIME
    valCounter++;
  }

  if (updates.length === 0) {
    res.status(400).json({ error: 'Validation Error: No settings updates provided.' });
    return;
  }

  try {
    const query = `
      UPDATE users 
      SET ${updates.join(', ')}, updated_at = NOW() 
      WHERE id = $1 
      RETURNING email, briefing_enabled, push_enabled, email_enabled, briefing_time
    `;
    const updateRes = await pool.query(query, values);
    if (updateRes.rowCount === 0) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }

    const updatedUser = updateRes.rows[0];
    const formattedTime = updatedUser.briefing_time && typeof updatedUser.briefing_time === 'string'
      ? updatedUser.briefing_time.substring(0, 5)
      : '05:55';

    res.status(200).json({
      email: updatedUser.email,
      briefing_enabled: updatedUser.briefing_enabled,
      push_enabled: updatedUser.push_enabled,
      email_enabled: updatedUser.email_enabled,
      briefing_time: formattedTime
    });
  } catch (error) {
    console.error('Error in PATCH /users/me:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// PATCH /users/me/fcm-token - Sync FCM device token for push notifications
router.patch('/me/fcm-token', authMiddleware, async (req: Request, res: Response) => {
  const userId = req.userId;
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized: User ID context missing.' });
    return;
  }

  const { fcmToken } = req.body;
  if (fcmToken === undefined) {
    res.status(400).json({ error: 'Validation Error: fcmToken is required.' });
    return;
  }

  try {
    const query = `
      UPDATE users 
      SET fcm_token = $2, updated_at = NOW() 
      WHERE id = $1 
      RETURNING id, email, fcm_token
    `;
    const updateRes = await pool.query(query, [userId, fcmToken ? String(fcmToken).trim() : null]);
    if (updateRes.rowCount === 0) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }

    res.status(200).json({ message: 'FCM token synced successfully.', user: updateRes.rows[0] });
  } catch (error) {
    console.error('Error in PATCH /users/me/fcm-token:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

export default router;

import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth';
import { runInstanceGenerationForAllActiveTemplates } from '../services/instanceGenerationService';
import { sendPushNotification } from '../services/fcmService';
import { runHealthCheck } from '../services/healthCheckService';
import { gatherBriefingData } from '../services/briefingService';
import { runBriefingPipeline } from '../services/briefingOrchestrator';
import { pool } from '../config/db';

const router = Router();

// POST /admin/test-briefing-pipeline - Manually trigger briefing pipeline sequence
router.post('/test-briefing-pipeline', authMiddleware, async (req: Request, res: Response) => {
  const userId = req.userId;
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized: User ID context missing.' });
    return;
  }

  try {
    const result = await runBriefingPipeline(userId);
    res.status(200).json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message || String(error) });
  }
});

// POST /admin/trigger-briefing - Manually trigger end-to-end briefing pipeline with dispatch
router.post('/trigger-briefing', authMiddleware, async (req: Request, res: Response) => {
  const userId = req.userId;
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized: User ID context missing.' });
    return;
  }

  const { mockDate } = req.body;

  try {
    const result = await runBriefingPipeline(userId, {
      mockDate: mockDate ? new Date(mockDate) : undefined
    });
    res.status(200).json({ outcome: result.outcome });
  } catch (error: any) {
    res.status(500).json({ error: error.message || String(error) });
  }
});

// GET /admin/test-briefing-data - Manually fetch aggregated briefing data
router.get('/test-briefing-data', authMiddleware, async (req: Request, res: Response) => {
  const userId = req.userId;
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized: User ID context missing.' });
    return;
  }

  try {
    const userRes = await pool.query('SELECT device_timezone FROM users WHERE id = $1', [userId]);
    if (userRes.rowCount === 0) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }
    const deviceTimezone = userRes.rows[0].device_timezone || 'UTC';

    const result = await gatherBriefingData(userId, deviceTimezone);
    res.status(200).json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message || String(error) });
  }
});

// GET /admin/test-health-check - Manually trigger health check verification
router.get('/test-health-check', authMiddleware, async (req: Request, res: Response) => {
  const userId = req.userId;
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized: User ID context missing.' });
    return;
  }

  try {
    const result = await runHealthCheck(userId);
    res.status(200).json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message || String(error) });
  }
});

// POST /admin/generate-instances - Manually trigger instance generation
router.post('/generate-instances', authMiddleware, async (req: Request, res: Response) => {
  const userId = req.userId;
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized: User ID context missing.' });
    return;
  }

  try {
    console.log(`Manual instance generation triggered by user ${userId}`);
    const results = await runInstanceGenerationForAllActiveTemplates();
    res.status(200).json({
      message: 'Instance generation run completed successfully.',
      results
    });
  } catch (error) {
    console.error('Error during manual instance generation route:', error);
    res.status(500).json({
      error: `Failed to generate instances: ${(error as Error).message}`
    });
  }
});

// POST /admin/test-push - Test Firebase push notification delivery
// Note: Retained behind auth middleware for ongoing developer debugging and manual testing as permitted by Step 5.2.
router.post('/test-push', authMiddleware, async (req: Request, res: Response) => {
  const userId = req.userId;
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized: User ID context missing.' });
    return;
  }

  const { deviceToken, title, body } = req.body;

  if (!deviceToken || typeof deviceToken !== 'string') {
    res.status(400).json({ error: 'Validation Error: deviceToken is required.' });
    return;
  }

  if (!title || typeof title !== 'string') {
    res.status(400).json({ error: 'Validation Error: title is required.' });
    return;
  }

  if (!body || typeof body !== 'string') {
    res.status(400).json({ error: 'Validation Error: body is required.' });
    return;
  }

  try {
    const result = await sendPushNotification(deviceToken, title, body);
    res.status(200).json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;

import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth';
import { runInstanceGenerationForAllActiveTemplates } from '../services/instanceGenerationService';
import { sendPushNotification } from '../services/fcmService';

const router = Router();

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

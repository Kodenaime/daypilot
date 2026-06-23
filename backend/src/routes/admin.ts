import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth';
import { runInstanceGenerationForAllActiveTemplates } from '../services/instanceGenerationService';

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

export default router;

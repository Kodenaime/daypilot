import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth';
import { performInitialSync, performIncrementalSync } from '../services/googleCalendar';

const router = Router();

// Perform initial calendar full sync
router.post('/initial', authMiddleware, async (req: Request, res: Response) => {
  const userId = req.userId;

  if (!userId) {
    res.status(401).json({ error: 'Unauthorized: User ID context missing.' });
    return;
  }

  try {
    const result = await performInitialSync(userId);
    res.status(200).json({
      message: 'Initial calendar sync completed successfully.',
      importedCount: result.importedCount
    });
  } catch (error) {
    console.error('Error during initial calendar sync route handler:', error);
    res.status(500).json({
      error: `Failed to complete initial calendar sync: ${(error as Error).message}`
    });
  }
});

// Perform incremental sync using cursors
router.post('/incremental', authMiddleware, async (req: Request, res: Response) => {
  const userId = req.userId;

  if (!userId) {
    res.status(401).json({ error: 'Unauthorized: User ID context missing.' });
    return;
  }

  try {
    const result = await performIncrementalSync(userId);
    res.status(200).json({
      message: 'Incremental calendar sync completed successfully.',
      upsertedCount: result.upsertedCount,
      deletedCount: result.deletedCount
    });
  } catch (error) {
    console.error('Error during incremental calendar sync route handler:', error);
    res.status(500).json({
      error: `Failed to complete incremental calendar sync: ${(error as Error).message}`
    });
  }
});

export default router;

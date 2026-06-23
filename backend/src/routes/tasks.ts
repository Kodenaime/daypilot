import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth';
import {
  createStandaloneTask,
  getTasksForUser,
  getTaskById,
  patchTask,
  deleteTask,
  getOverdueTasks
} from '../services/taskService';

const router = Router();

// Validate ISO 8601 string helper
function isValidISO8601(val: string): boolean {
  if (!val) return false;
  // A simple parsing check
  const timestamp = Date.parse(val);
  if (isNaN(timestamp)) return false;
  // Basic sanity check for ISO-like structure (contains '-' and optional 'T'/'Z' etc)
  return val.includes('-') && (val.includes(':') || val.length >= 10);
}

// POST /tasks - Create a standalone task
router.post('/', authMiddleware, async (req: Request, res: Response) => {
  const userId = req.userId;
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized: User ID context missing.' });
    return;
  }

  const { title, deadline_at, timezone_snapshot } = req.body;

  // Title validation
  if (!title || typeof title !== 'string' || title.trim() === '') {
    res.status(400).json({ error: 'Validation Error: Title is required and must be a non-empty string.' });
    return;
  }

  // Timezone validation
  if (!timezone_snapshot || typeof timezone_snapshot !== 'string' || timezone_snapshot.trim() === '') {
    res.status(400).json({ error: 'Validation Error: timezone_snapshot is required.' });
    return;
  }

  // Deadline validation (optional)
  if (deadline_at !== undefined && deadline_at !== null) {
    if (typeof deadline_at !== 'string' || !isValidISO8601(deadline_at)) {
      res.status(400).json({ error: 'Validation Error: deadline_at must be a valid ISO 8601 date string.' });
      return;
    }
  }

  try {
    const task = await createStandaloneTask(userId, {
      title: title.trim(),
      deadline_at,
      timezone_snapshot: timezone_snapshot.trim()
    });
    res.status(201).json(task);
  } catch (error) {
    console.error('Error in POST /tasks:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// GET /tasks - Get all tasks for user (ordered by deadline, optional status filter)
router.get('/', authMiddleware, async (req: Request, res: Response) => {
  const userId = req.userId;
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized: User ID context missing.' });
    return;
  }

  const { status } = req.query;
  let statusFilter: 'pending' | 'completed' | undefined = undefined;

  if (status === 'pending' || status === 'completed') {
    statusFilter = status;
  } else if (status !== undefined) {
    res.status(400).json({ error: "Validation Error: status query param must be 'pending' or 'completed'." });
    return;
  }

  try {
    const tasks = await getTasksForUser(userId, statusFilter);
    res.status(200).json(tasks);
  } catch (error) {
    console.error('Error in GET /tasks:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// GET /tasks/overdue - Get computed overdue tasks
router.get('/overdue', authMiddleware, async (req: Request, res: Response) => {
  const userId = req.userId;
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized: User ID context missing.' });
    return;
  }

  const { max_days } = req.query;
  let maxDaysVal: number | undefined = undefined;

  if (max_days !== undefined) {
    const parsed = Number(max_days);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      res.status(400).json({ error: "Validation Error: 'max_days' must be a positive integer." });
      return;
    }
    maxDaysVal = parsed;
  }

  try {
    const overdueTasks = await getOverdueTasks(userId, maxDaysVal);
    res.status(200).json(overdueTasks);
  } catch (error) {
    console.error('Error in GET /tasks/overdue:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// GET /tasks/:id - Get a single task (only if owned)
router.get('/:id', authMiddleware, async (req: Request, res: Response) => {
  const userId = req.userId;
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized: User ID context missing.' });
    return;
  }

  const taskId = req.params.id;

  try {
    const task = await getTaskById(userId, taskId);
    if (!task) {
      res.status(404).json({ error: 'Task not found or unauthorized.' });
      return;
    }
    res.status(200).json(task);
  } catch (error) {
    console.error(`Error in GET /tasks/${taskId}:`, error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// PATCH /tasks/:id - Update task (title, deadline_at, status)
router.patch('/:id', authMiddleware, async (req: Request, res: Response) => {
  const userId = req.userId;
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized: User ID context missing.' });
    return;
  }

  const taskId = req.params.id;
  const { title, deadline_at, status } = req.body;

  const updates: any = {};

  if (title !== undefined) {
    if (typeof title !== 'string' || title.trim() === '') {
      res.status(400).json({ error: 'Validation Error: Title must be a non-empty string.' });
      return;
    }
    updates.title = title.trim();
  }

  if (deadline_at !== undefined) {
    if (deadline_at !== null) {
      if (typeof deadline_at !== 'string' || !isValidISO8601(deadline_at)) {
        res.status(400).json({ error: 'Validation Error: deadline_at must be a valid ISO 8601 date string.' });
        return;
      }
      updates.deadline_at = deadline_at;
    } else {
      updates.deadline_at = null;
    }
  }

  if (status !== undefined) {
    if (status !== 'pending' && status !== 'completed') {
      res.status(400).json({ error: "Validation Error: status must be 'pending' or 'completed'." });
      return;
    }
    updates.status = status;
  }

  try {
    const updatedTask = await patchTask(userId, taskId, updates);
    if (!updatedTask) {
      res.status(404).json({ error: 'Task not found or unauthorized.' });
      return;
    }
    res.status(200).json(updatedTask);
  } catch (error) {
    console.error(`Error in PATCH /tasks/${taskId}:`, error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// DELETE /tasks/:id - Delete a task
router.delete('/:id', authMiddleware, async (req: Request, res: Response) => {
  const userId = req.userId;
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized: User ID context missing.' });
    return;
  }

  const taskId = req.params.id;

  try {
    const success = await deleteTask(userId, taskId);
    if (!success) {
      res.status(404).json({ error: 'Task not found or unauthorized.' });
      return;
    }
    res.status(200).json({ message: 'Task deleted successfully.' });
  } catch (error) {
    console.error(`Error in DELETE /tasks/${taskId}:`, error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

export default router;

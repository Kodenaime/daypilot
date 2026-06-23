import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth';
import {
  createTemplate,
  getTemplatesForUser,
  getTemplateById,
  patchTemplate,
  deactivateTemplate
} from '../services/templateService';

const router = Router();

// Input validator helper to strictly validate hours (00-23) and minutes/seconds (00-59)
function isValidTime(val: string): boolean {
  if (typeof val !== 'string') return false;
  const match = val.match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return false;
  const h = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  const s = match[3] ? parseInt(match[3], 10) : 0;
  return h >= 0 && h < 24 && m >= 0 && m < 60 && s >= 0 && s < 60;
}

// POST /templates - Create a template
router.post('/', authMiddleware, async (req: Request, res: Response) => {
  const userId = req.userId;
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized: User ID context missing.' });
    return;
  }

  const {
    title,
    recurrence_type,
    interval_days,
    days_of_week,
    day_of_month,
    time_of_day,
    timezone_snapshot
  } = req.body;

  // Basic checks
  if (!title || typeof title !== 'string' || title.trim() === '') {
    res.status(400).json({ error: 'Validation Error: Title is required.' });
    return;
  }

  const types = ['daily', 'weekly', 'monthly', 'custom_interval'];
  if (!recurrence_type || !types.includes(recurrence_type)) {
    res.status(400).json({ error: "Validation Error: recurrence_type must be one of 'daily', 'weekly', 'monthly', 'custom_interval'." });
    return;
  }

  if (!time_of_day || !isValidTime(time_of_day)) {
    res.status(400).json({ error: 'Validation Error: time_of_day is required and must be in HH:MM or HH:MM:SS format.' });
    return;
  }

  if (!timezone_snapshot || typeof timezone_snapshot !== 'string' || timezone_snapshot.trim() === '') {
    res.status(400).json({ error: 'Validation Error: timezone_snapshot is required.' });
    return;
  }

  // Conditional field validation
  let intervalVal: number | null = null;
  let daysVal: number[] | null = null;
  let domVal: number | null = null;

  if (recurrence_type === 'custom_interval') {
    if (interval_days === undefined || interval_days === null) {
      res.status(400).json({ error: "Validation Error: custom_interval requires 'interval_days'." });
      return;
    }
    const val = Number(interval_days);
    if (!Number.isInteger(val) || val <= 0) {
      res.status(400).json({ error: "Validation Error: 'interval_days' must be a positive integer." });
      return;
    }
    intervalVal = val;
  }

  if (recurrence_type === 'weekly') {
    if (days_of_week === undefined || days_of_week === null || !Array.isArray(days_of_week)) {
      res.status(400).json({ error: "Validation Error: weekly requires 'days_of_week' array." });
      return;
    }
    if (days_of_week.length === 0) {
      res.status(400).json({ error: "Validation Error: 'days_of_week' cannot be empty." });
      return;
    }
    for (const d of days_of_week) {
      const dayNum = Number(d);
      if (!Number.isInteger(dayNum) || dayNum < 0 || dayNum > 6) {
        res.status(400).json({ error: "Validation Error: 'days_of_week' elements must be integers from 0 to 6." });
        return;
      }
    }
    daysVal = days_of_week.map(Number);
  }

  if (recurrence_type === 'monthly') {
    if (day_of_month === undefined || day_of_month === null) {
      res.status(400).json({ error: "Validation Error: monthly requires 'day_of_month'." });
      return;
    }
    const val = Number(day_of_month);
    if (!Number.isInteger(val) || val < 1 || val > 31) {
      res.status(400).json({ error: "Validation Error: 'day_of_month' must be an integer from 1 to 31." });
      return;
    }
    domVal = val;
  }

  try {
    const template = await createTemplate(userId, {
      title: title.trim(),
      recurrence_type,
      interval_days: intervalVal,
      days_of_week: daysVal,
      day_of_month: domVal,
      time_of_day,
      timezone_snapshot: timezone_snapshot.trim()
    });
    res.status(201).json(template);
  } catch (error) {
    console.error('Error in POST /templates:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// GET /templates - Get all templates for user
router.get('/', authMiddleware, async (req: Request, res: Response) => {
  const userId = req.userId;
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized: User ID context missing.' });
    return;
  }

  const { is_active } = req.query;
  let activeFilter: boolean | undefined = undefined;

  if (is_active === 'true') {
    activeFilter = true;
  } else if (is_active === 'false') {
    activeFilter = false;
  } else if (is_active !== undefined) {
    res.status(400).json({ error: "Validation Error: 'is_active' filter must be 'true' or 'false'." });
    return;
  }

  try {
    const templates = await getTemplatesForUser(userId, activeFilter);
    res.status(200).json(templates);
  } catch (error) {
    console.error('Error in GET /templates:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// GET /templates/:id - Get single template
router.get('/:id', authMiddleware, async (req: Request, res: Response) => {
  const userId = req.userId;
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized: User ID context missing.' });
    return;
  }

  const templateId = req.params.id;

  try {
    const template = await getTemplateById(userId, templateId);
    if (!template) {
      res.status(404).json({ error: 'Template not found or unauthorized.' });
      return;
    }
    res.status(200).json(template);
  } catch (error) {
    console.error(`Error in GET /templates/${templateId}:`, error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// PATCH /templates/:id - Update template
router.patch('/:id', authMiddleware, async (req: Request, res: Response) => {
  const userId = req.userId;
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized: User ID context missing.' });
    return;
  }

  const templateId = req.params.id;
  const { title, recurrence_type, interval_days, days_of_week, day_of_month, time_of_day } = req.body;

  // Block changing recurrence_type
  if (recurrence_type !== undefined) {
    res.status(400).json({ error: 'Validation Error: Changing recurrence_type after creation is not allowed.' });
    return;
  }

  const updates: any = {};

  if (title !== undefined) {
    if (typeof title !== 'string' || title.trim() === '') {
      res.status(400).json({ error: 'Validation Error: Title must be a non-empty string.' });
      return;
    }
    updates.title = title.trim();
  }

  if (time_of_day !== undefined) {
    if (!isValidTime(time_of_day)) {
      res.status(400).json({ error: 'Validation Error: time_of_day must be in HH:MM or HH:MM:SS format.' });
      return;
    }
    updates.time_of_day = time_of_day;
  }

  if (interval_days !== undefined) {
    if (interval_days !== null) {
      const val = Number(interval_days);
      if (!Number.isInteger(val) || val <= 0) {
        res.status(400).json({ error: "Validation Error: 'interval_days' must be a positive integer." });
        return;
      }
      updates.interval_days = val;
    } else {
      updates.interval_days = null;
    }
  }

  if (days_of_week !== undefined) {
    if (days_of_week !== null) {
      if (!Array.isArray(days_of_week) || days_of_week.length === 0) {
        res.status(400).json({ error: "Validation Error: 'days_of_week' must be a non-empty array." });
        return;
      }
      for (const d of days_of_week) {
        const dayNum = Number(d);
        if (!Number.isInteger(dayNum) || dayNum < 0 || dayNum > 6) {
          res.status(400).json({ error: "Validation Error: 'days_of_week' elements must be integers from 0 to 6." });
          return;
        }
      }
      updates.days_of_week = days_of_week.map(Number);
    } else {
      updates.days_of_week = null;
    }
  }

  if (day_of_month !== undefined) {
    if (day_of_month !== null) {
      const val = Number(day_of_month);
      if (!Number.isInteger(val) || val < 1 || val > 31) {
        res.status(400).json({ error: "Validation Error: 'day_of_month' must be an integer from 1 to 31." });
        return;
      }
      updates.day_of_month = val;
    } else {
      updates.day_of_month = null;
    }
  }

  try {
    const updated = await patchTemplate(userId, templateId, updates);
    if (!updated) {
      res.status(404).json({ error: 'Template not found or unauthorized.' });
      return;
    }
    res.status(200).json(updated);
  } catch (error) {
    console.error(`Error in PATCH /templates/${templateId}:`, error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// PATCH /templates/:id/deactivate - Deactivate template (soft delete)
router.patch('/:id/deactivate', authMiddleware, async (req: Request, res: Response) => {
  const userId = req.userId;
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized: User ID context missing.' });
    return;
  }

  const templateId = req.params.id;

  try {
    const deactivated = await deactivateTemplate(userId, templateId);
    if (!deactivated) {
      res.status(404).json({ error: 'Template not found or unauthorized.' });
      return;
    }
    res.status(200).json(deactivated);
  } catch (error) {
    console.error(`Error in PATCH /templates/${templateId}/deactivate:`, error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

export default router;

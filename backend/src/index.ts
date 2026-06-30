import express, { Request, Response } from 'express';
import helmet from 'helmet';
import { rateLimiter } from './middleware/rateLimiter';
import dotenv from 'dotenv';
import { checkDatabaseConnection } from './config/db';
import { runMigrations } from './migrations/runner';
import './utils/encryption'; // Triggers key validation on startup
import { issueToken } from './utils/jwt'; // Triggers JWT secret check on startup
import { authMiddleware } from './middleware/auth';
import authRouter from './routes/auth';
import syncRouter from './routes/sync';
import tasksRouter from './routes/tasks';
import templatesRouter from './routes/templates';
import adminRouter from './routes/admin';
import usersRouter from './routes/users';
import { setupCalendarSyncJob } from './jobs/calendarSyncJob';
import { setupInstanceGenerationJob } from './jobs/instanceGenerationJob';
import { setupBriefingJob } from './jobs/briefingJob';
import './jobs/reminderQueue';
import './services/fcmService';
import './services/emailService';

import { logInfo, logError } from './utils/logger';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.json());

// Security Middlewares
app.use(helmet());

// Public and authenticated rate limiter (100 req/min limit, per user if logged in, falling back to IP)
app.use(rateLimiter);

// Mount routes
app.use('/auth', authRouter); // Mount Google OAuth routes
app.use('/sync', syncRouter); // Mount Google Calendar Sync routes
app.use('/tasks', tasksRouter); // Mount Tasks CRUD routes
app.use('/templates', templatesRouter); // Mount Templates CRUD routes
app.use('/admin', adminRouter); // Mount Admin routes
app.use('/users', usersRouter); // Mount Users routes

// Liveness health check with database status
app.get('/health', async (_req: Request, res: Response) => {
  const isDbConnected = await checkDatabaseConnection();
  res.status(200).json({
    status: 'ok',
    database: isDbConnected ? 'connected' : 'disconnected'
  });
});

// Temporary Route to Issue Test Tokens
app.get('/auth/test-token/:userId', (req: Request, res: Response) => {
  const token = issueToken(req.params.userId);
  res.status(200).json({ token });
});

// Temporary Protected Route for Middleware verification
app.get('/auth/test-protected', authMiddleware, (req: Request, res: Response) => {
  res.status(200).json({ userId: req.userId });
});


// Startup sequence
async function startServer() {
  logInfo('startup', 'Initializing DayPilot Backend...');

  // Database Connection Check with Retries (especially useful for Docker Compose startup)
  let dbConnected = false;
  const maxRetries = 5;
  const retryIntervalMs = 3000;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    dbConnected = await checkDatabaseConnection();
    if (dbConnected) {
      break;
    }
    if (attempt < maxRetries) {
      logInfo('startup', `Database not ready yet. Retrying in ${retryIntervalMs / 1000}s (attempt ${attempt}/${maxRetries})...`, { attempt, maxRetries });
      await new Promise((resolve) => setTimeout(resolve, retryIntervalMs));
    }
  }

  if (dbConnected) {
    logInfo('startup', 'Database connected successfully.');
    try {
      await runMigrations();
      // Initialize Background Scheduled Jobs
      await setupCalendarSyncJob();
      await setupInstanceGenerationJob();
      await setupBriefingJob();
    } catch (err) {
      logError('startup', 'Failed to initialize server dependencies or migrations', { error: err instanceof Error ? err.message : String(err) });
    }
  } else {
    logError('startup', 'Database connection failed after retries. Continuing server startup for health check liveness...');
  }

  app.listen(PORT, () => {
    logInfo('startup', `Server is running on port ${PORT}`, { port: PORT });
  });
}

startServer();

// Top-level unhandled exception and rejection handlers
process.on('uncaughtException', (err) => {
  logError('process', 'Uncaught Exception detected, exiting process', {
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined
  });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logError('process', 'Unhandled Rejection detected, exiting process', {
    reason: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined
  });
  process.exit(1);
});


import express, { Request, Response } from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
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
import { setupCalendarSyncJob } from './jobs/calendarSyncJob';
import { setupInstanceGenerationJob } from './jobs/instanceGenerationJob';
import { setupBriefingJob } from './jobs/briefingJob';
import './jobs/reminderQueue';
import './services/fcmService';
import './services/emailService';

// Load environment variables
dotenv.config();

const app = express();
app.use(express.json());
app.use('/auth', authRouter); // Mount Google OAuth routes
app.use('/sync', syncRouter); // Mount Google Calendar Sync routes

const PORT = process.env.PORT || 3000;

// Security Middlewares
app.use(helmet());

// Basic Rate Limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

app.use('/tasks', tasksRouter); // Mount Tasks CRUD routes
app.use('/templates', templatesRouter); // Mount Templates CRUD routes
app.use('/admin', adminRouter); // Mount Admin routes

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
  console.log('Initializing DayPilot Backend...');

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
      console.log(`Database not ready yet. Retrying in ${retryIntervalMs / 1000}s (attempt ${attempt}/${maxRetries})...`);
      await new Promise((resolve) => setTimeout(resolve, retryIntervalMs));
    }
  }

  if (dbConnected) {
    console.log('Database connected successfully.');
    try {
      await runMigrations();
      // Initialize Background Scheduled Jobs
      await setupCalendarSyncJob();
      await setupInstanceGenerationJob();
      await setupBriefingJob();
    } catch (err) {
      console.error('Failed to initialize server dependencies or migrations:', err);
    }
  } else {
    console.error('Database connection failed after retries. Continuing server startup for health check liveness...');
  }

  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
}

startServer();


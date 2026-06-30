import { Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { verifyToken } from '../utils/jwt';

export const rateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // Limit each key to 100 requests per window
  keyGenerator: (req: Request) => {
    // 1. If req.userId is already populated, use it
    if (req.userId) {
      return `user:${req.userId}`;
    }

    // 2. Try to decode the JWT token directly from headers if authMiddleware hasn't run yet
    const authHeader = req.headers.authorization;
    if (authHeader) {
      const parts = authHeader.split(' ');
      if (parts.length === 2 && parts[0] === 'Bearer') {
        try {
          const decoded = verifyToken(parts[1]);
          if (decoded && decoded.userId) {
            req.userId = decoded.userId; // Cache on request object
            return `user:${decoded.userId}`;
          }
        } catch (e) {
          // Token might be invalid/expired, fall back to IP limit
        }
      }
    }

    // 3. Fall back to IP address for unauthenticated requests
    return `ip:${req.ip || ''}`;
  },
  handler: (_req: Request, res: Response) => {
    res.status(429).json({
      error: 'Too many requests. Please wait a minute and try again.',
    });
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

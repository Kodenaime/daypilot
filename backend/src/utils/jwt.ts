import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET;

// Startup check for JWT_SECRET
if (!JWT_SECRET) {
  throw new Error('FATAL: JWT_SECRET environment variable is missing.');
}

interface TokenPayload {
  userId: string;
}

/**
 * Issues a signed JSON Web Token with a 30-day lifespan.
 */
export function issueToken(userId: string): string {
  const payload: TokenPayload = { userId };
  return jwt.sign(payload, JWT_SECRET as string, { expiresIn: '30d' });
}

/**
 * Verifies and decodes a JSON Web Token.
 * Returns the parsed payload containing the userId, or throws an error.
 */
export function verifyToken(token: string): TokenPayload {
  try {
    const decoded = jwt.verify(token, JWT_SECRET as string) as TokenPayload;
    if (!decoded || !decoded.userId) {
      throw new Error('Invalid token payload');
    }
    return decoded;
  } catch (error) {
    throw new Error(`Token verification failed: ${(error as Error).message}`);
  }
}

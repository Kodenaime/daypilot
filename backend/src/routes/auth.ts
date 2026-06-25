import { Router, Request, Response } from 'express';
import { OAuth2Client } from 'google-auth-library';
import { pool } from '../config/db';
import { issueToken } from '../utils/jwt';
import { encrypt } from '../utils/encryption';

const router = Router();

const redirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/auth/google/callback';

// Initialize OAuth2 client
const oauth2Client = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  redirectUri
);

if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
  console.warn(
    'Warning: GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET environment variable is missing. Google OAuth flow will fail.'
  );
}

// Redirect User to Google Consent screen
router.get('/google', (req: Request, res: Response) => {
  try {
    const platform = req.query.platform as string;
    const authorizeUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline', // critical to receive refresh_token
      scope: [
        'https://www.googleapis.com/auth/calendar.readonly',
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/userinfo.profile'
      ],
      prompt: 'consent', // force consent screen to ensure refresh_token is returned
      state: platform // Pass platform (e.g. 'mobile') in OAuth state
    });
    res.redirect(authorizeUrl);
  } catch (error) {
    console.error('Error generating Google OAuth URL:', error);
    res.status(500).json({ error: 'Failed to initialize Google OAuth login.' });
  }
});

// OAuth Callback handler
router.get('/google/callback', async (req: Request, res: Response): Promise<void> => {
  const { code } = req.query;

  if (!code) {
    res.status(400).json({ error: 'Bad Request: Authorization code is missing.' });
    return;
  }

  const client = await pool.connect();
  try {
    // 1. Exchange auth code for tokens
    const { tokens } = await oauth2Client.getToken(code as string);
    oauth2Client.setCredentials(tokens);

    // 2. Fetch User Profile Info to get email
    let email = '';
    if (tokens.id_token) {
      const ticket = await oauth2Client.verifyIdToken({
        idToken: tokens.id_token,
        audience: process.env.GOOGLE_CLIENT_ID
      });
      const payload = ticket.getPayload();
      email = payload?.email || '';
    }

    if (!email) {
      // Fallback request
      const infoRes = await oauth2Client.request<{ email: string }>({
        url: 'https://www.googleapis.com/oauth2/v2/userinfo'
      });
      email = infoRes.data.email || '';
    }

    if (!email) {
      res.status(400).json({ error: 'Failed to retrieve email profile from Google.' });
      return;
    }

    await client.query('BEGIN');

    // 3. User Upsert check
    let userRes = await client.query('SELECT id FROM users WHERE email = $1', [email]);
    let userId = '';

    if (userRes.rowCount === 0) {
      const insertUserRes = await client.query(
        'INSERT INTO users (email, device_timezone) VALUES ($1, $2) RETURNING id',
        [email, 'UTC']
      );
      userId = insertUserRes.rows[0].id;
    } else {
      userId = userRes.rows[0].id;
    }

    // 4. Update google_accounts (Encrypted Token Storage for 1.5b)
    // Check tokens expiration
    const expiryOffsetMs = tokens.expiry_date ? (tokens.expiry_date - Date.now()) : 3600 * 1000;
    const tokenExpiresAt = new Date(Date.now() + expiryOffsetMs);

    // Remove existing credential record for this user to avoid conflicts
    await client.query('DELETE FROM google_accounts WHERE user_id = $1', [userId]);

    await client.query(
      `INSERT INTO google_accounts (user_id, access_token, refresh_token, token_expires_at, sync_status)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        userId,
        encrypt(tokens.access_token || ''),
        encrypt(tokens.refresh_token || ''), // Encrypted storage (1.5b requirement)
        tokenExpiresAt,
        'healthy'
      ]
    );

    await client.query('COMMIT');

    // 5. Issue application JWT
    const jwtToken = issueToken(userId);
    if (req.query.state === 'mobile') {
      res.redirect(`daypilot://auth-callback?token=${encodeURIComponent(jwtToken)}`);
    } else {
      res.status(200).json({ token: jwtToken });
    }
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('OAuth callback processing failed:', error);
    res.status(500).json({ error: 'Authentication processing failed.' });
  } finally {
    client.release();
  }
});

export default router;

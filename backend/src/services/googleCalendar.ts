import { OAuth2Client } from 'google-auth-library';
import { pool } from '../config/db';
import { encrypt, decrypt } from '../utils/encryption';
import { logInfo, logWarn, logError } from '../utils/logger';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/auth/google/callback';

/**
 * Looks up user's Google OAuth credentials, decrypts refresh token,
 * refreshes the access token if expired, and returns an authenticated OAuth2Client.
 */
export async function getAuthenticatedCalendarClient(userId: string): Promise<OAuth2Client> {
  const res = await pool.query(
    'SELECT access_token, refresh_token, token_expires_at FROM google_accounts WHERE user_id = $1',
    [userId]
  );

  if (res.rowCount === 0) {
    throw new Error('Google Account credentials not found for this user.');
  }

  const { access_token, refresh_token, token_expires_at } = res.rows[0];

  // Decrypt credentials
  const decryptedAccess = decrypt(access_token);
  const decryptedRefresh = decrypt(refresh_token);

  const oauth2Client = new OAuth2Client(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI
  );

  oauth2Client.setCredentials({
    access_token: decryptedAccess,
    refresh_token: decryptedRefresh,
    expiry_date: new Date(token_expires_at).getTime()
  });

  // If token is expired or expiring in under 1 minute, refresh it manually
  const isExpired = new Date(token_expires_at).getTime() - Date.now() < 60 * 1000;
  if (isExpired) {
    logInfo('sync', `OAuth token expired or expiring soon for user ${userId}. Refreshing access token...`, { userId });
    try {
      const { credentials } = await oauth2Client.refreshAccessToken();
      oauth2Client.setCredentials(credentials);

      const newExpiresAt = new Date(credentials.expiry_date || (Date.now() + 3600 * 1000));
      
      await pool.query(
        `UPDATE google_accounts 
         SET access_token = $1, token_expires_at = $2, sync_status = 'healthy' 
         WHERE user_id = $3`,
        [
          encrypt(credentials.access_token || ''),
          newExpiresAt,
          userId
        ]
      );
      logInfo('sync', `OAuth access token successfully refreshed and encrypted in DB for user ${userId}.`, { userId });
    } catch (err) {
      // Set sync_status to token_expired on refresh failure
      await pool.query(
        "UPDATE google_accounts SET sync_status = 'token_expired' WHERE user_id = $1",
        [userId]
      );
      throw new Error(`Failed to refresh Google OAuth token: ${(err as Error).message}`);
    }
  }

  return oauth2Client;
}

interface CalendarEvent {
  id: string;
  summary?: string;
  status?: string;
  start?: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
}

interface CalendarListResponse {
  items: CalendarEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
}

/**
 * Performs initial sync: downloads all events from 1 year ago to future.
 * Saves cursor synchronization token in google_accounts.
 */
export async function performInitialSync(userId: string): Promise<{ importedCount: number }> {
  const oauth2Client = await getAuthenticatedCalendarClient(userId);

  // Retrieve user's timezone settings
  const userRes = await pool.query('SELECT device_timezone FROM users WHERE id = $1', [userId]);
  const userTimezone = userRes.rows[0]?.device_timezone || 'UTC';

  let importedCount = 0;
  let nextPageToken: string | undefined = undefined;
  let syncToken: string | undefined = undefined;

  try {
    // We only import events starting from 1 year ago. This is a heuristic decision
    // by Google Calendar API to receive a "nextSyncToken" for future incremental syncs.
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

    logInfo('sync', `Starting initial sync for user ${userId}. Skipping tasks prior to ${oneYearAgo.toISOString()}.`, { userId });

    do {
      const params: Record<string, string | boolean> = {
        singleEvents: true, // Expand recurring events
        maxResults: '250'
      };

      if (nextPageToken) {
        params.pageToken = nextPageToken;
      }

      const response = await fetchEventsWithBackoff(oauth2Client, params, userId);

      const data = response.data;
      const events = data.items || [];

      for (const event of events) {
        // Skip cancelled events
        if (event.status === 'cancelled') continue;

        const eventStart = event.start?.dateTime || event.start?.date;
        if (!eventStart) continue;

        const deadlineAt = new Date(eventStart);
        
        // Skip events older than 1 year
        if (deadlineAt < oneYearAgo) continue;

        const title = event.summary || 'Untitled Event';
        const timezoneSnapshot = event.start?.timeZone || userTimezone;

        // Insert event into tasks table
        await pool.query(
          `INSERT INTO tasks (user_id, google_event_id, title, deadline_at, timezone_snapshot, status)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (google_event_id) DO NOTHING`, // Avoid duplicates if run multiple times
          [
            userId,
            event.id,
            title,
            deadlineAt,
            timezoneSnapshot,
            'pending'
          ]
        );
        importedCount++;
      }

      nextPageToken = data.nextPageToken;
      syncToken = data.nextSyncToken;
    } while (nextPageToken);

    if (syncToken) {
      // Update next sync token and sync status in DB
      await pool.query(
        `UPDATE google_accounts 
         SET sync_token = $1, last_synced_at = NOW(), sync_status = 'healthy' 
         WHERE user_id = $2`,
        [syncToken, userId]
      );
      logInfo('sync', `Initial sync complete for user ${userId}. nextSyncToken saved.`, { userId });
    }

    return { importedCount };
  } catch (error) {
    const statusCode = (error as any).status || (error as any).code || (error as any).response?.status;
    if (statusCode === 429 || statusCode === 403) {
      logWarn('sync', `Quota limit exceeded (HTTP ${statusCode}) during initial sync for user ${userId}. Skipping.`, { userId, statusCode });
      throw error;
    }
    logError('sync', `Initial sync failure for user ${userId}`, {
      userId,
      error: error instanceof Error ? error.message : String(error)
    });
    await pool.query(
      "UPDATE google_accounts SET sync_status = 'sync_error' WHERE user_id = $1",
      [userId]
    );
    throw error;
  }
}

const BACKOFF_DELAY_MS = process.env.NODE_ENV === 'test' ? 50 : 30000;

async function fetchEventsWithBackoff(
  oauth2Client: OAuth2Client,
  params: Record<string, string | boolean>,
  userId: string
): Promise<any> {
  try {
    return await oauth2Client.request<CalendarListResponse>({
      url: 'https://www.googleapis.com/calendar/v3/calendars/primary/events',
      params
    });
  } catch (err) {
    const statusCode = (err as any).status || (err as any).code || (err as any).response?.status;
    if (statusCode === 429 || statusCode === 403) {
      logWarn('sync', `Google Calendar API quota limit hit (HTTP ${statusCode}) for user ${userId}. Retrying in ${BACKOFF_DELAY_MS}ms...`, { userId, statusCode });
      await new Promise((resolve) => setTimeout(resolve, BACKOFF_DELAY_MS));
      // Retry once
      return await oauth2Client.request<CalendarListResponse>({
        url: 'https://www.googleapis.com/calendar/v3/calendars/primary/events',
        params
      });
    }
    throw err;
  }
}

/**
 * Performs incremental sync using the stored nextSyncToken cursor.
 * Saves/modifies tasks based on changes since the last sync.
 */
export async function performIncrementalSync(
  userId: string
): Promise<{ upsertedCount: number; deletedCount: number }> {
  const oauth2Client = await getAuthenticatedCalendarClient(userId);

  // Retrieve user's timezone settings and sync token
  const accountRes = await pool.query(
    'SELECT sync_token FROM google_accounts WHERE user_id = $1',
    [userId]
  );
  if (accountRes.rowCount === 0 || !accountRes.rows[0].sync_token) {
    throw new Error('Google Calendar sync token missing. Perform initial sync first.');
  }

  const storedSyncToken = accountRes.rows[0].sync_token;

  const userRes = await pool.query('SELECT device_timezone FROM users WHERE id = $1', [userId]);
  const userTimezone = userRes.rows[0]?.device_timezone || 'UTC';

  let upsertedCount = 0;
  let deletedCount = 0;
  let nextPageToken: string | undefined = undefined;
  let newSyncToken: string | undefined = undefined;

  logInfo('sync', `Starting incremental sync for user ${userId} with syncToken: ${storedSyncToken}`, { userId, storedSyncToken });

  try {
    do {
      const params: Record<string, string | boolean> = {
        syncToken: storedSyncToken,
        maxResults: '250'
      };

      if (nextPageToken) {
        params.pageToken = nextPageToken;
      }

      const response = await fetchEventsWithBackoff(oauth2Client, params, userId);
      const data = response.data;
      const events = data.items || [];

      for (const event of events) {
        if (event.status === 'cancelled') {
          // Hard-delete corresponding task (standard V1 behavior)
          const deleteRes = await pool.query(
            'DELETE FROM tasks WHERE google_event_id = $1 AND user_id = $2',
            [event.id, userId]
          );
          if (deleteRes.rowCount && deleteRes.rowCount > 0) {
            deletedCount++;
          }
        } else {
          const eventStart = event.start?.dateTime || event.start?.date;
          if (!eventStart) continue;

          const deadlineAt = new Date(eventStart);
          const title = event.summary || 'Untitled Event';
          const timezoneSnapshot = event.start?.timeZone || userTimezone;

          // Upsert modified or new events
          await pool.query(
            `INSERT INTO tasks (user_id, google_event_id, title, deadline_at, timezone_snapshot, status)
             VALUES ($1, $2, $3, $4, $5, 'pending')
             ON CONFLICT (google_event_id) DO UPDATE SET
               title = EXCLUDED.title,
               deadline_at = EXCLUDED.deadline_at,
               timezone_snapshot = EXCLUDED.timezone_snapshot,
               updated_at = NOW()`,
            [
              userId,
              event.id,
              title,
              deadlineAt,
              timezoneSnapshot
            ]
          );
          upsertedCount++;
        }
      }

      nextPageToken = data.nextPageToken;
      newSyncToken = data.nextSyncToken;
    } while (nextPageToken);

    if (newSyncToken) {
      await pool.query(
        `UPDATE google_accounts 
         SET sync_token = $1, last_synced_at = NOW(), sync_status = 'healthy' 
         WHERE user_id = $2`,
        [newSyncToken, userId]
      );
      logInfo('sync', `Incremental sync complete. nextSyncToken updated and sync_status marked healthy.`, { userId });
    }

    return { upsertedCount, deletedCount };
  } catch (error) {
    const statusCode = (error as any).status || (error as any).code || (error as any).response?.status;

    // HTTP 410 Gone indicates syncToken has expired/invalidated
    if (statusCode === 410) {
      logInfo('sync', `syncToken expired (410) for user ${userId}. Resetting token and executing full initial sync resync...`, { userId });
      await pool.query('UPDATE google_accounts SET sync_token = NULL WHERE user_id = $1', [userId]);
      const resync = await performInitialSync(userId);
      return { upsertedCount: resync.importedCount, deletedCount: 0 };
    }

    if (statusCode === 429 || statusCode === 403) {
      logWarn('sync', `Quota limit exceeded (HTTP ${statusCode}) twice for user ${userId}. Skipping this run.`, { userId, statusCode });
      throw error;
    }

    // Unexpected sync failure: Mark sync_status as sync_error
    logError('sync', `Incremental sync failure for user ${userId}`, {
      userId,
      error: error instanceof Error ? error.message : String(error)
    });
    await pool.query(
      "UPDATE google_accounts SET sync_status = 'sync_error' WHERE user_id = $1",
      [userId]
    );
    throw error;
  }
}

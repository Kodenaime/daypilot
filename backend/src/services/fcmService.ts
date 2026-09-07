import { initializeApp, cert } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import dotenv from 'dotenv';
import { withTimeout } from '../utils/withTimeout';
import { logInfo, logWarn, logError } from '../utils/logger';

dotenv.config();

const FCM_SERVICE_ACCOUNT_KEY = process.env.FCM_SERVICE_ACCOUNT_KEY;

if (!FCM_SERVICE_ACCOUNT_KEY) {
  throw new Error('FATAL: FCM_SERVICE_ACCOUNT_KEY environment variable is missing.');
}

let serviceAccount: any;
try {
  const decoded = Buffer.from(FCM_SERVICE_ACCOUNT_KEY, 'base64').toString('utf8');
  serviceAccount = JSON.parse(decoded);
} catch (error: any) {
  throw new Error(`FATAL: Failed to parse FCM_SERVICE_ACCOUNT_KEY as JSON. Error: ${error.message}`);
}

let isFirebaseInitialized = false;
try {
  initializeApp({
    credential: cert(serviceAccount)
  });
  logInfo('fcm', 'Firebase Admin SDK initialized successfully for FCM.');
  isFirebaseInitialized = true;
} catch (error: any) {
  logWarn('fcm', `WARNING: Firebase Admin SDK initialization failed: ${error.message}. Push notifications will fail to deliver.`, {
    error: error.message
  });
}

export async function sendPushNotification(
  deviceToken: string,
  title: string,
  body: string
): Promise<{ success: boolean; error?: string }> {
  if (!isFirebaseInitialized) {
    logError('fcm', 'FCM push notification send failed: Firebase Admin SDK is not initialized.');
    return { success: false, error: 'Firebase Admin SDK is not initialized.' };
  }

  try {
    const message = {
      notification: {
        title,
        body
      },
      token: deviceToken
    };
    // Race the FCM send call against an 8-second timeout
    const response = await withTimeout(
      getMessaging().send(message),
      8000,
      'FCM request timed out'
    );
    logInfo('fcm', 'Successfully sent push notification via FCM', { response });
    return { success: true };
  } catch (error: any) {
    logError('fcm', 'FCM push notification send failed', {
      error: error.message || String(error)
    });
    return { success: false, error: error.message || String(error) };
  }
}

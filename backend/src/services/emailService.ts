import dotenv from 'dotenv';
import { withTimeout } from '../utils/withTimeout';
import { logInfo, logError } from '../utils/logger';

dotenv.config();

const RESEND_API_KEY = process.env.RESEND_API_KEY;

if (!RESEND_API_KEY) {
  throw new Error('FATAL: RESEND_API_KEY environment variable is missing.');
}

export async function sendReminderEmail(
  toEmail: string,
  subject: string,
  bodyText: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const fetchPromise = fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'DayPilot <onboarding@resend.dev>', // Resend testing sandbox sender
        to: toEmail,
        subject: subject,
        text: bodyText
      })
    });

    const response = await withTimeout(
      fetchPromise,
      8000,
      'Resend request timed out'
    );

    const data: any = await response.json();

    if (!response.ok) {
      logError('email', 'Resend API returned an error status', {
        status: response.status,
        data
      });
      return { success: false, error: data?.message || `HTTP error ${response.status}` };
    }

    logInfo('email', 'Successfully sent email via Resend', { emailId: data.id });
    return { success: true };
  } catch (error: any) {
    logError('email', 'Resend email send failed', {
      error: error.message || String(error)
    });
    return { success: false, error: error.message || String(error) };
  }
}

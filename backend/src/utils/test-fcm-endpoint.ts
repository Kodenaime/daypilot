import http from 'http';
import { URL } from 'url';
import { issueToken } from './jwt';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function request(
  method: string,
  url: string,
  headers: Record<string, string> = {},
  body?: any
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const options = {
      method,
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      headers: {
        ...headers,
        ...(body ? { 'Content-Type': 'application/json' } : {})
      }
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({ status: res.statusCode || 0, body: data });
      });
    });
    req.on('error', reject);
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function run() {
  const token = issueToken('test_fcm_user');
  const headers = { 'Authorization': `Bearer ${token}` };

  const res = await request('POST', 'http://localhost:3000/admin/test-push', headers, {
    deviceToken: 'mock_device_token_123',
    title: 'Test Title',
    body: 'Test Body'
  });

  console.log('FCM Endpoint response status:', res.status);
  console.log('FCM Endpoint response body:', res.body);
  const parsed = JSON.parse(res.body);
  assert(res.status === 200, `Expected HTTP 200, got ${res.status}`);
  assert(parsed.success === false, 'Expected success=false for mock token');
  assert(parsed.error !== undefined, 'Expected error message for mock token');
  console.log('FCM Graceful error check PASSED.');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

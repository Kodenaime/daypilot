import http from 'http';
import { URL } from 'url';

function request(method: string, url: string, headers: Record<string, string> = {}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const options = {
      method,
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      headers
    };
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        resolve({ status: res.statusCode || 0, body });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function testRateLimit() {
  console.log('--- Testing Rate Limiting ---');
  
  // 1. Get a test token first
  const testUserId = 'e05042e9-4417-4509-86bb-aab4a6b6c445';
  const tokenRes = await request('GET', `http://localhost:3000/auth/test-token/${testUserId}`);
  const token = JSON.parse(tokenRes.body).token;
  
  console.log('Sending burst of 120 authenticated requests...');
  let hit429 = false;
  
  for (let i = 1; i <= 120; i++) {
    try {
      const res = await request('GET', 'http://localhost:3000/auth/test-protected', {
        'Authorization': `Bearer ${token}`
      });
      if (res.status === 429) {
        hit429 = true;
        console.log(`[AUTH] Request #${i} triggered 429 Rate Limit as expected! Body: ${res.body}`);
        break;
      }
    } catch (err) {
      console.error(`Request #${i} failed:`, err);
    }
  }

  if (!hit429) {
    console.error('ERROR: Did not hit 429 on authenticated endpoints after 120 requests');
    process.exit(1);
  }

  console.log('Sending burst of 120 unauthenticated requests...');
  let hitUnauth429 = false;
  
  for (let i = 1; i <= 120; i++) {
    try {
      const res = await request('GET', 'http://localhost:3000/auth/google');
      if (res.status === 429) {
        hitUnauth429 = true;
        console.log(`[UNAUTH] Request #${i} triggered 429 Rate Limit as expected! Body: ${res.body}`);
        break;
      }
    } catch (err) {
      console.error(`Request #${i} failed:`, err);
    }
  }

  if (!hitUnauth429) {
    console.error('ERROR: Did not hit 429 on unauthenticated endpoints after 120 requests');
    process.exit(1);
  }

  console.log('SUCCESS: Rate limiting works perfectly for both authenticated and unauthenticated keys!');
  process.exit(0);
}

testRateLimit().catch((err) => {
  console.error('Test script crashed:', err);
  process.exit(1);
});

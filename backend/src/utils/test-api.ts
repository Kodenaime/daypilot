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

async function run() {
  console.log('Testing JWT API Middleware & Sync endpoints...');
  try {
    // 1. Test unprotected liveness
    const health = await request('GET', 'http://localhost:3000/health');
    console.log(`GET /health: Status ${health.status}, Body: ${health.body}`);

    // 2. Test protected route without token (should be 401)
    const noToken = await request('GET', 'http://localhost:3000/auth/test-protected');
    console.log(`GET /auth/test-protected (No token): Status ${noToken.status}, Body: ${noToken.body}`);
    if (noToken.status !== 401) throw new Error('Expected 401 for no token');

    // 3. Request test token with a valid UUID format to avoid Postgres casting errors
    const testUserId = 'e05042e9-4417-4509-86bb-aab4a6b6c445';
    const tokenRes = await request('GET', `http://localhost:3000/auth/test-token/${testUserId}`);
    console.log(`GET /auth/test-token/${testUserId}: Status ${tokenRes.status}, Body: ${tokenRes.body}`);
    const token = JSON.parse(tokenRes.body).token;

    // 4. Test protected route with valid token (should be 200)
    const validRes = await request('GET', 'http://localhost:3000/auth/test-protected', {
      'Authorization': `Bearer ${token}`
    });
    console.log(`GET /auth/test-protected (Valid token): Status ${validRes.status}, Body: ${validRes.body}`);
    if (validRes.status !== 200) throw new Error('Expected 200 for valid token');
    const parsedValid = JSON.parse(validRes.body);
    if (parsedValid.userId !== testUserId) throw new Error(`Expected userId to match ${testUserId}`);

    // 5. Test protected route with tampered token (should be 401)
    const tamperedRes = await request('GET', 'http://localhost:3000/auth/test-protected', {
      'Authorization': `Bearer ${token}tampered`
    });
    console.log(`GET /auth/test-protected (Tampered token): Status ${tamperedRes.status}, Body: ${tamperedRes.body}`);
    if (tamperedRes.status !== 401) throw new Error('Expected 401 for tampered token');

    // 6. Test sync/initial endpoint without token (should be 401)
    const syncNoToken = await request('POST', 'http://localhost:3000/sync/initial');
    console.log(`POST /sync/initial (No token): Status ${syncNoToken.status}, Body: ${syncNoToken.body}`);
    if (syncNoToken.status !== 401) throw new Error('Expected 401 for no token on sync');

    // 7. Test sync/initial endpoint with valid token (user has no Google Credentials in DB, should return 500 error indicating client search fail)
    const syncValidRes = await request('POST', 'http://localhost:3000/sync/initial', {
      'Authorization': `Bearer ${token}`
    });
    console.log(`POST /sync/initial (Valid token, no credentials): Status ${syncValidRes.status}, Body: ${syncValidRes.body}`);
    if (syncValidRes.status !== 500) throw new Error('Expected 500 for missing credentials');
    const parsedSync = JSON.parse(syncValidRes.body);
    if (!parsedSync.error.includes('credentials not found')) {
      throw new Error('Expected error message to complain about credentials');
    }

    // 8. Test sync/incremental endpoint without token (should be 401)
    const incNoToken = await request('POST', 'http://localhost:3000/sync/incremental');
    console.log(`POST /sync/incremental (No token): Status ${incNoToken.status}, Body: ${incNoToken.body}`);
    if (incNoToken.status !== 401) throw new Error('Expected 401 for no token on incremental sync');

    // 9. Test sync/incremental endpoint with valid token (user has no sync token, should return 500 error)
    const incValidRes = await request('POST', 'http://localhost:3000/sync/incremental', {
      'Authorization': `Bearer ${token}`
    });
    console.log(`POST /sync/incremental (Valid token, no credentials): Status ${incValidRes.status}, Body: ${incValidRes.body}`);
    if (incValidRes.status !== 500) throw new Error('Expected 500 for missing credentials on incremental sync');
    const parsedIncSync = JSON.parse(incValidRes.body);
    if (!parsedIncSync.error.includes('credentials not found')) {
      throw new Error('Expected error message to complain about credentials');
    }

    console.log('JWT Middleware & Sync Endpoint API Verification PASS!');
    process.exit(0);
  } catch (err) {
    console.error('API Verification FAIL:', err);
    process.exit(1);
  }
}

run();

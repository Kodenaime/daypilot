import http from 'http';

function get(url: string, headers: Record<string, string> = {}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    http.get(url, { headers }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        resolve({ status: res.statusCode || 0, body });
      });
    }).on('error', reject);
  });
}

async function run() {
  console.log('Testing JWT API Middleware...');
  try {
    // 1. Test unprotected liveness
    const health = await get('http://localhost:3000/health');
    console.log(`GET /health: Status ${health.status}, Body: ${health.body}`);

    // 2. Test protected route without token (should be 401)
    const noToken = await get('http://localhost:3000/auth/test-protected');
    console.log(`GET /auth/test-protected (No token): Status ${noToken.status}, Body: ${noToken.body}`);
    if (noToken.status !== 401) throw new Error('Expected 401 for no token');

    // 3. Request test token
    const tokenRes = await get('http://localhost:3000/auth/test-token/user-555');
    console.log(`GET /auth/test-token/user-555: Status ${tokenRes.status}, Body: ${tokenRes.body}`);
    const token = JSON.parse(tokenRes.body).token;

    // 4. Test protected route with valid token (should be 200)
    const validRes = await get('http://localhost:3000/auth/test-protected', {
      'Authorization': `Bearer ${token}`
    });
    console.log(`GET /auth/test-protected (Valid token): Status ${validRes.status}, Body: ${validRes.body}`);
    if (validRes.status !== 200) throw new Error('Expected 200 for valid token');
    const parsedValid = JSON.parse(validRes.body);
    if (parsedValid.userId !== 'user-555') throw new Error('Expected userId to match user-555');

    // 5. Test protected route with tampered token (should be 401)
    const tamperedRes = await get('http://localhost:3000/auth/test-protected', {
      'Authorization': `Bearer ${token}tampered`
    });
    console.log(`GET /auth/test-protected (Tampered token): Status ${tamperedRes.status}, Body: ${tamperedRes.body}`);
    if (tamperedRes.status !== 401) throw new Error('Expected 401 for tampered token');

    console.log('JWT Middleware API Verification PASS!');
    process.exit(0);
  } catch (err) {
    console.error('JWT Middleware API Verification FAIL:', err);
    process.exit(1);
  }
}

run();

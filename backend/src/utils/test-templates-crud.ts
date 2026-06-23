import http from 'http';
import { URL } from 'url';
import { pool } from '../config/db';
import { issueToken } from './jwt';
import { getTomorrowDateInTimezone } from '../services/templateService';

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
  console.log('Running Recurrence Templates CRUD Integration Tests...');

  const userAId = 'a0000000-0000-0000-0000-000000000001';
  const userBId = 'b0000000-0000-0000-0000-000000000002';

  const tokenA = issueToken(userAId);
  const tokenB = issueToken(userBId);

  const authHeadersA = { 'Authorization': `Bearer ${tokenA}` };
  const authHeadersB = { 'Authorization': `Bearer ${tokenB}` };

  const dbClient = await pool.connect();

  try {
    // 1. Prepare database test users
    console.log('Inserting test users...');
    await dbClient.query(
      `INSERT INTO users (id, email, device_timezone) 
       VALUES ($1, $2, $3) 
       ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email`,
      [userAId, 'usera@example.com', 'UTC']
    );
    await dbClient.query(
      `INSERT INTO users (id, email, device_timezone) 
       VALUES ($1, $2, $3) 
       ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email`,
      [userBId, 'userb@example.com', 'UTC']
    );

    // Clean prior templates for testing
    await dbClient.query('DELETE FROM recurrence_templates WHERE user_id IN ($1, $2)', [userAId, userBId]);

    // 2. Test POST Validation
    console.log('\n--- Testing POST Validation ---');
    
    // Missing title
    const resVal1 = await request('POST', 'http://localhost:3000/templates', authHeadersA, {
      recurrence_type: 'daily',
      time_of_day: '08:00:00',
      timezone_snapshot: 'UTC'
    });
    assert(resVal1.status === 400, 'Expected 400 for missing title');

    // Invalid time
    const resVal2 = await request('POST', 'http://localhost:3000/templates', authHeadersA, {
      title: 'Daily Template',
      recurrence_type: 'daily',
      time_of_day: '25:00:00', // invalid HH
      timezone_snapshot: 'UTC'
    });
    assert(resVal2.status === 400, 'Expected 400 for invalid time');

    // Missing interval_days for custom_interval
    const resVal3 = await request('POST', 'http://localhost:3000/templates', authHeadersA, {
      title: 'Interval Template',
      recurrence_type: 'custom_interval',
      time_of_day: '08:00:00',
      timezone_snapshot: 'UTC'
    });
    assert(resVal3.status === 400, 'Expected 400 for missing interval_days');

    // Missing days_of_week for weekly
    const resVal4 = await request('POST', 'http://localhost:3000/templates', authHeadersA, {
      title: 'Weekly Template',
      recurrence_type: 'weekly',
      time_of_day: '08:00:00',
      timezone_snapshot: 'UTC'
    });
    assert(resVal4.status === 400, 'Expected 400 for missing days_of_week');

    // Missing day_of_month for monthly
    const resVal5 = await request('POST', 'http://localhost:3000/templates', authHeadersA, {
      title: 'Monthly Template',
      recurrence_type: 'monthly',
      time_of_day: '08:00:00',
      timezone_snapshot: 'UTC'
    });
    assert(resVal5.status === 400, 'Expected 400 for missing day_of_month');
    console.log('All validations rejected successfully.');

    // 3. Test Success Creations
    console.log('\n--- Testing Template Success Creations & Anchor Calculation ---');
    const expectedUTCAnchor = getTomorrowDateInTimezone('UTC');
    const expectedNYAnchor = getTomorrowDateInTimezone('America/New_York');

    const resDaily = await request('POST', 'http://localhost:3000/templates', authHeadersA, {
      title: 'Daily Exercise',
      recurrence_type: 'daily',
      time_of_day: '07:30',
      timezone_snapshot: 'UTC'
    });
    assert(resDaily.status === 201, 'Failed to create daily template');
    const dailyT = JSON.parse(resDaily.body);
    assert(dailyT.recurrence_type === 'daily', 'Type mismatch');
    assert(dailyT.anchor_date.startsWith(expectedUTCAnchor), `Expected anchor date to start with ${expectedUTCAnchor}, got ${dailyT.anchor_date}`);
    console.log('Daily template created with anchor:', dailyT.anchor_date);

    const resWeekly = await request('POST', 'http://localhost:3000/templates', authHeadersA, {
      title: 'Weekly Sync',
      recurrence_type: 'weekly',
      days_of_week: [1, 3, 5],
      time_of_day: '09:00:00',
      timezone_snapshot: 'America/New_York'
    });
    assert(resWeekly.status === 201, 'Failed to create weekly template');
    const weeklyT = JSON.parse(resWeekly.body);
    assert(weeklyT.days_of_week.length === 3, 'Days of week count mismatch');
    assert(weeklyT.anchor_date.startsWith(expectedNYAnchor), `Expected NY anchor ${expectedNYAnchor}, got ${weeklyT.anchor_date}`);
    console.log('Weekly NY template created with anchor:', weeklyT.anchor_date);

    // 4. Test Scoping / Ownership Checks
    console.log('\n--- Testing Scoping & Ownership ---');
    const resB = await request('POST', 'http://localhost:3000/templates', authHeadersB, {
      title: 'User B private template',
      recurrence_type: 'daily',
      time_of_day: '12:00:00',
      timezone_snapshot: 'UTC'
    });
    const templateB = JSON.parse(resB.body);
    console.log('User B template created:', templateB.id);

    // User A fetches User B template -> should return 404
    const getB = await request('GET', `http://localhost:3000/templates/${templateB.id}`, authHeadersA);
    assert(getB.status === 404, 'Unauthorized read should return 404');

    // User A updates User B template -> should return 404
    const patchB = await request('PATCH', `http://localhost:3000/templates/${templateB.id}`, authHeadersA, {
      title: 'Hacked title'
    });
    assert(patchB.status === 404, 'Unauthorized patch should return 404');

    // User A deactivates User B template -> should return 404
    const deactivateB = await request('PATCH', `http://localhost:3000/templates/${templateB.id}/deactivate`, authHeadersA);
    assert(deactivateB.status === 404, 'Unauthorized deactivate should return 404');
    console.log('Ownership scoping successfully validated.');

    // 5. Test PATCH Updates & Blocked recurrence_type Change
    console.log('\n--- Testing Template Updates ---');
    // Try to update recurrence_type
    const patchType = await request('PATCH', `http://localhost:3000/templates/${dailyT.id}`, authHeadersA, {
      recurrence_type: 'weekly'
    });
    assert(patchType.status === 400, 'Expected 400 when attempting to update recurrence_type');
    console.log('Prevented updating recurrence_type correctly.');

    // Correct update
    const patchSuccess = await request('PATCH', `http://localhost:3000/templates/${dailyT.id}`, authHeadersA, {
      title: 'Daily Exercise Updated',
      time_of_day: '08:00:00'
    });
    assert(patchSuccess.status === 200, 'Update failed');
    const updatedDaily = JSON.parse(patchSuccess.body);
    assert(updatedDaily.title === 'Daily Exercise Updated', 'Title update fail');
    assert(updatedDaily.time_of_day.startsWith('08:00'), 'Time of day update fail');
    console.log('Successfully updated template title and time.');

    // 6. Test Deactivation (Soft Delete)
    console.log('\n--- Testing Deactivation ---');
    const resDeact = await request('PATCH', `http://localhost:3000/templates/${dailyT.id}/deactivate`, authHeadersA);
    assert(resDeact.status === 200, 'Deactivation failed');
    const deactivatedT = JSON.parse(resDeact.body);
    assert(deactivatedT.is_active === false, 'is_active should be false');

    // Test List filtering
    const listAll = await request('GET', 'http://localhost:3000/templates', authHeadersA);
    const all = JSON.parse(listAll.body);
    assert(all.length === 2, 'Expected 2 templates total for User A');

    const listActive = await request('GET', 'http://localhost:3000/templates?is_active=true', authHeadersA);
    const active = JSON.parse(listActive.body);
    assert(active.length === 1, `Expected 1 active template, got ${active.length}`);
    assert(active[0].id === weeklyT.id, 'Weekly template should be the only active one');
    console.log('Deactivation and list filtering successfully verified.');

    console.log('\nAll Recurrence Templates CRUD integration tests PASSED successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Integration tests FAILED:', error);
    process.exit(1);
  } finally {
    console.log('Cleaning up database test data...');
    try {
      await dbClient.query('DELETE FROM recurrence_templates WHERE user_id IN ($1, $2)', [userAId, userBId]);
      await dbClient.query('DELETE FROM users WHERE id IN ($1, $2)', [userAId, userBId]);
    } catch (cleanupErr) {
      console.error('Failed to cleanup test data:', cleanupErr);
    }
    dbClient.release();
  }
}

run();

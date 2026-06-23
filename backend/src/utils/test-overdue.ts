import http from 'http';
import { URL } from 'url';
import { pool } from '../config/db';
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
  console.log('Running Computed Overdue Endpoint Integration Tests...');

  const userAId = 'a0000000-0000-0000-0000-000000000001';
  const tokenA = issueToken(userAId);
  const authHeadersA = { 'Authorization': `Bearer ${tokenA}` };

  const dbClient = await pool.connect();

  try {
    // 1. Prepare database test user
    console.log('Inserting test user...');
    await dbClient.query(
      `INSERT INTO users (id, email, device_timezone) 
       VALUES ($1, $2, $3) 
       ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email`,
      [userAId, 'usera@example.com', 'UTC']
    );

    // Clean prior tasks
    await dbClient.query('DELETE FROM tasks WHERE user_id = $1', [userAId]);

    // Create a task overdue by 10 days
    const deadline10DaysAgo = new Date();
    deadline10DaysAgo.setDate(deadline10DaysAgo.getDate() - 10);

    const task10DaysRes = await request('POST', 'http://localhost:3000/tasks', authHeadersA, {
      title: 'Overdue 10 Days',
      timezone_snapshot: 'UTC',
      deadline_at: deadline10DaysAgo.toISOString()
    });
    assert(task10DaysRes.status === 201, 'Failed to create 10-day overdue task');
    const task10 = JSON.parse(task10DaysRes.body);

    // ==========================================
    // Test Case 1: Unbounded Overdue
    // ==========================================
    console.log('\n--- Test Case 1: Unbounded Overdue ---');
    const overdueRes1 = await request('GET', 'http://localhost:3000/tasks/overdue', authHeadersA);
    assert(overdueRes1.status === 200, `Failed to get overdue tasks: ${overdueRes1.status}`);
    const overdueList1 = JSON.parse(overdueRes1.body);
    assert(overdueList1.length === 1, `Expected 1 overdue task, got ${overdueList1.length}`);
    assert(overdueList1[0].id === task10.id, 'Task ID mismatch');
    console.log('Unbounded Overdue PASSED.');

    // ==========================================
    // Test Case 2: Completed Overdue Exclusion
    // ==========================================
    console.log('\n--- Test Case 2: Completed Overdue Exclusion ---');
    // Complete the task
    const completeRes = await request('PATCH', `http://localhost:3000/tasks/${task10.id}`, authHeadersA, {
      status: 'completed'
    });
    assert(completeRes.status === 200, 'Failed to complete task');

    const overdueRes2 = await request('GET', 'http://localhost:3000/tasks/overdue', authHeadersA);
    const overdueList2 = JSON.parse(overdueRes2.body);
    assert(overdueList2.length === 0, `Expected 0 overdue tasks after completion, got ${overdueList2.length}`);
    console.log('Completed Overdue Exclusion PASSED.');

    // ==========================================
    // Test Case 3: Bounded Overdue
    // ==========================================
    console.log('\n--- Test Case 3: Bounded Overdue ---');
    // Revert the 10-day task back to pending
    const revertRes = await request('PATCH', `http://localhost:3000/tasks/${task10.id}`, authHeadersA, {
      status: 'pending'
    });
    assert(revertRes.status === 200, 'Failed to revert task');

    // Create a 5-day overdue task
    const deadline5DaysAgo = new Date();
    deadline5DaysAgo.setDate(deadline5DaysAgo.getDate() - 5);

    const task5DaysRes = await request('POST', 'http://localhost:3000/tasks', authHeadersA, {
      title: 'Overdue 5 Days',
      timezone_snapshot: 'UTC',
      deadline_at: deadline5DaysAgo.toISOString()
    });
    const task5 = JSON.parse(task5DaysRes.body);

    // Call GET /tasks/overdue?max_days=7 (should return ONLY task5, i.e. 5 days ago)
    const boundedRes = await request('GET', 'http://localhost:3000/tasks/overdue?max_days=7', authHeadersA);
    const boundedList = JSON.parse(boundedRes.body);
    assert(boundedList.length === 1, `Expected 1 bounded overdue task, got ${boundedList.length}`);
    assert(boundedList[0].id === task5.id, `Expected task ${task5.id}, got ${boundedList[0].id}`);
    console.log('GET /tasks/overdue?max_days=7 returned only 5-day overdue task.');

    // Call GET /tasks/overdue (unbounded, should return BOTH)
    const unboundedRes = await request('GET', 'http://localhost:3000/tasks/overdue', authHeadersA);
    const unboundedList = JSON.parse(unboundedRes.body);
    assert(unboundedList.length === 2, `Expected 2 overdue tasks, got ${unboundedList.length}`);
    console.log('GET /tasks/overdue returned both tasks.');
    console.log('Bounded Overdue PASSED.');

    // ==========================================
    // Test Case 4: Query Plan Sanity Check
    // ==========================================
    console.log('\n--- Test Case 4: Query Plan Sanity Check ---');
    // Disable sequential scan on this connection to force Postgres planner to use the index on our tiny test dataset
    await dbClient.query('SET enable_seqscan = off;');
    const explainRes = await dbClient.query(`
      EXPLAIN SELECT * FROM tasks 
      WHERE user_id = $1 
        AND status = 'pending' 
        AND deadline_at IS NOT NULL 
        AND deadline_at < NOW()
    `, [userAId]);

    const planLines = explainRes.rows.map(r => r['QUERY PLAN']);
    console.log('Query Plan:');
    planLines.forEach(line => console.log(`  ${line}`));

    const usesIndex = planLines.some(line => line.includes('Index Scan') || line.includes('Bitmap Index Scan'));
    assert(usesIndex, 'Query plan does not use index on tasks');
    console.log('Query Plan uses Index successfully.');
    console.log('Query Plan Sanity Check PASSED.');

    console.log('\nAll Computed Overdue Endpoint integration tests PASSED successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Integration tests FAILED:', error);
    process.exit(1);
  } finally {
    console.log('Cleaning up database test data...');
    try {
      await dbClient.query('DELETE FROM tasks WHERE user_id = $1', [userAId]);
      await dbClient.query('DELETE FROM users WHERE id = $1', [userAId]);
    } catch (cleanupErr) {
      console.error('Failed to cleanup test data:', cleanupErr);
    }
    dbClient.release();
  }
}

run();

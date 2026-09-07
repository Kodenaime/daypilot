import { isBriefingTriggerTime } from '../jobs/briefingJob';
import Redis from 'ioredis';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function run() {
  console.log('Running Daily Briefing Scheduler (5:55 AM) & Safeguard Tests...');

  // 1. Verify Timezone Check Function isBriefingTriggerTime
  console.log('\n--- Test Case 1: Timezone trigger matches 5:55 AM bucket ---');
  
  // Create dates representing exact times
  const time555 = new Date();
  time555.setUTCHours(5, 55, 0, 0);
  const match1 = isBriefingTriggerTime('UTC', time555);
  assert(match1.matches === true, 'Expected 5:55 AM UTC to trigger matches = true');
  assert(match1.localDateStr.length > 0, 'Expected valid localDateStr output');

  const time559 = new Date();
  time559.setUTCHours(5, 59, 30, 0);
  const match2 = isBriefingTriggerTime('UTC', time559);
  assert(match2.matches === true, 'Expected 5:59 AM UTC to trigger matches = true');

  const time600 = new Date();
  time600.setUTCHours(6, 0, 0, 0);
  const match3 = isBriefingTriggerTime('UTC', time600);
  assert(match3.matches === false, 'Expected 6:00 AM UTC to trigger matches = false');

  const time554 = new Date();
  time554.setUTCHours(5, 54, 0, 0);
  const match4 = isBriefingTriggerTime('UTC', time554);
  assert(match4.matches === false, 'Expected 5:54 AM UTC to trigger matches = false');

  console.log('Timezone checking matches logic passes.');

  // 2. Verify Redis Safeguard/Double-Trigger Prevention logic manually
  console.log('\n--- Test Case 2: Double-Trigger Safeguard via Redis ---');
  
  const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
  const redis = new Redis(REDIS_URL);
  
  const mockUserId = 'scheduler-test-user-id';
  const mockLocalDateStr = '2026-06-24';
  const safeguardKey = `briefing:sent:${mockUserId}:${mockLocalDateStr}`;

  // Clear any existing key
  await redis.del(safeguardKey);

  // Attempt 1: Not set, should proceed
  const alreadySent1 = await redis.get(safeguardKey);
  assert(!alreadySent1, 'Safeguard key should not be set initially');
  
  // Set key
  await redis.set(safeguardKey, '1', 'EX', 10); // 10s expiry for test
  
  // Attempt 2: Already set, should block
  const alreadySent2 = await redis.get(safeguardKey);
  assert(alreadySent2 === '1', 'Safeguard key should be set on subsequent attempt');
  
  await redis.del(safeguardKey);
  await redis.quit();

  console.log('Redis double-trigger safeguard logic passes.');

  console.log('\nALL BRIEFING SCHEDULING AND SAFEGUARD TESTS PASSED!');
}

run().then(() => {
  process.exit(0);
}).catch((err) => {
  console.error('Test run failed:', err);
  process.exit(1);
});

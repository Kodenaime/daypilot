import { getMatchingDatesInRange } from '../services/instanceGenerationService';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function runTests() {
  console.log('Running Universal Anchor Rule Pure Date Math Unit Tests...');

  // ==========================================
  // Test Case 1: Daily Recurrence
  // Range: 2026-06-23 to 2026-06-29 (7 days)
  // ==========================================
  console.log('\n- Testing Daily Recurrence...');
  const dailyDates = getMatchingDatesInRange(
    { recurrence_type: 'daily' },
    '2026-06-23', // anchor
    '2026-06-23', // start
    '2026-06-29'  // end
  );
  assert(dailyDates.length === 7, `Expected 7 daily dates, got ${dailyDates.length}`);
  assert(dailyDates[0] === '2026-06-23', 'First daily date mismatch');
  assert(dailyDates[6] === '2026-06-29', 'Last daily date mismatch');
  console.log('Daily Recurrence PASSED.');

  // ==========================================
  // Test Case 2: Weekly Recurrence (Creation Day Edge)
  // Creation day: Monday, June 22. Anchor date: Tuesday, June 23.
  // days_of_week: [1] (Monday).
  // Generation Window starts: Tuesday, June 23 (start) to Monday, June 29 (end).
  // ==========================================
  console.log('\n- Testing Weekly Recurrence (Creation Day Edge)...');
  const weeklyDates = getMatchingDatesInRange(
    { recurrence_type: 'weekly', days_of_week: [1] },
    '2026-06-23', // anchor (Tuesday)
    '2026-06-23', // range start (Tuesday)
    '2026-06-29'  // range end (Monday)
  );
  // Earliest date matched must be Monday June 29, not today (Monday June 22)
  assert(weeklyDates.length === 1, `Expected 1 weekly match, got ${weeklyDates.length}`);
  assert(weeklyDates[0] === '2026-06-29', `Expected match to be June 29, got ${weeklyDates[0]}`);
  console.log('Weekly Recurrence (Creation Day Edge) PASSED.');

  // ==========================================
  // Test Case 3: Monthly Recurrence (Month Boundaries Edge)
  // Created Oct 30. Anchor date: Oct 31. day_of_month: 31.
  // Generation window: Oct 31 to Dec 31.
  // November has only 30 days. Should match Oct 31, Dec 31, but skip November entirely.
  // ==========================================
  console.log('\n- Testing Monthly Recurrence (Month Boundaries Edge)...');
  const monthlyDates = getMatchingDatesInRange(
    { recurrence_type: 'monthly', day_of_month: 31 },
    '2026-10-31', // anchor (Oct 31)
    '2026-10-31', // range start
    '2026-12-31'  // range end
  );
  assert(monthlyDates.length === 2, `Expected 2 monthly matches, got ${monthlyDates.length}`);
  assert(monthlyDates[0] === '2026-10-31', `Expected first match to be Oct 31, got ${monthlyDates[0]}`);
  assert(monthlyDates[1] === '2026-12-31', `Expected second match to be Dec 31, got ${monthlyDates[1]}`);
  // Confirm Nov 30 or Nov 31 are not in the matches
  const hasNovember = monthlyDates.some(d => d.includes('-11-'));
  assert(!hasNovember, 'Should have skipped November (no 31st day)');
  console.log('Monthly Recurrence (Month Boundaries Edge) PASSED.');

  // ==========================================
  // Test Case 4: Custom Interval Recurrence (Fixed Anchor Offset)
  // Created: Monday, June 22. Anchor date: Tuesday, June 23 (Tuesday).
  // interval_days: 3.
  // Generation Window starts: Tuesday, June 23 (start) to Tuesday, June 30 (end).
  // Expected dates: Tuesday June 23 (anchor), Friday June 26 (anchor + 3), Monday June 29 (anchor + 6)
  // ==========================================
  console.log('\n- Testing Custom Interval Recurrence (Fixed Anchor Offset)...');
  const customDates = getMatchingDatesInRange(
    { recurrence_type: 'custom_interval', interval_days: 3 },
    '2026-06-23', // anchor (Tuesday)
    '2026-06-23', // range start (Tuesday)
    '2026-06-30'  // range end (Tuesday)
  );
  assert(customDates.length === 3, `Expected 3 matching custom dates, got ${customDates.length}`);
  assert(customDates[0] === '2026-06-23', `Expected first match to be anchor June 23, got ${customDates[0]}`);
  assert(customDates[1] === '2026-06-26', `Expected second match to be June 26, got ${customDates[1]}`);
  assert(customDates[2] === '2026-06-29', `Expected third match to be June 29, got ${customDates[2]}`);
  console.log('Custom Interval Recurrence (Fixed Anchor Offset) PASSED.');

  console.log('\nAll Universal Anchor Rule Pure Date Math Unit Tests PASSED successfully!');
}

runTests();

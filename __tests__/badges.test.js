const test = require('node:test');
const assert = require('node:assert/strict');
const { BADGES, tierBadgeCount } = require('../src/badges/badges.js');

function badge(id) {
  const found = BADGES.find(b => b.id === id);
  assert.ok(found, `expected a badge with id ${id}`);
  return found;
}

function makeScan(overrides = {}) {
  return {
    id: 'scan-1',
    coin_name: '1946 United States Lincoln Wheat Cent',
    country: 'United States',
    denomination: 'One Cent',
    year: 1946,
    estimated_value: 12.34,
    source: 'camera',
    denom_canonical: 'wheat-penny',
    is_foreign: false,
    local_date: '2026-06-01',
    local_hour: 14,
    scanned_at: '2026-06-01T18:00:00.000Z',
    ...overrides,
  };
}

test('scan count badges use scans.length against real rows', () => {
  assert.equal(badge('scan_1').check([makeScan()]), true);
  assert.equal(badge('scan_10').check([makeScan()]), false);
  assert.equal(badge('scan_10').check(Array.from({ length: 10 }, () => makeScan())), true);
});

test('net worth badges sum estimated_value', () => {
  const scans = [makeScan({ estimated_value: 60 }), makeScan({ estimated_value: 45 })];
  assert.equal(badge('worth_100').check(scans), true);
  assert.equal(badge('worth_500').check(scans), false);
});

test('membership badges read user.createdAt, independent of scans', () => {
  const eightDaysAgo = Date.now() - 8 * 86400000;
  assert.equal(badge('mem_7').check([], { createdAt: eightDaysAgo }), true);
  assert.equal(badge('mem_30').check([], { createdAt: eightDaysAgo }), false);
});

test('coin type badges key off server-computed denom_canonical, not string parsing', () => {
  const nickel = makeScan({ denom_canonical: 'nickel', coin_name: 'Random Foreign Coin' });
  assert.equal(badge('type_nickel').check([nickel]), true);
  assert.equal(badge('type_dime').check([nickel]), false);
});

test('world traveler badge uses server-computed is_foreign, not a country-name heuristic', () => {
  const foreign = makeScan({ country: 'Canada', is_foreign: true, denom_canonical: '5-cents' });
  const domestic = makeScan({ is_foreign: false });
  assert.equal(badge('type_foreign').check([foreign]), true);
  assert.equal(badge('type_foreign').check([domestic]), false);
});

test('old soul badge uses the integer year column', () => {
  assert.equal(badge('var_old_soul').check([makeScan({ year: 1920 })]), true);
  assert.equal(badge('var_old_soul').check([makeScan({ year: 2020 })]), false);
});

test('night owl badge uses server-computed local_hour', () => {
  assert.equal(badge('var_night_owl').check([makeScan({ local_hour: 1 })]), true);
  assert.equal(badge('var_night_owl').check([makeScan({ local_hour: 14 })]), false);
});

test('denom streak badges require consecutive scans in array order', () => {
  const nickels = Array.from({ length: 5 }, () => makeScan({ denom_canonical: 'nickel' }));
  const broken = [
    ...Array.from({ length: 2 }, () => makeScan({ denom_canonical: 'nickel' })),
    makeScan({ denom_canonical: 'dime' }),
    ...Array.from({ length: 2 }, () => makeScan({ denom_canonical: 'nickel' })),
  ];
  assert.equal(badge('var_nickel_streak').check(nickels), true);
  assert.equal(badge('var_nickel_streak').check(broken), false);
});

test('tierBadgeCount gives a safe aggregate-only approximation for other leaderboard users', () => {
  const count = tierBadgeCount({ scanned: 12, netWorth: 85, memberDays: 8 });
  // scan tiers 1,10 -> 2; worth tiers 1,10,50 -> 3; day tiers 0,7 -> 2
  assert.equal(count, 7);
});

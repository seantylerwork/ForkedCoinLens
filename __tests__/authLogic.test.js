const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_ADMIN_CODE, isAdminCodeValid, isAdminUser } = require('../authLogic');

test('accepts the configured admin code and the built-in fallback', () => {
  assert.equal(isAdminCodeValid('secret-admin', 'secret-admin'), true);
  assert.equal(isAdminCodeValid(DEFAULT_ADMIN_CODE, ''), true);
  assert.equal(isAdminCodeValid('wrong-code', ''), false);
});

test('recognizes admin users from role or known admin email', () => {
  assert.equal(isAdminUser({ role: 'admin' }, ''), true);
  assert.equal(isAdminUser({ email: 'admin@coinlens.app' }, ''), true);
  assert.equal(isAdminUser({ role: 'member' }, ''), false);
});

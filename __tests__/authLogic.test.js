const test = require('node:test');
const assert = require('node:assert/strict');
const { isAdminUser } = require('../authLogic');

test('recognizes admin users only by role', () => {
  assert.equal(isAdminUser({ role: 'admin' }), true);
  assert.equal(isAdminUser({ role: 'Admin' }), true);
  assert.equal(isAdminUser({ role: 'member' }), false);
  assert.equal(isAdminUser({ email: 'admin@coinlens.app' }), false);
  assert.equal(isAdminUser(null), false);
});

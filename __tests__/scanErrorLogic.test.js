const test = require('node:test');
const assert = require('node:assert/strict');
const { ScanError, makeErrorDetail } = require('../scanErrorLogic');

test('quota_exceeded is marked non-retryable and keeps the daily-limit title', () => {
  const detail = makeErrorDetail(new ScanError('quota_exceeded', 'Daily scan limit of 3 reached. Try again tomorrow.'));
  assert.equal(detail.code, 'quota_exceeded');
  assert.equal(detail.retryable, false);
  assert.equal(detail.title, 'Daily Scan Limit Reached');
  // The body is the server's message, so it carries the actual configured
  // limit dynamically instead of a hardcoded number in the UI layer.
  assert.match(detail.body, /3/);
});

test('other scan errors remain retryable', () => {
  const codes = ['network', 'server_error', 'rate_limit', 'identification_failure', 'unknown'];
  for (const code of codes) {
    const detail = makeErrorDetail(new ScanError(code, 'some message'));
    assert.equal(detail.retryable, true, `expected ${code} to remain retryable`);
  }
});

test('a plain (non-ScanError) error falls back to the retryable unknown display', () => {
  const detail = makeErrorDetail(new Error('boom'));
  assert.equal(detail.code, 'unknown');
  assert.equal(detail.retryable, true);
  assert.equal(detail.body, 'boom');
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { getCaptureStageMeta } = require('../scanFlowLogic');

test('getCaptureStageMeta returns the front prompt by default', () => {
  const meta = getCaptureStageMeta('front');
  assert.equal(meta.title, 'Front of the Coin');
  assert.match(meta.body, /front/i);
  assert.equal(meta.autoCaptureDelayMs, 2500);
});

test('getCaptureStageMeta returns the flip prompt for the reverse side', () => {
  const meta = getCaptureStageMeta('back');
  assert.equal(meta.title, 'Flip the Coin');
  assert.match(meta.body, /back/i);
  assert.match(meta.body, /automatically/i);
});

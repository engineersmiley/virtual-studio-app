const test = require('node:test');
const assert = require('node:assert/strict');
const { getAgentPollCadence } = require('./poll-cadence');

test('Agent samples movement at up to 60 fps only while control is active', () => {
  assert.deepEqual(getAgentPollCadence(true), {
    timerIntervalMs: 16,
    minimumRequestIntervalMs: 16,
  });
  assert.deepEqual(getAgentPollCadence(false), {
    timerIntervalMs: 16,
    minimumRequestIntervalMs: 500,
  });
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyScreenShareFrameRate,
  getScreenShareFrameRate,
} from './screen-share-frame-rate.js';

test('screen capture targets 60 fps only while remote control is active', () => {
  assert.equal(getScreenShareFrameRate(false), 30);
  assert.equal(getScreenShareFrameRate(true), 60);
});

test('frame-rate changes apply to the active video track', async () => {
  const constraints = [];
  const track = {
    readyState: 'live',
    applyConstraints: async value => constraints.push(value),
  };

  assert.equal(await applyScreenShareFrameRate(track, true), 60);
  assert.equal(await applyScreenShareFrameRate(track, false), 30);
  assert.deepEqual(constraints, [
    { frameRate: { ideal: 60, max: 60 } },
    { frameRate: { ideal: 30, max: 30 } },
  ]);
});

test('ended screen tracks are left untouched', async () => {
  const track = {
    readyState: 'ended',
    applyConstraints: async () => assert.fail('ended tracks must not be updated'),
  };

  assert.equal(await applyScreenShareFrameRate(track, true), false);
});

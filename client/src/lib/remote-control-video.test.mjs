import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isSyntheticClickAfterTouch,
  mapVideoPointToScreen,
} from './remote-control-video.js';

test('one touch emits its remote click and suppresses the follow-up browser click', () => {
  const commands = [];
  const touchEndedAt = 1_000;

  commands.push('mouse-click'); // touchend dispatches the remote click
  if (!isSyntheticClickAfterTouch(touchEndedAt, 1_250, 500)) {
    commands.push('mouse-click'); // browser-generated click
  }

  assert.deepEqual(commands, ['mouse-click']);
});

test('wide video coordinates account for vertical letterboxing', () => {
  const point = mapVideoPointToScreen(
    250,
    218.75 + (562.5 * 0.25),
    { left: 0, top: 0, width: 1000, height: 1000 },
    16,
    9,
    { width: 1920, height: 1080 },
  );

  assert.deepEqual(point, { x: 480, y: 270 });
});

test('tall video coordinates account for horizontal letterboxing', () => {
  const point = mapVideoPointToScreen(
    218.75 + (562.5 * 0.75),
    250,
    { left: 0, top: 0, width: 1000, height: 1000 },
    9,
    16,
    { width: 1920, height: 1080 },
  );

  assert.deepEqual(point, { x: 1440, y: 270 });
});

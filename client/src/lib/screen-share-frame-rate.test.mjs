import assert from 'node:assert/strict';
import test from 'node:test';
import { SCREEN_SHARE_FRAME_RATE } from './screen-share-frame-rate.js';

test('screen video stays capped at 30 fps so control does not raise encoder load', () => {
  assert.equal(SCREEN_SHARE_FRAME_RATE, 30);
});

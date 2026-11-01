import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getIdentifiedCaptureSurface,
  shouldPublishCaptureState,
} from './capture-state.js';

test('capture reporting follows joined signaling during polling fallback', () => {
  assert.equal(shouldPublishCaptureState({
    role: 'artist',
    signalingJoined: true,
    transportOpen: true,
    peerConnected: false,
  }), true);
});

test('capture reporting requires the artist role and an open joined transport', () => {
  assert.equal(shouldPublishCaptureState({
    role: 'engineer',
    signalingJoined: true,
    transportOpen: true,
  }), false);
  assert.equal(shouldPublishCaptureState({
    role: 'artist',
    signalingJoined: false,
    transportOpen: true,
  }), false);
  assert.equal(shouldPublishCaptureState({
    role: 'artist',
    signalingJoined: true,
    transportOpen: false,
  }), false);
});

function track(displaySurface, overrides = {}) {
  return {
    readyState: 'live',
    muted: false,
    getSettings: () => ({ displaySurface }),
    ...overrides,
  };
}

test('only a live, unmuted, explicitly identified monitor capture qualifies', () => {
  assert.equal(getIdentifiedCaptureSurface(track('monitor')), 'monitor');
  assert.equal(getIdentifiedCaptureSurface(track('window')), null);
  assert.equal(getIdentifiedCaptureSurface(track(undefined)), null);
  assert.equal(getIdentifiedCaptureSurface(track('monitor', { readyState: 'ended' })), null);
  assert.equal(getIdentifiedCaptureSurface(track('monitor', { muted: true })), null);
  assert.equal(getIdentifiedCaptureSurface(track('monitor'), true), null);
});

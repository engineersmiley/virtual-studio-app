import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../hooks/use-webrtc.ts', import.meta.url), 'utf8');

test('desktop sharing prefers readable text and does not force 1080p capture', () => {
  assert.match(source, /width: \{ ideal: 3840 \}/);
  assert.match(source, /height: \{ ideal: 2160 \}/);
  assert.match(source, /frameRate: \{ ideal: SCREEN_SHARE_FRAME_RATE, max: SCREEN_SHARE_FRAME_RATE \}/);
  assert.match(source, /videoTrack\.contentHint = 'detail'/);
  assert.doesNotMatch(source, /setScreenShareFrameRate|applyScreenShareFrameRate/);
});

test('video sender preserves resolution while leaving audio settings unchanged', async () => {
  const start = source.indexOf('async function optimizeSendersForLowLatency');
  const end = source.indexOf('// Lock audio sender bitrate', start);
  const functionSource = source.slice(start, end)
    .replace('(pc: RTCPeerConnection): Promise<void>', '(pc)')
    .replaceAll('(params.encodings[0] as any)', 'params.encodings[0]');
  const optimize = new Function(`return (${functionSource.trim()});`)();
  const applied = {};
  const pc = {
    getSenders: () => ['video', 'audio'].map(kind => ({
      track: { kind },
      getParameters: () => ({ encodings: [{}] }),
      setParameters: async parameters => { applied[kind] = parameters; },
    })),
  };
  await optimize(pc);
  assert.equal(applied.video.degradationPreference, 'maintain-resolution');
  assert.equal(applied.video.encodings[0].maxBitrate, 16000000);
  assert.equal(applied.audio.encodings[0].maxBitrate, 510000);
  assert.equal(applied.audio.degradationPreference, undefined);
});

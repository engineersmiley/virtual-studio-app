import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const schema = readFileSync(new URL('../../../shared/schema.ts', import.meta.url), 'utf8');
const home = readFileSync(new URL('../pages/Home.tsx', import.meta.url), 'utf8');
const session = readFileSync(new URL('../pages/Session.tsx', import.meta.url), 'utf8');
const webRtc = readFileSync(new URL('../hooks/use-webrtc.ts', import.meta.url), 'utf8');

test('DJ can be selected from the homepage and joins with the DJ role', () => {
  assert.match(schema, /SessionRoles = \['artist', 'engineer', 'producer', 'other', 'dj'\]/);
  assert.match(home, /data-testid="button-role-dj"/);
  assert.match(home, /setSelectedRole\('dj'\)/);
  assert.match(home, /aria-pressed=\{selectedRole === 'dj'\}/);
});

test('DJ can broadcast like a producer without gaining engineer-only control', () => {
  assert.match(webRtc, /role === 'producer' \|\| role === 'dj'/);
  assert.match(session, /data-testid=\{isDJ \? 'button-dj-share-audio' : 'button-producer-share-audio'\}/);
  assert.match(session, /const canRecord = role === 'engineer'/);
  assert.match(session, /if \(role !== 'engineer' && role !== 'artist'\) return;/);
});

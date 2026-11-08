import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const schema = readFileSync(new URL('../../../shared/schema.ts', import.meta.url), 'utf8');
const home = readFileSync(new URL('../pages/Home.tsx', import.meta.url), 'utf8');
const session = readFileSync(new URL('../pages/Session.tsx', import.meta.url), 'utf8');
const webRtc = readFileSync(new URL('../hooks/use-webrtc.ts', import.meta.url), 'utf8');

test('Writers can be selected and Others remains the final homepage role', () => {
  assert.match(schema, /SessionRoles = \['artist', 'engineer', 'producer', 'dj', 'writer', 'other'\]/);
  assert.match(home, /data-testid="button-role-writer"/);
  const roleButtonOrder = [...home.matchAll(/setSelectedRole\('([^']+)'\)/g)].map((match) => match[1]);
  assert.deepEqual(roleButtonOrder, ['artist', 'engineer', 'producer', 'dj', 'writer', 'other']);
});

test('Writers can broadcast, but do not receive engineer-only controls', () => {
  assert.match(webRtc, /role === 'dj' \|\| role === 'writer'/);
  assert.match(session, /button-writer-share-audio/);
  assert.match(session, /const canRecord = role === 'engineer'/);
  assert.match(session, /if \(role !== 'engineer' && role !== 'artist'\) return;/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const proxy = 'http://package-firewall.replit.internal/npm/';
const registry = 'https://registry.npmjs.org/';

function fixture(t, lock) {
  const directory = mkdtempSync(path.join(tmpdir(), 'normalize-lockfile-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const scripts = path.join(directory, 'scripts');
  mkdirSync(scripts);
  const script = path.join(scripts, 'normalize-lockfile.mjs');
  // Copy the real CLI unchanged so its relative lockfile path stays isolated.
  copyFileSync(new URL('./normalize-lockfile.mjs', import.meta.url), script);
  const lockPath = path.join(directory, 'package-lock.json');
  const original = `${JSON.stringify(lock, null, 4)}\n\n`;
  writeFileSync(lockPath, original);
  return {
    original,
    read: () => readFileSync(lockPath, 'utf8'),
    run: () => {
      const result = spawnSync(process.execPath, [script], {
        cwd: directory,
        encoding: 'utf8',
        timeout: 10_000,
      });
      assert.ifError(result.error);
      assert.equal(result.signal, null);
      return result;
    },
  };
}

function packageEntry(resolved) {
  return { version: '1.2.3', resolved, integrity: 'sha512-Zml4dHVyZQ==', dev: true };
}

test('replaces only the exact private proxy prefix and preserves all other metadata', t => {
  const lock = {
    name: 'fixture',
    version: '9.8.7',
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': { name: 'fixture', version: '9.8.7', dependencies: { example: '^1.2.3' } },
      'node_modules/example': packageEntry(`${proxy}example/-/example-1.2.3.tgz`),
      'node_modules/@scope/example': {
        ...packageEntry(`${proxy}@scope/example/-/example-1.2.3.tgz`),
        integrity: 'sha1-Zml4dHVyZQ==',
      },
      'node_modules/public': packageEntry(`${registry}public/-/public-1.2.3.tgz`),
      'node_modules/other': packageEntry('https://packages.example.org/other.tgz'),
      'node_modules/https-proxy': packageEntry('https://package-firewall.replit.internal/npm/example.tgz'),
      'node_modules/lookalike': packageEntry('http://package-firewall.replit.internal/npm-other/example.tgz'),
      'node_modules/embedded': packageEntry(`https://example.org/?url=${proxy}example.tgz`),
      'node_modules/link': { resolved: 'packages/local', link: true },
    },
  };
  const files = fixture(t, lock);
  const result = files.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.match(result.stdout, /Normalized 2 package URLs/);
  const expected = structuredClone(lock);
  expected.packages['node_modules/example'].resolved = `${registry}example/-/example-1.2.3.tgz`;
  expected.packages['node_modules/@scope/example'].resolved = `${registry}@scope/example/-/example-1.2.3.tgz`;
  // Compare the entire lockfile, not just URLs: versions, hashes and unrelated fields must survive.
  assert.deepEqual(JSON.parse(files.read()), expected);
});

for (const integrity of [undefined, '']) {
  test(`fails explicitly for ${integrity === undefined ? 'missing' : 'empty'} integrity without writing any changes`, t => {
    const invalid = packageEntry(`${proxy}invalid/-/invalid-1.2.3.tgz`);
    if (integrity === undefined) delete invalid.integrity;
    else invalid.integrity = integrity;
    const files = fixture(t, {
      lockfileVersion: 3,
      packages: {
        // This entry is visited before the invalid one: failure must not leave a partial rewrite.
        'node_modules/valid': packageEntry(`${proxy}valid/-/valid-1.2.3.tgz`),
        'node_modules/invalid': invalid,
      },
    });
    const result = files.run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Cannot normalize a package without its integrity hash\./);
    assert.equal(result.stdout, '');
    assert.equal(files.read(), files.original);
  });
}

test('leaves an already-portable lockfile byte-for-byte unchanged', t => {
  const files = fixture(t, {
    lockfileVersion: 3,
    packages: {
      '': { name: 'portable', version: '1.0.0' },
      'node_modules/example': packageEntry(`${registry}example/-/example-1.2.3.tgz`),
    },
  });
  const result = files.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
  // Nonstandard whitespace deliberately catches needless serialization.
  assert.equal(files.read(), files.original);
});

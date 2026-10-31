import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import {
  auditRepositoryProtection,
  protectionProblems,
  main,
  REQUIRED_CHECK,
  GITHUB_ACTIONS_APP_ID,
} from './audit-repository-protection.mjs';

const token = 'fake-test-credential-not-a-secret';
const healthy = () => ({
  required_status_checks: {
    strict: true,
    contexts: [REQUIRED_CHECK],
    checks: [{ context: REQUIRED_CHECK, app_id: GITHUB_ACTIONS_APP_ID }],
  },
  enforce_admins: { enabled: true },
});
const response = body => async () => ({ ok: true, json: async () => body });

test('audit stays synchronized with the actual required PR job', () => {
  const workflow = load(readFileSync(new URL('../.github/workflows/typecheck.yml', import.meta.url), 'utf8'));
  assert.equal(Object.values(workflow.jobs).filter(job => job.name === REQUIRED_CHECK).length, 1);
});

test('healthy protection passes using only a bounded GET to the fixed GitHub endpoint', async () => {
  let calls = 0;
  const result = await auditRepositoryProtection({
    token,
    fetchImpl: async (url, options) => {
      calls++;
      assert.equal(url, 'https://api.github.com/repos/engineersmiley/virtual-studio-app/branches/main/protection');
      assert.equal(options.method, 'GET');
      assert.equal(options.redirect, 'error');
      assert.equal(options.headers.Authorization, `Bearer ${token}`);
      assert.equal(options.headers['X-GitHub-Api-Version'], '2022-11-28');
      assert.ok(options.signal instanceof AbortSignal);
      assert.equal(options.body, undefined);
      return { ok: true, json: async () => healthy() };
    },
  });
  assert.equal(calls, 1);
  assert.match(result, /^PASS:/);
  assert.equal(result.includes(token), false);
});

for (const [name, mutate, message] of [
  ['removed required checks', p => delete p.required_status_checks, /Require "PR TypeScript check"/],
  ['null required checks', p => p.required_status_checks = null, /Require "PR TypeScript check"/],
  ['removed check', p => p.required_status_checks.checks = [], /Require "PR TypeScript check"/],
  ['renamed check', p => p.required_status_checks.checks[0].context = 'Optional TypeScript', /Require "PR TypeScript check"/],
  ['any-source check', p => p.required_status_checks.checks[0].app_id = null, /expected source GitHub Actions/],
  ['legacy any-source check', p => p.required_status_checks.checks[0].app_id = -1, /expected source GitHub Actions/],
  ['missing source', p => delete p.required_status_checks.checks[0].app_id, /expected source GitHub Actions/],
  ['different app', p => p.required_status_checks.checks[0].app_id = 42, /expected source GitHub Actions/],
  ['context-only response', p => delete p.required_status_checks.checks, /expected source GitHub Actions/],
  ['no strict updates', p => p.required_status_checks.strict = false, /up to date/],
  ['missing strict updates', p => delete p.required_status_checks.strict, /up to date/],
  ['truthy strict value', p => p.required_status_checks.strict = 'true', /up to date/],
  ['admin bypass', p => p.enforce_admins.enabled = false, /administrator enforcement/],
  ['missing admins', p => delete p.enforce_admins, /administrator enforcement/],
  ['null admins', p => p.enforce_admins = null, /administrator enforcement/],
  ['truthy admin value', p => p.enforce_admins.enabled = 'true', /administrator enforcement/],
]) {
  test(`fails for ${name} with corrective guidance`, async () => {
    const protection = healthy();
    mutate(protection);
    await assert.rejects(auditRepositoryProtection({ token, fetchImpl: response(protection) }), error => {
      assert.match(error.message, message);
      assert.match(error.message, /settings\/branches/);
      assert.match(error.message, /No settings were changed/);
      return true;
    });
  });
}

test('accepts additional required checks without weakening the exact match', () => {
  const protection = healthy();
  protection.required_status_checks.checks.unshift(null, { context: 'Another check', app_id: 42 });
  assert.deepEqual(protectionProblems(protection), []);
});

for (const body of [null, {}, [], 'unexpected', { required_status_checks: { checks: {} } }]) {
  test(`fails closed and reports all drift for ${JSON.stringify(body)}`, async () => {
    assert.equal(protectionProblems(body).length, 3);
    await assert.rejects(auditRepositoryProtection({ token, fetchImpl: response(body) }), /Merge protection is missing or has drifted/);
  });
}

for (const [status, guidance] of [
  [401, /Authentication was rejected/],
  [403, /token permissions/],
  [404, /rule is missing/],
  [429, /rate limited/],
  [500, /GitHub is unavailable/],
  [503, /GitHub is unavailable/],
  [302, /Check GitHub API/],
]) {
  test(`HTTP ${status} fails rather than passing or logging the response body`, async () => {
    const output = [];
    const exit = await main({
      env: { GITHUB_TOKEN: token },
      fetchImpl: async () => ({ ok: false, status, json: () => { throw new Error(token); } }),
      log: text => output.push(text),
      error: text => output.push(text),
    });
    assert.equal(exit, 1);
    assert.equal(output.length, 1);
    assert.match(output[0], new RegExp(`HTTP ${status}`));
    assert.match(output[0], guidance);
    assert.equal(output[0].includes(token), false);
  });
}

test('network and timeout errors fail without printing raw errors', async () => {
  for (const cause of [new Error(token), new DOMException(token, 'TimeoutError')]) {
    await assert.rejects(auditRepositoryProtection({
      token,
      fetchImpl: async () => { throw cause; },
    }), error => {
      assert.match(error.message, /network failure, timeout, or redirect/);
      assert.equal(error.message.includes(token), false);
      return true;
    });
  }
});

test('malformed JSON fails without printing response contents', async () => {
  await assert.rejects(auditRepositoryProtection({
    token,
    fetchImpl: async () => ({ ok: true, json: async () => { throw new Error(token); } }),
  }), error => {
    assert.match(error.message, /invalid JSON/);
    assert.equal(error.message.includes(token), false);
    return true;
  });
});

test('missing or blank token fails before any network request', async () => {
  for (const missing of [undefined, '', '  ']) {
    await assert.rejects(auditRepositoryProtection({
      token: missing,
      fetchImpl: async () => assert.fail('must not contact GitHub without a token'),
    }), /GITHUB_TOKEN is required/);
  }
});

test('CLI runner reports success and returns zero', async () => {
  const output = [];
  assert.equal(await main({
    env: { GITHUB_TOKEN: token },
    fetchImpl: response(healthy()),
    log: text => output.push(text),
    error: () => assert.fail('healthy audit must not fail'),
  }), 0);
  assert.match(output[0], /^PASS:/);
});

test('CLI runner returns nonzero and lists every correction when protection is absent', async () => {
  const output = [];
  assert.equal(await main({
    env: { GITHUB_TOKEN: token },
    fetchImpl: response({}),
    log: () => assert.fail('drift must not report success'),
    error: text => output.push(text),
  }), 1);
  assert.equal(output.length, 1);
  assert.match(output[0], /Require "PR TypeScript check"/);
  assert.match(output[0], /up to date/);
  assert.match(output[0], /administrator enforcement/);
  assert.match(output[0], /settings\/branches/);
  assert.equal(output[0].includes(token), false);
});

test('actual CLI exits nonzero when no runtime token is supplied', () => {
  const result = spawnSync(process.execPath, ['scripts/audit-repository-protection.mjs'], {
    cwd: new URL('../', import.meta.url),
    env: { ...process.env, GITHUB_TOKEN: '' },
    encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /FAIL: repository protection audit/);
  assert.match(result.stderr, /GITHUB_TOKEN is required/);
});

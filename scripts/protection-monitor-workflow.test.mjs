import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';

const workflow = load(readFileSync(new URL('../.github/workflows/repository-protection-audit.yml', import.meta.url), 'utf8'));
const { audit, notify } = workflow.jobs;
const notification = notify.steps[0].with.script;
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

test('monitor is scheduled and manual only, restricted to the real main branch', () => {
  assert.deepEqual(Object.keys(workflow.on).sort(), ['schedule', 'workflow_dispatch']);
  assert.deepEqual(workflow.on.schedule, [{ cron: '17 */6 * * *' }]);
  assert.deepEqual(workflow.permissions, {});
  assert.equal(workflow.concurrency['cancel-in-progress'], false);
  for (const job of [audit, notify]) {
    assert.match(job.if, /github\.repository == 'engineersmiley\/virtual-studio-app'/);
    assert.match(job.if, /github\.ref == 'refs\/heads\/main'/);
    assert.equal(job['timeout-minutes'], 5);
    assert.equal(job['continue-on-error'], undefined);
  }
});

test('Administration secret is scoped only to trusted read-only execution', () => {
  assert.equal(audit.environment, 'repository-protection-audit');
  assert.deepEqual(audit.permissions, { contents: 'read' });
  assert.equal(audit.steps.length, 3);
  const [checkout, node, run] = audit.steps;
  assert.match(checkout.uses, /^actions\/checkout@[a-f0-9]{40}$/);
  assert.equal(checkout.with.ref, 'refs/heads/main');
  assert.equal(checkout.with['persist-credentials'], false);
  assert.equal(checkout.with['sparse-checkout'], 'scripts/audit-repository-protection.mjs');
  assert.match(node.uses, /^actions\/setup-node@[a-f0-9]{40}$/);
  assert.equal(node.with['node-version'], '22.12.0');
  assert.deepEqual(run.env, { GITHUB_TOKEN: '${{ secrets.REPOSITORY_PROTECTION_TOKEN }}' });
  assert.equal(run.run, 'node scripts/audit-repository-protection.mjs');
  assert.equal(run.if, undefined);
  assert.equal(run['continue-on-error'], undefined);
  assert.equal(audit.env, undefined);
  assert.equal(workflow.env, undefined);
});

test('failure notification is independent and cannot access the audit credential or PR code', () => {
  assert.equal(notify.needs, 'audit');
  assert.match(notify.if, /^always\(\) && needs\.audit\.result == 'failure'/);
  assert.deepEqual(notify.permissions, { issues: 'write' });
  assert.equal(notify.environment, undefined);
  assert.equal(notify.env, undefined);
  assert.equal(notify.steps.length, 1);
  assert.match(notify.steps[0].uses, /^actions\/github-script@[a-f0-9]{40}$/);
  assert.equal(notify.steps[0].env, undefined);
  assert.doesNotMatch(JSON.stringify(notify), /secrets\.|checkout|pull_request\.head/);
  assert.doesNotMatch(notification, /\$\{\{/);
});

async function deliver({ issues = [], failAt } = {}) {
  const calls = [];
  const github = {
    rest: { issues: {
      listForRepo: () => {},
      create: async args => {
        calls.push(['create', args]);
        if (failAt === 'create') throw new Error('Issue delivery denied');
      },
      createComment: async args => {
        calls.push(['comment', args]);
        if (failAt === 'comment') throw new Error('Comment delivery denied');
      },
    } },
    paginate: async (_method, args) => {
      calls.push(['list', args]);
      if (failAt === 'list') throw new Error('Issue listing denied');
      return issues;
    },
  };
  await new AsyncFunction('github', 'context', 'core', notification)(github, {
    repo: { owner: 'engineersmiley', repo: 'virtual-studio-app' },
    serverUrl: 'https://github.com', runId: 123,
  }, { notice: message => calls.push(['notice', message]) });
  return calls;
}

test('first failure assigns and mentions maintainer with run link and actionable guidance', async () => {
  const calls = await deliver();
  assert.equal(calls[0][1].creator, 'github-actions[bot]');
  assert.equal(calls[0][1].state, 'open');
  const [action, issue] = calls[1];
  assert.equal(action, 'create');
  assert.deepEqual(issue.assignees, ['engineersmiley']);
  assert.match(issue.body, /@engineersmiley/);
  assert.match(issue.body, /https:\/\/github.com\/engineersmiley\/virtual-studio-app\/actions\/runs\/123/);
  for (const guidance of ['401/403', 'Administration: read', 'REPOSITORY_PROTECTION_TOKEN',
    'Drift/404', 'settings/branches', 'Network/429/5xx', 'No protection settings were changed']) {
    assert.ok(issue.body.includes(guidance), guidance);
  }
});

test('persistent failures comment on an open bot alert, rather than silently updating its body', async () => {
  const first = await deliver();
  const calls = await deliver({ issues: [
    { number: 1, title: first[1][1].title, pull_request: {} },
    { number: 2, title: 'Unrelated issue' },
    { number: 3, title: first[1][1].title },
  ] });
  assert.equal(calls[1][0], 'comment');
  assert.equal(calls[1][1].issue_number, 3);
  assert.match(calls[1][1].body, /@engineersmiley/);
  assert.equal(calls.some(([action]) => action === 'create'), false);
});

for (const failAt of ['list', 'create', 'comment']) {
  test(`notification ${failAt} errors fail visibly rather than being swallowed`, async () => {
    const first = await deliver();
    await assert.rejects(deliver({
      failAt,
      issues: failAt === 'comment' ? [{ number: 3, title: first[1][1].title }] : [],
    }), /denied/);
  });
}

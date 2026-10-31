import assert from 'node:assert/strict';
import { load } from 'js-yaml';

const owns = (object, key) => Object.hasOwn(object, key);
const isMapping = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function assertUnconditional(target, label) {
  assert.ok(!owns(target, 'if'), `${label} must not have an if condition`);
  assert.ok(
    !owns(target, 'continue-on-error') || target['continue-on-error'] === false,
    `${label} must not allow failure via continue-on-error`,
  );
}

// Intentionally strict: changes to the required status or its shell commands
// should receive an explicit contract review, not silently weaken merge safety.
export function assertWorkflowContract(source) {
  const workflow = load(source);
  assert.ok(isMapping(workflow), 'Workflow must be a YAML mapping');
  const triggers = workflow.on;
  if (typeof triggers === 'string' || Array.isArray(triggers)) {
    assert.ok(
      [triggers].flat().includes('pull_request'),
      'Workflow must trigger on pull_request',
    );
  } else {
    assert.ok(
      isMapping(triggers) && owns(triggers, 'pull_request'),
      'Workflow must trigger on pull_request',
    );
    const pr = triggers.pull_request;
    assert.ok(
      pr === null || (isMapping(pr) && Object.keys(pr).length === 0),
      'pull_request must be unfiltered (no branch, path, type, or other filters)',
    );
  }

  assert.ok(isMapping(workflow.jobs), 'Workflow must define jobs');
  const requiredJobs = Object.values(workflow.jobs).filter(
    job => job?.name === 'PR TypeScript check',
  );
  assert.equal(requiredJobs.length, 1, 'Exactly one job must be named PR TypeScript check');
  const job = requiredJobs[0];
  assertUnconditional(job, 'Required job');
  assert.ok(!owns(job, 'needs'), 'Required job must not depend on jobs that could skip it');
  assert.ok(!owns(job, 'strategy'), 'Required job must not expand or rename the required status via a matrix');
  assert.ok(Array.isArray(job.steps) && job.steps.length > 0, 'Required job must define steps');
  job.steps.forEach((step, index) => {
    assert.ok(isMapping(step), `Step ${index + 1} must be a mapping`);
    assertUnconditional(step, `Step ${index + 1} (${step.name ?? 'unnamed'})`);
  });

  // Standalone commands prevent accepting commented-out commands, shell guards,
  // and failure suppression such as "npm run check || true".
  const commands = job.steps.map(step => typeof step.run === 'string' ? step.run.trim() : null);
  const install = commands.indexOf('npm ci');
  const check = commands.indexOf('npm run check');
  assert.ok(install >= 0, 'Required job must execute a standalone npm ci step');
  assert.ok(check > install, 'Required job must execute a standalone npm run check after npm ci');
  for (const command of ['npm run test:workflows', 'npm test', 'npm run test:mobile', 'npx playwright install --with-deps chromium', 'npm run build']) {
    assert.ok(
      commands.indexOf(command) > install,
      `Required job must execute a standalone ${command} step after npm ci`,
    );
  }
  assert.ok(
    commands.indexOf('npm run test:mobile') > commands.indexOf('npx playwright install --with-deps chromium'),
    'Required job must execute mobile tests after installing the browser',
  );
  assert.ok(
    commands.indexOf('npm run test:production') > commands.indexOf('npm run build'),
    'Required job must execute a standalone npm run test:production step after npm run build',
  );
}

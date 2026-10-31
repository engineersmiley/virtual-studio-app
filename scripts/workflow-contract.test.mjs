import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dump, load } from 'js-yaml';
import { assertWorkflowContract } from './workflow-contract.mjs';

const source = readFileSync(new URL('../.github/workflows/typecheck.yml', import.meta.url), 'utf8');
const requiredJob = workflow =>
  Object.values(workflow.jobs).find(job => job.name === 'PR TypeScript check');

test('PR workflow preserves the required, unconditional TypeScript check', () => {
  assertWorkflowContract(source);
});

function rejects(title, mutate, message) {
  test(`contract rejects ${title}`, () => {
    const workflow = load(source);
    mutate(workflow, requiredJob(workflow));
    assert.throws(() => assertWorkflowContract(dump(workflow)), message);
  });
}

rejects('removing pull_request', workflow => delete workflow.on.pull_request, /trigger on pull_request/);
rejects('removing all triggers', workflow => delete workflow.on, /trigger on pull_request/);
for (const [filter, value] of [
  ['branches', ['main']],
  ['branches-ignore', ['draft/**']],
  ['paths', ['**.ts']],
  ['paths-ignore', ['docs/**']],
  ['types', ['opened']],
]) {
  rejects(`pull_request ${filter} filters`, workflow => {
    workflow.on.pull_request = { [filter]: value };
  }, /unfiltered/);
}
rejects('renaming the required status', (_workflow, job) => {
  job.name = 'Optional TypeScript';
}, /Exactly one job/);
rejects('deleting the required job', workflow => {
  workflow.jobs = {};
}, /Exactly one job/);
rejects('duplicating the required status', (workflow, job) => {
  workflow.jobs.duplicate = structuredClone(job);
}, /Exactly one job/);
rejects('job dependencies that can skip the check', (_workflow, job) => {
  job.needs = ['optional'];
}, /must not depend/);
rejects('matrix expansion of the required status', (_workflow, job) => {
  job.strategy = { matrix: { node: [22, 24] } };
}, /matrix/);
rejects('removing all steps', (_workflow, job) => delete job.steps, /must define steps/);

for (const condition of ['false', '${{ github.event_name == \'push\' }}', true]) {
  rejects(`job condition ${condition}`, (_workflow, job) => {
    job.if = condition;
  }, /must not have an if condition/);
}
for (const allowedFailure of [true, '${{ true }}']) {
  rejects(`job continue-on-error ${allowedFailure}`, (_workflow, job) => {
    job['continue-on-error'] = allowedFailure;
  }, /must not allow failure/);
}

// Exercise every step, including checkout/setup: a skipped prerequisite can
// invalidate the check just as easily as skipping the compiler itself.
requiredJob(load(source)).steps.forEach((step, index) => {
  rejects(`condition on step ${step.name}`, (_workflow, job) => {
    job.steps[index].if = '${{ false }}';
  }, /must not have an if condition/);
  rejects(`allowed failure on step ${step.name}`, (_workflow, job) => {
    job.steps[index]['continue-on-error'] = true;
  }, /must not allow failure/);
});

for (const command of ['npm ci', 'npm run check', 'npm run test:workflows', 'npm test', 'npx playwright install --with-deps chromium', 'npm run test:mobile', 'npm run build', 'npm run test:production']) {
  rejects(`removing ${command}`, (_workflow, job) => {
    job.steps = job.steps.filter(step => step.run !== command);
  }, /must execute/);
  for (const replacement of [`# ${command}`, `${command} || true`, `echo "${command}"`, `if false; then ${command}; fi`]) {
    rejects(`replacing ${command} with ${replacement}`, (_workflow, job) => {
      job.steps.find(step => step.run === command).run = replacement;
    }, /must execute/);
  }
}
rejects('checking before installing dependencies', (_workflow, job) => {
  job.steps.reverse();
}, /after npm ci/);
rejects('running mobile tests before installing the browser', (_workflow, job) => {
  const install = job.steps.find(step => step.run === 'npx playwright install --with-deps chromium');
  job.steps = job.steps.filter(step => step !== install);
  job.steps.push(install);
}, /after installing the browser/);

for (const trigger of ['pull_request', ['push', 'pull_request'], { pull_request: {} }]) {
  test(`accepts unfiltered trigger syntax ${JSON.stringify(trigger)}`, () => {
    const workflow = load(source);
    workflow.on = trigger;
    assertWorkflowContract(dump(workflow));
  });
}
test('accepts explicit false failure permissions and multiline standalone commands', () => {
  const workflow = load(source);
  const job = requiredJob(workflow);
  job['continue-on-error'] = false;
  for (const step of job.steps) {
    step['continue-on-error'] = false;
    if (step.run) step.run += '\n';
  }
  assertWorkflowContract(dump(workflow));
});

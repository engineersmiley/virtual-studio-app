import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dump, load } from 'js-yaml';
import { assertPackageScriptContract, assertWorkflowContract } from './workflow-contract.mjs';

const source = readFileSync(new URL('../.github/workflows/typecheck.yml', import.meta.url), 'utf8');
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const requiredJob = workflow =>
  Object.values(workflow.jobs).find(job => job.name === 'PR TypeScript check');

test('package scripts preserve the compiler and all workflow regression tests', () => {
  assertPackageScriptContract(manifest);
});

function rejectsPackage(title, mutate, message) {
  test(`package contract rejects ${title}`, () => {
    const mutated = structuredClone(manifest);
    mutate(mutated);
    assert.throws(() => assertPackageScriptContract(mutated), message);
  });
}

rejectsPackage('removing scripts', pkg => delete pkg.scripts, /must define scripts/);
for (const script of ['check', 'test:workflows']) {
  for (const value of [undefined, null, false, '', 'true', 'exit 0']) {
    rejectsPackage(`${script} set to ${JSON.stringify(value)}`, pkg => {
      if (value === undefined) delete pkg.scripts[script];
      else pkg.scripts[script] = value;
    }, script === 'check' ? /TypeScript compiler/ : /test:workflows/);
  }
}

for (const command of [
  'echo tsc', '# tsc', 'tsc --version', 'tsc --help',
  'tsc || true', 'tsc; exit 0', 'tsc &', 'if false; then tsc; fi',
  'true && echo tsc', 'tsc --noCheck',
]) {
  rejectsPackage(`compiler bypass ${JSON.stringify(command)}`, pkg => {
    pkg.scripts.check = command;
  }, /TypeScript compiler/);
}

// Each existing suite is required, including the audit and monitor regressions.
for (const file of manifest.scripts['test:workflows'].split(/\s+/).slice(2)) {
  rejectsPackage(`removing ${file} from test:workflows`, pkg => {
    pkg.scripts['test:workflows'] = pkg.scripts['test:workflows']
      .split(/\s+/).filter(token => token !== file).join(' ');
  }, /all required workflow regression tests/);
}
for (const replace of [
  command => `echo "${command}"`,
  command => `# ${command}`,
  command => `${command} || true`,
  command => `${command}; exit 0`,
  command => `if false; then ${command}; fi`,
  command => command.replace('node --test', 'node --test --test-name-pattern=nonexistent'),
  command => command.replace('node --test', 'node --test --test-only'),
  command => command.replace('node --test', 'node --check'),
]) {
  const command = replace(manifest.scripts['test:workflows']);
  rejectsPackage(`workflow test bypass ${JSON.stringify(command)}`, pkg => {
    pkg.scripts['test:workflows'] = command;
  }, /test:workflows/);
}

test('package contract accepts workflow test reordering and whitespace', () => {
  const reordered = structuredClone(manifest);
  const files = reordered.scripts['test:workflows'].split(/\s+/).slice(2).reverse();
  reordered.scripts['test:workflows'] = `  node  --test\t${files.join('  ')}\n`;
  assertPackageScriptContract(reordered);
});

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

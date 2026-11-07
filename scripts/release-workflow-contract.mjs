import assert from 'node:assert/strict';
import { load } from 'js-yaml';

const packagingJobs = {
  'build-agent.yml': ['build-windows', 'build-mac', 'build-linux'],
  'build-legacy.yml': ['build-mac-legacy'],
};
const isMapping = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const owns = (object, key) => Object.hasOwn(object, key);

function assertBlocking(target, label) {
  assert.ok(
    !owns(target, 'continue-on-error') || target['continue-on-error'] === false,
    `${label} must not allow failure`,
  );
}

function assertUnconditional(target, label) {
  assert.ok(!owns(target, 'if'), `${label} must not have an if condition`);
  assertBlocking(target, label);
}

function assertRootShell(target, label) {
  assert.ok(!owns(target, 'shell'), `${label} must use the default fail-fast shell`);
  assert.ok(
    !owns(target, 'working-directory') || target['working-directory'] === '.',
    `${label} must run at the repository root`,
  );
}

function assertNeeds(job, dependencies, label) {
  const needs = typeof job.needs === 'string' ? [job.needs] : job.needs;
  assert.ok(
    Array.isArray(needs) && dependencies.every(dependency => needs.includes(dependency)),
    `${label} must depend on ${dependencies.join(', ')}`,
  );
}

// Keep release contracts independent from the PR status/trigger contract.
// Exact standalone commands deliberately reject guards and failure suppression.
export function assertReleaseWorkflowContract(source, file) {
  const builds = packagingJobs[file];
  assert.ok(builds, `Unknown release workflow: ${file}`);
  const workflow = load(source);
  assert.ok(isMapping(workflow) && isMapping(workflow.jobs), `${file} must define jobs`);
  const gate = workflow.jobs.typecheck;
  assert.ok(isMapping(gate), `${file} must define the typecheck job`);
  assertUnconditional(gate, 'typecheck');
  assert.ok(!owns(gate, 'needs'), 'typecheck must not depend on another job');
  assert.ok(!owns(gate, 'strategy'), 'typecheck must not use a matrix strategy');
  assertRootShell(workflow.defaults?.run ?? {}, 'Workflow defaults');
  assertRootShell(gate.defaults?.run ?? {}, 'typecheck defaults');
  assert.ok(Array.isArray(gate.steps) && gate.steps.length > 0, 'typecheck must define steps');
  gate.steps.forEach((step, index) => {
    assert.ok(isMapping(step), `typecheck step ${index + 1} must be a mapping`);
    assertUnconditional(step, `typecheck step ${index + 1}`);
    if (owns(step, 'run')) assertRootShell(step, `typecheck step ${index + 1}`);
  });
  const commands = gate.steps.map(step => typeof step.run === 'string' ? step.run.trim() : null);
  let previous = -1;
  for (const command of ['npm ci', 'npm run check', 'npm test', 'npm run build']) {
    const index = commands.indexOf(command);
    assert.ok(index > previous, `typecheck must execute standalone ${command} in gate order`);
    previous = index;
  }

  for (const name of builds) {
    const job = workflow.jobs[name];
    assert.ok(isMapping(job), `${file} must define ${name}`);
    assertNeeds(job, ['typecheck'], name);
    assertUnconditional(job, name);
  }
  const release = workflow.jobs.release;
  assert.ok(isMapping(release), `${file} must define release`);
  // All packaging jobs must succeed, so publishing remains transitively gated.
  assertNeeds(release, builds, 'release');
  assertBlocking(release, 'release');
  const tagOnly = "startsWith(github.ref, 'refs/tags/')";
  const taggedOrManualRelease =
    "startsWith(github.ref, 'refs/tags/') || (github.event_name == 'workflow_dispatch' && inputs.release_tag != '')";
  const allowedConditions = file === 'build-agent.yml'
    ? [tagOnly, taggedOrManualRelease]
    : [tagOnly];
  assert.ok(
    !owns(release, 'if') || allowedConditions.includes(release.if),
    'release must retain the default success gate (optionally restricted to tags)',
  );
  if (file === 'build-agent.yml' && release.if === taggedOrManualRelease) {
    const releaseTagInput = workflow.on?.workflow_dispatch?.inputs?.release_tag;
    assert.ok(isMapping(releaseTagInput) && releaseTagInput.type === 'string' && releaseTagInput.required === true,
      'manual release must require a string release_tag input');
    const releaseStep = release.steps.find(step => step.name === 'Create Release');
    assert.equal(releaseStep?.with?.tag_name, '${{ inputs.release_tag || github.ref_name }}',
      'manual releases must use the requested tag');
    assert.ok(releaseStep?.with?.body?.includes('${{ inputs.release_tag || github.ref_name }}'),
      'manual release notes must show the requested tag');
  }
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dump, load } from 'js-yaml';
import { assertReleaseWorkflowContract } from './release-workflow-contract.mjs';

const requiredCommands = ['npm ci', 'npm run check', 'npm test', 'npm run build'];

for (const file of ['build-agent.yml', 'build-legacy.yml']) {
  const source = readFileSync(new URL(`../.github/workflows/${file}`, import.meta.url), 'utf8');
  const validate = workflow => assertReleaseWorkflowContract(dump(workflow), file);
  const rejects = (title, mutate, message) => {
    test(`${file} rejects ${title}`, () => {
      const workflow = load(source);
      mutate(workflow, workflow.jobs.typecheck);
      assert.throws(() => validate(workflow), message);
    });
  };

  test(`${file} retains the blocking release gate`, () => {
    assertReleaseWorkflowContract(source, file);
  });

  rejects('missing typecheck', workflow => delete workflow.jobs.typecheck, /define the typecheck/);
  rejects('missing steps', (_workflow, gate) => delete gate.steps, /define steps/);
  rejects('empty steps', (_workflow, gate) => { gate.steps = []; }, /define steps/);
  rejects('dependent typecheck', (_workflow, gate) => { gate.needs = 'optional'; }, /must not depend/);
  rejects('matrix typecheck', (_workflow, gate) => { gate.strategy = { matrix: { node: [22] } }; }, /matrix/);

  for (const condition of [false, true, '${{ false }}', "github.event_name == 'push'"]) {
    rejects(`typecheck if ${condition}`, (_workflow, gate) => { gate.if = condition; }, /if condition/);
  }
  for (const value of [true, '${{ true }}', '${{ false }}']) {
    rejects(`typecheck continue-on-error ${value}`, (_workflow, gate) => {
      gate['continue-on-error'] = value;
    }, /must not allow failure/);
  }
  // Include checkout and Node setup, not only the four required commands.
  load(source).jobs.typecheck.steps.forEach((step, index) => {
    rejects(`conditional step ${step.name}`, (_workflow, gate) => {
      gate.steps[index].if = '${{ false }}';
    }, /if condition/);
    rejects(`allowed failure on ${step.name}`, (_workflow, gate) => {
      gate.steps[index]['continue-on-error'] = true;
    }, /must not allow failure/);
  });

  for (const command of requiredCommands) {
    rejects(`removing ${command}`, (_workflow, gate) => {
      gate.steps = gate.steps.filter(step => step.run !== command);
    }, /must execute standalone/);
    for (const replacement of [
      `# ${command}`, `echo "${command}"`, `${command} || true`,
      `if false; then ${command}; fi`, `true\n${command}\ntrue`,
    ]) {
      rejects(`${command} replaced with ${JSON.stringify(replacement)}`, (_workflow, gate) => {
        gate.steps.find(step => step.run === command).run = replacement;
      }, /must execute standalone/);
    }
    rejects(`moving ${command} out of order`, (_workflow, gate) => {
      const index = gate.steps.findIndex(step => step.run === command);
      const [step] = gate.steps.splice(index, 1);
      if (command === 'npm ci') gate.steps.push(step);
      else gate.steps.unshift(step);
    }, /gate order/);
    for (const [key, value, message] of [
      ['shell', 'bash {0}', /fail-fast shell/],
      ['working-directory', 'virtual-studio-agent', /repository root/],
    ]) {
      rejects(`${command} overrides ${key}`, (_workflow, gate) => {
        gate.steps.find(step => step.run === command)[key] = value;
      }, message);
    }
  }

  for (const scope of ['workflow', 'job']) {
    for (const [key, value, message] of [
      ['shell', 'bash {0}', /fail-fast shell/],
      ['working-directory', 'virtual-studio-agent', /repository root/],
    ]) {
      rejects(`${scope} defaults override ${key}`, (workflow, gate) => {
        (scope === 'workflow' ? workflow : gate).defaults = { run: { [key]: value } };
      }, message);
    }
  }

  const builds = Object.keys(load(source).jobs).filter(name => name.startsWith('build-'));
  for (const name of builds) {
    rejects(`missing ${name}`, workflow => delete workflow.jobs[name], new RegExp(`define ${name}`));
    for (const needs of [undefined, [], ['other-job']]) {
      rejects(`${name} bypassing typecheck with needs ${JSON.stringify(needs)}`, workflow => {
        workflow.jobs[name].needs = needs;
      }, /must depend on typecheck/);
    }
    rejects(`${name} running despite failed gate`, workflow => {
      workflow.jobs[name].if = '${{ always() }}';
    }, /if condition/);
    rejects(`${name} allowed to fail`, workflow => {
      workflow.jobs[name]['continue-on-error'] = true;
    }, /must not allow failure/);
    rejects(`release bypassing ${name}`, workflow => {
      workflow.jobs.release.needs = builds.filter(build => build !== name);
    }, /release must depend/);
  }
  rejects('missing release', workflow => delete workflow.jobs.release, /define release/);
  rejects('release without dependencies', workflow => delete workflow.jobs.release.needs, /release must depend/);
  rejects('release allowed to fail', workflow => {
    workflow.jobs.release['continue-on-error'] = '${{ true }}';
  }, /must not allow failure/);
  for (const condition of ['always()', '${{ !cancelled() }}', "always() && startsWith(github.ref, 'refs/tags/')"]) {
    rejects(`release bypass condition ${condition}`, workflow => {
      workflow.jobs.release.if = condition;
    }, /default success gate/);
  }

  test(`${file} accepts harmless formatting and explicit blocking settings`, () => {
    const workflow = load(source);
    for (const job of Object.values(workflow.jobs)) {
      job['continue-on-error'] = false;
      if (job.needs?.length === 1) job.needs = job.needs[0];
    }
    for (const step of workflow.jobs.typecheck.steps) {
      step['continue-on-error'] = false;
      if (step.run) step.run = `${step.run}\n`;
    }
    delete workflow.jobs.release.if;
    validate(workflow);
  });
}

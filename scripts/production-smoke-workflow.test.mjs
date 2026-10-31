import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';

for (const file of ['typecheck.yml', 'build-agent.yml', 'build-legacy.yml']) {
  test(`${file} gates builds on isolated production startup`, () => {
    const workflow = load(readFileSync(new URL(`../.github/workflows/${file}`, import.meta.url), 'utf8'));
    const job = workflow.jobs.typecheck;
    const commands = job.steps.map(step => step.run);
    const build = commands.indexOf('npm run build');
    const smoke = commands.indexOf('npm run test:production');
    assert.ok(build >= 0 && smoke > build, 'Smoke must run after the production build');
    assert.ok(commands.indexOf('npm run test:production:runner') > build);
    assert.ok(commands.some(command => command?.includes('apt-get install -y postgresql')));
    const step = job.steps[smoke];
    assert.equal(step.if, undefined);
    assert.equal(step['continue-on-error'], undefined);
    assert.equal(step.env, undefined, 'Smoke must not receive workflow credentials');
    if (file !== 'typecheck.yml') {
      for (const [name, releaseJob] of Object.entries(workflow.jobs)) {
        if (name.startsWith('build-')) {
          assert.ok([releaseJob.needs].flat().includes('typecheck'));
        }
      }
    }
  });
}

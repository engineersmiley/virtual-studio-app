import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';

const agent = JSON.parse(readFileSync(new URL('../virtual-studio-agent/package.json', import.meta.url), 'utf8'));
const downloadPage = readFileSync(new URL('../client/src/pages/RemoteControl.tsx', import.meta.url), 'utf8');
const workflow = load(readFileSync(new URL('../.github/workflows/build-agent.yml', import.meta.url), 'utf8'));
const macJob = workflow.jobs['build-mac'];
const releaseJob = workflow.jobs.release;
const releaseText = releaseJob.steps.find(step => step.name === 'Create Release').with.body;
const releaseFiles = releaseJob.steps.find(step => step.name === 'Create Release').with.files;

test('macOS agent builds native Apple Silicon and Intel installers', () => {
  assert.match(agent.scripts['build:mac'], /--arm64\s+--x64/);
  assert.equal(agent.build.mac.hardenedRuntime, true);
  assert.equal(agent.build.mac.entitlements, 'entitlements.mac.plist');
  assert.equal(agent.build.mac.entitlementsInherit, 'entitlements.mac.plist');
  const buildStep = macJob.steps.find(step => step.name === 'Build for macOS');
  assert.equal(buildStep.run, 'npm run build:mac');
});

test('tagged macOS releases require code signing and notarization credentials', () => {
  const credentialStep = macJob.steps.find(step => step.name === 'Require Apple signing and notarization credentials for releases');
  assert.ok(credentialStep, 'release signing credential gate must exist');
  assert.match(credentialStep.if, /refs\/tags/);
  for (const name of ['MACOS_CSC_LINK', 'MACOS_CSC_KEY_PASSWORD', 'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID']) {
    assert.ok(credentialStep.env[name], `${name} must be supplied from GitHub Actions secrets`);
  }
});

test('release version and Mac download links match the published artifacts', () => {
  assert.match(downloadPage, new RegExp(`const AGENT_VERSION = "${agent.version}"`));
  const renameStep = releaseJob.steps.find(step => step.name === 'Rename files for consistent download URLs');
  for (const filename of ['Virtual.Studio.Agent-arm64.dmg', 'Virtual.Studio.Agent-x64.dmg']) {
    assert.ok(downloadPage.includes(filename), `download page must link ${filename}`);
    assert.ok(releaseText.includes(filename), `release notes must list ${filename}`);
    assert.ok(releaseFiles.includes(`dist/${filename}`), `release must upload ${filename}`);
    assert.ok(renameStep.run.includes(filename), `release workflow must produce ${filename}`);
  }
});

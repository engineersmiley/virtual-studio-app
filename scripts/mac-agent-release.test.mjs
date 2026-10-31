import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';

const agent = JSON.parse(readFileSync(new URL('../virtual-studio-agent/package.json', import.meta.url), 'utf8'));
const downloadPage = readFileSync(new URL('../client/src/pages/RemoteControl.tsx', import.meta.url), 'utf8');
const homePage = readFileSync(new URL('../client/src/pages/Home.tsx', import.meta.url), 'utf8');
const downloadConfig = readFileSync(new URL('../client/src/lib/agent-downloads.ts', import.meta.url), 'utf8');
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
  assert.match(credentialStep.if, /!inputs\.publish_unsigned_macos/);
  for (const name of ['MACOS_CSC_LINK', 'MACOS_CSC_KEY_PASSWORD', 'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID']) {
    assert.ok(credentialStep.env[name], `${name} must be supplied from GitHub Actions secrets`);
  }
  assert.equal(workflow.on.workflow_dispatch.inputs.publish_unsigned_macos.type, 'boolean');
  assert.equal(workflow.on.workflow_dispatch.inputs.publish_unsigned_macos.default, false);
});

test('release version and Mac download links match the published artifacts', () => {
  assert.match(downloadConfig, new RegExp(`AGENT_VERSION = "${agent.version}"`));
  assert.match(downloadConfig, /CURRENT_AGENT_VERSION = "1\.20\.0"/);
  assert.match(downloadConfig, /macos-v\$\{AGENT_VERSION\}/);
  assert.match(downloadConfig, /Virtual\.Studio\.Agent-arm64\.dmg/);
  const renameStep = releaseJob.steps.find(step => step.name === 'Rename files for consistent download URLs');
  for (const filename of ['Virtual.Studio.Agent-arm64.dmg', 'Virtual.Studio.Agent-x64.dmg']) {
    assert.ok(downloadConfig.includes(filename), `shared download config must link ${filename}`);
    assert.ok(releaseText.includes(filename), `release notes must list ${filename}`);
    assert.ok(releaseFiles.includes(`dist/${filename}`), `release must upload ${filename}`);
    assert.ok(renameStep.run.includes(filename), `release workflow must produce ${filename}`);
  }
  assert.match(downloadConfig, /Remote\.Studio\.Agent\.dmg/);
  assert.match(downloadPage, /AGENT_DOWNLOAD_URLS as DOWNLOAD_URLS/);
  assert.match(downloadPage, /DOWNLOAD_URLS\.macCurrent/);
  assert.match(downloadPage, /section-mac-apple-silicon-download/);
  assert.match(downloadPage, /href=\{DOWNLOAD_URLS\.macAppleSilicon\}/);
  assert.match(downloadPage, /button-download-agent-mac-apple-silicon/);
  assert.doesNotMatch(downloadPage, /button-download-agent-mac-apple-silicon-pending|This installer is not published yet/);
  assert.match(downloadPage, /unsigned and not notarized/i);
  assert.doesNotMatch(homePage, /section-apple-silicon-download/);
  assert.match(releaseText, /If this release was manually built without Apple signing/);
});

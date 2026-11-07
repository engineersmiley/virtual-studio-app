import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';

const agent = JSON.parse(readFileSync(new URL('../virtual-studio-agent/package.json', import.meta.url), 'utf8'));
const downloadPage = readFileSync(new URL('../client/src/pages/RemoteControl.tsx', import.meta.url), 'utf8');
const homePage = readFileSync(new URL('../client/src/pages/Home.tsx', import.meta.url), 'utf8');
const downloadConfig = readFileSync(new URL('../client/src/lib/agent-downloads.ts', import.meta.url), 'utf8');
const workflow = load(readFileSync(new URL('../.github/workflows/build-agent.yml', import.meta.url), 'utf8'));
const windowsWorkflow = load(readFileSync(new URL('../.github/workflows/build-agent-windows.yml', import.meta.url), 'utf8'));
const macJob = workflow.jobs['build-mac'];
const releaseJob = workflow.jobs.release;
const releaseText = releaseJob.steps.find(step => step.name === 'Create Release').with.body;
const releaseFiles = releaseJob.steps.find(step => step.name === 'Create Release').with.files;
const windowsJob = windowsWorkflow.jobs['build-and-release'];

test('macOS agent builds native Apple Silicon and Intel installers', () => {
  assert.match(agent.scripts['build:mac'], /--arm64\s+--x64/);
  assert.equal(agent.build.mac.hardenedRuntime, true);
  assert.equal(agent.build.mac.entitlements, 'entitlements.mac.plist');
  assert.equal(agent.build.mac.entitlementsInherit, 'entitlements.mac.plist');
  const buildStep = macJob.steps.find(step => step.name === 'Build for macOS');
  assert.equal(buildStep.run, 'npm run build:mac');
});

test('tagged macOS releases allow unsigned builds only when all signing credentials are absent', () => {
  const credentialStep = macJob.steps.find(step => step.name === 'Require Apple signing and notarization credentials for releases');
  assert.ok(credentialStep, 'release signing credential gate must exist');
  assert.match(credentialStep.if, /refs\/tags/);
  assert.match(credentialStep.if, /workflow_dispatch/);
  assert.match(credentialStep.if, /!inputs\.publish_unsigned_macos/);
  for (const name of ['MACOS_CSC_LINK', 'MACOS_CSC_KEY_PASSWORD', 'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID']) {
    assert.ok(credentialStep.env[name], `${name} must be supplied from GitHub Actions secrets`);
  }
  assert.match(credentialStep.run, /"\$\{#missing\[@\]\}" -eq 5/);
  assert.match(credentialStep.run, /No Apple signing credentials are configured; continuing with unsigned Mac installers/);
  assert.match(credentialStep.run, /Missing GitHub Actions secrets required for a signed macOS release/);
  assert.equal(workflow.on.workflow_dispatch.inputs.release_tag.type, 'string');
  assert.equal(workflow.on.workflow_dispatch.inputs.release_tag.required, true);
  assert.equal(workflow.on.workflow_dispatch.inputs.publish_unsigned_macos.type, 'boolean');
  assert.equal(workflow.on.workflow_dispatch.inputs.publish_unsigned_macos.default, false);
});

test('release version and Mac download links match the published artifacts', () => {
  assert.match(downloadConfig, new RegExp(`AGENT_VERSION = "${agent.version}"`));
  assert.match(downloadConfig, /WINDOWS_AGENT_VERSION = AGENT_VERSION/);
  assert.match(downloadConfig, /CURRENT_AGENT_VERSION = AGENT_VERSION/);
  assert.match(downloadConfig, /MAC_AGENT_VERSION = AGENT_VERSION/);
  assert.match(downloadConfig, /CURRENT_RELEASE_BASE = `\$\{RELEASE_DOWNLOAD_BASE\}\/v\$\{CURRENT_AGENT_VERSION\}`/);
  assert.match(downloadConfig, /windows: `\$\{CURRENT_RELEASE_BASE\}\/Virtual\.Studio\.Agent\.Setup\.exe`/);
  assert.match(downloadConfig, /macAppleSilicon: `\$\{CURRENT_RELEASE_BASE\}\/Virtual\.Studio\.Agent-arm64\.dmg`/);
  assert.match(downloadConfig, /macIntel: `\$\{CURRENT_RELEASE_BASE\}\/Virtual\.Studio\.Agent-x64\.dmg`/);
  assert.match(downloadConfig, /linux: `\$\{CURRENT_RELEASE_BASE\}\/Virtual\.Studio\.Agent\.AppImage`/);
  const renameStep = releaseJob.steps.find(step => step.name === 'Rename files for consistent download URLs');
  for (const filename of ['Virtual.Studio.Agent-arm64.dmg', 'Virtual.Studio.Agent-x64.dmg']) {
    assert.ok(releaseText.includes(filename), `release notes must list ${filename}`);
    assert.ok(releaseFiles.includes(`dist/${filename}`), `release must upload ${filename}`);
    assert.ok(renameStep.run.includes(filename), `release workflow must produce ${filename}`);
  }
  assert.doesNotMatch(downloadConfig, /v\$\{MAC_AGENT_VERSION\}-arm64|Remote\.Studio\.Agent\.dmg/);
  assert.match(downloadPage, /Mac Intel/);
  assert.match(downloadPage, /v\{MAC_AGENT_VERSION\}/);
  assert.match(downloadPage, /AGENT_DOWNLOAD_URLS as DOWNLOAD_URLS/);
  assert.match(downloadPage, /DOWNLOAD_URLS\.macCurrent/);
  assert.match(downloadPage, /section-mac-apple-silicon-download/);
  assert.match(downloadPage, /href=\{DOWNLOAD_URLS\.macAppleSilicon\}/);
  assert.match(downloadPage, /button-download-agent-mac-apple-silicon/);
  assert.doesNotMatch(downloadPage, /button-download-agent-mac-apple-silicon-pending|This installer is not published yet/);
  assert.match(downloadPage, /unsigned and not notarized/i);
  assert.match(downloadPage, /APPLE_SILICON_GATEKEEPER_COMMAND/);
  assert.match(downloadPage, /xattr -dr com\.apple\.quarantine/);
  assert.match(downloadPage, /button-copy-mac-quarantine-command/);
  assert.match(downloadPage, /drag Virtual Studio Agent into Applications/);
  assert.match(downloadPage, /Open Terminal/);
  assert.doesNotMatch(homePage, /section-apple-silicon-download/);
  assert.match(releaseText, /Mac installers are unsigned unless Apple signing and notarization credentials are configured/);
  assert.match(releaseText, /follow the Gatekeeper instructions on the download page/);
});

test('Windows installer path uses the same Agent release version', () => {
  assert.deepEqual(windowsWorkflow.on.push.tags, ['windows-v*']);
  assert.equal(windowsWorkflow.on.workflow_dispatch.inputs.release_tag.default, `windows-v${agent.version}`);
  assert.equal(windowsJob['runs-on'], 'windows-latest');
  assert.ok(windowsJob.steps.some(step => step.name === 'Build Windows installer'
    && step.run === 'npm run build:win'));
  const publish = windowsJob.steps.find(step => step.name === 'Publish Windows Agent release');
  assert.equal(publish.uses, 'softprops/action-gh-release@v1');
  assert.equal(publish.with.files, 'virtual-studio-agent/dist/Virtual.Studio.Agent.Setup.exe');
  assert.match(publish.with.body, /cursor-only alignment test/i);
  assert.equal(windowsWorkflow.permissions.contents, 'write');
});

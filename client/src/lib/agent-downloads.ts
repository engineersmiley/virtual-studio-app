export const AGENT_VERSION = "1.20.1";
export const CURRENT_AGENT_VERSION = "1.20.0";
export const LEGACY_AGENT_VERSION = "1.20.0";

const RELEASE_DOWNLOAD_BASE = "https://github.com/engineersmiley/virtual-studio-app/releases/download";
const CURRENT_RELEASE_BASE = `${RELEASE_DOWNLOAD_BASE}/v${CURRENT_AGENT_VERSION}`;
const NEXT_RELEASE_BASE = `${RELEASE_DOWNLOAD_BASE}/v${AGENT_VERSION}`;

export const AGENT_DOWNLOAD_URLS = {
  windows: `${CURRENT_RELEASE_BASE}/Remote.Studio.Agent.Setup.exe`,
  macCurrent: `${CURRENT_RELEASE_BASE}/Remote.Studio.Agent.dmg`,
  macAppleSilicon: `${NEXT_RELEASE_BASE}/Virtual.Studio.Agent-arm64.dmg`,
  macIntel: `${NEXT_RELEASE_BASE}/Virtual.Studio.Agent-x64.dmg`,
  linux: `${CURRENT_RELEASE_BASE}/Remote.Studio.Agent.AppImage`,
  macLegacy: `${RELEASE_DOWNLOAD_BASE}/legacy-v${LEGACY_AGENT_VERSION}/Remote.Studio.Agent.Legacy.zip`,
};

export const AGENT_VERSION = "1.20.1";
export const LEGACY_AGENT_VERSION = "1.20.0";

const RELEASE_DOWNLOAD_BASE = "https://github.com/engineersmiley/virtual-studio-app/releases/download";

export const AGENT_DOWNLOAD_URLS = {
  windows: `${RELEASE_DOWNLOAD_BASE}/v${AGENT_VERSION}/Virtual.Studio.Agent.Setup.exe`,
  macAppleSilicon: `${RELEASE_DOWNLOAD_BASE}/v${AGENT_VERSION}/Virtual.Studio.Agent-arm64.dmg`,
  macIntel: `${RELEASE_DOWNLOAD_BASE}/v${AGENT_VERSION}/Virtual.Studio.Agent-x64.dmg`,
  linux: `${RELEASE_DOWNLOAD_BASE}/v${AGENT_VERSION}/Virtual.Studio.Agent.AppImage`,
  macLegacy: `${RELEASE_DOWNLOAD_BASE}/legacy-v${LEGACY_AGENT_VERSION}/Remote.Studio.Agent.Legacy.zip`,
};

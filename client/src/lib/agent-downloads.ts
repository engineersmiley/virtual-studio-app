export const AGENT_VERSION = "1.20.4";
export const WINDOWS_AGENT_VERSION = AGENT_VERSION;
export const MAC_AGENT_VERSION = "1.20.1";
export const CURRENT_AGENT_VERSION = "1.20.0";
export const LEGACY_AGENT_VERSION = "1.20.0";

const RELEASE_DOWNLOAD_BASE = "https://github.com/engineersmiley/virtual-studio-app/releases/download";
const PREVIOUS_RELEASE_BASE = `${RELEASE_DOWNLOAD_BASE}/v${LEGACY_AGENT_VERSION}`;
const MAC_RELEASE_BASE = `${RELEASE_DOWNLOAD_BASE}/v${MAC_AGENT_VERSION}`;
const APPLE_SILICON_RELEASE_BASE = `${RELEASE_DOWNLOAD_BASE}/macos-v${MAC_AGENT_VERSION}`;
// Windows-only releases use a separate tag and installer name.
const WINDOWS_RELEASE_BASE = `${RELEASE_DOWNLOAD_BASE}/windows-v${WINDOWS_AGENT_VERSION}`;

export const AGENT_DOWNLOAD_URLS = {
  windows: `${WINDOWS_RELEASE_BASE}/Virtual.Studio.Agent.Setup.exe`,
  macCurrent: `${PREVIOUS_RELEASE_BASE}/Remote.Studio.Agent.dmg`,
  macAppleSilicon: `${APPLE_SILICON_RELEASE_BASE}/Virtual.Studio.Agent-arm64.dmg`,
  macIntel: `${MAC_RELEASE_BASE}/Virtual.Studio.Agent-x64.dmg`,
  linux: `${PREVIOUS_RELEASE_BASE}/Remote.Studio.Agent.AppImage`,
  macLegacy: `${RELEASE_DOWNLOAD_BASE}/legacy-v${LEGACY_AGENT_VERSION}/Remote.Studio.Agent.Legacy.zip`,
};

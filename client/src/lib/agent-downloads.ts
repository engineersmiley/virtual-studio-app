export const AGENT_VERSION = "1.20.7";
export const WINDOWS_AGENT_VERSION = AGENT_VERSION;
export const MAC_AGENT_VERSION = AGENT_VERSION;
export const CURRENT_AGENT_VERSION = AGENT_VERSION;
export const LEGACY_AGENT_VERSION = "1.20.0";

const RELEASE_DOWNLOAD_BASE = "https://github.com/engineersmiley/virtual-studio-app/releases/download";
const CURRENT_RELEASE_BASE = `${RELEASE_DOWNLOAD_BASE}/v${CURRENT_AGENT_VERSION}`;
const MAC_RELEASE_BASE = `${RELEASE_DOWNLOAD_BASE}/v${MAC_AGENT_VERSION}`;
const APPLE_SILICON_RELEASE_BASE = `${RELEASE_DOWNLOAD_BASE}/v${MAC_AGENT_VERSION}-arm64`;
// Architecture-specific release tags avoid the historical workflow overwriting
// one Mac architecture with the other under the same DMG filename.
const WINDOWS_RELEASE_BASE = `${RELEASE_DOWNLOAD_BASE}/v${WINDOWS_AGENT_VERSION}`;

export const AGENT_DOWNLOAD_URLS = {
  windows: `${WINDOWS_RELEASE_BASE}/Remote.Studio.Agent.Setup.exe`,
  macCurrent: `${MAC_RELEASE_BASE}/Remote.Studio.Agent.dmg`,
  macAppleSilicon: `${APPLE_SILICON_RELEASE_BASE}/Remote.Studio.Agent.dmg`,
  macIntel: `${MAC_RELEASE_BASE}/Remote.Studio.Agent.dmg`,
  linux: `${CURRENT_RELEASE_BASE}/Remote.Studio.Agent.AppImage`,
  macLegacy: `${RELEASE_DOWNLOAD_BASE}/legacy-v${LEGACY_AGENT_VERSION}/Remote.Studio.Agent.Legacy.zip`,
};

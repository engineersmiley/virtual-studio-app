const ACTIVE_CONTROL_INTERVAL_MS = 16;
const IDLE_POLL_INTERVAL_MS = 500;

function getAgentPollCadence(controlEnabled) {
  return {
    timerIntervalMs: ACTIVE_CONTROL_INTERVAL_MS,
    minimumRequestIntervalMs: controlEnabled ? ACTIVE_CONTROL_INTERVAL_MS : IDLE_POLL_INTERVAL_MS,
  };
}

module.exports = { getAgentPollCadence };

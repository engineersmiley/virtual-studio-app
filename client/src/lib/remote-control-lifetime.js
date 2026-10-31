// Pending input belongs to one authorization lifetime, never to the next grant.
export function createRemoteControlLifetime() {
  let allowed = false;
  let generation = 0;
  const timers = new Map();

  function cancel(group) {
    for (const [timer, owner] of timers) {
      if (group === undefined || owner === group) {
        clearTimeout(timer);
        timers.delete(timer);
      }
    }
  }

  return {
    isAllowed: () => allowed,
    setAllowed(next) {
      if (!next || next !== allowed) {
        generation++;
        cancel();
      }
      allowed = next;
    },
    cancel,
    schedule(group, callback, delay) {
      if (!allowed) return;
      const scheduledGeneration = generation;
      const timer = setTimeout(() => {
        // Also reject callbacks already queued by the browser when canceled.
        if (!timers.has(timer)) return;
        timers.delete(timer);
        if (allowed && generation === scheduledGeneration) callback();
      }, delay);
      timers.set(timer, group);
    },
  };
}

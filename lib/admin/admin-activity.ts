const ACTIVITY_EVENTS = new Set(["pointerdown", "keydown", "wheel", "touchstart"]);
const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta"]);

interface ActivityInput {
  type: string;
  isTrusted: boolean;
  key?: string;
}

/** A timer/focus/fetch never supplies activity; only successful acknowledgements throttle input. */
export function createAdminActivityTracker({
  touch,
  eligible,
  now = Date.now,
  throttleMs = 60_000,
}: {
  touch: () => Promise<boolean>;
  eligible: () => boolean;
  now?: () => number;
  throttleMs?: number;
}) {
  let stopped = false;
  let pending = false;
  let lastAcknowledged = -Infinity;
  return {
    stop() { stopped = true; },
    async input(event: ActivityInput): Promise<void> {
      if (stopped || pending || !eligible() || !event.isTrusted || !ACTIVITY_EVENTS.has(event.type)) return;
      if (event.type === "keydown" && MODIFIER_KEYS.has(event.key ?? "")) return;
      if (now() - lastAcknowledged < throttleMs) return;
      pending = true;
      try {
        if (await touch()) lastAcknowledged = now();
      } catch {
        // No acknowledgement means the next real input can retry. Never invent
        // periodic activity or extend a rejected session in browser state.
      } finally {
        pending = false;
      }
    },
  };
}

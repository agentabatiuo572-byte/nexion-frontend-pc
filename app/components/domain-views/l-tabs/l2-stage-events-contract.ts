import { readL2LiveStages } from "./l1-l2-live-data.ts";

type L2StageEventContract = {
  primary: string;
  fallback?: {
    event: string;
    occurrence: 2;
  };
};

export const L2_STAGE_EVENT_CONTRACT = [
  { primary: "auth.register_completed" },
  { primary: "kyc.express_verified" },
  { primary: "checkout.completed" },
  {
    primary: "wallet.reinvest",
    fallback: { event: "checkout.completed", occurrence: 2 },
  },
  { primary: "withdraw.submitted" },
] as const satisfies readonly L2StageEventContract[];

export const L2_STAGE_QUERY_EVENTS = L2_STAGE_EVENT_CONTRACT.map(({ primary }) => primary);

function responseEvent(contract: L2StageEventContract): string {
  return contract.fallback
    ? `${contract.primary} / 二次 ${contract.fallback.event}`
    : contract.primary;
}

export function isCanonicalL2StageEvents(raw: unknown): boolean {
  return Array.isArray(raw)
    && raw.length === L2_STAGE_EVENT_CONTRACT.length
    && raw.every((event, index) => typeof event === "string"
      && event === responseEvent(L2_STAGE_EVENT_CONTRACT[index]));
}

export function validateL2FunnelEventBindings(funnel: unknown, stageEvents: unknown): boolean {
  if (!isCanonicalL2StageEvents(stageEvents) || !Array.isArray(funnel)
    || funnel.length !== L2_STAGE_EVENT_CONTRACT.length) return false;
  return funnel.every((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const row = item as Record<string, unknown>;
    const expected = responseEvent(L2_STAGE_EVENT_CONTRACT[index]);
    return row.ev === expected && row.source === `nx_event_outbox:${expected}`;
  });
}

export function validateL2LifecycleContract(raw: unknown): boolean {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const data = raw as Record<string, unknown>;
  if (!Array.isArray(data.stages) || data.stages.length !== 6) return false;
  const strictTypes = data.stages.every((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const stage = item as Record<string, unknown>;
    return typeof stage.key === "string"
      && typeof stage.source === "string"
      && typeof stage.count === "number"
      && Number.isSafeInteger(stage.count)
      && stage.count >= 0;
  });
  return strictTypes
    && readL2LiveStages(data).length === 6
    && isCanonicalL2StageEvents(data.stageEvents);
}

import { formatAdminApiError } from "@/lib/admin/error-messages";
import { currentAdminOperator } from "@/lib/admin/current-operator";

interface ApiResult<T> {
  code: number;
  message?: string;
  data?: T;
}

export type H1RhythmParamKey = "totalMonths" | "currentMonth" | "phaseProgressPct";

export interface H1RhythmOverview {
  totalMonths: number;
  currentMonth: number;
  currentPhase: string;
  phaseProgressPct: number;
  options: number[];
  sources: string[];
}

let requestSeq = 0;

function nextIdempotencyKey(prefix: string) {
  requestSeq += 1;
  return `${prefix}-${Date.now()}-${requestSeq}`;
}

function numberValue(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function requiredNumber(value: unknown, field: string) {
  const n = numberValue(value);
  if (n == null) throw new Error(`H1 后端数据缺少字段:${field}`);
  return n;
}

function clampInt(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function normalizeRhythm(raw?: Record<string, unknown> | null): H1RhythmOverview {
  if (!raw) throw new Error("H1 后端未返回节奏数据");
  const rawOptions = Array.isArray(raw?.options) ? raw.options : [];
  const options = rawOptions.map((item) => Number(item)).filter((item) => Number.isFinite(item));
  const totalMonths = Math.max(1, Math.round(requiredNumber(raw.totalMonths, "totalMonths")));
  const rawCurrentMonth = requiredNumber(raw.currentMonth, "currentMonth");
  const rawPhaseProgress = requiredNumber(raw.phaseProgressPct, "phaseProgressPct");
  const currentPhase = typeof raw.currentPhase === "string" && raw.currentPhase.trim()
    ? raw.currentPhase.trim()
    : null;
  if (!currentPhase) throw new Error("H1 后端数据缺少字段:currentPhase");
  return {
    totalMonths,
    currentMonth: clampInt(rawCurrentMonth, 1, totalMonths),
    currentPhase,
    phaseProgressPct: rawPhaseProgress == null ? 0 : clampInt(rawPhaseProgress, 0, 100),
    options,
    sources: Array.isArray(raw?.sources) ? raw.sources.map(String) : [],
  };
}

async function growthRequest<T>(path: string, init?: RequestInit, idempotencyPrefix?: string): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (idempotencyPrefix && !headers.has("Idempotency-Key")) {
    headers.set("Idempotency-Key", nextIdempotencyKey(idempotencyPrefix));
  }

  const response = await fetch(`/api/admin/growth${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });
  const result = (await response.json()) as ApiResult<T>;
  if (!response.ok || result.code !== 0) {
    throw new Error(formatAdminApiError(result.message, `GROWTH_REQUEST_FAILED_${response.status}`));
  }
  return result.data as T;
}

function commandBody(key: string, value: string | number | boolean, reason: string, operator = currentAdminOperator()) {
  return JSON.stringify({ key, value: String(value), reason, operator: operator || currentAdminOperator() });
}

export async function fetchH1Rhythm(): Promise<H1RhythmOverview> {
  return normalizeRhythm(await growthRequest<Record<string, unknown>>("/rhythm"));
}

export async function fetchH1Phases(): Promise<Record<string, any>> {
  const data = await growthRequest<Record<string, any>>("/phases");
  return { ...data, rhythm: normalizeRhythm(data.rhythm) };
}

export async function updateH1RhythmParam(
  key: H1RhythmParamKey,
  value: string | number,
  reason: string,
  operator = currentAdminOperator(),
): Promise<H1RhythmOverview> {
  return normalizeRhythm(
    await growthRequest<Record<string, unknown>>(
      `/rhythm/${key}`,
      { method: "PATCH", body: commandBody(key, value, reason, operator) },
      "h1-rhythm",
    ),
  );
}

export async function updateH1MonthDial(month: number, key: string, value: string | number, reason: string) {
  return fetchH1PhaseMutation(`/phases/months/${month}/dials/${encodeURIComponent(key)}`, key, value, reason, "h1-month-dial");
}

export async function updateH1Control(key: string, value: string, reason: string) {
  return fetchH1PhaseMutation(`/phases/controls/${encodeURIComponent(key)}`, key, value, reason, "h1-control");
}

export async function updateH1Override(id: string, disabled: boolean, reason: string) {
  return fetchH1PhaseMutation(`/phases/overrides/${encodeURIComponent(id)}`, "disabled", disabled, reason, "h1-override");
}

async function fetchH1PhaseMutation(path: string, key: string, value: string | number | boolean, reason: string, idempotency: string) {
  const data = await growthRequest<Record<string, any>>(
    path,
    { method: "PATCH", body: commandBody(key, value, reason) },
    idempotency,
  );
  return { ...data, rhythm: normalizeRhythm(data.rhythm) };
}

export async function fetchH2Trials(): Promise<Record<string, any>> {
  return growthRequest<Record<string, any>>("/trials");
}

export async function updateH2TrialParam(key: string, value: string, reason: string) {
  return growthRequest<Record<string, any>>(
    `/trials/params/${encodeURIComponent(key)}`,
    { method: "PATCH", body: commandBody(key, value, reason) },
    "h2-param",
  );
}

export async function cancelH2TrialSession(sessionId: string, reason: string) {
  return growthRequest<Record<string, any>>(
    `/trials/sessions/${encodeURIComponent(sessionId)}/cancel`,
    { method: "POST", body: commandBody("cancel", "cancelled", reason) },
    "h2-cancel",
  );
}

export async function chargeH2TrialSession(sessionId: string, reason: string) {
  return growthRequest<Record<string, any>>(
    `/trials/sessions/${encodeURIComponent(sessionId)}/charge`,
    { method: "POST", body: commandBody("charge", "redeemed", reason) },
    "h2-charge",
  );
}

export async function killH2AutoPush(reason: string) {
  return growthRequest<Record<string, any>>(
    "/trials/auto-push/kill",
    { method: "POST", body: commandBody("autoPushKilled", "true", reason) },
    "h2-auto-push",
  );
}

export async function fetchH3QuestEvents(): Promise<Record<string, any>> {
  return growthRequest<Record<string, any>>("/quest-events");
}

export async function updateH3QuestConfig(key: string, value: string, reason: string) {
  return growthRequest<Record<string, any>>(
    `/quest-events/config/${encodeURIComponent(key)}`,
    { method: "PATCH", body: commandBody(key, value, reason) },
    "h3-config",
  );
}

export async function updateH4EventReward(eventId: string, value: string, reason: string) {
  return h4EventMutation(eventId, "reward", value, reason);
}

export async function updateH4EventStatus(eventId: string, value: string, reason: string) {
  return h4EventMutation(eventId, "status", value, reason);
}

export async function updateH4EventFeatured(eventId: string, value: boolean, reason: string) {
  return h4EventMutation(eventId, "featured", value, reason);
}

async function h4EventMutation(eventId: string, field: string, value: string | boolean, reason: string) {
  return growthRequest<Record<string, any>>(
    `/quest-events/events/${encodeURIComponent(eventId)}/${field}`,
    { method: "PATCH", body: commandBody(field, value, reason) },
    `h4-${field}`,
  );
}

export async function fetchH5CheckIn(): Promise<Record<string, any>> {
  return growthRequest<Record<string, any>>("/check-in");
}

export async function updateH5CheckInRule(key: string, value: string, reason: string) {
  return growthRequest<Record<string, any>>(
    `/check-in/rules/${encodeURIComponent(key)}`,
    { method: "PATCH", body: commandBody(key, value, reason) },
    "h5-rule",
  );
}

export async function updateH5StreakMilestone(id: number, value: string, reason: string) {
  return growthRequest<Record<string, any>>(
    `/check-in/streak-milestones/${id}`,
    { method: "PATCH", body: commandBody("reward", value, reason) },
    "h5-streak",
  );
}

export async function updateH5PowerUp(id: number, key: "day" | "note", value: string, reason: string) {
  return growthRequest<Record<string, any>>(
    `/check-in/power-ups/${id}`,
    { method: "PATCH", body: commandBody(key, value, reason) },
    "h5-power",
  );
}

export async function updateH5EarnMilestone(key: string, thresholdUsd: string | number, rewardNex: string | number, reason: string) {
  return growthRequest<Record<string, any>>(
    `/earn-milestones/${encodeURIComponent(key)}`,
    {
      method: "PATCH",
      body: JSON.stringify({ thresholdUsd: Number(thresholdUsd), rewardNex: Number(rewardNex), reason, operator: currentAdminOperator() }),
    },
    "h5-earn",
  );
}

export async function updateH5EarnTickInterval(value: string | number, reason: string) {
  return growthRequest<Record<string, any>>(
    "/earn-milestones/tick-interval",
    { method: "PATCH", body: commandBody("tick", value, reason) },
    "h5-earn-tick",
  );
}

export async function fetchH7Vouchers(): Promise<Record<string, any>> {
  return growthRequest<Record<string, any>>("/vouchers");
}

export async function createH7Voucher(voucher: Record<string, any>, reason: string) {
  return growthRequest<Record<string, any>>(
    "/vouchers",
    { method: "POST", body: JSON.stringify({ ...voucher, reason, operator: currentAdminOperator() }) },
    "h7-create",
  );
}

export async function updateH7Voucher(id: string, voucher: Record<string, any>, reason: string) {
  return growthRequest<Record<string, any>>(
    `/vouchers/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify({ ...voucher, id, reason, operator: currentAdminOperator() }) },
    "h7-update",
  );
}

export async function updateH7VoucherStatus(id: string, status: "active" | "paused", reason: string) {
  return growthRequest<Record<string, any>>(
    `/vouchers/${encodeURIComponent(id)}/status`,
    { method: "PATCH", body: commandBody("status", status, reason) },
    "h7-status",
  );
}

export async function deleteH7Voucher(id: string, reason: string) {
  return growthRequest<Record<string, any>>(
    `/vouchers/${encodeURIComponent(id)}`,
    { method: "DELETE", body: commandBody("delete", "delete", reason) },
    "h7-delete",
  );
}

// ===== H3/H4 业务实体创建(后端 POST /growth/quest-events/*) =====

export async function createH3Mission(mission: Record<string, any>, reason: string) {
  return growthRequest<Record<string, any>>(
    "/quest-events/missions",
    { method: "POST", body: JSON.stringify({ ...mission, reason, operator: currentAdminOperator() }) },
    "h3-mission-create",
  );
}

export async function createH3MonthlyMission(mission: Record<string, any>, reason: string) {
  return growthRequest<Record<string, any>>(
    "/quest-events/monthly-missions",
    { method: "POST", body: JSON.stringify({ ...mission, reason, operator: currentAdminOperator() }) },
    "h3-monthly-create",
  );
}

export async function createH4QuestEvent(event: Record<string, any>, reason: string) {
  return growthRequest<Record<string, any>>(
    "/quest-events/events",
    { method: "POST", body: JSON.stringify({ ...event, reason, operator: currentAdminOperator() }) },
    "h4-event-create",
  );
}

export async function createH4WheelTier(tier: Record<string, any>, reason: string) {
  return growthRequest<Record<string, any>>(
    "/quest-events/wheel-tiers",
    { method: "POST", body: JSON.stringify({ ...tier, reason, operator: currentAdminOperator() }) },
    "h4-tier-create",
  );
}

export async function createH4WheelGuard(guard: Record<string, any>, reason: string) {
  return growthRequest<Record<string, any>>(
    "/quest-events/wheel-guards",
    { method: "POST", body: JSON.stringify({ ...guard, reason, operator: currentAdminOperator() }) },
    "h4-guard-create",
  );
}

export type MTicketAssigneeCandidate = {
  adminId: number;
  name: string;
};

export type MSupportAgentFailureKind = "none" | "auth" | "permission" | "malformed" | "unavailable";

export type M1SupportAgentOverviewPayload = {
  agents: Record<string, unknown>[];
  advisorAssignments: Record<string, unknown>[];
  transferTargets: Record<string, unknown>[];
};

export class MContentReadError extends Error {
  readonly status: number;
  readonly apiCode: number | undefined;
  readonly backendMessage: string | undefined;

  constructor(
    status: number,
    apiCode: number | undefined,
    backendMessage: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = "MContentReadError";
    this.status = status;
    this.apiCode = apiCode;
    this.backendMessage = backendMessage;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isPositiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isStringArray(value: unknown, allowEmpty: boolean): value is string[] {
  return Array.isArray(value)
    && (allowEmpty || value.length > 0)
    && value.every((item) => isNonEmptyString(item));
}

function isM1ServiceTypes(value: unknown): value is string[] {
  return isStringArray(value, false)
    && value.every((item) => item === "support" || item === "advisor")
    && new Set(value).size === value.length;
}

function m1OverviewMalformed(): never {
  throw new Error("M1_SUPPORT_AGENT_OVERVIEW_MALFORMED");
}

export function parseM1SupportAgentOverview(value: unknown): M1SupportAgentOverviewPayload {
  if (!isRecord(value)
    || !Array.isArray(value.agents)
    || !Array.isArray(value.advisorAssignments)
    || !Array.isArray(value.transferTargets)) {
    return m1OverviewMalformed();
  }
  const agents = value.agents;
  if (!agents.every((agentValue) => {
    if (!isRecord(agentValue) || !isPositiveSafeInteger(agentValue.adminId)) return false;
    const adminId = agentValue.adminId;
    return agentValue.id === String(adminId)
      && isNonEmptyString(agentValue.name)
      && typeof agentValue.email === "string"
      && isNonEmptyString(agentValue.adminRole)
      && isNonEmptyString(agentValue.status)
      && (agentValue.seatType === "MANAGER" || agentValue.seatType === "DEDICATED" || agentValue.seatType === "GENERAL")
      && isNonEmptyString(agentValue.position)
      && isM1ServiceTypes(agentValue.serviceTypes)
      && isStringArray(agentValue.tags, true)
      && isPositiveSafeInteger(agentValue.maxConcurrent)
      && typeof agentValue.enabled === "boolean"
      && typeof agentValue.transferable === "boolean"
      && typeof agentValue.busy === "boolean"
      && isNonNegativeSafeInteger(agentValue.assignedUserCount)
      && isPositiveSafeInteger(agentValue.version)
      && isNonEmptyString(agentValue.updatedAt);
  })) return m1OverviewMalformed();

  const agentIds = agents.map((agent) => Number(agent.adminId));
  if (new Set(agentIds).size !== agents.length) {
    return m1OverviewMalformed();
  }
  const agentsById = new Map(agentIds.map((adminId, index) => [adminId, agents[index]]));

  const assignments = value.advisorAssignments;
  if (!assignments.every((assignment) => isRecord(assignment)
    && isPositiveSafeInteger(assignment.id)
    && isPositiveSafeInteger(assignment.agentAdminId)
    && agentsById.has(assignment.agentAdminId)
    && isPositiveSafeInteger(assignment.userId)
    && isNonEmptyString(assignment.status))) {
    return m1OverviewMalformed();
  }
  if (new Set(assignments.map((assignment) => assignment.id)).size !== assignments.length) {
    return m1OverviewMalformed();
  }

  const targets = value.transferTargets;
  if (!targets.every((target) => {
    if (!isRecord(target)
      || target.targetType !== "agent"
      || !isNonEmptyString(target.targetId)
      || !/^\d+$/.test(target.targetId)
      || !isNonEmptyString(target.targetName)
      || !isNonEmptyString(target.position)
      || !isM1ServiceTypes(target.serviceTypes)) return false;
    const agent = agentsById.get(Number(target.targetId));
    return Boolean(agent)
      && agent!.enabled === true
      && agent!.transferable === true
      && target.targetName === agent!.name
      && target.position === agent!.position
      && JSON.stringify(target.serviceTypes) === JSON.stringify(agent!.serviceTypes);
  })) return m1OverviewMalformed();
  const expectedTargetIds = agents
    .filter((agent) => agent.enabled === true && agent.transferable === true)
    .map((agent) => String(agent.adminId));
  const targetIds = targets.map((target) => String(target.targetId));
  if (new Set(targetIds).size !== targets.length
    || expectedTargetIds.length !== targetIds.length
    || expectedTargetIds.some((id) => !targetIds.includes(id))) {
    return m1OverviewMalformed();
  }
  return { agents, advisorAssignments: assignments, transferTargets: targets };
}

export function parseMContentApiEnvelope<T>(status: number, text: string, requireData: boolean): T {
  const httpOk = status >= 200 && status < 300;
  let rawPayload: unknown;
  try {
    rawPayload = text ? JSON.parse(text) : null;
  } catch {
    if (!httpOk) throw new MContentReadError(status, undefined, undefined, `CONTENT_API_${status}`);
    throw new Error("CONTENT_API_MALFORMED_RESPONSE");
  }
  if (!isRecord(rawPayload)) {
    if (!httpOk) throw new MContentReadError(status, undefined, undefined, `CONTENT_API_${status}`);
    throw new Error("CONTENT_API_MALFORMED_RESPONSE");
  }
  const code = Number.isSafeInteger(rawPayload.code) ? Number(rawPayload.code) : undefined;
  const backendMessage = typeof rawPayload.message === "string" ? rawPayload.message : undefined;
  if (!httpOk || (code !== undefined && code >= 400)) {
    throw new MContentReadError(status, code, backendMessage, `CONTENT_API_${status}`);
  }
  if (code !== 0 || (requireData && !Object.prototype.hasOwnProperty.call(rawPayload, "data"))) {
    throw new Error("CONTENT_API_MALFORMED_RESPONSE");
  }
  return rawPayload.data as T;
}

export function parseTicketAssigneeCandidates(value: unknown): MTicketAssigneeCandidate[] {
  if (!Array.isArray(value)) throw new Error("M2_TICKET_ASSIGNEE_CANDIDATES_MALFORMED");
  const candidates = value.map((valueRow) => {
    if (!valueRow || typeof valueRow !== "object" || Array.isArray(valueRow)) {
      throw new Error("M2_TICKET_ASSIGNEE_CANDIDATES_MALFORMED");
    }
    const row = valueRow as Record<string, unknown>;
    const keys = Object.keys(row);
    if (keys.length !== 2 || keys.some((key) => key !== "adminId" && key !== "name")) {
      throw new Error("M2_TICKET_ASSIGNEE_CANDIDATES_MALFORMED");
    }
    if (!Number.isSafeInteger(row.adminId) || Number(row.adminId) <= 0
      || typeof row.name !== "string" || row.name.trim().length === 0) {
      throw new Error("M2_TICKET_ASSIGNEE_CANDIDATES_MALFORMED");
    }
    return { adminId: Number(row.adminId), name: row.name.trim() };
  });
  if (new Set(candidates.map((candidate) => candidate.adminId)).size !== candidates.length) {
    throw new Error("M2_TICKET_ASSIGNEE_CANDIDATES_MALFORMED");
  }
  return candidates;
}

export function isRetryableM1SupportAgentAbort(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === "AbortError";
}

export function classifySupportAgentFailure(error: unknown): Exclude<MSupportAgentFailureKind, "none"> {
  if (error instanceof MContentReadError && (error.status === 401 || error.apiCode === 401)) return "auth";
  if (error instanceof MContentReadError && (error.status === 403 || error.apiCode === 403)) return "permission";
  if (error instanceof MContentReadError && (error.status >= 500 || error.apiCode === 500)) return "unavailable";
  if (error instanceof Error && (
    error.message === "M1_SUPPORT_AGENT_OVERVIEW_MALFORMED"
    || error.message === "CONTENT_API_MALFORMED_RESPONSE"
  )) return "malformed";
  return "unavailable";
}

export async function loadWithBoundedAbortRetry<T>(
  loader: () => Promise<T>,
  maxAttempts: number,
): Promise<T> {
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1) {
    throw new Error("M1_SUPPORT_AGENT_RETRY_BOUND_INVALID");
  }
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await loader();
    } catch (error) {
      lastError = error;
      if (isRetryableM1SupportAgentAbort(error) && attempt < maxAttempts) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

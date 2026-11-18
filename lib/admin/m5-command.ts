import type { MSupportAgent } from "./m-client";

export type M5Command = {
  actorId: number;
  key: string;
  value: string;
  reason: string;
  action: string;
  successMessage: string;
  resource: string;
  beforeValue: string;
  text: string;
  audience: string;
  profile?: MSupportAgent;
  request: { method: "POST" | "PATCH"; path: string; body: string };
};

/** Session storage is an input boundary; incomplete historical requests stay query-only. */
export function isM5Command(value: unknown): value is M5Command {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const command = value as M5Command;
  if (!Number.isSafeInteger(command.actorId) || command.actorId < 1
    || ![command.key, command.value, command.reason, command.action, command.successMessage, command.resource, command.beforeValue, command.text, command.audience].every(item => typeof item === "string")
    || !command.request || typeof command.request.body !== "string") return false;
  const { method, path } = command.request;
  if (!(method === "POST" && /^\/session-templates\/(scripts|reply-templates)$/.test(path)
    || method === "PATCH" && /^\/(support-agents\/\d+\/profile|session-templates\/(categories\/advisor|advisor-policy\/(enabled|delayMs|cooldownHours|maxPerSession|audience)|(scripts|reply-templates)\/[^/]+\/status))$/.test(path))) return false;
  if (command.profile !== undefined) {
    const row = command.profile;
    if (!row || typeof row !== "object" || !Number.isSafeInteger(row.adminId) || !Number.isSafeInteger(row.version)
      || ![row.name, row.email, row.position].every(item => typeof item === "string")
      || !Array.isArray(row.tags) || !row.tags.every(item => typeof item === "string")
      || !Number.isSafeInteger(row.maxConcurrent) || !Number.isSafeInteger(row.assignedUserCount)
      || ![row.enabled, row.transferable, row.busy].every(item => typeof item === "boolean")) return false;
  }
  try {
    const body = JSON.parse(command.request.body);
    if (!body || typeof body !== "object" || Array.isArray(body) || typeof body.operator !== "string" || body.reason !== command.reason) return false;
    if (path.startsWith("/support-agents/")) return !!command.profile && body.adminId === command.profile.adminId
      && body.expectedVersion === command.profile.version && Array.isArray(body.tags) && body.tags.every((tag: unknown) => typeof tag === "string")
      && Number.isSafeInteger(body.maxConcurrent) && body.maxConcurrent >= 0 && body.maxConcurrent <= 40
      && [body.enabled, body.transferable, body.busy].every(item => typeof item === "boolean");
    if (path.includes("/categories/")) return typeof body.enabled === "boolean" && typeof body.expectedEnabled === "boolean";
    if (path.includes("/advisor-policy/")) return typeof body.value === "string" && typeof body.expectedValue === "string";
    if (method === "POST") return typeof body.text === "string" && body.status === "draft";
    return ["draft", "published", "archived"].includes(body.status) && ["draft", "published", "archived"].includes(body.expectedStatus);
  } catch { return false; }
}

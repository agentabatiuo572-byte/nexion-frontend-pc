/**
 * Mutation responses are resource-shaped (node/void), not overview-shaped.
 * Always re-read the authoritative overview after the write succeeds.
 */
export class PlatformMutationReadbackError extends Error {
  readonly cause: unknown;

  constructor(cause: unknown) {
    super("操作已提交成功，但最新数据读取失败。请不要重复提交；请刷新页面核对最终状态。");
    this.name = "PlatformMutationReadbackError";
    this.cause = cause;
  }
}

export async function mutateThenReloadOverview<TMutation, TOverview>(
  mutate: () => Promise<TMutation>,
  reload: () => Promise<TOverview>,
): Promise<TOverview> {
  await mutate();
  try {
    return await reload();
  } catch (error) {
    throw new PlatformMutationReadbackError(error);
  }
}

export interface A2ProposalTicket {
  id: string;
  action: string;
  status: string;
  roleGate: string;
  amplifies: boolean;
}

export function normalizeProposalTicket(raw: unknown): A2ProposalTicket | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const id = typeof row.id === "string" ? row.id.trim() : "";
  const status = typeof row.status === "string" ? row.status.trim() : "";
  if (!id || !status) return null;
  return {
    id,
    action: typeof row.action === "string" ? row.action.trim() : "",
    status,
    roleGate: typeof row.roleGate === "string" ? row.roleGate.trim() : "",
    amplifies: row.amplifies === true,
  };
}

export function buildRoleMetadataPayload(roleName: string, remark: string): {
  roleName: string;
  remark?: string;
} {
  const normalizedRemark = remark.trim();
  return {
    roleName: roleName.trim(),
    ...(normalizedRemark ? { remark: normalizedRemark } : {}),
  };
}

export function buildRoleStatusPayload(status: number): { status: 0 | 1 } {
  if (status !== 0 && status !== 1) throw new Error("A6_ROLE_STATUS_INVALID");
  return { status };
}

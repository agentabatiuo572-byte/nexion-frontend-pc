"use client";

/**
 * 各域高敏动作接入 A2 后端 pending 的便捷 hook —— 一次绑定 A2 后端 + 当前登录身份,
 * 域里只需 `const propose = usePropose();` 然后在 run 里 `propose(toast, spec)`:
 *   写入后端 pending ticket,由 A2 审批接口执行目标域动作并落审计。
 */
import { useAdminAuth } from "@/lib/store/admin-auth";
import { createA2OperationProposal } from "@/lib/admin/a2-client";
import { proposeOrExecute, type ProposeSpec } from "@/lib/admin/propose-or-execute";

export function usePropose() {
  const session = useAdminAuth((s) => s.session);
  const operator = useAdminAuth((s) => s.operator);
  const role = useAdminAuth((s) => s.role);
  const principal = {
    name: session?.operator || session?.username || operator || "unknown-admin",
    role: session?.role ?? role,
    authorities: session?.authorities ?? [],
  };
  return (toast: (s: string) => void, spec: ProposeSpec) =>
    proposeOrExecute({ principal, createProposal: createA2OperationProposal, toast }, spec);
}

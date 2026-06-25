"use client";

/**
 * 各域高敏动作接入 A2 实时 pending 的便捷 hook —— 一次绑定平台 store + A2 后端 + 当前身份,
 * 域里只需 `const propose = usePropose();` 然后在 run 里 `propose(toast, spec)`:
 *   够执行门槛 → 直接执行(回放 spec.mutations + 审计);不够 → 写入后端 pending ticket 等有权者执行。
 * setParam/logAudit 取自平台 store(宽签名,逆变可赋值给 ProposeDeps 的窄签名)。
 */
import { useActingOperator } from "@/lib/store/admin/acting-operator-store";
import { usePlatformConfig } from "@/lib/store/admin/platform-config-store";
import { createA2OperationProposal } from "@/lib/admin/a2-client";
import { proposeOrExecute, type ProposeSpec } from "@/lib/admin/propose-or-execute";

export function usePropose() {
  const acting = useActingOperator((s) => s.acting);
  const setParam = usePlatformConfig((s) => s.setParam);
  const logAudit = usePlatformConfig((s) => s.logAudit);
  return (toast: (s: string) => void, spec: ProposeSpec) =>
    proposeOrExecute({ acting, setParam, logAudit, createProposal: createA2OperationProposal, toast }, spec);
}

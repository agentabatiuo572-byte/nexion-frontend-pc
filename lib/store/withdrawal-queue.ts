"use client";

/**
 * D2 提现队列 store(可变,不持久化 — 刷新复位,如 H5 useApp)。
 * 动作 = 状态迁移 + 追加审计条。时间标签仅在 action(用户点击后)生成,绝不在 render 调用。
 */
import { create } from "zustand";
import type { AdminRole } from "@/lib/nav/console-nav";
import type { AuditEntry } from "@/app/components/kit/audit-timeline";
import type { WithdrawalRequest } from "@/lib/mock/admin/withdrawals";
import { WITHDRAWALS_SEED } from "@/lib/mock/admin/withdrawals";

export interface Actor {
  name: string;
  role: AdminRole;
}

function clockLabel(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function appendAudit(
  r: WithdrawalRequest,
  by: Actor,
  action: string,
  detail: string,
): WithdrawalRequest {
  const entry: AuditEntry = {
    id: `${r.id}-a${r.audit.length + 1}`,
    actor: by.name,
    role: by.role,
    action,
    detail,
    at: clockLabel(),
    ip: "10.12.x.x",
  };
  return { ...r, audit: [...r.audit, entry] };
}

interface QueueState {
  requests: WithdrawalRequest[];
  claim: (id: string, by: Actor) => void;
  approve: (id: string, by: Actor) => void;
  delay: (id: string, by: Actor, reason?: string) => void;
  freeze: (id: string, by: Actor, reason?: string) => void;
}

function update(
  requests: WithdrawalRequest[],
  id: string,
  fn: (r: WithdrawalRequest) => WithdrawalRequest,
): WithdrawalRequest[] {
  return requests.map((r) => (r.id === id ? fn(r) : r));
}

export const useWithdrawalQueue = create<QueueState>((set) => ({
  requests: WITHDRAWALS_SEED,

  claim: (id, by) =>
    set((s) => ({
      requests: update(s.requests, id, (r) =>
        appendAudit(
          { ...r, state: "in_review", maker: { name: by.name, role: by.role, at: clockLabel() }, checker: undefined },
          by,
          "受理复核",
          "进入人工复核",
        ),
      ),
    })),

  approve: (id, by) =>
    set((s) => ({
      requests: update(s.requests, id, (r) =>
        appendAudit(
          { ...r, state: "approved", checker: { name: by.name, role: by.role, at: clockLabel() } },
          by,
          "复核通过",
          `放行 · 风险分 ${r.riskScore}`,
        ),
      ),
    })),

  delay: (id, by, reason) =>
    set((s) => ({
      requests: update(s.requests, id, (r) =>
        appendAudit({ ...r, state: "delayed" }, by, "延迟放行", reason ?? "延迟至下一资金窗口"),
      ),
    })),

  freeze: (id, by, reason) =>
    set((s) => ({
      requests: update(s.requests, id, (r) =>
        appendAudit({ ...r, state: "frozen" }, by, "冻结审查", reason ?? "转合规核查"),
      ),
    })),
}));

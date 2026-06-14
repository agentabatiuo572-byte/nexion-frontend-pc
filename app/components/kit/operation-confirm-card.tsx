"use client";

/**
 * OperationConfirmCard — 操作确认卡。展示操作员与执行门槛,
 * 强制「操作理由必填」+「确认后即写审计」。是 PRD §A2 审计 & 操作确认 的 UI 原语。
 */
import { ArrowDown, Check, X, ShieldCheck } from "lucide-react";
import type { AdminRole } from "@/lib/nav/console-nav";
import { ROLE_LABEL } from "@/lib/nav/console-nav";
import { RoleBadge } from "./role-badge";

export interface ConfirmParty {
  name: string;
  role: AdminRole;
  at?: string;
}

export type ConfirmState = "pending" | "approved" | "rejected";

export function OperationConfirmCard({
  operator,
  executor,
  requiredConfirmRole,
  state,
  currentRole,
  onApprove,
  onReject,
}: {
  operator: ConfirmParty;
  executor?: ConfirmParty;
  requiredConfirmRole: AdminRole;
  state: ConfirmState;
  currentRole: AdminRole;
  onApprove?: () => void;
  onReject?: () => void;
}) {
  const isSuper = currentRole === "superadmin";
  const roleOk = currentRole === requiredConfirmRole || isSuper;
  const canApprove = state === "pending" && roleOk;
  const blockReason = !roleOk ? `需「${ROLE_LABEL[requiredConfirmRole]}」或总管理员执行` : "";

  return (
    <div
      className="rounded-[12px] p-3.5"
      style={{ background: "var(--v5-surface-2)", borderLeft: "3px solid var(--v5-tech-cyan)" }}
    >
      <div className="flex items-center gap-1.5">
        <ShieldCheck size={14} style={{ color: "var(--v5-tech-cyan)" }} />
        <span className="text-[12px] font-medium" style={{ color: "var(--v5-ink-2)" }}>
          操作确认
        </span>
      </div>

      {/* 操作员 */}
      <div className="mt-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <RoleBadge role={operator.role} size="sm" />
          <span className="text-[12.5px]" style={{ color: "var(--v5-ink)" }}>
            {operator.name}
          </span>
        </div>
        <span className="font-mono-tabular text-[11px]" style={{ color: "var(--v5-ink-4)" }}>
          发起 {operator.at ?? ""}
        </span>
      </div>

      <div className="my-1.5 flex justify-center">
        <ArrowDown size={13} style={{ color: "var(--v5-ink-4)" }} />
      </div>

      {/* 执行记录 slot */}
      {state === "approved" && executor ? (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <RoleBadge role={executor.role} size="sm" />
            <span className="text-[12.5px]" style={{ color: "var(--v5-ink)" }}>
              {executor.name}
            </span>
          </div>
          <span
            className="inline-flex items-center gap-1 font-mono-tabular text-[11px]"
            style={{ color: "var(--v5-success)" }}
          >
            <Check size={12} /> 已执行 {executor.at ?? ""}
          </span>
        </div>
      ) : state === "rejected" ? (
        <span
          className="inline-flex items-center gap-1 text-[12px]"
          style={{ color: "var(--v5-danger)" }}
        >
          <X size={13} /> 已驳回
        </span>
      ) : (
        <div>
          <p className="text-[12px]" style={{ color: isSuper ? "var(--v5-brand)" : "var(--v5-ink-3)" }}>
            {isSuper ? "总管理员 · 仍需操作确认与理由留痕" : `待执行 · 需「${ROLE_LABEL[requiredConfirmRole]}」`}
          </p>
          <div className="mt-2.5 flex items-center gap-2">
            <button
              type="button"
              disabled={!canApprove}
              onClick={onApprove}
              className="flex-1 rounded-[8px] py-1.5 text-[12.5px] font-medium transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
              style={{ background: "var(--v5-brand)", color: "var(--v5-on-brand)" }}
            >
              确认执行
            </button>
            <button
              type="button"
              disabled={!canApprove}
              onClick={onReject}
              className="rounded-[8px] px-3 py-1.5 text-[12.5px] transition-colors hover:bg-[var(--v5-surface-3)] disabled:cursor-not-allowed disabled:opacity-40"
              style={{ color: "var(--v5-ink-3)", border: "1px solid var(--v5-border)" }}
            >
              驳回
            </button>
          </div>
          {blockReason && (
            <p className="mt-1.5 text-[11px]" style={{ color: "var(--v5-warning)" }}>
              {blockReason}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

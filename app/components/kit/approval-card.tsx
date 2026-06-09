"use client";

/**
 * ApprovalCard — Maker-Checker 双签卡。展示发起人(Maker)+ 复核人(Checker)双身份,
 * 强制「发起人不可自审」+「需指定角色复核」。是 PRD §A2 审计 & Maker-Checker 的 UI 原语。
 */
import { ArrowDown, Check, X, ShieldCheck } from "lucide-react";
import type { AdminRole } from "@/lib/nav/console-nav";
import { ROLE_LABEL } from "@/lib/nav/console-nav";
import { RoleBadge } from "./role-badge";

export interface ApprovalParty {
  name: string;
  role: AdminRole;
  at?: string;
}

export type ApprovalState = "pending" | "approved" | "rejected";

export function ApprovalCard({
  maker,
  checker,
  requiredCheckerRole,
  state,
  currentRole,
  onApprove,
  onReject,
}: {
  maker: ApprovalParty;
  checker?: ApprovalParty;
  requiredCheckerRole: AdminRole;
  state: ApprovalState;
  currentRole: AdminRole;
  onApprove?: () => void;
  onReject?: () => void;
}) {
  const isSuper = currentRole === "superadmin";
  const isSelf = currentRole === maker.role;
  const roleOk = currentRole === requiredCheckerRole || isSuper;
  // 总管理员拥有全部权限、免双签:不受自审拦截,可直接放行。
  const canApprove = state === "pending" && (isSuper || (!isSelf && roleOk));
  const blockReason = isSuper
    ? ""
    : isSelf
      ? "发起人不可自审,需他人复核"
      : !roleOk
        ? `需「${ROLE_LABEL[requiredCheckerRole]}」或总管理员复核`
        : "";

  return (
    <div
      className="rounded-[12px] p-3.5"
      style={{ background: "var(--v5-surface-2)", borderLeft: "3px solid var(--v5-tech-cyan)" }}
    >
      <div className="flex items-center gap-1.5">
        <ShieldCheck size={14} style={{ color: "var(--v5-tech-cyan)" }} />
        <span className="text-[12px] font-medium" style={{ color: "var(--v5-ink-2)" }}>
          Maker-Checker 双签审批
        </span>
      </div>

      {/* Maker */}
      <div className="mt-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <RoleBadge role={maker.role} size="sm" />
          <span className="text-[12.5px]" style={{ color: "var(--v5-ink)" }}>
            {maker.name}
          </span>
        </div>
        <span className="font-mono-tabular text-[11px]" style={{ color: "var(--v5-ink-4)" }}>
          发起 {maker.at ?? ""}
        </span>
      </div>

      <div className="my-1.5 flex justify-center">
        <ArrowDown size={13} style={{ color: "var(--v5-ink-4)" }} />
      </div>

      {/* Checker slot */}
      {state === "approved" && checker ? (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <RoleBadge role={checker.role} size="sm" />
            <span className="text-[12.5px]" style={{ color: "var(--v5-ink)" }}>
              {checker.name}
            </span>
          </div>
          <span
            className="inline-flex items-center gap-1 font-mono-tabular text-[11px]"
            style={{ color: "var(--v5-success)" }}
          >
            <Check size={12} /> 复核通过 {checker.at ?? ""}
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
            {isSuper ? "总管理员 · 拥有全部权限,可直接放行(免双签)" : `待复核 · 需「${ROLE_LABEL[requiredCheckerRole]}」`}
          </p>
          <div className="mt-2.5 flex items-center gap-2">
            <button
              type="button"
              disabled={!canApprove}
              onClick={onApprove}
              className="flex-1 rounded-[8px] py-1.5 text-[12.5px] font-medium transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
              style={{ background: "var(--v5-brand)", color: "var(--v5-on-brand)" }}
            >
              {isSuper ? "通过放行" : "复核通过"}
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

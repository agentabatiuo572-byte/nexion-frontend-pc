"use client";

/**
 * C1 用户详情(L3 · 画像全景)。页面只消费后端聚合的 360 画像和操作接口。
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Bell, CreditCard, KeyRound, LogOut, RefreshCcw, ShieldAlert, Snowflake, UserCog } from "lucide-react";
import {
  fetchUser360,
  fetchUserPaymentMethods,
  notifyUserPaymentMethodRebind,
  resetUserNickname,
  unbindUserPaymentMethod,
  type JsonRecord,
  type UserPaymentMethodPage,
  type User360Detail,
  type User360Profile,
  type User360Section,
  type User360Summary,
} from "@/lib/admin/user360-client";
import { usePropose } from "@/lib/admin/use-propose";
import { findHighOp } from "@/lib/admin/high-ops-registry";
import { OperationConfirmModal } from "@/app/components/domain-views/design-kit";
import { fmtNum, fmtUsd } from "@/lib/format";
import { toast } from "@/lib/store/ui";
import { KpiStatCard } from "@/app/components/kit/kpi-stat-card";
import { StatusPill, type PillTone } from "@/app/components/kit/status-pill";
import { AuditTimeline, type AuditEntry } from "@/app/components/kit/audit-timeline";
import type { AdminRole } from "@/lib/nav/console-nav";
import { useAdminAuth } from "@/lib/store/admin-auth";

type Column = {
  key: string;
  label: string;
  numeric?: boolean;
  render?: (value: unknown, row: JsonRecord) => ReactNode;
};

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "正常",
  FROZEN: "冻结",
  BANNED: "封禁",
  RESTRICTED: "受限",
};

const KYC_LABEL: Record<string, string> = {
  VERIFIED: "已认证",
  APPROVED: "已认证",
  PASSED: "已认证",
  PENDING: "待认证",
  REVIEW: "复审中",
  REVIEWING: "复审中",
  REJECTED: "未通过",
  FAILED: "未通过",
};

function asText(value: unknown, fallback = "-") {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "是" : "否";
  return fallback;
}

function asNumber(value: unknown, fallback = 0) {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function asArray<T extends JsonRecord = JsonRecord>(value: unknown): T[] {
  return Array.isArray(value)
    ? value.filter((row): row is T => !!row && typeof row === "object" && !Array.isArray(row))
    : [];
}

function asList(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function rows(section: User360Section | null | undefined) {
  return asArray(section?.records);
}

function money(value: unknown, digits = 2) {
  return fmtUsd(asNumber(value), digits);
}

function numberLabel(value: unknown) {
  return fmtNum(asNumber(value));
}

function statusLabel(value: unknown) {
  const key = asText(value).toUpperCase();
  return STATUS_LABEL[key] ?? key;
}

function kycLabel(value: unknown) {
  const key = asText(value).toUpperCase();
  return KYC_LABEL[key] ?? key;
}

function statusTone(value: unknown): PillTone {
  const key = asText(value).toUpperCase();
  if (key === "ACTIVE") return "success";
  if (key === "FROZEN" || key === "RESTRICTED") return "warning";
  if (key === "BANNED") return "danger";
  return "neutral";
}

function kycTone(value: unknown): PillTone {
  const key = asText(value).toUpperCase();
  if (key === "VERIFIED" || key === "APPROVED" || key === "PASSED") return "success";
  if (key === "REVIEW" || key === "REVIEWING" || key === "PENDING") return "warning";
  if (key === "REJECTED" || key === "FAILED") return "danger";
  return "neutral";
}

function riskTone(score: number): PillTone {
  return score >= 70 ? "danger" : score >= 40 ? "warning" : "success";
}

function riskColor(score: number) {
  return score >= 70 ? "var(--v5-danger)" : score >= 40 ? "var(--v5-warning)" : "var(--v5-success)";
}

function formatDate(value: unknown) {
  const text = asText(value, "");
  if (!text) return "-";
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text;
  return date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function displayValue(value: unknown) {
  if (value == null || value === "") return "-";
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "-";
  if (typeof value === "string") {
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return formatDate(value);
    return value;
  }
  if (Array.isArray(value)) return value.length ? `${value.length} 条` : "-";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "UNKNOWN_ERROR";
}

function sectionStatus(section: User360Section | null | undefined) {
  return asText(section?.sourceStatus, "READY");
}

function auditDetail(row: JsonRecord) {
  const detail = row.detailJson;
  if (typeof detail === "string" && detail.trim()) {
    try {
      const parsed = JSON.parse(detail) as Record<string, unknown>;
      const reason = asText(parsed.reason, "");
      const fromStatus = asText(parsed.fromStatus, "");
      const toStatus = asText(parsed.toStatus, "");
      if (reason && fromStatus && toStatus) return `${fromStatus} -> ${toStatus} · ${reason}`;
      if (reason) return reason;
    } catch {
      return detail;
    }
  }
  return asText(row.result, "");
}

function auditRole(row: JsonRecord): AdminRole | undefined {
  const raw = asText(row.operatorRole ?? row.actorRole ?? row.role ?? row.roleGate, "").toLowerCase();
  if (!raw) return undefined;
  if (raw.includes("superadmin") || raw.includes("超管") || raw.includes("总管理员")) return "superadmin";
  if (raw.includes("finance") || raw.includes("财务")) return "finance";
  if (raw.includes("config") || raw.includes("配置")) return "config";
  if (raw.includes("risk") || raw.includes("风控")) return "risk";
  if (raw.includes("content") || raw.includes("内容")) return "content";
  if (raw.includes("growth") || raw.includes("增长")) return "growth";
  if (raw.includes("support") || raw.includes("客服")) return "support";
  if (raw.includes("auditor") || raw.includes("audit") || raw.includes("审计")) return "auditor";
  return undefined;
}

function toAuditEntries(rowsValue: unknown): AuditEntry[] {
  return asArray(rowsValue).map((row, index) => ({
    id: asText(row.id, `${index}`),
    actor: asText(row.actorUsername, "系统"),
    role: auditRole(row),
    action: asText(row.action, "UNKNOWN"),
    detail: auditDetail(row),
    at: formatDate(row.createdAt),
    ip: asText(row.clientIp, "-"),
  }));
}

function Section({ title, tag, children }: { title: string; tag?: string; children: ReactNode }) {
  return (
    <div className="rounded-[12px] p-4" style={{ background: "var(--v5-surface)", border: "1px solid var(--v5-border)" }}>
      <div className="mb-2.5 flex items-center gap-2">
        <span className="font-display text-[14px]" style={{ color: "var(--v5-ink)" }}>{title}</span>
        {tag && <span className="font-mono-tabular text-[10px]" style={{ color: "var(--v5-ink-4)" }}>{tag}</span>}
      </div>
      {children}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5" style={{ borderBottom: "1px solid var(--v5-border)" }}>
      <span className="text-[12px]" style={{ color: "var(--v5-ink-4)" }}>{label}</span>
      <span className="text-right text-[12.5px]" style={{ color: "var(--v5-ink)" }}>{children}</span>
    </div>
  );
}

function DataTable({ rows, columns, emptyText = "暂无记录" }: { rows: JsonRecord[]; columns: Column[]; emptyText?: string }) {
  if (rows.length === 0) {
    return <p className="rounded-[8px] px-3 py-3 text-[12px]" style={{ background: "var(--v5-surface-2)", color: "var(--v5-ink-4)" }}>{emptyText}</p>;
  }
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="w-full text-left text-[12px]" style={{ minWidth: 760, borderCollapse: "separate", borderSpacing: 0 }}>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} className={column.numeric ? "text-right" : ""} style={{ color: "var(--v5-ink-4)", borderBottom: "1px solid var(--v5-border)", padding: "8px 10px", fontWeight: 500 }}>{column.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${asText(row.id ?? row.bizNo ?? row.orderNo ?? row.depositNo ?? row.withdrawalNo ?? row.instanceNo, "row")}-${index}`}>
              {columns.map((column) => (
                <td key={column.key} className={column.numeric ? "text-right font-mono-tabular" : ""} style={{ color: "var(--v5-ink-2)", borderBottom: "1px solid var(--v5-border)", padding: "8px 10px", maxWidth: 220 }}>
                  <span className="line-clamp-2">{column.render ? column.render(row[column.key], row) : displayValue(row[column.key])}</span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HubSection({
  id,
  title,
  section,
  columns,
  children,
  emptyText,
}: {
  id?: string;
  title: string;
  section?: User360Section | null;
  columns?: Column[];
  children?: ReactNode;
  emptyText?: string;
}) {
  const dataRows = rows(section);
  return (
    <div id={id} style={{ scrollMarginTop: 76 }}>
      <Section title={title} tag={`source ${sectionStatus(section)}`}>
        {children}
        {columns && (
          <div className={children ? "mt-3" : ""}>
            <DataTable rows={dataRows} columns={columns} emptyText={emptyText} />
          </div>
        )}
      </Section>
    </div>
  );
}

function ActionButton({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1.5 rounded-[9px] px-3 py-2 text-[12.5px] transition-colors hover:bg-[var(--v5-surface-2)] disabled:cursor-not-allowed disabled:opacity-55"
      style={{ border: "1px solid var(--v5-border)", color: "var(--v5-ink-2)" }}
    >
      {children}
    </button>
  );
}

export default function UserDetailPage() {
  const session = useAdminAuth((state) => state.session);
  const canWriteC1 = session?.role === "superadmin" || !!session?.authorities.includes("user_c1hub_write");
  const params = useParams<{ id: string }>();
  const userKey = params.id;
  const [detail, setDetail] = useState<User360Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState<string | null>(null);
  const [paymentMethods, setPaymentMethods] = useState<UserPaymentMethodPage | null>(null);
  const [includeUnbound, setIncludeUnbound] = useState(false);
  const [paymentPage, setPaymentPage] = useState(1);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const propose = usePropose();
  const [actionConfirm, setActionConfirm] = useState<null | {
    action: string;
    detail: string;
    amplifies?: boolean;
    run: (reason: string) => void;
  }>(null);
  // c1hub 无 CCtx:就近挂载本地 OperationConfirmModal,简化签名(只取 action/detail/amplifies/run)
  const openActionConfirmReq = (req: {
    action: string;
    detail: string;
    amplifies?: boolean;
    run: (reason: string) => void;
  }) => setActionConfirm(req);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setDetail(await fetchUser360(userKey));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [userKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const profile: User360Profile | null = detail?.profile ?? null;
  const summary: User360Summary = detail?.summary ?? {};
  const userId = profile?.id ?? summary.userId;
  const userNo = asText(profile?.userNo ?? summary.userNo, "-");
  const nickname = asText(profile?.nickname, "用户详情");
  const status = asText(profile?.status ?? summary.status, "UNKNOWN").toUpperCase();
  const riskScore = asNumber(summary.riskScore ?? profile?.riskScore);
  const riskBand = asText(summary.riskBand ?? profile?.riskBand, riskScore >= 70 ? "高风险" : riskScore >= 40 ? "中风险" : "低风险");
  const nonActive = status !== "ACTIVE" && status !== "UNKNOWN";
  const frozen = status === "FROZEN";
  const actionDisabled = !!actionPending || !userId;

  const loadPaymentMethods = useCallback(async () => {
    if (!userId) return;
    try {
      setPaymentMethods(await fetchUserPaymentMethods(userId, includeUnbound, paymentPage, 10));
      setPaymentError(null);
    } catch (err) {
      setPaymentError(errorMessage(err));
    }
  }, [includeUnbound, paymentPage, userId]);

  useEffect(() => { void loadPaymentMethods(); }, [loadPaymentMethods]);
  useEffect(() => { setPaymentPage(1); }, [userId]);

  useEffect(() => {
    if (!detail || typeof window === "undefined" || window.location.hash !== "#hub-payment-methods") return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById("hub-payment-methods")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [detail, paymentMethods]);

  const sessions = useMemo(() => asArray(detail?.sessions), [detail?.sessions]);
  const auditEntries = useMemo(() => toAuditEntries(detail?.audit), [detail?.audit]);

  function scrollToHub(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function doFreeze() {
    if (!userId) {
      toast.error("缺少用户主键", "请刷新后重试");
      return;
    }
    const opKey = frozen ? "c2_account_unfreeze" : "c2_account_freeze";
    const def = findHighOp(opKey)!;
    openActionConfirmReq({
      action: frozen ? `解冻账户 · ${nickname}` : `冻结账户 · ${nickname}`,
      detail: frozen
        ? `恢复 ${nickname} 的提现与交易能力。提交后进入 A2 待确认队列。`
        : `冻结 ${nickname} 的提现与交易,转合规核查。提交后进入 A2 待确认队列。`,
      amplifies: !frozen,
      run: (reason) => {
        void propose((s: string) => toast.success(s), {
          action: `${frozen ? "恢复账户" : "冻结账户"} · ${nickname}`,
          obj: String(userId),
          before: frozen ? "FROZEN" : "ACTIVE",
          after: frozen ? "ACTIVE" : "FROZEN",
          type: "acct",
          amplifies: false,
          gate: { roles: [] },
          gateLabel: def.gateLabel,
          reason,
          sourceDomain: "C1",
          command: def.buildCommand({ userId: String(userId) }),
          target: def.buildTarget({ userId: String(userId) }),
        });
      },
    });
  }

  const kpis = [
    { label: "可提余额", value: money(summary.walletUsdt ?? profile?.walletUsdt), accent: "var(--admin-domain-d)", anchor: "hub-deposit" },
    { label: "累计充值", value: money(summary.depositedUsd), accent: "var(--admin-domain-c)", anchor: "hub-deposit" },
    { label: "累计提现", value: money(summary.withdrawnUsd), accent: "var(--v5-warning)", anchor: "hub-withdrawal" },
    { label: "团队规模", value: `${numberLabel(summary.teamSize)} 人`, accent: "var(--admin-domain-f)", anchor: "hub-referral" },
    { label: "设备数", value: `${numberLabel(summary.deviceCount)} 台`, accent: "var(--admin-domain-e)", anchor: "hub-devices" },
  ];

  if (loading && !detail) {
    return (
      <div className="w-full">
        <Link href="/users/search" prefetch={false} className="inline-flex items-center gap-1 text-[12.5px]" style={{ color: "var(--v5-ink-3)" }}>
          <ArrowLeft size={14} /> 返回检索
        </Link>
        <p className="mt-6 text-[14px]" style={{ color: "var(--v5-ink-3)" }}>正在加载用户详情...</p>
      </div>
    );
  }

  if (error && !detail) {
    return (
      <div className="w-full">
        <Link href="/users/search" prefetch={false} className="inline-flex items-center gap-1 text-[12.5px]" style={{ color: "var(--v5-ink-3)" }}>
          <ArrowLeft size={14} /> 返回检索
        </Link>
        <div className="mt-6 rounded-[12px] p-4" style={{ background: "var(--v5-surface)", border: "1px solid var(--v5-border)" }}>
          <p className="text-[14px]" style={{ color: "var(--v5-danger)" }}>用户详情加载失败: {error}</p>
          <button type="button" onClick={() => void load()} className="mt-3 inline-flex items-center gap-1.5 rounded-[9px] px-3 py-2 text-[12.5px]" style={{ border: "1px solid var(--v5-border)", color: "var(--v5-ink-2)" }}>
            <RefreshCcw size={14} /> 重试
          </button>
        </div>
      </div>
    );
  }

  if (!profile || !detail) {
    return (
      <div className="w-full">
        <Link href="/users/search" prefetch={false} className="inline-flex items-center gap-1 text-[12.5px]" style={{ color: "var(--v5-ink-3)" }}>
          <ArrowLeft size={14} /> 返回检索
        </Link>
        <p className="mt-6 text-[14px]" style={{ color: "var(--v5-ink-3)" }}>后端未返回用户详情。</p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1100px]">
      <Link href="/users/search" prefetch={false} className="inline-flex items-center gap-1 text-[12.5px] transition-colors hover:opacity-80" style={{ color: "var(--v5-ink-3)" }}>
        <ArrowLeft size={14} /> 返回检索
      </Link>

      <header className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="font-display text-[24px]" style={{ color: "var(--v5-ink)" }}>{nickname}</h1>
            <span className="font-mono-tabular text-[12px]" style={{ color: "var(--v5-ink-4)" }}>用户编码 {userNo}</span>
          </div>
          <p className="mt-1 text-[12.5px]" style={{ color: "var(--v5-ink-3)" }}>
            {asText(profile.phoneMasked)} · 注册 {formatDate(profile.registeredAt)} · 最近登录 {formatDate(profile.lastLoginAt)}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusPill label={statusLabel(status)} tone={statusTone(status)} size="sm" />
            <StatusPill label={`KYC ${kycLabel(summary.kycStatus ?? profile.kycStatus)}`} tone={kycTone(summary.kycStatus ?? profile.kycStatus)} size="sm" dot={false} />
            <StatusPill label={`${riskBand} ${riskScore}`} tone={riskTone(riskScore)} size="sm" />
            <span className="font-mono-tabular rounded-full px-2 py-0.5 text-[10.5px]" style={{ background: "var(--v5-surface-2)", color: "var(--v5-ink-3)" }}>
              分层 {asText(profile.userLevel)} · {asText(profile.vRank)}
            </span>
            {asList(detail.risk?.flags).map((flag, index) => (
              <span key={`${displayValue(flag)}-${index}`} className="rounded-full px-2 py-0.5 text-[10.5px]" style={{ background: "color-mix(in srgb, var(--v5-danger) 14%, transparent)", color: "var(--v5-danger)" }}>
                {displayValue(flag)}
              </span>
            ))}
          </div>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-1.5 rounded-[9px] px-3 py-2 text-[12.5px] disabled:opacity-60" style={{ border: "1px solid var(--v5-border)", color: "var(--v5-ink-2)" }}>
          <RefreshCcw size={14} /> 刷新
        </button>
      </header>

      {nonActive && (
        <div className="mt-3 flex items-center gap-2 rounded-[10px] px-3 py-2 text-[12.5px]" style={{ background: "color-mix(in srgb, var(--v5-danger) 12%, transparent)", color: "var(--v5-danger)", border: "1px solid color-mix(in srgb, var(--v5-danger) 30%, transparent)" }}>
          <Snowflake size={14} /> 当前账户状态: {statusLabel(status)}。提现与交易能力以服务端状态为准。
        </div>
      )}

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {kpis.map((kpi) => (
          <button key={kpi.label} type="button" onClick={() => scrollToHub(kpi.anchor)} title={`查看该用户 ${kpi.label} 明细`} className="block w-full text-left transition-transform hover:-translate-y-0.5">
            <KpiStatCard label={kpi.label} value={kpi.value} accent={kpi.accent} />
          </button>
        ))}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <Section title="风险画像" tag="K4 风险评分 · C4 KYC">
            <div className="flex items-center gap-4">
              <div>
                <p className="font-mono-tabular text-[32px] leading-none" style={{ color: riskColor(riskScore) }}>{riskScore}</p>
                <p className="text-[10.5px]" style={{ color: "var(--v5-ink-4)" }}>{riskBand}</p>
              </div>
              <div className="flex-1">
                <Row label="KYC 状态"><StatusPill label={kycLabel(summary.kycStatus ?? profile.kycStatus)} tone={kycTone(summary.kycStatus ?? profile.kycStatus)} size="sm" dot={false} /></Row>
                <Row label="风险标记">{asList(detail.risk?.flags).map(displayValue).join(" · ") || "无"}</Row>
                <Row label="风险案件">{numberLabel(detail.risk?.openCaseCount)} 个未关闭</Row>
              </div>
            </div>
          </Section>

          <Section title="资产 & 账户" tag="C3 余额资产 · 双币 USDT/NEX">
            <Row label="可提余额 · USDT"><span className="font-mono-tabular">{money(summary.walletUsdt ?? profile.walletUsdt)}</span></Row>
            <Row label="NEX 余额"><span className="font-mono-tabular">{fmtNum(asNumber(summary.walletNex ?? profile.walletNex))} NEX</span></Row>
            <Row label="累计充值"><span className="font-mono-tabular">{money(summary.depositedUsd)}</span></Row>
            <Row label="累计提现"><span className="font-mono-tabular">{money(summary.withdrawnUsd)}</span></Row>
            <Row label="提现申请额"><span className="font-mono-tabular">{money(summary.withdrawRequestedUsd)}</span></Row>
          </Section>
        </div>

        <div className="flex flex-col gap-4">
          <Section title="账户操作" tag="C2 · 真实接口 · 审计留痕">
            <div className="flex flex-wrap gap-2">
              <ActionButton onClick={() => void doFreeze()} disabled={actionDisabled}>
                <Snowflake size={14} style={{ color: frozen ? "var(--v5-success)" : "var(--v5-danger)" }} /> {frozen ? "解冻账户" : "冻结账户"}
              </ActionButton>
              <ActionButton
                onClick={() => openActionConfirmReq({
                  action: `强制登出 · ${nickname}`,
                  detail: `使 ${nickname} 的全部会话失效。提交后进入 A2 待确认队列。`,
                  amplifies: false,
                  run: (reason) => {
                    const def = findHighOp("c2_session_revoke_all")!;
                    void propose((s: string) => toast.success(s), {
                      action: `强制登出 · ${nickname}`,
                      obj: String(userId),
                      before: "多会话",
                      after: "0 会话",
                      type: "acct",
                      amplifies: false,
                      gate: { roles: [] },
                      gateLabel: def.gateLabel,
                      reason,
                      sourceDomain: "C1",
                      command: def.buildCommand({ userId: String(userId) }),
                      target: def.buildTarget({ userId: String(userId) }),
                    });
                  },
                })}
                disabled={actionDisabled}
              >
                <LogOut size={14} style={{ color: "var(--v5-warning)" }} /> 强制登出
              </ActionButton>
              <ActionButton
                onClick={() => openActionConfirmReq({
                  action: `模拟登录 · ${nickname}`,
                  detail: `${nickname} 的 impersonate 会话有效期 15 分钟,全程审计留痕。提交后进入 A2 待确认队列。`,
                  amplifies: false,
                  run: (reason) => {
                    const def = findHighOp("c2_impersonate_start")!;
                    void propose((s: string) => toast.success(s), {
                      action: `发起模拟登录 · ${nickname}`,
                      obj: String(userId),
                      before: "—",
                      after: "只读 15min",
                      type: "acct",
                      amplifies: false,
                      gate: { roles: [] },
                      gateLabel: def.gateLabel,
                      reason,
                      sourceDomain: "C1",
                      command: def.buildCommand({ userId: String(userId), ttlMinutes: 15 }),
                      target: def.buildTarget({ userId: String(userId) }),
                    });
                  },
                })}
                disabled={actionDisabled}
              >
                <UserCog size={14} style={{ color: "var(--v5-tech-cyan)" }} /> impersonate
              </ActionButton>
              <ActionButton
                onClick={() => openActionConfirmReq({
                  action: `密码重置 · ${nickname}`,
                  detail: `失效 ${nickname} 的当前密码并要求重新设置。提交后进入 A2 待确认队列。`,
                  amplifies: false,
                  run: (reason) => {
                    const def = findHighOp("c5_password_reset")!;
                    void propose((s: string) => toast.success(s), {
                      action: `密码重置 · ${nickname}`,
                      obj: String(userId),
                      before: "旧密码有效",
                      after: "旧密码已作废",
                      type: "acct",
                      amplifies: false,
                      gate: { roles: [] },
                      gateLabel: def.gateLabel,
                      reason,
                      sourceDomain: "C1",
                      command: def.buildCommand({ userId: String(userId) }),
                      target: def.buildTarget({ userId: String(userId) }),
                    });
                  },
                })}
                disabled={actionDisabled}
              >
                <KeyRound size={14} style={{ color: "var(--v5-warning)" }} /> 重置密码
              </ActionButton>
              {canWriteC1 && <ActionButton
                onClick={() => openActionConfirmReq({
                  action: `重置昵称 · ${nickname}`,
                  detail: "服务器生成不暴露手机号等身份信息的新昵称；原昵称不再用于展示，操作写入审计。",
                  amplifies: false,
                  run: async (reason) => {
                    if (!userId) return;
                    setActionPending("重置昵称");
                    try {
                      const result = await resetUserNickname(userId, reason);
                      toast.success(`昵称已重置为 ${result.nickname}`);
                      await load();
                    } catch (err) {
                      toast.error("昵称重置失败", errorMessage(err));
                    } finally {
                      setActionPending(null);
                    }
                  },
                })}
                disabled={actionDisabled}
              >
                <UserCog size={14} style={{ color: "var(--v5-tech-cyan)" }} /> 重置昵称
              </ActionButton>}
            </div>
            <p className="mt-2.5 flex items-center gap-1 text-[11px]" style={{ color: "var(--v5-ink-4)" }}>
              <ShieldAlert size={12} /> 高敏动作均需确认,由后端接口写入审计。{actionPending ? ` 当前执行: ${actionPending}` : ""}
            </p>
          </Section>

          <Section title="安全 & 会话" tag="C5 安全会话">
            <div className="mb-2 grid grid-cols-3 gap-2">
              <KpiStatCard label="活跃会话" value={numberLabel(summary.activeSessionCount)} accent="var(--admin-domain-c)" />
              <KpiStatCard label="2FA" value={summary.twoFactorEnabled ? "开启" : "关闭"} accent="var(--admin-domain-e)" />
              <KpiStatCard label="锁定" value={summary.locked ? "是" : "否"} accent="var(--v5-warning)" />
            </div>
            <DataTable
              rows={sessions}
              columns={[
                { key: "deviceName", label: "设备" },
                { key: "clientIpMasked", label: "IP" },
                { key: "status", label: "状态", render: (value) => <StatusPill label={asText(value)} tone={asText(value).toUpperCase() === "ACTIVE" ? "success" : "neutral"} size="sm" /> },
                { key: "issuedAt", label: "签发", render: formatDate },
                { key: "expiresAt", label: "过期", render: formatDate },
              ]}
              emptyText="暂无会话"
            />
          </Section>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-4">
        <HubSection id="hub-payment-methods" title="支付方式" section={{ sourceStatus: paymentError ? "ERROR" : "READY" }}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <label className="inline-flex items-center gap-2 text-[12px]" style={{ color: "var(--v5-ink-3)" }}>
              <input type="checkbox" checked={includeUnbound} onChange={(event) => { setIncludeUnbound(event.target.checked); setPaymentPage(1); }} /> 显示已解绑
            </label>
            <button type="button" className="inline-flex items-center gap-1 rounded-[8px] px-2.5 py-1.5 text-[12px]" style={{ border: "1px solid var(--v5-border)", color: "var(--v5-ink-3)" }} onClick={() => void loadPaymentMethods()}><RefreshCcw size={13} /> 刷新支付方式</button>
          </div>
          {paymentError && <p className="mb-3 rounded-[8px] px-3 py-2 text-[12px]" style={{ color: "var(--v5-danger)", background: "color-mix(in srgb, var(--v5-danger) 10%, transparent)" }}>支付方式读取失败：{paymentError}</p>}
          <div className="grid gap-3 md:grid-cols-2">
            {(paymentMethods?.items ?? []).map((method) => (
              <div key={method.id} className="rounded-[10px] p-3" style={{ border: "1px solid var(--v5-border)", background: method.status === "BOUND" ? "var(--v5-surface-2)" : "color-mix(in srgb, var(--v5-surface-2) 70%, var(--v5-ink-4) 30%)", opacity: method.status === "BOUND" ? 1 : 0.68, filter: method.status === "BOUND" ? "none" : "grayscale(0.85)" }}>
                <div className="flex items-start justify-between gap-3"><div className="flex items-center gap-2"><CreditCard size={17} /><div><p className="text-[13px]" style={{ color: "var(--v5-ink)" }}>{method.brand} ···· {method.last4}</p><p className="text-[11px]" style={{ color: "var(--v5-ink-4)" }}>{method.provider} · {method.expiryLabel || "无到期信息"}</p></div></div><StatusPill label={method.status === "BOUND" ? (method.isDefault ? "已绑定 · 默认" : "已绑定") : "已解绑"} tone={method.status === "BOUND" ? "success" : "neutral"} size="sm" dot={false} /></div>
                {method.trialGuard && <p className="mt-2 text-[11px]" style={{ color: "var(--v5-warning)" }}>试用扣款占用中 · {method.trialRefId || "关联试用"}，禁止直接解绑</p>}
                {method.status !== "BOUND" && method.unboundAt && <p className="mt-2 text-[11px]" style={{ color: "var(--v5-ink-4)" }}>解绑时间：{formatDate(method.unboundAt)}</p>}
                {canWriteC1 && method.status === "BOUND" && <div className="mt-3 flex gap-2">{method.trialGuard ? <ActionButton disabled={!!actionPending} onClick={() => openActionConfirmReq({ action: `发送换绑通知 · 尾号 ${method.last4}`, detail: "向该用户发送真实站内通知与推送，引导先换绑试用扣款支付方式。", amplifies: false, run: async (reason) => { if (!userId) return; setActionPending(`换绑通知 ${method.id}`); try { await notifyUserPaymentMethodRebind(userId, method.id, method.version, reason); toast.success("换绑通知已进入推送队列"); await loadPaymentMethods(); } catch (err) { toast.error("换绑通知失败", errorMessage(err)); } finally { setActionPending(null); } } })}><Bell size={13} /> 发送换绑通知</ActionButton> : <ActionButton disabled={!!actionPending} onClick={() => openActionConfirmReq({ action: `解绑支付方式 · 尾号 ${method.last4}`, detail: "解绑后立即停止作为默认支付方式；若它是默认卡，服务器会选取其他已绑定方式作为默认。", amplifies: false, run: async (reason) => { if (!userId) return; setActionPending(`解绑 ${method.id}`); try { await unbindUserPaymentMethod(userId, method.id, method.version, reason); toast.success("支付方式已从 Nexion 账户解绑"); if (!includeUnbound) { setIncludeUnbound(true); setPaymentPage(1); } else { await loadPaymentMethods(); } } catch (err) { toast.error("支付方式解绑失败", errorMessage(err)); } finally { setActionPending(null); } } })}>解绑</ActionButton>}</div>}
              </div>
            ))}
          </div>
          {!paymentError && !(paymentMethods?.items ?? []).length && <p className="rounded-[8px] px-3 py-3 text-[12px]" style={{ background: "var(--v5-surface-2)", color: "var(--v5-ink-4)" }}>该用户暂无支付方式</p>}
          {!!paymentMethods?.total && <div className="mt-3 flex items-center justify-between gap-3 text-[12px]" style={{ color: "var(--v5-ink-4)" }}><span>共 {paymentMethods.total} 条 · 第 {paymentMethods.page}/{Math.max(1, Math.ceil(paymentMethods.total / paymentMethods.pageSize))} 页</span><div className="flex gap-2"><button type="button" className="rounded-[8px] px-2.5 py-1.5 disabled:opacity-40" style={{ border: "1px solid var(--v5-border)" }} disabled={paymentPage <= 1} onClick={() => setPaymentPage((page) => Math.max(1, page - 1))}>上一页</button><button type="button" className="rounded-[8px] px-2.5 py-1.5 disabled:opacity-40" style={{ border: "1px solid var(--v5-border)" }} disabled={paymentPage >= Math.ceil(paymentMethods.total / paymentMethods.pageSize)} onClick={() => setPaymentPage((page) => page + 1)}>下一页</button></div></div>}
        </HubSection>

        <HubSection
          id="hub-deposit"
          title="充值记录"
          section={detail.deposits}
          columns={[
            { key: "depositNo", label: "充值单号" },
            { key: "channel", label: "渠道" },
            { key: "asset", label: "币种" },
            { key: "amount", label: "金额", numeric: true },
            { key: "statusLabel", label: "状态" },
            { key: "confirmedAt", label: "确认时间", render: formatDate },
          ]}
        >
          <Row label="确认总额">{money(detail.deposits?.confirmedUsd)}</Row>
        </HubSection>

        <HubSection
          id="hub-withdrawal"
          title="提现记录"
          section={detail.withdrawals}
          columns={[
            { key: "withdrawalNo", label: "提现单号" },
            { key: "asset", label: "币种" },
            { key: "chain", label: "链" },
            { key: "amount", label: "金额", numeric: true },
            { key: "status", label: "状态" },
            { key: "riskScore", label: "风险分", numeric: true },
            { key: "createdAt", label: "创建时间", render: formatDate },
          ]}
        >
          <Row label="完成总额">{money(detail.withdrawals?.completedUsd)}</Row>
          <Row label="申请总额">{money(detail.withdrawals?.requestedUsd)}</Row>
        </HubSection>

        <HubSection
          id="hub-devices"
          title="设备明细"
          section={detail.devices}
          columns={[
            { key: "instanceNo", label: "实例" },
            { key: "name", label: "名称" },
            { key: "productTier", label: "规格" },
            { key: "status", label: "状态" },
            { key: "runtimeStatus", label: "运行态" },
            { key: "dailyUsdt", label: "日 USDT", numeric: true },
            { key: "dailyNex", label: "日 NEX", numeric: true },
          ]}
        >
          <Row label="在线 / 活跃">{numberLabel(detail.devices?.onlineCount)} / {numberLabel(detail.devices?.activeCount)}</Row>
          <Row label="日产出">{money(detail.devices?.dailyUsdt)} · {fmtNum(asNumber(detail.devices?.dailyNex))} NEX</Row>
        </HubSection>

        <HubSection
          title="收益明细"
          section={{ records: asArray(detail.earnings?.records), sourceStatus: asText(detail.earnings?.sourceStatus, "READY") }}
          columns={[
            { key: "bizNo", label: "业务单号" },
            { key: "bizType", label: "类型" },
            { key: "asset", label: "币种" },
            { key: "direction", label: "方向" },
            { key: "amount", label: "金额", numeric: true },
            { key: "balanceAfter", label: "余额", numeric: true },
            { key: "createdAt", label: "时间", render: formatDate },
          ]}
        >
          <Row label="收益合计">{money(detail.earnings?.totalUsdt)} · {fmtNum(asNumber(detail.earnings?.totalNex))} NEX</Row>
          <Row label="设备日产出">{money(detail.earnings?.deviceDailyUsdt)} · {fmtNum(asNumber(detail.earnings?.deviceDailyNex))} NEX</Row>
        </HubSection>

        <HubSection
          id="hub-referral"
          title="推荐团队"
          section={{ records: asArray(detail.referral?.members), sourceStatus: asText(detail.referral?.sourceStatus, "READY") }}
          columns={[
            { key: "memberNo", label: "成员编码" },
            { key: "nickname", label: "昵称" },
            { key: "vRank", label: "V-Rank" },
            { key: "level", label: "层级", numeric: true },
            { key: "volume", label: "贡献额", numeric: true },
            { key: "createdAt", label: "加入时间", render: formatDate },
          ]}
        >
          <Row label="团队规模">{numberLabel(detail.referral?.teamSize)} 人</Row>
          <Row label="直推人数">{numberLabel(detail.referral?.directCount)} 人</Row>
          <Row label="团队业绩">{money(detail.referral?.teamVolumeUsd)}</Row>
        </HubSection>

        <div className="grid gap-4 lg:grid-cols-2">
          <Section title="V-Rank" tag={`source ${sectionStatus(detail.vrank)}`}>
            <Row label="当前等级">{asText(detail.vrank?.currentRank)}</Row>
            <Row label="用户层级">{asText(detail.vrank?.userLevel)}</Row>
            <Row label="团队规模">{numberLabel(detail.vrank?.teamSize)} 人</Row>
            <Row label="直推人数">{numberLabel(detail.vrank?.directCount)} 人</Row>
            <Row label="团队业绩">{money(detail.vrank?.teamVolumeUsd)}</Row>
          </Section>

          <Section title="账户合规" tag={`source ${sectionStatus(detail.account)}`}>
            <Row label="用户编码">{userNo}</Row>
            <Row label="账户状态"><StatusPill label={statusLabel(status)} tone={statusTone(status)} size="sm" /></Row>
            <Row label="KYC"><StatusPill label={kycLabel(summary.kycStatus ?? profile.kycStatus)} tone={kycTone(summary.kycStatus ?? profile.kycStatus)} size="sm" dot={false} /></Row>
            <Row label="2FA">{summary.twoFactorEnabled ? "已开启" : "未开启"}</Row>
            <Row label="需重置密码">{summary.passwordResetRequired ? "是" : "否"}</Row>
          </Section>
        </div>

        <HubSection
          title="财务轨迹"
          section={{ records: asArray(detail.financial?.exchangeRows), sourceStatus: asText(detail.financial?.sourceStatus, "READY") }}
          columns={[
            { key: "bizNo", label: "业务单号" },
            { key: "bizType", label: "类型" },
            { key: "asset", label: "币种" },
            { key: "direction", label: "方向" },
            { key: "amount", label: "金额", numeric: true },
            { key: "createdAt", label: "时间", render: formatDate },
          ]}
          emptyText="暂无兑换/转换账单"
        >
          <Row label="钱包 USDT">{money((detail.financial?.wallet as JsonRecord | undefined)?.usdt)}</Row>
          <Row label="钱包 NEX">{fmtNum(asNumber((detail.financial?.wallet as JsonRecord | undefined)?.nex))} NEX</Row>
          <Row label="质押记录">{numberLabel(asArray(detail.financial?.stakingLedgerRows).length)} 条</Row>
        </HubSection>

        <HubSection
          title="参与与通知"
          section={detail.notifications}
          columns={[
            { key: "title", label: "标题" },
            { key: "type", label: "类型" },
            { key: "pushStatus", label: "推送" },
            { key: "readFlag", label: "已读" },
            { key: "createdAt", label: "创建时间", render: formatDate },
          ]}
        >
          <Row label="未读">{numberLabel(detail.notifications?.unreadCount)} 条</Row>
          <Row label="待推送">{numberLabel(detail.notifications?.pendingPushCount)} 条</Row>
          <Row label="失败">{numberLabel(detail.notifications?.failedPushCount)} 条</Row>
        </HubSection>

        <HubSection
          title="商城订单"
          section={{ records: asArray(detail.commerce?.orders), sourceStatus: asText(detail.commerce?.sourceStatus, "READY") }}
          columns={[
            { key: "orderNo", label: "订单号" },
            { key: "skuName", label: "商品" },
            { key: "amount", label: "金额", numeric: true },
            { key: "state", label: "状态" },
            { key: "dcLocation", label: "机房" },
            { key: "orderedAt", label: "下单时间", render: formatDate },
          ]}
        >
          <Row label="订单总数">{numberLabel(detail.commerce?.total)} 单</Row>
          <Row label="活跃订单">{numberLabel(detail.commerce?.activeOrderCount)} 单</Row>
        </HubSection>
      </div>

      <div className="mt-4">
        <Section title="审计时间线" tag="A2 全程留痕">
          <AuditTimeline entries={auditEntries} />
        </Section>
      </div>

      {actionConfirm && (
        <OperationConfirmModal
          action={actionConfirm.action}
          detail={actionConfirm.detail}
          amplifies={actionConfirm.amplifies ?? false}
          onClose={() => setActionConfirm(null)}
          onConfirm={(reason) => {
            const fn = actionConfirm.run;
            setActionConfirm(null);
            fn(reason);
          }}
        />
      )}
    </div>
  );
}

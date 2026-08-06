"use client";

import { currentAdminOperator } from "@/lib/admin/current-operator";
import { displayAdminError } from "@/lib/admin/error-messages";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { DataListPager, Drawer, useDataListPager } from "../design-kit";
import {
  fetchImpersonationReadonlyView,
  fetchUserAccountActionAccount,
  fetchUserAccountActionContext,
  fetchUserAccountActionOverview,
  isUsersRequestNotFound,
  UsersRequestError,
  removeUserAccountList,
  revokeUserSessions,
  startUserImpersonation,
  terminateUserImpersonation,
  updateUserStatus,
  upsertUserAccountList,
  type User360Profile,
  type UserAccountActionOverview,
  type UserAccountActionContext,
  type UserAccountListEntry,
  type UserImpersonationSession,
  type UserSession,
  type JsonRecord,
} from "@/lib/admin/user360-client";
import { usePropose } from "@/lib/admin/use-propose";
import { findHighOp } from "@/lib/admin/high-ops-registry";
import { useAdminAuth } from "@/lib/store/admin-auth";
import type { CCtx } from "./types";

const OPERATOR = currentAdminOperator;
const K1_PATH = "/risk/multi-account";

const STATUS_META: Record<string, [label: string, tone: string]> = {
  ACTIVE: ["正常", "ok"],
  FROZEN: ["冻结", "bad"],
  RESTRICTED: ["受限", "warn"],
  BANNED: ["禁用", "bad"],
};

const STATUS_WEIGHT: Record<string, number> = {
  FROZEN: 0,
  RESTRICTED: 1,
  BANNED: 2,
  ACTIVE: 3,
};

const KYC_STATUS_LABELS: Record<string, string> = {
  APPROVED: "已通过",
  PENDING: "待审核",
  REJECTED: "已驳回",
  NONE: "未认证",
};

const IMPERSONATION_STATUS_LABELS: Record<string, string> = {
  ACTIVE: "进行中",
  TERMINATED: "已终止",
  EXPIRED: "已到期",
};

const LIST_STATUS_LABELS: Record<string, string> = {
  ACTIVE: "生效中",
  REMOVED: "已移出",
  EXPIRED: "已到期",
};

const SESSION_STATUS_LABELS: Record<string, string> = {
  ACTIVE: "有效",
  REVOKED: "已吊销",
  EXPIRED: "已到期",
};

function accountStatusLabel(value: unknown) {
  return STATUS_META[text(value).toUpperCase()]?.[0] ?? text(value);
}

function kycStatusLabel(value: unknown) {
  return KYC_STATUS_LABELS[text(value).toUpperCase()] ?? text(value);
}

function impersonationStatusLabel(value: unknown) {
  return IMPERSONATION_STATUS_LABELS[text(value).toUpperCase()] ?? text(value);
}

function listStatusLabel(value: unknown) {
  return LIST_STATUS_LABELS[text(value).toUpperCase()] ?? text(value);
}

function sessionStatusLabel(value: unknown) {
  return SESSION_STATUS_LABELS[text(value).toUpperCase()] ?? text(value);
}

function text(value: unknown, fallback = "—") {
  return value === null || value === undefined || value === "" ? fallback : String(value);
}

function asNumber(value: unknown) {
  const next = Number(value);
  return Number.isFinite(next) ? next : 0;
}

function accountId(account: User360Profile) {
  return account.id === null || account.id === undefined ? "" : String(account.id);
}

function statusOf(account: User360Profile) {
  return text(account.status, "").toUpperCase();
}

function statusMeta(status: string) {
  return STATUS_META[status] ?? [status || "未知", "dim"];
}

function riskTone(score: unknown) {
  const value = asNumber(score);
  if (value >= 70) return "bad";
  if (value >= 40) return "warn";
  return "ok";
}

function displayAccount(account: Pick<User360Profile, "userNo" | "nickname" | "id"> | null | undefined) {
  if (!account) return "—";
  const code = text(account.userNo);
  const name = text(account.nickname, "");
  return name ? `${code} · ${name}` : code;
}

function displayListKind(kind: unknown) {
  return text(kind).toUpperCase() === "BLOCK" ? ["禁入", "bad"] as const : ["信任", "ok"] as const;
}

function formatDate(value: unknown, fallback = "—") {
  if (!value) return fallback;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatAmount(value: unknown) {
  return asNumber(value).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function formatCountdown(totalSeconds: number) {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function errorMessage(error: unknown) {
  return displayAdminError(error);
}

function accountListErrorMessage(error: unknown) {
  if (error instanceof UsersRequestError && error.code === "A4_SCHEMA_NOT_REGISTERED") {
    return "名单未生效，系统事件登记不完整，请联系平台管理员修复配置后重试。";
  }
  return errorMessage(error);
}

function activeSession(session: UserSession) {
  return text(session.status).toUpperCase() === "ACTIVE";
}

function activeListEntry(entry: UserAccountListEntry) {
  if (text(entry.status).toUpperCase() !== "ACTIVE") return false;
  if (!entry.expiresAt) return true;
  const expiresAt = new Date(String(entry.expiresAt));
  return !Number.isNaN(expiresAt.getTime()) && expiresAt.getTime() > Date.now();
}

function maskedSessionId(value: unknown) {
  const raw = text(value, "");
  if (!raw) return "—";
  return raw.length <= 8 ? `••••${raw.slice(-2)}` : `${raw.slice(0, 3)}••••${raw.slice(-4)}`;
}

function activeImpersonation(session: UserImpersonationSession) {
  return text(session.status).toUpperCase() === "ACTIVE";
}

function jsonRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function jsonRecords(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.map(jsonRecord) : [];
}

function ImpersonationUserScreen({ screen }: { screen: JsonRecord }) {
  const template = text(screen.template, "");
  if (template === "H5_HOME") {
    const assets = jsonRecords(screen.assetSummary);
    const devices = jsonRecord(screen.deviceSummary);
    return <div data-testid="impersonation-home-screen">
      <h3 style={{ margin: "14px 0 4px" }}>用户视角首页</h3>
      <p style={{ margin: "0 0 12px", color: "var(--ink-3)" }}>{text(screen.greeting)}</p>
      <div className="row wrap" style={{ gap: 8 }}>{assets.map((asset) => <div className="ctint" key={text(asset.symbol)}><b>{text(asset.symbol)}</b><br />{formatAmount(asset.available)}</div>)}</div>
      <div className="kv"><span className="k">设备概况</span><span className="v">活跃 {text(devices.active, "0")} / 共 {text(devices.total, "0")}</span></div>
      <div className="kv"><span className="k">真实入口</span><span className="v">{Array.isArray(screen.entries) ? screen.entries.join(" · ") : "—"}</span></div>
    </div>;
  }
  if (template === "H5_WALLET") {
    const assets = jsonRecords(screen.assets);
    return <div data-testid="impersonation-wallet-screen">
      <h3 style={{ margin: "14px 0 8px" }}>用户视角钱包</h3>
      {assets.map((asset) => <div className="kv" key={text(asset.symbol)}><span className="k">{text(asset.symbol)} 可用</span><span className="v">{formatAmount(asset.available)}</span></div>)}
      <div className="ctint warn" style={{ marginTop: 10 }}>{text(screen.readOnlyHint)}</div>
    </div>;
  }
  if (template === "H5_DEVICES") {
    const devices = jsonRecords(screen.devices);
    return <div data-testid="impersonation-devices-screen">
      <h3 style={{ margin: "14px 0 8px" }}>用户视角设备</h3>
      <div className="kv"><span className="k">设备概况</span><span className="v">活跃 {text(screen.active, "0")} / 共 {text(screen.total, "0")}</span></div>
      {Boolean(screen.truncated) && <div className="ctint warn" style={{ marginBottom: 10 }}>该用户共有 {text(screen.total, "0")} 台设备，当前按服务器限制展示最近 {text(screen.shown, String(devices.length))} 台。</div>}
      {devices.length > 0 ? <table className="l-tbl"><thead><tr><th>设备</th><th>状态</th><th>算力</th><th>日收益</th></tr></thead><tbody>{devices.map((device) => <tr key={text(device.instanceNo)}><td>{text(device.name)}<br /><span className="mono">{text(device.instanceNo)}</span></td><td>{text(device.status)}</td><td>{formatAmount(device.hashrate)}</td><td>{formatAmount(device.dailyUsdt)} USDT · {formatAmount(device.dailyNex)} NEX</td></tr>)}</tbody></table> : <p className="tiny">该用户暂无设备。</p>}
    </div>;
  }
  return <div data-testid="impersonation-profile-screen">
    <h3 style={{ margin: "14px 0 8px" }}>用户视角我的</h3>
    <div className="kv"><span className="k">用户编码</span><span className="v">{text(screen.userNo)}</span></div>
    <div className="kv"><span className="k">昵称</span><span className="v">{text(screen.nickname)}</span></div>
    <div className="kv"><span className="k">账户 / KYC</span><span className="v">{accountStatusLabel(screen.accountStatus)} · {kycStatusLabel(screen.kycStatus)}</span></div>
    <div className="kv"><span className="k">等级</span><span className="v">{text(screen.userLevel)} / {text(screen.vRank)}</span></div>
    <div className="kv"><span className="k">安全</span><span className="v">2FA {screen.twoFactorEnabled ? "已开启" : "未开启"} · 活跃会话 {text(screen.activeSessions, "0")}</span></div>
  </div>;
}

export function C2Actions({ ctx }: { ctx: CCtx }) {
  const { toast, openActionConfirm } = ctx;
  const session = useAdminAuth((state) => state.session);
  const authorities = session?.authorities ?? [];
  const canFreeze = authorities.includes("user_c2_account_freeze");
  const canUnfreeze = authorities.includes("user_c2_account_unfreeze");
  const canLogout = authorities.includes("user_c2_session_revoke_all");
  const canStartImpersonation = authorities.includes("user_c2_impersonate_start");
  const canTerminateImpersonation = authorities.includes("user_c2_impersonate_terminate");
  const canManageLists = authorities.includes("user_c2_blocklist_add");
  const canOpenK1 = authorities.some((authority) => authority.startsWith("risk_k1_"));
  const freezeProposalOnly = session?.role === "finance"
    && authorities.includes("platform_a2_proposal_create")
    && !authorities.includes("platform_a2_operation_approve");
  const propose = usePropose();
  const [overview, setOverview] = useState<UserAccountActionOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [acct, setAcct] = useState<User360Profile | null>(null);
  const [accountContext, setAccountContext] = useState<UserAccountActionContext | null>(null);
  const [accountContextError, setAccountContextError] = useState<string | null>(null);
  const [trace, setTrace] = useState<UserImpersonationSession | null>(null);
  const [mirror, setMirror] = useState<JsonRecord | null>(null);
  const [mirrorToken, setMirrorToken] = useState("");
  const [mirrorPage, setMirrorPage] = useState("HOME");
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [focusLookupState, setFocusLookupState] = useState<"idle" | "loading" | "found" | "not-found" | "error">("idle");
  const searchParams = useSearchParams();
  const focusUserCode = (searchParams?.get("userCode") ?? "").trim().toUpperCase();

  const loadOverview = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const next = await fetchUserAccountActionOverview();
      setOverview(next);
      setVersion((v) => v + 1);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    if (!mirror) return;
    setNowMs(Date.now());
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [mirror]);

  useEffect(() => {
    if (!mirror?.expiresAt) return;
    const expiresAt = new Date(String(mirror.expiresAt)).getTime();
    if (!Number.isFinite(expiresAt) || nowMs < expiresAt) return;
    setMirror(null);
    setMirrorToken("");
    setMirrorPage("HOME");
    toast("模拟会话已到期，只读镜像已自动关闭；服务端身份已失效。");
    void loadOverview(true);
  }, [loadOverview, mirror, nowMs, toast]);

  const accounts = useMemo(() => {
    return [...(overview?.accounts ?? [])]
      .filter((account) => !!account && !!accountId(account))
      .sort((a, b) => {
        const statusDiff = (STATUS_WEIGHT[statusOf(a)] ?? 9) - (STATUS_WEIGHT[statusOf(b)] ?? 9);
        if (statusDiff !== 0) return statusDiff;
        return asNumber(b.riskScore) - asNumber(a.riskScore);
      });
  }, [overview]);

  useEffect(() => {
    if (!focusUserCode) {
      setFocusLookupState("idle");
      return;
    }
    let active = true;
    setAcct(null);
    setAccountContext(null);
    setAccountContextError(null);
    setFocusLookupState("loading");
    void fetchUserAccountActionContext(focusUserCode)
      .then((context) => {
        if (!active) return;
        const target = context.account;
        if (!target) {
          setFocusLookupState("not-found");
          return;
        }
        if (text(target.userNo).trim().toUpperCase() !== focusUserCode) {
          setFocusLookupState("not-found");
          return;
        }
        setAccountContext(context);
        setAcct(target);
        setFocusLookupState("found");
      })
      .catch((lookupError: unknown) => {
        if (!active) return;
        setFocusLookupState(isUsersRequestNotFound(lookupError) ? "not-found" : "error");
      });
    return () => {
      active = false;
    };
  }, [focusUserCode]);

  const sessions = useMemo(() => overview?.sessions ?? [], [overview]);
  const listRows = useMemo(() => {
    return [...(overview?.accountLists ?? [])].sort((a, b) => {
      const activeDiff = Number(activeListEntry(b)) - Number(activeListEntry(a));
      if (activeDiff !== 0) return activeDiff;
      return formatDate(b.createdAt).localeCompare(formatDate(a.createdAt));
    });
  }, [overview]);
  const impersonations = useMemo(() => overview?.impersonations ?? [], [overview]);
  const controlFacts = useMemo(() => overview?.controlFacts ?? [], [overview]);

  const sessionCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const session of sessions) {
      if (!activeSession(session) || session.userId === null || session.userId === undefined) continue;
      const key = String(session.userId);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [sessions]);

  const selectedAccount = useMemo(() => {
    if (!acct) return null;
    if (accountContext?.account && accountId(accountContext.account) === accountId(acct)) {
      return accountContext.account;
    }
    return accounts.find((account) => accountId(account) === accountId(acct)) ?? acct;
  }, [acct, accountContext, accounts]);

  const traceSession = useMemo(() => {
    if (!trace?.sessionNo) return trace;
    return impersonations.find((session) => session.sessionNo === trace.sessionNo) ?? trace;
  }, [trace, impersonations]);

  const accountPager = useDataListPager(accounts, { initialPageSize: 10, resetKey: version });
  const listPager = useDataListPager(listRows, { initialPageSize: 10, resetKey: version });

  const refreshAccountContext = useCallback(async (userKey: string) => {
    const context = await fetchUserAccountActionContext(userKey);
    if (!context.account) throw new Error("服务器未返回该账户的 C2 权威详情");
    setAccountContext(context);
    setAccountContextError(null);
    setAcct(context.account);
    return context;
  }, []);

  const openAccount = useCallback((account: User360Profile) => {
    const key = accountId(account);
    setAcct(account);
    setAccountContext(null);
    setAccountContextError(null);
    if (!key) {
      setAccountContextError("账户缺少后端 ID，无法读取 C2 权威详情");
      return;
    }
    void refreshAccountContext(key).catch((detailError: unknown) => {
      setAccountContextError(errorMessage(detailError));
    });
  }, [refreshAccountContext]);

  const perform = useCallback(async (
    work: () => Promise<string | void>,
    fallbackMessage: string,
    formatError: (error: unknown) => string = errorMessage,
  ) => {
    setBusy(true);
    try {
      const message = await work();
      await loadOverview(true);
      const selectedKey = acct ? accountId(acct) : "";
      if (selectedKey) await refreshAccountContext(selectedKey);
      toast(message || fallbackMessage);
    } catch (err) {
      toast(formatError(err));
    } finally {
      setBusy(false);
    }
  }, [acct, loadOverview, refreshAccountContext, toast]);

  const resolveAccount = useCallback(async (rawValue: string | undefined) => {
    const raw = (rawValue ?? "").trim();
    if (!raw) {
      throw new Error("请选择用户。");
    }
    const needle = raw.toUpperCase();
    const local = accounts.find((account) =>
      accountId(account) === raw
      || text(account.userNo).toUpperCase() === needle
      || text(account.nickname, "").toUpperCase() === needle);
    if (local) return local;

    const detail = await fetchUserAccountActionAccount(raw);
    if (!detail?.id) {
      throw new Error("没有找到对应用户,请重新选择。");
    }
    return detail;
  }, [accounts]);

  const sessionsFor = useCallback((account: User360Profile | null) => {
    if (!account) return [];
    const id = accountId(account);
    if (accountContext?.account && accountId(accountContext.account) === id) {
      return accountContext.sessions ?? [];
    }
    return sessions.filter((session) => String(session.userId) === id);
  }, [accountContext, sessions]);

  const listFor = useCallback((account: User360Profile | null) => {
    if (!account) return null;
    const id = accountId(account);
    if (accountContext?.account && accountId(accountContext.account) === id) {
      const entry = accountContext.accountList;
      return entry && activeListEntry(entry) ? entry : null;
    }
    return listRows.find((entry) => String(entry.userId) === id && activeListEntry(entry)) ?? null;
  }, [accountContext, listRows]);

  const controlFactFor = useCallback((account: User360Profile | null) => {
    if (!account) return null;
    const id = accountId(account);
    if (accountContext?.account && accountId(accountContext.account) === id) {
      return accountContext.controlFact ?? null;
    }
    return controlFacts.find((fact) => String(fact.userId) === id) ?? null;
  }, [accountContext, controlFacts]);

  const freezeCompletionCopy = freezeProposalOnly
    ? "本次只创建 A2 待确认票；确认执行前业务状态不变。"
    : "具备执行权限；确认后立即落库，并写必达审计与事件。";

  const freeze = (account: User360Profile) => openActionConfirm({
    action: `冻结账户 · ${displayAccount(account)}`,
    detail: freezeProposalOnly
      ? "提交 A2 待确认票；确认执行后才冻结账户、吊销会话并冻结 D2 待处理提现。"
      : "确认后原子冻结账户、吊销活跃会话、冻结 D2 待处理提现，并同步 C2/K1 权威状态。",
    amplifies: false,
    completionCopy: freezeCompletionCopy,
    reasonMin: 8,
    reasonMax: 200,
    businessForm: {
      kind: "multi-field",
      title: "冻结依据",
      fields: [{
        key: "reasonCode", label: "原因分类", inputKind: "select", required: true,
        current: "RISK_HIT",
        options: ["RISK_HIT", "AML_REVIEW", "USER_APPEAL", "JUDICIAL_ASSISTANCE", "OTHER"],
        optionLabels: { RISK_HIT: "风控命中", AML_REVIEW: "反洗钱审查", USER_APPEAL: "用户申诉", JUDICIAL_ASSISTANCE: "司法协查", OTHER: "其他" },
      }],
    },
    run: (reason, _value, businessValue) => {
      const id = accountId(account);
      const reasonCode = businessValue?.reasonCode ?? "";
      if (!id || !reasonCode) return toast("账户或冻结原因分类缺失");
      if (!freezeProposalOnly) {
        void perform(
          () => updateUserStatus(id, "FROZEN", reasonCode, reason, OPERATOR()).then(() => `${displayAccount(account)} 已冻结`),
          "账户已冻结",
        );
        return;
      }
      const def = findHighOp("c2_account_freeze")!;
      void propose(toast, {
        action: `冻结账户 · ${displayAccount(account)}`, obj: id, before: "ACTIVE", after: "FROZEN",
        type: "acct", amplifies: false, gate: { roles: [] }, gateLabel: def.gateLabel, reason,
        sourceDomain: "C2", command: def.buildCommand({ userId: id, reasonCode }), target: def.buildTarget({ userId: id }),
      });
    },
  });

  const unfreeze = (account: User360Profile) => openActionConfirm({
    action: `恢复账户 · ${displayAccount(account)}`,
    detail: freezeProposalOnly
      ? "提交 A2 待确认票；确认前账户与 D2 提现保持冻结。"
      : "确认后仅允许 FROZEN→ACTIVE，并恢复由本次 C2 冻结联动暂停的 D2 提现；已吊销会话不会复活。",
    amplifies: true,
    completionCopy: freezeCompletionCopy,
    reasonMin: 8,
    reasonMax: 200,
    run: (reason) => {
      const id = accountId(account);
      if (!id) return toast("账户缺少后端ID");
      if (!freezeProposalOnly) {
        void perform(
          () => updateUserStatus(id, "ACTIVE", null, reason, OPERATOR()).then(() => `${displayAccount(account)} 已恢复`),
          "账户已恢复",
        );
        return;
      }
      const def = findHighOp("c2_account_unfreeze")!;
      void propose(toast, {
        action: `恢复账户 · ${displayAccount(account)}`, obj: id, before: "FROZEN", after: "ACTIVE",
        type: "acct", amplifies: true, gate: { roles: [] }, gateLabel: def.gateLabel, reason,
        sourceDomain: "C2", command: def.buildCommand({ userId: id }), target: def.buildTarget({ userId: id }),
      });
    },
  });

  const logoutAll = (account: User360Profile) => {
    const activeCount = sessionCounts.get(accountId(account)) ?? 0;
    if (activeCount <= 0) {
      toast("该账户没有活跃会话，无需强制登出");
      return;
    }
    openActionConfirm({
    action: `强制登出 · ${displayAccount(account)}`,
    detail: `确认后立即吊销当前 ${activeCount} 个活跃会话；这是止血动作，财务/风控/客服/超管均直接执行，重复提交同一幂等键不会二次执行。`,
    amplifies: false,
    completionCopy: "确认后立即执行，并写必达审计与事件。",
    reasonMin: 8,
    reasonMax: 200,
    run: (reason) => {
      const id = accountId(account);
      if (!id) return toast("账户缺少后端ID");
      void perform(
        () => revokeUserSessions(id, reason, OPERATOR()).then(() => `${displayAccount(account)} 已强制登出`),
        "会话已吊销",
      );
    },
    });
  };

  const startImp = () => openActionConfirm({
    action: "发起只读模拟登录",
    detail: "确认后签发只在内存中保存的限时身份，并立即打开服务端用户 H5 镜像；所有写请求由服务器统一返回 403。",
    amplifies: false,
    completionCopy: "确认后立即执行，并写必达审计与事件。",
    reasonMin: 8,
    reasonMax: 200,
    businessForm: {
      kind: "multi-field",
      title: "只读模拟登录参数",
      fields: [
        { key: "userCode", label: "用户编码或后端ID", inputKind: "text", required: true, current: text(accounts[0]?.userNo, "") },
        { key: "ttlMinutes", label: "有效期", inputKind: "select", required: true, current: "15", options: ["5", "10", "15", "30"], optionLabels: { "5": "5 分钟", "10": "10 分钟", "15": "15 分钟", "30": "30 分钟" } },
        { key: "reasonCode", label: "授权分类", inputKind: "select", required: true, current: "USER_ISSUE_REPRO", options: ["USER_ISSUE_REPRO", "DISPLAY_ANOMALY", "OTHER"], optionLabels: { USER_ISSUE_REPRO: "用户报障复现", DISPLAY_ANOMALY: "排查显示异常", OTHER: "其他" } },
      ],
    },
    run: (reason, _value, businessValue) => {
      void (async () => {
        try {
          const target = await resolveAccount(businessValue?.userCode);
          const id = accountId(target);
          const ttlMinutes = Number(businessValue?.ttlMinutes);
          const reasonCode = businessValue?.reasonCode ?? "";
          if (!id || ![5, 10, 15, 30].includes(ttlMinutes) || !reasonCode) throw new Error("模拟登录参数不完整");
          await perform(async () => {
            const result = await startUserImpersonation(id, reasonCode, reason, OPERATOR(), ttlMinutes);
            const accessToken = text(result.accessToken, "");
            if (!accessToken) throw new Error("服务器未返回只读模拟身份");
            setMirrorToken(accessToken);
            setMirrorPage("HOME");
            setMirror(await fetchImpersonationReadonlyView(accessToken, "HOME"));
            return `${displayAccount(target)} 的只读镜像已打开`;
          }, "只读镜像已打开");
        } catch (err) {
          toast(errorMessage(err));
        }
      })();
    },
  });

  const endImp = (session: UserImpersonationSession) => openActionConfirm({
    action: `终止模拟会话 · ${text(session.sessionNo)}`,
    detail: "确认后立即失效模拟身份；旧令牌下一次请求即被服务器拒绝。",
    amplifies: false,
    completionCopy: "确认后立即执行，并写必达审计与事件。",
    reasonMin: 8,
    reasonMax: 200,
    run: (reason) => {
      const sessionNo = text(session.sessionNo, "");
      if (!sessionNo) return toast("会话缺少 sessionNo");
      void perform(
        () => terminateUserImpersonation(sessionNo, reason, OPERATOR()).then(() => `模拟会话 ${sessionNo} 已终止`),
        "模拟会话已终止",
      );
    },
  });

  const exitMirror = () => {
    const sessionNo = text(mirror?.sessionNo, "");
    if (!sessionNo) return toast("当前只读镜像缺少服务端会话编号，请在模拟会话列表中终止。");
    openActionConfirm({
      action: `退出并终止模拟会话 · ${sessionNo}`,
      detail: "确认后立即终止服务端只读身份并关闭当前镜像；旧令牌下一次请求会被拒绝。",
      amplifies: false,
      completionCopy: "终止结果写入必达审计与事件；页面随后回读服务端状态。",
      reasonMin: 8,
      reasonMax: 200,
      run: (reason) => {
        void perform(async () => {
          await terminateUserImpersonation(sessionNo, reason, OPERATOR());
          setMirror(null);
          setMirrorToken("");
          return `模拟会话 ${sessionNo} 已退出并终止`;
        }, "模拟会话已退出并终止");
      },
    });
  };

  const addList = (kind: "ALLOW" | "BLOCK") => openActionConfirm({
    action: kind === "ALLOW" ? "加入信任名单" : "加入禁入名单",
    detail: "确认后立即写入服务器名单；指定失效日到期后自动显示为已到期。",
    amplifies: false,
    completionCopy: "确认后立即执行，并写必达审计与事件。",
    reasonMin: 8,
    reasonMax: 200,
    businessForm: {
      kind: "multi-field",
      title: "名单有效期",
      fields: [
        { key: "userCode", label: "用户编码或后端ID", inputKind: "text", required: true, current: text(accounts[0]?.userNo, "") },
        { key: "expiryMode", label: "有效期", inputKind: "select", required: true, current: "PERMANENT", options: ["PERMANENT", "SPECIFIED"], optionLabels: { PERMANENT: "长期", SPECIFIED: "指定日期" } },
        { key: "expiresAt", label: "失效日期", inputKind: "text", required: true, placeholder: "YYYY-MM-DD", visibleWhen: { key: "expiryMode", equals: "SPECIFIED" } },
      ],
    },
    run: (reason, _value, businessValue) => {
      void (async () => {
        try {
          const target = await resolveAccount(businessValue?.userCode);
          const id = accountId(target);
          const expiresAt = businessValue?.expiryMode === "SPECIFIED" ? businessValue.expiresAt : null;
          if (!id || (businessValue?.expiryMode === "SPECIFIED" && !expiresAt)) throw new Error("名单用户或失效日期缺失");
          await perform(
            () => upsertUserAccountList(id, kind, reason, OPERATOR(), expiresAt).then(() => `${displayAccount(target)} 名单已生效`),
            "名单已更新",
            accountListErrorMessage,
          );
        } catch (err) {
          toast(accountListErrorMessage(err));
        }
      })();
    },
  });

  const rmList = (entry: UserAccountListEntry) => openActionConfirm({
    action: `移出名单 · ${displayAccount(entry)}`,
    detail: "确认后立即恢复默认风控判定，并保留名单历史。",
    amplifies: false,
    completionCopy: "确认后立即执行，并写必达审计与事件。",
    reasonMin: 8,
    reasonMax: 200,
    run: (reason) => {
      if (entry.userId === null || entry.userId === undefined) return toast("名单行缺少 userId");
      const id = String(entry.userId);
      void perform(
        () => removeUserAccountList(id, reason, OPERATOR()).then(() => `${displayAccount(entry)} 已移出名单`),
        "已移出名单",
        accountListErrorMessage,
      );
    },
  });

  if (!overview) {
    return (
      <section className="l-card">
        <div className="l-h"><span className="ttl">账户操作</span><span className="sub">· 安全失败关闭</span></div>
        <div className="l-b">
          <div className={`ctint ${error ? "bad" : ""}`} role={error ? "alert" : "status"}>
            {loading
              ? "C2 数据加载中，账户处置暂不可操作…"
              : (error ? `C2 数据加载失败 · ${error}` : "C2 数据暂不可用，账户处置已停止展示和写入。")}
          </div>
          {!loading && (
            <button className="l-btn" style={{ marginTop: 12 }} onClick={() => void loadOverview()}>
              重新加载
            </button>
          )}
        </div>
      </section>
    );
  }

  const frozenUsers = asNumber(overview?.frozenUsers);
  const activeImps = impersonations.filter(activeImpersonation);
  const liveLeftMin = activeImps.length > 0 ? Math.max(...activeImps.map((session) => asNumber(session.leftMinutes))) : 0;
  const mirrorExpiresMs = mirror?.expiresAt ? new Date(String(mirror.expiresAt)).getTime() : Number.NaN;
  const mirrorRemainingSeconds = Number.isFinite(mirrorExpiresMs)
    ? Math.max(0, Math.ceil((mirrorExpiresMs - nowMs) / 1000))
    : 0;

  return (
    <>
      {focusUserCode && (
        <div className="ctint" role="status" style={{ marginBottom: 12 }}>
          已从 J3 带入用户 <b>{focusUserCode}</b>；
          {focusLookupState === "loading" && "正在向服务器精确查询该账户…"}
          {focusLookupState === "found" && "已按服务器查询结果打开该用户的 C2 处置上下文。"}
          {focusLookupState === "not-found" && "服务器未找到该用户，因此没有预选处置对象；下方仍保留当前账户列表，请返回 J3 刷新后重试。"}
          {focusLookupState === "error" && "账户查询失败，因此没有预选处置对象；下方仍保留当前账户列表，请检查网络后刷新重试。"}
        </div>
      )}
      <div className="f-stats">
        <div className="f-stat danger"><div className="k">冻结中账户</div><div className="v">{loading ? "…" : frozenUsers}</div><div className="sub">来自账户状态统计</div></div>
        <div className="f-stat warn"><div className="k">进行中的模拟登录</div><div className="v">{loading ? "…" : asNumber(overview?.activeImpersonations)}</div><div className="sub">{liveLeftMin > 0 ? `最长剩 ${liveLeftMin} 分钟` : "当前无进行中会话"}</div></div>
        <div className="f-stat"><div className="k">信任名单</div><div className="v">{loading ? "…" : asNumber(overview?.trustListCount)}</div><div className="sub">服务端名单 · ALLOW</div></div>
        <div className="f-stat"><div className="k">禁入名单</div><div className="v">{loading ? "…" : asNumber(overview?.blockedListCount)}</div><div className="sub">服务端名单 · BLOCK</div></div>
      </div>

      {error && (
        <div className="alertbar danger" style={{ marginBottom: 12 }}>
          <span className="ico">!</span>
          <div className="tiny">C2 数据加载失败 · {error}</div>
          <button className="l-btn sm" style={{ marginLeft: "auto" }} onClick={() => void loadOverview()}>重试</button>
        </div>
      )}

      {!loading && (
        asNumber(overview?.totalAccounts) > accounts.length
        || asNumber(overview?.totalAccountLists) > listRows.length
        || asNumber(overview?.totalSessions) > sessions.length
        || asNumber(overview?.totalImpersonations) > impersonations.length
      ) && (
        <div className="ctint" style={{ marginBottom: 12 }}>
          当前页展示服务端最近记录：账户 {accounts.length}/{asNumber(overview?.totalAccounts)}、名单 {listRows.length}/{asNumber(overview?.totalAccountLists)}、会话 {sessions.length}/{asNumber(overview?.totalSessions)}、模拟登录 {impersonations.length}/{asNumber(overview?.totalImpersonations)}；上方统计值来自全量聚合，不受展示上限影响。
        </div>
      )}

      <div className="two-col">
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">账户处置</span>
            <span className="sub">· 冻结 / 恢复 / 强制登出</span>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="l-tbl" style={{ minWidth: 820 }}>
              <thead><tr><th>用户编码</th><th>姓名</th><th>状态</th><th>风险</th><th>活跃会话</th><th style={{ textAlign: "right" }}>动作</th></tr></thead>
              <tbody>
                {accountPager.pageRows.map((account) => {
                  const status = statusOf(account);
                  const [label, tone] = statusMeta(status);
                  const locked = status === "FROZEN";
                  return (
                    <tr className={`click${locked ? " frozen-row" : ""}`} key={accountId(account)} onClick={() => openAccount(account)}>
                      <td className="mono" style={{ fontWeight: 600, color: "var(--ink)" }}>{text(account.userNo, accountId(account))} <span style={{ fontSize: 10.5, color: "var(--c-ac)" }}>详情›</span></td>
                      <td>{text(account.nickname)}</td>
                      <td><span className={`bdg ${tone}`}>{label}</span></td>
                      <td><span className={`bdg ${riskTone(account.riskScore)}`}>{text(account.riskScore)}</span></td>
                      <td className="mono">{sessionCounts.get(accountId(account)) ?? 0} 个</td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        {status === "ACTIVE" && canFreeze && <button disabled={busy} className="l-btn sm mc" onClick={(e) => { e.stopPropagation(); freeze(account); }}>冻结</button>}
                        {status === "FROZEN" && canUnfreeze && <button disabled={busy} className="l-btn sm mc" onClick={(e) => { e.stopPropagation(); unfreeze(account); }}>恢复</button>}
                        {canLogout && <button disabled={busy || (sessionCounts.get(accountId(account)) ?? 0) <= 0} className="l-btn sm" style={{ marginLeft: 6 }} onClick={(e) => { e.stopPropagation(); logoutAll(account); }}>强制登出</button>}
                        {!canFreeze && !canUnfreeze && !canLogout && <span className="tiny">只读</span>}
                      </td>
                    </tr>
                  );
                })}
                {!loading && accountPager.pageRows.length === 0 && (
                  <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--ink-4)", padding: "22px 12px" }}>暂无账户处置数据</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <DataListPager
            label="C2 账户处置"
            page={accountPager.page}
            pageSize={accountPager.pageSize}
            total={accountPager.total}
            onPageChange={accountPager.setPage}
            onPageSizeChange={accountPager.setPageSize}
          />
        </section>

        <section className="l-card">
          <div className="l-h">
            <span className="ttl">模拟登录控制台</span>
            <span className="sub">· 服务端模拟会话</span>
            <div className="r">{canStartImpersonation && <button disabled={busy} className="l-btn mc" onClick={startImp}>发起模拟登录</button>}</div>
          </div>
          <div className="l-b">
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>进行中 / 近期会话</div>
            {impersonations.map((session) => {
              const active = activeImpersonation(session);
              return (
                <div className="imp-row" key={text(session.sessionNo)}>
                  <span className="mono" style={active ? { fontWeight: 600, color: "var(--ink)" } : { color: "var(--ink-3)" }}>{text(session.operator)} → {text(session.userNo)}</span>
                  {active ? <span className="bdg warn">进行中 · 只读</span> : <span className="bdg dim">{impersonationStatusLabel(session.status)}</span>}
                  {active && (
                    <span className="ttlbar">
                      <span className="track"><i style={{ width: `${Math.min(100, Math.max(4, (asNumber(session.leftMinutes) / Math.max(1, asNumber(session.ttlMinutes))) * 100))}%` }} /></span>
                      <span className="mono" style={{ fontSize: 11.5, color: "var(--warning)" }}>剩 {asNumber(session.leftMinutes)} 分钟</span>
                    </span>
                  )}
                  <button className="l-btn sm" onClick={() => setTrace(session)}>看轨迹</button>
                  {active && canTerminateImpersonation && <button disabled={busy} className="l-btn sm" onClick={() => endImp(session)}>立即终止</button>}
                </div>
              );
            })}
            {!loading && impersonations.length === 0 && (
              <div style={{ fontSize: 12, color: "var(--ink-4)", lineHeight: 1.55 }}>暂无模拟登录会话。</div>
            )}
            <div className="ctint warn" style={{ marginTop: 12, fontSize: 12 }}><b>只读边界</b> · 服务器签发 claim=impersonate_readonly 的限时身份；只允许访问 H5 镜像读接口，任意写请求统一返回 403。</div>
          </div>
        </section>
      </div>

      <section className="l-card">
        <div className="l-h">
          <span className="ttl">信任 / 禁入名单</span>
          <span className="sub">· 账户级名单</span>
          <div className="r">
            {canManageLists && <button disabled={busy} className="l-btn mc" onClick={() => addList("ALLOW")}>+ 加入信任名单</button>}
            {canManageLists && <button disabled={busy} className="l-btn mc" onClick={() => addList("BLOCK")}>+ 加入禁入名单</button>}
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 860 }}>
            <thead><tr><th>用户编码</th><th>姓名</th><th>名单</th><th>状态</th><th>原因</th><th>失效时间</th><th>确认</th><th style={{ textAlign: "right" }}>动作</th></tr></thead>
            <tbody>
              {listPager.pageRows.map((entry) => {
                const [kindLabel, kindTone] = displayListKind(entry.kind);
                const entryActive = activeListEntry(entry);
                const entryStatus = !entryActive && text(entry.status).toUpperCase() === "ACTIVE" ? "EXPIRED" : text(entry.status);
                return (
                  <tr key={`${text(entry.userId)}-${text(entry.kind)}-${text(entry.status)}`}>
                    <td className="mono" style={{ fontWeight: 600, color: "var(--ink)" }}>{text(entry.userNo)}</td>
                    <td>{text(entry.nickname)}</td>
                    <td><span className={`bdg ${kindTone}`}>{kindLabel}</span></td>
                    <td><span className={`bdg ${entryActive ? "ok" : "dim"}`}>{entryActive ? "生效中" : listStatusLabel(entryStatus)}</span></td>
                    <td style={{ fontSize: 12, color: "var(--ink-3)" }}>{text(entry.reason)}</td>
                    <td className="mono" style={{ fontSize: 11.5 }}>{formatDate(entry.expiresAt, "长期")}</td>
                    <td className="mono" style={{ fontSize: 11.5, color: "var(--ink-4)" }}>{text(entry.createdBy)} · {formatDate(entry.createdAt)}</td>
                    <td style={{ textAlign: "right" }}>
                      {canManageLists && <button disabled={busy || !entryActive} className="l-btn sm mc" onClick={() => rmList(entry)}>移出名单</button>}
                    </td>
                  </tr>
                );
              })}
              {!loading && listPager.pageRows.length === 0 && (
                <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--ink-4)", padding: "22px 12px" }}>暂无名单数据</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <DataListPager
          label="C2 信任禁入名单"
          page={listPager.page}
          pageSize={listPager.pageSize}
          total={listPager.total}
          onPageChange={listPager.setPage}
          onPageSizeChange={listPager.setPageSize}
        />
      </section>

      <p className="f-foot"><b>动作确认口径</b>：{freezeProposalOnly ? "当前财务角色的冻结/恢复只创建 A2 待确认票；强制登出是止血动作，确认后立即执行。" : "当前角色可直接执行其获授权动作，确认后原子落库。"} 所有动作均要求 8-200 字理由、24 小时幂等、必达审计与事件；刷新后以服务器返回为准。</p>

      {selectedAccount && (() => {
        const status = statusOf(selectedAccount);
        const [statusLabel, statusTone] = statusMeta(status);
        const accountSessions = sessionsFor(selectedAccount);
        const listEntry = listFor(selectedAccount);
        const controlFact = controlFactFor(selectedAccount);
        return (
          <Drawer
            title={`账户明细 · ${displayAccount(selectedAccount)}`}
            onClose={() => { setAcct(null); setAccountContext(null); setAccountContextError(null); }}
            footer={canOpenK1 ? <Link className="l-btn" style={{ flex: 1, justifyContent: "center" }} href={K1_PATH}>去 K1 看反多账户簇 →</Link> : undefined}
          >
            <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink)" }}>{displayAccount(selectedAccount)} · <span className={`bdg ${statusTone}`}>{statusLabel}</span></div>
            <div style={{ fontSize: 12, color: "var(--ink-3)", lineHeight: 1.55, margin: "4px 0 12px" }}>详情来自后端按该用户精确查询的 C2 权威上下文，不受总览截断影响。</div>
            {accountContextError && <div className="ctint bad" role="alert" style={{ marginBottom: 12 }}>账户详情回读失败：{accountContextError}。当前停止使用旧详情执行处置，请重新打开后再试。</div>}

            <div style={{ fontSize: 13, fontWeight: 600, margin: "14px 0 4px" }}>账户概览</div>
            <div className="kv"><span className="k">用户编码</span><span className="v">{text(selectedAccount.userNo)}</span></div>
            <div className="kv"><span className="k">手机号</span><span className="v">{text(selectedAccount.phoneMasked)}</span></div>
            <div className="kv"><span className="k">KYC</span><span className="v">{kycStatusLabel(selectedAccount.kycStatus)}</span></div>
            <div className="kv"><span className="k">等级</span><span className="v">{text(selectedAccount.userLevel)} / {text(selectedAccount.vRank)}</span></div>
            <div className="kv"><span className="k">余额</span><span className="v">{formatAmount(selectedAccount.walletUsdt)} USDT · {formatAmount(selectedAccount.walletNex)} NEX</span></div>
            <div className="kv"><span className="k">风险分</span><span className="v">{text(selectedAccount.riskScore, "0")} · {text(selectedAccount.riskBand, "未分档")}</span></div>
            <div className="kv"><span className="k">当前名单</span><span className="v">{listEntry ? `${displayListKind(listEntry.kind)[0]} · ${text(listEntry.reason)}` : "无生效名单"}</span></div>
            <div className="kv"><span className="k">活跃会话</span><span className="v">{accountContext?.account && accountId(accountContext.account) === accountId(selectedAccount) ? asNumber(accountContext.activeSessions) : accountSessions.filter(activeSession).length} 个</span></div>
            {accountContext?.sessionsTruncated && <div className="ctint warn" style={{ marginTop: 8 }}>该用户共有 {asNumber(accountContext.totalSessions)} 条会话记录，当前展示最近 {accountSessions.length} 条；活跃数量由服务端全量统计。</div>}

            {status === "FROZEN" && <>
              <div style={{ fontSize: 13, fontWeight: 600, margin: "14px 0 4px" }}>冻结事实与 D2 联动</div>
              <div className="kv"><span className="k">冻结来源</span><span className="v">{text(controlFact?.freezeSource, "历史冻结")}{controlFact?.freezeSourceRef ? ` · ${text(controlFact.freezeSourceRef)}` : ""}</span></div>
              <div className="kv"><span className="k">原因</span><span className="v">{text(controlFact?.freezeReason, "历史数据未记录")}</span></div>
              <div className="kv"><span className="k">操作者 / 时间</span><span className="v">{text(controlFact?.freezeOperator, "—")} · {formatDate(controlFact?.frozenAt)}</span></div>
              <div className="kv"><span className="k">D2 冻结提现</span><span className="v">{text(controlFact?.d2FrozenWithdrawalCount, "0")} 笔 · 仅随同一来源恢复</span></div>
            </>}

            <div style={{ fontSize: 13, fontWeight: 600, margin: "14px 0 6px" }}>会话</div>
            {accountSessions.length > 0 ? (
              <table className="l-tbl">
                <thead><tr><th>会话</th><th>IP</th><th>设备</th><th>状态</th><th>到期</th></tr></thead>
                <tbody>
                  {accountSessions.map((session) => (
                    <tr key={text(session.refreshTokenId)}>
                      <td className="mono" style={{ fontSize: 11.5 }}>{maskedSessionId(session.refreshTokenId)}</td>
                      <td className="mono" style={{ fontSize: 11.5 }}>{text(session.clientIpMasked)}</td>
                      <td style={{ fontSize: 12 }}>{text(session.deviceName)}</td>
                      <td><span className={`bdg ${activeSession(session) ? "ok" : "dim"}`}>{sessionStatusLabel(session.status)}</span></td>
                      <td className="mono" style={{ fontSize: 11.5, color: "var(--ink-4)" }}>{formatDate(session.expiresAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div style={{ fontSize: 12, color: "var(--ink-4)", lineHeight: 1.55 }}>该账户暂无会话记录。</div>
            )}

            <div style={{ fontSize: 13, fontWeight: 600, margin: "14px 0 4px" }}>处置入口</div>
            <div className="row wrap" style={{ gap: 8 }}>
              {status === "ACTIVE" && canFreeze && <button disabled={busy || !!accountContextError} className="l-btn sm mc" onClick={() => freeze(selectedAccount)}>冻结</button>}
              {status === "FROZEN" && canUnfreeze && <button disabled={busy || !!accountContextError} className="l-btn sm mc" onClick={() => unfreeze(selectedAccount)}>恢复</button>}
              {canLogout && <button disabled={busy || !!accountContextError || (accountContext?.account && accountId(accountContext.account) === accountId(selectedAccount) ? asNumber(accountContext.activeSessions) : accountSessions.filter(activeSession).length) <= 0} className="l-btn sm" onClick={() => logoutAll(selectedAccount)}>强制登出</button>}
            </div>
          </Drawer>
        );
      })()}

      {traceSession && (
        <Drawer title={`模拟会话轨迹 · ${text(traceSession.sessionNo)}`} onClose={() => setTrace(null)}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink)" }}>
            {activeImpersonation(traceSession) ? `进行中 · 只读 · 剩 ${asNumber(traceSession.leftMinutes)} 分钟` : `${impersonationStatusLabel(traceSession.status)} · 起止写入服务端记录`}
          </div>
          <div style={{ fontSize: 12, color: "var(--ink-3)", lineHeight: 1.55, margin: "4px 0 12px" }}>该抽屉只展示服务端模拟会话字段；逐页浏览轨迹可在 A2 审计中查询。</div>

          <div className="kv"><span className="k">用户编码</span><span className="v">{text(traceSession.userNo)}</span></div>
          <div className="kv"><span className="k">操作者</span><span className="v">{text(traceSession.operator)}</span></div>
          <div className="kv"><span className="k">授权理由</span><span className="v">{text(traceSession.reason)}</span></div>
          <div className="kv"><span className="k">创建时间</span><span className="v">{formatDate(traceSession.createdAt)}</span></div>
          <div className="kv"><span className="k">到期时间</span><span className="v">{formatDate(traceSession.expiresAt)}</span></div>
          <div className="kv"><span className="k">结束人</span><span className="v">{text(traceSession.endedBy)}</span></div>
          <div className="kv"><span className="k">结束原因</span><span className="v">{text(traceSession.endReason)}</span></div>
          {activeImpersonation(traceSession) && canTerminateImpersonation && (
            <button disabled={busy} className="l-btn mc" style={{ marginTop: 14 }} onClick={() => endImp(traceSession)}>立即终止</button>
          )}
        </Drawer>
      )}

      {mirror && (
        <Drawer title={`用户 H5 只读镜像 · ${text(jsonRecord(mirror.user).userNo)}`} onClose={() => { setMirror(null); setMirrorToken(""); }}>
          <div className="ctint warn" style={{ marginBottom: 12 }}>
            <b>模拟登录中 · 全程只读</b>　剩余 <b data-testid="impersonation-countdown">{formatCountdown(mirrorRemainingSeconds)}</b> · 到期 {formatDate(mirror.expiresAt)}
            <div style={{ marginTop: 6 }}>右上角关闭仅收起镜像，会话仍在服务端计时；完成排查请使用“退出并终止”。</div>
          </div>
          <ImpersonationUserScreen screen={jsonRecord(mirror.screen)} />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
            {[["HOME", "首页"], ["WALLET", "钱包"], ["DEVICES", "设备"], ["PROFILE", "我的"]].map(([page, label]) => (
              <button
                key={page}
                disabled={busy || page === mirrorPage}
                className={page === mirrorPage ? "l-btn mc" : "l-btn"}
                onClick={async () => {
                  if (!mirrorToken) return;
                  setBusy(true);
                  try {
                    setMirror(await fetchImpersonationReadonlyView(mirrorToken, page));
                    setMirrorPage(page);
                  } catch (err) {
                    toast(errorMessage(err));
                  } finally {
                    setBusy(false);
                  }
                }}
              >{label}</button>
            ))}
          </div>
          {canTerminateImpersonation && <button disabled={busy} className="l-btn mc" style={{ width: "100%", justifyContent: "center", marginTop: 14 }} onClick={exitMirror}>退出并终止模拟会话</button>}
          <div style={{ fontSize: 11.5, color: "var(--ink-4)", lineHeight: 1.5, marginTop: 8 }}>安全声明：claim={text(mirror.claim)} · 写策略={text(mirror.writePolicy)}；所有写请求由服务端拒绝。</div>
          <p className="tiny" style={{ marginTop: 14 }}>当前页签：{text(mirror.currentPage, mirrorPage)}。以上为服务端按真实用户数据生成的页面级只读视图；每次页签访问均写必达审计，所有写入口保持禁用。</p>
        </Drawer>
      )}
    </>
  );
}

"use client";

import { currentAdminOperator } from "@/lib/admin/current-operator";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { DataListPager, Drawer, useDataListPager } from "../design-kit";
import {
  fetchUser360,
  fetchUserAccountActionAccount,
  fetchUserAccountActionOverview,
  isUsersRequestNotFound,
  removeUserAccountList,
  revokeUserSessions,
  startUserImpersonation,
  terminateUserImpersonation,
  updateUserStatus,
  upsertUserAccountList,
  type User360Profile,
  type UserAccountActionOverview,
  type UserAccountListEntry,
  type UserImpersonationSession,
  type UserSession,
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

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "C2_REQUEST_FAILED";
}

function activeSession(session: UserSession) {
  return text(session.status).toUpperCase() === "ACTIVE";
}

function activeListEntry(entry: UserAccountListEntry) {
  return text(entry.status).toUpperCase() === "ACTIVE";
}

function activeImpersonation(session: UserImpersonationSession) {
  return text(session.status).toUpperCase() === "ACTIVE";
}

export function C2Actions({ ctx }: { ctx: CCtx }) {
  const { toast, openActionConfirm } = ctx;
  const authorities = useAdminAuth((state) => state.session?.authorities ?? []);
  const canStartImpersonation = authorities.includes("user_c2_impersonate_start");
  const propose = usePropose();
  const [overview, setOverview] = useState<UserAccountActionOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [acct, setAcct] = useState<User360Profile | null>(null);
  const [trace, setTrace] = useState<UserImpersonationSession | null>(null);
  const [focusLookupState, setFocusLookupState] = useState<"idle" | "loading" | "found" | "not-found" | "error">("idle");
  const searchParams = useSearchParams();
  const focusUserCode = (searchParams.get("userCode") ?? "").trim().toUpperCase();

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
    setFocusLookupState("loading");
    void fetchUserAccountActionAccount(focusUserCode)
      .then((target) => {
        if (!active) return;
        if (text(target.userNo).trim().toUpperCase() !== focusUserCode) {
          setFocusLookupState("not-found");
          return;
        }
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
    return accounts.find((account) => accountId(account) === accountId(acct)) ?? acct;
  }, [acct, accounts]);

  const traceSession = useMemo(() => {
    if (!trace?.sessionNo) return trace;
    return impersonations.find((session) => session.sessionNo === trace.sessionNo) ?? trace;
  }, [trace, impersonations]);

  const accountPager = useDataListPager(accounts, { initialPageSize: 10, resetKey: version });
  const listPager = useDataListPager(listRows, { initialPageSize: 10, resetKey: version });

  const perform = useCallback(async (work: () => Promise<string | void>, fallbackMessage: string) => {
    setBusy(true);
    try {
      const message = await work();
      await loadOverview(true);
      toast(message || fallbackMessage);
    } catch (err) {
      toast(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }, [loadOverview, toast]);

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

    const detail = await fetchUser360(raw);
    if (!detail?.profile?.id) {
      throw new Error("没有找到对应用户,请重新选择。");
    }
    return detail.profile;
  }, [accounts]);

  const sessionsFor = useCallback((account: User360Profile | null) => {
    if (!account) return [];
    const id = accountId(account);
    return sessions.filter((session) => String(session.userId) === id);
  }, [sessions]);

  const listFor = useCallback((account: User360Profile | null) => {
    if (!account) return null;
    const id = accountId(account);
    return listRows.find((entry) => String(entry.userId) === id && activeListEntry(entry)) ?? null;
  }, [listRows]);

  const freeze = (account: User360Profile) => openActionConfirm({
    action: `冻结账户 · ${displayAccount(account)}`,
    detail: "确认后写入 A2 待确认队列,由门槛者执行后落账户状态为 FROZEN,并同步吊销该用户全部活跃会话。刷新后以服务端账户与会话查询结果为准。",
    amplifies: false,
    run: (reason) => {
      const id = accountId(account);
      if (!id) return toast("账户缺少后端ID");
      const def = findHighOp("c2_account_freeze")!;
      void propose(toast, {
        action: `冻结账户 · ${displayAccount(account)}`,
        obj: id,
        before: "ACTIVE",
        after: "FROZEN",
        type: "acct",
        amplifies: false,
        gate: { roles: [] },
        gateLabel: def.gateLabel,
        reason,
        sourceDomain: "C2",
        command: def.buildCommand({ userId: id }),
        target: def.buildTarget({ userId: id }),
      });
    },
  });

  const unfreeze = (account: User360Profile) => openActionConfirm({
    action: `恢复账户 · ${displayAccount(account)}`,
    detail: "恢复后账户状态改回 ACTIVE。提交后进入 A2 待确认队列,门槛者确认后落库。已被踢下线的会话不会复活,用户需要重新登录。",
    amplifies: true,
    run: (reason) => {
      const id = accountId(account);
      if (!id) return toast("账户缺少后端ID");
      const def = findHighOp("c2_account_unfreeze")!;
      void propose(toast, {
        action: `恢复账户 · ${displayAccount(account)}`,
        obj: id,
        before: "FROZEN",
        after: "ACTIVE",
        type: "acct",
        amplifies: true,
        gate: { roles: [] },
        gateLabel: def.gateLabel,
        reason,
        sourceDomain: "C2",
        command: def.buildCommand({ userId: id }),
        target: def.buildTarget({ userId: id }),
      });
    },
  });

  const logoutAll = (account: User360Profile) => openActionConfirm({
    action: `强制登出 · ${displayAccount(account)}`,
    detail: `吊销该用户当前 ${sessionCounts.get(accountId(account)) ?? 0} 个活跃会话。提交后进入 A2 待确认队列,门槛者确认后整链吊销并写 C2 会话处置审计。`,
    amplifies: false,
    run: (reason) => {
      const id = accountId(account);
      if (!id) return toast("账户缺少后端ID");
      const def = findHighOp("c2_session_revoke_all")!;
      void propose(toast, {
        action: `强制登出 · ${displayAccount(account)}`,
        obj: id,
        before: `${sessionCounts.get(accountId(account)) ?? 0} 个活跃会话`,
        after: "0 个活跃会话",
        type: "acct",
        amplifies: false,
        gate: { roles: [] },
        gateLabel: def.gateLabel,
        reason,
        sourceDomain: "C2",
        command: def.buildCommand({ userId: id }),
        target: def.buildTarget({ userId: id }),
      });
    },
  });

  const startImp = () => openActionConfirm({
    action: "发起模拟登录",
    detail: "输入用户编码或后端ID。确认后提交 A2 待确认队列,门槛者确认后创建后端 impersonation 会话,刷新后在近期会话里展示真实 sessionNo 和剩余时间。",
    amplifies: false,
    edit: { kind: "text", current: accounts[0]?.userNo ?? "U00000000", unit: "用户编码" },
    run: (reason, value) => {
      void (async () => {
        try {
          const target = await resolveAccount(value);
          const id = accountId(target);
          if (!id) { toast("账户缺少后端ID"); return; }
          const def = findHighOp("c2_impersonate_start")!;
          await propose(toast, {
            action: `发起模拟登录 · ${displayAccount(target)}`,
            obj: id,
            before: "—",
            after: "只读 30min",
            type: "acct",
            amplifies: false,
            gate: { roles: [] },
            gateLabel: def.gateLabel,
            reason,
            sourceDomain: "C2",
            command: def.buildCommand({ userId: id, ttlMinutes: 30 }),
            target: def.buildTarget({ userId: id }),
          });
        } catch (err) {
          toast(errorMessage(err));
        }
      })();
    },
  });

  const endImp = (session: UserImpersonationSession) => openActionConfirm({
    action: `终止模拟会话 · ${text(session.sessionNo)}`,
    detail: `立即终止 ${displayAccount(session)} 的 impersonation 会话。提交后进入 A2 待确认队列,门槛者确认后结束人和原因写入后端记录。`,
    amplifies: false,
    run: (reason) => {
      const sessionNo = text(session.sessionNo, "");
      if (!sessionNo) return toast("会话缺少 sessionNo");
      const def = findHighOp("c2_impersonate_terminate")!;
      void propose(toast, {
        action: `终止模拟会话 · ${sessionNo}`,
        obj: sessionNo,
        before: "ACTIVE",
        after: "TERMINATED",
        type: "acct",
        amplifies: false,
        gate: { roles: [] },
        gateLabel: def.gateLabel,
        reason,
        sourceDomain: "C2",
        command: def.buildCommand({ sessionNo }),
        target: def.buildTarget({ sessionNo }),
      });
    },
  });

  const addList = (kind: "ALLOW" | "BLOCK") => openActionConfirm({
    action: kind === "ALLOW" ? "加入信任名单" : "加入禁入名单",
    detail: "输入用户编码或后端ID。确认后提交 A2 待确认队列,门槛者确认后写入后端名单,刷新后以服务端名单表为准。",
    amplifies: false,
    edit: { kind: "text", current: accounts[0]?.userNo ?? "U00000000", unit: "用户编码" },
    run: (reason, value) => {
      void (async () => {
        try {
          const target = await resolveAccount(value);
          const id = accountId(target);
          if (!id) { toast("账户缺少后端ID"); return; }
          const def = findHighOp("c2_blocklist_upsert")!;
          await propose(toast, {
            action: `${kind === "ALLOW" ? "加入信任名单" : "加入禁入名单"} · ${displayAccount(target)}`,
            obj: id,
            before: kind === "ALLOW" ? "无信任名单" : "无禁入名单",
            after: kind === "ALLOW" ? "信任" : "禁入",
            type: "acct",
            amplifies: false,
            gate: { roles: [] },
            gateLabel: def.gateLabel,
            reason,
            sourceDomain: "C2",
            command: def.buildCommand({ userId: id, kind }),
            target: def.buildTarget({ userId: id }),
          });
        } catch (err) {
          toast(errorMessage(err));
        }
      })();
    },
  });

  const rmList = (entry: UserAccountListEntry) => openActionConfirm({
    action: `移出名单 · ${displayAccount(entry)}`,
    detail: "移出后该账户恢复默认风控判定。确认后写入后端名单状态,刷新表格展示 REMOVED 结果。",
    amplifies: false,
    run: (reason) => {
      if (entry.userId === null || entry.userId === undefined) return toast("名单行缺少 userId");
      void perform(
        () => removeUserAccountList(entry.userId!, reason, OPERATOR()).then(() => `${displayAccount(entry)} 已移出名单`),
        "已移出名单",
      );
    },
  });

  const frozenUsers = asNumber(overview?.frozenUsers);
  const activeImps = impersonations.filter(activeImpersonation);
  const liveLeftMin = activeImps.length > 0 ? Math.max(...activeImps.map((session) => asNumber(session.leftMinutes))) : 0;

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
                  const locked = status !== "ACTIVE";
                  return (
                    <tr className={`click${locked ? " frozen-row" : ""}`} key={accountId(account)} onClick={() => setAcct(account)}>
                      <td className="mono" style={{ fontWeight: 600, color: "var(--ink)" }}>{text(account.userNo, accountId(account))} <span style={{ fontSize: 10.5, color: "var(--c-ac)" }}>详情›</span></td>
                      <td>{text(account.nickname)}</td>
                      <td><span className={`bdg ${tone}`}>{label}</span></td>
                      <td><span className={`bdg ${riskTone(account.riskScore)}`}>{text(account.riskScore)}</span></td>
                      <td className="mono">{sessionCounts.get(accountId(account)) ?? 0} 个</td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        {locked
                          ? <button disabled={busy} className="l-btn sm mc" onClick={(e) => { e.stopPropagation(); unfreeze(account); }}>恢复</button>
                          : <button disabled={busy} className="l-btn sm mc" onClick={(e) => { e.stopPropagation(); freeze(account); }}>冻结</button>}
                        <button disabled={busy} className="l-btn sm" style={{ marginLeft: 6 }} onClick={(e) => { e.stopPropagation(); logoutAll(account); }}>强制登出</button>
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
            <span className="sub">· 后端 impersonation 会话</span>
            <div className="r">{canStartImpersonation && <button disabled={busy} className="l-btn mc" onClick={startImp}>发起模拟登录</button>}</div>
          </div>
          <div className="l-b">
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>进行中 / 近期会话</div>
            {impersonations.map((session) => {
              const active = activeImpersonation(session);
              return (
                <div className="imp-row" key={text(session.sessionNo)}>
                  <span className="mono" style={active ? { fontWeight: 600, color: "var(--ink)" } : { color: "var(--ink-3)" }}>{text(session.operator)} → {text(session.userNo)}</span>
                  {active ? <span className="bdg warn">进行中 · 只读</span> : <span className="bdg dim">{text(session.status)}</span>}
                  {active && (
                    <span className="ttlbar">
                      <span className="track"><i style={{ width: `${Math.min(100, Math.max(4, (asNumber(session.leftMinutes) / Math.max(1, asNumber(session.ttlMinutes))) * 100))}%` }} /></span>
                      <span className="mono" style={{ fontSize: 11.5, color: "var(--warning)" }}>剩 {asNumber(session.leftMinutes)}min</span>
                    </span>
                  )}
                  <button className="l-btn sm" onClick={() => setTrace(session)}>看轨迹</button>
                  {active && <button disabled={busy} className="l-btn sm" onClick={() => endImp(session)}>立即终止</button>}
                </div>
              );
            })}
            {!loading && impersonations.length === 0 && (
              <div style={{ fontSize: 12, color: "var(--ink-4)", lineHeight: 1.55 }}>暂无模拟登录会话。</div>
            )}
            <div className="ctint warn" style={{ marginTop: 12, fontSize: 12 }}><b>只读边界</b> · C2 只创建和终止后端 impersonation 会话,写接口是否拒绝由服务器凭证边界控制。</div>
          </div>
        </section>
      </div>

      <section className="l-card">
        <div className="l-h">
          <span className="ttl">信任 / 禁入名单</span>
          <span className="sub">· 账户级名单</span>
          <div className="r">
            <button disabled={busy} className="l-btn mc" onClick={() => addList("ALLOW")}>+ 加入信任名单</button>
            <button disabled={busy} className="l-btn mc" onClick={() => addList("BLOCK")}>+ 加入禁入名单</button>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 860 }}>
            <thead><tr><th>用户编码</th><th>姓名</th><th>名单</th><th>状态</th><th>原因</th><th>失效时间</th><th>确认</th><th style={{ textAlign: "right" }}>动作</th></tr></thead>
            <tbody>
              {listPager.pageRows.map((entry) => {
                const [kindLabel, kindTone] = displayListKind(entry.kind);
                const entryActive = activeListEntry(entry);
                return (
                  <tr key={`${text(entry.userId)}-${text(entry.kind)}-${text(entry.status)}`}>
                    <td className="mono" style={{ fontWeight: 600, color: "var(--ink)" }}>{text(entry.userNo)}</td>
                    <td>{text(entry.nickname)}</td>
                    <td><span className={`bdg ${kindTone}`}>{kindLabel}</span></td>
                    <td><span className={`bdg ${entryActive ? "ok" : "dim"}`}>{entryActive ? "生效中" : text(entry.status)}</span></td>
                    <td style={{ fontSize: 12, color: "var(--ink-3)" }}>{text(entry.reason)}</td>
                    <td className="mono" style={{ fontSize: 11.5 }}>{formatDate(entry.expiresAt, "长期")}</td>
                    <td className="mono" style={{ fontSize: 11.5, color: "var(--ink-4)" }}>{text(entry.createdBy)} · {formatDate(entry.createdAt)}</td>
                    <td style={{ textAlign: "right" }}>
                      <button disabled={busy || !entryActive} className="l-btn sm mc" onClick={() => rmList(entry)}>移出名单</button>
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

      <p className="f-foot"><b>四类动作的确认口径</b>:冻结、恢复、加白、拉黑、模拟登录授权与终止都走后端接口,刷新后以服务器返回为准。页面不再写本地 store 或临时状态。</p>

      {selectedAccount && (() => {
        const status = statusOf(selectedAccount);
        const [statusLabel, statusTone] = statusMeta(status);
        const accountSessions = sessionsFor(selectedAccount);
        const listEntry = listFor(selectedAccount);
        return (
          <Drawer
            title={`账户明细 · ${displayAccount(selectedAccount)}`}
            onClose={() => setAcct(null)}
            footer={<Link className="l-btn" style={{ flex: 1, justifyContent: "center" }} href={K1_PATH}>去 K1 看反多账户簇 →</Link>}
          >
            <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink)" }}>{displayAccount(selectedAccount)} · <span className={`bdg ${statusTone}`}>{statusLabel}</span></div>
            <div style={{ fontSize: 12, color: "var(--ink-3)", lineHeight: 1.55, margin: "4px 0 12px" }}>详情来自后端 C2 overview 的账户、名单和会话查询结果。</div>

            <div style={{ fontSize: 13, fontWeight: 600, margin: "14px 0 4px" }}>账户概览</div>
            <div className="kv"><span className="k">用户编码</span><span className="v">{text(selectedAccount.userNo)}</span></div>
            <div className="kv"><span className="k">手机号</span><span className="v">{text(selectedAccount.phoneMasked)}</span></div>
            <div className="kv"><span className="k">KYC</span><span className="v">{text(selectedAccount.kycStatus)}</span></div>
            <div className="kv"><span className="k">等级</span><span className="v">{text(selectedAccount.userLevel)} / {text(selectedAccount.vRank)}</span></div>
            <div className="kv"><span className="k">余额</span><span className="v">{formatAmount(selectedAccount.walletUsdt)} USDT · {formatAmount(selectedAccount.walletNex)} NEX</span></div>
            <div className="kv"><span className="k">风险分</span><span className="v">{text(selectedAccount.riskScore, "0")} · {text(selectedAccount.riskBand, "未分档")}</span></div>
            <div className="kv"><span className="k">名单(本页)</span><span className="v">{listEntry ? `${displayListKind(listEntry.kind)[0]} · ${text(listEntry.reason)}` : "无生效名单"}</span></div>
            <div className="kv"><span className="k">活跃会话</span><span className="v">{accountSessions.filter(activeSession).length} 个</span></div>

            <div style={{ fontSize: 13, fontWeight: 600, margin: "14px 0 6px" }}>会话</div>
            {accountSessions.length > 0 ? (
              <table className="l-tbl">
                <thead><tr><th>会话</th><th>IP</th><th>设备</th><th>状态</th><th>到期</th></tr></thead>
                <tbody>
                  {accountSessions.map((session) => (
                    <tr key={text(session.refreshTokenId)}>
                      <td className="mono" style={{ fontSize: 11.5 }}>{text(session.refreshTokenId)}</td>
                      <td className="mono" style={{ fontSize: 11.5 }}>{text(session.clientIpMasked)}</td>
                      <td style={{ fontSize: 12 }}>{text(session.deviceName)}</td>
                      <td><span className={`bdg ${activeSession(session) ? "ok" : "dim"}`}>{text(session.status)}</span></td>
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
              {status === "ACTIVE"
                ? <button disabled={busy} className="l-btn sm mc" onClick={() => freeze(selectedAccount)}>冻结</button>
                : <button disabled={busy} className="l-btn sm mc" onClick={() => unfreeze(selectedAccount)}>恢复</button>}
              <button disabled={busy} className="l-btn sm" onClick={() => logoutAll(selectedAccount)}>强制登出</button>
            </div>
          </Drawer>
        );
      })()}

      {traceSession && (
        <Drawer title={`模拟会话轨迹 · ${text(traceSession.sessionNo)}`} onClose={() => setTrace(null)}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink)" }}>
            {activeImpersonation(traceSession) ? `进行中 · 只读 · 剩 ${asNumber(traceSession.leftMinutes)}min` : `${text(traceSession.status)} · 起止写入后端记录`}
          </div>
          <div style={{ fontSize: 12, color: "var(--ink-3)", lineHeight: 1.55, margin: "4px 0 12px" }}>该抽屉只展示后端 impersonation 会话字段,逐页浏览轨迹归 A2 审计查询。</div>

          <div className="kv"><span className="k">用户编码</span><span className="v">{text(traceSession.userNo)}</span></div>
          <div className="kv"><span className="k">操作者</span><span className="v">{text(traceSession.operator)}</span></div>
          <div className="kv"><span className="k">授权理由</span><span className="v">{text(traceSession.reason)}</span></div>
          <div className="kv"><span className="k">创建时间</span><span className="v">{formatDate(traceSession.createdAt)}</span></div>
          <div className="kv"><span className="k">到期时间</span><span className="v">{formatDate(traceSession.expiresAt)}</span></div>
          <div className="kv"><span className="k">结束人</span><span className="v">{text(traceSession.endedBy)}</span></div>
          <div className="kv"><span className="k">结束原因</span><span className="v">{text(traceSession.endReason)}</span></div>
          {activeImpersonation(traceSession) && (
            <button disabled={busy} className="l-btn mc" style={{ marginTop: 14 }} onClick={() => endImp(traceSession)}>立即终止</button>
          )}
        </Drawer>
      )}
    </>
  );
}

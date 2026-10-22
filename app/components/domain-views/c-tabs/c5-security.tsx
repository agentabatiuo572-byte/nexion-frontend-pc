"use client";
import { PhoneReplacementPanel } from "./phone-replacement-panel";

import { currentAdminOperator } from "@/lib/admin/current-operator";
import { displayAdminError } from "@/lib/admin/error-messages";
import { sessionTimeAnomaly } from "@/lib/admin/session-time";
import { createPendingMutationStore } from "@/lib/admin/pending-mutation-store";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DataListPager, Drawer, type BusinessFormValue } from "../design-kit";
import {
  disableUserTwoFactor,
  fetchUserProfilesPage,
  fetchUserSecurityOverview,
  requestUserPasswordReset,
  revokeUserSession,
  revokeUserSessions,
  unlockUserSecurity,
  updateUserCredentialParam,
  type User360Profile,
  type UserCredentialParam,
  type UserSecurityOverview,
  type UserSecurityActionEvidence,
  type UserSecurityUserRow,
  type UserSession,
  UsersOutcomeUnknownError,
} from "@/lib/admin/user360-client";
import type { CCtx } from "./types";

const OPERATOR = currentAdminOperator;
const PAGE_SIZE_OPTIONS = [5, 10, 20, 50];
const NO_USER_SELECTION = "__NO_USER_SELECTION__";

function normalizedPhoneLookup(value: string) {
  return value.replace(/[^0-9]/g, "");
}

function isRawPhoneLookup(value: string) {
  const digits = normalizedPhoneLookup(value);
  return digits.length >= 8 && digits.length <= 15 && /^[+0-9()\s-]+$/.test(value);
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function privacySafeUserLookup(keyword: string) {
  if (isRawPhoneLookup(keyword)) {
    return { phoneHash: await sha256(normalizedPhoneLookup(keyword)) };
  }
  return { keyword };
}

function text(value: unknown, fallback = "—") {
  return value === null || value === undefined || String(value).trim() === "" ? fallback : String(value);
}

function toNumber(value: unknown, fallback = 0) {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function formatDateTime(value: unknown) {
  if (!value) return "—";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return text(value);
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function userIdOf(row?: UserSecurityUserRow | null) {
  const raw = row?.userId;
  return raw === null || raw === undefined || raw === "" ? null : raw;
}

function userLabel(row?: UserSecurityUserRow | null) {
  if (!row) return "未选择用户";
  return `${text(row.userNo)} · ${text(row.nickname)}`;
}

function profileKey(account?: User360Profile | null) {
  const raw = account?.userNo || account?.id;
  return raw === null || raw === undefined || raw === "" ? null : String(raw);
}

function profileLabel(account?: User360Profile | null) {
  if (!account) return "未选择用户";
  return `${text(account.userNo, text(account.id))} · ${text(account.nickname)}`;
}

function sessionId(session?: UserSession | null) {
  return text(session?.refreshTokenId, "—");
}

function maskSessionId(value: string) {
  if (!value || value === "—") return "—";
  if (value.length <= 10) return `${value.slice(0, 3)}•••${value.slice(-2)}`;
  return `${value.slice(0, 6)}••••${value.slice(-4)}`;
}

function numericParamValue(value: unknown) {
  const match = text(value, "").match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function rowKey(row: UserSecurityUserRow) {
  return text(row.userNo, text(row.userId));
}

function sessionTone(status?: string | null) {
  const normalized = text(status, "").toUpperCase();
  if (normalized === "ACTIVE") return "ok";
  if (normalized === "REVOKED") return "bad";
  if (normalized === "EXPIRED") return "dim";
  return "warn";
}

function sessionStatusLabel(status?: string | null) {
  const normalized = text(status, "").toUpperCase();
  if (normalized === "ACTIVE") return "活跃";
  if (normalized === "REVOKED") return "已撤销";
  if (normalized === "EXPIRED") return "已过期";
  return "状态未知";
}

function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "C5_DATA_LOAD_FAILED");
  // client 层已接 guardedFetch 咽喉,网络异常到这里通常已是咽喉中文文案;按原压制意图把判据扩到
  // 咽喉网络文案前缀(error-messages.ts 未导出该文案常量,就地字面量),命中仍走 C5 自家短文案。
  if (/failed to fetch|networkerror|network request failed/i.test(message) || message.includes("网络连接失败或后台服务不可达")) {
    return "网络请求失败，页面数据未改变，请检查连接后重试";
  }
  return displayAdminError(error);
}

function newCommandKey(prefix: string) {
  const suffix = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${suffix}`;
}

/** C5 七类安全动作共用一张表,调用点的 fingerprint 已带动作类型前缀 + 目标 id
 *  (`revoke-one|会话号`、`unlock|用户ID|锁类型`…),刷新后仍能用同一命令号重试。 */
const pendingCommandKeys = createPendingMutationStore({
  storageKey: "nexion-admin-c5-security-commands-v1",
});

function clearSelectedUserFromOverview(current: UserSecurityOverview | null): UserSecurityOverview | null {
  if (!current) return current;
  return {
    ...current,
    selectedUser: null,
    selectedActiveSessionCount: 0,
    sessions: {
      ...(current.sessions ?? {}),
      total: 0,
      pageNum: 1,
      pageSize: current.sessions?.pageSize ?? 10,
      records: [],
    },
  };
}

function operatorEvidence(
  businessValue: BusinessFormValue | undefined,
  lockKind?: "SHORT" | "LONG" | null,
): UserSecurityActionEvidence {
  return {
    operatorConfirmed: businessValue?.ack === "true",
    lockKind: lockKind ?? null,
  };
}

function StatCard({ tone, label, value, sub }: { tone?: string; label: string; value: string | number; sub: string }) {
  return (
    <div className={`f-stat ${tone ?? ""}`}>
      <div className="k">{label}</div>
      <div className="v">{value}</div>
      <div className="sub">{sub}</div>
    </div>
  );
}

function SecLabel({ children }: { children: string }) {
  return <div style={{ fontSize: 12.5, fontWeight: 600, margin: "14px 0 4px", color: "var(--ink)" }}>{children}</div>;
}

export function C5Security({ ctx }: { ctx: CCtx }) {
  const { toast, openActionConfirm, openConfirm } = ctx;
  const authorities = useAdminAuth((state) => state.session?.authorities ?? []);
  const canRevokeOne = authorities.includes("user_c5_session_revoke_one");
  const canRevokeAll = authorities.includes("user_c5_session_revoke_all");
  const canDisable2fa = authorities.includes("user_c5_2fa_disable");
  const canResetPassword = authorities.includes("user_c5_password_reset");
  const canUnlockShort = authorities.includes("user_c5_unlock_short");
  const canUnlockLong = authorities.includes("user_c5_unlock_long");
  const canWriteConfig = authorities.includes("user_c5_write");
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const focusUserCode = (searchParams?.get("userCode") ?? "").trim().toUpperCase();
  const [overview, setOverview] = useState<UserSecurityOverview | null>(null);
  const [selectedUserKey, setSelectedUserKey] = useState(NO_USER_SELECTION);
  const [userLookup, setUserLookup] = useState("");
  const [userOptions, setUserOptions] = useState<User360Profile[]>([]);
  const [userPage, setUserPage] = useState(1);
  const [userPageSize, setUserPageSize] = useState(20);
  const [userTotal, setUserTotal] = useState(0);
  const [userListRetry, setUserListRetry] = useState(0);
  const [userSearchLoading, setUserSearchLoading] = useState(false);
  const [userSearchError, setUserSearchError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ssId, setSsId] = useState<string | null>(null);
  const [lockId, setLockId] = useState<string | null>(null);

  const replaceFocusUserCode = useCallback((userCode?: string) => {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    if (userCode) {
      params.set("userCode", userCode);
    } else {
      params.delete("userCode");
    }
    const query = params.toString();
    const destination = query ? `${pathname ?? "/"}?${query}` : (pathname ?? "/");
    router.replace(destination, { scroll: false });
  }, [pathname, router, searchParams]);

  const dataGeneration = useRef(0);
  useEffect(() => {
    const key = focusUserCode || NO_USER_SELECTION;
    if (selectedUserKey === key) return;
    dataGeneration.current++;
    setOverview(clearSelectedUserFromOverview);
    setSelectedUserKey(key);
    setPage(1);
    setSsId(null);
    setLockId(null);
  }, [focusUserCode]);

  const loadData = useCallback(async (silent = false) => {
    const generation = ++dataGeneration.current;
    if (!silent) setLoading(true);
    try {
      const key = selectedUserKey === NO_USER_SELECTION ? "" : selectedUserKey.trim();
      const data = await fetchUserSecurityOverview({ userKey: key || undefined, pageNum: page, pageSize });
      if (generation !== dataGeneration.current) return false;
      setOverview(key ? data : clearSelectedUserFromOverview(data));
      setError(null);
      return true;
    } catch (err) {
      if (generation !== dataGeneration.current) return false;
      setOverview(null);
      setError(`C5 数据加载失败 · ${errorMessage(err)}`);
      return false;
    } finally {
      if (!silent && generation === dataGeneration.current) setLoading(false);
    }
  }, [page, pageSize, selectedUserKey]);

  useEffect(() => {
    void loadData();
    return () => { dataGeneration.current++; };
  }, [loadData]);

  useEffect(() => {
    let cancelled = false;
    setUserSearchLoading(true);
    setUserOptions([]);
    const timer = window.setTimeout(async () => {
      try {
        const keyword = userLookup.trim();
        const pageData = await fetchUserProfilesPage({
          ...(keyword ? await privacySafeUserLookup(keyword) : {}),
          pageNum: userPage,
          pageSize: userPageSize,
        });
        if (!cancelled) {
          setUserOptions(pageData.records);
          setUserTotal(pageData.total);
          setUserSearchError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setUserOptions([]);
          setUserTotal(0);
          setUserSearchError(`用户列表加载失败 · ${errorMessage(err)}`);
        }
      } finally {
        if (!cancelled) setUserSearchLoading(false);
      }
    }, 260);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [userPage, userPageSize, userLookup, userListRetry]);

  const perform = useCallback(async (
    fingerprint: string,
    work: (commandKey: string) => Promise<string>,
    fallback: string,
  ) => {
    setBusy(true);
    const commandKey = pendingCommandKeys.get(fingerprint) ?? newCommandKey("c5-command");
    pendingCommandKeys.remember(fingerprint, commandKey);
    let writeReturned = false;
    try {
      const message = await work(commandKey);
      writeReturned = true;
      if (!await loadData(true)) {
        throw new Error("操作可能已生效，但结果回读失败；请刷新核对，重试将继续使用同一请求号");
      }
      pendingCommandKeys.forget(fingerprint);
      toast(message || fallback);
      setError(null);
      return true;
    } catch (err) {
      if (!writeReturned && !(err instanceof UsersOutcomeUnknownError)) {
        pendingCommandKeys.forget(fingerprint);
      }
      const message = errorMessage(err);
      setError(`C5 操作失败 · ${message}`);
      toast(`C5 操作失败 · ${message}`);
      return false;
    } finally {
      setBusy(false);
    }
  }, [loadData, toast]);

  const selectedUser = overview?.selectedUser ?? null;
  const selectedUserId = userIdOf(selectedUser);
  const sessionPage = overview?.sessions;
  const sessions = useMemo(() => sessionPage?.records ?? [], [sessionPage?.records]);
  const activeSessionCount = toNumber(overview?.selectedActiveSessionCount);
  const total = toNumber(sessionPage?.total, sessions.length);
  const credentialParams = overview?.credentialParams ?? [];
  const lockedUsers = overview?.lockedUsers ?? [];
  const activeSessions = toNumber(overview?.stats?.activeSessions);
  const lockedShort = toNumber(overview?.stats?.lockedShort);
  const lockedLong = toNumber(overview?.stats?.lockedLong);
  const tokenReuseToday = toNumber(overview?.stats?.tokenReuseToday);
  const selectedSession = ssId ? sessions.find((session) => session.refreshTokenId === ssId) : undefined;
  const selectedLock = lockId ? lockedUsers.find((row) => rowKey(row) === lockId) : undefined;

  const selectLookupUser = (account: User360Profile) => {
    const key = profileKey(account);
    if (!key || key === selectedUserKey) return;
    dataGeneration.current++;
    setOverview(clearSelectedUserFromOverview);
    setSelectedUserKey(key);
    replaceFocusUserCode(key);
    setPage(1);
    setSsId(null);
    setLockId(null);
  };

  const revokeOne = (id: string) =>
    openConfirm({
      action: `退出该设备 · ${maskSessionId(id)}`,
      detail: "确认后服务器立即吊销该会话，用户当前设备马上下线；结果会写入高风险审计。",
      chips: [["立即吊销", "ready"], ["服务端审计", "done"]],
      reason: true,
      okLabel: "确认退出该设备",
      run: (reason) => {
        return perform(`revoke-one|${id}|${reason}`, async (commandKey) => {
          await revokeUserSession(id, reason, OPERATOR(), commandKey);
          return "会话已立即吊销";
        }, "会话已立即吊销");
      },
    });

  const revokeAll = () => {
    if (!selectedUserId) return;
    openConfirm({
      action: `退出全部设备 · ${userLabel(selectedUser)}`,
      detail: "确认后服务器立即吊销该用户全部活跃会话，常用于疑似盗号止损。",
      chips: [["整链立即吊销", "ready"], ["服务端审计", "done"]],
      reason: true,
      okLabel: "确认退出全部设备",
      run: (reason) => {
        if (!selectedUserId) return;
        return perform(`revoke-all|${selectedUserId}|${reason}`, async (commandKey) => {
          await revokeUserSessions(selectedUserId, reason, OPERATOR(), commandKey);
          return "全部活跃会话已立即吊销";
        }, "全部活跃会话已立即吊销");
      },
    });
  };

  const disable2fa = () => {
    if (!selectedUserId) return;
    openActionConfirm({
      action: `人工关闭 两步验证 · ${userLabel(selectedUser)}`,
      detail: <>用户丢失验证器设备时的恢复通道。服务器校验专门权限、防重复提交编号和当前状态，并记录操作人、角色和理由。</>,
      amplifies: false,
      businessForm: {
        kind: "identity-verify",
        subject: `${userLabel(selectedUser)} · 关闭 两步验证`,
        serverVerification: {
          channel: "角色权限 + 双确认",
          ticket: "当前管理员会话",
          verifiedAt: "提交时服务端校验",
          verifiedBy: OPERATOR(),
          expiresAt: "单次命令",
        },
      },
      run: (reason, _value, businessValue?: BusinessFormValue) => {
        if (!selectedUserId) return;
        return perform(`disable-2fa|${selectedUserId}|${reason}`, async (commandKey) => {
          await disableUserTwoFactor(selectedUserId, reason, OPERATOR(), operatorEvidence(businessValue), commandKey);
          return "两步验证 已立即关闭";
        }, "两步验证 已立即关闭");
      },
    });
  };

  const passwordReset = () => {
    if (!selectedUserId) return;
    openActionConfirm({
      action: `密码重置 · ${userLabel(selectedUser)}`,
      detail: <>后台始终看不到密码明文。双确认后，服务器标记“下次登录必须改密”并吊销全部旧会话。</>,
      amplifies: false,
      businessForm: {
        kind: "identity-verify",
        subject: `${userLabel(selectedUser)} · 密码重置`,
        serverVerification: {
          channel: "角色权限 + 双确认",
          ticket: "当前管理员会话",
          verifiedAt: "提交时服务端校验",
          verifiedBy: OPERATOR(),
          expiresAt: "单次命令",
        },
      },
      run: (reason, _value, businessValue?: BusinessFormValue) => {
        if (!selectedUserId) return;
        return perform(`password-reset|${selectedUserId}|${reason}`, async (commandKey) => {
          await requestUserPasswordReset(selectedUserId, reason, OPERATOR(), operatorEvidence(businessValue), commandKey);
          return "已要求用户下次登录完成密码重设";
        }, "密码重设要求已生效");
      },
    });
  };

  const unlockUser = (row: UserSecurityUserRow) => {
    const userId = userIdOf(row);
    if (!userId) return;
    const longLock = row.lockKind === "LONG";
    const lockKind = longLock ? "LONG" : "SHORT";
    openActionConfirm({
      action: `解除${longLock ? "长" : "短"}锁 · ${userLabel(row)}`,
      detail: longLock
        ? "长锁仅限超级管理员或风控角色解除。服务器校验锁类型未变化、权限和防重复提交编号后立即清除登录锁。"
        : "短锁仅限超级管理员、风控或客服角色解除。服务器校验权限和防重复提交编号后立即清除登录失败计数与登录锁。",
      amplifies: false,
      businessForm: {
        kind: "identity-verify",
        subject: `${userLabel(row)} · 解除${longLock ? "长" : "短"}锁`,
        serverVerification: {
          channel: "角色权限 + 双确认",
          ticket: "当前管理员会话",
          verifiedAt: "提交时服务端校验",
          verifiedBy: OPERATOR(),
          expiresAt: "单次命令",
        },
      },
      run: (reason, _value, businessValue?: BusinessFormValue) => {
        return perform(`unlock|${userId}|${lockKind}|${reason}`, async (commandKey) => {
          await unlockUserSecurity(userId, reason, OPERATOR(), operatorEvidence(businessValue, lockKind), commandKey);
          return `${longLock ? "长" : "短"}锁已立即解除`;
        }, "账户锁定已解除");
      },
    });
  };

  const updateParam = (param: UserCredentialParam) => {
    if (!param.key || param.readOnly || !canWriteConfig) return;
    openActionConfirm({
      action: `账户安全规则调整 · ${text(param.name)}`,
      detail: <><b>{text(param.name)}</b> · 当前 {text(param.value)} · {text(param.note)}。
        {param.key === "phoneChangeWindowDays" || param.key === "phoneChangeMaxCount"
          ? "更换手机号的限制对所有用户的下一次改号申请立即生效。"
          : "会话空闲阈值会立即影响活跃判定，其余凭证时长对新签发凭证生效。"}</>,
      amplifies: false,
      edit: {
        kind: "number",
        current: String(numericParamValue(param.value)),
        unit: text(param.unit, ""),
        min: toNumber(param.min, 0),
        max: toNumber(param.max, Number.MAX_SAFE_INTEGER),
        step: 1,
        disallowCurrent: true,
      },
      run: (reason, nextValue) => {
        const value = (nextValue ?? "").trim();
        if (!value) return;
        const expectedVersion = toNumber(param.version, Number.NaN);
        if (!Number.isFinite(expectedVersion)) {
          toast("当前配置版本不可用，请重新加载后再操作");
          return false;
        }
        return perform(`credential|${param.key}|${value}|${expectedVersion}|${reason}`, async (commandKey) => {
          await updateUserCredentialParam(param.key as string, value, reason, OPERATOR(), expectedVersion, commandKey);
          return `${text(param.name)} 已更新为 ${value}`;
        }, "账户安全规则已更新");
      },
    });
  };

  return (
    <>
      <div className="f-stats">
        <StatCard label="活跃会话(全平台)" value={activeSessions.toLocaleString("en-US")} sub="来自会话统计" />
        <StatCard tone="ok" label="两步验证 开启率" value={`${text(overview?.stats?.twoFactorRatePct, "0.0")}%`} sub="来自凭证安全统计" />
        <StatCard tone="warn" label="锁定中账户" value={lockedShort + lockedLong} sub={`短锁 ${lockedShort} · 长锁 ${lockedLong}`} />
        <StatCard tone="danger" label="今日异常登录清退" value={tokenReuseToday} sub="重复使用登录凭证 → 退出关联的所有登录设备" />
      </div>

      {error && (
        <div className="ctint bad" style={{ marginBottom: 12, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <span>{error}</span>
          <button className="l-btn sm" disabled={loading} onClick={() => void loadData()}>重新加载</button>
        </div>
      )}
      {loading && <div className="ctint" style={{ marginBottom: 12 }}>C5 数据加载中...</div>}

      <section className="l-card">
        <div className="l-h">
          <span className="ttl">登录安全与更换手机号限制</span>
          <span className="sub">· 每个用户单独统计改号次数</span>
        </div>
        <div className="l-b" style={{ paddingTop: 4 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "0 32px", minWidth: 0 }}>
            {credentialParams.map((param) => (
              <div className="p-row" key={text(param.key)}>
                <div className="txt">
                  <div className="k">
                    {text(param.name)}
                    {param.readOnly && <span className="bdg dim" style={{ marginLeft: 6 }}>当前仅可查看</span>}
                  </div>
                  <div className="s">{text(param.note)}</div>
                </div>
                <span className="v">{text(param.value)}</span>
                <button className="l-btn sm mc" disabled={busy || !!param.readOnly || !canWriteConfig} onClick={() => updateParam(param)}>
                  {param.readOnly ? "只读" : canWriteConfig ? "调整" : "无权限"}
                </button>
              </div>
            ))}
            {credentialParams.length === 0 && <div className="ctint">暂无凭证参数</div>}
          </div>
          <div className="ctint" style={{ marginTop: 10 }}>
            <b>更换登录手机号</b> · 按最近的统计天数滚动计算每位用户成功改号的次数；达到上限后，须等最早一次改号移出统计期。此规则与更换绑定设备的次数分开。
          </div>
          <div className="ctint" style={{ marginTop: 10 }}>
            <b>异常自动防御</b> · 同一个长凭证被使用两次时,服务器立即回收整条会话链;挑战码过期与高风险校验由后端执行。
          </div>
        </div>
      </section>

      <div className="two-col r125-1">
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">用户安全处置</span>
            <span className="sub">· 先选择用户，再处理该用户的登录设备、两步验证或密码</span>
          </div>
          <div className="l-b" style={{ paddingBottom: 10 }}>
            <input
              className="fld"
              aria-label="检索安全处置用户"
              value={userLookup}
              disabled={busy}
              onChange={(event) => {
                if (selectedUserKey !== NO_USER_SELECTION) dataGeneration.current++;
                setUserLookup(event.target.value);
                setUserPage(1);
                setSelectedUserKey(NO_USER_SELECTION);
                if (focusUserCode) replaceFocusUserCode();
                setOverview(clearSelectedUserFromOverview);
                setPage(1);
                setSsId(null);
                setLockId(null);
              }}
              placeholder="搜索用户编码 / 用户名 / 推荐码 / 手机号"
            />
            <div className="ctint" style={{ marginTop: 8 }}>
              直接点击用户右侧的“查看安全信息”；也可以先搜索。所有处置仅针对选中的用户。
            </div>
            {userSearchError && <div className="ctint bad" role="alert">
              {userSearchError} <button className="l-btn sm" disabled={userSearchLoading} onClick={() => setUserListRetry((value) => value + 1)}>重新加载用户</button>
            </div>}
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="l-tbl" aria-label="安全处置用户列表">
              <thead><tr><th>用户编码</th><th>用户名</th><th>手机号</th><th>操作</th></tr></thead>
              <tbody>
                {userOptions.map((account) => {
                  const key = profileKey(account);
                  const selected = key === selectedUserKey;
                  return (
                    <tr key={key ?? profileLabel(account)} aria-selected={selected}>
                      <td className="mono">{text(account.userNo, text(account.id))}</td>
                      <td>{text(account.nickname)}</td>
                      <td className="mono">{text(account.phoneMasked)}</td>
                      <td><button className="l-btn sm" disabled={busy || loading || !key || selected} onClick={() => selectLookupUser(account)}>
                        {selected ? "已选择" : "查看安全信息"}
                      </button></td>
                    </tr>
                  );
                })}
                {userOptions.length === 0 && <tr><td colSpan={4} style={{ textAlign: "center", padding: 18 }}>
                  {userSearchLoading ? "用户列表加载中…" : userSearchError ? "用户列表未能加载，请点击重新加载用户" : userLookup.trim() ? "没有匹配用户，请调整搜索条件" : "暂无可查看的用户"}
                </td></tr>}
              </tbody>
            </table>
          </div>
          <DataListPager label="安全处置用户" page={userPage} pageSize={userPageSize} total={userTotal} onPageChange={setUserPage}
            onPageSizeChange={(next) => { setUserPageSize(next); setUserPage(1); }} pageSizeOptions={[20, 50, 100, 200]} />
          <div className="l-h">
            <span className="ttl">{selectedUser ? `当前用户 · ${userLabel(selectedUser)}` : "选择用户后查看安全信息"}</span>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="l-tbl" style={{ minWidth: 700 }}>
              <thead>
                <tr>
                  <th>会话</th>
                  <th>IP</th>
                  <th>设备</th>
                  <th>状态</th>
                  <th>最近活跃</th>
                  <th style={{ textAlign: "right" }}>动作</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((session) => {
                  const id = sessionId(session);
                  const active = text(session.status, "").toUpperCase() === "ACTIVE";
                  return (
                    <tr key={id} className="click" style={!active ? { opacity: 0.62 } : undefined} onClick={() => setSsId(id)}>
                      <td className="mono" style={{ color: "var(--ink)" }}>{maskSessionId(id)} <span style={{ fontSize: 10.5, color: "var(--c-ac)" }}>详情›</span></td>
                      <td className="mono" style={{ fontSize: 11.5 }}>{text(session.clientIpMasked)}</td>
                      <td style={{ fontSize: 12 }}>{text(session.deviceName)}</td>
                      <td><span className={`bdg ${sessionTone(session.status)}`}>{sessionStatusLabel(session.status)}</span></td>
                      <td className="mono" style={{ fontSize: 11.5, color: "var(--ink-4)" }}>
                        {sessionTimeAnomaly(session) ? <span style={{ color: "var(--v5-warning)" }} title="服务端时间顺序异常，请核对会话原始记录">时间异常 · 查看详情</span> : formatDateTime(session.lastActiveAt ?? session.issuedAt)}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        {!active ? (
                          <span className="bdg dim">{sessionStatusLabel(session.status)}</span>
                        ) : (
                          <button className="l-btn sm" disabled={busy || !canRevokeOne} onClick={(event) => { event.stopPropagation(); revokeOne(id); }}>
                            {canRevokeOne ? "退出该设备" : "无权限"}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {sessions.length === 0 && (
                  <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--ink-4)", padding: "18px 12px" }}>{selectedUserId ? "该用户暂无会话记录" : "请先搜索并选择用户查看会话"}</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <DataListPager
            label="用户会话"
            page={page}
            pageSize={pageSize}
            total={total}
            onPageChange={setPage}
            onPageSizeChange={(next) => {
              setPageSize(next);
              setPage(1);
            }}
            pageSizeOptions={PAGE_SIZE_OPTIONS}
          />
          <div className="l-b" style={{ paddingTop: 10 }}>
            {selectedUserId && <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="l-btn" disabled={!selectedUserId || busy || !canRevokeAll || activeSessionCount === 0} onClick={revokeAll}>
                {!canRevokeAll ? "退出全部设备（无权限）" : activeSessionCount === 0 ? "退出全部设备（暂无在线设备）" : "退出全部设备"}
              </button>
              <button className="l-btn mc" disabled={!selectedUserId || busy || !canDisable2fa || !selectedUser?.twoFactorEnabled} onClick={disable2fa}>
                {!canDisable2fa ? "关闭两步验证（无权限）" : !selectedUser?.twoFactorEnabled ? "关闭两步验证（未开启）" : "关闭两步验证"}
              </button>
              <button className="l-btn mc" disabled={!selectedUserId || busy || !canResetPassword || !!selectedUser?.passwordResetRequired} onClick={passwordReset}>
                {!canResetPassword ? "密码重置（无权限）" : selectedUser?.passwordResetRequired ? "密码重置（已要求重置）" : "密码重置"}
              </button>
            </div>}
            {selectedUser && (
              <>
                <div className="ctint" style={{ marginTop: 10 }}>
                  <b>两步验证 状态</b> · {selectedUser.twoFactorEnabled ? "已开启" : "已关闭"} · 登录失败 {toNumber(selectedUser.loginFailCount)} 次
                </div>
                {selectedUser.passwordResetRequired && (
                  <div className="ctint warn" style={{ marginTop: 8 }}>
                    <b>密码重置</b> · 等待用户用当前密码验证身份并设置不同的新密码
                  </div>
                )}
              </>
            )}
          </div>
        </section>

        <section className="l-card">
          <div className="l-h">
            <span className="ttl">锁定状态与解除</span>
            <span className="sub">· 仅显示按失败次数排序的前 5 个紧急账户；精确到期时间来自服务端登录锁</span>
          </div>
          <div className="l-b">
            {lockedUsers.map((row) => {
              const longLock = row.lockKind === "LONG";
              const id = rowKey(row);
              return (
                <div className="lock-row" key={id} onClick={() => setLockId(id)}>
                  <span className="mono" style={{ fontWeight: 600, color: "var(--ink)" }}>{text(row.userNo)} <span style={{ fontSize: 10.5, color: "var(--c-ac)" }}>详情›</span></span>
                  <span className={`bdg ${longLock ? "bad" : "warn"}`}>{text(row.lockLabel)}</span>
                  <span style={{ flex: 1, fontSize: 12, color: "var(--ink-3)" }}>{text(row.nickname)} · {text(row.lockReason)}</span>
                  <span className="mono" style={{ fontSize: 11.5, color: "var(--ink-4)" }}>{text(row.lockLeft)}</span>
                  <button className={`l-btn sm ${longLock ? "mc" : ""}`} disabled={busy || (longLock ? !canUnlockLong : !canUnlockShort)} onClick={(event) => { event.stopPropagation(); unlockUser(row); }}>
                    {(longLock ? canUnlockLong : canUnlockShort) ? "解锁" : "无权限"}
                  </button>
                </div>
              );
            })}
            {lockedUsers.length === 0 && <div className="ctint">暂无锁定账户</div>}
          </div>
        </section>
      </div>

      <PhoneReplacementPanel userId={!loading && selectedUser && [String(selectedUser.userId), String(selectedUser.userNo)].includes(selectedUserKey) ? String(selectedUserId) : null} userLabel={userLabel(selectedUser)} />

      {selectedSession && (
        <Drawer title={`会话详情 · ${maskSessionId(sessionId(selectedSession))}`} sub={`${userLabel(selectedUser)} · ${sessionStatusLabel(selectedSession.status)}`} onClose={() => setSsId(null)}
          footer={<button className="l-btn danger" disabled={busy || !canRevokeOne || text(selectedSession.status, "").toUpperCase() !== "ACTIVE"} onClick={() => revokeOne(sessionId(selectedSession))}>退出该设备</button>}>
          <SecLabel>服务器会话 · 北京时间（UTC+08）</SecLabel>
          <div className="kv"><span className="k">刷新凭证</span><span className="v mono">{maskSessionId(sessionId(selectedSession))}</span></div>
          <div className="kv"><span className="k">设备</span><span className="v">{text(selectedSession.deviceName)}</span></div>
          <div className="kv"><span className="k">IP</span><span className="v mono">{text(selectedSession.clientIpMasked)}</span></div>
          <div className="kv"><span className="k">状态</span><span className="v">{sessionStatusLabel(selectedSession.status)}</span></div>
          <div className="kv"><span className="k">签发</span><span className="v mono">{text(selectedSession.issuedAt)}</span></div>
          <div className="kv"><span className="k">最近活跃</span><span className="v mono">{text(selectedSession.lastActiveAt ?? selectedSession.issuedAt)}{sessionTimeAnomaly(selectedSession) ? " · 源数据时间异常" : ""}</span></div>
          <div className="kv"><span className="k">过期</span><span className="v mono">{text(selectedSession.expiresAt)}</span></div>
          <div className="kv"><span className="k">吊销</span><span className="v mono">{text(selectedSession.revokedAt)}</span></div>
        </Drawer>
      )}

      {selectedLock && (
        <Drawer title={`锁定详情 · ${text(selectedLock.userNo)}`} sub={`${text(selectedLock.nickname)} · ${text(selectedLock.lockLabel)}`} onClose={() => setLockId(null)}
          footer={<button className={`l-btn ${selectedLock.lockKind === "LONG" ? "mc" : "primary"}`} disabled={busy || (selectedLock.lockKind === "LONG" ? !canUnlockLong : !canUnlockShort)} onClick={() => unlockUser(selectedLock)}>解除锁定</button>}>
          <SecLabel>锁定事实</SecLabel>
          <div className="kv"><span className="k">用户编码</span><span className="v mono">{text(selectedLock.userNo)}</span></div>
          <div className="kv"><span className="k">用户昵称</span><span className="v">{text(selectedLock.nickname)}</span></div>
          <div className="kv"><span className="k">失败次数</span><span className="v mono">{toNumber(selectedLock.loginFailCount)}</span></div>
          <div className="kv"><span className="k">锁定类型</span><span className="v">{text(selectedLock.lockLabel)}</span></div>
          <div className="kv"><span className="k">强制重置</span><span className="v">{selectedLock.passwordResetRequired ? "是" : "否"}</span></div>
          <div className="kv"><span className="k">说明</span><span className="v">{text(selectedLock.lockReason)}</span></div>
        </Drawer>
      )}
    </>
  );
}

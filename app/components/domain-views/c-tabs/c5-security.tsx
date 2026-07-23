"use client";

import { currentAdminOperator } from "@/lib/admin/current-operator";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DataListPager, Drawer, type BusinessFormValue } from "../design-kit";
import {
  disableUserTwoFactor,
  fetchUserProfilesPage,
  fetchUserSecurityOverview,
  requestUserPasswordReset,
  requestUserKycReverification,
  revokeUserSession,
  revokeUserSessions,
  unlockUserSecurity,
  updateUserCredentialParam,
  type User360Profile,
  type UserCredentialParam,
  type UserSecurityOverview,
  type UserSecurityActionEvidence,
  type UserKycReverification,
  type UserSecurityUserRow,
  type UserSession,
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

function profileMeta(account?: User360Profile | null) {
  if (!account) return "—";
  return [account.phoneMasked, account.status, account.kycStatus].map((item) => text(item, "")).filter(Boolean).join(" · ") || "—";
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
  if (/failed to fetch|networkerror|network request failed/i.test(message)) {
    return "网络请求失败，页面数据未改变，请检查连接后重试";
  }
  return message;
}

function clearSelectedUserFromOverview(current: UserSecurityOverview | null): UserSecurityOverview | null {
  if (!current) return current;
  return {
    ...current,
    selectedUser: null,
    selectedActiveSessionCount: 0,
    kycReverifications: [],
    sessions: {
      ...(current.sessions ?? {}),
      total: 0,
      pageNum: 1,
      pageSize: current.sessions?.pageSize ?? 10,
      records: [],
    },
  };
}

function identityEvidence(
  businessValue: BusinessFormValue | undefined,
  verification: UserKycReverification,
  lockKind?: "SHORT" | "LONG" | null,
): UserSecurityActionEvidence {
  return {
    kycVerificationChannel: "K5_INDEPENDENT_REVIEW",
    kycVerificationTicket: text(verification.ticketId, ""),
    kycVerifiedAt: text(verification.verifiedAt, ""),
    identityConfirmed: businessValue?.ack === "true",
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
  const focusUserCode = (searchParams.get("userCode") ?? "").trim().toUpperCase();
  const [overview, setOverview] = useState<UserSecurityOverview | null>(null);
  const [selectedUserKey, setSelectedUserKey] = useState(NO_USER_SELECTION);
  const [userLookup, setUserLookup] = useState("");
  const [userOptions, setUserOptions] = useState<User360Profile[]>([]);
  const [selectedLookupUser, setSelectedLookupUser] = useState<User360Profile | null>(null);
  const [userSearchLoading, setUserSearchLoading] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ssId, setSsId] = useState<string | null>(null);
  const [lockId, setLockId] = useState<string | null>(null);

  const replaceFocusUserCode = useCallback((userCode?: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (userCode) {
      params.set("userCode", userCode);
    } else {
      params.delete("userCode");
    }
    const query = params.toString();
    const destination = query ? `${pathname}?${query}` : pathname;
    router.replace(destination, { scroll: false });
  }, [pathname, router, searchParams]);

  useEffect(() => {
    if (!focusUserCode) return;
    if (selectedUserKey === focusUserCode) return;
    setSelectedUserKey(focusUserCode);
    setUserLookup(focusUserCode);
  }, [focusUserCode]);

  const loadData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const key = selectedUserKey === NO_USER_SELECTION ? "" : selectedUserKey.trim();
      const data = await fetchUserSecurityOverview({ userKey: key || undefined, pageNum: page, pageSize });
      setOverview(key ? data : clearSelectedUserFromOverview(data));
      setError(null);
    } catch (err) {
      setOverview(null);
      setError(`C5 数据加载失败 · ${errorMessage(err)}`);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [page, pageSize, selectedUserKey]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setUserSearchLoading(true);
      try {
        const keyword = userLookup.trim();
        if (selectedLookupUser && keyword === profileLabel(selectedLookupUser)) {
          if (!cancelled) setUserOptions([selectedLookupUser]);
          return;
        }
        if (!keyword) {
          if (!cancelled) {
            setUserOptions([]);
            setSelectedLookupUser(null);
            setSelectedUserKey(NO_USER_SELECTION);
            setOverview(clearSelectedUserFromOverview);
            setError(null);
          }
          return;
        }
        const pageData = await fetchUserProfilesPage({
          ...(await privacySafeUserLookup(keyword)),
          pageNum: 1,
          pageSize: 8,
        });
        if (!cancelled) {
          const records = pageData.records ?? [];
          setUserOptions(records);
          if (keyword && records.length === 0) {
            setOverview(clearSelectedUserFromOverview);
            setSelectedUserKey(NO_USER_SELECTION);
            if (focusUserCode) replaceFocusUserCode();
          }
        }
      } catch (err) {
        if (!cancelled) {
          setUserOptions([]);
          setError(`C5 用户搜索失败 · ${errorMessage(err)}`);
        }
      } finally {
        if (!cancelled) setUserSearchLoading(false);
      }
    }, 260);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [focusUserCode, replaceFocusUserCode, selectedLookupUser, userLookup]);

  const perform = useCallback(async (work: () => Promise<string>, fallback: string) => {
    setBusy(true);
    try {
      const message = await work();
      await loadData(true);
      toast(message || fallback);
      setError(null);
      return true;
    } catch (err) {
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
  const kycReverifications = overview?.kycReverifications ?? [];
  const activeSessions = toNumber(overview?.stats?.activeSessions);
  const lockedShort = toNumber(overview?.stats?.lockedShort);
  const lockedLong = toNumber(overview?.stats?.lockedLong);
  const tokenReuseToday = toNumber(overview?.stats?.tokenReuseToday);
  const selectedSession = ssId ? sessions.find((session) => session.refreshTokenId === ssId) : undefined;
  const selectedLock = lockId ? lockedUsers.find((row) => rowKey(row) === lockId) : undefined;
  const verificationFor = (action: string) => kycReverifications.find((item) => item.action === action);

  const requestVerification = (action: "DISABLE_2FA" | "PASSWORD_RESET" | "UNLOCK_SHORT" | "UNLOCK_LONG") => {
    if (!selectedUserId) return;
    openConfirm({
      action: `申请实名二验 · ${userLabel(selectedUser)}`,
      detail: "该高敏动作必须先由 K5 独立复审通过。当前操作只创建复审任务，不会改变用户安全状态。",
      chips: [["提交 K5 独立复审", "ready"], ["通过后仅可执行一次", "done"]],
      reason: true,
      okLabel: "提交复审申请",
      run: (reason) => perform(async () => {
        const result = await requestUserKycReverification(selectedUserId, action, reason, OPERATOR());
        return `实名二验已提交 · ${text(result.ticketId, "等待 K5 处理")}`;
      }, "实名二验已提交"),
    });
  };

  const selectLookupUser = (account: User360Profile) => {
    const key = profileKey(account);
    if (!key) return;
    setSelectedLookupUser(account);
    setUserLookup(profileLabel(account));
    setSelectedUserKey(key);
    replaceFocusUserCode(key);
    setPage(1);
    setSsId(null);
    setLockId(null);
    setShowUserMenu(false);
  };

  const chooseFirstUserOption = () => {
    const first = userOptions[0];
    if (first) {
      selectLookupUser(first);
      return;
    }
    setSelectedUserKey(NO_USER_SELECTION);
    replaceFocusUserCode();
    setOverview(clearSelectedUserFromOverview);
    setError("没有匹配用户，请核对用户编码、姓名或手机号后重试。");
  };

  const revokeOne = (id: string) =>
    openConfirm({
      action: `踢线 · ${maskSessionId(id)}`,
      detail: "确认后服务器立即吊销该会话，用户当前设备马上下线；结果会写入高风险审计。",
      chips: [["立即吊销", "ready"], ["服务端审计", "done"]],
      reason: true,
      okLabel: "确认踢线",
      run: (reason) => {
        return perform(async () => {
          await revokeUserSession(id, reason, OPERATOR());
          return "会话已立即吊销";
        }, "会话已立即吊销");
      },
    });

  const revokeAll = () => {
    if (!selectedUserId) return;
    openConfirm({
      action: `全部踢线 · ${userLabel(selectedUser)}`,
      detail: "确认后服务器立即吊销该用户全部活跃会话，常用于疑似盗号止损。",
      chips: [["整链立即吊销", "ready"], ["服务端审计", "done"]],
      reason: true,
      okLabel: "确认全部踢线",
      run: (reason) => {
        if (!selectedUserId) return;
        return perform(async () => {
          await revokeUserSessions(selectedUserId, reason, OPERATOR());
          return "全部活跃会话已立即吊销";
        }, "全部活跃会话已立即吊销");
      },
    });
  };

  const disable2fa = () => {
    if (!selectedUserId) return;
    const verification = verificationFor("DISABLE_2FA");
    if (!verification) return requestVerification("DISABLE_2FA");
    openActionConfirm({
      action: `人工关闭 2FA · ${userLabel(selectedUser)}`,
      detail: <>用户丢失验证器设备时的恢复通道。实名二验通过后，服务器立即关闭 2FA 并记录操作人、角色、核验工单和理由。</>,
      amplifies: false,
      businessForm: {
        kind: "identity-verify",
        subject: `${userLabel(selectedUser)} · 关闭 2FA`,
        serverVerification: {
          channel: "K5 独立复审",
          ticket: text(verification.ticketId, ""),
          verifiedAt: text(verification.verifiedAt, ""),
          verifiedBy: text(verification.verifiedBy, ""),
          expiresAt: text(verification.expiresAt, ""),
        },
      },
      run: (reason, _value, businessValue?: BusinessFormValue) => {
        if (!selectedUserId) return;
        return perform(async () => {
          await disableUserTwoFactor(selectedUserId, reason, OPERATOR(), identityEvidence(businessValue, verification));
          return "2FA 已立即关闭";
        }, "2FA 已立即关闭");
      },
    });
  };

  const passwordReset = () => {
    if (!selectedUserId) return;
    const verification = verificationFor("PASSWORD_RESET");
    if (!verification) return requestVerification("PASSWORD_RESET");
    openActionConfirm({
      action: `密码重置 · ${userLabel(selectedUser)}`,
      detail: <>后台始终看不到密码明文。实名二验通过后，服务器立即标记“下次登录必须改密”并吊销全部旧会话；当前密码只用于再次验证本人身份，不能继续作为新密码。</>,
      amplifies: false,
      businessForm: {
        kind: "identity-verify",
        subject: `${userLabel(selectedUser)} · 密码重置`,
        serverVerification: {
          channel: "K5 独立复审",
          ticket: text(verification.ticketId, ""),
          verifiedAt: text(verification.verifiedAt, ""),
          verifiedBy: text(verification.verifiedBy, ""),
          expiresAt: text(verification.expiresAt, ""),
        },
      },
      run: (reason, _value, businessValue?: BusinessFormValue) => {
        if (!selectedUserId) return;
        return perform(async () => {
          await requestUserPasswordReset(selectedUserId, reason, OPERATOR(), identityEvidence(businessValue, verification));
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
    const action = longLock ? "UNLOCK_LONG" : "UNLOCK_SHORT";
    const verification = verificationFor(action);
    if (!verification) return requestVerification(action);
    openActionConfirm({
      action: `解除${longLock ? "长" : "短"}锁 · ${userLabel(row)}`,
      detail: longLock
        ? "长锁仅限超管或风控角色解除。实名二验通过后，服务器校验锁类型未变化并立即清除登录锁。"
        : "短锁仅限超管、风控或客服角色解除。实名二验通过后，服务器立即清除登录失败计数与登录锁。",
      amplifies: false,
      businessForm: {
        kind: "identity-verify",
        subject: `${userLabel(row)} · 解除${longLock ? "长" : "短"}锁`,
        serverVerification: {
          channel: "K5 独立复审",
          ticket: text(verification.ticketId, ""),
          verifiedAt: text(verification.verifiedAt, ""),
          verifiedBy: text(verification.verifiedBy, ""),
          expiresAt: text(verification.expiresAt, ""),
        },
      },
      run: (reason, _value, businessValue?: BusinessFormValue) => {
        return perform(async () => {
          await unlockUserSecurity(userId, reason, OPERATOR(), identityEvidence(businessValue, verification, lockKind));
          return `${longLock ? "长" : "短"}锁已立即解除`;
        }, "账户锁定已解除");
      },
    });
  };

  const updateParam = (param: UserCredentialParam) => {
    if (!param.key || param.readOnly || !canWriteConfig) return;
    openActionConfirm({
      action: `凭证参数调整 · ${text(param.name)}`,
      detail: <><b>{text(param.name)}</b> · 当前 {text(param.value)} · {text(param.note)}。只对新签发凭证生效。</>,
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
        return perform(async () => {
          await updateUserCredentialParam(param.key as string, value, reason, OPERATOR());
          return `${text(param.name)} 已更新为 ${value}`;
        }, "凭证参数已更新");
      },
    });
  };

  return (
    <>
      <div className="f-stats">
        <StatCard label="活跃会话(全平台)" value={activeSessions.toLocaleString("en-US")} sub="来自会话统计" />
        <StatCard tone="ok" label="2FA 开启率" value={`${text(overview?.stats?.twoFactorRatePct, "0.0")}%`} sub="来自凭证安全统计" />
        <StatCard tone="warn" label="锁定中账户" value={lockedShort + lockedLong} sub={`短锁 ${lockedShort} · 长锁 ${lockedLong}`} />
        <StatCard tone="danger" label="今日凭证异常回收" value={tokenReuseToday} sub="刷新凭证复用 → 整链踢线" />
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
          <span className="ttl">凭证与会话参数</span>
          <span className="sub">· 后端配置读取 · 改动写入服务端配置</span>
        </div>
        <div className="l-b" style={{ paddingTop: 4 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "0 32px", minWidth: 0 }}>
            {credentialParams.map((param) => (
              <div className="p-row" key={text(param.key)}>
                <div className="txt">
                  <div className="k">
                    {text(param.name)}
                    {param.readOnly && <span className="bdg dim" style={{ marginLeft: 6 }}>V1 只读</span>}
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
            <b>异常自动防御</b> · 同一个长凭证被使用两次时,服务器立即回收整条会话链;挑战码过期与二验强制由后端执行。
          </div>
        </div>
      </section>

      <div className="two-col r125-1">
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">单用户安全处置 · {userLabel(selectedUser)}</span>
            <span className="sub">· 会话 / 2FA / 锁定</span>
            <div className="r">
              <div className="lookup" style={{ position: "relative", minWidth: 320 }}>
                <input
                  value={userLookup}
                  onChange={(event) => {
                    const next = event.target.value;
                    setUserLookup(next);
                    setShowUserMenu(true);
                    if (selectedLookupUser && next !== profileLabel(selectedLookupUser)) {
                      setSelectedLookupUser(null);
                    }
                    if (!selectedLookupUser || next !== profileLabel(selectedLookupUser)) {
                      setSelectedUserKey(NO_USER_SELECTION);
                      if (focusUserCode) replaceFocusUserCode();
                      setOverview(clearSelectedUserFromOverview);
                      setPage(1);
                      setSsId(null);
                      setLockId(null);
                    }
                  }}
                  onFocus={() => setShowUserMenu(true)}
                  onBlur={() => window.setTimeout(() => setShowUserMenu(false), 140)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      chooseFirstUserOption();
                    }
                  }}
                  placeholder="搜索用户编码 / 用户名 / 推荐码 / 手机号"
                />
                <div style={{ marginTop: 4, fontSize: 10.5, color: "var(--ink-4)" }}>
                  手机号仅在本机转为哈希后检索，服务端不会接收明文号码
                </div>
                {showUserMenu && (
                  <div
                    style={{
                      position: "absolute",
                      top: "calc(100% + 6px)",
                      right: 0,
                      left: 0,
                      zIndex: 30,
                      maxHeight: 260,
                      overflowY: "auto",
                      border: "1px solid var(--line)",
                      borderRadius: 8,
                      background: "var(--panel)",
                      boxShadow: "0 14px 36px rgba(15, 23, 42, 0.16)",
                      padding: 6,
                    }}
                  >
                    {userSearchLoading && <div className="ctint" style={{ margin: 4 }}>搜索用户中...</div>}
                    {!userSearchLoading && userOptions.length === 0 && <div className="ctint" style={{ margin: 4 }}>没有匹配用户</div>}
                    {!userSearchLoading && userOptions.map((account) => {
                      const key = profileKey(account) ?? profileLabel(account);
                      return (
                        <button
                          key={key}
                          type="button"
                          className="l-btn"
                          onMouseDown={(event) => {
                            event.preventDefault();
                            selectLookupUser(account);
                          }}
                          style={{
                            width: "100%",
                            justifyContent: "space-between",
                            marginBottom: 4,
                            padding: "8px 10px",
                            textAlign: "left",
                          }}
                        >
                          <span style={{ minWidth: 0 }}>
                            <span style={{ display: "block", fontWeight: 650, color: "var(--ink)" }}>{profileLabel(account)}</span>
                            <span className="mono" style={{ display: "block", marginTop: 3, fontSize: 11, color: "var(--ink-4)" }}>
                              {profileMeta(account)}
                            </span>
                          </span>
                          <span className="bdg ok" style={{ flex: "0 0 auto" }}>选择</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
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
                  const revoked = text(session.status, "").toUpperCase() === "REVOKED";
                  return (
                    <tr key={id} className="click" style={revoked ? { opacity: 0.62 } : undefined} onClick={() => setSsId(id)}>
                      <td className="mono" style={{ color: "var(--ink)" }}>{maskSessionId(id)} <span style={{ fontSize: 10.5, color: "var(--c-ac)" }}>详情›</span></td>
                      <td className="mono" style={{ fontSize: 11.5 }}>{text(session.clientIpMasked)}</td>
                      <td style={{ fontSize: 12 }}>{text(session.deviceName)}</td>
                      <td><span className={`bdg ${sessionTone(session.status)}`}>{sessionStatusLabel(session.status)}</span></td>
                      <td className="mono" style={{ fontSize: 11.5, color: "var(--ink-4)" }}>{formatDateTime(session.lastActiveAt ?? session.issuedAt)}</td>
                      <td style={{ textAlign: "right" }}>
                        {revoked ? (
                          <span className="bdg dim">已踢线</span>
                        ) : (
                          <button className="l-btn sm" disabled={busy || !canRevokeOne} onClick={(event) => { event.stopPropagation(); revokeOne(id); }}>
                            {canRevokeOne ? "踢线" : "无权限"}
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
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="l-btn" disabled={!selectedUserId || busy || !canRevokeAll || activeSessionCount === 0} onClick={revokeAll}>
                {canRevokeAll ? "全部踢线" : "全部踢线（无权限）"}
              </button>
              <button className="l-btn mc" disabled={!selectedUserId || busy || !canDisable2fa || !selectedUser?.twoFactorEnabled} onClick={disable2fa}>
                关闭 2FA（实名二验）
              </button>
              <button className="l-btn mc" disabled={!selectedUserId || busy || !canResetPassword || !!selectedUser?.passwordResetRequired} onClick={passwordReset}>
                密码重置（实名二验）
              </button>
            </div>
            {selectedUser && (
              <>
                <div className="ctint" style={{ marginTop: 10 }}>
                  <b>2FA 状态</b> · {selectedUser.twoFactorEnabled ? "已开启" : "已关闭"} · 登录失败 {toNumber(selectedUser.loginFailCount)} 次
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

      {selectedSession && (
        <Drawer title={`会话详情 · ${maskSessionId(sessionId(selectedSession))}`} sub={`${userLabel(selectedUser)} · ${sessionStatusLabel(selectedSession.status)}`} onClose={() => setSsId(null)}
          footer={<button className="l-btn danger" disabled={busy || !canRevokeOne || text(selectedSession.status, "").toUpperCase() === "REVOKED"} onClick={() => revokeOne(sessionId(selectedSession))}>踢线</button>}>
          <SecLabel>服务器会话</SecLabel>
          <div className="kv"><span className="k">刷新凭证</span><span className="v mono">{maskSessionId(sessionId(selectedSession))}</span></div>
          <div className="kv"><span className="k">设备</span><span className="v">{text(selectedSession.deviceName)}</span></div>
          <div className="kv"><span className="k">IP</span><span className="v mono">{text(selectedSession.clientIpMasked)}</span></div>
          <div className="kv"><span className="k">状态</span><span className="v">{sessionStatusLabel(selectedSession.status)}</span></div>
          <div className="kv"><span className="k">签发</span><span className="v mono">{formatDateTime(selectedSession.issuedAt)}</span></div>
          <div className="kv"><span className="k">过期</span><span className="v mono">{formatDateTime(selectedSession.expiresAt)}</span></div>
          <div className="kv"><span className="k">吊销</span><span className="v mono">{formatDateTime(selectedSession.revokedAt)}</span></div>
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

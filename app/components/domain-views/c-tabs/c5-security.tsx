"use client";

import { currentAdminOperator } from "@/lib/admin/current-operator";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DataListPager, Drawer } from "../design-kit";
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
  type UserSecurityUserRow,
  type UserSession,
} from "@/lib/admin/user360-client";
import type { CCtx } from "./types";

const OPERATOR = currentAdminOperator;
const PAGE_SIZE_OPTIONS = [5, 10, 20, 50];

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

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || "C5_DATA_LOAD_FAILED");
}

function identityTrail(prefix: string, businessValue?: { channel?: string; verifiedAt?: string; ticket?: string }) {
  return `${prefix} · 二验 ${businessValue?.channel ?? "—"} · ${businessValue?.verifiedAt || "—"} · 工单 ${businessValue?.ticket || "—"}`;
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
  const [overview, setOverview] = useState<UserSecurityOverview | null>(null);
  const [selectedUserKey, setSelectedUserKey] = useState("");
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

  const loadData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const key = selectedUserKey.trim();
      const data = await fetchUserSecurityOverview({ userKey: key || undefined, pageNum: page, pageSize });
      setOverview(data);
      setError(null);
    } catch (err) {
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
        const pageData = await fetchUserProfilesPage({ keyword: keyword || undefined, pageNum: 1, pageSize: 8 });
        if (!cancelled) setUserOptions(pageData.records ?? []);
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
  }, [userLookup]);

  const perform = useCallback(async (work: () => Promise<string>, fallback: string) => {
    setBusy(true);
    try {
      const message = await work();
      await loadData(true);
      toast(message || fallback);
      setError(null);
    } catch (err) {
      const message = errorMessage(err);
      setError(`C5 操作失败 · ${message}`);
      toast(`C5 操作失败 · ${message}`);
    } finally {
      setBusy(false);
    }
  }, [loadData, toast]);

  const selectedUser = overview?.selectedUser ?? null;
  const selectedUserId = userIdOf(selectedUser);
  const sessionPage = overview?.sessions;
  const sessions = useMemo(() => sessionPage?.records ?? [], [sessionPage?.records]);
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
    if (!key) return;
    setSelectedLookupUser(account);
    setUserLookup(profileLabel(account));
    setSelectedUserKey(key);
    setPage(1);
    setSsId(null);
    setLockId(null);
    setShowUserMenu(false);
  };

  const chooseFirstUserOption = () => {
    const first = userOptions[0];
    if (first) selectLookupUser(first);
  };

  const revokeOne = (id: string) =>
    openConfirm({
      action: `踢线 · ${id}`,
      detail: "吊销该会话的长短凭证,用户该设备立即下线。后端写入会话吊销时间并产生审计。",
      chips: [["即时 · 服务器吊销", "ready"], ["真实接口 · C5", "done"]],
      reason: true,
      okLabel: "确认踢线",
      run: (reason) => {
        void perform(async () => {
          await revokeUserSession(id, reason, OPERATOR());
          return `${id} 已踢线 · 后端留痕`;
        }, "会话已踢线");
      },
    });

  const revokeAll = () => {
    if (!selectedUserId) return;
    openConfirm({
      action: `全部踢线 · ${userLabel(selectedUser)}`,
      detail: "吊销该用户全部活跃会话,常用于疑似被盗号。结果以后端返回为准。",
      chips: [["整链吊销", "ready"], ["写审计", "done"]],
      reason: true,
      okLabel: "确认全部踢线",
      run: (reason) => {
        void perform(async () => {
          await revokeUserSessions(selectedUserId, reason, OPERATOR());
          return `${userLabel(selectedUser)} 全部会话已踢线`;
        }, "全部会话已踢线");
      },
    });
  };

  const disable2fa = () => {
    if (!selectedUserId) return;
    openActionConfirm({
      action: `人工关闭 2FA · ${userLabel(selectedUser)}`,
      detail: <>用户丢了验证器设备时的恢复通道。前置实名二验,确认通过后服务器关闭 2FA 并作废备份码。</>,
      amplifies: false,
      businessForm: {
        kind: "identity-verify",
        subject: `${userLabel(selectedUser)} · 关闭 2FA`,
        channels: ["视频核实", "当面核实", "回拨预留号码"],
        ticketHint: "如 KYC-20260618-001",
      },
      run: (reason, _value, businessValue) => {
        void perform(async () => {
          await disableUserTwoFactor(selectedUserId, identityTrail(reason, businessValue), OPERATOR());
          return "2FA 已关闭 · 二验结果已留痕";
        }, "2FA 已关闭");
      },
    });
  };

  const passwordReset = () => {
    if (!selectedUserId) return;
    openActionConfirm({
      action: `密码重置 · ${userLabel(selectedUser)}`,
      detail: <>后台看不到也改不了密码明文。确认后作废旧密码并发送一次性重置验证码,用户自行设置新密码。</>,
      amplifies: false,
      businessForm: {
        kind: "identity-verify",
        subject: `${userLabel(selectedUser)} · 密码重置`,
        channels: ["视频核实", "当面核实", "回拨预留号码"],
        ticketHint: "如 KYC-20260618-001",
      },
      run: (reason, _value, businessValue) => {
        void perform(async () => {
          await requestUserPasswordReset(selectedUserId, identityTrail(reason, businessValue), OPERATOR());
          return "旧密码已作废 · 重置验证码已发用户";
        }, "密码重置已提交");
      },
    });
  };

  const unlockUser = (row: UserSecurityUserRow) => {
    const userId = userIdOf(row);
    if (!userId) return;
    const longLock = row.lockKind === "LONG";
    const submit = (reason: string, businessValue?: { channel?: string; verifiedAt?: string; ticket?: string }) => {
      void perform(async () => {
        await unlockUserSecurity(userId, longLock ? identityTrail(reason, businessValue) : reason, OPERATOR());
        return `${userLabel(row)} 已解除锁定`;
      }, "锁定已解除");
    };
    if (longLock) {
      openActionConfirm({
        action: `解除长锁 · ${userLabel(row)}`,
        detail: "长锁通常挂着强制重置流程,解锁等于绕过它。必须完成实名二验并写明原因。",
        amplifies: false,
        businessForm: {
          kind: "identity-verify",
          subject: `${userLabel(row)} · 解除长锁`,
          channels: ["视频核实", "当面核实", "回拨预留号码"],
          ticketHint: "如 SEC-20260618-001",
        },
        run: (reason, _value, businessValue) => submit(reason, businessValue),
      });
      return;
    }
    openConfirm({
      action: `解除短锁 · ${userLabel(row)}`,
      detail: "清空登录失败计数,用户可重新登录。后端更新账户安全状态。",
      chips: [["短锁", "ready"], ["清失败计数", "done"]],
      reason: true,
      okLabel: "确认解锁",
      run: (reason) => submit(reason),
    });
  };

  const updateParam = (param: UserCredentialParam) => {
    if (!param.key || param.readOnly) return;
    openActionConfirm({
      action: `凭证参数调整 · ${text(param.name)}`,
      detail: <><b>{text(param.name)}</b> · 当前 {text(param.value)} · {text(param.note)}。只对新签发凭证生效。</>,
      amplifies: false,
      edit: { kind: "text", current: text(param.value, "") },
      run: (reason, nextValue) => {
        const value = (nextValue ?? "").trim();
        if (!value) return;
        void perform(async () => {
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

      {error && <div className="ctint bad" style={{ marginBottom: 12 }}>{error}</div>}
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
                <button className="l-btn sm mc" disabled={busy || !!param.readOnly} onClick={() => updateParam(param)}>
                  {param.readOnly ? "只读" : "调整"}
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
                  }}
                  onFocus={() => setShowUserMenu(true)}
                  onBlur={() => window.setTimeout(() => setShowUserMenu(false), 140)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      chooseFirstUserOption();
                    }
                  }}
                  placeholder="搜索用户编码 / 用户名 / 手机号 / 邮箱"
                />
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
                      <td className="mono" style={{ color: "var(--ink)" }}>{id} <span style={{ fontSize: 10.5, color: "var(--c-ac)" }}>详情›</span></td>
                      <td className="mono" style={{ fontSize: 11.5 }}>{text(session.clientIpMasked)}</td>
                      <td style={{ fontSize: 12 }}>{text(session.deviceName)}</td>
                      <td><span className={`bdg ${sessionTone(session.status)}`}>{text(session.status)}</span></td>
                      <td className="mono" style={{ fontSize: 11.5, color: "var(--ink-4)" }}>{formatDateTime(session.issuedAt)}</td>
                      <td style={{ textAlign: "right" }}>
                        {revoked ? (
                          <span className="bdg dim">已踢线</span>
                        ) : (
                          <button className="l-btn sm" disabled={busy} onClick={(event) => { event.stopPropagation(); revokeOne(id); }}>踢线</button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {sessions.length === 0 && (
                  <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--ink-4)", padding: "18px 12px" }}>该用户暂无会话记录</td></tr>
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
              <button className="l-btn" disabled={!selectedUserId || busy} onClick={revokeAll}>全部踢线</button>
              <button className="l-btn mc" disabled={!selectedUserId || busy} onClick={disable2fa}>关闭 2FA(操作确认 + 实名二验)</button>
              <button className="l-btn mc" disabled={!selectedUserId || busy} onClick={passwordReset}>密码重置(操作确认 + 实名二验)</button>
            </div>
            {selectedUser && (
              <>
                <div className="ctint" style={{ marginTop: 10 }}>
                  <b>2FA 状态</b> · {selectedUser.twoFactorEnabled ? "已开启" : "已关闭"} · 登录失败 {toNumber(selectedUser.loginFailCount)} 次
                </div>
                {selectedUser.passwordResetRequired && (
                  <div className="ctint warn" style={{ marginTop: 8 }}>
                    <b>密码重置</b> · 旧密码已作废,等待用户完成重置
                  </div>
                )}
              </>
            )}
          </div>
        </section>

        <section className="l-card">
          <div className="l-h">
            <span className="ttl">锁定状态与解除</span>
            <span className="sub">· 锁定事实来自账户安全状态</span>
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
                  <button className={`l-btn sm ${longLock ? "mc" : ""}`} disabled={busy} onClick={(event) => { event.stopPropagation(); unlockUser(row); }}>
                    解锁
                  </button>
                </div>
              );
            })}
            {lockedUsers.length === 0 && <div className="ctint">暂无锁定账户</div>}
          </div>
        </section>
      </div>

      {selectedSession && (
        <Drawer title={`会话详情 · ${sessionId(selectedSession)}`} sub={`${userLabel(selectedUser)} · ${text(selectedSession.status)}`} onClose={() => setSsId(null)}
          footer={<button className="l-btn danger" disabled={busy || text(selectedSession.status, "").toUpperCase() === "REVOKED"} onClick={() => revokeOne(sessionId(selectedSession))}>踢线</button>}>
          <SecLabel>服务器会话</SecLabel>
          <div className="kv"><span className="k">刷新凭证</span><span className="v mono">{sessionId(selectedSession)}</span></div>
          <div className="kv"><span className="k">设备</span><span className="v">{text(selectedSession.deviceName)}</span></div>
          <div className="kv"><span className="k">IP</span><span className="v mono">{text(selectedSession.clientIpMasked)}</span></div>
          <div className="kv"><span className="k">状态</span><span className="v">{text(selectedSession.status)}</span></div>
          <div className="kv"><span className="k">签发</span><span className="v mono">{formatDateTime(selectedSession.issuedAt)}</span></div>
          <div className="kv"><span className="k">过期</span><span className="v mono">{formatDateTime(selectedSession.expiresAt)}</span></div>
          <div className="kv"><span className="k">吊销</span><span className="v mono">{formatDateTime(selectedSession.revokedAt)}</span></div>
        </Drawer>
      )}

      {selectedLock && (
        <Drawer title={`锁定详情 · ${text(selectedLock.userNo)}`} sub={`${text(selectedLock.nickname)} · ${text(selectedLock.lockLabel)}`} onClose={() => setLockId(null)}
          footer={<button className={`l-btn ${selectedLock.lockKind === "LONG" ? "mc" : "primary"}`} disabled={busy} onClick={() => unlockUser(selectedLock)}>解除锁定</button>}>
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

"use client";

/**
 * C5 安全 & 会话 — 单用户账户安全处置面(design_handoff_c_domain port)。
 * 核心规矩 = 防社工夺号:用户端没有「忘记 2FA」自助通道,这里是唯一恢复路径——
 *  - 凭据铁律:关 2FA / 密码重置走 操作确认但**绝不传 edit**(不存在任何可输密码的框);
 *    密码只存哈希,后台看不到也改不了明文,重置 = 作废旧密码 + 发一次性重置验证码;
 *  - 操作确认 显式 edit 契约:凭证参数调整传 edit:{kind:"text",current};处置(踢线/解锁/2FA/重置)不传;
 *  - 锁定两档:15min 短锁普通确认(二验后即时)/ 24h 长锁 操作确认(解锁 = 绕过强制重置);
 *  - 数字单源:SEC(锁定 214 = 短 198 + 长 16,与 C6 同源)/ SESSIONS_2231(C2 同源同行)/
 *    CRED_PARAMS + STEPUP_RO(C.sess.<key> 真写,step-up 线 V1 只读)。
 * 真写键:C.sess.<key> / C.session.<ssid>.forcedOut(单会话)/ C.session.user.<uid>.allOut(整链,
 * 与 C2 强制登出 / 冻结联动同键)/ C.twofa.<uid> / C.user.<uid>.pwReset / C.lock.<id>。
 * 2FA 双源闭合:本页写 C.twofa,360 HUB 走 useUserOps.twoFactorReset —— 关 2FA 同时写两路,
 * 状态 tint 读两源任一(audit P1 修:跨页同实体必同源)。
 */
import { useState } from "react";
import { Drawer, PaginationExemptionList } from "../design-kit";
import { useUserOps, useOpsHydrated } from "@/lib/store/admin/user-ops-store";
import { SEC, SESSIONS_2231, LOCKS, CRED_PARAMS, STEPUP_RO } from "./data";
import type { CCtx } from "./types";

type Step = [what: string, when: string, mark: string];

const markColor = (m: string) =>
  m === "⚠" ? "var(--warning)" : m === "✓" ? "var(--success)" : "var(--ink-4)";

function StepRows({ steps }: { steps: Step[] }) {
  return (
    <>
      {steps.map(([what, when, mark], i) => (
        <div className="kv" key={i}>
          <span className="k" style={{ color: "var(--ink-2)", display: "inline-flex", alignItems: "center", gap: 7 }}>
            <span style={{ color: markColor(mark) }}>{mark}</span>
            {what}
          </span>
          <span className="v mono" style={{ fontSize: 11.5, fontWeight: 500, color: "var(--ink-4)" }}>{when}</span>
        </div>
      ))}
    </>
  );
}

function SecLabel({ children }: { children: string }) {
  return <div style={{ fontSize: 12.5, fontWeight: 600, margin: "14px 0 4px", color: "var(--ink)" }}>{children}</div>;
}

// 锁定明细连错记录(照设计稿:长锁 3 行 / 短锁 2 行)。
const lockSteps = (long: boolean): Step[] =>
  long
    ? [["密码错误 · 5 次 → 触发短锁", "—", "✓"], ["短锁内继续错 · 累计 10 次", "—", "✓"], ["升级 24h 长锁 + 挂强制重置", "已触发", "⚠"]]
    : [["密码错误 · 累计 5 次", "—", "✓"], ["触发 15 分钟短锁", "已触发", "⚠"]];

export function C5Security({ ctx }: { ctx: CCtx }) {
  const { pget, setParam, toast, openActionConfirm, openConfirm } = ctx;
  const resetTwoFactor = useUserOps((s) => s.resetTwoFactor);
  const opsTwofaReset = useUserOps((s) => s.users);
  const hydrated = useOpsHydrated();
  const [uid, setUid] = useState("usr_2231");
  const [inp, setInp] = useState("usr_2231");
  const [ssId, setSsId] = useState<string | null>(null);
  const [lockId, setLockId] = useState<string | null>(null);

  // 会话样本只有 usr_2231(C2 账户明细「活跃会话 3 个」同源同行);其他 uid 空表。
  const sessions = uid === "usr_2231" ? SESSIONS_2231 : [];
  // 整链踢线(C2 强制登出 / 冻结联动 / 本页全部踢线同键)→ 单会话行同步显示已踢。
  const userAllOut = pget(`C.session.user.${uid}.allOut`) === "true";
  // 2FA 双源任一关闭即显示关闭(本页 C.twofa + 360 HUB twoFactorReset 同实体同态)。
  const twofaOff = pget(`C.twofa.${uid}`) === "disabled" || (hydrated && !!opsTwofaReset[uid]?.twoFactorReset);
  const pwSent = pget(`C.user.${uid}.pwReset`) === "link-sent";

  const ss = ssId ? SESSIONS_2231.find((s) => s.id === ssId) : undefined;
  const lk = lockId ? LOCKS.find((l) => l.id === lockId) : undefined;

  const revokeOne = (id: string) =>
    openConfirm({
      action: `踢线 · ${id}`,
      detail: "吊销该会话的长短凭证,用户该设备立即下线。收紧动作,单人即时,写原因。",
      chips: [["即时 · 服务器吊销", "ready"], ["和 C2 共用审计事件", "done"]],
      reason: true,
      okLabel: "确认踢线",
      run: (reason) => {
        setParam(`C.session.${id}.forcedOut`, "true", { action: `踢线 ${id} · admin.session_revoked`, reason });
        toast(`${id} 已踢线 · 留痕`);
      },
    });

  return (
    <>
      <div className="f-stats">
        <div className="f-stat"><div className="k">活跃会话(全平台)</div><div className="v">{SEC.activeSessions.toLocaleString("en-US")}</div><div className="sub">30 天不活跃自动过期</div></div>
        <div className="f-stat ok"><div className="k">2FA 开启率</div><div className="v">{SEC.twofaRate}%</div><div className="sub">TOTP · 备份码上限 8 个</div></div>
        <div className="f-stat warn"><div className="k">锁定中账户</div><div className="v">{SEC.lockedShort + SEC.lockedLong}</div><div className="sub">短锁 {SEC.lockedShort} · 长锁 {SEC.lockedLong}</div></div>
        <div className="f-stat danger"><div className="k">今日凭证异常回收</div><div className="v">{SEC.tokenReuseToday}</div><div className="sub">刷新凭证被重复使用 → 整链踢线</div></div>
      </div>

      {/* 凭证与会话参数(C.sess.<key> 真写;step-up 再验证线 V1 只读) */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">凭证与会话参数</span>
          <span className="sub">· 安全基础设施参数,改动操作确认 · 只对新签发生效</span>
        </div>
        <div className="l-b" style={{ paddingTop: 4 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 40px", minWidth: 0 }}>
            {CRED_PARAMS.map((p) => {
              const v = pget(`C.sess.${p.key}`) ?? p.cur;
              return (
                <div className="p-row" key={p.key}>
                  <div className="txt">
                    <div className="k">{p.name}</div>
                    <div className="s">{p.sub}</div>
                  </div>
                  <span className="v">{v}</span>
                  <button className="l-btn sm mc" onClick={() => openActionConfirm({
                    action: `凭证参数调整 · ${p.name}`,
                    detail: <><b>{p.name}</b> · 当前 {v} · {p.note}。安全基础设施参数,操作确认。</>,
                    amplifies: false,
                    edit: { kind: "text", current: v },
                    run: (reason, nv) => {
                      if (!nv) return;
                      setParam(`C.sess.${p.key}`, nv, { action: `凭证参数调整 ${p.name}`, reason });
                      toast(`${p.name} 已更新为 ${nv} · 理由留痕`);
                    },
                  })}>调整</button>
                </div>
              );
            })}
            <div className="p-row">
              <div className="txt">
                <div className="k">{STEPUP_RO.name} <span className="bdg dim">V1 只读</span></div>
                <div className="s">{STEPUP_RO.sub}</div>
              </div>
              <span className="v">{STEPUP_RO.cur}</span>
            </div>
          </div>
          <div className="ctint" style={{ marginTop: 10 }}><b>异常自动防御</b> · 同一个长凭证被使用两次(疑似被盗复制)→ 服务器立即回收整条会话链;两步验证的挑战码 5 分钟过期(固定)。</div>
        </div>
      </section>

      <div className="two-col r125-1">
        {/* 单用户安全处置 */}
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">单用户安全处置 · {uid}</span>
            <span className="sub">· 会话 / 2FA / 锁定</span>
            <div className="r">
              <div className="lookup">
                <input value={inp} onChange={(e) => setInp(e.target.value)} />
                <button className="l-btn primary" onClick={() => {
                  const id = inp.trim() || "usr_2231";
                  setUid(id);
                  toast(`已加载 ${id} 的会话与安全状态`);
                }}>查询</button>
              </div>
            </div>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="l-tbl" style={{ minWidth: 620 }}>
              <thead><tr><th>会话</th><th>IP</th><th>设备</th><th>最近活跃</th><th style={{ textAlign: "right" }}>动作</th></tr></thead>
              <tbody>
                {sessions.map((s) => {
                  const forcedOut = pget(`C.session.${s.id}.forcedOut`) === "true" || userAllOut;
                  return (
                    <tr key={s.id} className="click" style={forcedOut ? { opacity: 0.62 } : undefined} onClick={() => setSsId(s.id)}>
                      <td className="mono" style={{ color: "var(--ink)" }}>{s.id} <span style={{ fontSize: 10.5, color: "var(--c-ac)" }}>详情›</span></td>
                      <td className="mono" style={{ fontSize: 11.5 }}>{s.ip}</td>
                      <td style={{ fontSize: 12 }}>{s.dev}</td>
                      <td className="mono" style={{ fontSize: 11.5, color: "var(--ink-4)" }}>{s.last}</td>
                      <td style={{ textAlign: "right" }}>
                        {forcedOut
                          ? <span className="bdg dim">已踢线</span>
                          : <button className="l-btn sm" onClick={(e) => { e.stopPropagation(); revokeOne(s.id); }}>踢线</button>}
                      </td>
                    </tr>
                  );
                })}
                {sessions.length === 0 && (
                  <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--ink-4)", padding: "18px 12px" }}>该用户暂无活跃会话记录</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="l-b" style={{ paddingTop: 10 }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="l-btn" onClick={() => openConfirm({
                action: `全部踢线 · ${uid}`,
                detail: "吊销该用户全部会话(常用于疑似被盗号)。收紧动作单人即时,写原因。",
                chips: [["整链吊销", "ready"], ["落审计 · 喂 B5", "done"]],
                reason: true,
                okLabel: "确认全部踢线",
                run: (reason) => {
                  // 整链键以当前查询 uid 为目标(audit P1 修:不再固定写 usr_2231 的会话);
                  // user 级 allOut 与 C2 强制登出 / 冻结联动同键,单会话行派生同步显示已踢。
                  setParam(`C.session.user.${uid}.allOut`, "true", { action: `全部踢线 ${uid} · admin.session_revoked`, reason });
                  toast(`${uid} 全部会话已踢线 · 留痕 · 喂 B5`);
                },
              })}>全部踢线</button>
              {/* 凭据铁律:关 2FA / 密码重置 = 处置,绝不传 edit —— 不存在任何可输密码的框 */}
              <button className="l-btn mc" onClick={() => openActionConfirm({
                action: "人工关闭 2FA(丢设备路径 · 实名二验)",
                detail: <>用户丢了验证器设备时的唯一恢复通道。<b>前置:用户先过一次实名二验</b>(结果会记进审计);确认通过后服务器关闭 2FA 并作废全部备份码,用户重新走开启流程。操作确认防社工——攻击者最爱借客服关 2FA。带防重号,重复请求不会重复作废。</>,
                amplifies: false,
                run: (reason) => {
                  setParam(`C.twofa.${uid}`, "disabled", { action: `人工关闭 2FA ${uid} · admin.2fa_disabled`, reason });
                  resetTwoFactor(uid); // 双源同写:360 HUB(useUserOps.twoFactorReset)同实体同态
                  toast("2FA 已关闭 · 二验结果与操作确认留痕");
                },
              })}>关闭 2FA(操作确认 + 实名二验)</button>
              <button className="l-btn mc" onClick={() => openActionConfirm({
                action: "密码重置(操作确认 + 实名二验)",
                detail: <><b>看不到也改不了密码明文</b>(只存哈希)。确认通过后:作废当前密码,给用户手机发一次性重置验证码,用户自己设新密码后获得新会话。前置实名二验,带防重号。</>,
                amplifies: false,
                run: (reason) => {
                  setParam(`C.user.${uid}.pwReset`, "link-sent", { action: `密码重置 ${uid}(发送重置验证码,后台不持有明文)`, reason });
                  toast("密码已作废 · 重置验证码已发用户 · 留痕");
                },
              })}>密码重置(操作确认 + 实名二验)</button>
            </div>
            <div className="ctint" style={{ marginTop: 10 }}>
              {twofaOff
                ? <><b>2FA 状态</b> · 已关闭(人工)· 备份码已作废 · 等用户重新开启</>
                : <><b>2FA 状态</b> · 已开启(TOTP)· 备份码剩 6 / 8 · 开启于 3/14</>}
            </div>
            {pwSent && (
              <div className="ctint warn" style={{ marginTop: 8 }}><b>密码重置</b> · 已作废旧密码并发送一次性重置验证码 · 等用户完成重置</div>
            )}
          </div>
        </section>

        {/* 锁定状态与解除(阈值在 C6 配,处置权在本页) */}
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">锁定状态与解除</span>
            <span className="sub">· 解锁处置权在这页;「何时锁」的阈值在 C6 配</span>
          </div>
          <div className="l-b">
            {LOCKS.map((l) => {
              const long = l.type === "24h";
              const unlocked = pget(`C.lock.${l.id}`) === "unlocked";
              return (
                <div className="lock-row" key={l.id} style={unlocked ? { opacity: 0.62 } : undefined} onClick={() => setLockId(l.id)}>
                  <span className="mono" style={{ fontWeight: 600, color: "var(--ink)" }}>{l.id} <span style={{ fontSize: 10.5, color: "var(--c-ac)" }}>详情›</span></span>
                  <span className={`bdg ${long ? "bad" : "warn"}`}>{long ? "24 小时长锁" : "15 分钟短锁"}</span>
                  <span style={{ flex: 1, fontSize: 12, color: "var(--ink-3)" }}>{l.why}</span>
                  <span className="mono" style={{ fontSize: 11.5, color: "var(--ink-4)" }}>{l.left}</span>
                  {unlocked ? (
                    <span className="bdg dim">已解除 · 留痕</span>
                  ) : long ? (
                    <button className="l-btn sm mc" onClick={(e) => {
                      e.stopPropagation();
                      openActionConfirm({
                        action: `解除 24 小时长锁 · ${l.id}`,
                        detail: "长锁挂着强制重置流程,解锁等于绕过它——操作确认 + 用户先过实名二验(结果入审计)。",
                        amplifies: false,
                        run: (reason) => {
                          setParam(`C.lock.${l.id}`, "unlocked", { action: `解除 24h 长锁 ${l.id}`, reason });
                          toast(`${l.id} 长锁已解除 · 操作确认 + 二验留痕`);
                        },
                      });
                    }}>解锁(操作确认)</button>
                  ) : (
                    <button className="l-btn sm" onClick={(e) => {
                      e.stopPropagation();
                      openConfirm({
                        action: `解除 15 分钟短锁 · ${l.id}`,
                        detail: "高频排障路径:用户过实名二验后即时解锁,写原因留痕。",
                        chips: [["实名二验前置", "ready"], ["即时 · 留痕", "done"]],
                        reason: true,
                        okLabel: "确认解锁",
                        run: (reason) => {
                          setParam(`C.lock.${l.id}`, "unlocked", { action: `解除 15min 短锁 ${l.id}`, reason });
                          toast(`${l.id} 短锁已解除 · 留痕`);
                        },
                      });
                    }}>解锁(二验后即时)</button>
                  )}
                </div>
              );
            })}
            <div className="ctint" style={{ marginTop: 12 }}><b>两档解锁路径</b> · <b>15 分钟短锁</b>(密码或 2FA 连错 5 次):客服让用户过实名二验后即时解,写原因;<b>24 小时长锁</b>(连错 10 次,带强制重置):操作确认 + 实名二验——解长锁等于绕过强制重置,所以审得严。</div>
          </div>
        </section>
      </div>

      <p className="f-foot"><b>真值都在服务器</b>:客户端把「2FA 已开启」改成关闭没有用——敏感操作校验的是会话凭证里的服务器标记;踢线是服务器吊销长短凭证,客户端不能本地续命。强制登出和账户操作页(C2)共用同一套会话体系和同一条审计事件。关 2FA、重置密码、解锁的每一步(含实名二验结果)全部进审计,异常安全事件(批量踢线、关 2FA 激增)喂风险雷达(B5)。</p>
      <PaginationExemptionList
        items={[
          {
            label: "单用户安全处置 · usr_2231",
            maxRows: 3,
            reason: "安全处置表仅展示当前查询用户会话,完整检索由查询框切换",
          },
        ]}
      />

      {/* 会话明细 Drawer */}
      {ss && (
        <Drawer title={`会话明细 · ${ss.id}`} onClose={() => setSsId(null)}
          footer={<button className="l-btn" style={{ flex: 1, justifyContent: "center" }} onClick={() => setSsId(null)}>关闭</button>}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink)" }}>{ss.dev} · {ss.ip}</div>
          <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 4, lineHeight: 1.6 }}>最近活跃 {ss.last}。会话真值在服务器,客户端改不了;踢线 = 服务器吊销长短凭证。</div>
          <SecLabel>登录轨迹</SecLabel>
          <StepRows steps={ss.trail} />
          <SecLabel>设备与位置</SecLabel>
          <div className="kv"><span className="k">设备指纹</span><span className="v">{ss.fp}</span></div>
          <div className="kv"><span className="k">登录地</span><span className="v">{ss.geo}</span></div>
          <div className="kv"><span className="k">凭证</span><span className="v">{ss.tok}</span></div>
          <div className="ctint" style={{ marginTop: 12 }}><b>处置在右侧「踢线」</b>:吊销该会话凭证。可疑登录地/代理 IP 会同步给风险雷达(B5)。</div>
        </Drawer>
      )}

      {/* 锁定明细 Drawer */}
      {lk && (() => {
        const long = lk.type === "24h";
        return (
          <Drawer title={`锁定明细 · ${lk.id}`} onClose={() => setLockId(null)}
            footer={<button className="l-btn" style={{ flex: 1, justifyContent: "center" }} onClick={() => setLockId(null)}>关闭</button>}>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink)" }}>{long ? "24 小时长锁" : "15 分钟短锁"} · {lk.left}</div>
            <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 4, lineHeight: 1.6 }}>触发原因:{lk.why}。计数按 IP + 账户双维度在服务器记,锁定期间一切登录 / 发码 / 重置都拒。</div>
            <SecLabel>连错记录(本次锁定窗内)</SecLabel>
            <StepRows steps={lockSteps(long)} />
            <SecLabel>锁定信息</SecLabel>
            <div className="kv"><span className="k">类型</span><span className="v">{long ? "24 小时长锁(挂强制重置)" : "15 分钟短锁"}</span></div>
            <div className="kv"><span className="k">计数维度</span><span className="v">IP + 账户</span></div>
            <div className="kv"><span className="k">剩余</span><span className="v">{lk.left}</span></div>
            <div className="kv"><span className="k">解锁条件</span><span className="v">{long ? "操作确认 + 实名二验" : "实名二验后即时"}</span></div>
            <div className="ctint" style={{ marginTop: 12 }}><b>解锁入口在右侧</b>:{long ? "长锁解锁等于绕过强制重置,操作确认 + 实名二验。" : "短锁过实名二验即时解。"} 锁定阈值在登录风控页(C6)配,这里只处置。</div>
          </Drawer>
        );
      })()}
    </>
  );
}

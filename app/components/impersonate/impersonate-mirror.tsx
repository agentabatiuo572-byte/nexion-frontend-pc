"use client";

/**
 * ImpersonateMirror — 「只读代入」假前端镜像(原型用,开发能看懂)。
 *
 * 真实平台里,客服确认代入后会载入「用户真实 App 的只读副本」,看到用户屏幕上一模一样的画面用于排障。
 * Nexion 用户前端(Nexion-prototype)是独立工程 + 单人 persona + `X-Frame-Options: DENY`(不能被 iframe),
 * 所以这里在 admin 内造一个**同源、按该用户数据填充、天然只读**的手机镜像:
 *   顶部代入横幅(用户 / 倒计时 / 退出)+ 手机框内仿 Nexion 消费端首页/设备/我的三屏 + 写操作一律禁用。
 * 数据来自被代入用户(c-view 的 USERS 行:余额 / NEX / 设备数 / V 级 / KYC / 冻结态…)。
 */
import { useEffect, useMemo, useState } from "react";
import { Wallet, Cpu, User as UserIcon, Users, Home, Eye, X, Lock, Snowflake, ShieldAlert, ChevronRight } from "lucide-react";

export interface ImpersonateUser {
  id: string;
  name: string;
  lc: string;       // 生命周期 L0–L5
  vrank: string;    // V0–V12
  devices: number;  // 设备数
  kyc: string;      // verified / pending / review
  risk: number;
  balance: number;  // USDT
  nex: number;      // NEX
  ref: string;      // 邀请码
  frozen: boolean;
  joined: string;
}

const SESSION_SECONDS = 30 * 60; // 只读代入会话 ≤ 30min
const DEVICE_MODELS = ["NexionBox Pro", "NexionBox Standard", "NexionBox Lite", "NexionBox Pro v2", "NexionBox Mini", "NexionBox Standard v2"];
const DEVICE_RATE = [7.8, 2.85, 0.62, 8.6, 0.3, 3.2];

const fmtUsd = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
const fmtNex = (n: number) => n.toLocaleString("en-US") + " NEX";
const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

type Tab = "home" | "devices" | "me";

export function ImpersonateMirror({ user, onExit }: { user: ImpersonateUser; onExit: () => void }) {
  const [left, setLeft] = useState(SESSION_SECONDS);
  const [tab, setTab] = useState<Tab>("home");
  const [flash, setFlash] = useState(false);

  // 会话倒计时:到 0 自动结束(令牌过期)
  useEffect(() => {
    const t = setInterval(() => setLeft((s) => (s <= 1 ? (onExit(), 0) : s - 1)), 1000);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onExit(); };
    document.addEventListener("keydown", onKey);
    return () => { clearInterval(t); document.removeEventListener("keydown", onKey); };
  }, [onExit]);

  // 写操作拦截:只读代入下任何用户端写动作都被挡,给出提示
  const blockWrite = () => { setFlash(true); setTimeout(() => setFlash(false), 1600); };

  const todayEarn = useMemo(() => Math.round(user.devices * 14.2 * 100) / 100, [user.devices]);
  const devices = useMemo(
    () => Array.from({ length: Math.max(user.devices, 1) }, (_, i) => ({
      model: DEVICE_MODELS[i % DEVICE_MODELS.length],
      rate: DEVICE_RATE[i % DEVICE_RATE.length],
      eff: 92 - i * 7,
    })),
    [user.devices],
  );

  return (
    <div onClick={onExit} style={S.scrim}>
      {/* 代入横幅(admin chrome,非用户 App 的一部分)*/}
      <div style={S.wrap} onClick={(e) => e.stopPropagation()}>
        <div style={S.banner}>
          <Eye size={15} style={{ flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 12.5 }}>只读代入中 · {user.name}</div>
            <div style={{ fontSize: 10.5, opacity: 0.85 }}>{user.id} · 客服视角 · 全程 A2 留痕 · 不可改任何数据</div>
          </div>
          <span style={S.timer} title="会话剩余,到期自动结束并吊销令牌"><Lock size={11} /> {mmss(left)}</span>
          <button onClick={onExit} style={S.exitBtn}><X size={13} /> 退出代入</button>
        </div>

        {/* 手机框:仿 Nexion 消费端(暗色),只读 */}
        <div style={S.phone}>
          <div style={S.statusbar}><span>9:41</span><span style={{ display: "flex", gap: 4, opacity: 0.7 }}>● ▲ ▮</span></div>

          <div style={S.screen}>
            {user.frozen && (
              <div style={S.alert("var(--v5-danger, #e5484d)")}><Snowflake size={14} /> 账户冻结中 · 提现与交易已暂停,请联系客服</div>
            )}
            {!user.frozen && user.kyc !== "verified" && (
              <div style={S.alert("var(--v5-warning, #f5a623)")}><ShieldAlert size={14} /> 实名待完成 · 完成后解锁提现与高额度</div>
            )}

            {tab === "home" && <>
              <div style={S.hi}>
                <div>
                  <div style={{ fontSize: 12, color: "var(--v5-ink-4,#8a8a8a)" }}>欢迎回来</div>
                  <div style={{ fontSize: 19, fontWeight: 700, color: "var(--v5-ink,#f5f5f5)" }}>{user.name}</div>
                </div>
                <span style={S.vchip}>{user.vrank}</span>
              </div>

              <div style={S.walletCard}>
                <div style={{ fontSize: 11.5, color: "rgba(10,10,10,.66)", fontWeight: 600 }}>钱包余额</div>
                <div style={{ fontSize: 30, fontWeight: 800, color: "#0a0a0a", lineHeight: 1.1, marginTop: 2 }}>{fmtUsd(user.balance)}</div>
                <div style={{ fontSize: 12.5, color: "rgba(10,10,10,.72)", fontWeight: 600, marginTop: 2 }}>{fmtNex(user.nex)}</div>
                <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                  <button onClick={blockWrite} style={S.cta("#0a0a0a", "rgba(10,10,10,.12)")}>充值</button>
                  <button onClick={blockWrite} style={S.cta("#0a0a0a", "rgba(10,10,10,.12)")}>提现</button>
                </div>
              </div>

              <div style={S.card}>
                <div style={S.rowBetween}>
                  <span style={{ fontSize: 12.5, color: "var(--v5-ink-3,#a8a8a8)" }}>今日收益</span>
                  <button onClick={blockWrite} style={S.linkBtn}>领取 <ChevronRight size={12} /></button>
                </div>
                <div style={{ fontSize: 24, fontWeight: 800, color: "var(--v5-brand,#9EDC1D)", marginTop: 2 }}>+{fmtUsd(todayEarn)}</div>
                <div style={{ fontSize: 11, color: "var(--v5-ink-4,#8a8a8a)", marginTop: 2 }}>{user.devices} 台设备在产 · 已结算至今日 UTC 0 点</div>
              </div>

              <div style={S.grid3}>
                {[["设备", String(user.devices)], ["等级", user.vrank], ["生命周期", user.lc]].map(([k, v]) => (
                  <div key={k} style={S.stat}><div style={S.statV}>{v}</div><div style={S.statK}>{k}</div></div>
                ))}
              </div>
            </>}

            {tab === "devices" && <>
              <div style={S.sectionTitle}>我的设备 · {user.devices} 台</div>
              {devices.map((d, i) => (
                <div key={i} style={S.card}>
                  <div style={S.rowBetween}>
                    <span style={{ fontWeight: 700, fontSize: 14, color: "var(--v5-ink,#f5f5f5)" }}>{d.model}</span>
                    <span style={S.runChip}>运行中</span>
                  </div>
                  <div style={{ display: "flex", gap: 16, marginTop: 8 }}>
                    <div><div style={S.mini}>日产</div><div style={S.miniV}>${d.rate.toFixed(2)}/d</div></div>
                    <div><div style={S.mini}>效能</div><div style={S.miniV}>{Math.max(d.eff, 30)}%</div></div>
                    <div><div style={S.mini}>状态</div><div style={{ ...S.miniV, color: "var(--v5-success,#29D27F)" }}>正常</div></div>
                  </div>
                </div>
              ))}
              <button onClick={blockWrite} style={S.cta("var(--v5-brand,#9EDC1D)", "transparent", true)}>购买新设备</button>
            </>}

            {tab === "me" && <>
              <div style={S.meHead}>
                <div style={S.avatar}>{user.name.charAt(0)}</div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: "var(--v5-ink,#f5f5f5)" }}>{user.name}</div>
                  <div style={{ fontSize: 11.5, color: "var(--v5-ink-4,#8a8a8a)" }}>{user.id} · 加入于 {user.joined}</div>
                </div>
              </div>
              {[
                ["邀请码", user.ref],
                ["V 等级", user.vrank],
                ["实名状态", user.kyc === "verified" ? "已认证" : user.kyc === "review" ? "审核中" : "待完成"],
                ["账户状态", user.frozen ? "已冻结" : "正常"],
              ].map(([k, v]) => (
                <div key={k} style={S.kvRow}><span style={{ color: "var(--v5-ink-3,#a8a8a8)", fontSize: 13 }}>{k}</span><span style={{ color: "var(--v5-ink,#f5f5f5)", fontSize: 13, fontWeight: 600 }}>{v}</span></div>
              ))}
              {["收益明细", "我的团队", "安全设置", "帮助与客服"].map((m) => (
                <button key={m} onClick={blockWrite} style={S.menuRow}>{m}<ChevronRight size={14} style={{ color: "var(--v5-ink-4,#8a8a8a)" }} /></button>
              ))}
            </>}
          </div>

          {/* 底部 tab 栏 */}
          <div style={S.tabbar}>
            {([["home", "首页", Home], ["devices", "设备", Cpu], ["me", "我的", UserIcon]] as const).map(([t, label, Ico]) => (
              <button key={t} onClick={() => setTab(t)} style={S.tabBtn(tab === t)}>
                <Ico size={18} /><span style={{ fontSize: 10 }}>{label}</span>
              </button>
            ))}
            <button onClick={blockWrite} style={S.tabBtn(false)}><Users size={18} /><span style={{ fontSize: 10 }}>团队</span></button>
          </div>

          {flash && <div style={S.flash}><Lock size={12} /> 只读代入 · 不可操作</div>}
        </div>

        <div style={{ fontSize: 11, color: "var(--v5-ink-4,#8a8a8a)", textAlign: "center", marginTop: 8 }}>
          ↑ 用户 {user.id} 在 App 内看到的画面(只读副本)· 所有按钮已禁用 · 按 Esc 或「退出代入」结束
        </div>
      </div>
    </div>
  );
}

/* ---- styles(消费端暗色,区别于 admin ops 风)---- */
const S = {
  scrim: { position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,.78)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, overflow: "auto" } as React.CSSProperties,
  wrap: { width: 412, maxWidth: "100%", display: "flex", flexDirection: "column", gap: 0 } as React.CSSProperties,
  banner: { display: "flex", alignItems: "center", gap: 9, padding: "9px 12px", borderRadius: "12px 12px 0 0", background: "var(--v5-warning,#f5a623)", color: "#0a0a0a" } as React.CSSProperties,
  timer: { display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11.5, fontWeight: 700, fontVariantNumeric: "tabular-nums", background: "rgba(10,10,10,.16)", padding: "3px 7px", borderRadius: 999 } as React.CSSProperties,
  exitBtn: { display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11.5, fontWeight: 700, color: "#0a0a0a", background: "rgba(10,10,10,.16)", border: "1px solid rgba(10,10,10,.28)", borderRadius: 999, padding: "4px 9px", cursor: "pointer" } as React.CSSProperties,
  phone: { position: "relative", background: "var(--v5-bg,#0a0a0a)", border: "1px solid var(--v5-border-strong,#3a3a3a)", borderTop: "none", borderRadius: "0 0 28px 28px", overflow: "hidden", display: "flex", flexDirection: "column", height: "min(74vh, 720px)" } as React.CSSProperties,
  statusbar: { display: "flex", justifyContent: "space-between", padding: "8px 18px 4px", fontSize: 11, fontWeight: 600, color: "var(--v5-ink-3,#a8a8a8)" } as React.CSSProperties,
  screen: { flex: 1, overflowY: "auto", padding: "8px 14px 14px", display: "flex", flexDirection: "column", gap: 12 } as React.CSSProperties,
  alert: (c: string): React.CSSProperties => ({ display: "flex", alignItems: "center", gap: 7, fontSize: 12, fontWeight: 600, color: c, background: `color-mix(in srgb, ${c} 14%, transparent)`, border: `1px solid color-mix(in srgb, ${c} 36%, transparent)`, borderRadius: 11, padding: "9px 11px" }),
  hi: { display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 2 } as React.CSSProperties,
  vchip: { fontSize: 12, fontWeight: 700, color: "var(--v5-brand,#9EDC1D)", background: "color-mix(in srgb, var(--v5-brand,#9EDC1D) 16%, transparent)", border: "1px solid color-mix(in srgb, var(--v5-brand,#9EDC1D) 36%, transparent)", borderRadius: 999, padding: "3px 11px" } as React.CSSProperties,
  walletCard: { background: "var(--v5-brand,#9EDC1D)", borderRadius: 18, padding: "16px 18px" } as React.CSSProperties,
  card: { background: "var(--v5-surface,#161616)", border: "1px solid var(--v5-border,#262626)", borderRadius: 16, padding: "14px 16px" } as React.CSSProperties,
  rowBetween: { display: "flex", alignItems: "center", justifyContent: "space-between" } as React.CSSProperties,
  cta: (fg: string, bg: string, outline = false): React.CSSProperties => ({ flex: 1, padding: "9px 0", borderRadius: 11, fontSize: 13, fontWeight: 700, color: fg, background: outline ? "transparent" : bg, border: outline ? `1.5px solid ${fg}` : "none", cursor: "pointer", width: "100%" }),
  linkBtn: { display: "inline-flex", alignItems: "center", gap: 2, fontSize: 12, fontWeight: 600, color: "var(--v5-brand,#9EDC1D)", background: "none", border: "none", cursor: "pointer" } as React.CSSProperties,
  grid3: { display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 } as React.CSSProperties,
  stat: { background: "var(--v5-surface,#161616)", border: "1px solid var(--v5-border,#262626)", borderRadius: 13, padding: "11px 8px", textAlign: "center" } as React.CSSProperties,
  statV: { fontSize: 17, fontWeight: 800, color: "var(--v5-ink,#f5f5f5)" } as React.CSSProperties,
  statK: { fontSize: 10.5, color: "var(--v5-ink-4,#8a8a8a)", marginTop: 2 } as React.CSSProperties,
  sectionTitle: { fontSize: 13, fontWeight: 700, color: "var(--v5-ink,#f5f5f5)", marginTop: 2 } as React.CSSProperties,
  runChip: { fontSize: 10.5, fontWeight: 600, color: "var(--v5-success,#29D27F)", background: "color-mix(in srgb, var(--v5-success,#29D27F) 15%, transparent)", borderRadius: 999, padding: "2px 8px" } as React.CSSProperties,
  mini: { fontSize: 10, color: "var(--v5-ink-4,#8a8a8a)" } as React.CSSProperties,
  miniV: { fontSize: 13, fontWeight: 700, color: "var(--v5-ink,#f5f5f5)", fontVariantNumeric: "tabular-nums" } as React.CSSProperties,
  meHead: { display: "flex", alignItems: "center", gap: 12, marginTop: 4 } as React.CSSProperties,
  avatar: { width: 48, height: 48, borderRadius: 14, background: "var(--v5-brand,#9EDC1D)", color: "#0a0a0a", display: "grid", placeItems: "center", fontSize: 20, fontWeight: 800, flexShrink: 0 } as React.CSSProperties,
  kvRow: { display: "flex", justifyContent: "space-between", padding: "11px 14px", background: "var(--v5-surface,#161616)", border: "1px solid var(--v5-border,#262626)", borderRadius: 12 } as React.CSSProperties,
  menuRow: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", background: "var(--v5-surface,#161616)", border: "1px solid var(--v5-border,#262626)", borderRadius: 12, fontSize: 13, color: "var(--v5-ink-2,#d8d8d8)", cursor: "pointer", width: "100%" } as React.CSSProperties,
  tabbar: { display: "flex", borderTop: "1px solid var(--v5-border,#262626)", background: "var(--v5-surface,#161616)", padding: "6px 0 10px" } as React.CSSProperties,
  tabBtn: (active: boolean): React.CSSProperties => ({ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2, background: "none", border: "none", cursor: "pointer", color: active ? "var(--v5-brand,#9EDC1D)" : "var(--v5-ink-4,#8a8a8a)" }),
  flash: { position: "absolute", bottom: 70, left: "50%", transform: "translateX(-50%)", display: "inline-flex", alignItems: "center", gap: 5, background: "var(--v5-surface-3,#222)", color: "var(--v5-ink,#f5f5f5)", border: "1px solid var(--v5-border-strong,#3a3a3a)", borderRadius: 999, padding: "7px 14px", fontSize: 12, fontWeight: 600, boxShadow: "0 8px 24px rgba(0,0,0,.5)", whiteSpace: "nowrap" } as React.CSSProperties,
};

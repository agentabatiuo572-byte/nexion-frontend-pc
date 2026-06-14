"use client";

/**
 * C2 账户操作 — design_handoff_c_domain port。冻结台账的权威页:
 *  - 账户处置:冻结(操作确认,不传 edit)/ 解冻(操作确认,amplifies 放大流出)/ 强制登出(普通确认,必填原因);
 *    冻结实时态 = useUserOps 共享 store(与 /users/search/[id] 360 页同源),
 *    冻结原子联动在途提现 D.withdraw.<id>.st 同键真写(D2 实时跟);
 *  - 模拟登录控制台:操作确认 授权(edit=userId)→ logAudit + startMirror 只读镜像;终止/轨迹 Drawer;
 *  - 信任/禁入名单:操作确认(edit=userId)动态行 = params 扫 C.list.add.<uid>,移出 = C.list.rm.<id>。
 * 撞号裁定按 data.ts:usr_8807=flagged CL-318 / usr_6201=frozen CL-301(K1 批量)/ usr_55B1=frozen 风控命中。
 */
import { useState } from "react";
import Link from "next/link";
import { Drawer, PaginationExemptionList } from "../design-kit";
import { useUserOps, useOpsHydrated } from "@/lib/store/admin/user-ops-store";
import {
  C2_ACCOUNTS, C2_ACCT_STATE, C2_LISTS, LIST_BASE, IMPERSONATIONS, SESSIONS_2231,
  frozenTotal, K1_FROZEN_ACCOUNTS, K1_PATH, manualFrozenSeeds, type C2Account,
} from "./data";
import type { CCtx } from "./types";

type Imp = (typeof IMPERSONATIONS)[number];

export function C2Actions({ ctx }: { ctx: CCtx }) {
  const { pget, setParam, logAudit, toast, openActionConfirm, openConfirm, startMirror } = ctx;
  const setFrozen = useUserOps((s) => s.setFrozen);
  const opsUsers = useUserOps((s) => s.users);
  const hydrated = useOpsHydrated();
  const [acct, setAcct] = useState<C2Account | null>(null);
  const [trace, setTrace] = useState<Imp | null>(null);

  // 行冻结实时态:store 有记录按 store(360 页同步),无记录回种子。
  const isFrozen = (a: C2Account) => (hydrated && opsUsers[a.id] ? !!opsUsers[a.id].frozen : a.st === "frozen");
  // 显示状态:冻结即 frozen;解冻后 frozen 种子回落 normal(badge/按钮/行底色三者一致),flagged 种子保留。
  const dispSt = (a: C2Account): C2Account["st"] => (isFrozen(a) ? "frozen" : a.st === "frozen" ? "normal" : a.st);
  // 会话键空间统一(audit P0 修):session 级 = C.session.<ssid>.forcedOut(C5 写),
  // 用户级整链 = C.session.user.<uid>.allOut(C2 强制登出 / 冻结联动 / C5 全部踢线,三写路径同键)。
  // usr_2231 有 session 明细 → 计数再减去 C5 已逐条踢线数;其他账户只有 user 级。
  const userAllOut = (id: string) => pget(`C.session.user.${id}.allOut`) === "true";
  const ssLive = (a: C2Account) => {
    if (userAllOut(a.id) || isFrozen(a)) return 0;
    if (a.id === "usr_2231") return SESSIONS_2231.filter((s) => pget(`C.session.${s.id}.forcedOut`) !== "true").length;
    return a.ss;
  };
  const impEnded = (i: Imp) => pget(`C.impersonate.${i.id}.ended`) === "true";

  // ① 冻结台账 98 = K1 批量 86 + 人工存量 11 + 实时人工冻结(C2 台账 ∪ USERS 全量按 id 去重,
  //    与 C1 同一派生;k1Batch 行已计入 86,防双计;360 页冻结检索页用户同样计入)。
  const manualLive = manualFrozenSeeds.filter(({ id, seed }) =>
    hydrated && opsUsers[id] ? !!opsUsers[id].frozen : seed,
  ).length;
  // ② 进行中的模拟登录(终止真写后实时归零)。
  const liveImps = IMPERSONATIONS.filter((i) => i.live && !impEnded(i));
  const liveLeftMin = liveImps[0] && "leftMin" in liveImps[0] ? liveImps[0].leftMin : 0;
  // ③④ 名单 = 样本窗以外存量(LIST_BASE)+ 可见行(种子未移出 + 动态新增未移出)→ 种子可见时 42 / 17。
  const removed = (id: string) => pget(`C.list.rm.${id}`) === "removed";
  const dynList = Object.entries(ctx.params)
    .filter(([k, v]) => k.startsWith("C.list.add.") && (v === "allow" || v === "block"))
    .map(([k, v]) => ({ id: k.slice("C.list.add.".length), kind: v as "allow" | "block", why: "确认备注见 A2", until: "长期", approver: "操作确认 ✓" }));
  const listRows = [...C2_LISTS, ...dynList].filter((l) => !removed(l.id));
  const allowCnt = LIST_BASE.allow + listRows.filter((l) => l.kind === "allow").length;
  const blockCnt = LIST_BASE.block + listRows.filter((l) => l.kind === "block").length;

  const freeze = (a: C2Account) => openActionConfirm({
    action: `冻结账户 · ${a.id}`,
    detail: "原因从枚举选(风控命中 / 反洗钱审查 / 用户申诉 / 司法协查 / 其他),写在操作理由里。确认通过后服务器原子执行:账户冻结 + 在途提现转冻结(D2)+ 全部会话踢线(C5)。带防重号。",
    amplifies: false,
    run: (reason) => {
      setFrozen(a.id, true);
      // 原子三联动逐写路径真落地:① 账户冻结 ② 在途提现转冻结(D2 同键)③ 全部会话踢线(C5 同键 user 级)。
      if (a.wdInflight) setParam(`D.withdraw.${a.wdInflight}.st`, "frozen", { action: `冻结联动:在途提现 ${a.wdInflight} 转冻结`, reason });
      setParam(`C.session.user.${a.id}.allOut`, "true", { action: `冻结联动:${a.id} 全部会话踢线`, reason });
      logAudit({ actor: "总管理员", action: `冻结账户 ${a.id} · admin.user_frozen`, target: a.id, reason });
      toast(`${a.id} 已冻结 · 联动 D2/C5 · 喂 B5`);
    },
  });

  const unfreeze = (a: C2Account) => openActionConfirm({
    action: `解冻账户 · ${a.id}`,
    detail: "解冻 = 恢复登录和资金流出,操作确认确认不是被滥用。解冻后 D2 在途提现回到待确认,不直接放行。",
    amplifies: true,
    run: (reason) => {
      setFrozen(a.id, false);
      if (a.wdInflight) setParam(`D.withdraw.${a.wdInflight}.st`, "review-pending", { action: `解冻联动:在途提现 ${a.wdInflight} 回待确认`, reason });
      // 注:解冻不撤会话踢线(allOut 保留)——被踢的会话不复活,用户重新登录即可。
      logAudit({ actor: "总管理员", action: `解冻账户 ${a.id} · admin.user_unfrozen`, target: a.id, reason });
      toast(`${a.id} 已解冻 · 理由留痕 · 在途提现回待处理`);
    },
  });

  const logoutAll = (a: C2Account) => openConfirm({
    action: `强制登出 · ${a.id}`,
    detail: `踢掉该用户全部 ${ssLive(a)} 个会话(吊销长短凭证,实际执行走 C5 会话体系)。收紧安全的即时动作,单人可办,必须写原因。`,
    chips: [["收紧动作 · 即时", "ready"], ["必须写原因 · 落审计", "done"]],
    reason: true, okLabel: "确认登出",
    run: (reason) => { setParam(`C.session.user.${a.id}.allOut`, "true", { action: `强制登出 ${a.id} 全部会话 · admin.session_revoked`, reason }); toast(`${a.id} 全部会话已踢线 · 原因留痕`); },
  });

  const startImp = () => openActionConfirm({
    action: "发起模拟登录",
    detail: "输入目标 userId(目标新值栏,如 usr_84F2 / usr_31E8),授权后获得只读的模拟会话:看得到用户界面,但代用户提现/改密/下单全被服务器拒绝;最长 30 分钟自动断。授权操作确认 + 全程留痕——即便只读,进入用户视角也涉隐私。",
    amplifies: false,
    edit: { kind: "text", current: "—", unit: "userId" },
    run: (_reason, v) => {
      const uid = (v || "").trim();
      if (!uid) return;
      logAudit({ actor: "总管理员", action: "impersonate 授权(只读 ≤30min)· admin.user_impersonation_started", target: uid });
      toast(`模拟登录 ${uid} 已授权 · 只读 30min · 全程留痕`);
      startMirror(uid);
    },
  });

  const endImp = (i: Imp) => openConfirm({
    action: `终止模拟会话 · ${i.op} → ${i.target}`,
    detail: "立即断开该模拟会话,结束时间和浏览轨迹入审计。",
    chips: [["即时断开", "ready"], ["轨迹留痕", "done"]],
    okLabel: "确认终止",
    run: (reason) => {
      setParam(`C.impersonate.${i.id}.ended`, "true", { action: `终止 impersonate 会话 ${i.id}`, reason: reason || "即时终止" });
      toast("模拟会话已终止 · 起止与轨迹入审计 · admin.user_impersonation_ended");
    },
  });

  const addList = (kind: "allow" | "block") => openActionConfirm({
    action: kind === "allow" ? "加入信任名单" : "加入禁入名单",
    detail: `${kind === "allow" ? "信任名单降低该账户的风控摩擦(提现路由、复审频率)," : "禁入名单拒绝该账户注册/登录,"}影响风控判定,操作确认。失效时间写在原因里(默认长期)。`,
    amplifies: false,
    edit: { kind: "text", current: "—", unit: "userId" },
    run: (reason, v) => {
      const uid = (v || "").trim();
      if (!uid) return;
      // 防重复行:该 uid 已在可见名单(种子未移出 / 动态未移出)→ 拒绝重复加入(audit P1 修)。
      if (listRows.some((l) => l.id === uid)) { toast(`${uid} 已在名单中 · 如需改类别请先移出`); return; }
      // 曾移出又重新加入(种子行或旧动态行):只翻 rm 标记复活原行,不再写 add 键 ——
      // 否则种子行复活 + 动态行并存 = 同 id 双行、计数虚增(audit R2 修)。复活沿用原类别。
      if (pget(`C.list.rm.${uid}`) === "removed") {
        setParam(`C.list.rm.${uid}`, "readded", { action: `重新加入名单 ${uid}(复活原行 · 沿用原类别)`, reason });
        toast(`${uid} 已重新加入名单(沿用原类别)· 理由留痕`);
        return;
      }
      setParam(`C.list.add.${uid}`, kind, { action: `加入${kind === "allow" ? "信任" : "禁入"}名单 ${uid}`, reason });
      toast("名单变更已生效 · 理由留痕");
    },
  });

  const rmList = (id: string) => openActionConfirm({
    action: `移出名单 · ${id}`,
    detail: "移出后恢复默认风控判定。操作确认。",
    amplifies: false,
    run: (reason) => { setParam(`C.list.rm.${id}`, "removed", { action: `移出名单 ${id}`, reason }); toast("已移出名单 · 理由留痕"); },
  });

  const traceLive = trace ? trace.live && !impEnded(trace) : false;

  return (
    <>
      <div className="f-stats">
        <div className="f-stat danger"><div className="k">冻结中账户</div><div className="v">{frozenTotal(manualLive)}</div><div className="sub">含 K1 批量冻结 {K1_FROZEN_ACCOUNTS} 个</div></div>
        <div className="f-stat warn"><div className="k">进行中的模拟登录</div><div className="v">{liveImps.length}</div><div className="sub">{liveImps.length > 0 ? `只读 · 剩 ${liveLeftMin} 分钟` : "当前无进行中会话"}</div></div>
        <div className="f-stat"><div className="k">信任名单</div><div className="v">{allowCnt}</div><div className="sub">降风控摩擦 · 操作确认入名单</div></div>
        <div className="f-stat"><div className="k">禁入名单</div><div className="v">{blockCnt}</div><div className="sub">拒绝注册/登录</div></div>
      </div>

      <div className="two-col">
        {/* 账户处置 */}
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">账户处置</span>
            <span className="sub">· 冻结/解冻操作确认 · 强制登出即时但要写原因</span>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="l-tbl" style={{ minWidth: 640 }}>
              <thead><tr><th>账户</th><th>状态</th><th>原因 / 来源</th><th>会话</th><th style={{ textAlign: "right" }}>动作</th></tr></thead>
              <tbody>
                {C2_ACCOUNTS.map((a) => {
                  const frozen = isFrozen(a);
                  const [stLabel, stTone] = C2_ACCT_STATE[dispSt(a)];
                  return (
                    <tr className={`click${frozen ? " frozen-row" : ""}`} key={a.id} onClick={() => setAcct(a)}>
                      <td className="mono" style={{ fontWeight: 600, color: "var(--ink)" }}>{a.id} <span style={{ fontSize: 10.5, color: "var(--c-ac)" }}>详情›</span></td>
                      <td><span className={`bdg ${stTone}`}>{stLabel}</span></td>
                      <td style={{ fontSize: 12, color: "var(--ink-3)" }}>{a.why}</td>
                      <td className="mono">{ssLive(a)} 个</td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        {frozen
                          ? <button className="l-btn sm mc" onClick={(e) => { e.stopPropagation(); unfreeze(a); }}>解冻</button>
                          : <button className="l-btn sm mc" onClick={(e) => { e.stopPropagation(); freeze(a); }}>冻结</button>}
                        <button className="l-btn sm" style={{ marginLeft: 6 }} onClick={(e) => { e.stopPropagation(); logoutAll(a); }}>强制登出</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="l-b" style={{ paddingTop: 10 }}>
            <div className="ctint" style={{ fontSize: 12 }}><b>冻结的连带动作</b> · 确认通过后服务器一次性原子执行:账户冻结 + 在途提现转冻结(D2)+ 全部会话踢下线(C5)。冻结原因从枚举里选(风控命中 / 反洗钱审查 / 用户申诉 / 司法协查 / 其他),状态同步给风险雷达(B5)。</div>
          </div>
        </section>

        {/* 模拟登录控制台 */}
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">模拟登录控制台</span>
            <span className="sub">· 排障复现用户看到的界面</span>
            <div className="r"><button className="l-btn mc" onClick={startImp}>发起模拟登录(操作确认)</button></div>
          </div>
          <div className="l-b">
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>进行中 / 近期会话</div>
            {IMPERSONATIONS.map((i) => {
              const ended = impEnded(i);
              if (i.live) {
                return (
                  <div className="imp-row" key={i.id}>
                    <span className="mono" style={ended ? { color: "var(--ink-3)" } : { fontWeight: 600, color: "var(--ink)" }}>{i.op} → {i.target}</span>
                    {ended ? <span className="bdg dim">已终止</span> : <span className="bdg warn">进行中 · 只读</span>}
                    {!ended && (
                      <span className="ttlbar">
                        <span className="track"><i style={{ width: `${"pct" in i ? i.pct : 0}%` }} /></span>
                        <span className="mono" style={{ fontSize: 11.5, color: "var(--warning)" }}>剩 {"leftMin" in i ? i.leftMin : 0}min</span>
                      </span>
                    )}
                    <button className="l-btn sm" onClick={() => setTrace(i)}>看轨迹</button>
                    {!ended && <button className="l-btn sm" onClick={() => endImp(i)}>立即终止</button>}
                  </div>
                );
              }
              return (
                <div className="imp-row" key={i.id}>
                  <span className="mono" style={{ color: "var(--ink-3)" }}>{i.op} → {i.target}</span>
                  <span className="bdg dim">已结束 · {"dur" in i ? i.dur : ""}</span>
                  <span style={{ fontSize: 12, color: "var(--ink-4)", marginLeft: "auto" }}>{"when" in i ? i.when : ""} · 工单 {i.ticket}</span>
                  <button className="l-btn sm" onClick={() => setTrace(i)}>看轨迹</button>
                </div>
              );
            })}
            <div className="ctint warn" style={{ marginTop: 12, fontSize: 12 }}><b>只读怎么保证</b> · 模拟会话的凭证里带着只读标记,所有写接口一律拒绝它(返回 403)——不是靠界面隐藏按钮,是服务器层面写不进去。到 30 分钟自动断线,起止时间、看过哪些页全部进审计。</div>
          </div>
        </section>
      </div>

      {/* 信任 / 禁入名单 */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">信任 / 禁入名单</span>
          <span className="sub">· 账户级名单(按 userId)· 和 K1 的 IP 白名单是两回事,各管一层</span>
          <div className="r">
            <button className="l-btn mc" onClick={() => addList("allow")}>+ 加入信任名单</button>
            <button className="l-btn mc" onClick={() => addList("block")}>+ 加入禁入名单</button>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 760 }}>
            <thead><tr><th>账户</th><th>名单</th><th>原因</th><th>失效时间</th><th>确认</th><th style={{ textAlign: "right" }}>动作</th></tr></thead>
            <tbody>
              {listRows.map((l, idx) => (
                <tr key={`${l.id}-${idx}`}>
                  <td className="mono" style={{ fontWeight: 600, color: "var(--ink)" }}>{l.id}</td>
                  <td>{l.kind === "allow" ? <span className="bdg ok">信任</span> : <span className="bdg bad">禁入</span>}</td>
                  <td style={{ fontSize: 12, color: "var(--ink-3)" }}>{l.why}</td>
                  <td className="mono" style={{ fontSize: 11.5 }}>{l.until}</td>
                  <td className="mono" style={{ fontSize: 11.5, color: "var(--ink-4)" }}>{l.approver}</td>
                  <td style={{ textAlign: "right" }}><button className="l-btn sm mc" onClick={() => rmList(l.id)}>移出名单</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="l-b" style={{ paddingTop: 10 }}>
          <div className="ctint" style={{ fontSize: 12 }}><b>分工</b> · 这页管「账户级」名单(信任某个人 / 禁入某个人);「IP 网段」豁免(合租办公网、校园网)在反多账户引擎(K1)的白名单里管——两边不重叠,别配重了。</div>
        </div>
      </section>

      <p className="f-foot"><b>四类动作的确认口径</b>:冻结、解冻、加白、拉黑、模拟登录授权——操作确认(理由必填,带防重号);强制登出是收紧安全的即时动作,单人可办但必须写原因(实际踢线走 C5 的会话体系,两页共用同一条审计事件)。账户状态、名单、模拟会话全部以服务器为准,页面不做任何本地状态。冻结/解冻事件喂审计(A2)、风险雷达(B5)和提现队列(D2)。</p>
      <PaginationExemptionList
        items={[
          {
            label: "账户处置",
            maxRows: 4,
            reason: "账户处置台账只展示高风险样本,完整账户检索在 C1",
          },
          {
            label: "信任 / 禁入名单",
            maxRows: 3,
            reason: "名单表为当前样本窗,新增移出操作会即时改同行",
          },
        ]}
      />

      {/* 账户明细 Drawer */}
      {acct && (() => {
        const [stLabel] = C2_ACCT_STATE[dispSt(acct)];
        const ss = ssLive(acct);
        return (
          <Drawer
            title={`账户明细 · ${acct.id}`}
            onClose={() => setAcct(null)}
            footer={acct.cluster ? <Link className="l-btn" style={{ flex: 1, justifyContent: "center" }} href={K1_PATH}>去 K1 看簇 →</Link> : undefined}
          >
            <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink)" }}>{acct.id} · {stLabel}</div>
            <div style={{ fontSize: 12, color: "var(--ink-3)", lineHeight: 1.55, margin: "4px 0 12px" }}>状态来源:{acct.why}。冻结台账以本页为准;其余维度(资产/实名/风险分)请到对应权威页。</div>

            <div style={{ fontSize: 13, fontWeight: 600, margin: "14px 0 4px" }}>账户概览</div>
            <div className="kv"><span className="k">当前状态</span><span className="v">{stLabel}</span></div>
            <div className="kv"><span className="k">关联簇(K1)</span><span className="v">{acct.cluster?.note ?? "无"}</span></div>
            <div className="kv"><span className="k">名单(本页)</span><span className="v">无</span></div>
            <div className="kv"><span className="k">活跃会话</span><span className="v">{ss} 个</span></div>

            <div style={{ fontSize: 13, fontWeight: 600, margin: "14px 0 6px" }}>冻结史</div>
            <table className="l-tbl">
              <thead><tr><th>时间</th><th>事由</th><th>确认</th></tr></thead>
              <tbody>
                {acct.freezeHist.map(([t, what, who], i) => (
                  <tr key={i}><td className="mono">{t}</td><td style={{ fontSize: 12 }}>{what}</td><td className="mono" style={{ fontSize: 11.5, color: "var(--ink-4)" }}>{who}</td></tr>
                ))}
              </tbody>
            </table>

            <div style={{ fontSize: 13, fontWeight: 600, margin: "14px 0 6px" }}>活跃会话({ss} 个 · 处置去 C5)</div>
            {acct.id === "usr_2231" && ss > 0 ? (
              <table className="l-tbl">
                <thead><tr><th>会话</th><th>IP</th><th>设备</th><th>最近</th></tr></thead>
                <tbody>
                  {SESSIONS_2231.filter((s) => pget(`C.session.${s.id}.forcedOut`) !== "true").map((s) => (
                    <tr key={s.id}><td className="mono" style={{ fontSize: 11.5 }}>{s.id}</td><td className="mono" style={{ fontSize: 11.5 }}>{s.ip}</td><td style={{ fontSize: 12 }}>{s.dev}</td><td className="mono" style={{ fontSize: 11.5, color: "var(--ink-4)" }}>{s.last}</td></tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div style={{ fontSize: 12, color: "var(--ink-4)", lineHeight: 1.55 }}>{ss > 0 ? "会话明细与逐条踢线在安全会话(C5)处置。" : "已无活跃会话。"}</div>
            )}

            <div style={{ fontSize: 13, fontWeight: 600, margin: "14px 0 4px" }}>近期动作</div>
            {acct.actions.map(([t, what, who], i) => (
              <div className="kv" key={i}><span className="k" style={{ color: "var(--ink-2)" }}>{what}</span><span className="v" style={{ fontWeight: 500, color: "var(--ink-4)" }}>{t} · {who}</span></div>
            ))}

            <div className="ctint" style={{ marginTop: 14 }}><b>处置入口在本页表格右侧</b>:冻结 / 解冻 / 强制登出。关联簇要批量处置去反多账户引擎(K1);会话级踢线去安全会话(C5)。</div>
          </Drawer>
        );
      })()}

      {/* 模拟会话轨迹 Drawer */}
      {trace && (
        <Drawer title={`模拟会话轨迹 · ${trace.op} → ${trace.target}`} onClose={() => setTrace(null)}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink)" }}>
            {traceLive ? `进行中 · 只读 · 剩 ${"leftMin" in trace ? trace.leftMin : 0}min` : trace.live ? "已终止 · 起止与轨迹入审计" : `已结束 · 全程 ${"dur" in trace ? trace.dur : ""}`}
          </div>
          <div style={{ fontSize: 12, color: "var(--ink-3)", lineHeight: 1.55, margin: "4px 0 12px" }}>排障工单 {trace.ticket} · 只读模拟会话,所有写接口被服务器拒绝(403)。以下为该会话逐页浏览轨迹,全部入审计。</div>

          <div style={{ fontSize: 13, fontWeight: 600, margin: "14px 0 4px" }}>浏览轨迹</div>
          {trace.trail.map(([what, t, mark], i) => {
            const blocked = mark.includes("⊘");
            return (
              <div className="kv" key={i}>
                <span className="k" style={{ color: blocked ? "var(--danger)" : "var(--ink-2)" }}>{what}</span>
                <span className="v" style={{ fontWeight: 500, color: "var(--ink-4)" }}>{t} <span className="mono" style={{ color: blocked ? "var(--danger)" : "var(--success)" }}>{mark}</span></span>
              </div>
            );
          })}

          <div style={{ height: 10 }} />
          {trace.kv.map(([k, v]) => (
            <div className="kv" key={k}><span className="k">{k}</span><span className="v">{v}</span></div>
          ))}

          <div className="ctint" style={{ marginTop: 14 }}><b>轨迹不可篡改</b> · 每步都是服务端记的只读会话行为日志,连同起止时间一起进 A2 append-only 审计。</div>
        </Drawer>
      )}
    </>
  );
}

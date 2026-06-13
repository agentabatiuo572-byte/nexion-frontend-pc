"use client";

/**
 * C3 余额 & 资产调整 — design_handoff_c_domain port。
 * 客服补偿/系统纠错的手工调整面:USDT/NEX/积分 × 增减,每笔操作确认 + 原因凭证必填。
 *  - USDT/NEX 真写 useUserOps.earningAppend(与 /users/search/[id] 360 页同源)+ logAudit(admin.balance_adjusted);
 *  - 积分改字段 + 审计不落账本(C.points.<uid>;A5 参数寄存器可回源,历史以 A2 审计为准);
 *  - 待确认队列 / 挂起放行 = 同语义写路径:裁决回写 C.adjust.<id>.status **且通过时 earningAppend 真落账**
 *    (审计 P1 修:只写状态不动钱 = 假放行);NEX 超额按 G3 行情 NEX_MARKET.price 折算等值 $ 判定;
 *  - 覆盖率/红线 = LEDGER 单源(加钱方向 amplifies,确认放行实时再验,禁止写死);
 *  - 操作确认 显式 edit 契约:本页全部为处置/裁决,一律不传 edit。
 */
import { useState } from "react";
import Link from "next/link";
import { Drawer, PaginationExemptionList } from "../design-kit";
import { LEDGER } from "@/lib/mock/admin/ledger";
import { useUserOps } from "@/lib/store/admin/user-ops-store";
import { NEX_MARKET } from "../g-tabs/data";
import { ADJUST_QUEUE, SUSPENDED_ADJ, ADJUST_HIST, C3_STATS, type AdjustRow } from "./data";
import type { CCtx } from "./types";

type HistRow = (typeof ADJUST_HIST)[number];

const OBJS = ["USDT", "NEX", "积分"] as const;
const REASON_CODES = ["客服补偿", "系统纠错", "活动补发", "争议退回"] as const;
const HIST_FILTERS = ["全部", "USDT", "NEX", "积分"] as const;

const fmtDelta = (r: AdjustRow) => {
  const n = Math.abs(r.delta).toLocaleString("en-US");
  const sign = r.delta >= 0 ? "+" : "−";
  return r.obj === "USDT" ? `${sign}$${n}` : r.obj === "NEX" ? `${sign}${n} NEX` : `${sign}${n} 分`;
};

export function C3Adjust({ ctx }: { ctx: CCtx }) {
  const { pget, setParam, logAudit, toast, openActionConfirm, openConfirm } = ctx;
  // audit-ok:hydration — 只取写动作 earningAppend(action 引用),不读任何持久态,无 SSR 水合时序面。
  const earningAppend = useUserOps((s) => s.earningAppend);
  const cov = LEDGER.coverageRatio.toFixed(1);

  const [acct, setAcct] = useState("usr_2231");
  const [obj, setObj] = useState<(typeof OBJS)[number]>("USDT");
  const [dir, setDir] = useState<"增加" | "扣减">("增加");
  const [amtStr, setAmtStr] = useState("120");
  const [kind, setKind] = useState<(typeof REASON_CODES)[number]>("客服补偿");
  const [histFilter, setHistFilter] = useState<(typeof HIST_FILTERS)[number]>("全部");
  const [hist, setHist] = useState<HistRow | null>(null);

  const pending = ADJUST_QUEUE.filter((r) => !pget(`C.adjust.${r.id}.status`));
  const pendingEsc = pending.filter((r) => r.escalated).length;
  const suspSt = pget(`C.adjust.${SUSPENDED_ADJ.id}.status`);
  const histRows = histFilter === "全部" ? ADJUST_HIST : ADJUST_HIST.filter((h) => h.obj === histFilter);

  /* 发起调整(操作确认;USDT/NEX 真写资产台账 + 审计,积分改字段不落账本) */
  const submitAdj = () => {
    const u = acct.trim() || "usr_2231";
    // 输入守卫(audit P1 修):金额必须正数(方向由「方向」chip 表达,负数输入会让红冲语义反转);
    // 积分单笔硬上限;NEX 超额按 G3 行情折算等值 $(server 放行时以实时行情再判)。
    const amt = Math.abs(parseFloat(amtStr) || 0);
    if (amt <= 0) { toast("金额须为正数 · 未提交"); return; }
    if (obj === "积分" && amt > C3_STATS.capPoints) { toast(`积分单笔上限 ${C3_STATS.capPoints.toLocaleString("en-US")} 分 · 未提交`); return; }
    const usdEq = obj === "NEX" ? amt * NEX_MARKET.price : amt;
    const over = obj !== "积分" && usdEq > C3_STATS.capUsd;
    const credit = dir === "增加" && obj !== "积分";
    openActionConfirm({
      action: `资产调整 · ${u} · ${dir === "增加" ? "+" : "−"}${amt} ${obj}`,
      detail: (
        <>
          {over ? <b>单笔超 ${C3_STATS.capUsd}{obj === "NEX" ? `(按行情 $${NEX_MARKET.price} 折算等值 ≈ $${Math.round(usdEq).toLocaleString("en-US")})` : ""},自动升级:执行门槛 = 财务主管 / 超管。</b> : "基础路径:执行门槛 = 财务。"}
          {credit
            ? <><b>加钱方向</b>:确认放行那一刻服务器实时核验覆盖率(当前 {cov}% &gt; 红线 {LEDGER.redlinePct},可过);低于红线会被拒并转挂起(7 天有效)。</>
            : "扣减方向不受红线约束。"}
          {obj === "积分"
            ? `积分调整改 points 字段 + 留审计,不落账本;上限 ${C3_STATS.capPoints.toLocaleString("en-US")} 分/笔。`
            : "放行即与账本(D4)同一事务记一条「人工调整」账单。"}
          凭证号写在原因里(工单号/截图引用),带防重号。
        </>
      ),
      amplifies: credit,
      run: (reason) => {
        if (obj === "USDT" || obj === "NEX") {
          earningAppend(u, dir === "增加" ? "补发" : "红冲", dir === "增加" ? amt : -amt, `${kind} · C3 调整`, obj === "NEX" ? "NEX" : "USDT");
          logAudit({ actor: "总管理员", action: `资产调整 ${obj} ${dir === "增加" ? "+" : "−"}${amt} · admin.balance_adjusted + admin.bill_adjusted(账单号关联)`, target: u, reason });
        } else {
          setParam(`C.points.${u}`, `${dir === "增加" ? "+" : "-"}${amt}`, { action: `积分调整 ${u}(改字段+审计,不落账本)`, reason });
        }
        toast(`已确认放行 · ${over ? "升级确认层" : "基础路径"} · 凭证留痕`);
      },
    });
  };

  /* 待确认队列裁决(通过 = 加钱方向挂红线核验;驳回不动余额) */
  const verdictMc = (r: AdjustRow, ok: boolean) => openActionConfirm({
    action: `资产调整确认${ok ? "通过" : "驳回"} · ${r.id}`,
    detail: ok
      ? `${r.userId} · ${fmtDelta(r)}。${r.credit ? `加钱方向:确认放行这一刻服务器实时核验覆盖率(当前 ${cov}% > 红线 ${LEDGER.redlinePct},可过);低于红线会被拒并转挂起。` : "扣减方向不受红线约束。"}通过后与账本(D4)同一事务记「人工调整」账单。`
      : `${r.userId} · ${fmtDelta(r)}。驳回后该调整不生效:不动余额、不落账本(D4 无账单);裁决与原因留痕,发起人可见驳回原因。`,
    amplifies: ok ? r.credit : false,
    run: (reason) => {
      setParam(`C.adjust.${r.id}.status`, ok ? "approved" : "rejected", { action: `资产调整确认${ok ? "通过" : "驳回"} ${r.id}`, reason });
      // 通过 = 真放行:写余额台账(360 页同源)+ 双事件留痕(audit P1 修:只写状态 = 假放行)。
      // 按钮只在未裁决时渲染,status 写入后入口消失 → 单次放行,无双击重复入账面。
      if (ok) {
        if (r.obj === "积分") {
          // 积分不落账本:改字段 + 审计(与 submitAdj 同分路;防未来积分种子行误按 USDT 落账)。
          setParam(`C.points.${r.userId}`, `${r.delta >= 0 ? "+" : "-"}${Math.abs(r.delta)}`, { action: `积分调整放行 ${r.id}(改字段+审计,不落账本)`, reason });
        } else {
          earningAppend(r.userId, r.delta >= 0 ? "补发" : "红冲", r.delta, `${r.kind} · ${r.id} 确认放行`, r.obj === "NEX" ? "NEX" : "USDT");
          logAudit({ actor: "总管理员", action: `资产调整放行 ${r.id} ${fmtDelta(r)} · admin.balance_adjusted + admin.bill_adjusted(账单号关联)`, target: r.userId, reason });
        }
      }
      toast(ok ? `${r.id} 已通过 · ${r.userId} · 余额与账单同事务落账` : `${r.id} 已驳回 · ${r.userId} · 已写审计`);
    },
  });

  return (
    <>
      <div className="f-stats">
        <div className="f-stat"><div className="k">本月调整</div><div className="v">{C3_STATS.monthCnt} 笔</div><div className="sub">{C3_STATS.monthSum}</div></div>
        <div className="f-stat warn"><div className="k">待确认</div><div className="v">{pending.length}</div><div className="sub">{pendingEsc} 笔超额待财务主管</div></div>
        <div className="f-stat cyan"><div className="k">挂起(等覆盖率)</div><div className="v">{suspSt ? 0 : 1}</div><div className="sub">7 天有效 · 可撤销 · 重新执行确认</div></div>
        <div className="f-stat ok"><div className="k">覆盖率(B1)</div><div className="v">{cov}%</div><div className="sub">红线 {LEDGER.redlinePct} · 加钱放行时实时再验</div></div>
      </div>

      <div className="two-col r1-12">
        {/* 调整面 */}
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">发起调整</span>
            <span className="sub">· 原因和凭证必填 · 提交后进操作确认</span>
          </div>
          <div className="l-b">
            <div className="adj-form">
              <div className="row"><label>账户</label><input value={acct} onChange={(e) => setAcct(e.target.value)} style={{ width: 160 }} /></div>
              <div className="row"><label>对象</label>
                <div className="chips">
                  {OBJS.map((o) => (
                    <button key={o} className={`chip${obj === o ? " sel" : ""}`} onClick={() => setObj(o)}>{o}</button>
                  ))}
                </div>
              </div>
              <div className="row"><label>方向</label>
                <div className="chips">
                  <button className={`chip${dir === "增加" ? " sel" : ""}`} onClick={() => setDir("增加")}>增加(过红线核验)</button>
                  <button className={`chip${dir === "扣减" ? " sel" : ""}`} onClick={() => setDir("扣减")}>扣减</button>
                </div>
              </div>
              <div className="row"><label>金额</label><input value={amtStr} onChange={(e) => setAmtStr(e.target.value)} style={{ width: 120 }} /><span style={{ fontSize: 12, color: "var(--ink-4)" }}>单笔 ≤ ${C3_STATS.capUsd} 走基础确认;超了自动升级</span></div>
              <div className="row"><label>原因码</label>
                <div className="chips">
                  {REASON_CODES.map((k) => (
                    <button key={k} className={`chip${kind === k ? " sel" : ""}`} onClick={() => setKind(k)}>{k}</button>
                  ))}
                </div>
              </div>
              <div className="row" style={{ justifyContent: "flex-end" }}><button className="l-btn mc" onClick={submitAdj}>提交调整(操作确认)</button></div>
            </div>
            <div className="esc-note" style={{ marginTop: 12 }}>
              <div className="b"><b>≤ ${C3_STATS.capUsd}</b> · 基础路径<br />执行门槛:财务</div>
              <div className="b"><b>&gt; ${C3_STATS.capUsd}</b> · 自动升级<br />执行门槛:财务主管 / 超管</div>
              <div className="b"><b>积分上限</b> · {C3_STATS.capPoints.toLocaleString("en-US")} 分/笔<br />积分影响提现门槛,同样操作确认</div>
            </div>
          </div>
        </section>

        {/* 挂起 + 规则 */}
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">挂起中的加钱申请</span>
            <span className="sub">· 确认时覆盖率低于红线被拒,转挂起等恢复</span>
          </div>
          <div className="l-b">
            <div className="susp-row">
              <span className="mono" style={{ fontWeight: 600, color: "var(--ink)" }}>{SUSPENDED_ADJ.id}</span>
              <span className="mono" style={{ fontSize: 12 }}>{SUSPENDED_ADJ.userId} · +${SUSPENDED_ADJ.delta}</span>
              {!suspSt
                ? <span className="bdg warn">挂起 · 剩 {SUSPENDED_ADJ.leftDays} 天</span>
                : suspSt === "approved"
                  ? <span className="bdg ok">已放行</span>
                  : <span className="bdg dim">已撤销</span>}
              <span style={{ fontSize: 12, color: "var(--ink-4)", flex: 1 }}>{SUSPENDED_ADJ.rejectedAt} 确认时覆盖率 {SUSPENDED_ADJ.rejectedCov}% &lt; 红线被拒</span>
              {!suspSt && (
                <>
                  <button className="l-btn sm mc" onClick={() => openActionConfirm({
                    action: `重新触发放行 · ${SUSPENDED_ADJ.id}`,
                    detail: `覆盖率已恢复到 ${cov}%(> 红线 ${LEDGER.redlinePct})。重新执行放行,服务器在放行瞬间再实时验一次覆盖率,通过即原子写余额 + 记账。`,
                    amplifies: true,
                    run: (reason) => {
                      setParam(`C.adjust.${SUSPENDED_ADJ.id}.status`, "approved", { action: `重新触发放行 ${SUSPENDED_ADJ.id}`, reason });
                      // 放行 = 真落账(同 verdict 写路径;按钮随 status 写入消失,单次放行)。
                      earningAppend(SUSPENDED_ADJ.userId, "补发", SUSPENDED_ADJ.delta, `客服补偿 · ${SUSPENDED_ADJ.id} 挂起恢复放行`, "USDT");
                      logAudit({ actor: "总管理员", action: `挂起放行 ${SUSPENDED_ADJ.id} +$${SUSPENDED_ADJ.delta} · admin.balance_adjusted + admin.bill_adjusted(账单号关联)`, target: SUSPENDED_ADJ.userId, reason });
                      toast(`${SUSPENDED_ADJ.id} 已放行 · 余额与账单同事务落账`);
                    },
                  })}>重新执行确认</button>
                  <button className="l-btn sm" onClick={() => openConfirm({
                    action: `撤销挂起申请 · ${SUSPENDED_ADJ.id}`,
                    detail: "只有原发起人可以撤销,取消动作留痕即可,落审计。",
                    chips: [["仅原发起人", "ready"], ["落审计", "done"]],
                    reason: true,
                    okLabel: "确认撤销",
                    run: (reason) => {
                      setParam(`C.adjust.${SUSPENDED_ADJ.id}.status`, "cancelled", { action: `撤销挂起申请 ${SUSPENDED_ADJ.id}`, reason });
                      toast(`${SUSPENDED_ADJ.id} 已撤销 · 留痕`);
                    },
                  })}>操作员取消</button>
                </>
              )}
            </div>
            <div className="ctint" style={{ marginTop: 12 }}><b>挂起的三条规则</b> · ① 挂起最多 7 天,超期自动失效并通知发起人;② 操作员可取消(取消动作留痕即可);③ 覆盖率恢复后<b>不会自动放行</b>——要执行门槛重新点放行,放行那一刻服务器再实时验一次覆盖率。</div>
            <div className="ctint warn" style={{ marginTop: 10 }}><b>账本怎么记</b> · USDT/NEX 调整在账本(D4)记一条「人工调整」类账单(不混进「退款」——退款专指提现失败退回,混了会污染储备/负债口径);积分是独立体系,改 points 字段 + 留审计,不落账单。发起记录和账本记录各记一条、用账单号互相关联,报表按账单号去重不会重复算。</div>
          </div>
        </section>
      </div>

      {/* 待确认队列(stat「待确认」对应的处置面) */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">待确认队列</span>
          <span className="sub">· 客服/财务执行门槛:理由 通过/驳回 · 通过后 D4 记账</span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 880 }}>
            <thead><tr><th>调整单</th><th>账户</th><th>对象</th><th className="num">金额</th><th>发起人</th><th>事由</th><th>状态</th><th>动作</th></tr></thead>
            <tbody>
              {ADJUST_QUEUE.map((r) => {
                const verdict = pget(`C.adjust.${r.id}.status`);
                return (
                  <tr key={r.id}>
                    <td className="mono" style={{ fontWeight: 600, color: "var(--ink)" }}>{r.id}</td>
                    <td className="mono">{r.userId}</td>
                    <td><span className="bdg dim">{r.obj}</span></td>
                    <td className="num mono" style={{ fontWeight: 700, color: r.delta >= 0 ? "var(--success)" : "var(--danger)" }}>{fmtDelta(r)}</td>
                    <td className="mono" style={{ fontSize: 12 }}>{r.operator}</td>
                    <td style={{ fontSize: 12, color: "var(--ink-3)" }}>{r.kind} · {r.reason}</td>
                    <td>
                      {verdict === "approved"
                        ? <span className="bdg ok">已通过</span>
                        : verdict === "rejected"
                          ? <span className="bdg bad">已驳回</span>
                          : <><span className="bdg warn">待确认 · {r.ts}</span>{r.escalated && <span className="bdg cyan" style={{ marginLeft: 6 }}>超额 · 财务主管</span>}</>}
                    </td>
                    <td>
                      {!verdict ? (
                        <span style={{ display: "inline-flex", gap: 6 }}>
                          <button className="l-btn sm primary" onClick={() => verdictMc(r, true)}>通过</button>
                          <button className="l-btn sm" style={{ color: "var(--danger)" }} onClick={() => verdictMc(r, false)}>驳回</button>
                        </span>
                      ) : <span style={{ fontSize: 12, color: "var(--ink-4)" }}>已裁决</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="l-b" style={{ paddingTop: 14 }}>
          <div className="ctint cyan"><b>操作理由必填(A2)</b> · 裁决回写 <span className="ccode">{"C.adjust.<id>.status"}</span>,通过项由 D4 双账本记账</div>
        </div>
      </section>

      {/* 历史 */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">调整历史</span>
          <span className="sub">· 每笔可追溯到账本账单号(USDT/NEX)或审计记录(积分)</span>
          <div className="r">
            <div className="chips">
              {HIST_FILTERS.map((f) => (
                <button key={f} className={`chip${histFilter === f ? " sel" : ""}`} onClick={() => setHistFilter(f)}>{f}</button>
              ))}
            </div>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 960 }}>
            <thead><tr><th>调整单</th><th>账户</th><th>对象</th><th className="num">增减</th><th>原因</th><th>操作 / 留痕</th><th>落点</th><th>时间</th></tr></thead>
            <tbody>
              {histRows.map((h) => (
                <tr key={h.id} className="click" onClick={() => setHist(h)}>
                  <td className="mono" style={{ fontWeight: 600, color: "var(--ink)" }}>{h.id} <span style={{ fontSize: 10.5, color: "var(--c-ac)" }}>详情›</span></td>
                  <td className="mono">{h.userId}</td>
                  <td><span className="bdg dim">{h.obj}</span></td>
                  <td className="num mono" style={{ fontWeight: 700, color: h.credit ? "var(--success)" : "var(--danger)" }}>{h.deltaLabel}</td>
                  <td style={{ fontSize: 12, color: "var(--ink-3)" }}>{h.reason}</td>
                  <td className="mono" style={{ fontSize: 11.5, color: "var(--ink-4)" }}>{h.chain}{h.escalated ? "(超额)" : ""}</td>
                  <td className="mono" style={{ fontSize: 11.5, color: "var(--c-ac)" }}>{h.sink}</td>
                  <td className="mono" style={{ fontSize: 11.5, color: "var(--ink-4)" }}>{h.t}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <p className="f-foot"><b>这页是纠错和补偿的入口,不是绕门槛的后门</b>——不能用调整帮用户跳过提现门槛、实名或阶段限制;超额自动升级 + 全程留痕就是防内部滥用的。调整放行后:USDT/NEX 进账本(D4)→ 进资金池负债聚合(D3)→ 影响覆盖率(B1);积分变了,提现队列(D2)下次校验时由服务器读最新积分判「够不够」。发起层和记账层两条审计事件用账单号关联,财务报表(L3)按号去重。所有写入带防重号,网络重试不会重复入账。</p>
      <PaginationExemptionList
        items={[
          {
            label: "待确认队列",
            maxRows: 3,
            reason: "待确认队列为当前人工调整样本,裁决后入口即时消失",
          },
          {
            label: "调整历史",
            maxRows: 4,
            reason: "历史表展示最近调整样本,完整审计与账单追溯在 A2/D4",
          },
        ]}
      />

      {hist && (() => {
        const operator = hist.chain.split(" → ")[0];
        const roleGate = (hist.chain.split(" → ")[1] ?? "").replace(/ ✓.*$/, "");
        const steps: [string, string][] = [
          [`发起 · ${operator}`, hist.t],
          [`确认 · ${roleGate}`, hist.t],
          [hist.credit ? "覆盖率红线核验通过" : "无需红线核验", hist.t],
          ["原子写余额 + 记账", hist.t],
        ];
        return (
          <Drawer
            title={`调整单明细 · ${hist.id}`}
            sub={`${hist.userId} · ${hist.obj} ${hist.deltaLabel}`}
            onClose={() => setHist(null)}
            footer={hist.sinkBill ? <Link className="l-btn" style={{ flex: 1, justifyContent: "center" }} href="/finance/ledger">去 D4 查账单 →</Link> : undefined}
          >
            <div className="ctint" style={{ marginBottom: 14 }}>原因:{hist.reason}。{hist.credit ? "加钱方向 · 确认放行时已过覆盖率红线核验。" : "扣减方向 · 不过红线。"}</div>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>调整内容</div>
            <div className="kv"><span className="k">对象</span><span className="v">{hist.obj}</span></div>
            <div className="kv"><span className="k">增减</span><span className="v">{hist.deltaLabel}</span></div>
            <div className="kv"><span className="k">原因码</span><span className="v">{hist.reason}</span></div>
            <div className="kv"><span className="k">确认路径</span><span className="v">{hist.escalated ? `超 $${C3_STATS.capUsd} 升级 · 财务主管/超管` : "基础 · 财务"}</span></div>
            <div style={{ fontSize: 13, fontWeight: 600, margin: "14px 0 4px" }}>操作操作链</div>
            {steps.map(([label, t]) => (
              <div className="kv" key={label}><span className="k">{label}</span><span className="v">{t} <span style={{ color: "var(--success)" }}>✓</span></span></div>
            ))}
            <div style={{ fontSize: 13, fontWeight: 600, margin: "14px 0 4px" }}>账本关联</div>
            <div className="kv"><span className="k">落点</span><span className="v" style={{ color: "var(--c-ac)" }}>{hist.sink}</span></div>
            <div className="kv"><span className="k">账单类型</span><span className="v">{hist.obj === "积分" ? "不落账 · 改字段+审计" : "人工调整(adjustment)"}</span></div>
            <div className="kv"><span className="k">幂等号</span><span className="v mono">IDEM-{hist.id}</span></div>
            <div className="kv"><span className="k">事件</span><span className="v">admin.balance_adjusted + {hist.obj === "积分" ? "(无账单)" : "admin.bill_adjusted"}</span></div>
            <div className="ctint cyan" style={{ marginTop: 14 }}><b>双事件按账单号关联</b>：发起层(C3)与记账层(D4)各记一条，财务报表按号去重；整条链不可篡改。</div>
          </Drawer>
        );
      })()}
    </>
  );
}

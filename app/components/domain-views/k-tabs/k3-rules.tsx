"use client";

/**
 * K3 提现风控规则引擎 — 四维规则卡(金额/速度/新账户/地址信誉)+ 规则状态机(archived 终态 409)+
 * 路由分布 + 命中日志 + 沙盒模拟(只读占位)。
 * 优先级:K3 delay/freeze/manual > D2 小额快速通道;pass 不产事件(隐式放行约定,与 D2 对齐)。
 * 真写:规则态 K.rule.state.<id> / 新建 K.rule.new.<名> / 调参 K.rule.<ruleKey>(沿用既有键)。
 */
import { useMemo, useState } from "react";
import { PaginationExemptionList } from "../design-kit";
import { K3_DIMS, K3_RULES, K3_HITS, K3_ROUTE_COUNTS, K3_ROUTE_TOTAL, RULE_ACT, RULE_ST, type K3Rule, type RuleState } from "./data";
import type { KCtx } from "./types";

const fmt = (n: number) => n.toLocaleString("en-US");
const pct1 = (n: number) => (Math.round((n / K3_ROUTE_TOTAL) * 1000) / 10).toFixed(1);

// cond **粗体** 标记渲染:关键阈值橙色强调(对应 .kdom .dim .cond b);pget 覆盖值为纯文本时原样展示。
const renderCond = (s: string) =>
  s.split("**").map((seg, i) => (i % 2 === 1 ? <b key={i}>{seg}</b> : <span key={i}>{seg}</span>));

const DIM_ICONS: Record<string, React.ReactNode> = {
  card: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="6" width="18" height="13" rx="2.5" /><path d="M3 10h18" /></svg>,
  wave: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12h3l2-6 4 14 2-8h5" /></svg>,
  user: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="8" r="3" /><path d="M3 19a6 6 0 0112 0" /><path d="M17 5v6M20 8h-6" /></svg>,
  shield: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" /><path d="M9 12l2 2 4-4" /></svg>,
};

export function K3HeaderActions({ ctx }: { ctx: KCtx }) {
  const dryRun = () =>
    ctx.openConfirm({
      action: "沙盒模拟(对历史样本试跑)",
      detail: "拿最近 30 天的历史提现样本,把当前(含草拟)规则跑一遍,看放行 / 延迟 / 冻结 / 转人工的分布会变成什么样 —— 只读模拟,不写生产、不影响任何在途提现;接口预留,本批不实现。",
      chips: [["只读 · 不写生产", "done"], ["模拟批次落审计", "ready"]],
      okLabel: "开始模拟",
      run: () => ctx.toast("模拟已开始 · 跑完出对比报告(原型占位)"),
    });
  return (
    <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
      <span className="f-ro"><span className="d" />规则在服务器评估 · 提现请求跳不过去</span>
      <button className="f-cta" onClick={dryRun} title="规则沙盒 dry-run · PRD K3④ 接口预留">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M10 9l5 3-5 3z" /></svg>
        沙盒模拟(不写生产)
      </button>
    </span>
  );
}

type RuleRow = K3Rule & { stateKey?: string };

export function K3Rules({ ctx }: { ctx: KCtx }) {
  const [filter, setFilter] = useState<"all" | "delay" | "freeze" | "manual">("all");

  const ruleState = (r: RuleRow): RuleState => (ctx.pget(`K.rule.state.${r.stateKey ?? r.id}`) as RuleState | undefined) ?? r.state;

  // 新建规则派生:key 后缀 = 输入的条件表达式(同时作为 cond 展示与状态键),id 按序派生 WR-C{n}。
  const customRules: RuleRow[] = useMemo(
    () =>
      Object.entries(ctx.params)
        .filter(([k]) => k.startsWith("K.rule.new."))
        .map(([k, v], i) => {
          const cond = k.slice("K.rule.new.".length);
          return { id: `WR-C${i + 1}`, dim: "自定义", cond: String(v) || cond, act: "delay" as const, state: ((ctx.params[`K.rule.state.${cond}`] as RuleState | undefined) ?? "draft"), stateKey: cond };
        }),
    [ctx.params],
  );
  const allRules: RuleRow[] = [...K3_RULES, ...customRules];

  const toggleRule = (r: RuleRow, to: "active" | "paused") =>
    ctx.openActionConfirm({
      action: `${to === "active" ? "启用规则" : "停用规则"} · ${r.id}`,
      detail: `${r.id}(${r.dim} · ${r.cond} → ${RULE_ACT[r.act][0]})${to === "active" ? "重新生效" : "停用"}。启停直接改变资金出口的摩擦,所以操作确认;通过后下一笔提现校验生效 · 写入 admin.withdraw_rule_toggled`,
      amplifies: to === "paused", // 停用规则 = 减摩擦放大流出 → B1 预检;启用 = 收紧不挂
      run: (reason) => {
        ctx.setParam(`K.rule.state.${r.stateKey ?? r.id}`, to, { action: `${to === "active" ? "启用" : "停用"}提现风控规则 ${r.id}`, reason });
        ctx.toast(`${r.id} 已${to === "active" ? "启用" : "停用"} · 理由留痕`);
      },
    });

  const archiveRule = (r: RuleRow) =>
    ctx.openConfirm({
      action: `归档规则 · ${r.id}`,
      detail: "归档是软删除终态:归档后不能再启用(服务器会拒绝,返回 409 冲突)。以后要复用这条规则的逻辑,得新建草稿并复制条件。",
      chips: [["终态 · 不可再启用", "done"], ["复用须新建草稿", "ready"]],
      reason: true,
      okLabel: "确认归档",
      run: (reason) => {
        ctx.setParam(`K.rule.state.${r.stateKey ?? r.id}`, "archived", { action: `归档提现风控规则 ${r.id}`, reason });
        ctx.toast(`${r.id} 已归档`);
      },
    });

  const newRule = () =>
    ctx.openActionConfirm({
      action: "新建提现风控规则",
      detail: "把条件表达式作目标新值输入(如「24h > 6 笔 → 延迟」;维度:金额 / 速度 / 新账户 / 地址信誉;命中动作:延迟 / 冻结 / 转人工)。新规则编号自动派发(WR-C 序列)并先进「草拟」,经操作确认后生效;规则批改属于参数批改,一律操作确认 · 写入 admin.withdraw_rule_created",
      edit: { kind: "text" },
      run: (reason, newVal) => {
        if (!newVal) return;
        ctx.setParam(`K.rule.new.${newVal}`, newVal, { action: `新建提现风控规则(条件:${newVal})`, reason });
        ctx.toast(`新规则「${newVal}」已进草拟 · 待操作确认生效`);
      },
    });

  const adjRule = (d: (typeof K3_DIMS)[number]) => {
    const cur = ctx.pget(`K.rule.${d.ruleKey}`) ?? d.condDefault;
    ctx.openActionConfirm({
      action: `规则阈值调整 · ${d.name}`,
      detail: `${d.name} · 当前「${cur}」· ${d.note}。改后下一笔提现校验生效,不影响在途单;放宽方向放大资金流出,须先核验 B1 覆盖率 · 写入 admin.withdraw_rule_adjusted`,
      amplifies: true,
      edit: { kind: "text", current: cur },
      run: (reason, newVal) => {
        if (!newVal) return;
        ctx.setParam(`K.rule.${d.ruleKey}`, newVal, { action: `调整提现风控规则 ${d.name}`, reason });
        ctx.toast(`提现风控规则「${d.name}」已更新阈值`);
      },
    });
  };

  const hits = K3_HITS.filter((h) => filter === "all" || h[5] === filter);

  return (
    <div>
      <div className="f-stats">
        <div className="f-stat ok"><div className="k">自动放行率(7 天)</div><div className="v">{pct1(K3_ROUTE_COUNTS[0].n)}%</div><div className="sub">{fmt(K3_ROUTE_COUNTS[0].n)} / {fmt(K3_ROUTE_TOTAL)} 笔直接过</div></div>
        <div className="f-stat warn"><div className="k">延迟处理</div><div className="v">{pct1(K3_ROUTE_COUNTS[1].n)}%</div><div className="sub">多为提速超限 + 新账户</div></div>
        <div className="f-stat cyan"><div className="k">转人工</div><div className="v">{pct1(K3_ROUTE_COUNTS[2].n)}%</div><div className="sub">大额为主 · 进 D2 队列分诊</div></div>
        <div className="f-stat danger"><div className="k">冻结</div><div className="v">{pct1(K3_ROUTE_COUNTS[3].n)}%</div><div className="sub">低信誉地址 · {K3_ROUTE_COUNTS[3].n} 笔</div></div>
      </div>

      {/* 四维规则卡 */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">四道关 · 规则配置</span>
          <span className="sub">· 改阈值 / 改命中动作都走操作确认 · 改后下一笔提现校验生效</span>
          <div className="r"><span className="kcode electric">命中动作:延迟 delay / 冻结 freeze / 转人工 manual</span></div>
        </div>
        <div className="l-b">
          <div className="dim-grid">
            {K3_DIMS.map((d) => {
              const cur = ctx.pget(`K.rule.${d.ruleKey}`);
              return (
                <div className="dim" key={d.ruleKey}>
                  <div className="top"><span className="ic">{DIM_ICONS[d.icon]}</span><div className="nm">{d.name}</div></div>
                  <div className="cond">{cur ? <>{cur}<span style={{ color: "var(--ink-4)" }}> · 已调整</span></> : renderCond(d.cond)}</div>
                  <div className="why">{d.why}</div>
                  <div className="ft">
                    <span className={`act ${d.act}`}>{d.act}</span>
                    <button className="l-btn sm mc" onClick={() => adjRule(d)} title={`PRD K3③ ${d.ruleKey}`}>调整</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <div className="two-col r135">
        {/* 规则总表 + 状态机 */}
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">规则总表</span>
            <span className="sub">· 已归档的规则不能再启用,要复用得新建草稿复制条件</span>
            <div className="r"><button className="l-btn mc" onClick={newRule}>+ 新建规则(操作确认)</button></div>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="l-tbl" style={{ minWidth: 660 }}>
              <thead><tr><th>规则</th><th>维度</th><th>条件</th><th>命中动作</th><th>状态</th><th style={{ textAlign: "right" }}>动作</th></tr></thead>
              <tbody>
                {allRules.map((r) => {
                  const st = ruleState(r);
                  const [stLb, stTone] = RULE_ST[st];
                  const [actLb, actTone] = RULE_ACT[r.act];
                  return (
                    <tr key={r.id}>
                      <td className="mono" style={{ color: "var(--ink)", fontWeight: 600 }}>{r.id}</td>
                      <td>{r.dim}</td>
                      <td className="mono" style={{ fontSize: 12, color: "var(--ink-2)" }}>{r.cond}</td>
                      <td><span className={`bdg ${actTone}`}>{actLb}</span></td>
                      <td><span className={`bdg ${stTone}`}>{stLb}</span></td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        <span style={{ display: "inline-flex", gap: 6 }}>
                          {st === "active" && <button className="l-btn sm mc" onClick={() => toggleRule(r, "paused")}>停用</button>}
                          {st === "paused" && <><button className="l-btn sm mc" onClick={() => toggleRule(r, "active")}>启用</button><button className="l-btn sm" onClick={() => archiveRule(r)}>归档</button></>}
                          {st === "archived" && <button className="l-btn sm" onClick={() => ctx.toast("服务器拒绝(409):已归档规则不能再启用,请新建草稿复制其条件")}>启用?</button>}
                          {st === "draft" && <button className="l-btn sm mc" onClick={() => toggleRule(r, "active")}>提交生效</button>}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="l-b" style={{ paddingTop: 12 }}>
            <div className="sm-strip">
              <span className="st">draft 草拟</span><span className="ar">操作确认 →</span>
              <span className="st ok">active 生效</span><span className="ar">⇄ 操作确认</span>
              <span className="st warn">paused 停用</span><span className="ar">→</span>
              <span className="st">archived 归档(终态 · 不可再启用)</span>
            </div>
          </div>
        </section>

        {/* 路由分布 */}
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">路由结果分布(7 天)</span>
            <span className="sub">· 评估规则松紧用</span>
          </div>
          <div className="l-b">
            <div className="route-bar">
              {K3_ROUTE_COUNTS.map((r) => (
                <i key={r.key} style={{ width: `${pct1(r.n)}%`, background: r.color }} title={`${r.label} ${pct1(r.n)}%`} />
              ))}
            </div>
            <div className="route-legend">
              {K3_ROUTE_COUNTS.map((r) => (
                <span className="it" key={r.key}><span className="d2" style={{ background: r.color }} />{r.label} {pct1(r.n)}%</span>
              ))}
            </div>
            <div className="ktint" style={{ marginTop: 14, fontSize: 12 }}>
              <b>两条优先级规矩</b> · ① 这里给出延迟 / 冻结 / 转人工结论时,提现队列的「小额快速通道」<b>不能盖过它</b> —— 只有这里放行的小额,那边才能单人即时放行;② 大额提现上,这里的路由和大额 KYC 复审(K5)<b>同时叠加、互不替代</b>:一个管钱的出口,一个管身份合规。
            </div>
            <div className="ktint" style={{ marginTop: 10, fontSize: 12 }}>
              <b>「放行」不发事件</b> · 只有延迟 / 冻结 / 转人工会产命中事件给提现队列;没收到事件就是放行 —— 这一隐式约定已和 D2 对齐,别把「没事件」当漏检。
            </div>
          </div>
        </section>
      </div>

      {/* 命中日志 */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">命中日志</span>
          <span className="sub">· 最近命中规则的提现请求 · 结论已下发提现队列</span>
          <div className="r">
            <div className="chips">
              {([["all", "全部"], ["delay", "延迟"], ["freeze", "冻结"], ["manual", "转人工"]] as const).map(([v, lb]) => (
                <button key={v} className={`chip${filter === v ? " sel" : ""}`} onClick={() => setFilter(v)}>{lb}</button>
              ))}
            </div>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 880 }}>
            <thead><tr><th>提现单</th><th>账户</th><th className="num">金额</th><th>命中规则</th><th>维度</th><th>路由结论</th><th>时间</th></tr></thead>
            <tbody>
              {hits.map((h) => {
                const [actLb, actTone] = RULE_ACT[h[5]];
                return (
                  <tr key={h[0]}>
                    <td className="mono" style={{ color: "var(--ink)" }}>{h[0]}</td>
                    <td className="mono">{h[1]}</td>
                    <td className="num mono" style={{ fontWeight: 700 }}>{h[2]}</td>
                    <td className="mono" style={{ fontSize: 12 }}>{h[3]}</td>
                    <td style={{ fontSize: 12.5 }}>{h[4]}</td>
                    <td><span className={`bdg ${actTone}`}>{actLb}</span></td>
                    <td className="mono" style={{ fontSize: 11.5, color: "var(--ink-4)" }}>今天 {h[6]}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <p className="f-foot">
        <b>所有评估都在服务器</b>:提现请求到达时服务端逐条过规则,客户端没有任何办法跳过;KYC 地址匹配、积分门槛这些既有门槛照常二次校验,这里的路由结论叠加在它们之上。命中冻结的提现单进「冻结」状态(客户端只能看),延迟的延长审核停留,转人工的进 D2 队列由人分诊 —— D2 同时展示风险评分(K4)+ 命中规则(本页),两套信号配合分诊。<b>提现冷却天数、积分门槛不在这里设</b> —— 那是运营节奏参数,归 H1 派发、在提现配置(D5)生效。命中事件同时喂风险雷达(B5)。
      </p>
      <PaginationExemptionList
        items={[
          {
            label: "规则总表",
            kind: "reference-catalog",
            maxRows: 6,
            reason: "提现规则固定六条,需要同屏校验四道关和动作",
          },
          {
            label: "命中日志",
            kind: "sample-ledger",
            maxRows: 7,
            reason: "命中日志当前七条样本,真实提现处置回 D2 队列",
          },
        ]}
      />
    </div>
  );
}

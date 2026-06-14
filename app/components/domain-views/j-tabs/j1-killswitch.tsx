"use client";

/**
 * J1 · Kill-Switch 矩阵 — 7 闸 status grid + 矩阵主表 + 应急快速通道 + B1 备付金前置核验 + 自动触发规则。
 * 闸集 = 前端 §9.11d.1 的 6 闸 + 后台应急新增 withdraw(7 闸,与 B5 雷达 / 首页单源)。
 * B1 数值全部从 LEDGER 单源派生(TREASURY);recoverGate = B1.redLine,不另立数值。
 */
import { CodeTag } from "../design-kit";
import { AutoGloss } from "@/app/components/kit/gloss";
import { KILLSWITCH, TREASURY } from "@/lib/mock/admin/design-data";
import { EMER_SLA, AUTO_RULES, TAMPER_ALERT_CONFIG } from "./data";
import type { JCtx } from "./types";

type Gate = (typeof KILLSWITCH)[number];
const IMPACT_LABEL: Record<string, string> = { immediate: "立即出钱", delayed: "延迟出钱", none: "不出钱" };
const PROPOSAL_LABEL: Record<string, string> = { idle: "无", pending: "待确认", approved: "已通过", rejected: "已驳回" };

/* B1 标尺:量程 0 — (redLine+40);三段 = 危险 <redLine / 审慎 redLine—yellowLine / 健康 ≥yellowLine */
const COV = TREASURY.coverageRatio;
const RED = TREASURY.redLine;
const YELLOW = TREASURY.yellowLine;
const RANGE = RED + 40;
const pct = (v: number) => Math.min(100, Math.max(0, (v / RANGE) * 100));

export function J1KillSwitch({ ctx }: { ctx: JCtx }) {
  const { pget, setParam, toast, openActionConfirm } = ctx;

  const effOn = (g: Gate): boolean => { const v = pget(`J.killswitch.${g.key}`); return v ? v === "on" : g.on; };
  const effEmer = (g: Gate): boolean => pget(`J.killswitch.${g.key}.emergency`) === "true";
  const effChange = (g: Gate): string => (pget(`J.killswitch.${g.key}`) ? "刚刚 · 你 / 执行门槛" : g.lastChange);
  const effProposal = (g: Gate): string => (pget(`J.killswitch.${g.key}`) ? "approved" : g.proposalStatus);
  // R3 阈值与 J3 告警阈值同源(PRD J1④ R3 判据引用 J3③,不另立 key);R1/R2 走 J.autorule.* 可操作确认调。
  const tamperThr = (pget("J.tamper.alertConfig") ?? TAMPER_ALERT_CONFIG.threshold).split("·")[0].trim();
  const effThr = (r: (typeof AUTO_RULES)[number]) => (r.id === "tamperCluster" ? tamperThr : pget(`J.autorule.${r.id}`) ?? r.thr);
  // recoverGate 跟随 B1 红线单源(LEDGER),J 域只读引用不持有;其余应急参数 store 可调。
  const effSla = (row: (typeof EMER_SLA)[number]) => (row.id === "recoverGate" ? String(RED) : pget(`J.emergency.${row.id}`) ?? row.v);
  const slaMins = effSla(EMER_SLA[0]);

  const live = KILLSWITCH.filter(effOn).length;
  const killed = KILLSWITCH.length - live;
  const covPass = COV >= RED;

  const killGate = (g: Gate, emer: boolean) => openActionConfirm({
    action: emer ? `应急熔断 · ${g.name} · emergency=true` : `Kill-Switch 熔断 · ${g.name}`,
    detail: emer ? (
      <><b>应急快速通道</b>:{g.name}(<span className="mono">{g.key}</span>)熔断提案进 A2 队列最高优先级 · 执行门槛响应时限压至 <b>{slaMins} 分钟</b> · 超时自动逐级升级呼叫(I3 critical 通道)· A2 记录标 <b>emergency=true</b> 高亮审计 · 仅止血方向适用 · 不取消确认理由(§15.1)。</>
    ) : (
      <><b>{g.name}</b>(<span className="mono">{g.key}</span> · {g.cap})· {g.desc} · 资金语义:<b>{IMPACT_LABEL[g.coverageImpactCategory]}</b> · 熔断方向不前置 B1 · 常规轨(emergency=false)· server 即时拒绝下游能力请求。<b>处置预案(disposition_plan,可选)</b>:在途请求冻结待恢复 · 客服话术同步 · 恢复条件 = 根因消除 + 执行门槛操作确认。</>
    ),
    run: (reason) => {
      setParam(`J.killswitch.${g.key}`, "off", { action: (emer ? "应急熔断功能闸(emergency=true)" : "熔断功能闸(常规轨)") + " " + g.key, reason });
      if (emer) setParam(`J.killswitch.${g.key}.emergency`, "true", { action: `A2 应急标记 ${g.key}`, reason });
      toast((emer ? "应急熔断 " : "已熔断 ") + g.name + (emer ? " · A2 emergency=true" : " · 写 A2"));
    },
  });

  const resumeGate = (g: Gate) => openActionConfirm({
    action: `Kill-Switch 恢复 · ${g.name}`,
    amplifies: g.amplifies,
    detail: (
      <><b>{g.name}</b>(<span className="mono">{g.key}</span>)从已关停 → 在线 · {g.cap} · {g.coveragePrecheckRequired
        ? <><b>B1 前置核验</b>:server 检查 coverageRatio(<b className="mono">{COV}%</b>)≥ recoverGate(<b className="mono">{RED}%</b>)· {covPass ? <>通过(距红线 +{(COV - RED).toFixed(0)}pt 缓冲)</> : <>不通过,禁止恢复</>} · 自动写 B1 快照标 coverageImpactCategory:{g.coverageImpactCategory}。</>
        : <>不挂 B1(非放大流出闸)· 直接恢复。</>} 恢复恒走常规轨,不可应急加速(§15.1)。</>
    ),
    run: (reason) => {
      setParam(`J.killswitch.${g.key}`, "on", { action: `恢复功能闸 ${g.key}` + (g.coveragePrecheckRequired ? `(B1 核验 ${COV}%≥${RED}%)` : ""), reason });
      if (effEmer(g)) setParam(`J.killswitch.${g.key}.emergency`, "false", { action: `清除应急标记 ${g.key}`, reason });
      toast(`已恢复 ${g.name} · A2 留痕`);
    },
  });

  const launchBatch = () => {
    const targets = KILLSWITCH.filter((g) => g.coverageImpactCategory === "immediate" && effOn(g));
    openActionConfirm({
      action: "应急批量熔断 · 监管点名场景",
      detail: (
        <>一次性熔断多个功能闸 · 用于<b>监管点名 / 法务事件</b>等重大合规触发 · 工单进 A2 队列最高优先级 · 执行门槛 SLA <b>{slaMins} 分钟</b> · 所有步骤标 emergency=true 高亮审计 · 默认勾选「立即出钱」闸:<b>{targets.map((g) => g.name).join(" / ") || "—(均已熔断)"}</b> · 每闸独立写 A2 事件。</>
      ),
      run: (reason) => {
        targets.forEach((g) => {
          setParam(`J.killswitch.${g.key}`, "off", { action: `应急批量熔断 ${g.key}(emergency=true)`, reason });
          setParam(`J.killswitch.${g.key}.emergency`, "true", { action: `A2 应急标记 ${g.key}`, reason });
        });
        toast(`应急批量熔断 · ${targets.length} 闸 · emergency=true`);
      },
    });
  };

  const adjEmer = (row: (typeof EMER_SLA)[number]) => {
    const cur = effSla(row);
    openActionConfirm({
      action: `应急参数调整 · ${row.k}`,
      detail: <><b>{row.k}</b> · {row.d}{row.id === "confirmSlaMins" && <> · 超时自动升级呼叫经 I3 critical 通道</>}{row.id === "escalateMaxMins" && <> · 耗尽后工单终止(守确认理由铁律的活性兜底)</>}{row.id === "escalateMaxRounds" && <> · 超过即终止工单</>}。</>,
      edit: { kind: row.kind, current: cur, unit: row.unit },
      run: (reason, newValue) => {
        setParam(`J.emergency.${row.id}`, newValue ?? cur, { action: `调整应急参数 ${row.k} ${cur}→${newValue}`, reason });
        toast(`${row.k} 已调整 · 确认中`);
      },
    });
  };

  const adjRule = (r: (typeof AUTO_RULES)[number]) => {
    const cur = effThr(r);
    openActionConfirm({
      action: `自动触发规则调整 · ${r.nm}`,
      detail: <><b>{r.nm}</b> · 当前 {cur} · 命中后自动熔断对应闸 · 自动熔断免预先确认,值班人 30 分钟内补填理由确认 · 走应急快速轨。</>,
      edit: { kind: "text", current: cur },
      run: (reason, newValue) => {
        setParam(`J.autorule.${r.id}`, newValue ?? cur, { action: `调整自动触发规则 ${r.nm} ${cur}→${newValue}`, reason });
        toast(`${r.nm} 已确认生效`);
      },
    });
  };

  return (
    <div>
      {/* stat strip */}
      <div className="f-stats">
        <div className="f-stat ok"><div className="k">在线功能闸</div><div className="v">{live} / {KILLSWITCH.length}</div><div className="sub">{killed === 0 ? "全闸正常营业" : "部分业务已关停"}</div></div>
        <div className="f-stat warn"><div className="k">应急轨提案</div><div className="v">0</div><div className="sub">pending 执行门槛 SLA</div></div>
        <div className="f-stat danger"><div className="k">已熔断闸</div><div className="v">{killed}</div><div className="sub">B1 前置阻断 0</div></div>
        <div className="f-stat cyan"><div className="k">B1 覆盖率</div><div className="v">{COV}%</div><div className="sub">redLine {RED}% · 距 +{(COV - RED).toFixed(0)}pt</div></div>
      </div>

      {/* 7 闸 status cards */}
      <div className="gates-strip">
        {KILLSWITCH.map((g) => { const on = effOn(g); return (
          <div key={g.key} className={"gate-card" + (on ? "" : " killed")}>
            <div className="top"><span className="key">{g.name}</span><span className="led" /></div>
            <div className="cap"><b>{g.cap}</b> <span style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--ink-4)" }}>{g.key}</span></div>
            <div className="ft">
              <span className={"impact " + g.coverageImpactCategory}><AutoGloss>{IMPACT_LABEL[g.coverageImpactCategory]}</AutoGloss></span>
              <span className="ts">{effChange(g).split(" · ")[0]}</span>
            </div>
          </div>
        ); })}
      </div>

      {/* 矩阵主表 */}
      <section className="matrix-card">
        <div className="matrix-h">
          <span className="ttl"><AutoGloss>{`功能开关总表 · ${KILLSWITCH.length} 个业务闸`}</AutoGloss></span>
          <span className="sub">· 状态以服务器为准</span>
          <div className="r"><CodeTag tone="electric">审计留痕</CodeTag><CodeTag>每次切换都记录</CodeTag></div>
        </div>
        <div className="matrix-tblwrap"><div className="matrix-tbl">
          <div className="hd">
            <div className="c">业务闸</div><div className="c">控制的能力</div><div className="c">状态</div><div className="c">资金影响</div>
            <div className="c"><AutoGloss>恢复需备付金</AutoGloss></div><div className="c">确认状态</div><div className="c">最近变更</div><div className="c">应急</div>
            <div className="c" style={{ justifyContent: "flex-end" }}>动作</div>
          </div>
          {KILLSWITCH.map((g) => { const on = effOn(g); const prop = effProposal(g); return (
            <div className="rw" key={g.key}>
              <div className="c"><div style={{ fontWeight: 600, color: "var(--ink)" }}>{g.name}</div><span className="mono" style={{ fontSize: 11, color: "var(--ink-4)" }}>{g.key}</span></div>
              <div className="c cap"><span className="nm">{g.cap}</span><span className="desc"><AutoGloss>{g.desc}</AutoGloss></span></div>
              <div className="c">{on ? <span className="badge-st live">在线</span> : <span className="badge-st killed">已关停</span>}</div>
              <div className="c"><span className={"badge-impact " + g.coverageImpactCategory}>{IMPACT_LABEL[g.coverageImpactCategory]}</span></div>
              <div className="c">{g.coveragePrecheckRequired ? <span className="badge-impact immediate"><AutoGloss>需核备付金</AutoGloss></span> : <span className="badge-impact none">不需</span>}</div>
              <div className="c"><span className={"badge-proposal " + prop}>{PROPOSAL_LABEL[prop] ?? prop}</span></div>
              <div className="c mono ink">{effChange(g).split(" · ")[0]}</div>
              <div className="c">{effEmer(g) ? <span className="badge-emergency">应急</span> : <span className="mono" style={{ color: "var(--ink-4)" }}>—</span>}</div>
              <div className="c acts">
                {on ? (<>
                  <button className="kill" onClick={() => killGate(g, false)}>熔断</button>
                  <button className="emer" onClick={() => killGate(g, true)}>应急熔断</button>
                </>) : (
                  <button className="resume" onClick={() => resumeGate(g)}>恢复</button>
                )}
              </div>
            </div>
          ); })}
        </div></div>
      </section>

      {/* 应急快速通道 + B1 备付金检查 */}
      <div className="j1-side">
        <section className="side-card">
          <div className="h">
            <span className="ic emer"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2L4.09 12.97A1 1 0 0 0 5 14h6l-1 8 8.91-10.97A1 1 0 0 0 18 10h-6l1-8z" /></svg></span>
            <div><div className="t">应急快速通道</div><div className="s"><AutoGloss>只用于「关停 / 封锁」这类止血操作 · 遇监管点名等大事时,把执行门槛响应时限压到几分钟</AutoGloss></div></div>
            <span className="tag">应急规则</span>
          </div>
          {EMER_SLA.map((row) => (
            <div className="emer-row" key={row.id}>
              <div className="l"><div className="k"><AutoGloss>{row.k}</AutoGloss></div><div className="d"><AutoGloss>{row.d}</AutoGloss></div></div>
              <div className="v">{effSla(row)}<span className="u">{row.unit}</span></div>
              {row.id === "recoverGate"
                ? <span className="gate-ref" title="recoverGate 引用 B1.redLine 单源,调整须在 B1 双账本域操作">跟随 B1 红线</span>
                : <button className="adj" onClick={() => adjEmer(row)}>调整</button>}
            </div>
          ))}
          <div className="emer-launch">
            <div className="txt"><b>一键批量关停</b> · <AutoGloss>遇监管点名 / 法务事件时,勾选多个业务一次性全部关停 · 全程留下高亮记录备查</AutoGloss></div>
            <button onClick={launchBatch}>发起应急关停</button>
          </div>
        </section>

        <section className="side-card">
          <div className="h">
            <span className="ic b1"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12h4l3-7 4 14 3-7h4" /></svg></span>
            <div><div className="t"><AutoGloss>恢复业务前 · 备付金检查</AutoGloss></div><div className="s"><AutoGloss>恢复「会往外付钱」的业务(提现 / 兑换 / Genesis / 质押 / NEX v2)前,先看平台备付金够不够</AutoGloss></div></div>
            <span className="tag">备付金</span>
          </div>
          <div className="b1cov-hero">
            <div className={"item " + (covPass ? "ok" : "warn")}>
              <div className="k">当前备付金覆盖率</div>
              <div className="v">{COV}%</div>
              <div className="sub">{COV >= YELLOW ? "能覆盖全部应付 · 还有富余" : covPass ? "高于红线 · 审慎区间" : "低于红线 · 禁止恢复"}</div>
            </div>
            <div className="item warn">
              <div className="k">恢复门槛(红线)</div>
              <div className="v">{RED}%</div>
              <div className="sub">低于此线不允许恢复</div>
            </div>
          </div>
          <div className="b1cov-bar" style={{ background: `linear-gradient(90deg, color-mix(in srgb, var(--danger) 50%, transparent) 0%, color-mix(in srgb, var(--danger) 50%, transparent) ${pct(RED)}%, color-mix(in srgb, var(--warning) 50%, transparent) ${pct(RED)}%, color-mix(in srgb, var(--warning) 50%, transparent) ${pct(YELLOW)}%, color-mix(in srgb, var(--success) 50%, transparent) ${pct(YELLOW)}%, color-mix(in srgb, var(--success) 50%, transparent) 100%)` }}>
            <div className="bnd" style={{ left: `${pct(RED)}%` }} />
            <div className="bnd" style={{ left: `${pct(YELLOW)}%` }} />
            <div className="needle" style={{ left: `${pct(COV)}%` }}><span className="nlb">当前 {COV}%</span></div>
          </div>
          <div className="b1cov-legend">
            <span className="it"><span className="d red" />危险 &lt;{RED}%</span>
            <span className="it"><span className="d yellow" />审慎 {RED}–{YELLOW}%</span>
            <span className="it"><span className="d green" />健康 ≥{YELLOW}%</span>
            <span className="it" style={{ marginLeft: "auto", color: covPass ? "var(--success)" : "var(--danger)", fontWeight: 600 }}>当前 {COV}% · {covPass ? "通过" : "不通过"}</span>
          </div>
          <div className="b1cov-detail">
            <span className="ic"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 7" /></svg></span>
            <div><b>{covPass ? "目前所有业务都可以安全恢复" : "低于红线 · 放大流出业务禁止恢复"}</b> · <AutoGloss>{`备付金覆盖率 ${COV}%,${covPass ? `高于 ${RED}% 红线,还有 ${(COV - RED).toFixed(0)} 个百分点的缓冲` : `低于 ${RED}% 红线`}。恢复提现 / 兑换 / Genesis / 质押 / NEX v2 任一业务时,系统都会自动记录当时的备付金水位。`}</AutoGloss></div>
          </div>
        </section>
      </div>

      {/* 自动触发规则 */}
      <section className="rules-card">
        <div className="rules-h">
          <span className="ttl"><AutoGloss>自动触发规则 · 命中就自动关停对应业务</AutoGloss></span>
          <span className="sub">· 自动关停自动触发 · 值班人 30 分钟内补填理由确认</span>
          <div className="r"><CodeTag tone="electric">审计留痕</CodeTag></div>
        </div>
        <div className="rules-grid">
          {AUTO_RULES.map((r) => (
            <div className="rule" key={r.id}>
              <div className="top">
                <span className="ic">
                  {r.icon === "surge" && <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" /></svg>}
                  {r.icon === "gap" && <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6l3 12 6-3 6 3 3-12" /><path d="M12 2v4" /></svg>}
                  {r.icon === "shield" && <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" /><path d="M9 12l2 2 4-4" /></svg>}
                  {r.icon === "clock" && <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" /></svg>}
                </span>
                <div className="t"><div className="nm">{r.nm}</div><div className="key">{r.tag}</div></div>
              </div>
              <div className="cond">{r.cond.map((part, i) => {
                if (!part) return null;
                const text = r.id === "tamperCluster" && i === 1 ? tamperThr : part;
                return i % 2 ? <b key={i}>{text}</b> : <AutoGloss key={i}>{text}</AutoGloss>;
              })}</div>
              <div className="row">
                <span className="key">{r.thrK}</span><span className="val">{effThr(r)}</span>
                {r.adjustable
                  ? <button onClick={() => adjRule(r)}>调整</button>
                  : r.refNote
                    ? <span className="gate-ref" title={r.refTitle}>{r.refNote}</span>
                    : null}
              </div>
            </div>
          ))}
        </div>
      </section>

      <p className="f-foot"><b>关停立刻全站生效、客户端绕不过</b>:<AutoGloss>开关状态以服务器为准,关停后对应业务的请求会被服务器当场拒绝。任何关停 / 恢复都必须走执行门槛、填写理由并落 A2 审计。恢复「会往外付钱」的业务(提现 / 兑换 / Genesis / 质押 / NEX v2)前要先确认备付金够;不涉及付钱的(试用 / 会员)恢复则不用。每次操作都会留完整审计记录,并同步给风险雷达、风险评分和备付金看板。</AutoGloss></p>
    </div>
  );
}

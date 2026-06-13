"use client";

/**
 * L5 · 导出 & 监管报告 — 全平台数据出口的唯一管控面。
 * 三道防线:每次导出落 admin.report_exported 审计;含 PII/资金明细批量导出经 操作确认;敏感字段默认脱敏(解密强操作确认+事由)。
 * 导出任务状态机:pending →[含敏感 OR 超限] pending_confirm(/split)→ generating → ready(限时 24h)→ expired;失败可重试(24h 去重)。
 * 真写:任务放行/重试/解密/监管报告 → L.export.* / L.regulatory.*;报送排程/模板沿用既有 L.report.* 契约(setParam + logAudit 双留痕)。
 */
import { useState } from "react";
import { AutoGloss } from "@/app/components/kit/gloss";
import { PaginationExemptionList } from "../design-kit";
import { EXPORT_TASKS, ST_LABEL, REG_TEMPLATES, J4_TRACE, MASK_RULES, EXPORT_PARAMS, AUDIT_ROWS, L5_STATS, SCHEDULE_OPTS, SCHEDULE_DEFAULT, type ExportTask } from "./data";
import type { LCtx } from "./types";

const TPL_ICONS: Record<string, React.ReactNode> = {
  kyc: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="8" r="3" /><path d="M3 19a6 6 0 0112 0" /><path d="M16 11l2 2 4-4" /></svg>,
  fund: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="6" width="18" height="13" rx="2.5" /><path d="M3 10h18" /></svg>,
  shield: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" /><path d="M9 12l2 2 4-4" /></svg>,
  geo: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" /></svg>,
};

export function L5HeaderActions({ ctx }: { ctx: LCtx }) {
  const newExport = () => ctx.openActionConfirm({
    action: "发起导出任务",
    detail: <>选择导出类型(账单 CSV / 漏斗序列 / 财务报表 / 运营报表 / 监管报告)、范围(时间窗 / cohort / 用户范围)、字段(含/不含 PII)与脱敏策略。<b>要不要走确认由服务端判定</b>:含敏感数据 <b>或</b> 行数 &gt; 100 万 → 进操作确认(超限走拆分确认);否则直接生成。同样范围 24 小时内重复发起会自动合并,防止重复生成。此处为原型:默认演示「聚合漏斗序列」(无 PII,仍需操作确认)。</>,
    edit: { kind: "text", current: "漏斗序列 · W17–W22 · 聚合" },
    run: (reason, newValue) => {
      const v = newValue || "漏斗序列 · W17–W22 · 聚合";
      ctx.setParam("L.export.new", v, { action: `发起导出任务「${v}」`, reason });
      ctx.logAudit({ actor: "总管理员", action: `发起导出任务「${v}」`, target: "admin.report_exported", after: "聚合无 PII · 仍需操作确认", reason });
      ctx.toast(`导出任务已创建:${v} · 聚合无 PII 仍需操作确认 · 落 admin.report_exported`);
    },
  });
  return (
    <>
      <span className="f-ro"><span className="d" />数据出境统一管控面</span>
      <button className="f-cta" onClick={newExport}>发起导出任务</button>
    </>
  );
}

export function L5Export({ ctx }: { ctx: LCtx }) {
  const { pget, params, setParam, logAudit, toast, openActionConfirm } = ctx;
  const [filter, setFilter] = useState(0);

  /* ---- 任务态:store 覆盖回落 mock(放行→generating / 重试→按 PII 重走确认或直接生成) ---- */
  const effSt = (t: ExportTask): string => {
    const v = pget(`L.export.${t.id}`);
    if (v === "approved") return "generating";
    if (v === "retried") return t.pii ? "pending_confirm" : "generating";
    return t.st;
  };
  const effActs = (t: ExportTask): ExportTask["acts"] => {
    const v = pget(`L.export.${t.id}`);
    if (v === "approved") return [];
    if (v === "retried") return t.pii ? ["approve"] : [];
    return t.acts;
  };
  const pendingCount = EXPORT_TASKS.filter((t) => effSt(t).startsWith("pending_")).length;
  const splitCount = EXPORT_TASKS.filter((t) => effSt(t) === "pending_split_confirm").length;
  const decryptedQ = AUDIT_ROWS.filter((a) => a.mask === "decrypted").length;

  const approveTask = (t: ExportTask) => openActionConfirm({
    action: `操作确认放行 · ${t.id}`,
    detail: <><b>{t.type}</b> · 范围:{t.scope} · 行数 {t.rows} · 脱敏 <b>{t.mask}</b> · {effSt(t) === "pending_split_confirm" && <><b>超 100 万行上限,按拆分批次放行(超管)</b> · </>}放行后进入 generating → ready(限时链接 24h)· 落 admin.report_exported(operator/scope/fields/row_count/contains_pii/masking_policy/operator / role_gate/ts)。</>,
    run: (reason) => {
      setParam(`L.export.${t.id}`, "approved", { action: `导出任务放行 ${t.id}(${t.type})`, reason });
      logAudit({ actor: "总管理员", action: `导出任务放行 ${t.id}`, target: "admin.report_exported", after: `${t.type} · rows=${t.rows} · masking=${t.mask}`, reason });
      toast(`${t.id} 已放行 → generating · A2 留痕`);
    },
  });
  const retryTask = (t: ExportTask) => {
    setParam(`L.export.${t.id}`, "retried", { action: `导出任务重新发起 ${t.id}`, reason: "同范围 24h 内自动合并" });
    toast(`${t.id} 已重新发起 · 同范围 24 小时内自动合并${t.pii ? " · 含敏感重走操作确认" : ""}`);
  };
  const genReport = (nm: string) => openActionConfirm({
    action: `生成监管报告 · ${nm}`,
    detail: <><b>监管报送 = 数据出境敏感</b> · 模板:{nm} · 数据范围按辖区要求 · <b>关联 I5 当前披露版本 × 司法辖区</b> · 法务确认状态随任务流转 · 操作链:风控(操作员,兼合规确认)→ 超管 / 风控 lead(执行门槛)· 落 admin.report_exported(+ 披露版本 + 辖区)。</>,
    run: (reason) => {
      setParam(`L.regulatory.${nm}`, "requested", { action: `生成监管报告 ${nm}(操作确认)`, reason });
      logAudit({ actor: "总管理员", action: `生成监管报告 ${nm}`, target: "admin.report_exported", after: "含 PII · masked · 关联 I5 披露版本 × 辖区", reason });
      toast(`${nm} 报告生成任务已创建 · 待操作确认`);
    },
  });
  const decryptExport = () => openActionConfirm({
    action: "解密导出 · masking_policy = decrypted",
    detail: <><b>PII 解密明文导出 = 最高敏感档</b> · 解密字段:手机号 / 卡 token / 地址(按字段勾选)· <b>强操作确认 + 强制事由</b>(操作理由即强制事由,写入审计)· 操作员:风控 / 只读审计 → 执行门槛:超管 / 风控 lead · 落 admin.report_exported(解密字段清单 / 事由 / operator / role_gate)· A2 只追加,不可抵赖。</>,
    run: (reason) => {
      setParam("L.export.decrypted", "requested", { action: "解密导出发起(decrypted · 强操作确认)", reason });
      logAudit({ actor: "总管理员", action: "解密导出发起", target: "admin.report_exported", after: "masking_policy=decrypted · 字段与事由已留痕", reason });
      toast("解密导出已发起 · 待强操作确认 · 解密字段与事由已留痕");
    },
  });
  const adjParam = (p: (typeof EXPORT_PARAMS)[number]) => openActionConfirm({
    action: `导出安全参数调整 · ${p.k}`,
    detail: <><b>{p.k}</b> · 当前:{p.cur} · 数据出境管控基线参数,调整经操作确认 · 含敏感操作确认开关为铁律不可关(不在可调范围)。</>,
    edit: { kind: "text", current: p.cur ?? p.v },
    run: (reason, newValue) => {
      setParam(`L.param.${p.k}`, newValue ?? p.v, { action: `调整导出安全参数 ${p.k}`, reason });
      toast(`${p.k} 调整已确认生效`);
    },
  });

  /* ---- 报送排程 & 报表模板(既有真功能,L.report.* 契约保留) ---- */
  const schedule = pget("L.report.schedule") ?? SCHEDULE_DEFAULT;
  const templates = Object.keys(params).filter((k) => k.startsWith("L.report.template.") && params[k] === "created").map((k) => k.slice("L.report.template.".length));
  const adjSchedule = () => openActionConfirm({
    action: "调整监管报送排程",
    detail: <>从「{schedule}」切换报送周期 · 改后按新周期自动触发生成 · 写入 L.report.schedule + A2 审计。</>,
    edit: { kind: "select", current: schedule, options: [...SCHEDULE_OPTS] },
    run: (reason, newValue) => {
      const v = (newValue ?? "").trim();
      if (!v) return;
      setParam("L.report.schedule", v, { action: "调整监管报送排程", reason });
      logAudit({ actor: "总管理员", action: "调整监管报送排程", target: "L.report.schedule", before: schedule, after: v, reason });
      toast(`报送排程已调整:${schedule} → ${v} · 写入 A2 审计`);
    },
  });
  const newTemplate = () => openActionConfirm({
    action: "新建报表模板",
    detail: <>输入模板名称创建自定义报送口径,供 L5 监管报告复用 · 写入 L.report.template.&lt;名称&gt; + A2 审计。</>,
    edit: { kind: "text", current: "—(输入模板名称)" },
    run: (reason, newValue) => {
      const name = (newValue ?? "").trim();
      if (!name) return;
      setParam(`L.report.template.${name}`, "created", { action: `新建报表模板 ${name}`, reason });
      logAudit({ actor: "总管理员", action: `新建报表模板 ${name}`, target: `L.report.template.${name}`, after: "created", reason });
      toast(`报表模板已新建:${name} · 写入 A2 审计`);
    },
  });

  return (
    <div>
      {/* stat strip */}
      <div className="f-stats">
        <div className="f-stat"><div className="k">本月导出任务</div><div className="v">{L5_STATS.monthTotal}</div><div className="sub">聚合 {L5_STATS.aggCount} · 含敏感 {L5_STATS.sensitiveCount}</div></div>
        <div className="f-stat warn"><div className="k">待操作确认</div><div className="v">{pendingCount}</div><div className="sub">含 {splitCount} 个超限拆分待超管批</div></div>
        <div className="f-stat danger"><div className="k">解密导出(本季)</div><div className="v">{decryptedQ}</div><div className="sub">强操作确认 + 强制事由 · 全留痕</div></div>
        <div className="f-stat cyan"><div className="k">监管报告(本季)</div><div className="v">{L5_STATS.regulatoryQ}</div><div className="sub">关联 I5 披露版本 × 司法辖区</div></div>
      </div>

      {/* 导出安全参数 */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">导出安全参数</span>
          <span className="sub">· <AutoGloss>数据出境管控基线 · 含敏感操作确认为铁律不可关</AutoGloss></span>
          <div className="r"><span className="lcode electric" title="§16.1 框架 3">数据出境管控</span></div>
        </div>
        <div className="l-b">
          <div className="param-grid">
            {EXPORT_PARAMS.map((p) => (
              <div key={p.k} className="p">
                <div className="k">{p.k}</div>
                <div className="v" style={p.fixed ? { color: "var(--success)" } : undefined}>
                  {p.v}{p.fixed ? <span className="bdg dim">不可关</span> : <button className="l-btn sm" onClick={() => adjParam(p)}>{p.k === "账单导出范围" ? "勾选" : "调整"}</button>}
                </div>
                <div className="s"><AutoGloss>{p.s}</AutoGloss></div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* (a) 导出任务管理 */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">导出任务管理</span>
          <span className="sub">· <AutoGloss>发起 / 跟踪 · 同样范围 24 小时内重复发起会自动合并,不会生成两份</AutoGloss></span>
          <div className="r"><div className="chips">
            {["全部", "待确认", "生成中", "可下载"].map((c, i) => (
              <button key={c} className={"chip" + (i === filter ? " sel" : "")} onClick={() => { setFilter(i); toast(`任务列表筛选:${c}`); }}>{c}</button>
            ))}
          </div></div>
        </div>
        <div className="l-b" style={{ paddingBottom: 10 }}>
          <div className="sm-strip">
            <span className="st">pending</span><span className="ar">含敏感 OR 超限 →</span>
            <span className="st hl">pending_confirm</span><span className="ar">超限拆分 →</span>
            <span className="st hl">pending_split_confirm</span><span className="ar">批 →</span>
            <span className="st">generating</span><span className="ar">→</span>
            <span className="st ok">ready(限时链接)</span><span className="ar">24h →</span>
            <span className="st">expired</span>
            <span className="ar" style={{ marginLeft: 12 }}>失败 →</span><span className="st bad">failed(可重试 · 24h 去重)</span>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 1080 }}>
            <thead><tr><th>任务</th><th>类型</th><th>范围</th><th>字段 / PII</th><th>脱敏</th><th className="num">行数</th><th>状态</th><th>操作链</th><th style={{ textAlign: "right" }}>操作</th></tr></thead>
            <tbody>
              {EXPORT_TASKS.map((t) => {
                const st = ST_LABEL[effSt(t)];
                const acts = effActs(t);
                return (
                  <tr key={t.id}>
                    <td className="mono" style={{ color: "var(--ink)" }}>{t.id}</td>
                    <td style={{ fontWeight: 600, color: "var(--ink-2)" }}><AutoGloss>{t.type}</AutoGloss></td>
                    <td className="mono" style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{t.scope}</td>
                    <td style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{t.fields}{t.pii && <span className="bdg bad" style={{ fontSize: 10.5, marginLeft: 4 }}>PII</span>}</td>
                    <td>{t.mask === "—" ? <span className="bdg dim">—</span> : <span className={"mask-pill " + t.mask}>{t.mask}</span>}</td>
                    <td className="num mono">{t.rows}</td>
                    <td><span className={"bdg " + st[1]}>{st[0]}</span></td>
                    <td className="mono" style={{ fontSize: 11.5, color: "var(--ink-4)" }}>{pget(`L.export.${t.id}`) === "approved" ? t.chain.replace("待批", "已批") : t.chain}</td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      {acts.length === 0 && <span className="mono" style={{ color: "var(--ink-4)" }}>—</span>}
                      {acts.includes("approve") && <button className="l-btn sm mc" onClick={() => approveTask(t)}>操作确认</button>}
                      {acts.includes("download") && <button className="l-btn sm" onClick={() => { logAudit({ actor: "总管理员", action: `下载导出产物 ${t.id}`, target: "admin.report_exported", after: "限时链接 24h · 下载行为留痕" }); toast("限时下载链接已打开(服务端签发 · 24 小时有效)· 下载行为落审计"); }}>下载</button>}
                      {acts.includes("retry") && <button className="l-btn sm" onClick={() => retryTask(t)}>重新发起</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* (b) 监管报告生成 */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">监管报告生成</span>
          <span className="sub">· <AutoGloss>由风控同事手动发起,不会被应急剧本自动触发 · 报告会带上当前风险披露版本和对应辖区</AutoGloss></span>
          <div className="r"><span className="lcode">操作员 = 风控 → 执行门槛 = 超管 / 风控 lead</span></div>
        </div>
        <div className="l-b">
          <div className="tpl-grid">
            {REG_TEMPLATES.map((t) => (
              <div key={t.key} className="tpl">
                <div className="top"><span className="ic">{TPL_ICONS[t.icon]}</span><div><div className="nm"><AutoGloss>{t.nm}</AutoGloss></div><div className="cy">{t.cy}</div></div></div>
                <div className="meta"><AutoGloss>{t.meta}</AutoGloss></div>
                <div className="ft"><span className="st">{pget(`L.regulatory.${t.nm}`) === "requested" ? "刚刚 · 待操作确认" : t.last}</span><button className="l-btn sm mc" onClick={() => genReport(t.nm)}>生成</button></div>
              </div>
            ))}
          </div>
          <div className="liab-split" style={{ marginTop: 16 }}>
            <div className="ltint" style={{ fontSize: 12 }}><b>发起规则</b> · <AutoGloss>监管报告由风控在本页手动发起(现阶段合规确认由风控兼任,后续才设独立合规角色)。如果以后要让应急剧本自动生成报告,得先去 J4 的剧本清单里登记,不在这页私自加联动。</AutoGloss></div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>J4 应急执行追溯 <span className="lcode" style={{ marginLeft: 6 }}>admin.emergency_playbook_executed · 只读消费</span></div>
              <div className="trace">
                {J4_TRACE.map((e) => (
                  <div key={e.ts} className="ev">
                    <span className="d" style={{ background: e.tone }} />
                    <div className="tx"><b><AutoGloss>{e.txt[0]}</AutoGloss></b><AutoGloss>{e.txt[1]}</AutoGloss></div>
                    <span className="ts">{e.ts}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 报送排程 & 报表模板(既有真功能) */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">报送排程 &amp; 报表模板</span>
          <span className="sub">· <AutoGloss>监管报送周期 / 自定义报送口径模板,供上方监管报告复用</AutoGloss></span>
          <div className="r"><span className="lcode">L.report.schedule</span></div>
        </div>
        <div className="l-b">
          <div className="liab-split">
            <div>
              <div className="rev-row" style={{ gridTemplateColumns: "1fr auto auto" }}>
                <span className="nm">监管报送排程<span className="src">按周期自动触发生成</span></span>
                <span className="amt">{schedule}</span>
                <button className="l-btn sm" onClick={adjSchedule}>调整排程</button>
              </div>
              <div className="rev-row" style={{ gridTemplateColumns: "1fr auto" }}>
                <span className="nm">下次报送窗口</span>
                <span style={{ fontSize: 11.5, color: "var(--ink-4)" }}>按当前排程「{schedule}」自动触发生成</span>
              </div>
            </div>
            <div>
              <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
                <div><div style={{ fontSize: 12.5, fontWeight: 600 }}>报表模板</div><div style={{ fontSize: 11.5, color: "var(--ink-4)" }}>自定义报送口径模板</div></div>
                <button className="l-btn sm mc" style={{ marginLeft: "auto" }} onClick={newTemplate}>+ 新建模板</button>
              </div>
              {templates.length > 0
                ? <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{templates.map((t) => <span key={t} className="lcode electric" title="已建报表模板">{t}</span>)}</div>
                : <div style={{ fontSize: 11.5, color: "var(--ink-4)" }}>暂无自定义模板 · 点「新建模板」创建报送口径</div>}
            </div>
          </div>
          <div className="ltint warn" style={{ marginTop: 12, fontSize: 12 }}><AutoGloss>排程调整 / 新建模板影响监管报送口径 · 须 操作确认 + admin 审计留痕</AutoGloss></div>
        </div>
      </section>

      <div className="bottom-split">
        {/* (c) 导出审计台 */}
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">导出审计台</span>
            <span className="sub">· <AutoGloss>admin.report_exported 统一呈现 · 只追加不可改 · 数据出境记录不可抵赖</AutoGloss></span>
            <div className="r"><button className="l-btn sm" onClick={() => toast("审计台核查(只读)· 可选落 admin.bi_query_run")}>核查</button></div>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="l-tbl" style={{ minWidth: 680 }}>
              <thead><tr><th>时间</th><th>导出者</th><th>类型 / 范围</th><th className="num">行数</th><th>PII</th><th>脱敏</th><th>操作员 / 执行门槛</th><th>下载</th></tr></thead>
              <tbody>
                {AUDIT_ROWS.map((a) => (
                  <tr key={a.ts} style={a.mask === "decrypted" ? { background: "var(--danger-soft)" } : undefined}>
                    <td className="mono" style={{ fontSize: 11.5 }}>{a.ts}</td>
                    <td className="mono" style={{ fontSize: 11.5, color: "var(--ink-2)" }}>{a.who}</td>
                    <td style={{ fontSize: 12 }}><AutoGloss>{a.what}</AutoGloss></td>
                    <td className="num mono">{a.rows}</td>
                    <td>{a.pii ? <span className="bdg bad">PII</span> : <span className="bdg dim">否</span>}</td>
                    <td>{a.mask === "—" ? <span className="bdg dim">—</span> : <span className={"mask-pill " + a.mask}>{a.mask}</span>}</td>
                    <td className="mono" style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{a.chain}</td>
                    <td className="mono" style={{ fontSize: 11.5, color: "var(--ink-4)" }}>{a.dl}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="l-b" style={{ paddingTop: 10 }}>
            <div className="ltint" style={{ fontSize: 11.5 }}><b>一处看全</b> · <AutoGloss>用户域原有的「用户名单导出」记录也统一收进这张表(类型标 user_list)——全平台谁导过什么,只看这一处。</AutoGloss></div>
          </div>
        </section>

        {/* 字段级脱敏规则表 */}
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">字段级脱敏规则表</span>
            <span className="sub">· 统一脱敏中间层 · masking_policy 三档</span>
            <div className="r"><span className="lcode">masked / partial / decrypted</span></div>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="l-tbl" style={{ minWidth: 520 }}>
              <thead><tr><th>字段</th><th>类别</th><th>默认规则</th><th>允许解密</th><th>解密确认</th></tr></thead>
              <tbody>
                {MASK_RULES.map((r) => (
                  <tr key={r.f}>
                    <td style={{ fontWeight: 600, color: "var(--ink)" }}><AutoGloss>{r.f}</AutoGloss></td>
                    <td><span className={"bdg " + r.catTone}>{r.cat}</span></td>
                    <td>{r.rule && <span className={"mask-pill " + r.rule}>{r.rule}</span>} {r.ruleNote}</td>
                    <td>{r.dec}</td>
                    <td className="mono" style={{ fontSize: 11.5 }}>{r.appr}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="l-b" style={{ paddingTop: 10 }}>
            <button className="l-btn mc" style={{ width: "100%", justifyContent: "center" }} onClick={decryptExport}>
              发起解密导出(强操作确认 + 强制事由)
            </button>
          </div>
        </section>
      </div>

      <p className="f-foot"><b>L5 的「写」只有导出产出本身</b>(<AutoGloss>只读数据的导出,不改任何业务状态</AutoGloss>)。<AutoGloss>账单 CSV 复用账本域(D4)既有导出通道,本页只做</AutoGloss><b>管控 / 审计 / 脱敏的叠加层</b>,<AutoGloss>不另开口子、不私加参数;导出范围必须覆盖全部 8 类账单(含 bonus 与 C3 人工调整 adjustment),不能静默丢掉。导出的数据全部来自服务端权威事件流与双账本聚合——</AutoGloss><b>客户端自己上报的状态绝不导出</b>。<AutoGloss>脱敏在服务端执行;下载链接由服务端签发、限时失效,绕不过也越不了权。每条</AutoGloss> <b>admin.report_exported</b> <AutoGloss>记录谁导的 / 导了什么 / 多少行 / 含不含隐私 / 怎么脱敏 / 谁发起谁确认 / 什么时间,进只追加不可改的审计库——这是防止数据被滥用带出去的核心防线。</AutoGloss></p>
      <PaginationExemptionList
        items={[
          {
            label: "导出任务管理",
            kind: "sample-ledger",
            maxRows: 6,
            reason: "导出任务当前六条样本,生成/放行动作按状态处理",
          },
          {
            label: "导出审计台",
            kind: "sample-ledger",
            maxRows: 6,
            reason: "审计台仅展示最近六条导出样本,完整审计归 A2/L5 后端查询",
          },
          {
            label: "字段级脱敏规则表",
            kind: "reference-catalog",
            maxRows: 6,
            reason: "脱敏字段规则固定六项,需同屏核对解密确认",
          },
        ]}
      />
    </div>
  );
}

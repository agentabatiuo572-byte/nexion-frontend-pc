"use client";

/**
 * A2 审计 & 操作确认中心 — design_handoff_a_domain/A2 设计稿 port(387 行 + SPEC §4 矩阵 14 行权威 + §7 三铁律)。
 *
 * 全后台最高频工作台:高敏操作动态 + 审计日志 + 执行历史 + 机制参数四块,落 9 大类操作确认清单。
 *
 * A 域三铁律(A2 实装,server-canonical 镜像):
 *  ① append-only — 审计日志只导出不改/删,导出按钮仍需操作确认(强制留痕)。无 endpoint = 无 UI;
 *  ② reason-required — 所有高敏动作提交前必须填操作理由,弹窗校验不通过不写 store;
 *  ③ 确认即执行 + 幂等 — 确认成功 toast 含「Idempotency-Key 24h dedup」提示,失败回 pending 零副作用。
 *
 * 真写键(A.*):
 *  A.appr.<id>.status(approved / rejected / withdrawn)·
 *  A.confirm.reasonMin(理由最短长度)· A.appr.ret(日志保留期)· A.appr.schemaVer(字段结构注册)。
 *
 * 操作确认 显式 edit 契约(2026-06 跨域硬化):
 *  - 调参(理由最短长度 / 保留期 / schema 注册)传 edit:{kind,current,unit};
 *  - 处置(放行 / 驳回)不传 edit。
 *
 * amplifies 仅 A2 fund 类 + amplifies=true(放大资金流出方向)挂 B1 红线预检。
 *
 * 设计稿元素省略:f-bar/f-nav/f-title/f-desc/f-cta 已由 DomainHeader 承担,本组件从 .f-stats 开始。
 */
import { useEffect, useMemo, useState } from "react";
import { Drawer, PaginationExemptionList } from "../design-kit";
import {
  A2_STATS,
  OPERATION_QUEUE,
  AUDIT_LOGS,
  OPERATION_HISTORY,
  MECHANISM_PARAMS,
  CONFIRM_CATEGORIES,
  type OperationRow,
  type OperationType,
  type AuditDomain,
} from "./data";
import type { ACtx } from "./types";

/* ────────────────── helpers ────────────────── */

/** demo 模拟当前用户 = "陈锐(超管)"(无登录态);所有高敏动作均由当前操作员确认即执行。 */
const CURRENT_USER_NAME = "陈锐";

type QType = "all" | OperationType;
type QOperator = "all" | "财务" | "风控" | "增长" | "内容" | "客服" | "超管";
type DomainFilter = "all" | AuditDomain;

const TYPE_CHIPS: { key: QType; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "fund", label: "资金类" },
  { key: "param", label: "参数类" },
  { key: "acct", label: "处置/账号" },
  { key: "sos", label: "⚡ 应急轨" },
];

const OPERATOR_CHIPS: { key: QOperator; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "财务", label: "财务" },
  { key: "风控", label: "风控" },
  { key: "增长", label: "增长" },
  { key: "内容", label: "内容" },
  { key: "客服", label: "客服" },
  { key: "超管", label: "超管" },
];

const DOMAIN_CHIPS: { key: DomainFilter; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "D", label: "资金 D" },
  { key: "C", label: "用户 C" },
  { key: "H", label: "节奏 H" },
  { key: "I", label: "内容 I" },
  { key: "A", label: "基座 A" },
];

const HIST_TONE: Record<string, "ok" | "bad" | "dim" | "warn"> = {
  approved: "ok",
  rejected: "bad",
  withdrawn: "dim",
  expired: "warn",
};

const HIST_LABEL: Record<string, string> = {
  approved: "approved",
  rejected: "rejected",
  withdrawn: "withdrawn",
  expired: "expired",
};

function pad2(n: number): string {
  return String(Math.max(0, Math.floor(n))).padStart(2, "0");
}

function fmtHMS(seconds: number): string {
  const s = Math.max(0, seconds);
  return `${pad2(Math.floor(s / 3600))}:${pad2(Math.floor((s % 3600) / 60))}:${pad2(s % 60)}`;
}

/* ────────────────── 主组件 ────────────────── */

export function A2Audit({ ctx }: { ctx: ACtx }) {
  const { pget, setParam, logAudit, toast, openActionConfirm, openConfirm } = ctx;

  /* 应急 SLA 倒计时(初始 42:10,每秒 -1) */
  const [sosSec, setSosSec] = useState<number>(42 * 60 + 10);
  useEffect(() => {
    const id = setInterval(() => setSosSec((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, []);

  /* 高敏动作过滤 + 分页 */
  const [qType, setQType] = useState<QType>("all");
  const [qOperator, setQOperator] = useState<QOperator>("all");
  const [qPage, setQPage] = useState(0);
  const [qPerPage, setQPerPage] = useState(10);

  /* 审计日志域筛 */
  const [dFlt, setDFlt] = useState<DomainFilter>("all");

  /* drawers */
  const [woIdx, setWoIdx] = useState<number | null>(null);
  const [logIdx, setLogIdx] = useState<number | null>(null);
  const [histIdx, setHistIdx] = useState<number | null>(null);
  const [mcListOpen, setActionConfirmListOpen] = useState(false);

  /* ────────────────── 动作实时态(pget 覆盖种子) ────────────────── */
  const effStatus = (w: OperationRow): "pending" | "approved" | "rejected" | "withdrawn" =>
    (pget(`A.appr.${w.id}.status`) as "approved" | "rejected" | "withdrawn" | undefined) ?? "pending";

  /* ────────────────── 高敏动作 ────────────────── */

  const approveWo = (w: OperationRow) => {
    openActionConfirm({
      action: <>确认执行 · {w.id}({w.action})</>,
      detail: (
        <>
          对象 <b>{w.obj}</b> · 提案 <b>{w.before} → {w.after}</b> · 发起人 {w.operator}。
          操作理由必填,确认后一次性事务写入目标域并落审计
          {w.sos ? (<>,<b> 应急轨:确认后立即生效并通知 J 域值班</b></>) : null}。<br />
          执行门槛:<b>{w.roleGate}</b> · 防重号 Idempotency-Key 24h dedup。
        </>
      ),
      amplifies: w.amplifies,
      run: (reason) => {
        const isWithdraw = w.id.includes("8852");
        setParam(`A.appr.${w.id}.status`, "approved", {
          action: `确认执行 ${w.id} · ${w.operatorRole}_lead${isWithdraw ? " → D2 同事务写" : ""} · admin.operation_confirmed`,
          reason,
        });
        logAudit({ actor: CURRENT_USER_NAME, action: `确认执行 ${w.id} · admin.operation_confirmed(${w.operatorRole}_lead/超管)`, target: w.id, reason });
        toast(`${w.id} 已执行 · 目标域写入 + 审计留痕 · idempotency 24h dedup`);
      },
    });
  };

  const rejectWo = (w: OperationRow) => {
    openConfirm({
      action: <>取消执行 · {w.id} · {w.action}</>,
      detail: (
        <>
          取消后该动作转 <b>rejected</b>(终态),原因必填并随审计永久留痕。需要再做只能重新发起新的操作确认。
        </>
      ),
      chips: [
        ["取消 = 终态 · 不可逆", "ready"],
        ["原因必填 · 写入审计", "ready"],
      ],
      reason: true,
      okLabel: "确认取消",
      run: (reason) => {
        setParam(`A.appr.${w.id}.status`, "rejected", {
          action: `取消执行 ${w.id} · admin.operation_rejected`,
          reason,
        });
        logAudit({ actor: CURRENT_USER_NAME, action: `取消执行 ${w.id} · admin.operation_rejected`, target: w.id, reason });
        toast(`${w.id} 已取消 · 原因留痕`);
      },
    });
  };

  /* ────────────────── 审计日志:导出(仍需操作确认 · 强制留痕) ────────────────── */
  const exportAudit = () =>
    openConfirm({
      action: "导出审计日志",
      detail: (
        <>
          导出范围:当前筛选条件命中的记录;隐私字段脱敏。导出本身也会留一条审计(谁、何时、导了什么范围)。
          可导角色:只读审计(全量)/ 财务·风控(本域)。
        </>
      ),
      chips: [
        ["脱敏导出 · 仍需操作确认", "done"],
        ["导出动作留审计", "ready"],
      ],
      okLabel: "导出",
      run: (reason) => {
        logAudit({
          actor: "总管理员",
          action: `审计日志导出(脱敏 CSV · 范围 ${dFlt === "all" ? "全部域" : `域 ${dFlt}`}) · admin.audit_exported`,
          target: "A2-audit",
          reason,
        });
        toast("导出任务已建 · 动作已留痕");
      },
    });

  /* ────────────────── 机制参数:理由最短长度 / 保留期 / schema 调整 ────────────────── */
  const adjReasonMin = () => {
    const cur = (pget("A.confirm.reasonMin") as string | undefined) ?? "8 字";
    openActionConfirm({
      action: "操作理由最短长度",
      detail: (
        <>
          当前 <b>{cur}</b> · 范围 8–200 字。所有操作确认弹窗提交前校验,不满足时确认按钮保持 disabled。
          这个参数只约束新提交的理由,历史审计按原文保留。
        </>
      ),
      amplifies: false,
      edit: { kind: "text", current: cur, unit: "字" },
      run: (reason, v) => {
        const val = (v || "").trim();
        if (!val) {
          toast("拒绝:理由最短长度不能为空");
          return;
        }
        setParam("A.confirm.reasonMin", val, {
          action: `操作理由最短长度调整 · admin.reason_min_changed`,
          reason,
        });
        toast(`理由最短长度已更新为 ${val}`);
      },
    });
  };

  const adjRet = () => {
    const cur = (pget("A.appr.ret") as string | undefined) ?? "13 个月";
    openActionConfirm({
      action: "审计日志保留期",
      detail: (
        <>
          当前 <b>{cur}</b> · 范围 13–36 个月(下限写死,要覆盖完整 12 月运营周期 + 1 月缓冲)。
          改动只对新日志生效,不回溯清理旧账。
        </>
      ),
      amplifies: false,
      edit: { kind: "text", current: cur, unit: "月" },
      run: (reason, v) => {
        const val = (v || "").trim();
        if (!val) {
          toast("拒绝:保留期不能为空");
          return;
        }
        setParam("A.appr.ret", val, {
          action: `审计日志保留期调整 · admin.audit_retention_changed`,
          reason,
        });
        toast(`日志保留期已更新为 ${val}`);
      },
    });
  };

  const adjSchema = () => {
    const cur = `schema ${(pget("A.appr.schemaVer") as string | undefined) ?? "v3"}`;
    openActionConfirm({
      action: "审计/事件字段结构变更",
      detail: (
        <>
          新增事件名或属性须先在事件中台(A4)注册:超管执行操作确认后落库生效。
          全后台共用一套字段结构,各域不许私加字段——口径分裂了取证就对不上。
        </>
      ),
      amplifies: false,
      edit: { kind: "text", current: cur, unit: "" },
      run: (reason, v) => {
        const val = (v || "").trim();
        if (!val) {
          toast("拒绝:schema 版本不能为空");
          return;
        }
        setParam("A.appr.schemaVer", val, {
          action: `schema 变更 ${val} · admin.audit_schema_registered`,
          reason,
        });
        toast(`schema 变更已提交注册确认`);
      },
    });
  };

  /* ────────────────── 工单过滤 + 排序(fund 置顶 · stable) ────────────────── */
  const filteredQ = useMemo(() => {
    const arr = OPERATION_QUEUE.filter((w) => {
      const tOk = qType === "all" || w.type === qType || (qType === "sos" && w.sos);
      const mOk = qOperator === "all" || w.operator.includes(qOperator);
      return tOk && mOk;
    });
    // fund 置顶 stable:用 indexOf 锚定原序,fund 排前
    return arr
      .map((w, i) => ({ w, i }))
      .sort((a, b) => {
        const af = a.w.type === "fund" ? 0 : 1;
        const bf = b.w.type === "fund" ? 0 : 1;
        if (af !== bf) return af - bf;
        return a.i - b.i;
      })
      .map((x) => x.w);
  }, [qType, qOperator]);

  const qTotal = filteredQ.length;
  const qPages = Math.max(1, Math.ceil(qTotal / qPerPage));
  const qSafePage = Math.min(qPage, qPages - 1);
  const qStart = qSafePage * qPerPage;
  const qEnd = Math.min(qStart + qPerPage, qTotal);
  const qRows = filteredQ.slice(qStart, qEnd);

  /* ────────────────── 审计日志过滤 ────────────────── */
  const logRows = useMemo(
    () => AUDIT_LOGS.filter((l) => dFlt === "all" || l.domain === dFlt),
    [dFlt],
  );

  /* ────────────────── 渲染 ────────────────── */

  return (
    <>
      {/* ───── 4 f-stat ───── */}
      <div className="f-stats">
        <div className="f-stat warn">
          <div className="k">高敏动作</div>
          <div className="v">{A2_STATS.pendingTickets} 件</div>
          <div className="sub">资金类 {A2_STATS.fundTickets} 件置顶 · 理由必填留痕</div>
        </div>
        <div className="f-stat danger">
          <div className="k">应急快速轨</div>
          <div className="v">{A2_STATS.sosTickets} 件</div>
          <div className="sub">J 域熔断恢复 · SLA <span className="mono">{fmtHMS(sosSec)}</span></div>
        </div>
        <div className="f-stat">
          <div className="k">今日审计事件</div>
          <div className="v">{A2_STATS.todayAuditEvents.toLocaleString()} 条</div>
          <div className="sub">全部 admin.* 动作统一落这里</div>
        </div>
        <div className="f-stat cyan">
          <div className="k">本周执行 / 取消</div>
          <div className="v">{A2_STATS.weeklyApproved} / {A2_STATS.weeklyRejected}</div>
          <div className="sub">另有 {A2_STATS.weeklyExpired} 件校验拦截 · {A2_STATS.weeklyWithdrawn} 件主动取消</div>
        </div>
      </div>

      {/* ───── (b) 高敏操作动态 ───── */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">高敏操作动态(b)· pending</span>
          <span className="sub">· 大额/资金类置顶 · 点击执行会打开独立操作确认弹窗,理由必填后立即生效</span>
          <div className="r chips">
            <span className="lb">筛</span>
            {TYPE_CHIPS.map((c) => (
              <button
                key={c.key}
                className={`chip${qType === c.key ? " sel" : ""}`}
                onClick={() => { setQType(c.key); setQPage(0); }}
              >{c.label}</button>
            ))}
            <span className="lb" style={{ marginLeft: 10 }}>发起人</span>
            {OPERATOR_CHIPS.map((c) => (
              <button
                key={c.key}
                className={`chip${qOperator === c.key ? " sel" : ""}`}
                onClick={() => { setQOperator(c.key); setQPage(0); }}
              >{c.label}</button>
            ))}
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 1020 }}>
            <thead>
              <tr>
                <th>编号</th><th>动作</th><th>对象</th><th>提案值</th>
                <th>发起人</th><th>标记</th><th>记录时间</th>
                <th style={{ textAlign: "right" }}></th>
              </tr>
            </thead>
            <tbody>
              {qRows.map((w) => {
                const idx = OPERATION_QUEUE.indexOf(w);
                const status = effStatus(w);
                const isFinal = status !== "pending";
                return (
                  <tr key={w.id} className="click" onClick={() => setWoIdx(idx)}>
                    <td className="mono" style={{ fontWeight: 600, color: "var(--ink)" }}>{w.id}</td>
                    <td style={{ fontSize: 12.5 }}>{w.action}</td>
                    <td style={{ fontSize: 12, color: "var(--ink-3)" }}>{w.obj}</td>
                    <td>
                      <span className="a2-ba">
                        <span className="o">{w.before}</span> → <span className="n">{w.after}</span>
                      </span>
                    </td>
                    <td style={{ fontSize: 12 }}>{w.operator}</td>
                    <td>
                      {w.amplifies && <span className="a2-amp">🔥 放大流出</span>}
                      {w.amplifies && w.sos ? " " : null}
                      {w.sos && <span className="a2-sos">⚡ 应急轨</span>}
                      {!w.amplifies && !w.sos && <span style={{ color: "var(--ink-4)" }}>—</span>}
                    </td>
                    <td>
                      <span className="a2-ttl">
                        {w.ts} · 留痕
                      </span>
                    </td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      {isFinal ? (
                        <span className={`bdg ${HIST_TONE[status] ?? "dim"}`}>{HIST_LABEL[status] ?? status}</span>
                      ) : (
                        <>
                          <button
                            className="l-btn sm mc"
                            onClick={(e) => { e.stopPropagation(); approveWo(w); }}
                          >执行</button>{" "}
                          <button
                            className="l-btn sm"
                            onClick={(e) => { e.stopPropagation(); rejectWo(w); }}
                          >取消</button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {/* 分页器 */}
        <div className="l-b" style={{ paddingTop: 6, paddingBottom: 0 }}>
          <div className="pager">
            <span className="pager-info">
              {qTotal === 0 ? "无记录" : `显示 ${qStart + 1}–${qEnd} / ${qTotal}`}
            </span>
            <button
              className="pager-btn"
              disabled={qSafePage === 0}
              onClick={() => setQPage(qSafePage - 1)}
            >‹</button>
            <span className="pager-num">{qSafePage + 1} / {qPages}</span>
            <button
              className="pager-btn"
              disabled={qSafePage >= qPages - 1}
              onClick={() => setQPage(qSafePage + 1)}
            >›</button>
            <select
              className="pager-size"
              value={qPerPage}
              onChange={(e) => { setQPerPage(Number(e.target.value)); setQPage(0); }}
            >
              <option value={10}>每页 10</option>
              <option value={20}>每页 20</option>
              <option value={50}>每页 50</option>
            </select>
          </div>
        </div>
        <div className="l-b" style={{ paddingTop: 10 }}>
          <div className="atint warn">
            <b>放大资金流出的动作</b>(带 🔥)执行前弹窗里直接给出当前备付金覆盖率和红线对比——
            覆盖率不够时服务器拒绝提交;确认时仍要看当前值有没有恶化。
          </div>
        </div>
      </section>

      {/* ───── (a) 审计日志 + (c) 确认历史 + 机制参数 ───── */}
      <div className="two-col">
        {/* (a) 审计日志 · 只追加 */}
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">审计日志(a)· 只追加</span>
            <span className="sub">· 按域/操作者/动作/时间筛 · 点行看全字段</span>
            <div className="r">
              <button className="l-btn sm" onClick={exportAudit}>导出(脱敏)</button>
            </div>
          </div>
          <div className="l-b" style={{ padding: "10px 20px 0" }}>
            <div className="chips" style={{ marginBottom: 4 }}>
              <span className="lb">域</span>
              {DOMAIN_CHIPS.map((c) => (
                <button
                  key={c.key}
                  className={`chip${dFlt === c.key ? " sel" : ""}`}
                  onClick={() => setDFlt(c.key)}
                >{c.label}</button>
              ))}
            </div>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="l-tbl" style={{ minWidth: 560 }}>
              <thead>
                <tr>
                  <th>时间</th><th>操作者</th><th>动作</th><th>对象</th><th>前 → 后</th>
                </tr>
              </thead>
              <tbody>
                {logRows.map((l) => {
                  const i = AUDIT_LOGS.indexOf(l);
                  return (
                    <tr key={`${l.ts}-${l.action}-${i}`} className="click" onClick={() => setLogIdx(i)}>
                      <td className="mono" style={{ fontSize: 11, whiteSpace: "nowrap" }}>{l.ts}</td>
                      <td style={{ fontSize: 11.5 }}>{l.actor} · {l.role}</td>
                      <td className="mono" style={{ fontSize: 11 }}>{l.action}</td>
                      <td style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{l.obj}</td>
                      <td className="mono" style={{ fontSize: 11 }}>{l.delta}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="l-b" style={{ paddingTop: 8 }}>
            <div className="atint">
              可见性按角色自动裁剪:客服仅看自己操作过或当前服务的用户;财务看资金域、风控看风控域;
              只读审计可全量查询并脱敏导出。日志只能看不能改、不能删。
            </div>
          </div>
        </section>

        {/* (c) 执行历史 + 机制参数 */}
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">执行历史(c)与机制参数</span>
            <span className="sub">· 任一高敏动作的完整操作链可追溯</span>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="l-tbl" style={{ minWidth: 520 }}>
              <thead>
                <tr>
                  <th>编号</th><th>动作</th><th>终态</th><th>操作 / 留痕</th><th>决策时间</th>
                </tr>
              </thead>
              <tbody>
                {OPERATION_HISTORY.map((h, i) => (
                  <tr key={h.id} className="click" onClick={() => setHistIdx(i)}>
                    <td className="mono">{h.id}</td>
                    <td style={{ fontSize: 12 }}>{h.action}</td>
                    <td>
                      <span className={`bdg ${HIST_TONE[h.st] ?? "dim"}`}>{HIST_LABEL[h.st] ?? h.st}</span>
                    </td>
                    <td style={{ fontSize: 11.5 }}>{h.chain}</td>
                    <td className="mono" style={{ fontSize: 11.5 }}>{h.t}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="l-b" style={{ paddingTop: 8 }}>
            {MECHANISM_PARAMS.map((p) => {
              if (p.key === "reason_required") {
                return (
                  <div className="a-vrow" key={p.key}>
                    <span className="nm">{p.name}<small>{p.sub}</small></span>
                    <span className="acode lock" title="§1.8 原则二.4 铁律">🔒 强制</span>
                  </div>
                );
              }
              if (p.key === "ttl") {
                const live = (pget("A.confirm.reasonMin") as string | undefined) ?? p.value;
                return (
                  <div className="a-vrow" key={p.key}>
                    <span className="nm">{p.name}<small>{p.sub}</small></span>
                    <span className="v">{live}</span>
                    <button className="l-btn sm mc" onClick={adjReasonMin}>调整</button>
                  </div>
                );
              }
              if (p.key === "retention") {
                const live = (pget("A.appr.ret") as string | undefined) ?? p.value;
                return (
                  <div className="a-vrow" key={p.key}>
                    <span className="nm">{p.name}<small>{p.sub}</small></span>
                    <span className="v">{live}</span>
                    <button className="l-btn sm mc" onClick={adjRet}>调整</button>
                  </div>
                );
              }
              if (p.key === "confirm_list") {
                return (
                  <div className="a-vrow" key={p.key}>
                    <span className="nm">{p.name}<small>{p.sub}</small></span>
                    <span className="v">{p.value}</span>
                    <button className="l-btn sm" onClick={() => setActionConfirmListOpen(true)}>看清单</button>
                  </div>
                );
              }
              // schema
              const liveSchema = `统一 schema · ${(pget("A.appr.schemaVer") as string | undefined) ?? "v3"}`;
              return (
                <div className="a-vrow" key={p.key}>
                  <span className="nm">{p.name}<small>{p.sub}</small></span>
                  <span className="v">{liveSchema}</span>
                  <button className="l-btn sm mc" onClick={adjSchema}>变更(注册)</button>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      {/* ───── f-foot ───── */}
      <p className="f-foot">
        <b>分工一句话</b>:这页管「记录谁做了什么 + 操作确认的流程」;「谁能做什么」的授权矩阵在账号页(A1);
        事件叫什么名、带什么字段归事件中台(A4)定义,这页负责落库与可查。
        <b> 执行门槛</b>:资金类 = 财务(lead)/超管;风控与账户类 = 风控(lead)/超管;
        内容类 = 内容(lead)/超管;账号治理与系统参数 = 仅超管。
        应急轨动作(J 域熔断/恢复)按 SLA 倒计时置顶,超时升级告警到超管。
      </p>
      <PaginationExemptionList
        items={[
          {
            label: "审计日志(a)· 只追加",
            kind: "sample-ledger",
            maxRows: 8,
            reason: "本页展示最近审计样本,完整审计查询和导出归 L5 导出审计台",
          },
          {
            label: "执行历史(c)与机制参数",
            maxRows: 4,
            reason: "执行历史仅展示最近四条终态样本,点行进入完整链路说明",
          },
        ]}
      />

      {/* ───── 高敏动作详情 Drawer ───── */}
      {woIdx !== null && (() => {
        const w = OPERATION_QUEUE[woIdx];
        const status = effStatus(w);
        const isFinal = status !== "pending";
        return (
          <Drawer
            title={`高敏动作 · ${w.id}`}
            sub={
              <>
                {w.action} · 对象 {w.obj} · 发起人 {w.operator} · 提案 {w.before} → {w.after}
              </>
            }
            onClose={() => setWoIdx(null)}
            footer={
              !isFinal ? (
                <div style={{ display: "flex", gap: 8, padding: "12px 16px", borderTop: "1px solid var(--border)" }}>
                  <button
                    className="l-btn mc"
                    style={{ flex: 1, justifyContent: "center" }}
                    onClick={() => { setWoIdx(null); approveWo(w); }}
                  >执行</button>
                  <button
                    className="l-btn"
                    style={{ flex: 1, justifyContent: "center" }}
                    onClick={() => { setWoIdx(null); rejectWo(w); }}
                  >取消</button>
                </div>
              ) : null
            }
          >
            <div className="l-b" style={{ padding: "4px 0 0" }}>
              <div className="kv"><span className="k">操作理由</span><span className="v" style={{ maxWidth: 360, textAlign: "right" }}>{w.reason}</span></div>
              <div className="kv"><span className="k">记录时间</span><span className="v">{w.ts}{w.sos ? "(应急 SLA)" : "(理由必填留痕)"}</span></div>
              <div className="kv"><span className="k">执行门槛</span><span className="v">{w.roleGate}</span></div>
              <div className="kv"><span className="k">防重</span><span className="v">执行携 Idempotency-Key · 24h dedup · 重复提交不重复生效</span></div>
              <div className="kv"><span className="k">原子性</span><span className="v" style={{ maxWidth: 320, textAlign: "right" }}>确认执行 = 一次事务写目标域;失败则动作保持 pending,目标域零副作用</span></div>
            </div>
            <div className="atint" style={{ marginTop: 14 }}>
              {w.amplifies ? (
                <>
                  <b>🔥 放大资金流出</b>:提交时备付金覆盖率已过线;放行弹窗会再显示当前覆盖率,
                  恶化到红线下请驳回并注明。
                </>
              ) : (
                <>非资金放大类:按动作说明核对前后值与原因即可。</>
              )}
            </div>
            {isFinal && (
              <div className="atint" style={{ marginTop: 8 }}>
                动作终态:<span className={`bdg ${HIST_TONE[status] ?? "dim"}`}>{HIST_LABEL[status] ?? status}</span> · 已留痕,无法再次裁决。
              </div>
            )}
          </Drawer>
        );
      })()}

      {/* ───── 审计记录 Drawer ───── */}
      {logIdx !== null && (() => {
        const l = AUDIT_LOGS[logIdx];
        const needIdem = l.action.includes("withdraw") || l.action.includes("balance") || l.action.includes("operation_confirmed");
        return (
          <Drawer
            title={`审计记录 · ${l.action}`}
            sub={<>{l.obj} · {l.delta}</>}
            onClose={() => setLogIdx(null)}
          >
            <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginBottom: 10 }}>
              统一字段结构;只追加,不可改不可删——取证链不可抵赖。
            </div>
            <div className="l-b" style={{ padding: 0 }}>
              <div className="kv"><span className="k">操作者 / 角色</span><span className="v">{l.actor} · {l.role}</span></div>
              <div className="kv"><span className="k">时间(毫秒级)</span><span className="v mono">{l.ts} · ts 1781234567890</span></div>
              <div className="kv"><span className="k">对象</span><span className="v">{l.obj}</span></div>
              <div className="kv"><span className="k">前值 → 后值</span><span className="v mono">{l.delta}</span></div>
              <div className="kv"><span className="k">原因</span><span className="v">(发起时必填,原样留存)</span></div>
              <div className="kv"><span className="k">IP</span><span className="v mono">{l.ip}</span></div>
              <div className="kv"><span className="k">操作 / 留痕</span><span className="v">{l.actor} / 对应 lead 或超管</span></div>
              <div className="kv"><span className="k">防重号</span><span className="v mono">{needIdem ? "idem-… (资金类必带)" : "—(非资金类)"}</span></div>
            </div>
            <div className="atint" style={{ marginTop: 14 }}>
              隐私字段(手机号/地址)在事件里只存哈希或 ID,导出时再脱敏一层。
            </div>
          </Drawer>
        );
      })()}

      {/* ───── 操作链 Drawer ───── */}
      {histIdx !== null && (() => {
        const h = OPERATION_HISTORY[histIdx];
        return (
          <Drawer
            title={`操作链 · ${h.id}`}
            sub={
              <>
                {h.action} · 终态 <span className={`bdg ${HIST_TONE[h.st] ?? "dim"}`} style={{ marginLeft: 4 }}>{HIST_LABEL[h.st] ?? h.st}</span>
                {" · "}{h.chain} · {h.t}
              </>
            }
            onClose={() => setHistIdx(null)}
          >
            <div className="atint" style={{ marginBottom: 10 }}>
              {h.note}
            </div>
            <div className="atint cyan">
              任何高敏动作的完整操作链(提案→决策→落库)都能这样追溯;这是内部问责的取证地基。
            </div>
          </Drawer>
        );
      })()}

      {/* ───── 9 大类操作确认清单 Drawer ───── */}
      {mcListOpen && (
        <Drawer
          title="操作确认适用动作清单(9 大类汇总)"
          sub="下列动作一律进确认门,理由必填"
          onClose={() => setActionConfirmListOpen(false)}
        >
          <div style={{ overflowX: "auto" }}>
            <table className="l-tbl">
              <thead>
                <tr>
                  <th>类别</th><th>例子</th><th>执行门槛</th>
                </tr>
              </thead>
              <tbody>
                {CONFIRM_CATEGORIES.map((c) => (
                  <tr key={c.cat}>
                    <td style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink-2)" }}>{c.cat}</td>
                    <td style={{ fontSize: 12 }}>{c.examples}</td>
                    <td style={{ fontSize: 12 }}>{c.roleGate}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="atint" style={{ marginTop: 14 }}>
            分界线:是否放大资金流出 / 变更权限边界 / 触及用户资产或合规态。
            强制登出、标记、只读、风控自动检测这类即时止血动作不进门(即时生效 + 留痕)。
          </div>
        </Drawer>
      )}
    </>
  );
}

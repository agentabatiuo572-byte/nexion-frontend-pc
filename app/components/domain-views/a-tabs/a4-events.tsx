"use client";

/**
 * A4 埋点事件中台 — design_handoff_a_domain/A4 设计稿 port(296 行 + SPEC §4 KPI 算式 + §2.4.6 口径权威)。
 *
 * 全后台「数据地基」:驾驶舱、资金对账、风控信号、BI 看板、八项 KPI,每个数字都从这条事件流派生。
 * 这页定义事件叫什么名、带什么字段、归哪个域;谁产谁消一目了然。
 *
 * A 域三铁律(A4 实装,server-canonical 镜像):
 *  ① 资金/KPI 只认 is_server_authoritative=true — family 表「服务器权威」列展示「全部」/「部分」;
 *     COMMON_FIELDS「is_server_authoritative」行强调「资金/状态事件 = true(服务器发);界面交互 = false」;
 *     服务器在状态机推进的那一刻 emit,端上伪造不出来,界面事件丢/重不影响资金账。
 *  ② PII 禁入 — schema 注册校验「无隐私明文」(手机号/地址明文一律 hash 或 ID);
 *     多处文案强调,registry 拒绝注册含 PII 的事件名/属性。
 *  ③ 不放大资金流出 — A4 全部动作 amplifies=false(数据中台不直接动账)。
 *
 * 真写键(A.*):
 *  A.event.kpi.day0(Day0 接入窗口)· A.event.kpi.retention(留存口径,locked)·
 *  A.event.kpi.event_retention(事件留存期)· A.event.kpi.sampling(采样率)·
 *  A.event.schemaVer(schema registry 版本)· A.batch.new.<slug>.status(扩展工单登记)。
 *
 * 操作确认 显式 edit 契约(2026-06 跨域硬化):
 *  - 调参传 edit:{kind:"text",current,unit};
 *  - schema 注册 / 登记扩展工单同样传 edit(text);
 *  - retention locked 不出按钮(server 同步锁 §2.4.9)。
 *
 * 设计稿元素省略:f-bar/f-nav/f-title/f-desc/f-cta 已由 DomainHeader 承担,本组件从 .f-stats 开始。
 */
import { useState } from "react";
import Link from "next/link";
import { Drawer, PaginationExemptionList } from "../design-kit";
import {
  A4_STATS,
  EVENT_FAMILIES,
  REGISTERED_DOMAINS,
  PENDING_DOMAINS,
  COMMON_FIELDS,
  KPI_DIMENSION_PARAMS,
  KPI_FORMULAS,
  DOMAIN_EXTENSIONS,
  type EventFamily,
  type Batch,
} from "./data";
import type { ACtx } from "./types";

/* ────────────────── helpers ────────────────── */

const BATCH_STATE: Record<Batch["state"], { tone: "ok" | "warn" | "dim"; label: string }> = {
  done: { tone: "ok", label: "已落地" },
  inprogress: { tone: "warn", label: "进行中" },
  pending: { tone: "warn", label: "待注册" },
  scheduled: { tone: "dim", label: "排期中" },
};

/* ────────────────── 组件 ────────────────── */

export function A4Events({ ctx }: { ctx: ACtx }) {
  const { pget, setParam, toast, openActionConfirm } = ctx;

  /* drawers */
  const [famIdx, setFamIdx] = useState<number | null>(null);
  const [batchIdx, setBatchIdx] = useState<number | null>(null);

  /* 实时态(pget 覆盖种子) */
  const liveSchemaVer = (pget("A.event.schemaVer") as string | undefined) ?? A4_STATS.schemaVersion;
  const liveDay0 = (pget("A.event.kpi.day0") as string | undefined) ?? "90 秒";
  const liveEventRetention = (pget("A.event.kpi.event_retention") as string | undefined) ?? "13 个月";
  const liveSampling = (pget("A.event.kpi.sampling") as string | undefined) ?? "浏览 10% · 资金 100%";

  /* 完成进度 = done + inprogress(BI 上线前必办:已落地 + 进行中算「已动起来」) */
  const batchDone = DOMAIN_EXTENSIONS.filter((b) => b.state === "done" || b.state === "inprogress").length;
  const batchTotal = DOMAIN_EXTENSIONS.length;

  /* ────────────────── 口径参数调整 ────────────────── */

  const adjDay0 = () => {
    const cur = liveDay0;
    openActionConfirm({
      action: "口径参数 · Day0 接入窗口",
      detail: (
        <>
          当前 <b>{cur}</b>。改了 KPI #1 口径就变,历史不重算。口径参数动一下,所有派生看板的算式跟着变,
          所以超管执行门槛:超管,改动广播给消费方(B3 / L 域)。
        </>
      ),
      amplifies: false,
      edit: { kind: "text", current: cur, unit: "" },
      run: (reason, v) => {
        const val = (v || "").trim();
        if (!val) { toast("拒绝:Day0 接入窗口不能为空"); return; }
        setParam("A.event.kpi.day0", val, {
          action: `Day0 接入窗口 → ${val} · admin.event_dimension_changed`,
          reason,
        });
        toast(`Day0 已更新为 ${val}`);
      },
    });
  };

  const adjEventRetention = () => {
    const cur = liveEventRetention;
    openActionConfirm({
      action: "口径参数 · 事件留存期",
      detail: (
        <>
          当前 <b>{cur}</b>。<b>只对新事件生效,不回溯清理旧账</b>;下限要覆盖完整 12 月运营周期 + 1 月缓冲。
          口径参数动一下,所有派生看板的算式跟着变,所以超管执行门槛:超管,改动广播给消费方(B3 / L 域)。
        </>
      ),
      amplifies: false,
      edit: { kind: "text", current: cur, unit: "" },
      run: (reason, v) => {
        const val = (v || "").trim();
        if (!val) { toast("拒绝:留存期不能为空"); return; }
        setParam("A.event.kpi.event_retention", val, {
          action: `事件留存期 → ${val} · admin.event_dimension_changed`,
          reason,
        });
        toast(`事件留存期已更新为 ${val}`);
      },
    });
  };

  const adjSampling = () => {
    const cur = liveSampling;
    openActionConfirm({
      action: "口径参数 · 采样率",
      detail: (
        <>
          当前 <b>{cur}</b>。<b>资金/风控/转化类 100% 不在可调范围</b>,只能调浏览/会话类抽样档省成本。
          口径参数动一下,所有派生看板的算式跟着变,所以超管执行门槛:超管,改动广播给消费方(B3 / L 域)。
        </>
      ),
      amplifies: false,
      edit: { kind: "text", current: cur, unit: "" },
      run: (reason, v) => {
        const val = (v || "").trim();
        if (!val) { toast("拒绝:采样率不能为空"); return; }
        setParam("A.event.kpi.sampling", val, {
          action: `采样率 → ${val} · admin.event_dimension_changed`,
          reason,
        });
        toast(`采样率已更新为 ${val}`);
      },
    });
  };

  /* ────────────────── schema registry 注册 ────────────────── */

  const registerSchema = () => {
    const cur = `schema ${liveSchemaVer}`;
    openActionConfirm({
      action: "注册新事件 / 属性(schema registry)",
      detail: (
        <>
          当前 <b>schema {liveSchemaVer}</b>。新事件名(<span className="acode">域.对象_动作</span>,过去式)或新属性<b>先注册后使用</b>;
          注册校验:命名规范 ✓ 不与现有事件重复 ✓ <b>无隐私明文(手机号/地址)</b> ✓。
          超管执行门槛:超管;registry 版本 +1 并广播。
        </>
      ),
      amplifies: false,
      edit: { kind: "text", current: cur, unit: "" },
      run: (reason, v) => {
        const val = (v || "").trim();
        if (!val) { toast("拒绝:schema 版本不能为空"); return; }
        setParam("A.event.schemaVer", val, {
          action: `schema 注册 ${val} · admin.event_schema_registered`,
          reason,
        });
        toast(`schema 已更新为 ${val} · 理由留痕`);
      },
    });
  };

  /* ────────────────── 登记 domain 扩展工单 ────────────────── */

  const registerBatch = () => {
    openActionConfirm({
      action: "登记 domain 扩展工单",
      detail: (
        <>
          提出域写清楚:要加的 domain 名 / 事件名(过去式) / 谁产谁消;落地前相关事件按 admin 占位 + 临时编号入库。
          <br />超管执行门槛:超管;注册完成后归档。
        </>
      ),
      amplifies: false,
      edit: { kind: "text", current: "", unit: "domain / 事件名" },
      run: (reason, v) => {
        const val = (v || "").trim();
        if (!val) { toast("拒绝:domain / 事件名不能为空"); return; }
        const slug = val.replace(/[^a-z0-9]/gi, "_").slice(0, 30) || `batch_${Date.now()}`;
        setParam(`A.batch.new.${slug}.status`, "registered", {
          action: `登记扩展工单 ${val} · admin.domain_extension_registered`,
          reason,
        });
        toast(`扩展工单 ${val} 已提交注册确认`);
      },
    });
  };

  /* ────────────────── 渲染 ────────────────── */

  return (
    <>
      {/* ───── 4 f-stat ───── */}
      <div className="f-stats">
        <div className="f-stat">
          <div className="k">今日事件量</div>
          <div className="v">{A4_STATS.todayEvents}</div>
          <div className="sub">资金/风控/转化类 100% 全量采</div>
        </div>
        <div className="f-stat cyan">
          <div className="k">注册 domain</div>
          <div className="v">{A4_STATS.registeredDomains} + {A4_STATS.pendingDomains}</div>
          <div className="sub">V1 枚举 {A4_STATS.registeredDomains} · 扩展批次新增 {A4_STATS.pendingDomains}</div>
        </div>
        <div className="f-stat warn">
          <div className="k">扩展工单(BI 上线前必办)</div>
          <div className="v">{batchDone} / {batchTotal} 批</div>
          <div className="sub">V3 批已落 · 内容批进行中</div>
        </div>
        <div className="f-stat">
          <div className="k">schema registry</div>
          <div className="v">{liveSchemaVer}</div>
          <div className="sub">变更走超管操作确认注册</div>
        </div>
      </div>

      {/* ───── 事件目录 · 6 family × domain 注册表 ───── */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">事件目录 · 6 个 family × domain 注册表</span>
          <span className="sub">· 命名一律「域.对象_动作(过去式)」,事件 = 已发生的事实 · 点 family 看事件清单</span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 920 }}>
            <thead>
              <tr>
                <th>family</th><th>口径作用</th><th>代表事件</th><th>服务器权威</th>
                <th className="num">今日量</th><th style={{ textAlign: "right" }}></th>
              </tr>
            </thead>
            <tbody>
              {EVENT_FAMILIES.map((f, i) => (
                <tr key={f.key} className="click" onClick={() => setFamIdx(i)}>
                  <td style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink)", whiteSpace: "nowrap" }}>{f.title}</td>
                  <td style={{ fontSize: 12, color: "var(--ink-3)" }}>{f.sub}</td>
                  <td className="mono" style={{ fontSize: 11, color: "var(--ink-4)" }}>{f.sample}</td>
                  <td style={{ fontSize: 11.5 }}>
                    {f.serverAuth.includes("全部")
                      ? f.serverAuth.split("全部").map((part, idx, arr) => (
                          <span key={idx}>{part}{idx < arr.length - 1 ? <b>全部</b> : null}</span>
                        ))
                      : f.serverAuth}
                  </td>
                  <td className="num mono">{f.todayCount}</td>
                  <td style={{ textAlign: "right" }}>
                    <button
                      className="l-btn sm"
                      onClick={(e) => { e.stopPropagation(); setFamIdx(i); }}
                    >事件清单</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="l-b" style={{ paddingTop: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
            domain 枚举(V1 现行 {A4_STATS.registeredDomains} 个 + 扩展批次 {A4_STATS.pendingDomains} 个)
          </div>
          <div style={{ marginBottom: 8 }}>
            {REGISTERED_DOMAINS.map((d) => (
              <span className="a4-dom" key={d}>{d}</span>
            ))}
            {PENDING_DOMAINS.map((d) => (
              <span className="a4-dom new" key={d} title="扩展批次新增">{d} +</span>
            ))}
          </div>
          <div className="atint cyan">
            <b>身份怎么串起来</b> · 注册前用设备匿名 ID 打点(落地页就开始),注册完成事件同时带旧匿名 ID 和新用户 ID,
            服务器做拼接——注册前的漏斗行为和渠道归因都能落到这个人头上。三件套:匿名 ID(注册前)/ 用户 ID(服务器权威)/ 会话 ID(单次会话)。
          </div>
        </div>
      </section>

      {/* ───── 通用字段 + 口径参数 · 八项 KPI(two-col) ───── */}
      <div className="two-col">
        {/* 通用字段 + 口径参数 */}
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">每个事件必带的字段 + 口径参数</span>
            <span className="sub">· 字段固定;参数调整走操作确认</span>
          </div>
          <div className="l-b" style={{ paddingTop: 4 }}>
            <div style={{ fontSize: 12, fontWeight: 600, margin: "2px 0 4px" }}>通用字段(10 项,固定)</div>
            {COMMON_FIELDS.map((c) => {
              const isPii = c.key === "is_server_authoritative";
              return (
                <div className="a-vrow" key={c.key}>
                  <span className="nm">
                    {c.key === "misc" ? c.name : <span className="mono">{c.name}</span>}
                    <small>{c.sub}</small>
                  </span>
                  <span className="v">{isPii ? c.value : c.value}</span>
                </div>
              );
            })}
            <div style={{ fontSize: 12, fontWeight: 600, margin: "10px 0 4px" }}>口径参数(锚定 12 月运营周期)</div>
            {KPI_DIMENSION_PARAMS.map((p) => {
              if (p.locked) {
                return (
                  <div className="a-vrow" key={p.key}>
                    <span className="nm">{p.name}<small>{p.sub}</small></span>
                    <span className="v">{p.value}</span>
                    <span className="acode lock" title="§2.4.9 · 对齐 KPI #2">🔒</span>
                  </div>
                );
              }
              const live = p.key === "day0" ? liveDay0
                : p.key === "event_retention" ? liveEventRetention
                : p.key === "sampling" ? liveSampling
                : p.value;
              const onAdj = p.key === "day0" ? adjDay0
                : p.key === "event_retention" ? adjEventRetention
                : adjSampling;
              return (
                <div className="a-vrow" key={p.key}>
                  <span className="nm">{p.name}<small>{p.sub}</small></span>
                  <span className="v">{live}</span>
                  <button className="l-btn sm mc" onClick={onAdj}>调整</button>
                </div>
              );
            })}
          </div>
        </section>

        {/* 八项 KPI → 事件口径 */}
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">八项 KPI → 事件口径</span>
            <span className="sub">· 每个看板数字都能倒查到事件和算式</span>
            <div className="r">
              <Link className="l-btn sm" href="/analytics/kpi">KPI 看板(L1)→</Link>
            </div>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="l-tbl" style={{ minWidth: 520 }}>
              <thead>
                <tr><th>#</th><th>KPI</th><th>事件算式(大白话)</th></tr>
              </thead>
              <tbody>
                {KPI_FORMULAS.map((k) => (
                  <tr key={k.n}>
                    <td className="mono">{k.n}</td>
                    <td style={{ fontSize: 12 }}>{k.kpi}</td>
                    <td style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{k.formula}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="l-b" style={{ paddingTop: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>主漏斗(喂驾驶舱 B3 / 下钻在 L2)</div>
            <div className="a4-pipe">
              <span className="st hot">注册</span><span className="ar">→</span>
              <span className="st">绑卡验证</span><span className="ar">→</span>
              <span className="st">首购</span><span className="ar">→</span>
              <span className="st">复投</span><span className="ar">→</span>
              <span className="st">提现</span>
            </div>
            <div style={{ fontSize: 11.5, color: "var(--ink-4)", marginTop: 4 }}>
              逐级转化 = 下级去重人数 ÷ 上级;支持按注册周 / 阶段 / 渠道三维切片。
            </div>
          </div>
        </section>
      </div>

      {/* ───── 管道与治理 ───── */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">管道与治理</span>
          <span className="sub">· 事件从产生到看板的全链路 · schema 注册归这页管</span>
          <div className="r">
            <button className="l-btn sm mc" onClick={registerSchema}>注册新事件 / 属性</button>
          </div>
        </div>
        <div className="l-b" style={{ paddingTop: 6 }}>
          <div className="a4-pipe" style={{ marginBottom: 10 }}>
            <span className="st">
              产生
              <small>资金/状态:服务器发 · 界面交互:端上 SDK 发</small>
            </span>
            <span className="ar">→</span>
            <span className="st">
              去重
              <small>按 event_id</small>
            </span>
            <span className="ar">→</span>
            <span className="st hot">
              事件库
              <small>13 个月</small>
            </span>
            <span className="ar">→</span>
            <span className="st">实时漏斗(B3)</span>
            <span className="ar">+</span>
            <span className="st">BI(L 域)</span>
            <span className="ar">+</span>
            <span className="st">风控(K)/ 对账(D)</span>
          </div>
          <div className="two-col" style={{ marginBottom: 0 }}>
            <div className="atint cyan">
              <b>防篡改</b> · 资金和 KPI 口径只统计「服务器权威 = true」的事件——
              服务器在状态机推进的那一刻发,端上伪造不出来;界面交互事件丢了重了都不影响资金账。
            </div>
            <div className="atint">
              <b>schema 注册</b> · 新事件名、新属性必须先在这里注册(超管执行门槛:超管)才能开始发;
              隐私明文(手机号/地址)进不了 schema。各域页面的「⑧ 埋点」段引用这里,不许私立命名。
            </div>
          </div>
        </div>
      </section>

      {/* ───── domain 扩展批次看板 ───── */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">domain 扩展批次看板 · BI 上线前必办</span>
          <span className="sub">· 扩展落地前,新类事件暂记 admin 名下占位 + 临时编号,落地后迁回各自 domain</span>
          <div className="r">
            <button className="l-btn sm mc" onClick={registerBatch}>登记扩展工单</button>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 920 }}>
            <thead>
              <tr>
                <th>批次</th><th>新增 domain / 事件</th><th>提出方</th>
                <th>状态</th><th>占位影响</th><th style={{ textAlign: "right" }}></th>
              </tr>
            </thead>
            <tbody>
              {DOMAIN_EXTENSIONS.map((b, i) => {
                const st = BATCH_STATE[b.state];
                const impactColor = b.state === "inprogress" ? "var(--warning)" : "var(--ink-4)";
                return (
                  <tr key={b.id} className="click" onClick={() => setBatchIdx(i)}>
                    <td className="mono" style={{ fontWeight: 600, color: "var(--ink)" }}>{b.title}</td>
                    <td>
                      {b.newDomains.length > 0 ? (
                        b.newDomains.map((d) => (
                          <span className={`a4-dom${d.n ? " new" : ""}`} key={d.name}>{d.name}</span>
                        ))
                      ) : (
                        <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
                          全后台 admin.* 事件清单 ↔ registry 逐条对账
                        </span>
                      )}
                    </td>
                    <td style={{ fontSize: 12 }}>{b.proposer}</td>
                    <td><span className={`bdg ${st.tone}`}>{st.label}</span></td>
                    <td style={{ fontSize: 11.5, color: impactColor }}>{b.impact}</td>
                    <td style={{ textAlign: "right" }}>
                      <button
                        className="l-btn sm"
                        onClick={(e) => { e.stopPropagation(); setBatchIdx(i); }}
                      >明细</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="l-b" style={{ paddingTop: 10 }}>
          <div className="atint warn">
            <b>为什么是「必办」</b> · BI(L 域)切换到正式口径前,这四批必须清零——
            否则内容/通知/披露/课程的事件还挂在 admin 名下的临时编号上,BI 一上线口径就带着占位债跑,
            以后迁移要重算历史。占位期间口径权威不受影响(算式不变,只是归类临时)。
          </div>
        </div>
      </section>

      {/* ───── f-foot ───── */}
      <p className="f-foot">
        <b>分工一句话</b>:这页定义「事件叫什么、带什么、归哪类」;审计中心(A2)负责 admin 类事件落库、理由留痕与高敏动态;
        消费方是驾驶舱(B1–B5)、资金对账(D)、风控(K)、BI(L)和节奏归因(H1)。
        <b> 动作分线</b>:schema 注册 / 变更 = 仅超管可执行;口径参数(窗口/留存/采样)= 超管操作确认;
        扩展工单登记 = 提出域提交,这页注册并由超管执行。
      </p>
      <PaginationExemptionList
        items={[
          {
            label: "事件目录 · 6 个 family × domain 注册表",
            kind: "reference-catalog",
            maxRows: 6,
            reason: "事件 family 固定六类,点行抽屉查看明细,不做无限事件查询",
          },
          {
            label: "八项 KPI → 事件口径",
            kind: "reference-catalog",
            maxRows: 8,
            reason: "八项 KPI 是固定验收口径目录,需要同屏对比算式",
          },
          {
            label: "domain 扩展批次看板 · BI 上线前必办",
            maxRows: 4,
            reason: "扩展批次固定四批,登记新工单后进入 schema 确认流",
          },
        ]}
      />

      {/* ───── family 事件清单 Drawer ───── */}
      {famIdx !== null && (() => {
        const f: EventFamily = EVENT_FAMILIES[famIdx];
        return (
          <Drawer
            title={`family ${f.title} · 事件清单`}
            sub={f.sub}
            onClose={() => setFamIdx(null)}
          >
            <div className="atint" style={{ marginBottom: 12 }}>
              命名规范:<span className="acode">域.对象_动作</span>(过去式);隐私明文禁入。
              服务器权威:<b>{f.serverAuth}</b>。
            </div>
            <table className="l-tbl">
              <thead>
                <tr><th>事件</th><th>说明</th></tr>
              </thead>
              <tbody>
                {f.events.map(([name, desc]) => (
                  <tr key={name}>
                    <td className="mono" style={{ fontSize: 11.5, color: "var(--ink-2)" }}>{name}</td>
                    <td style={{ fontSize: 12 }}>{desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="atint" style={{ marginTop: 14 }}>
              新增事件须先注册(超管操作确认)再开始发;各域页面「事件去向」段引用这里。
            </div>
          </Drawer>
        );
      })()}

      {/* ───── 扩展批次明细 Drawer ───── */}
      {batchIdx !== null && (() => {
        const b: Batch = DOMAIN_EXTENSIONS[batchIdx];
        const st = BATCH_STATE[b.state];
        return (
          <Drawer
            title={`扩展批次 · ${b.title}(${st.label})`}
            sub={<>{st.label} · {b.impact}</>}
            onClose={() => setBatchIdx(null)}
          >
            <div className="atint" style={{ marginBottom: 12 }}>
              <b>{st.label}</b> · {b.impact}
            </div>
            <table className="l-tbl">
              <thead>
                <tr><th>事件 / 项</th><th>说明</th></tr>
              </thead>
              <tbody>
                {b.details.map(([item, desc]) => (
                  <tr key={item}>
                    <td className="mono" style={{ fontSize: 11.5, color: "var(--ink-2)" }}>{item}</td>
                    <td style={{ fontSize: 12 }}>{desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="atint" style={{ marginTop: 14 }}>
              扩展登记走 schema 注册同一条确认路(超管操作确认);迁移时历史占位事件批量改归属、口径不重算。
            </div>
          </Drawer>
        );
      })()}
    </>
  );
}

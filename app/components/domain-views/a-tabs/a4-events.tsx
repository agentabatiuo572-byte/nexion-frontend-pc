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
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Drawer } from "../design-kit";
import {
  createA4IdempotencyKey,
  fetchA4Overview,
  registerA4DomainExtension,
  registerA4Schema,
  updateA4DimensionParam,
  type A4DomainExtensionBatch,
  type A4EventFamily,
  type A4Overview,
} from "@/lib/admin/a4-client";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { displayAdminError } from "@/lib/admin/error-messages";
import type { ACtx } from "./types";

/* ────────────────── helpers ────────────────── */

const BATCH_STATE: Record<A4DomainExtensionBatch["state"], { tone: "ok" | "warn" | "dim"; label: string }> = {
  done: { tone: "ok", label: "已落地" },
  inprogress: { tone: "warn", label: "进行中" },
  pending: { tone: "warn", label: "待注册" },
  scheduled: { tone: "dim", label: "排期中" },
  registered: { tone: "warn", label: "已登记" },
};

const PAST_ACTION = /(?:ed|sent|paid|held|bound|dau)$/;
const eventNameValid = (value: string) => /^[a-z][a-z0-9_]*\.[a-z0-9]+(?:_[a-z0-9]+)*$/.test(value) && PAST_ACTION.test(value);

/* ────────────────── 组件 ────────────────── */

export function A4Events({ ctx }: { ctx: ACtx }) {
  const { toast, openActionConfirm } = ctx;
  const canWrite = useAdminAuth((state) => state.session?.authorities.includes("platform_a4_write") ?? false);
  const [overview, setOverview] = useState<A4Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mutating, setMutating] = useState<string | null>(null);

  const refreshOverview = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setLoadError(null);
    try {
      setOverview(await fetchA4Overview());
    } catch (error) {
      setLoadError(displayAdminError(error));
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshOverview();
  }, [refreshOverview]);

  /* drawers */
  const [famIdx, setFamIdx] = useState<number | null>(null);
  const [batchIdx, setBatchIdx] = useState<number | null>(null);
  // 扩展工单登记:多字段抽屉(不再一个文本框塞「domain / 事件名」整串)
  const [naBatch, setNaBatch] = useState(false);
  const [batchForm, setBatchForm] = useState({ domain: "", event: "", producer: "", consumer: "" });

  /* 后端实时态 */
  const A4_STATS = overview?.stats ?? { todayEvents: "0", todayAuditEvents: 0, registeredDomains: 0, pendingDomains: 0, batchDone: 0, batchTotal: 0, schemaVersion: "—" };
  const EVENT_FAMILIES = overview?.eventFamilies ?? [];
  const REGISTERED_DOMAINS = overview?.registeredDomains ?? [];
  const PENDING_DOMAINS = overview?.pendingDomains ?? [];
  const COMMON_FIELDS = overview?.commonFields ?? [];
  const KPI_DIMENSION_PARAMS = overview?.dimensionParams ?? [];
  const KPI_FORMULAS = overview?.kpiFormulas ?? [];
  const DOMAIN_EXTENSIONS = overview?.domainExtensions ?? [];
  const SCHEMA_REGISTRATIONS = overview?.schemaRegistrations ?? [];
  const SCHEMA_OWNER_DOMAINS = Array.from(new Set([
    ...REGISTERED_DOMAINS,
    ...DOMAIN_EXTENSIONS
      .filter((extension) => extension.state === "inprogress" || extension.state === "registered")
      .flatMap((extension) => extension.newDomains.filter((domain) => domain.n).map((domain) => domain.name)),
  ]));
  const paramValue = (key: string, fallback = "") => KPI_DIMENSION_PARAMS.find((param) => param.key === key)?.value ?? fallback;
  const liveSchemaVer = A4_STATS.schemaVersion;
  const liveDay0 = paramValue("day0");
  const liveEventRetention = paramValue("event_retention");
  const liveSampling = paramValue("sampling");
  const batchDomainValid = /^[a-z][a-z0-9_]{1,31}$/.test(batchForm.domain.trim());
  const batchEventValid = /^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(batchForm.event.trim()) && PAST_ACTION.test(batchForm.event.trim());
  const batchFormValid = batchDomainValid && batchEventValid && !!batchForm.producer.trim() && !!batchForm.consumer.trim();

  /* 完成进度只认 done；inprogress 仍属于上线前未清零项。 */
  const batchDone = A4_STATS.batchDone || DOMAIN_EXTENSIONS.filter((b) => b.state === "done").length;
  const batchTotal = A4_STATS.batchTotal || DOMAIN_EXTENSIONS.length;

  const updateParam = (key: string, value: string, reason: string, success: string, stableIdempotencyKey: string) => {
    if (!canWrite) { toast("当前账号只有 A4 读取权限，不能修改事件治理数据"); return; }
    setMutating(`param-${key}`);
    return updateA4DimensionParam(key, value, reason, stableIdempotencyKey)
      .then((next) => {
        setOverview(next);
        toast(success);
      })
      .catch((error: unknown) => {
        toast(`提交失败:${displayAdminError(error)}`);
        throw error;
      })
      .finally(() => setMutating(null));
  };

  /* ────────────────── 口径参数调整 ────────────────── */

  const adjDay0 = () => {
    if (!canWrite) { toast("当前账号只有 A4 读取权限，不能调整口径"); return; }
    const cur = liveDay0;
    const stableKey = createA4IdempotencyKey("a4-param-day0");
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
        if (!/^\d{1,4}\s*(?:秒|s|sec|seconds?)?$/i.test(val)) { toast("A4_DAY0_VALUE_INVALID:请输入 30–600 秒"); return; }
        const seconds = Number.parseInt(val, 10);
        if (seconds < 30 || seconds > 600) { toast("A4_DAY0_VALUE_INVALID:请输入 30–600 秒"); return; }
        return updateParam("day0", val, reason, `Day0 已更新为 ${seconds} 秒`, stableKey);
      },
    });
  };

  const adjEventRetention = () => {
    if (!canWrite) { toast("当前账号只有 A4 读取权限，不能调整口径"); return; }
    const cur = liveEventRetention;
    const stableKey = createA4IdempotencyKey("a4-param-retention");
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
        if (!/^\d{1,3}\s*(?:个月|月|months?)?$/i.test(val)) { toast("A4_EVENT_RETENTION_INVALID:请输入 13–60 个月"); return; }
        const months = Number.parseInt(val, 10);
        if (months < 13 || months > 60) { toast("A4_EVENT_RETENTION_INVALID:请输入 13–60 个月"); return; }
        return updateParam("event_retention", val, reason, `事件留存期已更新为 ${months} 个月`, stableKey);
      },
    });
  };

  const adjSampling = () => {
    if (!canWrite) { toast("当前账号只有 A4 读取权限，不能调整口径"); return; }
    const cur = liveSampling;
    const stableKey = createA4IdempotencyKey("a4-param-sampling");
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
        const compact = val.replace(/\s+/g, "");
        const protectedSamplingInvalid = ["资金", "风控", "转化"].some((name) => {
          const match = new RegExp(`${name}[^0-9]*(\\d{1,3})%?`).exec(compact);
          return !!match && Number.parseInt(match[1], 10) !== 100;
        });
        if (protectedSamplingInvalid) {
          toast("A4_PROTECTED_EVENT_SAMPLING_INVALID:资金、风控、转化必须保持 100%"); return;
        }
        const percent = Number.parseInt(val.match(/\d{1,3}/)?.[0] || "", 10);
        if (!Number.isFinite(percent) || percent < 1 || percent > 100) { toast("A4_PROTECTED_EVENT_SAMPLING_INVALID:请输入浏览/会话 1–100%"); return; }
        return updateParam("sampling", String(percent), reason, `浏览/会话采样率已更新为 ${percent}%`, stableKey);
      },
    });
  };

  /* ────────────────── schema registry 注册 ────────────────── */

  const registerSchema = () => {
    if (!canWrite) { toast("当前账号只有 A4 读取权限，不能注册事件"); return; }
    const stableKey = createA4IdempotencyKey("a4-schema");
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
      businessForm: {
        kind: "schema-authoring",
        ownerDomains: SCHEMA_OWNER_DOMAINS,
        propertyTypes: ["string", "number", "boolean", "enum", "timestamp", "id", "json"],
        samplingPolicies: ["100%(资金/风控/转化)", "浏览 10%", "会话 25%"],
        versionHint: liveSchemaVer,
      },
      run: (reason, _v, bv) => {
        const ev = (bv?.eventName || "").trim();
        if (!ev) { toast("拒绝:事件名不能为空"); return; }
        if (!eventNameValid(ev)) { toast("拒绝:事件名必须是 domain.object_action，且动作为已发生事实"); return; }
        if (bv?.isPII === "true") { toast("拒绝:含 PII 明文的事件禁止注册(A 域三铁律 ② · server 422)"); return; }
        const ver = (bv?.version || "").trim() || liveSchemaVer;
        setMutating("schema");
        return registerA4Schema({
          eventName: ev,
          ownerDomain: (bv?.ownerDomain || "").trim(),
          producer: (bv?.producer || "").trim(),
          consumer: (bv?.consumer || "").trim(),
          propertyName: (bv?.propName || "").trim(),
          propertyType: (bv?.propType || "").trim(),
          pii: bv?.isPII === "true",
          isServerAuthoritative: bv?.isServerAuthoritative === "true",
          samplingPolicy: (bv?.samplingPolicy || "").trim(),
          expectedVersion: ver,
          reason,
        }, stableKey)
          .then((next) => {
            setOverview(next);
            toast(`事件 ${ev} schema 已提交注册(${ver} · ${bv?.producer})· 后端留痕`);
          })
          .catch((error: unknown) => {
            toast(`提交失败:${displayAdminError(error)}`);
            throw error;
          })
          .finally(() => setMutating(null));
      },
    });
  };

  /* ────────────────── 登记 domain 扩展工单 ────────────────── */

  const registerBatch = () => {
    if (!canWrite) { toast("当前账号只有 A4 读取权限，不能登记扩展工单"); return; }
    setBatchForm({ domain: "", event: "", producer: "", consumer: "" });
    setNaBatch(true);
  };

  /* ────────────────── 渲染 ────────────────── */

  if (loadError && !overview) {
    return (
      <section className="l-card">
        <div className="l-b">
          <div className="atint warn">
            A4 数据校验失败，页面已停止展示和写入：{loadError}
            <button className="l-btn sm" style={{ marginLeft: 8 }} onClick={() => void refreshOverview()}>重新读取</button>
          </div>
        </div>
      </section>
    );
  }
  if (loading && !overview) {
    return <section className="l-card"><div className="l-b"><div className="atint">正在核对 A4 事件事实源与 Schema Registry…</div></div></section>;
  }

  return (
    <>
      {loadError && overview && (
        <section className="l-card">
          <div className="l-b">
            <div className="atint warn" style={{ fontSize: 12 }}>
              A4 接口读取失败:{loadError}
              <button className="l-btn sm" style={{ marginLeft: 8 }} onClick={() => void refreshOverview()}>重试</button>
            </div>
          </div>
        </section>
      )}
      {loading && !overview && (
        <section className="l-card">
          <div className="l-b">
            <div className="atint" style={{ fontSize: 12 }}>正在读取 /api/admin/platform/events/overview。</div>
          </div>
        </section>
      )}
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
            {!COMMON_FIELDS.length && (
              <div className="atint warn" style={{ fontSize: 12 }}>后端暂无通用字段记录</div>
            )}
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
                  <button className="l-btn sm mc" title={canWrite ? undefined : "当前账号只有读取权限"} disabled={!canWrite || !overview || !!loadError || !!mutating} onClick={onAdj}>调整</button>
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
            <button className="l-btn sm mc" title={canWrite ? undefined : "当前账号只有读取权限"} disabled={!canWrite || !overview || !!loadError || !!mutating} onClick={registerSchema}>注册新事件 / 属性</button>
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
              <small>{liveEventRetention || "0"}</small>
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
          <div style={{ fontSize: 12, fontWeight: 600, margin: "12px 0 5px" }}>真实 Schema Registry（最近 {SCHEMA_REGISTRATIONS.length} 条）</div>
          <div style={{ overflowX: "auto" }}>
            <table className="l-tbl" style={{ minWidth: 920 }}>
              <thead><tr><th>事件</th><th>归属 / family</th><th>产 → 消</th><th>属性</th><th>权威 / 采样</th><th>版本</th></tr></thead>
              <tbody>
                {SCHEMA_REGISTRATIONS.map((schema) => (
                  <tr key={schema.eventName}>
                    <td className="mono">{schema.eventName}</td>
                    <td>{schema.ownerDomain} / {schema.familyKey}</td>
                    <td>{schema.producer} → {schema.consumers || "未指定"}</td>
                    <td className="mono">{schema.properties}</td>
                    <td>{schema.serverAuthoritative ? "服务器权威" : "客户端事件"} · {schema.samplingPolicy}</td>
                    <td className="mono">{schema.version}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ───── domain 扩展批次看板 ───── */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">domain 扩展批次看板 · BI 上线前必办</span>
          <span className="sub">· 扩展落地前,新类事件先进入待归属登记清单,落地后迁回各自 domain</span>
          <div className="r">
            <button className="l-btn sm mc" title={canWrite ? undefined : "当前账号只有读取权限"} disabled={!canWrite || !overview || !!loadError || !!mutating} onClick={registerBatch}>登记扩展工单</button>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 920 }}>
            <thead>
              <tr>
                <th>批次</th><th>新增 domain / 事件</th><th>提出方</th>
                <th>状态</th><th>归属影响</th><th style={{ textAlign: "right" }}></th>
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
            否则内容/通知/披露/课程的事件仍停留在待归属登记清单,BI 一上线口径就带着归属债跑,
            以后迁移要重算历史。待归属期间口径权威不受影响(算式不变,只是归类待迁移)。
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
      {/* ───── family 事件清单 Drawer ───── */}
      {famIdx !== null && (() => {
              const f: A4EventFamily = EVENT_FAMILIES[famIdx];
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
                {f.events.map((event) => (
                  <tr key={event.item}>
                    <td className="mono" style={{ fontSize: 11.5, color: "var(--ink-2)" }}>{event.item}</td>
                    <td style={{ fontSize: 12 }}>{event.desc}</td>
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
        const b: A4DomainExtensionBatch = DOMAIN_EXTENSIONS[batchIdx];
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
                {b.details.map((detail) => (
                  <tr key={detail.item}>
                    <td className="mono" style={{ fontSize: 11.5, color: "var(--ink-2)" }}>{detail.item}</td>
                    <td style={{ fontSize: 12 }}>{detail.desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="atint" style={{ marginTop: 14 }}>
              扩展登记走 schema 注册同一条确认路(超管操作确认);迁移时历史待归属事件批量改归属、口径不重算。
            </div>
          </Drawer>
        );
      })()}

      {/* ───── 登记 domain 扩展工单 · 多字段抽屉(domain / 事件名 / 产消方 各一格,不再一个框塞)───── */}
      {naBatch && (
        <Drawer
          title="登记 domain 扩展工单"
          sub="① domain 名 → ② 事件名(过去式) → ③ 生产方 → ④ 消费方 · 提交走超管操作确认"
          onClose={() => setNaBatch(false)}
          footer={
            <div style={{ display: "flex", gap: 8, padding: "12px 16px", borderTop: "1px solid var(--border)" }}>
              <button className="l-btn" style={{ flex: 1, justifyContent: "center" }} onClick={() => setNaBatch(false)}>取消</button>
              <button
                className="l-btn primary"
                style={{ flex: 2, justifyContent: "center", opacity: batchFormValid ? 1 : 0.5 }}
                disabled={!canWrite || !batchFormValid}
                onClick={() => {
                  const domain = batchForm.domain.trim(), event = batchForm.event.trim();
                  const producer = batchForm.producer.trim(), consumer = batchForm.consumer.trim();
                  if (!canWrite) { toast("当前账号只有 A4 读取权限，不能登记扩展工单"); return; }
                  if (!batchFormValid) { toast("拒绝:请填写合法 domain、过去式事件名、生产方和消费方"); return; }
                  const stableKey = createA4IdempotencyKey("a4-domain-extension");
                  setNaBatch(false);
                  openActionConfirm({
                    action: `登记 domain 扩展工单 · ${domain}`,
                    detail: (<><b>{domain}</b> · 事件 <span className="acode">{event}</span> · 生产 {producer || "—"} → 消费 {consumer || "—"}。落地前进入待归属登记清单;超管执行,注册完成后归档。</>),
                    amplifies: false,
                    run: (reason) => {
                      setMutating("domain-extension");
                      return registerA4DomainExtension({
                        domainName: domain,
                        eventName: `${domain}.${event}`,
                        producer,
                        consumer,
                        reason,
                      }, stableKey)
                        .then(() => refreshOverview(true))
                        .then(() => toast(`扩展工单 ${domain} / ${event} 已提交注册确认`))
                        .catch((error: unknown) => {
                          toast(`提交失败:${displayAdminError(error)}`);
                          throw error;
                        })
                        .finally(() => setMutating(null));
                    },
                  });
                }}
              >提交登记</button>
            </div>
          }
        >
          {(() => {
            const fst = { width: "100%", marginTop: 4, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border-strong)", background: "var(--surface)", color: "var(--ink)", fontFamily: "var(--mono)", fontSize: 13 };
            return (
              <div style={{ display: "grid", gap: 12 }}>
                <label style={{ fontSize: 12, color: "var(--ink-3)" }}>domain 名 *
                  <input value={batchForm.domain} onChange={(e) => setBatchForm({ ...batchForm, domain: e.target.value })} placeholder="如 referral" style={fst} />
                </label>
                <label style={{ fontSize: 12, color: "var(--ink-3)" }}>事件名(过去式)*
                  <input value={batchForm.event} onChange={(e) => setBatchForm({ ...batchForm, event: e.target.value })} placeholder="如 referral_bound" style={fst} />
                </label>
                <label style={{ fontSize: 12, color: "var(--ink-3)" }}>生产方(谁 emit)
                  <input value={batchForm.producer} onChange={(e) => setBatchForm({ ...batchForm, producer: e.target.value })} placeholder="如 F 域结算服务" style={fst} />
                </label>
                <label style={{ fontSize: 12, color: "var(--ink-3)" }}>消费方(谁用)
                  <input value={batchForm.consumer} onChange={(e) => setBatchForm({ ...batchForm, consumer: e.target.value })} placeholder="如 B3 漏斗 / L2 留存" style={fst} />
                </label>
                <div className="atint">提交后走超管操作确认(填理由);注册为待归属记录,落地后迁回各自 domain。</div>
              </div>
            );
          })()}
        </Drawer>
      )}
    </>
  );
}

"use client";
const redriveStatusText = (value: string) => ({PENDING:"待发送",CLAIMED:"处理中",PROCESSING:"处理中",SENT:"已发送",DELIVERED:"已送达",DEAD:"已终止",FAILED:"失败待重试",RETRY_REQUESTED:"已请求重试"} as Record<string,string>)[value] ?? "状态待核实";
import { operatorCopyText } from "@/lib/admin/operator-copy";

import { A4OutboxDiagnostics } from "./a4-outbox-diagnostics";

/**
 * A4 埋点事件中台 — design_handoff_a_domain/A4 设计稿 port(296 行 + SPEC §4 KPI 算式 + §2.4.6 口径权威)。
 *
 * 全后台「数据地基」:驾驶舱、资金对账、风控信号、BI 看板、八项 KPI,每个数字都从这条事件流派生。
 * 这页定义事件叫什么名、带什么字段、归哪个域;谁产谁消一目了然。
 *
 * A 域三铁律(A4 实装,server-canonical 镜像):
 *  ① 资金/KPI 只认 is_server_authoritative=true — family 表「服务器权威」列展示「全部」/「部分」;
 *     COMMON_FIELDS「is_server_authoritative」行强调「资金/状态事件 = true(服务器发);界面交互 = false」;
 *     服务器在处理流程推进的那一刻 emit,端上伪造不出来,界面事件丢/重不影响资金账。
 *  ② PII 禁入 — schema 注册校验「无隐私明文」(手机号/地址明文一律 hash 或 ID);
 *     多处文案强调,registry 拒绝注册含 PII 的事件名/属性。
 *  ③ 不放大资金流出 — A4 全部动作 amplifies=false(数据中台不直接动账)。
 *
 * 真写键(A.*):
 *  A.event.kpi.day0(Day0 接入窗口)· A.event.kpi.retention(留存口径,locked)·
 *  A.event.kpi.event_retention(事件留存期)· A.event.kpi.sampling(采样率)·
 *  A.event.schemaVer(事件字段登记表 版本)· A.batch.new.<slug>.status(扩展工单登记)。
 *
 * 操作确认 显式 edit 契约(2026-06 跨域硬化):
 *  - 调参传 edit:{kind:"text",current,unit};
 *  - schema 注册 / 登记扩展工单同样传 edit(text);
 *  - retention locked 不出按钮(server 同步锁 §2.4.9)。
 *
 * 设计稿元素省略:f-bar/f-nav/f-title/f-desc/f-cta 已由 DomainHeader 承担,本组件从 .f-stats 开始。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Drawer } from "../design-kit";
import {
  addA4SchemaProperty,
  createA4IdempotencyKey,
  fetchA4RetentionLatest,
  fetchA4SchemaRegistration,
  fetchA4Overview,
  fetchH3DeadOutboxRedrivePreview,
  redriveAuditedH3DeadOutboxEvent,
  registerA4DomainExtension,
  registerA4Schema,
  runA4RetentionNow,
  transitionA4Lifecycle,
  updateA4DimensionParam,
  type A4DomainExtensionBatch,
  type A4EventFamily,
  type A4H3DeadOutboxRedrivePreview,
  type A4H3DeadOutboxRedriveResult,
  type A4Overview,
  type A4RetentionExecution,
} from "@/lib/admin/a4-client";
import { runH3DeadOutboxRedriveCommand, type A4H3DeadOutboxRedriveCommand } from "@/lib/admin/a4-redrive-command";

import { fetchA2ReasonPolicy } from "@/lib/admin/a2-client";
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

// This is an audited recovery entry, not an event search or a general outbox
// console. It permits one ID at a time and never accepts mutable payload.
const H3_DEAD_REDRIVABLE_EVENT_TYPES = [
  "H3_STOREFRONT_THREE_PRODUCTS_VIEWED",
  "H3_GENESIS_SECONDARY_MARKET_VIEWED",
  "H3_COMPUTE_COMPLETED_50",
  "H3_REFERRAL_REGISTERED",
  "H3_EXCHANGE_COMPLETED",
] as const;

/* ────────────────── 组件 ────────────────── */

const lifecycleText = (value: string) => ({ new: "新建", pending_publish: "待发布", gray: "分批开放", full: "全面开放", disabled: "已停用" } as Record<string,string>)[value] ?? "未知状态";

export function A4Events({ ctx }: { ctx: ACtx }) {
  const canReadOutbox = useAdminAuth((state) => state.session?.authorities.includes("platform_a4_read") ?? false);
  const { toast, openActionConfirm } = ctx;
  const canWrite = useAdminAuth((state) => state.session?.authorities.includes("platform_a4_write") ?? false);
  const canRead = useAdminAuth((state) => state.session?.authorities.includes("platform_a4_read") ?? false) || canWrite;
  const canA2Write = useAdminAuth((state) => state.session?.authorities.includes("platform_a2_write") ?? false);
  const canRunRetention = canWrite && canA2Write;
  const canRedriveH3Dead = canWrite && canA2Write;
  const [overview, setOverview] = useState<A4Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mutating, setMutating] = useState<string | null>(null);
  const [retentionRun, setRetentionRun] = useState<A4RetentionExecution | null>(null);
  const [retentionRunError, setRetentionRunError] = useState<string | null>(null);
  const [a2ReasonMin, setA2ReasonMin] = useState(8);
  const [redriveEventId, setRedriveEventId] = useState("");
  const [redrivePreview, setRedrivePreview] = useState<A4H3DeadOutboxRedrivePreview | null>(null);
  const [redriveResult, setRedriveResult] = useState<A4H3DeadOutboxRedriveResult | null>(null);
  const [redrivePreviewing, setRedrivePreviewing] = useState(false);
  const [redrivePreviewError, setRedrivePreviewError] = useState<string | null>(null);
  const [redriveCommand, setRedriveCommand] = useState<A4H3DeadOutboxRedriveCommand | null>(null);
  const redriveCommandRef = useRef<A4H3DeadOutboxRedriveCommand | null>(null);
  const redrivePreviewSequence = useRef(0);
  const [schemaLookupEventName, setSchemaLookupEventName] = useState("");
  const [schemaLookup, setSchemaLookup] = useState<A4Overview["schemaRegistrations"][number] | null>(null);
  const [schemaLookupLoading, setSchemaLookupLoading] = useState(false);
  const [schemaLookupError, setSchemaLookupError] = useState<string | null>(null);
  const schemaLookupSequence = useRef(0);
  const schemaLookupEventNameRef = useRef("");

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

  const refreshRetentionRun = useCallback(async () => {
    try {
      setRetentionRunError(null);
      setRetentionRun(await fetchA4RetentionLatest());
    } catch (error) {
      setRetentionRun(null);
      setRetentionRunError(displayAdminError(error));
    }
  }, []);

  useEffect(() => {
    void refreshRetentionRun();
  }, [refreshRetentionRun]);

  useEffect(() => {
    void fetchA2ReasonPolicy().then((policy) => setA2ReasonMin(policy.minChars)).catch(() => undefined);
  }, []);

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
/**
 * 扩展批次行操作的目标名。
 *
 * 缺陷 100:同一张表里每行的操作按钮都只写「明细」,读屏与键盘用户无法分辨这一行到底指向
 * 哪个批次/事件。目标名取「批次标题 + 首个新增 domain/事件」,两者都缺时退回行序号 --
 * 绝不产出空标签(空 aria-label 等于没有可访问名称)。
 *
 * 缺陷 202:动态批次(登记扩展工单)的标题是常量、domain 又可能相同,只取 domain 仍会
 * 让多行**同名**。把首个明细项(事件名)一并带上 —— 它才是同一 domain 下区分不同工单的字段。
 */
const batchActionTarget = (batch: { title?: string; newDomains?: Array<{ name: string }>; details?: Array<{ item?: string }> }, index?: number) => {
  const title = (batch.title ?? "").trim();
  const first = (batch.newDomains ?? []).map((domain) => (domain?.name ?? "").trim()).find(Boolean) ?? "";
  const event = (batch.details ?? []).map((detail) => (detail?.item ?? "").trim()).find(Boolean) ?? "";
  const label = [title, first, event].filter(Boolean).join(" / ");
  return label || `第 ${(index ?? 0) + 1} 行`;
};

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
    if (!canWrite) { toast("当前账号只有 A4 读取权限，不能调整统计规则"); return; }
    const cur = liveDay0;
    const stableKey = createA4IdempotencyKey("a4-param-day0");
    openActionConfirm({
      action: "统计参数 · 首笔收益到账时限",
      detail: (
        <>
          当前 <b>{cur}</b>。改了 关键指标 #1 统计规则就变,历史不重算。统计参数动一下,所有派生看板的算式跟着变,
          所以超级管理员执行门槛:超级管理员,改动广播给使用方(B3 / L 域)。
        </>
      ),
      amplifies: false,
      edit: { kind: "text", current: cur, unit: "" },
      run: (reason, v) => {
        const val = (v || "").trim();
        if (!/^\d{1,4}\s*(?:秒|s|sec|seconds?)?$/i.test(val)) { toast("A4_DAY0_VALUE_INVALID:请输入 30–600 秒"); return; }
        const seconds = Number.parseInt(val, 10);
        if (seconds < 30 || seconds > 600) { toast("A4_DAY0_VALUE_INVALID:请输入 30–600 秒"); return; }
        return updateParam("day0", val, reason, `首笔收益到账时限已更新为 ${seconds} 秒`, stableKey);
      },
    });
  };

  const adjEventRetention = () => {
    if (!canWrite) { toast("当前账号只有 A4 读取权限，不能调整统计规则"); return; }
    const cur = liveEventRetention;
    const stableKey = createA4IdempotencyKey("a4-param-retention");
    openActionConfirm({
      action: "统计参数 · 事件留存期",
      detail: (
        <>
          当前 <b>{cur}</b>。<b>只对新事件生效,不回溯清理旧账</b>;下限要覆盖完整 12 月运营周期 + 1 月缓冲。
          统计参数动一下,所有派生看板的算式跟着变,所以超级管理员执行门槛:超级管理员,改动广播给使用方(B3 / L 域)。
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
    if (!canWrite) { toast("当前账号只有 A4 读取权限，不能调整统计规则"); return; }
    const cur = liveSampling;
    const stableKey = createA4IdempotencyKey("a4-param-sampling");
    openActionConfirm({
      action: "统计参数 · 采样率",
      detail: (
        <>
          当前 <b>{cur}</b>。<b>资金/风控/转化类 100% 不在可调范围</b>,只能调浏览/会话类抽样档省成本。
          统计参数动一下,所有派生看板的算式跟着变,所以超级管理员执行门槛:超级管理员,改动广播给使用方(B3 / L 域)。
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
        if (!Number.isFinite(percent) || percent < 0 || percent > 100) { toast("A4_SAMPLING_VALUE_INVALID:请输入浏览/会话 0–100%"); return; }
        return updateParam("sampling", String(percent), reason, `浏览/会话采样率已更新为 ${percent}%`, stableKey);
      },
    });
  };

  /* ────────────────── 事件字段登记表 注册 ────────────────── */

  const registerSchema = () => {
    if (!canWrite) { toast("当前账号只有 A4 读取权限，不能注册事件"); return; }
    const stableKey = createA4IdempotencyKey("a4-schema");
    openActionConfirm({
      action: "登记新事件或字段",
      detail: (
        <>
          当前 <b>事件目录版本 {liveSchemaVer}</b>。新事件名(<span className="acode">域.对象_动作</span>,过去式)或新属性<b>先注册后使用</b>;
          注册校验:命名规范 ✓ 不与现有事件重复 ✓ <b>无隐私明文(手机号/地址)</b>  ✓。
          超级管理员执行门槛:超级管理员;登记版本 +1 并广播。
        </>
      ),
      amplifies: false,
      businessForm: {
        kind: "schema-authoring",
        ownerDomains: SCHEMA_OWNER_DOMAINS,
        propertyTypes: ["string", "number", "boolean", "enum", "timestamp", "id", "json"],
        samplingPolicies: ["100%(资金/风控/转化)", "浏览 0%", "浏览 10%", "会话 25%"],
        versionHint: liveSchemaVer,
      },
      run: (reason, _v, bv) => {
        const ev = (bv?.eventName || "").trim();
        if (!ev) { toast("拒绝:事件名不能为空"); return; }
        if (!eventNameValid(ev)) { toast("拒绝:事件名必须是 domain.object_action，且动作为已发生事实"); return; }
        if (bv?.isPII === "true") { toast("无法登记：事件不能包含手机号、地址等个人隐私明文"); return; }
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
            toast(`事件 ${ev} 字段定义 已提交注册(${ver} · ${bv?.producer})· 后端留痕`);
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

  const openSchemaPropertyExtension = (schema: A4Overview["schemaRegistrations"][number]) => {
    if (!canWrite) { toast("当前账号只有 A4 读取权限，不能扩展既有 字段定义 属性"); return; }
    // Both values are frozen before the confirm drawer opens. A later lookup/input
    // response or overview refresh must not redirect this write to another schema.
    const schemaSnapshot = { ...schema };
    // A successful mutation returns a fresh overview, but a separately fetched
    // exact preview can otherwise keep showing the old row version/properties.
    // Keep both the input target and lookup generation so a completion can only
    // reconcile the preview it was opened from; it must never overwrite a later lookup.
    const lookupTargetAtOpen = schemaLookupEventNameRef.current.trim();
    const lookupSequenceAtOpen = schemaLookupSequence.current;
    // Property writes advance the global registry revision, whereas schema.version is this event's own revision.
    // Freeze the registry value from the overview that the operator reviewed so the server can reject a stale command.
    const registryVersion = overview?.stats.schemaVersion ?? "";
    if (!/^v[1-9][0-9]*$/.test(registryVersion)) {
      toast("当前全局 字段定义 注册表版本不可用，请刷新后重试");
      return;
    }
    const stableKey = createA4IdempotencyKey(`a4-schema-property-${schemaSnapshot.eventName}`);
    openActionConfirm({
      action: `扩展既有 字段定义 属性 · ${schemaSnapshot.eventName}`,
      detail: <>
        事件登记版本 <b>{schemaSnapshot.version}</b>  · 全局注册表 修改版本 <b>{registryVersion}</b> · 生产 <span className="acode">{schemaSnapshot.producer}</span> ·
        消费 <span className="acode">{schemaSnapshot.consumers || "未指定"}</span> · 现有属性 <span className="acode">{schemaSnapshot.properties}</span>。
        此入口只增加一个属性和类型；归属、发送方、使用方、采样和权威标记由服务端保留，不可在此覆盖。提交时以全局注册表版本校验，不以事件登记版本替代。
      </>,
      amplifies: false,
      reasonMin: a2ReasonMin,
      reasonMax: 200,
      businessForm: {
        kind: "multi-field",
        title: `新增属性 · ${schemaSnapshot.eventName}`,
        hint: "填写新字段名称并选择类型。保存时会检查修改版本，拒绝重复字段、个人隐私明文及不支持的类型。",
        fields: [
          { key: "propertyName", label: "属性名", current: "", inputKind: "text", required: true, placeholder: "例如 instance_key" },
          {
            key: "propertyType", label: "属性类型", current: "string", inputKind: "select", required: true,
            options: ["string", "number", "boolean", "enum", "timestamp", "id", "json"],
          },
        ],
      },
      run: async (reason, _value, businessValue) => {
        const propertyName = String(businessValue?.propertyName ?? "").trim();
        const propertyType = String(businessValue?.propertyType ?? "").trim();
        if (!/^[a-z][a-z0-9_]{0,63}$/.test(propertyName)) {
          toast("属性名须为小写字母开头，后接小写字母、数字或下划线");
          return;
        }
        if (!["string", "number", "boolean", "enum", "timestamp", "id", "json"].includes(propertyType)) {
          toast("请选择受支持的属性类型");
          return;
        }
        setMutating(`schema-property-${schemaSnapshot.eventName}`);
        try {
          const next = await addA4SchemaProperty(schemaSnapshot.eventName, propertyName, propertyType, registryVersion, reason, stableKey);
          setOverview(next);
          if (lookupTargetAtOpen === schemaSnapshot.eventName
            && schemaLookupEventNameRef.current.trim() === schemaSnapshot.eventName
            && schemaLookupSequence.current === lookupSequenceAtOpen) {
            // Invalidate an earlier exact GET before replacing the preview, so a
            // late response cannot put the pre-extension schema back on screen.
            schemaLookupSequence.current += 1;
            setSchemaLookupLoading(false);
            const refreshedSchema = next.schemaRegistrations.find((item) => item.eventName === schemaSnapshot.eventName) ?? null;
            if (refreshedSchema) {
              setSchemaLookup(refreshedSchema);
              setSchemaLookupError(null);
            } else {
              // The overview is intentionally capped. Do not retain an old exact
              // preview when this target is outside the returned current rows.
              setSchemaLookup(null);
              setSchemaLookupError("属性已增加；最新总览未包含该事件，请重新核验当前 字段定义");
            }
          }
          toast(`字段定义 ${schemaSnapshot.eventName} 已增加属性 ${propertyName}`);
        } catch (error) {
          toast(`属性扩展未提交：${displayAdminError(error)}`);
          throw error;
        } finally {
          setMutating(null);
        }
      },
    });
  };

  const resetSchemaLookup = (nextEventName: string) => {
    if (nextEventName === schemaLookupEventName) return;
    schemaLookupSequence.current += 1;
    schemaLookupEventNameRef.current = nextEventName;
    setSchemaLookupEventName(nextEventName);
    setSchemaLookup(null);
    setSchemaLookupLoading(false);
    setSchemaLookupError(null);
  };

  const lookupSchemaRegistration = async () => {
    if (!canRead) {
      toast("当前账号没有 A4 读取权限，不能查询既有 字段定义");
      return;
    }
    const requestedEventName = schemaLookupEventName.trim();
    if (!eventNameValid(requestedEventName)) {
      setSchemaLookup(null);
      setSchemaLookupError("事件名格式无效，请输入已登记的精确事件名");
      return;
    }
    const sequence = schemaLookupSequence.current + 1;
    schemaLookupSequence.current = sequence;
    setSchemaLookup(null);
    setSchemaLookupError(null);
    setSchemaLookupLoading(true);
    try {
      const found = await fetchA4SchemaRegistration(requestedEventName);
      if (sequence !== schemaLookupSequence.current) return;
      if (found.eventName !== requestedEventName) {
        setSchemaLookupError("服务端返回的 字段定义 与本次精确查询不一致");
        return;
      }
      setSchemaLookup(found);
    } catch (error) {
      if (sequence === schemaLookupSequence.current) {
        setSchemaLookupError(displayAdminError(error));
      }
    } finally {
      if (sequence === schemaLookupSequence.current) {
        setSchemaLookupLoading(false);
      }
    }
  };

  const runRetention = () => {
    if (!canRunRetention) { toast("立即清理需要 A4 写权限和 A2 审计执行权限"); return; }
    const commandKey = createA4IdempotencyKey("a4-retention-run");
    openActionConfirm({
      action: <>立即执行终态事件保留清理</>,
      detail: <>仅清理超过保留期且已完成或已终止的分析事件，以及过期行为记录。待发送或发送失败的事件、业务账本和其他事件不变。操作会写入 A2 审计记录；重复提交同一请求不会重复清理。</>,
      amplifies: false,
      reasonMin: a2ReasonMin,
      reasonMax: 200,
      run: async (reason) => {
        setMutating("retention-run");
        try {
          const result = await runA4RetentionNow(reason, commandKey);
          setRetentionRun(result);
          toast(result.lockAcquired
            ? `事件保留清理完成：已完成或已终止的待发送事件 ${result.outboxRows}，行为事实 ${result.behaviorFactRows}`
            : "已有事件保留清理在执行，本次未删除任何数据");
        } catch (error) {
          toast(`执行失败:${displayAdminError(error)}`);
          throw error;
        } finally {
          setMutating(null);
        }
      },
    });
  };

  const resetRedriveTarget = (nextEventId: string) => {
    if (nextEventId === redriveEventId) return;
    redrivePreviewSequence.current += 1;
    setRedriveEventId(nextEventId);
    setRedrivePreview(null);
    setRedriveResult(null);
    setRedrivePreviewError(null);
    redriveCommandRef.current = null;
    setRedriveCommand(null);
  };

  const previewH3DeadEvent = async () => {
    if (!canRedriveH3Dead) {
      toast("核验原 H3 事实需要 A4 写权限和 A2 审计执行权限");
      return;
    }
    const eventId = redriveEventId.trim();
    if (!/^[A-Za-z0-9-]{8,64}$/.test(eventId)) {
      setRedrivePreview(null);
      setRedrivePreviewError("请输入 8–64 位字母、数字或连字符组成的事件编号");
      return;
    }
    const sequence = ++redrivePreviewSequence.current;
    setRedrivePreviewing(true);
    setRedrivePreviewError(null);
    setRedrivePreview(null);
    setRedriveResult(null);
    try {
      const preview = await fetchH3DeadOutboxRedrivePreview(eventId);
      if (sequence !== redrivePreviewSequence.current) return;
      if (preview.eventId !== eventId) throw new Error("A4_H3_OUTBOX_REDRIVE_PREVIEW_MISMATCH");
      setRedrivePreview(preview);
    } catch (error) {
      if (sequence !== redrivePreviewSequence.current) return;
      setRedrivePreviewError(displayAdminError(error));
    } finally {
      if (sequence === redrivePreviewSequence.current) setRedrivePreviewing(false);
    }
  };

  const redriveAuditedH3DeadEvent = () => {
    if (!canRedriveH3Dead) {
      toast("重新发送原 H3 事实需要 A4 写权限和 A2 审计执行权限");
      return;
    }
    const snapshot = redrivePreview;
    if (!snapshot || snapshot.status !== "DEAD" || snapshot.deliveryStatus !== "DEAD" || snapshot.eventId !== redriveEventId.trim()) {
      toast("请先核验当前事件，只有原任务事件及其发送记录均仍已终止的同一事件可重新发送");
      return;
    }
    // The command key is selected in the confirmation callback, when the full
    // normalized request (including the audit reason) is available.
    openActionConfirm({
      action: "重新发送已终止的用户任务事件",
      detail: (
        <>
          目标事件编号 <span className="acode">{snapshot.eventId}</span> · 类型 <span className="acode">{snapshot.eventType}</span> ·
          原事实状态 <b>{snapshot.status === "DEAD" ? "已终止" : "状态已变化"}</b> · 已失败 {snapshot.retryCount} 次；任务事件发送状态 <b>{snapshot.deliveryStatus === "DEAD" ? "已终止" : "状态已变化"}</b> · 已尝试 {snapshot.deliveryAttemptCount}  次。
          这里重新发送的是原 H3 事实，不是编辑或补造下游事件。服务端会同时锁定两层并以失败与尝试次数检查，防止覆盖他人的修改；仅在它仍是未删除的 <b>已终止</b> 原事件、投递层也为 <b>已终止</b>、类型仍属于这五项 H3 事实时，才将原事件改回待发送：
          <span className="acode"> {H3_DEAD_REDRIVABLE_EVENT_TYPES.join(" / ")}</span>。不会传入或编辑 事件内容、来源、时间、重试次数或错误内容。
        </>
      ),
      amplifies: false,
      reasonMin: a2ReasonMin,
      reasonMax: 200,
      run: async (reason) => {
        setMutating("h3-dead-redrive");
        try {
          const result = await runH3DeadOutboxRedriveCommand(
            redriveCommandRef,
            snapshot,
            reason,
            () => createA4IdempotencyKey("a4-h3-dead-redrive"),
            async (command) => {
              setRedriveCommand(command);
              return redriveAuditedH3DeadOutboxEvent(
                snapshot.eventId,
                snapshot.retryCount,
                snapshot.deliveryStatus,
                snapshot.deliveryAttemptCount,
                command.reason,
                command.commandKey,
              );
            },
          );
          setRedrivePreview(null);
          setRedriveResult(result);
          redriveCommandRef.current = null;
          setRedriveCommand(null);
          toast(`原 H3 事实已请求重新发送：${result.eventId} · ${result.eventType} · ${redriveStatusText(result.status)}`);
        } catch (error) {
          toast(`原 H3 事实重新发送结果未确认：${displayAdminError(error)}；请核对当前状态后再操作。`);
          throw error;
        } finally {
          setMutating(null);
        }
      },
    });
  };

  const transitionLifecycle = (schema: A4Overview["schemaRegistrations"][number]) => {
    const next = ({ new: "pending_publish", pending_publish: "gray", gray: "full", full: "disabled" } as const)[schema.lifecycleState as "new" | "pending_publish" | "gray" | "full"];
    if (!next || !canWrite) return;
    const stableKey = createA4IdempotencyKey(`a4-lifecycle-${schema.eventName}`);
    openActionConfirm({
      action: `推进事件生命周期 · ${schema.eventName}`,
      detail: <>服务端 修改冲突检查 <b>{lifecycleText(schema.lifecycleState)} / v{schema.lifecycleVersion}</b> 后推进到 <b>{lifecycleText(next)}</b>；冲突或审计失败均不生效。</>,
      amplifies: false,
      reasonMin: 8,
      reasonMax: 200,
      run: async (reason) => {
        setMutating(`lifecycle-${schema.eventName}`);
        try {
          await transitionA4Lifecycle(schema.eventName, next, schema.lifecycleState, schema.lifecycleVersion, reason, stableKey);
          await refreshOverview(true);
          toast(`${schema.eventName} 已推进到 ${lifecycleText(next)} · 已回读服务端状态`);
        } catch (error) {
          toast(`生命周期推进失败:${displayAdminError(error)}`);
          throw error;
        } finally {
          setMutating(null);
        }
      },
    });
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
    return <section className="l-card"><div className="l-b"><div className="atint">正在核对事件记录和字段登记表…</div></div></section>;
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

      <A4OutboxDiagnostics canRead={canReadOutbox} />
      <section className="l-card" data-proof="a4-h3-dead-redrive">
        <div className="l-h">
          <span className="ttl">恢复已终止的用户任务事件</span>
          <span className="sub">· 每次只核验一个编号；仅原事件及任务事件发送记录均已终止 才可恢复</span>
        </div>
        <div className="l-b">
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <label style={{ fontSize: 12, color: "var(--ink-3)" }}>
              原事件编号
              <input
                value={redriveEventId}
                onChange={(event) => resetRedriveTarget(event.target.value)}
                placeholder="输入单个原 H3 事件编号"
                aria-label="原 H3 事件编号"
                style={{ marginLeft: 8 }}
                disabled={!canRedriveH3Dead || !!mutating}
              />
            </label>
            <button className="l-btn sm mc" disabled={!canRedriveH3Dead || !!loadError || !!mutating || redrivePreviewing} onClick={() => void previewH3DeadEvent()}>
              {redrivePreviewing ? "核验中…" : "核验事件"}
            </button>
            <button className="l-btn sm mc" disabled={!canRedriveH3Dead || !!loadError || !!mutating || !redrivePreview || redrivePreview.status !== "DEAD" || redrivePreview.deliveryStatus !== "DEAD"} onClick={redriveAuditedH3DeadEvent}>

              重新发送原 H3 事实
            </button>
          </div>
          <div className="atint" style={{ marginTop: 10 }}>
            只读取两层状态、类型、失败次数和受控失败码；不提供 事件内容、来源或用户信息，也不支持批量操作。服务端仅接受原始记录与发送记录均已终止的五类任务事件。
          </div>
          {redrivePreviewError ? <div className="atint warn" style={{ marginTop: 8 }}>核验失败：{redrivePreviewError}</div> : null}
          {redrivePreview ? <div className="atint" style={{ marginTop: 8 }}>
            已核验 · 编号 <span className="acode">{redrivePreview.eventId}</span> · 类型 <span className="acode">{redrivePreview.eventType}</span> ·
            原事实状态 <b>{redriveStatusText(redrivePreview.status)}</b> · 失败次数 {redrivePreview.retryCount} · 失败摘要 {redrivePreview.lastError ?? "—"} ·
            任务事件发送记录 <b>{redriveStatusText(redrivePreview.deliveryStatus)}</b> · 尝试次数 {redrivePreview.deliveryAttemptCount} · 失败摘要 {redrivePreview.deliveryLastError ?? "—"}
          </div> : null}
          {redriveResult ? <div className="atint" style={{ marginTop: 8 }}>

            已收到重新发送结果 · 编号 <span className="acode">{redriveResult.eventId}</span> · 类型 <span className="acode">{redriveResult.eventType}</span> ·
            原事实状态 <b>{redriveStatusText(redriveResult.status)}</b> · 投递层状态 <b>{redriveStatusText(redriveResult.deliveryStatus)}</b>。如需再次操作，请重新核验当前状态。
          </div> : null}
        </div>
      </section>
      {loading && !overview && (
        <section className="l-card">
          <div className="l-b">
            <div className="atint" style={{ fontSize: 12 }}>正在加载事件统计与登记信息。</div>
          </div>
        </section>
      )}
      {/* ───── 4 f-stat ───── */}
      <div className="f-stats">
        <div className="f-stat">
          <div className="k">今日事件量（含其他及未登记类型）</div>
          <div className="v">{A4_STATS.todayEvents}</div>
          <div className="sub">包含六类已登记事件、其他及未登记类型，与下表今日总量一致</div>
        </div>
        <div className="f-stat cyan">
          <div className="k">已登记业务域</div>
          <div className="v">{A4_STATS.registeredDomains} + {A4_STATS.pendingDomains}</div>
          <div className="sub">V1 枚举 {A4_STATS.registeredDomains} · 扩展批次新增 {A4_STATS.pendingDomains}</div>
        </div>
        <div className="f-stat warn">
          <div className="k">业务域扩展工单（分析报表启用前须完成）</div>
          <div className="v">{batchDone} / {batchTotal} 批</div>
          <div className="sub">V3 批已落 · 内容批进行中</div>
        </div>
        <div className="f-stat">
          <div className="k">事件字段登记表</div>
          <div className="v">{liveSchemaVer}</div>
          <div className="sub">变更走超级管理员操作确认注册</div>
        </div>
      </div>

      {/* ───── 事件目录 × domain 注册表 ───── */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">事件目录 · {EVENT_FAMILIES.length}  个 事件类别与业务域登记表</span>
          <span className="sub">· 命名一律「域.对象_动作(过去式)」,事件 = 已发生的事实 · 点 事件类别 看事件清单</span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 920 }}>
            <thead>
              <tr>
                <th>事件类别</th><th>统计用途</th><th>代表事件</th><th>服务器确认</th>
                <th className="num">今日量</th><th style={{ textAlign: "right" }}></th>
              </tr>
            </thead>
            <tbody>
              {EVENT_FAMILIES.map((f, i) => (
                <tr key={f.key} className="click" onClick={() => setFamIdx(i)}>
                  <td style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink)", whiteSpace: "nowrap" }}>{operatorCopyText(f.title)}</td>
                  <td style={{ fontSize: 12, color: "var(--ink-3)" }}>{operatorCopyText(f.sub)}</td>
                  <td className="mono" style={{ fontSize: 11, color: "var(--ink-4)" }}>{f.key === "OTHER" || f.key === "UNREGISTERED" || f.sample.includes("其他已注册 family") ? operatorCopyText(f.sample) : f.sample}</td>
                  <td style={{ fontSize: 11.5 }}>
                    {f.serverAuth.includes("全部")
                      ? f.serverAuth.split("全部").map((part, idx, arr) => (
                          <span key={idx}>{part}{idx < arr.length - 1 ? <b>全部</b> : null}</span>
                        ))
                      : operatorCopyText(f.serverAuth)}
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

            业务域列表(V1 现行 {A4_STATS.registeredDomains} 个 + 扩展批次 {A4_STATS.pendingDomains} 个)
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
            <b>身份怎么串起来</b>  · 注册前用设备匿名 ID 打点(落地页就开始),注册完成事件同时带旧匿名 ID 和新用户 ID,
            服务器做拼接——注册前的漏斗行为和渠道归因都能落到这个人头上。三件套:匿名 ID(注册前)/ 用户 ID(服务器确认)/ 会话 ID(单次会话)。
          </div>
        </div>
      </section>

      {/* ───── 通用字段 + 口径参数 · 八项 KPI(two-col) ───── */}
      <div className="two-col">
        {/* 通用字段 + 口径参数 */}
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">每个事件必带的字段 + 统计参数</span>
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
                    <small>{operatorCopyText(c.sub)}</small>
                  </span>
                  <span className="v">{isPii ? c.value : c.value}</span>
                </div>
              );
            })}
            {!COMMON_FIELDS.length && (
              <div className="atint warn" style={{ fontSize: 12 }}>后端暂无通用字段记录</div>
            )}
            <div style={{ fontSize: 12, fontWeight: 600, margin: "10px 0 4px" }}>统计参数(锚定 12 月运营周期)</div>
            {KPI_DIMENSION_PARAMS.map((p) => {
              if (p.locked) {
                return (
                  <div className="a-vrow" key={p.key}>
                    <span className="nm">{operatorCopyText(p.name)}<small>{operatorCopyText(p.sub)}</small></span>
                    <span className="v">{p.value}</span>
                    <span className="acode lock" title="§2.4.9 · 保持一致 关键指标 #2">🔒</span>
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
                  <span className="nm">{operatorCopyText(p.name)}<small>{operatorCopyText(p.sub)}{p.key === "event_retention" && (retentionRun
                    ? ` · 最近执行:${retentionRun.evaluatedAt} · 锁:${retentionRun.lockAcquired ? "已取得" : "占用"} · 事件发送状态：${retentionRun.outboxRows} · 事实:${retentionRun.behaviorFactRows}`
                    : retentionRunError ? ` · 最近状态读取失败:${retentionRunError}` : " · 暂无人工执行记录")}</small></span>
                  <span className="v">{live}</span>
                  <button className="l-btn sm mc" title={canWrite ? undefined : "当前账号只有读取权限"} disabled={!canWrite || !overview || !!loadError || !!mutating} onClick={onAdj}>调整</button>
                  {p.key === "event_retention" && <button className="l-btn sm mc" title={canRunRetention ? undefined : "需要 A4 写权限和 A2 审计执行权限"} disabled={!canRunRetention || !overview || !!loadError || !!mutating} onClick={runRetention}>立即清理</button>}
                </div>
              );
            })}
          </div>
        </section>

        {/* 八项 KPI → 事件口径 */}
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">八项 关键指标 → 事件统计规则</span>
            <span className="sub">· 每个看板数字都能倒查到事件和算式</span>
            <div className="r">
              <Link className="l-btn sm" href="/analytics/kpi">关键指标(L1)→</Link>
            </div>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="l-tbl" style={{ minWidth: 520 }}>
              <thead>
                <tr><th>#</th><th>关键指标</th><th>事件算式(大白话)</th></tr>
              </thead>
              <tbody>
                {KPI_FORMULAS.map((k) => (
                  <tr key={k.n}>
                    <td className="mono">{k.n}</td>
                    <td style={{ fontSize: 12 }}>{operatorCopyText(k.kpi)}</td>
                    <td style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{operatorCopyText(k.formula)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="l-b" style={{ paddingTop: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>主漏斗(喂运营总览 B3 / 查看明细在 L2)</div>
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
          <span className="sub">· 事件从产生到看板的全链路 · 字段定义 注册归这页管</span>
          <div className="r">
            <button className="l-btn sm mc" title={canWrite ? undefined : "当前账号只有读取权限"} disabled={!canWrite || !overview || !!loadError || !!mutating} onClick={registerSchema}>注册新事件 / 属性</button>
          </div>
        </div>
        <div className="l-b" style={{ paddingTop: 6 }}>
          <div className="a4-pipe" style={{ marginBottom: 10 }}>
            <span className="st">
              产生
              <small>资金/状态:服务器发 · 界面交互:客户端发送</small>
            </span>
            <span className="ar">→</span>
            <span className="st">
              去重
              <small>按事件编号</small>
            </span>
            <span className="ar">→</span>
            <span className="st hot">
              事件库
              <small>{liveEventRetention || "0"}</small>
            </span>
            <span className="ar">→</span>
            <span className="st">实时漏斗(B3)</span>
            <span className="ar">+</span>
            <span className="st">分析报表（L 域）</span>
            <span className="ar">+</span>
            <span className="st">风控(K)/ 对账(D)</span>
          </div>
          <div className="two-col" style={{ marginBottom: 0 }}>
            <div className="atint cyan">
              <b>防篡改</b>  · 资金和 关键指标 统计规则只统计「服务器已确认」的事件——
              服务器在处理流程推进的那一刻发,端上伪造不出来;界面交互事件丢了重了都不影响资金账。
            </div>
            <div className="atint">
              <b>字段定义 注册</b>  · 新事件名、新属性必须先在这里注册(超级管理员执行门槛:超级管理员)才能开始发;
              隐私明文(手机号/地址)进不了 字段定义。各域页面的「⑧ 埋点」段引用这里,不许私立命名。
            </div>
          </div>
          <div style={{ fontSize: 12, fontWeight: 600, margin: "12px 0 5px" }}>真实 事件字段登记表（最近 {SCHEMA_REGISTRATIONS.length} 条）</div>
          <div className="atint" style={{ marginBottom: 10 }}>
            <b>查询既有 字段定义</b> · 最近列表不会替代完整注册表。输入一个已登记的精确事件名以核验其当前元数据；不会做模糊搜索、枚举或返回事件内容。
            <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input
                className="ui-control" aria-label="精确事件名"
                value={schemaLookupEventName}
                placeholder="例如 quest.completed"
                onChange={(event) => resetSchemaLookup(event.target.value)}
                style={{ width: 300, maxWidth: "100%" }}
              />
              <button className="l-btn sm mc" disabled={!canRead || !!loadError || schemaLookupLoading} onClick={() => void lookupSchemaRegistration()}>
                {schemaLookupLoading ? "核验中…" : "核验既有 字段定义"}
              </button>
              {schemaLookupError && <span className="bad">{schemaLookupError}</span>}
            </div>
            {schemaLookup && <div style={{ marginTop: 8 }}>
              <span className="acode">{schemaLookup.eventName}</span> · 事件登记版本 <span className="acode">{schemaLookup.version}</span>  ·
              全局注册表 修改版本 <span className="acode">{liveSchemaVer}</span> · {schemaLookup.producer} → {schemaLookup.consumers || "未指定"} ·
              属性 <span className="acode">{schemaLookup.properties}</span>
              <button className="l-btn sm mc" style={{ marginLeft: 8 }} disabled={!canWrite || !!mutating || !!loadError} onClick={() => openSchemaPropertyExtension(schemaLookup)}>扩展属性</button>
            </div>}
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="l-tbl" style={{ minWidth: 1020 }}>
              <thead><tr><th>事件</th><th>归属 / 事件类别</th><th>产 → 消</th><th>属性</th><th>权威 / 采样</th><th>版本</th><th>操作</th></tr></thead>
              <tbody>
                {SCHEMA_REGISTRATIONS.map((schema) => (
                  <tr key={schema.eventName}>
                    <td className="mono">{schema.eventName}</td>
                    <td>{schema.ownerDomain} / {schema.familyKey}</td>
                    <td>{schema.producer} → {schema.consumers || "未指定"}</td>
                    <td className="mono">{schema.properties}</td>
                    <td>{schema.serverAuthoritative ? "服务器权威" : "客户端事件"} · {schema.samplingPolicy}</td>
                    <td className="mono">{schema.version}</td>
                    <td><button className="l-btn sm mc" disabled={!canWrite || !!mutating || !!loadError} onClick={() => openSchemaPropertyExtension(schema)}>扩展属性</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="l-card" data-restored-capability="a4-event-lifecycle" aria-labelledby="a4-lifecycle-title">
        <div className="l-h">
          <span className="ttl" id="a4-lifecycle-title">事件发布生命周期</span>
          <span className="sub">· 以服务器记录为准状态 · 按顺序处理 · 防覆盖修改检查 + 防重复提交 + A4 审计</span>
        </div>
        <div className="l-b">
          <table className="l-tbl">
            <thead><tr><th>事件</th><th>当前状态</th><th>版本</th><th style={{ textAlign: "right" }}>动作</th></tr></thead>
            <tbody>{SCHEMA_REGISTRATIONS.map((schema) => {
              const next = ({ new: "pending_publish", pending_publish: "gray", gray: "full", full: "disabled" } as const)[schema.lifecycleState as "new" | "pending_publish" | "gray" | "full"];
              return <tr key={`lifecycle-${schema.eventName}`}>
                <td className="mono">{schema.eventName}</td><td>{lifecycleText(schema.lifecycleState)}</td><td className="mono">v{schema.lifecycleVersion}</td>
                <td style={{ textAlign: "right" }}>{next ? <button className="l-btn sm mc" disabled={!canWrite || !!mutating || !!loadError} onClick={() => transitionLifecycle(schema)}>推进到 {lifecycleText(next)}</button> : <span className="bdg dim">终态</span>}</td>
              </tr>;
            })}</tbody>
          </table>
        </div>
      </section>

      {/* ───── domain 扩展批次看板 ───── */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">业务域扩展批次看板 ·分析报表启用前须完成</span>
          <span className="sub">· 扩展落地前,新类事件先进入待归属登记清单,落地后迁回所属业务域</span>
          <div className="r">
            <button className="l-btn sm mc" title={canWrite ? undefined : "当前账号只有读取权限"} disabled={!canWrite || !overview || !!loadError || !!mutating} onClick={registerBatch}>登记扩展工单</button>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 920 }}>
            <thead>
              <tr>
                <th>批次</th><th>新增业务域 / 事件</th><th>提出方</th>
                <th>状态</th><th>归属影响</th><th style={{ textAlign: "right" }}></th>
              </tr>
            </thead>
            <tbody>
              {DOMAIN_EXTENSIONS.map((b, i) => {
                const st = BATCH_STATE[b.state];
                const impactColor = b.state === "inprogress" ? "var(--warning)" : "var(--ink-4)";
                return (
                  <tr key={b.id} className="click" onClick={() => setBatchIdx(i)}>
                    <td className="mono" style={{ fontWeight: 600, color: "var(--ink)" }}>{operatorCopyText(b.title)}</td>
                    <td>
                      {b.newDomains.length > 0 ? (
                        b.newDomains.map((d) => (
                          <span className={`a4-dom${d.n ? " new" : ""}`} key={d.name}>{d.name}</span>
                        ))
                      ) : (
                        <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
                          将后台操作事件清单与登记表逐条核对
                        </span>
                      )}
                      {/* 🔴 zentao #202:列头写的是「新增 domain / 事件」,但此前只渲染 domain。
                          同一 domain 下登记多个事件时,行的「批次」列都是同一个常量标题
                          (登记扩展工单)、domain 又相同,于是若干条**看起来完全一样**的记录
                          并排出现,运营无法判断是重复工单还是不同事件。事件名是唯一区分字段,
                          必须出现在行上;工单号(b.id)同时给出来,便于与后端核对。 */}
                      {b.details.length > 0 && (
                        <span className="block" style={{ marginTop: 4, fontSize: 11, color: "var(--ink-4)", fontFamily: "var(--mono)" }}>
                          {b.details[0].item} · 工单 {b.id}
                        </span>
                      )}
                    </td>
                    <td style={{ fontSize: 12 }}>{b.proposer}</td>
                    <td><span className={`bdg ${st.tone}`}>{st.label}</span></td>
                    <td style={{ fontSize: 11.5, color: impactColor }}>{operatorCopyText(b.impact)}</td>
                    <td style={{ textAlign: "right" }}>
                      <button
                        className="l-btn sm"
                        aria-label={`查看扩展批次明细:${batchActionTarget(b, i)}`}
                        title={`查看扩展批次明细:${batchActionTarget(b, i)}`}
                        onClick={(e) => { e.stopPropagation(); setBatchIdx(i); }}
                      >明细 · {batchActionTarget(b, i)}</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="l-b" style={{ paddingTop: 10 }}>
          <div className="atint warn">
            <b>为什么是「必办」</b>  · 分析报表（L 域）切换到正式统计规则前,这四批必须清零——
            否则内容/通知/披露/课程的事件仍停留在待归属登记清单,分析报表启用时就会存在尚未归类的数据,
            以后迁移要重算历史。待归属期间统计规则权威不受影响(算式不变,只是归类待迁移)。
          </div>
        </div>
      </section>

      {/* ───── f-foot ───── */}
      <p className="f-foot">
        <b>分工一句话</b>:这页定义「事件叫什么、带什么、归哪类」;审计中心(A2)负责后台操作事件保存记录、理由留痕与敏感动态;
        使用方是运营总览(B1–B5)、资金对账(D)、风控(K)、分析报表（L）和节奏归因(H1)。
        <b> 动作分线</b>:字段定义 注册 / 变更 = 仅超级管理员可执行;统计参数(窗口/留存/采样)= 超级管理员操作确认;
        扩展工单登记 = 提出域提交,这页注册并由超级管理员执行。
      </p>
      {/* ───── family 事件清单 Drawer ───── */}
      {famIdx !== null && (() => {
              const f: A4EventFamily = EVENT_FAMILIES[famIdx];
        return (
          <Drawer
            title={`事件类别 ${operatorCopyText(f.title)} · 事件清单`}
            sub={operatorCopyText(f.sub)}
            onClose={() => setFamIdx(null)}
          >
            <div className="atint" style={{ marginBottom: 12 }}>
              命名规范:<span className="acode">域.对象_动作</span>(过去式);隐私明文禁入。
              服务器确认:<b>{operatorCopyText(f.serverAuth)}</b>。
            </div>
            <table className="l-tbl">
              <thead>
                <tr><th>事件</th><th>说明</th></tr>
              </thead>
              <tbody>
                {f.events.map((event) => (
                  <tr key={event.item}>
                    <td className="mono" style={{ fontSize: 11.5, color: "var(--ink-2)" }}>{event.item}</td>
                    <td style={{ fontSize: 12 }}>{operatorCopyText(event.desc)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="atint" style={{ marginTop: 14 }}>

              新增事件须先注册(超级管理员操作确认)再开始发;各域页面「事件去向」段引用这里。
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
            title={`扩展批次 · ${operatorCopyText(b.title)}(${st.label})`}
            sub={<>{st.label} · {operatorCopyText(b.impact)}</>}
            onClose={() => setBatchIdx(null)}
          >
            <div className="atint" style={{ marginBottom: 12 }}>
              <b>{st.label}</b> · {operatorCopyText(b.impact)}
            </div>
            <table className="l-tbl">
              <thead>
                <tr><th>事件 / 项</th><th>说明</th></tr>
              </thead>
              <tbody>
                {b.details.map((detail) => (
                  <tr key={detail.item}>
                    <td className="mono" style={{ fontSize: 11.5, color: "var(--ink-2)" }}>{detail.item}</td>
                    <td style={{ fontSize: 12 }}>{operatorCopyText(detail.desc)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="atint" style={{ marginTop: 14 }}>

              扩展登记走 字段定义 注册同一条确认路(超级管理员操作确认);迁移时历史待归属事件批量改归属、不重新计算历史数据。
            </div>
          </Drawer>
        );
      })()}

      {/* ───── 登记 domain 扩展工单 · 多字段抽屉(domain / 事件名 / 产消方 各一格,不再一个框塞)───── */}
      {naBatch && (
        <Drawer
          title="登记 业务域扩展工单"
          sub="① 业务域名称 → ② 事件名(过去式) → ③ 发送方 → ④ 使用方 · 提交走超级管理员操作确认"
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
                  if (!batchFormValid) { toast("拒绝:请填写有效业务域名称、过去式事件名、发送方和使用方"); return; }
                  const stableKey = createA4IdempotencyKey("a4-domain-extension");
                  setNaBatch(false);
                  openActionConfirm({
                    action: `登记 业务域扩展工单 · ${domain}`,
                    detail: (<><b>{domain}</b> · 事件 <span className="acode">{event}</span> · 生产 {producer || "—"} → 消费 {consumer || "—"}。落地前进入待归属登记清单;超级管理员执行,注册完成后归档。</>),
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
                <label style={{ fontSize: 12, color: "var(--ink-3)" }}>业务域名称 *
                  <input value={batchForm.domain} onChange={(e) => setBatchForm({ ...batchForm, domain: e.target.value })} placeholder="如 referral" style={fst} />
                </label>
                <label style={{ fontSize: 12, color: "var(--ink-3)" }}>事件名(过去式)*
                  <input value={batchForm.event} onChange={(e) => setBatchForm({ ...batchForm, event: e.target.value })} placeholder="如 referral_bound" style={fst} />
                </label>
                <label style={{ fontSize: 12, color: "var(--ink-3)" }}>发送方(谁发送)
                  <input value={batchForm.producer} onChange={(e) => setBatchForm({ ...batchForm, producer: e.target.value })} placeholder="如 F 域结算服务" style={fst} />
                </label>
                <label style={{ fontSize: 12, color: "var(--ink-3)" }}>使用方(谁用)
                  <input value={batchForm.consumer} onChange={(e) => setBatchForm({ ...batchForm, consumer: e.target.value })} placeholder="如 B3 漏斗 / L2 留存" style={fst} />
                </label>
                <div className="atint">提交后走超级管理员操作确认(填理由);注册为待归属记录,落地后迁回所属业务域。</div>
              </div>
            );
          })()}
        </Drawer>
      )}
    </>
  );
}

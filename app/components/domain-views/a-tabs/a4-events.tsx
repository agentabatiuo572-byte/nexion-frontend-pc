"use client";
const redriveStatusText = (value: string) => ({PENDING:"待发送",CLAIMED:"处理中",PROCESSING:"处理中",SENT:"已发送",DELIVERED:"已送达",DEAD:"已终止",FAILED:"失败待重试",RETRY_REQUESTED:"已请求重试"} as Record<string,string>)[value] ?? "状态未知";
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
  done: { tone: "ok", label: "已完成" },
  inprogress: { tone: "warn", label: "进行中" },
  pending: { tone: "warn", label: "待登记" },
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
    if (!canWrite) { toast("你只有查看权限，不能修改"); return; }
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
    if (!canWrite) { toast("你只有查看权限，不能修改统计参数"); return; }
    const cur = liveDay0;
    const stableKey = createA4IdempotencyKey("a4-param-day0");
    openActionConfirm({
      action: "统计参数 · 首笔收益到账时限",
      detail: (
        <>
          当前 <b>{cur}</b>。修改后关键指标 #1 的统计方式随之改变，历史数据不重算。
        </>
      ),
      amplifies: false,
      edit: { kind: "text", current: cur, unit: "" },
      run: (reason, v) => {
        const val = (v || "").trim();
        if (!/^\d{1,4}\s*(?:秒|s|sec|seconds?)?$/i.test(val)) { toast("请输入 30–600 秒"); return; }
        const seconds = Number.parseInt(val, 10);
        if (seconds < 30 || seconds > 600) { toast("请输入 30–600 秒"); return; }
        return updateParam("day0", val, reason, `首笔收益到账时限已更新为 ${seconds} 秒`, stableKey);
      },
    });
  };

  const adjEventRetention = () => {
    if (!canWrite) { toast("你只有查看权限，不能修改统计参数"); return; }
    const cur = liveEventRetention;
    const stableKey = createA4IdempotencyKey("a4-param-retention");
    openActionConfirm({
      action: "统计参数 · 事件留存期",
      detail: (
        <>
          当前 <b>{cur}</b>。只对新事件生效，至少保留 13 个月（覆盖一个完整运营周期）。
        </>
      ),
      amplifies: false,
      edit: { kind: "text", current: cur, unit: "" },
      run: (reason, v) => {
        const val = (v || "").trim();
        if (!/^\d{1,3}\s*(?:个月|月|months?)?$/i.test(val)) { toast("请输入 13–60 个月"); return; }
        const months = Number.parseInt(val, 10);
        if (months < 13 || months > 60) { toast("请输入 13–60 个月"); return; }
        return updateParam("event_retention", val, reason, `事件留存期已更新为 ${months} 个月`, stableKey);
      },
    });
  };

  const adjSampling = () => {
    if (!canWrite) { toast("你只有查看权限，不能修改统计参数"); return; }
    const cur = liveSampling;
    const stableKey = createA4IdempotencyKey("a4-param-sampling");
    openActionConfirm({
      action: "统计参数 · 采样率",
      detail: (
        <>
          当前 <b>{cur}</b>。资金、风控、转化类事件始终全部记录，这里只能调浏览和会话类的抽样比例。
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
          toast("资金、风控、转化类必须保持 100%"); return;
        }
        const percent = Number.parseInt(val.match(/\d{1,3}/)?.[0] || "", 10);
        if (!Number.isFinite(percent) || percent < 0 || percent > 100) { toast("浏览和会话类请输入 0–100%"); return; }
        return updateParam("sampling", String(percent), reason, `浏览/会话采样率已更新为 ${percent}%`, stableKey);
      },
    });
  };

  /* ────────────────── 事件字段登记表 注册 ────────────────── */

  const registerSchema = () => {
    if (!canWrite) { toast("你只有查看权限，不能登记事件"); return; }
    const stableKey = createA4IdempotencyKey("a4-schema");
    openActionConfirm({
      action: "登记新事件或字段",
      detail: (
        <>
          当前事件目录版本 <b>{liveSchemaVer}</b>。新事件或字段要先登记才能使用。
          事件名格式为 <span className="acode">模块.对象_动作</span>（动作用过去式），不能与已有事件重复，不能包含手机号、地址等隐私信息。
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
        if (!ev) { toast("请填写事件名"); return; }
        if (!eventNameValid(ev)) { toast("事件名格式应为 模块.对象_动作，动作用过去式"); return; }
        if (bv?.isPII === "true") { toast("无法登记：事件不能包含手机号、地址等隐私信息"); return; }
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
            toast(`事件 ${ev} 已提交登记（${ver} · ${bv?.producer}）`);
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
    if (!canWrite) { toast("你只有查看权限，不能登记"); return; }
    setBatchForm({ domain: "", event: "", producer: "", consumer: "" });
    setNaBatch(true);
  };

  const openSchemaPropertyExtension = (schema: A4Overview["schemaRegistrations"][number]) => {
    if (!canWrite) { toast("你只有查看权限，不能新增字段"); return; }
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
      toast("事件目录版本获取失败，请刷新后重试");
      return;
    }
    const stableKey = createA4IdempotencyKey(`a4-schema-property-${schemaSnapshot.eventName}`);
    openActionConfirm({
      action: `给已有事件新增字段 · ${schemaSnapshot.eventName}`,
      detail: <>
        事件版本 <b>{schemaSnapshot.version}</b> · 目录版本 <b>{registryVersion}</b> · 发送方 <span className="acode">{schemaSnapshot.producer}</span> ·
        使用方 <span className="acode">{schemaSnapshot.consumers || "未指定"}</span> · 现有字段 <span className="acode">{schemaSnapshot.properties}</span>。
        这里只能新增一个字段，事件的其他设置不变。
      </>,
      amplifies: false,
      reasonMin: a2ReasonMin,
      reasonMax: 200,
      businessForm: {
        kind: "multi-field",
        title: `新增字段 · ${schemaSnapshot.eventName}`,
        hint: "填写字段名并选择类型。字段不能重复，也不能包含隐私信息。",
        fields: [
          { key: "propertyName", label: "字段名", current: "", inputKind: "text", required: true, placeholder: "例如 instance_key" },
          {
            key: "propertyType", label: "字段类型", current: "string", inputKind: "select", required: true,
            options: ["string", "number", "boolean", "enum", "timestamp", "id", "json"],
          },
        ],
      },
      run: async (reason, _value, businessValue) => {
        const propertyName = String(businessValue?.propertyName ?? "").trim();
        const propertyType = String(businessValue?.propertyType ?? "").trim();
        if (!/^[a-z][a-z0-9_]{0,63}$/.test(propertyName)) {
          toast("字段名须以小写字母开头，只能包含小写字母、数字和下划线");
          return;
        }
        if (!["string", "number", "boolean", "enum", "timestamp", "id", "json"].includes(propertyType)) {
          toast("请选择字段类型");
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
              setSchemaLookupError("字段已新增，但列表里暂时没有这个事件，请重新查询");
            }
          }
          toast(`${schemaSnapshot.eventName} 已新增字段 ${propertyName}`);
        } catch (error) {
          toast(`新增字段失败：${displayAdminError(error)}`);
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
      toast("你没有查看事件的权限");
      return;
    }
    const requestedEventName = schemaLookupEventName.trim();
    if (!eventNameValid(requestedEventName)) {
      setSchemaLookup(null);
      setSchemaLookupError("请输入完整的、已登记的事件名");
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
        setSchemaLookupError("查询结果与输入的事件名不一致，请重试");
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
    if (!canRunRetention) { toast("你没有清理事件的权限"); return; }
    const commandKey = createA4IdempotencyKey("a4-retention-run");
    openActionConfirm({
      action: <>清理过期事件</>,
      detail: <>只清理超过保留期、已经处理完的事件。还在等待发送或发送失败的事件，以及资金账目都不受影响。</>,
      amplifies: false,
      reasonMin: a2ReasonMin,
      reasonMax: 200,
      run: async (reason) => {
        setMutating("retention-run");
        try {
          const result = await runA4RetentionNow(reason, commandKey);
          setRetentionRun(result);
          toast(result.lockAcquired
            ? `清理完成：发送记录 ${result.outboxRows} 条，行为记录 ${result.behaviorFactRows} 条`
            : "已有清理正在进行，本次没有删除任何数据");
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
      toast("你没有重新发送任务事件的权限");
      return;
    }
    const eventId = redriveEventId.trim();
    if (!/^[A-Za-z0-9-]{8,64}$/.test(eventId)) {
      setRedrivePreview(null);
      setRedrivePreviewError("事件编号应为 8–64 位字母、数字或连字符");
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
      toast("你没有重新发送任务事件的权限");
      return;
    }
    const snapshot = redrivePreview;
    if (!snapshot || snapshot.status !== "DEAD" || snapshot.deliveryStatus !== "DEAD" || snapshot.eventId !== redriveEventId.trim()) {
      toast("请先查询这个事件，确认它已终止后才能重新发送");
      return;
    }
    // The command key is selected in the confirmation callback, when the full
    // normalized request (including the audit reason) is available.
    openActionConfirm({
      action: "重新发送任务事件",
      detail: (
        <>
          目标事件编号 <span className="acode">{snapshot.eventId}</span> · 类型 <span className="acode">{snapshot.eventType}</span> ·
          事件状态 <b>{snapshot.status === "DEAD" ? "已终止" : "已变化"}</b> · 已失败 {snapshot.retryCount} 次；发送状态 <b>{snapshot.deliveryStatus === "DEAD" ? "已终止" : "已变化"}</b> · 已尝试 {snapshot.deliveryAttemptCount} 次。
          原样重新发送这个事件，内容不做任何修改。只支持以下任务事件：<span className="acode">{H3_DEAD_REDRIVABLE_EVENT_TYPES.join(" / ")}</span>。
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
          toast(`已重新发送：${result.eventId} · ${result.eventType} · ${redriveStatusText(result.status)}`);
        } catch (error) {
          toast(`重新发送结果未确认：${displayAdminError(error)}。请先查询当前状态再操作。`);
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
      action: `更新事件状态 · ${schema.eventName}`,
      detail: <>从 <b>{lifecycleText(schema.lifecycleState)}</b> 改为 <b>{lifecycleText(next)}</b>。</>,
      amplifies: false,
      reasonMin: 8,
      reasonMax: 200,
      run: async (reason) => {
        setMutating(`lifecycle-${schema.eventName}`);
        try {
          await transitionA4Lifecycle(schema.eventName, next, schema.lifecycleState, schema.lifecycleVersion, reason, stableKey);
          await refreshOverview(true);
          toast(`${schema.eventName} 已改为 ${lifecycleText(next)}`);
        } catch (error) {
          toast(`状态更新失败：${displayAdminError(error)}`);
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
    return <section className="l-card"><div className="l-b"><div className="atint">正在加载…</div></div></section>;
  }

  return (
    <>
      {loadError && overview && (
        <section className="l-card">
          <div className="l-b">
            <div className="atint warn" style={{ fontSize: 12 }}>
              加载失败：{loadError}
              <button className="l-btn sm" style={{ marginLeft: 8 }} onClick={() => void refreshOverview()}>重试</button>
            </div>
          </div>
        </section>
      )}

      <A4OutboxDiagnostics canRead={canReadOutbox} />
      <section className="l-card" data-proof="a4-h3-dead-redrive">
        <div className="l-h">
          <span className="ttl">重新发送失败的任务事件</span>
          <span className="sub">· 每次处理一个，只有已终止的事件才能重新发送</span>
        </div>
        <div className="l-b">
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <label style={{ fontSize: 12, color: "var(--ink-3)" }}>
              事件编号
              <input
                value={redriveEventId}
                onChange={(event) => resetRedriveTarget(event.target.value)}
                placeholder="输入一个任务事件编号"
                aria-label="任务事件编号"
                style={{ marginLeft: 8 }}
                disabled={!canRedriveH3Dead || !!mutating}
              />
            </label>
            <button className="l-btn sm mc" disabled={!canRedriveH3Dead || !!loadError || !!mutating || redrivePreviewing} onClick={() => void previewH3DeadEvent()}>
              {redrivePreviewing ? "查询中…" : "查询"}
            </button>
            <button className="l-btn sm mc" disabled={!canRedriveH3Dead || !!loadError || !!mutating || !redrivePreview || redrivePreview.status !== "DEAD" || redrivePreview.deliveryStatus !== "DEAD"} onClick={redriveAuditedH3DeadEvent}>

              重新发送
            </button>
          </div>
          <div className="atint" style={{ marginTop: 10 }}>
            用户完成任务却没拿到奖励时，可在这里把卡住的任务事件重新发送一次。
          </div>
          {redrivePreviewError ? <div className="atint warn" style={{ marginTop: 8 }}>查询失败：{redrivePreviewError}</div> : null}
          {redrivePreview ? <div className="atint" style={{ marginTop: 8 }}>
            编号 <span className="acode">{redrivePreview.eventId}</span> · 类型 <span className="acode">{redrivePreview.eventType}</span> ·
            事件状态 <b>{redriveStatusText(redrivePreview.status)}</b> · 失败 {redrivePreview.retryCount} 次 · 原因 {redrivePreview.lastError ?? "—"} ·
            发送状态 <b>{redriveStatusText(redrivePreview.deliveryStatus)}</b> · 尝试 {redrivePreview.deliveryAttemptCount} 次 · 原因 {redrivePreview.deliveryLastError ?? "—"}
          </div> : null}
          {redriveResult ? <div className="atint" style={{ marginTop: 8 }}>

            已重新发送 · 编号 <span className="acode">{redriveResult.eventId}</span> · 类型 <span className="acode">{redriveResult.eventType}</span> ·
            事件状态 <b>{redriveStatusText(redriveResult.status)}</b> · 发送状态 <b>{redriveStatusText(redriveResult.deliveryStatus)}</b>。
          </div> : null}
        </div>
      </section>
      {loading && !overview && (
        <section className="l-card">
          <div className="l-b">
            <div className="atint" style={{ fontSize: 12 }}>正在加载…</div>
          </div>
        </section>
      )}
      {/* ───── 4 f-stat ───── */}
      <div className="f-stats">
        <div className="f-stat">
          <div className="k">今日事件量</div>
          <div className="v">{A4_STATS.todayEvents}</div>
          <div className="sub">含未登记类型</div>
        </div>
        <div className="f-stat cyan">
          <div className="k">已接入模块</div>
          <div className="v">{A4_STATS.registeredDomains} + {A4_STATS.pendingDomains}</div>
          <div className="sub">另有 {A4_STATS.pendingDomains} 个待接入</div>
        </div>
        <div className="f-stat warn">
          <div className="k">模块接入进度</div>
          <div className="v">{batchDone} / {batchTotal} 批</div>
          <div className="sub">数据报表正式启用前须全部完成</div>
        </div>
        <div className="f-stat">
          <div className="k">已登记事件</div>
          <div className="v">{liveSchemaVer}</div>
          <div className="sub">仅超级管理员可修改</div>
        </div>
      </div>

      {/* ───── 事件目录 × domain 注册表 ───── */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">事件目录 · {EVENT_FAMILIES.length} 类</span>
          <span className="sub">· 点击「事件清单」查看每类包含哪些事件</span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 920 }}>
            <thead>
              <tr>
                <th>事件类别</th><th>统计用途</th><th>代表事件</th><th>系统记录</th>
                <th className="num">今日量</th><th style={{ textAlign: "right" }}></th>
              </tr>
            </thead>
            <tbody>
              {EVENT_FAMILIES.map((f, i) => (
                <tr key={f.key} className="click" onClick={() => setFamIdx(i)}>
                  <td style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink)", whiteSpace: "nowrap" }}>{operatorCopyText(f.title)}</td>
                  <td style={{ fontSize: 12, color: "var(--ink-3)" }}>{operatorCopyText(f.sub)}</td>
                  <td className="mono" style={{ fontSize: 11, color: "var(--ink-4)" }}>{f.key === "OTHER" || f.key === "UNREGISTERED" || f.key === "other_unregistered" || f.sample.includes("其他已注册 family") ? operatorCopyText(f.sample) : f.sample}</td>
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

            已接入模块 {A4_STATS.registeredDomains} 个 · 待接入 {A4_STATS.pendingDomains} 个
          </div>
          <div style={{ marginBottom: 8 }}>
            {REGISTERED_DOMAINS.map((d) => (
              <span className="a4-dom" key={d}>{d}</span>
            ))}
            {PENDING_DOMAINS.map((d) => (
              <span className="a4-dom new" key={d} title="待接入">{d} +</span>
            ))}
          </div>
          <div className="atint cyan">
            <b>注册前的行为也能算到用户头上</b> · 用户注册前用设备编号记录行为，注册后自动关联到这个用户，所以注册前的浏览和来源渠道都能统计。
          </div>
        </div>
      </section>

      {/* ───── 通用字段 + 口径参数 · 八项 KPI(two-col) ───── */}
      <div className="two-col">
        {/* 通用字段 + 口径参数 */}
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">通用字段与统计参数</span>
          </div>
          <div className="l-b" style={{ paddingTop: 4 }}>
            <div style={{ fontSize: 12, fontWeight: 600, margin: "2px 0 4px" }}>每个事件都带的字段（10 项，固定）</div>
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
              <div className="atint warn" style={{ fontSize: 12 }}>暂无通用字段</div>
            )}
            <div style={{ fontSize: 12, fontWeight: 600, margin: "10px 0 4px" }}>统计参数</div>
            {KPI_DIMENSION_PARAMS.map((p) => {
              if (p.locked) {
                return (
                  <div className="a-vrow" key={p.key}>
                    <span className="nm">{operatorCopyText(p.name)}<small>{operatorCopyText(p.sub)}</small></span>
                    <span className="v">{p.value}</span>
                    <span className="acode lock" title="系统固定，与关键指标 #2 保持一致">🔒</span>
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
                    ? ` · 上次清理 ${retentionRun.evaluatedAt}${retentionRun.lockAcquired ? "" : "（当时有其他清理在进行）"} · 发送记录 ${retentionRun.outboxRows} 条 · 行为记录 ${retentionRun.behaviorFactRows} 条`
                    : retentionRunError ? ` · 上次清理情况加载失败：${retentionRunError}` : " · 还没有手动清理过")}</small></span>
                  <span className="v">{live}</span>
                  <button className="l-btn sm mc" title={canWrite ? undefined : "你只有查看权限"} disabled={!canWrite || !overview || !!loadError || !!mutating} onClick={onAdj}>调整</button>
                  {p.key === "event_retention" && <button className="l-btn sm mc" title={canRunRetention ? undefined : "你没有清理事件的权限"} disabled={!canRunRetention || !overview || !!loadError || !!mutating} onClick={runRetention}>立即清理</button>}
                </div>
              );
            })}
          </div>
        </section>

        {/* 八项 KPI → 事件口径 */}
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">八项关键指标怎么算</span>
            <div className="r">
              <Link className="l-btn sm" href="/analytics/kpi">查看关键指标 →</Link>
            </div>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="l-tbl" style={{ minWidth: 520 }}>
              <thead>
                <tr><th>#</th><th>关键指标</th><th>计算方式</th></tr>
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
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>主要转化步骤（明细在「用户转化与留存」）</div>
            <div className="a4-pipe">
              <span className="st hot">注册</span><span className="ar">→</span>
              <span className="st">绑卡验证</span><span className="ar">→</span>
              <span className="st">首购</span><span className="ar">→</span>
              <span className="st">复投</span><span className="ar">→</span>
              <span className="st">提现</span>
            </div>
            <div style={{ fontSize: 11.5, color: "var(--ink-4)", marginTop: 4 }}>
              每一步转化率 = 这一步的人数 ÷ 上一步的人数，可按注册周、运营阶段、渠道查看。
            </div>
          </div>
        </section>
      </div>

      {/* ───── 管道与治理 ───── */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">事件流向与登记</span>
          <div className="r">
            <button className="l-btn sm mc" title={canWrite ? undefined : "你只有查看权限"} disabled={!canWrite || !overview || !!loadError || !!mutating} onClick={registerSchema}>登记新事件 / 字段</button>
          </div>
        </div>
        <div className="l-b" style={{ paddingTop: 6 }}>
          <div className="a4-pipe" style={{ marginBottom: 10 }}>
            <span className="st">
              产生
              <small>资金和状态由服务器发出，页面操作由 App 发出</small>
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
            <span className="st">用户转化分析</span>
            <span className="ar">+</span>
            <span className="st">数据报表</span>
            <span className="ar">+</span>
            <span className="st">风控 / 对账</span>
          </div>
          <div className="two-col" style={{ marginBottom: 0 }}>
            <div className="atint cyan">
              <b>防篡改</b> · 资金和关键指标只统计服务器发出的事件，用户无法伪造；App 发出的页面操作事件丢失或重复都不影响资金。
            </div>
            <div className="atint">
              <b>先登记再使用</b> · 新事件和新字段必须先在这里登记（仅超级管理员），不能包含手机号、地址等隐私信息。
            </div>
          </div>
          <div style={{ fontSize: 12, fontWeight: 600, margin: "12px 0 5px" }}>最近登记的事件（{SCHEMA_REGISTRATIONS.length} 条）</div>
          <div className="atint" style={{ marginBottom: 10 }}>
            <b>查询已登记的事件</b> · 上面只列最近登记的，查其他事件请输入完整事件名。
            <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input
                className="ui-control" aria-label="精确事件名"
                value={schemaLookupEventName}
                placeholder="例如 quest.completed"
                onChange={(event) => resetSchemaLookup(event.target.value)}
                style={{ width: 300, maxWidth: "100%" }}
              />
              <button className="l-btn sm mc" disabled={!canRead || !!loadError || schemaLookupLoading} onClick={() => void lookupSchemaRegistration()}>
                {schemaLookupLoading ? "查询中…" : "查询"}
              </button>
              {schemaLookupError && <span className="bad">{schemaLookupError}</span>}
            </div>
            {schemaLookup && <div style={{ marginTop: 8 }}>
              <span className="acode">{schemaLookup.eventName}</span> · 版本 <span className="acode">{schemaLookup.version}</span> ·
              {schemaLookup.producer} → {schemaLookup.consumers || "未指定"} ·
              字段 <span className="acode">{schemaLookup.properties}</span>
              <button className="l-btn sm mc" style={{ marginLeft: 8 }} disabled={!canWrite || !!mutating || !!loadError} onClick={() => openSchemaPropertyExtension(schemaLookup)}>新增字段</button>
            </div>}
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="l-tbl" style={{ minWidth: 1020 }}>
              <thead><tr><th>事件</th><th>所属模块 / 类别</th><th>发送方 → 使用方</th><th>字段</th><th>来源 / 采样</th><th>版本</th><th>操作</th></tr></thead>
              <tbody>
                {SCHEMA_REGISTRATIONS.map((schema) => (
                  <tr key={schema.eventName}>
                    <td className="mono">{schema.eventName}</td>
                    <td>{schema.ownerDomain} / {schema.familyKey}</td>
                    <td>{schema.producer} → {schema.consumers || "未指定"}</td>
                    <td className="mono">{schema.properties}</td>
                    <td>{schema.serverAuthoritative ? "服务器" : "App"} · {schema.samplingPolicy}</td>
                    <td className="mono">{schema.version}</td>
                    <td><button className="l-btn sm mc" disabled={!canWrite || !!mutating || !!loadError} onClick={() => openSchemaPropertyExtension(schema)}>新增字段</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="l-card" data-restored-capability="a4-event-lifecycle" aria-labelledby="a4-lifecycle-title">
        <div className="l-h">
          <span className="ttl" id="a4-lifecycle-title">事件上线进度</span>
          <span className="sub">· 新建 → 待发布 → 分批开放 → 全面开放，按顺序推进</span>
        </div>
        <div className="l-b">
          <table className="l-tbl">
            <thead><tr><th>事件</th><th>当前状态</th><th>版本</th><th style={{ textAlign: "right" }}>操作</th></tr></thead>
            <tbody>{SCHEMA_REGISTRATIONS.map((schema) => {
              const next = ({ new: "pending_publish", pending_publish: "gray", gray: "full", full: "disabled" } as const)[schema.lifecycleState as "new" | "pending_publish" | "gray" | "full"];
              return <tr key={`lifecycle-${schema.eventName}`}>
                <td className="mono">{schema.eventName}</td><td>{lifecycleText(schema.lifecycleState)}</td><td className="mono">v{schema.lifecycleVersion}</td>
                <td style={{ textAlign: "right" }}>{next ? <button className="l-btn sm mc" disabled={!canWrite || !!mutating || !!loadError} onClick={() => transitionLifecycle(schema)}>改为{lifecycleText(next)}</button> : <span className="bdg dim">终态</span>}</td>
              </tr>;
            })}</tbody>
          </table>
        </div>
      </section>

      {/* ───── domain 扩展批次看板 ───── */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">待接入的模块</span>
          <span className="sub">· 数据报表正式启用前须全部完成</span>
          <div className="r">
            <button className="l-btn sm mc" title={canWrite ? undefined : "你只有查看权限"} disabled={!canWrite || !overview || !!loadError || !!mutating} onClick={registerBatch}>登记新模块</button>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 920 }}>
            <thead>
              <tr>
                <th>批次</th><th>新模块 / 事件</th><th>提出方</th>
                <th>状态</th><th>影响</th><th style={{ textAlign: "right" }}></th>
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
                        aria-label={`查看明细：${batchActionTarget(b, i)}`}
                        title={`查看明细：${batchActionTarget(b, i)}`}
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
            <b>为什么必须完成</b> · 没接入的模块（内容、通知、披露、课程）产生的事件暂时没有归类，数据报表正式启用前不接入，以后就要重算历史数据。现有统计不受影响。
          </div>
        </div>
      </section>

      {/* ───── f-foot ───── */}
      <p className="f-foot">
        这页管用户行为事件的名称、字段和分类；后台运营人员的操作记录在「操作记录与审批」。所有修改都只有超级管理员能执行。
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
              命名格式 <span className="acode">模块.对象_动作</span>（动作用过去式），不能包含隐私信息。
              由服务器发出：<b>{operatorCopyText(f.serverAuth)}</b>。
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

              新事件须由超级管理员先登记再使用。
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
            title={`待接入模块 · ${operatorCopyText(b.title)}（${st.label}）`}
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

              接入完成后，之前未归类的事件会统一归到对应模块，不重算历史数据。
            </div>
          </Drawer>
        );
      })()}

      {/* ───── 登记 domain 扩展工单 · 多字段抽屉(domain / 事件名 / 产消方 各一格,不再一个框塞)───── */}
      {naBatch && (
        <Drawer
          title="登记新模块"
          sub="填写模块名、事件名、发送方和使用方"
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
                  if (!canWrite) { toast("你只有查看权限，不能登记"); return; }
                  if (!batchFormValid) { toast("请填写模块名、事件名（动作用过去式）、发送方和使用方"); return; }
                  const stableKey = createA4IdempotencyKey("a4-domain-extension");
                  setNaBatch(false);
                  openActionConfirm({
                    action: `登记新模块 · ${domain}`,
                    detail: (<><b>{domain}</b> · 事件 <span className="acode">{event}</span> · 发送方 {producer || "—"} → 使用方 {consumer || "—"}。</>),
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
                        .then(() => toast(`新模块 ${domain} / ${event} 已提交登记`))
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
                <label style={{ fontSize: 12, color: "var(--ink-3)" }}>模块名 *
                  <input value={batchForm.domain} onChange={(e) => setBatchForm({ ...batchForm, domain: e.target.value })} placeholder="如 referral" style={fst} />
                </label>
                <label style={{ fontSize: 12, color: "var(--ink-3)" }}>事件名（动作用过去式）*
                  <input value={batchForm.event} onChange={(e) => setBatchForm({ ...batchForm, event: e.target.value })} placeholder="如 referral_bound" style={fst} />
                </label>
                <label style={{ fontSize: 12, color: "var(--ink-3)" }}>发送方
                  <input value={batchForm.producer} onChange={(e) => setBatchForm({ ...batchForm, producer: e.target.value })} placeholder="如 团队结算" style={fst} />
                </label>
                <label style={{ fontSize: 12, color: "var(--ink-3)" }}>使用方
                  <input value={batchForm.consumer} onChange={(e) => setBatchForm({ ...batchForm, consumer: e.target.value })} placeholder="如 转化分析、留存报表" style={fst} />
                </label>
                <div className="atint">提交后需超级管理员确认。</div>
              </div>
            );
          })()}
        </Drawer>
      )}
    </>
  );
}

"use client";
import { useReach } from "@/lib/nav/use-reach";
import { operatorCopyText } from "@/lib/admin/operator-copy";

import { A4OutboxDiagnostics, useA4OutboxDiagnostics } from "./a4-outbox-diagnostics";

/**
 * A4 用户行为事件（改版）。App 里用户做的每件事都记成一条事件，报表、任务完成、奖励发放都靠它。
 * 首屏先回答投递健不健康（积压多少、最久多久、模块接没接全），页签分四块：事件目录、投递与死信、统计参数与清理、模块接入。
 *
 * 逻辑和旧页面一样：读取、校验、提交、权限判断、结果未知的保存和恢复都没有改，只换了界面。
 * 三类登记提交审批；参数、上线进度、清理、重新排队直接执行。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Activity, BookOpen, Boxes, CircleHelp, Clock3, FilePlus2, Hourglass, Inbox, Layers, ListTree, Puzzle, Lock, RefreshCw, RotateCcw, ServerCog, SlidersHorizontal, Trash2 } from "lucide-react";
import { OperationConfirmModal, type BusinessFormValue } from "../design-kit";
import {
  BlockState, Button, Cell, Change, ConfigList, ConfigRow, Conclusion, Decision, Drawer, Explain, Fact, Facts, Field, FilterBar, FilterField, Fold,
  Input, IrreversibleTag, MoreMenu, Notice, PageHeader, PageTabs, Pager, Panel, RatioBar, Segments, Stat, StatBand, StatusDistributionBar, StatusTag, Steps,
  Table, TableMessage, Td, Th, Tr, useTabIds,
} from "@/app/components/rd";
import {
  addA4SchemaProperty,
  createA4IdempotencyKey,
  fetchA4RetentionLatest,
  fetchA4SchemaRegistration,
  fetchA4Overview,
  fetchH3DeadOutboxRedrivePreview,
  pendingA4RegistryProposal,
  recoverA4RegistryProposal,
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

import { fetchA2ReasonPolicy, type A2OperationRow } from "@/lib/admin/a2-client";
import { useAdminAuth, type AdminSession } from "@/lib/store/admin-auth";
import { displayAdminError } from "@/lib/admin/error-messages";
import { ALL_L2, CONSOLE_NAV } from "@/lib/nav/console-nav";
import { businessStamp, businessZone } from "@/lib/admin/business-time";
import type { ACtx, ActionConfirmReq } from "./types";
import {
  A4RecoveryNotice, H3_TYPE_TEXT, LIFECYCLE_AFTER, LIFECYCLE_NOW, LIFECYCLE_ORDER, LIFECYCLE_TEXT, LifeDots, NEXT_LIFECYCLE, PRODUCER_TEXT, PROPERTY_TYPE_TEXT, REDRIVE_STATUS,
  consumerParts, eventDesc, moduleText, minute, propertyList, waited, zoneNote, type A4Lifecycle, type A4RecoveryRow, type A4Schema,
} from "./a4-event-views";

/* ────────────────── helpers ────────────────── */

const BATCH_STATE: Record<A4DomainExtensionBatch["state"], { tone: "done" | "progress" | "warn" | "role-other"; label: string }> = {
  done: { tone: "done", label: "已完成" },
  inprogress: { tone: "progress", label: "进行中" },
  pending: { tone: "warn", label: "待登记" },
  scheduled: { tone: "role-other", label: "排期中" },
  registered: { tone: "progress", label: "已登记" },
};

const PAST_ACTION = /(?:ed|sent|paid|held|bound|dau)$/;
const eventNameValid = (value: string) => /^[a-z][a-z0-9_]*\.[a-z0-9]+(?:_[a-z0-9]+)*$/.test(value) && PAST_ACTION.test(value);
const PROPERTY_TYPES = ["string", "number", "boolean", "enum", "timestamp", "id", "json"];
const REGISTRY_FIELD_LABELS: Record<string, string> = {
  eventName: "事件名", ownerDomain: "归属域", domainName: "模块名", producer: "发送方", consumer: "使用方",
  propertyName: "字段名", propertyType: "字段类型", pii: "含个人信息", serverAuthoritative: "服务端裁决",
  samplingPolicy: "采样策略", expectedVersion: "事件目录版本",
};
const REGISTRY_OP_TEXT: Record<string, string> = { a4_schema_register: "登记新事件", a4_schema_property_add: "给事件新增字段", a4_domain_extension_register: "登记新模块" };
type RegistryConfirm = Pick<ActionConfirmReq, "action" | "detail" | "businessForm" | "briefKind" | "title" | "facts" | "statedBrief"> & {
  /** 审批提示下面的一句：批准前什么不变、批准后会怎样。 */
  completion?: string;
  submit?: (actor: AdminSession, reason: string, value?: BusinessFormValue) => Promise<A2OperationRow>;
};

// This is an audited recovery entry, not an event search or a general outbox
// console. It permits one ID at a time and never accepts mutable payload.
const H3_DEAD_REDRIVABLE_EVENT_TYPES = [
  "H3_STOREFRONT_THREE_PRODUCTS_VIEWED",
  "H3_GENESIS_SECONDARY_MARKET_VIEWED",
  "H3_COMPUTE_COMPLETED_50",
  "H3_REFERRAL_REGISTERED",
  "H3_EXCHANGE_COMPLETED",
] as const;

const redriveStatusText = (value: string) => REDRIVE_STATUS[value] ?? "状态未知";
const lifecycleText = (value: string) => LIFECYCLE_TEXT[value as A4Lifecycle] ?? "未知状态";
/** 长事件名只在「.」「_」后面折行，不断在单词中间。 */
const breakable = (name: string) => name.split(/(?<=[._])/).map((part, index) => <span key={index}>{index > 0 && <wbr />}{part}</span>);
/** 重新排队预览的失败摘要：后端只给受控原因码，常见的一个翻成人话，原码跟在后面。 */
const redriveErrorText = (code: string | null | undefined) => !code ? "—" : code === "OUTBOX_DELIVERY_FAILED" ? <>投递失败 <span className="a4-dim" data-mono>{code}</span></> : <span data-mono>{code}</span>;
const pageName = (code: string) => ALL_L2.find((item) => item.id === code)?.name ?? (code.length === 1 ? CONSOLE_NAV.find((domain) => domain.code === code)?.name : undefined);
/** 通用字段里服务端说明说得太满的两项，按后端事实补一句（BF27、BF35）。 */
const COMMON_FIELD_NOTE: Record<string, string> = {
  ts: "可能取自经过校验的发生时间，不一定是系统收到的那一刻。",
  identity: "App 行为事件目前只在登录后记录；注册前的匿名行为不记录，也不会自动关联到注册后的用户。",
};
const SAMPLING_POLICIES = ["100%(资金/风控/转化)", "浏览 0%", "浏览 10%", "会话 25%"];
const LEGACY_OWNER_DOMAINS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"];
const TAB_ITEMS = ["catalog", "delivery", "params", "modules"] as const;
type A4Tab = typeof TAB_ITEMS[number];
type LifeFilter = "all" | A4Lifecycle;

const firstInt = (value: string) => {
  const match = /^\s*(\d{1,4})/.exec(value);
  return match ? Number.parseInt(match[1], 10) : Number.NaN;
};
const effectNow = <StatusTag tone="progress" filled>立即生效</StatusTag>;
const effectApproval = <StatusTag tone="progress" filled explain="提交后建一张审批单，另一位超级管理员在「操作记录与审批」批准后才写入；批准前事件目录、字段和模块都不变。">批准后生效</StatusTag>;

/* ────────────────── 组件 ────────────────── */

export function A4Events({ ctx }: { ctx: ACtx }) {
  const registryActor = useAdminAuth((state) => state.session);
  const authEpoch = useAdminAuth((state) => state.authEpoch);
  const reach = useReach();
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
  // 未登记事件（F04）：后端返回 A4_EVENT_SCHEMA_NOT_FOUND。现在的错误翻译会把这个码换成通用的一句，页面认不出来；
  // 界面已备好「这个事件还没有登记」和去登记的入口，等代码 worker 让这里拿到原因码。
  const [schemaLookupNotFound, setSchemaLookupNotFound] = useState(false);
  const [registryConfirm, setRegistryConfirm] = useState<(RegistryConfirm & { adminId: number; epoch: number; retry?: boolean }) | null>(null);
  const [registryTicket, setRegistryTicket] = useState<{ adminId: number; ticket: A2OperationRow } | null>(null);
  const schemaLookupSequence = useRef(0);
  const schemaLookupEventNameRef = useRef("");
  const outbox = useA4OutboxDiagnostics(canReadOutbox);
  const tabIds = useTabIds();
  const [tab, setTab] = useState<A4Tab>("catalog");
  const [lifeFilter, setLifeFilter] = useState<LifeFilter>("all");
  const [detailEvent, setDetailEvent] = useState<{ name: string; from: "list" | "lookup" } | null>(null);
  const [batchFilter, setBatchFilter] = useState<A4DomainExtensionBatch["state"] | "all">("all");
  const [batchPage, setBatchPage] = useState(1);
  const [batchPageSize, setBatchPageSize] = useState(20);
  const [batchTouched, setBatchTouched] = useState<Record<string, boolean>>({});
  const [schemaPage, setSchemaPage] = useState(1);
  const [schemaPageSize, setSchemaPageSize] = useState(20);

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

  // 首屏要回答「有没有事件卡住」：进入页面按默认条件查一次投递积压（和点「查询」发的请求一样，只读）。
  const outboxLoad = outbox.load;
  const outboxOpened = useRef(false);
  useEffect(() => {
    if (outboxOpened.current || !canReadOutbox) return;
    outboxOpened.current = true;
    void outboxLoad({ eventType: "", status: "", unresolvedOnly: false });
  }, [canReadOutbox, outboxLoad]);

  /* drawers */
  const [famIdx, setFamIdx] = useState<number | null>(null);
  const [batchIdx, setBatchIdx] = useState<number | null>(null);
  // 扩展工单登记:多字段抽屉(不再一个文本框塞「domain / 事件名」整串)
  const [naBatch, setNaBatch] = useState(false);
  const [batchForm, setBatchForm] = useState({ domain: "", event: "", producer: "", consumer: "" });
  const pendingRegistry = registryActor && pendingA4RegistryProposal(registryActor.adminId);
  const currentRegistryTicket = registryTicket?.adminId === registryActor?.adminId ? registryTicket?.ticket : null;

  const currentRegistryActor = () => {
    const current = useAdminAuth.getState();
    if (!current.isAuthenticated || !current.session || current.session.adminId !== registryActor?.adminId
        || current.authEpoch !== authEpoch || !current.session.authorities.includes("platform_a4_write")) {
      throw new Error("登录身份或登记权限已变化，请关闭后重新操作。");
    }
    return current.session;
  };

  const finishRegistry = (ticket: A2OperationRow) => {
    const actor = currentRegistryActor();
    setRegistryTicket({ adminId: actor.adminId, ticket });
    setRegistryConfirm(null);
    setNaBatch(false);
    if (ticket.status === "approved") void refreshOverview(true);
  };

  const recoverRegistry = async (retry = false) => {
    const ticket = await recoverA4RegistryProposal(currentRegistryActor().adminId, retry);
    if (!ticket) return false;
    finishRegistry(ticket);
    return true;
  };

  const openRegistryConfirm = (draft: RegistryConfirm & { retry?: boolean }) => {
    setRegistryConfirm({ ...draft, adminId: currentRegistryActor().adminId, epoch: authEpoch });
  };

  const registryParamFacts = (params: Record<string, unknown>) => (
    <Facts>
      {Object.entries(params).map(([key, value]) => (
        <Fact key={key} k={REGISTRY_FIELD_LABELS[key] ?? key}>{typeof value === "boolean" ? value ? "是" : "否" : String(value)}</Fact>
      ))}
    </Facts>
  );

  const openRegistryRecovery = (retry = false) => {
    if (!pendingRegistry) return false;
    openRegistryConfirm({
      action: "查询原审批单 · " + pendingRegistry.input.obj,
      title: "查询原审批单",
      retry,
      briefKind: "record",
      facts: <>
        <Facts>
          <Fact k="原申请">{REGISTRY_OP_TEXT[pendingRegistry.input.command.op] ?? "登记"}</Fact>
          <Fact k="提交时间">{`${businessStamp(pendingRegistry.createdAt)}（${businessZone().label}）`}</Fact>
        </Facts>
        {registryParamFacts(pendingRegistry.input.command.params)}
      </>,
      detail: <dl>
        {Object.entries(pendingRegistry.input.command.params).map(([key, value]) => (
          <div key={key}><dt>{REGISTRY_FIELD_LABELS[key]}</dt><dd>{typeof value === "boolean" ? value ? "是" : "否" : String(value)}</dd></div>
        ))}
      </dl>,
    });
    return true;
  };

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
  ])).filter((domain) => /^[a-z][a-z0-9_]*$/.test(domain));
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
    openActionConfirm({ briefKind: "config",
      action: "统计参数 · 首笔收益到账时限",
      title: "调整首笔收益到账时限",
      effect: effectNow,
      confirmLabel: "确认调整",
      statedBrief: {
        impact: "关键指标 #1 和用户转化分析按新值重算，历史时段的结果也会变；原始事件不改。",
        check: "提交时后端核对 30–600 秒的整数；和现在一样的值会被拒绝。",
      },
      detail: (
        <>
          当前 <b>{cur}</b>。修改后关键指标 #1 按新值统计，查询历史时段也按新值重算。
        </>
      ),
      amplifies: false,
      edit: { kind: "text", current: cur, unit: "", hint: "30–600 的整数，单位秒，例如 120",
        preview: (value) => {
          const seconds = firstInt(value);
          return seconds >= 30 && seconds <= 600 ? `改成 ${seconds} 秒：注册后 ${seconds} 秒内拿到首笔收益的人，算作「Day0 接入」。` : undefined;
        } },
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
    openActionConfirm({ briefKind: "config",
      action: "统计参数 · 事件留存期",
      title: "调整事件留存期",
      effect: effectNow,
      confirmLabel: "确认调整",
      statedBrief: {
        impact: "不马上删数据；下次清理按新月数判断所有记录，改短会多删旧记录，已删的找不回。",
        check: "提交时后端核对 13–60 的整数月；和现在一样的值会被拒绝。",
      },
      detail: (
        <>
          当前 <b>{cur}</b>。下一次清理时，现有记录都按新的月数判断是否到期；至少保留 13 个月（覆盖一个完整运营周期）。
        </>
      ),
      amplifies: false,
      edit: { kind: "text", current: cur, unit: "", hint: "13–60 的整数，单位月，例如 18",
        preview: (value) => {
          const months = firstInt(value);
          return months >= 13 && months <= 60 ? `改成 ${months} 个月：下次清理删除 ${months} 个月以前、已经结束的记录。` : undefined;
        } },
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
    openActionConfirm({ briefKind: "config",
      action: "统计参数 · 采样率",
      title: "调整浏览和会话的采样率",
      effect: effectNow,
      confirmLabel: "确认调整",
      statedBrief: {
        impact: "只影响之后的浏览、会话类事件：调低后报表这两类数字按比例变少，不回补；资金、风控、转化类始终全记。",
        check: "提交时后端核对 0–100 的整数；资金、风控、转化必须保持 100%。",
      },
      detail: (
        <>
          当前 <b>{cur}</b>。资金、风控、转化类事件始终全部记录，这里只能调浏览和会话类的抽样比例。
        </>
      ),
      amplifies: false,
      edit: { kind: "text", current: cur, unit: "", hint: "填浏览和会话类的百分比，0–100 的整数，例如 20",
        preview: (value) => {
          const percent = Number.parseInt(value.match(/\d{1,3}/)?.[0] || "", 10);
          if (!Number.isFinite(percent) || percent < 0 || percent > 100) return undefined;
          return percent === 0 ? "改成 0%：浏览和会话类之后不再记录；资金、风控、转化类仍全部记录。"
            : `改成 ${percent}%：浏览和会话类每 100 条约记 ${percent} 条；资金、风控、转化类仍全部记录。`;
        } },
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

  const registerSchema = (prefillEventName = "") => {
    if (!canWrite) { toast("你只有查看权限，不能登记事件"); return; }
    if (openRegistryRecovery()) return;
    const ownerDomains = SCHEMA_OWNER_DOMAINS.length ? SCHEMA_OWNER_DOMAINS : LEGACY_OWNER_DOMAINS;
    openRegistryConfirm({ briefKind: "config",
      action: "登记新事件或字段",
      title: "登记新事件",
      completion: "批准前目录不变；批准后从「新建」开始，要再按步推进上线。",
      statedBrief: {
        impact: "",
        check: "提交和批准时都核对格式和版本。",
      },
      detail: "新事件或字段要先登记才能用；事件名写成 模块.对象_动作，动作用过去式，不能含隐私信息。",
      // 改版页用 rd 画的多字段表单；字段键、初值和旧的事件登记表单一样，提交时 submit 读到的值不变。
      businessForm: {
        kind: "multi-field",
        feedback: (value) => value.isPII === "true"
          ? { invalid: true, message: "不得登记包含个人隐私明文的字段", field: "isPII" }
          : { invalid: false, message: "" },
        fields: [
          { key: "eventName", label: "事件名", inputKind: "text", current: prefillEventName, required: true, placeholder: "例如 device.order_paid",
            pattern: "^[a-z][a-z0-9_]*\\.[a-z0-9]+(?:_[a-z0-9]+)*$",
            patternMessage: "事件名称须使用小写字母，以点号分隔模块与动作、以下划线连接单词，例如 user.account_created",
            explain: "写成 模块.对象_动作，动作用过去式（以 ed、sent、paid、held、bound、dau 结尾）。" },
          { key: "ownerDomain", label: "归属模块", inputKind: "select", options: ownerDomains, current: ownerDomains[0], required: true,
            explain: "事件名的模块前缀要和这里一致；只能选已接入的模块和正在接入的新模块。" },
          { key: "producer", label: "发送方", inputKind: "select", options: ["server", "client", "server+client"], current: "server", required: true,
            optionLabels: { server: "服务器", client: "App", "server+client": "服务器和 App" },
            explain: "资金、风控和转化事件必须由服务器发送。" },
          { key: "consumer", label: "使用方", inputKind: "text", current: "", required: true, placeholder: "例如 转化分析、报表、风控" },
          { key: "propName", label: "第一个字段名", inputKind: "text", current: "", required: true, placeholder: "例如 order_id",
            explain: "不能是手机号、地址等隐私明文；用 _hash、_id 结尾的编号可以。" },
          { key: "propType", label: "字段类型", inputKind: "select", options: PROPERTY_TYPES, current: PROPERTY_TYPES[0], required: true,
            optionLabels: Object.fromEntries(PROPERTY_TYPES.map((type) => [type, `${PROPERTY_TYPE_TEXT[type]} ${type}`])) },
          { key: "samplingPolicy", label: "采集比例", inputKind: "select", options: SAMPLING_POLICIES, current: SAMPLING_POLICIES[0], required: true },
          { key: "version", label: "事件目录版本", inputKind: "text", current: liveSchemaVer, required: true, placeholder: liveSchemaVer,
            explain: "填当前目录版本；别人先登记过、版本变了，提交或批准时会被拒绝。" },
          { key: "isServerAuthoritative", label: "由服务器记录", inputKind: "select", options: ["true", "false"], current: "true", required: true,
            optionLabels: { true: "是（资金和状态类必选）", false: "否" } },
          { key: "isPII", label: "含个人隐私信息", inputKind: "select", options: ["false", "true"], current: "false", required: true,
            optionLabels: { false: "不含", true: "含（不能登记）" } },
        ],
      },
      submit: (actor, reason, bv) => {
        const ev = (bv?.eventName || "").trim();
        if (!ev) throw new Error("请填写事件名");
        if (!eventNameValid(ev)) throw new Error("事件名格式应为 模块.对象_动作，动作用过去式");
        if (bv?.isPII === "true") throw new Error("事件不能包含手机号、地址等隐私信息");
        const ver = (bv?.version || "").trim() || liveSchemaVer;
        return registerA4Schema(actor, {
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
        });
      },
    });
  };

  /* ────────────────── 登记 domain 扩展工单 ────────────────── */

  const registerBatch = () => {
    if (!canWrite) { toast("你只有查看权限，不能登记"); return; }
    if (openRegistryRecovery()) return;
    setBatchForm({ domain: "", event: "", producer: "", consumer: "" });
    setBatchTouched({});
    setNaBatch(true);
  };

  const openSchemaPropertyExtension = (schema: A4Overview["schemaRegistrations"][number]) => {
    if (!canWrite) { toast("你只有查看权限，不能新增字段"); return; }
    if (openRegistryRecovery()) return;
    // Both values are frozen before the confirm drawer opens. A later lookup/input
    // response or overview refresh must not redirect this write to another schema.
    const schemaSnapshot = { ...schema };
    // Property writes advance the global registry revision, whereas schema.version is this event's own revision.
    // Freeze the registry value from the overview that the operator reviewed so the server can reject a stale command.
    const registryVersion = overview?.stats.schemaVersion ?? "";
    if (!/^v[1-9][0-9]*$/.test(registryVersion)) {
      toast("事件目录版本获取失败，请刷新后重试");
      return;
    }
    const fields = propertyList(schemaSnapshot.properties);
    openRegistryConfirm({ briefKind: "config",
      action: `给已有事件新增字段 · ${schemaSnapshot.eventName}`,
      title: "给事件新增字段",
      completion: "批准后多一个必填字段，之后不带它的事件会被拒绝；旧事件不补。",
      statedBrief: {
        impact: "",
        check: "提交和批准时都核对字段和版本。",
      },
      facts: <Facts>
        <Fact k="事件"><span data-mono>{schemaSnapshot.eventName}</span></Fact>
        <Fact k="现有字段">{fields.length ? `${fields.length} 个：${fields.map((field) => field.name).join("、")}` : "暂无自定义字段"}</Fact>
        <Fact k="事件目录版本">{registryVersion}</Fact>
      </Facts>,
      detail: <>
        事件版本 <b>{schemaSnapshot.version}</b> · 目录版本 <b>{registryVersion}</b> · 发送方 <span data-mono>{schemaSnapshot.producer}</span> ·
        使用方 <span data-mono>{schemaSnapshot.consumers || "未指定"}</span> · 现有字段 <span data-mono>{schemaSnapshot.properties}</span>。
        这里只能新增一个字段，事件的其他设置不变。
      </>,
      businessForm: {
        kind: "multi-field",
        fields: [
          { key: "propertyName", label: "字段名", current: "", inputKind: "text", required: true, placeholder: "例如 instance_key",
            help: "小写字母开头，只用小写字母、数字和下划线，最多 64 位；不能是手机号、地址等隐私明文" },
          {
            key: "propertyType", label: "字段类型", current: "string", inputKind: "select", required: true,
            options: PROPERTY_TYPES, optionLabels: Object.fromEntries(PROPERTY_TYPES.map((type) => [type, `${PROPERTY_TYPE_TEXT[type]} ${type}`])),
          },
        ],
      },
      submit: (actor, reason, businessValue) => {
        const propertyName = String(businessValue?.propertyName ?? "").trim();
        const propertyType = String(businessValue?.propertyType ?? "").trim();
        if (!/^[a-z][a-z0-9_]{0,63}$/.test(propertyName)) {
          throw new Error("字段名须以小写字母开头，只能包含小写字母、数字和下划线");
        }
        if (!PROPERTY_TYPES.includes(propertyType)) {
          throw new Error("请选择字段类型");
        }
        return addA4SchemaProperty(actor, schemaSnapshot.eventName, propertyName, propertyType, registryVersion, reason);
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
    setSchemaLookupNotFound(false);
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
    setSchemaLookupNotFound(false);
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
        setSchemaLookupNotFound(error instanceof Error && error.message.includes("A4_EVENT_SCHEMA_NOT_FOUND"));
      }
    } finally {
      if (sequence === schemaLookupSequence.current) {
        setSchemaLookupLoading(false);
      }
    }
  };

  const retentionMonths = firstInt(liveEventRetention);
  const retentionCutoff = useMemo(() => {
    if (!Number.isFinite(retentionMonths)) return null;
    const at = new Date();
    at.setMonth(at.getMonth() - retentionMonths);
    return businessStamp(at.getTime()).slice(0, 10);
  }, [retentionMonths]);

  const runRetention = () => {
    if (!canRunRetention) { toast("你没有清理事件的权限"); return; }
    const commandKey = createA4IdempotencyKey("a4-retention-run");
    openActionConfirm({ briefKind: "record",
      action: <>清理过期事件</>,
      title: "立即清理到期的事件记录",
      effect: <><StatusTag tone="progress" filled>立即执行</StatusTag><IrreversibleTag>删了不能恢复</IrreversibleTag></>,
      confirmTone: "danger",
      confirmLabel: "确认清理",
      statedBrief: {
        impact: "直接执行，删了不能恢复；已终止的任务事件删掉后不能再重新排队。",
        check: "执行时后端取当前的留存月数并加锁；已有清理在进行时，这次不删任何数据。",
      },
      facts: <Facts>
        <Fact k="会删掉" tone="danger">{retentionCutoff ? `约 ${retentionCutoff} 之前的记录` : "留存期以前的记录"}</Fact>
        <Fact k="怎么算">执行那一刻往前推 {liveEventRetention || "—"}</Fact>
        <Fact k="删哪些">已发出、已结束和已终止（死信）的事件发送记录；用户行为记录只按时间删</Fact>
        <Fact k="不会删">还在等发送、发送失败等重试的事件；资金账目</Fact>
        <Fact k="一次最多">每张表 2000 条，剩下的下次再清</Fact>
        <Fact k="删多少条">执行后显示在「到期记录清理」</Fact>
      </Facts>,
      detail: <>只清理超过保留期的事件记录：已发出、已结束和已终止的事件发送记录，以及到期的用户行为记录。还在等待发送或发送失败的事件，以及资金账目都不受影响。</>,
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
      toast("请先查询这个事件，确认它已终止后才能重新排队");
      return;
    }
    // The command key is selected in the confirmation callback, when the full
    // normalized request (including the audit reason) is available.
    openActionConfirm({ briefKind: "record",
      action: "重新发送任务事件",
      title: "重新排队这条任务事件",
      effect: <StatusTag tone="progress" filled>立即执行</StatusTag>,
      confirmLabel: "确认重新排队",
      statedBrief: {
        impact: "会再触发一次原来的处理：成功时用户的周任务按这条事件算完成，可能因此发奖；失败会重新停下。不保证奖励补发。",
        check: "执行时后端核对两层都还是已终止、失败次数没变；事件内容、编号和失败次数都不改。",
      },
      facts: <Facts>
        <Fact k="事件编号"><span data-mono>{snapshot.eventId}</span></Fact>
        <Fact k="类型">{H3_TYPE_TEXT[snapshot.eventType] ?? snapshot.eventType}</Fact>
        <Fact k="原事件">{redriveStatusText(snapshot.status)} · 已失败 {snapshot.retryCount} 次</Fact>
        <Fact k="任务处理">{redriveStatusText(snapshot.deliveryStatus)} · 已试 {snapshot.deliveryAttemptCount} 次</Fact>
        <Fact k="最后的失败原因">{redriveErrorText(snapshot.deliveryLastError ?? snapshot.lastError)}</Fact>
      </Facts>,
      detail: (
        <>
          目标事件编号 <span data-mono>{snapshot.eventId}</span> · 类型 <span data-mono>{snapshot.eventType}</span> ·
          事件状态 <b>{snapshot.status === "DEAD" ? "已终止" : "已变化"}</b> · 已失败 {snapshot.retryCount} 次；发送状态 <b>{snapshot.deliveryStatus === "DEAD" ? "已终止" : "已变化"}</b> · 已尝试 {snapshot.deliveryAttemptCount} 次。
          原样重新排队这个事件，内容不做任何修改。只支持以下任务事件：<span data-mono>{H3_DEAD_REDRIVABLE_EVENT_TYPES.join(" / ")}</span>。
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
          toast(`已重新排队：${result.eventId} · ${result.eventType} · ${redriveStatusText(result.status)}`);
        } catch (error) {
          toast(`重新排队结果未知：${displayAdminError(error)}。请先查询当前状态再操作。`);
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
    openActionConfirm({ briefKind: "record",
      action: `更新事件状态 · ${schema.eventName}`,
      title: next === "disabled" ? "停用这个事件" : `把事件改为${lifecycleText(next)}`,
      effect: next === "disabled" ? <>{effectNow}<IrreversibleTag>停用后不能再开放</IrreversibleTag></> : effectNow,
      confirmTone: next === "disabled" ? "danger" : "primary",
      confirmLabel: next === "disabled" ? "确认停用" : `确认改为${lifecycleText(next)}`,
      statedBrief: {
        impact: `推进后${next === "disabled" ? "停用" : `改为${lifecycleText(next)}`}：${LIFECYCLE_AFTER[next]}`,
        check: "后端核对现在的上线进度和版本，只能推进到下一步；别人先改过会被拒绝，刷新后重来。",
      },
      facts: <Facts>
        <Fact k="事件"><span data-mono>{schema.eventName}</span></Fact>
        <Fact k="上线进度"><Change from={lifecycleText(schema.lifecycleState)} to={lifecycleText(next)} tone={next === "disabled" ? "danger" : undefined} /></Fact>
        <Fact k="进度版本">v{schema.lifecycleVersion}</Fact>
      </Facts>,
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

  const readOnly = canWrite ? undefined : "当前账号只能查看这页，登记、调整、推进和清理都不可用";
  const header = (
    <PageHeader pageId="A4" title="用户行为事件" summary="看用户行为事件有没有卡住，调参数、登记新事件。"
      readOnly={readOnly}
      actions={<Button icon={<RefreshCw size={14} aria-hidden />} loading={loading && !!overview} onClick={() => {
        void refreshOverview();
        void refreshRetentionRun();
        if (canReadOutbox) void outbox.load(outbox.applied);
      }}>刷新</Button>} />
  );

  // 原操作提醒：三类登记共用的本人原申请，和这一页里没收到成功结果的重新排队。
  const recoveryRows: A4RecoveryRow[] = [];
  if (canWrite && pendingRegistry) {
    const expired = Date.now() >= pendingRegistry.expiresAt;
    recoveryRows.push({
      key: pendingRegistry.commandKey,
      name: REGISTRY_OP_TEXT[pendingRegistry.input.command.op] ?? "登记",
      change: <span data-mono>{pendingRegistry.input.obj}</span>,
      submittedAt: pendingRegistry.createdAt,
      tag: expired
        ? <StatusTag tone="neutral" icon={Hourglass} explain="原申请超过 24 小时，不能再重试，只能查询原审批单。查不到也不能据此认定没提交。">已过期</StatusTag>
        : <StatusTag tone="warn" icon={CircleHelp} explain="提交时没收到确定结果，可能已经建了审批单。可以查询原结果；24 小时内也可以按原请求重试，后端认得出是同一次提交，不会建第二张。">结果未知</StatusTag>,
      actions: <>
        <Button size="sm" onClick={() => openRegistryRecovery()}>查询原结果</Button>
        <Button size="sm" disabledReason={expired ? "原申请超过 24 小时，不能再重试，只能查询" : undefined} onClick={() => openRegistryRecovery(true)}>按原请求重试</Button>
      </>,
    });
  }
  if (redriveCommand && mutating !== "h3-dead-redrive" && !redriveResult) {
    recoveryRows.push({
      key: `redrive-${redriveCommand.commandKey}`,
      name: "重新排队任务事件",
      change: <><span data-mono>{redriveCommand.eventId}</span> · 理由「{redriveCommand.reason}」</>,
      tag: <StatusTag tone="warn" icon={CircleHelp} explain="提交时没收到成功结果，可能已经重新排队。先查询原结果：重新读这条事件的两层状态。按原请求重试时理由要和原来一样，后端才认得出是同一次，不会再排一次。这条提醒只保存在这个页面里，刷新后就没有了。">结果未知</StatusTag>,
      actions: <>
        <Button size="sm" loading={redrivePreviewing} onClick={() => { setTab("delivery"); void previewH3DeadEvent(); }}>查询原结果</Button>
        <Button size="sm" disabledReason={!redrivePreview || redrivePreview.status !== "DEAD" || redrivePreview.deliveryStatus !== "DEAD" ? "先查询原结果；两层都还是已终止才能重试" : undefined}
          onClick={() => { setTab("delivery"); redriveAuditedH3DeadEvent(); }}>按原请求重试</Button>
      </>,
    });
  }
  const recoveryNotice = (
    <A4RecoveryNotice title={`有 ${recoveryRows.length} 项原操作要处理`} rows={recoveryRows}
      explain={<><p>提交时没收到确定结果，可能已经生效。先查询原结果；24 小时内可以按原请求重试，内容和理由都不变，后端认得出是同一次提交，不会重复执行。</p><p>登记的原申请保存在这个浏览器标签页里，拿到审批单后这条会清掉。参数、上线进度和清理不保存原请求，没收到结果时请到「操作记录与审批」核对。</p></>} />
  );

  if (loadError && !overview) {
    return (
      <div className="a4-page">
        {header}
        <Conclusion state="unknown" icon={Activity}>事件数据读取失败，这页没有判断</Conclusion>
        {recoveryNotice}
        <Panel title="用户行为事件">
          <BlockState state="error" title="事件数据读取失败" detail={<><p>{loadError}</p><p>为避免误判，页面已停止展示和写入。</p></>}
            retryLabel="重新读取" onRetry={() => void refreshOverview()} />
        </Panel>
      </div>
    );
  }
  if (loading && !overview) {
    return (
      <div className="a4-page">
        {header}
        {recoveryNotice}
        <div className="a4-loading" aria-label="正在读取用户行为事件">
          <div className="rd-skeleton a4-skel-line" />
          <div className="a4-skel-stats">{[0, 1, 2, 3].map((index) => <div key={index} className="rd-skeleton" />)}</div>
          <div className="rd-skeleton a4-skel-tabs" />
          <div className="rd-skeleton a4-skel-block" />
        </div>
      </div>
    );
  }

  const writeBlocked = !canWrite ? "你只有查看权限" : !overview ? "事件数据还没读到" : loadError ? "数据刷新失败，先重新读取" : mutating ? "正在提交另一项修改，完成后再操作" : undefined;
  const rowWriteBlocked = !canWrite ? "你只有查看权限" : loadError ? "数据刷新失败，先重新读取" : mutating ? "正在提交另一项修改，完成后再操作" : undefined;
  const diag = outbox.data;
  const backlogTotal = diag?.total;
  const pendingCount = A4_STATS.pendingDomains;

  // 结论：先说投递健不健康，再带一句模块接入。读不到积压时不说正常。
  const conclusion = !canReadOutbox
    ? <Conclusion state="unknown" icon={Activity} hint="投递积压要有用户行为事件的查看权限。">当前账号看不到投递积压，这部分没有判断</Conclusion>
    : outbox.error
      ? <Conclusion state="unknown" icon={Activity} action={<Button size="sm" onClick={() => void outbox.load(outbox.applied)}>重新查询</Button>}>投递积压读取失败，这部分没有判断</Conclusion>
      : !diag
        ? <Conclusion state="neutral" icon={Clock3}>正在查询投递积压…</Conclusion>
        : diag.total > 0
          ? <Conclusion state="warn" icon={Inbox}
              hint={<>到「投递与死信」看卡在哪一步；{pendingCount > 0 ? `另有 ${pendingCount} 个模块待接入。` : "模块都已接入。"}</>}
              explain="积压是还在等发送或发送失败、等下次重试的事件，不含已终止（死信）的；死信没有汇总数，要按事件编号逐条查。">
              有 {diag.total} 条事件没投递出去，最久的已等 {waited(diag.oldestSeconds)}
            </Conclusion>
          : <Conclusion state="ok" icon={Inbox} explain="积压是还在等发送或发送失败、等下次重试的事件，不含已终止（死信）的；死信没有汇总数，要按事件编号逐条查。">
              事件投递正常，没有积压{pendingCount > 0 ? `；还有 ${pendingCount} 个模块待接入` : ""}
            </Conclusion>;

  const stats = (
    <StatBand label="事件概况">
      <Stat lead icon={Inbox} tone={backlogTotal ? "warn" : undefined} iconTone={backlogTotal ? "warn" : "role-2"} label="没投递出去"
        value={!canReadOutbox ? "无权限" : diag ? String(diag.total) : "—"} unit={diag ? "条" : undefined}
        sub={!canReadOutbox ? undefined : diag ? (diag.total > 0 ? `最久已等 ${waited(diag.oldestSeconds)}` : "没有积压") : outbox.error ? "读取失败" : "正在查询"}
        explain="还在等发送或发送失败、等下次重试的事件。不含已终止（死信）的。"
        onOpen={() => setTab("delivery")} openLabel="查看没投递出去的事件" />
      <Stat icon={Activity} tone="role-2" label="今日事件" value={A4_STATS.todayEvents} unit="条"
        explain="今天（业务日）开始以来记下的事件条数，含没登记的类型，不管有没有投递成功；不是用户数。" />
      <Stat icon={Puzzle} tone="role-3" label="已接入模块" value={String(A4_STATS.registeredDomains)} unit="个"
        sub={pendingCount > 0 ? `另有 ${pendingCount} 个待接入` : "没有待接入"}
        explain="按内置清单和登记的接入工单算出来，不是检测 App 是否真的接上。"
        onOpen={() => setTab("modules")} openLabel="查看模块接入" />
      <Stat icon={Layers} tone="role-3" label="接入批次完成" value={String(batchDone)} unit={`/ ${batchTotal} 批`}
        explain="只算已完成的批次；进行中、待登记、排期中都不算。"
        onOpen={() => setTab("modules")} openLabel="查看接入批次" />
    </StatBand>
  );

  const ticketNotice = currentRegistryTicket && (() => {
    const t = currentRegistryTicket;
    const tone = t.status === "approved" ? "ok" : t.status === "rejected" ? "danger" : t.status === "pending" ? "warn" : "done";
    const text = {
      pending: "已提交，等另一位超级管理员批准；批准前事件目录不变。",
      approved: "已批准，事件目录已重新读取。",
      rejected: "被驳回，事件目录没有变化。",
      withdrawn: "已撤回，事件目录没有变化。",
      expired: "已过期，事件目录没有变化。",
    }[t.status];
    return (
      <Notice tone={tone} title={`登记审批单 ${t.id}`}
        action={registryActor?.authorities.includes("platform_a2_read") ? <Link className="rd-link" href="/platform/audit">查看操作记录与审批</Link> : undefined}>
        {text}
      </Notice>
    );
  })();

  /* ── 事件目录 ── */
  const lifeCounts = Object.fromEntries(LIFECYCLE_ORDER.map((state) => [state, SCHEMA_REGISTRATIONS.filter((schema) => schema.lifecycleState === state).length])) as Record<A4Lifecycle, number>;
  const shownSchemas = lifeFilter === "all" ? SCHEMA_REGISTRATIONS : SCHEMA_REGISTRATIONS.filter((schema) => schema.lifecycleState === lifeFilter);
  const todayTotal = Number(A4_STATS.todayEvents);
  // 表里只写前三个加「等 N 个」，全部写在详情抽屉里；悬停也能看全。
  const consumersOf = (consumers: string, all = false) => {
    const parts = consumerParts(consumers, pageName);
    if (!parts.length) return <span className="a4-dim">未指定</span>;
    const full = parts.map((part) => part.text).join("、");
    if (all || parts.length <= 3) return <span title={all ? undefined : full}>{full}</span>;
    return <span title={full}>{parts.slice(0, 3).map((part) => part.text).join("、")} <span className="a4-dim">等 {parts.length} 个</span></span>;
  };
  const moduleCell = (code: string) => {
    const name = moduleText(code);
    return name ? <span title={`模块代码 ${code}`}>{name}</span> : <span data-mono>{code}</span>;
  };
  const schemaActions = (schema: A4Schema) => {
    const next = NEXT_LIFECYCLE[schema.lifecycleState];
    const items = [
      ...(next ? [{ key: "next", label: next === "disabled" ? "停用这个事件" : `改为${lifecycleText(next)}`, danger: next === "disabled", disabledReason: rowWriteBlocked, onSelect: () => transitionLifecycle(schema) }] : []),
      { key: "field", label: "新增字段", disabledReason: rowWriteBlocked, onSelect: () => openSchemaPropertyExtension(schema) },
    ];
    return <MoreMenu label={`${schema.eventName} 的操作`} items={items} />;
  };

  const catalogTab = (
    <>
      <Panel title="事件类别" icon={ListTree} tone="role-2" sub={`${EVENT_FAMILIES.length} 类 · 今日共 ${A4_STATS.todayEvents} 条`}
        explain="每一类事件管一组统计用途。点一类看它包含哪些事件、每个事件记的是什么。类别和说明由系统固定给出。">
        <div className="a4-family-grid">
          {EVENT_FAMILIES.map((family, index) => {
            const count = Number(family.todayCount);
            const all = family.serverAuth.includes("全部");
            return (
              <button key={family.key} type="button" className="a4-family" onClick={() => setFamIdx(index)} aria-label={`${operatorCopyText(family.title)}，今日 ${family.todayCount} 条，查看事件清单`}>
                <span className="a4-family-head">
                  <span className="a4-family-title">{operatorCopyText(family.title)}</span>
                  <span className="a4-family-auth" title={operatorCopyText(family.serverAuth)}><ServerCog size={14} aria-hidden />{all ? "全部由系统记录" : "部分由系统记录"}</span>
                </span>
                <span className="a4-family-sub">{operatorCopyText(family.sub)}</span>
                <span className="a4-family-num" data-zero={count === 0 ? "" : undefined}>今日 <b>{family.todayCount}</b> 条</span>
                <RatioBar quiet label={`${operatorCopyText(family.title)}占今日事件`} value={Number.isFinite(count) ? count : 0} total={Number.isFinite(todayTotal) ? todayTotal : 0}
                  valueText={`今日 ${family.todayCount} 条，共 ${A4_STATS.todayEvents} 条`} tone="role-2" state={todayTotal > 0 ? "ready" : "empty"} emptyText="今天还没有事件" />
                <span className="a4-family-foot">{family.events.length} 类事件 · 查看清单</span>
              </button>
            );
          })}
        </div>
      </Panel>

      <Panel data-restored-capability="a4-event-lifecycle" aria-labelledby="a4-lifecycle-title" icon={BookOpen} tone="role-2"
        title={<span id="a4-lifecycle-title">最近登记的事件和上线进度</span>}
        sub={`最近 ${SCHEMA_REGISTRATIONS.length} 条 · 事件目录版本 ${liveSchemaVer}`}
        explain={<><p>只列最近登记或更新的 {SCHEMA_REGISTRATIONS.length} 个事件，不是全部；查其他事件在下面输入完整事件名。</p><p>上线进度按顺序推进：新建 → 待发布 → 分批开放 → 全面开放 → 已停用，每次只能走一步，直接生效。</p></>}
        actions={<Button size="sm" variant="primary" icon={<FilePlus2 size={14} aria-hidden />} disabledReason={writeBlocked} onClick={() => registerSchema()}>登记新事件</Button>}>
        <Segments label="按上线进度筛选" value={lifeFilter} onChange={(value) => { setLifeFilter(value); setSchemaPage(1); }}
          items={[{ value: "all" as LifeFilter, label: "全部", count: SCHEMA_REGISTRATIONS.length }, ...LIFECYCLE_ORDER.map((state) => ({
            value: state as LifeFilter, label: LIFECYCLE_TEXT[state], count: lifeCounts[state],
            tone: state === "full" ? "ok" as const : state === "disabled" ? "done" as const : "progress" as const,
          }))]} />
        <Table label="最近登记的事件" className="a4-schema-table">
          <thead><tr>
            <Th>事件</Th><Th>产生模块</Th><Th align="right">字段</Th><Th>上线进度</Th><Th>谁在用</Th><Th sticky="end" align="right">操作</Th>
          </tr></thead>
          <tbody>
            {shownSchemas.slice((schemaPage - 1) * schemaPageSize, schemaPage * schemaPageSize).map((schema) => {
              const desc = eventDesc(overview, schema.eventName);
              const count = propertyList(schema.properties).length;
              return (
                <Tr key={schema.eventName} selected={detailEvent?.from === "list" && detailEvent.name === schema.eventName}
                  onOpen={() => setDetailEvent({ name: schema.eventName, from: "list" })}>
                  <Td><span className="a4-ename">{desc && <span className="a4-ename-desc">{desc}</span>}<span data-mono>{breakable(schema.eventName)}</span></span></Td>
                  <Td>{moduleCell(schema.ownerDomain)}</Td>
                  <Td align="right">{count ? <><span data-num>{count}</span> 个</> : <span className="a4-dim">—</span>}</Td>
                  <Td><LifeDots state={schema.lifecycleState} /></Td>
                  <Td>{consumersOf(schema.consumers)}</Td>
                  <Td sticky="end" align="right" data-fit="">{schemaActions(schema)}</Td>
                </Tr>
              );
            })}
            {!shownSchemas.length && <TableMessage columns={6}>{SCHEMA_REGISTRATIONS.length ? `没有处在「${LIFECYCLE_TEXT[lifeFilter as A4Lifecycle]}」的事件` : "最近没有登记的事件"}</TableMessage>}
          </tbody>
        </Table>
        {shownSchemas.length > 10 && <Pager label="最近登记的事件分页" total={shownSchemas.length} page={schemaPage} pageSize={schemaPageSize} sizes={[10, 20, 50]}
          onPage={setSchemaPage} onPageSize={(size) => { setSchemaPageSize(size); setSchemaPage(1); }} />}
        <div className="a4-lookup">
          <FilterBar onSubmit={() => void lookupSchemaRegistration()} querying={schemaLookupLoading}
            notice={schemaLookupError && !schemaLookupNotFound ? schemaLookupError : undefined}>
            <FilterField label="查其他已登记的事件" grow>
              <Input aria-label="精确事件名" value={schemaLookupEventName} placeholder="输入完整事件名，例如 quest.completed"
                aria-invalid={schemaLookupError && !schemaLookupNotFound ? true : undefined}
                onChange={(event) => resetSchemaLookup(event.target.value)} disabled={!canRead || !!loadError} />
            </FilterField>
          </FilterBar>
          {schemaLookupNotFound && (
            <Notice tone="warn" title="这个事件还没有登记"
              action={canWrite ? <Button size="sm" disabledReason={writeBlocked} onClick={() => registerSchema(schemaLookupEventName.trim())}>登记这个事件</Button> : undefined}>
              <span data-mono>{schemaLookupEventName.trim()}</span> 不在事件目录里，先登记并等批准才能用。
            </Notice>
          )}
          {schemaLookup && (
            <div className="a4-lookup-hit">
              <span className="a4-pair"><span data-mono>{schemaLookup.eventName}</span><LifeDots state={schemaLookup.lifecycleState} /></span>
              <span className="a4-dim">{moduleText(schemaLookup.ownerDomain) ?? schemaLookup.ownerDomain} · {propertyList(schemaLookup.properties).length} 个字段</span>
              <Button size="sm" onClick={() => setDetailEvent({ name: schemaLookup.eventName, from: "lookup" })}>查看详情</Button>
            </div>
          )}
        </div>
      </Panel>

      <Fold title="每条事件都带的字段" summary={`${COMMON_FIELDS.length} 项，所有事件固定带上`} icon={Boxes}
        explain="这些是事件外层的通用字段，说明由系统给出；不是某条事件的具体内容，也不显示用户隐私原文。">
        {COMMON_FIELDS.length ? (
          <Table label="通用字段" className="a4-common-table">
            <thead><tr><Th>字段</Th><Th>记的是什么</Th><Th>要求</Th></tr></thead>
            <tbody>
              {COMMON_FIELDS.map((field) => (
                <Tr key={field.key}>
                  <Td>{field.key === "misc" ? field.name : <span data-mono>{field.name}</span>}</Td>
                  <Td><span className="a4-pair">{operatorCopyText(field.sub)}{COMMON_FIELD_NOTE[field.key] && <Explain label={`${field.name}的补充说明`} content={COMMON_FIELD_NOTE[field.key]} />}</span></Td>
                  <Td>{field.value}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        ) : <BlockState state="empty" title="暂无通用字段" />}
      </Fold>

      <Fold title="事件从产生到报表" summary={`产生 → 去重 → 保留 ${liveEventRetention || "—"} → 分析和对账`} icon={Activity}>
        <ol className="a4-flow" aria-label="事件流向">
          <li><b>产生</b><span>资金和状态类由服务器在业务发生时记录；App 只发页面浏览、点击和商城浏览这几类行为，而且只在用户登录后记录。</span></li>
          <li><b>去重</b><span>服务器事件按系统生成的事件编号去重；App 事件按 App 生成的编号去重。</span></li>
          <li><b>保留</b><span>留存期 {liveEventRetention || "—"}，到期的记录按「统计参数与清理」里的规则删除。</span></li>
          <li><b>使用</b><span>用户转化分析、数据报表、风控和对账；关键指标大多只统计服务器记录的事件，商城浏览和推送点击例外，也统计 App 上报的。</span></li>
        </ol>
        <p className="a4-note">资金账不靠这些行为事件记账；新事件和新字段要先登记、经另一位超级管理员批准才能用。</p>
      </Fold>
    </>
  );

  /* ── 投递与死信 ── */
  const redriveBlocked = !canRedriveH3Dead ? "你没有重新排队任务事件的权限（要有事件修改和操作审批的写权限）" : loadError ? "数据刷新失败，先重新读取" : mutating ? "正在提交另一项修改，完成后再操作" : undefined;
  const deliveryTab = (
    <>
      <A4OutboxDiagnostics state={outbox} describe={(eventType) => eventDesc(overview, eventType)} />
      <Panel title="重新排队一条任务事件" icon={RotateCcw} tone="role-2" sub="每次一条 · 只限 5 种周任务事件"
        explain={<><p>用户完成了周任务却没拿到奖励时，可能是任务事件发送失败、已终止（死信）。在这里输入事件编号，查到两层都已终止，就能把它重新排队一次。</p><p>死信没有汇总数，要按事件编号逐条查。只支持这 5 种：{H3_DEAD_REDRIVABLE_EVENT_TYPES.map((type) => H3_TYPE_TEXT[type]).join("；")}。</p></>}>
        <FilterBar onSubmit={() => void previewH3DeadEvent()} querying={redrivePreviewing}
          notice={redrivePreviewError ? `查询失败：${redrivePreviewError}` : undefined}
          action={<Button variant="primary" disabledReason={redriveBlocked ?? (redrivePreviewing ? "正在查询" : undefined)} loading={redrivePreviewing} onClick={() => void previewH3DeadEvent()}>查询</Button>}>
          <FilterField label="任务事件编号" grow>
            <Input value={redriveEventId} onChange={(event) => resetRedriveTarget(event.target.value)} placeholder="输入一个任务事件编号，8–64 位"
              aria-label="任务事件编号" aria-invalid={redrivePreviewError ? true : undefined} disabled={!canRedriveH3Dead || !!mutating} data-search="" />
          </FilterField>
        </FilterBar>
        <div data-proof="a4-h3-dead-redrive" className="a4-redrive">
          {!canRedriveH3Dead && !redrivePreview && !redriveResult && !redrivePreviewError && !redrivePreviewing && (
            <p className="a4-note">{canRedriveH3Dead ? "" : "当前账号不能查询或重新排队任务事件。"}</p>
          )}
          {redrivePreview && (
            <div className="a4-redrive-card">
              <div className="a4-redrive-head">
                <span className="a4-redrive-type">{H3_TYPE_TEXT[redrivePreview.eventType] ?? redrivePreview.eventType}</span>
                <span data-mono>{redrivePreview.eventId}</span>
              </div>
              <ol className="a4-layers" aria-label="卡在哪一步">
                <li data-dead={redrivePreview.status === "DEAD" ? "" : undefined}>
                  <span className="a4-layer-name">原事件</span>
                  <StatusTag tone={redrivePreview.status === "DEAD" ? "danger" : "neutral"}>{redriveStatusText(redrivePreview.status)}</StatusTag>
                  <span className="a4-dim">已失败 {redrivePreview.retryCount} 次</span>
                  <span className="a4-layer-err">{redriveErrorText(redrivePreview.lastError)}</span>
                </li>
                <li data-dead={redrivePreview.deliveryStatus === "DEAD" ? "" : undefined}>
                  <span className="a4-layer-name">任务处理</span>
                  <StatusTag tone={redrivePreview.deliveryStatus === "DEAD" ? "danger" : "neutral"}>{redriveStatusText(redrivePreview.deliveryStatus)}</StatusTag>
                  <span className="a4-dim">已试 {redrivePreview.deliveryAttemptCount} 次</span>
                  <span className="a4-layer-err">{redriveErrorText(redrivePreview.deliveryLastError)}</span>
                </li>
              </ol>
              <div className="rd-toolbar" data-end="">
                <span className="rd-toolbar-note">只放回发送队列，不改内容</span>
                <Button variant="primary" icon={<RotateCcw size={14} aria-hidden />}
                  disabledReason={redriveBlocked ?? (redrivePreview.status !== "DEAD" || redrivePreview.deliveryStatus !== "DEAD" ? "两层都已终止才能重新排队" : undefined)}
                  onClick={redriveAuditedH3DeadEvent}>重新排队</Button>
              </div>
            </div>
          )}
          {redriveResult && (
            <Notice tone="ok" title="已重新排队">
              <span data-mono>{redriveResult.eventId}</span> · {H3_TYPE_TEXT[redriveResult.eventType] ?? redriveResult.eventType}：原事件 {redriveStatusText(redriveResult.status)}，任务处理 {redriveStatusText(redriveResult.deliveryStatus)}。只代表已排队，不代表任务已完成。
            </Notice>
          )}
        </div>
      </Panel>
    </>
  );

  /* ── 统计参数与清理 ── */
  const lastCleanup = retentionRun
    ? retentionRun.lockAcquired
      ? <>上次删除了 {minute(retentionRun.evaluatedAt)} 之前的记录</>
      : <>{minute(retentionRun.evaluatedAt)} 那次有别的清理在进行，没有删除</>
    : retentionRunError ? <span className="a4-warn">上次清理结果读取失败</span> : <span className="a4-dim">没有读到上次手动清理的结果</span>;
  const paramMeta: Record<string, { what: string; when: string; effect: string; open: () => void }> = {
    day0: { what: "注册后多少秒内拿到首笔收益，算作 Day0 接入", when: "确认后立即生效", effect: "关键指标 #1 和用户转化分析每次查询都按现在的值重算，改了以后历史时段的结果也会变；原始事件不改。30–600 秒。", open: adjDay0 },
    event_retention: { what: "事件记录保留多少个月", when: "确认后立即生效，不会马上删数据", effect: "下一次清理时按新的月数算：改短会让更多旧记录被删，以前记下的也一样；改长只会让以后少删，已经删掉的找不回来。13–60 个月。", open: adjEventRetention },
    sampling: { what: "浏览和会话类事件抽多少比例记下来", when: "确认后立即生效，只管之后新进来的事件", effect: "调低后报表里浏览、会话类的数字按比例变少，调高也补不回以前没记的；资金、风控、转化类始终 100%。0–100%。", open: adjSampling },
  };
  const paramsTab = (
    <>
      <Panel title="统计参数" icon={SlidersHorizontal} tone="role-4" sub={`${KPI_DIMENSION_PARAMS.filter((param) => !param.locked).length} 项可调整`}
        explain="三项可以调整，确认后立即生效，不走审批；留存统计方式是系统固定的。">
        <ConfigList label="统计参数">
          {KPI_DIMENSION_PARAMS.map((param) => {
            if (param.locked) {
              return <ConfigRow key={param.key} name={operatorCopyText(param.name)} what={operatorCopyText(param.sub)} when="系统固定"
                note="和关键指标 #2 一致，不能修改。" value={param.value} sub={<StatusTag tone="neutral" icon={Lock}>系统固定</StatusTag>} />;
            }
            const meta = paramMeta[param.key] ?? paramMeta.sampling;
            const name = param.key === "day0" ? "首笔收益到账时限" : param.key === "event_retention" ? "事件留存期" : param.key === "sampling" ? "采样率" : operatorCopyText(param.name);
            const live = param.key === "day0" ? liveDay0 : param.key === "event_retention" ? liveEventRetention : param.key === "sampling" ? liveSampling : param.value;
            return (
              <ConfigRow key={param.key} name={name} what={meta.what} when={meta.when} effect={meta.effect}
                note={param.key === "day0" ? `系统里叫「${operatorCopyText(param.name)}」：${operatorCopyText(param.sub)}` : operatorCopyText(param.sub)}
                value={live || "—"}
                action={canWrite ? (describedBy) => <Button size="sm" aria-describedby={describedBy} disabledReason={writeBlocked} onClick={meta.open}>调整</Button> : undefined} />
            );
          })}
          <ConfigRow name="到期记录清理" what="删除超过留存期的事件记录" when="点「立即清理」时执行，不走审批"
            effect="删掉已结束和已终止的事件发送记录、到期的用户行为记录，不归档、不能恢复；还在等发送或发送失败的事件和资金账目不删。每张表一次最多 2000 条。"
            note="上次清理只读得到最近一次手动清理。读不到不代表从没清理过。"
            value={lastCleanup}
            sub={retentionRun?.lockAcquired ? `发送记录 ${retentionRun.outboxRows} 条 · 行为记录 ${retentionRun.behaviorFactRows} 条 · 按 ${retentionRun.retentionMonths} 个月` : undefined}
            action={!canRunRetention ? undefined : (describedBy) => <Button size="sm" variant="danger-outline" icon={<Trash2 size={14} aria-hidden />} aria-describedby={describedBy}
              disabledReason={!canRunRetention ? "你没有清理事件的权限（要有事件修改和操作审批的写权限）" : !overview ? "事件数据还没读到" : loadError ? "数据刷新失败，先重新读取" : mutating ? "正在提交另一项修改，完成后再操作" : undefined}
              onClick={runRetention}>立即清理</Button>} />
        </ConfigList>
        {retentionRun && <p className="a4-note">{zoneNote()}</p>}
      </Panel>

      <Fold title="八项关键指标怎么算" summary={`${KPI_FORMULAS.length} 项，用上面的事件统计`} icon={Activity}
        explain="这里只是计算方式的说明，不是指标的数值，也不能在这里修改。#1 跟着首笔收益到账时限变。"
        actions={reach("/analytics/kpi", "bi_l1_read") ? <Link className="rd-link" href="/analytics/kpi">查看关键指标</Link> : undefined}>
        <Table label="关键指标计算方式" className="a4-kpi-table">
          <thead><tr><Th align="right">#</Th><Th>关键指标</Th><Th>怎么算</Th></tr></thead>
          <tbody>
            {KPI_FORMULAS.map((kpi) => (
              <Tr key={kpi.n}><Td align="right"><span data-num>{kpi.n}</span></Td><Td>{operatorCopyText(kpi.kpi)}</Td><Td grow>{operatorCopyText(kpi.formula)}</Td></Tr>
            ))}
          </tbody>
        </Table>
        <p className="a4-note">用户转化与留存按 注册 → 首购 → 复购 → 提现 分步统计，可按注册周、运营阶段、渠道查看。</p>
      </Fold>
    </>
  );

  /* ── 模块接入 ── */
  const batchCounts = Object.fromEntries((Object.keys(BATCH_STATE) as A4DomainExtensionBatch["state"][]).map((state) => [state, DOMAIN_EXTENSIONS.filter((batch) => batch.state === state).length])) as Record<A4DomainExtensionBatch["state"], number>;
  const shownBatches = DOMAIN_EXTENSIONS.map((batch, index) => ({ batch, index })).filter(({ batch }) => batchFilter === "all" || batch.state === batchFilter);
  const pageBatches = shownBatches.slice((batchPage - 1) * batchPageSize, batchPage * batchPageSize);
  const modulesTab = (
    <>
      <Panel title="模块" icon={Puzzle} tone="role-3" sub={`已接入 ${REGISTERED_DOMAINS.length} 个 · 待接入 ${PENDING_DOMAINS.length} 个`}
        explain="按内置清单和登记的接入工单算出来，不是检测 App 是否真的接上。待接入的模块还有没完成的接入工单。">
        <div className="a4-domains" aria-label="模块">
          {PENDING_DOMAINS.map((domain) => <span key={`p-${domain}`} className="a4-chip" data-pending="" title={`模块代码 ${domain}`}>{moduleText(domain) ?? <span data-mono>{domain}</span>}<small>待接入</small></span>)}
          {REGISTERED_DOMAINS.map((domain) => <span key={`r-${domain}`} className="a4-chip" title={`模块代码 ${domain}`}>{moduleText(domain) ?? <span data-mono>{domain}</span>}</span>)}
        </div>
      </Panel>
      <Panel title="接入批次" icon={Layers} tone="role-3" sub={`完成 ${batchDone} / ${batchTotal} 批`}
        explain="一个批次是一组要接入的模块或事件。登记新模块只建接入工单，不会自动接上发送和使用的代码，也不会自动建事件；批次的状态在这里只能查看。"
        actions={<Button size="sm" variant="primary" icon={<FilePlus2 size={14} aria-hidden />} disabledReason={writeBlocked} onClick={registerBatch}>登记新模块</Button>}>
        <StatusDistributionBar label="接入批次按状态" selectedKey={batchFilter === "all" ? undefined : batchFilter}
          state={DOMAIN_EXTENSIONS.length ? "ready" : "empty"} emptyText="还没有接入批次"
          segments={(Object.keys(BATCH_STATE) as A4DomainExtensionBatch["state"][]).map((state) => ({
            key: state, label: BATCH_STATE[state].label, value: batchCounts[state], text: `${batchCounts[state]} 批`, tone: BATCH_STATE[state].tone,
            onSelect: () => { setBatchFilter(batchFilter === state ? "all" : state); setBatchPage(1); },
          }))} />
        {batchFilter !== "all" && <p className="a4-note">只看「{BATCH_STATE[batchFilter].label}」· {shownBatches.length} 批 <button type="button" className="rd-link" onClick={() => { setBatchFilter("all"); setBatchPage(1); }}>显示全部</button></p>}
        <Table label="接入批次" className="a4-batch-table">
          <thead><tr><Th>批次</Th><Th>新模块</Th><Th>提出方</Th><Th>状态</Th><Th>影响</Th><Th sticky="end" align="right">操作</Th></tr></thead>
          <tbody>
            {pageBatches.map(({ batch, index }) => {
              const state = BATCH_STATE[batch.state];
              return (
                <Tr key={batch.id} selected={batchIdx === index} onOpen={() => setBatchIdx(index)}>
                  <Td><span className="a4-ename" title={`工单 ${batch.id}`}><span className="a4-ename-desc">{operatorCopyText(batch.title)}</span><span data-mono>{batch.details.length > 0 ? breakable(batch.details[0].item) : `工单 ${batch.id}`}</span></span></Td>
                  <Td>{batch.newDomains.length > 0
                    ? <span className="a4-domains" data-inline="">{batch.newDomains.map((domain) => <span key={domain.name} className="a4-chip" data-pending={domain.n ? "" : undefined} title={moduleText(domain.name) ? `模块代码 ${domain.name}` : undefined}>{moduleText(domain.name) ?? <span data-mono>{domain.name}</span>}</span>)}</span>
                    : <span className="a4-dim">核对后台操作事件清单</span>}</Td>
                  <Td><Cell main={batch.proposer} title={batch.proposer} /></Td>
                  <Td><StatusTag tone={state.tone === "role-other" ? "neutral" : state.tone}>{state.label}</StatusTag></Td>
                  <Td grow><span className="a4-clamp" title={operatorCopyText(batch.impact)}>{operatorCopyText(batch.impact)}</span></Td>
                  <Td sticky="end" align="right" data-fit="">
                    <Button size="sm" aria-label={`查看明细：${batchActionTarget(batch, index)}`} onClick={() => setBatchIdx(index)}>明细</Button>
                  </Td>
                </Tr>
              );
            })}
            {!pageBatches.length && <TableMessage columns={6}>{DOMAIN_EXTENSIONS.length ? "没有这个状态的批次" : "还没有接入批次"}</TableMessage>}
          </tbody>
        </Table>
        {shownBatches.length > 0 && <Pager label="接入批次分页" total={shownBatches.length} page={batchPage} pageSize={batchPageSize} sizes={[10, 20, 50]}
          onPage={setBatchPage} onPageSize={(size) => { setBatchPageSize(size); setBatchPage(1); }} />}
      </Panel>
    </>
  );

  const detailSchema = detailEvent ? (detailEvent.from === "lookup" ? (schemaLookup?.eventName === detailEvent.name ? schemaLookup : null) : SCHEMA_REGISTRATIONS.find((schema) => schema.eventName === detailEvent.name) ?? null) : null;
  const detailIndex = detailSchema && detailEvent?.from === "list" ? shownSchemas.findIndex((schema) => schema.eventName === detailSchema.eventName) : -1;
  const family = famIdx !== null ? EVENT_FAMILIES[famIdx] as A4EventFamily | undefined : undefined;
  const batch = batchIdx !== null ? DOMAIN_EXTENSIONS[batchIdx] as A4DomainExtensionBatch | undefined : undefined;
  const batchIssue = (key: keyof typeof batchForm): string | undefined => {
    const value = batchForm[key].trim();
    if (!batchTouched[key]) return undefined;
    if (!value) return key === "domain" ? "请填写模块名" : key === "event" ? "请填写事件名" : key === "producer" ? "请填写发送方" : "请填写使用方";
    if (key === "domain" && !batchDomainValid) return "2–32 位，小写字母开头，只用小写字母、数字和下划线";
    if (key === "event" && !batchEventValid) return "小写字母和数字，单词用下划线连接，动作用过去式";
    return undefined;
  };
  const batchMissing = [
    !batchForm.domain.trim() ? "模块名" : !batchDomainValid ? "模块名格式" : "",
    !batchForm.event.trim() ? "事件名" : !batchEventValid ? "事件名格式" : "",
    !batchForm.producer.trim() ? "发送方" : "",
    !batchForm.consumer.trim() ? "使用方" : "",
  ].filter(Boolean);

  return (
    <>
      <div className="a4-page">
      {header}
      {recoveryNotice}
      {ticketNotice}
      {loadError && overview && (
        <Notice tone="warn" title="刷新失败" action={<Button size="sm" onClick={() => void refreshOverview()}>重试</Button>}>
          {loadError}。下面是上次读到的数据，写入先停用。
        </Notice>
      )}
      {conclusion}
      {stats}
      <PageTabs label="用户行为事件内容" ids={tabIds} value={tab} onChange={setTab} items={[
        { value: "catalog", label: "事件目录" },
        { value: "delivery", label: "投递与死信", count: !canReadOutbox ? undefined : backlogTotal ?? "—" },
        { value: "params", label: "统计参数与清理" },
        { value: "modules", label: "模块接入", count: pendingCount },
      ]} />
      <div {...tabIds.panel(tab)} className="rd-tab-pane a4-pane">
        {tab === "catalog" && catalogTab}
        {tab === "delivery" && deliveryTab}
        {tab === "params" && paramsTab}
        {tab === "modules" && modulesTab}
      </div>
      </div>

      {/* ───── 事件类别的事件清单 ───── */}
      <Drawer open={!!family} onClose={() => setFamIdx(null)} icon={ListTree} tone="role-2"
        title={family ? operatorCopyText(family.title) : "事件清单"}
        sub={family ? `事件清单 · ${family.events.length} 类事件 · 今日 ${family.todayCount} 条` : undefined}
        explain="命名格式是「模块.对象_动作」，动作用过去式；不能包含隐私信息。新事件要先登记、经另一位超级管理员批准后才能用。">
        {family && <>
          <Facts>
            <Fact k="统计用途">{operatorCopyText(family.sub)}</Fact>
            <Fact k="由系统记录">{operatorCopyText(family.serverAuth)}</Fact>
          </Facts>
          <Table label="事件清单" className="a4-family-table">
            <thead><tr><Th>事件</Th><Th>记的是什么</Th></tr></thead>
            <tbody>
              {family.events.map((event) => (
                <Tr key={event.item}><Td><span data-mono>{event.item}</span></Td><Td grow>{operatorCopyText(event.desc)}</Td></Tr>
              ))}
              {!family.events.length && <TableMessage columns={2}>这一类没有列出事件</TableMessage>}
            </tbody>
          </Table>
        </>}
      </Drawer>

      {/* ───── 单个事件的详情：上线进度、字段、谁在用 ───── */}
      <Drawer open={!!detailSchema} onClose={() => setDetailEvent(null)} icon={BookOpen} tone="role-2"
        title={detailSchema ? eventDesc(overview, detailSchema.eventName) ?? "事件详情" : "事件详情"}
        sub={detailSchema ? <span data-mono>{detailSchema.eventName}</span> : undefined}
        nav={detailIndex >= 0 ? {
          hasPrev: detailIndex > 0, hasNext: detailIndex < shownSchemas.length - 1,
          onPrev: () => setDetailEvent({ name: shownSchemas[detailIndex - 1].eventName, from: "list" }),
          onNext: () => setDetailEvent({ name: shownSchemas[detailIndex + 1].eventName, from: "list" }),
        } : undefined}
        footer={detailSchema && (() => {
          const next = NEXT_LIFECYCLE[detailSchema.lifecycleState];
          return <Decision
            note={!next ? "已停用是终点，不能再开放。" : undefined}
            danger={next === "disabled" ? <Button variant="danger-outline" disabledReason={rowWriteBlocked} onClick={() => transitionLifecycle(detailSchema)}>停用这个事件</Button> : undefined}
            others={<Button disabledReason={rowWriteBlocked} onClick={() => openSchemaPropertyExtension(detailSchema)}>新增字段</Button>}
            primary={next && next !== "disabled" ? <Button variant="primary" disabledReason={rowWriteBlocked} onClick={() => transitionLifecycle(detailSchema)}>改为{lifecycleText(next)}</Button> : undefined} />;
        })()}>
        {detailSchema && (() => {
          const at = LIFECYCLE_ORDER.indexOf(detailSchema.lifecycleState);
          const next = NEXT_LIFECYCLE[detailSchema.lifecycleState];
          const fields = propertyList(detailSchema.properties);
          return <>
            <div className="a4-detail-life">
              <Steps label="上线进度" items={LIFECYCLE_ORDER.map((state, index) => ({ label: LIFECYCLE_TEXT[state], state: index < at ? "done" as const : index === at ? "current" as const : "todo" as const }))} />
              <Facts>
                <Fact k="现在">{LIFECYCLE_TEXT[detailSchema.lifecycleState]}：{LIFECYCLE_NOW[detailSchema.lifecycleState]}</Fact>
                <Fact k="下一步">{next ? `改为${LIFECYCLE_TEXT[next]}` : "没有下一步：已停用是终点。"}</Fact>
                {next && <Fact k="推进后">{LIFECYCLE_AFTER[next]}</Fact>}
              </Facts>
            </div>
            <Facts>
              <Fact k="产生模块">{moduleText(detailSchema.ownerDomain) ? <>{moduleText(detailSchema.ownerDomain)} <span className="a4-dim" data-mono>{detailSchema.ownerDomain}</span></> : <span data-mono>{detailSchema.ownerDomain}</span>}</Fact>
              <Fact k="发送方">{PRODUCER_TEXT[detailSchema.producer] ?? detailSchema.producer}{!PRODUCER_TEXT[detailSchema.producer] && <> <span className="a4-dim">（登记时写的说明）</span></>}</Fact>
              <Fact k="谁在用">{consumersOf(detailSchema.consumers, true)}</Fact>
              <Fact k="由服务器记录">{detailSchema.serverAuthoritative ? "是" : "否，由 App 上报"}</Fact>
              <Fact k="采集比例">{detailSchema.samplingPolicy}</Fact>
              <Fact k="版本">事件 {detailSchema.version} · 上线进度 v{detailSchema.lifecycleVersion}</Fact>
            </Facts>
            <Fold title="字段" summary={fields.length ? `${fields.length} 个` : "暂无自定义字段"} inset defaultOpen>
              {fields.length ? (
                <Table label="事件字段" className="a4-field-table">
                  <thead><tr><Th>字段名</Th><Th>类型</Th></tr></thead>
                  <tbody>{fields.map((field) => <Tr key={field.name}><Td><span data-mono>{field.name}</span></Td><Td>{PROPERTY_TYPE_TEXT[field.type] ?? field.type} <span className="a4-dim" data-mono>{field.type}</span></Td></Tr>)}</tbody>
                </Table>
              ) : <p className="a4-note">这个事件还没有自定义字段，只带每条事件都有的通用字段。</p>}
            </Fold>
          </>;
        })()}
      </Drawer>

      {/* ───── 接入批次明细 ───── */}
      <Drawer open={!!batch} onClose={() => setBatchIdx(null)} icon={Layers} tone="role-3"
        title={batch ? operatorCopyText(batch.title) : "接入批次"}
        sub={batch ? <>工单 <span data-mono>{batch.id}</span> · {BATCH_STATE[batch.state].label}</> : undefined}
        explain="批次状态只能查看。接入完成只改工单状态；以前没归类的事件不会回头改归类。">
        {batch && <>
          <Facts>
            <Fact k="状态" tone={BATCH_STATE[batch.state].tone === "warn" ? "warn" : undefined}>{BATCH_STATE[batch.state].label}</Fact>
            <Fact k="提出方">{batch.proposer}</Fact>
            <Fact k="影响">{operatorCopyText(batch.impact)}</Fact>
            <Fact k="新模块">{batch.newDomains.length ? batch.newDomains.map((domain) => domain.name).join("、") : "—"}</Fact>
          </Facts>
          <Table label="批次明细" className="a4-family-table">
            <thead><tr><Th>事件或项目</Th><Th>说明</Th></tr></thead>
            <tbody>
              {batch.details.map((detail) => <Tr key={detail.item}><Td><span data-mono>{detail.item}</span></Td><Td grow>{operatorCopyText(detail.desc)}</Td></Tr>)}
              {!batch.details.length && <TableMessage columns={2}>这个批次没有列出明细</TableMessage>}
            </tbody>
          </Table>
        </>}
      </Drawer>

      {/* ───── 登记新模块：先填四项，下一步到确认框 ───── */}
      <Drawer open={naBatch && !registryConfirm} onClose={() => setNaBatch(false)} icon={Puzzle} tone="role-3"
        title="登记新模块" sub={<StatusTag tone="progress" filled>批准后生效</StatusTag>}
        explain="只建一张接入工单，经另一位超级管理员批准后生效；不会自动接上发送和使用的代码，也不会自动建事件。"
        footer={<Decision others={<Button onClick={() => setNaBatch(false)}>取消</Button>}
          primary={<Button variant="primary" disabledReason={!canWrite ? "你只有查看权限" : batchMissing.length ? `还要填好：${batchMissing.join("、")}` : undefined}
            onBlockedClick={() => setBatchTouched({ domain: true, event: true, producer: true, consumer: true })}
            onClick={() => {
              const domain = batchForm.domain.trim(), event = batchForm.event.trim();
              const producer = batchForm.producer.trim(), consumer = batchForm.consumer.trim();
              if (!canWrite) { toast("你只有查看权限，不能登记"); return; }
              if (!batchFormValid) { toast("请填写模块名、事件名（动作用过去式）、发送方和使用方"); return; }
              openRegistryConfirm({ briefKind: "record",
                action: `登记新模块 · ${domain}`,
                title: "登记新模块",
                completion: "批准后只建接入工单，不会自动接上代码或建事件。",
                statedBrief: {
                  impact: "",
                  check: "提交时后端核对模块名不是已有模块、事件名属于这个模块并用过去式、同样的组合没登记过。",
                },
                facts: <Facts>
                  <Fact k="模块"><span data-mono>{domain}</span></Fact>
                  <Fact k="事件"><span data-mono>{`${domain}.${event}`}</span></Fact>
                  <Fact k="发送方">{producer}</Fact>
                  <Fact k="使用方">{consumer}</Fact>
                </Facts>,
                detail: (<><b>{domain}</b> · 事件 <span data-mono>{event}</span> · 发送方 {producer || "—"} → 使用方 {consumer || "—"}。</>),
                submit: (actor, reason) => registerA4DomainExtension(actor, {
                    domainName: domain,
                    eventName: `${domain}.${event}`,
                    producer,
                    consumer,
                    reason,
                }),
              });
            }}>下一步</Button>} />}>
        <div className="rd-stack a4-batch-form">
          <Field label="模块名" required error={batchIssue("domain")} help={batchIssue("domain") ? undefined : "2–32 位，小写字母开头，只用小写字母、数字和下划线；不能是已接入的模块"}>
            {(control) => <Input {...control} value={batchForm.domain} placeholder="例如 referral" onBlur={() => setBatchTouched((t) => ({ ...t, domain: true }))} onChange={(e) => setBatchForm({ ...batchForm, domain: e.target.value })} />}
          </Field>
          <Field label="事件名" required error={batchIssue("event")} help={batchIssue("event") ? undefined : batchForm.domain.trim() ? `完整事件名会是 ${batchForm.domain.trim()}.${batchForm.event.trim() || "…"}；动作用过去式` : "只填模块后面的部分，动作用过去式，例如 referral_bound"}>
            {(control) => <Input {...control} value={batchForm.event} placeholder="例如 referral_bound" onBlur={() => setBatchTouched((t) => ({ ...t, event: true }))} onChange={(e) => setBatchForm({ ...batchForm, event: e.target.value })} />}
          </Field>
          <Field label="发送方" required error={batchIssue("producer")} help={batchIssue("producer") ? undefined : "谁发这个事件，写说明即可"}>
            {(control) => <Input {...control} value={batchForm.producer} placeholder="例如 团队结算" onBlur={() => setBatchTouched((t) => ({ ...t, producer: true }))} onChange={(e) => setBatchForm({ ...batchForm, producer: e.target.value })} />}
          </Field>
          <Field label="使用方" required error={batchIssue("consumer")} help={batchIssue("consumer") ? undefined : "哪些报表或功能用它"}>
            {(control) => <Input {...control} value={batchForm.consumer} placeholder="例如 转化分析、留存报表" onBlur={() => setBatchTouched((t) => ({ ...t, consumer: true }))} onChange={(e) => setBatchForm({ ...batchForm, consumer: e.target.value })} />}
          </Field>
        </div>
      </Drawer>

      {registryConfirm && registryConfirm.adminId === registryActor?.adminId && registryConfirm.epoch === authEpoch && (
        <OperationConfirmModal
          action={registryConfirm.action}
          title={registryConfirm.title}
          detail={registryConfirm.detail}
          facts={registryConfirm.facts}
          statedBrief={registryConfirm.statedBrief}
          effect={effectApproval}
          confirmLabel="提交审批"
          briefKind={registryConfirm.briefKind}
          businessForm={registryConfirm.businessForm}
          reasonMin={a2ReasonMin}
          reasonMax={200}
          getPendingReason={() => pendingA4RegistryProposal(registryConfirm.adminId)?.input.reason}
          inlineApproval={{
            pending: !!pendingRegistry,
            expired: !!pendingRegistry && Date.now() >= pendingRegistry.expiresAt,
            initialRecovery: registryConfirm.retry ? "retry" : undefined,
            resolve: () => ({
              heading: "要另一位超级管理员批准（需有审批批准权限），你自己不能批",
              completionCopy: registryConfirm.completion ?? "批准前，事件目录、字段和扩展批次均保持原状。",
            }),
            recover: () => recoverRegistry(),
            retry: async () => { await recoverRegistry(true); },
          }}
          onClose={() => setRegistryConfirm(null)}
          onConfirm={async (reason, _value, businessValue) => {
            if (!registryConfirm.submit) return;
            setMutating("registry-approval");
            try {
              finishRegistry(await registryConfirm.submit(currentRegistryActor(), reason, businessValue));
            } finally {
              setMutating(null);
            }
          }}
        />
      )}
    </>
  );
}


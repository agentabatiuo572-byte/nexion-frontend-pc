"use client";

/**
 * 法律条款与风险披露（版本发布页样板，PG-47）。三个页签发布路径不同：
 * - 风险披露：草稿直接保存；发布、切换生效、地区启停、受限动作都提交审批，批准后才生效；发布只封存内容，切换生效才要求用户重新确认。
 * - 法律条款、隐私政策：填理由后立即生效（Q-08），见 i5-legal、i5-privacy。
 * 披露和条款的读取权限独立：页签按权限给，一边读不到不影响另一边。
 * 内容账号没有提交审批的权限（EX-17），审批类入口按真实权限隐藏，不留一点就 403 的按钮。
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { Ban, Check as CheckIcon, CheckCircle2, FilePen, FileText, Globe2, History, ListChecks, MapPinned, Plus, RefreshCw, ShieldAlert, ShieldCheck, Users } from "lucide-react";
import { BlockState, Button, Cell, Change, Conclusion, Decision, Drawer, Explain, Fact, Facts, Field, Fold, Input, InlineMeter, InlineRetry, IrreversibleTag, JudgmentPoints, LocaleTabs, Modal, MoreMenu, Notice, PageHeader, PageTabs, Panel, Select, Stat, StatBand, StatusTag, Steps, Table, TableMessage, Td, Textarea, Th, Tr, type JudgmentRow, useTabIds } from "@/app/components/rd";
import { fetchA2Overview, type A2OperationRow } from "@/lib/admin/a2-client";
import { businessClock, businessZone, formatBusinessTimeCompact } from "@/lib/admin/business-time";
import { disclosurePublicationIssue } from "@/lib/admin/disclosure-publication-diagnostic";
import { findHighOp } from "@/lib/admin/high-ops-registry";
import type { DisclosureChapterView, DisclosureJurisdictionOption, DisclosureJurisdictionView, DisclosureVersionItemView } from "@/lib/admin/i-client";
import type { ProposeSpec } from "@/lib/admin/propose-or-execute";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { useReach } from "@/lib/nav/use-reach";
import type { BusinessFormSpec } from "../design-kit";
import { LegalTab } from "./i5-legal";
import { PrivacyTab } from "./i5-privacy";
import { LeaveDialog, mergeEdits, useI5Writes, useLeaveGuard, withConflict, WRITE_LOCKED, type I5Writes } from "./i5-writes";
import type { ICtx } from "./types";

type TabKey = "disclosure" | "legal" | "privacy";
type Lang = "zh" | "vi" | "en";
type Editor = {
  mode: "create" | "edit";
  editing?: DisclosureVersionItemView;
  version: string;
  jurisdiction: string;
  languageScope: string;
  effectiveDate: string;
  zh: string;
  vi: string;
  en: string;
  chapters: Pick<DisclosureChapterView, "no" | "zh" | "vi" | "en" | "zhBody" | "viBody" | "enBody">[];
  /** 「读取最新」后的最新内容，编辑器把没改过的字段换成它（OP-97）。 */
  rebase?: Editor;
};

const TAB_LABEL: Record<TabKey, string> = { disclosure: "风险披露", legal: "法律条款", privacy: "隐私政策" };
const READING = "正在读取最新数据，读完再操作";
const STALE = "数据没有读到最新，重新读取后再操作";
const IN_APPROVAL = "这个对象有审批中的操作，批准或驳回后再提交";
const APPROVAL_TEXT = "提交审批，批准后生效";
const APPROVER = "有审批权限的管理员在「操作记录与审批」批准";
const LANGUAGE_NAME: Record<string, string> = { zh: "中文", vi: "越南语", en: "英语", id: "印尼语", ms: "马来语", fil: "菲律宾语", ru: "俄语", kk: "哈萨克语", uz: "乌兹别克语" };
const DEFAULT_LANGUAGE_SCOPES = ["zh+vi", "zh+vi+en"];
const STATUS_TEXT: Record<string, string> = { published: "已发布", draft: "草稿", archived: "已归档", superseded: "已取代", pending: "待处理", active: "已启用", disabled: "已停用", pending_review: "待发布复核" };
const statusZh = (status?: string) => STATUS_TEXT[(status ?? "").toLowerCase()] ?? "未知状态";
const languageText = (scope?: string) => {
  const names = (scope ?? "").split("+").filter(Boolean).map((code) => LANGUAGE_NAME[code] ?? code);
  if (!names.length) return "—";
  return names.length > 3 ? `${names.slice(0, 3).join(" / ")} 等 ${names.length} 种语言` : names.join(" / ");
};
const count = (value: number) => value.toLocaleString("en-US");
/** 少于 5 人不显示人数和比例（ST-44）。 */
const SMALL_SAMPLE = "样本过小";
const isSmall = (value: number) => value > 0 && value < 5;
const people = (value: number) => isSmall(value) ? SMALL_SAMPLE : `${count(value)} 人`;
/** 列表时间按业务时区（TX-26）；只有日期的（2026-11-04、11-04）不换算。 */
const timeText = (value?: string) => !value ? "—" : /^\d{4}-\d{2}-\d{2}[T ]\d/.test(value) ? formatBusinessTimeCompact(value, value) : value;
const pendingAckOf = (j: DisclosureJurisdictionView) => j.pendingAck ?? Math.max(0, Math.round(j.affected * (100 - j.ackProgress) / 100));
const ackedOf = (j: DisclosureJurisdictionView) => j.acked ?? Math.max(0, j.affected - pendingAckOf(j));
const operatorText = (value?: string) => !value ? "—" : value.startsWith("migration:") ? "系统迁移" : value;
const versionKey = (row: Pick<DisclosureVersionItemView, "jurisdiction" | "version">) => `${row.jurisdiction}\u0000${row.version}`;

function compareVersionsDesc(left: string, right: string): number {
  const leftParts = left.replace(/^v/i, "").split(".").map(Number);
  const rightParts = right.replace(/^v/i, "").split(".").map(Number);
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const delta = (rightParts[index] ?? 0) - (leftParts[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return right.localeCompare(left);
}

function readTab(allowed: readonly TabKey[]): TabKey {
  const wanted = new URLSearchParams(window.location.search).get("tab");
  return allowed.find((item) => item === wanted) ?? allowed[0];
}

/** 页面入口：页签、待确认条和三个页签的权限。 */
export function I5Disclosures({ ctx, errorText }: { ctx: ICtx; errorText: string | null }) {
  const session = useAdminAuth((state) => state.session);
  const isSuperadmin = session?.role === "superadmin";
  const has = useCallback((code: string) => isSuperadmin || !!session?.authorities.includes(code), [isSuperadmin, session?.authorities]);
  const tabs = useMemo(() => [
    ...(has("content_i5_read") ? ["disclosure" as const] : []),
    ...(has("content_legal_terms_read") ? ["legal" as const, "privacy" as const] : []),
  ], [has]);
  const tabIds = useTabIds();
  const [tab, setTab] = useState<TabKey | null>(null);
  const [visited, setVisited] = useState<TabKey[]>([]);
  const [legalNonce, setLegalNonce] = useState(0);
  const [privacyNonce, setPrivacyNonce] = useState(0);
  const [queueNonce, setQueueNonce] = useState(0);

  const choose = useCallback((next: TabKey) => {
    setTab(next);
    setVisited((current) => current.includes(next) ? current : [...current, next]);
    const url = new URL(window.location.href);
    if (next === tabs[0]) url.searchParams.delete("tab");
    else url.searchParams.set("tab", next);
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, [tabs]);
  useEffect(() => {
    if (!tabs.length) return;
    const initial = readTab(tabs);
    setTab(initial);
    setVisited((current) => current.includes(initial) ? current : [...current, initial]);
  }, [tabs]);

  const writes = useI5Writes({
    actions: ctx.actions,
    toast: ctx.toast,
    canQuery: has("platform_a2_read"),
    onSettled: async ({ op }) => {
      if (op.kind === "legal-save" || op.kind === "legal-transition") setLegalNonce((value) => value + 1);
      else if (op.kind === "privacy") setPrivacyNonce((value) => value + 1);
      else {
        setQueueNonce((value) => value + 1);
        await ctx.actions.reloadIContent();
      }
    },
    onReadBack: ({ op }) => {
      if (op.kind === "privacy") { choose("privacy"); setPrivacyNonce((value) => value + 1); }
      else { choose("legal"); setLegalNonce((value) => value + 1); }
    },
  });

  if (!tabs.length) {
    return <>
      <PageHeader pageId="I5" title="法律条款与风险披露" summary="管风险披露、法律条款和隐私政策的版本。" />
      <BlockState state="denied" title="没有这个页面的查看权限" detail="这个账号读不了风险披露和法律条款，需要超级管理员开通。" />
    </>;
  }

  const canDraft = has("content_i5_write");
  const canPropose = has("platform_a2_write") || has("platform_a2_proposal_create");
  const legalWrite = has("content_legal_terms_write");
  const legalPublish = has("content_legal_terms_publish");
  const readOnly = tab === "disclosure"
    ? !canDraft && !(canPropose && (has("content_i5_disclosure_publish") || has("content_i5_gate_adjust"))) ? "你只能查看；写草稿要有这页的修改权限。"
      : !canPropose ? "你可以写草稿和维护地区名称；发布、切换版本要提交审批，这个账号不能提交。" : undefined
    : tab && !legalWrite && !legalPublish ? "你只能查看；改条款和隐私政策要有修改权限。" : undefined;

  return <>
    <DisclosureHeader ctx={ctx} tab={tab} readOnly={readOnly} guideExtra={readOnly ? <p>{readOnly}</p> : undefined} />
    {writes.notices}
    {tabs.length > 1 && tab && <PageTabs ids={tabIds} label="法律条款与风险披露内容" value={tab} onChange={choose} items={tabs.map((value) => ({ value, label: TAB_LABEL[value] }))} />}
    {visited.includes("disclosure") && <div {...tabIds.panel("disclosure")} hidden={tab !== "disclosure"} className="rd-tab-pane"><DisclosureTab ctx={ctx} errorText={errorText} writes={writes} has={has} queueNonce={queueNonce} /></div>}
    {visited.includes("legal") && <div {...tabIds.panel("legal")} hidden={tab !== "legal"} className="rd-tab-pane"><LegalTab ctx={ctx} writes={writes} canWrite={legalWrite} canPublish={legalPublish} nonce={legalNonce} /></div>}
    {visited.includes("privacy") && <div {...tabIds.panel("privacy")} hidden={tab !== "privacy"} className="rd-tab-pane"><PrivacyTab ctx={ctx} writes={writes} canWrite={legalWrite} canPublish={legalPublish} nonce={privacyNonce} /></div>}
    {writes.releaseModal}
  </>;
}

function DisclosureHeader({ ctx, tab, readOnly, guideExtra }: { ctx: ICtx; tab: TabKey | null; readOnly?: string; guideExtra?: ReactNode }) {
  const data = ctx.content.trustDisclosure;
  const [readAt, setReadAt] = useState("");
  useEffect(() => { if (data) setReadAt(businessClock(Date.now())); }, [data]);
  return (
    <PageHeader pageId="I5" title="法律条款与风险披露" summary="管风险披露、法律条款和隐私政策的版本。" readOnly={readOnly} guideExtra={guideExtra}
      meta={tab === "disclosure" && readAt ? `${readAt} 读取（${businessZone().label}）· 每 10 秒更新` : undefined} />
  );
}

function DisclosureTab({ ctx, errorText, writes, has, queueNonce }: { ctx: ICtx; errorText: string | null; writes: I5Writes; has: (code: string) => boolean; queueNonce: number }) {
  const { toast, openActionConfirm, actions, content, contentLoading } = ctx;
  const reach = useReach();
  const data = content.trustDisclosure;
  const canDraft = has("content_i5_write");
  const canPropose = has("platform_a2_write") || has("platform_a2_proposal_create");
  const canPublish = has("content_i5_disclosure_publish") && canPropose;
  const canAdjustGate = has("content_i5_gate_adjust") && canPropose;
  const canQueue = has("platform_a2_read");

  const [refreshing, setRefreshing] = useState(false);
  const [queue, setQueue] = useState<A2OperationRow[]>([]);
  const [queueFailed, setQueueFailed] = useState(false);
  const [jurCode, setJurCode] = useState<string | null>(null);
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const [detailLang, setDetailLang] = useState<Lang>("zh");
  const [editor, setEditor] = useState<Editor | null>(null);
  const [rebaseWanted, setRebaseWanted] = useState(false);

  const loadQueue = useCallback(async () => {
    if (!canQueue) return;
    try {
      const overview = await fetchA2Overview({ domain: "I" });
      setQueue(overview.operationQueue.filter((row) => row.status === "pending" && /披露|受限动作/.test(row.action)));
      setQueueFailed(false);
    } catch {
      setQueue([]);
      setQueueFailed(true);
    }
  }, [canQueue]);
  useEffect(() => { void loadQueue(); }, [loadQueue, queueNonce]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void actions.reloadIContent();
      void loadQueue();
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [actions, loadQueue]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([actions.reloadIContent(), loadQueue()]);
    } finally {
      setRefreshing(false);
    }
  };

  const jurisdictions = useMemo(() => data?.jurisdictions ?? [], [data]);
  const versions = useMemo(() => data?.disclosureVersionItems ?? [], [data]);
  const catalog = useMemo(() => data?.jurisdictionCatalog ?? [], [data]);
  const gates = (data?.gatedActions ?? []).map((gate) => ({ ...gate, retired: gate.key === "staking" || gate.key === "withdraw" }));
  const nameOf = (code: string, fallback = code) => catalog.find((item) => item.code === code)?.name ?? fallback;
  const activeCatalog = catalog.filter((item) => item.status.toLowerCase() === "active");
  const isActive = (code: string) => activeCatalog.some((item) => item.code === code);
  const regionOption = (item: DisclosureJurisdictionOption) => ({ value: item.code, label: `${item.code} · ${item.name}` });
  const publishedVersionsByJurisdiction = versions.reduce<Record<string, string[]>>((map, row) => {
    if (!["published", "superseded"].includes(row.status.toLowerCase())) return map;
    const list = map[row.jurisdiction] ?? [];
    if (!list.includes(row.version)) map[row.jurisdiction] = [...list, row.version].sort(compareVersionsDesc);
    return map;
  }, {});
  const issues = new Map(jurisdictions.flatMap((j) => {
    const issue = contentLoading ? null : disclosurePublicationIssue({ code: j.code, version: j.version, status: j.status }, versions);
    return issue ? [[j.code, issue] as const] : [];
  }));
  const drafts = versions.filter((row) => row.status.toLowerCase() === "draft");
  // 已发布只是封存：比生效版本新、又还没切过去的，用户还看不到（I5-C03）。
  const unswitched = versions.filter((row) => {
    if (row.status.toLowerCase() !== "published") return false;
    const mapping = jurisdictions.find((item) => item.code === row.jurisdiction);
    return !!mapping && mapping.status.toLowerCase() !== "archived" && mapping.version !== row.version;
  });
  const unmapped = activeCatalog.filter((item) => !item.hasActiveMapping);
  // 归档的映射只是历史记录，不算在生效。
  const effectiveCount = jurisdictions.filter((j) => j.status.toLowerCase() === "published").length;
  const inApproval = (code: string) => queue.some((row) => row.obj === code);
  const gateInApproval = queue.some((row) => row.action.includes("受限动作"));

  /** 写入口不能点的原因：读取中、数据旧、结果未确认、审批中，按这个顺序（ST-32、OP-93）。 */
  const blocked = (target?: string, approvalBusy = false) => refreshing ? READING : errorText ? STALE : target && writes.isLocked(target) ? WRITE_LOCKED : approvalBusy ? IN_APPROVAL : undefined;
  const regionBlocked = (code: string) => blocked(`jur:${code}`, inApproval(code));

  const submit = (target: string, spec: Omit<ProposeSpec, "gate" | "sourceDomain" | "type" | "gateLabel"> & { gateLabel: string }) =>
    writes.send({ target, label: spec.action, op: { kind: "a2", spec: { ...spec, type: "param", gate: { roles: [] }, sourceDomain: "I5" } } });

  const approvalTag = <StatusTag tone="progress" filled>批准后生效</StatusTag>;
  const approvalProps = {
    effect: approvalTag,
    confirmLabel: APPROVAL_TEXT,
    amplifies: false,
  };
  /** 批准后收不回来的：删除、归档映射、发布封存（VS-106）。 */
  const irreversibleApproval = <>{approvalTag}<IrreversibleTag /></>;

  // ---------- 地区 ----------
  const editJurisdiction = (current?: DisclosureJurisdictionOption) => openActionConfirm({ briefKind: "config",
    action: <>{current ? "编辑" : "新增"}披露适用地区</>,
    detail: <>适用地区代码创建后不可修改；名称与生命周期由适用地区配置统一维护，版本和国家映射在下方独立管理。</>,
    amplifies: false,
    effect: <StatusTag tone="progress" filled>立即生效</StatusTag>,
    confirmLabel: current ? "保存名称" : "确认新增",
    statedBrief: current
      ? { impact: "地区名称立即更新，只影响后台显示和可选列表，已生效的披露版本不变。", check: "核对新名称，理由写清依据或工单号。" }
      : { impact: "新地区立即出现在目录里，状态是已停用。启用后才能新建版本，配置生效版本后用户才看得到。代码创建后不能改。", check: "核对地区代码和名称，理由写清依据或工单号。" },
    businessForm: { kind: "disclosure-jurisdiction", mode: current ? "edit" : "create", code: current?.code, name: current?.name, revision: current?.revision },
    run: async (reason, _value, form) => {
      const code = form?.code?.trim().toUpperCase() || "";
      const name = form?.name?.trim() || "";
      if (!code || !name) return false;
      const target = `jur:${current?.code ?? code}`;
      const result = await writes.send(current
        ? { target, label: `编辑适用地区 · ${current.code}`, op: { kind: "content", call: { fn: "updateI5Jurisdiction", args: [current.code, { name, expectedRevision: current.revision }, reason] } } }
        : { target, label: `新增适用地区 · ${code}`, op: { kind: "content", call: { fn: "createI5Jurisdiction", args: [{ code, name }, reason] } } });
      if (result === "done") toast(current ? "适用地区名称已更新" : "适用地区已新增");
    },
  });

  const changeLifecycle = (item: DisclosureJurisdictionOption, action: "enable" | "disable" | "archive") => {
    const labels = { enable: "启用", disable: "停用", archive: "归档" } as const;
    const statuses = { enable: "ACTIVE", disable: "DISABLED", archive: "ARCHIVED" } as const;
    const effects = {
      enable: "批准后这个地区可以新建披露版本和配置生效版本。",
      disable: "批准后不能再为这个地区新建披露版本或绑定版本，历史版本和操作记录保留。",
      archive: "批准后这个地区不再出现在可选列表里，历史版本和操作记录永久保留。",
    } as const;
    openActionConfirm({ briefKind: "content", ...approvalProps,
      action: <>{labels[action]}适用地区 · {item.code}</>,
      title: `${labels[action]}适用地区`,
      detail: <>{effects[action]}</>,
      statedBrief: { impact: `${effects[action]}由${APPROVER}，批准前状态不变。`, check: "核对地区和状态，理由写清依据或工单号。" },
      facts: <Facts><Fact k="地区">{item.code} · {item.name}</Fact><Fact k="状态"><Change from={statusZh(item.status)} to={statusZh(statuses[action])} /></Fact></Facts>,
      run: async (reason) => {
        const def = findHighOp("i5_jurisdiction_status")!;
        await submit(`jur:${item.code}`, {
          action: `${labels[action]}披露适用地区 · ${item.code}`, obj: item.code, before: item.status, after: statuses[action], amplifies: false, gateLabel: def.gateLabel, reason,
          command: def.buildCommand({ jurisdiction: item.code, status: statuses[action], expectedRevision: item.revision }),
          target: def.buildTarget({ jurisdiction: item.code }),
        });
      },
    });
  };

  const deleteJurisdiction = (item: DisclosureJurisdictionOption) => openActionConfirm({ briefKind: "config", ...approvalProps,
    action: <>删除未使用适用地区 · {item.code}</>,
    title: "删除未使用的适用地区",
    detail: <>只有已归档、且没有任何披露版本用到的地区可以删除；删除后这个地区代码不能再次使用。</>,
    confirmTone: "danger",
    effect: irreversibleApproval,
    statedBrief: { impact: `批准后这个地区从目录删除，代码 ${item.code} 不能再次使用。由${APPROVER}，批准前不变。`, check: "确认这个地区不再需要，理由写清依据或工单号。" },
    facts: <Facts><Fact k="地区">{item.code} · {item.name}</Fact><Fact k="状态">{statusZh(item.status)}</Fact></Facts>,
    run: async (reason) => {
      const def = findHighOp("i5_jurisdiction_delete")!;
      await submit(`jur:${item.code}`, {
        action: `删除未使用披露适用地区 · ${item.code}`, obj: item.code, before: `${item.name} · ${item.status}`, after: "删除", amplifies: false, gateLabel: def.gateLabel, reason,
        command: def.buildCommand({ jurisdiction: item.code, expectedRevision: item.revision }),
        target: def.buildTarget({ jurisdiction: item.code }),
      });
    },
  });

  // ---------- 生效版本 ----------
  const mappableOptions = activeCatalog.filter((item) => !item.hasActiveMapping && (publishedVersionsByJurisdiction[item.code]?.length ?? 0) > 0).map(regionOption);
  const newMappingBlocked = blocked() ?? (activeCatalog.length === 0 ? "暂无启用适用地区，请先维护适用地区配置"
    : unmapped.length === 0 ? "启用的地区都已配置生效版本，要换版本点行里的「调整映射」"
      : mappableOptions.length === 0 ? "没配置的地区还没有已发布版本，先新建并发布版本" : undefined);

  const configMatrix = (current?: DisclosureJurisdictionView, targetVersion?: string) => {
    const spec: BusinessFormSpec = {
      kind: "disclosure-matrix",
      mode: current ? "edit" : "create",
      jurisdictionCode: current?.code,
      jurisdictionName: current?.name,
      version: targetVersion ?? current?.version,
      countryCodes: current?.countryCodes ?? [],
      countryOptions: (data?.countryOptions ?? []).map((item) => ({ value: item.code, label: `${item.code} · ${item.name}` })),
      jurisdictionOptions: current ? activeCatalog.filter((item) => item.code === current.code).map(regionOption) : mappableOptions,
      publishedVersionsByJurisdiction,
      unchanged: current ? { version: current.version, countryCodes: current.countryCodes } : undefined,
      affected: current ? current.affected : undefined,
    };
    openActionConfirm({ briefKind: "config", ...approvalProps,
      action: <>{current ? "编辑" : "新增"}适用地区 × 版本映射</>,
      title: `${current ? "调整" : "新增"}版本映射`,
      detail: <>这里仅维护启用适用地区的适用国家/地区与已发布版本映射。映射批准后生效；版本或适用国家变化时，新旧国家的用户须重新确认。</>,
      completionCopy: "批准后生效：更新该地区映射；版本或适用国家变化时，新旧国家的用户须重新确认并收到通知。提交本身不会切换版本。",
      statedBrief: { impact: `批准后这个地区按这里的版本和国家生效；版本或适用国家变了，新旧国家的用户都要重新确认，并收到通知。由${APPROVER}，批准前当前生效版本不变。`, check: "核对地区、版本和适用国家，理由写清版本依据。" },
      facts: current && <Facts><Fact k="地区">{current.code} · {nameOf(current.code, current.name)}</Fact><Fact k="当前">{current.version} · {current.countryCodes.join("、") || "未配置国家"}</Fact></Facts>,
      businessForm: spec,
      run: async (reason, _value, form) => {
        const jurisdictionCode = form?.jurisdictionCode?.trim().toUpperCase() || "";
        if (!jurisdictionCode) return false;
        const countryCodes = (form?.countryCodes || "").split(",").map((code) => code.trim()).filter(Boolean);
        const version = form?.version || "";
        const def = findHighOp("i5_matrix_configure")!;
        const snapshot = jurisdictions.find((item) => item.code === jurisdictionCode);
        await submit(`jur:${jurisdictionCode}`, {
          action: `${current ? "调整" : "新增"}披露适用地区版本矩阵 · ${jurisdictionCode}`, obj: jurisdictionCode,
          before: current ? `${current.version} · ${current.countryCodes.join("、")}` : "未配置", after: `${version} · ${countryCodes.join("、")}`, amplifies: false, gateLabel: def.gateLabel, reason,
          command: def.buildCommand({
            jurisdictionCode,
            jurisdictionName: catalog.find((item) => item.code === jurisdictionCode)?.name ?? "",
            countryCodes,
            version,
            expectedVersion: snapshot?.version ?? "",
            expectedStatus: snapshot?.status ?? "ABSENT",
            expectedCountryCodes: snapshot?.countryCodes ?? [],
          }),
          target: def.buildTarget({ jurisdictionCode }),
        });
      },
    });
  };

  const archiveMatrix = (j: DisclosureJurisdictionView) => openActionConfirm({ briefKind: "record", ...approvalProps,
    action: <>归档适用地区版本映射 · {j.code}</>,
    title: "归档版本映射",
    detail: <>归档后不再作为生效版本，历史版本和操作记录仍保留。</>,
    confirmTone: "danger",
    effect: irreversibleApproval,
    statedBrief: { impact: `批准后这个地区不再有生效版本，归档的映射不能恢复，要用时重新新增。由${APPROVER}，批准前不变。`, check: "核对地区和版本，理由写清依据或工单号。" },
    facts: <Facts><Fact k="地区">{j.code} · {nameOf(j.code, j.name)}</Fact><Fact k="生效版本"><Change from={j.version} to="无" /></Fact><Fact k="涉及用户">{people(j.affected)}</Fact></Facts>,
    run: async (reason) => {
      const def = findHighOp("i5_matrix_archive")!;
      await submit(`jur:${j.code}`, {
        action: `归档披露适用地区版本矩阵 · ${j.code}`, obj: j.code, before: `${j.version} · ${statusZh(j.status)}`, after: "已归档", amplifies: false, gateLabel: def.gateLabel, reason,
        command: def.buildCommand({ jurisdiction: j.code, expectedVersion: j.version, expectedStatus: j.status }),
        target: def.buildTarget({ jurisdiction: j.code }),
      });
    },
  });

  // ---------- 版本 ----------
  const editorFrom = (snapshot: DisclosureVersionItemView | undefined, jurisdiction: string, version: string, mode: Editor["mode"], editing?: DisclosureVersionItemView): Editor => ({
    mode, editing, version, jurisdiction,
    languageScope: snapshot?.languageScope ?? data?.languageScopes?.[0] ?? DEFAULT_LANGUAGE_SCOPES[0],
    effectiveDate: snapshot?.effectiveDate ?? "",
    zh: snapshot?.zh ?? "", vi: snapshot?.vi ?? "", en: snapshot?.en ?? "",
    chapters: snapshot?.chapters?.length === 7
      ? snapshot.chapters.map(({ no, zh, vi, en, zhBody, viBody, enBody }) => ({ no, zh, vi, en, zhBody, viBody, enBody }))
      : Array.from({ length: 7 }, (_, index) => ({ no: String(index + 1).padStart(2, "0"), zh: "", vi: "", en: "", zhBody: "", viBody: "", enBody: "" })),
  });
  const nextVersionFor = (jurisdiction: string) => data?.nextVersionByJurisdiction?.[jurisdiction] ?? data?.nextDisclosureVersionByJurisdiction?.[jurisdiction] ?? data?.nextDisclosureVersion ?? "";
  const firstRegion = activeCatalog[0]?.code ?? "";
  const newVersionBlocked = blocked() ?? (!firstRegion ? "暂无启用适用地区，请先在适用地区目录新增或启用" : !nextVersionFor(firstRegion) ? "暂时拿不到新版本号，请刷新后再新建" : undefined);
  const openNewVersion = () => {
    const base = versions.find((row) => row.jurisdiction === firstRegion && row.status.toLowerCase() === "published");
    setDetailKey(null);
    setEditor(editorFrom(base, firstRegion, nextVersionFor(firstRegion), "create"));
  };
  const loadRegionBase = async (jurisdiction: string): Promise<Editor> => {
    const current = jurisdictions.find((row) => row.code === jurisdiction)?.version ?? "";
    let snapshot = versions.find((row) => row.jurisdiction === jurisdiction && row.version === current);
    if (!snapshot && current) {
      try {
        snapshot = await actions.fetchI5DisclosureVersion(jurisdiction, current);
      } catch {
        toast("适用地区加载失败，请刷新后重试");
      }
    }
    return editorFrom(snapshot, jurisdiction, nextVersionFor(jurisdiction), "create");
  };

  /** 「读取最新」：重读后把最新内容交给编辑器，自己改过的字段留着（OP-97）。 */
  const readLatest = () => { void refresh().then(() => setRebaseWanted(true)); };
  useEffect(() => {
    if (!rebaseWanted) return;
    setRebaseWanted(false);
    setEditor((current) => {
      const row = current?.editing && versions.find((item) => versionKey(item) === versionKey(current.editing!));
      return current && row ? { ...current, rebase: { ...editorFrom(row, row.jurisdiction, row.version, "edit", row) } } : current;
    });
  });
  const saveEditor = (form: Editor, after?: () => void) => {
    const { editing, jurisdiction, version } = form;
    const payload = {
      jurisdiction,
      languageScope: form.languageScope,
      effectiveDate: form.effectiveDate,
      requiresReack: true,
      zh: form.zh.trim(), vi: form.vi.trim(), en: form.en.trim(),
      chapters: form.chapters.map(({ no, zh, vi, en, zhBody, viBody, enBody }) => ({ no, zhTitle: zh, viTitle: vi, enTitle: en, zhBody, viBody, enBody })),
      ...(editing ? { expectedRevision: editing.revision, expectedContentHash: editing.contentHash } : {}),
    };
    openActionConfirm(withConflict(ctx, { briefKind: "config",
      action: <>{editing ? "编辑披露草稿" : "新建披露版本"} · 风控提交</>,
      title: editing ? "编辑披露草稿" : "新建披露版本",
      detail: <>保存后只改草稿，App 内容不变。发布和生效版本映射要分别批准。</>,
      amplifies: false,
      effect: <StatusTag tone="neutral" filled>保存草稿，App 不变</StatusTag>,
      confirmLabel: "保存草稿",
      completionCopy: "草稿保存立即生效于草稿，App 内容不变；发布与生效版本映射须分别批准后生效。",
      statedBrief: { impact: "只保存草稿，用户看到的内容不变。之后还要发布并切换生效版本，用户才看得到。", check: "核对地区、语言范围和七章内容，理由写清修改依据。" },
      facts: <Facts><Fact k="地区">{jurisdiction} · {nameOf(jurisdiction)}</Fact><Fact k="版本">{version}</Fact><Fact k="语言">{languageText(form.languageScope)}</Fact><Fact k="生效日期">{form.effectiveDate}</Fact></Facts>,
      reasonPlaceholder: "例如：监管要求更新第 3 章",
      run: async (reason) => {
        const result = await writes.send(editing
          ? { target: `jur:${jurisdiction}`, label: `编辑披露草稿 · ${jurisdiction} ${version}`, op: { kind: "content", call: { fn: "updateI5DisclosureVersion", args: [jurisdiction, version, payload, reason] } } }
          : { target: `jur:${jurisdiction}`, label: `新建披露版本 · ${jurisdiction} ${version}`, op: { kind: "content", call: { fn: "createI5DisclosureVersion", args: [jurisdiction, payload, reason] } } });
        setEditor(null);
        if (result === "done") { toast("草稿已保存，App 内容不变"); after?.(); }
      },
    }, readLatest));
  };

  const deleteDraft = (row: DisclosureVersionItemView) => openActionConfirm({ briefKind: "record",
    action: <>删除披露草稿 · {row.jurisdiction} {row.version}</>,
    title: "删除披露草稿",
    detail: <>只删除还没发布的草稿；已发布和旧版本不能删除。</>,
    amplifies: false,
    confirmTone: "danger",
    effect: <><StatusTag tone="progress" filled>立即生效</StatusTag><IrreversibleTag /></>,
    confirmLabel: "确认删除草稿",
    statedBrief: { impact: "草稿立即删除。已发布和生效的版本不受影响。", check: "确认这个草稿不再需要，理由写清依据。" },
    facts: <Facts><Fact k="地区">{row.jurisdiction} · {nameOf(row.jurisdiction)}</Fact><Fact k="草稿">{row.version}</Fact></Facts>,
    run: async (reason) => {
      if (row.revision == null || !row.contentHash) throw new Error("草稿并发校验信息缺失，请刷新后重试");
      const result = await writes.send({ target: `jur:${row.jurisdiction}`, label: `删除披露草稿 · ${row.jurisdiction} ${row.version}`, op: { kind: "content", call: { fn: "deleteI5DisclosureVersion", args: [row.jurisdiction, row.version, row.revision, row.contentHash, reason] } } });
      setDetailKey(null);
      if (result === "done") toast("披露草稿已删除");
    },
  });

  const publishVersion = (row: DisclosureVersionItemView) => {
    const j = jurisdictions.find((item) => item.code === row.jurisdiction);
    const current = versions.find((item) => item.jurisdiction === row.jurisdiction && item.status.toLowerCase() === "published");
    const affected = row.affected ?? j?.affected ?? 0;
    const pendingAck = row.pendingAck ?? j?.pendingAck ?? Math.max(0, Math.round(affected * (100 - (j?.ackProgress ?? 0)) / 100));
    openActionConfirm({ briefKind: "config", ...approvalProps,
      action: <>发布已存披露草稿 · {row.jurisdiction}</>,
      title: "发布披露草稿",
      detail: <>发布的是已保存的草稿，批准后 7 章内容固定不能改，App 当前版本不变。之后另行提交生效版本映射，批准切换后才要求用户重新确认。</>,
      completionCopy: "批准后生效：仅封存已保存草稿，App 当前版本不变，也不触发重新确认；生效版本映射须另行提交审批。",
      confirmTone: "danger",
      effect: irreversibleApproval,
      statedBrief: { impact: `批准后这个版本封存，不能再改也不能删除。App 还是当前版本，不要求用户重新确认，要另外切换生效版本。由${APPROVER}，批准前不变。`, check: "逐章核对中文、越南语和英语内容，理由写清版本依据。" },
      facts: <Facts><Fact k="地区">{row.jurisdiction} · {nameOf(row.jurisdiction)}</Fact><Fact k="版本"><Change from={current?.version ?? j?.version ?? "无生效版"} to={row.version} /></Fact><Fact k="语言">{languageText(row.languageScope)}</Fact><Fact k="切换生效后要确认的用户">{people(affected)}</Fact></Facts>,
      businessForm: {
        kind: "disclosure-publish-review",
        jurisdiction: row.jurisdiction,
        currentVersion: current?.version ?? j?.version ?? "",
        targetVersion: row.version,
        affected,
        pendingAck,
        blocked: row.blocked ?? j?.blocked ?? 0,
        gatedActions: gates.filter((gate) => gate.active).map((gate) => gate.name),
        currentChapters: current?.chapters ?? [],
        targetChapters: row.chapters,
      },
      run: async (reason) => {
        const def = findHighOp("i5_disclosure_publish")!;
        await submit(`jur:${row.jurisdiction}`, {
          action: `发布披露新版 · ${row.jurisdiction}`, obj: row.jurisdiction, before: current?.version ?? j?.version ?? "无生效版", after: row.version, amplifies: false, gateLabel: def.gateLabel, reason,
          command: def.buildCommand({ jurisdiction: row.jurisdiction, version: row.version, expectedRevision: row.revision, contentHash: row.contentHash }),
          target: def.buildTarget({ jurisdiction: row.jurisdiction }),
        });
      },
    });
  };

  const toggleGate = (gate: typeof gates[number]) => {
    const on = gate.active;
    openActionConfirm({ briefKind: "record", ...approvalProps,
      action: <>{on ? "移出" : "纳入"}受限动作 · {gate.name}</>,
      title: `${on ? "移出" : "纳入"}受限动作`,
      detail: on
        ? <>把 <b>{gate.name}</b> 移出受限范围：确认状态过期时不再拦截该动作。缩小范围等于放松合规拦截，确认时写清依据。</>
        : <>把 <b>{gate.name}</b> 纳入受限范围：确认状态过期时拦截该动作。</>,
      amplifies: on, // 移出受限范围 = 放松合规拦截；纳入 = 收紧
      coverageLead: "这项操作放松合规拦截",
      statedBrief: { impact: `${on ? "批准后用户做这个操作不用先确认披露" : "批准后还没确认当前披露的用户会被拦下"}。由${APPROVER}，批准前范围不变。`, check: "核对操作名称，理由写清合规依据。" },
      facts: <Facts><Fact k="操作">{gate.name}</Fact><Fact k="范围"><Change from={on ? "受限内" : "已移出"} to={on ? "已移出" : "受限内"} /></Fact></Facts>,
      run: async (reason) => {
        const nextScope = gates.filter((item) => (item.key === gate.key ? !on : item.active)).map((item) => item.name).join(" + ") || gate.name;
        const def = findHighOp("i5_gate_adjust")!;
        await submit("gate", {
          action: `${on ? "移出" : "纳入"}受限动作 · ${gate.name}`, obj: gate.name, before: on ? "受限内" : "已移出", after: on ? "已移出" : "受限内", amplifies: on, gateLabel: def.gateLabel, reason,
          command: def.buildCommand({ scope: nextScope, expectedScope: data?.gateScope ?? "" }),
          target: def.buildTarget({}),
        });
      },
    });
  };

  // ---------- 读取状态 ----------
  if (contentLoading && !data) return <BlockState state="loading" title="风险披露数据加载中…" />;
  if (!data) return <BlockState state="error" title="暂无风险披露数据" detail={<>内容数据加载失败 · {errorText ?? "请刷新重试。"}</>} retryLabel="重新加载" onRetry={() => void refresh()} retrying={refreshing} />;

  const stats = data.stats;
  const jur = jurCode ? jurisdictions.find((item) => item.code === jurCode) ?? null : null;
  const detail = detailKey ? versions.find((row) => versionKey(row) === detailKey) ?? null : null;
  const detailIndex = detail ? versions.indexOf(detail) : -1;
  const jurIndex = jur ? jurisdictions.indexOf(jur) : -1;
  const regionHistory = jur ? versions.filter((row) => row.jurisdiction === jur.code) : [];
  const auditHref = "/platform/audit?domain=I";
  const auditReachable = reach(auditHref, "platform_a2_read");
  const openVersion = (row: DisclosureVersionItemView) => { setJurCode(null); setDetailKey(versionKey(row)); setDetailLang("zh"); };
  const openRegion = (code: string) => { setDetailKey(null); setJurCode(code); };

  // ---------- 待处理 ----------
  const todoCount = drafts.length + unswitched.length + queue.length;
  const headActions = <>
    <Button variant="ghost" size="sm" loading={refreshing} icon={<RefreshCw size={14} aria-hidden />} onClick={() => void refresh()}>刷新</Button>
    {canDraft && <Button variant="primary" icon={<Plus size={15} aria-hidden />} disabledReason={newVersionBlocked} onClick={openNewVersion}>新建版本</Button>}
  </>;
  const todoHint = [drafts.length && `${drafts.length} 个草稿待发布`, unswitched.length && `${unswitched.length} 个版本已发布未切换`, queue.length && `${queue.length} 个操作待审批`].filter(Boolean).join(" · ") || undefined;
  // 审批看不到或没读到时只说能确定的，不把未知当成没有（T09）。
  const queueUnknown = !canQueue || queueFailed;
  const queueLimit = queueUnknown ? (canQueue ? "待审批没读到" : "这个账号看不到待审批") : undefined;
  const conclusion = issues.size
    ? <Conclusion state="danger" icon={ShieldAlert} action={headActions} hint={todoHint}><b>{issues.size}</b> 个地区的披露引用异常，App 可能读不到</Conclusion>
    : unmapped.length
      ? <Conclusion state="warn" action={headActions} hint={todoHint}><b>{unmapped.length}</b> 个启用地区还没有生效版本：{unmapped.map((item) => item.code).join("、")}</Conclusion>
      : todoCount
        ? <Conclusion state="neutral" icon={ListChecks} action={headActions} hint={[todoHint, queueLimit].filter(Boolean).join(" · ")}>有 {todoCount} 件事要处理</Conclusion>
        : effectiveCount === 0
          ? <Conclusion state="neutral" action={headActions}>还没有地区配置生效版本</Conclusion>
          : <Conclusion state={queueUnknown ? "neutral" : "ok"} icon={ShieldCheck} action={headActions} hint={queueLimit}>{queueUnknown ? "启用的地区都有生效版本，没有草稿" : "启用的地区都有生效版本，没有要处理的版本"}</Conclusion>;

  const hasToken = (row: DisclosureVersionItemView) => row.revision != null && Boolean(row.contentHash);
  const publishBlocked = (row: DisclosureVersionItemView) => regionBlocked(row.jurisdiction)
    ?? (!hasToken(row) ? "版本信息不完整，请刷新" : row.chapters.length !== 7 ? "七章还没写全，先编辑版本" : !isActive(row.jurisdiction) ? "须先启用适用地区" : undefined);
  const editBlocked = (row: DisclosureVersionItemView) => regionBlocked(row.jurisdiction) ?? (!hasToken(row) ? "版本信息不完整，请刷新" : undefined);
  const catalogStatus = (code: string) => catalog.find((item) => item.code === code)?.status.toLowerCase() ?? "";
  const draftActions = (row: DisclosureVersionItemView) => {
    const canEdit = canDraft && catalogStatus(row.jurisdiction) !== "archived";
    const items = [
      ...(canEdit ? [{ key: "edit", label: "编辑版本", disabledReason: editBlocked(row), onSelect: () => { setDetailKey(null); setEditor(editorFrom(row, row.jurisdiction, row.version, "edit", row)); } }] : []),
      ...(canDraft ? [{ key: "delete", label: "删除草稿", danger: true, disabledReason: editBlocked(row), onSelect: () => deleteDraft(row) }] : []),
    ];
    return <span className="rd-row-actions">
      {canPublish && <Button size="sm" disabledReason={publishBlocked(row)} onClick={() => publishVersion(row)}>发布</Button>}
      {items.length > 0 && <MoreMenu label={`${row.jurisdiction} ${row.version} 的更多操作`} items={items} />}
    </span>;
  };
  const switchBlocked = (code: string) => regionBlocked(code) ?? (!isActive(code) ? "地区未启用，先到适用地区目录启用" : undefined);

  return <>
    {errorText && <Notice tone="warn" title="数据没有读到最新" action={<Button size="sm" loading={refreshing} onClick={() => void refresh()}>重新加载</Button>}>内容数据加载失败 · {errorText} 下面是上次读到的内容，写入口已禁用。</Notice>}
    {conclusion}
    <StatBand label="风险披露关键数字">
      <Stat tone="role-3" icon={Users} label="当前版本待确认用户" value={count(stats.staleAckUsers)} unit="人" explain={`切换生效版本或改适用国家后，还没重新确认的用户。${gates.find((gate) => gate.key === "withdraw")?.active ? "提现受限内 · 未确认时拦截" : "提现已移出受限动作范围"}。`} />
      <Stat tone="role-2" icon={Globe2} label="生效地区" value={effectiveCount} unit="个" explain="已发布、正在生效的地区数，已归档的不算。" />
      <Stat tone="role-4" icon={Ban} label="未确认被拦截（近 7 天）" value={stats.weeklyGateBlocked} unit="次" explain="全部受限动作的历史事件，不代表当前提现状态。" />
    </StatBand>

    {queueFailed && <Notice tone="warn" title="待审批读取失败" action={<InlineRetry onRetry={() => void loadQueue()} />}>审批中的操作这里看不到，到「操作记录与审批」核对。</Notice>}
    {todoCount > 0 && <Panel title="草稿和待审批" icon={FilePen} tone="role-1" flush>
        <Table label="草稿和待审批">
          <thead><tr><Th>内容</Th><Th>状态</Th><Th>下一步</Th><Th align="right">操作</Th></tr></thead>
          <tbody>
            {queue.map((row) => (
              <Tr key={row.id}>
                <Td><Cell main={row.action} sub={`${row.operator} · ${row.ts}`} title={row.reason} /></Td>
                <Td><StatusTag tone="warn" explain="已提交，还没批准。批准前用户看到的内容不变。">待审批</StatusTag></Td>
                <Td>等待审批</Td>
                <Td align="right">{auditReachable ? <Link className="rd-link" href={`${auditHref}&object=${encodeURIComponent(row.obj)}`} prefetch={false}>查看审批</Link> : "—"}</Td>
              </Tr>
            ))}
            {drafts.map((row) => (
              <Tr key={versionKey(row)} selected={detail === row} onOpen={() => openVersion(row)}>
                <Td><Cell main={`${row.jurisdiction} ${row.version}`} sub={`${languageText(row.languageScope)} · ${timeText(row.updatedAt || row.effectiveDate)}`} /></Td>
                <Td><StatusTag tone="neutral" explain="只有后台能看到，用户看不到。">草稿</StatusTag></Td>
                <Td>{canPublish ? "核对七章后发布" : "等有审批提交权限的同事发布"}</Td>
                <Td align="right">{draftActions(row)}</Td>
              </Tr>
            ))}
            {unswitched.map((row) => {
              const mapping = jurisdictions.find((item) => item.code === row.jurisdiction)!;
              return (
                <Tr key={versionKey(row)} selected={detail === row} onOpen={() => openVersion(row)}>
                  <Td><Cell main={`${row.jurisdiction} ${row.version}`} sub={`当前生效 ${mapping.version}`} /></Td>
                  <Td><StatusTag tone="progress" explain="内容已封存，用户还在看旧版本。切换生效后才要求用户重新确认。">已发布，未切换</StatusTag></Td>
                  <Td>切换生效版本</Td>
                  <Td>{canPublish ? <Button size="sm" disabledReason={switchBlocked(row.jurisdiction)} onClick={() => configMatrix(mapping, row.version)}>切换生效</Button> : "—"}</Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
    </Panel>}
    {data.draft?.version && data.draft.zh && data.draft.vi && (
      <div data-proof="disclosure-draft-preview">
        <Fold title="草稿预览" icon={FilePen} tone="role-1" summary={`${data.draft.jurisdiction ?? ""} ${data.draft.version} · ${languageText(data.draft.languageScope ?? "zh+vi")}`}>
          <Facts>
            <Fact k="生效日">{data.draft.effectiveDate ?? "—"}</Fact>
            <Fact k="重新确认">{data.draft.requiresReack === false ? "否" : "是"}</Fact>
            <Fact k="中文">{data.draft.zh}</Fact>
            <Fact k="越南语">{data.draft.vi}</Fact>
            {data.draft.en && <Fact k="英语">{data.draft.en}</Fact>}
          </Facts>
        </Fold>
      </div>
    )}

    <Panel title="各地区生效版本" icon={MapPinned} tone="role-2" flush explain="用户现在看的版本。覆盖人数按账号地区算，确认进度按当前版本算。拦截数是历史记录，可能包含已经确认过的用户。" actions={canPublish ? <Button size="sm" disabledReason={newMappingBlocked} onClick={() => configMatrix()}>新增映射</Button> : undefined}>
      {[...issues].map(([code, issue]) => (
        <div className="rd-panel-line" key={code} data-proof="disclosure-publication-issue"><Notice tone="danger" title={`${code} 引用异常`}>{issue}</Notice></div>
      ))}
      <Table label="各地区生效版本">
        <thead><tr><Th>适用地区</Th><Th>当前版本</Th><Th>状态</Th><Th>重新确认进度</Th><Th align="right">历史拦截(近7天)</Th>{canPublish && <Th align="right">操作</Th>}</tr></thead>
        <tbody>
          {jurisdictions.map((j) => {
            const archived = j.status.toLowerCase() === "archived";
            const pendingAck = pendingAckOf(j);
            return (
              <Tr key={j.code} selected={j.code === jurCode} onOpen={() => openRegion(j.code)}>
                <Td><Cell main={`${j.code} · ${nameOf(j.code, j.name)}`} sub={`适用 ${j.countryCodes?.join("、") || "未配置"}`} /></Td>
                <Td><Cell num main={j.version} sub={timeText(j.publishedAt)} /></Td>
                <Td>{issues.has(j.code) ? <StatusTag tone="danger">引用异常</StatusTag> : <StatusTag tone={archived ? "done" : "neutral"} icon={archived ? undefined : CheckCircle2}>{statusZh(j.status)}</StatusTag>}</Td>
                <Td>{j.affected === 0 ? <Cell main="无覆盖用户" /> : isSmall(j.affected) ? <Cell main={SMALL_SAMPLE} />
                  : <Cell main={<InlineMeter value={j.ackProgress / 100} text={`${j.ackProgress}%`} tone={pendingAck > 0 ? "progress" : "ok"} />} sub={`待确认 ${count(pendingAck)} · 共 ${count(j.affected)} 人`} />}</Td>
                <Td align="right"><Cell num main={j.blocked ? count(j.blocked) : <span className="rd-weak">0</span>} /></Td>
                {canPublish && <Td align="right">{archived ? "—" : <span className="rd-row-actions">
                  <Button size="sm" disabledReason={switchBlocked(j.code)} onClick={() => configMatrix(j)}>调整映射</Button>
                  <MoreMenu label={`${j.code} 的更多操作`} items={[{ key: "archive", label: "归档", danger: true, disabledReason: regionBlocked(j.code), onSelect: () => archiveMatrix(j) }]} />
                </span>}</Td>}
              </Tr>
            );
          })}
          {jurisdictions.length === 0 && <TableMessage columns={canPublish ? 6 : 5}>还没有地区配置生效版本。{canPublish ? "发布版本后点「新增映射」。" : ""}</TableMessage>}
        </tbody>
      </Table>
    </Panel>

    <Fold title="披露版本列表" icon={History} tone="role-3" summary={`${versions.length} 个版本`}>
      <Table label="披露版本列表">
        <thead><tr><Th>版本</Th><Th>状态</Th><Th>语言</Th><Th>生效/更新（{businessZone().label}）</Th><Th sticky="end" align="right">操作</Th></tr></thead>
        <tbody>
          {versions.map((row) => {
            const isDraft = row.status.toLowerCase() === "draft";
            return (
              <Tr key={versionKey(row)} selected={detail === row} onOpen={() => openVersion(row)}>
                <Td><Cell main={`${row.jurisdiction} ${row.version}`} sub={`${row.chapters.length} / 7 章`} /></Td>
                <Td><StatusTag tone={isDraft ? "neutral" : row.status.toLowerCase() === "published" ? "ok" : "done"}>{statusZh(row.status)}</StatusTag></Td>
                <Td>{languageText(row.languageScope)}</Td>
                <Td><Cell num main={timeText(row.publishedAt || row.updatedAt || row.effectiveDate)} sub={row.operator ? operatorText(row.operator) : undefined} /></Td>
                <Td sticky="end" align="right"><span className="rd-row-actions"><Button size="sm" onClick={() => openVersion(row)}>查看七章</Button>{isDraft && draftActions(row)}</span></Td>
              </Tr>
            );
          })}
          {versions.length === 0 && <TableMessage columns={5}>暂无披露版本，请刷新后新建。</TableMessage>}
        </tbody>
      </Table>
    </Fold>

    <Fold title="适用地区目录" icon={Globe2} tone="role-2" summary={`${catalog.length} 个地区 · ${activeCatalog.length} 个已启用`}>
      {canDraft && <div className="rd-fold-tools"><Button size="sm" disabledReason={blocked()} onClick={() => editJurisdiction()}>新增适用地区</Button></div>}
      <Table label="适用地区目录">
        <thead><tr><Th>适用地区</Th><Th>状态</Th><Th align="right">引用版本</Th><Th>当前映射</Th><Th>最后操作</Th>{(canDraft || canPublish) && <Th sticky="end" align="right">操作</Th>}</tr></thead>
        <tbody>
          {catalog.map((item) => {
            const status = item.status.toLowerCase();
            const canDelete = status === "archived" && item.referencedVersionCount === 0 && !item.hasActiveMapping;
            const lock = regionBlocked(item.code);
            const menu = canPublish ? [
              ...(status === "active" ? [{ key: "disable", label: "停用", disabledReason: lock ?? (item.hasActiveMapping ? "请先归档下方当前映射，再停用适用地区" : undefined), onSelect: () => changeLifecycle(item, "disable") }] : []),
              ...(status === "disabled" ? [{ key: "enable", label: "启用", disabledReason: lock, onSelect: () => changeLifecycle(item, "enable") }] : []),
              ...(status !== "archived" ? [{ key: "archive", label: "归档", disabledReason: lock ?? (item.hasActiveMapping ? "请先归档下方当前映射，再归档适用地区" : undefined), onSelect: () => changeLifecycle(item, "archive") }] : []),
              { key: "delete", label: "删除", danger: true, disabledReason: lock ?? (canDelete ? undefined : "须先归档适用地区，且不能存在版本或当前映射"), onSelect: () => deleteJurisdiction(item) },
            ] : [];
            return (
              <Tr key={item.code}>
                <Td><Cell main={`${item.code} · ${item.name}`} /></Td>
                <Td><StatusTag tone={status === "active" ? "ok" : status === "disabled" ? "warn" : "done"}>{statusZh(item.status)}</StatusTag></Td>
                <Td align="right"><Cell num main={item.referencedVersionCount} /></Td>
                <Td>{item.hasActiveMapping ? "已配置" : "未配置"}</Td>
                <Td><Cell main={operatorText(item.lastOperator)} sub={formatBusinessTimeCompact(item.updatedAt, "—")} title={item.lastOperator} /></Td>
                {(canDraft || canPublish) && <Td sticky="end" align="right"><span className="rd-row-actions">
                  {canDraft && status !== "archived" && <Button size="sm" disabledReason={lock} onClick={() => editJurisdiction(item)}>编辑</Button>}
                  {menu.length > 0 && <MoreMenu label={`${item.code} 的更多操作`} items={menu} />}
                </span></Td>}
              </Tr>
            );
          })}
          {catalog.length === 0 && <TableMessage columns={canDraft || canPublish ? 6 : 5}>暂无适用地区配置，请先新增适用地区。</TableMessage>}
        </tbody>
      </Table>
    </Fold>

    <Fold title="需要先确认的操作" icon={ShieldCheck} tone="role-4" explain={<><p>{gates.some((gate) => gate.active) ? "还没重新确认的用户，做这里受限的操作时会被拦下并跳到披露页。" : "当前没有受限的操作，用户不会被拦。"}</p><p>重新确认相当于让用户重新签一次条款，不是紧急开关。监管要求停业务，去「紧急停用开关」。</p></>} summary={gates.some((gate) => gate.active) ? `${gates.filter((gate) => gate.active).length} 项受限，未确认的用户会被拦下` : "当前没有纳入风险披露前置确认范围的操作。"}>
      <Table label="需要先确认的操作">
        <thead><tr><Th>操作</Th><Th>状态</Th>{canAdjustGate && <Th sticky="end" align="right">动作</Th>}</tr></thead>
        <tbody>
          {gates.map((gate) => (
            <Tr key={gate.key}>
              <Td><Cell main={gate.name} /></Td>
              <Td>{gate.retired ? <StatusTag tone="done" explain="已移出风险披露前置确认范围，不支持重新纳入。">不再纳入</StatusTag> : <StatusTag tone={gate.active ? "ok" : "done"} explain={gate.sub}>{gate.active ? "受限内" : "已移出"}</StatusTag>}</Td>
              {canAdjustGate && <Td sticky="end" align="right">{gate.retired ? "—" : <Button size="sm" disabledReason={blocked("gate", gateInApproval)} onClick={() => toggleGate(gate)}>{gate.active ? "移出" : "纳入"}</Button>}</Td>}
            </Tr>
          ))}
          {gates.length === 0 && <TableMessage columns={canAdjustGate ? 3 : 2}>当前没有纳入风险披露前置确认范围的操作。</TableMessage>}
        </tbody>
      </Table>
    </Fold>

    <nav className="rd-links" aria-label="相关页面">
      <span>相关页面</span>
      {reach("/content/notifications") && <Link className="rd-link" href="/content/notifications" prefetch={false}>通知活动</Link>}
      {reach("/emergency/kill-switch") && <Link className="rd-link" href="/emergency/kill-switch" prefetch={false}>紧急停用开关</Link>}
      {auditReachable && <Link className="rd-link" href={auditHref} prefetch={false}>操作记录与审批</Link>}
    </nav>

    <Drawer open={!!jur} onClose={() => setJurCode(null)} title="适用地区" sub={jur ? `${jur.code}（${nameOf(jur.code, jur.name)}）` : undefined} icon={MapPinned} tone="role-2" explain="按用户账号国家/地区代码和这里的适用国家匹配。"
      nav={{ hasPrev: jurIndex > 0, hasNext: jurIndex >= 0 && jurIndex < jurisdictions.length - 1, onPrev: () => setJurCode(jurisdictions[jurIndex - 1].code), onNext: () => setJurCode(jurisdictions[jurIndex + 1].code) }}
      footer={jur && canPublish && jur.status.toLowerCase() !== "archived" ? <Decision
        danger={<Button variant="danger-outline" disabledReason={regionBlocked(jur.code)} onClick={() => archiveMatrix(jur)}>归档</Button>}
        primary={<Button variant="primary" disabledReason={switchBlocked(jur.code)} onClick={() => configMatrix(jur)}>调整映射</Button>} /> : undefined}>
      {jur && <>
        <JudgmentPoints rows={regionPoints(jur, issues.get(jur.code))} />
        <Facts>
          <Fact k="适用国家/地区">{jur.countryCodes?.join("、") || "未配置"}</Fact>
          <Fact k="已确认">{isSmall(jur.affected) ? SMALL_SAMPLE : `${count(ackedOf(jur))} 人`}</Fact>
          <Fact k="历史拦截（近 7 天）">{count(jur.blocked)} 次</Fact>
        </Facts>
        <Fold inset title="版本历史" summary={`${regionHistory.length} 个版本`}>
          <Table label="这个地区的版本">
            <tbody>
              {regionHistory.map((row) => (
                <Tr key={versionKey(row)} onOpen={() => openVersion(row)}>
                  <Td><Cell main={row.version} sub={languageText(row.languageScope)} /></Td>
                  <Td><StatusTag tone={row.version === jur.version ? "ok" : "done"}>{row.version === jur.version ? "生效中" : statusZh(row.status)}</StatusTag></Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Fold>
        {auditReachable && <Link className="rd-link" href={`${auditHref}&object=${encodeURIComponent(jur.code)}`} prefetch={false}>查看操作记录</Link>}
      </>}
    </Drawer>

    <Drawer open={!!detail} onClose={() => setDetailKey(null)} title="披露版本" sub={detail ? `${detail.jurisdiction} ${detail.version}` : undefined} icon={FileText} tone="role-3"
      nav={{ hasPrev: detailIndex > 0, hasNext: detailIndex >= 0 && detailIndex < versions.length - 1, onPrev: () => setDetailKey(versionKey(versions[detailIndex - 1])), onNext: () => setDetailKey(versionKey(versions[detailIndex + 1])) }}
      footer={detail && detail.status.toLowerCase() === "draft" && (canDraft || canPublish) ? <Decision
        danger={canDraft ? <Button variant="danger-outline" disabledReason={editBlocked(detail)} onClick={() => deleteDraft(detail)}>删除草稿</Button> : undefined}
        others={canDraft && catalogStatus(detail.jurisdiction) !== "archived" ? <Button disabledReason={editBlocked(detail)} onClick={() => { setDetailKey(null); setEditor(editorFrom(detail, detail.jurisdiction, detail.version, "edit", detail)); }}>编辑版本</Button> : undefined}
        primary={canPublish ? <Button variant="primary" disabledReason={publishBlocked(detail)} onClick={() => publishVersion(detail)}>发布</Button> : undefined} /> : undefined}>
      {detail && <>
        <Steps label="披露版本进度" items={versionSteps(detail, jurisdictions.find((item) => item.code === detail.jurisdiction)?.version)} />
        <JudgmentPoints title="版本要点" rows={[
          { label: "状态", value: statusZh(detail.status) },
          { label: "语言", value: languageText(detail.languageScope) },
          { label: "章节", value: `${detail.chapters.length} / 7`, state: detail.chapters.length === 7 ? undefined : "warn" },
          { label: "生效日期", value: detail.effectiveDate || "—" },
        ]} />
        <LocaleTabs label="查看语言" value={detailLang} onChange={setDetailLang} items={[{ value: "zh", label: "中文" }, { value: "vi", label: "越南语" }, ...(detail.chapters.some((chapter) => chapter.en) ? [{ value: "en" as const, label: "英语" }] : [])]} />
        <div className="rd-doc">
          {detail[detailLang] && <p>{detail[detailLang]}</p>}
          {detail.chapters.map((chapter) => (
            <section key={chapter.no}>
              <h3>第 {chapter.no} 章 · {chapter[detailLang] || "未填写标题"}</h3>
              <p>{chapter[`${detailLang}Body`] || "未填写正文"}</p>
            </section>
          ))}
        </div>
        <Fold inset title="技术信息" summary={`修订号 ${detail.revision ?? "—"}`}>
          <Facts>
            <Fact k="操作员">{operatorText(detail.operator)}</Fact>
            <Fact k="内容校验值"><span data-mono="">{detail.contentHash || "—"}</span></Fact>
          </Facts>
        </Fold>
      </>}
    </Drawer>

    {editor && <VersionEditor key={`${editor.mode}|${editor.editing ? versionKey(editor.editing) : ""}`} initial={editor} regions={editor.mode === "edit" ? catalog.filter((item) => item.code === editor.jurisdiction).map(regionOption) : activeCatalog.map(regionOption)} languageScopes={data.languageScopes?.length ? data.languageScopes : DEFAULT_LANGUAGE_SCOPES} loadRegionBase={loadRegionBase} onSave={saveEditor} onClose={() => setEditor(null)} blockedFor={(code) => regionBlocked(code)} />}
  </>;
}

function regionPoints(jur: DisclosureJurisdictionView, issue: string | undefined): JudgmentRow[] {
  const pendingAck = pendingAckOf(jur);
  return [
    { label: "生效版本", value: `${jur.version} · ${jur.publishedAt || "—"} 起`, state: issue ? "danger" : undefined, reason: issue },
    { label: "用户", value: jur.affected === 0 ? "无覆盖用户" : isSmall(jur.affected) ? SMALL_SAMPLE : `共 ${count(jur.affected)} 人，已确认 ${jur.ackProgress}%` },
    { label: "要不要处理", value: isSmall(jur.affected) ? "用户下次做受限操作前会确认" : pendingAck > 0 ? `${count(pendingAck)} 人待确认，用户下次做受限操作前会确认` : "没有待确认的用户" },
  ];
}

function versionSteps(row: DisclosureVersionItemView, live: string | undefined): { label: string; state: "done" | "current" | "todo" }[] {
  const status = row.status.toLowerCase();
  if (status === "draft") return [{ label: "写草稿", state: "current" }, { label: "发布封存", state: "todo" }, { label: "切换生效", state: "todo" }];
  if (row.version === live) return [{ label: "写草稿", state: "done" }, { label: "发布封存", state: "done" }, { label: "切换生效", state: "done" }];
  return [{ label: "写草稿", state: "done" }, { label: "发布封存", state: "done" }, { label: "切换生效", state: status === "published" ? "current" : "todo" }];
}

/** 新建和编辑披露版本：抽屉里按语言切换，切语言不动别的语言（CP-64）。理由在保存时的确认框里填（OP-24）。 */
function VersionEditor({ initial, regions, languageScopes, loadRegionBase, onSave, onClose, blockedFor }: {
  initial: Editor;
  regions: readonly { value: string; label: string }[];
  languageScopes: readonly string[];
  loadRegionBase: (jurisdiction: string) => Promise<Editor>;
  onSave: (form: Editor, after?: () => void) => void;
  onClose: () => void;
  /** 按表单当前的地区判断，换地区后跟着变。 */
  blockedFor: (jurisdiction: string) => string | undefined;
}) {
  const [form, setForm] = useState(initial);
  const [baseline, setBaseline] = useState(initial);
  const [lang, setLang] = useState<Lang>("zh");
  const [loadingRegion, setLoadingRegion] = useState(false);
  const [pendingRegion, setPendingRegion] = useState<string | null>(null);
  const dirty = JSON.stringify(form) !== JSON.stringify(baseline);
  const needEn = form.languageScope.split("+").includes("en");
  const guard = useLeaveGuard(dirty, onClose);
  useEffect(() => {
    if (!initial.rebase) return;
    const latest = initial.rebase;
    setForm((current) => mergeEdits(baseline, current, latest));
    setBaseline(latest);
    // 只在「读取最新」时合并一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial.rebase]);

  const langMissing = (code: Lang) => !form[code].trim() || form.chapters.some((chapter) => !chapter[code].trim() || !chapter[`${code}Body`].trim());
  const missing = [
    !form.effectiveDate && "生效日期",
    langMissing("zh") && "中文内容",
    langMissing("vi") && "越南语内容",
    needEn && langMissing("en") && "英语内容",
  ].filter(Boolean);
  const saveBlocked = blockedFor(form.jurisdiction) ?? (loadingRegion ? "正在加载该地区的版本内容" : missing.length ? `还缺：${missing.join("、")}` : form.mode === "edit" && !dirty ? "没有改动" : undefined);
  const setChapter = (index: number, patch: Partial<Editor["chapters"][number]>) => setForm((current) => ({ ...current, chapters: current.chapters.map((chapter, itemIndex) => itemIndex === index ? { ...chapter, ...patch } : chapter) }));
  const switchRegion = async (jurisdiction: string) => {
    setPendingRegion(null);
    setLoadingRegion(true);
    const next = await loadRegionBase(jurisdiction);
    setForm(next);
    setBaseline(next);
    setLoadingRegion(false);
  };
  const close = guard.askClose;
  const langName = LANGUAGE_NAME[lang];

  return <>
    <Drawer open wide onClose={close} title={initial.mode === "edit" ? "编辑披露草稿" : "新建披露版本"} sub={initial.mode === "edit" ? `${form.jurisdiction} ${form.version}` : undefined} explain={initial.mode === "create" ? "内容已带入这个地区当前的已发布版本，切换生效版本后用户须重新确认。" : undefined} icon={FilePen} tone="role-1"
      footer={<Decision explain="保存草稿不改变 App 内容。" others={<Button onClick={close}>取消</Button>} primary={<Button variant="primary" icon={<CheckIcon size={15} aria-hidden />} disabledReason={saveBlocked} onClick={() => onSave(form)}>保存草稿</Button>} />}>
      <div data-business-form="version-authoring" className="rd-form-stack">
        <div className="rd-form-grid">
          <Field label="披露版本"><div className="rd-form-static">{form.version}<Explain label="版本号怎么来的" content="系统自动编号，不能手填。" /></div></Field>
          <Field label="适用地区">{initial.mode === "edit" ? <div className="rd-form-static">{regions[0]?.label ?? form.jurisdiction}</div>
            : <Select aria-label="适用地区" value={form.jurisdiction} options={regions} disabled={loadingRegion} onChange={(next) => { if (next === form.jurisdiction) return; if (dirty) setPendingRegion(next); else void switchRegion(next); }} />}</Field>
          <Field label="语言范围"><Select aria-label="语言范围" value={form.languageScope} options={languageScopes.map((scope) => ({ value: scope, label: languageText(scope) }))} onChange={(next) => setForm((current) => ({ ...current, languageScope: next }))} /></Field>
          <Field label="生效日期" required>{(control) => <Input {...control} type="date" value={form.effectiveDate} onChange={(event) => setForm((current) => ({ ...current, effectiveDate: event.target.value }))} />}</Field>
        </div>
        <LocaleTabs label="正文语言" value={lang} onChange={setLang} items={[
          { value: "zh", label: "中文", missing: langMissing("zh") },
          { value: "vi", label: "越南语", missing: langMissing("vi") },
          { value: "en", label: needEn ? "英语" : "英语（选填）", missing: needEn && langMissing("en") },
        ]} />
        <Field label={`${langName}版本正文`} required={lang !== "en" || needEn}>{(control) => <Textarea {...control} rows={4} value={form[lang]} onChange={(event) => setForm((current) => ({ ...current, [lang]: event.target.value }))} />}</Field>
        {form.chapters.map((chapter, index) => (
          <section key={chapter.no} className="rd-form-stack" aria-label={`第 ${chapter.no} 章`}>
            <h3 className="rd-form-group-title">第 {chapter.no} 章</h3>
            <Field label={`${langName}标题`} required={lang !== "en" || needEn}>{(control) => <Input {...control} value={chapter[lang]} onChange={(event) => setChapter(index, { [lang]: event.target.value })} />}</Field>
            <Field label={`${langName}正文`} required={lang !== "en" || needEn}>{(control) => <Textarea {...control} rows={3} value={chapter[`${lang}Body`]} onChange={(event) => setChapter(index, { [`${lang}Body`]: event.target.value })} />}</Field>
          </section>
        ))}
      </div>
    </Drawer>
    {pendingRegion && (
      <Modal title="换地区会覆盖已填内容" icon={ShieldCheck} onClose={() => setPendingRegion(null)} footer={<>
        <Button onClick={() => setPendingRegion(null)}>继续编辑</Button>
        <Button variant="primary" onClick={() => void switchRegion(pendingRegion)}>换地区，放弃已填内容</Button>
      </>}><p>换成 {pendingRegion} 后，表单改成这个地区当前已发布版本的内容，已填内容不会保留。</p></Modal>
    )}
    <LeaveDialog guard={guard} saveLabel="保存草稿" saveBlocked={saveBlocked} onSave={() => onSave(form, guard.saved)} />
  </>;
}

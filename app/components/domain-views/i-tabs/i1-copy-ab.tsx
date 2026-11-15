"use client";
import { nexGridBrandText } from "@/lib/admin/brand-copy";

/**
 * I1 页面文案对比测试（改版）。三层：位置 → 这个位置的文案和版本 → 版本上的实验。
 * 统一来源：后端 /content/copy-ab/overview。17 个写操作都直接执行、不走审批。
 * 请求、校验和提交沿用原来的处理函数：编辑文案、新增文案、创建实验先在抽屉里填（字段和初始值同 copy-edit、copy-create、
 * copy-experiment-create），点按钮后进操作确认填理由；位置、版本目录、启动实验用 multi-field，字段名和原来相同。
 * amplifies = false（只改措辞，不动费率、奖励、价格）。
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { BookOpen, CheckCircle2, Eye, FileText, FlaskConical, History, Layers, ListChecks, MapPin, Plus, Settings2, ShieldAlert, TriangleAlert } from "lucide-react";
import { BlockState, Button, Cell, ConfigList, ConfigRow, Conclusion, Decision, Drawer, Explain, Fact, Facts, FilterBar, FilterField, Fold, IrreversibleTag, JudgmentPoints, MoreMenu, Notice, PageHeader, PageTabs, Pager, Panel, Segments, Select, Stat, StatBand, StatusTag, Table, TableMessage, Td, Th, Tr, useTabIds, type MoreMenuItem, type JudgmentRow } from "@/app/components/rd";
import { PaginationExemptionList, type BusinessFormSpec, type BusinessFormValue } from "../design-kit";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { useReach } from "@/lib/nav/use-reach";
import type { ActionConfirmReq, ConfirmReq, ICtx } from "./types";
import { displayAdminError } from "@/lib/admin/error-messages";
import { fetchI1CopyOverview, type CopyAbOverview, pendingI1Commands, retryI1Command, type I1Command } from "@/lib/admin/i-client";
import { isOutcomeUnknownError } from "@/lib/admin/outcome-classification";
import { useIConflictReview } from "@/lib/admin/i-conflict-review";
import { conflictRow, IConflictModal, IConflictPending, inGroup, useIConflictView, type IConflictRow } from "./i-conflict";
import { isRetryExpired } from "@/lib/admin/pending-mutation-store";
import {
  CompareTexts, CopyEditorDrawer, ExperimentCard, ExperimentDrawer, LangBlocks, PositionCard,
  audienceText, copyStatus, experimentState, LANGUAGE_OPTIONS, missingLangs, moduleLabel, versionStatus,
  type CopyCreateSpec, type CopyEditSpec, type ExperimentCopyOption, type PositionCopy, type SaveMode, type Texts,
} from "./i1-parts";

const COPY_MODULES = ["home", "store", "earn", "me"] as const;
type CopyModule = (typeof COPY_MODULES)[number];
type Surf = "all" | CopyModule;
type ExpFlt = "all" | "running" | "concluded";
type VersionStatusFlt = "all" | "draft" | "published" | "archived";
type Tab = "positions" | "experiments" | "history" | "catalog";
type CopyRow = {
  key: string; desc: string; surface: string;
  version: string; status: string; i18nKey: string; expId: string; lastChange: string;
  draftVersion?: string; draftZh?: string; draftEn?: string; draftVi?: string; copyPosition?: string; draftCopyPosition?: string; draftSurface?: string; draftAudience?: string; draftAudienceTarget?: AudienceTarget | null; draftTrafficSplit?: string; draftNote?: string;
  revision?: number; usedVersionKeys?: string[];
};
type AudienceTarget = { locales?: string[]; tiers?: string[]; registrationDaysMin?: number | null; registrationDaysMax?: number | null };
type VersionRow = {
  copyKey: string; v: string; st: string; chain: string; ts: string;
  zh: string; en: string; vi: string; copyPosition?: string; surface: string;
  audience: string; audienceTarget?: AudienceTarget | null; estimatedAudience?: number; trafficSplit: string; versionNote: string;
};
type VersionOptionRow = {
  versionKey: string; name: string; description: string | null; status: string;
  sortOrder: number; revision: number; usageCount: number;
};
type ExpRow = {
  id: string; copyKey: string; variants: { name: string; split: number; cvr: number; version: string; impressions?: number; conversions?: number }[];
  audience: string; estimatedAudience?: number; impressions: string; conversions: string; state: string; note: string;
};
type Editor =
  | { kind: "edit"; spec: CopyEditSpec; copy: CopyRow; base?: VersionRow; forceNew: boolean }
  | { kind: "create"; spec: CopyCreateSpec };

const COPY_MODULE_LABELS: Record<CopyModule, string> = { home: "首页", store: "商城", earn: "收益", me: "我的" };
const COPY_MODULE_OPTIONS = COPY_MODULES.map((value) => ({ value, label: COPY_MODULE_LABELS[value] }));
const LEGACY_MODULES: Record<string, CopyModule> = { Home: "home", Store: "store", Earn: "earn", Me: "me", 商城: "store" };
const SURF_FLT: [Surf, string][] = [["all", "全部"], ...COPY_MODULES.map((value) => [value, COPY_MODULE_LABELS[value]] as [Surf, string])];
const EXP_FLT: [ExpFlt, string][] = [["all", "全部"], ["running", "进行中"], ["concluded", "已结束"]];
const VERSION_STATUS_FLT: [VersionStatusFlt, string][] = [["all", "全部"], ["draft", "草稿"], ["published", "已发布"], ["archived", "已归档"]];
const VERSION_PAGE_SIZE = 20;
const ZONE = "北京时间";

const LIVE = <StatusTag tone="progress" filled>立即生效</StatusTag>;
const OFFLINE = (text: string) => <StatusTag tone="neutral" filled>{text}</StatusTag>;

// 占位符是数据槽,任一语言漏掉就会渲染出半截句子。
// 取三语**交集**而不是并集:并集会把「历史数据本来就少一种语言」变成一道死锁 ——
// 运营只想改个错别字,却被逼先把一个占位符硬塞进那条本来就没有它的译文里才能保存,
// 而且没有豁免出口。交集只锁「三语现在都有、你不许改没」的槽,是纯增量的保护,
// 不会因为存量不一致挡住无关编辑。存量不一致本身归 I6 词条治理,不在这条路径上解决。
const COPY_PLACEHOLDER_PATTERN = /\{[A-Za-z0-9_.]+\}/g;

function placeholdersIn(text?: string): Set<string> {
  return new Set(text?.match(COPY_PLACEHOLDER_PATTERN) ?? []);
}

function requiredPlaceholders(...texts: (string | undefined)[]): string[] {
  const sets = texts.map(placeholdersIn);
  if (sets.length === 0) return [];
  const [first, ...rest] = sets;
  return [...first].filter((token) => rest.every((set) => set.has(token))).sort();
}

function normalizeCopyModule(value?: string): string {
  const raw = value?.trim() ?? "";
  return LEGACY_MODULES[raw] ?? raw.toLowerCase();
}

function composeAudience(form?: Record<string, string>): string {
  const phaseMin = form?.phaseMin || "P1";
  const phaseMax = form?.phaseMax || "P3";
  const phase = phaseMin === phaseMax ? phaseMin : `${phaseMin}-${phaseMax}`;
  const language = !form?.language || form.language === "all" ? "全语言" : form.language;
  const days = Math.max(0, Number(form?.registrationDaysGt || 0));
  return `${phase} · ${language} · 注册>${days}天`;
}

function composeAudienceTarget(form?: Record<string, string>) {
  const phaseMin = form?.phaseMin || "P1";
  const phaseMax = form?.phaseMax || "P3";
  const language = form?.language || "all";
  const registrationDaysGt = Number(form?.registrationDaysGt || 0);
  const start = Number(phaseMin.replace("P", ""));
  const end = Number(phaseMax.replace("P", ""));
  return {
    mode: "structured",
    tiers: Array.from({ length: Math.max(0, end - start + 1) }, (_, index) => `P${start + index}`),
    locales: language === "all" ? [] : [language],
    registrationDaysMin: registrationDaysGt + 1,
    registrationDaysMax: null,
  };
}

function audienceTargetFields(target?: AudienceTarget | null) {
  if (!target) return {};
  const tiers = (target.tiers ?? []).map((tier) => Number(tier.replace(/^P/i, ""))).filter(Number.isFinite).sort((a, b) => a - b);
  return {
    phaseMin: tiers.length ? `P${tiers[0]}` : "P1",
    phaseMax: tiers.length ? `P${tiers[tiers.length - 1]}` : "P6",
    language: target.locales?.[0] ?? "all",
    registrationDaysGt: String(Math.max(0, (target.registrationDaysMin ?? 1) - 1)),
  };
}

const textsOf = (row?: { zh?: string; en?: string; vi?: string }): Texts | null => row ? { zh: row.zh ?? "", vi: row.vi ?? "", en: row.en ?? "" } : null;
const textsOfForm = (form: BusinessFormValue): Texts => ({ zh: form.zh ?? "", vi: form.vi ?? "", en: form.en ?? "" });
/** 后端给的是累计数的字符串；读不成整数就当没有。 */
const countOf = (value: string) => (/^\d+$/.test(value.trim()) ? Number(value.trim()) : null);

type I1Pending = { id: string; label: string; change: string; at: string; retryBlocked?: string; record: I1Command };

function PendingNotice({ items, onQuery, onRetry }: { items: readonly I1Pending[]; onQuery: (record: I1Command) => void; onRetry: (record: I1Command) => void }) {
  if (items.length === 0) return null;
  return (
    <Notice tone="warn" title={<>{`${items.length} 项操作结果未知`}<Explain label="结果未知怎么处理" content={<><p>提交时没收到确定结果，可能已经执行。「查询原结果」只重读现在的内容，不能证明原操作成没成，记录继续保留。</p><p>24 小时内可以「按原请求重试」，后端认得出是同一次提交，不会重复执行；过了 24 小时只能查询。</p></>} /></>} actionBelow>
      <ul className="i1-pending">
        {items.map((item) => (
          <li key={item.id}>
            <span className="i1-pending-what"><b>{item.label}</b>{item.change}</span>
            <span className="i1-weak">提交于 {item.at}（{ZONE}）</span>
            <span className="i1-pending-actions">
              <Button size="sm" onClick={() => onQuery(item.record)}>查询原结果</Button>
              <Button size="sm" disabledReason={item.retryBlocked} onClick={() => onRetry(item.record)}>按原请求重试</Button>
            </span>
          </li>
        ))}
      </ul>
    </Notice>
  );
}

export function I1CopyAb({ ctx, errorText }: { ctx: ICtx; errorText?: string | null }) {
  const { toast, actions, content, contentLoading } = ctx;
  const session = useAdminAuth((state) => state.session);
  const reach = useReach();
  const isSuperadmin = session?.role === "superadmin";
  const canWrite = isSuperadmin || !!session?.authorities.includes("content_i1_write");
  const canManageExperiments = isSuperadmin || !!session?.authorities.includes("content_i1_experiment_manage");
  const canCreateCopy = isSuperadmin || !!session?.authorities.includes("content_i1_copy_create");
  const [tab, setTab] = useState<Tab>("positions");
  const tabIds = useTabIds();
  const [surf, setSurf] = useState<Surf>("all");
  const [expFlt, setExpFlt] = useState<ExpFlt>("all");
  const [versionCopyFlt, setVersionCopyFlt] = useState("all");
  const [versionStatusFlt, setVersionStatusFlt] = useState<VersionStatusFlt>("all");
  const [versionPage, setVersionPage] = useState(1);
  const [deletingDraftKey, setDeletingDraftKey] = useState<string | null>(null);
  const deleteInFlightRef = useRef(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [creatingExperiment, setCreatingExperiment] = useState(false);
  const [copyDetail, setCopyDetail] = useState<string | null>(null);
  const [versionDetail, setVersionDetail] = useState<string | null>(null);
  const [focusExp, setFocusExp] = useState<string | null>(null);
  const [reloading, setReloading] = useState(false);
  const data = content.copyAb;
  const conflictReview = useIConflictReview<CopyAbOverview, { reason: string; value?: string; form?: Record<string, string> }, I1Command>();
  const reviewConflict = (error: unknown, reason: string, value?: string, form?: Record<string, string>) =>
    conflictReview.reject(error, { reason, value, form }, async () => {
      const latest = await fetchI1CopyOverview();
      await actions.reloadIContent();
      return latest;
    });
  const conflictView = useIConflictView(conflictReview.review);
  /** 核对冲突后重开确认框时带回的理由和表单，只给紧接着打开的那一个框用。 */
  const prefill = useRef<{ reason: string; value?: string; business?: BusinessFormValue } | null>(null);
  const [pending, setPending] = useState<I1Command[]>([]);
  const [retrying, setRetrying] = useState<string | null>(null);
  const retryInFlight = useRef(false);
  const [requiresReload, setRequiresReload] = useState(false);
  const readBarrier = useRef(data);
  const latestRead = useRef(data);
  latestRead.current = data;
  const newMutationReason = conflictReview.blockedReason() ?? (!data ? "数据还没读到" : errorText || requiresReload || contentLoading ? "数据没有读到最新，请重新加载" : undefined);
  const newMutationBlocked = useRef(newMutationReason);
  newMutationBlocked.current = newMutationReason;
  const syncPending = () => setPending(pendingI1Commands());
  useEffect(() => { setPending(pendingI1Commands()); }, [session?.adminId]);
  useEffect(() => {
    if (requiresReload && data && data !== readBarrier.current && !contentLoading && !errorText) setRequiresReload(false);
  }, [requiresReload, data, contentLoading, errorText]);

  const refreshAfterMutation = async () => {
    // A replay returns the old receipt. Close every confirmation based on the old overview before rereading.
    readBarrier.current = latestRead.current;
    newMutationBlocked.current = "数据没有读到最新，请重新加载";
    setRequiresReload(true);
    ctx.closeActionConfirm();
    ctx.closeConfirm?.();
    setEditor(null);
    setCreatingExperiment(false);
    syncPending();
    await actions.reloadIContent();
  };
  const replay = async (record: I1Command) => {
    try {
      await retryI1Command(record);
    } catch (error) {
      syncPending();
      if (!pendingI1Commands().some((row) => row.commandKey === record.commandKey)) {
        await refreshAfterMutation();
        toast(`操作失败:${displayAdminError(error)}`);
        return false;
      }
      throw new Error(`操作失败:${displayAdminError(error)}`);
    }
    await refreshAfterMutation();
    toast(`${record.label} · ${record.target.slice(record.target.indexOf(":") + 1)}`);
  };
  const openActionConfirm = (req: ActionConfirmReq) => {
    if (newMutationBlocked.current) { toast(newMutationBlocked.current); return; }
    const openedData = data;
    let pendingKey: string | undefined;
    let savedBusiness: BusinessFormValue | undefined;
    const original = () => pendingI1Commands().find((row) => row.commandKey === pendingKey);
    const carried = prefill.current;
    prefill.current = null;
    ctx.openActionConfirm({ ...req,
      initialReason: carried?.reason,
      getPendingReason: () => original()?.reason,
      getPendingBusinessValue: () => original() ? savedBusiness : carried?.business,
      run: async (reason, value, form) => {
        if (pendingKey) {
          const record = original();
          if (!record) { ctx.closeActionConfirm(); return false; }
          return replay(record);
        }
        if (conflictReview.blockedReason()) throw new Error(conflictReview.blockedReason());
        if (newMutationBlocked.current || latestRead.current !== openedData) {
          ctx.closeActionConfirm();
          throw new Error(newMutationBlocked.current ?? "数据已更新，请重新核对原操作。");
        }
        try { return await req.run(reason, value, form); }
        catch (error) {
          if (isOutcomeUnknownError(error)) {
            pendingKey = (error as { commandKey?: string }).commandKey;
            savedBusiness = form;
            setEditor(null);
            setCreatingExperiment(false);
          }
          if (await reviewConflict(error, reason, value, form)) ctx.closeActionConfirm();
          syncPending();
          // The domain owns first-attempt rejection: keep the confirmation and its input even for business 403.
          throw new Error(`操作失败:${displayAdminError(error)}`);
        }
      },
    });
  };
  const openConfirm = (req: ConfirmReq) => {
    if (newMutationBlocked.current) { toast(newMutationBlocked.current); return; }
    const openedData = data;
    let pendingKey: string | undefined;
    let savedValue: string | undefined;
    const original = () => pendingI1Commands().find((row) => row.commandKey === pendingKey);
    const carried = prefill.current;
    prefill.current = null;
    ctx.openConfirm({ ...req, initialReason: carried?.reason, initialValue: carried?.value, freezePendingInputs: true, getPendingReason: () => original()?.reason, getPendingValue: () => original() ? savedValue : undefined,
      run: async (reason, value) => {
        if (pendingKey) {
          const record = original();
          if (!record) { ctx.closeConfirm?.(); return false; }
          return replay(record);
        }
        if (conflictReview.blockedReason()) throw new Error(conflictReview.blockedReason());
        if (newMutationBlocked.current || latestRead.current !== openedData) {
          ctx.closeConfirm?.();
          throw new Error(newMutationBlocked.current ?? "数据已更新，请重新核对原操作。");
        }
        try { return await req.run(reason, value); }
        catch (error) {
          if (isOutcomeUnknownError(error)) { pendingKey = (error as { commandKey?: string }).commandKey; savedValue = value; }
          if (await reviewConflict(error, reason, value)) ctx.closeConfirm?.();
          syncPending();
          throw new Error(`操作失败:${displayAdminError(error)}`);
        }
      },
    });
  };
  const restore = async (record: I1Command) => {
    if (retryInFlight.current) return;
    retryInFlight.current = true;
    setRetrying(record.commandKey);
    try { await replay(record); }
    catch (error) { toast(displayAdminError(error)); }
    finally { retryInFlight.current = false; setRetrying(null); }
  };
  const pendingNotice = <PendingNotice items={pending.map((record) => ({
    id: record.commandKey, label: `${record.label} · ${record.target.slice(record.target.indexOf(":") + 1)}`, change: record.change,
    at: new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(record.createdAt),
    retryBlocked: retrying ? "提交中…" : isRetryExpired(record) ? "已超过 24 小时，不能再重试，只能查询。" : !record.original ? "原操作记录不完整，只能查询核对，不能重试。"
      : !(isSuperadmin || session?.authorities.includes(record.permission)) ? "当前账号没有这项操作权限，请查询原结果。" : undefined,
    record,
  }))} onRetry={restore} onQuery={() => { void actions.reloadIContent().then(() => toast("已重新读取；现在的内容不能证明原操作的结果，记录继续保留。")); }} />;
  const lockReason = (target: string): string | undefined => {
    if (newMutationReason) return newMutationReason;
    const related = target.startsWith("copy:")
      ? (data?.experiments ?? []).filter((row) => row.copyKey === target.slice(5)).map((row) => `exp:${row.id}`)
      : target.startsWith("exp:") ? [`copy:${data?.experiments.find((row) => row.id === target.slice(4))?.copyKey}`] : [];
    return pending.some((row) => !row.original || row.target === target || related.includes(row.target))
      ? "此对象有结果未知的原操作，请先到页面上方核对。" : undefined;
  };
  const I1_STATS = data?.stats ?? { managedCopies: 0, runningExps: 0, weeklyExposures: "—", topLift: "—" };
  const COPY_POOL: CopyRow[] = (data?.copies ?? []).map((row) => ({
    key: row.key,
    desc: row.desc,
    surface: normalizeCopyModule(row.surface),
    version: row.version,
    status: row.status,
    i18nKey: row.i18nKey,
    expId: row.expId,
    lastChange: row.lastChange,
    draftVersion: row.draftVersion,
    draftZh: row.draftZh,
    draftEn: row.draftEn,
    draftVi: row.draftVi,
    copyPosition: row.copyPosition,
    draftCopyPosition: row.draftCopyPosition,
    draftSurface: row.draftSurface ? normalizeCopyModule(row.draftSurface) : undefined,
    draftAudience: row.draftAudience,
    draftAudienceTarget: row.draftAudienceTarget,
    draftTrafficSplit: row.draftTrafficSplit,
    draftNote: row.draftNote,
    revision: row.revision,
    usedVersionKeys: row.usedVersionKeys,
  }));
  const COPY_VERSIONS: VersionRow[] = (data?.versions ?? []).map((row) => ({
    copyKey: row.copyKey,
    v: row.version,
    st: row.status,
    chain: row.chain,
    ts: row.ts,
    zh: row.zh,
    en: row.en,
    vi: row.vi,
    copyPosition: row.copyPosition,
    surface: normalizeCopyModule(row.surface),
    audience: row.audience,
    audienceTarget: row.audienceTarget,
    estimatedAudience: row.estimatedAudience,
    trafficSplit: row.trafficSplit,
    versionNote: row.versionNote,
  }));
  const VERSION_OPTIONS: VersionOptionRow[] = [...(data?.versionOptions ?? [])]
    .map((option) => ({
      ...option,
      usageCount: option.usageCount ?? COPY_VERSIONS.filter((version) => version.v === option.versionKey).length,
    }))
    .sort((left, right) => left.sortOrder - right.sortOrder || left.versionKey.localeCompare(right.versionKey));
  const ACTIVE_VERSION_OPTIONS = VERSION_OPTIONS
    .filter((option) => option.status.toUpperCase() === "ACTIVE")
    .map((option) => ({ value: option.versionKey, label: `${option.versionKey} · ${option.name}`, status: option.status }));
  const ACTIVE_EXPERIMENT_COPY_KEYS = new Set(
    (data?.experiments ?? [])
      .filter((experiment) => experiment.state.toLowerCase() === "scheduled" || experiment.state.toLowerCase() === "running")
      .map((experiment) => experiment.copyKey),
  );
  const EXPERIMENT_COPY_CANDIDATES = COPY_POOL.map((copy) => ({
    value: copy.key,
    label: `${copy.desc} · ${copy.key}`,
    versions: COPY_VERSIONS
      .filter((version) => version.copyKey === copy.key && version.st.toLowerCase() !== "draft")
      .map((version) => ({
        value: version.v,
        label: `${version.v} · ${version.st.toLowerCase() === "published" ? "已发布" : "已归档"}`,
        audience: version.audience,
        audienceTarget: version.audienceTarget ?? undefined,
        estimatedAudience: version.estimatedAudience,
      })),
  })).filter((copy) => copy.versions.length >= 2);
  const EXPERIMENT_COPY_OPTIONS: ExperimentCopyOption[] = EXPERIMENT_COPY_CANDIDATES
    .filter((copy) => !ACTIVE_EXPERIMENT_COPY_KEYS.has(copy.value) && !lockReason(`copy:${copy.value}`));
  const experimentUnavailableReason = EXPERIMENT_COPY_CANDIDATES.length === 0
    ? "至少需要同一文案下存在 2 个非草稿内容版本"
    : EXPERIMENT_COPY_CANDIDATES.map((copy) => lockReason(`copy:${copy.value}`)).find(Boolean)
      ?? "符合条件的文案已有待启动或进行中的实验，请先完成或停止现有实验";
  const usedVersionsForCopy = (copy: CopyRow) => new Set(
    copy.usedVersionKeys ?? COPY_VERSIONS.filter((row) => row.copyKey === copy.key).map((row) => row.v),
  );
  const EXP_FRAMEWORK = (data?.frameworkParams ?? []).map((row) => ({
    key: row.key,
    name: row.name,
    cur: row.current,
    sub: row.description,
  }));
  const EXPS: ExpRow[] = (data?.experiments ?? []).map((row) => ({
    id: row.id,
    copyKey: row.copyKey,
    variants: row.variants.map((v) => ({ name: v.name, split: v.split, cvr: Number(v.cvr), version: v.version ?? "", impressions: v.impressions, conversions: v.conversions })),
    audience: row.audience,
    estimatedAudience: row.estimatedAudience,
    impressions: row.impressions,
    conversions: row.conversions,
    state: row.state,
    note: row.note,
  }));
  const COPY_TRAFFIC_SPLITS = Array.from(new Set([
    ...(data?.trafficSplits ?? []),
    ...COPY_POOL.map((c) => c.draftTrafficSplit),
    ...COPY_VERSIONS.map((v) => v.trafficSplit),
  ].filter((item): item is string => !!item?.trim())));
  const COPY_POSITION_ROWS = data?.positions ?? [];
  const COPY_POSITIONS = COPY_POSITION_ROWS.map((position) => ({
    value: position.positionKey,
    label: `${position.name} · ${position.positionKey}`,
    surface: normalizeCopyModule(position.surface),
    status: position.status,
  })).filter((position) => position.status.toUpperCase() === "ACTIVE");
  const COPY_POSITION_OPTIONS = COPY_POSITIONS;

  const findVersion = (copyKey: string, version?: string) => (version ? COPY_VERSIONS.find((row) => row.copyKey === copyKey && row.v === version) : undefined);
  const findCopy = (key: string) => COPY_POOL.find((copy) => copy.key === key);
  const optionName = (versionKey?: string) => VERSION_OPTIONS.find((option) => option.versionKey === versionKey)?.name;
  const positionName = (positionKey?: string) => COPY_POSITION_ROWS.find((position) => position.positionKey === positionKey)?.name ?? positionKey ?? "—";
  const isPublished = (copy: CopyRow) => copy.status.toLowerCase() === "published";
  /** 同一个位置上另外已发布的文案（I1-PD01：App 要求一个位置恰好一条）。 */
  const othersPublishedAt = (positionKey: string | undefined, exceptKey: string) => positionKey
    ? COPY_POOL.filter((copy) => copy.key !== exceptKey && isPublished(copy) && copy.copyPosition === positionKey)
    : [];
  const crowdNotice = (positionKey: string | undefined, exceptKey: string) => {
    const others = othersPublishedAt(positionKey, exceptKey);
    if (others.length === 0) return null;
    return <Notice tone="warn" title="这个位置已有发布中的内容">「{others.map((copy) => copy.desc).join("、")}」已在{positionName(positionKey)}发布。再发布一条会让这个位置在 App 里取不到内容。</Notice>;
  };
  const i18nFact = (key: string) => (
    <Fact k="同时更新">词条 <span data-mono="">{key}</span>（{reach("/content/i18n") ? <Link className="rd-link" href="/content/i18n" prefetch={false}>多语言与课程</Link> : "多语言与课程"}）</Fact>
  );
  const variantsText = (exp: ExpRow) => exp.variants.map((variant) => `${variant.name} ${variant.version || "—"} ${variant.split}%`).join(" · ");

  const runBackend = (task: Promise<void>, ok: string) => {
    return task
      .then(() => refreshAfterMutation())
      .then(() => { toast(ok); return true; });
  };

  const liveCopyStatus = (c: CopyRow): string => c.status;
  const liveExpState = (e: ExpRow): string => e.state;
  const liveFw = (_key: string, cur: string): string => cur;

  const filteredVersions = COPY_VERSIONS.filter((row) =>
    (versionCopyFlt === "all" || row.copyKey === versionCopyFlt)
    && (versionStatusFlt === "all" || row.st.toLowerCase() === versionStatusFlt));
  const versionPages = Math.max(1, Math.ceil(filteredVersions.length / VERSION_PAGE_SIZE));
  const safeVersionPage = Math.min(versionPage, versionPages);
  const pagedVersions = filteredVersions.slice((safeVersionPage - 1) * VERSION_PAGE_SIZE, safeVersionPage * VERSION_PAGE_SIZE);
  const filteredExps = EXPS.filter((e) => {
    if (expFlt === "all") return true;
    const st = liveExpState(e);
    if (expFlt === "running") return st === "running";
    return st === "concluded" || st === "adopted" || st === "discarded" || st === "stopped";
  });

  // 编辑文案 —— 先在抽屉里填，存草稿或发布再进操作确认。
  const editCopy = (c: CopyRow, targetVersion?: VersionRow, forceNew = false) => {
    const editableVersion = targetVersion
      ?? COPY_VERSIONS.find((row) => row.copyKey === c.key && row.v === c.draftVersion)
      ?? COPY_VERSIONS.find((row) => row.copyKey === c.key && row.v === c.version);
    const editingExistingDraft = !forceNew && editableVersion?.st.toLowerCase() === "draft";
    const usedVersions = usedVersionsForCopy(c);
    const selectableVersions = ACTIVE_VERSION_OPTIONS.filter((option) => editingExistingDraft || !usedVersions.has(option.value));
    if (forceNew && selectableVersions.length === 0) {
      toast("请先在文案版本列表中新增或启用一个未被该文案使用的版本");
      return;
    }
    const spec: CopyEditSpec = {
      kind: "copy-edit",
      keyName: c.key,
      version: editingExistingDraft ? editableVersion?.v || "" : "",
      versionOptions: selectableVersions,
      surface: editableVersion?.surface || c.surface,
      copyPosition: editableVersion?.copyPosition || c.copyPosition,
      audience: editableVersion?.audience,
      ...audienceTargetFields(editableVersion?.audienceTarget),
      trafficSplit: editableVersion?.trafficSplit,
      trafficSplits: COPY_TRAFFIC_SPLITS,
      modules: COPY_MODULE_OPTIONS,
      positions: COPY_POSITION_OPTIONS,
      zh: editableVersion?.zh || "",
      en: editableVersion?.en || "",
      vi: editableVersion?.vi || "",
      versionNote: editableVersion?.versionNote || "后台编辑文案",
      placeholders: requiredPlaceholders(editableVersion?.zh, editableVersion?.en, editableVersion?.vi),
      saveModeChoice: true,
    };
    setCopyDetail(null);
    setVersionDetail(null);
    setEditor({ kind: "edit", spec, copy: c, base: editableVersion, forceNew });
  };

  const submitCopyEdit = (c: CopyRow, editableVersion: VersionRow | undefined, form: BusinessFormValue, mode: SaveMode) => {
    const draft = mode === "存草稿";
    const target = form.version || editableVersion?.v || "";
    const current = findVersion(c.key, c.version);
    const pauses = draft && isPublished(c);
    openActionConfirm({ briefKind: "config",
      action: <>{draft ? "存草稿" : "发布内容版本"} · {c.key} {target}</>,
      title: `${draft ? "存草稿" : "发布"} ${target}`,
      detail: <>{draft ? "保存这个草稿。" : "发布这个版本。"}</>,
      amplifies: false,
      effect: draft ? (pauses ? LIVE : OFFLINE("保存草稿，线上不变")) : LIVE,
      confirmLabel: draft ? "确认存草稿" : "确认发布",
      statedBrief: draft
        ? { impact: pauses ? `保存草稿 ${target}，这条文案的状态变成草稿。` : "只保存草稿，这条文案现在没有在投放。", check: "核对三种语言和位置；存草稿不更新多语言与课程的词条。" }
        : { impact: `${target} 替换现在发布的 ${c.version}，同时更新多语言与课程里的同名词条。`, check: "核对三种语言、位置和占位符。" },
      facts: <Facts>
        <Fact k="文案">{c.desc} · <span data-mono="">{c.key}</span></Fact>
        <Fact k="位置">{positionName(form.copyPosition)} · {moduleLabel(form.surface)}</Fact>
        {!draft && i18nFact(c.i18nKey)}
      </Facts>,
      content: <>
        {pauses && <Notice tone="warn" title="存草稿会撤下线上内容">按位置取文案时取不到这条文案，发布或删掉这个草稿后恢复。</Notice>}
        {!draft && crowdNotice(form.copyPosition, c.key)}
        <CompareTexts beforeLabel={`现在 ${c.version}`} afterLabel={draft ? `草稿 ${target}` : `发布后 ${target}`} before={textsOf(current)} after={textsOfForm(form)} />
      </>,
      run: (reason) => {
        const payload = {
          version: form?.version || editableVersion?.v,
          surface: form?.surface || editableVersion?.surface || c.surface,
          copyPosition: form?.copyPosition || editableVersion?.copyPosition || c.copyPosition || "",
          audience: composeAudience(form),
          audienceTarget: composeAudienceTarget(form),
          phaseMin: form?.phaseMin,
          phaseMax: form?.phaseMax,
          language: form?.language,
          registrationDaysGt: Number(form?.registrationDaysGt || 0),
          trafficSplit: form?.trafficSplit || editableVersion?.trafficSplit || COPY_TRAFFIC_SPLITS[0] || "",
          versionNote: form?.versionNote || "后台编辑文案",
          zh: form?.zh || editableVersion?.zh || "",
          en: form?.en || editableVersion?.en || "",
          vi: form?.vi || editableVersion?.vi || "",
          expectedRevision: c.revision,
        };
        const done = (result: unknown) => { if (result !== false) setEditor(null); return result; };
        if (form?.saveMode === "存草稿") {
          return runBackend(actions.saveI1CopyDraft(c.key, payload, reason), pauses ? `${c.key} 草稿已保存，暂停投放` : `${c.key} 草稿已保存，线上不变`).then(done);
        } else {
          return runBackend(actions.publishI1CopyVersion(c.key, payload, reason), `${c.key} 新版本已发布生效`).then(done);
        }
      },
    });
  };

  const createCopy = (preset?: { surface: string; copyPosition: string }) => {
    if (ACTIVE_VERSION_OPTIONS.length === 0) {
      toast("请先在文案版本列表中新增或启用文案版本");
      return;
    }
    setEditor({ kind: "create", spec: {
      kind: "copy-create",
      modules: COPY_MODULE_OPTIONS,
      positions: COPY_POSITIONS,
      versionOptions: ACTIVE_VERSION_OPTIONS,
      trafficSplits: COPY_TRAFFIC_SPLITS,
      ...preset,
    } });
  };

  const submitCreateCopy = (form: BusinessFormValue) => openActionConfirm({ briefKind: "config",
    action: <>新增文案</>,
    title: "新增文案并发布",
    detail: <>新建文案并发布第一个版本。</>,
    amplifies: false,
    effect: LIVE,
    confirmLabel: "确认新增",
    statedBrief: { impact: "新建这条文案并直接发布第一个版本，同时在多语言与课程里建同名词条。", check: "核对文案标识、位置和三种语言；文案标识建好后不能改。" },
    facts: <Facts>
      <Fact k="文案">{form.description?.trim() || "—"} · <span data-mono="">{form.copyKey?.trim() || "—"}</span></Fact>
      <Fact k="位置">{positionName(form.copyPosition)} · {moduleLabel(form.surface)}</Fact>
      <Fact k="版本">{form.version}</Fact>
      {i18nFact(form.copyKey?.trim() || "—")}
    </Facts>,
    content: <>
      {crowdNotice(form.copyPosition, "")}
      <div className="rd-impact"><div className="rd-impact-title">发布的内容</div><LangBlocks texts={textsOfForm(form)} /></div>
    </>,
    run: (reason) => {
      if (!form?.copyKey?.trim()) return false;
      const copyKey = form.copyKey.trim();
      return runBackend(actions.createI1Copy({
        copyKey,
        version: form.version,
        description: form.description?.trim() || copyKey,
        surface: form.surface || "home",
        copyPosition: form.copyPosition || "",
        i18nKey: copyKey,
        audience: composeAudience(form),
        audienceTarget: composeAudienceTarget(form),
        phaseMin: form?.phaseMin,
        phaseMax: form?.phaseMax,
        language: form?.language,
        registrationDaysGt: Number(form?.registrationDaysGt || 0),
        trafficSplit: form.trafficSplit || COPY_TRAFFIC_SPLITS[0] || "50",
        versionNote: form.versionNote || "新增文案初始内容",
        zh: form.zh || "",
        en: form.en || "",
        vi: form.vi || "",
      }, reason), `文案 ${copyKey} 已新增 · 初始内容已发布`).then((result) => { if (result !== false) setEditor(null); return result; });
    },
  });

  const versionOptionForm = (option?: VersionOptionRow): BusinessFormSpec => ({
    kind: "multi-field",
    fields: [
      ...(option ? [] : [{ key: "versionKey", label: "版本标识", placeholder: "v3", pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$", patternMessage: "字母或数字开头，最多 32 位，可用点、下划线、短横线", explain: "建好后不能改。" }]),
      { key: "name", label: "版本名称", placeholder: "转化优化版", current: option?.name ?? "" },
      { key: "status", label: "状态", inputKind: "select" as const, options: ["ACTIVE", "INACTIVE"], optionLabels: { ACTIVE: "启用", INACTIVE: "停用" }, current: option?.status ?? "ACTIVE", explain: "停用后新增文案和新增版本时不能选它，已有内容不受影响。" },
      { key: "sortOrder", label: "排序", inputKind: "number" as const, min: 0, step: 1, current: String(option?.sortOrder ?? 0), help: "数字小的排前面" },
      { key: "description", label: "版本说明", placeholder: "这个版本用在哪、想改什么", required: false, maxLength: 255, current: option?.description ?? "", wide: true },
    ],
  });

  const createCopyVersionOption = () => openActionConfirm({ briefKind: "config",
    action: <>新增文案版本</>,
    title: "新增版本",
    detail: <>新增一个可选的版本。</>,
    amplifies: false,
    effect: OFFLINE("只加目录，线上不变"),
    confirmLabel: "确认新增",
    statedBrief: { impact: "新增后，新增文案和新增版本时可以选它；不会给已有文案建内容。", check: "核对版本标识，建好后不能改。" },
    businessForm: versionOptionForm(),
    run: (reason, _value, form) => runBackend(actions.createI1CopyVersionOption({
      versionKey: form?.versionKey?.trim(),
      name: form?.name?.trim(),
      description: form?.description?.trim() || "",
      status: form?.status || "ACTIVE",
      sortOrder: Number(form?.sortOrder || 0),
    }, reason), `文案版本 ${form?.versionKey} 已新增`),
  });

  const editCopyVersionOption = (option: VersionOptionRow) => openActionConfirm({ briefKind: "config",
    action: <>编辑文案版本 · {option.versionKey}</>,
    title: `编辑版本 ${option.versionKey}`,
    detail: <>修改版本的名称、说明、排序和状态。</>,
    amplifies: false,
    effect: OFFLINE("只改目录，线上不变"),
    confirmLabel: "确认保存",
    statedBrief: { impact: "已有内容和发布历史不受影响；停用后新增文案和新增版本时不能选它。", check: "版本标识不能改；核对状态。" },
    facts: <Facts><Fact k="版本标识"><span data-mono="">{option.versionKey}</span></Fact><Fact k="被用过">{option.usageCount} 次</Fact></Facts>,
    businessForm: versionOptionForm(option),
    run: (reason, _value, form) => runBackend(actions.updateI1CopyVersionOption(option.versionKey, {
      name: form?.name?.trim(),
      description: form?.description?.trim() || "",
      status: form?.status || option.status,
      sortOrder: Number(form?.sortOrder || 0),
      expectedRevision: option.revision,
    }, reason), `文案版本 ${option.versionKey} 已更新`),
  });

  const deleteCopyVersionOption = (option: VersionOptionRow) => openActionConfirm({ briefKind: "record",
    action: <>删除文案版本 · {option.versionKey}</>,
    title: `删除版本 ${option.versionKey}`,
    detail: <>删除一个从没被用过的版本。</>,
    amplifies: false,
    effect: <IrreversibleTag>不能恢复</IrreversibleTag>,
    confirmTone: "danger",
    confirmLabel: "确认删除",
    statedBrief: { impact: "这个版本从目录里删掉，不能恢复；用过的版本删不掉。", check: "核对版本标识；不想再用可以改成停用。" },
    facts: <Facts><Fact k="版本">{option.versionKey} · {option.name}</Fact><Fact k="被用过">{option.usageCount} 次</Fact></Facts>,
    run: (reason) => runBackend(actions.deleteI1CopyVersionOption(option.versionKey, option.revision, reason), `文案版本 ${option.versionKey} 已删除`),
  });

  const createCopyPosition = () => openActionConfirm({ briefKind: "config",
    action: <>新增文案位置</>,
    title: "新增文案位置",
    detail: <>新增一个可以放文案的位置。</>,
    amplifies: false,
    effect: OFFLINE("只加位置，线上不变"),
    confirmLabel: "确认新增",
    statedBrief: { impact: "新增一个可以放文案的位置；不会自动建文案，App 也不会因此多出控件。", check: "核对标识和模块，这页建好后不能改。" },
    businessForm: { kind: "multi-field", fields: [
      { key: "positionKey", label: "位置标识", placeholder: "home.hero.banner", explain: "小写字母开头，可用小写字母、数字、点、下划线、短横线，2–96 位。" },
      { key: "positionName", label: "位置名称", placeholder: "首页主横幅" },
      { key: "surface", label: "投放模块", inputKind: "select", options: COPY_MODULE_OPTIONS.map((item) => item.value), optionLabels: COPY_MODULE_LABELS },
    ] },
    run: (reason, _value, form) => {
      if (!form?.positionKey?.trim()) return false;
      return runBackend(actions.createI1CopyPosition({
        positionKey: form.positionKey.trim(),
        name: form.positionName?.trim() || form.positionKey.trim(),
        surface: form.surface || "home",
        sortOrder: 0,
      }, reason), `文案位置 ${form.positionKey.trim()} 已新增`);
    },
  });

  const deleteCopyPosition = (positionKey: string) => {
    const users = new Set([
      ...COPY_POOL.filter((copy) => copy.copyPosition === positionKey || copy.draftCopyPosition === positionKey).map((copy) => copy.key),
      ...COPY_VERSIONS.filter((version) => version.copyPosition === positionKey).map((version) => version.copyKey),
    ]);
    const position = COPY_POSITION_ROWS.find((item) => item.positionKey === positionKey);
    openActionConfirm({ briefKind: "config",
      action: <>删除文案位置 · {positionKey}</>,
      title: "删除文案位置",
      detail: <>删除一个没被用过的位置。</>,
      amplifies: false,
      effect: <IrreversibleTag>不能恢复</IrreversibleTag>,
      confirmTone: "danger",
      confirmLabel: "确认删除",
      statedBrief: { impact: "这个位置从目录里删掉，不能恢复；有文案或版本用到它时删不掉。", check: "核对位置标识。" },
      facts: <Facts>
        <Fact k="位置">{position?.name ?? "—"} · <span data-mono="">{positionKey}</span></Fact>
        <Fact k="模块">{moduleLabel(normalizeCopyModule(position?.surface))}</Fact>
        <Fact k="在用" tone={users.size > 0 ? "warn" : undefined}>{users.size > 0 ? `${users.size} 条文案用到它，删除会被拒绝` : "没有文案用到它"}</Fact>
      </Facts>,
      run: (reason) => runBackend(actions.deleteI1CopyPosition(positionKey, reason), `文案位置 ${positionKey} 已删除`),
    });
  };

  const rollbackTo = (copy: CopyRow, v: string) => {
    const target = findVersion(copy.key, v);
    openActionConfirm({ briefKind: "content",
      action: <>回滚 · {copy.key} → 重新发布 {v}</>,
      title: `回滚到 ${v}`,
      detail: <>把历史版本 {v} 重新发布。</>,
      amplifies: false,
      effect: LIVE,
      confirmLabel: "确认回滚",
      statedBrief: { impact: `${v} 重新发布，现在的 ${copy.version} 转为已归档，位置和模块按 ${v} 的；草稿和实验记录保留，同名词条一起更新。`, check: "核对内容对比；历史版本缺位置或受众时会被拒绝。" },
      facts: <Facts>
        <Fact k="文案">{copy.desc} · <span data-mono="">{copy.key}</span></Fact>
        <Fact k="位置">{positionName(target?.copyPosition)} · {moduleLabel(target?.surface)}</Fact>
        {i18nFact(copy.i18nKey)}
      </Facts>,
      content: <>
        {crowdNotice(target?.copyPosition, copy.key)}
        {target && <CompareTexts beforeLabel={`现在 ${copy.version}`} afterLabel={`回滚后 ${v}`} before={textsOf(findVersion(copy.key, copy.version))} after={textsOf(target)!} />}
      </>,
      run: (reason) => {
        if (copy.revision == null) {
          toast("当前文案修订号缺失，请刷新后重试");
          return false;
        }
        return runBackend(actions.rollbackI1CopyVersion(copy.key, v, copy.version, copy.revision, reason), `${copy.key} 已回滚到 ${v}`);
      },
    });
  };

  const archiveCurrentVersion = (copy: CopyRow, version: string) => openActionConfirm({ briefKind: "content",
    action: <>下架当前发布版 · {copy.key} {version}</>,
    title: `下架 ${version}`,
    detail: <>下架现在发布的版本。</>,
    amplifies: false,
    effect: LIVE,
    confirmLabel: "确认下架",
    statedBrief: { impact: "下架后这条文案没有发布中的内容，按位置取不到它，同名词条一起下架；App 上已经拿到的内容，要等它重新读取才变。", check: "常规换内容直接发新版本，不用先下架。" },
    facts: <Facts>
      <Fact k="文案">{copy.desc} · <span data-mono="">{copy.key}</span></Fact>
      <Fact k="下架的版本">{version}{optionName(version) ? ` · ${optionName(version)}` : ""}</Fact>
      <Fact k="位置">{positionName(copy.copyPosition)}</Fact>
    </Facts>,
    run: (reason) => {
      if (copy.revision == null) {
        toast("当前文案修订号缺失，请刷新后重试");
        return false;
      }
      return runBackend(actions.archiveI1Copy(copy.key, version, copy.revision, reason), `${copy.key} ${version} 已下架`);
    },
  });

  const deleteDraftVersion = (copyKey: string, version: string, revision: number) => {
    const copy = findCopy(copyKey);
    const back = copy && findVersion(copyKey, copy.version)?.st.toLowerCase() === "published";
    openActionConfirm({ briefKind: "record",
      action: <>删除草稿 · {copyKey} {version}</>,
      title: `删除草稿 ${version}`,
      detail: <>删除这个草稿。</>,
      amplifies: false,
      effect: <IrreversibleTag>不能恢复</IrreversibleTag>,
      confirmTone: "danger",
      confirmLabel: "确认删除",
      statedBrief: { impact: back ? `草稿删掉、不能恢复；这条文案回到发布 ${copy?.version} 的状态。` : "草稿删掉、不能恢复；已发布和已归档的版本不受影响。", check: "这个版本号以后不能再给这条文案用。" },
      facts: <Facts>
        <Fact k="文案">{copy?.desc ?? copyKey} · <span data-mono="">{copyKey}</span></Fact>
        <Fact k="草稿">{version}</Fact>
        {back && <Fact k="之后">恢复投放 {copy?.version}</Fact>}
      </Facts>,
      run: (reason) => {
        const mutationKey = `${copyKey}:${version}`;
        if (deleteInFlightRef.current) return false;
        deleteInFlightRef.current = true;
        setDeletingDraftKey(mutationKey);
        return runBackend(actions.deleteI1CopyDraft(copyKey, version, revision, reason), `${copyKey} ${version} 草稿已删除`)
          .finally(() => {
            deleteInFlightRef.current = false;
            setDeletingDraftKey(null);
          });
      },
    });
  };

  const adjustFramework = (key: string, name: string, cur: string) => openConfirm({ briefKind: "config",
    action: <>实验框架参数 · {name}</>,
    title: `调整 ${name}`,
    detail: <>当前值：<b>{cur}</b>。目前只保存这个值，创建、启动和运行实验都不读它。</>,
    effect: OFFLINE("目前不影响实验运行"),
    reasonPlaceholder: "例如：工单号、调整依据",
    statedBrief: { impact: "只保存新的值；创建、启动和运行实验都不读它。", check: "核对新值，最多 80 字。" },
    input: { label: "新的值", placeholder: cur },
    reason: true,
    okLabel: "保存",
    run: (reason, v) => {
      if (!v) return false;
      return runBackend(actions.updateI1Framework(key, v, cur, reason), `${name} 默认值已更新为 ${v}`);
    },
  });

  /* ---------- 刚被别人改过：看最新的和自己填的，确认后按最新的重建编辑器或确认框 ---------- */
  const conflictUi = (() => {
    const conflict = conflictReview.review;
    if (!conflict) return null;
    const original = conflict.rejectedCommand?.original;
    const path = original?.path ?? "";
    let body: Record<string, unknown> = {};
    try { body = original ? JSON.parse(original.body) as Record<string, unknown> : {}; } catch { body = {}; }
    const part = (index: number) => decodeURIComponent(path.split("/")[index] ?? "");
    const ready = !!conflict.latest;
    const findCopy = (key: string): CopyRow | undefined => {
      const row = conflict.latest?.copies.find(copy => copy.key === key);
      return row && { ...row, surface: normalizeCopyModule(row.surface), draftSurface: row.draftSurface ? normalizeCopyModule(row.draftSurface) : undefined };
    };
    const findVersion = (key: string, version?: string): VersionRow | undefined => {
      const row = conflict.latest?.versions.find(item => item.copyKey === key && item.version === version);
      return row && { ...row, v: row.version, st: row.status, surface: normalizeCopyModule(row.surface) };
    };
    let subject: ReactNode = "这一项";
    let rows: IConflictRow[] = [];
    let columns: [string, string] = ["你打开时", "现在"];
    let gone: string | undefined;
    let note: ReactNode;
    let rebuildLabel = "按最新的重新确认";
    let rebuild: (() => void) | undefined;
    const optionState = (value: unknown) => !value ? undefined : String(value).toUpperCase() === "ACTIVE" ? "启用" : "停用";
    const reopen = (task: () => void) => () => { prefill.current = { reason: conflict.requested.reason, business: conflict.requested.form }; task(); prefill.current = null; };
    if (path.startsWith("/copy-ab/copies/")) {
      const key = part(3);
      const copy = findCopy(key);
      subject = <>文案 <span data-mono="">{key}</span></>;
      if (ready && !copy) gone = "这条文案在最新读取里没有了，不能按最新的重做。";
      const state = copy ? `${copy.version} · ${copyStatus(copy.status).text}${copy.draftVersion ? ` · 草稿 ${copy.draftVersion}` : ""}` : "—";
      const editing = (original?.method === "PATCH" && path.endsWith("/draft")) || (original?.method === "POST" && /\/versions$/.test(path));
      if (editing) {
        columns = ["现在", "你填的"];
        rebuildLabel = "按最新的重新填写";
        const latestText = findVersion(key, copy?.draftVersion) ?? findVersion(key, copy?.version);
        const audienceNow = audienceTargetFields(latestText?.audienceTarget);
        const languageName = (value: unknown) => typeof value !== "string" || !value ? undefined : LANGUAGE_OPTIONS.find((option) => option.value === value)?.label ?? value;
        rows = [...inGroup("版本", [conflictRow("这条文案", state, `存成 ${String(body.version ?? "—")}`), conflictRow("版本说明", latestText?.versionNote, body.versionNote)]),
          ...inGroup("三语内容", [conflictRow("中文", latestText?.zh, body.zh), conflictRow("英语", latestText?.en, body.en), conflictRow("越南语", latestText?.vi, body.vi)]),
          ...inGroup("投放", [conflictRow("投放模块", latestText?.surface && moduleLabel(latestText.surface), typeof body.surface === "string" && body.surface ? moduleLabel(body.surface) : undefined),
            conflictRow("文案位置", latestText?.copyPosition && positionName(latestText.copyPosition), typeof body.copyPosition === "string" && body.copyPosition ? positionName(body.copyPosition) : undefined), conflictRow("分流比例", latestText?.trafficSplit && `${latestText.trafficSplit}%`, body.trafficSplit == null || body.trafficSplit === "" ? undefined : `${String(body.trafficSplit)}%`)]),
          ...inGroup("受众", [conflictRow("受众", latestText?.audience, body.audience),
            conflictRow("最低阶段", audienceNow.phaseMin, body.phaseMin), conflictRow("最高阶段", audienceNow.phaseMax, body.phaseMax),
            conflictRow("语言", languageName(audienceNow.language), languageName(body.language)),
            conflictRow("注册超过", audienceNow.registrationDaysGt && `${audienceNow.registrationDaysGt} 天`, body.registrationDaysGt == null ? undefined : `${String(body.registrationDaysGt)} 天`)])];
        note = original?.method === "PATCH" ? "保存会用你填的整份内容替换现在的草稿；别人改的要留，先在编辑框里补上。" : "你填的内容留在编辑框里，提交时按最新的版本。";
        rebuild = copy ? () => (prefill.current = { reason: conflict.requested.reason }) && setEditor((current) => current?.kind === "edit" && current.copy.key === key
          ? { ...current, copy, base: findVersion(key, current.base?.v) ?? current.base } : current) : undefined;
      } else {
        const version = part(5);
        rows = [conflictRow("这条文案", String(body.expectedVersion ?? "—"), state)];
        const target = version ? findVersion(key, version) : undefined;
        if (version) rows.push(conflictRow(`版本 ${version}`, "—", target ? versionStatus(target.st).text : "没有了"));
        if (ready && version && !target) gone = `${version} 在最新读取里没有了。`;
        rebuild = !copy ? undefined
          : path.endsWith("/rollback") ? target && reopen(() => rollbackTo(copy, version))
            : path.endsWith("/archive") ? reopen(() => archiveCurrentVersion(copy, copy.version))
              : original?.method === "DELETE" && target ? reopen(() => deleteDraftVersion(key, version, copy.revision ?? 0)) : undefined;
      }
    } else if (path.startsWith("/copy-ab/version-options/")) {
      const key = part(3);
      const latestOption = conflict.latest?.versionOptions.find((row) => row.versionKey === key);
      const option = latestOption && { ...latestOption, usageCount: latestOption.usageCount ?? conflict.latest!.versions.filter(row => row.version === key).length };
      subject = <>版本 <span data-mono="">{key}</span></>;
      if (ready && !option) gone = "这个版本在最新读取里没有了，不能按最新的重做。";
      if (original?.method === "PUT") {
        columns = ["现在", "你填的"];
        rebuildLabel = "按最新的重新填写";
        rows = [conflictRow("名称", option?.name, body.name), conflictRow("说明", option?.description, body.description), conflictRow("状态", optionState(option?.status), optionState(body.status)), conflictRow("排序", option?.sortOrder, body.sortOrder)];
        rebuild = option && reopen(() => editCopyVersionOption(option));
      } else {
        rows = [conflictRow("用到它的文案", "—", option ? `${option.usageCount} 条` : "—"), conflictRow("状态", "—", option?.status)];
        rebuild = option && reopen(() => deleteCopyVersionOption(option));
      }
    } else if (path.startsWith("/copy-ab/framework/")) {
      const key = part(3);
      const latestParam = conflict.latest?.frameworkParams.find((row) => row.key === key);
      const param = latestParam && { ...latestParam, cur: latestParam.current };
      subject = <>{param?.name ?? key}</>;
      if (ready && !param) gone = "这个参数在最新读取里没有了。";
      rows = [conflictRow("值", body.expectedValue, param?.cur), conflictRow("你填的新值", body.value, body.value)];
      rows[1].changed = false;
      note = "这个框带不回你填的新值和理由，重新打开后照上面再填一次。";
      rebuild = param && (() => { prefill.current = { reason: conflict.requested.reason, value: conflict.requested.value }; adjustFramework(param.key, param.name, param.cur); });
    }
    if (!rebuild && !gone) { rebuildLabel = "知道了"; note = "最新的已经读到页面上，关掉后重新打开要做的操作。"; }
    const finish = (task?: () => void) => {
      if (!conflictReview.confirm(conflict, () => undefined)) return;
      conflictView.show();
      if (task) window.setTimeout(task, 0);
    };
    return conflictView.open
      ? <IConflictModal review={conflict} subject={subject} rows={rows} columns={columns} gone={gone} note={note} rebuildLabel={rebuildLabel}
          onReread={() => void conflictReview.reread()} onClose={conflictView.hide} onRebuild={() => finish(rebuild)}
          onDiscard={() => finish(() => setEditor(null))} />
      : <IConflictPending subject={subject} onOpen={conflictView.show} />;
  })();

  const createExperiment = () => {
    if (EXPERIMENT_COPY_OPTIONS.length === 0) {
      toast(`暂无可创建实验的文案：${experimentUnavailableReason}`);
      return;
    }
    setCreatingExperiment(true);
  };

  const submitExperiment = (form: BusinessFormValue) => {
    const count = Number(form?.variantCount || 0);
    const copy = findCopy(form.copyKey);
    const first = EXPERIMENT_COPY_OPTIONS.find((item) => item.value === form.copyKey)?.versions.find((item) => item.value === form["variantVersion.0"]);
    openActionConfirm({ briefKind: "config",
      action: <>创建 A/B 实验</>,
      title: "创建对比实验",
      detail: <>创建一个待启动的实验。</>,
      amplifies: false,
      effect: OFFLINE("创建后待启动，线上不变"),
      confirmLabel: "确认创建",
      statedBrief: { impact: "创建后是待启动，不分组、不改用户看到的内容；要人点「启动」才开始。", check: "核对各组版本和分流，启动后不能改。" },
      facts: <Facts>
        <Fact k="文案">{copy?.desc ?? form.copyKey} · <span data-mono="">{form.copyKey}</span></Fact>
        {Array.from({ length: count }, (_, index) => (
          <Fact key={index} k={`${String.fromCharCode(65 + index)} 组`}>{form[`variantVersion.${index}`]} · 分流 {form[`variantSplit.${index}`]}%</Fact>
        ))}
        <Fact k="受众">{audienceText(first)}</Fact>
      </Facts>,
      run: (reason) => {
        const variants = Array.from({ length: count }, (_, index) => ({
          version: form?.[`variantVersion.${index}`]?.trim() || "",
          splitPct: Number(form?.[`variantSplit.${index}`] || 0),
        }));
        const versions = variants.map((variant) => variant.version);
        const valid = !!form?.copyKey
          && variants.length >= 2
          && variants.every((variant) => variant.version && Number.isInteger(variant.splitPct) && variant.splitPct >= 1 && variant.splitPct <= 99)
          && new Set(versions).size === versions.length
          && variants.reduce((sum, variant) => sum + variant.splitPct, 0) === 100;
        if (!valid) {
          toast("实验版本或分流比例无效，请确认至少 2 个不同版本且分流合计为 100%");
          return false;
        }
        const note = form?.note?.trim();
        return runBackend(actions.createI1Experiment({
          copyKey: form!.copyKey,
          variants,
          ...(note ? { note } : {}),
        }, reason), "A/B 实验已创建 · 等待启动").then((result) => { if (result !== false) setCreatingExperiment(false); return result; });
      },
    });
  };

  const experimentFacts = (exp: ExpRow) => {
    const copy = findCopy(exp.copyKey);
    return <>
      <Fact k="文案">{copy?.desc ?? exp.copyKey} · <span data-mono="">{exp.copyKey}</span></Fact>
      <Fact k="实验"><span data-mono="">{exp.id}</span></Fact>
      <Fact k="各组">{variantsText(exp)}</Fact>
    </>;
  };

  const startExp = (id: string) => {
    const exp = EXPS.find((item) => item.id === id);
    openActionConfirm({ briefKind: "config",
      action: <>启动实验 · {id}</>,
      title: "启动实验",
      detail: <>启动这个实验。</>,
      amplifies: false,
      effect: LIVE,
      confirmLabel: "确认启动",
      statedBrief: { impact: "启动后，用户第一次请求这个位置时按分流分组，实验进行中一直在这组；版本、分流和受众不能再改。", check: "核对各组版本、分流和受众。" },
      facts: exp && <Facts>
        {experimentFacts(exp)}
        <Fact k="受众">{exp.audience || "—"}</Fact>
        <Fact k="估算人数">{exp.estimatedAudience == null ? "—" : `约 ${exp.estimatedAudience.toLocaleString()} 人（按现在的条件）`}</Fact>
      </Facts>,
      businessForm: { kind: "multi-field", fields: [{ key: "ack", label: "我已核对各组版本、分流和受众", inputKind: "checkbox" }] },
      run: (reason) => runBackend(actions.startI1Experiment(id, reason), `${id} 已启动`),
    });
  };

  const discardExp = (id: string) => {
    const exp = EXPS.find((item) => item.id === id);
    openActionConfirm({ briefKind: "config",
      action: <>弃用实验 · {id}</>,
      title: "弃用实验",
      detail: <>弃用这个实验。</>,
      amplifies: false,
      effect: <IrreversibleTag>不能撤回</IrreversibleTag>,
      confirmTone: "danger",
      confirmLabel: "确认弃用",
      statedBrief: { impact: "弃用后不能再启动或采纳；已收集的数据和操作记录保留，用户看到的内容不变。", check: "要用实验结果，先采纳再说。" },
      facts: exp && <Facts>{experimentFacts(exp)}<Fact k="状态">{experimentState(exp.state).text}</Fact></Facts>,
      run: (reason) => runBackend(actions.discardI1Experiment(id, reason), `${id} 已弃用`),
    });
  };

  const stopExp = (id: string) => {
    const exp = EXPS.find((item) => item.id === id);
    openActionConfirm({ briefKind: "content",
      action: <>停止实验 · {id}</>,
      title: "停止实验",
      detail: <>停止这个实验。</>,
      amplifies: false,
      effect: LIVE,
      confirmLabel: "确认停止",
      statedBrief: { impact: "停止后不再分组，按位置取文案回到已发布的版本；这条文案存了草稿时仍取不到。数据保留，之后可以采纳或弃用。", check: "App 上已经拿到的内容，要等它重新读取才变。" },
      facts: exp && <Facts>
        {experimentFacts(exp)}
        <Fact k="合计看到">{countOf(exp.impressions) === null ? "—" : `${countOf(exp.impressions)!.toLocaleString()} 人`}</Fact>
        <Fact k="转化">{countOf(exp.conversions) === null ? "—" : `${countOf(exp.conversions)!.toLocaleString()} 人`}</Fact>
      </Facts>,
      run: (reason) => {
        return runBackend(actions.stopI1Experiment(id, reason), `${id} 已停止`);
      },
    });
  };

  const adoptExp = (id: string) => {
    const exp = EXPS.find((item) => item.id === id);
    const copy = exp ? findCopy(exp.copyKey) : undefined;
    const lead = exp ? leaderOf(exp) : undefined;
    const winner = exp?.variants.find((variant) => variant.name === lead);
    const winnerVersion = copy && winner ? findVersion(copy.key, winner.version) : undefined;
    openActionConfirm({ briefKind: "content",
      action: <>采纳获胜变体 · {id}</>,
      title: "采纳实验结果",
      detail: <>把转化率最高的那组发布为现在的版本。</>,
      amplifies: false,
      effect: LIVE,
      confirmLabel: "确认采纳",
      statedBrief: { impact: "按真实转化率选唯一最高的一组，把它的版本发布为现在的版本；同名词条一起更新。", check: "每组至少 100 人看到、转化率唯一最高才能采纳；采纳不重跑发布时的内容检查，先核对内容对比；没有显著性检验。" },
      facts: exp && <Facts>
        {experimentFacts(exp)}
        <Fact k="按页面的数" tone={winner ? "ok" : "warn"}>{winner ? `${winner.name} 组 ${winner.version} 最高（${winner.impressions != null && winner.conversions != null ? `看到 ${winner.impressions.toLocaleString()}、转化 ${winner.conversions.toLocaleString()} 人，` : ""}${winner.cvr.toFixed(2)}%）` : "没有唯一最高的一组，后端会拒绝"}</Fact>
        {copy && i18nFact(copy.i18nKey)}
      </Facts>,
      content: <>
        {copy && crowdNotice(winnerVersion?.copyPosition ?? copy.copyPosition, copy.key)}
        {copy?.draftVersion && <Notice tone="warn" title="这条文案存了草稿">{`采纳后仍取不到，发布或删掉草稿 ${copy.draftVersion} 才恢复投放。`}</Notice>}
        {copy && winnerVersion && <CompareTexts beforeLabel={`现在 ${copy.version}`} afterLabel={`采纳后 ${winnerVersion.v}`} before={textsOf(findVersion(copy.key, copy.version))} after={textsOf(winnerVersion)!} />}
      </>,
      run: (reason) => {
        return runBackend(actions.adoptI1Experiment(id, reason), `${id} 获胜版本已发布`);
      },
    });
  };

  /** New group counters allow the same integer ratio comparison as the backend; older responses retain their rounded-rate hint. */
  function leaderOf(exp: ExpRow): string | undefined {
    const seen = countOf(exp.impressions);
    if (!seen || exp.state === "scheduled" || exp.variants.length < 2) return undefined;
    if (exp.variants.every((variant) => variant.impressions !== undefined && variant.impressions > 0 && variant.conversions !== undefined)) {
      let best = exp.variants[0];
      let tied = false;
      for (const candidate of exp.variants.slice(1)) {
        const comparison = BigInt(candidate.conversions!) * BigInt(best.impressions!)
          - BigInt(best.conversions!) * BigInt(candidate.impressions!);
        if (comparison > BigInt(0)) { best = candidate; tied = false; }
        else if (comparison === BigInt(0)) tied = true;
      }
      return tied ? undefined : best.name;
    }
    const max = Math.max(...exp.variants.map((variant) => variant.cvr));
    const top = exp.variants.filter((variant) => variant.cvr === max);
    return top.length === 1 ? top[0].name : undefined;
  }

  const sampleOf = (exp: ExpRow): { text: ReactNode; tone: "warn" | null } => {
    if (exp.state === "scheduled") return { text: "还没开始", tone: null };
    const short = exp.variants.filter((variant) => variant.impressions !== undefined && variant.impressions < 100);
    if (short.length > 0) {
      if (exp.variants.every((variant) => variant.impressions === 0)) return { text: "还没有人看到", tone: null };
      return { text: `${short.map((variant) => variant.name).join("、")} 组不到 100 人`, tone: exp.state === "adopted" || exp.state === "discarded" ? null : "warn" };
    }
    if (exp.variants.length < 2 || exp.variants.some((variant) => variant.impressions === undefined)) return { text: "—", tone: null };
    return { text: "每组都满 100 人", tone: null };
  };

  const openExperiment = (id: string) => {
    setCopyDetail(null);
    setExpFlt("all");
    setTab("experiments");
    setFocusExp(id);
  };
  useEffect(() => {
    if (tab !== "experiments" || !focusExp) return;
    document.getElementById(`i1-exp-${focusExp}`)?.scrollIntoView({ behavior: "instant" as ScrollBehavior, block: "start" });
  }, [tab, focusExp]);

  const reload = async () => {
    setReloading(true);
    await actions.reloadIContent();
    setReloading(false);
  };

  const header = (
    <PageHeader pageId="I1" title="页面文案对比测试" summary="管 App 各位置的文案版本和对比实验。"
      readOnly={!canWrite && !canCreateCopy && !canManageExperiments ? "这个账号只能查看这页" : undefined}
      actions={canCreateCopy ? <Button variant="primary" icon={<Plus size={14} aria-hidden />} disabledReason={newMutationReason ?? (data && ACTIVE_VERSION_OPTIONS.length === 0 ? "先在「版本目录」新增或启用一个版本" : undefined)} onClick={() => createCopy()}>新增文案</Button> : undefined} />
  );

  if (!data) {
    return (
      <>
        {header}
        {pendingNotice}
        {conflictUi}
        {contentLoading && !errorText
          ? <BlockState state="loading" title="文案数据加载中…" />
          : errorText
            ? <BlockState state="error" title="文案数据读取失败" detail={errorText} onRetry={() => void reload()} retrying={reloading} retryLabel="重新加载" />
            : <BlockState state="empty" title="暂无文案数据" detail="没有读到文案位置和文案。" />}
      </>
    );
  }

  // ---- 位置卡 ----
  const versionsOf = (copyKey: string) => COPY_VERSIONS.filter((row) => row.copyKey === copyKey);
  const experimentOf = (copyKey: string) => EXPS.find((exp) => exp.copyKey === copyKey && ["scheduled", "running", "concluded", "stopped"].includes(exp.state));
  const experimentSummary = (copyKey: string): PositionCopy["experiment"] => {
    const exp = experimentOf(copyKey);
    if (!exp) return undefined;
    const st = experimentState(exp.state);
    const lead = leaderOf(exp);
    return { id: exp.id, tone: st.tone, text: exp.state === "running" ? (lead ? `实验进行中 · ${lead} 组领先` : "实验进行中") : `实验${st.text}` };
  };
  const toCard = (copy: CopyRow): PositionCopy => ({
    key: copy.key,
    name: copy.desc,
    status: liveCopyStatus(copy),
    version: copy.version,
    versionName: optionName(copy.version),
    texts: textsOf(findVersion(copy.key, copy.version)),
    versionCount: versionsOf(copy.key).length,
    draftVersion: copy.draftVersion,
    lastChange: copy.lastChange,
    experiment: experimentSummary(copy.key),
  });
  const positionKeys = new Set(COPY_POSITION_ROWS.map((position) => position.positionKey));
  const visiblePositions = COPY_POSITION_ROWS.filter((position) => surf === "all" || normalizeCopyModule(position.surface) === surf);
  const orphanCopies = COPY_POOL.filter((copy) => !copy.copyPosition || !positionKeys.has(copy.copyPosition)).filter((copy) => surf === "all" || copy.surface === surf);
  const surfCount = (value: Surf) => value === "all" ? COPY_POSITION_ROWS.length : COPY_POSITION_ROWS.filter((position) => normalizeCopyModule(position.surface) === value).length;
  const crowded = COPY_POSITION_ROWS.filter((position) => COPY_POOL.filter((copy) => isPublished(copy) && copy.copyPosition === position.positionKey).length > 1);
  const paused = COPY_POOL.filter((copy) => { const value = copy.status.toLowerCase(); return value === "draft-saved" || value === "draft"; });
  const awaiting = EXPS.filter((exp) => exp.state === "concluded" || exp.state === "stopped");
  const scheduled = EXPS.filter((exp) => exp.state === "scheduled");
  const publishedCount = COPY_POOL.filter(isPublished).length;
  const activePositions = COPY_POSITION_ROWS.filter((position) => position.status.toUpperCase() === "ACTIVE").length;
  const createBlocked = newMutationReason ?? (ACTIVE_VERSION_OPTIONS.length === 0 ? "先在「版本目录」新增或启用一个版本" : undefined);

  const conclusion = errorText
    ? <Conclusion state="unknown" icon={ShieldAlert}>文案暂时不能改，先重新加载</Conclusion>
    : crowded.length > 0
      ? <Conclusion state="danger" icon={TriangleAlert} hint="下架多出来的一条。">{crowded[0].name}有 <b>{COPY_POOL.filter((copy) => isPublished(copy) && copy.copyPosition === crowded[0].positionKey).length}</b> 条在投放，App 取不到这个位置的内容</Conclusion>
      : paused.length > 0
        ? <Conclusion state="warn" icon={TriangleAlert} hint="发布草稿后恢复投放。" explain={<><p>存草稿会把文案改成草稿状态，按位置取文案时取不到它。后端已按缺陷登记。</p><p>删掉草稿只在现在的版本还是已发布时恢复；下架后存的草稿，删掉也不会恢复。</p></>}><b>{paused.length}</b> 条文案存了草稿，暂停投放</Conclusion>
        : awaiting.length + scheduled.length > 0
          ? <Conclusion state="neutral" icon={ListChecks} hint={[awaiting.length ? `${awaiting.length} 个已结束，去采纳或弃用` : "", scheduled.length ? `${scheduled.length} 个待启动` : ""].filter(Boolean).join("，")}>有 {awaiting.length + scheduled.length} 个实验等你处理</Conclusion>
          : COPY_POOL.length === 0
            ? <Conclusion state="neutral" icon={ListChecks} hint={canCreateCopy ? "在一个位置上点「在这里新增文案」。" : undefined}>还没有文案，{COPY_POSITION_ROWS.length} 个位置都空着</Conclusion>
            : <Conclusion state="ok" icon={CheckCircle2}>{publishedCount} 条文案已发布，{I1_STATS.runningExps} 个实验进行中</Conclusion>;

  const positionsPane = (
    <div {...tabIds.panel("positions")} className="rd-tab-pane i1-pane">
      <FilterBar scope={<Segments label="投放模块" value={surf} onChange={setSurf} items={SURF_FLT.map(([value, label]) => ({ value, label, count: surfCount(value) }))} />}
        sort={canWrite ? <Button size="sm" icon={<Plus size={14} aria-hidden />} disabledReason={newMutationReason} onClick={createCopyPosition}>新增位置</Button> : undefined} />
      {visiblePositions.length === 0 && orphanCopies.length === 0 && (
        <BlockState state="empty" title={COPY_POSITION_ROWS.length === 0 ? "还没有文案位置" : "这个模块没有文案位置"} detail={COPY_POSITION_ROWS.length === 0 && canWrite ? "先点「新增位置」。" : undefined} />
      )}
      <div className="i1-cards" data-proof="copy-position-list">
        {visiblePositions.map((position) => {
          const surface = normalizeCopyModule(position.surface);
          const copies = COPY_POOL.filter((copy) => copy.copyPosition === position.positionKey);
          const live = copies.filter(isPublished);
          const inactive = position.status.toUpperCase() !== "ACTIVE";
          const menu: MoreMenuItem[] = [
            ...(canCreateCopy && !inactive ? [{ key: "create", label: "在这里新增文案", disabledReason: createBlocked, onSelect: () => createCopy({ surface, copyPosition: position.positionKey }) }] : []),
            ...(canWrite ? [{ key: "delete", label: "删除位置", danger: true, disabledReason: lockReason(`position:${position.positionKey}`), onSelect: () => deleteCopyPosition(position.positionKey) }] : []),
          ];
          return (
            <PositionCard key={position.positionKey}
              title={position.name}
              sub={<>{moduleLabel(surface)} · <span data-mono="">{position.positionKey}</span></>}
              statusTag={inactive ? <StatusTag tone="done">已停用</StatusTag> : undefined}
              surface={surface}
              copies={copies.map(toCard)}
              problem={live.length > 1 ? <Notice tone="danger" title={`有 ${live.length} 条在投放`}>App 按位置取文案时取不到内容，下架多出来的一条。</Notice> : undefined}
              empty={<>
                <span className="i1-weak">{inactive ? "位置已停用，不能放文案" : "还没有文案"}</span>
                {canCreateCopy && !inactive && <Button size="sm" disabledReason={createBlocked} onClick={() => createCopy({ surface, copyPosition: position.positionKey })}>在这里新增文案</Button>}
              </>}
              menu={menu}
              openLabel={canWrite ? "查看和编辑" : "查看"}
              onOpenCopy={setCopyDetail}
              onOpenExperiment={openExperiment} />
          );
        })}
        {orphanCopies.length > 0 && (
          <PositionCard title="没放到现有位置的文案" sub={`${orphanCopies.length} 条 · 位置已删除或没填`}
            copies={orphanCopies.map(toCard)} openLabel={canWrite ? "查看和编辑" : "查看"} onOpenCopy={setCopyDetail} onOpenExperiment={openExperiment} />
        )}
      </div>
    </div>
  );

  const expCount = (value: ExpFlt) => value === "all" ? EXPS.length : value === "running" ? EXPS.filter((exp) => exp.state === "running").length : EXPS.filter((exp) => ["concluded", "adopted", "discarded", "stopped"].includes(exp.state)).length;
  const experimentsPane = (
    <div {...tabIds.panel("experiments")} className="rd-tab-pane i1-pane">
      <FilterBar scope={<Segments label="实验状态" value={expFlt} onChange={setExpFlt} items={EXP_FLT.map(([value, label]) => ({ value, label, count: expCount(value) }))} />}
        sort={<>
          <span className="rd-filter-result">最高转化率 {String(I1_STATS.topLift).replace(/^\+/, "")}<Explain label="最高转化率怎么算" content="所有实验里单独一组的最高转化率，不是相对原版的提升。" /></span>
          {canManageExperiments && <Button size="sm" variant="primary" icon={<Plus size={14} aria-hidden />} disabledReason={newMutationReason ?? (EXPERIMENT_COPY_OPTIONS.length === 0 ? experimentUnavailableReason : undefined)} onClick={createExperiment}>创建实验</Button>}
        </>} />
      {filteredExps.length === 0 && <BlockState state="empty" title={EXPS.length === 0 ? "还没有实验" : "这个状态下没有实验"} />}
      <div className="i1-cards">
        {filteredExps.map((e) => {
          const st = liveExpState(e);
          const isRunning = st === "running";
          const canDiscard = st === "scheduled" || st === "concluded";
          const copy = findCopy(e.copyKey);
          const locked = lockReason(`exp:${e.id}`);
          const buttons = canManageExperiments && st === "scheduled" ? (
            <>
              <Button size="sm" variant="danger-outline" disabledReason={locked} onClick={() => discardExp(e.id)}>弃用</Button>
              <Button size="sm" variant="primary" disabledReason={locked} onClick={() => startExp(e.id)}>启动</Button>
            </>
          ) : canManageExperiments && isRunning ? (
            <Button size="sm" disabledReason={locked} onClick={() => stopExp(e.id)}>停止实验</Button>
          ) : canManageExperiments && (st === "concluded" || st === "stopped") ? (
            <>
              {canDiscard && <Button size="sm" variant="danger-outline" disabledReason={locked} onClick={() => discardExp(e.id)}>弃用</Button>}
              <Button size="sm" variant="primary" disabledReason={locked} onClick={() => adoptExp(e.id)}>采纳结果</Button>
            </>
          ) : null;
          return (
            <ExperimentCard key={e.id} id={e.id} selected={focusExp === e.id}
              title={copy?.desc ?? e.copyKey}
              sub={<>{positionName(copy?.copyPosition)} · <span data-mono="">{e.id}</span></>}
              state={st}
              variants={e.variants.map((variant) => ({ ...variant, versionName: optionName(variant.version), text: findVersion(e.copyKey, variant.version)?.zh }))}
              impressions={countOf(e.impressions)}
              conversions={countOf(e.conversions)}
              leader={leaderOf(e)}
              sample={sampleOf(e)}
              audience={<>{e.audience || "—"}<span className="i1-weak">{e.estimatedAudience == null ? "" : ` · 按现在的条件约 ${e.estimatedAudience.toLocaleString()} 人`}</span></>}
              note={e.note}
              actions={buttons} />
          );
        })}
      </div>
      <Fold title="实验全局设置" icon={Settings2} tone="role-other" summary={EXP_FRAMEWORK.length ? `${EXP_FRAMEWORK.length} 项 · 目前不影响实验运行` : "没有设置项"}
        explain="这些值只保存，创建、启动和运行实验都不读它们；采纳要求每组至少 100 人是固定规则，不在这里。后端已登记待处理。">
        {EXP_FRAMEWORK.length === 0
          ? <BlockState state="empty" title="没有读到全局设置" />
          : <ConfigList label="实验全局设置">
              {EXP_FRAMEWORK.map((p) => {
                const cur = liveFw(p.key, p.cur);
                return <ConfigRow key={p.key} name={p.name} what={p.sub || "—"} when="保存后只记下新值" effect="目前不影响实验运行。" value={cur}
                  action={canManageExperiments ? <Button size="sm" disabledReason={lockReason(`framework:${p.key}`)} onClick={() => adjustFramework(p.key, p.name, cur)}>调整</Button> : undefined} />;
              })}
            </ConfigList>}
      </Fold>
    </div>
  );

  const historyAction = (row: VersionRow): MoreMenuItem[] => {
    const copy = COPY_POOL.find((item) => item.key === row.copyKey);
    if (!canWrite || !copy) return [];
    const status = row.st.toLowerCase();
    const existingDraft = copy.draftVersion
      ? COPY_VERSIONS.find((item) => item.copyKey === copy.key && item.v === copy.draftVersion && item.st.toLowerCase() === "draft")
      : undefined;
    const usedVersionKeys = usedVersionsForCopy(copy);
    const hasUnusedActiveVersion = ACTIVE_VERSION_OPTIONS.some((option) => !usedVersionKeys.has(option.value));
    const locked = lockReason(`copy:${copy.key}`);
    const items: MoreMenuItem[] = [];
    if (status === "archived") items.push({ key: "rollback", label: `回滚到 ${row.v}`, disabledReason: locked, onSelect: () => rollbackTo(copy, row.v) });
    if (status === "published") {
      items.push(existingDraft
        ? { key: "draft", label: `继续草稿 ${existingDraft.v}`, disabledReason: locked, onSelect: () => editCopy(copy, existingDraft) }
        : { key: "new", label: "新增版本", disabledReason: locked ?? (!hasUnusedActiveVersion ? "先在「版本目录」新增或启用一个这条文案没用过的版本" : undefined), onSelect: () => editCopy(copy, row, true) });
      if (copy.version === row.v) items.push({ key: "archive", label: "下架", danger: true, disabledReason: locked, onSelect: () => archiveCurrentVersion(copy, row.v) });
    }
    if (status === "draft" && copy.draftVersion === row.v) {
      items.push({ key: "edit", label: "编辑或发布", disabledReason: locked, onSelect: () => editCopy(copy, row) });
      if (copy.revision != null) items.push({ key: "delete", label: deletingDraftKey === `${row.copyKey}:${row.v}` ? "删除中…" : "删除草稿", danger: true, disabledReason: locked ?? (deletingDraftKey !== null ? "有草稿正在删除" : undefined), onSelect: () => deleteDraftVersion(row.copyKey, row.v, copy.revision!) });
    }
    return items;
  };

  const historyPane = (
    <div {...tabIds.panel("history")} className="rd-tab-pane i1-pane">
      <FilterBar scope={<Segments label="版本状态" value={versionStatusFlt} onChange={(next) => { setVersionStatusFlt(next); setVersionPage(1); }} items={VERSION_STATUS_FLT.map(([value, label]) => ({ value, label }))} />}
        onClear={() => { setVersionCopyFlt("all"); setVersionStatusFlt("all"); setVersionPage(1); }} canClear={versionCopyFlt !== "all" || versionStatusFlt !== "all"}>
        <FilterField grow>
          <Select aria-label="按文案筛选" value={versionCopyFlt} onChange={(next) => { setVersionCopyFlt(next); setVersionPage(1); }}
            options={[{ value: "all", label: "全部文案" }, ...COPY_POOL.map((copy) => ({ value: copy.key, label: `${copy.desc} · ${copy.key}` }))]} />
        </FilterField>
      </FilterBar>
      <Panel title="内容历史" icon={History} tone="role-3" flush sub={`${filteredVersions.length} 条 · ${ZONE}`} explain="每条文案各个版本的内容、状态和最近一次操作。时间只有月日时分，没有年份。" data-proof="copy-version-list">
        <Table label="内容历史" className="i1-history">
          <thead><tr><Th>文案</Th><Th>版本</Th><Th>中文内容</Th><Th>位置</Th><Th>最近操作</Th><Th align="right">操作</Th></tr></thead>
          <tbody>
            {pagedVersions.map((row) => {
              const copy = COPY_POOL.find((item) => item.key === row.copyKey);
              const st = versionStatus(row.st);
              const lack = missingLangs(textsOf(row)!).filter((label) => label !== "中文");
              const items = historyAction(row);
              const id = `${row.copyKey}:${row.v}`;
              return (
                <Tr key={id} selected={versionDetail === id} onOpen={() => setVersionDetail(id)}>
                  <Td><Cell main={copy?.desc || row.copyKey} sub={<span data-mono="">{row.copyKey}</span>} title={`${copy?.desc || row.copyKey} · ${row.copyKey}`} /></Td>
                  <Td><Cell main={<span data-mono="">{row.v}</span>} sub={<StatusTag tone={st.tone}>{st.text}</StatusTag>} /></Td>
                  <Td grow><Cell main={row.zh ? nexGridBrandText(row.zh) : <StatusTag tone="warn">中文缺失</StatusTag>} title={row.zh ? nexGridBrandText(row.zh) : undefined}
                    sub={lack.length ? <span className="i1-warn-text">缺{lack.join("、")}</span> : undefined} /></Td>
                  <Td><Cell main={positionName(row.copyPosition)} sub={moduleLabel(row.surface)} /></Td>
                  <Td><Cell main={row.chain || "—"} sub={row.ts || "—"} title={row.chain || undefined} /></Td>
                  <Td align="right" data-fit="">{items.length > 0 ? <MoreMenu label={`${row.copyKey} ${row.v} 的操作`} items={items} /> : <span className="i1-weak">—</span>}</Td>
                </Tr>
              );
            })}
            {filteredVersions.length === 0 && <TableMessage columns={6}>{COPY_VERSIONS.length === 0 ? "还没有版本记录" : "这个筛选下没有版本记录"}</TableMessage>}
          </tbody>
        </Table>
        {filteredVersions.length > 0 && <Pager label="内容历史" total={filteredVersions.length} page={safeVersionPage} pageSize={VERSION_PAGE_SIZE} sizes={[VERSION_PAGE_SIZE]}
          onPage={(page) => setVersionPage(Math.min(versionPages, Math.max(1, page)))} onPageSize={() => undefined} />}
      </Panel>
    </div>
  );

  const catalogPane = (
    <div {...tabIds.panel("catalog")} className="rd-tab-pane i1-pane">
      <Panel title="版本目录" icon={Layers} tone="role-4" flush sub={`${VERSION_OPTIONS.length} 个 · 启用 ${ACTIVE_VERSION_OPTIONS.length} 个`}
        explain="新增文案和新增版本时从启用的版本里选；一条文案每个版本只能用一次。用过的版本不能删除，可以停用。"
        actions={canWrite ? <Button size="sm" icon={<Plus size={14} aria-hidden />} disabledReason={newMutationReason} onClick={createCopyVersionOption}>新增版本</Button> : undefined} data-proof="copy-version-catalog">
        <Table label="版本目录" className="i1-catalog">
          <thead><tr><Th>版本</Th><Th>说明</Th><Th>状态</Th><Th align="right">排序</Th><Th align="right">被用过</Th>{canWrite && <Th align="right">操作</Th>}</tr></thead>
          <tbody>
            {VERSION_OPTIONS.map((option) => {
              const referenced = option.usageCount > 0;
              const active = option.status.toUpperCase() === "ACTIVE";
              return (
                <tr key={option.versionKey}>
                  <Td><Cell main={<b data-mono="">{option.versionKey}</b>} sub={option.name} title={`${option.versionKey} · ${option.name}`} /></Td>
                  <Td grow><Cell main={option.description || <span className="i1-weak">—</span>} title={option.description || undefined} /></Td>
                  <Td><StatusTag tone={active ? "ok" : "done"}>{active ? "已启用" : "已停用"}</StatusTag></Td>
                  <Td align="right">{option.sortOrder}</Td>
                  <Td align="right">{option.usageCount} 次</Td>
                  {canWrite && <Td align="right" data-fit="">
                    <span className="i1-row-actions">
                      <Button size="sm" variant="ghost" disabledReason={lockReason(`version:${option.versionKey}`)} onClick={() => editCopyVersionOption(option)}>编辑</Button>
                      <Button size="sm" variant="ghost" disabledReason={lockReason(`version:${option.versionKey}`) ?? (referenced ? "已有内容用过这个版本，不能删除；可以停用" : undefined)} onClick={() => deleteCopyVersionOption(option)}>删除</Button>
                    </span>
                  </Td>}
                </tr>
              );
            })}
            {VERSION_OPTIONS.length === 0 && <TableMessage columns={canWrite ? 6 : 5}>还没有版本，先新增一个再建文案</TableMessage>}
          </tbody>
        </Table>
      </Panel>
    </div>
  );

  // ---- 文案详情抽屉 ----
  const detailCopy = copyDetail ? findCopy(copyDetail) : undefined;
  const detailCurrent = detailCopy ? findVersion(detailCopy.key, detailCopy.version) : undefined;
  const detailDraft = detailCopy?.draftVersion ? findVersion(detailCopy.key, detailCopy.draftVersion) : undefined;
  const detailExp = detailCopy ? experimentOf(detailCopy.key) : undefined;
  const copyDrawer = detailCopy && (() => {
    const st = copyStatus(detailCopy.status);
    const locked = lockReason(`copy:${detailCopy.key}`);
    const rows: JudgmentRow[] = [
      { label: "状态", value: <StatusTag tone={st.tone} explain={st.explain}>{st.text}</StatusTag> },
      { label: "位置", value: `${positionName(detailCopy.copyPosition)} · ${moduleLabel(detailCopy.surface)}` },
      { label: "发布中的版本", value: `${detailCopy.version}${optionName(detailCopy.version) ? ` · ${optionName(detailCopy.version)}` : ""}` },
      { label: "草稿", value: detailCopy.draftVersion ?? "没有" },
      { label: "实验", value: detailExp ? <button type="button" className="rd-link i1-exp-link" onClick={() => openExperiment(detailExp.id)}>{experimentState(detailExp.state).text} · {detailExp.id}</button> : "没有" },
    ];
    const others = othersPublishedAt(detailCopy.copyPosition, detailCopy.key);
    const vers = versionsOf(detailCopy.key);
    return (
      <Drawer open onClose={() => setCopyDetail(null)} title="文案详情" sub={<>{detailCopy.desc} · <span data-mono="">{detailCopy.key}</span></>} icon={FileText} tone="role-2"
        footer={canWrite ? <Decision
          danger={isPublished(detailCopy) ? <Button variant="danger-outline" disabledReason={locked} onClick={() => archiveCurrentVersion(detailCopy, detailCopy.version)}>下架</Button> : undefined}
          others={detailCopy.draftVersion && detailCopy.revision != null && detailDraft
            ? <Button disabledReason={locked ?? (deletingDraftKey !== null ? "有草稿正在删除" : undefined)} onClick={() => deleteDraftVersion(detailCopy.key, detailCopy.draftVersion!, detailCopy.revision!)}>删除草稿</Button>
            : undefined}
          primary={<Button variant="primary" disabledReason={locked} onClick={() => editCopy(detailCopy)}>{detailCopy.draftVersion ? "编辑草稿" : "编辑文案"}</Button>} /> : undefined}>
        <JudgmentPoints rows={rows} />
        {isPublished(detailCopy) && others.length > 0 && <Notice tone="danger" title="这个位置不止一条在投放">「{others.map((copy) => copy.desc).join("、")}」也在这里发布，App 按位置取文案时取不到内容。</Notice>}
        <Panel plain headingLevel={3} title={`发布中的内容 ${detailCopy.version}`}>
          {detailCurrent ? <LangBlocks texts={textsOf(detailCurrent)!} /> : <p className="i1-weak">读不到这个版本的内容</p>}
        </Panel>
        {detailCopy.draftVersion && (
          <Fold inset title={`草稿 ${detailCopy.draftVersion}`} summary="还没发布" defaultOpen>
            <LangBlocks texts={{ zh: detailCopy.draftZh ?? detailDraft?.zh ?? "", vi: detailCopy.draftVi ?? detailDraft?.vi ?? "", en: detailCopy.draftEn ?? detailDraft?.en ?? "" }} />
          </Fold>
        )}
        <Fold inset title="全部版本" summary={`${vers.length} 个`}>
          <ul className="i1-vlist">
            {vers.map((row) => {
              const vst = versionStatus(row.st);
              const items = historyAction(row);
              return (
                <li key={row.v}>
                  <span className="i1-vlist-main"><b data-mono="">{row.v}</b><StatusTag tone={vst.tone}>{vst.text}</StatusTag></span>
                  <span className="i1-weak">{row.chain || "—"} · {row.ts || "—"}</span>
                  {items.length > 0 && <MoreMenu label={`${row.v} 的操作`} items={items} />}
                </li>
              );
            })}
          </ul>
        </Fold>
        <Fold inset title="受众和分流" summary="只对实验起作用" explain="创建实验时沿用这里的受众；普通发布不按受众和分流筛选用户。">
          <Facts>
            <Fact k="受众">{detailCurrent?.audience || "—"}</Fact>
            <Fact k="分流比例">{detailCurrent?.trafficSplit ? `${detailCurrent.trafficSplit}%` : "—"}</Fact>
            <Fact k="估算人数">{detailCurrent?.estimatedAudience == null ? "—" : `约 ${detailCurrent.estimatedAudience.toLocaleString()} 人（按现在的条件）`}</Fact>
            <Fact k="词条"><span data-mono="">{detailCopy.i18nKey}</span></Fact>
          </Facts>
        </Fold>
      </Drawer>
    );
  })();

  // ---- 版本详情抽屉 ----
  const detailRow = versionDetail ? pagedVersions.find((row) => `${row.copyKey}:${row.v}` === versionDetail) ?? COPY_VERSIONS.find((row) => `${row.copyKey}:${row.v}` === versionDetail) : undefined;
  const rowIndex = detailRow ? pagedVersions.indexOf(detailRow) : -1;
  const versionDrawer = detailRow && (() => {
    const copy = findCopy(detailRow.copyKey);
    const st = versionStatus(detailRow.st);
    const items = historyAction(detailRow);
    const primary = items.find((item) => !item.danger);
    const dangers = items.filter((item) => item.danger);
    const go = (offset: number) => { const next = pagedVersions[rowIndex + offset]; if (next) setVersionDetail(`${next.copyKey}:${next.v}`); };
    return (
      <Drawer open onClose={() => setVersionDetail(null)} title="内容版本" sub={<><span data-mono="">{detailRow.copyKey}</span> · {detailRow.v}</>} icon={History} tone="role-3"
        nav={{ onPrev: () => go(-1), onNext: () => go(1), hasPrev: rowIndex > 0, hasNext: rowIndex >= 0 && rowIndex < pagedVersions.length - 1 }}
        footer={items.length > 0 ? <Decision
          danger={dangers.length > 0 ? <>{dangers.map((item) => <Button key={item.key} variant="danger-outline" disabledReason={item.disabledReason} onClick={item.onSelect}>{item.label}</Button>)}</> : undefined}
          primary={primary ? <Button variant="primary" disabledReason={primary.disabledReason} onClick={primary.onSelect}>{primary.label}</Button> : undefined} /> : undefined}>
        <JudgmentPoints rows={[
          { label: "状态", value: <StatusTag tone={st.tone}>{st.text}</StatusTag> },
          { label: "文案", value: copy?.desc ?? detailRow.copyKey },
          { label: "位置", value: `${positionName(detailRow.copyPosition)} · ${moduleLabel(detailRow.surface)}` },
          { label: "最近操作", value: `${detailRow.chain || "—"} · ${detailRow.ts || "—"}（${ZONE}）` },
        ]} />
        <Panel plain headingLevel={3} title="三种语言">
          <LangBlocks texts={textsOf(detailRow)!} />
        </Panel>
        <Fold inset title="版本说明、受众和分流" summary={detailRow.versionNote || "没写版本说明"}>
          <Facts>
            <Fact k="版本说明">{detailRow.versionNote || "—"}</Fact>
            <Fact k="受众">{detailRow.audience || "—"}</Fact>
            <Fact k="分流比例">{detailRow.trafficSplit ? `${detailRow.trafficSplit}%` : "—"}</Fact>
            <Fact k="估算人数">{detailRow.estimatedAudience == null ? "—" : `约 ${detailRow.estimatedAudience.toLocaleString()} 人（按现在的条件）`}</Fact>
          </Facts>
        </Fold>
      </Drawer>
    );
  })();

  const expNeed = EXPS.filter((exp) => ["scheduled", "running", "concluded", "stopped"].includes(exp.state)).length;

  return (
    <>
      {header}
      {errorText && <Notice tone="warn" title="数据没有读到最新" action={<Button size="sm" loading={reloading} onClick={() => void reload()}>重新加载</Button>}>{errorText} 下面是上次读到的内容。</Notice>}
      <Notice tone="neutral" title="App 还没接上位置文案">
        App 目前只显示普通文案键能覆盖的内容，位置文案还没有接上。
        <Explain label="现在 App 能看到什么" content={<><p>发布、回滚、采纳会同步「多语言与课程」里的同名词条，App 用到这个词条的地方会跟着变。</p><p>App 还没接上按位置取文案和实验分组，所以实验分组现在不会真正发生在 App 上。</p></>} />
      </Notice>
      {pendingNotice}
      {conflictUi}
      {conclusion}
      <StatBand label="文案对比测试关键数字">
        <Stat icon={MapPin} tone="role-2" label="文案位置" value={String(COPY_POSITION_ROWS.length)} unit="个" sub={`启用 ${activePositions}`} />
        <Stat icon={BookOpen} tone="role-2" label="文案" value={String(I1_STATS.managedCopies)} unit="条" sub={`已发布 ${publishedCount}`} explain="所有没删除的文案，不是位置数。" />
        <Stat icon={FlaskConical} tone="role-3" label="进行中实验" value={String(I1_STATS.runningExps)} unit="个" sub={scheduled.length ? `待启动 ${scheduled.length}` : undefined} />
        <Stat icon={Eye} tone="role-3" label="累计看到" value={String(I1_STATS.weeklyExposures)} unit="人" explain="所有实验累计看到的人数之和，不限本周；这是约数。" />
      </StatBand>
      <PageTabs ids={tabIds} label="页面文案对比测试内容" value={tab} onChange={setTab} items={[
        { value: "positions", label: "文案位置" },
        { value: "experiments", label: "对比实验", count: expNeed },
        { value: "history", label: "内容历史" },
        { value: "catalog", label: "版本目录" },
      ]} />
      {tab === "positions" && positionsPane}
      {tab === "experiments" && experimentsPane}
      {tab === "history" && historyPane}
      {tab === "catalog" && catalogPane}
      {copyDrawer}
      {versionDrawer}
      {editor?.kind === "edit" && (
        <CopyEditorDrawer spec={editor.spec}
          title={editor.spec.version ? "编辑草稿" : editor.forceNew ? "新增版本" : "编辑文案"}
          sub={<>{editor.copy.desc} · <span data-mono="">{editor.copy.key}</span></>}
          basedOn={<Fact k="基于">{editor.base ? `${editor.base.v} · ${versionStatus(editor.base.st).text}` : editor.copy.version}</Fact>}
          pausesDelivery={isPublished(editor.copy)}
          onClose={() => setEditor(null)}
          onSubmit={(form, mode) => submitCopyEdit(editor.copy, editor.base, { ...form, saveMode: mode }, mode)} />
      )}
      {editor?.kind === "create" && (
        <CopyEditorDrawer spec={editor.spec} title="新增文案" onClose={() => setEditor(null)} onSubmit={(form) => submitCreateCopy(form)} />
      )}
      {creatingExperiment && (
        <ExperimentDrawer copies={EXPERIMENT_COPY_OPTIONS} versionText={(copyKey, version) => findVersion(copyKey, version)?.zh}
          onClose={() => setCreatingExperiment(false)} onSubmit={submitExperiment} />
      )}
      <PaginationExemptionList
        items={[
          { label: "文案位置", kind: "reference-catalog", maxRows: COPY_POSITION_ROWS.length, reason: "按模块筛选后查看和编辑" },
          { label: "内容历史", maxRows: VERSION_PAGE_SIZE, reason: "每页 20 条，可按文案和状态筛选" },
          { label: "对比实验", maxRows: EXPS.length, reason: "这里只显示实验摘要" },
        ]}
      />
    </>
  );
}


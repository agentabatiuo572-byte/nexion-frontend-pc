"use client";

/**
 * H9「首页与网络展示设置」—— 规格 FEAT-HOME02b 后台单元。
 *
 * 运营在这里维护 App 首页和网络页给用户看的展示数字：首屏六张卡是六块现在的展示值，也是页签；
 * 每块先画 App 上的样子和按现在参数接下来怎么涨，旁边是参数。设备预估排名是独立的一套设置。
 * 整组原子保存：确认框给前后值和对 App 的影响 → 必填理由 → 服务端落审计 + 防重复提交编号，任一项非法整组不落库。
 *
 * 页面里没有任何平台数字的字面量：当前值、默认值、历史日产锚都从服务端读模型来。
 * 「改了设备总数会连带改掉哪些金额」由历史估算的影响预览现算，不靠运营心算，也不在后台另存一份日产档。
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import { RefreshCw, SlidersHorizontal, Smartphone, TableProperties } from "lucide-react";
import { BlockState, Button, Change, Conclusion, DiffList, Explain, Fact, KeepText, Facts, Field, Notice, NumberInput, PageHeader, Panel, RatioBar, StatusTag, Table, Td, Th, Tr, TrendLines, useTabIds, type DiffRow } from "@/app/components/rd";
import { PaginationExemption } from "../design-kit";
import { displayAdminError, formatAdminApiError } from "@/lib/admin/error-messages";
import {
  H9_FIELDS,
  fetchH9AppDisplay,
  fetchH9PublicStats,
  prepareH9PublicStats,
  updateH9PublicStats,
  type H9EditableValues,
  type H9FieldDef,
  type H9PercentileBand,
  type H9PublicStatsOverview,
  type H9PublicStatsValues,
} from "@/lib/admin/h9-client";
// 🔴 分位表值域规则唯一来源(与前端 network-rank.ts 行为等价,契约测试钉着)——
//    面板不许手写第二份判据;parity 门查的是「用途位」出现,不是 import 位。
import {
  h9MoneyPrecisionValid,
  H9_BAND_MIN,
  H9_BAND_TOPS_MIN,
  h9BandRowErrors,
  h9DraftNumber as num,
  h9DraftText,
  h9BandMeaning,
  h9PlaceholderCopy,
  type H9BandDraft as BandDraft,
} from "@/lib/admin/h9-validation";
import type { HCtx } from "./types";
import { H9DeviceRank } from "./h9-device-rank";
import { H9GlobeDisplay } from "./h9-globe-display";
import { H9ModuleCards, moduleLabel, type H9Module, type RankSnapshot } from "./h9-overview";
import { AppNumber, AppPreview, AuditFoot, type AppDisplayRead, axisShort, ConfirmFacts, PAID_UNIT, PAID_UNIT_NOTE, paid, DAY_LABELS, DAY_TICKS, H9RecoveryNotice, h9Status, HOUR_LABELS, HOUR_TICKS, ModuleToolbar, averageGain, count, memberSpread, membersAt, saveIssueKind, usd, usdApprox, usdProduct, type MemberModel, type SaveIssueKind } from "./h9-parts";
import { reconcileH9Editor, type H9EditorState } from "@/lib/admin/h9-module-drafts";
import { canRetryH9Command, pendingH9Command, queryH9Command, type H9Command } from "@/lib/admin/h9-command";
import { isRetryExpired, RETRY_EXPIRED_TEXT } from "@/lib/admin/pending-mutation-store";
import { canInvestigateECommand, eCommandClosureOffer, eCommandSettled } from "@/lib/admin/e-command-investigation";
import type { FundInvestigationOutcome } from "@/lib/admin/fund-command-investigation";
import { FundClosureModal, settledText } from "../fund-command-check";
import { TechInfo, receiptFact, receiptOf } from "../recovery-panel";
import { DIRECT_RECOVERY_INTRO, CLOSURE_KEPT_TEXT } from "../direct-recovery-copy";
import { useSearchParams } from "next/navigation";
import { businessStamp, businessZone, formatBusinessTimeCompact } from "@/lib/admin/business-time";

type ScalarKey = H9FieldDef["key"];
type ScalarDrafts = Record<ScalarKey, string>;

const HOME_KEYS: ScalarKey[] = ["homeOnlineCurrent", "homeOnlineStepMin", "homeOnlineStepMax", "homePaidCurrent", "homePaidStepMin", "homePaidStepMax"];
const NETWORK_KEYS: ScalarKey[] = ["registeredUsersBase", "registeredUsersTickIntervalSec", "registeredUsersTickStepMin", "registeredUsersTickStepMax", "registeredUsersMonthlyGrowthPct"];
const HISTORY_KEYS: ScalarKey[] = ["fleetDevices", "onlineRatePct", "onlineJitter", "virtualUserCount"];
const MODULE_KEYS: Record<H9Module, ScalarKey[]> = {
  home: HOME_KEYS, network: NETWORK_KEYS, jobs: ["activeJobsBase"], globe: [], rank: [], history: HISTORY_KEYS,
};
const MONEY_KEYS = new Set<ScalarKey>(["homePaidCurrent", "homePaidStepMin", "homePaidStepMax"]);
/** 有「恢复默认」的三块（A07）；首页、全球网络、排名后端也给默认值，但没有恢复入口。 */
const DEFAULTABLE: readonly H9Module[] = ["network", "jobs", "history"];

/** 页面上的字段名和这是什么。说法按后端现行行为写（BF13、BF16、BF30），不用 h9-client 里过时的 hint。 */
const FIELD_COPY: Record<ScalarKey, { name: string; what: string }> = {
  homeOnlineCurrent: { name: "当前值", what: "App 上在线设备从这个数开始。只有改了它，保存后才从这个数重新开始；没改就接着 App 上已经涨到的数。" },
  homeOnlineStepMin: { name: "每秒最少增加", what: "开启增长时，每秒在最少和最多之间随机加一个整数，所有用户看到同一个数。" },
  homeOnlineStepMax: { name: "每秒最多增加", what: "开启增长时，每秒在最少和最多之间随机加一个整数，所有用户看到同一个数。" },
  homePaidCurrent: { name: "当前值", what: "App 上累计已发放从这个金额开始。只有改了它，保存后才从这个金额重新开始。这是展示数字，不是真实已完成提现。" },
  homePaidStepMin: { name: "每秒最少增加", what: "开启增长时，每秒在最少和最多之间随机加一个金额（按整数分）。" },
  homePaidStepMax: { name: "每秒最多增加", what: "开启增长时，每秒在最少和最多之间随机加一个金额（按整数分）。" },
  registeredUsersBase: { name: "注册人数基数", what: "网络脉搏注册人数从这个数开始推算。改了它，推算起点重置为保存时刻。" },
  registeredUsersTickIntervalSec: { name: "跳动间隔", what: "每隔多少秒加一次人数。三项一起填；改了它，推算起点重置为保存时刻。" },
  registeredUsersTickStepMin: { name: "每次最少增加", what: "每跳一次至少加多少人，可以填 0。" },
  registeredUsersTickStepMax: { name: "每次最多增加", what: "每跳一次最多加多少人，不能小于最少值。所有用户看到同一个数。" },
  registeredUsersMonthlyGrowthPct: { name: "月增长率", what: "没设跳动时，注册人数按每月这个比例复利增长。只改它不会重置推算起点，会按原起点重算整段。" },
  fleetDevices: { name: "历史估算设备总数", what: "历史估算的设备台数，不是实际设备数。" },
  onlineRatePct: { name: "历史在线设备占比", what: "历史在线估算 = 设备总数 × 这个比例。" },
  onlineJitter: { name: "历史在线浮动幅度", what: "保存后不参与任何计算，这页的估算也不用它。" },
  virtualUserCount: { name: "虚拟人口", what: "历史估算分母 = 注册账号总数 + 虚拟人口。不参与设备预估排名。" },
  activeJobsBase: { name: "全球作业基座", what: "只用于展示，不参与任务派发、结算或资金" },
};

const RECOVERY_EXPLAIN = <>
  <p>{DIRECT_RECOVERY_INTRO}</p>
  <p>有结论前这一块不能发起新的保存。</p>
</>;

type SaveIssue = { kind: SaveIssueKind; message: string; module: H9Module; change: string; at: number };

function bandDraftsFrom(values: H9PublicStatsValues): BandDraft[] {
  return values.hashratePercentileTable.map((band) => ({
    tops: h9DraftText(band.tops),
    cumPct: h9DraftText(band.cumPct),
  }));
}

/** 单个数值参数的合法域校验 → 返回运营看得懂的提示，合法返回空串。 */
function scalarError(field: H9FieldDef, raw: string): string {
  if ((field.pairedOptional || field.clearable) && !raw.trim()) return "";
  const value = num(raw);
  if (!Number.isFinite(value)) return "请填数字";
  if (value < field.min || value > field.max) return `要在 ${count(field.min)}–${count(field.max)} ${field.unit} 之间`;
  if (field.integer && !Number.isInteger(value)) return "只能填整数";
  if (MONEY_KEYS.has(field.key) && !h9MoneyPrecisionValid(raw)) return "金额最多两位小数";
  return "";
}

function sameBands(a: H9PercentileBand[], b: H9PercentileBand[]) {
  return a.length === b.length && a.every((row, index) => row.tops === b[index].tops && row.cumPct === b[index].cumPct);
}

/** 一个参数值写成人话：金额两位起、不舍入；空写清楚是什么。 */
function valueText(key: ScalarKey, value: number | null | undefined): string {
  if (value === undefined) return "未设置";
  if (value === null) return "不发布";
  const field = H9_FIELDS.find((item) => item.key === key)!;
  return MONEY_KEYS.has(key) ? paid(value) : `${count(value)} ${field.unit}`;
}


const APP_PAID_NOTE = "App 上数字前写 $，这里照 App 写；设定值写 USD，是同一个单位。";
const APP_DISPLAY_REASON: Record<string, string> = {
  HOME_DISPLAY_SNAPSHOT_UNAVAILABLE: "这一刻还没有可用的展示数据",
  HOME_DISPLAY_SANDBOX_UNAVAILABLE: "测试环境不生成首页展示数据",
};
/** 进行中作业数读不到的原因（GrowthPublicStatsService.appDisplay 的 unavailable，ae9783f7）。 */
const JOBS_REASON: Record<string, string> = {
  H9_ACTIVE_JOBS_BASE_UNPUBLISHED: "基座未发布，App 不显示作业数",
  HOME_DISPLAY_SNAPSHOT_UNAVAILABLE: "这一刻还没有可用的首页展示数据",
};
/** 按分算的金额写成两位小数加千分位，不舍入（paid 是 JSON 数字，末尾的 0 会丢，所以用 paidCents）。这是「App 显示」的写法，照 App 两位小数写，不按后台金额规则改；$ 由调用处照 App 加在前面。 */
function centsAmount(cents: number) {
  return `${Math.floor(cents / 100).toLocaleString("en-US")}.${String(cents % 100).padStart(2, "0")}`;
}
/** App 示意卡下的一行：读到时写取样时间，读不到写原因和上面显示的是什么。 */
function AppSample({ read, found, fallback }: { read: AppDisplayRead; found: boolean; fallback: "设定值" | "推算" }) {
  if (read.state === "loading") return <p className="h9-chart-note">正在读取 App 显示的数…</p>;
  if (read.state === "error") return <p className="h9-chart-note">App 显示的数没读到，上面是{fallback}<Explain label="失败原因" content={read.message} /></p>;
  if (found) return <p className="h9-chart-note">App 显示的数 · 取样 {formatBusinessTimeCompact(read.data.capturedAt, "—")}（{businessZone().label}）{read.data.sourceEnvironment === "SANDBOX" ? " · 测试环境" : ""}</p>;
  const reason = fallback === "设定值" ? APP_DISPLAY_REASON[read.data.reason ?? ""] ?? "原因不明" : "这个数现在算不出";
  return <p className="h9-chart-note">App 显示的数读不到：{reason}，上面是{fallback}</p>;
}

export function H9PublicStats({ ctx }: { ctx: HCtx }) {
  const canWrite = ctx.can("growth_h9_write");
  const ids = useTabIds();
  const search = useSearchParams();
  const selected = search.get("module");
  const module: H9Module = selected && ["home", "network", "jobs", "globe", "rank", "history"].includes(selected) ? selected as H9Module : "home";
  const setModule = (next: H9Module) => {
    const url = new URL(window.location.href);
    url.searchParams.set("module", next);
    window.history.replaceState(null, "", url);
  };
  const [, syncPending] = useReducer(n => n + 1, 0);
  const pending = pendingH9Command("main");
  const [outcomes, setOutcomes] = useState<Record<string, FundInvestigationOutcome>>({});
  const [closing, setClosing] = useState<H9Command | null>(null);
  const [saving, setSaving] = useState(false);
  const ready = useRef(false);
  const [rank, setRank] = useState<RankSnapshot>({ state: "loading" });
  const [data, setData] = useState<H9PublicStatsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<SaveIssue | null>(null);
  const [editor, setEditor] = useState<H9EditorState | null>(null);
  const [readAt, setReadAt] = useState(0);
  /** App 此刻实际显示的数（5f8f1053 app-display），跟着每次主配置读取重读；读不到不拿设定值冒充。 */
  const [appDisplay, setAppDisplay] = useState<AppDisplayRead>({ state: "loading" });
  useEffect(() => {
    if (!readAt) return;
    const controller = new AbortController();
    setAppDisplay({ state: "loading" });
    fetchH9AppDisplay(controller.signal).then((value) => { if (!controller.signal.aborted) setAppDisplay({ state: "ready", data: value }); })
      .catch((cause) => { if (!controller.signal.aborted) setAppDisplay({ state: "error", message: formatAdminApiError(cause instanceof Error ? cause.message : null, "H9_DATA_LOAD_FAILED") }); });
    return () => controller.abort();
  }, [readAt]);
  const appData = appDisplay.state === "ready" ? appDisplay.data : null;
  /** 正式环境是 App 首页同一来源的进行中作业数；测试环境是任务目录的种类数，不是正在跑的任务。 */
  const jobsName = appData?.sourceEnvironment === "SANDBOX" ? "任务种类数" : "进行中作业数";
  const currentVersion = useRef(data?.version);
  currentVersion.current = data?.version;
  const drafts = editor?.drafts ?? null;
  const bands = editor?.bands ?? [];
  const setDrafts = (update: (current: ScalarDrafts) => ScalarDrafts) => setEditor(current => current ? { ...current, drafts: update(current.drafts) } : current);
  const setBands = (update: BandDraft[] | ((current: BandDraft[]) => BandDraft[])) => setEditor(current => current ? { ...current, bands: typeof update === "function" ? update(current.bands) : update } : current);

  const load = useCallback(async (scope?: H9Module) => {
    ready.current = false;
    setLoading(true);
    ctx.openActionConfirm(null);
    const original = pendingH9Command("main");
    if (original) {
      try {
        const receipt = await queryH9Command("main", original);
        setOutcomes(all => ({ ...all, [original.commandKey]: { receipt } }));
        if (eCommandSettled(receipt)) ctx.toast(settledText({ status: receipt!.originalStatus }), "success");
      } catch (cause) {
        setOutcomes(all => ({ ...all, [original.commandKey]: { error: displayAdminError(cause) } }));
      }
      syncPending();
    }
    try {
      const next = await fetchH9PublicStats();
      setData(next);
      setEditor(current => reconcileH9Editor(current, next.values, H9_FIELDS.map(field => field.key), scope ? MODULE_KEYS[scope] : [], !scope || scope === "history"));
      setError(null);
      setSaveError(null);
      setReadAt(Date.now());
      return next;
    } catch (cause) {
      // 运营面只出中文:解析错 / 网络错的机器码都过一遍共享错误字典。
      setError(formatAdminApiError(cause instanceof Error ? cause.message : null, "H9_DATA_LOAD_FAILED"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { syncPending(); void load(); }, [load]);
  ready.current = !!data && !loading && !error && !saving && !pending && saveError?.kind !== "conflict";

  const fieldErrors = useMemo(() => {
    if (!drafts) return {} as Record<ScalarKey, string>;
    const errors = Object.fromEntries(H9_FIELDS.map((field) => [field.key, scalarError(field, drafts[field.key])])) as Record<ScalarKey, string>;
    if (num(drafts.homeOnlineStepMin) > num(drafts.homeOnlineStepMax)) errors.homeOnlineStepMax = "上限不能小于下限";
    if (num(drafts.homePaidStepMin) > num(drafts.homePaidStepMax)) errors.homePaidStepMax = "上限不能小于下限";
    const tickKeys = ["registeredUsersTickIntervalSec", "registeredUsersTickStepMin", "registeredUsersTickStepMax"] as const;
    const tickFilled = tickKeys.filter((key) => drafts[key].trim());
    if (tickFilled.length > 0 && tickFilled.length < tickKeys.length) {
      for (const key of tickKeys) if (!drafts[key].trim()) errors[key] = "跳动间隔、每次最少和最多增加人数要一起填写";
    }
    if (tickFilled.length === tickKeys.length && num(drafts.registeredUsersTickStepMin) > num(drafts.registeredUsersTickStepMax)) {
      errors.registeredUsersTickStepMax = "最多增加人数不能小于最少增加人数";
    }
    if (data?.values.registeredUsersTickIntervalSec !== undefined && tickFilled.length === 0) {
      errors.registeredUsersTickIntervalSec = "已设置的跳动间隔不能清空，可以改成新的值";
    }
    return errors;
  }, [data, drafts]);

  const rowErrors = useMemo(() => h9BandRowErrors(bands), [bands]);
  const bandCountError = bands.length < H9_BAND_MIN
    ? `算力分位表至少要 ${H9_BAND_MIN} 档，现在只有 ${bands.length} 档`
    : "";
  const conflict = !!data && !!editor && (MODULE_KEYS[module].some(key => h9DraftText(editor.baseline[key]) !== h9DraftText(data.values[key]))
    || module === "history" && !sameBands(editor.baseline.hashratePercentileTable, data.values.hashratePercentileTable));
  const allValid = !loading && !error && !saving && !pending && saveError?.kind !== "conflict" && !conflict && MODULE_KEYS[module].every(key => !fieldErrors[key])
    && (module !== "history" || rowErrors.every(text => !text) && !bandCountError);

  /** 后端还没返回全球作业基座时,这一项不可编辑、也不提交。 */
  const jobsBaseSupported = data?.values.activeJobsBase !== undefined;

  /** 草稿 → 可提交值(仅在 allValid 时有意义)。 */
  const nextValues: H9EditableValues | null = useMemo(() => {
    if (!data || !drafts || !allValid) return null;
    const { registeredUsersAnchorAt: _anchor, ...saved } = data.values;
    return {
      ...saved,
      ...(Object.fromEntries(H9_FIELDS
        .filter((field) => MODULE_KEYS[module].includes(field.key) && !(field.pairedOptional && !drafts[field.key].trim())
          && !(field.key === "activeJobsBase" && !jobsBaseSupported))
        .map((field) => [field.key, field.clearable && !drafts[field.key].trim() ? null : num(drafts[field.key])])) as Record<ScalarKey, number | null>),
      hashratePercentileTable: module === "history" ? bands.map((row) => ({ tops: num(row.tops), cumPct: num(row.cumPct) })) : saved.hashratePercentileTable,
    } as H9EditableValues;
  }, [data, drafts, allValid, bands, module, jobsBaseSupported]);

  const dirty = useMemo(() => {
    if (!data || !drafts) return false;
    if (MODULE_KEYS[module].some(key => drafts[key].trim() !== h9DraftText(data.values[key]))) return true;
    return module === "history" && (bands.length !== data.values.hashratePercentileTable.length
      || bands.some((row, index) => {
        const saved = data.values.hashratePercentileTable[index];
        return row.tops.trim() !== String(saved.tops) || row.cumPct.trim() !== String(saved.cumPct);
      }));
  }, [data, drafts, bands, module]);

  /** 影响预览:同一组公式分别代入「当前值」与「保存后」,让运营直接看到差在哪。 */
  const impact = useMemo(() => {
    if (!data) return null;
    const perDevice = data.publishedDailyUsdPerDevice;
    const derive = (fleet: number, ratePct: number, virtualCount: number) => ({
      online: fleet * ratePct / 100,
      daily: usdProduct(fleet, perDevice),
      perSec: fleet * perDevice / 86_400,
      monthly: usdProduct(usdProduct(fleet, perDevice), 30),
      denominator: data.realUserCount + virtualCount,
    });
    const current = derive(data.values.fleetDevices, data.values.onlineRatePct, data.values.virtualUserCount);
    const draftFleet = drafts ? num(drafts.fleetDevices) : Number.NaN;
    const draftRate = drafts ? num(drafts.onlineRatePct) : Number.NaN;
    const draftVirtual = drafts ? num(drafts.virtualUserCount) : Number.NaN;
    return { perDevice, current, next: derive(draftFleet, draftRate, draftVirtual) };
  }, [data, drafts]);

  const setDraft = (key: ScalarKey, value: string) => setDrafts((current) => ({ ...current, [key]: value }));
  const setBand = (index: number, key: keyof BandDraft, value: string) =>
    setBands((current) => current.map((row, i) => (i === index ? { ...row, [key]: value } : row)));
  const addBand = () => setBands((current) => [...current, { tops: "", cumPct: "" }]);
  const removeBand = (index: number) => setBands((current) => current.filter((_, i) => i !== index));
  const restoreCurrent = () => {
    if (!data) return;
    setEditor(current => reconcileH9Editor(current, data.values, H9_FIELDS.map(field => field.key), MODULE_KEYS[module], module === "history"));
    setSaveError(null);
  };
  const fillDefaults = () => {
    if (!data) return;
    setDrafts(current => ({ ...current, ...Object.fromEntries(MODULE_KEYS[module].map(key => [key, h9DraftText(data.defaults[key])])) }));
    if (module === "history") setBands(bandDraftsFrom(data.defaults));
    ctx.toast("已填入默认值，还没保存。点「保存变更」确认后才生效");
  };

  /** 网络脉搏的推算模型：已保存的，和按草稿保存后的（改基数或跳动三项时起点重置为保存时刻，只改月增长率不重置）。 */
  const memberModels = useMemo(() => {
    if (!data || !drafts) return null;
    const saved = data.values;
    const savedModel: MemberModel = {
      base: saved.registeredUsersBase, anchorAt: saved.registeredUsersAnchorAt, monthlyPct: saved.registeredUsersMonthlyGrowthPct,
      tick: saved.registeredUsersTickIntervalSec !== undefined && saved.registeredUsersTickStepMin !== undefined && saved.registeredUsersTickStepMax !== undefined
        ? { intervalSec: saved.registeredUsersTickIntervalSec, stepMin: saved.registeredUsersTickStepMin, stepMax: saved.registeredUsersTickStepMax } : undefined,
    };
    const valid = NETWORK_KEYS.every((key) => !fieldErrors[key]);
    const tickFilled = !!drafts.registeredUsersTickIntervalSec.trim();
    const draftModel: MemberModel = {
      base: num(drafts.registeredUsersBase), anchorAt: saved.registeredUsersAnchorAt, monthlyPct: num(drafts.registeredUsersMonthlyGrowthPct),
      tick: tickFilled ? { intervalSec: num(drafts.registeredUsersTickIntervalSec), stepMin: num(drafts.registeredUsersTickStepMin), stepMax: num(drafts.registeredUsersTickStepMax) } : undefined,
    };
    const resets = draftModel.base !== savedModel.base || draftModel.tick?.intervalSec !== savedModel.tick?.intervalSec
      || draftModel.tick?.stepMin !== savedModel.tick?.stepMin || draftModel.tick?.stepMax !== savedModel.tick?.stepMax;
    const changed = NETWORK_KEYS.some((key) => drafts[key].trim() !== h9DraftText(saved[key]));
    return { saved: savedModel, draft: valid && changed ? { ...draftModel, anchorAt: resets ? readAt : saved.registeredUsersAnchorAt } : null, resets };
  }, [data, drafts, fieldErrors, readAt]);

  const memberSeries = (model: MemberModel) => DAY_TICKS.map((day) => membersAt(model, readAt + day * 86_400_000));
  /** 保存后 App 上的注册人数会不会突然跳：按读取时刻比一比现在的数和按草稿保存后的数。 */
  const memberJump = memberModels?.draft ? { from: membersAt(memberModels.saved, readAt), to: membersAt(memberModels.draft, readAt) } : null;
  const jumpNotice = memberJump && memberJump.from != null && memberJump.to != null && memberJump.from !== memberJump.to
    ? <Notice tone="warn" title={`App 上的注册人数会从约 ${count(memberJump.from)} 人${memberJump.to < memberJump.from ? "跳回" : "跳到"} ${count(memberJump.to)} 人`}>
      {memberModels?.resets
        ? <>改了基数或跳动参数，推算起点重置为保存时刻、从新基数重新开始。要接着现在的数涨，把基数填成约 {count(memberJump.from)}。</>
        : <>只改月增长率不重置推算起点，会按原起点重算整段。</>}
    </Notice> : null;

  const save = (enabled?: boolean) => {
    if (!canWrite || !ready.current || !data || !nextValues) return;
    const submitted = { ...nextValues, homeDisplayEnabled: enabled ?? data.values.homeDisplayEnabled };
    // 完整原请求在确认提交时创建一次；未知后只恢复该记录，不按草稿或理由变化换号。
    const rows: DiffRow[] = H9_FIELDS
      .filter((field) => submitted[field.key] !== data.values[field.key])
      .map((field) => ({ key: field.key, label: field.key === "homeOnlineCurrent" ? "在线设备" : field.key === "homePaidCurrent" ? "累计已发放" : FIELD_COPY[field.key].name, before: valueText(field.key, data.values[field.key]), after: valueText(field.key, submitted[field.key]) }));
    if (!sameBands(submitted.hashratePercentileTable, data.values.hashratePercentileTable)) {
      const before = data.values.hashratePercentileTable, after = submitted.hashratePercentileTable;
      const band = (row?: H9PercentileBand) => row ? `${count(row.tops)} TOPS · ${row.cumPct}%` : "没有";
      for (let index = 0; index < Math.max(before.length, after.length); index += 1) {
        if (band(before[index]) !== band(after[index])) rows.push({ key: `band-${index}`, label: `分位表第 ${index + 1} 档`, before: band(before[index]), after: after[index] ? band(after[index]) : "删除" });
      }
    }
    const toggled = submitted.homeDisplayEnabled !== data.values.homeDisplayEnabled;
    if (toggled) rows.unshift({ key: "enabled", label: "首页数字增长", before: data.values.homeDisplayEnabled ? "增长中" : "已暂停", after: submitted.homeDisplayEnabled ? "增长中" : "已暂停" });
    const fleetChanged = nextValues.fleetDevices !== data.values.fleetDevices;
    const virtualZero = nextValues.virtualUserCount === 0 && data.values.virtualUserCount !== 0;
    const currentChanged = nextValues.homeOnlineCurrent !== data.values.homeOnlineCurrent || nextValues.homePaidCurrent !== data.values.homePaidCurrent;
    const stepsChanged = (["homeOnlineStepMin", "homeOnlineStepMax", "homePaidStepMin", "homePaidStepMax"] as const).some((key) => nextValues[key] !== data.values[key]);
    const label = moduleLabel(module);
    const title = toggled ? (submitted.homeDisplayEnabled ? "开启首页数字增长" : "暂停首页数字增长") : `保存${label}`;
    // 环境要等 App 显示读到才知道；没读到时按正式 / 测试两种写。
    const sandbox = appData?.sourceEnvironment === "SANDBOX";
    const growthNote = appData ? "跟在线设备同步增加" : "正式环境跟在线设备同步增加（测试环境只显示基座、不增长）";
    const jobsBaseChanged = nextValues.activeJobsBase !== data.values.activeJobsBase;
    // 全球作业不跟首页填的新当前值走：后端从 App 上现在的作业数接续，基座未发布时一直是「—」。
    const jobsClause = (enabled: boolean) => data.values.activeJobsBase == null ? "全球作业未发布，App 上仍是「—」"
      : sandbox ? "测试环境的全球作业只显示基座，不增长"
        : enabled ? `全球作业接着 App 上现在的数，${growthNote}` : "全球作业跟着一起停住";
    const impactText = toggled
      ? submitted.homeDisplayEnabled
        ? `开启后 App 的在线设备和累计已发放每秒在区间内随机增加，${currentChanged ? "从你填的新当前值开始" : "接着 App 上现在的数继续"}；${jobsClause(true)}。`
        : `暂停后 App 的在线设备和累计已发放停住不再增加，${currentChanged ? "停在你填的新当前值" : "已打开的页面最多再涨约一分钟，所有页面停在同一个数"}，再开启从那里接着涨；${jobsClause(false)}。`
      : module === "home" ? `保存后按新参数生成 App 首页的展示数字，${currentChanged ? "从你填的新当前值开始" : "接着 App 上现在的数继续"}；${jobsClause(data.values.homeDisplayEnabled)}；增长开关不变。`
        : module === "network" ? (memberModels?.resets ? "保存后 App 网络脉搏的注册人数从新基数、在保存时刻重新开始推算。" : "保存后 App 网络脉搏的注册人数按新的月增长率、从原推算起点重算整段。")
          : module === "jobs" ? !jobsBaseChanged ? "全球作业基座没变，App 上的数照常。" : nextValues.activeJobsBase == null ? "保存后 App 首页、赚取页任务中心和全球网络页不显示全球作业数。" : `保存后 App 首页、赚取页任务中心和全球网络页的全球作业从 ${count(nextValues.activeJobsBase)} 重新起算。`
            : "这组参数 App 正式页面不读，保存后只改变这页的历史估算。";
    const homeCompare = (module === "home" || toggled) && stepsChanged;
    const facts = <ConfirmFacts rows={rows} facts={<>
        <Fact k="改的是">{label}</Fact>
        <Fact k="主配置版本"><Change from={`v${data.version}`} to={`v${data.version + 1}`} /></Fact>
        {toggled && dirty && <Fact k="一起保存">首页填写中的 {rows.length - 1} 项改动</Fact>}
        {module === "network" && memberModels?.resets && <Fact k="推算起点"><Change from={businessStamp(data.values.registeredUsersAnchorAt)} to="保存时刻" /></Fact>}
        <Fact k="操作记录">记一条高风险操作记录（不走审批）</Fact>
      </>}>
      {fleetChanged && impact && <Notice tone="neutral" title="历史估算会跟着变">
        日金额估算从 {usd(impact.current.daily)} USD 变成 {usd(usdProduct(nextValues.fleetDevices, data.publishedDailyUsdPerDevice))} USD（每台每日 {usd(data.publishedDailyUsdPerDevice)} USD 不变）。这是内部估算，不是实付，App 不显示。
      </Notice>}
      {module === "jobs" && jobsBaseSupported && jobsBaseChanged && <Notice tone="neutral" title={nextValues.activeJobsBase != null ? `预览：保存后 App 从 ${count(nextValues.activeJobsBase)} 个开始显示` : "预览：保存后 App 不显示全球作业数"}>
        {nextValues.activeJobsBase == null ? "基座留空就是不发布，App 上这个数显示「—」。"
          : sandbox ? "测试环境只显示基座，不增长。"
          : data.values.homeDisplayEnabled ? `首页数字增长开着，之后${growthNote}。` : "首页数字增长暂停中，保存后停在这个数。"}
      </Notice>}
      {virtualZero && <Notice tone="neutral">虚拟人口填了 0：历史估算分母只按注册账号总数（{count(data.realUserCount)} 人）算。</Notice>}
      {homeCompare && <div className="h9-confirm-chart">
        <p className="h9-chart-title">开启时接下来 24 小时平均增加的在线设备</p>
        <TrendLines label="新旧参数下 24 小时在线设备平均增加量" ticks={HOUR_LABELS} height={120} format={(value) => `${count(Math.round(value))} 台`} axisFormat={axisShort("台")}
          series={[
            { key: "before", label: "现在的参数", slot: "other", values: HOUR_TICKS.map((hour) => averageGain(data.values.homeOnlineStepMin, data.values.homeOnlineStepMax, hour)) },
            { key: "after", label: "改后", slot: 2, values: HOUR_TICKS.map((hour) => averageGain(nextValues.homeOnlineStepMin, nextValues.homeOnlineStepMax, hour)) },
          ]} />
      </div>}
      {module === "network" && jumpNotice}
      {module === "network" && memberModels?.draft && <div className="h9-confirm-chart">
        <p className="h9-chart-title">接下来 30 天的注册人数</p>
        <TrendLines label="新旧参数下 30 天注册人数推算" ticks={DAY_LABELS} height={120} format={(value) => `${count(value)} 人`} axisFormat={axisShort("人")}
          series={[
            { key: "before", label: "现在的参数", slot: "other", values: memberSeries(memberModels.saved) },
            { key: "after", label: "改后", slot: 3, values: memberSeries(memberModels.draft) },
          ]} />
      </div>}
    </ConfirmFacts>;

    const change = rows.slice(0, 2).map(row => `${row.label} ${row.before} → ${row.after}`).join("；") + (rows.length > 2 ? `；等 ${rows.length} 项` : "");
    let command: H9Command | undefined;
    ctx.openActionConfirm({ briefKind: "config",
      getPendingReason: () => command && pendingH9Command("main")?.commandKey === command.commandKey ? command.original?.reason : undefined,
      action: `保存${label}`,
      title,
      effect: <StatusTag tone="progress" filled>立即生效</StatusTag>,
      confirmLabel: toggled ? (submitted.homeDisplayEnabled ? "确认开启" : "确认暂停") : "确认保存",
      statedBrief: { impact: impactText, check: "核对改动和对 App 的影响，理由写清调整依据。" },
      reasonPlaceholder: "例如：运营活动安排、工单号",
      facts,
      detail: "主配置整组保存：任何一项不合法，整组都不保存；页面上其他块没保存的草稿不会带上。",
      // 🔴 不挂 amplifies:它的语义是「放大资金流出方向,系统会先检查备付金覆盖率」(K 域契约),
      //    而本页改的是展示数字,一分钱都不流出,也没传 coverage —— 挂上等于在弹窗里
      //    向运营承诺一道根本没跑的资金闸。
      reasonMin: 8,
      reasonMax: 200,
      run: async (reason) => {
        const recovering = !!command && pendingH9Command("main")?.commandKey === command.commandKey;
        if (!recovering && (!ready.current || data.version !== currentVersion.current)) throw new Error("H9_CURRENT_READ_REQUIRED");
        command ??= prepareH9PublicStats(submitted, data.version, reason, {
          module, title, action: `保存${label}`, impact: impactText, change: change || title,
          rows: rows.map(row => ({ key: String(row.key), label: String(row.label), before: String(row.before), after: String(row.after) })),
          extraFacts: [
            ...(toggled && dirty ? [{ label: "一起保存", value: `首页填写中的 ${rows.length - 1} 项改动` }] : []),
            ...(module === "network" && memberModels?.resets ? [{ label: "推算起点", before: businessStamp(data.values.registeredUsersAnchorAt), after: "保存时刻" }] : []),
          ],
        });
        ready.current = false;
        setSaving(true);
        try {
          const saved = await updateH9PublicStats(command, recovering);
          if (recovering) {
            ctx.openActionConfirm(null);
            await load(module);
          } else {
            setData(saved);
            setEditor(current => reconcileH9Editor(current, saved.values, H9_FIELDS.map(field => field.key), MODULE_KEYS[module], module === "history"));
            setReadAt(Date.now());
          }
          setSaveError(null);
          ctx.toast(`${label}已保存，主配置 v${saved.version}`, "success");
        } catch (cause) {
          const unresolved = pendingH9Command("main");
          const message = formatAdminApiError(cause instanceof Error ? cause.message : null, "H9_SAVE_FAILED");
          const kind = unresolved ? "unknown" : saveIssueKind(cause, ["H9_CONFIG_VERSION_CONFLICT"], recovering);
          if (kind === "conflict") ready.current = false;
          setSaveError({ kind, message, module, change: change || title, at: command.createdAt });
          if (!unresolved) {
            command = undefined;
            if (recovering) { ctx.openActionConfirm(null); await load(module); }
          }
          throw cause;
        } finally { setSaving(false); syncPending(); }
      },
    });
  };

  /** 全球网络保存没得到明确结果：和主配置同一个对象，写进同一条提醒。 */
  const onGlobeIssue = (cause: unknown, change: string) => {
    const message = formatAdminApiError(cause instanceof Error ? cause.message : null, "H9_SAVE_FAILED");
    setSaveError({ kind: saveIssueKind(cause, ["H9_CONFIG_VERSION_CONFLICT"]), message, module: "globe", change, at: Date.now() });
  };

  const recover = (record: H9Command) => {
    const original = record.original;
    if (!original) return;
    const display = original.display;
    ctx.openActionConfirm({ briefKind: "config", action: display.action, title: display.title,
      effect: <StatusTag tone="progress" filled>立即生效</StatusTag>, confirmLabel: "按原操作重试",
      statedBrief: { impact: display.impact, check: "核对改动和对 App 的影响，理由写清调整依据。" },
      detail: "主配置整组保存：任何一项不合法，整组都不保存；页面上其他块没保存的草稿不会带上。",
      getPendingReason: () => pendingH9Command("main")?.commandKey === record.commandKey ? original.reason : undefined,
      blockedReason: !canRetryH9Command(record) ? RETRY_EXPIRED_TEXT : !canWrite ? formatAdminApiError("ACCESS_DENIED", "ACCESS_DENIED") : undefined,
      facts: <ConfirmFacts rows={display.rows} facts={<>
        <Fact k="改的是">{display.objectLabel ?? moduleLabel(display.module)}</Fact>
        <Fact k="主配置版本"><Change from={`v${original.expectedVersion}`} to={`v${original.expectedVersion + 1}`} /></Fact>
        {display.extraFacts?.map(fact => <Fact key={fact.label} k={fact.label}>{fact.value ?? <Change from={fact.before} to={fact.after} />}</Fact>)}
        <Fact k="操作记录">记一条高风险操作记录（不走审批）</Fact>
      </>} />,
      run: async () => {
        ready.current = false;
        setSaving(true);
        try {
          const saved = await updateH9PublicStats(record, true);
          ctx.openActionConfirm(null);
          await load(display.module);
          ctx.toast(`${moduleLabel(display.module)}已保存，主配置 v${saved.version}`, "success");
        } catch (cause) {
          if (!pendingH9Command("main")) { ctx.openActionConfirm(null); await load(display.module); }
          throw cause;
        } finally { setSaving(false); syncPending(); }
      },
    });
  };
  const recoveryRows = pending ? [{
    key: pending.commandKey, name: pending.original ? moduleLabel(pending.original.display.module) : "首页与网络展示设置",
    change: pending.original?.display.change ?? formatAdminApiError("H9_ORIGINAL_REQUEST_UNAVAILABLE", "H9_ORIGINAL_REQUEST_UNAVAILABLE"), submittedAt: pending.createdAt,
    status: h9Status(pending, outcomes[pending.commandKey], canWrite),
    tech: <TechInfo commandKey={pending.commandKey} receipt={receiptOf(outcomes[pending.commandKey])} />,
    actions: <>
      <Button size="sm" disabled={loading} onClick={() => { if (pending.original) setModule(pending.original.display.module); void load(pending.original?.display.module); }}>查询原操作</Button>
      {canInvestigateECommand("growth_h9_read") && eCommandClosureOffer(outcomes[pending.commandKey], isRetryExpired(pending)).conclusions.length > 0 && <Button size="sm" variant="danger-outline" disabled={loading || saving} onClick={() => setClosing(pending)}>核查结案</Button>}
      <Button size="sm" disabledReason={!canRetryH9Command(pending) ? pending.original ? RETRY_EXPIRED_TEXT : formatAdminApiError("H9_ORIGINAL_REQUEST_UNAVAILABLE", "H9_ORIGINAL_REQUEST_UNAVAILABLE") : !canWrite ? formatAdminApiError("ACCESS_DENIED", "ACCESS_DENIED") : undefined}
        disabled={saving} onClick={() => recover(pending)}>按原操作重试</Button>
    </>,
  }] : [];
  const recoveryNotice = <><H9RecoveryNotice rows={recoveryRows} explain={RECOVERY_EXPLAIN} />
    {closing && <FundClosureModal label={closing.original ? moduleLabel(closing.original.display.module) : "首页与网络展示设置"} createdAt={closing.createdAt}
      offer={eCommandClosureOffer(outcomes[closing.commandKey], isRetryExpired(closing))}
      facts={<Fact k="系统记录">{receiptFact(((outcome) => outcome && "receipt" in outcome ? outcome.receipt : null)(outcomes[closing.commandKey]), "记录保留")}</Fact>}
      onClose={() => setClosing(null)} onSubmit={async evidence => {
        const record = closing;
        const receipt = await queryH9Command("main", record, evidence);
        setOutcomes(all => ({ ...all, [record.commandKey]: { receipt } }));
        setClosing(null);
        syncPending();
        if (eCommandSettled(receipt)) {
          ctx.toast(settledText({ status: receipt!.originalStatus }), "success");
          ctx.openActionConfirm(null);
          await load(record.original?.display.module);
        } else ctx.toast(CLOSURE_KEPT_TEXT, "warn");
      }} />}
  </>;
  /** 排名的结果未知提醒在排名那一块里；切到别的块时，在页面上方给一个入口。 */
  const rankPending = pendingH9Command("rank");
  const unresolved = [pending && (pending.original ? moduleLabel(pending.original.display.module) : "主配置"), rankPending && "设备预估排名"].filter(Boolean).join("、");
  const rankJump = rankPending && module !== "rank" ? <Button size="sm" onClick={() => setModule("rank")}>去设备预估排名处理 →</Button> : undefined;

  const header = (
    <PageHeader pageId="H9" title="首页与网络展示设置" summary="管 App 首页和网络页给用户看的展示数字。"
      meta={data ? <>主配置 v{data.version} · {businessStamp(Date.parse(data.effectiveAt))} 生效（{businessZone().label}）· 打开时读取</> : undefined}
      readOnly={!canWrite ? "你只能查看；修改要有这页的修改权限。" : undefined} />
  );

  const cards = <H9ModuleCards data={data} failed={!data && !loading} rank={rank} rankUnknown={!!rankPending} module={module} onSelect={setModule} ids={ids} readAt={readAt}
    appJobs={appData && appData.version === data?.version ? appData.activeJobsDisplay : undefined} />;
  const rankPanel = <div key="rank" hidden={module !== "rank"} {...ids.panel("rank")}><H9DeviceRank ctx={ctx} onData={setRank} /></div>;

  if (!data || !drafts) {
    return <div className="h9-page">
      {header}
      {recoveryNotice}
      {rankJump && <Notice tone="warn" title="设备预估排名有一次保存结果未知" action={rankJump}>{rankPending?.original?.display.change ?? "原保存的内容没有存全"} · {businessStamp(rankPending!.createdAt)} 提交（{businessZone().label}）</Notice>}
      {loading
        ? <Conclusion state="unknown">展示设置读取中…</Conclusion>
        /* 文案拼接走 h9PlaceholderCopy:字典整句自带句号,直接再拼「。」就是双句号(P2-15 回归)。 */
        : <Notice tone="danger" title="主配置读取失败，这页暂时不能改" action={<Button size="sm" icon={<RefreshCw size={14} aria-hidden />} onClick={() => void load()}>重新读取</Button>}><KeepText text={h9PlaceholderCopy(error)} /></Notice>}
      {cards}
      {module !== "rank" && <div {...ids.panel(module)}>
        <BlockState state={loading ? "loading" : "error"} title={loading ? "读取中…" : `${moduleLabel(module)}暂时看不到`} detail={loading ? undefined : "主配置读到后才显示这一块；设备预估排名照常可用。"} />
      </div>}
      {rankPanel}
    </div>;
  }

  const values = data.values;
  const savedTick = values.registeredUsersTickIntervalSec !== undefined;
  const changedBands = module !== "history" ? 0 : Array.from({ length: Math.max(bands.length, values.hashratePercentileTable.length) },
    (_, index) => bands[index]?.tops.trim() !== h9DraftText(values.hashratePercentileTable[index]?.tops) || bands[index]?.cumPct.trim() !== h9DraftText(values.hashratePercentileTable[index]?.cumPct)).filter(Boolean).length;
  const changedKeys = MODULE_KEYS[module].filter((key) => drafts[key].trim() !== h9DraftText(values[key]));
  const badCount = MODULE_KEYS[module].filter((key) => fieldErrors[key]).length + (module === "history" ? rowErrors.filter(Boolean).length + (bandCountError ? 1 : 0) : 0);
  const saveBlock = pending ? formatAdminApiError("H9_ORIGINAL_UNRESOLVED", "H9_ORIGINAL_UNRESOLVED") : error ? formatAdminApiError("H9_CURRENT_READ_REQUIRED", "H9_CURRENT_READ_REQUIRED") : saving ? "正在保存" : loading ? "正在读取最新数据，读完再保存" : conflict ? "这块已被别人改过，先刷新这一块" : !dirty ? "没有改动" : !allValid ? "有填错的项，按框下的提示改" : undefined;
  const toolbarNote = loading ? "正在读取…" : !canWrite ? "只能查看" : !dirty ? "没有改动" : badCount ? `有 ${badCount} 处要改` : `改了 ${changedKeys.length + changedBands || 1} 项，还没保存`;

  const renderField = (key: ScalarKey) => {
    const field = H9_FIELDS.find((item) => item.key === key)!;
    const pending = key === "activeJobsBase" && !jobsBaseSupported;
    const defaultable = DEFAULTABLE.includes(module);
    const isDefault = defaultable && h9DraftText(values[key]) === h9DraftText(data.defaults[key]) && values[key] !== undefined;
    const unit = MONEY_KEYS.has(key) ? PAID_UNIT : field.unit;
    const range = `${count(field.min)}–${count(field.max)} ${unit}${field.integer ? "，整数" : ""}`;
    const defaultText = defaultable && !isDefault ? `默认 ${data.defaults[key] == null ? "不发布" : `${count(data.defaults[key])} ${field.unit}`}` : "";
    return <Field key={key} label={<>{FIELD_COPY[key].name}{isDefault && <StatusTag tone="neutral">默认值</StatusTag>}</>}
      explain={FIELD_COPY[key].what} hint={range}
      help={[field.clearable ? "留空表示不发布" : pending ? "这一项目前还不支持，暂时不能改" : "", defaultText].filter(Boolean).join("；") || undefined}
      error={fieldErrors[key] || undefined}>
      {(control) => <NumberInput {...control}
        aria-label={`${field.label}目标值`}
        unit={unit} min={field.min} max={field.max} step={field.step}
        inputMode={field.integer ? "numeric" : "decimal"}
        value={drafts[key]}
        placeholder={pending ? "暂不支持" : field.clearable ? "不发布" : undefined}
        disabled={!canWrite || loading || !!error || saving || !!pendingH9Command("main") || pending}
        onChange={(event) => setDraft(key, event.target.value)} />}
    </Field>;
  };

  const toolbar = (extra?: ReactNode) => <ModuleToolbar note={toolbarNote} tone={dirty && badCount ? "warn" : undefined}>
    <Button variant="ghost" size="sm" icon={<RefreshCw size={14} aria-hidden />} disabled={loading} onClick={() => void load(module)}>刷新这一块</Button>
    {canWrite && extra}
    {canWrite && <Button size="sm" disabled={!dirty || !!pending || saving || loading || !!error} onClick={restoreCurrent}>放弃改动</Button>}
    {canWrite && <Button variant="primary" size="sm" disabledReason={saveBlock} onClick={() => save()}>保存变更</Button>}
  </ModuleToolbar>;
  const defaultsButton = <Button size="sm" disabled={loading || !!error || saving || !!pending} onClick={fillDefaults}>恢复默认</Button>;

  const conflictNotice = conflict && <Notice tone="warn" title="这块已被别人改过" action={<Button size="sm" onClick={() => void load(module)}>刷新这一块</Button>}>
    你填的内容还在。刷新会读最新值并放弃这一块没保存的改动，再按最新值重新改，避免盖掉别人的设置。
  </Notice>;

  // 首页：App 显示的数读得到就放大写它、设定值退到下面；增长推算只算增加量。
  const display = appData;
  const shown = display?.homeDisplay ?? null;
  const appMembers = display?.registeredUsers ?? null;
  const homeDraftValid = HOME_KEYS.every((key) => !fieldErrors[key]);
  const homeStepsDirty = (["homeOnlineStepMin", "homeOnlineStepMax", "homePaidStepMin", "homePaidStepMax"] as const).some((key) => drafts[key].trim() !== h9DraftText(values[key]));
  const homeSeries = (min: number, max: number) => HOUR_TICKS.map((hour) => averageGain(min, max, hour));
  const growthChart = (kind: "online" | "paid") => {
    const [minKey, maxKey] = kind === "online" ? ["homeOnlineStepMin", "homeOnlineStepMax"] as const : ["homePaidStepMin", "homePaidStepMax"] as const;
    const showDraft = homeStepsDirty && homeDraftValid;
    const format = kind === "online" ? (value: number) => `${count(Math.round(value))} 台` : (value: number) => paid(Number(value.toFixed(2)));
    const perDay = (min: number, max: number) => kind === "online" ? `${count(min * 86_400)}–${count(max * 86_400)} 台` : `${usd(usdProduct(min, 86_400))}–${usd(usdProduct(max, 86_400))} USD`;
    return <div className="h9-chart">
      <p className="h9-chart-title">{kind === "online" ? "在线设备" : "累计已发放（USD）"} · 开启时 24 小时平均增加</p>
      <TrendLines label={`${kind === "online" ? "在线设备" : "累计已发放"}开启后 24 小时平均增加量`} ticks={HOUR_LABELS} height={120} format={format} axisFormat={axisShort(kind === "online" ? "台" : "")}
        series={[
          { key: "saved", label: "现在的参数", slot: showDraft ? "other" : 2, values: homeSeries(values[minKey], values[maxKey]) },
          ...(showDraft ? [{ key: "draft", label: "填写中", slot: 2 as const, values: homeSeries(num(drafts[minKey]), num(drafts[maxKey])) }] : []),
        ]} />
      <p className="h9-chart-note">一天增加 {perDay(values[minKey], values[maxKey])}{showDraft && <>，改后 {perDay(num(drafts[minKey]), num(drafts[maxKey]))}</>}</p>
    </div>;
  };

  const homeModule = <div className="rd-split h9-module" data-detail="" data-even="" hidden={module !== "home"} {...ids.panel("home")} aria-label="首页数字增长">
    <Panel title="App 上的样子" icon={Smartphone} tone="role-2" explain="App 介绍页、首页和网络脉搏的在线设备都是这个数；累计已发放在介绍页。数字由系统按秒生成，所有用户看到同一个数。">
      <AppPreview where="App 介绍页 · 网络脉搏"
        explain={<><p>增长开着时，两个数每秒在区间里随机增加，所有用户看到同一个数；暂停后停在暂停那一刻，再开启从那里接着涨。保存参数不会改开关。</p><p>App 页面开着时一般 60 秒内读到新参数，退到后台或断网时不保证。</p></>}
        status={values.homeDisplayEnabled ? <><StatusTag tone="progress">增长中</StatusTag>每秒在区间里随机增加</> : <><StatusTag tone="neutral">已暂停</StatusTag>App 上的数停住不动</>}>
        <AppNumber label={shown ? "在线设备 · App 显示" : "在线设备 · 设定值"} value={count(shown ? shown.onlineDevices : values.homeOnlineCurrent)} unit="台"
          sub={shown ? `设定值 ${count(values.homeOnlineCurrent)} 台` : undefined} />
        <AppNumber label={<>{shown ? "累计已发放 · App 显示" : "累计已发放 · 设定值"}<Explain label="累计已发放的单位" content={shown ? APP_PAID_NOTE : PAID_UNIT_NOTE} /></>}
          value={shown ? `$${centsAmount(shown.paidCents)}` : paid(values.homePaidCurrent)} sub={shown ? `设定值 ${paid(values.homePaidCurrent)}` : undefined} />
      </AppPreview>
      <AppSample read={appDisplay} found={!!shown} fallback="设定值" />
      {growthChart("online")}
      {growthChart("paid")}
    </Panel>
    <Panel title="参数" icon={SlidersHorizontal} tone="role-4" sub={`主配置 v${data.version}`}
      actions={canWrite && <Button size="sm" variant={values.homeDisplayEnabled ? "secondary" : "primary"}
        disabledReason={pending ? formatAdminApiError("H9_ORIGINAL_UNRESOLVED", "H9_ORIGINAL_UNRESOLVED") : error ? formatAdminApiError("H9_CURRENT_READ_REQUIRED", "H9_CURRENT_READ_REQUIRED") : saving ? "正在保存" : loading ? "正在读取最新数据" : conflict ? "这块已被别人改过，先刷新这一块" : !allValid ? "首页有填错的项，改好后才能切换" : undefined}
        onClick={() => save(!values.homeDisplayEnabled)}>{values.homeDisplayEnabled ? "暂停增长" : "开启增长"}</Button>}
      explain="开启或暂停会把首页这块填写中的改动一起保存；只保存参数不会改开关。">
      {conflictNotice}
      <div className="h9-group">
        <h3 className="h9-group-title">在线设备</h3>
        {renderField("homeOnlineCurrent")}
        <div className="h9-pair">{renderField("homeOnlineStepMin")}{renderField("homeOnlineStepMax")}</div>
      </div>
      <div className="h9-group">
        <h3 className="h9-group-title">累计已发放<Explain label="累计已发放的单位" content={PAID_UNIT_NOTE} /> <span className="h9-group-rule">金额最多两位小数，多了不能保存</span></h3>
        {renderField("homePaidCurrent")}
        <div className="h9-pair">{renderField("homePaidStepMin")}{renderField("homePaidStepMax")}</div>
      </div>
      {toolbar()}
    </Panel>
  </div>;

  // 网络脉搏注册人数。
  const members = membersAt(memberModels!.saved, readAt);
  const spread = memberModels!.saved.tick ? memberSpread(memberModels!.saved.tick.stepMin, memberModels!.saved.tick.stepMax) : 0;
  const networkModule = <div className="rd-split h9-module" data-detail="" data-even="" hidden={module !== "network"} {...ids.panel("network")}>
    <Panel title="App 上的样子" icon={Smartphone} tone="role-3" explain="注册人数是按参数推算的展示数字，不改真实账户，也不参与设备预估排名。">
      <AppPreview where="App 首页 · 网络脉搏"
        explain={savedTick
          ? <>{appMembers != null && <>App 显示的是系统算出的数。</>}推算按读取这页的时刻、用同一个公式。每跳一次另有 0–{count(spread)} 人的固定随机偏移，所以 App 上会比推算多 0–{count(spread)} 人，所有用户一致。</>
          : <>只配了月增长率：网络脉搏卡片显示这个数，网络快照等位置会显示「不可用」。</>}
        status={savedTick ? `App 上比推算多 0–${count(spread)} 人` : <><StatusTag tone="warn">部分位置不显示</StatusTag>网络快照显示「不可用」</>}>
        {appMembers != null
          ? <AppNumber label="注册用户 · App 显示" value={count(appMembers)} unit="人" sub={members == null ? undefined : `按参数推算约 ${count(members)} 人`} />
          : <AppNumber label="注册用户 · 推算约" value={members == null ? "—" : count(members)} unit={members == null ? undefined : "人"} empty={members == null} />}
      </AppPreview>
      <AppSample read={appDisplay} found={appMembers != null} fallback="推算" />
      <div className="h9-chart">
        <p className="h9-chart-title">接下来 30 天</p>
        <TrendLines label="接下来 30 天注册人数推算" ticks={DAY_LABELS} height={140} format={(value) => `${count(value)} 人`} axisFormat={axisShort("人")}
          series={[
            { key: "saved", label: "现在的参数", slot: memberModels!.draft ? "other" : 3, values: memberSeries(memberModels!.saved) },
            ...(memberModels!.draft ? [{ key: "draft", label: "填写中", slot: 3 as const, values: memberSeries(memberModels!.draft) }] : []),
          ]} />
      </div>
      {jumpNotice}
      <Facts>
        <Fact k="推算起点">{businessStamp(values.registeredUsersAnchorAt)}（{businessZone().label}）</Fact>
      </Facts>
    </Panel>
    <Panel title="参数" icon={SlidersHorizontal} tone="role-4" sub={`主配置 v${data.version}`}
      explain="改基数、跳动间隔或每次人数，推算起点重置为保存时刻；只改月增长率不重置起点，会按原起点重算整段。">
      {conflictNotice}
      {!savedTick && <Notice tone="warn" title="只配了月增长率">App 网络脉搏卡片照常显示注册人数，网络快照等位置会显示「不可用」。要各处都显示，填上跳动间隔和每次增加人数（三项一起）。</Notice>}
      {renderField("registeredUsersBase")}
      <div className="h9-group">
        <h3 className="h9-group-title">按跳动增长</h3>
        {renderField("registeredUsersTickIntervalSec")}
        <div className="h9-pair">{renderField("registeredUsersTickStepMin")}{renderField("registeredUsersTickStepMax")}</div>
      </div>
      {savedTick
        ? <div className="h9-group" data-idle="">
          <h3 className="h9-group-title">目前不生效 <StatusTag tone="neutral" explain="已设了跳动，注册人数只按跳动算。月增长率还能保存，但不会被用到。">设了跳动后不用</StatusTag></h3>
          {renderField("registeredUsersMonthlyGrowthPct")}
        </div>
        : <div className="h9-group">
          <h3 className="h9-group-title">按月增长</h3>
          {renderField("registeredUsersMonthlyGrowthPct")}
        </div>}
      {toolbar(defaultsButton)}
    </Panel>
  </div>;

  // 全球作业基座：App 显示的数由服务端按 App 同一算法给出，页面不重算（ae9783f7）。
  // 样本和主配置是两次读取，版本对不上（中间有人保存过）就当没读到。
  const appJobs = display?.version === data.version ? display.activeJobsDisplay : undefined;
  const jobsActual = display?.activeJobsActual ?? null;
  const jobsReason = display?.unavailable.find(item => item.field === "activeJobsDisplay")?.reason;
  const jobsSandbox = display?.sourceEnvironment === "SANDBOX";
  const jobsModule = <div className="rd-split h9-module" data-detail="" data-even="" hidden={module !== "jobs"} {...ids.panel("jobs")}>
    <Panel title="App 上的样子" icon={Smartphone} tone="role-2" explain="App 首页、赚取页任务中心和全球网络页用同一个数。">
      <AppPreview where="App 赚取页 · 任务中心"
        explain={<><p>App 显示的是从基座起算的展示数：首页数字增长开着时跟在线设备同步增加，暂停时停住。不加真实的{jobsName}。</p><p>保存新的基座后从新基座重新起算；留空就是不发布，App 显示「—」。测试环境只显示基座，不增长。</p><p>{jobsName}只在这页作参考，App 不显示。</p></>}
        status={appJobs === undefined ? undefined : jobsSandbox ? <><StatusTag tone="warn">测试环境</StatusTag>只显示基座，不增长</> : "正式环境 · 和 App 首页同一批展示数"}>
        <AppNumber label={appJobs != null ? "全球作业进行中 · App 显示" : "全球作业进行中"}
          value={appJobs != null ? count(appJobs) : "—"} unit={appJobs != null ? "个" : undefined} empty={appJobs == null}
          sub={appJobs != null ? `基座 ${count(display!.activeJobsBase)}${jobsActual == null ? "" : `；${jobsName} ${count(jobsActual)}，仅作参考`}`
            : appJobs === null ? JOBS_REASON[jobsReason ?? ""] ?? "原因不明" : undefined} />
      </AppPreview>
      {appDisplay.state === "loading" ? <p className="h9-chart-note">正在读取 App 显示的数…</p>
        : appDisplay.state === "error" ? <p className="h9-chart-note">App 显示的数没读到<Explain label="失败原因" content={appDisplay.message} /></p>
          : appJobs === undefined ? <p className="h9-chart-note">App 显示的作业数现在没有</p>
            : <p className="h9-chart-note">{appJobs === null ? "App 显示的数读不到" : "App 显示的数"} · 取样 {formatBusinessTimeCompact(appDisplay.data.capturedAt, "—")}（{businessZone().label}）</p>}
    </Panel>
    <Panel title="参数" icon={SlidersHorizontal} tone="role-4" sub={`主配置 v${data.version}`}>
      {conflictNotice}
      {renderField("activeJobsBase")}
      {toolbar(defaultsButton)}
    </Panel>
  </div>;

  // 历史估算：App 不读，整块归「目前不生效」。
  const impactRows = impact ? [
    { key: "online", label: "历史在线估算", now: `${count(impact.current.online)} 台`, next: `${count(impact.next.online)} 台` },
    { key: "daily", label: "日金额估算", now: `${usd(impact.current.daily)} USD`, next: `${usd(impact.next.daily)} USD` },
    { key: "perSec", label: "每秒金额估算", now: `${usdApprox(impact.current.perSec)} USD`, next: `${usdApprox(impact.next.perSec)} USD` },
    { key: "monthly", label: "30 天金额估算", now: `${usd(impact.current.monthly)} USD`, next: `${usd(impact.next.monthly)} USD` },
    { key: "denominator", label: "历史估算分母", now: `${count(impact.current.denominator)} 人`, next: `${count(impact.next.denominator)} 人` },
  ].map((row) => ({ ...row, next: row.next.includes("NaN") || row.next.startsWith("—") ? "—" : row.next })) : [];
  const historyModule = <div className="h9-stack" hidden={module !== "history"} {...ids.panel("history")}>
    <Notice tone="neutral" title="这组参数目前不生效">App 正式页面不读历史估算，在线设备、已完成提现和设备预估排名都不用它。保存后只改变这页的估算。</Notice>
    <div className="rd-split h9-module" data-detail="" data-even="">
      <Panel title="估算结果" icon={TableProperties} tone="role-other" sub={`每台每日 ${usd(data.publishedDailyUsdPerDevice)} USD`}
        explain="按你填的值随填随算，保存前就能看到。日金额 = 设备总数 × 每台每日；不是实付金额，也不改账户、设备或资金账单。">
        <Table label="历史估算的影响">
          <thead><tr><Th>指标</Th><Th align="right">现在</Th><Th align="right">按填写的值</Th></tr></thead>
          <tbody>
            {impactRows.map((row) => <Tr key={row.key}>
              <Td>{row.label}</Td>
              <Td align="right">{row.now}</Td>
              <Td align="right">{row.now === row.next ? row.next : <span className="h9-changed">{row.next}</span>}</Td>
            </Tr>)}
          </tbody>
        </Table>
      </Panel>
      <Panel title="参数" icon={SlidersHorizontal} tone="role-4" sub={`主配置 v${data.version}`}>
        {conflictNotice}
        {renderField("fleetDevices")}
        {renderField("onlineRatePct")}
        {renderField("virtualUserCount")}
        <div className="h9-group" data-idle="">
          <h3 className="h9-group-title">目前不生效 <StatusTag tone="neutral" explain="保存后不参与任何计算，这页的估算也不用它。">没有地方用</StatusTag></h3>
          {renderField("onlineJitter")}
        </div>
      </Panel>
    </div>
    <Panel title="算力分位表" icon={TableProperties} tone="role-other" sub={`${bands.length} 档`}
      explain={<>累计占比是算力达到或低于这一档的人占历史估算分母的比例；100% 表示覆盖全部。只用于历史估算，设备预估排名用的是自己的档位。</>}
      actions={<>
        <PaginationExemption label="算力分位表" reason="整表统一保存，需同时检查各行数值顺序" maxRows={bands.length} kind="fixed-matrix" />
        {canWrite && <Button size="sm" disabled={loading || !!error || saving || !!pending} onClick={addBand}>添加档</Button>}
      </>}>
      {bandCountError && <Notice tone="warn">{bandCountError}。{canWrite ? "点「添加档」补齐。" : ""}</Notice>}
      {bands.length > 0 && <Table label="算力分位表">
        <thead><tr><Th>档</Th><Th>算力档位</Th><Th>累计占比</Th><Th>含义</Th>{canWrite && <Th align="right">操作</Th>}</tr></thead>
        <tbody>
          {bands.map((row, index) => {
            const pct = num(row.cumPct);
            return <Tr key={index}>
              <Td>{index + 1}</Td>
              <Td><NumberInput aria-label={`第 ${index + 1} 档算力档位`} unit="TOPS" min={H9_BAND_TOPS_MIN} inputMode="decimal" value={row.tops} disabled={!canWrite || loading || !!error || saving || !!pending} onChange={(event) => setBand(index, "tops", event.target.value)} /></Td>
              <Td><span className="h9-band-pct">
                {Number.isFinite(pct) && pct >= 0 && pct <= 100 && <RatioBar compact quiet label="累计占比" value={pct} total={100} valueText={`累计 ${pct}%`} tone="role-other" />}
                <NumberInput aria-label={`第 ${index + 1} 档累计占比`} unit="%" min={0} max={100} inputMode="decimal" value={row.cumPct} disabled={!canWrite || loading || !!error || saving || !!pending} onChange={(event) => setBand(index, "cumPct", event.target.value)} />
              </span></Td>
              <Td>{rowErrors[index] ? <span className="h9-row-error">{rowErrors[index]}</span> : h9BandMeaning(row.tops, row.cumPct)}</Td>
              {canWrite && <Td align="right"><Button size="sm" variant="ghost" aria-label={`删除第 ${index + 1} 档`} disabled={loading || !!error || saving || !!pending} onClick={() => removeBand(index)}>删除</Button></Td>}
            </Tr>;
          })}
        </tbody>
      </Table>}
      <p className="h9-band-rule">算力从 {H9_BAND_TOPS_MIN} 起从小到大排；累计占比逐行不变小，最高 100%；至少 {H9_BAND_MIN} 档。</p>
      {toolbar(defaultsButton)}
    </Panel>
  </div>;

  const issue = saveError;

  return <div className="h9-page">
    {header}
    {recoveryNotice}
    {issue?.kind === "conflict" && !ctx.confirmOpen && <Notice tone="warn" title={`保存没成功：${moduleLabel(issue.module)}所在的主配置已被别人改过`}
      action={<Button size="sm" onClick={() => { setModule(issue.module); void load(issue.module); }}>刷新这一块</Button>}>
      这次没有保存。刷新读到最新值后再改，避免盖掉别人的设置。
    </Notice>}
    {issue?.kind === "rejected" && !ctx.confirmOpen && <Notice tone="danger" title={`保存被拒：${moduleLabel(issue.module)}`}>{issue.message}{/没有保存/.test(issue.message) ? "" : " 这次没有保存，按原因改好后再保存。"}</Notice>}
    {error && <Notice tone="danger" title="刷新没成功">{error} 页面上还是上次读到的值，已填写的内容保留，请重试。</Notice>}
    {!issue && !error && (unresolved
      ? <Conclusion state="warn" action={rankJump}>{unresolved}的保存还没有结论：先处理上方的记录，有结论前不能再保存</Conclusion>
      : savedTick
      ? <Conclusion state="ok">首页数字{values.homeDisplayEnabled ? "增长中" : "已暂停"}，设备预估排名{rank.state === "ready" ? rank.config.enabled ? "已开启" : "已关闭" : rank.state === "failed" ? "读取失败" : "读取中"}；没有要处理的事</Conclusion>
      : <Conclusion state="warn" action={module !== "network" ? <Button size="sm" onClick={() => setModule("network")}>去看注册人数 →</Button> : undefined}>网络脉搏注册人数只配了月增长率，App 上有的位置显示「不可用」</Conclusion>)}
    {cards}
    {homeModule}
    {networkModule}
    {jobsModule}
    <div hidden={module !== "globe"} {...ids.panel("globe")}>
      <H9GlobeDisplay ctx={ctx} data={data} appDisplay={appDisplay} refreshing={loading} blocked={!!error || saving || !!pending || saveError?.kind === "conflict"} ready={ready} onPending={syncPending} onIssue={onGlobeIssue} onSaved={next => {
        setData(next); setEditor(current => reconcileH9Editor(current, next.values, H9_FIELDS.map(field => field.key))); setSaveError(null); setReadAt(Date.now());
      }} onRefresh={() => load("globe")} />
    </div>
    {rankPanel}
    {historyModule}
    <AuditFoot />
  </div>;
}

export default H9PublicStats;

"use client";

/**
 * J2 地区访问限制（应急控制页）。管哪些国家和地区不能用、哪些只能用一部分功能。
 * 首屏：结论、四个数（封锁、受限、近 24 小时拦截、地区识别）、两份全局名单、功能入口规则对照表、地区识别源。
 * 第二层：名单国家明细、拦截记录、最近修改（折叠）。
 * 五个写入口直接生效、不走审批：改名单（整份替换）、改入口规则、切换识别源、应急批量封锁。
 * 改名单、改入口规则、应急批量封锁先在选择框里选国家，随时看到加了哪些、去了哪些，再进共用确认框写理由提交；
 * 请求、校验、提交锁和结果未知的处理都和改版前一样（runBackend、j-client 的命令号）。
 * 结果未知按 R1 由代码 worker 接：这里备好逐条提醒（J2RecoveryNotice）和对象上的「结果未知」标记，现在传空。
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { Ban, Globe2, Replace, Unplug, History, ListOrdered, Plus, Radar, RefreshCw, ShieldMinus, Siren, Waypoints } from "lucide-react";
import { BarList, BlockState, Button, Cell, Change, Conclusion, Explain, Fact, Facts, Fold, Input, KeyValues, Notice, PageHeader, Panel, SearchSelect, Segments, Stat, StatBand, StatusTag, Table, TableMessage, Td, Th, Tr } from "@/app/components/rd";
import { businessClock, businessZone, formatBusinessTimeCompact } from "@/lib/admin/business-time";
import { displayAdminError } from "@/lib/admin/error-messages";
import { isEmergencyOutcomeUncertain, type GeoCountry, type GeoEndpoint, type GeoRecentChange } from "@/lib/admin/j-client";
import { useReach } from "@/lib/nav/use-reach";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { expiredTag, unknownTag } from "../g-tabs/g-recovery";
import { CountryDiff, CountryEditor, CountryLabel, J2RecoveryNotice, STATUS_TEXT, countryName, type EditorResult, type EditorSpec, type GeoStatus, type J2RecoveryRow } from "./j2-editor";
import type { JCtx } from "./types";

const TRIGGER_BASES = ["", "监管点名", "挤兑风险", "安全事件", "其他"];
const TRIGGER_LABELS = { "": "请选择触发依据" };
const IMMEDIATE = <StatusTag tone="progress" filled>立即生效</StatusTag>;
const REASON_HINT = "例如：监管通知编号、工单号、事件编号";
const READING = "正在读取最新状态，读完再操作";
/** 拦截分布后端只给前 20 个国家，合计也只算这 20 个（J2-口径、J2-BE-01）。 */
const HIT_LIMIT = 20;
/** 名单卡上直接摆出的国家数，其余到「名单国家明细」里看。 */
const WALL = 18;
const MODE_TEXT: Record<"derived" | "explicit", string> = { derived: "继承全局", explicit: "单独设定" };
const HEALTH: Record<string, { text: string; tone: "ok" | "warn" | "danger" }> = {
  healthy: { text: "正常", tone: "ok" },
  degraded: { text: "异常", tone: "danger" },
  stale: { text: "没有新样本", tone: "warn" },
  awaiting_samples: { text: "样本不足", tone: "warn" },
};
const healthOf = (status: string) => HEALTH[status] ?? { text: "状态不明", tone: "warn" as const };
const HEALTH_RULE = "近 5 分钟全部样本不少于 20 个、有成功记录、失败率低于 5% 才算正常。每个经过可信代理的 App 请求都给两个识别源各记一个样本。";

/** 问号里分行写：名称加一句话，一段一行。 */
const explainRows = (rows: { k: string; v: string }[]) => <>{rows.map((row) => <p key={row.k}><b>{row.k}：</b>{row.v}</p>)}</>;

function createJ2CommandKey(scope: string) {
  return `j2-${scope}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

const count = (value: number) => value.toLocaleString("en-US");

/** USDT 合计：每个值按 6 位小数转成整数再加，浮点误差不进显示；去掉补的 0，至少 2 位，不舍入（TX-19）。 */
function usdtSum(values: number[]) {
  const total = values.reduce((sum, value) => sum + BigInt(value.toFixed(6).replace(".", "")), BigInt(0));
  const negative = total < BigInt(0);
  const abs = negative ? -total : total;
  const million = BigInt(1000000);
  const whole = (abs / million).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = (abs % million).toString().padStart(6, "0").replace(/0+$/, "").padEnd(2, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

function parseAuditValue(value: string): unknown {
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    // 早期的记录可能存的是普通字符串。
    return value;
  }
}

/** 最近修改的前后值写成人话：名单译成国家名，入口规则译成继承或单独设定，识别源译成名字。 */
function auditValueText(raw: unknown, names: Record<string, string>, edgeLabels: Record<string, string>, resourceType: string) {
  if (raw === undefined || raw === "") return "—";
  const statusLabels: Record<string, string> = { blocked: "封锁", limited: "受限", allowed: "不限制" };
  if (Array.isArray(raw)) return raw.length === 0 ? "空名单" : raw.map((item) => names[String(item)] ?? String(item)).join("、");
  if (raw && typeof raw === "object") {
    const row = raw as Record<string, unknown>;
    const mode = String(row.mode ?? row.source ?? "");
    const countries = Array.isArray(row.countries) ? row.countries.map((item) => names[String(item)] ?? String(item)) : [];
    if (mode === "derived") return "继承全局";
    if (mode === "explicit") return countries.length > 0 ? `单独设定：${countries.join("、")}` : "单独设定（空）";
    return "已单独设置";
  }
  const text = String(raw);
  if (resourceType === "GEO_EDGE") return edgeLabels[text] ?? "未登记的识别源";
  return statusLabels[text] ?? edgeLabels[text] ?? names[text] ?? text;
}

function auditChange(change: GeoRecentChange, names: Record<string, string>, edgeLabels: Record<string, string>) {
  const before = parseAuditValue(change.beforeValue);
  const after = parseAuditValue(change.afterValue);
  const beforeText = auditValueText(before, names, edgeLabels, change.resourceType);
  const afterText = auditValueText(after, names, edgeLabels, change.resourceType);
  const full = `原来：${beforeText}；改后：${afterText}`;
  if (Array.isArray(before) && Array.isArray(after)) {
    const was = new Set(before.map(String));
    const now = new Set(after.map(String));
    const added = [...now].filter((cc) => !was.has(cc)).map((cc) => names[cc] ?? cc);
    const removed = [...was].filter((cc) => !now.has(cc)).map((cc) => names[cc] ?? cc);
    const parts = [added.length ? `加 ${added.join("、")}` : "", removed.length ? `去 ${removed.join("、")}` : ""].filter(Boolean);
    return { main: parts.length ? parts.join("；") : "名单没变", full };
  }
  return { main: `${beforeText} → ${afterText}`, full };
}

function auditObject(change: GeoRecentChange, endpoints: GeoEndpoint[], names: Record<string, string>) {
  if (change.resourceType === "GEO_COUNTRY_LIST") return change.resourceId === "limited" ? "受限名单" : "封锁名单";
  if (change.resourceType === "GEO_ENDPOINT") {
    const label = endpoints.find((item) => item.key === change.resourceId)?.label;
    return label ? `${label}的入口规则` : "功能入口规则";
  }
  if (change.resourceType === "GEO_EDGE") return "地区识别源";
  if (change.resourceType === "GEO_COUNTRY_BATCH") return "应急批量封锁";
  if (change.resourceType === "GEO_COUNTRY") return `${names[change.resourceId] ?? "单个国家"}（单个国家）`;
  return "地区访问限制";
}

/** 后端给的「边缘源 nexion-gateway」「12 次 / 24h」拆成识别源和次数。 */
function sourceHits(metrics: { key: string; value: string }[]) {
  const out = new Map<string, number>();
  for (const row of metrics) {
    const source = /^边缘源\s+(.+)$/.exec(row.key)?.[1];
    const hits = /^(\d+)\s*次/.exec(row.value)?.[1];
    if (source && hits) out.set(source, Number(hits));
  }
  return out;
}

export function J2GeoBlock({ ctx }: { ctx: JCtx }) {
  const { toast, openActionConfirm, actions, emergency, contentLoading, contentError } = ctx;
  const session = useAdminAuth((state) => state.session);
  const authorities = new Set(session?.authorities ?? []);
  const canCountry = authorities.has("emergency_j2_country_manage");
  const canEndpoint = authorities.has("emergency_j2_write");
  const canEdge = authorities.has("emergency_j2_edge_source_manage");
  const canEmergency = authorities.has("emergency_j2_emergency_block");
  const reach = useReach();
  const data = emergency.geoBlock;

  const [readAt, setReadAt] = useState("");
  const [editor, setEditor] = useState<EditorSpec | null>(null);
  const [lookupText, setLookupText] = useState("");
  const [lookup, setLookup] = useState("");
  const [countryQuery, setCountryQuery] = useState("");
  const [countryFilter, setCountryFilter] = useState<"all" | GeoStatus>("all");
  const [listOpen, setListOpen] = useState(false);
  useEffect(() => {
    if (data) setReadAt(businessClock(Date.now()));
  }, [data]);

  const countryNames = useMemo(() => Object.fromEntries((data?.countryOptions ?? []).map((option) => [option.value, option.label])), [data]);
  const lookupOptions = useMemo(() => {
    const q = lookupText.trim().toLocaleLowerCase();
    if (!data || !q) return [];
    const status = new Map<string, GeoStatus>([...data.blocked.map((row) => [row.cc, "blocked"] as const), ...data.limited.map((row) => [row.cc, "limited"] as const)]);
    return data.countryOptions
      .filter((option) => `${option.value} ${option.label}`.toLocaleLowerCase().includes(q))
      .slice(0, 50)
      .map((option) => ({ value: option.value, label: `${option.label}（${option.value}）`, extra: status.has(option.value) ? `现在${STATUS_TEXT[status.get(option.value)!]}` : undefined }));
  }, [data, lookupText]);

  // 结果未知的原操作。旧逻辑只在本标签页存命令号和输入指纹，不存原请求的名单和理由，拼不出逐条提醒；
  // 代码 worker 按 R1 保存原请求后在这里拼行，并把对象键（list:blocked、list:limited、endpoint:{key}、edge）放进 unknownOn。
  const recoveryRows: J2RecoveryRow[] = [];
  const unknownOn = new Set<string>();
  const recovery = <J2RecoveryNotice rows={recoveryRows} unknownTag={unknownTag("direct")} expiredTag={expiredTag("direct")} />;

  const reload = () => void actions.reloadJEmergency().catch(() => undefined);
  const readOnly = !canCountry && !canEndpoint && !canEdge && !canEmergency;

  const header = (actionsSlot?: ReactNode) => (
    <PageHeader pageId="J2" title="地区访问限制"
      summary="按来访地区限制使用：封锁整个 App，或只拦资金和奖励类操作。改动立即生效。"
      actions={actionsSlot}
      meta={<span className="rd-toolbar">
        {readAt && <span>{readAt} 读取（{businessZone().label}）<Explain label="数据时间说明" content="打开和点「刷新」时读取，不自动更新；改完会自动重读一次。" /></span>}
        {!contentError && <Button variant="ghost" size="sm" icon={<RefreshCw size={14} aria-hidden />} loading={contentLoading} onClick={reload}>刷新</Button>}
      </span>}
      readOnly={readOnly ? <>你只能查看 <Explain label="只读说明" content="改名单、改入口规则、切换识别源和应急批量封锁各要对应的权限，请联系超级管理员。" /></> : undefined}
      guideExtra={<p>这个账号：{canCountry ? "能改封锁名单和受限名单" : "不能改名单"}，{canEndpoint ? "能改入口规则" : "不能改入口规则"}，{canEdge ? "能切换识别源" : "不能切换识别源"}，{canEmergency ? "能应急批量封锁" : "不能应急批量封锁"}。</p>} />
  );

  if (contentError) {
    return <div className="j2-page">
      {header()}
      {recovery}
      <BlockState state="error" title="当前无法确认地区限制的最新状态" detail={`${contentError} 为避免误操作，控制项已隐藏。`} onRetry={reload} retrying={contentLoading} retryLabel="刷新" />
    </div>;
  }
  if (!data) {
    return <div className="j2-page">
      {header()}
      {recovery}
      <BlockState state="loading" title="地区限制加载中" detail="正在读取名单、入口规则和地区识别源" />
    </div>;
  }

  const banned: GeoCountry[] = data.blocked;
  const limited: GeoCountry[] = data.limited;
  const geoEndpoints = data.endpoints;
  const geoHits = data.hits;
  const totalHits = Number(data.stats.totalHits ?? geoHits.reduce((sum, hit) => sum + hit.ct, 0));
  const hitCapped = geoHits.length >= HIT_LIMIT;
  const hitMap = new Map(geoHits.map((hit) => [hit.cc, hit.ct]));
  const edgeSource = data.edge.source;
  const edgeSourceKnown = data.edge.sourceKnown;
  const healthStatus = data.edge.healthStatus;
  // 识别源健康 ≠ 全部入口都接上了：还有没接入的入口时不能只写「正常」（J2-C11）。
  const pendingEndpoints = geoEndpoints.filter((entry) => !entry.configurable);
  const blockedCodes = new Set(banned.map((country) => country.cc));
  const limitedCodes = new Set(limited.map((country) => country.cc));
  const statusOf = (cc: string): GeoStatus | undefined => blockedCodes.has(cc) ? "blocked" : limitedCodes.has(cc) ? "limited" : undefined;
  const emergencyCandidates = data.countryOptions.filter((option) => !blockedCodes.has(option.value));
  const limitedCandidates = data.countryOptions.filter((option) => !blockedCodes.has(option.value));
  const limitedEditDisabled = limited.length === 0 && limitedCandidates.length === 0;
  const optionOf = new Map(data.countryOptions.map((option) => [option.value, option]));
  const edgeSwitchCandidates = data.edge.sources.filter((source) => source.healthy && source.value !== edgeSource);
  const edgeSourceLabels: Record<string, string> = Object.fromEntries(data.edge.sources.map((source) => [source.value, source.label]));
  const currentEdgeLabel = edgeSourceKnown ? (edgeSourceLabels[edgeSource] ?? "已设置的识别源") : "未登记的识别源";
  const currentHealth = edgeSourceKnown ? healthOf(healthStatus) : { text: "未登记", tone: "danger" as const };
  const edgeFallbackAvailable = edgeSourceKnown && data.edge.healthy;
  const perSourceHits = sourceHits(data.edge.metrics);
  const metricOf = (key: string) => data.edge.metrics.find((row) => row.key === key)?.value;
  const closeConfirm = () => openActionConfirm(null);

  /** 加进来的这几个国家按账户国家统计的人数和余额：只是参考，不是实际会被拦的人。 */
  const impactOf = (codes: string[], lead: string) => {
    if (codes.length === 0) return undefined;
    const rows = codes.map((cc) => optionOf.get(cc)).filter((row): row is NonNullable<typeof row> => !!row);
    return <>{lead}：活跃用户 <b>{count(rows.reduce((sum, row) => sum + row.activeUsers, 0))}</b> 位，钱包余额 <b>{usdtSum(rows.map((row) => row.walletUsdt))}</b> USDT<Explain label="账户国家口径" content="按用户账户里保存的国家统计，不是来访地区，所以不等于实际会被拦的人。活跃用户只算状态正常的账户；钱包余额是这些国家全部账户的可用和提现中 USDT 之和，不含 UVT。" /></>;
  };

  const runBackend = async (task: () => Promise<void>, ok: string) => {
    try {
      await task();
    } catch (error) {
      if (isEmergencyOutcomeUncertain(error)) {
        try {
          await actions.reloadJEmergency();
          toast(`结果未知 · 页面已刷新，请核对现在的名单、规则和最近修改。${error instanceof Error ? ` ${error.message}` : ""}`, "warn");
        } catch {
          toast("结果未知，页面也刷新不了。请不要重复提交，等网络恢复后刷新页面并核对最近修改。", "warn");
        }
      } else {
        toast(`操作未完成 · ${error instanceof Error ? displayAdminError(error) : "请稍后重试"}`, "error");
      }
      throw error;
    }
    try {
      await actions.reloadJEmergency();
      toast(ok, "success");
    } catch {
      toast(`${ok}，但最新状态暂时无法读取，请刷新确认`, "warn");
    }
  };

  /** 第二步：共用确认框。提交的是整份名单，和改版前同一个请求（J2-A01、A02）。 */
  const confirmCountryList = (target: GeoStatus, picked: string[]) => {
    const commandKey = createJ2CommandKey(`country-list-${target}`);
    const current = target === "blocked" ? banned : limited;
    const currentCodes = current.map((country) => country.cc).sort();
    const countries = [...picked].map((item) => item.trim()).filter(Boolean).sort();
    const added = countries.filter((country) => !currentCodes.includes(country));
    const blockedList = target === "blocked";
    openActionConfirm({ briefKind: "config",
      action: blockedList ? "编辑全局封禁名单" : "编辑受限名单",
      title: blockedList ? "替换封锁名单" : "替换受限名单",
      effect: <>{IMMEDIATE}<StatusTag tone="neutral" icon={Replace}>整份替换</StatusTag></>,
      facts: <CountryDiff initial={currentCodes} codes={countries} names={countryNames} statusOf={statusOf}
        addTitle={blockedList ? "加进封锁名单" : "加进受限名单"}
        addEffect={blockedList ? `这些地区的用户之后的请求全部被拒：注册、登录、浏览和资金操作都不行。${added.some((cc) => limitedCodes.has(cc)) ? "原来受限的改成封锁。" : ""}` : "这些地区的用户还能登录和浏览，资金和奖励类操作（提现、兑换、下单、领奖励等）马上被拒。"}
        impact={impactOf(added, "加进来的按账户国家统计")}
        removeTitle={blockedList ? "从封锁名单去掉" : "从受限名单去掉"}
        removeEffect={blockedList ? "改回不限制（不会自动变成受限），这些地区的用户马上能正常使用；入口单独封锁的规则还在。" : "改回不限制，资金和奖励类操作马上放开；入口单独封锁的规则还在。"}
        keptTitle="名单里不变的"
        onBack={() => { closeConfirm(); openListEditor(target, { codes: countries }); }} />,
      detail: blockedList
        ? "提交的是整份封锁名单，不是只加一个。如果别人刚改过名单，或加、去的国家正被审批锁住，整份不执行，刷新后重改。"
        : "提交的是整份受限名单，不是只加一个。已封锁的国家不能直接改成受限，要先从封锁名单去掉。如果别人刚改过名单，整份不执行，刷新后重改。",
      statedBrief: { impact: `提交后名单变成 ${countries.length} 个。加进来的马上被拦，去掉的马上放开。`, check: "核对加和去的国家，理由写清依据或工单号。" },
      confirmTone: blockedList ? "danger" : "primary",
      confirmLabel: "确认替换，立即生效",
      reasonPlaceholder: REASON_HINT,
      reasonMax: 200,
      businessForm: blockedList && added.length > 0 ? {
        kind: "multi-field",
        reasonMax: 200,
        fields: [{ key: "triggerBasis", label: "触发依据", current: "", inputKind: "select", options: TRIGGER_BASES, optionLabels: TRIGGER_LABELS, wide: true, explain: "加进封锁名单时必须选；只去掉国家时不用选。" }],
      } : undefined,
      run: (reason, _newValue, businessValue) => {
        const triggerBasis = businessValue?.triggerBasis ?? "";
        if (target === "blocked" && added.length > 0 && !triggerBasis) {
          const error = new Error("新增封禁国家时，请选择触发依据");
          toast(`操作未完成 · ${error.message}`);
          throw error;
        }
        return runBackend(
          () => actions.replaceJ2CountryList(target, countries, currentCodes, triggerBasis || undefined, reason, commandKey),
          blockedList ? "封锁名单已更新" : "受限名单已更新",
        );
      },
    });
  };

  /** 第一步：选国家，随时看加了哪些、去了哪些。 */
  const openListEditor = (target: GeoStatus, draft?: EditorResult) => {
    const current = target === "blocked" ? banned : limited;
    setEditor({
      kind: target,
      title: target === "blocked" ? "编辑封锁名单" : "编辑受限名单",
      options: target === "limited" ? limitedCandidates : data.countryOptions,
      initial: current.map((country) => country.cc).sort(),
      draft,
      statusOf,
      names: countryNames,
      excludedNote: target === "limited" && banned.length > 0 ? `封锁名单里的 ${banned.length} 个不在这里：已封锁的不能直接改成受限，要先从封锁名单去掉。` : undefined,
      onNext: (result) => { setEditor(null); confirmCountryList(target, result.codes); },
    });
  };

  const confirmEndpoint = (entry: GeoEndpoint, result: EditorResult) => {
    const commandKey = createJ2CommandKey(`endpoint-${entry.key}`);
    const mode = result.mode === "explicit" ? "explicit" : "derived";
    const countries = mode === "explicit" ? result.codes.map((item) => item.trim()).filter(Boolean).sort() : [];
    const expectedMode = entry.source === "explicit" ? "explicit" : "derived";
    const expectedCountries = [...entry.countries].sort();
    openActionConfirm({ briefKind: "config",
      action: `调整功能入口封锁范围 · ${entry.label}`,
      title: "修改入口规则",
      effect: IMMEDIATE,
      facts: <div className="rd-stack">
        <Facts>
          <Fact k="功能入口">{entry.label}{entry.biz && <span className="j2-muted">（{entry.biz}）</span>}</Fact>
          <Fact k="设置方式">{mode === expectedMode ? MODE_TEXT[mode] : <Change from={MODE_TEXT[expectedMode]} to={MODE_TEXT[mode]} />}</Fact>
        </Facts>
        <CountryDiff initial={expectedCountries} codes={countries} names={countryNames} statusOf={statusOf}
          addTitle="这个入口另外封锁" addEffect="这些地区的用户不能用这个入口，浏览也不行。封锁名单照样先判断。"
          removeTitle="不再单独封锁" removeEffect="这个入口改回只按全局名单处理：封锁的照样不能用，受限的照样不能做资金和奖励类操作。"
          keptTitle="继续单独封锁的"
          onBack={() => { closeConfirm(); openEndpointEditor(entry, { codes: countries, mode }); }} />
      </div>,
      detail: "单独设定只是在全局名单之外再加限制，不能给封锁名单里的国家开口子。如果别人刚改过这个入口，本次不执行，刷新后重改。",
      statedBrief: { impact: "之后这个入口的请求按新规则判断，已经拦下的记录不变。", check: "核对入口和加、去的国家，理由写清依据或工单号。" },
      confirmLabel: "确认修改，立即生效",
      reasonPlaceholder: REASON_HINT,
      reasonMax: 200,
      run: (reason) => {
        if (mode === "explicit" && countries.length === 0) {
          const error = new Error("单独设定时，请至少选择一个国家或地区");
          toast(`操作未完成 · ${error.message}`);
          throw error;
        }
        if (mode === expectedMode && countries.join(",") === expectedCountries.join(",")) {
          const error = new Error("封锁范围没有发生变化，本次未提交");
          toast(`操作未完成 · ${error.message}`);
          throw error;
        }
        return runBackend(() => actions.updateJ2Endpoint(entry.key, mode, countries, expectedMode, expectedCountries, reason, commandKey), `${entry.label}的封锁范围已生效`);
      },
    });
  };

  const openEndpointEditor = (entry: GeoEndpoint, draft?: EditorResult) => {
    setEditor({
      kind: "endpoint",
      title: "编辑入口规则",
      subject: <Facts><Fact k="功能入口">{entry.label}{entry.biz && <span className="j2-muted">（{entry.biz}）</span>}</Fact></Facts>,
      options: data.countryOptions,
      initial: [...entry.countries].sort(),
      initialMode: entry.source === "explicit" ? "explicit" : "derived",
      draft,
      statusOf,
      names: countryNames,
      onNext: (result) => { setEditor(null); confirmEndpoint(entry, result); },
    });
  };

  const switchJudge = (target?: string) => {
    const commandKey = createJ2CommandKey("edge-source");
    return openActionConfirm({ briefKind: "config",
      action: "切换地区识别来源",
      title: "切换地区识别源",
      effect: IMMEDIATE,
      facts: <Facts>
        <Fact k="切换后 5 分钟" tone={edgeFallbackAvailable ? undefined : "warn"}>{edgeFallbackAvailable ? "新源给不出国家时，先用现在这个源兜底" : "现在这个源不健康，没有兜底：新源给不出国家的请求会被拒"}</Fact>
        <Fact k="正在用 App 的用户">不会被踢下线；之后的每个请求按新源给的国家判断</Fact>
      </Facts>,
      detail: "只能切到近 5 分钟样本不少于 20 个、失败率低于 5% 的识别源。兜底只在新源给不出国家时用，不会自动切回原来的源。",
      statedBrief: { impact: "之后的请求改按新识别源判断地区，已经记下的拦截不变。", check: "核对新识别源的健康状况，理由写清依据或工单号。" },
      confirmLabel: "确认切换，立即生效",
      reasonPlaceholder: REASON_HINT,
      edit: { kind: "select", label: "切换到", current: edgeSource, initialValue: target ?? edgeSwitchCandidates[0]?.value ?? "", options: edgeSwitchCandidates.map((source) => source.value), optionLabels: { ...edgeSourceLabels, [edgeSource]: currentEdgeLabel } },
      run: (reason, newValue) => runBackend(
        () => actions.updateJ2EdgeJudge(newValue ?? "", edgeSource, reason, commandKey),
        "地区识别源已切换",
      ),
    });
  };

  const confirmEmergency = (codes: string[]) => {
    const commandKey = createJ2CommandKey("emergency-block");
    openActionConfirm({ briefKind: "config",
      action: "应急即时封锁 · 批量加入全局封禁名单",
      title: "应急批量封锁",
      effect: <>{IMMEDIATE}<StatusTag tone="neutral" icon={Plus}>只加不减</StatusTag></>,
      facts: <div className="rd-stack">
        <Facts>
          <Fact k="加进封锁名单" lead unit="个">{count(codes.length)}</Fact>
          <Fact k="现有封锁">{count(banned.length)} 个，不变</Fact>
          <Fact k="怎么撤销">没有一键撤销。要放开，到「封锁名单」点「编辑封锁名单」把它们去掉</Fact>
        </Facts>
        <CountryDiff initial={[]} codes={codes} names={countryNames} statusOf={statusOf}
          addTitle="这次封锁" addEffect={`这些地区的用户之后的请求全部被拒：注册、登录、浏览和资金操作都不行。${codes.some((cc) => limitedCodes.has(cc)) ? "原来受限的改成封锁。" : ""}`}
          impact={impactOf(codes, "按账户国家统计")}
          onBack={() => { closeConfirm(); openEmergencyEditor({ codes }); }} />
      </div>,
      detail: "所有国家先统一检查：有一个已经封锁或正被审批锁住，整批都不执行，不会只成功一部分。",
      statedBrief: { impact: `${codes.length} 个国家或地区马上加进封锁名单，原有的封锁不变。`, check: "核对国家和触发依据，理由写清监管通知、工单或事件编号。" },
      confirmTone: "danger",
      confirmLabel: `确认封锁 ${codes.length} 个，立即生效`,
      reasonPlaceholder: REASON_HINT,
      reasonMax: 200,
      businessForm: {
        kind: "multi-field",
        reasonMax: 200,
        fields: [{ key: "triggerBasis", label: "触发依据", current: "", inputKind: "select", options: TRIGGER_BASES, optionLabels: TRIGGER_LABELS, wide: true }],
      },
      run: (reason, _newValue, businessValue) => {
        const countries = codes.map((item) => item.trim()).filter(Boolean);
        const triggerBasis = businessValue?.triggerBasis ?? "";
        return runBackend(() => actions.emergencyBlockJ2(countries, triggerBasis, reason, commandKey), "应急封锁已全部生效");
      },
    });
  };

  const openEmergencyEditor = (draft?: EditorResult) => {
    setEditor({
      kind: "emergency",
      title: "应急批量封锁",
      options: emergencyCandidates,
      initial: [],
      existingCount: banned.length,
      draft,
      statusOf,
      names: countryNames,
      excludedNote: banned.length > 0 ? `已经封锁的 ${banned.length} 个不在这里。` : undefined,
      onNext: (result) => { setEditor(null); confirmEmergency(result.codes); },
    });
  };

  const openList = (status: GeoStatus) => {
    setCountryFilter(status);
    setListOpen(true);
    window.requestAnimationFrame(() => document.getElementById("j2-countries")?.scrollIntoView({ block: "start" }));
  };

  // ---------- 结论 ----------
  const counts = <>封锁 <b>{count(banned.length)}</b> 个、受限 <b>{count(limited.length)}</b> 个国家或地区</>;
  const sourceBroken = !edgeSourceKnown || healthStatus === "degraded";
  const switchHint = canEdge
    ? edgeSwitchCandidates.length > 0 ? "到下面「地区识别」切到健康的识别源。" : "现在没有健康的备用识别源可切，请联系技术值班。"
    : "请有权限的超级管理员到「地区识别」处理。";
  const conclusion = !edgeSourceKnown ? (
    <Conclusion state="danger" hint={switchHint} explainTitle="识别源没登记会怎样" explain="现在设置的识别源不在登记表里，App 请求拿不到地区，会被拒绝（提示无法确认地区）。">地区识别不可用：现在设置的识别源没有登记；{counts}</Conclusion>
  ) : healthStatus === "degraded" ? (
    <Conclusion state="danger" hint={switchHint} explainTitle="识别源异常会怎样" explain={`当前识别源给不出国家时，App 请求会被拒绝（提示无法确认地区），这类拒绝不算进拦截次数。${HEALTH_RULE}`}>识别源「{currentEdgeLabel}」异常，近 5 分钟识别失败太多；{counts}</Conclusion>
  ) : recoveryRows.length > 0 ? (
    <Conclusion state="warn" hint="到上方逐条查询原结果。">{recoveryRows.length} 项修改结果未知；{counts}</Conclusion>
  ) : healthStatus === "stale" ? (
    <Conclusion state="warn" explainTitle="没有新样本是什么意思" explain={`近 5 分钟没有经过可信代理的 App 请求，识别源健康不健康判断不了。${HEALTH_RULE}`}>{counts}；识别源「{currentEdgeLabel}」近 5 分钟没有新样本，健康状况判断不了</Conclusion>
  ) : healthStatus !== "healthy" ? (
    <Conclusion state="unknown" explainTitle="样本不足是什么意思" explain={`近 5 分钟经过可信代理的 App 请求不到 20 个，识别源健康不健康暂时判断不了。${HEALTH_RULE}`}>{counts}；识别源「{currentEdgeLabel}」样本不足，健康状况暂时判断不了</Conclusion>
  ) : pendingEndpoints.length > 0 || geoEndpoints.length === 0 ? (
    <Conclusion state="neutral" explainTitle="没接入的入口怎么管" explain="没接入的入口不能单独设规则，单独规则也不会生效；封锁名单和受限名单照常管它们。">{counts}；识别源正常，{geoEndpoints.length === 0 ? "还没有登记功能入口" : `${count(pendingEndpoints.length)} 个功能入口还没接入单独规则`}</Conclusion>
  ) : (
    <Conclusion state="ok">{counts}；识别源正常，功能入口都已接入</Conclusion>
  );

  // ---------- 名单卡 ----------
  const listCard = (status: GeoStatus) => {
    const rows = status === "blocked" ? banned : limited;
    const sorted = [...rows].sort((a, b) => (hitMap.get(b.cc) ?? 0) - (hitMap.get(a.cc) ?? 0) || a.cc.localeCompare(b.cc));
    const blockedList = status === "blocked";
    const action = blockedList
      ? canCountry && <Button disabledReason={contentLoading ? READING : undefined} onClick={() => openListEditor("blocked")}>编辑封锁名单</Button>
      : canCountry && <Button disabledReason={contentLoading ? READING : limitedEditDisabled ? "没有可以加进受限名单的国家：其他国家都已封锁，先从封锁名单去掉" : undefined} onClick={() => openListEditor("limited")}>编辑受限名单</Button>;
    return (
      <Panel title={blockedList ? "封锁名单" : "受限名单"} icon={blockedList ? Ban : ShieldMinus} tone="role-4"
        sub={`${count(rows.length)} 个国家或地区`}
        explain={explainRows(blockedList ? [
          { k: "管什么", v: "名单里的国家或地区，App 的请求全部被拒：注册、登录、浏览、资金操作都不行。" },
          { k: "按什么判断", v: "来访请求的国家（可信边缘代理在请求头里给的），不是账户注册地。" },
          { k: "不管什么", v: "后台、代看、支付回调等不经过这条规则；已登录的会话不会被踢下线，但之后的请求会被拒。" },
          { k: "和入口规则", v: "去掉封锁不会清掉入口单独封锁的规则。" },
        ] : [
          { k: "管什么", v: "名单里的国家或地区，用户能登录和浏览；资金和奖励类操作（提现、兑换、充值、下单、领奖励等）被拒。" },
          { k: "和封锁名单", v: "已封锁的国家不能直接改成受限，要先从封锁名单去掉；要更严，可以在封锁名单里直接加上它。" },
          { k: "和入口规则", v: "去掉受限不会清掉入口单独封锁的规则。" },
        ])}
        actions={<>{unknownOn.has(`list:${status}`) && unknownTag("direct")}{action}</>}>
        <p className="j2-scope">{blockedList ? <><Ban size={14} aria-hidden />整个 App 不能用</> : <><ShieldMinus size={14} aria-hidden />能登录浏览，资金和奖励类操作被拒</>}</p>
        {rows.length === 0
          ? <p className="j2-empty">{blockedList ? "没有封锁的国家或地区" : "没有受限的国家或地区"}</p>
          : <ul className="j2-wall" aria-label={blockedList ? "封锁的国家或地区" : "受限的国家或地区"}>
            {sorted.slice(0, WALL).map((row) => (
              <li key={row.cc} className="j2-cc">
                <CountryLabel cc={row.cc} names={countryNames} />
                {(hitMap.get(row.cc) ?? 0) > 0 && <span className="j2-cc-hits">{count(hitMap.get(row.cc)!)} 次</span>}
              </li>
            ))}
            {rows.length > WALL && <li><button type="button" className="rd-link j2-linkbtn" onClick={() => openList(status)}>还有 {count(rows.length - WALL)} 个</button></li>}
          </ul>}
        {rows.length > 0 && (
          <div className="j2-impact">
            <span>{impactOf(rows.map((row) => row.cc), "按账户国家")}</span>
            <button type="button" className="rd-link j2-linkbtn" onClick={() => openList(status)}>看明细</button>
          </div>
        )}
      </Panel>
    );
  };

  // ---------- 入口规则 ----------
  const lookupStatus = lookup ? statusOf(lookup) : undefined;
  const verdict = (entry: GeoEndpoint) => {
    if (lookupStatus === "blocked") return <StatusTag tone="danger" icon={Ban} explain="在封锁名单里：整个 App 不能用。">不能用</StatusTag>;
    if (entry.source === "explicit" && entry.configurable && entry.countries.includes(lookup)) return <StatusTag tone="danger" icon={Ban} explain="这个入口单独封锁了它，浏览也不行。">这个入口不能用</StatusTag>;
    if (lookupStatus === "limited") return <StatusTag tone="warn" icon={ShieldMinus} explain="在受限名单里：能浏览，资金和奖励类操作被拒。这个入口是不是资金类，以后端登记的路由为准。">资金和奖励类被拒</StatusTag>;
    return <StatusTag tone="ok">能用</StatusTag>;
  };
  const endpointPanel = (
    <Panel id="j2-endpoints" title="功能入口规则" icon={Waypoints} tone="role-4" flush
      sub={`${count(geoEndpoints.length)} 个入口`}
      explain={explainRows([
        { k: "两层怎么合起来", v: "一个请求先看封锁名单，再看这个入口有没有单独封锁，最后看受限名单；先命中哪条就按哪条处理。" },
        { k: "继承全局", v: "这个入口只按封锁名单和受限名单处理。" },
        { k: "单独设定", v: "在全局名单之外再封锁选中的国家，这个入口对它们整个不能用；不能给封锁名单里的国家开口子。" },
        { k: "还没接入", v: "后端还没把这个入口接上，单独规则设不了也不会生效；全局名单照常管。" },
        { k: "不在这里的", v: "地区规则只管经过地区过滤的 App 请求；后台、代看、支付回调等不受影响。" },
      ])}
      actions={unknownOn.size > 0 && [...unknownOn].some((key) => key.startsWith("endpoint:")) ? unknownTag("direct") : undefined}>
      <div className="j2-endpoints-top">
        <ol className="j2-order" aria-label="一个请求按什么顺序判断">
          <li><span className="j2-order-n">1</span><span className="j2-order-if">在封锁名单</span><span className="j2-order-then" data-tone="danger"><Ban size={14} aria-hidden />整个 App 不能用</span></li>
          <li><span className="j2-order-n">2</span><span className="j2-order-if">被这个入口单独封锁</span><span className="j2-order-then" data-tone="danger"><Ban size={14} aria-hidden />这个入口不能用</span></li>
          <li><span className="j2-order-n">3</span><span className="j2-order-if">在受限名单</span><span className="j2-order-then" data-tone="warn"><ShieldMinus size={14} aria-hidden />资金和奖励类操作被拒</span></li>
          <li><span className="j2-order-n">4</span><span className="j2-order-if">都不是</span><span className="j2-order-then" data-tone="ok">能用</span></li>
        </ol>
        {geoEndpoints.length > 0 && (
          <div className="j2-lookup">
            <label className="j2-lookup-label" htmlFor="j2-lookup">看一个国家</label>
            <div className="j2-lookup-box">
              <SearchSelect id="j2-lookup" aria-label="看一个国家在各入口能不能用" placeholder="输入国家代码或名称" value={lookupText}
                onChange={(value) => { setLookupText(value); if (!value) setLookup(""); }}
                options={lookupOptions} selected={lookup || undefined} empty={lookupText.trim() ? "没有匹配的国家或地区" : "输入代码或名称"}
                onSelect={(value) => { setLookup(value); setLookupText(countryName(value, countryNames)); }} />
            </div>
            {lookup && <Button size="sm" variant="ghost" onClick={() => { setLookup(""); setLookupText(""); }}>清除</Button>}
          </div>
        )}
      </div>
      {geoEndpoints.length === 0
        ? <div className="j2-endpoints-empty"><BlockState state="empty" compact title="还没有登记功能入口" detail="单独规则暂时设不了；封锁名单和受限名单照常生效。" /></div>
        : <Table label="功能入口规则" className="j2-endpoint-table" data-lookup={lookup ? "" : undefined}>
          <thead><tr>
            <Th>功能入口</Th><Th>设置方式</Th><Th>单独封锁的国家</Th>
            {lookup && <Th>{countryName(lookup, countryNames)}</Th>}
            <Th align="right">近 24 小时拦截</Th><Th align="right">操作</Th>
          </tr></thead>
          <tbody>
            {geoEndpoints.map((entry) => (
              <Tr key={entry.key}>
                <Td><Cell main={<>{entry.label}{unknownOn.has(`endpoint:${entry.key}`) && <> {unknownTag("direct")}</>}</>} sub={entry.biz || undefined} /></Td>
                <Td>{!entry.configurable
                  ? <StatusTag tone="neutral" icon={Unplug} explain="后端还没把这个入口接上，单独规则设不了也不会生效；封锁名单和受限名单照常管它。">还没接入</StatusTag>
                  : <span className="j2-mode" data-mode={entry.source}>{entry.sourceLabel || MODE_TEXT[entry.source === "explicit" ? "explicit" : "derived"]}</span>}</Td>
                <Td>{entry.countries.length === 0
                  ? <span className="j2-muted">{entry.source === "derived" ? "没有，跟随全局" : "—"}</span>
                  : <span className="j2-entry-cc" title={entry.countries.map((cc) => countryName(cc, countryNames)).join("、")}>
                    {entry.countries.slice(0, 3).map((cc) => <span key={cc} className="j2-cc" data-small=""><CountryLabel cc={cc} names={countryNames} /></span>)}
                    {entry.countries.length > 3 && <span className="j2-more">+{entry.countries.length - 3}</span>}
                  </span>}</Td>
                {lookup && <Td>{verdict(entry)}</Td>}
                <Td align="right">{!entry.configurable ? <span className="j2-muted">—</span> : <span className="j2-num" data-zero={entry.hits === 0 ? "" : undefined}>{count(entry.hits)}</span>}</Td>
                <Td align="right" data-fit="">{canEndpoint && entry.configurable
                  ? <Button size="sm" disabledReason={contentLoading ? READING : undefined} onClick={() => openEndpointEditor(entry)}>编辑规则</Button>
                  : entry.configurable ? <span className="j2-muted">无编辑权限</span> : <span className="j2-muted">—</span>}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>}
    </Panel>
  );

  // ---------- 地区识别 ----------
  const p95 = metricOf("请求头判定延迟 P95");
  const failRate = metricOf("地区解析失败率");
  const unknownSourceHits = [...perSourceHits].filter(([key]) => !edgeSourceLabels[key]);
  const edgePanel = (
    <Panel id="j2-edge" title="地区识别" icon={Radar} tone="role-other" sub={`现在用 ${currentEdgeLabel}`}
      explain={explainRows([
        { k: "怎么识别", v: "按可信边缘代理在请求头里给的国家判断，后台不自己查 IP，也不信用户自报的地区。" },
        { k: "识别不出时", v: "当前识别源给不出国家或给的不对，App 请求被拒绝（提示无法确认地区），这类拒绝不算进拦截次数。" },
        { k: "健康怎么算", v: HEALTH_RULE },
        { k: "风险提示书", v: "风险提示书另有一套地区判断（登录用户按账户保存的国家，未登录按查询的国家），和这里互不影响。" },
      ])}
      actions={unknownOn.has("edge") ? unknownTag("direct") : undefined}>
      {!edgeSourceKnown && <Notice tone="danger" title="现在设置的识别源没有登记">App 请求拿不到地区，会被拒绝。{canEdge ? "在下面切到一个健康的识别源。" : "请有权限的超级管理员处理。"}</Notice>}
      <div className="j2-sources">
        {data.edge.sources.map((source) => {
          const current = edgeSourceKnown && source.value === edgeSource;
          const health = current ? currentHealth : healthOf(source.healthStatus);
          const hits = perSourceHits.get(source.value);
          return (
            <section key={source.value} className="j2-source" data-current={current ? "" : undefined} aria-label={source.label}>
              <div className="j2-source-head">
                <span className="j2-source-name">{source.label}</span>
                {current ? <StatusTag tone="progress" filled>正在使用</StatusTag> : <span className="j2-muted">备用</span>}
              </div>
              <div className="j2-source-health">
                <StatusTag tone={health.tone}>{health.text}</StatusTag>
                <span className="j2-muted">近 5 分钟样本 {count(source.sampleCount)} 个</span>
              </div>
              <KeyValues rows={[
                ...(current ? [
                  { key: "p95", label: "识别耗时 P95", value: p95 ?? "—" },
                  { key: "fail", label: "识别失败率", value: failRate ?? "—" },
                ] : []),
                { key: "hits", label: "近 24 小时拦截", value: hits === undefined ? "0 次" : `${count(hits)} 次` },
              ]} />
              {!current && canEdge && (
                <div className="j2-source-foot">
                  <Button size="sm" disabledReason={contentLoading ? READING : !source.healthy ? `${health.text}：${HEALTH_RULE}` : undefined} onClick={() => switchJudge(source.value)}>切换到这个源</Button>
                </div>
              )}
            </section>
          );
        })}
      </div>
      {unknownSourceHits.length > 0 && <p className="j2-note">识别源不明的拦截（近 24 小时）：{unknownSourceHits.map(([key, value]) => `${key} ${count(value)} 次`).join("，")}</p>}
    </Panel>
  );

  // ---------- 第二层：名单明细、拦截记录、最近修改 ----------
  const policyRows = data.countries.filter((row) => countryFilter === "all" || row.status === countryFilter)
    .filter((row) => {
      const q = countryQuery.trim().toLocaleLowerCase();
      return !q || `${row.cc} ${countryNames[row.cc] ?? row.name}`.toLocaleLowerCase().includes(q);
    });
  const hitText = (cc: string) => hitMap.has(cc) ? count(hitMap.get(cc)!) : hitCapped ? "—" : "0";
  const countriesFold = (
    <div id="j2-countries">
      <Fold title="名单国家明细" icon={Globe2} tone="role-other"
        summary={`封锁 ${count(banned.length)} 个 · 受限 ${count(limited.length)} 个`}
        explain="每个国家的理由、最近谁改的、按账户国家统计的人数和余额。近 24 小时拦截只给前 20 个国家，不在前 20 的写「—」。"
        open={listOpen} onOpenChange={setListOpen}>
        {data.countries.length === 0
          ? <BlockState state="empty" compact title="名单都是空的" detail="没有封锁或受限的国家或地区。" />
          : <>
            <div className="j2-filter">
              <Segments label="按状态看" value={countryFilter} onChange={setCountryFilter} items={[
                { value: "all", label: "全部", count: data.countries.length },
                { value: "blocked", label: "封锁", count: banned.length },
                { value: "limited", label: "受限", count: limited.length },
              ]} />
              <Input type="search" className="j2-filter-search" aria-label="在名单里找国家代码或名称" placeholder="找国家代码或名称" value={countryQuery} onChange={(event) => setCountryQuery(event.target.value)} />
            </div>
            <Table label="名单国家明细" className="j2-country-table">
              <thead><tr><Th>国家或地区</Th><Th>状态</Th><Th align="right">近 24 小时拦截</Th><Th align="right">按账户国家</Th><Th>最近改动</Th><Th>理由</Th></tr></thead>
              <tbody>
                {policyRows.length === 0
                  ? <TableMessage columns={6}>没有找到「{countryQuery.trim()}」</TableMessage>
                  : policyRows.map((row) => (
                    <Tr key={row.cc}>
                      <Td><CountryLabel cc={row.cc} names={countryNames} /></Td>
                      <Td>{row.status === "blocked" ? <StatusTag tone="neutral" icon={Ban}>封锁</StatusTag> : <StatusTag tone="neutral" icon={ShieldMinus}>受限</StatusTag>}</Td>
                      <Td align="right"><span className="j2-num" data-zero={hitText(row.cc) === "0" || hitText(row.cc) === "—" ? "" : undefined}>{hitText(row.cc)}</span></Td>
                      <Td align="right"><Cell num main={`${count(row.activeUsers)} 位`} sub={`${usdtSum([row.walletUsdt])} USDT`} /></Td>
                      <Td><Cell num main={row.updatedAt ? formatBusinessTimeCompact(row.updatedAt) : "—"} sub={row.operator || undefined} /></Td>
                      <Td grow><Cell main={row.reason || "—"} title={row.reason || undefined} /></Td>
                    </Tr>
                  ))}
              </tbody>
            </Table>
            <p className="j2-note">时间为{businessZone().label}</p>
          </>}
      </Fold>
    </div>
  );

  const topHit = geoHits[0];
  const endpointHits = geoEndpoints.filter((entry) => entry.configurable && entry.hits > 0).sort((a, b) => b.hits - a.hits);
  const hitsFold = (
    <Fold title="拦截记录" icon={ListOrdered} tone="role-other"
      summary={geoHits.length === 0 ? "近 24 小时没有拦截" : `近 24 小时 · 前 20 个国家合计 ${count(totalHits)} 次 · 最多 ${countryNames[topHit.cc] ?? topHit.nm} ${count(topHit.ct)} 次`}
      explain="滚动 24 小时，不是自然日。只算识别出国家、又被名单或入口规则拒绝的请求；识别不出地区被拒的不算。按国家最多列 20 个，合计也只算这 20 个，所以可能比真实总数少。">
      {geoHits.length === 0
        ? <BlockState state="empty" compact title="近 24 小时没有拦截" detail="名单和入口规则都没有拦下请求。" />
        : <div className="j2-hits">
          <section aria-label="按国家或地区">
            <h3 className="j2-sub-title">按国家或地区{hitCapped && <span className="j2-muted"> · 只列前 20 个</span>}</h3>
            <BarList label="近 24 小时拦截最多的国家或地区" slot={2} rows={geoHits.map((hit) => ({ key: hit.cc, label: <CountryLabel cc={hit.cc} names={{ ...countryNames, [hit.cc]: countryNames[hit.cc] ?? hit.nm }} />, value: hit.ct, text: `${count(hit.ct)} 次` }))} />
          </section>
          <section aria-label="按功能入口">
            <h3 className="j2-sub-title">按功能入口</h3>
            {endpointHits.length === 0
              ? <p className="j2-muted">各入口都没有拦截，拦下的都是全局名单。</p>
              : <BarList label="近 24 小时各功能入口的拦截" slot={2} rows={endpointHits.map((entry) => ({ key: entry.key, label: entry.label, value: entry.hits, text: `${count(entry.hits)} 次` }))} />}
          </section>
        </div>}
    </Fold>
  );

  const latest = data.recentChanges[0];
  const changesFold = (
    <Fold title="最近修改" icon={History} tone="role-other"
      summary={latest ? `最近 ${count(data.recentChanges.length)} 条 · 最新 ${formatBusinessTimeCompact(latest.createdAt, "—")} ${latest.operator || ""}`.trim() : "还没有修改记录"}
      explain="只列最近 8 条成功的修改，被拒的不列；每条记下操作人、理由和修改前后的内容，不能改。完整记录在「操作记录与审批」。"
      actions={reach("/platform/audit", "platform_a2_read") ? <Link className="rd-link" href="/platform/audit?domain=J" prefetch={false}>查看操作记录与审批</Link> : undefined}>
      {data.recentChanges.length === 0
        ? <BlockState state="empty" compact title="还没有修改记录" detail="名单、入口规则、识别源改过之后在这里列出。" />
        : <>
          <Table label="最近修改" className="j2-change-table">
            <thead><tr><Th>时间</Th><Th>操作人</Th><Th>改了什么</Th><Th>改动</Th><Th>理由</Th></tr></thead>
            <tbody>
              {data.recentChanges.map((change, index) => {
                const diff = auditChange(change, countryNames, edgeSourceLabels);
                return (
                  <Tr key={`${change.createdAt}-${change.resourceId}-${index}`}>
                    <Td><Cell num main={formatBusinessTimeCompact(change.createdAt, "—")} /></Td>
                    <Td>{change.operator || "—"}</Td>
                    <Td>{auditObject(change, geoEndpoints, countryNames)}</Td>
                    <Td><Cell main={diff.main} title={diff.full} /></Td>
                    <Td><Cell main={change.reason || "—"} title={change.reason || undefined} /></Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
          <p className="j2-note">时间为{businessZone().label}</p>
        </>}
    </Fold>
  );

  const emergencyAction = canEmergency && (
    <span data-pair="">
      <Button variant="danger-outline" icon={<Siren size={14} aria-hidden />}
        disabledReason={contentLoading ? READING : emergencyCandidates.length === 0 ? "所有国家和地区都已封锁，没有可以加封的" : undefined}
        onClick={() => openEmergencyEditor()}>应急批量封锁</Button>
      <Explain label="应急批量封锁说明" content="遇监管点名、制裁名单更新或安全事件时，一次把多个国家或地区加进封锁名单，立即生效。只加不减；要撤销，到「封锁名单」点「编辑封锁名单」把它们去掉。" />
    </span>
  );

  return (
    <div className="j2-page">
      {header(emergencyAction || undefined)}
      {recovery}
      {conclusion}
      <StatBand label="地区限制摘要">
        <Stat icon={Ban} tone="role-4" label="封锁的国家或地区" value={count(banned.length)} unit="个" explain="整个 App 不能用。" />
        <Stat icon={ShieldMinus} tone="role-4" label="受限的国家或地区" value={count(limited.length)} unit="个" explain="能登录浏览，资金和奖励类操作被拒。" />
        <Stat icon={ListOrdered} tone="role-other" label="近 24 小时拦截" value={count(totalHits)} unit="次" sub="前 20 个国家合计"
          explain="滚动 24 小时，不是自然日；只算识别出国家又被拒绝的请求，按国家最多算前 20 个，可能比真实总数少。" />
        <Stat icon={Radar} tone={sourceBroken ? "danger" : currentHealth.tone === "ok" ? "role-other" : "warn"} label="地区识别" value={currentHealth.text} sub={currentEdgeLabel}
          explain={HEALTH_RULE} onOpen={() => document.getElementById("j2-edge")?.scrollIntoView({ block: "start" })} openLabel={`地区识别：${currentEdgeLabel}，${currentHealth.text}，查看识别源`} />
      </StatBand>
      <div className="rd-split" data-even="">
        {listCard("blocked")}
        {listCard("limited")}
      </div>
      {endpointPanel}
      {edgePanel}
      {countriesFold}
      {hitsFold}
      {changesFold}
      {editor && <CountryEditor spec={editor} onClose={() => setEditor(null)} />}
    </div>
  );
}

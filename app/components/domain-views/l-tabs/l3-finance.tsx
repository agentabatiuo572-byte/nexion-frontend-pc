"use client";

/**
 * L3 · 财务报表（改版，rd）。
 * 一句结论 → 四个数按「进了多少、出了多少、付不付得起、接下来要付多少」排 → 本期收入构成 | 本期提现
 * → 兑付覆盖率 | 九类应付款 → 接下来要付多少（未来 7/30 天按类别、30 天分四段）。
 * 读取、校验、两种导出的请求体和命令号沿用改版前的写法（请求逐字节不变），这里只换界面。
 * 周期只管收入和提现，注册业务月只管提现；储备、应付款、覆盖率和到期是读取那一刻的数，不随周期变。
 */
import { useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowDownToLine, ArrowUpFromLine, CalendarClock, FileSpreadsheet, Gauge, LockKeyhole, ReceiptText, RefreshCw, ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react";
import {
  BlockState, Button, Conclusion, Explain, Fact, Facts, FilterBar, FilterField, Input, KeyValues, Notice, PageHeader, Panel,
  Segments, Stat, StatBand, StatusTag, ThresholdMeter, TrendLines, type ChartSlot,
} from "@/app/components/rd";
import { isLOutcomeUnknownError } from "@/lib/admin/l-client";
import { LIABILITY_EXPLANATIONS, liabilityDisplayName } from "@/lib/admin/liability-labels";
import { amountDigits, amountText } from "@/lib/admin/treasury-amount";
import { TREASURY_VALUATION_UNAVAILABLE } from "@/lib/admin/treasury-valuation";
import { coverDaysText } from "@/lib/admin/treasury-cover-days";
import { businessZone, formatBusinessTimeCompact } from "@/lib/admin/business-time";
import { findByPath } from "@/lib/nav/console-nav";
import { useReach } from "@/lib/nav/use-reach";
import { num, rec, rows, str, strings } from "./live-data";
import { readL3FinanceSnapshot, readL3LiveFacts } from "./l3-live-data";
import { cents, count, DueBars, LiabilityBars, MaturityGroups, pctText, RedemptionFigures, RevenueFigure, usdt, type LiabilityRow, type MaturityPart, type Redemption, type RevenueStream } from "./l3-finance-views";
import type { LCtx } from "./types";

const FINANCE_DETAIL_FIELDS = [
  "交易时间",
  "用户编码（脱敏）",
  "业务编号",
  "账单类型",
  "资产",
  "方向",
  "金额",
  "余额",
  "状态",
] as const;

const EXPORT_PAGE = "/analytics/export";
const WITHDRAW_PAGE = "/finance/withdrawals";
const TREASURY_PAGE = "/finance/pool";
const OVERVIEW_PAGE = "/overview/dual-ledger";

function currentMonthRange() {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();
  const pad = (value: number) => String(value).padStart(2, "0");
  return {
    from: `${year}-${pad(month + 1)}-01`,
    to: `${year}-${pad(month + 1)}-${pad(new Date(year, month + 1, 0).getDate())}`,
  };
}

/** 后端给的九类名称是内部写法；按类别换成资金储备与应付款、资金与应付款总览用的名字，三页同名。 */
const LIABILITY_CATEGORY: Record<string, string> = {
  "可提余额": "withdrawable_balance",
  "USDT staking 本金": "usdt_staking_principal",
  "staking 应付利息": "staking_interest",
  "Genesis 排放承诺": "genesis_daily_emission",
  "UVT v2 未来兑付": "nex_v2_future",
  "待提现 queue": "withdrawal_queue",
  "佣金冷却未解锁": "commission_cooling",
  "锁仓本息其他": "lock_other",
  "待核实入金": "unverified_deposit",
};

/** 四类收入各是什么（后端事实），名字照后端，只把「设备销售 GMV」写成中文。 */
const REVENUE_TEXT: Record<string, { name?: string; explain: string }> = {
  device_sales: { name: "设备销售成交额", explain: "已付款并且已完成的设备订单金额，按付款时间算；退款后不再是完成状态的不算。是成交额，不是利润。" },
  team_commission: { explain: "团队奖励账本里本期记的金额，含还没结算的，不分资产和方向。不能当平台净收入。" },
  token_economy: { explain: "本期完成的代币兑换里 USDT 那一边的成交量，不是利润。" },
  compute_matching: { explain: "算力撮合服务费、算力服务费、任务服务费三类已入账的金额。" },
};
const REVENUE_SLOTS: readonly ChartSlot[] = [1, 2, 3, 4];

const MATURITY_PARTS: readonly MaturityPart[] = [
  { key: "withdraw", name: "提现", slot: 2 },
  { key: "interest", name: "质押奖励利息", slot: 3 },
  { key: "genesis", name: "创世节点收益", slot: 1 },
];
const MATURITY_EXPLAIN: Record<string, ReactNode> = {
  withdraw: "进行中的 USDT 提现按冷却到期日排，已经过了到期日还没处理的算在今天。",
  interest: "质押仓位的预计利息，不含本金。到期一次给的算在到期那天，按日给的摊到每天。",
  genesis: "合格创世节点持仓每天应得的收益：每个持仓按系列单价 × 每日收益比例算，再加起来。",
};

const VALUATION_NOTE = "UVT 锁仓到期应付按最新有效价格折算。没有有效价格时，这一类金额、应付款合计、覆盖率、差额和各类占比都写「暂时无法估值」；储备和其余 8 类照常显示。";

type ExportOutcome =
  | { kind: "summary-done" | "summary-unknown" }
  | { kind: "detail-done" | "detail-unknown"; range: string; fields: number; recipient: string; ticket: string };

export function L3Finance({ ctx, title, summary }: { ctx: LCtx; title: ReactNode; summary: string }) {
  const reach = useReach();
  const [matWin, setMatWin] = useState<"7d" | "30d">("7d");
  const defaultCustomRange = currentMonthRange();
  const [customFrom, setCustomFrom] = useState(ctx.l3Query?.from ?? defaultCustomRange.from);
  const [customTo, setCustomTo] = useState(ctx.l3Query?.to ?? defaultCustomRange.to);
  const exportingRef = useRef(false);
  const detailExportingRef = useRef(false);
  const detailIntentRef = useRef<{ fingerprint: string; key: string } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [detailExporting, setDetailExporting] = useState(false);
  // 只管显示：导出后页面上方的结果条。不参与请求。
  const [outcome, setOutcome] = useState<ExportOutcome | null>(null);

  const data = ctx.biData?.l3;
  const readAt = useMemo(() => (data ? formatBusinessTimeCompact(new Date().toISOString(), "") : ""), [data]);
  const exportPageName = findByPath(EXPORT_PAGE)?.l2.name ?? "数据导出与监管报告";
  const canOpenExportPage = reach(EXPORT_PAGE, "bi_l5_read");
  const exportPageLink = (text: string) => (canOpenExportPage
    ? <Link className="rd-link" href={EXPORT_PAGE}>{text}</Link>
    : <>你没有「{exportPageName}」的权限，请找有权限的同事核对。</>);

  /* ---------------- 两个导出：请求体、命令号、互斥和改版前一致（L3-A02、L3-A03、L3-S05） ---------------- */
  const liveFacts = readL3LiveFacts(data);
  const financeSnapshot = readL3FinanceSnapshot(data);
  const exportable = liveFacts.length > 0 || financeSnapshot !== null;
  const period = rec(data?.period);
  const periodFrom = typeof period.from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(period.from) ? period.from : "";
  const periodTo = typeof period.to === "string" && /^\d{4}-\d{2}-\d{2}$/.test(period.to) ? period.to : "";
  const detailExportable = Boolean(periodFrom && periodTo && periodFrom <= periodTo);
  const periodLabel = String(data?.periodLabel ?? "当前周期");

  const exportAgg = () => {
    if (exportingRef.current) return;
    const timeRange = String(ctx.biData?.l3?.periodLabel ?? "当前周期");
    setOutcome(null);
    ctx.openActionConfirm({ briefKind: "export",
      title: "导出财务当前汇总",
      action: "导出财务汇总",
      detail: "导出此刻的资金汇总，不含用户明细。",
      effect: <StatusTag tone="progress" filled>立即生成</StatusTag>,
      statedBrief: { impact: "生成一份此刻的资金汇总 CSV，不改任何数据，操作记录里留痕。", check: "它不跟页面上的周期和注册业务月走；要本期收入和提现，看这页上的数。" },
      facts: (
        <Facts>
          <Fact k="文件内容">此刻的储备、应付款、到期和账单计数<Explain label="汇总里有什么" content={<><p>此刻的资金储备、九类应付款、未来 7 天到期和钱包账单分类计数。</p><p>生成那一刻读一次资金数据，存成文件；以后再下载还是那一刻的数。</p><p>不含本期四类收入、提现笔数、确认 ÷ 申请和 30 天到期。</p></>} /></Fact>
          <Fact k="周期">不受页面筛选影响</Fact>
          <Fact k="个人信息">不含</Fact>
          <Fact k="文件格式">CSV</Fact>
          <Fact k="去哪下载">「{exportPageName}」</Fact>
        </Facts>
      ),
      confirmLabel: "确认导出",
      reasonPlaceholder: "写这份汇总给谁、做什么用，例如：月度资金核对",
      reasonMax: 200,
      run: async (reason) => {
        exportingRef.current = true;
        setExporting(true);
        try {
          await ctx.biActions?.createReport({
            exportType: "财务当前汇总",
            timeRange,
            fields: "资金池概览/负债科目/七日到期排程/钱包账单分类计数",
            piiLevel: "NONE",
            maskPolicy: "NONE",
            recipient: "财务管理员",
            ticket: "L3-FINANCE",
          }, reason);
          await ctx.reloadBi?.();
          ctx.toast("财务当前汇总已生成 · 已记录导出范围与操作者");
          setOutcome({ kind: "summary-done" });
        } catch (error) {
          // 结果未知仍交给外壳关框、重读、提示（l-view）；这里只记下来，在页面上留一条核对提示（决定 B4-PD02）。
          if (isLOutcomeUnknownError(error)) setOutcome({ kind: "summary-unknown" });
          throw error;
        } finally {
          exportingRef.current = false;
          setExporting(false);
        }
      },
    });
  };

  const openDetailExport = () => {
    if (!ctx.canExportFinanceDetail || !detailExportable || detailExportingRef.current) return;
    const allFields = FINANCE_DETAIL_FIELDS.join(",");
    setOutcome(null);
    ctx.openActionConfirm({ briefKind: "export",
      title: "申请脱敏资金明细",
      action: "申请导出脱敏资金明细",
      detail: `导出范围锁定为当前报表周期 ${periodFrom} 至 ${periodTo}，最多 100,000 行。`,
      effect: <StatusTag tone="warn" icon={LockKeyhole}>另一位放行后才能下载</StatusTag>,
      statedBrief: {
        impact: "提交后生成一份待放行的脱敏资金明细，不改余额、账本和提现。要另一位有审批权的同事在「数据导出与监管报告」放行，你不能批自己的申请。",
        check: "核对日期范围和字段；文件在提交这一刻生成，放行时不会重新取数。",
      },
      facts: (
        <Facts>
          <Fact k="日期范围">{periodFrom} 至 {periodTo}（含首尾两天）</Fact>
          <Fact k="导出什么">这段时间的全部钱包账单，按时间从新到旧，最多 100,000 行<Explain label="导出范围的说明" content={<><p>不分用户、资产和状态，全部钱包账单都算；超过 100,000 行不能提交，请缩短周期。</p><p>不带注册业务月；日期是页面已经读到的这一期，输入框里没应用的日期不算。</p></>} /></Fact>
          <Fact k="脱敏" tone="warn">只隐藏用户编码（留前 2 位和后 2 位）<Explain label="脱敏到什么程度" content={<><p>用户编码 4 位以内整个写成 ***。业务编号、金额、余额、时间都是原值。</p><p>不导出手机号、昵称、备注。</p></>} /></Fact>
          <Fact k="谁来放行">另一位有导出审批权的同事，不能是你</Fact>
          <Fact k="去哪下载">放行后到「{exportPageName}」下载<Explain label="下载链接多久有效" content="下载链接从放行后签发起 24 小时内有效，只给签发时的那位同事用。创建、放行、下载都有操作记录。" /></Fact>
        </Facts>
      ),
      confirmLabel: "提交申请",
      reasonPlaceholder: "写这份明细给谁、做什么用，例如：对账工单号、核对哪笔差异",
      reasonMin: 8,
      reasonMax: 200,
      businessForm: {
        kind: "multi-field",
        hint: "至少选一个字段；最多 100,000 行。",
        fields: [
          {
            key: "fields",
            label: "导出字段",
            current: allFields,
            inputKind: "multi-select",
            options: [...FINANCE_DETAIL_FIELDS],
            required: true,
            wide: true,
            explain: "默认九项全选，至少留一项；文件里的列按你选的顺序排。",
          },
          {
            key: "recipient",
            label: "使用人",
            current: "财务管理员",
            inputKind: "text",
            required: true,
            explain: "这份明细给谁用，会记进操作记录。",
          },
          {
            key: "ticket",
            label: "审批工单",
            current: "L3-FINANCE-DETAIL",
            inputKind: "text",
            required: true,
            explain: "对应的工单号，会记进操作记录，放行的同事会看到。",
          },
        ],
      },
      run: async (reason, _newValue, businessValue) => {
        if (detailExportingRef.current || !ctx.biActions) return;
        const fields = String(businessValue?.fields ?? "").split(",").map((item) => item.trim()).filter(Boolean);
        if (fields.length === 0 || fields.some((field) => !FINANCE_DETAIL_FIELDS.includes(field as (typeof FINANCE_DETAIL_FIELDS)[number]))) {
          throw new Error("至少选择一个允许导出的脱敏资金字段");
        }
        const input = {
          exportType: "财务资金明细",
          timeRange: `${periodFrom}/${periodTo}`,
          fields: fields.join(","),
          piiLevel: "HIGH_PII",
          maskPolicy: "MASKED",
          recipient: String(businessValue?.recipient ?? "").trim(),
          ticket: String(businessValue?.ticket ?? "").trim(),
        };
        const fingerprint = JSON.stringify({ ...input, reason: reason.trim() });
        if (!detailIntentRef.current || detailIntentRef.current.fingerprint !== fingerprint) {
          const entropy = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
          detailIntentRef.current = { fingerprint, key: `l3-finance-detail-${entropy}` };
        }
        const shown = { range: `${periodFrom} 至 ${periodTo}`, fields: fields.length, recipient: input.recipient, ticket: input.ticket };
        detailExportingRef.current = true;
        setDetailExporting(true);
        try {
          await ctx.biActions.createReport(input, reason, detailIntentRef.current.key);
          detailIntentRef.current = null;
          await ctx.reloadBi?.();
          ctx.toast("资金明细申请已提交，请在「数据导出与监管报告」审批后下载");
          setOutcome({ kind: "detail-done", ...shown });
        } catch (error) {
          // 结果未知仍交给外壳关框、重读、提示；页面上方留一条核对提示。R1 的本机保存和按原内容重试由代码 worker 接（决定 L3-PD02）。
          if (isLOutcomeUnknownError(error)) setOutcome({ kind: "detail-unknown", ...shown });
          throw error;
        } finally {
          detailExportingRef.current = false;
          setDetailExporting(false);
        }
      },
    });
  };

  const readBlocked = ctx.biLoading ? "正在读取，读完再导出" : ctx.biError ? "财务数据读取失败，暂时不能导出" : undefined;
  const summaryBlocked = readBlocked ?? (!exportable ? "暂无可导出的财务数据" : undefined);
  const detailBlocked = readBlocked ?? (!detailExportable ? "当前周期没有起止日期，不能导出明细" : undefined);
  const actions = (ctx.canExport || ctx.canExportFinanceDetail) ? (
    <span className="l3-actions">
      {ctx.canExport && (
        <span className="l3-pair" data-pair="">
          <Button icon={<FileSpreadsheet size={14} aria-hidden />} loading={exporting} loadingText="正在生成…" disabledReason={summaryBlocked} onClick={exportAgg}>导出当前汇总（CSV）</Button>
          <Explain label="当前汇总是什么" content={<><p>马上生成，不含个人信息：此刻的资金储备、九类应付款、未来 7 天到期和钱包账单分类计数。</p><p>是生成那一刻的快照，不跟页面上的周期和注册业务月走。到「{exportPageName}」下载。</p></>} />
        </span>
      )}
      {ctx.canExportFinanceDetail ? (
        <span className="l3-pair" data-pair="">
          <Button icon={<LockKeyhole size={14} aria-hidden />} loading={detailExporting} loadingText="正在提交…" disabledReason={detailBlocked} onClick={openDetailExport}>申请资金明细（需放行）</Button>
          <Explain label="资金明细怎么申请" content={<><p>这一期的钱包账单逐笔明细，用户编码已隐藏部分字符，属于高敏数据。</p><p>提交后要另一位有审批权的同事在「{exportPageName}」放行才能下载，你不能批自己的申请。</p></>} />
        </span>
      ) : (
        ctx.canExport && <span className="rd-toolbar-note">当前角色仅可导出汇总报表 · 明细需财务明细权限</span>
      )}
      {!ctx.canExport && ctx.canExportFinanceDetail && <span className="rd-toolbar-note">当前角色可申请导出脱敏资金明细 · 没有汇总导出权限</span>}
    </span>
  ) : undefined;

  const header = (
    <PageHeader
      pageId="L3"
      title={title}
      summary={summary}
      actions={actions}
      meta={<span className="rd-toolbar">
        <span>{readAt ? `${readAt} 读取（${businessZone().label}）· ` : ""}打开页面时读取，不自动刷新</span>
        <Button variant="ghost" size="sm" loading={ctx.biLoading} icon={<RefreshCw size={14} aria-hidden />} onClick={() => void ctx.reloadBi?.()}>刷新</Button>
      </span>}
      readOnly={!ctx.canExport && !ctx.canExportFinanceDetail ? "当前角色仅可查看 · 没有财务报表导出权限" : undefined}
    />
  );

  const outcomeNotice = outcome && (() => {
    const close = <Button size="sm" onClick={() => setOutcome(null)}>知道了</Button>;
    if (outcome.kind === "summary-done") return (
      <Notice tone="ok" title="已生成财务当前汇总" action={close}>
        是生成那一刻的资金快照，不含本期收入和提现。{exportPageLink(`到「${exportPageName}」下载`)}
      </Notice>
    );
    if (outcome.kind === "summary-unknown") return (
      <Notice tone="warn" title="汇总导出结果未确认" action={close}>
        请求已发出，但没有收到明确结果，汇总可能已经生成。先{exportPageLink(`到「${exportPageName}」看有没有这条任务`)}，没有再重新导出；导出不改业务数据。
      </Notice>
    );
    if (!("range" in outcome)) return null;
    const request = `${outcome.range} · ${outcome.fields} 个字段 · 使用人 ${outcome.recipient} · 工单 ${outcome.ticket}`;
    if (outcome.kind === "detail-done") return (
      <Notice tone="warn" title="已申请资金明细，等另一位放行" action={close} actionBelow>
        <p>{request}</p>
        <p>有导出审批权的另一位同事放行后才能下载，你不能批自己的申请。{exportPageLink(`到「${exportPageName}」看进度`)}</p>
      </Notice>
    );
    return (
      <Notice tone="warn" title="资金明细申请结果未确认" action={close} actionBelow>
        <p>{request}</p>
        <p>请求已发出，但没有收到明确结果，申请可能已经提交。{canOpenExportPage
          ? <>先{exportPageLink(`到「${exportPageName}」看有没有这条待放行的申请`)}，没有再按同样内容重新申请。</>
          : <>你没有「{exportPageName}」的权限，请找有权限的同事核对；核对之前不要换内容重新申请。</>}</p>
        {/* R1：代码 worker 在这里接本机保存和「按原内容重试」（决定 L3-PD02、e-page-common R1）。 */}
      </Notice>
    );
  })();

  /* ---------------- 周期、注册业务月：选了立即读（L3-Q01、L3-Q02、L3-S06） ---------------- */
  const selectPeriod = (next: "day" | "week" | "month" | "quarter" | "custom") => {
    if (!ctx.setL3Query) return;
    ctx.setL3Query(next === "custom"
      ? { ...ctx.l3Query, period: next, from: customFrom, to: customTo }
      : { period: next, cohort: ctx.l3Query?.cohort });
  };
  const activePeriod = ctx.l3Query?.period ?? "month";
  const cohort = ctx.l3Query?.cohort ?? "";
  const customInvalid = !customFrom || !customTo || customFrom > customTo;
  const customChanged = activePeriod === "custom" && (customFrom !== (ctx.l3Query?.from ?? "") || customTo !== (ctx.l3Query?.to ?? ""));
  const scopeExplain = (
    <Explain label="三个切换各管哪几块" content={<>
      <p>报表周期：管本期收入和本期提现，和上一个同样长的周期比。</p>
      <p>注册业务月：只管本期提现，只算这个月注册的用户；清空就是全部用户。</p>
      <p>到期窗口（下面「接下来要付多少」里）：只换按类别的到期金额，不重新读取。</p>
      <p>储备、应付款、兑付覆盖率和到期都是读取那一刻的数，不随这三个切换变；导出的汇总也一样。</p>
    </>} />
  );
  const filterBar = (
    <FilterBar
      scope={<Segments<"day" | "week" | "month" | "quarter" | "custom"> label="报表周期" value={activePeriod}
        items={([["day", "日"], ["week", "周"], ["month", "月"], ["quarter", "季"], ["custom", "自定义"]] as const).map(([value, label]) => ({ value, label, disabled: ctx.biLoading }))}
        onChange={selectPeriod} />}
      onClear={() => ctx.setL3Query?.({ ...(ctx.l3Query ?? { period: "month" }), cohort: undefined })}
      canClear={Boolean(cohort) && !ctx.biLoading}
      clearLabel="不限注册月"
      sort={<span className="l3-scope rd-filter-result">
        现在看：{periodFrom && periodTo && !periodLabel.includes(periodFrom) ? `${periodLabel}（${periodFrom === periodTo ? periodFrom : `${periodFrom} 至 ${periodTo}`}）` : periodLabel} · {cohort ? `${cohort} 注册的用户` : "全部用户"}{customChanged ? " · 日期还没应用" : ""}
        {scopeExplain}
      </span>}
    >
      <FilterField>
        <span className="rd-filter-group">
          <label className="rd-note" htmlFor="l3-cohort">注册业务月</label>
          <Input id="l3-cohort" aria-label="注册业务月" type="month" value={cohort}
            onChange={(event) => ctx.setL3Query?.({ ...(ctx.l3Query ?? { period: "month" }), cohort: event.target.value || undefined })} />
        </span>
      </FilterField>
      {activePeriod === "custom" && (
        <div className="rd-filter-line">
          <label className="rd-note" htmlFor="l3-custom-from">起</label>
          <Input id="l3-custom-from" aria-label="自定义开始日期" type="date" value={customFrom} max={customTo} aria-invalid={customInvalid || undefined} onChange={(event) => setCustomFrom(event.target.value)} />
          <label className="rd-note" htmlFor="l3-custom-to">止</label>
          <Input id="l3-custom-to" aria-label="自定义结束日期" type="date" value={customTo} min={customFrom} aria-invalid={customInvalid || undefined} onChange={(event) => setCustomTo(event.target.value)} />
          <Button disabledReason={ctx.biLoading ? "正在读取" : customInvalid ? "开始日期不能晚于结束日期" : undefined} onClick={() => selectPeriod("custom")}>应用日期</Button>
          <Explain label="自定义日期的说明" content={`按平台业务日（${businessZone().label}）算，含首尾两天，最长一年。超过一年时读取失败，改短后再应用。`} />
        </div>
      )}
    </FilterBar>
  );

  const page = (body: ReactNode) => (
    <>
      {header}
      {outcomeNotice}
      {filterBar}
      {body}
    </>
  );

  if (!data) return page(<>
    <Conclusion state="unknown" icon={ShieldQuestion}>{ctx.biLoading ? "财务状况：正在读取" : ctx.biError ? "财务状况：读取失败，暂时无法判断" : "财务状况：还没有数据"}</Conclusion>
    {ctx.biLoading
      ? <BlockState state="loading" title="正在读取本期收入、提现、储备和到期…" />
      : ctx.biError
        ? <BlockState state="error" title="财务数据读取失败，不显示旧数据" detail={`${ctx.biError} 可以改上面的周期再读；还是失败的话，请把错误信息发给技术同事。`} onRetry={() => void ctx.reloadBi?.()} retryLabel="重新加载" />
        : <BlockState state="empty" title="还没有可显示的财务数据" detail="请先重新加载；仍然为空，说明还没有产生数据。" onRetry={() => void ctx.reloadBi?.()} retryLabel="重新加载" />}
  </>);

  /* ---------------- 读到的数：映射和完整性检查沿用改版前（L3-S04、L3-V06） ---------------- */
  const ledgerRaw = rec(data.ledger);
  const treasuryRaw = rec(data.treasury);
  const redemptionRaw = rec(data.redemption);
  const maturityRaw = rec(data.maturityWindow);
  const maturity7Raw = rec(maturityRaw["7d"]);
  const maturity30Raw = rec(maturityRaw["30d"]);
  const scheduleRaw = rec(data.maturitySchedule);
  const revenueStreamsRaw = rows<Record<string, unknown>>(rec(data.revenue).streams);
  const liabilitiesRaw = rows<{ id: number; name: string; amount: number }>(data.liabilities);
  const coverageSeries = rows<number>(data.coverage12w);
  const coverageTicks = strings(data.coverageWeeks);
  const breaches = rows<{ i: number; type: string; label: string }>(data.coverageBreaches)
    .filter((item) => Number.isInteger(item.i) && item.i >= 0 && item.i < coverageSeries.length);
  const schedule = { weeks: strings(scheduleRaw.weeks), data: rows<number[]>(scheduleRaw.data) };
  const hasNumber = (record: Record<string, unknown>, key: string) => Object.prototype.hasOwnProperty.call(record, key) && Number.isFinite(Number(record[key]));
  const hasNullableNumber = (record: Record<string, unknown>, key: string) => Object.prototype.hasOwnProperty.call(record, key)
    && (record[key] === null || (typeof record[key] === "number" && Number.isFinite(record[key])));
  const fullContractReady = revenueStreamsRaw.length > 0
    && revenueStreamsRaw.every((row) => Number.isFinite(num(row.amountUsdt)) && num(row.amountUsdt) >= 0)
    && liabilitiesRaw.length > 0
    && liabilitiesRaw.every((row) => Number.isFinite(row.amount) && row.amount >= 0)
    && coverageSeries.length >= 2
    && coverageTicks.length === coverageSeries.length
    && coverageSeries.every(Number.isFinite)
    && ["reserveUsd", "liabilitiesUsd"].every((key) => hasNumber(ledgerRaw, key))
    && ["coverageRatio", "redLine", "yellowLine", "netExposure"].every((key) => hasNumber(treasuryRaw, key))
    && ["submitted", "confirmed", "rejected", "delayed", "frozen"].every((key) => hasNumber(redemptionRaw, key))
    && ["rate", "prevRate"].every((key) => hasNullableNumber(redemptionRaw, key))
    && [maturity7Raw, maturity30Raw].every((window) => ["withdraw", "interest", "genesis"].every((key) => hasNumber(window, key)))
    && schedule.weeks.length > 0
    && schedule.weeks.length === schedule.data.length
    && schedule.data.every((group) => Array.isArray(group) && group.length === 3 && group.every(Number.isFinite))
    && Object.prototype.hasOwnProperty.call(data, "reserveCoverDays")
    && Number.isFinite(Number(data.reserveCoverDays));
  if (!fullContractReady) return page(<>
    <Conclusion state="unknown" icon={ShieldQuestion}>财务状况：数据不完整，暂时无法判断</Conclusion>
    <BlockState state="error" title="收到的财务数据不完整，已停止显示" detail="页面不显示不可靠的数字，也不能导出。请先重新加载；仍然这样，请把这页的情况告诉技术同事。" onRetry={() => void ctx.reloadBi?.()} retryLabel="重新加载" />
  </>);

  /* 估值：有 UVT 应付款却没有有效价格时，应付款合计、覆盖率、差额和占比都不可靠（F03）。
     代码 worker 接：改读 treasury-snapshot 的 liabilities.valuationReliable（L3-BE-01）；现在先用同一次读取里财务概览带的同名标记。 */
  const valuationUnavailable = financeSnapshot?.valuationReliable === false;

  const reserve = num(ledgerRaw.reserveUsd);
  const liabilityTotal = valuationUnavailable ? null : num(ledgerRaw.liabilitiesUsd);
  const coverage = num(treasuryRaw.coverageRatio);
  const redLine = num(treasuryRaw.redLine);
  const healthyLine = num(treasuryRaw.yellowLine);
  const netExposure = valuationUnavailable ? null : num(treasuryRaw.netExposure);
  const noLiability = liabilityTotal === 0;
  const moneyDigits = amountDigits([reserve, liabilityTotal, netExposure]);

  const revenueStreams: RevenueStream[] = revenueStreamsRaw.map((row, index) => {
    const key = str(row.stream);
    const text = REVENUE_TEXT[key];
    return {
      key,
      name: text?.name ?? str(row.label),
      source: str(row.source),
      explain: text?.explain ?? "",
      amount: num(row.amountUsdt),
      previous: num(row.previousAmountUsdt),
      share: typeof row.share === "number" ? row.share : null,
      momDelta: typeof row.momDelta === "number" ? row.momDelta : null,
      slot: REVENUE_SLOTS[index] ?? "other",
    };
  });
  const revenueTotal = cents(revenueStreams.reduce((sum, row) => sum + row.amount, 0));

  const redemption: Redemption = {
    submitted: num(redemptionRaw.submitted),
    confirmed: num(redemptionRaw.confirmed),
    rejected: num(redemptionRaw.rejected),
    delayed: num(redemptionRaw.delayed),
    frozen: num(redemptionRaw.frozen),
    avgLatency: String(redemptionRaw.avgLatency ?? "—"),
    rate: typeof redemptionRaw.rate === "number" ? redemptionRaw.rate : null,
    prevRate: typeof redemptionRaw.prevRate === "number" ? redemptionRaw.prevRate : null,
    prevLabel: String(redemptionRaw.prevLabel ?? "上期"),
  };

  const liabilities: LiabilityRow[] = liabilitiesRaw.map((row) => {
    const category = LIABILITY_CATEGORY[row.name] ?? "";
    return {
      key: category || String(row.id),
      name: liabilityDisplayName(category, row.name),
      explain: LIABILITY_EXPLANATIONS[category] ?? row.name,
      amount: valuationUnavailable && category === "nex_v2_future" ? null : row.amount,
    };
  });

  const windowTotals = (raw: Record<string, unknown>) => MATURITY_PARTS.map((part) => num(raw[part.key]));
  const due7 = windowTotals(maturity7Raw);
  const due30 = windowTotals(maturity30Raw);
  const due7Total = cents(due7.reduce((sum, value) => sum + value, 0));
  const due30Total = cents(due30.reduce((sum, value) => sum + value, 0));
  const shownDue = matWin === "7d" ? due7 : due30;
  const shownDueTotal = matWin === "7d" ? due7Total : due30Total;
  const dueDigits = amountDigits([due7Total, due30Total, ...due7, ...due30]);
  /* 能付多久：照后端返回的天数写（含资金储备与应付款开着的试用业务压力测试）。后端没有到期时返回 999（有储备）或 0（没储备），
     只有三类合计也是 0 时才当作「没有到期」，避免把含试用压力算出的天数写成不计算（F04）。代码 worker 接：改读 maturity30.trialStressIncluded 和 cumulativeUsdt。 */
  const coverDays = Number(data.reserveCoverDays);
  const noDue30 = due30Total === 0 && (coverDays === 999 || coverDays === 0);
  const coverDaysValue = noDue30 ? "30 天内没有到期" : coverDaysText(coverDays);

  const groupDays = [7, 7, 7, 9];
  const groups = schedule.weeks.map((label, index) => ({ key: `${index}-${label}`, label, days: groupDays[index] ?? 0, values: schedule.data[index] ?? [0, 0, 0] }));
  const groupTotals = groups.map((group) => cents(group.values.reduce((sum, value) => sum + value, 0)));
  const peakIndex = groupTotals.reduce((best, value, index) => (value > groupTotals[best] ? index : best), 0);
  const peakGroup = groups[peakIndex];
  const peakPart = peakGroup ? peakGroup.values.reduce((best, value, index) => (value > peakGroup.values[best] ? index : best), 0) : 0;

  /* ---------------- 结论：付不付得起，和资金与应付款总览同一种说法 ---------------- */
  const zone = valuationUnavailable ? "unknown" : noLiability ? "ok" : coverage < redLine ? "danger" : coverage === redLine || coverage <= healthyLine ? "warn" : "ok";
  const coverageTone = zone === "danger" ? "danger" : zone === "warn" ? "warn" : zone === "ok" ? "ok" : "neutral";
  const overviewName = findByPath(OVERVIEW_PAGE)?.l2.name ?? "资金与应付款总览";
  const overviewLink = reach(OVERVIEW_PAGE) ? <Link className="rd-link" href={OVERVIEW_PAGE}>去「{overviewName}」看处理建议</Link> : null;
  const conclusionExplain = <><p>兑付覆盖率 = 可用储备 ÷ 应付款，和「{overviewName}」是同一个数。低于红线时提现审核不能放行，低于健康线算警戒。</p><p>这页只能查看和导出，不会改账。</p></>;
  const conclusion = zone === "unknown"
    ? <Conclusion state="unknown" icon={ShieldQuestion} explain={VALUATION_NOTE} explainTitle="为什么不下结论" hint="储备、其余 8 类应付款、收入、提现和到期照常显示。">资金状态：UVT 暂时无法估值，覆盖率不下结论</Conclusion>
    : noLiability
      ? <Conclusion state="ok" icon={ShieldCheck} explain={conclusionExplain}>资金安全：目前没有应付款</Conclusion>
      : zone === "danger"
        ? <Conclusion state="danger" strong lead icon={ShieldAlert} explain={conclusionExplain} action={overviewLink}>资金告警：覆盖率 <b>{pctText(coverage)}</b>，跌破红线 {pctText(redLine)}</Conclusion>
        : zone === "warn"
          ? <Conclusion state="warn" lead icon={ShieldAlert} explain={conclusionExplain} action={overviewLink}>
            资金需要注意：覆盖率 <b>{pctText(coverage)}</b>，{coverage === redLine ? "正好压在红线上" : coverage === healthyLine ? "正好压在健康线上" : `低于健康线 ${pctText(healthyLine)}`}
          </Conclusion>
          : <Conclusion state="ok" icon={ShieldCheck} explain={conclusionExplain} hint="储备够付全部应付款，这页不用处理。">资金安全：覆盖率 {pctText(coverage)}，高于健康线 {pctText(healthyLine)}</Conclusion>;

  /* ---------------- 四个数：进了多少、出了多少、付不付得起、接下来要付多少 ---------------- */
  const statDigits = amountDigits([revenueTotal, due7Total, due30Total]);
  const stats = (
    <StatBand label="这一期的四个关键数">
      <Stat tone="role-2" icon={ArrowDownToLine} label="本期四类收入" value={amountText(revenueTotal, statDigits)} unit="USDT" sub={periodLabel}
        explain="设备销售成交额、团队奖励、代币经济、算力撮合服务费四类相加，是成交额和费用的合计，不是利润。按报表周期统计，构成在下面「本期收入构成」。" />
      <Stat tone="role-2" icon={ArrowUpFromLine} label="本期提现确认" value={count(redemption.confirmed)} unit="笔" sub={`申请 ${count(redemption.submitted)} 笔`}
        explain="提现只统计笔数，没有金额。按报表周期和注册业务月统计；本期确认的可能是上期申请的。" />
      <Stat tone={zone === "danger" || zone === "warn" ? zone : "role-4"} icon={Gauge} label="兑付覆盖率"
        value={valuationUnavailable ? TREASURY_VALUATION_UNAVAILABLE : noLiability ? "无应付款" : pctText(coverage)}
        sub={`红线 ${pctText(redLine)} · 健康线 ${pctText(healthyLine)}`}
        explain={<><p>可用储备 ÷ 应付款，读取那一刻的数，不随周期变。</p>{valuationUnavailable && <p>{VALUATION_NOTE}</p>}</>} />
      <Stat tone="role-3" icon={CalendarClock} label="未来 7 天到期" value={amountText(due7Total, statDigits)} unit="USDT" sub={`未来 30 天 ${usdt(due30Total, statDigits)}`}
        explain="提现、质押奖励利息、创世节点收益三类相加，从今天（业务日）算起。质押只算利息，不含本金。" />
    </StatBand>
  );

  /* ---------------- 本期收入构成 | 本期提现 ---------------- */
  const withdrawName = findByPath(WITHDRAW_PAGE)?.l2.name ?? "提现审核";
  const inPanels = (
    <div className="rd-split" data-even="">
      <Panel title="本期收入构成" icon={ArrowDownToLine} tone="role-2" sub={`${periodLabel} · 共 ${usdt(revenueTotal, amountDigits([revenueTotal]))}`}
        explain={<><p>四类各自从订单、账本或兑换单汇总，不是同一本账；都不算测试用户。是成交额和费用，不是利润。</p><p>较上期：和上一个同样长的周期比；上期是 0 时写「—」，−100% 表示本期没有。</p></>}>
        <RevenueFigure streams={revenueStreams} total={revenueTotal} />
      </Panel>
      <Panel title="本期提现" icon={ArrowUpFromLine} tone="role-2" sub={`${periodLabel} · ${cohort ? `${cohort} 注册的用户` : "全部用户"} · 只有笔数`}
        explain={<><p>按提现事件发生的时间统计笔数，没有金额。一笔提现可能先被延迟或冻结、后来又确认了，所以几项加起来不等于申请数。</p><p>注册业务月只影响这一块。</p></>}>
        <div className="rd-stack">
          <RedemptionFigures data={redemption} />
          {reach(WITHDRAW_PAGE) && <nav className="rd-links" aria-label="处理提现"><span>要处理某一笔</span><Link className="rd-link" href={WITHDRAW_PAGE}>{withdrawName}</Link></nav>}
        </div>
      </Panel>
    </div>
  );

  /* ---------------- 兑付覆盖率 | 九类应付款 ---------------- */
  const seriesRange = coverageTicks.length ? `${coverageTicks[0]} 至 ${coverageTicks[coverageTicks.length - 1]}` : "";
  const trendWord = coverageSeries.length >= 2
    ? coverageSeries[coverageSeries.length - 1] - coverageSeries[0] > 0.01 ? "这段时间储备在增加" : coverageSeries[0] - coverageSeries[coverageSeries.length - 1] > 0.01 ? "这段时间储备在减少" : "这段时间储备没有明显变化"
    : "";
  const treasuryName = findByPath(TREASURY_PAGE)?.l2.name ?? "资金储备与应付款";
  const coveragePanel = (
    <Panel title="兑付覆盖率" icon={Gauge} tone="role-4" sub={`读取那一刻 · 红线 ${pctText(redLine)} · 健康线 ${pctText(healthyLine)}`}
      explain={<><p>可用储备 ÷ 应付款，和「{overviewName}」同一个数，不随报表周期变。</p><p>红线和健康线在「{overviewName}」设置，这页只读。</p></>}>
      <div className="rd-stack">
        {valuationUnavailable
          ? <BlockState state="empty" title={`覆盖率${TREASURY_VALUATION_UNAVAILABLE}`} detail="UVT 锁仓到期应付缺少有效价格，算不出应付款合计。红线和健康线照常生效。" />
          : noLiability
            ? <p className="rd-note">目前没有应付款，不画覆盖率尺。</p>
            : <ThresholdMeter label="覆盖率和红线、健康线"
              rows={[{ key: "coverage", label: "覆盖率", value: coverage, text: pctText(coverage), tone: coverageTone }]}
              marks={[{ key: "red", text: `红线 ${pctText(redLine)}`, value: redLine, tone: "danger" }, { key: "healthy", text: `健康线 ${pctText(healthyLine)}`, value: healthyLine, tone: "ok" }]} />}
        <KeyValues rows={[
          { key: "reserve", label: "可用储备", value: usdt(reserve, moneyDigits), explain: "平台现在能动用的钱，和「资金与应付款总览」同一个数。不是用户钱包余额。" },
          { key: "liability", label: "应付款", value: usdt(liabilityTotal, moneyDigits), explain: valuationUnavailable ? VALUATION_NOTE : "右边九类相加，是之后要付给用户的全部钱，不是都能马上提现。" },
          { key: "net", label: "差额（储备 − 应付款）", value: netExposure === null ? TREASURY_VALUATION_UNAVAILABLE : <span className="l3-delta" data-dir={netExposure > 0 ? "up" : netExposure < 0 ? "down" : undefined}>{`${netExposure > 0 ? "+" : netExposure < 0 ? "−" : ""}${amountText(Math.abs(netExposure), moneyDigits)} USDT`}</span>,
            explain: valuationUnavailable ? VALUATION_NOTE : "负数表示储备不够付全部应付款，不等于某一笔提现会马上失败。" },
        ]} />
        <div className="l3-trend">
          <h3 className="l3-sub">近 {coverageSeries.length} 个时段（{seriesRange}）<Explain label="覆盖率走势怎么算" content="系统按资金账本倒推每个时段当时的储备，应付款一律用现在的值（应付款没有历史记录），所以这条线不是当时真实的覆盖率，起伏只来自储备进出。时间按服务器时间。" /></h3>
          <p className="l3-caliber">历史点 = 当时的储备 ÷ 现在的应付款，只反映储备变化{trendWord ? ` · ${trendWord}` : ""}</p>
          {valuationUnavailable
            ? <p className="rd-note">覆盖率{TREASURY_VALUATION_UNAVAILABLE}，走势不画。</p>
            : <TrendLines label="近几个时段的覆盖率" ticks={coverageTicks.map((tick) => tick.slice(-5))} format={pctText} axisFormat={(value) => `${Number(value.toFixed(1))}%`} height={120}
              series={[{ key: "coverage", label: "覆盖率", slot: 4, values: coverageSeries }]}
              marks={[{ key: "red", text: `红线 ${pctText(redLine)}`, value: redLine, tone: "danger" }, { key: "healthy", text: `健康线 ${pctText(healthyLine)}`, value: healthyLine, tone: "ok" }]} />}
          <p className="rd-note">{breaches.length ? `越线记录：${breaches.map((item) => `${coverageTicks[item.i]} ${item.label}`).join("；")}` : "越线记录：后端目前不提供"}</p>
        </div>
      </div>
    </Panel>
  );
  const liabilityPanel = (
    <Panel title="九类应付款" icon={ReceiptText} tone="role-2" sub={`读取那一刻 · 合计 ${usdt(liabilityTotal, moneyDigits)}`}
      explain={<><p>和「{treasuryName}」「{overviewName}」同一套九类、同一组数。条长按金额，百分比是占九类合计的比例。</p>{valuationUnavailable && <p>{VALUATION_NOTE}</p>}</>}>
      <LiabilityBars rows={liabilities} total={liabilityTotal} />
    </Panel>
  );

  /* ---------------- 接下来要付多少 ---------------- */
  const duePanel = (
    <Panel title="接下来要付多少" icon={CalendarClock} tone="role-3" sub="从今天（业务日）起 · 读取那一刻的预测"
      explain={<><p>数字取自「{treasuryName}」的到期预测，只算提现、质押奖励利息、创世节点收益三类；其余应付款不在到期里。</p><p>UVT 锁仓要 24 个月后才到期，不在这里。哪几类计入、质押利息怎么摊，按「{treasuryName}」的预测设置。</p></>}>
      <div className="rd-split" data-even="">
        <div className="rd-stack">
          <div className="rd-toolbar">
            <Segments<"7d" | "30d"> label="到期窗口" value={matWin}
              items={[{ value: "7d", label: "未来 7 天" }, { value: "30d", label: "未来 30 天" }]}
              onChange={(next) => { setMatWin(next); ctx.toast(`到期窗口已切换为${next === "7d" ? "未来 7 天" : "未来 30 天"}`, "info"); }} />
            <span className="rd-toolbar-note l3-toolbar-end">只换这一块，不重新读取</span>
          </div>
          <p className="l3-due-total"><span>{matWin === "7d" ? "未来 7 天" : "未来 30 天"}合计</span><b data-empty={shownDueTotal === 0 ? "" : undefined}>{amountText(shownDueTotal, dueDigits)}<small>USDT</small></b></p>
          {shownDueTotal === 0
            ? <p className="rd-note">{matWin === "7d" ? "未来 7 天" : "未来 30 天"}这三类都没有到期。</p>
            : <DueBars parts={MATURITY_PARTS} values={shownDue} digits={dueDigits} explain={MATURITY_EXPLAIN} />}
          {!noDue30 && due30Total === 0 && <p className="rd-note">三类都没有到期，下面的天数来自「{treasuryName}」开着的试用业务压力测试。</p>}
          <KeyValues rows={[{
            key: "days",
            label: "能付多久（按 30 天到期）",
            value: coverDaysValue,
            explain: noDue30
              ? "未来 30 天三类都没有到期，算不出能付多少天。"
              : <><p>按「{treasuryName}」预测设置里计入的储备，除以未来 30 天平均每天到期的金额。精确值 {coverDays.toLocaleString("en-US")} 天。</p><p>「{treasuryName}」开了试用业务压力测试时，每天的到期还会多算一笔压力值，上面的三类合计不含它。「{treasuryName}」页的能付多久按 7 天算，两个数可能不同。</p></>,
          }]} />
        </div>
        <div className="rd-stack">
          <h3 className="l3-sub">未来 30 天分四段<Explain label="四段怎么分" content="从今天起每 7 天一段，最后一段 9 天。条长按这一段三类的合计，条里按类别分色。不随左边的到期窗口变。" /></h3>
          {due30Total === 0
            ? <p className="rd-note">未来 30 天这三类都没有到期。</p>
            : <MaturityGroups parts={MATURITY_PARTS} groups={groups}
              footer={peakGroup && <p className="l3-caliber">最多的一段是 {peakGroup.label}，{usdt(groupTotals[peakIndex], dueDigits)}，其中{MATURITY_PARTS[peakPart].name}最多</p>} />}
        </div>
      </div>
    </Panel>
  );

  return page(<>
    {conclusion}
    {stats}
    {inPanels}
    <div className="rd-split" data-even="">
      {coveragePanel}
      {liabilityPanel}
    </div>
    {duePanel}
  </>);
}

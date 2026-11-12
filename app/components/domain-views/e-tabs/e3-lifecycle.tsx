"use client";
/**
 * E3 设备使用与升级置换（改版）。配置页：结论、四个数、产能曲线和最近 24 小时，再往下是两套规则和「目前不生效」。
 * 两套规则就是旧页的「任务产能节奏」（产能随月龄下降、参与任务递减的商品）和「升级置换阶梯」（分档界线、各档抵扣比例）。
 * 读数、写入口和请求都走壳（e-view.tsx）原来的 ctx：openActionConfirm 的 name、op、paramKey(s)、edit、businessForm、amplify 与旧页一致，
 * 只加了显示用的 title、effect、facts、statedBrief、hint、preview、explain、warning。
 */
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowLeftRight, BookOpen, Clock3, Gauge, Hourglass, Info, PackageOpen, RefreshCw, Wallet } from "lucide-react";
import { useReach } from "@/lib/nav/use-reach";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { e3ConfigAmplifies } from "@/lib/admin/e3-outflow";
import { BlockState, Button, Cell, Conclusion, ConfigList, ConfigRow, Explain, Fact, Facts, Fold, Notice, PageHeader, Panel,
  ScaleBar, Stat, StatBand, StatusTag, StepBar, Table, TableMessage, Td, Th, Tr, TrendLines } from "@/app/components/rd";
import type { EViewCtx, McSpec } from "./types";
import { E3Manual } from "./e3-manual";

/** 批准资格的真实路径（后端 A2：不同于发起人、有批准权、能访问 E 域；单项另要 E3 读权）。 */
export const E3_APPROVER_SINGLE = "另一位有批准权限、能查看这页的管理员在「操作记录与审批」批准后生效，发起人不能自批；批准前规则不变。";
export const E3_APPROVER_BATCH = "另一位有批准权限的管理员在「操作记录与审批」批准后整组一起生效，发起人不能自批；批准前规则不变。";
/** 覆盖率和任务奖励上限在批准执行时检查，提交时不查。 */
export const E3_COVERAGE_CHECK = "提交时不检查；批准执行时后端检查兑付覆盖率，产能类修改还检查各商品的任务奖励上限，不通过就不执行。";

export const REQUIRED_E3_KEYS = [
  "E.device.capacity.band1DeltaPct",
  "E.device.capacity.band2DeltaPct",
  "E.device.capacity.band3DeltaPct",
  "E.device.stageEarlyEnd",
  "E.device.stageMidEnd",
  "E.device.cycleMonths",
  "E.device.capacity.floorPct",
  "E.device.capacity.subsidyDays",
  "E.device.capacity.applyTo.phone",
  "E.device.capacity.applyTo.cloud-share",
  "E.device.capacity.applyTo.pc-gpu",
  "E.device.capacity.applyTo.stellarbox-s1",
  "E.device.capacity.applyTo.stellarbox-pro",
  "E.device.capacity.applyTo.stellarbox-pro-v2",
  "E.device.capacity.applyTo.stellarrack-p1",
  "E.device.capacity.applyTo.stellarrack-p2",
  "E.device.taskLock.s1",
  "E.device.taskLock.pro",
  "E.device.taskLock.rack",
  "E.tradein.enabled",
  "E.tradein.ladder.cut1",
  "E.tradein.ladder.cut2",
  "E.tradein.ladder.cut3",
  "E.tradein.ladder.cut4",
  "E.tradein.ladder.credit1",
  "E.tradein.ladder.credit2",
  "E.tradein.ladder.credit3",
  "E.tradein.ladder.credit4",
  "E.tradein.ladder.credit5",
  "E.tradein.requireHigherPrice",
  "E.tradein.maxDevicesPerOrder",
  "E.tradein.eligibility",
];

/** FEAT-DEV01 参与任务递减（每个商品一个开关）：值是「参与递减」或「免递减」。与 App 的 CAPACITY_EXEMPT_KINDS 对账（canon 哨兵）。 */
export const APPLY_TO_SKUS: { kind: string; label: string }[] = [
  { kind: "phone", label: "手机" },
  { kind: "cloud-share", label: "云端共享份额" },
  { kind: "pc-gpu", label: "电脑共享" },
  { kind: "stellarbox-s1", label: "UVELBox S1" },
  { kind: "stellarbox-pro", label: "UVELBox Pro" },
  { kind: "stellarbox-pro-v2", label: "UVELBox Pro v2" },
  { kind: "stellarrack-p1", label: "UVELRack P1" },
  { kind: "stellarrack-p2", label: "UVELRack P2" },
];

/** 本页名字：配置键 → 运营看到的名字。确认框、待批准条、说明手册都用这一份。 */
const NAMES: Record<string, string> = {
  "E.device.capacity.band1DeltaPct": "前期每月变化",
  "E.device.capacity.band2DeltaPct": "中期每月变化",
  "E.device.capacity.band3DeltaPct": "后期每月变化",
  "E.device.capacity.floorPct": "产能下限",
  "E.device.capacity.subsidyDays": "新机任务补贴天数",
  "E.device.stageEarlyEnd": "前期到第几月",
  "E.device.stageMidEnd": "中期到第几月",
  "E.device.cycleMonths": "曲线画几个月",
  "E.tradein.enabled": "升级置换开关",
  "E.tradein.requireHigherPrice": "只能换更贵的新设备",
  "E.tradein.maxDevicesPerOrder": "每单最多抵扣台数",
  "E.tradein.eligibility": "谁能升级置换",
};
/** 缺项提示用：每个必需键都有中文名。 */
const keyName = (key: string) => NAMES[key]
  ?? (key.match(/ladder\.cut(\d)$/) ? `分档界线 ${key.slice(-1)}`
  : key.match(/ladder\.credit(\d)$/) ? `第 ${key.slice(-1)} 档抵扣比例`
  : key.startsWith("E.device.capacity.applyTo.") ? `${APPLY_TO_SKUS.find((s) => key.endsWith(`.${s.kind}`))?.label ?? key}是否逐月下降`
  : key.startsWith("E.device.taskLock.") ? "提示升级的月损失金额"
  : key);
const ELIGIBILITY = ["全部用户", "L2+ 持有者", "L3+ 持有者", "L4+ 持有者", "L5+ 持有者", "L6+ 持有者"];

/**
 * E3 提案的读回：待批准、结果未确认、超过 24 小时只能查询、被驳回。
 * 界面已备好，等代码 worker 接 A2 按命令号读回和 R1 恢复（重构说明 C4、R2-03）。现在恒为空，页面上不出现这些条。
 */
type E3Proposal = { id: string; label: string; keys: readonly string[]; after: Readonly<Record<string, string>>; state: "pending" | "unknown" | "expired" | "rejected"; at: string; reason?: string };
const E3_PROPOSALS: readonly E3Proposal[] = [];
/** 查询原操作、按原操作重试：等代码 worker 接上后传进来，没接时不显示按钮。 */
const E3_RECOVERY: { lookup?: (proposal: E3Proposal) => void; retry?: (proposal: E3Proposal) => void } = {};

const num = (value: string) => Number(value);
const signed = (value: string) => `${num(value) > 0 ? "+" : ""}${value}%`;
const countText = (value: number) => value.toLocaleString("zh-CN");
const usdtText = (value: number) => `${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 })} USDT`;
const capText = (value: number) => `${Number(value.toFixed(2))}%`;

/** 产能（%）：分段连乘再取下限，和后端 E3CapacityCurve 同一个算法。只用来画图和写预览，不参与提交。 */
function capacityAt(policy: Record<string, string>, month: number) {
  const early = num(policy["E.device.stageEarlyEnd"]), mid = num(policy["E.device.stageMidEnd"]);
  const factor = (band: number) => 1 + num(policy[`E.device.capacity.band${band}DeltaPct`]) / 100;
  return Math.max(num(policy["E.device.capacity.floorPct"]), 100
    * factor(1) ** Math.min(month, early)
    * factor(2) ** Math.max(Math.min(month, mid) - early, 0)
    * factor(3) ** Math.max(month - mid, 0));
}
const curveOf = (policy: Record<string, string>, months: number) => Array.from({ length: months + 1 }, (_, month) => capacityAt(policy, month));
/** 第一个超过 100% 的月份；App 目前拒绝显示这种产能（E3-DEC-03）。 */
function overHundred(policy: Record<string, string>, months: number) {
  const curve = curveOf(policy, Math.max(months, num(policy["E.device.stageMidEnd"]) + 12));
  const month = curve.findIndex((value) => value > 100.000001);
  return month < 0 ? null : { month, value: curve[month] };
}
const OVER_HUNDRED = "App 目前不接受超过 100% 的产能";

export function E3Lifecycle({ ctx }: { ctx: EViewCtx }) {
  const reach = useReach();
  const authorities = useAdminAuth((s) => s.session?.authorities ?? []);
  const [manualOpen, setManualOpen] = useState(false);
  const { pE, e3Loading, e3Error, e3Ready, e3Stats, e3Operations } = ctx;
  const missing = REQUIRED_E3_KEYS.filter((key) => pE(key) === "—");
  const ready = e3Ready && missing.length === 0;

  const header = (
    <PageHeader pageId="E3" title="设备使用与升级置换"
      summary="看设备老化和升级置换，维护产能和抵扣规则。"
      actions={<Button icon={<BookOpen size={15} aria-hidden />} onClick={() => setManualOpen(true)}>操作说明手册</Button>}
      meta={<span className="rd-toolbar"><span>打开时读取，不自动刷新</span>
        <Button variant="ghost" size="sm" loading={e3Loading} icon={<RefreshCw size={14} aria-hidden />} onClick={() => void ctx.refreshE3()}>刷新</Button></span>}
      readOnly={ready && !ctx.canWriteE3 ? "你只能查看；修改规则要有这页的修改权限。" : undefined} />
  );
  const manual = manualOpen && <E3Manual ctx={ctx} onClose={() => setManualOpen(false)} />;

  if (!ready) {
    return <div className="e3p">
      {header}
      {e3Loading && !e3Ready ? <BlockState state="loading" title="正在读取规则和统计…" />
        : e3Error ? <BlockState state="error" title="规则和统计没有读到" detail={`${e3Error.replace(/[。.]+$/, "")}。这页的数字和规则都不显示，避免把旧值当成现在的。`} retryLabel="重新读取" retrying={e3Loading} onRetry={() => void ctx.refreshE3()} />
        : e3Ready ? <BlockState state="error" title={`规则没有读全：缺 ${missing.length} 项`} detail={`缺 ${[...new Set(missing.map(keyName))].slice(0, 6).join("、")}${missing.length > 6 ? " 等" : ""}。读全之前不显示规则，也不能修改，请稍后重新读取或联系后端核对配置。`} retryLabel="重新读取" retrying={e3Loading} onRetry={() => void ctx.refreshE3()} />
        : <BlockState state="loading" title="正在读取规则和统计…" />}
      {manual}
    </div>;
  }

  const policy = Object.fromEntries(REQUIRED_E3_KEYS.map((key) => [key, pE(key)]));
  const s1 = num(pE("E.device.stageEarlyEnd")), s2 = num(pE("E.device.stageMidEnd")), cyc = num(pE("E.device.cycleMonths"));
  const floor = pE("E.device.capacity.floorPct");
  const declining = APPLY_TO_SKUS.filter((s) => pE(`E.device.capacity.applyTo.${s.kind}`) === "参与递减");
  const exempt = APPLY_TO_SKUS.filter((s) => pE(`E.device.capacity.applyTo.${s.kind}`) !== "参与递减");
  const cuts = [1, 2, 3, 4].map((i) => pE(`E.tradein.ladder.cut${i}`));
  const credits = [1, 2, 3, 4, 5].map((i) => pE(`E.tradein.ladder.credit${i}`));
  const tradeinOn = pE("E.tradein.enabled") === "开";
  const stats = e3Stats;
  const lateFrom = s2 + 1;
  const pendingFor = (keys: readonly string[]) => E3_PROPOSALS.find((p) => p.state === "pending" && p.keys.some((key) => keys.includes(key)));
  const proposalOnly = authorities.includes("platform_a2_proposal_create") && !authorities.includes("platform_a2_write");
  const BATCH_BLOCKED = "你的账号只有提案权，后端目前不接受这类账号提交成组修改（已提后端）。单项修改不受影响；这组请有完整审批写权限的同事提交。";

  const effect = (batch: boolean) => <StatusTag tone="progress" filled explain={batch ? E3_APPROVER_BATCH : E3_APPROVER_SINGLE}>批准后生效</StatusTag>;
  const open = (spec: McSpec) => ctx.openActionConfirm(spec);

  // ── 单项（9 个里的 7 个数值/开关、2 个选项）：name、op、paramKey、edit 的校验参数和旧页一样 ──
  const numericBounds = (key: string): { min?: number; max?: number; step?: number } => {
    if (/capacity\.band\dDeltaPct$/.test(key)) return { min: -100, max: 100, step: 0.01 };
    if (/capacity\.floorPct$|ladder\.(cut|credit)\d$/.test(key)) return { min: 0, max: 100, step: 0.01 };
    if (/stageEarlyEnd|stageMidEnd|cycleMonths|maxDevicesPerOrder/.test(key)) return { min: 1, max: 1000000, step: 1 };
    return { min: 0, max: 1000000, step: 1 };
  };
  type Single = { label: string; key: string; unit: string; amplify?: boolean; editKind?: "number" | "select"; options?: string[]; optionLabels?: Record<string, string>;
    title: string; detail: string; impact: string; hint?: string; preview?: (value: string) => ReactNode; coverageLead?: string; facts: ReactNode };
  const single = (s: Single) => open({
    briefKind: "config", name: `${s.label} 调整`, title: s.title, op: "param", paramKey: s.key, amplify: s.amplify ?? false,
    edit: { kind: s.editKind ?? "number", label: "改后", current: pE(s.key), unit: s.unit, options: s.options, optionLabels: s.optionLabels, disallowCurrent: true,
      amplifiesWhen: (value) => e3ConfigAmplifies(policy, { [s.key]: value }), hint: s.hint, preview: s.preview, ...(s.editKind === "select" ? {} : numericBounds(s.key)) },
    detail: `批准后生效。${s.detail}`, effect: effect(false), facts: s.facts, coverageLead: s.coverageLead,
    statedBrief: { impact: s.impact, check: "核对改的是哪一项、现在和改后的值，理由写清依据或工单号。" },
  });
  // ── 成组（5 个）：一个按钮改一组，整组一起提交、一起批准 ──
  type MFField = { key: string; paramKey: string; label: string; placeholder?: string; inputKind?: "number" | "text" | "select"; options?: string[]; min?: number; max?: number; step?: number; wide?: boolean; warnAbove?: number; warnText?: string; explain?: ReactNode; warning?: (value: Record<string, string>) => string | undefined };
  type Multi = { name: string; title: string; fields: MFField[]; ascending?: boolean; hint: string; amplify?: boolean; detail: string; impact: string; coverageLead?: string; facts: ReactNode };
  const multi = (m: Multi) => open({
    briefKind: "config", name: `${m.name} 调整`, title: m.title, op: "param-multi", amplify: m.amplify,
    businessForm: {
      kind: "multi-field", amplifies: (values) => e3ConfigAmplifies(policy, Object.fromEntries(m.fields.map((field) => [field.paramKey, values[field.key]]))), ascending: m.ascending, hint: m.hint, requireAnyChange: true,
      fields: m.fields.map((f) => {
        const bounds = f.inputKind === "number" ? numericBounds(f.paramKey) : {};
        return { key: f.key, label: f.label, current: pE(f.paramKey), placeholder: f.placeholder, inputKind: f.inputKind, options: f.options, min: f.min ?? bounds.min, max: f.max ?? bounds.max, step: f.step ?? bounds.step, wide: f.wide, warnAbove: f.warnAbove, warnText: f.warnText, explain: f.explain, warning: f.warning };
      }),
    },
    paramKeys: m.fields.map((f) => ({ key: f.key, paramKey: f.paramKey })),
    detail: `批准后生效。${m.detail}`, effect: effect(true), facts: m.facts, coverageLead: m.coverageLead,
    statedBrief: { impact: m.impact, check: "核对这一组每一项的现在和改后，理由写清依据或工单号。这一组所有值都会发送，没改的按现在的值。" },
  });
  const unsettledFor = (keys: readonly string[]) => E3_PROPOSALS.find((p) => (p.state === "unknown" || p.state === "expired") && p.keys.some((key) => keys.includes(key)));
  const pendingTag = (keys: readonly string[]) => {
    const p = pendingFor(keys), u = unsettledFor(keys);
    if (u) return <StatusTag tone="warn" explain={`${u.label}：${u.at} 提交的结果还没确认，先在页面上方查询原操作。`}>结果未确认</StatusTag>;
    return p && <StatusTag tone="progress" icon={Clock3} explain={`${p.label}：已提交申请，等另一位管理员批准，批准前仍按现在的值执行。提交于 ${p.at}。`}>待批准</StatusTag>;
  };
  const adjust = (keys: readonly string[], onClick: () => void, batch = false, label = "调整") => ctx.canWriteE3
    ? (describedBy: string | undefined) => <Button size="sm" aria-describedby={describedBy} onClick={onClick}
        disabledReason={unsettledFor(keys) ? "这一项有一次提交结果未确认，先在页面上方查询原操作" : pendingFor(keys) ? "这一项有一张待批准的申请，批准或驳回后才能再改" : batch && proposalOnly ? BATCH_BLOCKED : undefined}>{label}</Button>
    : undefined;

  // ── 产能的预览：改后第几个月是多少，超过 100% 时写 App 现状 ──
  const keyMonths = [...new Set([s1, s2, cyc])];
  const capPreview = (key: string) => (value: string) => {
    const next = { ...policy, [key]: value };
    const over = overHundred(next, cyc);
    return <>
      <span>改后第 {keyMonths.join("、")} 月：{keyMonths.map((m) => capText(capacityAt(next, m))).join("、")}（现在 {keyMonths.map((m) => capText(capacityAt(policy, m))).join("、")}）。只对参与下降的 {declining.length} 类商品生效。</span>
      {over && <span className="e3p-warn" role="status">{OVER_HUNDRED}：按这个值，第 {over.month} 月起超过 100%（{capText(over.value)}）。</span>}
    </>;
  };
  const capFacts = (key: string, stage: string) => <Facts><Fact k="改的是">{stage}</Fact><Fact k="影响谁">参与逐月下降的 {declining.length} 类商品的设备；免递减的始终 100%</Fact></Facts>;
  const bandSingle = (band: 1 | 2 | 3) => {
    const key = `E.device.capacity.band${band}DeltaPct`;
    const stage = band === 1 ? `前期（第 1–${s1} 月）` : band === 2 ? `中期（第 ${s1 + 1}–${s2} 月）` : `后期（第 ${lateFrom} 月起）`;
    single({ label: NAMES[key], key, unit: "%", amplify: band === 3, title: `调整${stage.replace(/（.*/, "")}每月变化`,
      detail: `${stage}每月按当前产能乘以（1 + 这个值 ÷ 100）。批准后之后的产能按新值算，不改已发的任务和已结算的收益。`,
      impact: `改${stage}每个月产能变化多少。调高（往正数方向）会让产能更高，平台按产能多付任务收益。`,
      hint: "−100 到 100，最多两位小数；负数是下降，正数是上升", preview: capPreview(key), coverageLead: "调高每月变化会让设备产能更高，平台多付任务收益", facts: capFacts(key, `${stage}每月变化`) });
  };

  // ── 数据 ──
  const ops = e3Operations;
  const okSum = ops.reduce((sum, item) => sum + item.ok, 0), failSum = ops.reduce((sum, item) => sum + item.fail, 0);
  const rate = okSum + failSum > 0 ? `${Number(((okSum / (okSum + failSum)) * 100).toFixed(1))}%` : null;
  const ageMax = Math.max(cyc, Math.ceil(stats?.averageAgeMonths ?? 0), s2 + 1);
  const curve = curveOf(policy, cyc);
  const pendingCurve = pendingFor(["E.device.capacity.band1DeltaPct", "E.device.capacity.band2DeltaPct", "E.device.capacity.band3DeltaPct", "E.device.capacity.floorPct", "E.device.stageEarlyEnd", "E.device.stageMidEnd"]);
  const ledgerHref = "/finance/ledger?keyword=tradein&status=FAILED";
  const lead = E3_PROPOSALS.filter((p) => p.state !== "pending");
  const pendingCount = E3_PROPOSALS.filter((p) => p.state === "pending").length;

  return <div className="e3p">
    {header}
    <Conclusion state={tradeinOn ? "neutral" : "warn"} icon={tradeinOn ? Gauge : undefined}
      explain={<><p>平均月龄和后期台数来自在用设备（已回收、已停用、未激活、已退役的不算），月龄按购买时间、没有时按激活时间算整月。</p><p>后期从第 {lateFrom} 月起，由「中期到第几月」决定。</p></>}
      hint={pendingCount ? `有 ${pendingCount} 张修改申请等批准，批准前按现在的规则执行。` : undefined}>
      {tradeinOn ? "升级置换开启中" : "升级置换已关闭"}：平均月龄 {stats ? `${Number(stats.averageAgeMonths.toFixed(2))} 个月` : "—"}，{stats ? countText(stats.cliffDeviceCount) : "—"} 台已进入后期
    </Conclusion>

    {lead.map((p) => p.state === "unknown"
      ? <Notice key={p.id} tone="warn" title={`${p.label} · 提交结果未确认`} actionBelow
          action={(E3_RECOVERY.lookup || E3_RECOVERY.retry) && <>{E3_RECOVERY.lookup && <Button size="sm" onClick={() => E3_RECOVERY.lookup!(p)}>查询原操作</Button>}{E3_RECOVERY.retry && <Button size="sm" onClick={() => E3_RECOVERY.retry!(p)}>按原操作重试</Button>}</>}>
          原内容、理由和命令号已保存，可能已经生成审批单。先查原操作；查不到再按原内容重试，不会另建一张。原理由：{p.reason}</Notice>
      : p.state === "expired"
        ? <Notice key={p.id} tone="warn" title={`${p.label} · 已超过 24 小时，只能查询`} actionBelow action={E3_RECOVERY.lookup && <Button size="sm" onClick={() => E3_RECOVERY.lookup!(p)}>查询原操作</Button>}>
            {p.at} 提交的这次修改结果一直没确认。超过 24 小时不再重新发送，只能按原命令号查询有没有生成审批单。</Notice>
        : <Notice key={p.id} tone="done" title={`${p.label} · 已驳回`}>审批人没有同意，规则没有变化。要改请重新提交。</Notice>)}

    <StatBand label="设备和升级置换">
      <Stat label="在用设备平均月龄" icon={Hourglass} tone="role-3" value={stats ? String(Number(stats.averageAgeMonths.toFixed(2))) : "—"} unit="个月"
        sub={`第 ${lateFrom} 月起进入后期`} explain="在用设备从购买（没有时从激活）到现在的整月数取平均。已回收、已停用、未激活、已退役的设备不算；没有在用设备时也是 0。" />
      <Stat label="已进入后期的设备" icon={Gauge} tone="role-3" value={stats ? countText(stats.cliffDeviceCount) : "—"} unit="台"
        sub={`月龄满 ${lateFrom} 个月`} explain="只按月龄数，不看设备的实际产能，也不看它的商品是否参与逐月下降，所以不一定都低于 100%。" />
      <Stat label="本月升级置换申请" icon={ArrowLeftRight} tone="role-2" value={stats ? countText(stats.tradeinMonthCount) : "—"} unit="笔"
        explain="本月（按业务日历的月初起）创建的升级置换申请，包括还没完成和被拒绝的。" />
      <Stat label="本月折抵金额" icon={Wallet} tone="role-1" value={stats ? usdtText(stats.tradeinDiscountUsdt).replace(/ USDT$/, "") : "—"} unit="USDT"
        explain="本月申请里的折抵金额合计，包括还没完成的申请。折抵只抵新设备货款，不进用户余额。" />
    </StatBand>

    <div className="rd-split">
      <Panel title="产能随月龄变化" icon={Gauge} tone="role-4" sub={`画到第 ${cyc} 个月`} data-proof="e3-capacity-curve"
        explain={<><p>参与逐月下降的商品，设备第 m 个月的产能 = 100% × 各段（1 + 每月变化 ÷ 100）的连乘，不低于下限 {floor}%。图上按两位小数显示，后端按六位小数算。</p><p>「曲线画几个月」只决定图画多长，不截断用户的产能。</p></>}
        actions={pendingCurve && <StatusTag tone="progress" icon={Clock3}>有待批准的修改</StatusTag>}>
        <div className="e3p-curve">
          <TrendLines label={`产能随月龄变化：第 0 月 100%，第 ${s1} 月 ${capText(curve[s1] ?? 0)}，第 ${s2} 月 ${capText(curve[s2] ?? 0)}，第 ${cyc} 月 ${capText(curve[cyc] ?? 0)}，下限 ${floor}%`}
            ticks={curve.map((_, m) => `${m} 月`)} format={capText} axisFormat={(v) => `${Number(v.toFixed(1))}%`} height={200}
            series={[{ key: "now", label: "现在", slot: 4, values: curve },
              ...(pendingCurve ? [{ key: "pending", label: "批准后", slot: "other" as const, values: curveOf({ ...policy, ...pendingCurve.after }, cyc) }] : [])]}
            marks={[{ key: "floor", text: `下限 ${floor}%`, value: num(floor), tone: "neutral" }]}
            event={{ index: Math.min(s2, cyc), text: `第 ${lateFrom} 月起后期` }} />
          <div className="e3p-age">
            <div className="e3p-age-head"><span>在用设备平均月龄</span><b>{stats ? `${Number(stats.averageAgeMonths.toFixed(2))} 个月` : "—"}</b><span className="e3p-sub">后期区间从第 {lateFrom} 月起</span></div>
            {stats && <ScaleBar label="平均月龄" valueText={`平均 ${Number(stats.averageAgeMonths.toFixed(2))} 个月；前期到第 ${s1} 月，中期到第 ${s2} 月，后期从第 ${lateFrom} 月起`} max={ageMax}
              value={stats.averageAgeMonths} range={{ low: s2, high: ageMax }} tone="role-3"
              ticks={[{ value: 0, text: "0" }, { value: s1, text: `${s1} 月` }, { value: s2, text: `${s2} 月` }, { value: ageMax, text: `${ageMax} 月` }]} />}
          </div>
        </div>
      </Panel>

      <Panel title="最近 24 小时" icon={Clock3} tone="role-2" sub={rate ? `成功率 ${rate}` : "24 小时内没有处理"}
        explain={<><p>按服务器时间往前 24 小时统计。成功率 = 成功 ÷（成功 + 失败），恢复不算进去；三类来源不同，同一台设备可能被算进多类。</p><p>恢复：回收、停用是之后被恢复的次数；置换是 24 小时内回退的申请数。</p><p>这页不代用户换机，也不处理单台设备；单台设备在「设备管理」里看。</p></>}
        actions={reach(ledgerHref, "finance_d4_read") && <Link className="rd-link" href={ledgerHref}>查看失败的置换账单</Link>}>
        <Table label="最近 24 小时的回收、置换、停用">
          <thead><tr><Th>类别</Th><Th align="right">成功</Th><Th align="right">失败</Th><Th align="right">恢复</Th><Th>最近记录</Th></tr></thead>
          <tbody>
            {ops.length === 0 ? <TableMessage columns={5}>24 小时内没有记录</TableMessage> : ops.map((t) => (
              <Tr key={t.nm}>
                <Td>{t.nm}</Td>
                <Td align="right"><span className="e3p-num" data-zero={t.ok === 0 ? "" : undefined}>{countText(t.ok)}</span></Td>
                <Td align="right"><span className="e3p-num" data-zero={t.fail === 0 ? "" : undefined} data-tone={t.fail > 0 ? "danger" : undefined}>{countText(t.fail)}</span></Td>
                <Td align="right"><span className="e3p-num" data-zero={t.roll === 0 ? "" : undefined}>{countText(t.roll)}</span></Td>
                <Td><span className="e3p-latest">{t.ts}<Explain label={`${t.nm}最近记录的说明`} content={<><p>{t.k}：{t.reason}</p><p>失败数大于 0 时标为最近失败，否则标为最新成功，不是逐条最后一次的结果。具体原因到操作记录里查。</p></>} /></span></Td>
              </Tr>))}
          </tbody>
        </Table>
      </Panel>
    </div>

    {proposalOnly && ctx.canWriteE3 && <Notice tone="warn" title="成组修改暂时不能提交">{BATCH_BLOCKED}</Notice>}

    {/* 任务产能节奏：产能随月龄下降（参与任务递减的商品） */}
    <Panel title="产能规则" icon={Gauge} tone="role-4" sub="7 项" data-proof="e3-capacity-rules"
      explain="设备用得越久，能接的任务越少。修改都先提交审批，另一位管理员批准后才生效。">
      <ConfigList label="产能规则">
        {([1, 2, 3] as const).map((band) => {
          const key = `E.device.capacity.band${band}DeltaPct`;
          const name = band === 1 ? `前期 · 第 1–${s1} 月` : band === 2 ? `中期 · 第 ${s1 + 1}–${s2} 月` : `后期 · 第 ${lateFrom} 月起`;
          return <ConfigRow key={key} name={name} value={`每月 ${signed(pE(key))}`} sub={pendingTag([key])}
            what="这一段每个月产能变化多少" when="批准后，之后的产能按新值算" effect="调高（往正数方向）产能更高，平台多付任务收益；调低产能更低。"
            note={band === 3 ? "后期变化最直接影响老设备的收益。" : undefined}
            action={adjust([key], () => bandSingle(band))} />;
        })}
        <ConfigRow name="三段的分界月份" value={`前期到第 ${s1} 月 · 中期到第 ${s2} 月`} sub={<>{pendingTag(["E.device.stageEarlyEnd", "E.device.stageMidEnd", "E.device.cycleMonths"])}<span className="e3p-sub">图上画 {cyc} 个月</span></>}
          what="三段各从第几个月到第几个月，和曲线画几个月" when="三个数一起提交，批准后一起生效" effect="分界往后，下降来得晚；往前，下降来得早。分界改动让某个月产能变高时算多付钱。「曲线画几个月」只影响图。"
          action={adjust(["E.device.stageEarlyEnd", "E.device.stageMidEnd", "E.device.cycleMonths"], () => multi({
            name: "产能分段周期", title: "调整三段的分界月份", ascending: true,
            hint: "要满足：前期到第几月 < 中期到第几月 < 曲线画几个月。",
            detail: "三个数一起提交、一起批准。前两项决定产能分段；曲线画几个月只影响这页图的长度，不截断用户的产能。",
            impact: "改产能三段的分界月份。分界改动让某个月的产能变高时，平台多付任务收益。",
            coverageLead: "这次改动会让某些月份的产能变高，平台多付任务收益",
            facts: <Facts><Fact k="现在">前期到第 {s1} 月，中期到第 {s2} 月，图上画 {cyc} 个月</Fact><Fact k="影响谁">参与逐月下降的 {declining.length} 类商品的设备</Fact></Facts>,
            fields: [
              { key: "early", paramKey: "E.device.stageEarlyEnd", label: "前期截止月", inputKind: "number", placeholder: "3", explain: "前期从第 1 月到这个月。",
                warning: (v) => { const over = overHundred({ ...policy, "E.device.stageEarlyEnd": v.early, "E.device.stageMidEnd": v.mid }, num(v.total)); return over ? `${OVER_HUNDRED}：第 ${over.month} 月起超过 100%。` : undefined; } },
              { key: "mid", paramKey: "E.device.stageMidEnd", label: "中期截止月", inputKind: "number", placeholder: "8", explain: "中期从前期之后到这个月；后期从下一个月开始。" },
              { key: "total", paramKey: "E.device.cycleMonths", label: "曲线显示月数", inputKind: "number", placeholder: "12", explain: "这页的产能图画多少个月，不影响用户的产能。" },
            ],
          }), true)} />
        <ConfigRow name="产能下限" value={`${floor}%`} sub={pendingTag(["E.device.capacity.floorPct"])}
          what="产能降到这里就不再下降" when="批准后，之后的产能按新值算" effect="调高后老设备产能更高，平台多付任务收益。下限只保证产能，不保证一直有任务或收益。"
          action={adjust(["E.device.capacity.floorPct"], () => single({ label: NAMES["E.device.capacity.floorPct"], key: "E.device.capacity.floorPct", unit: "%", title: "调整产能下限",
            detail: "参与下降的设备产能不低于这个值，免递减的始终 100%。下限只保证产能，不保证一直有任务或收益。",
            impact: "改产能最低降到多少。调高后老设备产能更高，平台多付任务收益。", hint: "0 到 100，最多两位小数",
            preview: capPreview("E.device.capacity.floorPct"), coverageLead: "调高下限会让老设备产能更高，平台多付任务收益",
            facts: capFacts("E.device.capacity.floorPct", "产能下限") }))} />
        <ConfigRow name="新机任务补贴天数" value={`${pE("E.device.capacity.subsidyDays")} 天`} sub={pendingTag(["E.device.capacity.subsidyDays"])}
          what="新设备开头这些天，App 显示「补贴中」，不显示产能百分比" where="App 设备卡片" when="批准后，已有设备下次显示也按新天数算"
          effect="只改 App 上的显示，不改产能和收益的计算。从购买时间算起，没有购买时间才从激活时间算。"
          action={adjust(["E.device.capacity.subsidyDays"], () => single({ label: NAMES["E.device.capacity.subsidyDays"], key: "E.device.capacity.subsidyDays", unit: "天", title: "调整新机任务补贴天数",
            detail: "新设备从购买时间（没有时从激活时间）算起这些天，App 显示「补贴中」。只改显示，不改产能和收益。已有设备下次显示也按新天数算。",
            impact: "改 App 显示「补贴中」的天数，不改产能和收益的计算。", hint: "0 到 1,000,000 的整数，0 表示不显示补贴",
            facts: <Facts><Fact k="改的是">新机任务补贴天数</Fact><Fact k="影响谁">参与逐月下降的设备在 App 上的显示</Fact></Facts> }))} />
        <ConfigRow name="哪些商品逐月下降" value={`${declining.length} 类下降 · ${exempt.length} 类始终 100%`}
          sub={<>{pendingTag(APPLY_TO_SKUS.map((s) => `E.device.capacity.applyTo.${s.kind}`))}<span className="e3p-sub">始终 100%：{exempt.map((s) => s.label).join("、") || "无"}<Explain label="逐月下降的商品" content={`按曲线下降：${declining.map((s) => s.label).join("、") || "无"}。`} /></span></>}
          what="每类商品是按上面的曲线下降，还是始终 100%（参与任务递减）" when="八项一起提交，批准后对这类商品的所有设备生效"
          effect="从下降改成始终 100%，这类设备产能更高，平台多付任务收益（上面设成正数增长时相反）。"
          action={adjust(APPLY_TO_SKUS.map((s) => `E.device.capacity.applyTo.${s.kind}`), () => multi({
            name: "产能是否逐月下降（按商品）", title: "调整哪些商品逐月下降",
            hint: "参与递减：按产能曲线逐月下降；免递减：始终 100%。",
            detail: "八类一起提交、一起批准，批准后对这类商品的所有设备生效，不改已结算的收益。",
            impact: "改每类商品的产能是否逐月下降。改成免递减时，这类设备产能更高，平台多付任务收益。",
            coverageLead: "这次改动会让某类设备产能更高，平台多付任务收益",
            facts: <Facts><Fact k="现在下降">{declining.map((s) => s.label).join("、") || "—"}</Fact><Fact k="现在始终 100%">{exempt.map((s) => s.label).join("、") || "—"}</Fact></Facts>,
            fields: APPLY_TO_SKUS.map((s) => ({ key: s.kind, paramKey: `E.device.capacity.applyTo.${s.kind}`, label: s.label, inputKind: "select" as const, options: ["参与递减", "免递减"] })),
          }), true)} />
      </ConfigList>
    </Panel>

    {/* 升级置换阶梯：旧设备按已赚回比例分 5 档抵扣 */}
    <Panel title="升级置换规则" icon={ArrowLeftRight} tone="role-2" sub={tradeinOn ? "开启中" : "已关闭"} data-proof="e3-tradein-rules"
      explain="用户用旧设备抵扣买新设备。按旧设备「已赚回 ÷ 实付价」落在哪一档，按那档比例抵扣实付价；折抵只减新设备的应付，不进余额，最多抵到新设备价格。">
      <ConfigList label="升级置换开关">
        <ConfigRow name="升级置换" value={<StatusTag tone={tradeinOn ? "ok" : "done"}>{tradeinOn ? "开启" : "关闭"}</StatusTag>} sub={pendingTag(["E.tradein.enabled"])}
          what="App 能不能发起升级置换" when="批准后，之后的报价和提交按新开关判断，已完成的不回溯"
          effect="关闭后 App 不再给出报价；开启后用户仍要满足设备、等级和商品的条件。开启算多付钱。"
          action={adjust(["E.tradein.enabled"], () => single({ label: NAMES["E.tradein.enabled"], key: "E.tradein.enabled", unit: "", editKind: "select", options: ["开", "关"], optionLabels: { 开: "开启", 关: "关闭" },
            title: tradeinOn ? "关闭升级置换" : "开启升级置换",
            detail: "开启后用户仍要满足设备、等级和商品条件；关闭后报价和提交都被拒绝。已完成的置换不回溯。",
            impact: "改 App 能不能升级置换。开启后会产生新的折抵，平台少收货款。",
            coverageLead: "开启升级置换会产生新的折抵，平台少收新设备货款",
            facts: <Facts><Fact k="改的是">升级置换开关</Fact><Fact k="本月申请">{stats ? `${countText(stats.tradeinMonthCount)} 笔` : "—"}</Fact></Facts> }))} />
      </ConfigList>

      <div className="e3p-ladder" data-proof="e3-tradein-ladder">
        <div className="e3p-ladder-head">
          <h3>各档抵扣比例<Explain label="分档怎么算" content={<><p>已赚回 ÷ 旧设备实付价，小于界线 1 是第 1 档；等于某条界线就算下一档；不小于界线 4 是第 5 档。</p><p>折抵 = 实付价 × 档位比例，最多抵到新设备价格。</p></>} /></h3>
          {pendingTag([...cuts.map((_, i) => `E.tradein.ladder.cut${i + 1}`), ...credits.map((_, i) => `E.tradein.ladder.credit${i + 1}`)])}
          {ctx.canWriteE3 && <span className="e3p-ladder-actions">
            {adjust(cuts.map((_, i) => `E.tradein.ladder.cut${i + 1}`), () => multi({
              name: "分档界线", title: "调整分档界线", ascending: true,
              hint: "已赚回 ÷ 实付价小于界线 1 是第 1 档，等于界线算下一档，不小于界线 4 是第 5 档。四条要从小到大。",
              detail: "四条界线一起提交、一起批准，批准后对之后的报价和提交生效，已完成的置换不回溯。",
              impact: "改旧设备按已赚回比例分到哪一档。界线往后挪，高抵扣档持续更久，平台多让利。",
              coverageLead: "这次改动会让某些旧设备落进抵扣更多的档，平台多让利",
              facts: <Facts><Fact k="现在">{cuts.map((c) => `${c}%`).join("、")}</Fact><Fact k="各档比例">{credits.map((c) => `${c}%`).join("、")}（这次不改）</Fact></Facts>,
              fields: [
                { key: "cut1", paramKey: "E.tradein.ladder.cut1", label: "界线 1（%）", inputKind: "number", placeholder: "25" },
                { key: "cut2", paramKey: "E.tradein.ladder.cut2", label: "界线 2（%）", inputKind: "number", placeholder: "50" },
                { key: "cut3", paramKey: "E.tradein.ladder.cut3", label: "界线 3（%）", inputKind: "number", placeholder: "75" },
                { key: "cut4", paramKey: "E.tradein.ladder.cut4", label: "界线 4（%）", inputKind: "number", placeholder: "100" },
              ],
            }), true, "调整分档界线")?.(undefined)}
            {adjust(credits.map((_, i) => `E.tradein.ladder.credit${i + 1}`), () => multi({
              name: "各档抵扣比例", title: "调整各档抵扣比例", amplify: true,
              hint: "第 1 档抵扣最多，往后逐档减少；不逐档递减会在批准时被拒绝。",
              detail: "五档一起提交、一起批准，批准后对之后的报价和提交生效，已完成的置换不回溯。超过 75% 是提醒，不是上限。",
              impact: "改每一档抵扣实付价的百分之几。调高任一档，平台多让利。",
              coverageLead: "调高抵扣比例，平台多让利",
              facts: <Facts><Fact k="现在">{credits.map((c) => `${c}%`).join("、")}</Fact><Fact k="分档界线">{cuts.map((c) => `${c}%`).join("、")}（这次不改）</Fact></Facts>,
              fields: [
                { key: "credit1", paramKey: "E.tradein.ladder.credit1", label: "第 1 档（低于界线 1，%）", inputKind: "number", placeholder: "75", warnAbove: 75, warnText: "超过 75% 让利很大，提交前请看一下兑付覆盖率",
                  warning: (v) => [v.credit1, v.credit2, v.credit3, v.credit4, v.credit5].map(Number).some((c, i, all) => i > 0 && !(c < all[i - 1])) ? "五档要逐档递减，不然批准时会被拒绝。" : undefined },
                { key: "credit2", paramKey: "E.tradein.ladder.credit2", label: "第 2 档（%）", inputKind: "number", placeholder: "60", warnAbove: 75, warnText: "超过 75% 让利很大，提交前请看一下兑付覆盖率" },
                { key: "credit3", paramKey: "E.tradein.ladder.credit3", label: "第 3 档（%）", inputKind: "number", placeholder: "45", warnAbove: 75, warnText: "超过 75% 让利很大，提交前请看一下兑付覆盖率" },
                { key: "credit4", paramKey: "E.tradein.ladder.credit4", label: "第 4 档（%）", inputKind: "number", placeholder: "30", warnAbove: 75, warnText: "超过 75% 让利很大，提交前请看一下兑付覆盖率" },
                { key: "credit5", paramKey: "E.tradein.ladder.credit5", label: "第 5 档（超过界线 4，%）", inputKind: "number", placeholder: "15", warnAbove: 75, warnText: "超过 75% 让利很大，提交前请看一下兑付覆盖率" },
              ],
            }), true, "调整抵扣比例")?.(undefined)}
          </span>}
        </div>
        <StepBar label="各档抵扣比例" unit="抵扣" max={100} items={credits.map((credit, i) => ({
          key: `credit${i + 1}`, label: `第 ${i + 1} 档`, value: num(credit), valueText: `${credit}%`,
          name: i === 0 ? `赚回不到 ${cuts[0]}%` : i === 4 ? `赚回 ${cuts[3]}% 及以上` : `赚回 ${cuts[i - 1]}%–${cuts[i]}%`,
        }))} />
        <div className="e3p-cuts">
          <span className="e3p-sub">分档界线（已赚回 ÷ 实付价）</span>
          <ScaleBar label="分档界线" valueText={`第 1 档低于 ${cuts[0]}%；第 2 档 ${cuts[0]}% 到 ${cuts[1]}%；第 3 档 ${cuts[1]}% 到 ${cuts[2]}%；第 4 档 ${cuts[2]}% 到 ${cuts[3]}%；第 5 档 ${cuts[3]}% 及以上`}
            max={Math.max(100, num(cuts[3]))} bands={{ labels: ["第 1 档", "第 2 档", "第 3 档", "第 4 档", "第 5 档"], openEnd: true, marks: cuts.map((c) => ({ value: num(c), text: `${c}%` })) }} />
        </div>
      </div>

      <ConfigList label="谁能换、怎么换">
        <ConfigRow name="谁能升级置换" value={pE("E.tradein.eligibility")} sub={pendingTag(["E.tradein.eligibility"])}
          what="用户等级达到多少才能升级置换" when="批准后，之后的资格判断按新等级" effect="门槛降低，能换的人更多，算多付钱。「全部用户」也仍要满足设备和商品条件。"
          action={adjust(["E.tradein.eligibility"], () => single({ label: NAMES["E.tradein.eligibility"], key: "E.tradein.eligibility", unit: "", editKind: "select", options: ELIGIBILITY, title: "调整谁能升级置换",
            detail: "用用户当前等级和门槛比；选「全部用户」也仍要满足设备、商品库存和上架条件。只影响之后的资格判断。",
            impact: "改升级置换的等级门槛。门槛降低，能换的人更多，平台多让利。",
            coverageLead: "降低等级门槛，能换的人更多，平台多让利",
            facts: <Facts><Fact k="改的是">谁能升级置换</Fact></Facts> }))} />
        <ConfigRow name="只能换更贵的新设备" value={<StatusTag tone={pE("E.tradein.requireHigherPrice") === "开" ? "ok" : "done"}>{pE("E.tradein.requireHigherPrice") === "开" ? "开启" : "关闭"}</StatusTag>} sub={pendingTag(["E.tradein.requireHigherPrice"])}
          what="新设备价格要高于旧设备实付价" when="批准后，之后的报价和提交按新规则" effect="关闭后可以换同价或更便宜的设备，应付可能是 0，算多付钱。"
          action={adjust(["E.tradein.requireHigherPrice"], () => single({ label: "仅限升级更高价设备", key: "E.tradein.requireHigherPrice", unit: "", editKind: "select", options: ["开", "关"], optionLabels: { 开: "开启", 关: "关闭" },
            title: pE("E.tradein.requireHigherPrice") === "开" ? "关闭「只能换更贵的新设备」" : "开启「只能换更贵的新设备」",
            detail: "开启时新设备价格要高于旧设备实付价；关闭后不比价格，可以换同价或更便宜的设备，折抵最多抵到新设备价格，应付可能是 0。仍要换成不同的商品。只影响之后的置换。",
            impact: "改升级置换要不要比价格。关闭后应付可能是 0，平台多让利。",
            coverageLead: "关闭后可以换同价或更便宜的设备，应付可能是 0",
            facts: <Facts><Fact k="改的是">只能换更贵的新设备</Fact></Facts> }))} />
        <ConfigRow name="每单最多抵扣台数" value={`${pE("E.tradein.maxDevicesPerOrder")} 台`}
          sub={<>{pendingTag(["E.tradein.maxDevicesPerOrder"])}{num(pE("E.tradein.maxDevicesPerOrder")) !== 1 && <StatusTag tone="neutral" icon={Info} explain="App 和后端提交时都只收一台旧设备，这个值大于 1 也只按 1 台处理（已提后端）。">目前每单只按 1 台处理</StatusTag>}</>}
          what="一笔升级置换最多用几台旧设备抵扣" when="批准后，之后的置换按新值判断" effect="目前每单只按 1 台处理；调大算多付钱。"
          action={adjust(["E.tradein.maxDevicesPerOrder"], () => single({ label: "单笔最多抵扣台数", key: "E.tradein.maxDevicesPerOrder", unit: "台", title: "调整每单最多抵扣台数",
            detail: "目前 App 和后端提交时都只收一台旧设备，这个值大于 1 也只按 1 台处理（已提后端）。只影响之后的置换。",
            impact: "改一笔升级置换最多用几台旧设备抵扣。目前每单只按 1 台处理。", hint: "1 到 1,000,000 的整数；目前每单只按 1 台处理",
            coverageLead: "调大台数算多付钱",
            facts: <Facts><Fact k="改的是">每单最多抵扣台数</Fact><Fact k="现在实际">每单只按 1 台处理</Fact></Facts> }))} />
        <ConfigRow name="近 30 天高频置换账户" value={stats ? `${countText(stats.k2ArbitrageHits)} 个` : "—"}
          what="近 30 天完成升级置换 3 次及以上，同期又有佣金或礼品入账的账户数" effect="只是参考计数，不代表这些账户被拦截，也不会自动处理；要核查到「异常套利与刷量排查」。" />
      </ConfigList>
    </Panel>

    <Fold title="目前不生效的参数" icon={PackageOpen} tone="role-other" summary="1 组 · 提示升级的月损失金额，App 目前不读"
      explain="能保存，但 App 目前不读这几个值，改了不会触发任何提示（已提后端接上或退役）。入口保留。">
      <ConfigList label="目前不生效的参数">
        <ConfigRow name="提示升级的月损失金额" value={`入门 ${pE("E.device.taskLock.s1")} · Pro ${pE("E.device.taskLock.pro")} · 机柜 ${pE("E.device.taskLock.rack")} USDT`}
          sub={<>{pendingTag(["E.device.taskLock.s1", "E.device.taskLock.pro", "E.device.taskLock.rack"])}<StatusTag tone="neutral" icon={Info}>目前不生效</StatusTag></>}
          what="设备每月少赚超过这个金额时提示用户升级（入门 / Pro / 机柜三类）" where="App 目前没有读这三个值" when="三个一起提交，批准后保存"
          effect="目前只保存，不会触发升级提示，也不改派单和任务。"
          action={adjust(["E.device.taskLock.s1", "E.device.taskLock.pro", "E.device.taskLock.rack"], () => multi({
            name: "提示升级的月损失金额", title: "调整提示升级的月损失金额",
            hint: "目前只保存：App 不读这三个金额，改了不会触发升级提示。",
            detail: "三个一起提交、一起批准。目前 App 不读这三个值，改了不会触发升级提示（已提后端）。它们是金额，不是派单等待时间。",
            impact: "只保存三个金额，目前不触发任何提示，不改派单和收益。",
            facts: <Facts><Fact k="入门设备">{pE("E.device.taskLock.s1")} USDT</Fact><Fact k="UVELBox Pro">{pE("E.device.taskLock.pro")} USDT</Fact><Fact k="UVELRack">{pE("E.device.taskLock.rack")} USDT</Fact><Fact k="生效情况">目前不生效</Fact></Facts>,
            fields: [
              { key: "s1", paramKey: "E.device.taskLock.s1", label: "入门设备（USDT）", inputKind: "number", placeholder: "40" },
              { key: "pro", paramKey: "E.device.taskLock.pro", label: "UVELBox Pro（USDT）", inputKind: "number", placeholder: "140" },
              { key: "rack", paramKey: "E.device.taskLock.rack", label: "UVELRack（USDT）", inputKind: "number", placeholder: "450" },
            ],
          }), true)} />
      </ConfigList>
    </Fold>
    {manual}
  </div>;
}

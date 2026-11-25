"use client";

/**
 * 首页与网络展示设置（H9）的共用小件：数字写法、增长推算、App 示意框、保存结果提醒。
 * 只排版和按页面给的数现算，不发请求、不判权限、不改提交内容。
 */
import type { ReactNode } from "react";
import Link from "next/link";
import { CircleHelp, Smartphone } from "lucide-react";
import { Change, DiffList, Explain, Fact, Facts, Notice, StatusTag, type DiffRow, type StateTone } from "@/app/components/rd";
import { OPEN_RESULT_LABELS } from "../recovery-panel";
import { businessStamp, businessZone } from "@/lib/admin/business-time";
import { canRetryH9Command, h9CommandRejected, type H9Command } from "@/lib/admin/h9-command";
import { isRetryExpired } from "@/lib/admin/pending-mutation-store";
import { canInvestigateECommand } from "@/lib/admin/e-command-investigation";
import type { FundInvestigationOutcome } from "@/lib/admin/fund-command-investigation";
import { fundRecoveryStatus } from "../fund-command-check";
import type { H9AppDisplay } from "@/lib/admin/h9-client";
import { amountDisplay } from "@/lib/format";

/** App 此刻实际显示的数（读 /public-stats/app-display）：读取中、读到、没读到。 */
export type AppDisplayRead = { state: "loading" } | { state: "ready"; data: H9AppDisplay } | { state: "error"; message: string };

/** 整数、个数：千分位，原值有小数就照写，不舍入。 */
export function count(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const [whole, fraction] = String(value).split(".");
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${fraction ? `.${fraction}` : ""}`;
}

/** 金额：千分位，至少两位小数，原值多出的小数照写，不舍入。单位由调用方写「USD」。 */
/** 金额按全站写法（amountDisplay）：千分位，去掉末尾 0、整数不写小数点，不舍入。读不到写「—」。 */
export function usd(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return amountDisplay(value);
}

/**
 * 首页「累计已发放」的设定值：后端字段 homePaidCurrent 不带币种，App（home-display-stats.vue）在金额前写「$」。
 * 后台自己的显示按 TX-19 写「数字 + 空格 + USD」（重构说明 H9：金额 USD、USD/秒），不换算（BUG-635）；只有「App 上的样子」里 App 显示的数照 App 写。
 */
export const PAID_UNIT = "USD";
export const PAID_UNIT_NOTE = "App 上金额前写 $（例如 $2,865,400.50）；这里按美元写 USD，不换算。这是展示数字，不是真实结算币种。";
export function paid(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? "—" : `${usd(value)} USD`;
}

/** 两个金额相乘：按两边的小数位定精度，避开浮点尾差（28432 × 0.06 = 1,705.92）。 */
export function usdProduct(a: number, b: number): number {
  const places = (value: number) => (String(value).split(".")[1]?.length ?? 0);
  return Number((a * b).toFixed(Math.min(12, places(a) + places(b))));
}

/** 估算出来的每秒金额会除不尽：最多写六位小数，前面加「约」。 */
export function usdApprox(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const fixed = Number(value.toFixed(6));
  return `${fixed === value ? "" : "约 "}${usd(fixed)}`;
}

export const TIME_ZONE_NOTE = () => `时间为${businessZone().label}`;

/** 每秒在下限到上限之间取一个整数（金额按整数分），平均每秒 (下限 + 上限) / 2。 */
export function perSecondAverage(min: number, max: number): number {
  return (min + max) / 2;
}

/** 开启增长后 hours 小时里平均增加多少。 */
export function averageGain(min: number, max: number, hours: number): number {
  return perSecondAverage(min, max) * 3600 * hours;
}

export const HOUR_TICKS = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24];
export const HOUR_LABELS = HOUR_TICKS.map((hour) => (hour === 0 ? "现在" : `${hour} 时`));
export const DAY_TICKS = [0, 3, 6, 9, 12, 15, 18, 21, 24, 27, 30];
export const DAY_LABELS = DAY_TICKS.map((day) => (day === 0 ? "现在" : `${day} 天`));

export type MemberModel = {
  base: number;
  anchorAt: number;
  monthlyPct: number;
  tick?: { intervalSec: number; stepMin: number; stepMax: number };
};

const MONTH_MS = 30 * 24 * 3_600_000;

/**
 * 网络脉搏注册人数，和后端 GrowthPublicStatsService.networkPulse 同一个公式：
 * 设了跳动：基数 + 跳动次数 × (每次最少 + 最多) / 2（取整），每跳一次另有 0–spread 人的固定随机偏移，这里不算偏移；
 * 没设跳动：基数 × (1 + 月增长率) ^ (经过的月数)，取整。超出安全整数时后端返回空，这里也写空。
 */
export function membersAt(model: MemberModel, at: number): number | null {
  if (model.tick) {
    const ticks = Math.floor(Math.max(0, at - model.anchorAt) / (model.tick.intervalSec * 1000));
    const value = model.base + Math.floor(ticks * (model.tick.stepMin + model.tick.stepMax) / 2);
    return Number.isSafeInteger(value) ? value : null;
  }
  const months = Math.max(0, at - model.anchorAt) / MONTH_MS;
  const value = Math.floor(model.base * (1 + model.monthlyPct / 100) ** months);
  return Number.isSafeInteger(value) ? value : null;
}

/** 每跳一次的随机偏移最多几人（后端 tickedMembers 的 spread）。 */
export function memberSpread(stepMin: number, stepMax: number): number {
  const sum = stepMin + stepMax;
  return Math.max(0, Math.min(Math.floor(sum / 2) - stepMin, stepMax - Math.ceil(sum / 2)));
}

/** App 上的样子：一块浅底的卡片，左上角写这是 App 的哪一页（旁边问号讲 App 怎么用这个数），右上角写「展示值」；status 是一句短状态。 */
export function AppPreview({ where, explain, children, status }: { where: ReactNode; explain?: ReactNode; children: ReactNode; status?: ReactNode }) {
  return (
    <figure className="h9-app">
      <figcaption className="h9-app-head">
        <span className="h9-app-where"><Smartphone size={14} aria-hidden />{where}{explain && <Explain label="App 怎么用这个数" content={explain} />}</span>
        <StatusTag tone="neutral" explain="这里的数字只给用户看，不是真实经营数据，不改账户、设备、算力和资金。">展示值</StatusTag>
      </figcaption>
      <div className="h9-app-body">{children}</div>
      {status && <div className="h9-app-status">{status}</div>}
    </figure>
  );
}

/** App 示意卡里的一个数：名称在上，数字放大，单位跟在后面。 */
export function AppNumber({ label, value, unit, sub, empty }: { label: ReactNode; value: ReactNode; unit?: ReactNode; sub?: ReactNode; empty?: boolean }) {
  return (
    <div className="h9-app-number" data-empty={empty ? "" : undefined}>
      <span className="h9-app-label">{label}</span>
      <span className="h9-app-value">{value}{unit && <small>{unit}</small>}</span>
      {sub && <span className="h9-app-sub">{sub}</span>}
    </div>
  );
}

/** 保存没得到明确结果时怎么归类：只决定页面上写在哪、用什么颜色，不改原逻辑。 */
export type SaveIssueKind = "conflict" | "rejected" | "unknown";

export function saveIssueKind(cause: unknown, conflictCodes: readonly string[], recovering = false): SaveIssueKind {
  if (!h9CommandRejected(cause, recovering)) return "unknown";
  const code = (cause as { reasonCode?: unknown } | null)?.reasonCode;
  if (typeof code === "string" && conflictCodes.includes(code)) return "conflict";
  return "rejected";
}

export type H9RecoveryRow = {
  key: string;
  /** 改的是哪一块。 */
  name: string;
  /** 从多少改到多少，人话。 */
  change: ReactNode;
  /** 提交时间（毫秒）。 */
  submittedAt: number;
  /** 查询后这一行的标签和结论（共用 fundRecoveryStatus）；没有时是「结果未知」。 */
  status?: { tone: StateTone; label: string; line: string; more?: string };
  /** 结论句后面的「技术信息」。 */
  tech?: ReactNode;
  actions: ReactNode;
};

/** 这一行怎么说：共用面板的标签和句子（没查过是「结果未知」或「已过期」）。查询失败的原因放标签的问号里。 */
export function h9Status(record: H9Command, outcome: FundInvestigationOutcome | undefined, canWrite: boolean) {
  const shown = fundRecoveryStatus({ outcome, expired: isRetryExpired(record), canRetry: canRetryH9Command(record) && canWrite, canQuery: true, canClose: canInvestigateECommand("growth_h9_read") });
  return { ...shown, more: shown.more ?? (outcome && "error" in outcome ? outcome.error : undefined) };
}

/**
 * 结果未知的提醒：逐条写改的是哪一块、从多少到多少、什么时候提交的，按钮在每条的右边。
 * 页面传入「查询原结果」「按原操作重试」，由原请求记录决定可用性；本件不解除记录。
 */
export function H9RecoveryNotice({ rows, explain }: { rows: readonly H9RecoveryRow[]; explain: ReactNode }) {
  if (rows.length === 0) return null;
  const open = rows.every(row => row.status && OPEN_RESULT_LABELS.includes(row.status.label));
  return (
    <Notice tone="warn" title={<>{open ? "保存还没结案" : "保存的结果未知"}<Explain label="结果未知怎么处理" content={explain} /></>}>
      <ul className="h9-recovery" aria-label="结果未知的保存">
        {rows.map((row) => (
          <li key={row.key}>
            <span className="h9-recovery-name">{row.name}</span>
            <span className="h9-recovery-change">{row.change}</span>
            <span className="h9-recovery-time">{businessStamp(row.submittedAt)} 提交</span>
            {row.status ? <StatusTag tone={row.status.tone} explain={row.status.more}>{row.status.label}</StatusTag> : <StatusTag tone="warn" icon={CircleHelp}>结果未知</StatusTag>}
            <span className="h9-recovery-actions">{row.actions}</span>
            {row.status && <span className="h9-recovery-note" role="status">{row.status.line} {row.tech}</span>}
          </li>
        ))}
      </ul>
      <p className="h9-recovery-zone">{TIME_ZONE_NOTE()}</p>
    </Notice>
  );
}

/** 每块参数底下的操作行：左边写现在的状态（改了几项、哪里填错），右边是按钮。 */
export function ModuleToolbar({ note, tone, children }: { note: ReactNode; tone?: "warn"; children: ReactNode }) {
  return (
    <div className="rd-toolbar h9-toolbar" data-end="">
      <span className="rd-toolbar-note" data-tone={tone}>{note}</span>
      {children}
    </div>
  );
}

/** 页尾：修改记录去哪看（L01）。目标页自己判断能不能看。 */
export function AuditFoot() {
  return <p className="h9-foot">每次保存都记进 <Link href="/platform/audit" className="rd-link" prefetch={false}>操作记录与审批</Link>。</p>;
}

/** 图的纵轴刻度：大数写成「万」「亿」，不让刻度字挤出图外；完整的数在悬停和图下的一句里。 */
export function axisShort(unit: string) {
  return (value: number) => {
    const abs = Math.abs(value);
    const text = abs >= 1e8 ? `${Number((value / 1e8).toFixed(2))} 亿` : abs >= 1e4 ? `${Number((value / 1e4).toFixed(1))} 万` : count(Math.round(value));
    return `${text}${unit ? ` ${unit}` : ""}`;
  };
}

/**
 * 确认框里的事实块和改动：只改了一项时写成事实块里的一行「名称 现在 → 改后」，不丢名称；改了几项时事实块下面接 DiffList。
 * 外面包 rd-stack，块和块之间统一 12。
 */
export function ConfirmFacts({ facts, rows, rest, children }: { facts: ReactNode; rows: readonly DiffRow[]; rest?: string; children?: ReactNode }) {
  const changed = rows.filter((row) => row.before !== row.after);
  const single = changed.length === 1 ? changed[0] : null;
  return (
    <div className="rd-stack">
      <Facts>
        {facts}
        {single && <Fact k={typeof single.label === "string" ? single.label : "改动"}><Change from={single.before} to={single.after} /></Fact>}
      </Facts>
      {single?.note && <p className="h9-confirm-note">{single.note}</p>}
      {!single && <DiffList rows={rows} emptyNote="参数没有改动" restTitle={rest} />}
      {children}
    </div>
  );
}

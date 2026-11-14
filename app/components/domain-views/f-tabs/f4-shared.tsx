"use client";

/**
 * F4 奖励池、名额与排行榜（改版）三块共用的写法：金额、人数、时间、业务时区、「结果未知」逐条提醒。
 * 只管显示，不算业务口径：金额按接口原值写（千分位、去掉补的末尾 0、至少两位小数、不舍入），空值写「—」。
 */
import type { ReactNode } from "react";
import { CircleHelp } from "lucide-react";
import { Explain, Notice, StatusTag } from "@/app/components/rd";
import { businessOffsetMinutes, businessStamp, businessZone, formatBusinessTimeCompact, type BusinessZone } from "@/lib/admin/business-time";
import { f4Decimal } from "@/lib/admin/f4-money";

/** 接口给的 USDT 金额：保留接口十进制，千分位、至少两位，不舍入、不缩写。 */
export function usdt(value: number | string | null | undefined) {
  return value == null ? "—" : decimalText(f4Decimal(value));
}

/** 后端存的十进制文本（预算、认可金额）：整数部分加千分位，小数原样保留，至少两位。 */
export function decimalText(value: number | string | null | undefined) {
  if (value === null || value === undefined || String(value).trim() === "") return "—";
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(f4Decimal(value) ?? "");
  if (!match) return String(value);
  const fraction = (match[3] ?? "").replace(/0+$/, "").padEnd(2, "0");
  return `${match[1]}${match[2].replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction}`;
}

/** 人数、台数、票数：千分位。编号不用它。 */
export function count(value: number | null | undefined) {
  return value === null || value === undefined || !Number.isFinite(value) ? "—" : value.toLocaleString("en-US");
}

/** 「2026-11-14 10:20」，读不到写「—」。时区由区块标一次。 */
export function stamp(value: string | null | undefined) {
  return formatBusinessTimeCompact(value ?? "", "—");
}

/** 区块标一次的时区说明，比如「北京时间（UTC+8）」。 */
export function zoneNote() {
  const zone = businessZone();
  return `${zone.label}（${zone.offset}）`;
}

const WEEKDAYS: Record<string, string> = { "0": "日", "7": "日", SUN: "日", "1": "一", MON: "一", "2": "二", TUE: "二", "3": "三", WED: "三", "4": "四", THU: "四", "5": "五", FRI: "五", "6": "六", SAT: "六" };

/**
 * 把自动结算的定时表达式写成人话：「每月 1 日 02:00（越南时间，北京时间 03:00）」。
 * 只认 5 段或 6 段、秒为 0、分和时是单个数字、日 / 月 / 星期是「每天」「每月某日」「每周某天」三种写法；别的写法返回 null，页面写「自定义时间」加原文，不猜。
 * 只做显示，后端按原文解析。
 */
export function describeSettleCron(raw: string, settlementZone?: BusinessZone | null): string | null {
  return parseSettleCron(raw, settlementZone)?.text ?? null;
}

export type SettleCadence = "daily" | "weekly" | "monthly";

/**
 * 自动结算多久触发一次，和对运营的提醒。后端每次触发只调一次 injectAndSettleLastClosedWeek：
 * 只结算最近结束的那一周（越南时间周一到周日），这一周已经有发放记录就跳过，不重复发、不补差额。
 * 所以不是「每周某天」时，要写清楚哪些周会自动结算。weekly 不提醒；读不出的写「自定义」。
 */
export function settleCadenceNote(raw: string): { cadence: SettleCadence | "custom"; tone: "warn" | "neutral"; text: string; short: string; tag: string } | null {
  if (!raw.trim()) return null;
  const cadence = parseSettleCron(raw)?.cadence ?? "custom";
  if (cadence === "weekly") return null;
  if (cadence === "monthly") return { cadence, tone: "warn",
    text: "按现在的设置每月只自动结算一次，每次只结算最近结束的那一周；其余各周不会自动结算，要靠「提前结算本周池」。",
    short: "自动结算每月只结算一次，其余各周要靠提前结算", tag: "每月只自动结算一次" };
  if (cadence === "daily") return { cadence, tone: "neutral",
    text: "按现在的设置每天都触发，每次只结算最近结束的那一周；这一周已经结算过就跳过，不会重复发，也不补后来的差额。",
    short: "自动结算每天触发，每周只结算一次", tag: "每天触发，每周只结一次" };
  return { cadence, tone: "warn",
    text: "页面读不出这个时间多久触发一次；每次触发只结算最近结束的那一周。",
    short: "自动结算时间读不出多久触发一次，每次只结算最近结束的一周", tag: "读不出多久触发一次" };
}

function parseSettleCron(raw: string, settlementZone?: BusinessZone | null): { text: string | null; cadence: SettleCadence } | null {
  const parts = raw.trim().split(/\s+/);
  const fields = parts.length === 5 ? ["0", ...parts] : parts;
  if (fields.length !== 6) return null;
  const [sec, min, hour, dom, month, dow] = fields.map((f) => f.toUpperCase());
  if (sec !== "0" || !/^\d{1,2}$/.test(min) || !/^\d{1,2}$/.test(hour) || month !== "*") return null;
  const m = Number(min), h = Number(hour);
  if (m > 59 || h > 23) return null;
  const any = (f: string) => f === "*" || f === "?";
  let day: string, cadence: SettleCadence;
  if (any(dom) && any(dow)) { day = "每天"; cadence = "daily"; }
  else if (/^\d{1,2}$/.test(dom) && Number(dom) >= 1 && Number(dom) <= 31 && any(dow)) { day = `每月 ${Number(dom)} 日`; cadence = "monthly"; }
  else if (any(dom) && WEEKDAYS[dow]) { day = `每周${WEEKDAYS[dow]}`; cadence = "weekly"; }
  else return null;
  // Spring accepts days 29–31 but skips months where that date does not exist.
  // The existing "每月只自动结算一次" copy cannot describe that schedule exactly.
  if (cadence === "monthly" && Number(dom) > 28) return null;
  if (!settlementZone) return { text: null, cadence };
  const clock = (total: number) => `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
  const local = h * 60 + m;
  const zone = businessZone();
  const shifted = local - businessOffsetMinutes(settlementZone) + businessOffsetMinutes(zone);
  const page = shifted === local ? "" : `，${zone.label} ${shifted >= 1440 ? "次日 " : shifted < 0 ? "前一天 " : ""}${clock(((shifted % 1440) + 1440) % 1440)}`;
  return { text: `${day} ${clock(local)}（${settlementZone.label}${page}）`, cadence };
}

export type F4RecoveryRow = {
  key: string;
  /** 改的是什么。 */
  name: string;
  /** 从多少到多少，或这次提交的内容。 */
  change: ReactNode;
  submittedAt?: number;
  tag: ReactNode;
  /** 在等批准（不是结果未知、也没过期）。标题按这个分开说。 */
  pending?: boolean;
  actions?: ReactNode;
};

/** 结果未知：提交时没收到确定结果。直接记录的写操作和走审批的申请各一句。 */
export function unknownTag(kind: "direct" | "approval") {
  return <StatusTag tone="warn" icon={CircleHelp} explain={kind === "direct"
    ? "提交时没收到确定结果，可能已经记录。24 小时内可以按原请求重试，后端认得出是同一次提交，不会记两次。"
    : "提交时没收到确定结果，可能已经建了审批单。可以查询原结果；按原请求重试不会建第二张。"}>结果未知</StatusTag>;
}

/**
 * 页面最上方的「结果未知」逐条提醒（全站-结果未知叫法）：改的是什么、改成什么、什么时候提交的、现在什么状态、按钮。
 * 行由页面用本机保存的原记录拼好传进来；按钮调用已有的恢复入口，不在这里发请求。没有行时不显示。
 */
export function F4RecoveryNotice({ rows }: { rows: F4RecoveryRow[] }) {
  if (!rows.length) return null;
  return (
    <Notice tone={rows.every((row) => row.pending) ? "progress" : "warn"} title={<>{rows.every((row) => row.pending) ? `${rows.length} 项申请在等批准` : `有 ${rows.length} 项原操作还没有结论`}<Explain label="原操作怎么处理" content="原请求和理由都保留在这台电脑上。按原请求重试只会用原内容，不能改；有了确定结论（成功、被拒或审批结束）这一项才会清掉。" /></>}>
      <ul className="f4-recovery" aria-label="还没有结论的原操作">
        {rows.map((row) => (
          <li key={row.key}>
            <span className="f4-recovery-name">{row.name}</span>
            <span className="f4-recovery-change">{row.change}</span>
            <span className="f4-recovery-time">{row.submittedAt === undefined ? "" : `${businessStamp(row.submittedAt)} 提交`}</span>
            <span className="f4-recovery-state">{row.tag}</span>
            <span className="f4-recovery-actions">{row.actions}</span>
          </li>
        ))}
      </ul>
      <p className="f4-recovery-zone">提交时间为{zoneNote()}</p>
    </Notice>
  );
}

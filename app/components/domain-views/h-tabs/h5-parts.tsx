"use client";

/**
 * H5 签到与UVT奖励的排版件：七天签到条、连签奖励线、原操作提醒列表、数字写法。
 * 只负责画：数字、文字和按钮由页面算好传进来，这里不发请求、不判权限、不判方向。
 */
import type { ReactNode } from "react";
import { CircleHelp, Clock3, Gift, Hourglass } from "lucide-react";
import { Explain, Notice, StatusTag } from "@/app/components/rd";
import { businessStamp, businessZone } from "@/lib/admin/business-time";

export type { CheckInRule, StreakMilestone, PowerUp, EarnMilestone, H5Model } from "@/lib/admin/h5-contract";

/** 整数加千分位；不是数字的原样返回。 */
export function countText(value: unknown) {
  const n = Number(value);
  return value === null || value === undefined || value === "" || !Number.isFinite(n) ? "—" : n.toLocaleString("en-US", { maximumFractionDigits: 20 });
}

/**
 * 金额照原值写：整数部分加千分位，去掉后端补的末尾 0，至少两位小数，有真实小数位的一位不丢、不舍入。
 * 用原始字符串拆，不经过浮点运算。
 */
export function amountText(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  const raw = String(value).trim();
  const match = raw.match(/^(-?)(\d+)(?:\.(\d+))?$/);
  if (!match) {
    const n = Number(raw);
    if (!Number.isFinite(n)) return raw;
    return amountText(n.toFixed(20).replace(/0+$/, "").replace(/\.$/, ""));
  }
  const [, sign, int, frac = ""] = match;
  const decimals = frac.replace(/0+$/, "").padEnd(2, "0");
  return `${sign}${int.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${decimals}`;
}

/** 「3 天」→ 3；读不出天数时 null。 */
export function dayNumber(day: string) {
  const match = String(day).match(/^\s*(\d+)\s*天/);
  return match ? Number(match[1]) : null;
}

/** 连签奖励的类型名。和后端 kind 小写对上；读不出的写「其他奖励」，不猜。 */
export function rewardKindText(kind?: string) {
  return ({ uvt: "UVT", usdt: "USDT", spin: "转盘票", badge: "徽章", voucher: "代金券" } as Record<string, string>)[String(kind ?? "").toLowerCase()] ?? "其他奖励";
}

/** 奖励名称里还写着旧币名或旧积分（NEX、POINTS、积分）：后端新格式不收，改的时候要换。 */
export function legacyRewardName(reward: string) {
  return /NEX|POINTS|积分/i.test(reward);
}

/**
 * 连签奖励怎么写：名称是旧写法（NEX、积分）时，读模型拿不到真实数量，只写种类，原名称另起一行标「旧名称」；
 * 其他照名称写。只改显示，提交时匹配用的原名称不变。
 */
export function streakRewardView(reward: string, kind?: string, copy: (text: string) => string = (text) => text) {
  return legacyRewardName(reward)
    ? { main: `${rewardKindText(kind)} 奖励`, legacyName: copy(reward) }
    : { main: copy(reward), legacyName: undefined };
}

/** 签到规则的值是不是正整数（PD01：App 只发正整数）。 */
export function positiveInteger(value: string) {
  return /^\s*[1-9]\d*\s*$/.test(value);
}

export type StripMilestone = { key: string; text: ReactNode; kind: string; legacyName?: string };

/**
 * 七天签到条：一格一天，基础奖励、第 7 天加奖、连签到这一天能领的连签奖励标在对应的格子上。
 * 看它能判断：一个用户连签一周，每天拿多少，哪几天多拿。
 */
export function CheckInStrip({ base, baseOk, bonus, bonusOk, milestones, unit = "UVT" }: {
  base: string;
  baseOk: boolean;
  bonus: string;
  bonusOk: boolean;
  /** 第 1–7 天能领的连签奖励，按天放。 */
  milestones: Record<number, StripMilestone[]>;
  unit?: string;
}) {
  return (
    <ol className="h5-strip" aria-label="连签 7 天每天拿多少">
      {Array.from({ length: 7 }, (_, index) => {
        const day = index + 1;
        const extra = milestones[day] ?? [];
        const seventh = day === 7;
        return (
          <li key={day} className="h5-strip-day" data-seventh={seventh ? "" : undefined} data-extra={extra.length ? "" : undefined}>
            <span className="h5-strip-label">第 {day} 天</span>
            <span className="h5-strip-base" data-bad={baseOk ? undefined : ""}>{base}<small>{unit}</small></span>
            {seventh && <span className="h5-strip-bonus" data-bad={bonusOk ? undefined : ""}>+{bonus} {unit}<small>第 7 天加奖</small></span>}
            {extra.map((item) => (
              <span key={item.key} className="h5-strip-gift" data-kind={item.kind}>
                <b>{item.text}</b>
                <small><Gift size={12} aria-hidden />连签奖励</small>
                {item.legacyName && <small className="h5-strip-legacy"><span>旧名称</span><span>{item.legacyName}</span></small>}
              </span>
            ))}
          </li>
        );
      })}
    </ol>
  );
}

export type TrackNode = {
  key: string;
  day: string;
  reward: ReactNode;
  kind: string;
  tags?: ReactNode;
  action?: ReactNode;
};

/**
 * 连签奖励线：按天数先后排的里程碑，一个点一档，点下面是这一档的奖励和按钮。点等距，只表示先后，不按天数比例画。
 * 看它能判断：连签到哪几天有额外奖励、各给什么。
 */
export function MilestoneTrack({ label, nodes }: { label: string; nodes: readonly TrackNode[] }) {
  return (
    <ol className="h5-track" aria-label={label}>
      {nodes.map((node) => (
        <li key={node.key} className="h5-track-node" data-kind={node.kind}>
          <span className="h5-track-dot" aria-hidden />
          <span className="h5-track-day">{node.day}</span>
          <div className="h5-track-card">
            <span className="h5-track-reward">{node.reward}</span>
            {node.tags && <span className="h5-track-tags">{node.tags}</span>}
            {node.action && <span className="h5-track-action">{node.action}</span>}
          </div>
        </li>
      ))}
    </ol>
  );
}

/* ---------------- 原操作提醒（结果未知、待审批、已过期），和 G 域同一排法 ---------------- */

export type H5RecoveryRow = {
  key: string;
  /** 改的是什么：参数名或档位名。 */
  name: string;
  /** 从多少到多少，写人话。 */
  change: ReactNode;
  submittedAt?: number;
  tag: ReactNode;
  ticket?: string;
  actions: ReactNode;
};

export function unknownTag(kind: "direct" | "approval") {
  return <StatusTag tone="warn" icon={CircleHelp} explain={kind === "direct"
    ? "提交时没收到确定结果，可能已经生效。可以查询原结果；24 小时内也可以按原请求重试，不会重复执行。"
    : "提交时没收到确定结果，可能已经建了审批单。可以查询原结果；24 小时内也可以按原请求重试，不会建第二张。"}>结果未知</StatusTag>;
}

export function pendingTag(approver: string, note = "批准前仍按现在的值；审批结束前这页不能再改这一项。") {
  return <StatusTag tone="warn" icon={Clock3} explain={`等${approver}在「操作记录与审批」批准。${note}`}>待审批</StatusTag>;
}

/** 申请已建单，但这次没查到审批进度：只能查询，不会重发。 */
export function acknowledgedTag() {
  return <StatusTag tone="neutral" icon={Clock3} explain="申请已建单，这次没查到审批进度。点「查询原结果」再查；不会重发。">已建单</StatusTag>;
}

export function expiredTag(kind: "direct" | "approval") {
  return <StatusTag tone="neutral" icon={Hourglass} explain={kind === "direct"
    ? "原请求超过 24 小时，不能再重试，只能查询。查询读到的是现在的值，不能据此认定原操作成没成。"
    : "原申请超过 24 小时，不能再重试，只能查询原审批单。查不到时保留原申请和同项修改锁，请到操作记录与审批核对。"}>已过期</StatusTag>;
}

export function H5RecoveryNotice({ title, explain, rows, link }: { title: ReactNode; explain?: ReactNode; rows: H5RecoveryRow[]; link?: ReactNode }) {
  if (rows.length === 0) return null;
  const timed = rows.some((row) => row.submittedAt !== undefined);
  return (
    <Notice tone="warn" title={<>{title}{explain && <Explain label="原操作怎么处理" content={explain} />}</>}>
      <ul className="h5-rec" aria-label="原操作">
        {rows.map((row) => (
          <li key={row.key}>
            <span className="h5-rec-name">{row.name}</span>
            <span className="h5-rec-change">{row.change}</span>
            <span className="h5-rec-time">{row.submittedAt === undefined ? "" : `${businessStamp(row.submittedAt)} 提交`}</span>
            <span className="h5-rec-state">
              {row.tag}
              {row.ticket && <span className="h5-rec-ticket">审批单 <span data-mono>{row.ticket}</span></span>}
            </span>
            <span className="h5-rec-actions">{row.actions}</span>
          </li>
        ))}
      </ul>
      {(timed || link) && <p className="h5-rec-zone">{timed && `提交时间为${businessZone().label}`}{timed && link && " · "}{link}</p>}
    </Notice>
  );
}

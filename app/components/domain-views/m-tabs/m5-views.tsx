"use client";

/** M5 服务规则与话术：页内共用的小块（摘要类型、新客户流程图、结果未知提醒、状态标签）。不发请求、不改数据。 */
import type { ReactNode } from "react";
import { Archive, BellRing, CheckCircle2, CircleHelp, FilePen, MessageSquareText, UserPlus, UsersRound, Timer } from "lucide-react";
import { Explain, Notice, StatusTag, type StateTone } from "@/app/components/rd";
import { businessStamp, businessZone } from "@/lib/admin/business-time";

export type M5Tab = "rules" | "roster" | "welcome" | "content" | "channels";
export type M5ReadState = "loading" | "failed" | "ready";
export type M5RulesSummary = { state: M5ReadState; mode?: "AUTO_RANDOM" | "SUPERVISOR"; inheritance?: "UNCONFIGURED" | "LIMITED" | "UNLIMITED"; depth?: number | null; pending?: boolean };
export type M5PolicySummary = { state: M5ReadState; alert?: number; fallback?: number; groupId?: number | null; groupName?: string | null; pending?: boolean };
export type M5WelcomeSummary = { state: M5ReadState; updatedAt?: string | null; pending?: boolean };

export const MODE_NAME = { AUTO_RANDOM: "首次咨询时按负载自动分配", SUPERVISOR: "客服主管分配" } as const;
export const INHERIT_NAME = { UNCONFIGURED: "未配置", LIMITED: "限定次数", UNLIMITED: "不限制" } as const;

/** 话术、模板的三种状态：已发布客服能选到，草稿只在后台，已归档从可选里拿掉。 */
export function ContentStatusTag({ status }: { status: string }) {
  if (status === "published") return <StatusTag tone="ok" icon={CheckCircle2}>已发布</StatusTag>;
  if (status === "archived") return <StatusTag tone="done" icon={Archive}>已归档</StatusTag>;
  return <StatusTag tone="neutral" icon={FilePen}>草稿</StatusTag>;
}

const minutes = (value: number | undefined) => value === undefined ? "—" : `${value} 分钟`;

/**
 * 一个新客户会经过什么：注册 → 首次咨询 → 等待提醒 → 兜底。值都取已保存的规则和待分配设置，
 * 没读到的节点写「—」，不画成 0。看它能判断：新客户从注册到分到客服要经过哪几步、各等多久。
 */
export function M5Flow({ rules, policy }: { rules: M5RulesSummary; policy: M5PolicySummary }) {
  const ruleReady = rules.state === "ready";
  const policyReady = policy.state === "ready";
  const auto = ruleReady && rules.mode === "AUTO_RANDOM";
  const inherit = !ruleReady ? "—" : rules.inheritance === "UNLIMITED" ? "不限次数" : rules.inheritance === "LIMITED" ? `最多 ${rules.depth ?? "—"} 次` : "未配置";
  const steps: { key: string; icon: typeof UserPlus; when: string; value: ReactNode; what: ReactNode; muted?: boolean; explain: ReactNode }[] = [
    { key: "register", icon: UserPlus, when: "新用户注册", value: inherit, what: "继承邀请人的专属客服",
      explain: "用专属邀请码注册，或邀请人已有专属客服时，注册时就按「邀请来的用户归谁」归给那位客服。继承不到的进待分配，等第一次发消息再分。" },
    { key: "inquiry", icon: MessageSquareText, when: "第一次发消息", value: !ruleReady ? "—" : auto ? "自动分配" : "等主管分配", what: !ruleReady ? "分配方式没读到" : auto ? "在可接单的客服里按负载选" : "客服主管在客服工作台「待分配」里分",
      explain: "选手上客户和待回复会话最少的客服（待回复算两倍），一样少的随机选。只选没暂停接新单、客户没到上限的客服。欢迎语不算客户发消息。" },
    { key: "alert", icon: BellRing, when: "等待提醒", value: policyReady ? minutes(policy.alert) : "—", what: "还没人接，标红提醒主管",
      explain: "只在专属会话的待分配和客服工作台里标红，不另发通知。" },
    { key: "fallback", icon: Timer, when: "超时兜底", value: !ruleReady ? "—" : auto ? "定时重试" : policyReady ? minutes(policy.fallback) : "—", muted: auto,
      what: auto ? "首次咨询没分成的，后台继续重试" : "按负载自动兜底分配，主管事后可以改派",
      explain: "系统约每分钟查一次，时间不精确到秒。没有能接的客服时，客户继续留在待分配。" },
  ];
  return (
    <div className="m5-flow" role="list" aria-label="一个新客户会经过什么">
      {steps.map((step, index) => (
        <div key={step.key} className="m5-flow-step" role="listitem" data-muted={step.muted ? "" : undefined}>
          <div className="m5-flow-head">
            <span className="m5-flow-icon" aria-hidden><step.icon size={16} /></span>
            <span className="m5-flow-when">{index + 1}. {step.when}</span>
            <Explain label={`${step.when}的说明`} content={step.explain} side="top" align="start" />
          </div>
          <div className="m5-flow-value" data-empty={step.value === "—" ? "" : undefined}>{step.value}</div>
          <div className="m5-flow-what">{step.what}</div>
        </div>
      ))}
      <div className="m5-flow-group" role="listitem">
        <UsersRound size={14} aria-hidden />
        <span>没分过组的客户分配时先进</span>
        <strong>{!policyReady ? "—" : policy.groupId == null ? "不设默认接收组" : policy.groupName ?? `组编号 ${policy.groupId}`}</strong>
        <Explain label="默认接收组怎么用" content="只对没有分组、也从没分过组的客户生效，而且这个组要启用、有负责人。已有专属客服的客户不会重新分配。" side="top" align="start" />
      </div>
    </div>
  );
}

export type M5PendingRow = { key: string; name: ReactNode; change: ReactNode; submittedAt: number; expired: boolean; actions: ReactNode;
  /** 这一行的标签和结论句；不传时按有没有过期写。 */
  status?: { tone: StateTone; label: string }; note?: ReactNode };

/** 结果未知的写操作逐条列出（和 G 域、M4 同一个排法）：改的是什么、从什么改成什么、什么时候提交、查询原结果、按原请求重试。 */
export function M5PendingWrites({ rows, explain }: { rows: readonly M5PendingRow[]; explain?: ReactNode }) {
  if (rows.length === 0) return null;
  return (
    <Notice tone="warn" title={<>有 {rows.length} 个操作结果未知<Explain label="结果未知怎么处理" content={explain ?? "提交时没收到确定结果，可能已经生效。24 小时内可以按原请求重试，不会重复执行。页面上的现状证明不了原操作有没有执行。有结论前同一项不能再改。"} /></>}>
      <ul className="m5-pending" aria-label="结果未知的操作">
        {rows.map((row) => (
          <li key={row.key}>
            <span className="m5-pending-name">{row.name}</span>
            <span className="m5-pending-change">{row.change}</span>
            <span className="m5-pending-time">{businessStamp(row.submittedAt)} 提交</span>
            <span>{row.status ? <StatusTag tone={row.status.tone}>{row.status.label}</StatusTag> : row.expired
              ? <StatusTag tone="neutral" icon={CircleHelp} explain="原请求超过 24 小时，不能再重试。">已过期</StatusTag>
              : <StatusTag tone="warn" icon={CircleHelp}>结果未知</StatusTag>}</span>
            <span className="m5-pending-actions">{row.actions}</span>
            {row.note && <span className="m5-pending-note" role="status">{row.note}</span>}
          </li>
        ))}
      </ul>
      <p className="m5-pending-zone">提交时间为{businessZone().label}</p>
    </Notice>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { Clock3, ListChecks, MessageSquare, UserRoundPlus, Users } from "lucide-react";
import { StatBand, Stat, Conclusion, InlineRetry } from "@/app/components/rd";
import type { SessionConvo } from "./data";
import type { MCtx } from "./types";

function durationText(ms: number): string {
  const minutes = Math.max(1, Math.round(Math.abs(ms) / 60000));
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `${hours} 小时${minutes % 60 ? ` ${minutes % 60} 分` : ""}` : `${Math.floor(hours / 24)} 天${hours % 24 ? ` ${hours % 24} 小时` : ""}`;
}

function parse<T>(raw: string | undefined): T[] {
  try { const rows = JSON.parse(raw ?? "[]"); return Array.isArray(rows) ? rows as T[] : []; } catch { return []; }
}

/**
 * M-40: what needs handling right now, above the business statistics. Built from the inbox and advisor
 * data the console already holds; each figure opens the list where it is handled. (Tickets are retired.)
 */
export function M1LiveService({ ctx, alertMinutes = ctx.unboundAlertMinutes ?? 5 }: { ctx: MCtx; alertMinutes?: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 30000); return () => window.clearInterval(timer); }, []);
  const conversationsReady = ctx.pget("I.session.conversationsAvailable") === "1";
  // An unread roster is not an empty one (BUG-122): 0 only comes from a successful read.
  const agentsReady = ctx.pget("I.support.agentsAvailable") === "1", agentsFailed = !agentsReady && ctx.pget("I.support.agentsError") !== "none";
  const facts = useMemo(() => {
    const convos = parse<SessionConvo>(ctx.pget("I.session.convos")).filter((row) => !row.archived && (row.pendingReplyCount ?? 0) > 0);
    const customers = (rows: SessionConvo[]) => new Set(rows.map((row) => String(row.customerId ?? row.id))).size;
    const waiting = convos.filter((row) => !row.ownerUnbound), unassigned = convos.filter((row) => row.ownerUnbound);
    const oldest = Math.min(...convos.map((row) => row.pendingReplySince ?? Infinity));
    const agents = parse<{ enabled?: boolean; status?: string }>(ctx.pget("I.support.agents")).filter((row) => row.enabled !== false && row.status !== "disabled");
    return {
      waiting: customers(waiting), unassigned: customers(unassigned), oldest: Number.isFinite(oldest) ? now - oldest : null,
      agents: agents.length,
    };
  }, [ctx, now]);
  const late = facts.oldest !== null && facts.oldest >= alertMinutes * 60000;
  const dash = (ready: boolean, value: number | string) => ready ? value : "—";
  return <section aria-label="实时服务" className="m1-live-service">
    <Conclusion state={!conversationsReady || !agentsReady ? "unknown" : late ? "warn" : "neutral"} icon={conversationsReady && agentsReady && !late && (facts.waiting || facts.unassigned) ? ListChecks : undefined} hint={!conversationsReady || !agentsReady ? "重读会话或客服名单后再判断。" : facts.waiting || facts.unassigned ? "打开待回复或有留言待分配客户，继续处理会话。" : "可核对分配、客户和负责组资料。"} explain="待回复与有留言待分配按共享未归档会话的客户去重。可接待人数来自当前可用名册，不代表空闲席位。">{!conversationsReady || !agentsReady ? "部分服务数据暂时读不到" : facts.waiting || facts.unassigned ? "有客户正在等待处理" : "当前没有待回复客户"}</Conclusion>
    <StatBand label="实时服务"><Stat label="待回复客户" value={dash(conversationsReady, facts.waiting)} unit="位" icon={MessageSquare} lead href="/service/sessions?tab=pending" explain="当前已绑定且有待回复留言的客户，按客户去重。" />
      <Stat label="最长等待" value={!conversationsReady ? "—" : facts.oldest === null ? "无" : durationText(facts.oldest)} icon={Clock3} tone={late ? "warn" : undefined} href="/service/sessions?tab=pending" explain="从最早待回复留言起计；本地每 30 秒只更新等待时长。" />
      <Stat label="待分配（有留言）" value={dash(conversationsReady, facts.unassigned)} unit="位" icon={UserRoundPlus} href="/service/sessions?tab=unassigned" explain="有待回复留言但尚未绑定的客户，全部池客户见待分配页签。" />
      <Stat label="可接待专属客服" value={dash(agentsReady, facts.agents)} unit="位" icon={Users} explain="名册中已启用且未停用的专属客服人数，不是空闲席位。" sub={agentsFailed ? <InlineRetry label="名单加载失败，重试" onRetry={() => void ctx.refreshContent().catch(() => ctx.toast("客服名单还是没有加载出来，请稍后重试。"))} /> : undefined} />
    </StatBand>
  </section>;
}

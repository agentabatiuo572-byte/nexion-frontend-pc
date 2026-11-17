"use client";

import { useEffect, useMemo, useState } from "react";
import { Clock3, ListChecks, MessageSquare, UserRoundPlus, Users } from "lucide-react";
import { StatBand, Stat, Conclusion, InlineRetry, Drawer, Button, Table, Th, Tr, Td } from "@/app/components/rd";
import { SupportAvatar, advisorAvatarPath } from "./support-avatar";
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

/** Same authorized roster and enabled/status predicate as the live card; no additional read permission. */
export function availableSupportRoster(ctx: MCtx) {
  const ready = ctx.pget("I.support.agentsAvailable") === "1";
  const failure = ctx.pget("I.support.agentsError");
  const state = ready ? "ready" : failure === "permission" ? "permission" : failure && failure !== "none" ? "error" : "loading";
  const rows = ready ? parse<{ adminId: number; name: string; enabled?: boolean; status?: string; assignedUserCount?: number; avatarAssetId?: string; avatarVersion?: number }>(ctx.pget("I.support.agents"))
    .filter(row => row.enabled !== false && row.status !== "disabled") : [];
  return { state, rows };
}

/**
 * M-40: what needs handling right now, above the business statistics. Built from the inbox and advisor
 * data the console already holds; each figure opens the list where it is handled. (Tickets are retired.)
 */
export function M1LiveService({ ctx, alertMinutes = ctx.unboundAlertMinutes ?? 5 }: { ctx: MCtx; alertMinutes?: number }) {
  const [now, setNow] = useState(() => Date.now());
  const [rosterOpen, setRosterOpen] = useState(false);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 30000); return () => window.clearInterval(timer); }, []);
  const conversationsReady = ctx.pget("I.session.conversationsAvailable") === "1";
  // An unread roster is not an empty one (BUG-122): 0 only comes from a successful read.
  const roster = availableSupportRoster(ctx);
  const agentsReady = roster.state === "ready", agentsFailed = roster.state === "error", agentsDenied = roster.state === "permission";
  // 没有名单权限时重读也读不到：结论只按会话判断，不提示重读名单。
  const unknown = !conversationsReady || !agentsReady && !agentsDenied;
  const facts = useMemo(() => {
    const convos = parse<SessionConvo>(ctx.pget("I.session.convos")).filter((row) => !row.archived && (row.pendingReplyCount ?? 0) > 0);
    const customers = (rows: SessionConvo[]) => new Set(rows.map((row) => String(row.customerId ?? row.id))).size;
    const waiting = convos.filter((row) => !row.ownerUnbound), unassigned = convos.filter((row) => row.ownerUnbound);
    const oldest = Math.min(...convos.map((row) => row.pendingReplySince ?? Infinity));
    const agents = availableSupportRoster(ctx).rows;
    return {
      waiting: customers(waiting), unassigned: customers(unassigned), oldest: Number.isFinite(oldest) ? now - oldest : null,
      agents: agents.length,
    };
  }, [ctx, now]);
  const late = facts.oldest !== null && facts.oldest >= alertMinutes * 60000;
  const dash = (ready: boolean, value: number | string) => ready ? value : "—";
  return <section aria-label="实时服务" className="m1-live-service">
    <Conclusion state={unknown ? "unknown" : late ? "warn" : "neutral"} icon={!unknown && !late && (facts.waiting || facts.unassigned) ? ListChecks : undefined} hint={unknown ? "重读会话或客服名单后再判断。" : facts.waiting || facts.unassigned ? "打开待回复或有留言待分配客户，继续处理会话。" : "可核对分配、客户和负责组资料。"} explain="待回复和有留言的待分配客户按还没归档的会话算，同一客户只算一次。可接待人数是名单上能接待的人，不是空闲人数。">{unknown ? "部分服务数据暂时读不到" : facts.waiting || facts.unassigned ? "有客户正在等待处理" : "当前没有待回复客户"}</Conclusion>
    <StatBand label="实时服务"><Stat label="待回复客户" value={dash(conversationsReady, facts.waiting)} unit={conversationsReady ? "位" : undefined} icon={MessageSquare} lead href="/service/sessions?tab=pending" explain="已绑定、有留言等回复的客户，同一客户只算一次。" />
      <Stat label="最长等待" value={!conversationsReady ? "—" : facts.oldest === null ? "无" : durationText(facts.oldest)} icon={Clock3} tone={late ? "warn" : undefined} href="/service/sessions?tab=pending" explain="从最早一条待回复留言算起；页面每 30 秒更新一次等待时长。" />
      <Stat label="待分配（有留言）" value={dash(conversationsReady, facts.unassigned)} unit={conversationsReady ? "位" : undefined} icon={UserRoundPlus} href="/service/sessions?tab=unassigned" explain="有留言等回复、还没分配专属客服的客户；全部待分配客户在「待分配」页签。" />
      <Stat label="可接待专属客服" value={dash(agentsReady, facts.agents)} unit={agentsReady ? "位" : undefined} icon={Users} explain="名册中已启用且未停用的专属客服人数，不是空闲席位。" onOpen={agentsReady ? () => setRosterOpen(true) : undefined} openLabel="查看可接待专属客服名单" sub={agentsFailed ? <InlineRetry label="名单加载失败，重试" onRetry={() => void ctx.refreshContent().catch(() => ctx.toast("客服名单还是没有加载出来，请稍后重试。"))} /> : agentsDenied ? "没有查看客服名单的权限" : undefined} />
    </StatBand>
    {rosterOpen && agentsReady && <Drawer open title="可接待专属客服" sub={`共 ${roster.rows.length} 位`} explain="名册中已启用且未停用的专属客服，不是空闲人数。" onClose={() => setRosterOpen(false)} footer={<Button type="button" onClick={() => setRosterOpen(false)}>返回工作台</Button>}>
      {roster.rows.length ? <Table label="可接待专属客服名单"><thead><Tr><Th scope="col">专属客服</Th><Th scope="col" align="right">现在服务</Th></Tr></thead><tbody>{roster.rows.map(row => <Tr key={row.adminId}>
        <Td><span className="m1-live-roster-name"><SupportAvatar name={row.name} path={row.avatarAssetId ? advisorAvatarPath(row.adminId) : undefined} version={row.avatarVersion} size={24} /><span title={row.name}>{row.name}</span></span></Td>
        <Td align="right">{row.assignedUserCount == null ? "—" : `${row.assignedUserCount} 位客户`}</Td>
      </Tr>)}</tbody></Table> : <p className="rd-note">名册里现在没有可接待的专属客服。</p>}
    </Drawer>}
  </section>;
}

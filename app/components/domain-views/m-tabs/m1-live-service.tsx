"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { SessionConvo } from "./data";
import type { MCtx } from "./types";
import { durationText } from "@/lib/admin/support-sla";

function parse<T>(raw: string | undefined): T[] {
  try { const rows = JSON.parse(raw ?? "[]"); return Array.isArray(rows) ? rows as T[] : []; } catch { return []; }
}

/**
 * M-40: what needs handling right now, above the business statistics. Built from the inbox and advisor
 * data the console already holds; each figure opens the list where it is handled. (Tickets are retired.)
 */
export function M1LiveService({ ctx, alertMinutes = 5 }: { ctx: MCtx; alertMinutes?: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 30000); return () => window.clearInterval(timer); }, []);
  const conversationsReady = ctx.pget("I.session.conversationsAvailable") === "1";
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
  const dash = (ready: boolean, value: number | string) => ready ? value : "-";
  return <section className="m1-live" aria-label="实时服务">
    <h3>实时服务</h3>
    <Link href="/service/sessions?tab=pending" className="m1-live-item"><span>待回复客户</span><strong>{dash(conversationsReady, facts.waiting)}</strong></Link>
    <Link href="/service/sessions?tab=pending" className={`m1-live-item${late ? " alert" : ""}`}><span>最长等待</span><strong>{!conversationsReady ? "-" : facts.oldest === null ? "无" : durationText(facts.oldest)}</strong></Link>
    <Link href="/service/sessions?tab=unassigned" className={`m1-live-item${facts.unassigned ? " alert" : ""}`}><span>待分配（有留言）</span><strong>{dash(conversationsReady, facts.unassigned)}</strong></Link>
    <div className="m1-live-item"><span>可接待专属客服</span><strong>{facts.agents}</strong></div>
  </section>;
}

"use client";

/**
 * M5 服务规则与话术（改版页）。页头一句现在的状态和四格关键数，下面按五件事分页签：
 * 分配规则（流程图 + 规则 + 待分配）、客服接待、欢迎语、话术与模板、会话类别与推送。
 * 每块的读取和提交仍在原来的组件里（m5-service-rules、m5-unbound-policy、m5-welcome-message、m5-scripts），这里只排版面。
 */
import { useCallback, useState } from "react";
import { Headset, MessageCircleHeart, MessageSquareText, Route } from "lucide-react";
import { BlockState, Button, Conclusion, Notice, PageHeader, PageTabs, Stat, StatBand, useTabIds } from "@/app/components/rd";
import { formatBusinessTime } from "@/lib/admin/business-time";
import { M5Scripts, type M5ScriptsSummary } from "./m5-scripts";
import { M5ServiceRules, type MSupportPermission } from "./m5-service-rules";
import { M5UnboundPolicy } from "./m5-unbound-policy";
import { M5WelcomeMessage } from "./m5-welcome-message";
import { M5Flow, type M5PolicySummary, type M5RulesSummary, type M5Tab, type M5WelcomeSummary } from "./m5-views";
import type { MCtx } from "./types";
import { useAdminAuth } from "@/lib/store/admin-auth";

export function M5Page({ ctx, permission, permissionUnknown, hasData, loading, loadError, title, summary, authEpoch }: {
  ctx: MCtx; permission: MSupportPermission; permissionUnknown: boolean; hasData: boolean; loading: boolean; loadError: string | null; title: string; summary: string; authEpoch: number;
}) {
  const manager = permission !== "agent";
  const canWriteM5 = useAdminAuth((s) => Boolean(s.session?.authorities.includes("service_m5_write")));
  const [tab, setTab] = useState<M5Tab>(manager ? "rules" : "content");
  const shownTab: M5Tab = !manager && (tab === "rules" || tab === "roster" || tab === "welcome") ? "content" : tab;
  const ids = useTabIds();
  const [rules, setRules] = useState<M5RulesSummary>({ state: "loading" });
  const [policy, setPolicy] = useState<M5PolicySummary>({ state: "loading" });
  const [welcome, setWelcome] = useState<M5WelcomeSummary>({ state: "loading" });
  const [content, setContent] = useState<M5ScriptsSummary | null>(null);
  const onRules = useCallback((next: M5RulesSummary) => setRules(next), []);
  const onPolicy = useCallback((next: M5PolicySummary) => setPolicy(next), []);
  const onWelcome = useCallback((next: M5WelcomeSummary) => setWelcome(next), []);
  const onContent = useCallback((next: M5ScriptsSummary) => setContent(next), []);

  const auto = rules.mode === "AUTO_RANDOM";
  const rulePending = (rules.pending ? 1 : 0) + (policy.pending ? 1 : 0);
  const pendingCount = rulePending + (welcome.pending ? 1 : 0) + (content?.pending ?? 0);
  const contentReady = hasData && content?.contentAvailable;
  const agentsReady = hasData && content?.agentsAvailable;
  const welcomeDate = welcome.updatedAt ? formatBusinessTime(welcome.updatedAt, { year: "numeric", month: "2-digit", day: "2-digit" }) : null;

  const conclusion = permissionUnknown ? <Conclusion state="unknown">客服查看范围没读到，管理入口先不显示</Conclusion>
    : manager && pendingCount > 0 ? <Conclusion state="warn" hint="先在下面逐条核对；有结论前同一项不能再改。">有 {pendingCount} 次保存结果未知</Conclusion>
      : manager && (rules.state === "loading" || policy.state === "loading") ? <Conclusion state="unknown">正在读取分配规则…</Conclusion>
        : manager && (rules.state === "failed" || policy.state === "failed") ? <Conclusion state="unknown" hint="到「分配规则」页签重新读取。">分配规则读不到，现在不知道新客户怎么分</Conclusion>
          : manager ? <Conclusion state="ok" hint={agentsReady && contentReady ? `${content.agentsOpen} 位客服开放接待，客服回复时能选 ${content.published} 条话术和模板。` : undefined}>
            新客户{auto ? "第一次发消息时按负载自动分配" : `由客服主管分配，等 ${policy.fallback ?? "—"} 分钟没人分就自动兜底`}
          </Conclusion>
            : !hasData ? <Conclusion state="unknown">{loadError ? "话术与模板读不到" : "正在读取话术与模板…"}</Conclusion>
              : <Conclusion state="ok">客服回复时能选 {contentReady ? content.published : "—"} 条话术和模板</Conclusion>;

  const notLoaded = (what: string) => loading && !loadError
    ? <BlockState state="loading" title={`正在读取${what}…`} />
    : <BlockState state="error" title={`${what}读不到`} detail="客服中心的数据没同步成功。" onRetry={() => void ctx.refreshContent()} retryLabel="重新读取" />;

  return (
    <>
      <PageHeader pageId="M5" title={title} summary={summary}
        readOnly={permission === "supervisor" ? canWriteM5 ? "分配规则和欢迎语只有超级管理员能改；客服接待和话术按你的管理范围维护" : "你只能改客服接待的接单设置，其余只能查看" : undefined} />
      {permissionUnknown && <Notice tone="warn" action={<Button size="sm" onClick={() => void ctx.refreshContent()}>重试核对</Button>}>客服查看范围暂时没读到，对客操作和管理入口先不显示。</Notice>}
      {hasData && loadError && <Notice tone="danger" action={<Button size="sm" onClick={() => void ctx.refreshContent()}>重试</Button>}>客服中心有部分数据没同步成功，请稍后重试。</Notice>}
      {conclusion}
      <StatBand label="服务规则与话术现状" fit={!manager}>
        {manager && <Stat icon={Route} tone="role-3" label="新客户怎么分" value={rules.state !== "ready" ? "—" : auto ? "自动分配" : "主管分配"}
          sub={policy.state === "ready" ? auto ? `等 ${policy.alert} 分钟没人接就提醒` : `提醒 ${policy.alert} 分钟 · 兜底 ${policy.fallback} 分钟` : undefined}
          explain="首次咨询的分配方式、提醒和兜底时长。点这一格看完整流程。" onOpen={() => setTab("rules")} openLabel="看分配规则" />}
        {manager && <Stat icon={Headset} tone="role-3" label="开放接待" value={agentsReady ? content.agentsOpen : "—"} unit={agentsReady ? "位" : undefined}
          sub={agentsReady ? `暂停接新单 ${content.agentsBusy} · 共 ${content.agentsTotal} 位` : undefined}
          explain="你能管的客服里开着接待的人数。暂停接新单的不会被自动分配或转接新客户，邀请来的新用户仍会归他。点这一格看客服名册。" onOpen={() => setTab("roster")} openLabel="看客服接待名册" />}
        {manager && <Stat icon={MessageCircleHeart} tone="role-3" label="欢迎语最近修改" value={welcome.state !== "ready" ? "—" : welcomeDate ?? "还没改过"}
          sub={welcome.state === "ready" ? "只影响之后注册的用户" : undefined}
          explain="新用户注册后收到的第一条消息，中文、英语、越南语各一份。点这一格看内容。" onOpen={() => setTab("welcome")} openLabel="看欢迎语" />}
        <Stat icon={MessageSquareText} tone="role-2" label="客服能选的话术和模板" value={contentReady ? content.published : "—"} unit={contentReady ? "条" : undefined}
          sub={contentReady ? `草稿 ${content.draft} · 已归档 ${content.archived}` : undefined}
          explain="已发布的话术和即时回复模板，客服在专属会话里能选到。草稿和已归档的选不到。点这一格看列表。" onOpen={() => setTab("content")} openLabel="看话术与模板" />
      </StatBand>

      <PageTabs label="服务规则与话术内容" ids={ids} value={shownTab} onChange={setTab} items={[
        ...(manager ? [
          { value: "rules" as const, label: "分配规则", count: rulePending || undefined },
          { value: "roster" as const, label: "客服接待" },
          { value: "welcome" as const, label: "欢迎语", count: welcome.pending ? 1 : undefined },
        ] : []),
        { value: "content" as const, label: "话术与模板" },
        { value: "channels" as const, label: "会话类别与推送" },
      ]} />

      {manager && <div {...ids.panel("rules")} hidden={shownTab !== "rules"} className="rd-tab-pane m5-pane">
        <section className="m5-flow-block" aria-label="一个新客户会经过什么">
          <h2 className="m5-block-title">一个新客户会经过什么</h2>
          <M5Flow rules={rules} policy={policy} />
        </section>
        <div className="m5-rules-grid">
          <M5ServiceRules key={authEpoch} permission={permission} onSummary={onRules} />
          <M5UnboundPolicy permission={permission} onSummary={onPolicy} />
        </div>
      </div>}
      {manager && <div {...ids.panel("welcome")} hidden={shownTab !== "welcome"} className="rd-tab-pane m5-pane">
        <M5WelcomeMessage permission={permission} onSummary={onWelcome} />
      </div>}
      <M5Scripts key={authEpoch} ctx={ctx} tab={shownTab} ids={ids} showSeatOperations={false} showSeatProfiles={manager} onSummary={onContent} hasData={hasData}
        fallback={<>
          {manager && <div {...ids.panel("roster")} hidden={shownTab !== "roster"} className="rd-tab-pane m5-pane">{notLoaded("客服名册")}</div>}
          <div {...ids.panel("content")} hidden={shownTab !== "content"} className="rd-tab-pane m5-pane">{notLoaded("话术与模板")}</div>
          <div {...ids.panel("channels")} hidden={shownTab !== "channels"} className="rd-tab-pane m5-pane">{notLoaded("会话类别和推送设置")}</div>
        </>} />
    </>
  );
}

"use client";

/**
 * 「待跟进」页签的挂载处：读名单、管筛选和翻页，把结果交给 m1-todo-list.tsx 画。
 * 视觉项只接了能画出各状态的最小读取（和首页计数同一个接口 filter=TODO，不传 mode）；标 TODO(B-wire) 的地方由接逻辑的代码项补齐。
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { supportClient, isSupportSessionExpired, type SupportCustomer } from "@/lib/admin/m-support-client";
import { operatorNicknameText } from "@/lib/admin/brand-copy";
import { m1CustomerCode } from "./m1-customer-code";
import { M1TodoPanel, TodoHoldNotice, TodoProfileDrawer, type TodoAccess, type TodoConfigLink, type TodoFilter, type TodoListRead, type TodoOption, type TodoRow, type TodoScope } from "./m1-todo-list";

/** 发起会话用的最小对象：只要客户号和名字。 */
export type TodoSessionTarget = { customerId: string; nickname?: string | null };

export function todoRowOf(row: SupportCustomer): TodoRow {
  const code = m1CustomerCode(row.customerId);
  return {
    customerId: row.customerId,
    customerCode: code,
    name: operatorNicknameText(row.displayName || "") || code,
    avatarPath: row.customerAvatarRef ?? undefined,
    agentName: row.agentName ?? null,
    waitingReply: row.waitingReply,
    pendingReplyCount: row.pendingReplyCount,
    waitingReplySinceAt: row.waitingReplySinceAt ?? null,
    // 首次待联系、待维护只在维护开启时算（design-plan 板 4）。
    firstContact: row.maintenanceEnabled && row.firstContact,
    firstContactSinceAt: row.firstContactSinceAt ?? null,
    due: row.maintenanceEnabled && row.due === true,
    maintenanceDueAt: row.maintenanceDueAt ?? null,
    evaluatedAt: row.evaluatedAt ?? null,
    lastLoginAt: row.lastEffectiveAt,
  };
}

/**
 * 页签「待跟进 N」：默认范围的独立读取，不随名单的筛选变（读不到写「—」，读取中不写数）。
 * TODO(B-wire)：和侧栏、顶栏的待办数（use-service-badges.ts）共用同一份 30 秒读取。
 */
export function useTodoTabCount(enabled: boolean, revision: number): number | "—" | undefined {
  const [count, setCount] = useState<number | "—" | undefined>(undefined);
  useEffect(() => {
    setCount(undefined);
    if (!enabled) return;
    const controller = new AbortController();
    void supportClient.customers({ pageNum: 1, pageSize: 1, filter: "TODO", signal: controller.signal })
      .then(page => { if (!controller.signal.aborted) setCount(page.total); })
      .catch(cause => { if (!controller.signal.aborted && !isSupportSessionExpired(cause)) setCount("—"); });
    return () => controller.abort();
  }, [enabled, revision]);
  return count;
}

type Applied = { reason: TodoFilter; groupId: string; agentId: string; keyword: string };
const DEFAULTS: Applied = { reason: "TODO", groupId: "", agentId: "", keyword: "" };

export function M1TodoTab({ mode, groups, agents, access, configLink, checkingId, holdError, onStart, onOpenSessions, onDismissHold, renderProfile }: {
  mode: "ALL" | "MANAGED";
  /** 负责组选项。TODO(B-wire)：按 design-plan 改取组目录（support-group-client.ts），目录读不到只影响这个控件。 */
  groups: TodoOption[];
  /** 客服选项。TODO(B-wire)：按 design-plan 改取客服名册（supportClient.agents，含所选组），名册读不到传 { unavailable }。 */
  agents: TodoOption[] | { unavailable: string };
  access: TodoAccess;
  configLink?: TodoConfigLink;
  checkingId: string | null;
  holdError: TodoSessionTarget | null;
  onStart: (target: TodoSessionTarget) => void;
  /** TODO(B-wire)：去会话页要带待跟进来源（from=todo）和已应用的条件，页头返回和浏览器后退回到这份名单。 */
  onOpenSessions: (target: TodoSessionTarget) => void;
  onDismissHold: () => void;
  /** 现有的管理版客户资料（M3CustomerProfile，来源 M1）。 */
  renderProfile: (customerId: string) => ReactNode;
}) {
  // TODO(B-wire)：原因、组、客服、页码、每页条数写进网址并能还原；关键字只存同账号本次会话（ST-23、ST-24）。
  const [applied, setApplied] = useState<Applied>(DEFAULTS);
  const [keyword, setKeyword] = useState("");
  const [page, setPage] = useState(1), [pageSize, setPageSize] = useState(10);
  const [read, setRead] = useState<TodoListRead>({ state: "loading" });
  const [retry, setRetry] = useState(0);
  const [profileId, setProfileId] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setRead({ state: "loading" });
    void supportClient.snapshot({ pageNum: page, pageSize, filter: applied.reason, keyword: applied.keyword || undefined, groupId: applied.groupId ? Number(applied.groupId) : undefined, agentId: applied.agentId ? Number(applied.agentId) : undefined, signal: controller.signal })
      .then(snapshot => {
        if (controller.signal.aborted) return;
        setRead(!snapshot.customers.available ? { state: "unconfigured" } : { state: "ready", rows: snapshot.customers.records.map(todoRowOf), total: snapshot.customers.total, evaluatedAt: snapshot.overview.evaluatedAt });
      })
      // TODO(B-wire)：403、404（组或客服已不可读）按 ST-38、ST-40 分开写；这里先都按读取失败。
      .catch(cause => { if (!controller.signal.aborted && !isSupportSessionExpired(cause)) setRead({ state: "error" }); });
    return () => controller.abort();
  }, [applied, page, pageSize, retry]);
  const change = (next: Partial<Applied>) => { setProfileId(null); setPage(1); setApplied(previous => ({ ...previous, ...next, ...(next.groupId !== undefined ? { agentId: "" } : {}) })); };
  const groupName = groups.find(option => option.value === applied.groupId)?.label;
  const agentName = Array.isArray(agents) ? agents.find(option => option.value === applied.agentId)?.label : undefined;
  const scope: TodoScope = applied.agentId ? { kind: "agent", name: agentName ?? "账号 " + applied.agentId } : applied.groupId ? { kind: "group", name: groupName ?? "组名未同步" } : mode === "ALL" ? { kind: "all" } : { kind: "managed", groups: groups.length };
  const chips = [
    ...(applied.groupId ? [{ key: "group", label: "负责组：" + (groupName ?? "组名未同步"), onRemove: () => change({ groupId: "" }) }] : []),
    ...(applied.agentId ? [{ key: "agent", label: "客服：" + (agentName ?? "账号 " + applied.agentId), onRemove: () => change({ agentId: "" }) }] : []),
    ...(applied.keyword ? [{ key: "keyword", label: "关键词：" + applied.keyword, onRemove: () => { setKeyword(""); change({ keyword: "" }); } }] : []),
  ];
  const rows = read.state === "ready" ? read.rows : [];
  const profileIndex = rows.findIndex(row => row.customerId === profileId);
  const profileRow = profileIndex >= 0 ? rows[profileIndex] : null;
  const toTarget = (row: TodoRow): TodoSessionTarget => ({ customerId: row.customerId, nickname: row.name });
  const holdNotice = (inDrawer: boolean) => holdError && (holdError.customerId === profileRow?.customerId) === inDrawer
    ? <TodoHoldNotice name={holdError.nickname || m1CustomerCode(holdError.customerId)} onRead={access === "none" ? undefined : () => onOpenSessions(holdError)} onDismiss={onDismissHold} /> : undefined;
  const canClear = applied.reason !== "TODO" || chips.length > 0;
  return <>
    <M1TodoPanel scope={scope} read={read} filter={applied.reason} onFilter={reason => change({ reason })}
      keyword={keyword} onKeyword={setKeyword} onSubmit={() => change({ keyword: keyword.trim() })}
      groupValue={applied.groupId} groupOptions={groups} onGroup={groupId => change({ groupId })}
      agentValue={applied.agentId} agentOptions={agents} onAgent={agentId => change({ agentId })}
      applied={chips} moreCount={[applied.groupId, applied.agentId].filter(Boolean).length} canClear={canClear}
      onClear={() => { setKeyword(""); change(DEFAULTS); }} querying={read.state === "loading"} onRetry={() => setRetry(n => n + 1)} configLink={configLink}
      page={page} pageSize={pageSize} onPage={next => { setProfileId(null); setPage(next); }} onPageSize={size => { setProfileId(null); setPageSize(size); setPage(1); }}
      access={access} checkingId={checkingId} selectedId={profileId}
      onStart={row => onStart(toTarget(row))} onRead={row => onOpenSessions(toTarget(row))} onProfile={row => setProfileId(row.customerId)}
      notice={holdNotice(false)} />
    {profileRow && read.state === "ready" && <TodoProfileDrawer row={profileRow} evaluatedAt={read.evaluatedAt} access={access} checking={checkingId === profileRow.customerId}
      nav={{ hasPrev: profileIndex > 0, hasNext: profileIndex < rows.length - 1, onPrev: () => setProfileId(rows[profileIndex - 1]?.customerId ?? profileId), onNext: () => setProfileId(rows[profileIndex + 1]?.customerId ?? profileId) }}
      holdNotice={holdNotice(true)} onStart={() => onStart(toTarget(profileRow))} onRead={() => onOpenSessions(toTarget(profileRow))} onClose={() => setProfileId(null)}>
      {renderProfile(profileRow.customerId)}
    </TodoProfileDrawer>}
  </>;
}

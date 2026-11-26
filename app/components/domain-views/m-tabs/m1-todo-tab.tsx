"use client";

import { useEffect, useState, type ReactNode } from "react";
import { supportClient, SupportClientError, isSupportSessionExpired, type SupportCustomer } from "@/lib/admin/m-support-client";
import { displayAdminReadError, supportContractReadError } from "@/lib/admin/error-messages";
import { operatorNicknameText } from "@/lib/admin/brand-copy";
import { readTodoLocation, todoListHref, type TodoListLocation } from "@/lib/admin/support-todo-route";
import { allAgents } from "./m1-customer-transfer";
import { m1CustomerCode } from "./m1-customer-code";
import { M1TodoPanel, TodoHoldNotice, TodoProfileDrawer, type TodoAccess, type TodoConfigLink, type TodoListRead, type TodoOptions, type TodoRow, type TodoScope } from "./m1-todo-list";
import type { MCtx } from "./types";

export type TodoSessionTarget = { customerId: string; nickname?: string | null };
export type TodoHoldError = { row: TodoSessionTarget; inDrawer: boolean; canRead: boolean };

function todoRowOf(row: SupportCustomer): TodoRow {
  const code = m1CustomerCode(row.customerId);
  return {
    customerId: row.customerId,
    customerCode: code,
    name: operatorNicknameText(row.displayName || "") || code,
    avatarPath: row.customerAvatarRef ?? undefined,
    agentName: row.agentName ?? null,
    waitingReply: row.waitingReply,
    pendingReplyCount: row.pendingReplyCount,
    waitingReplySinceAt: row.waitingReplySinceAt,
    firstContact: row.maintenanceEnabled && row.firstContact,
    firstContactSinceAt: row.firstContactSinceAt,
    due: row.maintenanceEnabled && row.due === true,
    maintenanceDueAt: row.maintenanceDueAt,
    evaluatedAt: row.evaluatedAt,
    lastLoginAt: row.lastEffectiveAt,
  };
}

type Query = TodoListLocation & { keyword: string };

function initialQuery(keywordKey: string): Query {
  const params = new URLSearchParams(typeof window === "undefined" ? "" : window.location.search);
  let keyword = "";
  if (typeof window !== "undefined" && params.get("entry") !== "overview") {
    try { keyword = sessionStorage.getItem(keywordKey)?.slice(0, 200) ?? ""; }
    catch { /* The browser can deny session storage. */ }
  }
  return { ...readTodoLocation(params), keyword };
}

export function M1TodoTab({ adminId, mode, groups, revision, conversationSnapshot, access, configLink, checkingId, holdError, scopeNotice, onStart, onOpenSessions, onDismissHold, onQueryChanged, renderProfile }: {
  adminId: number;
  mode: "ALL" | "MANAGED";
  groups: TodoOptions;
  revision: number;
  conversationSnapshot: string | undefined;
  access: TodoAccess;
  configLink?: TodoConfigLink;
  checkingId: string | null;
  holdError: TodoHoldError | null;
  scopeNotice?: MCtx["scopeNotice"];
  onStart: (target: TodoSessionTarget, inDrawer: boolean) => void;
  onOpenSessions: (target: TodoSessionTarget) => void;
  onDismissHold: () => void;
  onQueryChanged: () => void;
  renderProfile: (customerId: string) => ReactNode;
}) {
  const keywordKey = "nexion-m1-todo-keyword:" + adminId;
  const [query, setQuery] = useState(() => initialQuery(keywordKey));
  const [keyword, setKeyword] = useState(query.keyword);
  const [result, setResult] = useState<{ query: Query; read: TodoListRead }>();
  const [querying, setQuerying] = useState(true);
  const [retry, setRetry] = useState(0);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [agentDirectory, setAgentDirectory] = useState<{ groupId: string; options: TodoOptions }>();

  useEffect(() => {
    const refresh = () => setRetry(value => value + 1);
    const invalidate = (event: Event) => {
      const customerId = (event as CustomEvent<{ customerId?: string }>).detail?.customerId;
      setProfileId(current => !customerId || current === customerId ? null : current);
      setResult(current => {
        if (!customerId) return undefined;
        if (current?.read.state !== "ready") return current;
        return { ...current, read: { ...current.read, rows: current.read.rows.filter(row => row.customerId !== customerId) } };
      });
    };
    window.addEventListener("support-todo-changed", refresh);
    window.addEventListener("support-scope-invalidated", invalidate);
    return () => {
      window.removeEventListener("support-todo-changed", refresh);
      window.removeEventListener("support-scope-invalidated", invalidate);
    };
  }, []);

  useEffect(() => {
    window.history.replaceState(null, "", todoListHref(query));
    try { sessionStorage.setItem(keywordKey, query.keyword); }
    catch { /* Search remains usable without session storage. */ }
  }, [query, keywordKey]);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    setAgentDirectory(undefined);
    void allAgents(query.groupId ? Number(query.groupId) : undefined, signal)
      .then(rows => {
        if (!signal.aborted) setAgentDirectory({ groupId: query.groupId, options: rows.map(row => ({ value: String(row.adminId), label: row.name })) });
      })
      .catch(cause => {
        if (!signal.aborted && !isSupportSessionExpired(cause)) setAgentDirectory({ groupId: query.groupId, options: { unavailable: displayAdminReadError(cause) } });
      });
    return () => controller.abort();
  }, [query.groupId, revision]);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    setQuerying(true);
    void supportClient.customers({
      pageNum: query.page,
      pageSize: query.pageSize,
      filter: query.reason,
      keyword: query.keyword || undefined,
      groupId: query.groupId ? Number(query.groupId) : undefined,
      agentId: query.agentId ? Number(query.agentId) : undefined,
      signal,
    }).then(page => {
      if (signal.aborted) return;
      if (page.available) {
        const lastPage = Math.max(1, Math.ceil(page.total / query.pageSize));
        if (query.page > lastPage) {
          setQuery({ ...query, page: lastPage });
          return;
        }
      }
      const read: TodoListRead = page.available
        ? { state: "ready", rows: page.records.map(todoRowOf), total: page.total, evaluatedAt: page.evaluatedAt }
        : { state: "unconfigured" };
      if (read.state === "ready") setProfileId(current => read.rows.some(row => row.customerId === current) ? current : null);
      setResult({ query, read });
    }).catch(cause => {
      if (signal.aborted || isSupportSessionExpired(cause)) return;
      const status = cause instanceof SupportClientError ? cause.status === 200 ? cause.apiCode : cause.status : undefined;
      const detail = supportContractReadError(cause) ?? displayAdminReadError(cause);
      setResult({ query, read: { state: status === 403 ? "denied" : status === 404 ? "missing" : "error", detail } });
    }).finally(() => {
      if (!signal.aborted) setQuerying(false);
    });
    return () => controller.abort();
  }, [query, retry, revision, conversationSnapshot]);

  function apply(next: Query) {
    onQueryChanged();
    setProfileId(null);
    setQuery(next);
  }

  const change = (next: Partial<Query>) => apply({ ...query, ...next, page: 1 });
  const agents = agentDirectory?.groupId === query.groupId ? agentDirectory.options : { unavailable: "" };
  const groupName = Array.isArray(groups) ? groups.find(option => option.value === query.groupId)?.label : undefined;
  const agentName = Array.isArray(agents) ? agents.find(option => option.value === query.agentId)?.label : undefined;
  const scope: TodoScope = query.agentId ? { kind: "agent", name: agentName ?? "账号 " + query.agentId }
    : query.groupId ? { kind: "group", name: groupName ?? "组名未同步" }
    : mode === "ALL" ? { kind: "all" } : { kind: "managed", groups: Array.isArray(groups) ? groups.length : null };
  const chips = [
    ...(query.groupId ? [{ key: "group", label: "负责组：" + (groupName ?? "组名未同步"), onRemove: () => change({ groupId: "", agentId: "" }) }] : []),
    ...(query.agentId ? [{ key: "agent", label: "客服：" + (agentName ?? "账号 " + query.agentId), onRemove: () => change({ agentId: "" }) }] : []),
    ...(query.keyword ? [{ key: "keyword", label: "关键词：" + query.keyword, onRemove: () => { setKeyword(""); change({ keyword: "" }); } }] : []),
  ];
  const read: TodoListRead = result?.query === query ? result.read : { state: "loading" };
  const keptTotal = result?.read.state === "ready" && result.read.rows.length > 0 ? result.read.total : undefined;
  const rows = read.state === "ready" ? read.rows : [];
  const profileIndex = rows.findIndex(row => row.customerId === profileId);
  const profileRow = profileIndex >= 0 ? rows[profileIndex] : null;
  const toTarget = (row: TodoRow): TodoSessionTarget => ({ customerId: row.customerId, nickname: row.name });
  const holdNotice = (inDrawer: boolean) => holdError?.inDrawer === inDrawer
    && (inDrawer ? holdError.row.customerId === profileRow?.customerId : rows.some(row => row.customerId === holdError.row.customerId))
    ? <TodoHoldNotice name={holdError.row.nickname || m1CustomerCode(holdError.row.customerId)} onRead={access !== "none" && holdError.canRead ? () => onOpenSessions(holdError.row) : undefined} onDismiss={onDismissHold} /> : undefined;
  const canClear = query.reason !== "TODO" || chips.length > 0;
  const noGroups = mode === "MANAGED" && Array.isArray(groups) && groups.length === 0 && !canClear;
  const selectProfile = (customerId: string | null) => { onQueryChanged(); setProfileId(customerId); };

  return <>
    <M1TodoPanel scope={scope} read={read} filter={query.reason} onFilter={reason => change({ reason })}
      keyword={keyword} onKeyword={setKeyword} onSubmit={() => change({ keyword: keyword.trim() })} draftChanged={keyword.trim() !== query.keyword} appliedKeyword={query.keyword}
      groupValue={query.groupId} groupOptions={groups} onGroup={groupId => change({ groupId, agentId: "" })}
      agentValue={query.agentId} agentOptions={agents} onAgent={agentId => change({ agentId })}
      applied={chips} moreCount={[query.groupId, query.agentId].filter(Boolean).length} canClear={canClear}
      onClear={() => { setKeyword(""); change({ reason: "TODO", groupId: "", agentId: "", keyword: "" }); }}
      querying={querying || read.state === "loading"} keptTotal={keptTotal} onRetry={() => setRetry(n => n + 1)} configLink={configLink} noGroups={noGroups}
      page={query.page} pageSize={query.pageSize} onPage={page => apply({ ...query, page })} onPageSize={pageSize => change({ pageSize })}
      access={access} checkingId={checkingId} selectedId={profileId}
      onStart={row => onStart(toTarget(row), false)} onRead={row => onOpenSessions(toTarget(row))} onProfile={row => selectProfile(row.customerId)}
      notice={scopeNotice ? <TodoHoldNotice message={scopeNotice.text} onDismiss={scopeNotice.dismiss} /> : holdNotice(false)} />
    {profileRow && <TodoProfileDrawer row={profileRow} access={access} checking={checkingId === profileRow.customerId} refreshing={querying}
      nav={{ hasPrev: profileIndex > 0, hasNext: profileIndex < rows.length - 1, onPrev: () => selectProfile(rows[profileIndex - 1]?.customerId ?? profileId), onNext: () => selectProfile(rows[profileIndex + 1]?.customerId ?? profileId) }}
      holdNotice={holdNotice(true)} onStart={() => onStart(toTarget(profileRow), true)} onRead={() => onOpenSessions(toTarget(profileRow))} onClose={() => selectProfile(null)}>
      {renderProfile(profileRow.customerId)}
    </TodoProfileDrawer>}
  </>;
}

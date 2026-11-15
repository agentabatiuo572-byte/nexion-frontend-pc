"use client";

/**
 * M5 话术与模板配置 — 会话类别启停 + 顾问 AutoPushPolicy + 受众圈定 + 话术库 + 即时回复模板(helpdesk 设计稿,由 I9 迁出)。
 * 类别 / 顾问策略 / 话术 / 回复模板读写走后端 content/session-template 接口。
 * I.session.* 为 M 容器传入的视图适配键。
 * ai(Nova)类别推送/模板归 I2,本页只渲染只读「I2 管」。高敏配置:变更走确认 + 理由。
 */
import { useReach } from "@/lib/nav/use-reach";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Archive, CheckCircle2, CircleOff, Headset, Lock, Megaphone, MessageSquareText, MessagesSquare, PauseCircle, Plus, SlidersHorizontal, Upload, Zap } from "lucide-react";
import {
  BlockState, Button, Change, Check, CheckGroup, ConfigList, ConfigRow, DiffField, Explain, Fact, Facts, Field, IrreversibleTag, Modal as RdModal, Notice, NumberInput,
  PageTabs, Pager as RdPager, Panel, StatusTag, Table, TableLoading, TableMessage, Td, Textarea, Th, Tr, useTabIds, type TabIds,
} from "@/app/components/rd";
import { SupportAvatar, advisorAvatarPath } from "./support-avatar";
import { ContentStatusTag, M5PendingWrites, type M5Tab } from "./m5-views";
import { compactSupportBoardValue } from "./support-leaderboard";
import { displayAdminError } from "@/lib/admin/error-messages";
import { Icon, Modal, Toggle, type IconName } from "../design-kit";
import {
  buildM5Command, sendM5Command,
  fetchMAdvisorBindingUsers,
  type MAdvisorBindingUser,
  fetchMSupportAgentsPage,
  scriptGroupLabel,
  type MAdvisorAssignment,
  type MSupportAgentPage,
  type MSupportAgent,
  type MSupportServiceType,
} from "@/lib/admin/m-client";
import { mCommands, type MCommandRecord } from "@/lib/admin/m-pending-commands";
import type { M5Command } from "@/lib/admin/m5-command";
import { MContentReadError } from "@/lib/admin/m-support-read-contract";
import { isExplicitRejection } from "@/lib/admin/explicit-rejection";
import { isDeterministicRejection, OutcomeUnknownError } from "@/lib/admin/outcome-classification";
import { isRetryExpired, RETRY_EXPIRED_TEXT } from "@/lib/admin/pending-mutation-store";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { supportAnalyticsClient } from "@/lib/admin/support-analytics-client";
import { adminShellSessionKey } from "@/lib/admin/shell-authorities";
import {
  type AdvisorScript,
  type SessionCategory,
  type SessionReplyTpl,
  type SessionType,
} from "./data";
import type { ActionConfirmReq, MCtx } from "./types";

const CAT_KEY = (t: SessionType) => `I.session.cat.${t}.enabled`;
const POLICY_KEY = (f: string) => `I.session.advisor.policy.${f}`;
const SCRIPT_KEY = (id: string) => `I.session.script.${id}.status`;
const SCRIPT_AUDIENCE_KEY = (id: string) => `I.session.script.${id}.audience`;
const TPL_KEY = (id: string) => `I.session.tpl.${id}.status`;
const CATEGORY_LIST_KEY = "I.session.categories";
const SCRIPT_LIST_KEY = "I.session.scripts";
const REPLY_TEMPLATE_LIST_KEY = "I.session.replyTemplates";
const AGENT_LIST_KEY = "I.support.agents";
const ASSIGNMENT_LIST_KEY = "I.support.advisorAssignments";
const SUPPORT_AGENT_PAGE_SIZE = 5;
const SUPPORT_USER_PAGE_SIZE = 8;
const SCRIPT_PAGE_SIZE = 5;
const REPLY_TEMPLATE_PAGE_SIZE = 5;
const scriptI18nKey = (id: string) => `conversation.script.${id.toLowerCase()}`;
const templateI18nKey = (id: string) => `conversation.template.${id.toLowerCase()}`;

const DEFAULT_ADVISOR_POLICY = { enabled: "off", delayMs: 1500, cooldownHours: 24, maxPerSession: 1 };
const ADVISOR_AUTOPUSH_EXECUTOR_AVAILABLE = false;

const CAT_ICON: Record<SessionType, IconName> = { advisor: "users", support: "bell", ai: "power" };
const SEAT_LABEL: Record<string, string> = { MANAGER: "客服主管（管理资格）", DEDICATED: "专属客服", GENERAL: "专属客服", SUPERVISOR: "客服主管（管理资格）" };
const seatLabel = (position: string) => Object.hasOwn(SEAT_LABEL, position) ? SEAT_LABEL[position] : position.includes("主管") ? "客服主管（管理资格）" : "专属客服";

function SensTag() {
  return (
    <span className="sens-tag">
      <Icon name="shield" size={12} />
      敏感 · 需理由
    </span>
  );
}
function Sw({ on, onClick, label, disabled = false }: { on: boolean; onClick: () => void; label: string; disabled?: boolean }) {
  return <button type="button" className={`sw${on ? " on" : ""}`} role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={onClick} />;
}
function parseParamArray<T>(raw: string | undefined, fallback: T[]): T[] {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : fallback;
  } catch {
    return fallback;
  }
}
function totalPages(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}
function clampPage(page: number, total: number, pageSize: number): number {
  return Math.min(Math.max(1, page), totalPages(total, pageSize));
}
function pageSlice<T>(rows: T[], page: number, pageSize: number): T[] {
  const start = (clampPage(page, rows.length, pageSize) - 1) * pageSize;
  return rows.slice(start, start + pageSize);
}

function isDedicatedSupportAgent(agent: MSupportAgent): boolean {
  return agent.enabled;
}

/**
 * 自动验收占位内容识别。M5 的自动验收脚本会写入 `M5RA<时间戳> 顾问主动话术` /
 * `M5RA<时间戳> 即时回复模板` 这类编号化文案并归档;它们不是业务草稿也不是正式话术,
 * 正式列表始终筛除这些记录；过滤不会删除或修改原记录。
 */
const AUTO_ACCEPTANCE_PLACEHOLDER = /^M5RA\d{6,}\s*(?:顾问主动话术|即时回复模板)?$/;

function isAutoAcceptancePlaceholder(text: string): boolean {
  return AUTO_ACCEPTANCE_PLACEHOLDER.test(text.trim());
}

function isSupportSupervisor(mode: string | null): boolean {
  return mode === "MANAGED";
}

function Pager({
  page,
  total,
  pageSize,
  onPage,
  available = true,
}: {
  page: number;
  total: number;
  pageSize: number;
  onPage: (page: number) => void;
  available?: boolean;
}) {
  const pages = totalPages(total, pageSize);
  const safePage = clampPage(page, total, pageSize);
  const start = total === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const end = Math.min(total, safePage * pageSize);
  return (
    <div className="row m5-pager" style={{ justifyContent: "flex-end", gap: 8, padding: "10px 12px 4px", borderTop: total > 0 ? "1px solid var(--border)" : "none" }}>
      <span className="dim2" style={{ fontSize: 11.5, marginRight: "auto" }}>
        {!available ? "-" : total === 0 ? "暂无记录" : `${start}-${end} / ${total}`}
      </span>
      <button type="button" className="btn btn-sec btn-sm" disabled={safePage <= 1} onClick={() => onPage(safePage - 1)}>
        <span style={{ display: "inline-flex", transform: "rotate(180deg)" }}><Icon name="chevron" size={14} /></span>
        上一页
      </button>
      <span className="mono" style={{ minWidth: 54, textAlign: "center", fontSize: 12, color: "var(--ink-3)" }}>{available ? `${safePage} / ${pages}` : "-"}</span>
      <button type="button" className="btn btn-sec btn-sm" disabled={safePage >= pages} onClick={() => onPage(safePage + 1)}>
        下一页
        <Icon name="chevron" size={14} />
      </button>
    </div>
  );
}

const POLICY_HINT: Record<string, string> = {
  delayMs: "0–60000 的整数，单位毫秒（1000 毫秒 = 1 秒）",
  cooldownHours: "1–720 的整数，单位小时",
  maxPerSession: "0–20 的整数，单位条",
};

export type M5ScriptsSummary = { contentAvailable: boolean; published: number; draft: number; archived: number; agentsAvailable: boolean; agentsOpen: number; agentsBusy: number; agentsTotal: number; pending: number };

export function M5Scripts({ ctx, tab, ids, showSeatOperations = true, showSeatProfiles = false, onSummary, hasData = true, fallback }: { ctx: MCtx; tab: M5Tab; ids: TabIds; showSeatOperations?: boolean; showSeatProfiles?: boolean; onSummary?: (summary: M5ScriptsSummary) => void; hasData?: boolean; fallback?: ReactNode }) {
  const reach = useReach();
  const { pget, toast } = ctx;
  const [pendingRevision, setPendingRevision] = useState(0);
  const [needsRead, setNeedsRead] = useState(false);
  const [profileRecovery, setProfileRecovery] = useState<MCommandRecord>();
  const restoring = useRef<MCommandRecord | undefined>(undefined);
  const activeConfirm = useRef<{ original?: MCommandRecord }>({});
  const inFlight = useRef(false);
  const currentWrite = useRef<((key: string, value: string, meta: { action: string; reason: string; commandKey?: string }, successMessage: string) => Promise<boolean>) | null>(null);
  const commitM5Write = (key: string, value: string, meta: { action: string; reason: string; commandKey?: string }, successMessage: string) => currentWrite.current!(key, value, meta, successMessage);
  const pendingCommands = pendingRevision === 0 ? [] : mCommands.list().filter(row => row.m5?.actorId === useAdminAuth.getState().session?.adminId
    || !row.m5 && !row.faq && /^cmd\|(?:m5:|I\.session\.(?:cat\.|advisor\.policy\.|script\.|tpl\.|replyTemplates)|I\.support\.agentProfile)/.test(row.fingerprint));
  const syncPending = () => setPendingRevision(value => value + 1);
  useEffect(syncPending, []);
  useEffect(() => {
    const next = pendingCommands.map(row => row.expiresAt).filter(deadline => deadline > Date.now()).sort((a, b) => a - b)[0];
    if (next === undefined) return;
    const timer = window.setTimeout(syncPending, next - Date.now());
    return () => window.clearTimeout(timer);
  }, [pendingCommands]);
  const blocked = (key: string, adminId?: number) => pendingCommands.some(row => !row.m5 || row.m5.resource === (adminId ? `profile:${adminId}` : key));
  const canRetry = (command: M5Command) => Boolean(useAdminAuth.getState().session?.authorities.includes(command.profile ? "service_m1_write" : "service_m5_write"));
  const openActionConfirm = (request: ActionConfirmReq) => {
    const state = { original: restoring.current };
    activeConfirm.current = state;
    ctx.openActionConfirm({ ...request,
      initialReason: state.original?.m5?.reason,
      edit: request.edit && { ...request.edit, initialValue: state.original?.m5 ? recoveredEditValue(state.original.m5) : request.edit.initialValue },
      getPendingReason: () => state.original?.m5 && mCommands.list().some(row => row.commandKey === state.original?.commandKey) ? state.original.m5.reason : undefined,
      blockedReason: state.original && (isRetryExpired(state.original) ? RETRY_EXPIRED_TEXT : state.original.m5 && !canRetry(state.original.m5) ? "当前账号没有查看或操作此功能的权限，请联系管理员核对菜单、按钮和接口权限。" : undefined),
      run: async (reason, value, businessValue) => state.original?.m5
        ? commitOriginal(state.original, true) : request.run(reason, value, businessValue),
    });
  };
  const recoveredEditValue = (command: M5Command) => {
    const body = JSON.parse(command.request.body);
    return command.key.startsWith("I.session.advisor.policy.") ? body.value : body.text;
  };
  const currentRole = useAdminAuth((s) => s.session?.role ?? s.role);
  const currentAdminId = useAdminAuth((s) => s.session?.adminId ?? 0);
  const authorities = useAdminAuth((s) => s.session?.authorities);
  const actorStamp = useAdminAuth((state) => `${adminShellSessionKey(state.session)}:${state.authEpoch}`);
  const [managementScope, setManagementScope] = useState<{ actorStamp: string; mode: string } | null>(null);
  const currentRoleKey = String(currentRole);
  const categories = parseParamArray<SessionCategory>(pget(CATEGORY_LIST_KEY), []).filter(category => category.type !== "support");
  const scripts = parseParamArray<AdvisorScript>(pget(SCRIPT_LIST_KEY), []);
  const replyTemplates = parseParamArray<SessionReplyTpl>(pget(REPLY_TEMPLATE_LIST_KEY), []);
  const supportAgents = useMemo(() => parseParamArray<MSupportAgent>(pget(AGENT_LIST_KEY), []), [ctx.params, pget]);
  const advisorAssignments = useMemo(() => parseParamArray<MAdvisorAssignment>(pget(ASSIGNMENT_LIST_KEY), []), [ctx.params, pget]);
  const audienceOptions = useMemo(() => {
    const rows = parseParamArray<string>(pget("I.session.audienceOptions"), []);
    return rows;
  }, [ctx.params, pget]);
  const defaultAudience = audienceOptions[0] ?? "";
  const scriptFact = (id: string) => <span className="m5-fact-text">{restoring.current?.m5?.text ?? scripts.find((row) => row.id === id)?.text ?? "—"}</span>;
  const templateFact = (id: string) => <span className="m5-fact-text">{restoring.current?.m5?.text ?? replyTemplates.find((row) => row.id === id)?.text ?? "—"}</span>;
  const [profileAgent, setProfileAgent] = useState<MSupportAgent | null>(null);
  const [assignAgent, setAssignAgent] = useState<MSupportAgent | null>(null);
  const [agentPage, setAgentPage] = useState(1);
  const [scriptPage, setScriptPage] = useState(1);
  const [replyTemplatePage, setReplyTemplatePage] = useState(1);
  const [agentPageData, setAgentPageData] = useState<MSupportAgentPage | null>(null);
  const [agentPageLoading, setAgentPageLoading] = useState(false);
  const [agentPageError, setAgentPageError] = useState("");
  const [agentPageRetry, setAgentPageRetry] = useState(0);
  const [writePending, setWritePending] = useState(false);
  const [contentView, setContentView] = useState<"scripts" | "templates">("scripts");
  const contentIds = useTabIds();
  const pendingReplyTemplateDraftIds = useRef(new Map<string, string>());

  const catEnabled = (cat: { type: SessionType; enabled: boolean }): boolean => (pget(CAT_KEY(cat.type)) ?? (cat.enabled ? "on" : "off")) === "on";
  const policyVal = (field: string, def: string | number): string => pget(POLICY_KEY(field)) ?? String(def);
  const scriptStatus = (id: string, def: string): string => pget(SCRIPT_KEY(id)) ?? def;
  const scriptAudience = (id: string): string => pget(SCRIPT_AUDIENCE_KEY(id)) ?? defaultAudience;
  const tplStatus = (id: string, def: string): string => pget(TPL_KEY(id)) ?? def;

  const currentAudience = policyVal("audience", defaultAudience);
  const masterOn = policyVal("enabled", DEFAULT_ADVISOR_POLICY.enabled) === "on";
  const agentSnapshot = useMemo(
    () => supportAgents.map((agent) => `${agent.adminId}:${agent.position}:${agent.serviceTypes.join(",")}:${agent.maxConcurrent}:${agent.enabled}:${agent.busy}:${agent.assignedUserCount}`).join("|"),
    [supportAgents],
  );
  const assignmentSnapshot = useMemo(
    () => advisorAssignments.map((row) => `${row.id}:${row.agentAdminId}:${row.userId}:${row.status}:${row.updatedAt || ""}`).join("|"),
    [advisorAssignments],
  );
  const agentTotal = agentPageData?.total ?? supportAgents.length;
  const visibleSupportAgents = useMemo(
    () => agentPageData?.records ?? pageSlice(supportAgents, agentPage, SUPPORT_AGENT_PAGE_SIZE),
    [agentPageData, supportAgents, agentPage],
  );
  const visibleAdvisorAssignments = agentPageData?.advisorAssignments ?? advisorAssignments;
  const isSuperAdmin = currentRoleKey === "superadmin" || currentRoleKey === "super";
  const hasM1ReadAuthority = isSuperAdmin || Boolean(authorities?.includes("service_m1_read"));
  const agentPageAvailable = Boolean(agentPageData) && !agentPageLoading && !agentPageError && hasM1ReadAuthority && pget("I.support.agentsAvailable") === "1";
  const hasM5WriteAuthority = isSuperAdmin || Boolean(authorities?.includes("service_m5_write"));
  const isContentOperator = currentRoleKey === "content";
  const isSupportM5Supervisor = currentRoleKey === "support" && isSupportSupervisor(managementScope?.actorStamp === actorStamp ? managementScope.mode : null);
  const canManageM5Content = hasM5WriteAuthority && (isSuperAdmin || isContentOperator || isSupportM5Supervisor);
  const canManageM5Operations = hasM5WriteAuthority && (isSuperAdmin || isSupportM5Supervisor);
  const canManageSupportSeats = (isSuperAdmin || Boolean(authorities?.includes("service_m1_write")))
    && (isSuperAdmin || isSupportM5Supervisor);
  const profileRestriction = (agent: MSupportAgent) => isSuperAdmin ? undefined
    : agent.adminId === currentAdminId ? displayAdminError(new Error("SUPPORT_SEAT_ASSIGNMENT_SELF_FORBIDDEN"))
      : agent.seatType === "MANAGER" ? displayAdminError(new Error("SUPPORT_SEAT_MANAGER_ASSIGNMENT_SUPER_ONLY")) : undefined;
  useEffect(() => {
    setManagementScope(null);
    if (!hasM1ReadAuthority || currentRoleKey !== "support" || !currentAdminId) return;
    const controller = new AbortController();
    supportAnalyticsClient.query({ view: "OVERVIEW", pageSize: 1, signal: controller.signal })
      .then((result) => {
        const current = useAdminAuth.getState();
        if (!controller.signal.aborted && actorStamp === `${adminShellSessionKey(current.session)}:${current.authEpoch}`)
          setManagementScope({ actorStamp, mode: result.scopeSummary.mode });
      })
      .catch(() => { /* A denied or unavailable scope grants no management qualification. */ });
    return () => controller.abort();
  }, [actorStamp, hasM1ReadAuthority, currentRoleKey, currentAdminId]);
  const sessionTemplatesAvailable = pget("I.session.templatesAvailable") === "1" && !needsRead && !ctx.contentLoading;
  const policyDisplay = (field: string) => sessionTemplatesAvailable && compactSupportBoardValue(pget(POLICY_KEY(field)), "count") !== "-" ? pget(POLICY_KEY(field)) : "-";
  // M-48: show delays in seconds ("1.5 秒"), not raw milliseconds.
  const delayText = () => { const ms = Number(policyDisplay("delayMs")); return Number.isFinite(ms) ? `${Number((ms / 1000).toFixed(1))} 秒` : "-"; };
  // 正式列表与分页始终排除验收记录；不改变原记录。
  const keptScripts = scripts.filter((row) => !isAutoAcceptancePlaceholder(row.text));
  const keptReplyTemplates = replyTemplates.filter((row) => !isAutoAcceptancePlaceholder(row.text));
  // 分页与计数一律以「筛除占位后」的完整可见集为准:
  // ① 分页条不会声称有 N 条而列表只有几行;
  // ② 若某一服务端分页整页都是占位,真实业务行不会被卡在不可达的后续页。
  // 完整集来自 overview 的全量列表(与服务端分页同源),因此不改变数据权威性。
  const scriptTotal = keptScripts.length;
  const replyTemplateTotal = keptReplyTemplates.length;
  const visibleScripts = pageSlice(keptScripts, scriptPage, SCRIPT_PAGE_SIZE);
  const visibleReplyTemplates = pageSlice(keptReplyTemplates, replyTemplatePage, REPLY_TEMPLATE_PAGE_SIZE);

  const readCurrent = async () => {
    setNeedsRead(true);
    try {
      if (!ctx.refreshM5Content) return false;
      await ctx.refreshM5Content(); setNeedsRead(false); setAgentPageRetry(n => n + 1); return true;
    } catch (cause) { setAgentPageError(displayAdminError(cause)); toast(displayAdminError(cause), "warn"); return false; }
  };
  const commitOriginal = async (record: MCommandRecord, recovered: boolean): Promise<boolean> => {
    const command = record.m5;
    if (!command || inFlight.current || command.actorId !== useAdminAuth.getState().session?.adminId || !canRetry(command)) return false;
    if (isRetryExpired(record)) { toast(RETRY_EXPIRED_TEXT, "warn"); return false; }
    if (!mCommands.isDurablyStored(record.fingerprint, record.commandKey)) {
      if (!recovered) { mCommands.forget(record.fingerprint, record.commandKey); syncPending(); }
      toast(recovered ? "浏览器没能记下这次操作，这次没有发出；之前发出的原操作结果仍未知，请先查询原结果。" : "浏览器没能记下这次操作，这次没有发出；请关闭无痕模式或允许本站保存数据后再试。", "warn"); return false;
    }
    inFlight.current = true; setWritePending(true);
    const epoch = useAdminAuth.getState().authEpoch;
    const current = () => epoch === useAdminAuth.getState().authEpoch && command.actorId === useAdminAuth.getState().session?.adminId;
    try {
      await sendM5Command(command, record.commandKey);
      if (!current()) return false;
      mCommands.forget(record.fingerprint, record.commandKey); syncPending();
      activeConfirm.current.original = undefined;
      ctx.closeActionConfirm?.(); setProfileAgent(null); setProfileRecovery(undefined);
      await readCurrent(); if (!command.profile) toast(command.successMessage); return true;
    } catch (error) {
      if (!current()) return false;
      const rejected = recovered ? isExplicitRejection(error)
        : error instanceof MContentReadError && !error.backendMessage?.startsWith("IDEMPOTENCY_") && isDeterministicRejection(error.status, error.apiCode);
      if (rejected) {
        mCommands.forget(record.fingerprint, record.commandKey); syncPending();
        activeConfirm.current.original = undefined;
        if (recovered) { ctx.closeActionConfirm?.(); setProfileAgent(null); setProfileRecovery(undefined); }
        await readCurrent();
        toast(displayAdminError(error), "error");
        throw new Error(displayAdminError(error));
      }
      activeConfirm.current.original = record;
      if (command.profile) setProfileRecovery(record);
      syncPending(); toast(`结果未知 · ${displayAdminError(error)}`, "warn");
      throw new OutcomeUnknownError(displayAdminError(error));
    } finally { inFlight.current = false; if (current()) setWritePending(false); }
  };
  // An open confirmation retains its callback; new attempts must use the reread facts and permissions.
  currentWrite.current = async (key, value, meta, successMessage) => {
    if (key === "I.support.advisorAssignment.__delete") return ctx.setParam(key, value, meta);
    if (activeConfirm.current.original?.m5) return commitOriginal(activeConfirm.current.original, true);
    const profile = key === "I.support.agentProfile.__update" ? supportAgents.find(agent => agent.adminId === profileAgent?.adminId) : undefined;
    if (key === "I.support.agentProfile.__update" && (!profile || profileRestriction(profile))) return false;
    if (currentAdminId !== useAdminAuth.getState().session?.adminId
      || !useAdminAuth.getState().session?.authorities.includes(profile ? "service_m1_write" : "service_m5_write")) return false;
    const allowed = profile ? canManageSupportSeats && agentPageAvailable : key.startsWith("I.session.cat.") || key.startsWith("I.session.advisor.policy.") ? canManageM5Operations : canManageM5Content;
    // 只换说法：读到之前照旧不提交，但在框里说清为什么点了没反应。
    if (allowed && !inFlight.current && !blocked(key, profile?.adminId) && (needsRead || ctx.contentLoading || (profile ? !agentPageAvailable : !sessionTemplatesAvailable))) {
      throw new Error("现在的数据还没读到，读到后才能提交。");
    }
    if (!allowed || needsRead || ctx.contentLoading || (profile ? !agentPageAvailable : !sessionTemplatesAvailable) || inFlight.current || blocked(key, profile?.adminId)) return false;
    const command = buildM5Command(key, profile ? JSON.stringify({ ...JSON.parse(value), expectedVersion: profile.version }) : value, ctx.params, meta, currentAdminId, successMessage, profile);
    const fingerprint = `m5|${command.resource}`, commandKey = `m-${Date.now()}-${crypto.randomUUID()}`;
    mCommands.remember(fingerprint, commandKey, { m5: command });
    const record = mCommands.list().find(row => row.commandKey === commandKey)!;
    return commitOriginal(record, false);
  };
  const recover = (record: MCommandRecord) => {
    const command = record.m5;
    if (!command) return;
    restoring.current = record;
    try {
      if (command.profile) { setProfileRecovery(record); setProfileAgent(command.profile); }
      else if (command.key === CAT_KEY("advisor")) toggleCat({ type: "advisor", name: command.text, enabled: command.beforeValue === "on" });
      else if (command.key === "I.session.script.__create") newScript();
      else if (command.key === REPLY_TEMPLATE_LIST_KEY) newReplyTemplate();
      else if (command.key === POLICY_KEY("audience")) editAudience();
      else if (command.key.startsWith("I.session.advisor.policy.")) {
        const field = command.key.split(".").at(-1)!;
        if (field === "enabled") toggleAdvisorPush();
        else editPolicy(field, field === "delayMs" ? "首推延迟" : field === "cooldownHours" ? "冷却时间" : "单会话上限", command.beforeValue, field === "delayMs" ? " 毫秒" : field === "cooldownHours" ? " 小时" : " 条");
      } else {
        const match = /^I\.session\.(script|tpl)\.(.+)\.status$/.exec(command.key);
        if (match?.[1] === "script") publishScript(match[2], command.beforeValue as AdvisorScript["status"]);
        else if (match) toggleTpl(match[2], command.beforeValue as SessionReplyTpl["status"]);
      }
    } finally { restoring.current = undefined; }
  };

  useEffect(() => {
    if (!hasM1ReadAuthority || !hasData) {
      setAgentPageData(null);
      setAgentPageError("");
      setAgentPageLoading(false);
      return;
    }
    let alive = true;
    setAgentPageData(null);
    setAgentPageLoading(true);
    setAgentPageError("");
    fetchMSupportAgentsPage(agentPage, SUPPORT_AGENT_PAGE_SIZE)
      .then((page) => {
        if (alive) setAgentPageData(page);
      })
      .catch((err) => {
        if (!alive) return;
        setAgentPageError(displayAdminError(err));
      })
      .finally(() => {
        if (alive) setAgentPageLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [agentPage, agentSnapshot, assignmentSnapshot, hasM1ReadAuthority, actorStamp, agentPageRetry, hasData]);

  useEffect(() => {
    if (agentPageAvailable) setAgentPage((page) => clampPage(page, agentTotal, SUPPORT_AGENT_PAGE_SIZE));
  }, [agentPageAvailable, agentTotal]);
  useEffect(() => {
    setScriptPage((page) => clampPage(page, scriptTotal, SCRIPT_PAGE_SIZE));
  }, [scriptTotal]);
  useEffect(() => {
    setReplyTemplatePage((page) => clampPage(page, replyTemplateTotal, REPLY_TEMPLATE_PAGE_SIZE));
  }, [replyTemplateTotal]);

  const unbindAdvisor = (agent: MSupportAgent, row: MAdvisorAssignment) => {
    if (!canManageSupportSeats || writePending) return;
    openActionConfirm({
      action: <>解绑专属客服 · {row.nickname}</>,
      briefKind: "record",
      detail: <>解除 <b>{agent.name}</b> 与用户 <span className="mono">{row.userNo}</span> 的专属客服服务关系。解绑后该用户不再固定分配给该客服。</>,
      amplifies: false,
      reasonMin: 8,
      reasonMax: 200,
      run: (reason: string) => commitM5Write("I.support.advisorAssignment.__delete", JSON.stringify({ adminId: agent.adminId, assignmentId: row.id }), {
          action: "解除专属客服",
          reason,
        }, `${row.userNo} 已解绑`),
    });
  };

  // ── 类别启停:处置(不传 edit)──
  const toggleCat = (cat: { type: SessionType; name: string; enabled: boolean }) => {
    if (!restoring.current && (!canManageM5Operations || !sessionTemplatesAvailable || writePending || blocked(CAT_KEY(cat.type))) || cat.type !== "advisor") return;
    const on = restoring.current?.m5 ? restoring.current.m5.beforeValue === "on" : catEnabled(cat);
    openActionConfirm({
      action: <>{on ? "禁用" : "启用"}会话类别 · {cat.name}</>,
      title: on ? `停用「${cat.name}」会话` : `启用「${cat.name}」会话`,
      effect: <StatusTag tone="progress" filled>立即生效</StatusTag>,
      confirmLabel: on ? "确认停用" : "确认启用",
      statedBrief: on
        ? { impact: "用户在 App 里不能再新建这类会话；进行中的会话和聊天记录保留，不会被关掉。", check: "只停这一类专属客服会话，不停全部客服；AI 会话由 AI 平台管。" }
        : { impact: "用户在 App 里又能新建这类会话；不会自动给谁发消息。", check: "核对客服人手够不够接。" },
      facts: <Facts><Fact k="会话类别">{cat.name}</Fact><Fact k="状态"><Change from={on ? "已启用" : "已停用"} to={on ? "已停用" : "已启用"} /></Fact></Facts>,
      reasonPlaceholder: on ? "例如：客服人手不足，暂停新建专属客服会话" : "例如：客服人手已补齐，恢复专属客服会话",
      briefKind: "session-category",
      detail: on ? <>用户不能再新建这类会话；进行中的会话保留，不会强制关闭。不影响全部客服能力。</> : <>启用后用户可以在 App 里新建这类会话。</>,
      amplifies: false,
      reasonMin: 8,
      reasonMax: 200,
      run: (reason: string) => commitM5Write(
        CAT_KEY(cat.type),
        on ? "off" : "on",
        { action: `${on ? "禁用" : "启用"}会话类别 ${cat.name} · admin.conversation_category_toggled`, reason },
        `${cat.name} 类别${on ? "已禁用" : "已启用"}`,
      ),
    });
  };

  const toggleAdvisorPush = () => {
    if (!restoring.current && (!canManageM5Operations || !sessionTemplatesAvailable || writePending
      || (!masterOn && !ADVISOR_AUTOPUSH_EXECUTOR_AVAILABLE))) return;
    openActionConfirm({
      action: <>{masterOn ? "停用" : "启用"}专属客服主动推送</>,
      title: masterOn ? "停用主动推送" : "启用主动推送",
      effect: <StatusTag tone="neutral" filled>只保存设置，目前不会推送</StatusTag>,
      confirmLabel: masterOn ? "确认停用" : "确认启用",
      statedBrief: { impact: "主动推送目前没有执行器：保存这个开关不会给任何用户发消息，也不会停掉已经发出的消息。", check: "后端目前只接受停用，启用会被拒绝。" },
      facts: <Facts><Fact k="主动推送"><Change from={masterOn ? "已启用" : "已停用"} to={masterOn ? "已停用" : "已启用"} /></Fact></Facts>,
      briefKind: "record",
      detail: <>主动推送目前没有执行器，保存这个开关不会推送任何消息。</>,
      amplifies: false,
      reasonMin: 8,
      reasonMax: 200,
      run: (reason: string) => commitM5Write(
        POLICY_KEY("enabled"),
        masterOn ? "off" : "on",
        { action: `${masterOn ? "停用" : "启用"}专属客服主动推送 · admin.conversation_autopush_toggled`, reason },
        `专属客服主动推送${masterOn ? "已停用" : "已启用"}`,
      ),
    });
  };

  // ── AutoPushPolicy 调参:传 edit ──
  const editPolicy = (field: string, label: string, current: string, unit: string) =>
    (restoring.current || canManageM5Operations && sessionTemplatesAvailable && !writePending && !blocked(POLICY_KEY(field))) && openActionConfirm({
      action: <>调整专属客服推送 · {label}</>,
      title: `调整${label}`,
      effect: <StatusTag tone="neutral" filled>只保存设置，目前不会推送</StatusTag>,
      confirmLabel: "确认保存",
      statedBrief: { impact: "主动推送目前没有执行器：这个参数能保存，但现在不会给任何用户推送。", check: "核对新值和单位。" },
      reasonPlaceholder: "例如：先把参数定好，等主动推送上线后直接用",
      briefKind: "config",
      detail: ADVISOR_AUTOPUSH_EXECUTOR_AVAILABLE
        ? <>影响全体进入会话中心用户的专属客服主动触达频率/时机。对新会话即时生效。</>
        : <>主动推送当前不可用；保存该参数不会触发主动推送。</>,
      amplifies: false,
      edit: { kind: "text", current, unit, hint: POLICY_HINT[field] },
      reasonMin: 8,
      reasonMax: 200,
      run: (reason: string, v?: string) => v
        ? commitM5Write(
          POLICY_KEY(field),
          v,
          { action: `调整专属客服推送 ${label} · admin.conversation_autopush_changed`, reason },
          `${label} 已更新 · ${v}${unit}`,
        )
        : false,
    });

  // ── 受众圈定:调参(select edit)──
  const editAudience = () =>
    (restoring.current || canManageM5Operations && sessionTemplatesAvailable && !writePending && !blocked(POLICY_KEY("audience")) && audienceOptions.length > 0) && openActionConfirm({
      action: <>圈定专属客服推送受众</>,
      title: "调整主动推送受众",
      effect: <StatusTag tone="neutral" filled>只保存设置，目前不会推送</StatusTag>,
      confirmLabel: "确认保存",
      statedBrief: { impact: "主动推送目前没有执行器：受众能保存，但现在不会给任何用户推送。这是整个主动推送的受众，不是某一条话术的。", check: "核对要选的人群。" },
      reasonPlaceholder: "例如：先把受众定为新注册用户",
      briefKind: "config",
      detail: ADVISOR_AUTOPUSH_EXECUTOR_AVAILABLE
        ? <>限定专属客服主动触达的人群范围;对新会话即时生效,已在会话中的用户不受影响。</>
        : <>主动推送当前不可用；保存受众设置不会触发主动推送。</>,
      amplifies: false,
      edit: { kind: "select", current: restoring.current?.m5?.beforeValue ?? currentAudience, options: restoring.current?.m5 ? [restoring.current.m5.beforeValue, recoveredEditValue(restoring.current.m5)] : audienceOptions },
      reasonMin: 8,
      reasonMax: 200,
      run: (reason: string, v?: string) => v
        ? commitM5Write(
          POLICY_KEY("audience"),
          v,
          { action: "圈定专属客服推送受众 · admin.conversation_autopush_changed", reason },
          `推送受众已更新 · ${v}`,
        )
        : false,
    });

  // ── 话术发布 / 下架 / 新增:处置(新增传 edit 录 key)──
  const publishScript = (id: string, currentStatus: AdvisorScript["status"]) =>
    (restoring.current || canManageM5Content && sessionTemplatesAvailable && !writePending && !blocked(SCRIPT_KEY(id))) && currentStatus !== "archived" && openActionConfirm({
      action: <>{currentStatus === "published" ? "归档" : "发布"}专属客服话术 · {id}</>,
      title: currentStatus === "published" ? "归档这条话术" : "发布这条话术",
      effect: currentStatus === "published" ? <><StatusTag tone="progress" filled>立即生效</StatusTag><IrreversibleTag>归档后不能再发布</IrreversibleTag></> : <StatusTag tone="progress" filled>立即生效</StatusTag>,
      confirmLabel: currentStatus === "published" ? "确认归档" : "确认发布",
      confirmTone: currentStatus === "published" ? "danger" : undefined,
      statedBrief: currentStatus === "published"
        ? { impact: "这条话术现在客服回复时能选到；归档后就选不到了，也不能再发布。已经发给客户的消息不受影响。", check: "核对编号和正文；只想改内容的，新建一条再发布。" }
        : { impact: "发布后客服在专属会话里回复时能选到这条话术；不会自动发给客户。只写了中文也能发布，已有的译文要和中文一致。", check: "核对正文和受众。" },
      facts: <Facts><Fact k="编号"><span data-mono="">{id}</span></Fact><Fact k="正文">{scriptFact(id)}</Fact><Fact k="状态"><Change from={currentStatus === "published" ? "已发布，客服能选到" : "草稿，客服看不到"} to={currentStatus === "published" ? "已归档，客服选不到" : "已发布，客服能选到"} /></Fact></Facts>,
      reasonPlaceholder: currentStatus === "published" ? "例如：活动结束，这条话术不再使用" : "例如：新话术内容已核对，上线给客服用",
      briefKind: currentStatus === "published" ? "record" : "content",
      detail: currentStatus === "published" ? <>归档后客服选不到，不能再发布。</> : <>发布后客服回复时能选到，只写中文也行。</>,
      amplifies: false,
      reasonMin: 8,
      reasonMax: 200,
      run: (reason: string) => commitM5Write(
        SCRIPT_KEY(id),
        currentStatus === "published" ? "archived" : "published",
        { action: `${currentStatus === "published" ? "归档" : "发布"}专属客服话术 ${id} · admin.conversation_script_published`, reason },
        `${id} ${currentStatus === "published" ? "已归档" : "发布已生效"}`,
      ),
    });
  const newScript = () =>
    (restoring.current || canManageM5Content && sessionTemplatesAvailable && !writePending && !blocked("I.session.script.__create") && audienceOptions.length > 0) && openActionConfirm({
      action: <>新增专属客服话术</>,
      title: "新建话术",
      effect: <StatusTag tone="neutral" filled>存为草稿，客服暂时看不到</StatusTag>,
      confirmLabel: "保存草稿",
      statedBrief: { impact: "新建的是草稿，客服回复时还选不到；发布后才能选。不会发给任何客户。", check: "正文最多 400 字，不能以 { 或 [ 开头，不能带网址。" },
      facts: <Facts><Fact k="分类">开场</Fact><Fact k="受众">{restoring.current?.m5?.audience || currentAudience || defaultAudience || "—"}</Fact></Facts>,
      reasonPlaceholder: "例如：补一条新客户开场话术",
      briefKind: "config",
      detail: <>新建的是草稿，发布后客服才能选到。</>,
      amplifies: false,
      edit: { kind: "text", current: "", unit: "话术文案", hint: "最多 400 字；不能以 { 或 [ 开头，不能带网址" },
      reasonMin: 8,
      reasonMax: 200,
      run: async (reason: string, v?: string) => {
        const text = v?.trim();
        if (!text) return false;
        const audience = currentAudience || defaultAudience;
        const succeeded = await commitM5Write("I.session.script.__create", JSON.stringify({ scriptGroup: "开场", text, ctaPath: "—", audience, status: "draft" }), {
          action: "新增专属客服话术 · admin.conversation_script_created",
          reason,
          commandKey: `m5:create-script:${text}:${audience}`,
        }, "话术已创建 · 待发布确认");
        if (succeeded) setScriptPage(totalPages(scriptTotal + 1, SCRIPT_PAGE_SIZE));
        return succeeded;
      },
    });

  // ── 模板发布 / 归档:处置(不传 edit)──
  const toggleTpl = (id: string, currentStatus: SessionReplyTpl["status"]) =>
    (restoring.current || canManageM5Content && sessionTemplatesAvailable && !writePending && !blocked(TPL_KEY(id))) && currentStatus !== "archived" && openActionConfirm({
      action: <>{currentStatus === "published" ? "归档" : "发布"}回复模板 · {id}</>,
      title: currentStatus === "published" ? "归档这个即时回复模板" : "发布这个即时回复模板",
      effect: currentStatus === "published" ? <><StatusTag tone="progress" filled>立即生效</StatusTag><IrreversibleTag>归档后不能再发布</IrreversibleTag></> : <StatusTag tone="progress" filled>立即生效</StatusTag>,
      confirmLabel: currentStatus === "published" ? "确认归档" : "确认发布",
      confirmTone: currentStatus === "published" ? "danger" : undefined,
      statedBrief: currentStatus === "published"
        ? { impact: "这个模板现在客服回复时能选到；归档后就选不到了，也不能再发布。已经发给客户的消息不受影响。", check: "核对编号和正文；只想改内容的，新建一个再发布。" }
        : { impact: "发布后客服在专属会话里回复时能选到这个模板；不会自动发给客户。只写了中文也能发布，已有的译文要和中文一致。", check: "核对正文。" },
      facts: <Facts><Fact k="编号"><span data-mono="">{id}</span></Fact><Fact k="正文">{templateFact(id)}</Fact><Fact k="状态"><Change from={currentStatus === "published" ? "已发布，客服能选到" : "草稿，客服看不到"} to={currentStatus === "published" ? "已归档，客服选不到" : "已发布，客服能选到"} /></Fact></Facts>,
      reasonPlaceholder: currentStatus === "published" ? "例如：这句回复已过时，不再使用" : "例如：新模板内容已核对，上线给客服用",
      briefKind: "content",
      detail: currentStatus === "published" ? <>归档后客服选不到，不能再发布。</> : <>发布后客服回复时能选到，只写中文也行。</>,
      amplifies: false,
      reasonMin: 8,
      reasonMax: 200,
      run: (reason: string) => commitM5Write(
        TPL_KEY(id),
        currentStatus === "published" ? "archived" : "published",
        { action: `${currentStatus === "published" ? "归档" : "发布"}回复模板 ${id} · admin.conversation_template_published`, reason },
        `${id} ${currentStatus === "published" ? "已归档" : "发布已生效"}`,
      ),
    });
  const newReplyTemplate = () =>
    (restoring.current || canManageM5Content && sessionTemplatesAvailable && !writePending && !blocked(REPLY_TEMPLATE_LIST_KEY)) && openActionConfirm({
      action: <>新增即时回复模板</>,
      title: "新建即时回复模板",
      effect: <StatusTag tone="neutral" filled>存为草稿，客服暂时看不到</StatusTag>,
      confirmLabel: "保存草稿",
      statedBrief: { impact: "新建的是草稿，客服回复时还选不到；发布后才能在专属会话的回复框里选用。不会发给任何客户。", check: "正文最多 400 字，不能以 { 或 [ 开头，不能带网址。" },
      reasonPlaceholder: "例如：补一句常用的到账说明回复",
      briefKind: "config",
      detail: <>新建的是草稿，发布后客服才能在回复框里选到。</>,
      amplifies: false,
      edit: { kind: "text", current: "", unit: "模板文案", hint: "最多 400 字；不能以 { 或 [ 开头，不能带网址" },
      reasonMin: 8,
      reasonMax: 200,
      run: async (reason: string, v?: string) => {
        const text = v?.trim();
        if (!text) return false;
        const commandKey = `m5:create-reply-template:${text}`;
        const draftId = pendingReplyTemplateDraftIds.current.get(commandKey)
          ?? `RT-TEMP-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
        pendingReplyTemplateDraftIds.current.set(commandKey, draftId);
        const row: SessionReplyTpl = {
          id: draftId,
          type: "support",
          text,
          status: "draft",
        };
        const succeeded = await commitM5Write(REPLY_TEMPLATE_LIST_KEY, JSON.stringify([row, ...replyTemplates]), {
          action: "新增即时回复模板 · admin.conversation_template_created",
          reason,
          commandKey: `m5:create-reply-template:${text}`,
        }, "即时回复模板已创建 · 待发布确认");
        if (succeeded) {
          pendingReplyTemplateDraftIds.current.delete(commandKey);
          setReplyTemplatePage(totalPages(replyTemplateTotal + 1, REPLY_TEMPLATE_PAGE_SIZE));
        }
        return succeeded;
      },
    });

  const shown = (value: string | undefined) => !value || value === "-" ? "—" : value;
  const statusCounts = (rows: { status: string }[]) => ({
    published: rows.filter((row) => row.status === "published").length,
    draft: rows.filter((row) => row.status === "draft").length,
    archived: rows.filter((row) => row.status === "archived").length,
  });
  const scriptRows = keptScripts.map((row) => ({ ...row, status: scriptStatus(row.id, row.status) }));
  const templateRows = keptReplyTemplates.map((row) => ({ ...row, status: tplStatus(row.id, row.status) }));
  const scriptCount = statusCounts(scriptRows);
  const templateCount = statusCounts(templateRows);
  const countSub = (count: ReturnType<typeof statusCounts>) => `已发布 ${count.published} · 草稿 ${count.draft} · 已归档 ${count.archived}`;
  const canTranslate = reach("/content/i18n", "content_i6_read");
  const pane = (key: M5Tab, children: ReactNode) => <div {...ids.panel(key)} hidden={tab !== key} className="rd-tab-pane m5-pane">{children}</div>;
  const rosterColumns = canManageSupportSeats ? 6 : 5;
  const agentsListed = pget("I.support.agentsAvailable") === "1";
  const publishedTotal = scriptCount.published + templateCount.published, draftTotal = scriptCount.draft + templateCount.draft, archivedTotal = scriptCount.archived + templateCount.archived;
  const agentsOpen = supportAgents.filter((agent) => agent.enabled).length, agentsBusy = supportAgents.filter((agent) => agent.busy).length, agentsTotal = supportAgents.length;
  useEffect(() => {
    onSummary?.({ contentAvailable: sessionTemplatesAvailable, published: publishedTotal, draft: draftTotal, archived: archivedTotal, agentsAvailable: agentsListed, agentsOpen, agentsBusy, agentsTotal, pending: pendingCommands.length });
  }, [onSummary, sessionTemplatesAvailable, publishedTotal, draftTotal, archivedTotal, agentsListed, agentsOpen, agentsBusy, agentsTotal, pendingCommands.length]);

  const roster = !hasM1ReadAuthority
    ? <BlockState state="denied" title="当前账号没有客服名册权限" detail="话术与模板照常能维护。" />
    : <>
      <Notice tone="neutral">暂停接新单的客服，自动分配和人工转接都选不到；同时接待上限只管自动分配。</Notice>
      <Panel flush icon={Headset} tone="role-3" title="客服接待名册" sub={agentPageAvailable ? `${agentTotal} 位` : undefined}
        explain="列出你能管的客服，每页 5 位。分组、在不在线到客服工作台的「客服与分组」看；接待资格和主管资格在账号管理里改，这里不改。">
        <Table label="客服接待名册" className="m5-roster">
          <thead><tr>
            <Th>客服</Th>
            <Th className="m5-col-state">接待状态</Th>
            <Th className="m5-col-served"><Explain label="服务客户怎么算" content="现在绑定在这位客服名下的客户，最多列出 4 位，其余写「+n」。">服务客户</Explain></Th>
            <Th className="m5-col-cap" align="right"><Explain label="同时接待上限是什么" content="自动分配时，这位客服名下的有效绑定客户数到这个数就不再选他，0 表示自动分配不选他。不是同时会话数；邀请继承和主管指定不受它限制。">同时接待上限</Explain></Th>
            <Th className="m5-col-tags">标签</Th>
            {canManageSupportSeats && <Th sticky="end">操作</Th>}
          </tr></thead>
          <tbody>
            {agentPageLoading ? <TableLoading columns={rosterColumns} rows={SUPPORT_AGENT_PAGE_SIZE} />
              : agentPageError ? <TableMessage columns={rosterColumns} role="alert">客服名册读不到：{agentPageError} <Button size="sm" onClick={() => { if (needsRead) void readCurrent(); else setAgentPageRetry(n => n + 1); }}>重新加载客服</Button></TableMessage>
                : !agentPageAvailable ? <TableMessage columns={rosterColumns} role="status">客服名册暂时不可用，读到后再列出。</TableMessage>
                  : agentTotal === 0 ? <TableMessage columns={rosterColumns} role="status">还没有客服。先在平台管理员里给账号分配客服角色。</TableMessage>
                    : visibleSupportAgents.map((agent) => {
                      const assignments = visibleAdvisorAssignments.filter((row) => row.agentAdminId === agent.adminId && row.status === "ACTIVE");
                      return <Tr key={agent.id}>
                        <Td>
                          <div className="m5-agent">
                            <SupportAvatar name={agent.name || "客服"} path={agent.avatarAssetId ? advisorAvatarPath(agent.adminId) : undefined} version={agent.avatarVersion} size={32} />
                            <div className="m5-agent-text">
                              <span className="m5-agent-name" title={agent.name || undefined}>{agent.name || "名称未同步"}</span>
                              <span className="rd-note" data-proof="m5-seat-position-label" title={`${seatLabel(agent.position)} · ${agent.email || "—"} · 账号 #${agent.adminId}`}>{seatLabel(agent.position)} · {agent.email || "—"}</span>
                            </div>
                          </div>
                        </Td>
                        <Td>
                          <span className="m5-tags">
                            {agent.enabled ? <StatusTag tone="ok" icon={CheckCircle2}>开放接待</StatusTag> : <StatusTag tone="done" icon={CircleOff}>不接待</StatusTag>}
                            {agent.busy && <StatusTag tone="warn" icon={PauseCircle}>暂停接新单</StatusTag>}
                          </span>
                          {!agent.transferable && <span className="rd-note">不接受转交</span>}
                        </Td>
                        <Td>
                          <span className="m5-served">
                            <span className="m5-served-count" data-empty={agent.assignedUserCount === 0 ? "" : undefined}>{compactSupportBoardValue(agent.assignedUserCount, "count") === "-" ? "—" : `${agent.assignedUserCount} 位`}</span>
                            {assignments.slice(0, 4).map((row) => <span key={row.id} className="m5-chip" title={`${row.nickname} ${row.userNo}`}>{row.nickname} <span data-mono="">{row.userNo}</span></span>)}
                            {assignments.length > 4 && <span className="m5-more">+{assignments.length - 4}</span>}
                          </span>
                        </Td>
                        <Td align="right"><span className="m5-cap" data-empty={agent.maxConcurrent === 0 ? "" : undefined}>{compactSupportBoardValue(agent.maxConcurrent, "count") === "-" ? "—" : `${agent.maxConcurrent} 位`}</span></Td>
                        <Td>{agent.tags?.length ? <span className="m5-tags">{agent.tags.map((tag) => <span key={tag} className="m5-chip">{tag}</span>)}</span> : <span className="rd-note">—</span>}</Td>
                        {canManageSupportSeats && <Td sticky="end"><Button size="sm" icon={<SlidersHorizontal size={14} aria-hidden />} disabled={writePending || needsRead || blocked("I.support.agentProfile.__update", agent.adminId)} disabledReason={profileRestriction(agent)} onClick={() => { activeConfirm.current = {}; setProfileRecovery(undefined); setProfileAgent(agent); }}>接单设置</Button></Td>}
                      </Tr>;
                    })}
          </tbody>
        </Table>
        {agentPageAvailable && agentTotal > 0 && <RdPager label="客服接待名册" total={agentTotal} page={clampPage(agentPage, agentTotal, SUPPORT_AGENT_PAGE_SIZE)} pageSize={SUPPORT_AGENT_PAGE_SIZE} sizes={[SUPPORT_AGENT_PAGE_SIZE]} loading={agentPageLoading} onPage={setAgentPage} onPageSize={() => undefined} />}
      </Panel>
    </>;

  const contentActions = (kind: "script" | "template", id: string, status: string) => {
    const published = status === "published", archived = status === "archived";
    const look = { size: "sm" as const, variant: published ? "danger-outline" as const : "secondary" as const, icon: published ? <Archive size={14} aria-hidden /> : <Upload size={14} aria-hidden />, disabled: !sessionTemplatesAvailable || writePending || blocked(kind === "script" ? SCRIPT_KEY(id) : TPL_KEY(id)) };
    return <span className="m5-row-actions">
      {canManageM5Content && !archived && (kind === "script"
        ? <Button {...look} data-proof={`session-script-publish-${id}`} onClick={() => publishScript(id, status as AdvisorScript["status"])}>{published ? "归档" : "发布"}</Button>
        : <Button {...look} data-proof={`session-tpl-publish-${id}`} onClick={() => toggleTpl(id, status as SessionReplyTpl["status"])}>{published ? "归档" : "发布"}</Button>)}
      {canTranslate && <a className="rd-link" href="/content/i18n">维护翻译</a>}
      {!canTranslate && (!canManageM5Content || archived) && <span className="rd-note">—</span>}
    </span>;
  };

  const content = <>
    {!sessionTemplatesAvailable && (ctx.contentLoading ? <BlockState state="loading" title="正在读取话术与模板…" />
      : <BlockState state="error" title="话术与模板读不到，暂时不能修改" onRetry={() => void readCurrent()} retryLabel="重新读取" />)}
    {sessionTemplatesAvailable && !canManageM5Content && <Notice tone="neutral">{isSupportM5Supervisor ? "你只能查看；新建、发布和归档还需要服务规则与话术的修改权限。" : "你只能查看；新建、发布和归档要超级管理员、内容运营或客服主管。"}</Notice>}
    <PageTabs level={2} label="话术与模板分类" ids={contentIds} value={contentView} onChange={setContentView} items={[
      { value: "scripts", label: "专属客服话术" },
      { value: "templates", label: "即时回复模板" },
    ]} />
    <div {...contentIds.panel("scripts")} hidden={contentView !== "scripts"} className="rd-tab-pane">
    <Panel flush icon={MessageSquareText} tone="role-2" title="专属客服话术" sub={sessionTemplatesAvailable ? countSub(scriptCount) : undefined}
      explain="客服在专属会话里主动发话时可选的话术。只有已发布的能选到；草稿只在后台；归档后选不到，也不能再发布。不会自动发给客户。每页 5 条，按排序值和更新时间排，新建的不一定在最后一页。"
      actions={canManageM5Content && <Button variant="primary" size="sm" data-proof="session-script-new" icon={<Plus size={14} aria-hidden />} disabled={!sessionTemplatesAvailable || writePending || audienceOptions.length === 0 || blocked("I.session.script.__create")}
        disabledReason={sessionTemplatesAvailable && audienceOptions.length === 0 ? "后端没给可选受众，暂时不能新建" : undefined} onClick={newScript}>新建话术</Button>}>
      <Table label="专属客服话术" className="m5-content-table">
        <thead><tr>
          <Th className="m5-col-id">编号</Th>
          <Th>话术</Th>
          <Th className="m5-col-aud">受众</Th>
          <Th className="m5-col-status">状态</Th>
          <Th sticky="end">操作</Th>
        </tr></thead>
        <tbody>
          {!sessionTemplatesAvailable ? ctx.contentLoading ? <TableLoading columns={5} rows={3} /> : <TableMessage columns={5} role="alert">读到后再列出。</TableMessage>
            : scriptTotal === 0 ? <TableMessage columns={5} role="status">{canManageM5Content ? "还没有话术。点「新建话术」写第一条，发布后客服才能选到。" : "还没有话术。"}</TableMessage>
              : visibleScripts.map((row) => {
                const status = scriptStatus(row.id, row.status);
                return <Tr key={row.id}>
                  <Td><span data-mono="" className="m5-id" title={row.id}><span className="m5-id-head">{row.id.slice(0, -12)}</span><span className="m5-id-tail">{row.id.slice(-12)}</span></span></Td>
                  <Td grow><span className="m5-text" data-user-content="">{row.text}</span><span className="rd-note">{scriptGroupLabel(row.group)} · 点击后跳转 {row.ctaHref && row.ctaHref !== "—" ? row.ctaHref : "无"}</span></Td>
                  <Td>{scriptAudience(row.id) || "—"}</Td>
                  <Td><ContentStatusTag status={status} /></Td>
                  <Td sticky="end">{contentActions("script", row.id, status)}</Td>
                </Tr>;
              })}
        </tbody>
      </Table>
      {sessionTemplatesAvailable && scriptTotal > 0 && <RdPager label="专属客服话术" total={scriptTotal} page={clampPage(scriptPage, scriptTotal, SCRIPT_PAGE_SIZE)} pageSize={SCRIPT_PAGE_SIZE} sizes={[SCRIPT_PAGE_SIZE]} onPage={setScriptPage} onPageSize={() => undefined} />}
    </Panel>
    </div>
    <div {...contentIds.panel("templates")} hidden={contentView !== "templates"} className="rd-tab-pane">
    <Panel flush icon={Zap} tone="role-2" title="即时回复模板" sub={sessionTemplatesAvailable ? countSub(templateCount) : undefined}
      explain="客服在专属会话回复框里一键选用的短回复。只有已发布的能选到；草稿只在后台；归档后选不到，也不能再发布。每页 5 条。"
      actions={canManageM5Content && <Button variant="primary" size="sm" data-proof="session-tpl-new" icon={<Plus size={14} aria-hidden />} disabled={!sessionTemplatesAvailable || writePending || blocked(REPLY_TEMPLATE_LIST_KEY)} onClick={newReplyTemplate}>新建模板</Button>}>
      <Table label="即时回复模板" className="m5-content-table">
        <thead><tr>
          <Th className="m5-col-id">编号</Th>
          <Th>模板</Th>
          <Th className="m5-col-aud">给谁用</Th>
          <Th className="m5-col-status">状态</Th>
          <Th sticky="end">操作</Th>
        </tr></thead>
        <tbody>
          {!sessionTemplatesAvailable ? ctx.contentLoading ? <TableLoading columns={5} rows={3} /> : <TableMessage columns={5} role="alert">读到后再列出。</TableMessage>
            : replyTemplateTotal === 0 ? <TableMessage columns={5} role="status">{canManageM5Content ? "还没有即时回复模板。点「新建模板」写第一条，发布后客服才能选到。" : "还没有即时回复模板。"}</TableMessage>
              : visibleReplyTemplates.map((row) => {
                const status = tplStatus(row.id, row.status);
                return <Tr key={row.id}>
                  <Td><span data-mono="" className="m5-id" title={row.id}><span className="m5-id-head">{row.id.slice(0, -12)}</span><span className="m5-id-tail">{row.id.slice(-12)}</span></span></Td>
                  <Td grow><span className="m5-text" data-user-content="">{row.text}</span></Td>
                  <Td>专属客服</Td>
                  <Td><ContentStatusTag status={status} /></Td>
                  <Td sticky="end">{contentActions("template", row.id, status)}</Td>
                </Tr>;
              })}
        </tbody>
      </Table>
      {sessionTemplatesAvailable && replyTemplateTotal > 0 && <RdPager label="即时回复模板" total={replyTemplateTotal} page={clampPage(replyTemplatePage, replyTemplateTotal, REPLY_TEMPLATE_PAGE_SIZE)} pageSize={REPLY_TEMPLATE_PAGE_SIZE} sizes={[REPLY_TEMPLATE_PAGE_SIZE]} onPage={setReplyTemplatePage} onPageSize={() => undefined} />}
    </Panel>
    </div>
  </>;

  const policyRow = (field: "delayMs" | "cooldownHours" | "maxPerSession", name: string, value: string, unit: string, what: string) => (
    <ConfigRow key={field} name={name} what={what} when="保存后立即记下；主动推送上线前不会推送" value={value}
      action={canManageM5Operations ? (describedBy) => {
        const props = { size: "sm" as const, "aria-describedby": describedBy, disabled: !sessionTemplatesAvailable || writePending || blocked(POLICY_KEY(field)), onClick: () => editPolicy(field, name, policyVal(field, DEFAULT_ADVISOR_POLICY[field]), unit) };
        return field === "delayMs" ? <Button {...props} data-proof="session-policy-delay">调整</Button>
          : field === "cooldownHours" ? <Button {...props} data-proof="session-policy-cooldown">调整</Button>
            : <Button {...props} data-proof="session-policy-max">调整</Button>;
      } : undefined} />
  );
  const channels = <>
    {!sessionTemplatesAvailable && (ctx.contentLoading ? <BlockState state="loading" title="正在读取会话类别和推送设置…" />
      : <BlockState state="error" title="会话类别和推送设置读不到，暂时不能修改" onRetry={() => void readCurrent()} retryLabel="重新读取" />)}
    <Panel icon={MessagesSquare} tone="role-3" title="会话类别"
      explain="用户在 App 客服入口能新建哪几类会话。这里只管专属客服会话；Nova 智能问答已在 App 下线。停用全部客服能力到全局运营开关。">
      <ConfigList label="会话类别">
        {categories.length === 0 ? <BlockState state="empty" title="没有可管理的会话类别" /> : categories.map((c) => {
          const managed = c.type === "ai";
          const on = catEnabled(c);
          return <ConfigRow key={c.type} name={c.name}
            what={managed ? "App 里已没有入口，用户不能新建；只剩历史会话" : "用户能不能新建专属客服会话"}
            effect={managed ? undefined : "停用后用户不能再新建这类会话，进行中的会话保留"}
            value={managed ? <span className="m5-tags"><StatusTag tone="done" icon={CircleOff}>已下线</StatusTag><span className="m5-inline-note"><Lock size={12} aria-hidden />后台开关：{on ? "开" : "关"}</span></span>
              : on ? <StatusTag tone="ok" icon={CheckCircle2}>已启用</StatusTag> : <StatusTag tone="done" icon={CircleOff}>已停用</StatusTag>}
            action={!managed && canManageM5Operations ? (describedBy) => <Button size="sm" aria-describedby={describedBy} data-proof={`session-cat-toggle-${c.type}`} variant={on ? "danger-outline" : "secondary"} disabled={!sessionTemplatesAvailable || writePending || blocked(CAT_KEY(c.type))} onClick={() => toggleCat(c)}>{on ? "停用" : "启用"}</Button> : undefined} />;
        })}
      </ConfigList>
    </Panel>
    <Panel icon={Megaphone} tone="role-other" title={<span className="m5-title-tag">主动推送<StatusTag tone="neutral" icon={CircleOff}>目前不生效</StatusTag></span>}
      explain="专属客服主动给用户发消息的参数。后端目前没有执行器：参数能保存，但不会给任何用户推送，也不能启用（已提后端）。和客服的「同时接待上限」不是一回事。">
      <ConfigList label="主动推送">
        <ConfigRow name="总开关" what="主动推送开不开" when="后端目前只接受停用" value={<StatusTag tone="done" icon={CircleOff}>{masterOn ? "已启用（未推送）" : "已停用"}</StatusTag>}
          action={canManageM5Operations ? (describedBy) => <Button size="sm" aria-describedby={describedBy} data-proof="session-policy-enabled" disabled={!sessionTemplatesAvailable || writePending || (!masterOn && !ADVISOR_AUTOPUSH_EXECUTOR_AVAILABLE)}
            disabledReason={sessionTemplatesAvailable && !masterOn && !ADVISOR_AUTOPUSH_EXECUTOR_AVAILABLE ? "主动推送还没有执行器，后端不接受启用" : undefined} onClick={toggleAdvisorPush}>{masterOn ? "停用" : "启用"}</Button> : undefined} />
        {policyRow("delayMs", "首推延迟", sessionTemplatesAvailable ? shown(delayText()) : "—", " 毫秒", "用户进会话后等多久发第一条")}
        {policyRow("cooldownHours", "冷却时间", shown(policyDisplay("cooldownHours")) === "—" ? "—" : `${policyDisplay("cooldownHours")} 小时`, " 小时", "同一用户两次主动推送至少隔多久")}
        {policyRow("maxPerSession", "单会话上限", shown(policyDisplay("maxPerSession")) === "—" ? "—" : `${policyDisplay("maxPerSession")} 条`, " 条", "一次会话里最多主动发几条")}
        <ConfigRow name="受众" what="主动推送发给哪类用户；是整体的，不是某一条话术的" when="保存后立即记下；主动推送上线前不会推送"
          value={sessionTemplatesAvailable ? audienceOptions.length > 0 ? currentAudience || "—" : "后端没给可选受众" : "—"}
          action={canManageM5Operations ? (describedBy) => <Button size="sm" aria-describedby={describedBy} data-proof="session-policy-audience" disabled={!sessionTemplatesAvailable || writePending || audienceOptions.length === 0 || blocked(POLICY_KEY("audience"))} onClick={editAudience}>调整</Button> : undefined} />
      </ConfigList>
    </Panel>
  </>;

  const pendingRows = pendingCommands.map(record => {
    const command = record.m5;
    const body = command ? JSON.parse(command.request.body) : null;
    const statusName = (status: string) => status === "published" ? "已发布" : status === "archived" ? "已归档" : "草稿";
    const change = !command ? "结果未知" : command.profile
      ? `${command.profile.name} · 同时接待上限 ${command.profile.maxConcurrent} → ${body.maxConcurrent}`
      : command.request.method === "POST" ? command.text
        : command.key === CAT_KEY("advisor") ? `${command.text} · ${body.expectedEnabled ? "已启用" : "已停用"} → ${body.enabled ? "已启用" : "已停用"}`
          : command.key.startsWith("I.session.advisor.policy.") ? `${command.beforeValue} → ${body.value}`
            : `${statusName(body.expectedStatus)} → ${statusName(body.status)} · ${command.text}`;
    return { key: record.commandKey, name: command?.action.split(" · admin.")[0] ?? "结果未知", change, submittedAt: record.createdAt, expired: isRetryExpired(record), actions: <>
      <Button size="sm" disabled={writePending} onClick={() => void readCurrent()}>读回核对</Button>
      {command && !isRetryExpired(record) && <Button size="sm" variant="primary" disabled={writePending || !canRetry(command)} onClick={() => recover(record)}>按原请求重试</Button>}
    </> };
  });
  return (
    <>
      <M5PendingWrites rows={pendingRows} />
      {hasData ? <>
      {(showSeatOperations || showSeatProfiles) && pane("roster", roster)}
      {pane("content", content)}
      {pane("channels", channels)}
      </> : fallback}
      {profileAgent && (canManageSupportSeats || profileRecovery) && <AgentProfileModal agent={profileRecovery ? profileAgent : supportAgents.find(agent => agent.adminId === profileAgent.adminId) ?? profileAgent} agents={supportAgents} pending={profileRecovery}
        canSubmitNew={agentPageAvailable && supportAgents.some(agent => agent.adminId === profileAgent.adminId && !profileRestriction(agent)) && !needsRead && !ctx.contentLoading && !writePending && !blocked("I.support.agentProfile.__update", profileAgent.adminId) && Boolean(authorities?.includes("service_m1_write"))}
        ctx={{ ...ctx, setParam: async (key, value, meta) => {
        try { return profileRecovery ? await commitOriginal(profileRecovery, true) : await commitM5Write(key, value, meta, `${profileAgent.name} 客服接单设置已保存`); }
        catch (cause) { toast(displayAdminError(cause), "warn"); return false; }
      } }} onClose={() => { setProfileAgent(null); setProfileRecovery(undefined); }} />}
      {canManageSupportSeats && assignAgent && <AdvisorAssignModal agent={assignAgent} ctx={ctx} onClose={() => setAssignAgent(null)} />}
    </>
  );
}

function toggleList<T extends string>(rows: T[], item: T): T[] {
  return rows.includes(item) ? rows.filter((row) => row !== item) : [...rows, item];
}

function AgentProfileModal({ agent, agents, ctx, pending, canSubmitNew, onClose }: { agent: MSupportAgent; agents: MSupportAgent[]; ctx: MCtx; pending?: MCommandRecord; canSubmitNew: boolean; onClose: () => void }) {
  const originalInput = pending?.m5 ? JSON.parse(pending.m5.request.body) : null;
  const tagOptions = useMemo(
    () => Array.from(new Set([...agents.flatMap(item => item.tags ?? []), ...agent.tags, ...(originalInput?.tags ?? [])].filter(Boolean))) as string[],
    [agents, agent, pending],
  );
  const position = agent.position;
  const [tags, setTags] = useState<string[]>(originalInput?.tags ?? agent.tags ?? []);
  const [maxConcurrent, setMaxConcurrent] = useState(String(originalInput?.maxConcurrent ?? agent.maxConcurrent));
  const [enabled, setEnabled] = useState<boolean>(originalInput?.enabled ?? agent.enabled);
  const [transferable, setTransferable] = useState<boolean>(originalInput?.transferable ?? agent.transferable);
  const [busy, setBusy] = useState<boolean>(originalInput?.busy ?? agent.busy);
  const [reason, setReason] = useState(pending?.m5?.reason ?? "");
  const [saving, setSaving] = useState(false);
  const reasonOk = reason.trim().length >= 8 && reason.trim().length <= 200;
  const canSave = !saving && (pending ? !isRetryExpired(pending) && Boolean(useAdminAuth.getState().session?.authorities.includes("service_m1_write")) : canSubmitNew && reasonOk && maxConcurrent.trim() !== "" && Number.isInteger(Number(maxConcurrent)) && Number(maxConcurrent) >= 0 && Number(maxConcurrent) <= 40);

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const succeeded = await ctx.setParam("I.support.agentProfile.__update", JSON.stringify({
        adminId: agent.adminId,
        expectedVersion: agent.version,
        // M-56: the displayed type ("advisor") is the canonical role; the stored legacy routing flag is
        // left alone, so saving tags or capacity no longer rewrites it.
        tags,
        maxConcurrent: Number(maxConcurrent),
        enabled,
        transferable,
        busy,
      }), {
        action: "客服接单设置",
        reason: reason.trim(),
      });
      if (succeeded) {
        ctx.toast(`${agent.name} 客服接单设置已保存`);
        onClose();
      }
    } finally {
      setSaving(false);
    }
  };

  // 只显示用（F03 的提交修正归代码 worker）：如实写出现在保存会提交的上限，不悄悄改。
  const capText = maxConcurrent.trim();
  const capNumber = Number(capText);
  const capProblem = capText === "" || !Number.isInteger(capNumber) || capNumber < 0 || capNumber > 40 ? "要填 0–40 的整数" : "";
  const capNote = capText !== "" && !capProblem && capNumber === 0 ? "填 0：自动分配不再选他；已有客户、邀请继承和主管指定不受影响。" : undefined;

  return (
    <RdModal title="客服接单设置" icon={SlidersHorizontal} wide busy={saving} onClose={onClose}
      sub={<><StatusTag tone="progress" filled>保存后立即生效</StatusTag><span className="m5-modal-id">{agent.name} · 账号 #{agent.adminId}</span></>}
      footer={<>
        <Button disabled={saving} onClick={onClose}>取消</Button>
        <Button variant="primary" loading={saving} disabled={!canSave} disabledReason={!saving && !pending && !canSubmitNew ? "名册没读到，或这位客服已不在你的范围" : !saving && !reasonOk ? "操作理由要 8–200 字" : !saving && canSubmitNew && !canSave ? "同时接待上限要填 0–40 的整数" : undefined} onClick={() => void save()}>{pending ? "按原请求重试" : "保存"}</Button>
      </>}>
      <Facts>
        <Fact k="客服">{agent.name || "名称未同步"} · {agent.email || "—"}</Fact>
        <Fact k="坐席类型"><span data-proof="m5-seat-position-field">{seatLabel(position)}</span></Fact>
        <Fact k="现在服务">{agent.assignedUserCount} 位客户</Fact>
      </Facts>
      {pending && <Notice tone="warn" title="结果未知">{isRetryExpired(pending) ? "原请求超过 24 小时，不能再重试，只能读回核对。" : "上次保存可能已经生效。内容已锁定为原请求，按原请求重试不会重复执行。"}</Notice>}
      <p className="rd-note">接待资格和主管资格在账号管理里改。</p>
      <DiffField label="同时接待上限" before={String(agent.maxConcurrent)} unit="位" hint="0–40 的整数，0 表示不自动分配给他" error={capProblem || undefined} note={capNote}>
        {(control) => <NumberInput {...control} unit="位" min={0} max={40} step={1} value={maxConcurrent} disabled={saving || Boolean(pending)} onChange={(event) => setMaxConcurrent(event.target.value)} />}
      </DiffField>
      <div className="m5-profile-grid">
      <CheckGroup legend="接待开关">
        <Check label="开放接待" help="关闭后不参与自动分配和邀请继承" checked={enabled} disabled={saving || Boolean(pending)} onChange={() => setEnabled((v) => !v)} />
        <Check label="允许被转交" help="关闭后转交会话时选不到他" checked={transferable} disabled={saving || Boolean(pending)} onChange={() => setTransferable((v) => !v)} />
        <Check label="暂停接新单" help="自动分配和人工转接都选不到他" checked={busy} disabled={saving || Boolean(pending)} onChange={() => setBusy((v) => !v)} />
      </CheckGroup>
      <div className="m5-tag-checks">
        <CheckGroup legend="标签" explain="只能从名册里已有的标签里选，最多 10 个。" help={tagOptions.length === 0 ? "名册里还没有任何标签。" : undefined}>
          {tagOptions.map((tag) => <Check key={tag} label={tag} checked={tags.includes(tag)} disabled={saving || Boolean(pending)} onChange={() => setTags((rows) => toggleList(rows, tag))} />)}
        </CheckGroup>
      </div>
      </div>
      <Field label="操作理由" required hint="8–200 字">
        {(control) => <Textarea {...control} rows={3} maxLength={200} value={reason} disabled={saving || Boolean(pending)} count={`${reason.trim().length}/200`} onChange={(e) => setReason(e.target.value)} placeholder="例如：主管调整分工，这位客服本周只接高价值客户" />}
      </Field>
    </RdModal>
  );
}

function userIdOf(profile: MAdvisorBindingUser): number {
  return Number.isSafeInteger(profile.userId) && profile.userId > 0 ? profile.userId : 0;
}

function userNoOf(profile: MAdvisorBindingUser): string {
  return profile.userNo || `U${String(profile.userId).padStart(8, "0")}`;
}

function AdvisorAssignModal({ agent, ctx, onClose }: { agent: MSupportAgent; ctx: MCtx; onClose: () => void }) {
  const [keyword, setKeyword] = useState("");
  const [userPage, setUserPage] = useState(1);
  const [userTotal, setUserTotal] = useState(0);
  const [userReload, setUserReload] = useState(0);
  const [users, setUsers] = useState<MAdvisorBindingUser[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<MAdvisorBindingUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const allActiveAssignments = useMemo(
    () => parseParamArray<MAdvisorAssignment>(ctx.pget(ASSIGNMENT_LIST_KEY), [])
      .filter((row) => row.status === "ACTIVE"),
    [ctx.params, ctx],
  );
  const activeAssignmentByUserId = useMemo(() => {
    const map = new Map<number, MAdvisorAssignment>();
    allActiveAssignments.forEach((row) => {
      if (Number.isFinite(Number(row.userId)) && !map.has(row.userId)) {
        map.set(row.userId, row);
      }
    });
    return map;
  }, [allActiveAssignments]);
  const boundUserIds = useMemo(
    () => new Set(activeAssignmentByUserId.keys()),
    [activeAssignmentByUserId],
  );
  const selectedUserIds = useMemo(
    () => new Set(selectedUsers.map(userIdOf).filter((userId) => userId > 0)),
    [selectedUsers],
  );
  const bindableSelectedUsers = selectedUsers.filter((user) => {
    const userId = userIdOf(user);
    return userId > 0 && !boundUserIds.has(userId);
  });
  const reasonOk = reason.trim().length >= 8 && reason.trim().length <= 200;
  const canSave = !saving && bindableSelectedUsers.length > 0 && reasonOk;

  useEffect(() => {
    let alive = true;
    let pageRedirected = false;
    setLoading(true);
    setError("");
    const timer = window.setTimeout(() => {
      fetchMAdvisorBindingUsers({ keyword: keyword.trim(), pageNum: userPage, pageSize: SUPPORT_USER_PAGE_SIZE })
        .then((page) => {
          if (!alive) return;
          const safePage = clampPage(userPage, page.total, SUPPORT_USER_PAGE_SIZE);
          if (safePage !== userPage) {
            setUsers([]);
            setUserTotal(page.total);
            pageRedirected = true;
            setUserPage(safePage);
            return;
          }
          setUsers(page.records);
          setUserTotal(page.total);
        })
        .catch((err) => {
          if (!alive) return;
          setUsers([]);
          setUserTotal(0);
          setError(displayAdminError(err));
        })
        .finally(() => {
          if (alive && !pageRedirected) setLoading(false);
        });
    }, 250);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [keyword, userPage, userReload]);

  const toggleUser = (user: MAdvisorBindingUser) => {
    const userId = userIdOf(user);
    if (!userId || boundUserIds.has(userId)) return;
    setSelectedUsers((prev) => {
      const exists = prev.some((row) => userIdOf(row) === userId);
      return exists ? prev.filter((row) => userIdOf(row) !== userId) : [...prev, user];
    });
  };

  const save = async () => {
    if (!canSave) return;
    const userIds = Array.from(new Set(bindableSelectedUsers.map(userIdOf).filter((userId) => userId > 0)));
    if (userIds.length === 0) return;
    setSaving(true);
    try {
      const succeeded = await ctx.setParam("I.support.advisorAssignment.__create", JSON.stringify({
        adminId: agent.adminId,
        userIds,
      }), {
        action: "绑定专属客服",
        reason: reason.trim(),
      });
      if (succeeded) {
        ctx.toast(`${agent.name} 已绑定 ${userIds.length} 个用户`);
        onClose();
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="绑定专属客服服务用户"
      icon="users"
      wide
      onClose={onClose}
      footer={<><span className="sub">已选 {bindableSelectedUsers.length} 人</span><span style={{ flex: 1 }} /><button type="button" className="btn btn-sec btn-sm" disabled={saving} onClick={onClose}>取消</button><button type="button" data-proof="advisor-assignment-save" className="btn btn-pri btn-sm" disabled={!canSave} onClick={() => void save()}>{saving ? "绑定中..." : `绑定${canSave ? ` ${bindableSelectedUsers.length} 人` : " · 待补全"}`}</button></>}
    >
      <div className="mcol m5-modal-grid" style={{ gap: 22 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>{agent.name}</div>
            <div data-proof="m5-seat-position-label" className="dim2" style={{ fontSize: 11.5, marginTop: 3 }}>{seatLabel(agent.position)} · <span className="mono">账号 #{agent.adminId}</span></div>
          </div>
          <label className="field" style={{ marginBottom: 0 }}>
            <span>搜索用户</span>
            <div className="inp">
              <Icon name="search" size={15} />
              <input value={keyword} onChange={(e) => { setKeyword(e.target.value); setUserPage(1); }} placeholder="用户名 / 用户编码 / 手机号（后4位起）" />
            </div>
            <span className="tiny" style={{ color: "var(--ink-4)", marginTop: 4 }}>支持完整手机号、带区号手机号或末尾至少 4 位；不搜索时可翻页浏览全部用户。</span>
          </label>
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            <div className="sub" style={{ fontWeight: 600 }}>已选用户</div>
            {bindableSelectedUsers.length === 0 ? (
              <div className="itint" style={{ padding: "10px 12px" }}>从右侧搜索结果中多选用户。</div>
            ) : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {bindableSelectedUsers.map((user) => (
                  <button
                    key={`selected-${userNoOf(user)}-${userIdOf(user)}`}
                    type="button"
                    className="chip"
                    onClick={() => toggleUser(user)}
                    title="移除已选用户"
                    style={{ height: 24, fontSize: 11.5 }}
                  >
                    {userNoOf(user)} · {user.nickname || "未命名用户"}
                    <Icon name="x" size={12} />
                  </button>
                ))}
              </div>
            )}
          </div>
          <label className="field" style={{ marginBottom: 0 }}>
            <span>绑定理由 <b style={{ color: "var(--danger)" }}>*</b></span>
            <textarea className="fld" rows={3} maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="例:高价值用户进入专属客服服务名单,由客服主管分配跟进。" style={{ resize: "vertical" }} />
            <span className="tiny" style={{ color: "var(--ink-4)", marginTop: 4 }}>理由需填写 8-200 字。</span>
          </label>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
          <div className="sub" style={{ fontWeight: 600 }}>可选用户</div>
          {loading && <div className="itint">正在查询用户…</div>}
          {!loading && error && <div className="itint">用户加载失败 · {error} <button type="button" className="btn btn-sec btn-sm" onClick={() => setUserReload((value) => value + 1)}>重试</button></div>}
          {!loading && !error && users.length === 0 && (
            <div className="itint">
              <div style={{ fontSize: 13 }}>暂无匹配用户</div>
              <div className="tiny" style={{ color: "var(--ink-4)", marginTop: 4 }}>换一个昵称、用户编码或手机号关键词。</div>
            </div>
          )}
          {!loading && !error && users.map((user) => {
            const id = userIdOf(user);
            const checked = selectedUserIds.has(id);
            const boundAssignment = activeAssignmentByUserId.get(id);
            const alreadyBound = Boolean(boundAssignment);
            const boundToCurrent = boundAssignment?.agentAdminId === agent.adminId;
            return (
              <button
                key={`${userNoOf(user)}-${id}`}
                type="button"
                data-proof="advisor-user-option"
                disabled={alreadyBound}
                onClick={() => toggleUser(user)}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 10px", borderRadius: 10, border: `1px solid ${checked ? "var(--m-hd-border)" : "var(--border)"}`, background: checked ? "var(--m-hd-soft)" : alreadyBound ? "var(--bg-2)" : "transparent", cursor: alreadyBound ? "not-allowed" : "pointer", textAlign: "left", fontFamily: "inherit", opacity: alreadyBound ? 0.62 : 1 }}
              >
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 13, fontWeight: 500, color: "var(--ink)" }}>{user.nickname || "未命名用户"}</span>
                  <span className="mono dim2" style={{ fontSize: 11.5 }}>{userNoOf(user)} · {user.phoneMasked || "未留手机号"}</span>
                </span>
                {alreadyBound && <span className="chip" style={{ height: 20, fontSize: 11, border: "none" }}>{boundToCurrent ? "已绑定" : "已绑定其他坐席"}</span>}
                {checked && <Icon name="check" size={15} />}
              </button>
            );
          })}
          {!loading && !error && <Pager page={userPage} total={userTotal} pageSize={SUPPORT_USER_PAGE_SIZE} onPage={setUserPage} />}
        </div>
      </div>
    </Modal>
  );
}

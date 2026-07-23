"use client";

/**
 * M5 话术与模板配置 — 会话类别启停 + 顾问 AutoPushPolicy + 受众圈定 + 话术库 + 即时回复模板(helpdesk 设计稿,由 I9 迁出)。
 * 类别 / 顾问策略 / 话术 / 回复模板读写走后端 content/session-template 接口。
 * I.session.* 为 M 容器传入的视图适配键。
 * ai(Nova)类别推送/模板归 I2,本页只渲染只读「I2 管」。高敏配置:变更走确认 + 理由。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon, Modal, Toggle, type IconName } from "../design-kit";
import type { User360Profile } from "@/lib/admin/user360-client";
import {
  fetchMSupportWorkbenchUsers,
  fetchMReplyTemplatesPage,
  fetchMSessionScriptsPage,
  fetchMSupportAgentsPage,
  type AdminPage,
  type MAdvisorAssignment,
  type MSupportAgentPage,
  type MSupportAgent,
  type MSupportServiceType,
} from "@/lib/admin/m-client";
import { useAdminAuth } from "@/lib/store/admin-auth";
import {
  type AdvisorScript,
  type SessionCategory,
  type SessionReplyTpl,
  type SessionType,
} from "./data";
import type { MCtx } from "./types";

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
const SCRIPT_PAGE_SIZE = 5;
const REPLY_TEMPLATE_PAGE_SIZE = 5;

const DEFAULT_ADVISOR_POLICY = { enabled: "on", delayMs: 1500, cooldownHours: 24, maxPerSession: 1 };

const CAT_ICON: Record<SessionType, IconName> = { advisor: "users", support: "bell", ai: "power" };

function SensTag() {
  return (
    <span className="sens-tag">
      <Icon name="shield" size={12} />
      高敏 · 需理由
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
  return agent.seatType === "DEDICATED" || agent.position.includes("专属");
}

function isSupportSupervisor(agent: MSupportAgent | null | undefined): boolean {
  return Boolean(agent?.seatType === "MANAGER" || agent?.position.includes("主管"));
}

function Pager({
  page,
  total,
  pageSize,
  onPage,
}: {
  page: number;
  total: number;
  pageSize: number;
  onPage: (page: number) => void;
}) {
  const pages = totalPages(total, pageSize);
  const safePage = clampPage(page, total, pageSize);
  const start = total === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const end = Math.min(total, safePage * pageSize);
  return (
    <div className="row" style={{ justifyContent: "flex-end", gap: 8, padding: "10px 12px 4px", borderTop: total > 0 ? "1px solid var(--border)" : "none" }}>
      <span className="dim2" style={{ fontSize: 11.5, marginRight: "auto" }}>
        {total === 0 ? "暂无记录" : `${start}-${end} / ${total}`}
      </span>
      <button type="button" className="btn btn-sec btn-sm" disabled={safePage <= 1} onClick={() => onPage(safePage - 1)}>
        <span style={{ display: "inline-flex", transform: "rotate(180deg)" }}><Icon name="chevron" size={14} /></span>
        上一页
      </button>
      <span className="mono" style={{ minWidth: 54, textAlign: "center", fontSize: 12, color: "var(--ink-3)" }}>{safePage} / {pages}</span>
      <button type="button" className="btn btn-sec btn-sm" disabled={safePage >= pages} onClick={() => onPage(safePage + 1)}>
        下一页
        <Icon name="chevron" size={14} />
      </button>
    </div>
  );
}

export function M5Scripts({ ctx }: { ctx: MCtx }) {
  const { pget, setParam, toast, openActionConfirm } = ctx;
  const currentRole = useAdminAuth((s) => s.session?.role ?? s.role);
  const currentAdminId = useAdminAuth((s) => s.session?.adminId ?? 0);
  const authorities = useAdminAuth((s) => s.session?.authorities);
  const currentRoleKey = String(currentRole);
  const categories = parseParamArray<SessionCategory>(pget(CATEGORY_LIST_KEY), []);
  const scripts = parseParamArray<AdvisorScript>(pget(SCRIPT_LIST_KEY), []);
  const replyTemplates = parseParamArray<SessionReplyTpl>(pget(REPLY_TEMPLATE_LIST_KEY), []);
  const supportAgents = useMemo(() => parseParamArray<MSupportAgent>(pget(AGENT_LIST_KEY), []), [ctx.params, pget]);
  const advisorAssignments = useMemo(() => parseParamArray<MAdvisorAssignment>(pget(ASSIGNMENT_LIST_KEY), []), [ctx.params, pget]);
  const audienceOptions = useMemo(() => {
    const rows = parseParamArray<string>(pget("I.session.audienceOptions"), []);
    return rows;
  }, [ctx.params, pget]);
  const defaultAudience = audienceOptions[0] ?? "";
  const [profileAgent, setProfileAgent] = useState<MSupportAgent | null>(null);
  const [assignAgent, setAssignAgent] = useState<MSupportAgent | null>(null);
  const [agentPage, setAgentPage] = useState(1);
  const [scriptPage, setScriptPage] = useState(1);
  const [replyTemplatePage, setReplyTemplatePage] = useState(1);
  const [agentPageData, setAgentPageData] = useState<MSupportAgentPage | null>(null);
  const [scriptPageData, setScriptPageData] = useState<AdminPage<AdvisorScript> | null>(null);
  const [replyTemplatePageData, setReplyTemplatePageData] = useState<AdminPage<SessionReplyTpl> | null>(null);
  const [agentPageLoading, setAgentPageLoading] = useState(false);
  const [scriptPageLoading, setScriptPageLoading] = useState(false);
  const [replyTemplatePageLoading, setReplyTemplatePageLoading] = useState(false);
  const [agentPageError, setAgentPageError] = useState("");
  const [scriptPageError, setScriptPageError] = useState("");
  const [replyTemplatePageError, setReplyTemplatePageError] = useState("");
  const [writePending, setWritePending] = useState(false);
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
  const scriptTotal = scriptPageData?.total ?? scripts.length;
  const replyTemplateTotal = replyTemplatePageData?.total ?? replyTemplates.length;
  const visibleSupportAgents = useMemo(
    () => agentPageData?.records ?? pageSlice(supportAgents, agentPage, SUPPORT_AGENT_PAGE_SIZE),
    [agentPageData, supportAgents, agentPage],
  );
  const visibleAdvisorAssignments = agentPageData?.advisorAssignments ?? advisorAssignments;
  const currentSupportAgent = useMemo(
    () => supportAgents.find((agent) => agent.adminId === currentAdminId) ?? null,
    [currentAdminId, supportAgents],
  );
  const isSuperAdmin = currentRoleKey === "superadmin" || currentRoleKey === "super";
  const hasM5WriteAuthority = isSuperAdmin || Boolean(authorities?.includes("service_m5_write"));
  const canWriteM5 = hasM5WriteAuthority && (isSuperAdmin || isSupportSupervisor(currentSupportAgent));
  const canManageSupportSeats = (isSuperAdmin || Boolean(authorities?.includes("service_m1_write")))
    && (isSuperAdmin || isSupportSupervisor(currentSupportAgent));
  const sessionTemplatesAvailable = pget("I.session.templatesAvailable") === "1";
  const visibleScripts = useMemo(
    () => scriptPageData?.records ?? pageSlice(scripts, scriptPage, SCRIPT_PAGE_SIZE),
    [scriptPageData, scripts, scriptPage],
  );
  const visibleReplyTemplates = useMemo(
    () => replyTemplatePageData?.records ?? pageSlice(replyTemplates, replyTemplatePage, REPLY_TEMPLATE_PAGE_SIZE),
    [replyTemplatePageData, replyTemplates, replyTemplatePage],
  );

  const commitM5Write = async (
    key: string,
    value: string,
    meta: { action: string; reason: string; commandKey?: string },
    successMessage: string,
  ): Promise<boolean> => {
    if (writePending) return false;
    setWritePending(true);
    try {
      const succeeded = await setParam(key, value, meta);
      if (succeeded) toast(successMessage);
      return succeeded;
    } finally {
      setWritePending(false);
    }
  };

  useEffect(() => {
    let alive = true;
    setAgentPageLoading(true);
    setAgentPageError("");
    fetchMSupportAgentsPage(agentPage, SUPPORT_AGENT_PAGE_SIZE)
      .then((page) => {
        if (alive) setAgentPageData(page);
      })
      .catch((err) => {
        if (!alive) return;
        setAgentPageError(err instanceof Error ? err.message : "SUPPORT_AGENT_PAGE_FAILED");
      })
      .finally(() => {
        if (alive) setAgentPageLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [agentPage, agentSnapshot, assignmentSnapshot]);

  useEffect(() => {
    let alive = true;
    setScriptPageLoading(true);
    setScriptPageError("");
    fetchMSessionScriptsPage(scriptPage, SCRIPT_PAGE_SIZE)
      .then((page) => {
        if (alive) setScriptPageData(page);
      })
      .catch((err) => {
        if (!alive) return;
        setScriptPageError(err instanceof Error ? err.message : "SESSION_SCRIPT_PAGE_FAILED");
      })
      .finally(() => {
        if (alive) setScriptPageLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [scriptPage, scripts.length]);

  useEffect(() => {
    let alive = true;
    setReplyTemplatePageLoading(true);
    setReplyTemplatePageError("");
    fetchMReplyTemplatesPage(replyTemplatePage, REPLY_TEMPLATE_PAGE_SIZE)
      .then((page) => {
        if (alive) setReplyTemplatePageData(page);
      })
      .catch((err) => {
        if (!alive) return;
        setReplyTemplatePageError(err instanceof Error ? err.message : "SESSION_REPLY_TEMPLATE_PAGE_FAILED");
      })
      .finally(() => {
        if (alive) setReplyTemplatePageLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [replyTemplatePage, replyTemplates.length]);

  useEffect(() => {
    setAgentPage((page) => clampPage(page, agentTotal, SUPPORT_AGENT_PAGE_SIZE));
  }, [agentTotal]);
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
      detail: <>解除 <b>{agent.name}</b> 与用户 <span className="mono">{row.userNo}</span> 的专属客服服务关系。解绑后该用户不再固定分配给该客服。</>,
      amplifies: false,
      reasonMin: 8,
      reasonMax: 200,
      run: (reason: string) => commitM5Write("I.support.advisorAssignment.__delete", JSON.stringify({ adminId: agent.adminId, assignmentId: row.id }), {
          action: "M5 专属客服解绑",
          reason,
        }, `${row.userNo} 已解绑`),
    });
  };

  // ── 类别启停:处置(不传 edit)──
  const toggleCat = (cat: { type: SessionType; name: string; enabled: boolean }) => {
    if (!canWriteM5 || !sessionTemplatesAvailable || writePending) return;
    const on = catEnabled(cat);
    openActionConfirm({
      action: <>{on ? "禁用" : "启用"}会话类别 · {cat.name}</>,
      detail: on ? <>该类别从会话中心入口移除;<b>进行中会话保持 open,不强制关闭</b>。仅入口动作,不是 J1 熔断。</> : <>恢复后新用户可在会话中心选择该类别。</>,
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
    if (!canWriteM5 || !sessionTemplatesAvailable || writePending) return;
    openActionConfirm({
      action: <>{masterOn ? "停用" : "启用"}顾问主动推送</>,
      detail: masterOn ? <>停用后顾问不再主动触达,只在用户发起时回复。引导转化触点暂停。</> : <>启用后顾问按下方 AutoPushPolicy 主动触达用户(引导购机 / 锁仓 / 复投)。</>,
      amplifies: false,
      reasonMin: 8,
      reasonMax: 200,
      run: (reason: string) => commitM5Write(
        POLICY_KEY("enabled"),
        masterOn ? "off" : "on",
        { action: `${masterOn ? "停用" : "启用"}顾问主动推送 · admin.conversation_autopush_toggled`, reason },
        `顾问主动推送${masterOn ? "已停用" : "已启用"}`,
      ),
    });
  };

  // ── AutoPushPolicy 调参:传 edit ──
  const editPolicy = (field: string, label: string, current: string, unit: string) =>
    canWriteM5 && sessionTemplatesAvailable && !writePending && openActionConfirm({
      action: <>调整顾问推送 · {label}</>,
      detail: <>影响全体进入会话中心用户的顾问主动触达频率/时机。对新会话即时生效。</>,
      amplifies: false,
      edit: { kind: "text", current, unit },
      reasonMin: 8,
      reasonMax: 200,
      run: (reason: string, v?: string) => v
        ? commitM5Write(
          POLICY_KEY(field),
          v,
          { action: `调整顾问推送 ${label} · admin.conversation_autopush_changed`, reason },
          `${label} 已更新 · ${v}${unit}`,
        )
        : false,
    });

  // ── 受众圈定:调参(select edit)──
  const editAudience = () =>
    canWriteM5 && sessionTemplatesAvailable && !writePending && audienceOptions.length > 0 && openActionConfirm({
      action: <>圈定顾问推送受众</>,
      detail: <>限定顾问主动触达的人群范围;对新会话即时生效,已在会话中的用户不受影响。</>,
      amplifies: false,
      edit: { kind: "select", current: currentAudience, options: audienceOptions },
      reasonMin: 8,
      reasonMax: 200,
      run: (reason: string, v?: string) => v
        ? commitM5Write(
          POLICY_KEY("audience"),
          v,
          { action: "圈定顾问推送受众 · admin.conversation_autopush_changed", reason },
          `推送受众已更新 · ${v}`,
        )
        : false,
    });

  // ── 话术发布 / 下架 / 新增:处置(新增传 edit 录 key)──
  const publishScript = (id: string, currentStatus: AdvisorScript["status"]) =>
    canWriteM5 && sessionTemplatesAvailable && !writePending && currentStatus !== "archived" && openActionConfirm({
      action: <>{currentStatus === "published" ? "归档" : "发布"}顾问话术 · {id}</>,
      detail: currentStatus === "published" ? <>归档后从坐席可选话术池移除,归档为终态。</> : <>发布即对坐席快捷话术菜单生效;话术挂双语词条(I6),服务器校验中英镜像。</>,
      amplifies: false,
      reasonMin: 8,
      reasonMax: 200,
      run: (reason: string) => commitM5Write(
        SCRIPT_KEY(id),
        currentStatus === "published" ? "archived" : "published",
        { action: `${currentStatus === "published" ? "归档" : "发布"}顾问话术 ${id} · admin.conversation_script_published`, reason },
        `${id} ${currentStatus === "published" ? "已归档" : "发布已生效"}`,
      ),
    });
  const newScript = () =>
    canWriteM5 && sessionTemplatesAvailable && !writePending && audienceOptions.length > 0 && openActionConfirm({
      action: <>新增顾问话术</>,
      detail: <>新建草稿后进入坐席可选话术库;发布走操作确认。</>,
      amplifies: false,
      edit: { kind: "text", current: "", unit: "话术文案" },
      reasonMin: 8,
      reasonMax: 200,
      run: async (reason: string, v?: string) => {
        const text = v?.trim();
        if (!text) return false;
        const audience = currentAudience || defaultAudience;
        const succeeded = await commitM5Write("I.session.script.__create", JSON.stringify({ scriptGroup: "开场", text, ctaPath: "—", audience, status: "draft" }), {
          action: "新增顾问话术 · admin.conversation_script_created",
          reason,
          commandKey: `m5:create-script:${text}:${audience}`,
        }, "话术已创建 · 待发布确认");
        if (succeeded) setScriptPage(totalPages(scriptTotal + 1, SCRIPT_PAGE_SIZE));
        return succeeded;
      },
    });

  // ── 模板发布 / 归档:处置(不传 edit)──
  const toggleTpl = (id: string, currentStatus: SessionReplyTpl["status"]) =>
    canWriteM5 && sessionTemplatesAvailable && !writePending && currentStatus !== "archived" && openActionConfirm({
      action: <>{currentStatus === "published" ? "归档" : "发布"}回复模板 · {id}</>,
      detail: currentStatus === "published" ? <>归档后从快捷回复池移除,归档为终态。</> : <>发布后进入坐席快捷回复池。</>,
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
    canWriteM5 && sessionTemplatesAvailable && !writePending && openActionConfirm({
      action: <>新增即时回复模板</>,
      detail: <>新增草稿后进入坐席快捷回复模板库,发布后可在 M2/M3 回复框中选用。</>,
      amplifies: false,
      edit: { kind: "text", current: "", unit: "模板文案" },
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

  const tileStyle = { padding: "11px 12px", background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 10, textAlign: "left" as const, cursor: "pointer", fontFamily: "inherit" };
  const tileHead = (k: string) => (
    <div className="dim2" style={{ fontSize: 11.5, display: "flex", alignItems: "center", gap: 6 }}>
      {k}
      <span style={{ flex: 1 }} />
      <span style={{ color: "var(--m-hd-2)", fontSize: 11 }}>调整</span>
    </div>
  );
  const tileVal = (v: string) => <div className="mono" style={{ fontSize: 15, marginTop: 5, color: "var(--ink)" }}>{v}</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <p className="dim" style={{ margin: 0, fontSize: 13 }}>管会话类别、顾问主动推送、话术和回复模板。改动要确认 + 填理由。</p>
      {!sessionTemplatesAvailable && (
        <div className="itint">话术与模板后端当前不可用，页面已进入只读保护；恢复同步后才能修改。</div>
      )}
      {sessionTemplatesAvailable && !canWriteM5 && (
        <div className="itint">当前账号只有查看权限；仅超级管理员或客服主管可维护 M5 配置。</div>
      )}

      <div className="card">
        <div className="card-pad" style={{ paddingBottom: 10, display: "flex", alignItems: "center", gap: 10 }}>
          <div className="sec-h" style={{ margin: 0 }}>
            <span className="t">客服岗位与专属客服</span>
            <span className="n">{agentTotal} 名客服</span>
          </div>
          <span className="dim2" style={{ fontSize: 11.5 }}>名单来自 A1 全局客服角色 · 坐席类型由 M1 分配,M5 维护接派单与专属关系</span>
          <span className="sp" style={{ flex: 1 }} />
          <SensTag />
        </div>
        <div style={{ padding: "0 8px 8px" }}>
          {agentPageLoading && <div className="itint" style={{ margin: "0 10px 8px" }}>正在加载客服分页...</div>}
          {!agentPageLoading && agentPageError && (
            <div className="itint" style={{ margin: "0 10px 8px" }}>客服分页加载失败 · {agentPageError}</div>
          )}
          {agentTotal === 0 ? (
            <div className="itint" style={{ margin: 10 }}>
              <div style={{ fontSize: 13 }}>暂无客服管理员</div>
              <div className="tiny" style={{ color: "var(--ink-4)", marginTop: 4 }}>请先在平台管理员里给管理员分配客服角色。</div>
            </div>
          ) : visibleSupportAgents.map((agent) => {
            const assignments = visibleAdvisorAssignments.filter((row) => row.agentAdminId === agent.adminId && row.status === "ACTIVE");
            const advisorEnabled = agent.serviceTypes.includes("advisor");
            return (
              <div key={agent.id} style={{ display: "grid", gridTemplateColumns: "minmax(180px, 1fr) 220px minmax(220px, 1.2fr) 170px", gap: 12, alignItems: "center", padding: "12px", borderTop: "1px solid var(--border)" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 13.5, fontWeight: 500, color: "var(--ink)" }}>{agent.name}</span>
                    <span className={`stat ${agent.enabled ? "active" : "closed"}`}>{agent.enabled ? "启用" : "停用"}</span>
                    {agent.busy && <span className="bdg warn">暂停接派单</span>}
                  </div>
                  <div className="dim2" style={{ fontSize: 11.5, marginTop: 3 }}>{agent.email || agent.adminRole || "客服管理员"} · <span className="mono">A1#{agent.adminId}</span></div>
                </div>
                <div>
                  <div style={{ fontSize: 12.5, color: "var(--ink-2)" }}>{agent.position}</div>
                  <div className="row wrap" style={{ gap: 5, marginTop: 5 }}>
                    {agent.serviceTypes.map((type) => (
                      <span key={type} className="chip" style={{ height: 18, fontSize: 11, border: "none" }}>{type === "advisor" ? "专属客服服务" : "普通客服"}</span>
                    ))}
                  </div>
                </div>
                <div style={{ minWidth: 0 }}>
                  <div className="dim2" style={{ fontSize: 11.5 }}>服务用户 {assignments.length} / 接派单上限 {agent.maxConcurrent}</div>
                  {assignments.length === 0 ? (
                    <div className="dim2" style={{ fontSize: 11.5, marginTop: 5 }}>{advisorEnabled ? "暂无专属客服绑定" : "未开启专属客服服务"}</div>
                  ) : (
                    <div className="row wrap" style={{ gap: 5, marginTop: 6 }}>
                      {assignments.slice(0, 4).map((row) => (
                        canManageSupportSeats ? (
                          <button key={row.id} type="button" className="chip" disabled={writePending} title="解绑专属客服" onClick={() => unbindAdvisor(agent, row)}>
                            {row.nickname} · <span className="mono">{row.userNo}</span>
                            <Icon name="x" size={11} />
                          </button>
                        ) : (
                          <span key={row.id} className="chip">
                            {row.nickname} · <span className="mono">{row.userNo}</span>
                          </span>
                        )
                      ))}
                      {assignments.length > 4 && <span className="dim2" style={{ fontSize: 11.5 }}>+{assignments.length - 4}</span>}
                    </div>
                  )}
                </div>
                <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
                  {canManageSupportSeats && (
                    <>
                      <button type="button" className="btn btn-sec btn-sm" disabled={writePending} onClick={() => setProfileAgent(agent)}>
                        <Icon name="gauge" size={15} />
                        配置岗位
                      </button>
                      <button type="button" className="btn btn-pri btn-sm" disabled={writePending || !advisorEnabled || !isDedicatedSupportAgent(agent)} onClick={() => setAssignAgent(agent)} title={advisorEnabled && isDedicatedSupportAgent(agent) ? "绑定服务用户" : "先在 M1 分配为专属客服并开启专属客服服务"}>
                        <Icon name="users" size={15} />
                        绑定用户
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
          <Pager page={agentPage} total={agentTotal} pageSize={SUPPORT_AGENT_PAGE_SIZE} onPage={setAgentPage} />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.15fr 1fr", gap: 16 }}>
        <div className="card card-pad">
          <div className="sec-h">
            <span className="t">会话类别</span>
            <span className="sp" />
            <SensTag />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {categories.map((c) => {
              const managed = c.type === "ai";
              const on = catEnabled(c);
              return (
                <div key={c.type} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 12px", background: "var(--surface-2)", borderRadius: 10 }}>
                  <span style={{ width: 32, height: 32, borderRadius: 9, display: "grid", placeItems: "center", background: managed ? "var(--surface-3)" : "var(--m-hd-soft)", color: managed ? "var(--ink-3)" : "var(--m-hd-2)" }}>
                    <Icon name={CAT_ICON[c.type]} size={16} />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 500, color: "var(--ink)" }}>
                      {c.name}
                      {managed && (
                        <span className="chip" style={{ height: 18, fontSize: 11.5, marginLeft: 8, border: "none" }}>
                          <Icon name="lock" size={11} />
                          AI 平台域管理
                        </span>
                      )}
                    </div>
                    <div className="dim2" style={{ fontSize: 11.5, marginTop: 2 }}>{c.managedBy} · <span className="mono">{c.type}</span></div>
                  </div>
                  {managed ? (
                    <span className="chip" style={{ color: on ? "var(--m-ok)" : "var(--ink-3)", border: "none" }}>{on ? "已启用(只读)" : "已停用(只读)"}</span>
                  ) : (
                    <span data-proof={`session-cat-toggle-${c.type}`}>
                      <Sw on={on} disabled={!canWriteM5 || !sessionTemplatesAvailable || writePending} onClick={() => toggleCat(c)} label={`${on ? "禁用" : "启用"} ${c.name}`} />
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="card card-pad">
          <div className="sec-h">
            <span className="t">顾问主动推送策略</span>
            <span className="sp" />
            <button type="button" data-proof="session-policy-enabled" className="btn btn-sec btn-sm" disabled={!canWriteM5 || !sessionTemplatesAvailable || writePending} onClick={toggleAdvisorPush}>
              <Icon name="gauge" size={16} />
              {masterOn ? "停用" : "启用"}总开关
            </button>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: "var(--surface-2)", borderRadius: 10, marginBottom: 10 }}>
            <span className="dim" style={{ fontSize: 13 }}>主动推送总开关</span>
            <SensTag />
            <span className="sp" style={{ flex: 1 }} />
            <span className={`stat ${masterOn ? "active" : "closed"}`}>{masterOn ? "ON" : "OFF"}</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <button type="button" data-proof="session-policy-delay" disabled={!canWriteM5 || !sessionTemplatesAvailable || writePending} style={tileStyle} onClick={() => editPolicy("delayMs", "首推延迟", policyVal("delayMs", DEFAULT_ADVISOR_POLICY.delayMs), " ms")}>
              {tileHead("首推延迟")}
              {tileVal(`${policyVal("delayMs", DEFAULT_ADVISOR_POLICY.delayMs)} ms`)}
            </button>
            <button type="button" data-proof="session-policy-cooldown" disabled={!canWriteM5 || !sessionTemplatesAvailable || writePending} style={tileStyle} onClick={() => editPolicy("cooldownHours", "冷却", policyVal("cooldownHours", DEFAULT_ADVISOR_POLICY.cooldownHours), " h")}>
              {tileHead("冷却时间")}
              {tileVal(`${policyVal("cooldownHours", DEFAULT_ADVISOR_POLICY.cooldownHours)} h`)}
            </button>
            <button type="button" data-proof="session-policy-max" disabled={!canWriteM5 || !sessionTemplatesAvailable || writePending} style={tileStyle} onClick={() => editPolicy("maxPerSession", "单会话上限", policyVal("maxPerSession", DEFAULT_ADVISOR_POLICY.maxPerSession), " 条")}>
              {tileHead("单会话上限")}
              {tileVal(`${policyVal("maxPerSession", DEFAULT_ADVISOR_POLICY.maxPerSession)} 条`)}
            </button>
            <button type="button" data-proof="session-policy-audience" disabled={!canWriteM5 || !sessionTemplatesAvailable || writePending || audienceOptions.length === 0} style={tileStyle} onClick={editAudience}>
              {tileHead("受众圈定")}
              {tileVal(audienceOptions.length > 0 ? currentAudience : "暂无可用受众")}
            </button>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-pad" style={{ paddingBottom: 10, display: "flex", alignItems: "center", gap: 10 }}>
          <div className="sec-h" style={{ margin: 0 }}>
            <span className="t">顾问主动话术</span>
              <span className="n">{scriptTotal} 条</span>
          </div>
          <SensTag />
          <span className="sp" style={{ flex: 1 }} />
          <button type="button" data-proof="session-script-new" className="btn btn-pri btn-sm" disabled={!canWriteM5 || !sessionTemplatesAvailable || writePending || audienceOptions.length === 0} onClick={newScript}>
            <Icon name="plus" size={16} />
            新增话术
          </button>
        </div>
        <div style={{ padding: "0 8px 8px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "92px 1fr 120px 88px 96px", gap: 10, padding: "0 12px 8px", fontSize: 11.5, color: "var(--ink-4)" }}>
            <span>编号 · 分类</span>
            <span>文案</span>
            <span>受众</span>
            <span>CTA</span>
            <span style={{ textAlign: "right" }}>发布</span>
          </div>
          {scriptPageLoading && <div className="itint" style={{ margin: "0 12px 8px" }}>正在加载话术分页...</div>}
          {!scriptPageLoading && scriptPageError && (
            <div className="itint" style={{ margin: "0 12px 8px" }}>话术分页加载失败 · {scriptPageError}</div>
          )}
          {scriptTotal === 0 && (
            <div className="itint" style={{ margin: "8px 12px 12px" }}>
              <div style={{ fontSize: 13 }}>暂无顾问主动话术</div>
              <div className="tiny" style={{ color: "var(--ink-4)", marginTop: 4 }}>点击新增话术后会写入后端话术库。</div>
            </div>
          )}
          {visibleScripts.map((a) => {
            const currentStatus = scriptStatus(a.id, a.status) as AdvisorScript["status"];
            const published = currentStatus === "published";
            const archived = currentStatus === "archived";
            return (
              <div key={a.id} style={{ display: "grid", gridTemplateColumns: "92px 1fr 120px 88px 96px", gap: 10, alignItems: "center", padding: "11px 12px", borderTop: "1px solid var(--border)" }}>
                <div>
                  <div className="idtag" style={{ fontSize: 11.5 }}>{a.id}</div>
                  <div className="dim2" style={{ fontSize: 11 }}>{a.group}</div>
                </div>
                <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.5 }}>{a.text}</div>
                <span className="dim" style={{ fontSize: 12 }}>{scriptAudience(a.id)}</span>
                <span style={{ fontSize: 12, color: a.ctaHref !== "—" ? "var(--m-hd-2)" : "var(--ink-4)" }}>{a.ctaHref}</span>
                <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8 }}>
                  <span className="dim2" style={{ fontSize: 11 }}>{archived ? "已归档" : published ? "已发布" : "草稿"}</span>
                  <span data-proof={`session-script-publish-${a.id}`}>
                    <Sw on={published} disabled={!canWriteM5 || !sessionTemplatesAvailable || writePending || archived} onClick={() => publishScript(a.id, currentStatus)} label={`${published ? "归档" : archived ? "已归档" : "发布"} ${a.id}`} />
                  </span>
                </div>
              </div>
            );
          })}
          <Pager page={scriptPage} total={scriptTotal} pageSize={SCRIPT_PAGE_SIZE} onPage={setScriptPage} />
        </div>
      </div>

      <div className="card">
        <div className="card-pad" style={{ paddingBottom: 10, display: "flex", alignItems: "center", gap: 10 }}>
          <div className="sec-h" style={{ margin: 0 }}>
            <span className="t">即时回复模板库</span>
              <span className="n">{replyTemplateTotal} 条</span>
          </div>
          <span className="dim2" style={{ fontSize: 11.5 }}>坐席快捷回复 · 例行维护</span>
          <span className="sp" style={{ flex: 1 }} />
          <button type="button" data-proof="session-tpl-new" className="btn btn-pri btn-sm" disabled={!canWriteM5 || !sessionTemplatesAvailable || writePending} onClick={newReplyTemplate}>
            <Icon name="plus" size={16} />
            新增模板
          </button>
        </div>
        <div style={{ padding: "0 8px 8px" }}>
          {replyTemplatePageLoading && <div className="itint" style={{ margin: "0 12px 8px" }}>正在加载模板分页...</div>}
          {!replyTemplatePageLoading && replyTemplatePageError && (
            <div className="itint" style={{ margin: "0 12px 8px" }}>模板分页加载失败 · {replyTemplatePageError}</div>
          )}
          {replyTemplateTotal === 0 && (
            <div className="itint" style={{ margin: "8px 12px 12px" }}>
              <div style={{ fontSize: 13 }}>暂无即时回复模板</div>
              <div className="tiny" style={{ color: "var(--ink-4)", marginTop: 4 }}>新增模板后会进入坐席快捷回复池。</div>
            </div>
          )}
          {visibleReplyTemplates.map((t) => {
            const currentStatus = tplStatus(t.id, t.status) as SessionReplyTpl["status"];
            const published = currentStatus === "published";
            const archived = currentStatus === "archived";
            return (
              <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 12px", borderTop: "1px solid var(--border)" }}>
                <span className="idtag" style={{ fontSize: 11.5, minWidth: 48 }}>{t.id}</span>
                <span className="chip" style={{ height: 20, border: "none" }}>{t.type === "advisor" ? "专属客服" : "普通客服"}</span>
                <span className="dim" style={{ fontSize: 12.5, flex: 1, minWidth: 0 }}>{t.text}</span>
                <span className="dim2" style={{ fontSize: 11 }}>{archived ? "已归档" : published ? "已发布" : "草稿"}</span>
                <span data-proof={`session-tpl-publish-${t.id}`}>
                  <Sw on={published} disabled={!canWriteM5 || !sessionTemplatesAvailable || writePending || archived} onClick={() => toggleTpl(t.id, currentStatus)} label={`${published ? "归档" : archived ? "已归档" : "发布"} ${t.id}`} />
                </span>
              </div>
            );
          })}
          <Pager page={replyTemplatePage} total={replyTemplateTotal} pageSize={REPLY_TEMPLATE_PAGE_SIZE} onPage={setReplyTemplatePage} />
        </div>
      </div>

      <p className="dim2" style={{ fontSize: 12, lineHeight: 1.6, margin: 0 }}>
        <b style={{ color: "var(--ink-3)", fontWeight: 500 }}>执行门槛</b>:类别启停 / 顾问推送策略 / 受众圈定 / 话术与模板发布走操作确认(理由必填);调参类(受众 / 延迟 / 冷却 / 上限)展示目标新值,处置类(启停 / 发布)只确认动作。<b style={{ color: "var(--ink-3)", fontWeight: 500 }}>边界</b>:Nova(ai)推送配置见 I2;平台级停客服能力走 J1。话术挂双语词条(I6),发布前服务器校验中英镜像。
      </p>

      {canManageSupportSeats && profileAgent && <AgentProfileModal agent={profileAgent} agents={supportAgents} ctx={ctx} onClose={() => setProfileAgent(null)} />}
      {canManageSupportSeats && assignAgent && <AdvisorAssignModal agent={assignAgent} ctx={ctx} onClose={() => setAssignAgent(null)} />}
    </div>
  );
}

function toggleList<T extends string>(rows: T[], item: T): T[] {
  return rows.includes(item) ? rows.filter((row) => row !== item) : [...rows, item];
}

function AgentProfileModal({ agent, agents, ctx, onClose }: { agent: MSupportAgent; agents: MSupportAgent[]; ctx: MCtx; onClose: () => void }) {
  const tagOptions = useMemo(
    () => Array.from(new Set(agents.flatMap((item) => item.tags ?? []).filter(Boolean))),
    [agents],
  );
  const position = agent.position || "通用客服";
  const dedicatedSeat = agent.seatType === "DEDICATED" || position.includes("专属");
  const [serviceTypes, setServiceTypes] = useState<MSupportServiceType[]>(
    dedicatedSeat ? (agent.serviceTypes.length ? agent.serviceTypes : ["advisor"]) : ["support"],
  );
  const [tags, setTags] = useState<string[]>(agent.tags ?? []);
  const [maxConcurrent, setMaxConcurrent] = useState(String(agent.maxConcurrent || 10));
  const [enabled, setEnabled] = useState(agent.enabled);
  const [transferable, setTransferable] = useState(agent.transferable);
  const [busy, setBusy] = useState(agent.busy);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const reasonOk = reason.trim().length >= 8 && reason.trim().length <= 200;
  const canSave = !saving && reasonOk && serviceTypes.length > 0 && Number(maxConcurrent) >= 0;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const succeeded = await ctx.setParam("I.support.agentProfile.__update", JSON.stringify({
        adminId: agent.adminId,
        serviceTypes,
        tags,
        maxConcurrent: Math.max(0, Math.min(40, Math.round(Number(maxConcurrent) || 0))),
        enabled,
        transferable,
        busy,
      }), {
        action: "M5 客服接派单配置",
        reason: reason.trim(),
      });
      if (succeeded) {
        ctx.toast(`${agent.name} 接派单配置已保存`);
        onClose();
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="配置客服岗位"
      icon="gauge"
      wide
      onClose={onClose}
      footer={<><span style={{ flex: 1 }} /><button type="button" className="btn btn-sec btn-sm" disabled={saving} onClick={onClose}>取消</button><button type="button" className="btn btn-pri btn-sm" disabled={!canSave} onClick={() => void save()}>{saving ? "保存中..." : `保存${!canSave ? " · 待补全" : ""}`}</button></>}
    >
      <div className="mcol" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 22 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>{agent.name}</div>
            <div className="dim2" style={{ fontSize: 11.5, marginTop: 3 }}>{agent.email || agent.adminRole} · <span className="mono">A1#{agent.adminId}</span></div>
          </div>
          <label className="field" style={{ marginBottom: 0 }}>
            <span>坐席类型</span>
            <input className="fld" value={position} readOnly disabled />
            <span className="tiny" style={{ color: "var(--ink-4)", marginTop: 4 }}>客服主管 / 专属客服 / 通用客服由 M1「分配坐席」维护。</span>
          </label>
          <label className="field" style={{ marginBottom: 0 }}>
            <span>接派单上限</span>
            <input className="fld mono" type="number" min={0} max={40} value={maxConcurrent} onChange={(e) => setMaxConcurrent(e.target.value)} />
          </label>
          <label className="field" style={{ marginBottom: 0 }}>
            <span>变更理由 <b style={{ color: "var(--danger)" }}>*</b></span>
            <textarea className="fld" rows={3} maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="例:客服主管调整岗位分工,该坐席本周负责高价值用户。" style={{ resize: "vertical" }} />
            <span className="tiny" style={{ color: "var(--ink-4)", marginTop: 4 }}>理由需填写 8-200 字。</span>
          </label>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <div className="sub" style={{ fontWeight: 600, marginBottom: 8 }}>服务类型</div>
            <div className="row wrap" style={{ gap: 8 }}>
              {(["support", "advisor"] as MSupportServiceType[]).map((type) => {
                const disabled = type === "advisor" && !dedicatedSeat;
                return (
                  <button
                    key={type}
                    type="button"
                    className={`chip${serviceTypes.includes(type) ? " sel" : ""}`}
                    disabled={disabled}
                    onClick={() => {
                      if (!disabled) setServiceTypes((rows) => toggleList(rows, type));
                    }}
                    style={disabled ? { opacity: 0.55, cursor: "not-allowed" } : undefined}
                  >
                    {type === "advisor" ? "专属客服服务" : "普通客服"}
                  </button>
                );
              })}
            </div>
            {!dedicatedSeat && <div className="tiny" style={{ color: "var(--ink-4)", marginTop: 6 }}>只有 M1 分配为专属客服后才能开启专属客服服务。</div>}
          </div>
          <div>
            <div className="sub" style={{ fontWeight: 600, marginBottom: 8 }}>岗位标签</div>
            <div className="row wrap" style={{ gap: 8 }}>
              {tagOptions.length === 0 && <span className="sub">后端暂无可选标签</span>}
              {tagOptions.map((tag) => (
                <button key={tag} type="button" className={`chip${tags.includes(tag) ? " sel" : ""}`} onClick={() => setTags((rows) => toggleList(rows, tag))}>
                  {tag}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <label className="row" style={{ justifyContent: "space-between", gap: 12, alignItems: "center" }}>
              <span><span style={{ fontSize: 13 }}>启用客服</span><span className="sub" style={{ display: "block" }}>关闭后不参与新派单</span></span>
              <Toggle on={enabled} onClick={() => setEnabled((v) => !v)} />
            </label>
            <label className="row" style={{ justifyContent: "space-between", gap: 12, alignItems: "center" }}>
              <span><span style={{ fontSize: 13 }}>允许被转交</span><span className="sub" style={{ display: "block" }}>关闭后不出现在 M3 转交坐席</span></span>
              <Toggle on={transferable} onClick={() => setTransferable((v) => !v)} />
            </label>
            <label className="row" style={{ justifyContent: "space-between", gap: 12, alignItems: "center" }}>
              <span><span style={{ fontSize: 13 }}>暂停接派单</span><span className="sub" style={{ display: "block" }}>保留在职,临时不接新单</span></span>
              <Toggle on={busy} onClick={() => setBusy((v) => !v)} />
            </label>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function numericUserId(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const raw = value == null ? "" : String(value).trim();
  if (!raw) return 0;
  const direct = Number(raw);
  if (Number.isFinite(direct)) return direct;
  const matched = raw.match(/\d+/)?.[0];
  const parsed = matched ? Number(matched) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

function userIdOf(profile: User360Profile): number {
  return numericUserId(profile.id) || numericUserId(profile.userNo);
}

function userNoOf(profile: User360Profile): string {
  return profile.userNo || (profile.id ? `U${String(profile.id).padStart(8, "0")}` : "未编号用户");
}

function AdvisorAssignModal({ agent, ctx, onClose }: { agent: MSupportAgent; ctx: MCtx; onClose: () => void }) {
  const [keyword, setKeyword] = useState("");
  const [users, setUsers] = useState<User360Profile[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<User360Profile[]>([]);
  const [loading, setLoading] = useState(false);
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
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError("");
      fetchMSupportWorkbenchUsers({ keyword: keyword.trim(), pageNum: 1, pageSize: 8 })
        .then((page) => {
          if (!alive) return;
          setUsers(page.records);
        })
        .catch((err) => {
          if (!alive) return;
          setUsers([]);
          setError(err instanceof Error ? err.message : "USERS_LOAD_FAILED");
        })
        .finally(() => {
          if (alive) setLoading(false);
        });
    }, 250);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [keyword]);

  const toggleUser = (user: User360Profile) => {
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
        action: "M5 专属客服绑定",
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
      footer={<><span className="sub">用户来自客服工作台查询 · 已选 {bindableSelectedUsers.length} 人</span><span style={{ flex: 1 }} /><button type="button" className="btn btn-sec btn-sm" disabled={saving} onClick={onClose}>取消</button><button type="button" data-proof="advisor-assignment-save" className="btn btn-pri btn-sm" disabled={!canSave} onClick={() => void save()}>{saving ? "绑定中..." : `绑定${canSave ? ` ${bindableSelectedUsers.length} 人` : " · 待补全"}`}</button></>}
    >
      <div className="mcol" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 22 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>{agent.name}</div>
            <div className="dim2" style={{ fontSize: 11.5, marginTop: 3 }}>{agent.position} · <span className="mono">A1#{agent.adminId}</span></div>
          </div>
          <label className="field" style={{ marginBottom: 0 }}>
            <span>搜索用户</span>
            <div className="inp">
              <Icon name="search" size={15} />
              <input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="用户名 / 用户编码 / 手机号" />
            </div>
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
          {loading && <div className="itint">正在查询用户...</div>}
          {!loading && error && <div className="itint">用户加载失败 · {error}</div>}
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
                  <span className="mono dim2" style={{ fontSize: 11.5 }}>{userNoOf(user)} · {user.phoneMasked || "未留手机号"} · KYC {user.kycStatus || "PENDING"}</span>
                </span>
                {alreadyBound && <span className="chip" style={{ height: 20, fontSize: 11, border: "none" }}>{boundToCurrent ? "已绑定" : "已绑定其他坐席"}</span>}
                {checked && <Icon name="check" size={15} />}
              </button>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}

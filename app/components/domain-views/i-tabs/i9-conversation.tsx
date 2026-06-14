"use client";

/**
 * I9 会话中心运营 — 前端即时多类别客服会话中心(Nexion-uniapp /support/messages + /support/chat,
 * ConversationType advisor/support/ai)的后台对端。两块:
 *  (A) 配置:类别启停 + 顾问主动话术 + AutoPushPolicy(nexion-design 4 参)+ 即时回复模板;
 *  (B) 坐席对话台:会话 list + thread + reply(真写 append),字段镜像 UniApp mock/conversations.ts。
 * 真写单源 platform-config setParam(I.session.*)。配置变更走操作确认(显式 edit 契约:调参传 edit、
 * 处置不传);坐席回复/分配 inline 审计理由直写(同 I8)。ai(Nova)类别推送/模板归 I2,本页只接 advisor/support。
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { DataListPager, PaginationExemptionList, useDataListPager } from "../design-kit";
import {
  ADVISOR_POLICY,
  ADVISOR_SCRIPTS,
  SESSION_AGENTS,
  SESSION_CATEGORIES,
  SESSION_CONVOS,
  SESSION_REPLY_TEMPLATES,
  type SessionConvo,
  type SessionStatus,
  type SessionType,
} from "./data";
import type { ICtx } from "./types";

const CAT_KEY = (t: SessionType) => `I.session.cat.${t}.enabled`;
const POLICY_KEY = (f: string) => `I.session.advisor.policy.${f}`;
const SCRIPT_KEY = (id: string) => `I.session.script.${id}.status`;
const TPL_KEY = (id: string) => `I.session.tpl.${id}.status`;
const CONVO_KEY = "I.session.convos";

const STATUS_FILTERS: Array<["all" | SessionStatus, string]> = [
  ["all", "全部"],
  ["open", "进行中"],
  ["resolved", "已解决"],
  ["closed", "已关闭"],
];
const TYPE_FILTERS: Array<["all" | "advisor" | "support", string]> = [
  ["all", "全部"],
  ["advisor", "专属顾问"],
  ["support", "普通客服"],
];

function parseParamArray<T>(raw: string | undefined, fallback: T[]): T[] {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : fallback;
  } catch {
    return fallback;
  }
}

function cloneConvos(rows: SessionConvo[]): SessionConvo[] {
  return rows.map((convo) => ({ ...convo, messages: convo.messages.map((message) => ({ ...message })) }));
}

function relWhen(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.max(1, Math.floor(diff / 60_000))}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function minReason(reason: string): boolean {
  return reason.trim().length >= 8;
}

function statusTone(status: SessionStatus): string {
  if (status === "open") return "warn";
  if (status === "resolved") return "ok";
  return "dim";
}
function statusLabel(status: SessionStatus): string {
  return status === "open" ? "进行中" : status === "resolved" ? "已解决" : "已关闭";
}

function Field({ label, required, children }: { label: string; required?: boolean; children: ReactNode }) {
  return (
    <label className="field" style={{ marginBottom: 0 }}>
      <span>
        {label}
        {required && <b style={{ color: "var(--danger)", marginLeft: 4 }}>*</b>}
      </span>
      {children}
    </label>
  );
}
function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className="fld" {...props} />;
}
function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className="fld" {...props} />;
}
function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className="fld" {...props} />;
}

export function I9Conversation({ ctx }: { ctx: ICtx }) {
  const { pget, setParam, toast, openActionConfirm } = ctx;

  // ── 配置实时态(pget 覆盖默认)──
  const catEnabled = (cat: { type: SessionType; enabled: boolean }): boolean =>
    (pget(CAT_KEY(cat.type)) ?? (cat.enabled ? "on" : "off")) === "on";
  const policyVal = (field: string, def: string | number): string => pget(POLICY_KEY(field)) ?? String(def);
  const scriptStatus = (id: string, def: string): string => pget(SCRIPT_KEY(id)) ?? def;
  const tplStatus = (id: string, def: string): string => pget(TPL_KEY(id)) ?? def;

  const renderStatusBadge = (st: string) => {
    if (st === "published") return <span className="bdg ok">published</span>;
    if (st === "archived") return <span className="bdg dim">archived</span>;
    if (st === "draft") return <span className="bdg warn">draft</span>;
    return <span className="bdg dim">{st}</span>;
  };

  // ── 坐席会话单源 ──
  const convos = useMemo(
    () => cloneConvos(parseParamArray<SessionConvo>(pget(CONVO_KEY), SESSION_CONVOS)),
    [ctx.params, pget],
  );

  const [typeFilter, setTypeFilter] = useState<"all" | "advisor" | "support">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | SessionStatus>("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("cv-advisor-1");
  const [ownerDraft, setOwnerDraft] = useState("Mia");
  const [statusDraft, setStatusDraft] = useState<SessionStatus>("open");
  const [assignReason, setAssignReason] = useState("");
  const [replyBody, setReplyBody] = useState("");
  const [replyReason, setReplyReason] = useState("");

  const selected = convos.find((convo) => convo.id === selectedId) ?? convos[0] ?? null;

  useEffect(() => {
    if (!selected) return;
    setOwnerDraft(selected.owner);
    setStatusDraft(selected.status);
    setAssignReason("");
    setReplyBody("");
    setReplyReason("");
  }, [selected?.id, selected?.owner, selected?.status]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return convos
      .filter((convo) => typeFilter === "all" || convo.type === typeFilter)
      .filter((convo) => statusFilter === "all" || convo.status === statusFilter)
      .filter((convo) => {
        if (!q) return true;
        return [convo.id, convo.agentName, convo.owner].some((text) => text.toLowerCase().includes(q));
      })
      .sort((a, b) => b.lastTs - a.lastTs);
  }, [convos, query, statusFilter, typeFilter]);

  const pager = useDataListPager(filtered, {
    initialPageSize: 5,
    resetKey: `${typeFilter}:${statusFilter}:${query}:${convos.length}`,
  });

  const liveCount = convos.filter((convo) => convo.status === "open").length;
  const pendingReplies = convos.filter(
    (convo) => convo.status === "open" && convo.messages[convo.messages.length - 1]?.sender === "user",
  ).length;

  const writeConvos = (next: SessionConvo[], reason: string, action: string) => {
    setParam(CONVO_KEY, JSON.stringify(next), { action, reason });
  };
  const updateConvo = (id: string, updater: (convo: SessionConvo) => SessionConvo, reason: string, action: string) => {
    writeConvos(convos.map((convo) => (convo.id === id ? updater(convo) : convo)), reason, action);
  };

  const saveMeta = () => {
    if (!selected) return;
    if (!minReason(assignReason)) {
      toast("分配 / 改状态需要 8 字以上审计理由");
      return;
    }
    updateConvo(
      selected.id,
      (convo) => ({ ...convo, owner: ownerDraft, status: statusDraft, lastTs: Date.now() }),
      assignReason.trim(),
      `会话分配与状态更新 ${selected.id} · admin.conversation_meta_updated`,
    );
    toast(`${selected.id} 已更新 owner/status`);
  };

  const sendReply = () => {
    if (!selected) return;
    if (!replyBody.trim() || !minReason(replyReason)) {
      toast("回复需要正文和 8 字以上审计理由");
      return;
    }
    const now = Date.now();
    updateConvo(
      selected.id,
      (convo) => ({
        ...convo,
        owner: ownerDraft === "Unassigned" ? convo.owner : ownerDraft,
        unread: 0,
        lastTs: now,
        messages: [
          ...convo.messages,
          { ts: now, sender: "agent", agentName: ownerDraft === "Unassigned" ? "Support desk" : ownerDraft, text: replyBody.trim() },
        ],
      }),
      replyReason.trim(),
      `坐席回复会话 ${selected.id} · admin.conversation_replied`,
    );
    setReplyBody("");
    setReplyReason("");
    toast(`${selected.id} 已回复`);
  };

  // ── 配置:操作确认(MC 显式 edit 契约)──
  const toggleCat = (cat: { type: SessionType; name: string; enabled: boolean }) => {
    const on = catEnabled(cat);
    openActionConfirm({
      action: <>{on ? "禁用" : "启用"}会话类别 · {cat.name}</>,
      detail: on
        ? <>该类别从会话中心入口移除;<b>进行中会话保持 open,不强制关闭</b>。仅入口动作,不是 J1 熔断。</>
        : <>恢复后新用户可在会话中心选择该类别。</>,
      amplifies: false,
      run: (reason: string) => {
        setParam(CAT_KEY(cat.type), on ? "off" : "on", {
          action: `${on ? "禁用" : "启用"}会话类别 ${cat.name} · admin.conversation_category_toggled`,
          reason,
        });
        toast(`${cat.name} 类别${on ? "已禁用" : "已启用"}`);
      },
    });
  };

  const toggleAdvisorPush = () => {
    const on = policyVal("enabled", ADVISOR_POLICY.enabled) === "on";
    openActionConfirm({
      action: <>{on ? "停用" : "启用"}顾问主动推送</>,
      detail: on
        ? <>停用后顾问不再主动触达,只在用户发起时回复。引导转化触点暂停。</>
        : <>启用后顾问按下方 AutoPushPolicy 主动触达用户(引导购机 / 锁仓 / 复投)。</>,
      amplifies: false,
      run: (reason: string) => {
        setParam(POLICY_KEY("enabled"), on ? "off" : "on", {
          action: `${on ? "停用" : "启用"}顾问主动推送 · admin.conversation_autopush_toggled`,
          reason,
        });
        toast(`顾问主动推送${on ? "已停用" : "已启用"}`);
      },
    });
  };

  const editPolicy = (field: string, label: string, current: string, unit: string) =>
    openActionConfirm({
      action: <>调整顾问推送 · {label}</>,
      detail: <>影响全体进入会话中心用户的顾问主动触达频率/时机。对新会话即时生效。</>,
      amplifies: false,
      edit: { kind: "text", current, unit },
      run: (reason: string, v?: string) => {
        if (!v) return;
        setParam(POLICY_KEY(field), v, { action: `调整顾问推送 ${label} · admin.conversation_autopush_changed`, reason });
        toast(`${label} 已更新 · ${v}${unit}`);
      },
    });

  const publishScript = (id: string, label: string) =>
    openActionConfirm({
      action: <>发布顾问话术 · {label}</>,
      detail: <>发布即对坐席快捷话术菜单生效;话术挂双语词条(I6),服务器校验中英镜像。</>,
      amplifies: false,
      run: (reason: string) => {
        setParam(SCRIPT_KEY(id), "published", { action: `发布顾问话术 ${label} · admin.conversation_script_published`, reason });
        toast(`${label} 发布已生效`);
      },
    });
  const archiveScript = (id: string, label: string) =>
    openActionConfirm({
      action: <>下架顾问话术 · {label}</>,
      detail: <>下架后从坐席可选话术池移除。</>,
      amplifies: false,
      run: (reason: string) => {
        setParam(SCRIPT_KEY(id), "archived", { action: `下架顾问话术 ${label}`, reason });
        toast(`${label} 已下架`);
      },
    });
  const newScript = () =>
    openActionConfirm({
      action: <>新增顾问话术</>,
      detail: <>新建草稿后挂双语词条(I6);发布走操作确认。</>,
      amplifies: false,
      edit: { kind: "text", current: "—", unit: "话术 key" },
      run: (reason: string, v?: string) => {
        if (!v) return;
        setParam(SCRIPT_KEY(v), "draft", { action: `新增顾问话术 ${v}`, reason });
        toast(`话术 ${v} 已创建 · 待发布确认`);
      },
    });

  const publishTpl = (id: string, label: string) =>
    openActionConfirm({
      action: <>发布回复模板 · {label}</>,
      detail: <>发布后进入坐席快捷回复池。</>,
      amplifies: false,
      run: (reason: string) => {
        setParam(TPL_KEY(id), "published", { action: `发布回复模板 ${label} · admin.conversation_template_published`, reason });
        toast(`${label} 发布已生效`);
      },
    });
  const archiveTpl = (id: string, label: string) =>
    openActionConfirm({
      action: <>归档回复模板 · {label}</>,
      detail: <>归档后从快捷回复池移除。</>,
      amplifies: false,
      run: (reason: string) => {
        setParam(TPL_KEY(id), "archived", { action: `归档回复模板 ${label}`, reason });
        toast(`${label} 已归档`);
      },
    });

  return (
    <>
      <div className="f-stats">
        <div className="f-stat warn">
          <div className="k">进行中会话</div>
          <div className="v">{liveCount}</div>
          <div className="sub">open · 顾问 + 普通客服</div>
        </div>
        <div className="f-stat cyan">
          <div className="k">待坐席回复</div>
          <div className="v">{pendingReplies}</div>
          <div className="sub">用户末发言 · 等人工回复</div>
        </div>
        <div className="f-stat ok">
          <div className="k">启用类别</div>
          <div className="v">{SESSION_CATEGORIES.filter((cat) => catEnabled(cat)).length} / {SESSION_CATEGORIES.length}</div>
          <div className="sub">顾问 / 客服 / Nova</div>
        </div>
        <div className="f-stat">
          <div className="k">顾问话术</div>
          <div className="v">{ADVISOR_SCRIPTS.length} 条</div>
          <div className="sub">主动引导转化话术库</div>
        </div>
      </div>

      {/* 类别配置 */}
      <section className="l-card" data-session-panel="categories">
        <div className="l-h">
          <span className="ttl">会话类别</span>
          <span className="sub">· 对齐 UniApp 会话中心 advisor / support / ai 三类</span>
          <div className="r"><span className="icode electric">I.session.cat.*</span></div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 760 }}>
            <thead>
              <tr>
                <th>开关</th>
                <th>类别</th>
                <th>角色副标题 key</th>
                <th>接待方</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              {SESSION_CATEGORIES.map((cat) => {
                const on = catEnabled(cat);
                return (
                  <tr key={cat.type}>
                    <td>
                      {cat.type === "ai" ? (
                        <span className="bdg dim" title="Nova 推送/模板配置见 I2">I2 管</span>
                      ) : (
                        <button
                          className={`nv-sw${on ? " on" : ""}`}
                          data-proof={`session-cat-toggle-${cat.type}`}
                          onClick={() => toggleCat(cat)}
                          aria-label={`${on ? "禁用" : "启用"} ${cat.name}`}
                        />
                      )}
                    </td>
                    <td>
                      <span className="mono" style={{ fontWeight: 600, color: "var(--ink)" }}>{cat.type}</span>
                      <div style={{ fontSize: 11.5, color: "var(--ink-4)", marginTop: 2 }}>{cat.name}</div>
                    </td>
                    <td className="mono" style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{cat.roleKey}</td>
                    <td style={{ fontSize: 12, color: "var(--ink-3)" }}>{cat.managedBy}</td>
                    <td><span className={`bdg ${on ? "ok" : "dim"}`}>{on ? "启用" : "停用"}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="l-b" style={{ paddingTop: 8 }}>
          <div className="itint">
            <b>禁用 ≠ 熔断</b> · 禁用类别只把入口从会话中心移除,进行中会话保持 open;要平台级停掉客服能力走 J1。<b>Nova(ai)</b> 类别的推送节奏与模板在 I2 配置,本页不重复持有。
          </div>
        </div>
      </section>

      {/* 顾问主动话术 + AutoPushPolicy */}
      <section className="l-card" data-session-panel="advisor">
        <div className="l-h">
          <span className="ttl">顾问主动话术 + 推送策略</span>
          <span className="sub">· 顾问「主动引导转化」从前端写死改为后台可调</span>
          <div className="r"><span className="icode electric">I.session.advisor.*</span></div>
        </div>
        <div className="l-b">
          <div className="p-row">
            <div className="txt">
              <div className="k">主动推送总开关</div>
              <div className="s">关掉后顾问只在用户发起时回复</div>
            </div>
            <span className="v">{policyVal("enabled", ADVISOR_POLICY.enabled) === "on" ? "ON" : "OFF"}</span>
            <button className="l-btn sm mc" data-proof="session-policy-enabled" onClick={toggleAdvisorPush}>切换</button>
          </div>
          <div className="p-row">
            <div className="txt"><div className="k">首推延迟 delayMs</div><div className="s">进入会话后延迟触发,避免抢首屏</div></div>
            <span className="v">{policyVal("delayMs", ADVISOR_POLICY.delayMs)} ms</span>
            <button className="l-btn sm mc" data-proof="session-policy-delay" onClick={() => editPolicy("delayMs", "首推延迟", policyVal("delayMs", ADVISOR_POLICY.delayMs), " ms")}>调整</button>
          </div>
          <div className="p-row">
            <div className="txt"><div className="k">冷却 cooldownHours</div><div className="s">同用户相邻主动推送的最小间隔</div></div>
            <span className="v">{policyVal("cooldownHours", ADVISOR_POLICY.cooldownHours)} h</span>
            <button className="l-btn sm mc" data-proof="session-policy-cooldown" onClick={() => editPolicy("cooldownHours", "冷却", policyVal("cooldownHours", ADVISOR_POLICY.cooldownHours), " h")}>调整</button>
          </div>
          <div className="p-row">
            <div className="txt"><div className="k">单会话上限 maxPerSession</div><div className="s">单会话最多主动推送条数,防骚扰</div></div>
            <span className="v">{policyVal("maxPerSession", ADVISOR_POLICY.maxPerSession)} 条</span>
            <button className="l-btn sm mc" data-proof="session-policy-max" onClick={() => editPolicy("maxPerSession", "单会话上限", policyVal("maxPerSession", ADVISOR_POLICY.maxPerSession), " 条")}>调整</button>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 760 }}>
            <thead>
              <tr>
                <th>话术</th>
                <th>分类</th>
                <th>文案</th>
                <th>CTA</th>
                <th>状态</th>
                <th style={{ textAlign: "right" }}></th>
              </tr>
            </thead>
            <tbody>
              {ADVISOR_SCRIPTS.map((script) => {
                const st = scriptStatus(script.id, script.status);
                return (
                  <tr key={script.id}>
                    <td className="mono" style={{ fontWeight: 600, color: "var(--ink)" }}>{script.id}</td>
                    <td><span className="bdg cyan">{script.group}</span></td>
                    <td style={{ fontSize: 12, color: "var(--ink-3)", maxWidth: 360 }}>{script.text}</td>
                    <td className="mono" style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{script.ctaHref}</td>
                    <td>{renderStatusBadge(st)}</td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <button className="l-btn sm mc" data-proof={`session-script-publish-${script.id}`} onClick={() => publishScript(script.id, script.id)}>发布</button>
                      <button className="l-btn sm" style={{ marginLeft: 6 }} onClick={() => archiveScript(script.id, script.id)}>下架</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="l-b" style={{ paddingTop: 8 }}>
          <div className="r" style={{ display: "flex", justifyContent: "flex-end" }}>
            <button className="l-btn sm mc" data-proof="session-script-new" onClick={newScript}>+ 新话术</button>
          </div>
          <div className="itint" style={{ marginTop: 8 }}>
            <b>顾问主动 = 转化触点</b> · CTA 跳商城(E)/ 金融产品(G)等下游域,成交归各业务域结算。话术挂双语词条(I6),发布前服务器校验中英镜像。
          </div>
        </div>
      </section>

      {/* 即时回复模板 */}
      <section className="l-card" data-session-panel="templates">
        <div className="l-h">
          <span className="ttl">即时回复模板</span>
          <span className="sub">· 坐席快捷回复(顾问 / 普通客服)</span>
          <div className="r"><span className="icode electric">I.session.tpl.*</span></div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 720 }}>
            <thead>
              <tr>
                <th>模板</th>
                <th>类别</th>
                <th>文案</th>
                <th>状态</th>
                <th style={{ textAlign: "right" }}></th>
              </tr>
            </thead>
            <tbody>
              {SESSION_REPLY_TEMPLATES.map((tpl) => {
                const st = tplStatus(tpl.id, tpl.status);
                return (
                  <tr key={tpl.id}>
                    <td className="mono" style={{ fontWeight: 600, color: "var(--ink)" }}>{tpl.id}</td>
                    <td><span className="bdg cyan">{tpl.type === "advisor" ? "专属顾问" : "普通客服"}</span></td>
                    <td style={{ fontSize: 12, color: "var(--ink-3)", maxWidth: 380 }}>{tpl.text}</td>
                    <td>{renderStatusBadge(st)}</td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <button className="l-btn sm mc" data-proof={`session-tpl-publish-${tpl.id}`} onClick={() => publishTpl(tpl.id, tpl.id)}>发布</button>
                      <button className="l-btn sm" style={{ marginLeft: 6 }} onClick={() => archiveTpl(tpl.id, tpl.id)}>归档</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* 坐席对话台 */}
      <div className="two-col">
        <section className="l-card" data-session-panel="convos">
          <div className="l-h">
            <span className="ttl">坐席对话台 · 会话列表</span>
            <span className="sub">· 字段镜像 UniApp conversations mock</span>
            <div className="r chips">
              <span className="lb">状态</span>
              {STATUS_FILTERS.map(([value, label]) => (
                <button key={value} className={`chip${statusFilter === value ? " sel" : ""}`} onClick={() => setStatusFilter(value)}>{label}</button>
              ))}
            </div>
          </div>
          <div className="l-b" style={{ paddingBottom: 10 }}>
            <div className="grid g-2" style={{ gap: 10 }}>
              <Field label="类别筛选">
                <Select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as "all" | "advisor" | "support")}>
                  {TYPE_FILTERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </Select>
              </Field>
              <Field label="搜索 会话 / 坐席">
                <Input data-proof="session-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="cv-advisor-1 / Mia / Sarah" />
              </Field>
            </div>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="l-tbl" style={{ minWidth: 820 }}>
              <thead>
                <tr>
                  <th>会话</th>
                  <th>类别</th>
                  <th>状态</th>
                  <th>Owner</th>
                  <th>未读</th>
                  <th>Last</th>
                  <th style={{ textAlign: "right" }}>动作</th>
                </tr>
              </thead>
              <tbody>
                {pager.pageRows.map((convo) => (
                  <tr key={convo.id} className="click" onClick={() => setSelectedId(convo.id)}>
                    <td>
                      <span className="mono" style={{ fontWeight: 700, color: "var(--ink)" }}>{convo.id}</span>
                      <div style={{ fontSize: 12, color: "var(--ink-2)", marginTop: 3 }}>{convo.agentName}</div>
                    </td>
                    <td><span className="bdg cyan">{convo.type === "advisor" ? "专属顾问" : "普通客服"}</span></td>
                    <td><span className={`bdg ${statusTone(convo.status)}`}>{statusLabel(convo.status)}</span></td>
                    <td className="mono" style={{ fontSize: 11.5 }}>{convo.owner}</td>
                    <td className="mono" style={{ fontSize: 11.5 }}>{convo.unread}</td>
                    <td className="mono" style={{ fontSize: 11.5 }}>{relWhen(convo.lastTs)}</td>
                    <td style={{ textAlign: "right" }}>
                      <button type="button" className="l-btn sm mc" onClick={(event) => { event.stopPropagation(); setSelectedId(convo.id); }}>查看接待</button>
                    </td>
                  </tr>
                ))}
                {pager.total === 0 && (
                  <tr>
                    <td colSpan={7} style={{ textAlign: "center", padding: "22px 12px", color: "var(--ink-4)" }}>当前筛选下没有会话</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <DataListPager
            label="坐席会话队列"
            page={pager.page}
            pageSize={pager.pageSize}
            total={pager.total}
            rawTotal={convos.length}
            onPageChange={pager.setPage}
            onPageSizeChange={pager.setPageSize}
            pageSizeOptions={[5, 10, 20, 50]}
          />
        </section>

        <section className="l-card" data-session-panel="convo-detail">
          <div className="l-h">
            <span className="ttl">会话详情与接待</span>
            <span className="sub">· 分配 / 回复 / 改状态都是真写</span>
            <div className="r">{selected && <span className="icode electric">{selected.id}</span>}</div>
          </div>
          {selected ? (
            <div className="l-b" style={{ display: "grid", gap: 14 }}>
              <div className="itint">
                <b>{selected.agentName}</b>
                <div style={{ marginTop: 6 }}>
                  <span className="bdg cyan">{selected.type === "advisor" ? "专属顾问" : "普通客服"}</span>{" "}
                  <span className={`bdg ${statusTone(selected.status)}`}>{statusLabel(selected.status)}</span>{" "}
                  <span className="bdg dim">unread {selected.unread}</span>
                </div>
                <div className="tiny" style={{ color: "var(--ink-4)", marginTop: 8 }}>
                  lastTs {relWhen(selected.lastTs)} · {selected.messages.length} 条消息
                </div>
              </div>

              <div style={{ display: "grid", gap: 8 }}>
                <div className="mono" style={{ fontSize: 11.5, color: "var(--ink-4)" }}>MESSAGE THREAD</div>
                {selected.messages.map((message, index) => {
                  const isAgent = message.sender === "agent";
                  return (
                    <div
                      key={`${message.ts}-${index}`}
                      style={{ padding: "11px 12px", borderRadius: 10, background: isAgent ? "var(--i-ac-soft)" : "var(--surface-2)", color: "var(--ink-2)" }}
                    >
                      <div className="mono" style={{ fontSize: 11, color: isAgent ? "var(--i-ac)" : "var(--ink-4)", marginBottom: 5 }}>
                        {isAgent ? message.agentName ?? "Agent" : "User"} · {relWhen(message.ts)}
                      </div>
                      <div style={{ fontSize: 12.5, lineHeight: 1.6 }}>{message.text}</div>
                      {message.ctaHref && message.ctaHref !== "—" && (
                        <div className="mono" style={{ fontSize: 11, color: "var(--i-ac)", marginTop: 5 }}>CTA → {message.ctaHref}</div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="grid g-2" style={{ gap: 10 }}>
                <Field label="Owner 坐席" required>
                  <Select data-proof="session-owner" value={ownerDraft} onChange={(event) => setOwnerDraft(event.target.value)}>
                    {SESSION_AGENTS.map((agent) => <option key={agent} value={agent}>{agent}</option>)}
                  </Select>
                </Field>
                <Field label="状态" required>
                  <Select data-proof="session-status" value={statusDraft} onChange={(event) => setStatusDraft(event.target.value as SessionStatus)}>
                    <option value="open">进行中</option>
                    <option value="resolved">已解决</option>
                    <option value="closed">已关闭</option>
                  </Select>
                </Field>
                <Field label="分配 / 改状态审计理由" required>
                  <Input data-proof="session-meta-reason" value={assignReason} onChange={(event) => setAssignReason(event.target.value)} placeholder="例: 转 Mia 跟进升级咨询" />
                </Field>
              </div>
              <button type="button" data-proof="session-meta-save" className="l-btn primary" onClick={saveMeta}>保存 owner / status</button>

              <div className="itint cyan">
                <b>快捷回复模板</b>
                <div className="row wrap" style={{ gap: 6, marginTop: 8 }}>
                  {SESSION_REPLY_TEMPLATES.filter((tpl) => tpl.type === selected.type && tplStatus(tpl.id, tpl.status) === "published").map((tpl) => (
                    <button key={tpl.id} type="button" className="chip" onClick={() => setReplyBody(tpl.text)}>{tpl.text.slice(0, 16)}...</button>
                  ))}
                </div>
              </div>
              <Field label="坐席回复正文" required>
                <TextArea data-proof="session-reply" rows={4} value={replyBody} onChange={(event) => setReplyBody(event.target.value)} placeholder="回复给用户;保存后追加 agent message 并清未读" />
              </Field>
              <Field label="回复审计理由" required>
                <Input data-proof="session-reply-reason" value={replyReason} onChange={(event) => setReplyReason(event.target.value)} placeholder="例: 已核对 D2 提现队列并同步 ETA" />
              </Field>
              <button type="button" data-proof="session-reply-save" className="l-btn primary" onClick={sendReply}>发送回复</button>
            </div>
          ) : (
            <div className="l-b"><div className="itint">请选择左侧会话。</div></div>
          )}
        </section>
      </div>

      <p className="f-foot">
        <b>执行门槛</b>:类别启停 / 顾问推送策略 / 话术与模板发布走操作确认(理由必填);坐席分配 / 回复 / 改状态写 A2 审计与 platform-config 持久层。<b>前端对应</b>:UniApp `/support/messages`、`/support/chat` 使用同构 conversations 字段。<b>边界</b>:涉及提现 / KYC 的咨询转 D2 / K5 工单处理;Nova(ai)推送配置见 I2;平台级停客服能力走 J1。
      </p>
      <PaginationExemptionList
        items={[
          { label: "会话类别", kind: "reference-catalog", maxRows: 3, reason: "类别固定三类(顾问/客服/Nova),同屏核对启用态" },
          { label: "顾问主动话术 + 推送策略", kind: "sample-ledger", maxRows: 6, reason: "话术为种子样本,发布/下架走操作确认" },
          { label: "即时回复模板", kind: "sample-ledger", maxRows: 6, reason: "回复模板种子样本" },
        ]}
      />
    </>
  );
}

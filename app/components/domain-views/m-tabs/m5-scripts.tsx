"use client";

/**
 * M5 话术与模板配置 — 会话类别启停 + 顾问 AutoPushPolicy + 受众圈定 + 话术库 + 即时回复模板(helpdesk 设计稿,由 I9 迁出)。
 * 真写统一落 platform-config params(persist 兼容前缀,操作确认 显式 edit 契约):
 *  - I.session.cat.<type>.enabled(类别启停,处置,不传 edit)
 *  - I.session.advisor.policy.<field>(AutoPushPolicy + audience,调参,传 edit)
 *  - I.session.script.<id>.status / .audience(顾问话术发布·受众)
 *  - I.session.tpl.<id>.status(即时回复模板)
 * ai(Nova)类别推送/模板归 I2,本页只渲染只读「I2 管」。高敏配置:变更走确认 + 理由。
 */
import { Icon, type IconName } from "../design-kit";
import {
  ADVISOR_POLICY,
  ADVISOR_SCRIPTS,
  SESSION_CATEGORIES,
  SESSION_REPLY_TEMPLATES,
  type SessionType,
} from "./data";
import { catCN } from "./hd-ui";
import type { MCtx } from "./types";

const CAT_KEY = (t: SessionType) => `I.session.cat.${t}.enabled`;
const POLICY_KEY = (f: string) => `I.session.advisor.policy.${f}`;
const SCRIPT_KEY = (id: string) => `I.session.script.${id}.status`;
const SCRIPT_AUDIENCE_KEY = (id: string) => `I.session.script.${id}.audience`;
const TPL_KEY = (id: string) => `I.session.tpl.${id}.status`;

// 受众五档(复用 I3 受众文案口径)。
const AUDIENCE_OPTIONS = ["全量", "SFC 辖区 · 未重确认", "近 30 天提现偏高", "注册 ≤14 天", "P3 阶段活跃"];
const DEFAULT_AUDIENCE = AUDIENCE_OPTIONS[0];

const CAT_ICON: Record<SessionType, IconName> = { advisor: "users", support: "bell", ai: "power" };

function SensTag() {
  return (
    <span className="sens-tag">
      <Icon name="shield" size={12} />
      高敏 · 需理由
    </span>
  );
}
function Sw({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return <button type="button" className={`sw${on ? " on" : ""}`} role="switch" aria-checked={on} aria-label={label} onClick={onClick} />;
}

export function M5Scripts({ ctx }: { ctx: MCtx }) {
  const { pget, setParam, toast, openActionConfirm } = ctx;

  const catEnabled = (cat: { type: SessionType; enabled: boolean }): boolean => (pget(CAT_KEY(cat.type)) ?? (cat.enabled ? "on" : "off")) === "on";
  const policyVal = (field: string, def: string | number): string => pget(POLICY_KEY(field)) ?? String(def);
  const scriptStatus = (id: string, def: string): string => pget(SCRIPT_KEY(id)) ?? def;
  const scriptAudience = (id: string): string => pget(SCRIPT_AUDIENCE_KEY(id)) ?? DEFAULT_AUDIENCE;
  const tplStatus = (id: string, def: string): string => pget(TPL_KEY(id)) ?? def;

  const currentAudience = policyVal("audience", DEFAULT_AUDIENCE);
  const masterOn = policyVal("enabled", ADVISOR_POLICY.enabled) === "on";

  // ── 类别启停:处置(不传 edit)──
  const toggleCat = (cat: { type: SessionType; name: string; enabled: boolean }) => {
    const on = catEnabled(cat);
    openActionConfirm({
      action: <>{on ? "禁用" : "启用"}会话类别 · {cat.name}</>,
      detail: on ? <>该类别从会话中心入口移除;<b>进行中会话保持 open,不强制关闭</b>。仅入口动作,不是 J1 熔断。</> : <>恢复后新用户可在会话中心选择该类别。</>,
      amplifies: false,
      run: (reason: string) => {
        setParam(CAT_KEY(cat.type), on ? "off" : "on", { action: `${on ? "禁用" : "启用"}会话类别 ${cat.name} · admin.conversation_category_toggled`, reason });
        toast(`${cat.name} 类别${on ? "已禁用" : "已启用"}`);
      },
    });
  };

  const toggleAdvisorPush = () => {
    openActionConfirm({
      action: <>{masterOn ? "停用" : "启用"}顾问主动推送</>,
      detail: masterOn ? <>停用后顾问不再主动触达,只在用户发起时回复。引导转化触点暂停。</> : <>启用后顾问按下方 AutoPushPolicy 主动触达用户(引导购机 / 锁仓 / 复投)。</>,
      amplifies: false,
      run: (reason: string) => {
        setParam(POLICY_KEY("enabled"), masterOn ? "off" : "on", { action: `${masterOn ? "停用" : "启用"}顾问主动推送 · admin.conversation_autopush_toggled`, reason });
        toast(`顾问主动推送${masterOn ? "已停用" : "已启用"}`);
      },
    });
  };

  // ── AutoPushPolicy 调参:传 edit ──
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

  // ── 受众圈定:调参(select edit)──
  const editAudience = () =>
    openActionConfirm({
      action: <>圈定顾问推送受众</>,
      detail: <>限定顾问主动触达的人群范围;对新会话即时生效,已在会话中的用户不受影响。</>,
      amplifies: false,
      edit: { kind: "select", current: currentAudience, options: AUDIENCE_OPTIONS },
      run: (reason: string, v?: string) => {
        if (!v) return;
        setParam(POLICY_KEY("audience"), v, { action: `圈定顾问推送受众 · admin.conversation_autopush_changed`, reason });
        toast(`推送受众已更新 · ${v}`);
      },
    });

  // ── 话术发布 / 下架 / 新增:处置(新增传 edit 录 key)──
  const publishScript = (id: string, on: boolean) =>
    openActionConfirm({
      action: <>{on ? "下架" : "发布"}顾问话术 · {id}</>,
      detail: on ? <>下架后从坐席可选话术池移除。</> : <>发布即对坐席快捷话术菜单生效;话术挂双语词条(I6),服务器校验中英镜像。</>,
      amplifies: false,
      run: (reason: string) => {
        setParam(SCRIPT_KEY(id), on ? "archived" : "published", { action: `${on ? "下架" : "发布"}顾问话术 ${id} · admin.conversation_script_published`, reason });
        toast(`${id} ${on ? "已下架" : "发布已生效"}`);
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
        setParam(SCRIPT_KEY(v), "draft", { action: `新增顾问话术 ${v} · admin.conversation_script_published`, reason });
        toast(`话术 ${v} 已创建 · 待发布确认`);
      },
    });

  // ── 模板发布 / 归档:处置(不传 edit)──
  const toggleTpl = (id: string, on: boolean) =>
    openActionConfirm({
      action: <>{on ? "归档" : "发布"}回复模板 · {id}</>,
      detail: on ? <>归档后从快捷回复池移除。</> : <>发布后进入坐席快捷回复池。</>,
      amplifies: false,
      run: (reason: string) => {
        setParam(TPL_KEY(id), on ? "archived" : "published", { action: `${on ? "归档" : "发布"}回复模板 ${id} · admin.conversation_template_published`, reason });
        toast(`${id} ${on ? "已归档" : "发布已生效"}`);
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

      <div style={{ display: "grid", gridTemplateColumns: "1.15fr 1fr", gap: 16 }}>
        <div className="card card-pad">
          <div className="sec-h">
            <span className="t">会话类别</span>
            <span className="sp" />
            <SensTag />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {SESSION_CATEGORIES.map((c) => {
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
                      <Sw on={on} onClick={() => toggleCat(c)} label={`${on ? "禁用" : "启用"} ${c.name}`} />
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
            <button type="button" data-proof="session-policy-enabled" className="btn btn-sec btn-sm" onClick={toggleAdvisorPush}>
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
            <button type="button" data-proof="session-policy-delay" style={tileStyle} onClick={() => editPolicy("delayMs", "首推延迟", policyVal("delayMs", ADVISOR_POLICY.delayMs), " ms")}>
              {tileHead("首推延迟")}
              {tileVal(`${policyVal("delayMs", ADVISOR_POLICY.delayMs)} ms`)}
            </button>
            <button type="button" data-proof="session-policy-cooldown" style={tileStyle} onClick={() => editPolicy("cooldownHours", "冷却", policyVal("cooldownHours", ADVISOR_POLICY.cooldownHours), " h")}>
              {tileHead("冷却时间")}
              {tileVal(`${policyVal("cooldownHours", ADVISOR_POLICY.cooldownHours)} h`)}
            </button>
            <button type="button" data-proof="session-policy-max" style={tileStyle} onClick={() => editPolicy("maxPerSession", "单会话上限", policyVal("maxPerSession", ADVISOR_POLICY.maxPerSession), " 条")}>
              {tileHead("单会话上限")}
              {tileVal(`${policyVal("maxPerSession", ADVISOR_POLICY.maxPerSession)} 条`)}
            </button>
            <button type="button" data-proof="session-policy-audience" style={tileStyle} onClick={editAudience}>
              {tileHead("受众圈定")}
              {tileVal(currentAudience)}
            </button>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-pad" style={{ paddingBottom: 10, display: "flex", alignItems: "center", gap: 10 }}>
          <div className="sec-h" style={{ margin: 0 }}>
            <span className="t">顾问主动话术</span>
            <span className="n">{ADVISOR_SCRIPTS.length} 条</span>
          </div>
          <SensTag />
          <span className="sp" style={{ flex: 1 }} />
          <button type="button" data-proof="session-script-new" className="btn btn-pri btn-sm" onClick={newScript}>
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
          {ADVISOR_SCRIPTS.map((a) => {
            const published = scriptStatus(a.id, a.status) === "published";
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
                  <span className="dim2" style={{ fontSize: 11 }}>{published ? "已发布" : "草稿"}</span>
                  <span data-proof={`session-script-publish-${a.id}`}>
                    <Sw on={published} onClick={() => publishScript(a.id, published)} label={`${published ? "下架" : "发布"} ${a.id}`} />
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="card">
        <div className="card-pad" style={{ paddingBottom: 10, display: "flex", alignItems: "center", gap: 10 }}>
          <div className="sec-h" style={{ margin: 0 }}>
            <span className="t">即时回复模板库</span>
            <span className="n">{SESSION_REPLY_TEMPLATES.length} 条</span>
          </div>
          <span className="dim2" style={{ fontSize: 11.5 }}>坐席快捷回复 · 例行维护</span>
        </div>
        <div style={{ padding: "0 8px 8px" }}>
          {SESSION_REPLY_TEMPLATES.map((t) => {
            const published = tplStatus(t.id, t.status) === "published";
            return (
              <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 12px", borderTop: "1px solid var(--border)" }}>
                <span className="idtag" style={{ fontSize: 11.5, minWidth: 48 }}>{t.id}</span>
                <span className="chip" style={{ height: 20, border: "none" }}>{t.type === "advisor" ? "专属顾问" : "普通客服"}</span>
                <span className="dim" style={{ fontSize: 12.5, flex: 1, minWidth: 0 }}>{t.text}</span>
                <span className="dim2" style={{ fontSize: 11 }}>{published ? "已发布" : "草稿"}</span>
                <span data-proof={`session-tpl-publish-${t.id}`}>
                  <Sw on={published} onClick={() => toggleTpl(t.id, published)} label={`${published ? "归档" : "发布"} ${t.id}`} />
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <p className="dim2" style={{ fontSize: 12, lineHeight: 1.6, margin: 0 }}>
        <b style={{ color: "var(--ink-3)", fontWeight: 500 }}>执行门槛</b>:类别启停 / 顾问推送策略 / 受众圈定 / 话术与模板发布走操作确认(理由必填);调参类(受众 / 延迟 / 冷却 / 上限)展示目标新值,处置类(启停 / 发布)只确认动作。<b style={{ color: "var(--ink-3)", fontWeight: 500 }}>边界</b>:Nova(ai)推送配置见 I2;平台级停客服能力走 J1。话术挂双语词条(I6),发布前服务器校验中英镜像。
      </p>
    </div>
  );
}

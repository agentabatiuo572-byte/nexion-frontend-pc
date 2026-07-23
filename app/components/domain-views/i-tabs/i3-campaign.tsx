"use client";

/**
 * I3 通知 Campaign — design_handoff_i_domain/I3 通知Campaign.html port。
 * 单源:后端 /content/campaigns/overview;空库时以后端初始化结果为准。
 * 操作确认 显式 edit 契约:CAP 调整(传 edit text)= 调参;调度下发 / 取消 = 纯处置(不传 edit)。
 * critical 档锁定 = 不渲染调整按钮(渲染 icode lock)。
 * amplifies = false(I3 通知体系不动钱,不碰 B1 红线)。
 * 新建 Campaign / 行点击详情 = 本地 Drawer 原语(design-kit 共享 Drawer);提交新建走后端 /content/campaigns。
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Drawer, PaginationExemptionList } from "../design-kit";
import type { ICtx } from "./types";
import type { NotificationAudienceTarget, NotificationCampaignRow } from "@/lib/admin/i-client";
import { usePropose } from "@/lib/admin/use-propose";
import { findHighOp } from "@/lib/admin/high-ops-registry";

type StFlt = "all" | "scheduled" | "sent" | "draft" | "failed" | "cancelled";
const ST_FLT: [StFlt, string][] = [
  ["all", "全部"],
  ["scheduled", "排期中"],
  ["sent", "已下发"],
  ["draft", "草稿"],
  ["failed", "下发失败"],
  ["cancelled", "已取消"],
];

type CampaignRow = Omit<NotificationCampaignRow, "status" | "kind"> & {
  kind: string;
  st: NotificationCampaignRow["status"];
  budget?: number;
};
type TierK = CampaignRow["tier"];
const TIER_OPTS: TierK[] = ["critical", "high", "normal", "low"];
const I3_TIER_STATE: Record<TierK, [label: string, tone: string]> = {
  critical: ["紧急", "danger"],
  high: ["高", "warn"],
  normal: ["普通", "cyan"],
  low: ["低", "dim"],
};
/** 名称 → slug(小写、空格转 -、保留中英数字,去其他符号)。 */
function slug(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}\-]+/gu, "")
    .slice(0, 48) || "untitled";
}

type NewForm = {
  name: string;
  titleZh: string;
  titleVi: string;
  titleEn: string;
  bodyZh: string;
  bodyVi: string;
  bodyEn: string;
  kind: string;
  ctaHref: string;
  tier: TierK;
  phaseMin: string;
  phaseMax: string;
  language: NotificationAudienceTarget["language"];
  registrationDaysMin: string;
  budget: string;
};

const FORM_INIT: NewForm = {
  name: "",
  titleZh: "",
  titleVi: "",
  titleEn: "",
  bodyZh: "",
  bodyVi: "",
  bodyEn: "",
  kind: "system",
  ctaHref: "",
  tier: "normal",
  phaseMin: "P1",
  phaseMax: "P6",
  language: "all",
  registrationDaysMin: "0",
  budget: "",
};

function splitNotificationBody(value: string): { title: string; body: string } {
  const [title = "", ...body] = value.split("\n");
  return { title, body: body.join("\n") };
}

function targetFromForm(form: NewForm): NotificationAudienceTarget {
  return {
    phaseMin: form.phaseMin,
    phaseMax: form.phaseMax,
    language: form.language,
    registrationDaysMin: Math.max(0, Number(form.registrationDaysMin || 0)),
  };
}

export function I3Campaign({ ctx }: { ctx: ICtx }) {
  const { toast, openActionConfirm, openConfirm, actions, content, contentLoading } = ctx;
  const propose = usePropose();
  const [stFlt, setStFlt] = useState<StFlt>("all");
  const [newOpen, setNewOpen] = useState(false);
  const [editing, setEditing] = useState<CampaignRow | null>(null);
  const [form, setForm] = useState<NewForm>(FORM_INIT);
  const [estimatedAudience, setEstimatedAudience] = useState<number | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [scheduleRow, setScheduleRow] = useState<CampaignRow | null>(null);
  const [scheduledAt, setScheduledAt] = useState("");
  const [scheduleReason, setScheduleReason] = useState("");
  const [scheduleVerified, setScheduleVerified] = useState(false);
  const [detail, setDetail] = useState<CampaignRow | null>(null);
  const [newRows, setNewRows] = useState<CampaignRow[]>([]);
  const data = content.campaigns;
  const I3_STATS = data?.stats ?? { monthCampaigns: 0, monthSent: 0, monthScheduled: 0, monthDraft: 0, criticalInflight: 0, avgReadRate: "—", weeklySwipe: "—" };
  const CAMPAIGNS: CampaignRow[] = (data?.campaigns ?? []).map((row) => ({
    ...row,
    st: row.status,
  }));
  const CAP_TIERS = data?.capRules ?? [];
  const AUDIENCE_CATALOG = data?.audienceCatalog;
  const DELIVERY_CATALOG = data?.deliveryCatalog;
  const SWIPE_ROWS = data?.swipeRoutes ?? [];
  const runBackend = (task: Promise<void>, ok: string) => {
    task
      .then(() => actions.reloadIContent())
      .then(() => toast(ok))
      .catch((error) => toast(`操作失败:${error instanceof Error ? error.message : String(error)}`));
  };

  useEffect(() => {
    if (!newOpen) return;
    const timer = window.setTimeout(() => {
      setEstimating(true);
      actions.estimateI3Audience(targetFromForm(form))
        .then((result) => setEstimatedAudience(result.estimatedUsers))
        .catch(() => setEstimatedAudience(null))
        .finally(() => setEstimating(false));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [newOpen, form.phaseMin, form.phaseMax, form.language, form.registrationDaysMin, actions]);

  const liveSt = (c: CampaignRow): CampaignRow["st"] => {
    return c.st;
  };
  const liveCap = (tier: string, cap: string): string => (tier === "critical" ? "∞ 永不淘汰" : cap);
  const liveCampaign = (c: CampaignRow): CampaignRow => c;
  const liveBudget = (id: string): string | undefined => {
    const row = CAMPAIGNS.find((c) => c.id === id);
    return row?.budget === undefined ? undefined : String(row.budget);
  };

  const filtered = useMemo(() => {
    return [...newRows, ...CAMPAIGNS].filter((c) => {
      if (stFlt === "all") return true;
      const st = liveSt(c);
      return st === stFlt;
    });
  }, [stFlt, newRows, CAMPAIGNS]);

  /* ---------- actions ---------- */

  const sendCmp = (c: CampaignRow) => {
    setScheduleRow(c);
    setScheduledAt("");
    setScheduleReason("");
    setScheduleVerified(false);
  };

  const editDraft = (c: CampaignRow) => {
    const zh = splitNotificationBody(c.bodyZh);
    const vi = splitNotificationBody(c.bodyVi);
    const en = splitNotificationBody(c.bodyEn);
    setEditing(c);
    setForm({
      name: c.name,
      titleZh: zh.title,
      titleVi: vi.title,
      titleEn: en.title,
      bodyZh: zh.body,
      bodyVi: vi.body,
      bodyEn: en.body,
      kind: c.kind || "system",
      ctaHref: c.ctaHref || "",
      tier: c.tier,
      phaseMin: c.audienceTarget?.phaseMin ?? "P1",
      phaseMax: c.audienceTarget?.phaseMax ?? "P6",
      language: c.audienceTarget?.language ?? "all",
      registrationDaysMin: String(c.audienceTarget?.registrationDaysMin ?? 0),
      budget: c.budget === undefined ? "" : String(c.budget),
    });
    setNewOpen(true);
  };

  const deleteDraft = (c: CampaignRow) => openConfirm({
    action: <>删除通知草稿 · {c.id}</>,
    detail: <>仅草稿或已取消记录可删除；已下发记录保留审计，不允许删除。</>,
    reason: true,
    okLabel: "确认删除",
    run: (reason) => runBackend(actions.deleteI3Campaign(c.id, c.revision, reason), `${c.id} 已删除`),
  });

  const sendNow = (c: CampaignRow) => openActionConfirm({
    action: <>立即下发 · {c.name}</>,
    detail: (
      <>
        从排期改成<b>立即下发</b>:服务器即刻逐人写入通知流,带防重号(重复提交不会发两遍)。<b>优先级 {c.tier}</b>,受众 <b>{c.audience}</b>(估算 {c.reach} 人)。
        {c.tier === "critical" ? <> <b>紧急级执行门槛升至合规/超管。</b></> : <> 执行门槛 = 内容主管。</>}
      </>
    ),
    amplifies: false,
    run: (reason) => {
      runBackend(actions.sendI3CampaignNow(c.id, c.revision, reason), `${c.id} 立即下发已确认生效`);
    },
  });

  const cancelScheduled = (c: CampaignRow) => openConfirm({
    action: <>取消排期 · {c.id}</>,
    detail: (
      <>
        排期未发可取消。取消后不可恢复,需要重新调度。
      </>
    ),
    reason: true,
    okLabel: "确认取消",
    run: (reason) => {
      runBackend(actions.cancelI3Campaign(c.id, c.revision, reason), `${c.id} 已取消`);
    },
  });

  const adjustCap = (tier: TierK, cap: string) => openActionConfirm({
    action: <>调整 CAP · {tier}</>,
    detail: (
      <>
        当前 <b>{cap}</b> · 调整后立即按新上限清理已有通知。调小可能把未读的高档通知挤出显示窗,影响合规类可见性,所以操作确认;内容和风控都可发起。<b>紧急档锁死为无限保留,不在可调范围。</b>
        {tier === "low" && (
          <>{` `}低优先级除数量上限外,仍固定执行 48 小时自动过期清理。</>
        )}
      </>
    ),
    amplifies: false,
    edit: {
      kind: "number",
      current: cap.replace(/\D/g, ""),
      unit: "条",
      min: 1,
      max: 10000,
      step: 1,
    },
    run: (reason, v) => {
      if (!v) return;
      const def = findHighOp("i3_cap_adjust")!;
      void propose(toast, {
        action: `调整 CAP · ${tier}`,
        obj: tier,
        before: cap,
        after: v,
        type: "param",
        amplifies: false,
        gate: { roles: [] },
        gateLabel: def.gateLabel,
        reason,
        sourceDomain: "I3",
        command: def.buildCommand({ tier, cap: v }),
        target: def.buildTarget({ tier }),
      });
    },
  });

  /* ---------- new campaign drawer 提交 ---------- */
  const submitNew = () => {
    const trimmedName = form.name.trim();
    if (!trimmedName) {
      toast("请填写 Campaign 名称");
      return;
    }
    if (!form.titleZh.trim() || !form.titleVi.trim() || !form.bodyZh.trim() || !form.bodyVi.trim()) {
      toast("请完整填写中文和越南语标题与正文");
      return;
    }
    const minIndex = AUDIENCE_CATALOG?.phases.findIndex((item) => item.value === form.phaseMin) ?? -1;
    const maxIndex = AUDIENCE_CATALOG?.phases.findIndex((item) => item.value === form.phaseMax) ?? -1;
    if (minIndex < 0 || maxIndex < 0 || minIndex > maxIndex) {
      toast("P 阶段范围不正确");
      return;
    }
    const selectedCta = DELIVERY_CATALOG?.ctaRoutes.find((option) => option.value === form.ctaHref);
    const payload = {
      name: trimmedName,
      titleZh: form.titleZh.trim(),
      titleVi: form.titleVi.trim(),
      titleEn: form.titleEn.trim(),
      bodyZh: form.bodyZh.trim(),
      bodyVi: form.bodyVi.trim(),
      bodyEn: form.bodyEn.trim(),
      kind: form.kind,
      ctaHref: form.ctaHref,
      ctaLabel: selectedCta?.label ?? "",
      tier: form.tier,
      audienceTarget: targetFromForm(form),
      budget: Number(form.budget || 0),
    };
    const id = editing?.id ?? `CMP-N-${slug(trimmedName)}`;
    const task = editing
      ? actions.updateI3CampaignDraft(editing.id, payload, editing.revision, `编辑 Campaign 草稿 ${editing.id}`)
      : actions.createI3Campaign(payload, `新建 Campaign 草稿 ${id}`);
    runBackend(task, editing ? `${editing.id} 草稿已保存` : `Campaign 草稿已建 · ${id} · 下发需操作确认`);
    setNewOpen(false);
    setEditing(null);
    setForm(FORM_INIT);
  };

  /* ---------- render helpers ---------- */
  const renderStBadge = (st: CampaignRow["st"]): ReactNode => {
    if (st === "draft") return <span className="bdg dim">草稿</span>;
    if (st === "scheduled") return <span className="bdg warn">排期中</span>;
    if (st === "sending") return <span className="bdg cyan">下发中</span>;
    if (st === "sent") return <span className="bdg ok">已下发</span>;
    if (st === "failed") return <span className="bdg danger">下发失败</span>;
    return <span className="bdg dim">已取消</span>;
  };

  const renderActions = (c: CampaignRow): ReactNode => {
    const st = liveSt(c);
    if (st === "draft") {
      return (
        <>
          <button className="l-btn sm mc" onClick={(e) => { e.stopPropagation(); sendCmp(c); }}>调度下发</button>
          {" "}
          <button className="l-btn sm" onClick={(e) => { e.stopPropagation(); editDraft(c); }}>编辑</button>
          {" "}
          <button className="l-btn sm" onClick={(e) => { e.stopPropagation(); deleteDraft(c); }}>删除</button>
        </>
      );
    }
    if (st === "scheduled") {
      return (
        <>
          <button className="l-btn sm mc" onClick={(e) => { e.stopPropagation(); sendNow(c); }}>立即下发</button>
          {" "}
          <button className="l-btn sm" onClick={(e) => { e.stopPropagation(); cancelScheduled(c); }}>取消</button>
        </>
      );
    }
    if (st === "sent") {
      return <button className="l-btn sm" onClick={(e) => { e.stopPropagation(); setDetail(c); }}>查看</button>;
    }
    if (st === "cancelled") {
      return <button className="l-btn sm" onClick={(e) => { e.stopPropagation(); deleteDraft(c); }}>删除</button>;
    }
    return null;
  };

  if (contentLoading && !data) {
    return <section className="l-card"><div className="l-b"><div className="itint">I3 数据加载中...</div></div></section>;
  }
  if (!data) {
    return <section className="l-card"><div className="l-b"><div className="itint danger">I3 暂无真实接口数据</div></div></section>;
  }

  return (
    <>
      {/* ===== 4 f-stat ===== */}
      <div className="f-stats">
        <div className="f-stat">
          <div className="k">本月 campaign</div>
          <div className="v">{I3_STATS.monthCampaigns} 个</div>
          <div className="sub">已发 {I3_STATS.monthSent} · 排期 {I3_STATS.monthScheduled} · 草稿 {I3_STATS.monthDraft}</div>
        </div>
        <div className="f-stat danger">
          <div className="k">紧急级在途</div>
          <div className="v">{I3_STATS.criticalInflight} 条</div>
          <div className="sub">披露重确认 + 风控异动 · 不淘汰</div>
        </div>
        <div className="f-stat ok">
          <div className="k">平均已读率</div>
          <div className="v">{I3_STATS.avgReadRate}</div>
          <div className="sub">已读 ÷ 送达 · 服务器口径</div>
        </div>
        <div className="f-stat cyan">
          <div className="k">滑动直达转化(本周)</div>
          <div className="v">{I3_STATS.weeklySwipe}</div>
          <div className="sub">佣金到账 → 左滑直跳复投</div>
        </div>
      </div>

      {/* ===== (a) campaign 列表 ===== */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">本月 campaign(a)</span>
          <span className="sub">· 列表 / 详情 / 下发(受众估算 + 双语预览 + 调度)</span>
          <div className="r chips">
            <span className="lb">状态</span>
            {ST_FLT.map(([k, l]) => (
              <button key={k} className={`chip${stFlt === k ? " sel" : ""}`} onClick={() => setStFlt(k)}>{l}</button>
            ))}
            <button className="l-btn sm primary" onClick={() => { setEditing(null); setForm(FORM_INIT); setNewOpen(true); }}>+ 新建 Campaign</button>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 980 }}>
            <thead>
              <tr>
                <th>编号 / 名称</th>
                <th>受众</th>
                <th>优先级</th>
                <th className="num">触达</th>
                <th>调度</th>
                <th>状态</th>
                <th style={{ textAlign: "right" }}>动作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => {
                const row = liveCampaign(c);
                const tierLabel = I3_TIER_STATE[row.tier][0];
                const st = liveSt(row);
                return (
                  <tr key={row.id} className="click" onClick={() => setDetail(row)}>
                    <td>
                      <span className="mono" style={{ fontWeight: 600, color: "var(--ink)" }}>{row.id}</span>
                      <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 2 }}>{row.name}</div>
                    </td>
                    <td style={{ fontSize: 12 }}>{row.audience}</td>
                    <td>
                      <span className={`nc-pr ${row.tier}`}>{tierLabel}</span>
                    </td>
                    <td className="num mono">{row.reach}</td>
                    <td className="mono" style={{ fontSize: 11.5 }}>{row.schedule}</td>
                    <td>{renderStBadge(st)}</td>
                    <td style={{ textAlign: "right" }}>{renderActions(row)}</td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ textAlign: "center", padding: "20px 12px", color: "var(--ink-4)", fontSize: 12 }}>
                    当前筛选下没有 campaign
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ===== (c) CAP 配置 ===== */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">优先级容量闸(c)</span>
          <span className="sub">· 4 档保留策略 · CAP_CRITICAL 锁定 ∞</span>
          <div className="r">
            <span className="icode danger">CAP 单源 = SPEC §6 权威</span>
          </div>
        </div>
        <div className="l-b" style={{ paddingTop: 4 }}>
          {CAP_TIERS.map((row) => {
            const tier = row.tier as TierK;
            const cap = liveCap(tier, row.cap);
            return (
              <div className="p-row" key={tier}>
                <div className="txt">
                  <div className="k">
                    <span className={`nc-pr ${tier}`}>{I3_TIER_STATE[tier][0]}</span>
                  </div>
                  <div className="s" style={{ fontSize: 11.5, color: "var(--ink-4)" }}>{row.policy}</div>
                </div>
                <span
                  className="v"
                  style={tier === "critical" ? { color: "var(--danger)" } : undefined}
                >
                  {cap}
                </span>
                {row.locked ? (
                  <span className="icode lock" title="合规硬约束 · CAP_CRITICAL 固定 Infinity">🔒 锁定</span>
                ) : (
                  <button className="l-btn sm mc" onClick={() => adjustCap(tier, cap)}>调整</button>
                )}
              </div>
            );
          })}
          <div className="itint warn" style={{ marginTop: 10 }}>
            <b>为什么动容量闸要操作确认</b> · 调小高档容量可能把还没读的合规通知挤掉——这影响紧急级和高级通知的可见性,所以内容和风控都能提交,但必须主管执行并填写理由。紧急档直接锁死不开口子。
          </div>
          <div className="itint cyan" style={{ marginTop: 8 }}>
            <b>合规通道特例</b> · 风险披露改版触发的重新确认提醒(I5 页)和 J 域监管应急公告,由对应域发起、借这页的通道按<b>紧急级</b>下发;这两类的执行门槛升到合规/超管级,常规运营公告执行门槛是内容主管。
          </div>
        </div>
      </section>

      {/* ===== swipe 直达表(只读) ===== */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">左滑直达表</span>
          <span className="sub">· 通知类型决定左滑跳转位置;系统通知无转化跳转</span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 540 }}>
            <thead>
              <tr>
                <th>跳转位置</th>
                <th>通知类型</th>
                <th>案例</th>
              </tr>
            </thead>
            <tbody>
              {SWIPE_ROWS.map((r) => {
                const empty = r.to.startsWith("—");
                return (
                  <tr key={r.kind}>
                    <td className="mono" style={empty ? { color: "var(--ink-4)" } : undefined}>{r.to}</td>
                    <td><span className="bdg dim">{DELIVERY_CATALOG?.kinds.find((option) => option.value === r.kind)?.label ?? r.kind}</span></td>
                    <td style={{ fontSize: 12 }}>{r.note}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="l-b" style={{ paddingTop: 10 }}>
          <div className="itint">
            下发、取消、送达、已读和左滑动作均由服务器记录，供触达健康度与转化漏斗使用。
          </div>
        </div>
      </section>

      {/* ===== f-foot ===== */}
      <p className="f-foot">
        <b>执行门槛</b>:草稿随便建(留审计);调度下发 / 取消 = 内容提交(风控合规类可由风控提交),内容主管/超管执行;容量闸调整 = 内容或风控执行门槛:主管。<b>事件去向</b>:送达 / 已读 / 滑动动作三类事件喂触达健康度看板和数据 BI(L 域:触达→已读→转化漏斗、各档送达率);有转化路径的滑动(佣金→复投)喂实时漏斗(B3)。<b>I4 重新确认与 J 域监管应急</b>共用紧急级通道,执行门槛升至合规/超管。下发带防重号,重复点不会发两遍。
      </p>
      <PaginationExemptionList
        items={[
          {
            label: "本月 campaign(a)",
            kind: "reference-catalog",
            maxRows: 7,
            reason: "本月 campaign 使用后端返回记录,按优先级和调度状态筛选",
          },
          {
            label: "左滑直达表",
            maxRows: 3,
            reason: "左滑直达仅固定三类手势映射说明",
          },
        ]}
      />

      {/* ===== Drawer · 新建 / 编辑 Campaign ===== */}
      {newOpen && (
        <Drawer
          title={editing ? `编辑 Campaign 草稿 · ${editing.id}` : "新建 Campaign（存为草稿）"}
          sub="中文、越南语必填，英文可选 · 受众条件按 AND 组合 · 下发另走操作确认"
          onClose={() => { setNewOpen(false); setEditing(null); }}
          footer={
            <>
              <button className="l-btn sm" onClick={() => { setNewOpen(false); setEditing(null); }}>取消</button>
              {" "}
              <button
                className="l-btn sm primary"
                disabled={!AUDIENCE_CATALOG || estimating}
                onClick={submitNew}
              >
                {editing ? "保存修改" : "保存草稿"}
              </button>
            </>
          }
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <FormField label="Campaign 名称 · 用于 slug" required>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="如:7 月费率说明公告"
                style={INPUT_STYLE}
              />
              {form.name.trim() && (
                <div style={{ fontSize: 11.5, color: "var(--ink-4)", marginTop: 4 }}>
                  slug → <span className="mono" style={{ color: "var(--ink-3)" }}>{slug(form.name)}</span>
                </div>
              )}
            </FormField>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12 }}>
              <FormField label="中文标题" required>
                <input
                  value={form.titleZh}
                  onChange={(e) => setForm({ ...form, titleZh: e.target.value })}
                  placeholder="通知流第一行（中文）"
                  style={INPUT_STYLE}
                />
              </FormField>
              <FormField label="越南语标题" required>
                <input
                  value={form.titleVi}
                  onChange={(e) => setForm({ ...form, titleVi: e.target.value })}
                  placeholder="Dòng đầu tiên (VI)"
                  style={INPUT_STYLE}
                />
              </FormField>
              <FormField label="英文标题（可选）">
                <input
                  value={form.titleEn}
                  onChange={(e) => setForm({ ...form, titleEn: e.target.value })}
                  placeholder="通知流第一行（英文）"
                  style={INPUT_STYLE}
                />
              </FormField>
              <FormField label="中文正文" required>
                <textarea
                  rows={4}
                  value={form.bodyZh}
                  onChange={(e) => setForm({ ...form, bodyZh: e.target.value })}
                  placeholder="填写中文正文"
                  style={{ ...INPUT_STYLE, resize: "vertical", fontFamily: "inherit", fontSize: 12.5 }}
                />
              </FormField>
              <FormField label="越南语正文" required>
                <textarea
                  rows={4}
                  value={form.bodyVi}
                  onChange={(e) => setForm({ ...form, bodyVi: e.target.value })}
                  placeholder="Nhập nội dung tiếng Việt"
                  style={{ ...INPUT_STYLE, resize: "vertical", fontFamily: "inherit", fontSize: 12.5 }}
                />
              </FormField>
              <FormField label="英文正文（可选）">
                <textarea
                  rows={4}
                  value={form.bodyEn}
                  onChange={(e) => setForm({ ...form, bodyEn: e.target.value })}
                  placeholder="填写英文正文"
                  style={{ ...INPUT_STYLE, resize: "vertical", fontFamily: "inherit", fontSize: 12.5 }}
                />
              </FormField>
            </div>
            <FormField label="优先级">
              <select
                value={form.tier}
                onChange={(e) => setForm({ ...form, tier: e.target.value as TierK })}
                style={INPUT_STYLE}
              >
                {TIER_OPTS.map((t) => (
                  <option key={t} value={t}>{I3_TIER_STATE[t][0]}</option>
                ))}
              </select>
            </FormField>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <FormField label="通知类型" required>
                <select
                  value={form.kind}
                  onChange={(e) => setForm({ ...form, kind: e.target.value })}
                  disabled={!DELIVERY_CATALOG}
                  style={INPUT_STYLE}
                >
                  {(DELIVERY_CATALOG?.kinds ?? []).map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </FormField>
              <FormField label="点击后跳转位置">
                <select
                  value={form.ctaHref}
                  onChange={(e) => setForm({ ...form, ctaHref: e.target.value })}
                  disabled={!DELIVERY_CATALOG}
                  style={INPUT_STYLE}
                >
                  {(DELIVERY_CATALOG?.ctaRoutes ?? []).map((option) => (
                    <option key={option.value || "none"} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </FormField>
            </div>

            <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 12 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink-2)", marginBottom: 4 }}>受众条件</div>
              <div style={{ fontSize: 11.5, color: "var(--ink-4)", marginBottom: 10 }}>
                以下条件同时满足（AND）才会进入受众范围，选项由后端配置提供。
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 24px 1fr", gap: 8, alignItems: "end" }}>
                <FormField label="P 阶段起点" required>
                  <select
                    value={form.phaseMin}
                    onChange={(e) => setForm({ ...form, phaseMin: e.target.value })}
                    disabled={!AUDIENCE_CATALOG}
                    style={INPUT_STYLE}
                  >
                    {(AUDIENCE_CATALOG?.phases ?? []).map((item) => (
                      <option key={item.value} value={item.value}>{item.label}</option>
                    ))}
                  </select>
                </FormField>
                <div style={{ textAlign: "center", paddingBottom: 9, color: "var(--ink-4)" }}>至</div>
                <FormField label="P 阶段终点" required>
                  <select
                    value={form.phaseMax}
                    onChange={(e) => setForm({ ...form, phaseMax: e.target.value })}
                    disabled={!AUDIENCE_CATALOG}
                    style={INPUT_STYLE}
                  >
                    {(AUDIENCE_CATALOG?.phases ?? []).map((item) => (
                      <option key={item.value} value={item.value}>{item.label}</option>
                    ))}
                  </select>
                </FormField>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 10 }}>
                <FormField label="语言" required>
                  <select
                    value={form.language}
                    onChange={(e) => setForm({ ...form, language: e.target.value as NotificationAudienceTarget["language"] })}
                    disabled={!AUDIENCE_CATALOG}
                    style={INPUT_STYLE}
                  >
                    {(AUDIENCE_CATALOG?.languages ?? []).map((item) => (
                      <option key={item.value} value={item.value}>{item.label}</option>
                    ))}
                  </select>
                </FormField>
                <FormField label="注册时长（大于 N 天）" required>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={form.registrationDaysMin}
                    onChange={(e) => setForm({ ...form, registrationDaysMin: e.target.value })}
                    style={INPUT_STYLE}
                  />
                </FormField>
              </div>
              <div className="itint cyan" style={{ marginTop: 10 }}>
                <b>预计覆盖</b> · {estimating ? "计算中…" : estimatedAudience === null ? "暂不可用" : `${estimatedAudience.toLocaleString("zh-CN")} 人`}
              </div>
            </div>

            <FormField label="预算 USD · 可选">
              <input
                type="number"
                value={form.budget}
                onChange={(e) => setForm({ ...form, budget: e.target.value })}
                placeholder="留空 = 不计预算"
                style={INPUT_STYLE}
              />
            </FormField>
            <div className="itint">
              <b>提交后</b> · 保存草稿并写入 A2 审计;之后从列表里走「调度下发」操作确认,服务器逐人写入通知流,带防重号。
            </div>
          </div>
        </Drawer>
      )}

      {/* ===== Drawer · 调度下发 ===== */}
      {scheduleRow && (
        <Drawer
          title={`调度下发 · ${scheduleRow.id}`}
          sub="选择明确的下发时间；服务端会再次校验必须晚于当前时间"
          onClose={() => setScheduleRow(null)}
          footer={
            <>
              <button className="l-btn sm" onClick={() => setScheduleRow(null)}>取消</button>
              {" "}
              <button
                className="l-btn sm primary"
                disabled={!scheduledAt || !scheduleVerified || scheduleReason.trim().length < 8 || scheduleReason.trim().length > 200}
                onClick={() => {
                  runBackend(
                    actions.scheduleI3Campaign(scheduleRow.id, scheduledAt, scheduleRow.revision, scheduleReason.trim()),
                    `${scheduleRow.id} 已进入排期`,
                  );
                  setScheduleRow(null);
                }}
              >
                确认排期
              </button>
            </>
          }
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div className="itint">
              <b>{scheduleRow.name}</b> · 优先级 {I3_TIER_STATE[scheduleRow.tier][0]} · {scheduleRow.audience} · 预计覆盖 {scheduleRow.reach} 人
            </div>
            <FormField label="计划下发时间" required>
              <input
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                style={INPUT_STYLE}
              />
            </FormField>
            <FormField label="操作理由（8～200 个字）" required>
              <textarea
                rows={3}
                maxLength={200}
                value={scheduleReason}
                onChange={(e) => setScheduleReason(e.target.value)}
                placeholder="说明本次调度的业务目的"
                style={{ ...INPUT_STYLE, resize: "vertical", fontFamily: "inherit" }}
              />
            </FormField>
            <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12.5, color: "var(--ink-2)" }}>
              <input
                type="checkbox"
                checked={scheduleVerified}
                onChange={(e) => setScheduleVerified(e.target.checked)}
                style={{ marginTop: 2 }}
              />
              <span>我已核对中文、越南语、英文标题、正文和受众条件；排期后如需修改，应先取消排期再编辑草稿。</span>
            </label>
          </div>
        </Drawer>
      )}

      {/* ===== Drawer · campaign 详情 ===== */}
      {detail && (
        <Drawer
          title={
            <>
              <span className="mono" style={{ fontWeight: 600, color: "var(--ink)" }}>{detail.id}</span>
              <span style={{ color: "var(--ink-3)", marginLeft: 10, fontWeight: 500 }}>· {detail.name}</span>
            </>
          }
          sub={null}
          onClose={() => setDetail(null)}
        >
          <DetailBody c={liveCampaign(detail)} liveStRender={renderStBadge(liveSt(detail))} budget={liveBudget(detail.id)} />
        </Drawer>
      )}
    </>
  );
}

/* ============ 内部小组件 ============ */

const INPUT_STYLE: React.CSSProperties = {
  width: "100%",
  background: "var(--surface-2)",
  border: "1px solid var(--border-strong)",
  borderRadius: 8,
  padding: "8px 12px",
  color: "var(--ink)",
  fontSize: 13,
  outline: "none",
  fontFamily: "inherit",
};

function FormField({ label, required, children }: { label: string; required?: boolean; children: ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: "var(--ink-3)", marginBottom: 6 }}>
        {label}
        {required && <span style={{ color: "var(--danger)", marginLeft: 4 }}>*</span>}
      </div>
      {children}
    </div>
  );
}

function DetailBody({ c, liveStRender, budget }: { c: CampaignRow; liveStRender: ReactNode; budget?: string }) {
  const tierLabel = I3_TIER_STATE[c.tier][0];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ fontSize: 12, color: "var(--ink-3)", lineHeight: 1.6 }}>
        <b style={{ color: "var(--ink-2)" }}>通知 server 单源 · App 端只是显示窗口</b>
        <div style={{ marginTop: 4, color: "var(--ink-4)" }}>
          下发由服务器写入用户通知流,App 端只拉取显示;已读 / 删除 / 滑动动作也都按服务器记账,client 改不了。
        </div>
      </div>

      <div>
        <div style={{ fontSize: 12, color: "var(--ink-4)", marginBottom: 6 }}>通知体(EN)</div>
        <div className="ab-prev">
          <div className="lc">EN · {tierLabel} · {c.audience}</div>
          <div className="tx">{c.bodyEn}</div>
        </div>
      </div>

      <div>
        <div style={{ fontSize: 12, color: "var(--ink-4)", marginBottom: 6 }}>通知体(VI)</div>
        <div className="ab-prev">
          <div className="lc">VI</div>
          <div className="tx">{c.bodyVi}</div>
        </div>
      </div>

      <div>
        <div style={{ fontSize: 12, color: "var(--ink-4)", marginBottom: 6 }}>通知体(ZH)</div>
        <div className="ab-prev">
          <div className="lc">ZH</div>
          <div className="tx">{c.bodyZh}</div>
        </div>
      </div>

      <div>
        <div className="kv">
          <span className="k">优先级 / 触达</span>
          <span className="v">
            <span className={`nc-pr ${c.tier}`}>{tierLabel}</span>
            <span className="mono" style={{ marginLeft: 8 }}>{c.reach}</span>
          </span>
        </div>
        <div className="kv">
          <span className="k">调度</span>
          <span className="v mono">{c.schedule}</span>
        </div>
        {budget !== undefined && (
          <div className="kv">
            <span className="k">预算</span>
            <span className="v mono">${budget}</span>
          </div>
        )}
        <div className="kv">
          <span className="k">状态</span>
          <span className="v">{liveStRender}</span>
        </div>
        <div className="kv">
          <span className="k">送达 / 已读</span>
          <span className="v mono">{c.st === "sent" ? `${c.sent} / ${c.read}` : "—"}</span>
        </div>
        <div className="kv">
          <span className="k">swipe 直达</span>
          <span className="v mono" style={c.swipeTo === "—" ? { color: "var(--ink-4)" } : undefined}>{c.swipeTo}</span>
        </div>
        <div className="kv">
          <span className="k">事件</span>
          <span className="v mono" style={{ fontSize: 11.5 }}>
            admin.notification_campaign_sent + notification.delivered / read / swipe_action_taken
          </span>
        </div>
      </div>

      {c.tier === "critical" && (
        <div className="itint warn">
          <b>合规通道特例</b> · 风险披露重新确认(I5)+ J 域监管应急公告借这页紧急级通道下发;执行门槛升至合规/超管。
        </div>
      )}
    </div>
  );
}

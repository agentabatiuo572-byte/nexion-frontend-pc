"use client";

/**
 * I3 通知 Campaign — design_handoff_i_domain/I3 通知Campaign.html port。
 * 单源:
 *  - 4 档 CAP = CAP_TIERS(SPEC §6 权威 · critical=∞ 锁死);
 *  - campaign 池 = CAMPAIGNS;tier 颜色映射 = I3_TIER_STATE;统计 = I3_STATS(i-tabs/data 文件头裁定)。
 *  - 实时态 = pget(`I.campaign.<id>.status`) 覆盖种子 st / pget(`I.cap.<tier>`) 覆盖种子 cap。
 * 操作确认 显式 edit 契约:CAP 调整(传 edit text)= 调参;调度下发 / 取消 = 纯处置(不传 edit)。
 * critical 档锁定 = 不渲染调整按钮(渲染 icode lock)。
 * amplifies = false(I3 通知体系不动钱,不碰 B1 红线)。
 * 新建 Campaign / 行点击详情 = 本地 Drawer 原语(design-kit 共享 Drawer);
 *   提交新建 → setParam(`I.campaign.<slug>.status`, "pending") + toast。
 */
import { useMemo, useState, type ReactNode } from "react";
import { Drawer, PaginationExemptionList } from "../design-kit";
import {
  I3_STATS,
  CAP_TIERS,
  CAMPAIGNS,
  I3_TIER_STATE,
  type CampaignRow,
} from "./data";
import type { ICtx } from "./types";

type StFlt = "all" | "scheduled" | "sent" | "draft";
const ST_FLT: [StFlt, string][] = [
  ["all", "全部"],
  ["scheduled", "排期中"],
  ["sent", "已下发"],
  ["draft", "草稿"],
];

type TierK = CampaignRow["tier"];
const TIER_OPTS: TierK[] = ["critical", "high", "normal", "low"];
const AUDIENCE_OPTS = [
  "全量",
  "SFC 辖区 · 未重确认用户",
  "近 30 天提现 >$1k",
  "注册 ≤14 天",
  "P3 阶段活跃用户",
];

/** 名称 → slug(小写、空格转 -、保留中英数字,去其他符号)。 */
function slug(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}\-]+/gu, "")
    .slice(0, 48) || "untitled";
}

type SwipeRow = { to: string; kind: string; note: string };
const SWIPE_ROWS: SwipeRow[] = [
  { to: "/reinvest", kind: "commission", note: "佣金到账 → 复投" },
  { to: "/me/bills", kind: "refund", note: "退款到账 → 账单" },
  { to: "—(留空)", kind: "system", note: "维护公告 / KYC 提醒 / 监管通告 / 运营公告 — system kind 无转化跳转" },
];

type NewForm = {
  name: string;
  title: string;
  content: string;
  tier: TierK;
  audience: string;
  budget: string;
};

const FORM_INIT: NewForm = {
  name: "",
  title: "",
  content: "",
  tier: "normal",
  audience: "全量",
  budget: "",
};

export function I3Campaign({ ctx }: { ctx: ICtx }) {
  const { pget, setParam, toast, openActionConfirm, openConfirm } = ctx;
  const [stFlt, setStFlt] = useState<StFlt>("all");
  const [newOpen, setNewOpen] = useState(false);
  const [form, setForm] = useState<NewForm>(FORM_INIT);
  const [detail, setDetail] = useState<CampaignRow | null>(null);
  // audit P1 修:新建 Campaign 草稿要在列表里可见(种子是 const seed,不能改);用 useState 维护新行,
  // 与 CAMPAIGNS 合并渲染(同源单一时间线 = pget(`I.campaign.<id>.status`),双源共用同一 liveSt)。
  const [newRows, setNewRows] = useState<CampaignRow[]>([]);

  // 实时态(pget 覆盖种子);"pending" = 新建草稿态(submitNew 写入),纳入白名单防种子覆盖。
  const liveSt = (c: CampaignRow): CampaignRow["st"] => {
    const v = pget(`I.campaign.${c.id}.status`);
    if (v === "scheduled" || v === "sending" || v === "sent" || v === "cancelled" || v === "draft") return v;
    if (v === "pending") return "draft"; // pending 视为 draft(待确认未发出)
    return c.st;
  };
  // audit P0 修:critical 是合规硬约束 ∞,不可调降——pget 路径也必须拦(防 dev console 直接 setParam 绕开 UI 按钮拦截)。
  const liveCap = (tier: string, cap: string): string => (tier === "critical" ? "∞ 永不淘汰" : pget(`I.cap.${tier}`) ?? cap);
  const liveCampaign = (c: CampaignRow): CampaignRow => {
    const draftTier = pget(`I.campaign.${c.id}.draft.tier`);
    const tier = TIER_OPTS.includes(draftTier as TierK) ? (draftTier as TierK) : c.tier;
    const draftBody = pget(`I.campaign.${c.id}.draft.body`);
    return {
      ...c,
      name: pget(`I.campaign.${c.id}.draft.title`) ?? c.name,
      bodyZh: draftBody ?? c.bodyZh,
      bodyEn: draftBody ?? c.bodyEn,
      tier,
      audience: pget(`I.campaign.${c.id}.draft.audience`) ?? c.audience,
      schedule: pget(`I.campaign.${c.id}.draft.schedule`) ?? c.schedule,
    };
  };
  const liveBudget = (id: string): string | undefined => pget(`I.campaign.${id}.draft.budget`);

  const filtered = useMemo(() => {
    // 新建草稿置顶,再接种子(单一时间线);liveSt 已统一 pget 派生,过滤同一口径。
    return [...newRows, ...CAMPAIGNS].filter((c) => {
      if (stFlt === "all") return true;
      const st = liveSt(c);
      return st === stFlt;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stFlt, ctx.params, newRows]);

  /* ---------- actions ---------- */

  const sendCmp = (c: CampaignRow) => openActionConfirm({
    action: <>调度下发 · {c.name}</>,
    detail: (
      <>
        受众 <b>{c.audience}</b>(估算 {c.reach} 人)· 优先级 <b>{c.tier}</b>。批量触达属高敏动作:下发后服务器逐人写入通知流,带防重号(重复提交不会发两遍);排期到点自动转下发中。
        {c.tier === "critical" ? (
          <>
            {" "}<b>critical 类执行门槛升合规/超管。</b>
          </>
        ) : (
          <> 执行门槛 = 内容主管。</>
        )}
      </>
    ),
    amplifies: false,
    run: (reason) => {
      setParam(`I.campaign.${c.id}.status`, "scheduled", {
        action: `调度下发 ${c.id} · admin.notification_campaign_sent`,
        reason,
      });
      toast(`${c.id} 调度下发已确认生效`);
    },
  });

  const editDraft = (c: CampaignRow) => openActionConfirm({
    action: <>编辑草稿 · {c.id}</>,
    detail: (
      <>
        草稿编辑保存即留痕(不对外):双语正文同改、占位符两边都得有;发出去另走操作确认。
      </>
    ),
    amplifies: false,
    businessForm: {
      kind: "campaign-edit",
      title: c.name,
      body: `${c.name} · ${c.audience}`,
      defaultTier: c.tier,
      defaultAudience: c.audience,
      tiers: TIER_OPTS,
      audiences: AUDIENCE_OPTS,
    },
    run: (reason, _v, form) => {
      setParam(`I.campaign.${c.id}.status`, "draft", {
        action: `编辑草稿 ${c.id} · admin.notification_campaign_draft_saved`,
        reason,
      });
      if (form) {
        setParam(`I.campaign.${c.id}.draft.title`, form.title, { action: `编辑草稿 ${c.id} · title`, reason });
        setParam(`I.campaign.${c.id}.draft.body`, form.body, { action: `编辑草稿 ${c.id} · body`, reason });
        setParam(`I.campaign.${c.id}.draft.tier`, form.tier, { action: `编辑草稿 ${c.id} · tier`, reason });
        setParam(`I.campaign.${c.id}.draft.audience`, form.audience, { action: `编辑草稿 ${c.id} · audience`, reason });
        setParam(`I.campaign.${c.id}.draft.schedule`, form.schedule, { action: `编辑草稿 ${c.id} · schedule`, reason });
        setParam(`I.campaign.${c.id}.draft.budget`, form.budget, { action: `编辑草稿 ${c.id} · budget`, reason });
      }
      toast(`${c.id} 草稿已保存 · 留审计`);
    },
  });

  const sendNow = (c: CampaignRow) => openActionConfirm({
    action: <>立即下发 · {c.name}</>,
    detail: (
      <>
        从排期改成<b>立即下发</b>:服务器即刻逐人写入通知流,带防重号(重复提交不会发两遍)。<b>优先级 {c.tier}</b>,受众 <b>{c.audience}</b>(估算 {c.reach} 人)。
        {c.tier === "critical" ? <> <b>critical 类执行门槛升合规/超管。</b></> : <> 执行门槛 = 内容主管。</>}
      </>
    ),
    amplifies: false,
    run: (reason) => {
      setParam(`I.campaign.${c.id}.status`, "sending", {
        action: `立即下发 ${c.id} · admin.notification_campaign_sent`,
        reason,
      });
      toast(`${c.id} 立即下发已确认生效`);
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
      setParam(`I.campaign.${c.id}.status`, "cancelled", {
        action: `取消 campaign ${c.id} · admin.notification_campaign_cancelled`,
        reason,
      });
      toast(`${c.id} 已取消`);
    },
  });

  const adjustCap = (tier: TierK, cap: string) => openActionConfirm({
    action: <>调整 CAP · {tier}</>,
    detail: (
      <>
        当前 <b>{cap}</b> · 对新通知的保留立即生效,已有通知不追溯删除。调小可能把未读的高档通知挤出显示窗,影响合规类可见性,所以操作确认;内容和风控都可发起。<b>critical 档锁死 ∞,不在可调范围。</b>
        {tier === "low" && (
          <>{` `}low 档真后台对接后建议切到「24–48 小时自动过期」模式,数量上限就不用了。</>
        )}
      </>
    ),
    amplifies: false,
    edit: { kind: "text", current: cap },
    run: (reason, v) => {
      if (!v) return;
      setParam(`I.cap.${tier}`, v, {
        action: `CAP 调整 ${tier} · admin.notification_cap_changed`,
        reason,
      });
      toast(`${tier} CAP 已更新为 ${v} · 理由留痕`);
    },
  });

  /* ---------- new campaign drawer 提交 ---------- */
  const submitNew = () => {
    const trimmedName = form.name.trim();
    if (!trimmedName) {
      toast("请填写 Campaign 名称");
      return;
    }
    if (!form.title.trim() || !form.content.trim()) {
      toast("请填写标题与正文");
      return;
    }
    const id = `CMP-N-${slug(trimmedName)}`; // N- 前缀:与种子 CMP-26xx 命名空间显式隔离,防 slug 撞号(R2 P1 修)
    setParam(`I.campaign.${id}.status`, "pending", {
      action: `新建 Campaign ${id} · admin.notification_campaign_created`,
      reason: `tier=${form.tier} · audience=${form.audience}${form.budget ? ` · budget=${form.budget}` : ""}`,
    });
    // 同时追加到 newRows,让新草稿在列表里可见(双源同 liveSt 派生,无双口径分叉)。
    setNewRows((rs) => [
      {
        id, name: trimmedName, kind: "system",
        tier: form.tier, audience: form.audience, reach: "—",
        st: "draft", schedule: "—", sent: "—", read: "—",
        bodyEn: form.content, bodyZh: form.content, swipeTo: "—",
      },
      ...rs,
    ]);
    toast(`Campaign 草稿已建 · ${id} · 下发需操作确认`);
    setNewOpen(false);
    setForm(FORM_INIT);
  };

  /* ---------- render helpers ---------- */
  const renderStBadge = (st: CampaignRow["st"]): ReactNode => {
    if (st === "draft") return <span className="bdg dim">draft</span>;
    if (st === "scheduled") return <span className="bdg warn">scheduled</span>;
    if (st === "sending") return <span className="bdg cyan">sending</span>;
    if (st === "sent") return <span className="bdg ok">sent</span>;
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
    return null;
  };

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
          <div className="k">critical 在途</div>
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
            <button className="l-btn sm primary" onClick={() => setNewOpen(true)}>+ 新建 Campaign</button>
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
                    <span className={`nc-pr ${tier}`}>{tier}</span>
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
            <b>为什么动容量闸要操作确认</b> · 调小高档容量可能把还没读的合规通知挤掉——这影响 critical/high 类的可见性,所以内容和风控都能提交,但必须主管执行并填写理由。critical 档直接锁死不开口子。
          </div>
          <div className="itint cyan" style={{ marginTop: 8 }}>
            <b>合规通道特例</b> · 风险披露改版触发的重确认提醒(I4–I5 页)和 J 域监管应急公告,由对应域发起、借这页的通道按 <b>critical</b> 下发;这两类的执行门槛升到合规/超管级,常规运营公告执行门槛是内容主管。
          </div>
        </div>
      </section>

      {/* ===== swipe 直达表(只读) ===== */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">左滑直达表</span>
          <span className="sub">· 通知 kind 决定 swipe 跳哪;system kind 无转化跳转,字段留空</span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 540 }}>
            <thead>
              <tr>
                <th>swipeTo</th>
                <th>kind</th>
                <th>案例</th>
              </tr>
            </thead>
            <tbody>
              {SWIPE_ROWS.map((r) => {
                const empty = r.to.startsWith("—");
                return (
                  <tr key={r.kind}>
                    <td className="mono" style={empty ? { color: "var(--ink-4)" } : undefined}>{r.to}</td>
                    <td><span className="bdg dim">{r.kind}</span></td>
                    <td style={{ fontSize: 12 }}>{r.note}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="l-b" style={{ paddingTop: 10 }}>
          <div className="itint">
            事件 <b>admin.notification_campaign_sent / _cancelled</b> + <b>notification.delivered / read / swipe_action_taken</b> — 待 A4 notification domain 工单上线后正式归类。
          </div>
        </div>
      </section>

      {/* ===== f-foot ===== */}
      <p className="f-foot">
        <b>执行门槛</b>:草稿随便建(留审计);调度下发 / 取消 = 内容提交(风控合规类可由风控提交),内容主管/超管执行;容量闸调整 = 内容或风控执行门槛:主管。<b>事件去向</b>:送达 / 已读 / 滑动动作三类事件喂触达健康度看板和数据 BI(L 域:触达→已读→转化漏斗、各档送达率);有转化路径的滑动(佣金→复投)喂实时漏斗(B3)。<b>I5 re-ack 与 J 域监管应急</b>共用 critical 通道:由对应域提交、借这页的通道按 critical 下发,执行门槛升合规/超管级。通知类事件的归类登记(notification 域)是 BI 上线前必办工单,占位期按临时编号入库<span title="§2.4.3 domain 枚举扩展 · V4 内容批次 · blocking">。</span>下发带防重号,重复点不会发两遍。
      </p>
      <PaginationExemptionList
        items={[
          {
            label: "本月 campaign(a)",
            kind: "sample-ledger",
            maxRows: 7,
            reason: "本月 campaign 当前七条运营样本,按优先级和调度状态筛选",
          },
          {
            label: "左滑直达表",
            maxRows: 3,
            reason: "左滑直达仅固定三类手势映射说明",
          },
        ]}
      />

      {/* ===== Drawer · 新建 Campaign ===== */}
      {newOpen && (
        <Drawer
          title="新建 Campaign(存为草稿)"
          sub="提交后写 I.campaign.<slug>.status=pending · 下发另走操作确认"
          onClose={() => setNewOpen(false)}
          footer={
            <>
              <button className="l-btn sm" onClick={() => setNewOpen(false)}>取消</button>
              {" "}
              <button className="l-btn sm primary" onClick={submitNew}>保存草稿</button>
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
            <FormField label="通知标题" required>
              <input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="标题(显示在通知流第一行)"
                style={INPUT_STYLE}
              />
            </FormField>
            <FormField label="通知正文(双语合并 · 占位期)" required>
              <textarea
                rows={4}
                value={form.content}
                onChange={(e) => setForm({ ...form, content: e.target.value })}
                placeholder="先填一份占位文案,真后台对接后拆双语词条由 I6 接管"
                style={{ ...INPUT_STYLE, resize: "vertical", fontFamily: "inherit", fontSize: 12.5 }}
              />
            </FormField>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <FormField label="优先级 tier">
                <select
                  value={form.tier}
                  onChange={(e) => setForm({ ...form, tier: e.target.value as TierK })}
                  style={INPUT_STYLE}
                >
                  {TIER_OPTS.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </FormField>
              <FormField label="受众定向">
                <select
                  value={form.audience}
                  onChange={(e) => setForm({ ...form, audience: e.target.value })}
                  style={INPUT_STYLE}
                >
                  {AUDIENCE_OPTS.map((a) => (
                    <option key={a} value={a}>{a}</option>
                  ))}
                </select>
              </FormField>
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
              <b>提交后</b> · 写 <span className="mono" style={{ color: "var(--ink-2)" }}>I.campaign.&lt;slug&gt;.status=pending</span>(草稿态)+ A2 审计;之后从列表里走「调度下发」操作确认,服务器逐人写入通知流,带防重号。
            </div>
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
          <b>合规通道特例</b> · 风险披露重确认(I4-I5)+ J 域监管应急公告借这页 critical 下发;执行门槛升合规/超管。
        </div>
      )}
    </div>
  );
}

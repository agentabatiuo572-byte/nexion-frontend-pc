"use client";

/**
 * I2 Nova 推送运营 — design_handoff_i_domain/I2 Nova推送运营.html port。
 * 单源:后端 /content/nova/overview;空库时保持后端空态,不补前端业务样例。
 * 操作确认 显式 edit 契约:调 cadence(tick/cd) / 调概率分布 = 调参传 edit;
 *   kill 单频道 / 启停 / 发布 / 归档模板 = 处置不传 edit。
 * amplifies = false(I2 不碰 B1 红线 —— 只动推送节奏与文案出口,不动费率/奖励/价格)。
 */
import { useEffect, useState } from "react";
import { Drawer, PaginationExemptionList } from "../design-kit";
import {
  formatNovaDuration,
  NOVA_TIME_UNITS,
  parseNovaDuration,
  validateNovaCadence,
  type NovaTimeUnit,
} from "../../../../lib/admin/nova-cadence";
import type { ICtx } from "./types";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { displayAdminError } from "@/lib/admin/error-messages";

type NovaForm = {
  name: string;
  runtimeSource: string;
  tickValue: string;
  tickUnit: NovaTimeUnit;
  cooldownValue: string;
  cooldownUnit: NovaTimeUnit;
};
type TemplateForm = {
  channel: string;
  name: string;
  cta: string;
  version: string;
  titleZh: string;
  bodyZh: string;
  titleVi: string;
  bodyVi: string;
  titleEn: string;
  bodyEn: string;
};
const EMPTY_FORM: NovaForm = {
  name: "",
  runtimeSource: "",
  tickValue: "",
  tickUnit: "minutes",
  cooldownValue: "",
  cooldownUnit: "hours",
};
const EMPTY_TEMPLATE: TemplateForm = {
  channel: "", name: "", cta: "", version: "v1",
  titleZh: "", bodyZh: "", titleVi: "", bodyVi: "", titleEn: "", bodyEn: "",
};
type OpsNova = { key: string; name: string; trigger: string; tick: string; cd: string; phaseKeyed: string; ctr: number; on: boolean };

const normalizeNovaKey = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);

const slug = (s: string) => normalizeNovaKey(s) || "untitled";

export function I2Nova({ ctx }: { ctx: ICtx }) {
  const { toast, openActionConfirm, openConfirm, actions, content, contentLoading } = ctx;
  const session = useAdminAuth((state) => state.session);
  const canWriteI2 = session?.role === "superadmin" || !!session?.authorities.includes("content_i2_write");
  const data = content.nova;
  const I2_STATS = data?.stats ?? { todayDelivered: "—", ctr: "—", ctrTarget: 0, onlineChannels: 0, totalChannels: 0, weeklySocial: "—" };
  const novas: OpsNova[] = (data?.channels ?? []).map((n) => ({
    key: n.key,
    name: n.name,
    trigger: n.trigger,
    tick: n.tick,
    cd: n.cooldown,
    phaseKeyed: n.phaseKeyed,
    ctr: Number(n.ctr),
    on: n.enabled,
  }));
  const NOVA_EVENT_DRIVEN = (data?.eventDriven ?? []).map((r) => ({ name: r.name, why: r.reason, owner: r.owner, tone: r.tone, st: r.status }));
  const NOVA_TPLS = (data?.templates ?? []).map((t) => ({
    ch: t.channel, name: t.name, cta: t.cta, v: t.version, status: t.status,
    titleZh: t.titleZh, bodyZh: t.bodyZh, titleVi: t.titleVi, bodyVi: t.bodyVi,
    titleEn: t.titleEn, bodyEn: t.bodyEn,
  }));
  const CTA_OPTIONS = data?.templateCtaOptions ?? [];
  const RUNTIME_SOURCE_OPTIONS = data?.runtimeSourceOptions ?? [];
  const SOCIAL_DIST = data?.socialDistribution ?? [];
  const INITIAL_SOCIAL_EVENTS = data?.socialEvents ?? [];
  const SOCIAL_EVENT_TYPE_OPTIONS = data?.socialEventTypes ?? [];
  const SOCIAL_EVENT_STATUS_OPTIONS = data?.socialEventStatuses ?? [];

  const runBackend = (task: Promise<void>, ok: string, onSuccess?: () => void) => task
      .then(() => actions.reloadIContent())
      .then(() => { toast(ok); onSuccess?.(); })
      .catch((error) => {
        toast(`操作失败:${displayAdminError(error)}`);
        throw error;
      });

  // ── Drawer 表单(新增 / 编辑通道复用同一抽屉)──
  const [novaDrawer, setNovaDrawer] = useState(false);
  const [editNovaKey, setEditNovaKey] = useState<string | null>(null);
  const [form, setForm] = useState<NovaForm>(EMPTY_FORM);

  const openNewNova = () => { setEditNovaKey(null); setForm(EMPTY_FORM); setNovaDrawer(true); };
  const openEditNova = (n: OpsNova) => {
    const tick = parseNovaDuration(n.tick, "minutes");
    const cooldown = parseNovaDuration(n.cd, "hours");
    setEditNovaKey(n.key);
    setForm({
      name: n.name,
      runtimeSource: n.trigger.startsWith("a4:") ? n.trigger : "",
      tickValue: tick.value,
      tickUnit: tick.unit,
      cooldownValue: cooldown.value,
      cooldownUnit: cooldown.unit,
    });
    setNovaDrawer(true);
  };
  const closeDrawer = () => { setNovaDrawer(false); setEditNovaKey(null); setForm(EMPTY_FORM); };

  const cadenceError = validateNovaCadence(
    form.tickValue,
    form.tickUnit,
    form.cooldownValue,
    form.cooldownUnit,
  );

  const submitDrawer = () => {
    const name = form.name.trim();
    if (!name) return;
    if (cadenceError) {
      toast(cadenceError);
      return;
    }
    const tick = formatNovaDuration(form.tickValue, form.tickUnit);
    const cd = formatNovaDuration(form.cooldownValue, form.cooldownUnit);
    if (editNovaKey) {
      const prev = novas.find((x) => x.key === editNovaKey);
      runBackend(actions.updateI2NovaChannel(editNovaKey, {
        name,
        trigger: form.runtimeSource || prev?.trigger || "",
        tick,
        cooldown: cd,
        ctr: prev?.ctr ?? 0,
        enabled: prev?.on ?? true,
      }, "后台编辑 Nova 通道"), `Nova 通道已更新:${prev?.name ?? editNovaKey} → ${name}`, closeDrawer);
    } else {
      const key = `${slug(name).slice(0, 50)}-${Date.now().toString(36).slice(-6)}`;
      runBackend(actions.createI2NovaChannel({
        key,
        name,
        trigger: form.runtimeSource,
        tick,
        cooldown: cd,
        ctr: 0,
        enabled: false,
      }, "后台新增 Nova 通道"), `Nova 通道已新增:${name}`, closeDrawer);
    }
  };

  // ── 单通道 kill / 恢复:走操作确认(操作确认 不传 edit) ──
  const toggleNova = (n: OpsNova) => openActionConfirm({
    action: <>{n.on ? "kill" : "恢复"} Nova 通道 · {n.name}</>,
    detail: n.on
      ? <>停推该频道。<b>操作确认防误杀</b> · 监管点名要快速止血时也走这条路径(内容/风控都能发起)。</>
      : <>恢复投递配置。只有对应业务事件满足触发条件时才会发出；检查间隔只决定扫描频率。</>,
    amplifies: false,
    reasonMax: 200,
    run: (reason) => {
      if (!n.on && tplStatus(n.key) !== "published") {
        toast("请先为该通道创建并发布完整的中越文模板，再恢复通道");
        throw new Error("NOVA_PUBLISHED_TEMPLATE_REQUIRED");
      }
      return runBackend(actions.updateI2NovaChannelStatus(n.key, !n.on, reason), `${n.name} 通道${n.on ? "已 kill" : "已恢复"}`);
    },
  });

  // ── 删除通道:走普通确认(原因必填 + 留痕) ──
  const removeNova = (n: OpsNova) => openConfirm({
    action: <>删除推送通道 · {n.name}</>,
    detail: <>从 Nova cadence 移除并停止投递。需审计留痕。</>,
    reason: true,
    okLabel: "确认删除",
    run: (reason) => {
      return runBackend(actions.deleteI2NovaChannel(n.key, reason), `Nova 通道已删除:${n.name}`);
    },
  });

  const tplStatus = (ch: string): string => NOVA_TPLS.find((t) => t.ch === ch)?.status?.toLowerCase() ?? "missing";
  const renderTplBadge = (st: string) => {
    if (st === "published") return <span className="bdg ok">已发布</span>;
    if (st === "archived") return <span className="bdg dim">已归档</span>;
    if (st === "draft") return <span className="bdg warn">草稿</span>;
    if (st === "missing") return <span className="bdg danger">缺少模板</span>;
    return <span className="bdg dim">{st}</span>;
  };

  const publishTpl = (ch: string, name: string) => openActionConfirm({
    action: <>发布模板 · {name}</>,
    detail: <>频道 <b>{ch}</b>。发布即对该频道下一条推送生效;服务器侧校验中英镜像 + 占位符一致,不齐直接拒。</>,
    amplifies: false,
    reasonMax: 200,
    run: (reason) => {
      return runBackend(actions.updateI2TemplateStatus(ch, "PUBLISHED", reason), `${name} 发布已确认生效`);
    },
  });
  const archiveTpl = (ch: string, name: string) => openActionConfirm({
    action: <>归档模板 · {name}</>,
    detail: <>归档后该模板从频道可选池移除,已在投递队列里的不撤回。</>,
    amplifies: false,
    reasonMax: 200,
    run: (reason) => {
      return runBackend(actions.updateI2TemplateStatus(ch, "ARCHIVED", reason), `${name} 归档已确认生效`);
    },
  });

  const [tplDrawer, setTplDrawer] = useState(false);
  const [editTplChannel, setEditTplChannel] = useState<string | null>(null);
  const [tplForm, setTplForm] = useState<TemplateForm>(EMPTY_TEMPLATE);
  const newTpl = () => {
    const firstChannel = novas.find((n) => !NOVA_TPLS.some((t) => t.ch === n.key))?.key ?? "";
    setEditTplChannel(null);
    setTplForm({ ...EMPTY_TEMPLATE, channel: firstChannel, cta: CTA_OPTIONS[0]?.value ?? "" });
    setTplDrawer(true);
  };
  const editTpl = (t: (typeof NOVA_TPLS)[number]) => {
    setEditTplChannel(t.ch);
    setTplForm({ channel: t.ch, name: t.name, cta: t.cta, version: t.v,
      titleZh: t.titleZh, bodyZh: t.bodyZh, titleVi: t.titleVi, bodyVi: t.bodyVi,
      titleEn: t.titleEn, bodyEn: t.bodyEn });
    setTplDrawer(true);
  };
  const closeTplDrawer = () => { setTplDrawer(false); setEditTplChannel(null); setTplForm(EMPTY_TEMPLATE); };
  const submitTpl = () => openConfirm({
    action: <>{editTplChannel ? "编辑" : "新增"}推送模板 · {tplForm.name}</>,
    detail: <>保存后状态为草稿；发布前服务器会再次校验中越文完整性和占位符一致性。</>,
    reason: true,
    okLabel: "保存草稿",
    run: (reason) => {
      const body = { ...tplForm };
      return runBackend(editTplChannel
        ? actions.updateI2Template(editTplChannel, body, reason)
        : actions.createI2Template(body, reason),
      `模板 ${tplForm.name} 已保存为草稿`, closeTplDrawer);
    },
  });
  const removeTpl = (t: (typeof NOVA_TPLS)[number]) => openConfirm({
    action: <>删除推送模板 · {t.name}</>,
    detail: <>已发布模板不能直接删除，请先归档。删除后对应通道无法启用。</>,
    reason: true,
    okLabel: "确认删除",
    run: (reason) => runBackend(actions.deleteI2Template(t.ch, reason), `模板 ${t.name} 已删除`),
  });

  // ── social 概率分布:一次编辑全部类型，禁止静默篡改另一类别。──
  const [distDrawer, setDistDrawer] = useState(false);
  const [distDraft, setDistDraft] = useState<Record<string, string>>({});
  const openDistDrawer = () => {
    setDistDraft(Object.fromEntries(SOCIAL_DIST.map((item) => [item.key, String(item.pct)])));
    setDistDrawer(true);
  };
  const distDraftTotal = SOCIAL_DIST.reduce((sum, item) => sum + Number(distDraft[item.key] ?? 0), 0);
  const distDraftValid = SOCIAL_DIST.length > 0
    && SOCIAL_DIST.every((item) => {
      const value = Number(distDraft[item.key]);
      return Number.isFinite(value) && Number.isInteger(value) && value >= 0 && value <= 100;
    })
    && distDraftTotal === 100;
  const submitDistribution = () => openConfirm({
    action: <>保存 social 事件概率分布</>,
    detail: <>本次会整体替换 5 类真实事件权重；合计必须为 100%，不会自动改动任何其他类别。</>,
    reason: true,
    okLabel: "确认保存",
    run: (reason) => {
      const items = SOCIAL_DIST.map((item) => ({ key: item.key, pct: Number(distDraft[item.key] ?? 0) }));
      const expectedItems = SOCIAL_DIST.map((item) => ({ key: item.key, pct: Number(item.pct) }));
      return runBackend(actions.updateI2Distribution(items, expectedItems, reason), "真实事件概率分布已更新", () => setDistDrawer(false));
    },
  });

  // ── 真实事件生命周期:事件只能从受信业务表同步，管理端不提供伪造入口。──
  const [eventTypeFilter, setEventTypeFilter] = useState("");
  const [eventStatusFilter, setEventStatusFilter] = useState("");
  const [previewLanguage, setPreviewLanguage] = useState<"ZH" | "VI" | "EN">("VI");
  const [eventPage, setEventPage] = useState(1);
  const [eventBusy, setEventBusy] = useState<string | null>(null);
  const [eventRefreshKey, setEventRefreshKey] = useState(0);
  const [SOCIAL_EVENTS, setSocialEvents] = useState(INITIAL_SOCIAL_EVENTS);
  const [eventTotal, setEventTotal] = useState(INITIAL_SOCIAL_EVENTS.length);
  const [eventLoading, setEventLoading] = useState(false);
  const EVENT_PAGE_SIZE = 20;
  const eventPageCount = Math.max(1, Math.ceil(eventTotal / EVENT_PAGE_SIZE));
  const visibleSocialEvents = SOCIAL_EVENTS;
  useEffect(() => {
    let active = true;
    setEventLoading(true);
    actions.listI2SocialEvents(eventTypeFilter, eventStatusFilter, eventPage, EVENT_PAGE_SIZE)
      .then((result) => {
        if (!active) return;
        const lastPage = Math.max(1, Math.ceil(result.total / EVENT_PAGE_SIZE));
        if (eventPage > lastPage) {
          setEventPage(lastPage);
          return;
        }
        setSocialEvents(result.items);
        setEventTotal(result.total);
      })
      .catch((error) => active && toast(`事件列表加载失败:${displayAdminError(error)}`))
      .finally(() => active && setEventLoading(false));
    return () => { active = false; };
  }, [actions.listI2SocialEvents, eventPage, eventRefreshKey, eventStatusFilter, eventTypeFilter, toast]);
  const optionLabel = (options: { value: string; label: string }[], value: string) =>
    options.find((option) => option.value === value)?.label ?? value;
  const statusLabel = (value: string) => SOCIAL_EVENT_STATUS_OPTIONS.find((option) => option.value === value)?.label
    ?? ({ ACTIVE: "已验证", DISABLED: "已停用", EXPIRED: "已过期" } as Record<string, string>)[value]
    ?? value;
  const formatEventTime = (value?: string) => {
    if (!value) return "—";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
  };
  const canRestoreEvent = (expiresAt: string) => new Date(expiresAt).getTime() > Date.now();
  const syncSocialEvents = () => openConfirm({
    action: <>同步真实业务事件</>,
    detail: <>仅从提现、V 等级、Genesis 成交和整点新增用户等受信业务表采集；重复来源会幂等跳过，AI 客户消费在真实计费源接入前保持不可用。</>,
    reason: true,
    okLabel: "开始同步",
    run: (reason) => {
      setEventBusy("sync");
      return actions.syncI2SocialEvents(reason)
        .then((result) => actions.reloadIContent().then(() => result))
        .then((result) => {
          setEventRefreshKey((key) => key + 1);
          toast(`同步完成：发现 ${result.discovered} 条，新增 ${result.inserted} 条，重复 ${result.duplicates} 条`);
        })
        .catch((error) => {
          toast(`同步失败:${displayAdminError(error)}`);
          throw error;
        })
        .finally(() => setEventBusy(null));
    },
  });
  const previewSocialEvent = () => {
    setEventBusy("preview");
    actions.previewI2SocialEvent(previewLanguage)
      .then((sample) => toast(sample ? `抽样预览：${sample.body}` : "当前没有可投放的真实事件，本轮不会推送"))
      .catch((error) => toast(`抽样失败:${displayAdminError(error)}`))
      .finally(() => setEventBusy(null));
  };
  const changeSocialEventStatus = (event: (typeof SOCIAL_EVENTS)[number], status: "ACTIVE" | "DISABLED" | "EXPIRED") => openConfirm({
    action: <>{status === "ACTIVE" ? "恢复" : status === "DISABLED" ? "停用" : "立即过期"}真实事件 · #{event.id}</>,
    detail: <>来源事件只允许改变投放资格，不允许修改来源、人物、金额或发生时间；全部操作保留审计记录。</>,
    reason: true,
    okLabel: "确认操作",
    run: (reason) => {
      setEventBusy(`status-${event.id}`);
      return runBackend(actions.updateI2SocialEventStatus(event.id, status, reason), "事件状态已更新",
        () => setEventRefreshKey((key) => key + 1))
        .finally(() => setEventBusy(null));
    },
  });
  const deleteSocialEvent = (event: (typeof SOCIAL_EVENTS)[number]) => openConfirm({
    action: <>删除真实事件 · #{event.id}</>,
    detail: <>执行软删除并保留来源和审计链；已投递记录不会被物理抹除。</>,
    reason: true,
    okLabel: "确认删除",
    run: (reason) => {
      setEventBusy(`delete-${event.id}`);
      return runBackend(actions.deleteI2SocialEvent(event.id, reason), "事件已软删除",
        () => setEventRefreshKey((key) => key + 1))
        .finally(() => setEventBusy(null));
    },
  });

  const onlineCount = novas.filter((n) => n.on).length;

  if (contentLoading && !data) {
    return <section className="l-card"><div className="l-b"><div className="itint">I2 数据加载中...</div></div></section>;
  }
  if (!data) {
    return <section className="l-card"><div className="l-b"><div className="itint danger">I2 暂无真实接口数据</div></div></section>;
  }

  return (
    <>
      <div className="f-stats">
        <div className="f-stat">
          <div className="k">今日推送量</div>
          <div className="v">{I2_STATS.todayDelivered}</div>
          <div className="sub">送达事件服务器口径</div>
        </div>
        <div className="f-stat ok">
          <div className="k">Nova 点击率</div>
          <div className="v">{I2_STATS.ctr}</div>
          <div className="sub">目标 &gt;{I2_STATS.ctrTarget}% ✓ · 点击 ÷ 送达</div>
        </div>
        <div className="f-stat cyan">
          <div className="k">频道在线</div>
          <div className="v">{onlineCount} / {novas.length}</div>
          <div className="sub">停推 = 单频道 kill,操作确认</div>
        </div>
        <div className="f-stat">
          <div className="k">social 事件派发(本周)</div>
          <div className="v">{I2_STATS.weeklySocial}</div>
          <div className="sub">5 类按概率分布抽取</div>
        </div>
      </div>

      {/* (a) 10 可调通道节奏表 */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">可调通道节奏表</span>
          <span className="sub">· 启停 + 检查间隔 + 同一用户最短推送间隔 + P 阶段分档</span>
          <div className="r">
            {!canWriteI2 && <span className="bdg dim">只读</span>}
            {canWriteI2 && <button className="l-btn sm primary" onClick={openNewNova}>+ 新增通道</button>}
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 960 }}>
            <thead>
              <tr>
                <th>开关</th>
                <th>key / 名称</th>
                <th>内容触发</th>
                <th>检查间隔</th>
                <th>同一用户最短推送间隔</th>
                <th>phase-keyed</th>
                <th>推送文案</th>
                <th>真实 CTR</th>
                <th style={{ textAlign: "right" }}></th>
              </tr>
            </thead>
            <tbody>
              {novas.map((n) => {
                const phaseKeyed = n.phaseKeyed || "—";
                const h1CadenceReadOnly = n.key === "tradein" || n.key === "taskLockMonthly";
                const trigger = n.trigger || n.name;
                const channelTemplate = NOVA_TPLS.find((t) => t.ch === n.key);
                const phaseStyle = phaseKeyed === "—"
                  ? { fontSize: 11.5, color: "var(--ink-4)" }
                  : { fontSize: 11.5, color: "var(--warning)" };
                return (
                  <tr key={n.key}>
                    <td>
                      {canWriteI2 ? <button
                        className={`nv-sw${n.on ? " on" : ""}`}
                        onClick={() => toggleNova(n)}
                        aria-label={`${n.on ? "kill" : "恢复"} ${n.name}`}
                      /> : <span className={`bdg ${n.on ? "ok" : "dim"}`}>{n.on ? "开启" : "停推"}</span>}
                    </td>
                    <td>
                      <span className="mono" style={{ fontWeight: 600, color: "var(--ink)" }}>{n.key}</span>
                      <div style={{ fontSize: 11.5, color: "var(--ink-4)", marginTop: 2 }}>{n.name}</div>
                    </td>
                    <td style={{ fontSize: 12, color: "var(--ink-3)", maxWidth: 240 }}>{trigger}</td>
                    <td className="mono" style={{ fontSize: 12 }}>{n.tick}</td>
                    <td className="mono" style={{ fontSize: 12 }}>{n.cd}</td>
                    <td style={phaseStyle}>{phaseKeyed}</td>
                    <td>{renderTplBadge(tplStatus(n.key))}<div style={{ fontSize: 11, marginTop: 3, color: "var(--ink-4)" }}>{channelTemplate?.name ?? "请先新增模板"}</div></td>
                    <td className="mono" style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{`CTR ${n.ctr}%`}</td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      {canWriteI2 && <>
                        {h1CadenceReadOnly
                          ? <button className="l-btn sm" disabled title="当前节奏由 H1 阶段权威派发">H1 节奏只读</button>
                          : <button className="l-btn sm" onClick={() => openEditNova(n)}>编辑</button>}
                        <button className="l-btn sm" style={{ marginLeft: 6 }} onClick={() => removeNova(n)}>删除</button>
                      </>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="l-b" style={{ paddingTop: 10 }}>
          <div className="itint warn">
            <b>这套开关不在熔断矩阵里</b> · 停某个 Nova 频道走这页的开关(操作确认),不占应急熔断矩阵(J1)的 6 个功能闸,也不是地区屏蔽(J2);只有「Nova 整体作为一种能力要平台级停掉」才轮到 J 域出手。别把频道停推误报成熔断。
          </div>
          <div className="itint" style={{ marginTop: 8 }}>
          <b>两个随阶段变的频道</b> · 以旧换新(tradein)和月度任务锁定(taskLockMonthly)的同一用户最短推送间隔按运营阶段(P1–P6)分档,阶段切换时自动换档——<b>阶段由节奏调度页(H1)说了算,这页只读跟随</b>,想改当前是 P 几去 H1。
          </div>
        </div>
      </section>

      {/* 不在 10 通道里的推送(口径闭合) */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">不在 10 频道里的推送(口径闭合)</span>
          <span className="sub">· 文案归这页的模板池管,节奏这页管不了 · 防止盘点时漏数或多数</span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 760 }}>
            <thead>
              <tr>
                <th>频道</th>
                <th>为什么不可调</th>
                <th>节奏归谁</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              {NOVA_EVENT_DRIVEN.map((r) => (
                <tr key={r.name}>
                  <td className="mono" style={{ fontWeight: 600, color: "var(--ink)" }}>{r.name}</td>
                  <td style={{ fontSize: 12, color: "var(--ink-3)" }}>
                    {r.name.startsWith("team_event") ? (
                      <>这三个 v3 业务频道的节奏目前<b>写死在 App 代码里</b>,没有开关字段、不读服务器配置——把它们接进这张节奏表是一张已登记的整合工单,落地前这页不持有它们的调频项</>
                    ) : r.why}
                  </td>
                  <td style={{ fontSize: 12, color: "var(--ink-3)" }}>{r.owner}</td>
                  <td><span className={`bdg ${r.tone}`}>{r.st}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="l-b" style={{ paddingTop: 8 }}>
          <div className="itint">
            <b>容易混的两个 market</b> · 节奏表里的 market(12 分钟一查)是全网算力 / 币价的氛围播报;上面待整合的 market_event 是 v3 的业务市场事件,两者不是一回事——节奏表只暴露前者,后者等整合工单。
          </div>
        </div>
      </section>

      <div className="two-col">
        {/* (b) 推送模板池 */}
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">推送模板池(b)</span>
            <span className="sub">· 中文/越南语必填,英语可选 · 发布操作确认</span>
            <div className="r">
              {!canWriteI2 && <span className="bdg dim">只读</span>}
              {canWriteI2 && <button className="l-btn sm mc" onClick={newTpl}>+ 新模板</button>}
            </div>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="l-tbl" style={{ minWidth: 540 }}>
              <thead>
                <tr>
                  <th>频道</th>
                  <th>模板</th>
                  <th>CTA 去向</th>
                  <th>中/越文预览</th>
                  <th>版本</th>
                  <th>状态</th>
                  <th style={{ textAlign: "right" }}></th>
                </tr>
              </thead>
              <tbody>
                {NOVA_TPLS.map((t) => {
                  const st = tplStatus(t.ch);
                  const canPublish = st !== "published";
                  const canArchive = st !== "archived";
                  return (
                    <tr key={t.ch}>
                      <td className="mono" style={{ fontSize: 11.5 }}>{t.ch}</td>
                      <td className="mono" style={{ fontWeight: 600, color: "var(--ink)" }}>{t.name}</td>
                      <td style={{ fontSize: 12, color: "var(--ink-3)" }}>{t.cta}</td>
                      <td style={{ fontSize: 11.5, color: "var(--ink-3)", maxWidth: 260 }}>
                        <div><b>中文：</b>{t.titleZh} · {t.bodyZh}</div>
                        <div><b>越南语：</b>{t.titleVi} · {t.bodyVi}</div>
                        {t.bodyEn && <div><b>英语：</b>{t.titleEn} · {t.bodyEn}</div>}
                      </td>
                      <td className="mono" style={{ fontWeight: 700 }}>{t.v}</td>
                      <td>{renderTplBadge(st)}</td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        {canWriteI2 && <>
                        {canPublish && (
                          <button className="l-btn sm mc" onClick={() => publishTpl(t.ch, t.name)}>发布</button>
                        )}
                        {canArchive && (
                          <button className="l-btn sm" style={{ marginLeft: canPublish ? 6 : 0 }} onClick={() => archiveTpl(t.ch, t.name)}>归档</button>
                        )}
                        {st === "draft" && <button className="l-btn sm" style={{ marginLeft: 6 }} onClick={() => editTpl(t)}>编辑</button>}
                        {st !== "published" && <button className="l-btn sm" style={{ marginLeft: 6 }} onClick={() => removeTpl(t)}>删除</button>}
                        </>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="l-b" style={{ paddingTop: 8 }}>
            <div className="itint">
              <b>文案来源</b> · 模板中的中文、越南语和可选英语正文就是通道实际推送内容；通道、CTA 均从后端配置目录选择。状态机：草稿 → 已发布 → 已归档。
            </div>
          </div>
        </section>

        {/* (c) 全网真实事件池 · social 频道 */}
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">全网真实事件池(c)· social 频道</span>
            <span className="sub">· 只消费已核验、未过期的真实业务事件 · 无事件就跳过投放</span>
            <div className="r">
              {canWriteI2 && <button className="l-btn sm" onClick={openDistDrawer}>编辑全部概率</button>}
              {canWriteI2 && <button className="l-btn sm mc" disabled={eventBusy !== null} onClick={syncSocialEvents}>{eventBusy === "sync" ? "同步中…" : "同步真实事件"}</button>}
              <select className="fld" style={{ width: 112 }} value={previewLanguage} onChange={(event) => setPreviewLanguage(event.target.value as "ZH" | "VI" | "EN")} aria-label="预览语言">
                <option value="VI">越南语</option><option value="ZH">中文</option><option value="EN">英语</option>
              </select>
              <button className="l-btn sm" disabled={eventBusy !== null} onClick={previewSocialEvent}>{eventBusy === "preview" ? "抽样中…" : "预览抽样"}</button>
            </div>
          </div>
          <div className="l-b" style={{ paddingTop: 6 }}>
            <div className="nv-pb">
              {SOCIAL_DIST.map((d) => (
                <i key={d.name} style={{ width: `${Number(d.pct)}%`, background: d.color }} />
              ))}
            </div>
            <div className="nv-leg" style={{ marginBottom: 10 }}>
              {SOCIAL_DIST.map((d) => (
                <span key={d.name}>
                  <span className="d" style={{ background: d.color }} />
                  {d.name} {Number(d.pct)}%
                </span>
              ))}
            </div>

            <div className="p-row">
              <div className="txt">
                <div className="k">概率分布（整体结构化保存）</div>
                <div className="s">当前合计 {SOCIAL_DIST.reduce((sum, item) => sum + Number(item.pct), 0)}%；不会为了凑满 100% 静默调整其他类别。</div>
              </div>
              <span className={`bdg ${SOCIAL_DIST.reduce((sum, item) => sum + Number(item.pct), 0) === 100 ? "ok" : "danger"}`}>
                {SOCIAL_DIST.reduce((sum, item) => sum + Number(item.pct), 0) === 100 ? "合计正确" : "配置无效"}
              </span>
            </div>

            <div className="itint" style={{ marginTop: 10 }}>
              <b>真实性边界</b> · 提现、等级、Genesis 与新增用户只从业务表同步；完整用户 ID、订单号、地址和交易哈希不会返回管理端。AI 客户消费在真实计费来源接入前不会进入线上抽样。
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "12px 0 8px" }}>
              <select className="fld" style={{ width: 190 }} value={eventTypeFilter} onChange={(event) => { setEventTypeFilter(event.target.value); setEventPage(1); }} aria-label="事件类型筛选">
                <option value="">全部事件类型</option>
                {SOCIAL_EVENT_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              <select className="fld" style={{ width: 160 }} value={eventStatusFilter} onChange={(event) => { setEventStatusFilter(event.target.value); setEventPage(1); }} aria-label="事件状态筛选">
                <option value="">全部状态</option>
                {SOCIAL_EVENT_STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              {(eventTypeFilter || eventStatusFilter) && <button className="l-btn sm" onClick={() => { setEventTypeFilter(""); setEventStatusFilter(""); setEventPage(1); }}>清除筛选</button>}
            </div>

            <div className="k" style={{ marginBottom: 8 }}>真实事件明细</div>
            {eventLoading ? (
              <div className="itint">正在读取真实事件...</div>
            ) : eventTotal === 0 && !eventTypeFilter && !eventStatusFilter ? (
              <div className="itint warn"><b>当前没有可投放的真实事件</b> · social 通道不会发送，系统不会生成虚假占位内容。等待真实业务数据产生后点击“同步真实事件”。</div>
            ) : eventTotal === 0 ? (
              <div className="itint">当前筛选条件下没有事件，请清除筛选后重试。</div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="l-tbl" style={{ minWidth: 1120 }}>
                  <thead><tr><th>脱敏展示</th><th>事件类型</th><th>来源系统</th><th>来源事件ID</th><th>发生时间</th><th>到期时间</th><th>状态</th><th>投递</th><th style={{ textAlign: "right" }}>操作</th></tr></thead>
                  <tbody>
                    {visibleSocialEvents.map((event) => (
                      <tr key={event.id}>
                        <td><b>{[event.actorDisplay, event.cityDisplay, event.amountDisplay].filter(Boolean).join(" · ") || "聚合事件"}</b><div className="muted tiny">{event.sourceNote || "来源已核验"}</div></td>
                        <td>{event.eventTypeLabel || optionLabel(SOCIAL_EVENT_TYPE_OPTIONS, event.eventType)}</td>
                        <td><span className="bdg ok">已验证</span><div className="muted tiny">{event.sourceSystem || "业务系统"}</div></td>
                        <td><span className="mono">{event.sourceEventId || "已脱敏"}</span></td>
                        <td>{formatEventTime(event.occurredAt)}</td>
                        <td>{formatEventTime(event.expiresAt)}</td>
                        <td><span className={`bdg ${event.status === "ACTIVE" ? "ok" : event.status === "EXPIRED" ? "warn" : "dim"}`}>{statusLabel(event.status)}</span></td>
                        <td>{event.dispatchCount ?? 0} 次</td>
                        <td><div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                          {canWriteI2 && event.status === "ACTIVE" && <button className="l-btn sm" disabled={eventBusy !== null} onClick={() => changeSocialEventStatus(event, "DISABLED")}>停用</button>}
                          {canWriteI2 && event.status === "DISABLED" && canRestoreEvent(event.expiresAt) && <button className="l-btn sm mc" disabled={eventBusy !== null} onClick={() => changeSocialEventStatus(event, "ACTIVE")}>恢复</button>}
                          {canWriteI2 && event.status === "DISABLED" && !canRestoreEvent(event.expiresAt) && <span className="muted tiny">已到期不可恢复</span>}
                          {canWriteI2 && event.status !== "EXPIRED" && <button className="l-btn sm" disabled={eventBusy !== null} onClick={() => changeSocialEventStatus(event, "EXPIRED")}>立即过期</button>}
                          {canWriteI2 && <button className="l-btn sm danger" disabled={eventBusy !== null} onClick={() => deleteSocialEvent(event)}>删除</button>}
                        </div></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {eventTotal > EVENT_PAGE_SIZE && (
              <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8, marginTop: 10 }}>
                <button className="l-btn sm" disabled={eventPage <= 1} onClick={() => setEventPage((page) => Math.max(1, page - 1))}>上一页</button>
                <span className="muted tiny">第 {eventPage} / {eventPageCount} 页 · 共 {eventTotal} 条</span>
                <button className="l-btn sm" disabled={eventPage >= eventPageCount} onClick={() => setEventPage((page) => Math.min(eventPageCount, page + 1))}>下一页</button>
              </div>
            )}

            <div className="itint" style={{ marginTop: 10 }}>
              <b>运行时规则</b> · 只从“有效、已验证、未过期”的事件中按权重抽样；来源事件重复会被唯一键拦截；没有有效真实事件时不推送。
            </div>
          </div>
        </section>
      </div>

      <p className="f-foot">
        <b>执行门槛</b>:节奏调整 = 内容或增长执行门槛:内容主管/超管;<b>频道停推</b> = 内容或<b>风控</b>可提交,内容主管/超管执行;模板与事件池发布 = 内容执行门槛:内容主管。
        <b>事件去向</b>:送达 / 点击都是已登记事件(nova 域,无需扩展),点击率口径只认服务器发的送达事件;各频道点击率与召回贡献喂数据 BI(L 域),推送拉回访间接喂 Day7 留存。
        <b>直播代答模式</b>期间 AI 自动推送全静默,服务端同样拦,不止前端。
      </p>
      <PaginationExemptionList
        items={[
          {
            label: "可调通道节奏表",
            kind: "reference-catalog",
            maxRows: 10,
            reason: "首屏同屏校验通道的检查间隔与个人冷却时间",
          },
          {
            label: "不在 10 频道里的推送(口径闭合)",
            maxRows: 3,
            reason: "三类不可调频道只做口径闭合说明",
          },
          {
            label: "推送模板池(b)",
            kind: "sample-ledger",
            maxRows: 7,
            reason: "模板池当前七条种子样本,发布和归档走操作确认",
          },
        ]}
      />

      {distDrawer && (
        <Drawer
          title="编辑真实事件概率分布"
          sub="一次提交全部事件类型；系统不会隐式修改任何其他类别"
          onClose={() => setDistDrawer(false)}
          footer={
            <>
              <button className="l-btn" style={{ flex: 1, justifyContent: "center" }} onClick={() => setDistDrawer(false)}>取消</button>
              <button className="l-btn primary" style={{ flex: 1, justifyContent: "center" }} disabled={!distDraftValid} onClick={submitDistribution}>保存概率</button>
            </>
          }
        >
          <div className="col" style={{ gap: 12 }}>
            {SOCIAL_DIST.map((item) => (
              <label key={item.key} className="col" style={{ gap: 5 }}>
                <span className="muted tiny">{item.name}</span>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 64px", gap: 8, alignItems: "center" }}>
                  <input
                    className="fld"
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    value={distDraft[item.key] ?? ""}
                    onChange={(event) => setDistDraft({ ...distDraft, [item.key]: event.target.value })}
                  />
                  <span className="muted">%</span>
                </div>
              </label>
            ))}
            <div className={`itint ${distDraftValid ? "" : "danger"}`}>
              <b>当前合计：{distDraftTotal}%</b> · {distDraftValid ? "可以保存" : "每项必须是 0～100 的整数，且总和为 100%"}
            </div>
          </div>
        </Drawer>
      )}

      {/* 新增 / 编辑通道 Drawer(复用) */}
      {novaDrawer && (
        <Drawer
          title={editNovaKey ? "编辑 Nova 推送通道" : "新增 Nova 推送通道"}
          sub="系统按检查间隔扫描；仅向满足业务触发条件且已过个人冷却时间的用户推送"
          onClose={closeDrawer}
          footer={
            <>
              <button className="l-btn" style={{ flex: 1, justifyContent: "center" }} onClick={closeDrawer}>取消</button>
              <button
                className="l-btn primary"
                style={{ flex: 1, justifyContent: "center" }}
                disabled={!form.name.trim() || cadenceError !== null || (!editNovaKey && !form.runtimeSource)}
                onClick={submitDrawer}
              >
                {editNovaKey ? "保存" : "提交"}
              </button>
            </>
          }
        >
          <div className="col" style={{ gap: 12 }}>
            <div className="itint">
              <b>触发方式：周期扫描</b> · 检查间隔只决定多久扫描一次；具体给谁推送由该通道的业务规则判断。
            </div>
            <label className="col" style={{ gap: 5 }}>
              <span className="muted tiny">通道名称</span>
              <input
                className="fld"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="例如：每周回顾"
              />
            </label>
            <label className="col" style={{ gap: 5 }}>
              <span className="muted tiny">服务端真实事实源</span>
              <select
                className="fld"
                value={form.runtimeSource}
                disabled={!!editNovaKey && !form.runtimeSource}
                onChange={(e) => setForm({ ...form, runtimeSource: e.target.value })}
              >
                <option value="">请选择受控事实源</option>
                {RUNTIME_SOURCE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              <span className="muted tiny">仅可选择服务端 A4 事实；客户端不能输入或伪造事件名。</span>
            </label>
            <label className="col" style={{ gap: 5 }}>
              <span className="muted tiny">检查间隔（多久执行一次扫描）</span>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 112px", gap: 8 }}>
                <input
                  className="fld"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  step={1}
                  value={form.tickValue}
                  onChange={(e) => setForm({ ...form, tickValue: e.target.value })}
                  placeholder="输入正整数"
                  aria-label="检查间隔数值"
                />
                <select
                  className="fld"
                  value={form.tickUnit}
                  onChange={(e) => setForm({ ...form, tickUnit: e.target.value as NovaTimeUnit })}
                  aria-label="检查间隔单位"
                >
                  {NOVA_TIME_UNITS.map((unit) => <option key={unit.value} value={unit.value}>{unit.label}</option>)}
                </select>
              </div>
              <span className="muted tiny">只控制系统多久检查一次，不包含触发条件。</span>
            </label>
            <label className="col" style={{ gap: 5 }}>
              <span className="muted tiny">同一用户最短推送间隔</span>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 112px", gap: 8 }}>
                <input
                  className="fld"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  step={1}
                  value={form.cooldownValue}
                  onChange={(e) => setForm({ ...form, cooldownValue: e.target.value })}
                  placeholder="输入正整数"
                  aria-label="同一用户最短推送间隔数值"
                />
                <select
                  className="fld"
                  value={form.cooldownUnit}
                  onChange={(e) => setForm({ ...form, cooldownUnit: e.target.value as NovaTimeUnit })}
                  aria-label="同一用户最短推送间隔单位"
                >
                  {NOVA_TIME_UNITS.map((unit) => <option key={unit.value} value={unit.value}>{unit.label}</option>)}
                </select>
              </div>
              <span className="muted tiny">同一用户收到本通道消息后，在此时间内不会再次收到。</span>
            </label>
            {(form.tickValue || form.cooldownValue) && cadenceError && <div className="itint danger">{cadenceError}</div>}
            <div className="itint"><b>CTR 无需填写</b> · 新通道从 0% 开始，产生真实投递与点击后由系统自动统计。</div>
            {!editNovaKey && <div className="itint warn"><b>新增后默认停用</b> · 请先在模板池填写并发布中越文模板，再开启通道。</div>}
          </div>
        </Drawer>
      )}
      {tplDrawer && (
        <Drawer
          title={editTplChannel ? "编辑 Nova 推送模板" : "新增 Nova 推送模板"}
          sub="模板正文由 Nova 直接用于实际推送；中文、越南语必填，英语可选"
          onClose={closeTplDrawer}
          footer={
            <>
              <button className="l-btn" style={{ flex: 1, justifyContent: "center" }} onClick={closeTplDrawer}>取消</button>
              <button
                className="l-btn primary"
                style={{ flex: 1, justifyContent: "center" }}
                disabled={!tplForm.channel || !tplForm.name.trim() || !tplForm.cta || !tplForm.version.trim()
                  || !tplForm.titleZh.trim() || !tplForm.bodyZh.trim() || !tplForm.titleVi.trim() || !tplForm.bodyVi.trim()
                  || (!!tplForm.titleEn.trim() !== !!tplForm.bodyEn.trim())}
                onClick={submitTpl}
              >保存草稿</button>
            </>
          }
        >
          <div className="col" style={{ gap: 12 }}>
            <div className="itint"><b>生效条件</b> · 保存后仍是草稿；内容主管发布成功后，通道才允许开启。各语言的 <span className="mono">{"{变量}"}</span> 必须完全一致。</div>
            <label className="col" style={{ gap: 5 }}>
              <span className="muted tiny">推送通道（来自通道列表）</span>
              <select className="fld" value={tplForm.channel} disabled={!!editTplChannel}
                onChange={(e) => setTplForm({ ...tplForm, channel: e.target.value })}>
                <option value="">请选择通道</option>
                {novas.filter((n) => editTplChannel === n.key || !NOVA_TPLS.some((t) => t.ch === n.key))
                  .map((n) => <option key={n.key} value={n.key}>{n.name}（{n.key}）</option>)}
              </select>
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 120px", gap: 8 }}>
              <label className="col" style={{ gap: 5 }}><span className="muted tiny">模板名称</span>
                <input className="fld" value={tplForm.name} onChange={(e) => setTplForm({ ...tplForm, name: e.target.value })} placeholder="例如：每周回顾提醒" /></label>
              <label className="col" style={{ gap: 5 }}><span className="muted tiny">版本号</span>
                <input className="fld" value={tplForm.version} onChange={(e) => setTplForm({ ...tplForm, version: e.target.value })} placeholder="v1" /></label>
            </div>
            <label className="col" style={{ gap: 5 }}><span className="muted tiny">CTA 去向（来自后端路由目录）</span>
              <select className="fld" value={tplForm.cta} onChange={(e) => setTplForm({ ...tplForm, cta: e.target.value })}>
                <option value="">请选择投放去向</option>
                {CTA_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}（{option.value}）</option>)}
              </select></label>
            {(["Zh", "Vi", "En"] as const).map((locale) => {
              const label = locale === "Zh" ? "中文" : locale === "Vi" ? "越南语" : "英语（可选）";
              const titleKey = `title${locale}` as const;
              const bodyKey = `body${locale}` as const;
              return <div className="col" style={{ gap: 6 }} key={locale}>
                <b style={{ fontSize: 12 }}>{label}</b>
                <input className="fld" value={tplForm[titleKey]}
                  onChange={(e) => setTplForm({ ...tplForm, [titleKey]: e.target.value })} placeholder={`${label}标题`} />
                <textarea className="fld" rows={3} value={tplForm[bodyKey]}
                  onChange={(e) => setTplForm({ ...tplForm, [bodyKey]: e.target.value })} placeholder={`${label}正文，例如：你有 {amount} NEX 待领取`} />
              </div>;
            })}
            {!!tplForm.titleEn.trim() !== !!tplForm.bodyEn.trim() && <div className="itint danger">英语标题和正文必须同时填写，或同时留空。</div>}
          </div>
        </Drawer>
      )}
    </>
  );
}

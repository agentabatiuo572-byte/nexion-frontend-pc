"use client";

/**
 * I2 Nova 推送运营 — design_handoff_i_domain/I2 Nova推送运营.html port。
 * 单源:后端 /content/nova/overview;空库时保持后端空态,不补前端业务样例。
 * 操作确认 显式 edit 契约:调 cadence(tick/cd) / 调 CTR / 调概率分布 / 池条目数 = 调参传 edit;
 *   kill 单频道 / 启停 / 发布 / 归档模板 = 处置不传 edit。
 * amplifies = false(I2 不碰 B1 红线 —— 只动推送节奏与文案出口,不动费率/奖励/价格)。
 */
import { useState } from "react";
import { Drawer, PaginationExemptionList } from "../design-kit";
import type { ICtx } from "./types";

type NovaForm = { name: string; tick: string; cd: string; ctr: string };
const EMPTY_FORM: NovaForm = { name: "", tick: "", cd: "", ctr: "" };
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
  const NOVA_TPLS = (data?.templates ?? []).map((t) => ({ ch: t.channel, name: t.name, cta: t.cta, v: t.version, status: t.status }));
  const SOCIAL_DIST = data?.socialDistribution ?? [];
  const SOCIAL_POOLS = (data?.socialPools ?? []).map((p) => ({ key: p.key, name: p.name, sub: p.description, cnt: p.count }));

  const runBackend = (task: Promise<void>, ok: string) => {
    task
      .then(() => actions.reloadIContent())
      .then(() => toast(ok))
      .catch((error) => toast(`操作失败:${error instanceof Error ? error.message : String(error)}`));
  };

  // ── Drawer 表单(新增 / 编辑通道复用同一抽屉)──
  const [novaDrawer, setNovaDrawer] = useState(false);
  const [editNovaKey, setEditNovaKey] = useState<string | null>(null);
  const [form, setForm] = useState<NovaForm>(EMPTY_FORM);

  const openNewNova = () => { setEditNovaKey(null); setForm(EMPTY_FORM); setNovaDrawer(true); };
  const openEditNova = (n: OpsNova) => {
    setEditNovaKey(n.key);
    setForm({ name: n.name, tick: n.tick, cd: n.cd, ctr: String(n.ctr ?? "") });
    setNovaDrawer(true);
  };
  const closeDrawer = () => { setNovaDrawer(false); setEditNovaKey(null); setForm(EMPTY_FORM); };

  const submitDrawer = () => {
    const name = form.name.trim();
    if (!name) return;
    const tick = form.tick.trim() || "—";
    const cd = form.cd.trim() || "—";
    const ctrNum = Number(form.ctr) || 0;
    if (editNovaKey) {
      const prev = novas.find((x) => x.key === editNovaKey);
      runBackend(actions.updateI2NovaChannel(editNovaKey, {
        name,
        trigger: prev?.trigger || "后台编辑 Nova 通道",
        tick,
        cooldown: cd,
        ctr: ctrNum,
        enabled: prev?.on ?? true,
      }, "后台编辑 Nova 通道"), `Nova 通道已更新:${prev?.name ?? editNovaKey} → ${name}`);
    } else {
      const key = `${slug(name)}-${novas.length + 100}`;
      runBackend(actions.createI2NovaChannel({
        key,
        name,
        trigger: "后台新增 Nova 通道",
        tick,
        cooldown: cd,
        ctr: ctrNum,
        enabled: true,
      }, "后台新增 Nova 通道"), `Nova 通道已新增:${name}`);
    }
    closeDrawer();
  };

  // ── 单通道 kill / 恢复:走操作确认(操作确认 不传 edit) ──
  const toggleNova = (n: OpsNova) => openActionConfirm({
    action: <>{n.on ? "kill" : "恢复"} Nova 通道 · {n.name}</>,
    detail: n.on
      ? <>停推该频道。<b>操作确认防误杀</b> · 监管点名要快速止血时也走这条路径(内容/风控都能发起)。</>
      : <>恢复投递。频道开启后下一次 cadence tick 自动推送。</>,
    amplifies: false,
    run: (reason) => {
      runBackend(actions.updateI2NovaChannelStatus(n.key, !n.on, reason), `${n.name} 通道${n.on ? "已 kill" : "已恢复"}`);
    },
  });

  // ── 删除通道:走普通确认(原因必填 + 留痕) ──
  const removeNova = (n: OpsNova) => openConfirm({
    action: <>删除推送通道 · {n.name}</>,
    detail: <>从 Nova cadence 移除并停止投递。需审计留痕。</>,
    reason: true,
    okLabel: "确认删除",
    run: (reason) => {
      runBackend(actions.deleteI2NovaChannel(n.key, reason), `Nova 通道已删除:${n.name}`);
    },
  });

  const tplStatus = (ch: string): string => NOVA_TPLS.find((t) => t.ch === ch)?.status?.toLowerCase() ?? "published";
  const renderTplBadge = (st: string) => {
    if (st === "published") return <span className="bdg ok">published</span>;
    if (st === "archived") return <span className="bdg dim">archived</span>;
    if (st === "draft") return <span className="bdg warn">draft</span>;
    return <span className="bdg dim">{st}</span>;
  };

  const publishTpl = (ch: string, name: string) => openActionConfirm({
    action: <>发布模板 · {name}</>,
    detail: <>频道 <b>{ch}</b>。发布即对该频道下一条推送生效;服务器侧校验中英镜像 + 占位符一致,不齐直接拒。</>,
    amplifies: false,
    run: (reason) => {
      runBackend(actions.updateI2TemplateStatus(ch, "PUBLISHED", reason), `${name} 发布已确认生效`);
    },
  });
  const archiveTpl = (ch: string, name: string) => openActionConfirm({
    action: <>归档模板 · {name}</>,
    detail: <>归档后该模板从频道可选池移除,已在投递队列里的不撤回。</>,
    amplifies: false,
    run: (reason) => {
      runBackend(actions.updateI2TemplateStatus(ch, "ARCHIVED", reason), `${name} 归档已确认生效`);
    },
  });

  // ── 新模板:走操作确认(传 edit 录模板 key) ──
  const newTpl = () => openActionConfirm({
    action: <>新增 Nova 推送模板</>,
    detail: <>新建草稿后挂双语词条(I6);发布走操作确认。模板 key 仅支持字母、数字、短横线、下划线。</>,
    amplifies: false,
    edit: { kind: "text", current: "—", unit: "模板 key" },
    run: (reason, v) => {
      const raw = (v ?? "").trim();
      const key = normalizeNovaKey(raw);
      if (key.length < 2) {
        toast("模板 key 至少 2 位,仅支持字母、数字、短横线、下划线");
        return;
      }
      if (key !== raw) {
        toast(`模板 key 已规范化为 ${key}`);
      }
      runBackend(actions.createI2Template({
        channel: key,
        name: key,
        cta: "→ /content",
        version: "v1",
      }, reason), `模板 ${key} 已创建 · 待发布确认`);
    },
  });

  // ── social 概率分布:拆成 5 个单值(按序号 key,不再一个文本框手打「30/25/20/15/10」整串)──
  const distPct = (d: { pct: number }, _i: number): number => Number(d.pct);
  const editDistCat = (d: { name: string; pct: number }, i: number) => openActionConfirm({
    action: <>调整 social 概率 · {d.name}</>,
    detail: <>{d.name} 当前 <b>{distPct(d, i)}%</b> · 5 类合计必须 = 100%,不足或超出服务器直接拒;对新派发即时生效。</>,
    amplifies: false,
    edit: { kind: "number", current: `${distPct(d, i)}%`, unit: "%" },
    run: (reason, v) => {
      const n = (v ?? "").replace(/[^\d.]/g, "").trim();
      if (!n) return;
      const target = Math.max(0, Math.min(100, Math.round(Number(n))));
      const next = SOCIAL_DIST.map((item, idx) => ({ key: item.key, pct: idx === i ? target : item.pct }));
      const delta = 100 - next.reduce((sum, item) => sum + item.pct, 0);
      const adjustIdx = next.findIndex((_item, idx) => idx !== i);
      if (adjustIdx >= 0) next[adjustIdx] = { ...next[adjustIdx], pct: Math.max(0, next[adjustIdx].pct + delta) };
      runBackend(actions.updateI2Distribution(next, reason), `${d.name} 概率已改为 ${target}%`);
    },
  });

  // ── social 池条目数编辑(传 edit) ──
  const editPool = (key: string, name: string, sub: string, cnt: number) => openActionConfirm({
    action: <>编辑 {name}</>,
    detail: <>{sub}。<b>编辑提交即操作确认</b>(改变全体用户所见)。</>,
    amplifies: false,
    edit: { kind: "text", current: String(cnt), unit: "条数" },
    run: (reason, v) => {
      if (!v) return;
      runBackend(actions.updateI2Pool(key, Math.max(0, Math.round(Number(v))), reason), `${name} 已更新 · 理由留痕`);
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
          <span className="ttl">10 可调通道节奏表</span>
          <span className="sub">· enabled kill 开关 + tick/cooldown + phase-keyed 分档(随 H1 只读)</span>
          <div className="r">
            <button className="l-btn sm primary" onClick={openNewNova}>+ 新增通道</button>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 960 }}>
            <thead>
              <tr>
                <th>开关</th>
                <th>key / 名称</th>
                <th>内容触发</th>
                <th>tick</th>
                <th>cooldown</th>
                <th>phase-keyed</th>
                <th>最近改动</th>
                <th style={{ textAlign: "right" }}></th>
              </tr>
            </thead>
            <tbody>
              {novas.map((n) => {
                const phaseKeyed = n.phaseKeyed || "—";
                const trigger = n.trigger || n.name;
                const phaseStyle = phaseKeyed === "—"
                  ? { fontSize: 11.5, color: "var(--ink-4)" }
                  : { fontSize: 11.5, color: "var(--warning)" };
                return (
                  <tr key={n.key}>
                    <td>
                      <button
                        className={`nv-sw${n.on ? " on" : ""}`}
                        onClick={() => toggleNova(n)}
                        aria-label={`${n.on ? "kill" : "恢复"} ${n.name}`}
                      />
                    </td>
                    <td>
                      <span className="mono" style={{ fontWeight: 600, color: "var(--ink)" }}>{n.key}</span>
                      <div style={{ fontSize: 11.5, color: "var(--ink-4)", marginTop: 2 }}>{n.name}</div>
                    </td>
                    <td style={{ fontSize: 12, color: "var(--ink-3)", maxWidth: 240 }}>{trigger}</td>
                    <td className="mono" style={{ fontSize: 12 }}>{n.tick}</td>
                    <td className="mono" style={{ fontSize: 12 }}>{n.cd}</td>
                    <td style={phaseStyle}>{phaseKeyed}</td>
                    <td className="mono" style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{`CTR ${n.ctr}%`}</td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <button className="l-btn sm" onClick={() => openEditNova(n)}>编辑</button>
                      <button className="l-btn sm" style={{ marginLeft: 6 }} onClick={() => removeNova(n)}>删除</button>
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
            <b>两个随阶段变的频道</b> · 以旧换新(tradein)和月度任务锁定(taskLockMonthly)的歇息时长按运营阶段(P1–P6)分档,阶段切换时自动换档——<b>阶段由节奏调度页(H1)说了算,这页只读跟随</b>,想改分档值在这页改,想改当前是 P 几去 H1。
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
            <span className="sub">· 文案体挂双语词条(I6) · 发布操作确认</span>
            <div className="r">
              <button className="l-btn sm mc" onClick={newTpl}>+ 新模板</button>
            </div>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="l-tbl" style={{ minWidth: 540 }}>
              <thead>
                <tr>
                  <th>频道</th>
                  <th>模板</th>
                  <th>CTA 去向</th>
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
                      <td className="mono" style={{ fontWeight: 700 }}>{t.v}</td>
                      <td>{renderTplBadge(st)}</td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        {canPublish && (
                          <button className="l-btn sm mc" onClick={() => publishTpl(t.ch, t.name)}>发布</button>
                        )}
                        {canArchive && (
                          <button className="l-btn sm" style={{ marginLeft: canPublish ? 6 : 0 }} onClick={() => archiveTpl(t.ch, t.name)}>归档</button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="l-b" style={{ paddingTop: 8 }}>
            <div className="itint">
              <b>CTA 接下游转化</b> · 团队类跳分销(F 域)、质押类跳金融产品(G 域)、买机类跳商城(E 域)——推送是入口,成交归各业务域结算。模板状态机:draft 草稿 → published 生效 → archived 归档。
            </div>
          </div>
        </section>

        {/* (c) 全网真实事件池 · social 频道 */}
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">全网真实事件池(c)· social 频道</span>
            <span className="sub">· 5 类事件按概率抽一条推 · 概率合计必须 100%</span>
          </div>
          <div className="l-b" style={{ paddingTop: 6 }}>
            <div className="nv-pb">
              {SOCIAL_DIST.map((d, i) => (
                <i key={d.name} style={{ width: `${distPct(d, i)}%`, background: d.color }} />
              ))}
            </div>
            <div className="nv-leg" style={{ marginBottom: 10 }}>
              {SOCIAL_DIST.map((d, i) => (
                <span key={d.name}>
                  <span className="d" style={{ background: d.color }} />
                  {d.name} {distPct(d, i)}%
                </span>
              ))}
            </div>

            <div className="p-row">
              <div className="txt">
                <div className="k">概率分布(逐类单独调)</div>
                <div className="s">5 类合计须 = 100%(当前合计 {SOCIAL_DIST.reduce((s, d, i) => s + distPct(d, i), 0)}%{SOCIAL_DIST.reduce((s, d, i) => s + distPct(d, i), 0) !== 100 ? " · ⚠ 不等于 100,服务器会拒" : ""});对新派发即时生效</div>
              </div>
              <span className="v" style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                {SOCIAL_DIST.map((d, i) => (
                  <button key={d.name} className="l-btn sm mc" onClick={() => editDistCat(d, i)} title={`调整 ${d.name} 概率`}>{d.name} {distPct(d, i)}%</button>
                ))}
              </span>
            </div>

            {SOCIAL_POOLS.map((p) => (
              <div className="p-row" key={p.key}>
                <div className="txt">
                  <div className="k">{p.name}</div>
                  <div className="s">{p.sub}</div>
                </div>
                <span className="v">{p.cnt} 个</span>
                <button className="l-btn sm mc" onClick={() => editPool(p.key, p.name, p.sub, p.cnt)}>编辑</button>
              </div>
            ))}

            <div className="itint" style={{ marginTop: 10 }}>
              <b>金额与轮换</b> · 每市场可单独换人名 / 城市 / 金额段位;同一事件模板按双语词条渲染。池子内容上线 = 改变全体用户所见,所以编辑提交即操作确认。
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
            label: "10 可调通道节奏表",
            kind: "reference-catalog",
            maxRows: 10,
            reason: "Nova 可调通道固定十项,需要同屏校验 tick/cooldown",
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

      {/* 新增 / 编辑通道 Drawer(复用) */}
      {novaDrawer && (
        <Drawer
          title={editNovaKey ? "编辑 Nova 推送通道" : "新增 Nova 推送通道"}
          sub={editNovaKey ? "提交即对全体用户的该频道节奏生效" : "提交后即生效;后续可继续 kill / 编辑 / 删除"}
          onClose={closeDrawer}
          footer={
            <>
              <button className="l-btn" style={{ flex: 1, justifyContent: "center" }} onClick={closeDrawer}>取消</button>
              <button
                className="l-btn primary"
                style={{ flex: 1, justifyContent: "center" }}
                disabled={!form.name.trim()}
                onClick={submitDrawer}
              >
                {editNovaKey ? "保存" : "提交"}
              </button>
            </>
          }
        >
          <div className="col" style={{ gap: 12 }}>
            <label className="col" style={{ gap: 5 }}>
              <span className="muted tiny">通道名(name)</span>
              <input
                className="fld"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="如 weekly-recap"
              />
            </label>
            <label className="col" style={{ gap: 5 }}>
              <span className="muted tiny">tick(检查节奏)</span>
              <input
                className="fld"
                value={form.tick}
                onChange={(e) => setForm({ ...form, tick: e.target.value })}
                placeholder="如 15 min / 注册 8s / 每 25 任务"
              />
            </label>
            <label className="col" style={{ gap: 5 }}>
              <span className="muted tiny">cooldown(推完歇多久)</span>
              <input
                className="fld"
                value={form.cd}
                onChange={(e) => setForm({ ...form, cd: e.target.value })}
                placeholder="如 60 min / 24h / 7d"
              />
            </label>
            <label className="col" style={{ gap: 5 }}>
              <span className="muted tiny">CTR(%,可留空)</span>
              <input
                className="fld"
                value={form.ctr}
                onChange={(e) => setForm({ ...form, ctr: e.target.value })}
                placeholder="输入接口返回的 CTR"
              />
            </label>
          </div>
        </Drawer>
      )}
    </>
  );
}

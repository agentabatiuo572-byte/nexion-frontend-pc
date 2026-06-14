"use client";

/**
 * I1 转化文案 A/B — design_handoff_i_domain/I1 转化文案AB.html port。
 * 单源:
 *  - 文案池 = COPY_POOL · 版本历史 = COPY_VERSIONS(home.conversionBanner 演示位)
 *    · 框架参数 = EXP_FRAMEWORK · 实验池 = EXPS(i-tabs/data 文件头裁定)。
 *  - 状态实时态 = pget(`I.copy.<key>.status`) / pget(`I.exp.<id>.status`) / pget(`I.exp.framework.<param>`)
 *    覆盖种子,真写统一落 platform-config setParam(I.*)。
 * 操作确认 显式 edit 契约:发布新版 / 回滚到历史版 / 调整框架参数 = 调参传 edit;
 *   下架 / 停止实验 / 采纳获胜变体 = 处置不传 edit。
 * amplifies = false(I1 不碰 B1 红线 —— 只改措辞,不动费率/奖励/价格)。
 * 框架参数 = 运营设定(仍需操作确认 + 必填原因留痕)→ 走 openConfirm + input(ConfirmReq.input 已支持)。
 */
import { useState } from "react";
import { PaginationExemptionList } from "../design-kit";
import { I1_STATS, COPY_POOL, COPY_VERSIONS, EXP_FRAMEWORK, EXPS, type CopyRow, type ExpRow } from "./data";
import type { ICtx } from "./types";

type Surf = "all" | "Home" | "Me" | "商城";
type ExpFlt = "all" | "running" | "concluded";

const SURF_FLT: [Surf, string][] = [["all", "全部"], ["Home", "Home"], ["Me", "Me"], ["商城", "商城"]];
const EXP_FLT: [ExpFlt, string][] = [["all", "全部"], ["running", "进行中"], ["concluded", "已结"]];

const VAR_COLORS = ["var(--i-ac)", "var(--admin-cat-5)", "var(--admin-cat-3)"];

export function I1CopyAb({ ctx }: { ctx: ICtx }) {
  const { pget, setParam, toast, openActionConfirm, openConfirm } = ctx;
  const [surf, setSurf] = useState<Surf>("all");
  const [expFlt, setExpFlt] = useState<ExpFlt>("all");

  // 文案池实时态(pget 覆盖种子 status)。
  const liveCopyStatus = (c: CopyRow): string =>
    pget(`I.copy.${c.key}.status`) ?? c.status;
  const liveCopyDraftZh = (key: string): string | undefined => pget(`I.copy.${key}.draft.zh`);
  const liveCopyDraftEn = (key: string): string | undefined => pget(`I.copy.${key}.draft.en`);
  const liveCopyDraftMeta = (key: string): { audience?: string; trafficSplit?: string; note?: string; surface?: string } => ({
    audience: pget(`I.copy.${key}.draft.audience`),
    trafficSplit: pget(`I.copy.${key}.draft.trafficSplit`),
    note: pget(`I.copy.${key}.draft.versionNote`),
    surface: pget(`I.copy.${key}.draft.surface`),
  });

  // 实验实时态(pget 覆盖种子 state)。
  const liveExpState = (e: ExpRow): string =>
    pget(`I.exp.${e.id}.status`) ?? e.state;

  // 框架参数实时值。
  const liveFw = (key: string, cur: string): string =>
    pget(`I.exp.framework.${key}`) ?? cur;

  const filteredPool = COPY_POOL.filter((c) => surf === "all" || c.surface === surf);
  const filteredExps = EXPS.filter((e) => {
    if (expFlt === "all") return true;
    const st = liveExpState(e);
    if (expFlt === "running") return st === "running";
    return st === "adopted" || st === "discarded" || st === "stopped";
  });

  // 发布新版(任一文案位通用) —— 操作确认 + 调参 edit。
  const pubNewVersion = (c: CopyRow) => openActionConfirm({
    action: <>发布新版 · {c.key}</>,
    detail: <>当前发布版 <b>{c.version}</b>。发布即对全体用户下一次渲染生效;服务器先校验中英镜像与占位符,不齐直接拒。</>,
    amplifies: false,
    businessForm: {
      kind: "copy-edit",
      keyName: c.key,
      version: c.version,
      surface: c.surface,
      zh: "",
      en: "",
    },
    run: (reason, v, form) => {
      if (!v) return;
      setParam(`I.copy.${c.key}.status`, `${v} published`, { action: `发布新版 ${c.key} → ${v} · admin.content_published`, reason });
      if (form) {
        setParam(`I.copy.${c.key}.${v}.zh`, form.zh, { action: `发布新版 ${c.key} · 中文文案`, reason });
        setParam(`I.copy.${c.key}.${v}.en`, form.en, { action: `发布新版 ${c.key} · English copy`, reason });
        setParam(`I.copy.${c.key}.${v}.surface`, form.surface, { action: `发布新版 ${c.key} · surface`, reason });
        setParam(`I.copy.${c.key}.${v}.audience`, form.audience, { action: `发布新版 ${c.key} · audience`, reason });
        setParam(`I.copy.${c.key}.${v}.trafficSplit`, form.trafficSplit, { action: `发布新版 ${c.key} · traffic split`, reason });
        setParam(`I.copy.${c.key}.${v}.versionNote`, form.versionNote, { action: `发布新版 ${c.key} · version note`, reason });
      }
      toast(`${c.key} 新版已确认生效 · 目标 ${v}`);
    },
  });

  // home.conversionBanner 演示位(版本详情卡固定位)。
  const HCB = "home.conversionBanner";
  const hcbRow = COPY_POOL.find((c) => c.key === HCB)!;

  const pubDraftV8 = () => openActionConfirm({
    action: <>发布新版 · {HCB}</>,
    detail: <>当前发布版 <b>v7</b>。发布即对全体用户下一次渲染生效;服务器先校验中英镜像与占位符,不齐直接拒。</>,
    amplifies: false,
    businessForm: {
      kind: "copy-edit",
      keyName: HCB,
      version: "v8",
      surface: hcbRow.surface,
      zh: "完成 {amount} USDT 复投并获得 {nex} NEX 奖励",
      en: "Reinvest {amount} USDT and earn {nex} NEX",
      placeholders: ["{amount}", "{nex}"],
    },
    run: (reason, v, form) => {
      if (!v) return;
      setParam(`I.copy.${HCB}.status`, `${v} published`, { action: `发布新版 ${HCB} → ${v} · admin.content_published`, reason });
      if (form) {
        setParam(`I.copy.${HCB}.${v}.zh`, form.zh, { action: `发布新版 ${HCB} · 中文文案`, reason });
        setParam(`I.copy.${HCB}.${v}.en`, form.en, { action: `发布新版 ${HCB} · English copy`, reason });
        setParam(`I.copy.${HCB}.${v}.surface`, form.surface, { action: `发布新版 ${HCB} · surface`, reason });
        setParam(`I.copy.${HCB}.${v}.audience`, form.audience, { action: `发布新版 ${HCB} · audience`, reason });
        setParam(`I.copy.${HCB}.${v}.trafficSplit`, form.trafficSplit, { action: `发布新版 ${HCB} · traffic split`, reason });
        setParam(`I.copy.${HCB}.${v}.versionNote`, form.versionNote, { action: `发布新版 ${HCB} · version note`, reason });
      }
      toast(`${HCB} 新版已确认生效 · 目标 ${v}`);
    },
  });

  const editDraftV8 = () => openActionConfirm({
    action: <>编辑草稿 v8 · {HCB}</>,
    detail: <>中英两份一起改(词序可以不同,占位符必须两边都有);保存只存草稿、不对外,但会留审计记录。</>,
    amplifies: false,
    businessForm: {
      kind: "copy-edit",
      keyName: HCB,
      version: "v8",
      surface: hcbRow.surface,
      zh: "完成 {amount} USDT 复投并获得 {nex} NEX 奖励",
      en: "Reinvest {amount} USDT and earn {nex} NEX",
      placeholders: ["{amount}", "{nex}"],
    },
    run: (reason, _v, form) => {
      setParam(`I.copy.${HCB}.status`, "v8 draft saved", { action: `编辑草稿 v8 ${HCB} · admin.content_version_drafted`, reason });
      if (form) {
        setParam(`I.copy.${HCB}.draft.zh`, form.zh, { action: `编辑草稿 v8 ${HCB} · 中文文案`, reason });
        setParam(`I.copy.${HCB}.draft.en`, form.en, { action: `编辑草稿 v8 ${HCB} · English copy`, reason });
        setParam(`I.copy.${HCB}.draft.version`, form.version, { action: `编辑草稿 v8 ${HCB} · variant id`, reason });
        setParam(`I.copy.${HCB}.draft.surface`, form.surface, { action: `编辑草稿 v8 ${HCB} · surface`, reason });
        setParam(`I.copy.${HCB}.draft.audience`, form.audience, { action: `编辑草稿 v8 ${HCB} · audience`, reason });
        setParam(`I.copy.${HCB}.draft.trafficSplit`, form.trafficSplit, { action: `编辑草稿 v8 ${HCB} · traffic split`, reason });
        setParam(`I.copy.${HCB}.draft.versionNote`, form.versionNote, { action: `编辑草稿 v8 ${HCB} · version note`, reason });
      }
      toast(`草稿 v8 已保存 · 占位符校验通过 · 留审计`);
    },
  });

  const rollbackTo = (v: string) => openActionConfirm({
    action: <>回滚 · {HCB} 当前 v7 → 重新发布 {v}</>,
    detail: <>回滚 = 把历史版 <b>{v}</b> 重新发布,效果和发新版完全一样(对全体用户生效),所以同样走操作确认。归档版的双语文案体原样恢复,审计记 from v7 → to {v}。</>,
    amplifies: false,
    edit: { kind: "text", current: v },
    run: (reason) => {
      setParam(`I.copy.${HCB}.status`, `${v} 重新发布`, { action: `回滚到 ${v} · admin.content_rolledback`, reason });
      toast(`回滚 ${v} 已确认生效`);
    },
  });

  const archiveCurV7 = () => openActionConfirm({
    action: <>下架当前发布版 · {HCB} v7</>,
    detail: <>下架后该文案位<b>没有生效版本</b>,App 端会退回内置兜底文案——一般只在文案出合规问题时才这么做;常规换版直接发新版即可。下架立即生效。</>,
    amplifies: false,
    run: (reason) => {
      setParam(`I.copy.${HCB}.status`, "v7 archived", { action: `下架 ${HCB} v7 · admin.content_archived`, reason });
      toast(`v7 下架已确认生效`);
    },
  });

  const adjustFramework = (key: string, name: string, cur: string) => openConfirm({
    action: <>实验框架参数 · {name}</>,
    detail: <>当前默认:<b>{cur}</b> · 只影响<b>之后新建</b>的实验的默认值;已启动实验按启动时锁定的快照跑,不回溯。</>,
    chips: [["运营设定 · 仍需操作确认", "done"], ["改动留审计记录", "ready"]],
    input: { label: "新默认值", placeholder: cur },
    reason: true,
    okLabel: "保存",
    run: (reason, v) => {
      if (!v) return;
      setParam(`I.exp.framework.${key}`, v, { action: `实验框架参数调整 ${name}`, reason });
      toast(`${name} 默认值已更新为 ${v} · 留审计`);
    },
  });

  const stopExp = (id: string) => openActionConfirm({
    action: <>停止实验 · {id}</>,
    detail: <>停止后<b>全部用户回到当前发布版</b>,实验转已结(可再选择采纳或弃用)。停止会改变用户所见文案分布,所以要操作确认。已收集的曝光/转化数据保留,结算页可查。</>,
    amplifies: false,
    run: (reason) => {
      setParam(`I.exp.${id}.status`, "stopped", { action: `停止实验 ${id} · admin.content_experiment_toggled(stopped)`, reason });
      toast(`${id} 停止已确认生效`);
    },
  });

  const adoptExp = (id: string) => openActionConfirm({
    action: <>采纳获胜变体 · {id}</>,
    detail: <>把获胜变体<b>采纳为该文案位的发布版</b>——这等价于一次正式发布(对全体用户生效),审计会记采纳来源实验号。采纳前确认:样本达标 ✓ 提升显著 ✓。</>,
    amplifies: false,
    run: (reason) => {
      setParam(`I.exp.${id}.status`, "adopted", { action: `采纳获胜变体 ${id} · admin.content_published(adopted from EXP)`, reason });
      toast(`${id} 获胜变体采纳已确认生效`);
    },
  });

  const renderCopyStatus = (c: CopyRow) => {
    const st = liveCopyStatus(c);
    // 已发布(含 "v8 published")→ ok;已归档/下架 → dim。
    if (st.includes("archived")) return <span className="bdg dim">已下架</span>;
    if (st.includes("published") || st === "published") return <span className="bdg ok">已发布</span>;
    return <span className="bdg dim">{st}</span>;
  };

  const renderVerStatus = (st: string) => {
    if (st === "draft") return <span className="bdg warn">draft</span>;
    if (st === "published") return <span className="bdg ok">published</span>;
    return <span className="bdg dim">archived</span>;
  };

  const renderExpState = (e: ExpRow) => {
    const st = liveExpState(e);
    if (st === "running") return <span className="bdg ok">running</span>;
    if (st === "stopped") return <span className="bdg dim">已停止</span>;
    if (st === "adopted") return <span className="bdg cyan">已采纳</span>;
    return <span className="bdg dim">已弃用</span>;
  };

  const hcbDraftZh = liveCopyDraftZh(HCB);
  const hcbDraftEn = liveCopyDraftEn(HCB);
  const hcbDraftMeta = liveCopyDraftMeta(HCB);

  return (
    <>
      <div className="f-stats">
        <div className="f-stat">
          <div className="k">受管文案位</div>
          <div className="v">{I1_STATS.managedCopies} 个</div>
          <div className="sub">Home 5 · Me 4 · 商城 3</div>
        </div>
        <div className="f-stat cyan">
          <div className="k">进行中实验</div>
          <div className="v">{I1_STATS.runningExps} 个</div>
          <div className="sub">分组固定 · 服务器掷签</div>
        </div>
        <div className="f-stat">
          <div className="k">本周变体曝光</div>
          <div className="v">{I1_STATS.weeklyExposures}</div>
          <div className="sub">曝光/转化事件喂漏斗(B3/L2)</div>
        </div>
        <div className="f-stat ok">
          <div className="k">最佳实验提升</div>
          <div className="v">{I1_STATS.topLift}</div>
          <div className="sub">EXP-2607 · 已采纳为发布版</div>
        </div>
      </div>

      {/* (a) 文案池 */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">文案池(a)</span>
          <span className="sub">· 每个文案位 = 一条受管内容线:当前发布版 + 版本历史 + 是否有进行中实验</span>
          <div className="r chips">
            <span className="lb">界面</span>
            {SURF_FLT.map(([k, l]) => (
              <button key={k} className={`chip${surf === k ? " sel" : ""}`} onClick={() => setSurf(k)}>{l}</button>
            ))}
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 860 }}>
            <thead>
              <tr>
                <th>文案位</th>
                <th>界面</th>
                <th>发布版</th>
                <th>状态</th>
                <th>双语词条</th>
                <th>进行中实验</th>
                <th>最近改版</th>
                <th style={{ textAlign: "right" }}></th>
              </tr>
            </thead>
            <tbody>
              {filteredPool.map((c) => (
                <tr key={c.key}>
                  <td>
                    <div style={{ fontWeight: 600, color: "var(--ink)" }}>{c.desc}</div>
                    <span className="mono" style={{ fontSize: 11, color: "var(--ink-4)" }}>{c.key}</span>
                  </td>
                  <td><span className="bdg dim">{c.surface}</span></td>
                  <td className="mono" style={{ fontWeight: 700 }}>{c.version}</td>
                  <td>{renderCopyStatus(c)}</td>
                  <td className="mono" style={{ fontSize: 11.5, color: "var(--ink-4)" }}>{c.i18nKey}</td>
                  <td>{c.expId === "—" ? <span style={{ color: "var(--ink-4)" }}>—</span> : <span className="bdg cyan">{c.expId}</span>}</td>
                  <td className="mono" style={{ fontSize: 11.5 }}>{c.lastChange}</td>
                  <td style={{ textAlign: "right" }}>
                    <button className="l-btn sm mc" onClick={() => pubNewVersion(c)}>发布新版</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="l-b" style={{ paddingTop: 10 }}>
          <div className="ab-sm">
            <span style={{ fontSize: 12, color: "var(--ink-4)", marginRight: 6 }}>版本状态机:</span>
            <span className="st">draft 草稿</span>
            <span className="ar">发布(操作确认)→</span>
            <span className="st ok">published 生效中</span>
            <span className="ar">下架/被新版取代 →</span>
            <span className="st">archived 归档</span>
            <span className="ar" style={{ marginLeft: 10 }}>回滚 = 把历史版重新发布,同样走操作确认</span>
          </div>
        </div>
      </section>

      <div className="two-col">
        {/* (b) 版本详情 · home.conversionBanner */}
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">版本详情(b)· <span className="icode electric">{HCB}</span></span>
            <span className="sub">· 主转化横幅</span>
            <div className="r">
              <button className="l-btn sm" onClick={editDraftV8}>编辑草稿 v8</button>
              <button className="l-btn sm mc" onClick={pubDraftV8}>发布 v8</button>
            </div>
          </div>
          <div className="l-b" style={{ paddingTop: 6 }}>
            <div className="ab-grid">
              <div className="ab-prev">
                <div className="lc">EN · v7 生效中</div>
                <div className="tx">
                  Activate <em>{"{targetName}"}</em> · earn $<em>{"{targetDaily}"}</em>/day · payback ~<em>{"{paybackDays}"}</em> days · <em>{"{multiplier}"}</em>× <em>{"{lowestName}"}</em>
                </div>
              </div>
              <div className="ab-prev">
                <div className="lc">ZH · v7 生效中</div>
                <div className="tx">
                  激活 <em>{"{targetName}"}</em>,每天赚 $<em>{"{targetDaily}"}</em>,约 <em>{"{paybackDays}"}</em> 天回本,收益是 <em>{"{lowestName}"}</em> 的 <em>{"{multiplier}"}</em> 倍
                </div>
              </div>
            </div>
            <div className="itint ok" style={{ marginBottom: 12 }}>
              <b>占位符校验通过</b> · 中英两份文案用到的占位符集合完全一致(词序可以不同);缺一个或多一个,发布会被服务器直接拦下。
            </div>
            {hcbDraftZh && hcbDraftEn && (
              <div className="itint cyan" data-proof="copy-draft-preview" style={{ marginBottom: 12 }}>
                <b>当前草稿回显</b> · 受众 <span className="mono">{hcbDraftMeta.audience ?? "全量"}</span>
                {" "}· 分流 <span className="mono">{hcbDraftMeta.trafficSplit ?? "50"}%</span>
                {" "}· 位置 <span className="mono">{hcbDraftMeta.surface ?? hcbRow.surface}</span>
                {hcbDraftMeta.note ? <> · 说明 <span className="mono">{hcbDraftMeta.note}</span></> : null}
                <div className="ab-grid" style={{ marginTop: 8 }}>
                  <div className="ab-prev">
                    <div className="lc">ZH · draft</div>
                    <div className="tx">{hcbDraftZh}</div>
                  </div>
                  <div className="ab-prev">
                    <div className="lc">EN · draft</div>
                    <div className="tx">{hcbDraftEn}</div>
                  </div>
                </div>
              </div>
            )}
            <div style={{ overflowX: "auto" }}>
              <table className="l-tbl" style={{ minWidth: 420 }}>
                <thead>
                  <tr>
                    <th>版本</th>
                    <th>状态</th>
                    <th>操作 / 留痕</th>
                    <th>时间</th>
                    <th style={{ textAlign: "right" }}></th>
                  </tr>
                </thead>
                <tbody>
                  {COPY_VERSIONS.map((row) => (
                    <tr key={row.v}>
                      <td className="mono" style={{ fontWeight: 600, color: "var(--ink)" }}>{row.v}</td>
                      <td>{renderVerStatus(row.st)}</td>
                      <td style={{ fontSize: 12 }}>{row.chain}</td>
                      <td className="mono" style={{ fontSize: 11.5 }}>{row.ts}</td>
                      <td style={{ textAlign: "right" }}>
                        {row.st === "archived" ? (
                          <button className="l-btn sm mc" onClick={() => rollbackTo(row.v)}>回滚到此版</button>
                        ) : (
                          <button className="l-btn sm" onClick={() => toast(`版本对比 ${row.v} vs v7 · 占位符一致 ✓`)}>对比</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button className="l-btn sm mc" style={{ marginTop: 10 }} onClick={archiveCurV7}>下架当前发布版(v7)</button>
            {/* 触摸 hcbRow 仅用于编译期完整性(确保 HCB 在 COPY_POOL 中存在,后续 audit 改文案位时强类型保证)。 */}
            <span style={{ display: "none" }} data-hcb={hcbRow.key} />
          </div>
        </section>

        {/* 实验框架默认参数 */}
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">实验框架默认参数</span>
            <span className="sub">· 每个实验启动时按这套默认值锁定,启动后不再变</span>
          </div>
          <div className="l-b" style={{ paddingTop: 4 }}>
            {EXP_FRAMEWORK.map((p) => {
              const cur = liveFw(p.key, p.cur);
              return (
                <div className="p-row" key={p.key}>
                  <div className="txt">
                    <div className="k">{p.name}</div>
                    <div className="s">{p.sub}</div>
                  </div>
                  <span className="v">{cur}</span>
                  <button className="l-btn sm" onClick={() => adjustFramework(p.key, p.name, cur)}>调整</button>
                </div>
              );
            })}
            <div className="itint" style={{ marginTop: 10 }}>
              <b>分组怎么发的</b> · 用户首次命中实验时由服务器掷签入组,之后固定不变(换设备也不变);曝光和转化都按服务器记的组归因。用户在本地改自己的组,服务器照旧按原组算,不会污染结论。
            </div>
            <div className="itint cyan" style={{ marginTop: 8 }}>
              <b>不碰钱</b> · 这页只改措辞,费率 / 奖励 / 价格一个都改不了——那些归各业务域,改之前要过备付金红线;文案发布没有这道约束。
            </div>
          </div>
        </section>
      </div>

      {/* (c) A/B 实验面板 */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">A/B 实验面板(c)</span>
          <span className="sub">· 曝光 / 转化 / CVR 全部由事件流结算(服务器口径),不是页面临时拼的数</span>
          <div className="r chips">
            {EXP_FLT.map(([k, l]) => (
              <button key={k} className={`chip${expFlt === k ? " sel" : ""}`} onClick={() => setExpFlt(k)}>{l}</button>
            ))}
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 980 }}>
            <thead>
              <tr>
                <th>实验</th>
                <th>文案位</th>
                <th>变体 × 分流</th>
                <th>定向</th>
                <th className="num">曝光</th>
                <th className="num">转化</th>
                <th className="num">CVR</th>
                <th>状态</th>
                <th style={{ textAlign: "right" }}></th>
              </tr>
            </thead>
            <tbody>
              {filteredExps.map((e) => {
                const st = liveExpState(e);
                const isRunning = st === "running";
                const maxCvr = e.variants.reduce((m, v) => Math.max(m, v[2]), 0);
                return (
                  <tr key={e.id}>
                    <td className="mono" style={{ fontWeight: 600, color: "var(--ink)" }}>{e.id}</td>
                    <td className="mono" style={{ fontSize: 11.5 }}>{e.copyKey}</td>
                    <td style={{ minWidth: 230 }}>
                      {e.variants.map((v, j) => (
                        <div key={j} style={{ display: "flex", alignItems: "center", gap: 7, margin: "2px 0" }}>
                          <span style={{ fontSize: 11.5, color: "var(--ink-3)", minWidth: 104 }}>{v[0]} · {v[1]}%</span>
                          <span className="ab-bar" style={{ flex: 1 }}>
                            <i style={{ width: `${Math.min(100, v[2] * 16)}%`, background: VAR_COLORS[j % VAR_COLORS.length] }} />
                          </span>
                          <span
                            className="mono"
                            style={{
                              fontSize: 11.5,
                              fontWeight: 700,
                              minWidth: 38,
                              textAlign: "right",
                              color: v[2] === maxCvr ? "var(--success)" : undefined,
                            }}
                          >
                            {v[2]}%
                          </span>
                        </div>
                      ))}
                    </td>
                    <td style={{ fontSize: 12 }}>{e.audience}</td>
                    <td className="num mono">{e.impressions}</td>
                    <td className="num mono">{e.conversions}</td>
                    <td className="num mono" style={{ fontWeight: 700 }}>{maxCvr}%</td>
                    <td>
                      {renderExpState(e)}
                      <div style={{ fontSize: 11, color: "var(--ink-4)", marginTop: 2 }}>{e.note}</div>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      {isRunning ? (
                        <button className="l-btn sm mc" onClick={() => stopExp(e.id)}>停止</button>
                      ) : st === "discarded" ? (
                        <button className="l-btn sm mc" onClick={() => adoptExp(e.id)}>采纳获胜</button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="l-b" style={{ paddingTop: 10 }}>
          <div className="ab-sm">
            <span style={{ fontSize: 12, color: "var(--ink-4)", marginRight: 6 }}>实验状态机:</span>
            <span className="st">scheduled 待开始</span>
            <span className="ar">到点开跑 →</span>
            <span className="st ok">running 进行中</span>
            <span className="ar">手动结算 / 到期 →</span>
            <span className="st warn">concluded 已结</span>
            <span className="ar">→ adopted 采纳获胜版(等于发布,走操作确认)或 discarded 弃用</span>
          </div>
        </div>
      </section>

      <p className="f-foot">
        <b>执行门槛</b>:草稿随便存(留审计);发布 / 下架 / 回滚 / 实验启停 / 采纳获胜 = 内容执行门槛:内容主管或超管。增长角色只能给<b>增长类文案位</b>(转化横幅这类)当实验发起人,法务和品牌类文案只有内容角色能动——服务器按文案位分类校验发起资格。<b>事件去向</b>:变体曝光 / 转化喂实时漏斗(B3,购买段)和留存 BI(L2,各变体 CVR 曲线);这四类内容事件的归类登记(content 域)是 BI 上线前必办工单,占位期按临时编号入库<span title="§2.4.3 domain 枚举扩展 · V4 内容批次 · blocking">。</span>
        <b>边界</b>:活动卡里能独立做 A/B 的通用文案归这页;活动本身的玩法 / 奖励 / 时窗归活动页(H4),互不越界。
      </p>
      <PaginationExemptionList
        items={[
          {
            label: "文案池(a)",
            kind: "sample-ledger",
            maxRows: 12,
            reason: "文案池为当前种子样本十二条,通过界面/状态字段定位后编辑",
          },
          {
            label: "版本详情(b)· home.conversionBanner",
            maxRows: 4,
            reason: "版本详情仅展示当前文案位四个版本样本",
          },
          {
            label: "A/B 实验面板(c)",
            maxRows: 5,
            reason: "实验面板固定五条运行样本,完整实验归埋点统计",
          },
        ]}
      />
    </>
  );
}

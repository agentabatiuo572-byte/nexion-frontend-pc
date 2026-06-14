"use client";

/**
 * J2 · Geo-block — 黑/灰名单 + per-endpoint geo_block 派生 + 边缘 IP 判定 + 应急封锁。
 * activeCountries 派生:mock 三态 GEOBLOCK + store(J.geo.* / J.geo.limited.*)覆盖,server-canonical。
 * 名单变更:风控 操作员 · 执行门槛:合规审计 (财务不参与,server 按 key=geo-block 拒绝财务 操作员)。
 */
import { CodeTag } from "../design-kit";
import { AutoGloss } from "@/app/components/kit/gloss";
import { GEOBLOCK } from "@/lib/mock/admin/design-data";
import { GEO_ENDPOINTS, GEO_SRC_LABEL, GEO_HITS, GEO_EDGE } from "./data";
import type { JCtx } from "./types";

type Entry = { cc: string; name: string; reason: string };
const ISO_RE = /^[A-Z]{2}$/;

export function J2GeoBlock({ ctx }: { ctx: JCtx }) {
  const { pget, params, setParam, toast, openActionConfirm } = ctx;
  const slaMins = pget("J.emergency.confirmSlaMins") ?? "15"; // 应急轨 SLA 与 J1 同源

  /* ---- 名单派生:mock 基线 + store 覆盖(解封移除 / 新增追加) ---- */
  const mockBanned = GEOBLOCK.filter((g) => g.status === "blocked");
  const mockLimited = GEOBLOCK.filter((g) => g.status === "limited");
  const known = new Map<string, string>(GEOBLOCK.map((g) => [g.cc, g.name]));

  const banned: Entry[] = [
    ...mockBanned.filter((g) => pget(`J.geo.${g.cc}`) !== "allowed").map((g) => ({ cc: g.cc, name: g.name, reason: g.reason })),
    ...Object.entries(params)
      .filter(([k, v]) => k.startsWith("J.geo.") && !k.startsWith("J.geo.limited.") && !k.startsWith("J.geo.endpoint.") && v === "blocked")
      .map(([k]) => k.split(".")[2])
      .filter((cc) => ISO_RE.test(cc) && !mockBanned.some((g) => g.cc === cc))
      .map((cc) => ({ cc, name: known.get(cc) ?? cc, reason: "运营加入 · A2 留痕" })),
  ];
  const limited: Entry[] = [
    ...mockLimited.filter((g) => pget(`J.geo.limited.${g.cc}`) !== "allowed").map((g) => ({ cc: g.cc, name: g.name, reason: g.reason })),
    ...Object.entries(params)
      .filter(([k, v]) => k.startsWith("J.geo.limited.") && v === "limited")
      .map(([k]) => k.split(".")[3])
      .filter((cc) => ISO_RE.test(cc) && !mockLimited.some((g) => g.cc === cc))
      .map((cc) => ({ cc, name: known.get(cc) ?? cc, reason: "运营加入 · A2 留痕" })),
  ];
  const totalHits = GEO_HITS.reduce((s, h) => s + h.ct, 0);
  const maxHit = Math.max(...GEO_HITS.map((h) => h.ct));

  /* ---- 动作 ---- */
  const rmBanned = (c: Entry) => openActionConfirm({
    action: `黑名单解封 · ${c.cc}(${c.name})`,
    detail: <>从全局封禁名单移除 <b>{c.cc}</b>({c.name})· <b>恢复方向</b>:该国 IP 段重新开放对应功能入口 · 已存量账户从只读态切回完整状态 · 同步重算 B 域漏斗地域归因 · <b>合规审计 执行门槛 必参</b>(非财务)· 解封恒走常规轨。</>,
    run: (reason) => { setParam(`J.geo.${c.cc}`, "allowed", { action: `黑名单解封 ${c.cc}(移出全局封禁名单)`, reason }); toast(`${c.cc} 已解封 · 已移出全局封禁名单`); },
  });
  const rmLimited = (c: Entry) => openActionConfirm({
    action: `受限解除 · ${c.cc}(${c.name})`,
    detail: <>从受限名单移除 <b>{c.cc}</b>({c.name})· 该国新增资金类操作放开 · 走常规 操作确认。</>,
    run: (reason) => { setParam(`J.geo.limited.${c.cc}`, "allowed", { action: `受限名单解除 ${c.cc}`, reason }); toast(`${c.cc} 受限已解除`); },
  });
  const addTo = (list: "banned" | "limited") => openActionConfirm({
    action: list === "banned" ? "新增黑名单 · 全局封禁" : "新增受限名单",
    detail: list === "banned"
      ? <><b>加入新国家到黑名单</b>(输入 ISO 3166-1 两位国家码)· 走风控 操作员 · 执行门槛:合规审计 (财务不参与)· 加封锁方向<b>可走应急快速通道</b>(监管点名场景)· A2 留痕全局黑名单变更(审计字段 active_countries · 前→后)。</>
      : <><b>加入新国家到受限名单</b>(输入 ISO 3166-1 两位国家码)· 允许登录浏览 · 禁新增资金类操作 · 视监管动态可升级为黑名单。</>,
    edit: { kind: "text", current: "—(ISO 码,如 VE)" },
    run: (reason, newValue) => {
      const cc = (newValue ?? "").trim().toUpperCase();
      if (!ISO_RE.test(cc)) { toast("ISO 国家码无效 · 需 2 位字母(如 VE)"); return; }
      if (list === "banned") setParam(`J.geo.${cc}`, "blocked", { action: `新增黑名单 ${cc}(全功能封禁)`, reason });
      else setParam(`J.geo.limited.${cc}`, "limited", { action: `新增受限名单 ${cc}(只读)`, reason });
      toast(`${cc} 已加入${list === "banned" ? "黑名单 · 全功能封禁" : "受限名单 · 只读"}(A2 留痕)`);
    },
  });
  const editEndpoint = (e: (typeof GEO_ENDPOINTS)[number]) => {
    const cur = pget(`J.geo.endpoint.${e.ep}`) ?? e.geo.join(", ");
    openActionConfirm({
      action: `编辑屏蔽国家 · ${e.label}`,
      detail: <><b>{e.label}</b>(<span className="mono">{e.ep}</span> · 所属{e.biz})· 当前屏蔽:<b className="mono">[{cur || "未设置"}]</b> · 设置方式:<b>{GEO_SRC_LABEL[e.src]}</b> · {e.srcDesc} · 编辑后该入口的屏蔽国家独立生效 · 不影响全局黑名单 · {e.src === "explicit" ? "创世节点是唯一前端显式声明屏蔽国家的入口(§9.11d.1)。" : e.src === "pending" ? "设置方式待补(V4 落地收口)。" : "默认继承全局黑名单 · 编辑后转为单独设定。"}</>,
      edit: { kind: "text", current: cur || "—" },
      run: (reason, newValue) => {
        setParam(`J.geo.endpoint.${e.ep}`, (newValue ?? "").toUpperCase(), { action: `编辑功能入口屏蔽国家 ${e.label}(${e.ep})`, reason });
        toast(`${e.label} 屏蔽国家已确认生效`);
      },
    });
  };
  const switchJudge = () => {
    const cur = pget("J.geo.edgeJudgeSource") ?? "服务器边缘 IP 判定";
    openActionConfirm({
      action: "切换边缘 IP 判定源",
      detail: <><b>边缘 IP 判定源</b> · 当前 <b className="mono">{cur}</b>(§9.11d.1 纯 IP 判定)· 切换判定源为配置级变更 · <b>实时生效(下一判定周期)</b>· 影响地区封锁的 IP 解析链路 · 与「风险提示书」按 IP+国籍判定<b>保持分离</b> · 风控主导 · 写 A2(key=geo-block / edge_judge_config)。</>,
      edit: { kind: "text", current: cur },
      run: (reason, newValue) => {
        setParam("J.geo.edgeJudgeSource", newValue ?? cur, { action: `切换边缘 IP 判定源 ${cur}→${newValue}`, reason });
        toast("边缘 IP 判定源切换已确认生效");
      },
    });
  };
  const emergencyBlock = () => openActionConfirm({
    action: "应急即时封锁 · 批量加入全局封禁名单",
    detail: <><b>应急快速通道</b>:监管点名 / OFAC / FATF 链路触发 · 一次性加入多个国家到黑名单 · <b>仅加封锁方向</b>(移除走常规轨)· 执行门槛 SLA 压至 <b>{slaMins} 分钟</b> · A2 标 emergency=true · 联动各功能入口屏蔽范围 + 该辖区资金闸定向冻结(联动 J1)· 实际批量名单由工单表单选择,本处登记应急封锁工单。</>,
    run: (reason) => { setParam("J.geo.emergency", "launched", { action: "应急即时封锁工单(emergency=true)", reason }); toast("应急封锁工单 · A2 emergency=true"); },
  });

  return (
    <div>
      {/* stat strip */}
      <div className="f-stats">
        <div className="f-stat danger"><div className="k">屏蔽国家</div><div className="v">{banned.length}</div><div className="sub">完全不可用 · 黑名单</div></div>
        <div className="f-stat warn"><div className="k">受限国家</div><div className="v">{limited.length}</div><div className="sub">只能看 · 不能动钱</div></div>
        <div className="f-stat cyan"><div className="k">今日拦截</div><div className="v">{totalHits}</div><div className="sub">被服务器在入口拦下</div></div>
        <div className="f-stat ok"><div className="k">判定系统健康</div><div className="v">99.8%</div><div className="sub">靠访问 IP 判定 · 响应快</div></div>
      </div>

      {/* 应急封锁 strip */}
      <div className="emer-strip">
        <span className="ic"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M4.93 4.93l14.14 14.14" /></svg></span>
        <div className="txt"><b>一键紧急封锁</b> · <AutoGloss>遇监管点名 / 制裁名单更新时,一次性把多个国家加进黑名单(只能加、不能在这里移除)· 审核加急、但仍需第二个人 · 全程高亮留记。</AutoGloss></div>
        <button onClick={emergencyBlock}>应急封锁</button>
      </div>

      {/* 黑/灰名单 */}
      <div className="geo-grid">
        <section className="geo-card">
          <div className="geo-h">
            <span className="ttl">黑名单(完全封禁)</span>
            <span className="sub">· 注册 / 登录 / 资金操作全停</span>
            <div className="r"><span className="cnt danger">{banned.length}</span> 国 · 全面封禁</div>
          </div>
          <div className="country-list">
            {banned.length === 0 && <span style={{ color: "var(--ink-4)", fontSize: 11.5, padding: "8px 0" }}>活跃黑名单为空 · 当前无封禁国家</span>}
            {banned.map((c) => (
              <button key={c.cc} className="country-chip banned" title={c.reason} onClick={() => rmBanned(c)}>
                <span className="cc">{c.cc}</span><span>{c.name}</span><span className="x">×</span>
              </button>
            ))}
          </div>
          <div className="geo-foot">
            <span><AutoGloss>命中 → server 边缘判定</AutoGloss> <b>403 reject</b> · <AutoGloss>已登录账户即时转</AutoGloss><b>只读</b><AutoGloss>停产</AutoGloss></span>
            <button onClick={() => addTo("banned")}>+ 加入黑名单</button>
          </div>
        </section>

        <section className="geo-card">
          <div className="geo-h">
            <span className="ttl">受限名单(只读)</span>
            <span className="sub">· 能登录浏览 · 不能新增资金操作</span>
            <div className="r"><span className="cnt warn">{limited.length}</span> 国 · 部分受限</div>
          </div>
          <div className="country-list">
            {limited.length === 0 && <span style={{ color: "var(--ink-4)", fontSize: 11.5, padding: "8px 0" }}>受限名单为空</span>}
            {limited.map((c) => (
              <button key={c.cc} className="country-chip limited" title={c.reason} onClick={() => rmLimited(c)}>
                <span className="cc">{c.cc}</span><span>{c.name}</span><span className="x">×</span>
              </button>
            ))}
          </div>
          <div className="geo-foot">
            <span>升级触发:<b>监管指令</b> · <AutoGloss>升级为封禁联动 J1 该辖区资金闸定向冻结</AutoGloss></span>
            <button className="warn" onClick={() => addTo("limited")}>+ 加入受限</button>
          </div>
        </section>
      </div>

      {/* per-endpoint 派生表 */}
      <section className="deriv-card">
        <div className="deriv-h">
          <span className="ttl">各功能入口的封锁范围</span>
          <span className="sub">· 看每个功能入口分别屏蔽了哪些国家</span>
          <div className="r"><CodeTag tone="electric">审计留痕</CodeTag><CodeTag>每次变更都记录</CodeTag></div>
        </div>
        <div className="deriv-tblwrap"><div className="deriv-tbl">
          <div className="hd">
            <div className="c">功能入口</div><div className="c">所属业务</div><div className="c">屏蔽国家</div><div className="c">设置方式</div><div className="c">今日拦截</div>
            <div className="c" style={{ justifyContent: "flex-end" }}>动作</div>
          </div>
          {GEO_ENDPOINTS.map((e) => {
            const ov = pget(`J.geo.endpoint.${e.ep}`);
            const geoList = ov !== undefined ? ov.split(/[,\s]+/).filter(Boolean) : e.geo;
            const src = ov !== undefined ? "explicit" : e.src;
            return (
              <div className="rw" key={e.ep}>
                <div className="c">
                  <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                    <span style={{ fontWeight: 600, color: "var(--ink)" }}>{e.label}</span>
                    <span className="endpoint" style={{ fontSize: 11 }}>{e.ep}</span>
                  </div>
                </div>
                <div className="c">
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0, alignItems: "flex-start" }}>
                    <span style={{ fontSize: 12, color: "var(--ink-2)" }}>{e.biz}</span>
                    <span className="domain">{e.domain}</span>
                  </div>
                </div>
                <div className="c"><div className="geo-set">
                  {geoList.length === 0 ? <span className="inherit">(本页尚未设置)</span> : (<>
                    {geoList.slice(0, 4).map((cc) => <span key={cc} className="cc">{cc}</span>)}
                    {geoList.length > 4 && <span className="more">+{geoList.length - 4}</span>}
                  </>)}
                </div></div>
                <div className="c"><span className={"src " + src}>{GEO_SRC_LABEL[src]}</span></div>
                <div className="c">{e.hits === 0 ? <span className="hits zero">—</span> : <span className="hits">{e.hits}</span>}</div>
                <div className="c acts"><button onClick={() => editEndpoint(e)}>编辑屏蔽国家</button></div>
              </div>
            );
          })}
        </div></div>
      </section>

      {/* Top 拦截 + 边缘 IP 判定 */}
      <div className="geo-grid">
        <section className="hits-card">
          <div className="hits-h">
            <span className="t">拦截最多的国家 · 今日</span>
            <span className="s">· 被服务器在入口拒绝的访问</span>
            <span className="r">总计 <b style={{ color: "var(--danger)" }}>{totalHits}</b> 次</span>
          </div>
          {GEO_HITS.map((h) => (
            <div className="hit-row" key={h.cc}>
              <div className="cc">{h.cc}<span className="nm">{h.nm}</span></div>
              <div className="bar"><div className="f" style={{ width: `${Math.round((h.ct / maxHit) * 100)}%` }} /></div>
              <div className="ct">{h.ct}</div>
            </div>
          ))}
        </section>

        <section className="edge-card">
          <div className="edge-h">
            <span className="ic"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></svg></span>
            <div><div className="t">边缘 IP 判定</div><div className="s">· 靠访问 IP 判定地区</div></div>
          </div>
          <div className="edge-body">
            <div className="edge-kv"><span className="k">判定源</span><span className="v" style={{ display: "flex", alignItems: "center", gap: 8 }}>{pget("J.geo.edgeJudgeSource") ?? "服务器边缘 IP 判定"}<button onClick={switchJudge}>切换</button></span></div>
            {GEO_EDGE.map((row) => (
              <div className="edge-kv" key={row.k}><span className="k"><AutoGloss>{row.k}</AutoGloss></span><span className={"v " + row.tone}><AutoGloss>{row.v}</AutoGloss></span></div>
            ))}
            <div className="edge-note">
              <span className="ic"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 16v-4M12 8h.01M12 22a10 10 0 1 1 0-20 10 10 0 0 1 0 20z" /></svg></span>
              <div><b>地区封锁靠 IP,风险提示书靠 IP + 实名国籍</b> — <AutoGloss>这是两套独立机制。改这里的地区封锁,不会影响风险提示书的地区判定。</AutoGloss></div>
            </div>
          </div>
        </section>
      </div>

      <p className="f-foot"><b>封锁在服务器入口生效、客户端绕不过</b>:<AutoGloss>封锁名单以服务器为准,被封国家的 IP 会在入口</AutoGloss><b>直接被拒</b>。<AutoGloss>地区靠</AutoGloss><b>访问 IP 判定</b>(<AutoGloss>和「风险提示书」按 IP+国籍判定是两套机制</AutoGloss>)。<AutoGloss>每个功能入口可以单独设封锁国家,也可默认继承全局黑名单。名单变更要</AutoGloss><b>风控 lead / 超管执行操作确认</b>(<AutoGloss>财务不参与</AutoGloss>),<AutoGloss>每次都留完整审计记录。</AutoGloss></p>
    </div>
  );
}

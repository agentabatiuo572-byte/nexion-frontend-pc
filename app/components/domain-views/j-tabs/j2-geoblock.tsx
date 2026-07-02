"use client";

/**
 * J2 · Geo-block — 黑/灰名单 + per-endpoint geo_block 派生 + 边缘 IP 判定 + 应急封锁。
 * activeCountries / endpoint geo_block 均由后端 /emergency/geo-block 返回,server-canonical。
 * 名单变更:风控 操作员 · 执行门槛:合规审计 (财务不参与,server 按 key=geo-block 拒绝财务 操作员)。
 */
import { CodeTag } from "../design-kit";
import { AutoGloss } from "@/app/components/kit/gloss";
import type { JCtx } from "./types";
import type { GeoCountry, GeoEndpoint } from "@/lib/admin/j-client";

type Entry = GeoCountry;
const ISO_RE = /^[A-Z]{2}$/;

export function J2GeoBlock({ ctx }: { ctx: JCtx }) {
  const { toast, openActionConfirm, actions, emergency, contentLoading } = ctx;
  const data = emergency.geoBlock;
  if (contentLoading && !data) {
    return <section className="deriv-card"><div className="deriv-h"><span className="ttl">J2 数据加载中</span><span className="sub">· 正在读取地区封锁接口</span></div></section>;
  }
  if (!data) {
    return <section className="deriv-card"><div className="deriv-h"><span className="ttl">J2 暂无地区封锁数据</span><span className="sub">· 后端接口未返回数据</span></div></section>;
  }

  const banned: Entry[] = data.blocked;
  const limited: Entry[] = data.limited;
  const GEO_ENDPOINTS = data.endpoints;
  const GEO_HITS = data.hits;
  const GEO_EDGE = data.edge.metrics;
  const totalHits = Number(data.stats.totalHits ?? GEO_HITS.reduce((s, h) => s + h.ct, 0));
  const maxHit = Math.max(1, ...GEO_HITS.map((h) => h.ct));
  const slaMins = data.stats.confirmSlaMins == null || data.stats.confirmSlaMins === "" ? "缺数据" : String(data.stats.confirmSlaMins);
  const edgeSource = data.edge.source;
  const health = data.stats.health == null || data.stats.health === "" ? null : String(data.stats.health);

  const runBackend = (task: Promise<void>, ok: string) => {
    task
      .then(() => actions.reloadJEmergency())
      .then(() => toast(ok))
      .catch((error) => toast(`操作失败 · ${error instanceof Error ? error.message : "J2_API_FAILED"}`));
  };

  /* ---- 动作 ---- */
  const rmBanned = (c: Entry) => openActionConfirm({
    action: `黑名单解封 · ${c.cc}(${c.name})`,
    detail: <>从全局封禁名单移除 <b>{c.cc}</b>({c.name})· <b>恢复方向</b>:该国 IP 段重新开放对应功能入口 · 已存量账户从只读态切回完整状态 · 同步重算 B 域漏斗地域归因 · <b>合规审计 执行门槛 必参</b>(非财务)· 解封恒走常规轨。</>,
    run: (reason) => runBackend(actions.updateJ2Country(c.cc, "allowed", reason), `${c.cc} 已解封 · 已移出全局封禁名单`),
  });
  const rmLimited = (c: Entry) => openActionConfirm({
    action: `受限解除 · ${c.cc}(${c.name})`,
    detail: <>从受限名单移除 <b>{c.cc}</b>({c.name})· 该国新增资金类操作放开 · 走常规 操作确认。</>,
    run: (reason) => runBackend(actions.updateJ2Country(c.cc, "allowed", reason), `${c.cc} 受限已解除`),
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
      runBackend(
        actions.updateJ2Country(cc, list === "banned" ? "blocked" : "limited", reason),
        `${cc} 已加入${list === "banned" ? "黑名单 · 全功能封禁" : "受限名单 · 只读"}(A2 留痕)`,
      );
    },
  });
  const editEndpoint = (e: GeoEndpoint) => {
    const cur = e.countries.join(", ");
    openActionConfirm({
      action: `编辑屏蔽国家 · ${e.label}`,
      detail: <><b>{e.label}</b>(<span className="mono">{e.ep}</span> · 所属{e.biz})· 当前屏蔽:<b className="mono">[{cur || "未设置"}]</b> · 设置方式:<b>{e.sourceLabel}</b> · {e.sourceDescription} · 编辑后该入口的屏蔽国家独立生效 · 不影响全局黑名单 · {e.source === "explicit" ? "创世节点是唯一前端显式声明屏蔽国家的入口(§9.11d.1)。" : e.source === "pending" ? "设置方式待补(V4 落地收口)。" : "默认继承全局黑名单 · 编辑后转为单独设定。"}</>,
      edit: { kind: "text", current: cur || "—" },
      run: (reason, newValue) => {
        const countries = (newValue ?? "").toUpperCase().split(/[,\s]+/).map((code) => code.trim()).filter((code) => ISO_RE.test(code));
        runBackend(actions.updateJ2Endpoint(e.key, countries, reason), `${e.label} 屏蔽国家已确认生效`);
      },
    });
  };
  const switchJudge = () => {
    const cur = edgeSource;
    openActionConfirm({
      action: "切换边缘 IP 判定源",
      detail: <><b>边缘 IP 判定源</b> · 当前 <b className="mono">{cur}</b>(§9.11d.1 纯 IP 判定)· 切换判定源为配置级变更 · <b>实时生效(下一判定周期)</b>· 影响地区封锁的 IP 解析链路 · 与「风险提示书」按 IP+国籍判定<b>保持分离</b> · 风控主导 · 写 A2(key=geo-block / edge_judge_config)。</>,
      edit: { kind: "text", current: cur },
      run: (reason, newValue) => {
        runBackend(actions.updateJ2EdgeJudge(newValue ?? cur, reason), "边缘 IP 判定源切换已确认生效");
      },
    });
  };
  const emergencyBlock = () => openActionConfirm({
    action: "应急即时封锁 · 批量加入全局封禁名单",
    detail: <><b>应急快速通道</b>:监管点名 / OFAC / FATF 链路触发。在「目标新值」<b>批量粘贴国家码</b>(ISO2,逗号 / 空格 / 换行分隔,如 <span className="mono">VE, IR, KP</span>)· <b>仅加封锁方向</b>(移除走常规轨)· 执行门槛 SLA 压至 <b>{slaMins} 分钟</b> · A2 标 emergency=true。
      <div className="geo-foot" data-proof="j2-emergency-preview" style={{ display: "block", marginTop: 10 }}>
        <div><b>影响预览</b></div>
        <div>当前黑名单 {banned.length} 国 · 受限 {limited.length} 国 · 命中依据:边缘 IP 判定(<span className="mono">{edgeSource}</span>)</div>
        <div>影响 endpoint:{GEO_ENDPOINTS.length} 个功能入口(继承全局黑名单)+ 该辖区资金闸定向冻结(联动 J1)· 受影响账户:命中国 IP 段存量账户即时转只读</div>
      </div>
    </>,
    edit: { kind: "text", current: "—(批量 ISO 码,如 VE, IR, KP)" },
    run: (reason, newValue) => {
      const codes = (newValue ?? "").toUpperCase().split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
      const valid = codes.filter((c) => ISO_RE.test(c));
      if (!valid.length) { toast("请粘贴至少一个有效 ISO2 国家码(如 VE, IR, KP),未执行"); return; }
      runBackend(actions.emergencyBlockJ2(valid, reason), `应急封锁 ${valid.length} 国(${valid.join("/")})· A2 emergency=true`);
    },
  });

  return (
    <div>
      {/* stat strip */}
      <div className="f-stats">
        <div className="f-stat danger"><div className="k">屏蔽国家</div><div className="v">{banned.length}</div><div className="sub">完全不可用 · 黑名单</div></div>
        <div className="f-stat warn"><div className="k">受限国家</div><div className="v">{limited.length}</div><div className="sub">只能看 · 不能动钱</div></div>
        <div className="f-stat cyan"><div className="k">今日拦截</div><div className="v">{totalHits}</div><div className="sub">被服务器在入口拦下</div></div>
        <div className="f-stat ok"><div className="k">判定系统健康</div><div className="v">{health ?? "未返回"}</div><div className="sub">{health ? "来自后端健康指标" : "接口未返回健康指标"}</div></div>
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
            const geoList = e.countries;
            const src = e.source;
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
                <div className="c"><span className={"src " + src}>{e.sourceLabel}</span></div>
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
            <div className="edge-kv"><span className="k">判定源</span><span className="v" style={{ display: "flex", alignItems: "center", gap: 8 }}>{edgeSource}<button onClick={switchJudge}>切换</button></span></div>
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

      <p className="f-foot"><b>封锁在服务器入口生效、客户端绕不过</b>:<AutoGloss>封锁名单以服务器为准,被封国家的 IP 会在入口</AutoGloss><b>直接被拒</b>。<AutoGloss>地区靠</AutoGloss><b>访问 IP 判定</b>(<AutoGloss>和「风险提示书」按 IP+国籍判定是两套机制</AutoGloss>)。<AutoGloss>每个功能入口可以单独设封锁国家,也可默认继承全局黑名单。名单变更要</AutoGloss><b>风控 / 超管执行操作确认</b>(<AutoGloss>财务不参与</AutoGloss>),<AutoGloss>每次都留完整审计记录。</AutoGloss></p>
    </div>
  );
}

"use client";

import { CodeTag } from "../design-kit";
import { AutoGloss } from "@/app/components/kit/gloss";
import type { JCtx } from "./types";
import { isEmergencyOutcomeUncertain, type GeoCountry, type GeoEndpoint, type GeoRecentChange } from "@/lib/admin/j-client";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { displayAdminError } from "@/lib/admin/error-messages";

type Entry = GeoCountry;

const TRIGGER_BASES = ["", "监管点名", "挤兑风险", "安全事件", "其他"];
const TRIGGER_LABELS = { "": "请选择触发依据" };

function createJ2CommandKey(scope: string) {
  return `j2-${scope}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function formatGeoChangeValue(value: string, countryNames: Record<string, string>, edgeLabels: Record<string, string>, resourceType: string) {
  if (!value) return "—";
  let parsed: unknown = value;
  try {
    parsed = JSON.parse(value);
  } catch {
    // Older audit rows may contain a plain string rather than JSON.
  }
  const statusLabels: Record<string, string> = { blocked: "完全封禁", limited: "限制资金操作", allowed: "允许访问" };
  const countryLabel = (code: string) => countryNames[code] ?? code;
  if (Array.isArray(parsed)) {
    return parsed.length === 0 ? "空名单" : parsed.map((item) => countryLabel(String(item))).join("、");
  }
  if (parsed && typeof parsed === "object") {
    const row = parsed as Record<string, unknown>;
    const mode = String(row.mode ?? row.source ?? "");
    const countries = Array.isArray(row.countries) ? row.countries.map((item) => countryLabel(String(item))) : [];
    if (mode === "derived") return "继承全局封禁名单";
    if (mode === "explicit") return countries.length > 0 ? `单独封禁：${countries.join("、")}` : "单独设定（空）";
    return "结构化策略已记录";
  }
  const text = String(parsed);
  if (resourceType === "GEO_EDGE") return edgeLabels[text] ?? "未登记判定源";
  return statusLabels[text] ?? edgeLabels[text] ?? countryLabel(text);
}

function geoChangeObjectLabel(change: GeoRecentChange, endpoints: GeoEndpoint[], countryNames: Record<string, string>) {
  if (change.resourceType === "GEO_COUNTRY_LIST") return change.resourceId === "limited" ? "受限名单" : "全局封禁名单";
  if (change.resourceType === "GEO_ENDPOINT") return endpoints.find((item) => item.key === change.resourceId)?.label ?? "功能入口封锁规则";
  if (change.resourceType === "GEO_EDGE") return "边缘地区判定源";
  if (change.resourceType === "GEO_COUNTRY_BATCH") return "应急批量封锁";
  if (change.resourceType === "GEO_COUNTRY") return countryNames[change.resourceId] ?? "国家或地区策略";
  return "J2 地域策略";
}

export function J2GeoBlock({ ctx }: { ctx: JCtx }) {
  const { toast, openActionConfirm, actions, emergency, contentLoading } = ctx;
  const session = useAdminAuth((state) => state.session);
  const authorities = new Set(session?.authorities ?? []);
  const canCountry = authorities.has("emergency_j2_country_manage");
  const canEndpoint = authorities.has("emergency_j2_write");
  const canEdge = authorities.has("emergency_j2_edge_source_manage");
  const canEmergency = authorities.has("emergency_j2_emergency_block");
  const data = emergency.geoBlock;

  if (contentLoading && !data) {
    return <section className="deriv-card"><div className="deriv-h"><span className="ttl">J2 数据加载中</span><span className="sub">· 正在读取地区封锁状态</span></div></section>;
  }
  if (!data) {
    return <section className="deriv-card"><div className="deriv-h"><span className="ttl">当前无法确认地区封锁状态</span><span className="sub">· 为避免误操作，控制项已隐藏</span></div></section>;
  }

  const banned: Entry[] = data.blocked;
  const limited: Entry[] = data.limited;
  const geoEndpoints = data.endpoints;
  const geoHits = data.hits;
  const geoEdge = data.edge.metrics;
  const totalHits = Number(data.stats.totalHits ?? geoHits.reduce((sum, hit) => sum + hit.ct, 0));
  const maxHit = Math.max(1, ...geoHits.map((hit) => hit.ct));
  const edgeSource = data.edge.source;
  const edgeSourceKnown = data.edge.sourceKnown;
  const healthStatus = data.edge.healthStatus;
  const health = !edgeSourceKnown ? "判定源未登记" : healthStatus === "healthy" ? "正常" : healthStatus === "degraded" ? "异常" : healthStatus === "stale" ? "已过期" : "待采样";
  const healthTone = !edgeSourceKnown || healthStatus === "degraded" ? "danger" : healthStatus === "healthy" ? "ok" : "warn";
  const countryOptions = data.countryOptions.map((option) => option.value);
  const blockedCodes = new Set(banned.map((country) => country.cc));
  const emergencyCandidates = countryOptions.filter((country) => !blockedCodes.has(country));
  const limitedCandidates = countryOptions.filter((country) => !blockedCodes.has(country));
  const limitedEditDisabled = limited.length === 0 && limitedCandidates.length === 0;
  const countryNames = Object.fromEntries(data.countryOptions.map((option) => [option.value, option.label]));
  const countryLabels = Object.fromEntries([
    ...data.countryOptions.map((option) => [option.value, `${option.label}（${option.value}）· ${option.activeUsers} 位活跃用户 · ${option.walletUsdt.toLocaleString()} USDT`]),
  ]);
  const edgeSwitchCandidates = data.edge.sources.filter((source) => source.healthy && source.value !== edgeSource);
  const edgeSourceLabels = Object.fromEntries(data.edge.sources.map((source) => [source.value, source.label]));
  const currentEdgeSourceLabel = edgeSourceKnown ? (edgeSourceLabels[edgeSource] ?? "已登记判定源") : "判定源未登记";
  const edgeFallbackAvailable = edgeSourceKnown && data.edge.healthy;

  const runBackend = async (task: () => Promise<void>, ok: string) => {
    try {
      await task();
    } catch (error) {
      if (isEmergencyOutcomeUncertain(error)) {
        try {
          await actions.reloadJEmergency();
          toast(`执行结果待确认 · 已重新读取服务端权威状态，请以当前页面和审计记录为准。${error instanceof Error ? ` ${error.message}` : ""}`);
        } catch {
          toast("执行结果待确认 · 当前也无法重新读取权威状态，请勿连续提交；请恢复网络后刷新页面并核对审计记录。");
        }
      } else {
        toast(`操作未完成 · ${error instanceof Error ? displayAdminError(error) : "请稍后重试"}`);
      }
      throw error;
    }
    try {
      await actions.reloadJEmergency();
      toast(ok);
    } catch {
      toast(`${ok}，但最新状态暂时无法读取，请刷新确认`);
    }
  };

  const editCountryList = (target: "blocked" | "limited") => {
    const commandKey = createJ2CommandKey(`country-list-${target}`);
    const current = target === "blocked" ? banned : limited;
    const currentCodes = current.map((country) => country.cc).sort();
    const availableOptions = target === "limited" ? limitedCandidates : countryOptions;
    const impactUsers = current.reduce((sum, country) => sum + country.activeUsers, 0);
    const impactWallet = current.reduce((sum, country) => sum + country.walletUsdt, 0);
    openActionConfirm({
    action: target === "blocked" ? "编辑全局封禁名单" : "编辑受限名单",
    detail: target === "blocked"
      ? <>提交的是<b>完整封禁名单</b>，页面会展示新增和移除差异。新增国家会立即停止其注册、登录和资金操作；<b>解除全局封禁不会清除功能入口的单独封锁，最终可用能力以入口策略及其他业务闸为准。</b></>
      : <>提交的是<b>完整受限名单</b>，页面会展示新增和移除差异。名单中的用户仍可登录和浏览，但资金变更入口会被拒绝；<b>解除全局受限不会清除功能入口的单独封锁，最终可用能力以入口策略及其他业务闸为准。</b>已封禁国家不能直接降级为受限。</>,
    businessForm: {
      kind: "multi-field",
      title: target === "blocked" ? "全局封禁名单" : "受限名单",
      hint: `当前名单影响 ${impactUsers} 位活跃用户、钱包余额 ${impactWallet.toLocaleString()} USDT；本次移除对象会在差异区列出，移除只解除本名单，不会清除入口单独策略或其他业务闸。提交时会校验页面初始快照，若已被其他管理员修改则整单拒绝。`,
      reasonMax: 200,
      fields: [
        {
          key: "countries",
          label: "名单中的国家或地区",
          current: currentCodes.join(","),
          inputKind: "multi-select",
          searchable: true,
          showDiff: true,
          required: false,
          options: availableOptions,
          optionLabels: countryLabels,
          wide: true,
        },
        ...(target === "blocked" ? [{ key: "triggerBasis", label: "新增封禁的触发依据", current: "", inputKind: "select" as const, options: TRIGGER_BASES, optionLabels: TRIGGER_LABELS, required: false, requiredWhenAddedTo: "countries" }] : []),
      ],
    },
    run: (reason, _newValue, businessValue) => {
      const countries = (businessValue?.countries ?? "").split(",").map((item) => item.trim()).filter(Boolean).sort();
      const triggerBasis = businessValue?.triggerBasis ?? "";
      const added = countries.filter((country) => !currentCodes.includes(country));
      if (target === "blocked" && added.length > 0 && !triggerBasis) {
        const error = new Error("新增封禁国家时，请选择触发依据");
        toast(`操作未完成 · ${error.message}`);
        throw error;
      }
      return runBackend(
        () => actions.replaceJ2CountryList(target, countries, currentCodes, triggerBasis || undefined, reason, commandKey),
        target === "blocked" ? "全局封禁名单已更新 · 已记审计" : "受限名单已更新 · 已记审计",
      );
    },
  });
  };

  const editEndpoint = (entry: GeoEndpoint) => {
    const commandKey = createJ2CommandKey(`endpoint-${entry.key}`);
    return openActionConfirm({
    action: `调整功能入口封锁范围 · ${entry.label}`,
    detail: <><b>{entry.label}</b>当前采用“{entry.sourceLabel}”。选择“继承全局”时自动跟随全局封禁名单；选择“单独设定”时，只对勾选的国家生效。</>,
    businessForm: {
      kind: "multi-field",
      title: "功能入口封锁规则",
      hint: "待实装确认的功能入口不可编辑；单独设定至少选择一个国家。",
      reasonMax: 200,
      fields: [
        {
          key: "mode",
          label: "设置方式",
          current: entry.source === "explicit" ? "explicit" : "derived",
          inputKind: "select",
          options: ["derived", "explicit"],
          optionLabels: { derived: "继承全局", explicit: "单独设定" },
        },
        {
          key: "countries",
          label: "单独屏蔽的国家或地区",
          current: entry.countries.join(","),
          inputKind: "multi-select",
          searchable: true,
          options: data.countryOptions.map((option) => option.value),
          optionLabels: countryLabels,
          required: false,
          visibleWhen: { key: "mode", equals: "explicit" },
          wide: true,
        },
      ],
    },
    run: (reason, _newValue, businessValue) => {
      const mode = businessValue?.mode === "explicit" ? "explicit" : "derived";
      const countries = mode === "explicit"
        ? (businessValue?.countries ?? "").split(",").map((item) => item.trim()).filter(Boolean).sort()
        : [];
      if (mode === "explicit" && countries.length === 0) {
        const error = new Error("单独设定时，请至少选择一个国家或地区");
        toast(`操作未完成 · ${error.message}`);
        throw error;
      }
      const expectedMode = entry.source === "explicit" ? "explicit" : "derived";
      const expectedCountries = [...entry.countries].sort();
      if (mode === expectedMode && countries.join(",") === expectedCountries.join(",")) {
        const error = new Error("封锁范围没有发生变化，本次未提交");
        toast(`操作未完成 · ${error.message}`);
        throw error;
      }
      return runBackend(() => actions.updateJ2Endpoint(entry.key, mode, countries, expectedMode, expectedCountries, reason, commandKey), `${entry.label}的封锁范围已生效 · 已记审计`);
    },
  });
  };

  const switchJudge = () => {
    const commandKey = createJ2CommandKey("edge-source");
    return openActionConfirm({
    action: "切换边缘地区判定源",
    detail: <>当前使用“{currentEdgeSourceLabel}”，健康状态为“{health}”。只允许选择最近 5 分钟至少有 20 个可信请求头样本的边缘网络；{edgeFallbackAvailable
      ? "切换后旧源继续兜底 5 分钟，请持续观察解析状态。"
      : "当前源不可用，不具备回退能力；所选健康判定源切换后立即生效，请持续观察解析状态。"}</>,
    edit: { kind: "select", current: edgeSwitchCandidates[0]?.value ?? "", options: edgeSwitchCandidates.map((source) => source.value), optionLabels: edgeSourceLabels },
    run: (reason, newValue) => runBackend(
      () => actions.updateJ2EdgeJudge(newValue ?? "", edgeSource, reason, commandKey),
      "边缘地区判定源已切换 · 已记审计",
    ),
  });
  };

  const emergencyBlock = () => {
    const commandKey = createJ2CommandKey("emergency-block");
    return openActionConfirm({
    action: "应急即时封锁 · 批量加入全局封禁名单",
    detail: <><b>仅加封锁，不在这里解除。</b>选择一个或多个国家和触发依据后，所有目标会先统一校验；有任何冲突时整批不执行，避免只成功一部分。</>,
    businessForm: {
      kind: "multi-field",
      title: "应急封锁范围",
      hint: `当前全局封禁 ${banned.length} 个、受限 ${limited.length} 个；已封禁国家不会重复出现在候选中，判定来源为“${currentEdgeSourceLabel}”。`,
      reasonMax: 200,
      fields: [
        {
          key: "countries",
          label: "目标国家或地区",
          current: "",
          inputKind: "multi-select",
          searchable: true,
          options: emergencyCandidates,
          optionLabels: countryLabels,
          wide: true,
        },
        { key: "triggerBasis", label: "触发依据", current: "", inputKind: "select", options: TRIGGER_BASES, optionLabels: TRIGGER_LABELS },
      ],
    },
    run: (reason, _newValue, businessValue) => {
      const countries = (businessValue?.countries ?? "").split(",").map((item) => item.trim()).filter(Boolean);
      const triggerBasis = businessValue?.triggerBasis ?? "";
      return runBackend(() => actions.emergencyBlockJ2(countries, triggerBasis, reason, commandKey), "应急封锁已整批生效 · 已记审计");
    },
  });
  };

  const countryChip = (country: Entry, tone: "banned" | "limited") => (
    <span key={country.cc} className={`country-chip ${tone}`} title={country.reason}>
      <span className="cc">{country.cc}</span><span>{country.name}</span>
    </span>
  );

  return (
    <div>
      <div className="f-stats">
        <div className="f-stat danger"><div className="k">封禁国家</div><div className="v">{banned.length}</div><div className="sub">注册、登录、资金操作全停</div></div>
        <div className="f-stat warn"><div className="k">受限国家</div><div className="v">{limited.length}</div><div className="sub">可浏览，不可新增资金操作</div></div>
        <div className="f-stat cyan"><div className="k">今日拦截</div><div className="v">{totalHits}</div><div className="sub">在业务入口被拒绝</div></div>
        <div className={`f-stat ${healthTone}`}><div className="k">判定系统健康</div><div className="v">{health}</div><div className="sub">服务端实时判定</div></div>
      </div>

      <div className="emer-strip">
        <span className="ic" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M4.93 4.93l14.14 14.14" /></svg></span>
        <div className="txt"><b>一键紧急封锁</b> · <AutoGloss>遇监管点名、制裁名单更新或安全事件时，一次性把多个国家加入全局封禁名单。单人授权确认后立即执行，全程留痕。</AutoGloss>{emergencyCandidates.length === 0 && <span className="tiny muted"> 所有国家和地区均已封禁，当前没有可新增候选。</span>}</div>
        {canEmergency && <button disabled={emergencyCandidates.length === 0} onClick={emergencyBlock}>应急封锁</button>}
      </div>

      <div className="geo-grid">
        <section className="geo-card">
          <div className="geo-h"><span className="ttl">黑名单（完全封禁）</span><span className="sub">· 注册、登录、资金操作全停</span><div className="r"><span className="cnt danger">{banned.length}</span> 国</div></div>
          <div className="country-list">
            {banned.length === 0 && <span style={{ color: "var(--ink-4)", fontSize: 11.5, padding: "8px 0" }}>当前没有封禁国家</span>}
            {banned.map((country) => countryChip(country, "banned"))}
          </div>
          <div className="geo-foot"><span>命中后在业务入口直接拒绝，并记录拦截事件</span>{canCountry && <button onClick={() => editCountryList("blocked")}>编辑黑名单</button>}</div>
        </section>

        <section className="geo-card">
          <div className="geo-h"><span className="ttl">受限名单（只读）</span><span className="sub">· 可登录浏览，不可新增资金操作</span><div className="r"><span className="cnt warn">{limited.length}</span> 国</div></div>
          <div className="country-list">
            {limited.length === 0 && <span style={{ color: "var(--ink-4)", fontSize: 11.5, padding: "8px 0" }}>当前没有受限国家</span>}
            {limited.map((country) => countryChip(country, "limited"))}
          </div>
          <div className="geo-foot"><span>{limitedEditDisabled ? "暂无可加入受限名单的国家，请先解除全局封禁" : "需要更严格管控时，可在黑名单中直接升级为完全封禁"}</span>{canCountry && <button className="warn" disabled={limitedEditDisabled} onClick={() => editCountryList("limited")}>编辑受限名单</button>}</div>
        </section>
      </div>

      <section className="deriv-card">
        <div className="deriv-h"><span className="ttl">各功能入口的封锁范围</span><span className="sub">· 分别查看继承或单独设置的国家</span><div className="r"><CodeTag tone="electric">审计留痕</CodeTag><CodeTag>变更立即生效</CodeTag></div></div>
        <div className="deriv-tblwrap"><div className="deriv-tbl">
          <div className="hd"><div className="c">功能入口</div><div className="c">所属业务</div><div className="c">屏蔽国家</div><div className="c">设置方式</div><div className="c">今日拦截</div><div className="c" style={{ justifyContent: "flex-end" }}>动作</div></div>
          {geoEndpoints.length === 0 && <div className="rw"><div className="c muted" style={{ gridColumn: "1 / -1" }}>当前没有已登记的功能入口</div></div>}
          {geoEndpoints.map((entry) => (
            <div className="rw" key={entry.key}>
              {/* ⚠️ 这里**不要**加 endpoint 路径或所属域的副标:`tests/j2-geoblock-contract.test.mjs`
                  「J2 operator view hides endpoint paths and technical domain codes」明令禁止。
                  2026-08-07 曾按差距台账 J-6 加过一次(用 entry.endpoint 绕开断言里写的 entry.ep,
                  两者是同一值的两个字段名),已撤。J1 侧无同款禁令,闸 key 副标可以留。 */}
              <div className="c"><span style={{ fontWeight: 600, color: "var(--ink)" }}>{entry.label}</span></div>
              <div className="c"><span style={{ fontSize: 12, color: "var(--ink-2)" }}>{entry.biz}</span></div>
              <div className="c"><div className="geo-set">{entry.countries.length === 0 ? <span className="inherit">{entry.source === "derived" ? "跟随全局" : "尚未设置"}</span> : <>{entry.countries.slice(0, 4).map((code) => <span key={code} className="cc">{countryNames[code] ?? "未知地区"}（{code}）</span>)}{entry.countries.length > 4 && <span className="more">+{entry.countries.length - 4}</span>}</>}</div></div>
              <div className="c"><span className={`src ${entry.source}`}>{entry.sourceLabel}</span></div>
              <div className="c">{entry.hits === 0 ? <span className="hits zero">—</span> : <span className="hits">{entry.hits}</span>}</div>
              <div className="c acts">{canEndpoint && entry.configurable ? <button onClick={() => editEndpoint(entry)}>编辑封锁范围</button> : <span className="muted tiny">{entry.configurable ? "无编辑权限" : "待实装确认"}</span>}</div>
            </div>
          ))}
        </div></div>
      </section>

      <div className="geo-grid">
        <section className="hits-card">
          <div className="hits-h"><span className="t">拦截最多的国家 · 今日</span><span className="s">· 在业务入口被拒绝的访问</span><span className="r">总计 <b style={{ color: "var(--danger)" }}>{totalHits}</b> 次</span></div>
          {geoHits.length === 0 && <div className="tiny muted" style={{ padding: "18px 0" }}>今天暂无地区封锁拦截记录</div>}
          {geoHits.map((hit) => <div className="hit-row" key={hit.cc}><div className="cc">{hit.cc}<span className="nm">{hit.nm}</span></div><div className="bar"><div className="f" style={{ width: `${Math.round((hit.ct / maxHit) * 100)}%` }} /></div><div className="ct">{hit.ct}</div></div>)}
        </section>

        <section className="edge-card">
          <div className="edge-h"><span className="ic" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></svg></span><div><div className="t">边缘 IP 判定</div><div className="s">· 按访问 IP 判定地区</div></div></div>
          <div className="edge-body">
            <div className="edge-kv"><span className="k">判定源</span><span className={`v ${edgeSourceKnown ? "" : "danger"}`} style={{ display: "flex", alignItems: "center", gap: 8 }}>{currentEdgeSourceLabel}{canEdge && edgeSwitchCandidates.length > 0 && <button onClick={switchJudge}>切换</button>}</span></div>
            {canEdge && edgeSwitchCandidates.length === 0 && <div className="tiny muted">暂无满足最近 5 分钟 20 个可信样本门槛的备用判定源</div>}
            {geoEdge.map((row) => <div className="edge-kv" key={row.k}><span className="k"><AutoGloss>{row.k}</AutoGloss></span><span className={`v ${row.tone}`}><AutoGloss>{row.v}</AutoGloss></span></div>)}
            <div className="edge-note"><span className="ic" aria-hidden="true">ⓘ</span><div><b>地区封锁只按访问 IP；风险提示书按 IP 与账户注册地区。</b>两套机制相互独立。</div></div>
          </div>
        </section>
      </div>

      <section className="deriv-card">
        <div className="deriv-h"><span className="ttl">最近 J2 变更</span><span className="sub">· 来自不可修改的服务端审计记录</span></div>
        <div className="deriv-tblwrap"><div className="deriv-tbl">
          <div className="hd"><div className="c">时间</div><div className="c">操作人</div><div className="c">对象</div><div className="c">理由</div><div className="c">变更前</div><div className="c">变更后</div></div>
          {data.recentChanges.length === 0 && <div className="rw"><div className="c muted" style={{ gridColumn: "1 / -1" }}>暂无 J2 变更记录</div></div>}
          {data.recentChanges.map((change, index) => (
            <div className="rw" key={`${change.createdAt}-${change.resourceId}-${index}`}>
              <div className="c tiny">{change.createdAt || "—"}</div><div className="c">{change.operator || "—"}</div><div className="c"><CodeTag>{geoChangeObjectLabel(change, geoEndpoints, countryNames)}</CodeTag></div><div className="c">{change.reason || "—"}</div><div className="c tiny">{formatGeoChangeValue(change.beforeValue, countryNames, edgeSourceLabels, change.resourceType)}</div><div className="c tiny">{formatGeoChangeValue(change.afterValue, countryNames, edgeSourceLabels, change.resourceType)}</div>
            </div>
          ))}
        </div></div>
      </section>

      <p className="f-foot"><b>封锁在服务端业务入口生效，客户端无法绕过。</b>全局名单与各功能入口规则均以服务端状态为准；每次变更都记录操作者、理由、前后状态和通知事件。</p>
    </div>
  );
}

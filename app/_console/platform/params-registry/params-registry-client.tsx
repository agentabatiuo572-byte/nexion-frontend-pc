"use client";
import "@/app/components/domain-views/a-domain.css";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, ArrowUpRight, Ban, CircleCheck, Database, Globe2, Lock, Power, RefreshCw, Search, SlidersHorizontal, Siren } from "lucide-react";
import {
  BlockState, Button, Cell, Conclusion, ControlCard, ControlGrid, Explain, FilterBar, FilterField, Fold, Input, Notice,
  PageHeader, Panel, RdPage, Select, StatusTag, Table, Td, Th, Tr,
} from "@/app/components/rd";
import { operatorCopyText } from "@/lib/admin/operator-copy";
import { A5LoadError, fetchA5Registry, type A5LoadErrorKind } from "@/lib/admin/a5-client";
import type { A5RegistryOverview, A5RegistryRow } from "@/lib/admin/a5-contract";
import { businessZone, formatBusinessTimeCompact } from "@/lib/admin/business-time";
import { findByPath } from "@/lib/nav/console-nav";
import { useReach } from "@/lib/nav/use-reach";
// 与 E6 共用同一份安装包地址判定(zentao #156):E6 已判为无效的值,A5 不得再把它
// 展示成「当前服务端值」——否则同一事实在两页互相矛盾。
import { isAcceptableDownloadCopy, isSafeInstallerUrl } from "@/lib/admin/installer-url";

/** E6 客户端下载配置里承载文案的四个键(与 ComputeConfigRegistry.DOWNLOAD_FIELDS 对应)。 */
const E6_DOWNLOAD_COPY_KEYS: ReadonlySet<string> = new Set([
  "E.compute.download.zhTitle",
  "E.compute.download.zhGuide",
  "E.compute.download.enTitle",
  "E.compute.download.enGuide",
]);

const H5_RETIRED_KEY = "E.compute.h5BaseFactor";
const CONTINUITY_RETIRED_KEY = "E.compute.continuityFullHours";

/**
 * 该行的当前值是否真的生效。
 *
 * 现在只有客户端下载地址一类的键需要内容级校验:后端只保证「已写入」,不保证值
 * 可下发;E6 会按同一规则把它判为未配置并拦住开关,所以 A5 必须照同一判据显示,
 * 否则运营会在参数寄存器里看到一个实际不生效的值。
 */
function rowValueEffective(row: A5RegistryRow): boolean {
  if (row.canonicalKey === "E.compute.download.url") {
    return isSafeInstallerUrl(row.currentValue.trim());
  }
  // 四段下载文案(中/英标题与说明)与下载地址同属「E6 才能判定是否可下发」的键。
  // E6 用内容质量门(长度 + 测试标点)把它们判为未配置,所以 A5 必须用**同一份规则**,
  // 否则运营在参数寄存器里看到「当前服务端值 · 服务端权威」,而 E6 明明拒绝下发 ——
  // 同一事实两页互相矛盾(zentao #156)。判定函数与 E6 共用同一实现,不再各写一份。
  if (E6_DOWNLOAD_COPY_KEYS.has(row.canonicalKey)) {
    return isAcceptableDownloadCopy(row.currentValue.trim());
  }
  return true;
}

/** 参数索引只呈现可读摘要；结构化正文在归属菜单编辑，原配置值保留在 DTO 中。 */
function parameterValueText(row: A5RegistryRow): string {
  const value = row.currentValue.trim();
  if (!value) return "空值";
  if (E6_DOWNLOAD_COPY_KEYS.has(row.canonicalKey)) return value;
  if (/^[\[{]/.test(value)) {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object") return `已配置 ${Array.isArray(parsed) ? parsed.length : Object.keys(parsed).length} 项，请进入归属模块查看`;
    } catch { /* 非 JSON 的普通文字按原展示处理。 */ }
  }
  if (/^(?:https?:\/\/|\/)/.test(value)) return value;
  return ({ on: "开启", off: "关闭", true: "是", false: "否" } as Record<string,string>)[value] ?? operatorCopyText(value);
}

/** 开关类按 BOOLEAN 单独读：只认 true/false/on/off，其余写「状态待核实」，空值不当「关闭」。 */
function displayValue(row: A5RegistryRow): string {
  if (row.valueType === "BOOLEAN") return ({ true: "开启", false: "关闭", on: "开启", off: "关闭" } as Record<string, string>)[row.currentValue] ?? "状态待核实";
  return parameterValueText(row);
}

const TYPE_LABEL: Record<string, string> = { STRING: "文本", TEXT: "文本", NUMBER: "数值", BOOLEAN: "开关", SECRET: "敏感信息", JSON: "结构化设置", ENUM: "状态" };

const SEARCH_INPUT_ID = "a5-parameter-search";
const DOMAIN_FILTER_ID = "a5-domain-filter";

/**
 * 归属链接的可访问名称(zentao #84)。
 *
 * 同一模块下多条参数卡的链接此前完全同名(「前往A2 审计与追溯：A2 · 操作理由最短长度」),
 * 两个不同 canonical key 只要 displayName 相同,读屏与语音控制就无法区分目标。名称必须
 * 含该卡片自己的参数键才唯一。
 */
function ownerLinkAccessibleName(row: A5RegistryRow) {
  return `前往 ${ownerName(row)}：${operatorCopyText(row.displayName)}（参数 ${row.canonicalKey}）`;
}

const ERROR_COPY: Record<A5LoadErrorKind, { title: string; detail: string }> = {
  auth: { title: "登录已失效", detail: "正在清理旧会话，请重新登录后查看。" },
  forbidden: { title: "没有查看平台参数的权限", detail: "请联系管理员开通「平台参数目录」的查看权限；系统要求先改密码时，改完再打开。" },
  integrity: { title: "数据有误，已停止显示", detail: "参数数据缺字段、格式不对、重复或统计对不上，为避免误判已暂停显示，请联系技术人员。" },
  server: { title: "平台参数加载失败", detail: "暂时无法显示参数，请重新加载；持续失败请联系技术人员。" },
  unavailable: { title: "平台参数暂时无法加载", detail: "参数设置没有被修改，请稍后重新加载。" },
};

const SOURCE_STATUS: Record<string, { label: string; tone: "ok" | "warn" | "neutral" }> = {
  READY: { label: "已就绪", tone: "ok" },
  PARTIAL: { label: "部分可用", tone: "warn" },
  EMPTY: { label: "无记录", tone: "neutral" },
};

/** 后端时间是不带时区的存储时间；解析不了的原文（「默认值」「暂无变更记录」）照原样写。 */
const stamp = (value: string) => formatBusinessTimeCompact(value, value);

/** 归属页现在的菜单名：后端登记的名称可能是旧名，同一页全站只用一个名字。 */
function ownerName(row: A5RegistryRow) {
  return findByPath(row.ownerRoute.split(/[?#]/, 1)[0])?.l2.name ?? operatorCopyText(row.ownerLabel);
}

/** 日期和时刻分两段：窄屏时时刻换到第二行，不截断。 */
function TimeText({ value }: { value: string }) {
  const text = stamp(value);
  const at = text.indexOf(" ");
  return at < 0 ? <>{text}</> : <span className="a5-time"><span>{text.slice(0, at)}</span> <span>{text.slice(at + 1)}</span></span>;
}

export function PlatformParamsRegistry() {
  const [overview, setOverview] = useState<A5RegistryOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorKind, setErrorKind] = useState<A5LoadErrorKind | null>(null);
  const [query, setQuery] = useState("");
  const [domain, setDomain] = useState("ALL");
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(new Set());
  const reach = useReach();

  const load = useCallback(async () => {
    setLoading(true);
    setErrorKind(null);
    try {
      setOverview(await fetchA5Registry());
    } catch (error) {
      setOverview(null);
      setErrorKind(error instanceof A5LoadError ? error.kind : "unavailable");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const domains = useMemo(() => {
    if (!overview) return [];
    return Array.from(new Map(overview.rows.map((row) => [row.domain, row.domainLabel])).entries());
  }, [overview]);

  const visibleRows = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return (overview?.rows ?? []).filter((row) => {
      if (domain !== "ALL" && row.domain !== domain) return false;
      if (!keyword) return true;
      return [row.displayName, row.canonicalKey, row.description, row.ownerLabel, ownerName(row), row.currentValue]
        .some((value) => value.toLowerCase().includes(keyword));
    });
  }, [domain, overview, query]);

  const grouped = useMemo(() => {
    const result = new Map<string, A5RegistryRow[]>();
    for (const row of visibleRows) result.set(row.domain, [...(result.get(row.domain) ?? []), row]);
    return Array.from(result.entries());
  }, [visibleRows]);

  const partialSources = overview?.sources.filter((source) => source.status !== "READY") ?? [];
  const zone = businessZone().label;

  const header = (
    <PageHeader pageId="A5" title="平台参数目录" summary="查一个参数现在的值，再去它所在的页面修改。"
      readOnly="这页只能查看，修改要去参数所在的页面"
      meta={overview ? `读取于 ${stamp(overview.observedAt)}（${zone}）· 不自动刷新` : undefined}
      actions={<Button icon={<RefreshCw size={14} aria-hidden />} onClick={() => void load()}>重新加载</Button>} />
  );

  if (loading) {
    return (
      <RdPage className="a5-page">
        {header}
        <div className="a5-loading" aria-label="正在加载平台参数">
          <div className="rd-skeleton a5-skel-line" />
          <div className="rd-skeleton a5-skel-bar" />
          <div className="rd-skeleton a5-skel-block" />
          <div className="rd-skeleton a5-skel-block" />
        </div>
      </RdPage>
    );
  }

  if (errorKind || !overview) {
    const copy = ERROR_COPY[errorKind ?? "unavailable"];
    return (
      <RdPage className="a5-page">
        {header}
        <Conclusion state="unknown" icon={SlidersHorizontal}>平台参数没读到，这页没有判断</Conclusion>
        <Panel title="平台参数">
          <BlockState state={errorKind === "forbidden" ? "denied" : "error"} title={copy.title} detail={copy.detail}
            retryLabel="重新加载" onRetry={errorKind === "auth" ? undefined : () => void load()} />
        </Panel>
      </RdPage>
    );
  }

  const rows = overview.rows;
  const gates = rows.filter((row) => row.canonicalKey.startsWith("emergency.gate."));
  const geo = rows.find((row) => row.canonicalKey === "emergency.geo-block");
  const emergencySource = overview.sources.find((source) => source.key === "emergency");
  const emergencyPartial = emergencySource?.status === "PARTIAL";
  const gatesMissing = emergencyPartial && gates.length === 0;
  const geoMissing = emergencyPartial && !geo;
  const stopped = gates.filter((row) => row.currentValue === "disabled");
  const geoLimited = geo && geo.currentValue !== "没有限制" ? geo : null;
  const filtered = query.trim() !== "" || domain !== "ALL";
  const domainCounts = new Map<string, number>();
  for (const row of rows) domainCounts.set(row.domain, (domainCounts.get(row.domain) ?? 0) + 1);
  const clear = () => { setQuery(""); setDomain("ALL"); };
  const stats = overview.stats;

  const conclusion = stopped.length > 0 ? (
    <Conclusion state="warn" lead icon={Siren}
      hint="去「紧急停用开关」看原因和恢复审批"
      explain="「已关停」取自紧急停用开关的当前状态。这里只显示状态，不能在这页恢复。">
      有 {stopped.length} 个业务已紧急关停：{stopped.map((row) => operatorCopyText(row.displayName)).join("、")}
    </Conclusion>
  ) : partialSources.length > 0 ? (
    <Conclusion state="warn" icon={SlidersHorizontal} hint="已读到的参数照常显示；哪一类不完整、为什么，见下方提示"
      explain="紧急开关、地区访问限制和系统健康分开读取，其中一类没读到不影响其他参数；系统参数本身读不到时整页读不到。没读到的值不会显示成正常或 0。">
      有 {partialSources.length} 个来源不完整，已读到 {stats.registeredCount} 项
    </Conclusion>
  ) : (
    <Conclusion state="ok" icon={SlidersHorizontal}
      explain="参数数是这次读到的全部启用参数，不含还没登记所属页面的参数。「在线」取自紧急停用开关的当前状态。">
      共 {stats.registeredCount} 项参数{gates.length > 0 ? "，紧急开关全部在线" : ""}{geoLimited ? `；地区访问限制：${operatorCopyText(geoLimited.currentValue)}` : ""}
    </Conclusion>
  );

  const ownerCell = (row: A5RegistryRow) => {
    const name = ownerName(row);
    if (row.canonicalKey === H5_RETIRED_KEY) return <Cell main={<span className="a5-muted">没有修改入口</span>} sub="已停用，值固定为 0" />;
    const path = row.ownerRoute.split(/[?#]/, 1)[0];
    if (!findByPath(path)) return <Cell main={name} sub="这一页还没有上线" />;
    if (!reach(row.ownerRoute)) return <Cell main={name} sub="你的账号进不去这一页" />;
    return (
      <Cell main={<Link className="rd-link a5-owner" href={row.ownerRoute} prefetch={false} aria-label={ownerLinkAccessibleName(row)}>{name}</Link>}
        sub={row.canonicalKey === CONTINUITY_RETIRED_KEY ? "去那里只能查看" : undefined} />
    );
  };

  const statusCell = (row: A5RegistryRow) => {
    if (row.canonicalKey === H5_RETIRED_KEY) return <StatusTag tone="done" icon={Ban}>已停用</StatusTag>;
    if (row.canonicalKey === CONTINUITY_RETIRED_KEY) return <StatusTag tone="done" icon={Ban}>已退役</StatusTag>;
    if (row.live && row.stale) return <StatusTag tone="warn">没读到实时值</StatusTag>;
    if (row.live) return <StatusTag tone="neutral" icon={Activity}>实时读取</StatusTag>;
    if (row.stale) return <StatusTag tone="warn">旧值已过期</StatusTag>;
    if (!rowValueEffective(row)) return <StatusTag tone="warn" explain={`这个值不合规，目前没有生效，请到「${ownerName(row)}」改正后重新保存。`}>未生效</StatusTag>;
    return <StatusTag tone="neutral" icon={CircleCheck}>已启用</StatusTag>;
  };

  const timeCell = (row: A5RegistryRow) => {
    if (row.live) {
      return row.observedAt ? <Cell num main={<TimeText value={row.observedAt} />} sub="采样时间" /> : <Cell main={<span className="a5-muted">—</span>} sub="这次没有采样" />;
    }
    if (row.updatedAt === "默认值") return <Cell main={<span className="a5-muted">默认值</span>} sub="还没有保存过" />;
    if (!row.updatedAt || row.updatedAt === "未知") return <Cell main={<span className="a5-muted">—</span>} sub="时间未知" />;
    return <Cell num main={<TimeText value={row.updatedAt} />} />;
  };

  const valueCell = (row: A5RegistryRow) => {
    const text = displayValue(row);
    const secret = row.valueType === "SECRET";
    const weak = text === "空值" || text === "—";
    return (
      <Cell title={text} main={<span className="a5-value" data-tone={row.stale || !rowValueEffective(row) ? "warn" : weak ? "weak" : undefined}>
        {secret && <Lock size={12} aria-hidden />}{text}{row.unit ? <span className="a5-unit">{operatorCopyText(row.unit)}</span> : null}
      </span>} sub={TYPE_LABEL[row.valueType] ?? "其他类型"} />
    );
  };

  const emergencyCard = (row: A5RegistryRow) => {
    const isGeo = row.canonicalKey === "emergency.geo-block";
    const name = operatorCopyText(row.displayName);
    const on = isGeo ? row.currentValue === "没有限制" : row.currentValue === "enabled";
    const known = isGeo || row.currentValue === "enabled" || row.currentValue === "disabled";
    const status = isGeo
      ? <StatusTag tone={on ? "ok" : "warn"} icon={on ? undefined : Globe2}>{operatorCopyText(row.currentValue)}</StatusTag>
      : !known ? <StatusTag tone="warn">状态待核实</StatusTag>
        : on ? <StatusTag tone="ok">在线</StatusTag> : <StatusTag tone="warn" icon={Power}>已关停</StatusTag>;
    const changed = !row.updatedAt || row.updatedAt === "未知" ? "最近变更 —"
      : Number.isFinite(Date.parse(row.updatedAt.replace(" ", "T"))) ? `最近变更 ${stamp(row.updatedAt)}` : operatorCopyText(row.updatedAt);
    return (
      <ControlCard key={row.canonicalKey} title={name} icon={isGeo ? Globe2 : Power} tone={on ? "ok" : "warn"} attention={!on}
        explain={[{ k: "这是什么", v: operatorCopyText(row.description) }, { k: "时间", v: "最近一次变更的时间，不是读取时间" }, { k: "参数键", v: row.canonicalKey }]}
        status={<span className="a5-card-status">{status}<span className="a5-card-time">{changed}</span></span>}
        action={reach(row.ownerRoute)
          ? <Link className="rd-link a5-owner" href={row.ownerRoute} prefetch={false} aria-label={ownerLinkAccessibleName(row)}>{on ? "查看" : "去处理"}<ArrowUpRight size={12} aria-hidden /></Link>
          : <span className="a5-muted">你的账号进不去「{ownerName(row)}」</span>} />
    );
  };

  const emergencyRows = grouped.find(([code]) => code === "J")?.[1] ?? [];
  const otherGroups = grouped.filter(([code]) => code !== "J");
  const emergencyShown = emergencyRows.length > 0 || (!filtered && emergencyPartial) || (domain === "J" && emergencyPartial);
  const orderedEmergency = [...emergencyRows].sort((a, b) => Number(a.currentValue !== "disabled") - Number(b.currentValue !== "disabled"));

  return (
    <RdPage className="a5-page">
      {header}
      {conclusion}

      {partialSources.length > 0 && (
        <Notice tone="warn" title="有的来源不完整">
          {partialSources.map((source) => <p key={source.key}>{source.label}：{source.key === "emergency" && emergencyShown ? "具体是哪一类没读到，见下方「紧急开关」" : operatorCopyText(source.detail)}</p>)}
        </Notice>
      )}

      {rows.length === 0 ? (
        <Panel title="平台参数">
          <BlockState state="empty" title="暂无平台参数" detail="当前没有启用中的参数。" retryLabel="重新加载" onRetry={() => void load()} />
        </Panel>
      ) : (
        <>
          <div className="a5-search">
            <FilterBar onClear={clear} canClear={filtered} clearLabel="清除条件"
              sort={<span className="rd-filter-result" role="status">{filtered ? `找到 ${visibleRows.length} 项` : `共 ${stats.registeredCount} 项 · ${stats.domainCount} 个模块`}</span>}>
              <FilterField grow>
                <span className="a5-search-box">
                  <Search size={16} aria-hidden />
                  <Input id={SEARCH_INPUT_ID} aria-label="搜索平台参数" placeholder="搜索参数名、参数键、当前值或所在页面" value={query} onChange={(event) => setQuery(event.target.value)} />
                </span>
              </FilterField>
              <FilterField>
                <Select id={DOMAIN_FILTER_ID} aria-label="模块筛选" value={domain} onChange={setDomain}
                  options={[{ value: "ALL", label: "全部模块" }, ...domains.map(([code, label]) => ({ value: code, label: `${code} · ${operatorCopyText(label)}（${domainCounts.get(code) ?? 0}）` }))]} />
              </FilterField>
            </FilterBar>
          </div>

          {grouped.length === 0 && !emergencyShown ? (
            <Panel title="搜索结果">
              <BlockState state="empty" title="没有匹配的参数"
                detail={<>
                  <p>换个关键词或模块试试。参数名、参数键、当前值和所在页面都能搜，比如参数键的一段「withdraw」。</p>
                  <p>这里只收录启用中、已登记所属页面的参数{partialSources.some((source) => source.key === "config") ? "；有一部分参数还没登记所属页面，见上方提示" : ""}。</p>
                </>}
                retryLabel="清除条件" onRetry={clear} />
            </Panel>
          ) : (
            <div className="a5-groups">
              {emergencyShown && (
                <Panel icon={Siren} tone="role-3" title="紧急开关"
                  sub={`${gatesMissing ? "业务开关没读到" : `${gates.length} 个业务开关`}${geo ? " · 地区访问限制" : ""}`}
                  explain="紧急停用开关和地区访问限制的当前状态。这里只读，关停和恢复在各自的页面操作。">
                  {(gatesMissing || geoMissing) && (
                    <Notice tone="warn" title={gatesMissing && geoMissing ? "紧急开关和地区访问限制都没读到" : gatesMissing ? "紧急停用开关没读到" : "地区访问限制没读到"}>
                      未知状态不会显示成在线，请到对应页面查看。
                    </Notice>
                  )}
                  {orderedEmergency.length > 0 && <ControlGrid label="紧急开关">{orderedEmergency.map(emergencyCard)}</ControlGrid>}
                </Panel>
              )}
              {otherGroups.map(([code, groupRows]) => {
                const label = operatorCopyText(groupRows[0].domainLabel);
                const owners = Array.from(new Set(groupRows.map(ownerName)));
                const attention = groupRows.filter((row) => row.stale || !rowValueEffective(row)).length;
                return (
                  <Fold key={code} icon={Database} title={`${code} ${label}`}
                    summary={`${groupRows.length} 项${filtered ? "匹配" : ""} · 在${owners.length > 3 ? `${owners.slice(0, 3).join("、")}等 ${owners.length} 页` : owners.join("、")}修改${attention > 0 ? ` · ${attention} 项要核对` : ""}`}
                    alert={attention > 0}
                    open={filtered || openGroups.has(code)}
                    onOpenChange={(open) => setOpenGroups((current) => { const next = new Set(current); if (open) next.add(code); else next.delete(code); return next; })}>
                    <Table label={`${label}的参数`} className="a5-table">
                      <thead><tr>
                        <Th>参数</Th>
                        <Th>当前值</Th>
                        <Th><Explain label="状态是什么意思" rows={[
                          { k: "已启用", v: "这条配置是启用状态、读得到；不代表业务已经在用它" },
                          { k: "实时读取", v: "每次打开这页时现查的系统健康指标，这页不会自己刷新" },
                          { k: "敏感信息", v: "后端只告诉这里已配置，值已脱敏，不代表一定可用" },
                          { k: "已停用", v: "H5 基础托管系数不再参与计算，值固定为 0" },
                          { k: "已退役", v: "不再参与计算的旧参数，保留原值，只能查看" },
                        ]}>状态</Explain></Th>
                        <Th>最近修改<span className="a5-th-zone">{zone}</span></Th>
                        <Th>在哪改</Th>
                      </tr></thead>
                      <tbody>
                        {groupRows.map((row) => (
                          <Tr key={row.canonicalKey}>
                            <Td><Cell full
                              main={<span className="a5-name">{operatorCopyText(row.displayName)}<Explain label={`${operatorCopyText(row.displayName)}的说明`} content={operatorCopyText(row.description)} /></span>}
                              sub={<span data-mono>{row.canonicalKey}</span>} /></Td>
                            <Td>{valueCell(row)}</Td>
                            <Td>{statusCell(row)}</Td>
                            <Td>{timeCell(row)}</Td>
                            <Td>{ownerCell(row)}</Td>
                          </Tr>
                        ))}
                      </tbody>
                    </Table>
                  </Fold>
                );
              })}
            </div>
          )}
        </>
      )}

      <Fold title="数据来源" icon={Database}
        summary={`${overview.sources.length} 个来源，${partialSources.length === 0 ? "全部就绪" : `${partialSources.length} 个不完整`} · ${stats.registeredCount} 项参数 · ${stats.domainCount} 个模块 · ${stats.highSensitivityCount} 项修改需确认`}
        alert={partialSources.length > 0}
        explain="「修改需确认」是后端标记的数量，不保证所在页面一定弹确认框；不是走审批的数量，也不是敏感信息的数量。">
        <Table label="数据来源">
          <thead><tr><Th>来源</Th><Th>状态</Th><Th align="right">条数</Th><Th>说明</Th></tr></thead>
          <tbody>
            {overview.sources.map((source) => (
              <Tr key={source.key}>
                <Td><Cell main={source.label} /></Td>
                <Td><Cell main={<StatusTag tone={SOURCE_STATUS[source.status]?.tone ?? "neutral"}>{SOURCE_STATUS[source.status]?.label ?? source.status}</StatusTag>} /></Td>
                <Td align="right"><Cell num main={`${source.rowCount} 条`} /></Td>
                <Td grow><Cell main={operatorCopyText(source.detail)} title={operatorCopyText(source.detail)} /></Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Fold>
    </RdPage>
  );
}

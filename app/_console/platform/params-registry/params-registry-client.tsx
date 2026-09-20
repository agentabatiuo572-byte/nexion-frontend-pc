"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowUpRight, Database, RefreshCw, Search, ShieldCheck } from "lucide-react";
import { A5LoadError, fetchA5Registry, type A5LoadErrorKind } from "@/lib/admin/a5-client";
import type { A5RegistryOverview, A5RegistryRow } from "@/lib/admin/a5-contract";
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

/**
 * 该行的当前值是否真的生效。
 *
 * 现在只有客户端下载地址一类的键需要内容级校验:后端只保证「已写入」,不保证值
 * 可下发;E6 会按同一规则把它判为未配置并拦住开关,所以 A5 必须照同一判据显示,
 * 否则运营会在参数寄存器里看到一个实际不生效的值。
 */
/**
 * 值区顶部标签(zentao #198)。
 *
 * 三种事实必须能一眼分开:实时采样的权威值、已过期的历史快照、以及普通配置行。
 * 此前健康类键与配置键共用「当前服务端值」一句,于是 A3 的「严重积压」与 A5 的
 * 「正常 · 延迟 1.2s」同屏出现且都自称当前值。
 */
function rowValueLabel(row: A5RegistryRow): string {
  if (row.live) {
    return row.stale
      ? "实时采样 · 当前不可用"
      : `实时采样${row.observedAt ? ` · 观测于 ${row.observedAt}` : ""}`;
  }
  if (row.stale) return "历史快照 · 已过期";
  return rowValueEffective(row) ? "当前服务端值" : "当前服务端值 · 未生效";
}

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

const DOMAIN_ACCENT: Record<string, string> = {
  A: "var(--admin-domain-a)", B: "var(--admin-domain-b)", C: "var(--admin-domain-c)",
  D: "var(--admin-domain-d)", E: "var(--admin-domain-e)", F: "var(--admin-domain-f)",
  G: "var(--admin-domain-g)", H: "var(--admin-domain-h)", I: "var(--admin-domain-i)",
  J: "var(--admin-domain-j)", K: "var(--admin-domain-k)", L: "var(--admin-domain-l)",
  M: "var(--admin-domain-m)",
};

const ERROR_COPY: Record<A5LoadErrorKind, { title: string; detail: string }> = {
  auth: { title: "登录已失效", detail: "正在清理旧会话，请重新登录后查看。" },
  forbidden: { title: "没有查看平台参数寄存器的权限", detail: "请联系管理员授予 A5 只读权限；其他平台权限不会代替 A5 权限。" },
  integrity: { title: "数据一致性校验未通过", detail: "本页已停止展示可疑数据，避免把重复键或错误统计当成真实参数。" },
  server: { title: "平台参数服务返回异常", detail: "服务已响应但未能完成本次读取，当前不展示任何参数值；请重新加载或联系平台运维。" },
  unavailable: { title: "平台参数服务暂时不可用", detail: "现有配置没有被修改。请稍后重新加载；若持续失败，请检查后端服务。" },
};

export function PlatformParamsRegistry() {
  const [overview, setOverview] = useState<A5RegistryOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorKind, setErrorKind] = useState<A5LoadErrorKind | null>(null);
  const [query, setQuery] = useState("");
  const [domain, setDomain] = useState("ALL");

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
      return [row.displayName, row.canonicalKey, row.description, row.ownerLabel, row.currentValue]
        .some((value) => value.toLowerCase().includes(keyword));
    });
  }, [domain, overview, query]);

  const grouped = useMemo(() => {
    const result = new Map<string, A5RegistryRow[]>();
    for (const row of visibleRows) result.set(row.domain, [...(result.get(row.domain) ?? []), row]);
    return Array.from(result.entries());
  }, [visibleRows]);

  const partialSources = overview?.sources.filter((source) => source.status !== "READY") ?? [];

  return (
    <div className="mx-auto w-full max-w-[1240px]">
      <header className="mb-4">
        <p className="font-mono-tabular text-[11px]" style={{ color: "var(--admin-domain-a)" }}>A5 · 平台基础</p>
        <h1 className="font-display mt-1 text-[24px]" style={{ color: "var(--v5-ink)" }}>平台参数寄存器</h1>
        <p className="mt-1.5 max-w-[820px] text-[12.5px] leading-relaxed" style={{ color: "var(--v5-ink-3)" }}>
          汇总服务端当前启用的跨域参数与 J1/J2 实时状态。这里是只读索引；修改请进入每行标明的归属模块。
        </p>
      </header>

      {loading ? (
        <StateCard title="正在读取平台参数" detail="正在核对服务端当前值与归属模块……" spinning />
      ) : errorKind ? (
        <StateCard title={ERROR_COPY[errorKind].title} detail={ERROR_COPY[errorKind].detail} tone="danger" onRetry={errorKind === "auth" ? undefined : load} />
      ) : overview ? (
        <>
          <div className="mb-4 flex flex-wrap gap-2.5">
            <Stat label="服务端参数" value={`${overview.stats.registeredCount}`} accent="var(--admin-domain-a)" />
            <Stat label="覆盖业务域" value={`${overview.stats.domainCount}`} />
            <Stat label="需操作确认" value={`${overview.stats.highSensitivityCount}`} accent="var(--v5-warning)" />
            <Stat label="数据来源" value={`${overview.stats.sourceCount}`} sub={`核对于 ${formatTime(overview.observedAt)}`} />
          </div>

          {partialSources.length > 0 && (
            <div className="mb-4 flex items-start gap-2 rounded-[10px] p-3 text-[12px]" style={{ background: "var(--v5-warning-soft)", color: "var(--v5-warning)" }}>
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <div>
                <b>部分来源未就绪</b>
                {partialSources.map((source) => <p key={source.key} className="mt-0.5">{source.label}：{source.detail}</p>)}
              </div>
            </div>
          )}

          {overview.rows.length === 0 ? (
            <StateCard title="尚未登记服务端参数" detail="当前没有启用中的服务端参数；本页不会用前端常量或文档占位值补齐。" onRetry={load} />
          ) : (
            <>
              <div className="mb-4 grid gap-2 sm:grid-cols-[minmax(240px,1fr)_220px_auto]">
                <label className="flex items-center gap-2 rounded-[9px] px-3" style={{ background: "var(--v5-surface)", border: "1px solid var(--v5-border)" }}>
                  <Search size={15} style={{ color: "var(--v5-ink-4)" }} />
                  <input aria-label="搜索平台参数" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索参数名称、参数键、当前值或归属模块" className="min-w-0 flex-1 bg-transparent py-2 text-[12px] outline-none" style={{ color: "var(--v5-ink)" }} />
                </label>
                <select aria-label="业务域筛选" value={domain} onChange={(event) => setDomain(event.target.value)} className="rounded-[9px] px-3 py-2 text-[12px] outline-none" style={{ background: "var(--v5-surface)", border: "1px solid var(--v5-border)", color: "var(--v5-ink)" }}>
                  <option value="ALL">全部业务域</option>
                  {domains.map(([code, label]) => <option key={code} value={code}>{code} · {label}</option>)}
                </select>
                <button type="button" onClick={() => void load()} className="inline-flex items-center justify-center gap-1.5 rounded-[9px] px-3 py-2 text-[12px]" style={{ background: "var(--v5-surface)", border: "1px solid var(--v5-border)", color: "var(--v5-ink-2)" }}>
                  <RefreshCw size={14} />重新加载
                </button>
              </div>

              {grouped.length === 0 ? (
                <StateCard title="没有匹配的参数" detail="请调整关键词或业务域筛选条件。" />
              ) : (
                <div className="flex flex-col gap-3.5">
                  {grouped.map(([domainCode, rows]) => (
                    <DomainSection key={domainCode} domain={domainCode} rows={rows} />
                  ))}
                </div>
              )}
            </>
          )}

          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {overview.sources.map((source) => (
              <div key={source.key} className="rounded-[9px] px-3 py-2 text-[11px]" style={{ background: "var(--v5-surface)", border: "1px solid var(--v5-border)", color: "var(--v5-ink-3)" }}>
                <span className="inline-flex items-center gap-1.5"><Database size={12} />{source.label}</span>
                <span className="ml-2 font-mono-tabular" style={{ color: source.status === "READY" ? "var(--v5-success)" : "var(--v5-warning)" }}>{source.status === "READY" ? "已就绪" : source.status === "EMPTY" ? "无记录" : "部分可用"}</span>
                <p className="mt-1">{source.rowCount} 条 · {source.detail}</p>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

function DomainSection({ domain, rows }: { domain: string; rows: A5RegistryRow[] }) {
  const accent = DOMAIN_ACCENT[domain] ?? "var(--admin-domain-a)";
  return (
    <section className="rounded-[12px] p-4" style={{ background: "var(--v5-surface)", border: "1px solid var(--v5-border)" }}>
      <div className="mb-3 flex items-center gap-2">
        <span className="font-mono-tabular rounded-[6px] px-1.5 py-0.5 text-[11px]" style={{ background: `color-mix(in srgb, ${accent} 16%, transparent)`, color: accent }}>{domain}</span>
        <span className="font-display text-[14px]" style={{ color: "var(--v5-ink)" }}>{rows[0].domainLabel}</span>
        <span className="font-mono-tabular text-[10.5px]" style={{ color: "var(--v5-ink-4)" }}>{rows.length} 项</span>
      </div>
      <div className="grid gap-2 lg:grid-cols-2">
        {rows.map((row) => (
          <article key={row.canonicalKey} className="rounded-[9px] p-3" style={{ background: "var(--v5-surface-2)", border: "1px solid color-mix(in srgb, var(--v5-border) 75%, transparent)" }}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-[12.5px] font-semibold leading-snug" style={{ color: "var(--v5-ink)" }}>{row.displayName}</p>
                <p className="font-mono-tabular mt-1 break-all text-[10px]" style={{ color: "var(--v5-ink-4)" }}>参数键 · {row.canonicalKey}</p>
              </div>
              {/* 归属链接此前只暴露模块名(如「A2 审计与追溯」),同一模块下多条链接完全同名,
                  读屏与语音控制无法区分目标。名称必须含该卡片的参数本身。 */}
              <Link href={row.ownerRoute} prefetch={false} aria-label={`前往${row.ownerLabel}：${row.displayName}`} className="inline-flex shrink-0 items-center gap-1 rounded-[7px] px-2 py-1 text-[10.5px]" style={{ border: "1px solid var(--v5-border)", color: accent }}>
                {row.ownerLabel}<ArrowUpRight size={11} />
              </Link>
            </div>
            <div className="mt-2 rounded-[7px] px-2.5 py-2" style={{ background: "var(--v5-surface)" }}>
              {/* 🔴 值标签必须说清这个数是不是实时权威事实(zentao #198)。
                  实时行标「实时采样 · 观测于 …」;过期/读不到的行标「历史快照 · 已过期」——
                  不许把 2026-06-24 的死行显示成「当前服务端值」。 */}
              <p className="text-[9.5px]" style={{ color: row.stale ? "var(--v5-warning)" : "var(--v5-ink-4)" }}>{rowValueLabel(row)}</p>
              <p className="font-mono-tabular mt-0.5 break-all text-[13px]" style={{ color: rowValueEffective(row) && !row.stale ? "var(--v5-ink)" : "var(--v5-warning)" }}>{row.currentValue || "空值"}{row.unit ? <span className="ml-1 text-[10px]" style={{ color: "var(--v5-ink-3)" }}>{row.unit}</span> : null}</p>
              {row.stale && (
                <p className="mt-1 text-[10px] leading-relaxed" style={{ color: "var(--v5-warning)" }}>
                  该值不是当前实时事实{row.observedAt ? `（最近采样 ${row.observedAt}）` : "（实时读取失败）"}；请以{row.ownerLabel}的实时页面为准，不要把这里的快照当成当前状态。
                </p>
              )}
              {!rowValueEffective(row) && (
                <p className="mt-1 text-[10px] leading-relaxed" style={{ color: "var(--v5-warning)" }}>
                  该值未通过归属模块的有效性校验，当前不生效、也不会下发给用户端；请在{row.ownerLabel}修正后重新保存。
                </p>
              )}
            </div>
            <p className="mt-2 text-[10.5px] leading-relaxed" style={{ color: "var(--v5-ink-3)" }}>{row.description}</p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[9.5px]" style={{ color: "var(--v5-ink-4)" }}>
              <span className="rounded-full px-1.5 py-0.5" style={{ background: "var(--v5-surface)" }}>{row.valueType}</span>
              {/* 过期/读不到的实时行不得标「服务端权威」(zentao #198):那句声明的是
                  「这就是当前生效的服务端事实」,而陈旧快照恰恰不是。 */}
              {row.stale
                ? <span className="rounded-full px-1.5 py-0.5" style={{ background: "var(--v5-warning-soft)", color: "var(--v5-warning)" }}>历史快照 · 已过期</span>
                : rowValueEffective(row)
                  ? <span className="rounded-full px-1.5 py-0.5" style={{ background: "var(--v5-success-soft)", color: "var(--v5-success)" }}>{row.live ? "实时权威" : "服务端权威"}</span>
                  : <span className="rounded-full px-1.5 py-0.5" style={{ background: "var(--v5-warning-soft)", color: "var(--v5-warning)" }}>已存储 · 未生效</span>}
              {row.operationConfirm && <span className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5" style={{ background: "var(--v5-warning-soft)", color: "var(--v5-warning)" }}><ShieldCheck size={9} />修改需确认</span>}
              <span>更新于 {formatTime(row.live && row.observedAt ? row.observedAt : row.updatedAt)}</span>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function StateCard({ title, detail, tone, spinning, onRetry }: { title: string; detail: string; tone?: "danger"; spinning?: boolean; onRetry?: () => void | Promise<void> }) {
  return (
    <section className="rounded-[12px] p-5" role={tone === "danger" ? "alert" : "status"} style={{ background: "var(--v5-surface)", border: `1px solid ${tone === "danger" ? "var(--v5-danger)" : "var(--v5-border)"}` }}>
      <div className="flex items-start gap-2">
        {tone === "danger" ? <AlertTriangle size={17} style={{ color: "var(--v5-danger)" }} /> : spinning ? <RefreshCw size={17} className="animate-spin" style={{ color: "var(--admin-domain-a)" }} /> : <Database size={17} style={{ color: "var(--admin-domain-a)" }} />}
        <div>
          <p className="font-display text-[14px]" style={{ color: "var(--v5-ink)" }}>{title}</p>
          <p className="mt-1 text-[12px]" style={{ color: "var(--v5-ink-3)" }}>{detail}</p>
          {onRetry && <button type="button" onClick={() => void onRetry()} className="mt-3 inline-flex items-center gap-1.5 rounded-[8px] px-3 py-1.5 text-[11px]" style={{ background: "var(--v5-brand-soft)", color: "var(--v5-brand)" }}><RefreshCw size={12} />重新加载</button>}
        </div>
      </div>
    </section>
  );
}

function Stat({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="rounded-[9px] px-3 py-2" style={{ background: "var(--v5-surface)", border: "1px solid var(--v5-border)" }}>
      <p className="text-[10.5px]" style={{ color: "var(--v5-ink-4)" }}>{label}</p>
      <p className="font-mono-tabular text-[15px]" style={{ color: accent || "var(--v5-ink)" }}>{value}</p>
      {sub && <p className="text-[9.5px]" style={{ color: "var(--v5-ink-4)" }}>{sub}</p>}
    </div>
  );
}

function formatTime(value: string) {
  if (!value || value === "未知") return "未知";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value.replace("T", " ") : parsed.toLocaleString("zh-CN", { hour12: false });
}

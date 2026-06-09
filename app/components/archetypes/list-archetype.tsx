"use client";

/**
 * ListArchetype — 表格型模块通用页(审计/对账/订单/KYC/佣金/风控命中/CMS 列表…)。
 * KPI 带 + FilterBar(搜索+chip)+ DataTable(状态 pill 着色)+ 可选行详情抽屉 + Maker-Checker 脚注。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, X, Check, Lock, ShieldCheck, Plus } from "lucide-react";
import { DataTable, type Column } from "@/app/components/kit/data-table";
import { FilterBar, FilterChip } from "@/app/components/kit/filter-bar";
import { KpiStatCard } from "@/app/components/kit/kpi-stat-card";
import { useIsSuperadmin } from "@/lib/store/use-admin-role";
import { AutoGloss } from "@/app/components/kit/gloss";
import type { ListSpec } from "@/lib/admin/module-content";

function statusTone(v: string): string {
  if (/通过|正常|已放行|达标|启用|在售|成功|健康|完成|已结|生效|上线|有效|解锁|已退款|上架|在架|促销/.test(v)) return "var(--v5-success)";
  if (/待|审核中|复核|延迟|冷却|预警|警戒|处理中|排队|草稿|灰度|观察|限制/.test(v)) return "var(--v5-warning)";
  if (/冻结|拒绝|高危|失败|超限|异常|跌破|封禁|风险|拦截|下架|逾期|暂停/.test(v)) return "var(--v5-danger)";
  return "var(--v5-ink-3)";
}

export function ListArchetype({ spec, accent }: { spec: ListSpec; accent: string }) {
  const isSuper = useIsSuperadmin();
  const [q, setQ] = useState("");
  const filters = spec.filters ?? [];
  const [chip, setChip] = useState(filters[0] ?? "全部");
  const [detail, setDetail] = useState<Record<string, string> | null>(null);
  const [actedLabel, setActedLabel] = useState<string | null>(null);
  const drawerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    setActedLabel(null); // 切换/关闭记录时复位操作状态
    if (!detail) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDetail(null);
    };
    document.addEventListener("keydown", onKey);
    drawerRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [detail]);

  // 抽屉双签:若该行处于待处理态,给出 Maker-Checker 操作
  const statusCol = spec.columns.find((c) => c.status);
  const detailPending = !!(detail && statusCol && /待|审核中|复核|研判|审批|挂起/.test(detail[statusCol.key] ?? ""));

  // 主操作(新增)创建抽屉
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState(false);
  const createRef = useRef<HTMLElement>(null);
  useEffect(() => {
    setCreated(false);
    if (!creating) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCreating(false);
    };
    document.addEventListener("keydown", onKey);
    createRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [creating]);

  const filtered = useMemo(() => {
    let rows = spec.rows;
    if (spec.filterKey && filters.length && chip !== filters[0]) {
      rows = rows.filter((r) => r[spec.filterKey!] === chip);
    }
    if (q.trim()) {
      const s = q.trim().toLowerCase();
      rows = rows.filter((r) => Object.values(r).some((v) => String(v).toLowerCase().includes(s)));
    }
    return rows;
  }, [spec, q, chip, filters]);

  const columns: Column<Record<string, string>>[] = spec.columns.map((c) => ({
    key: c.key,
    header: c.header,
    align: c.align,
    mono: c.mono,
    sortValue: (r) => r[c.key] ?? "",
    render: c.status
      ? (r) => (
          <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px]" style={{ background: `color-mix(in srgb, ${statusTone(r[c.key])} 15%, transparent)`, color: statusTone(r[c.key]) }}>
            <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: statusTone(r[c.key]) }} />
            {r[c.key]}
          </span>
        )
      : undefined,
  }));
  if (spec.detail) {
    columns.push({ key: "__act", header: "", align: "right", render: () => <ChevronRight size={14} style={{ color: "var(--v5-ink-4)" }} aria-hidden /> });
  }

  return (
    <div className="mt-5">
      {spec.metrics && spec.metrics.length > 0 && (
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {spec.metrics.map((m) => (
            <KpiStatCard key={m.label} label={m.label} value={m.value} accent={m.accent ?? accent} sublabel={m.sub} hint={m.hint} delta={m.delta} />
          ))}
        </div>
      )}

      <div className="mb-3 flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <FilterBar search={q} onSearch={setQ} placeholder={spec.search ?? "搜索…"} resultCount={filtered.length}>
            {filters.map((f) => (
              <FilterChip key={f} label={f} active={chip === f} onClick={() => setChip(f)} accent={accent} />
            ))}
          </FilterBar>
        </div>
        {spec.primaryAction && (
          <button
            type="button"
            onClick={() => { setDetail(null); setCreating(true); }}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-[9px] px-3.5 py-2 text-[13px] font-medium transition-opacity hover:opacity-90"
            style={{ background: "var(--v5-brand)", color: "var(--v5-on-brand)" }}
          >
            <Plus size={15} aria-hidden /> {spec.primaryAction.label}
          </button>
        )}
      </div>

      <DataTable
        columns={columns}
        rows={filtered}
        getRowId={(r) => r[spec.rowIdKey ?? spec.columns[0].key]}
        onRowClick={spec.detail ? (r) => { setCreating(false); setDetail(r); } : undefined}
        empty="无匹配记录"
      />

      {spec.note && <p className="mt-2.5 text-[11.5px]" style={{ color: "var(--v5-ink-4)" }}><AutoGloss>{spec.note}</AutoGloss></p>}

      {detail && (
        <>
          <div className="fixed inset-0" style={{ background: "rgba(0,0,0,0.5)", zIndex: "var(--admin-z-drawer)" }} onClick={() => setDetail(null)} aria-hidden />
          <aside
            ref={drawerRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            className="fixed right-0 top-0 flex h-screen w-full max-w-[380px] flex-col"
            style={{ background: "var(--v5-surface)", borderLeft: "1px solid var(--v5-border-strong)", boxShadow: "-16px 0 48px rgba(0,0,0,0.55)", zIndex: "calc(var(--admin-z-drawer) + 1)", outline: "none" }}
          >
            <div className="flex items-center gap-3 px-5 py-4" style={{ borderBottom: "1px solid var(--v5-border)" }}>
              <span className="font-display text-[15px]" style={{ color: "var(--v5-ink)" }}>记录详情</span>
              <span className="font-mono-tabular text-[12px]" style={{ color: accent }}>{detail[spec.columns[0].key]}</span>
              <button type="button" onClick={() => setDetail(null)} aria-label="关闭" className="ml-auto grid h-8 w-8 place-items-center rounded-[9px]" style={{ border: "1px solid var(--v5-border)", color: "var(--v5-ink-3)" }}>
                <X size={15} aria-hidden />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-2">
              {spec.columns.map((c) => (
                <div key={c.key} className="flex items-start justify-between gap-4 py-2.5" style={{ borderBottom: "1px solid var(--v5-border)" }}>
                  <span className="text-[12.5px]" style={{ color: "var(--v5-ink-3)" }}><AutoGloss>{c.header}</AutoGloss></span>
                  <span className={`text-right text-[12.5px] ${c.mono ? "font-mono-tabular" : ""}`} style={{ color: c.status ? statusTone(detail[c.key]) : "var(--v5-ink-2)" }}>{detail[c.key]}</span>
                </div>
              ))}
            </div>
            {/* 行级操作 footer:声明的 rowActions(状态门控)/ 待办默认双签 / 终态 */}
            {(() => {
              const acts = (spec.rowActions ?? []).filter(
                (a) => !a.whenStatus || (statusCol ? (detail[statusCol.key] ?? "").includes(a.whenStatus) : true),
              );
              const showDefault = acts.length === 0 && detailPending;
              if (acts.length === 0 && !detailPending) {
                return (
                  <div className="px-5 py-3.5 text-[12px]" style={{ borderTop: "1px solid var(--v5-border)", color: "var(--v5-ink-4)" }}>
                    该记录为终态,无待办操作。
                  </div>
                );
              }
              return (
                <div className="px-5 py-4" style={{ borderTop: "1px solid var(--v5-border)", background: "var(--v5-surface-2)" }}>
                  {actedLabel ? (
                    <span className="inline-flex items-center gap-1.5 text-[13px]" style={{ color: "var(--v5-success)", fontWeight: 500 }}>
                      <Check size={15} aria-hidden /> 已{actedLabel} · {isSuper ? "即时生效" : "提交复核"} · 留痕 A2(演示)
                    </span>
                  ) : (
                    <>
                      <p className="mb-2.5 inline-flex items-center gap-1.5 text-[11.5px]" style={{ color: "var(--v5-ink-4)" }}>
                        {isSuper ? <ShieldCheck size={12} style={{ color: "var(--v5-brand)" }} aria-hidden /> : <Lock size={12} aria-hidden />}
                        {isSuper ? "总管理员 · 免双签,操作即时生效并留痕 A2" : "操作需 Maker-Checker 双签 · 发起人不可自审 · 留痕 A2"}
                      </p>
                      <div className="flex flex-wrap gap-2.5">
                        {showDefault ? (
                          <>
                            <button type="button" onClick={() => setActedLabel(isSuper ? "通过" : "复核通过")} className="min-w-[88px] flex-1 rounded-[9px] py-2 text-[13px] font-medium transition-opacity hover:opacity-90" style={{ background: "var(--v5-brand)", color: "var(--v5-on-brand)" }}>{isSuper ? "通过" : "复核通过"}</button>
                            <button type="button" onClick={() => setActedLabel("驳回")} className="min-w-[88px] flex-1 rounded-[9px] py-2 text-[13px] font-medium transition-colors hover:opacity-90" style={{ background: "var(--v5-danger-soft)", color: "var(--v5-danger)", border: "1px solid color-mix(in srgb, var(--v5-danger) 40%, transparent)" }}>驳回</button>
                          </>
                        ) : (
                          acts.map((a) => (
                            <button
                              key={a.label}
                              type="button"
                              onClick={() => setActedLabel(a.label)}
                              className="min-w-[88px] flex-1 rounded-[9px] py-2 text-[13px] font-medium transition-opacity hover:opacity-90"
                              style={
                                a.tone === "danger"
                                  ? { background: "var(--v5-danger-soft)", color: "var(--v5-danger)", border: "1px solid color-mix(in srgb, var(--v5-danger) 40%, transparent)" }
                                  : a.tone === "primary"
                                    ? { background: "var(--v5-brand)", color: "var(--v5-on-brand)" }
                                    : { background: "var(--v5-surface-3)", color: "var(--v5-ink-2)", border: "1px solid var(--v5-border-strong)" }
                              }
                            >
                              {a.label}
                            </button>
                          ))
                        )}
                      </div>
                    </>
                  )}
                </div>
              );
            })()}
          </aside>
        </>
      )}

      {creating && spec.primaryAction && (
        <>
          <div className="fixed inset-0" style={{ background: "rgba(0,0,0,0.5)", zIndex: "var(--admin-z-drawer)" }} onClick={() => setCreating(false)} aria-hidden />
          <aside
            ref={createRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            className="fixed right-0 top-0 flex h-screen w-full max-w-[380px] flex-col"
            style={{ background: "var(--v5-surface)", borderLeft: "1px solid var(--v5-border-strong)", boxShadow: "-16px 0 48px rgba(0,0,0,0.55)", zIndex: "calc(var(--admin-z-drawer) + 1)", outline: "none" }}
          >
            <div className="flex items-center gap-3 px-5 py-4" style={{ borderBottom: "1px solid var(--v5-border)" }}>
              <span className="font-display text-[15px]" style={{ color: "var(--v5-ink)" }}>{spec.primaryAction.label}</span>
              <button type="button" onClick={() => setCreating(false)} aria-label="关闭" className="ml-auto grid h-8 w-8 place-items-center rounded-[9px]" style={{ border: "1px solid var(--v5-border)", color: "var(--v5-ink-3)" }}>
                <X size={15} aria-hidden />
              </button>
            </div>
            <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-5 py-4">
              {(spec.primaryAction.fields ?? ["名称"]).map((f) => (
                <label key={f} className="flex flex-col gap-1.5">
                  <span className="text-[12px]" style={{ color: "var(--v5-ink-3)" }}>{f}</span>
                  <input
                    placeholder={`输入${f}`}
                    className="rounded-[9px] px-3 py-2 text-[13px] outline-none transition-colors focus:border-[var(--v5-border-strong)]"
                    style={{ background: "var(--v5-surface-3)", border: "1px solid var(--v5-border)", color: "var(--v5-ink)" }}
                  />
                </label>
              ))}
            </div>
            <div className="px-5 py-4" style={{ borderTop: "1px solid var(--v5-border)", background: "var(--v5-surface-2)" }}>
              {created ? (
                <span className="inline-flex items-center gap-1.5 text-[13px]" style={{ color: "var(--v5-success)", fontWeight: 500 }}>
                  <Check size={15} aria-hidden /> 已创建 · {isSuper ? "即时生效并留痕 A2" : "提交 A2 待复核"}(演示)
                </span>
              ) : (
                <>
                  <p className="mb-2.5 inline-flex items-center gap-1.5 text-[11.5px]" style={{ color: "var(--v5-ink-4)" }}>
                    {isSuper ? <ShieldCheck size={12} style={{ color: "var(--v5-brand)" }} aria-hidden /> : <Lock size={12} aria-hidden />}
                    {isSuper ? "总管理员 · 免双签,创建即时生效" : "创建需 Maker-Checker 双签 · 留痕 A2"}
                  </p>
                  <button type="button" onClick={() => setCreated(true)} className="w-full rounded-[9px] py-2.5 text-[13px] font-medium transition-opacity hover:opacity-90" style={{ background: "var(--v5-brand)", color: "var(--v5-on-brand)" }}>
                    {isSuper ? "创建" : "提交创建(待复核)"}
                  </button>
                </>
              )}
            </div>
          </aside>
        </>
      )}
    </div>
  );
}

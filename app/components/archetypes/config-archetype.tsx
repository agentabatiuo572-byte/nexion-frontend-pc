"use client";

/**
 * ConfigArchetype — 配置/规则/参数型模块的**真实可编辑配置页**(非只读展示)。
 * 每个参数 = 受控输入(可改值)+ 范围/影响提示;脏检测 + 重置 + 应用变更(变更预览)。
 * 角色感知:总管理员免双签即时生效;其余角色提交 Maker-Checker 复核。
 */
import { useMemo, useState } from "react";
import { Lock, Check, ShieldAlert, ShieldCheck, RotateCcw } from "lucide-react";
import { KpiStatCard } from "@/app/components/kit/kpi-stat-card";
import { useIsSuperadmin } from "@/lib/store/use-admin-role";
import { AutoGloss } from "@/app/components/kit/gloss";
import type { ConfigSpec, ConfigField } from "@/lib/admin/module-content";

const fkey = (group: string, f: ConfigField) => `${group}::${f.label}`;

export function ConfigArchetype({ spec, accent }: { spec: ConfigSpec; accent: string }) {
  const isSuper = useIsSuperadmin();
  const initial = useMemo<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    spec.groups.forEach((g) => g.fields.forEach((f) => (m[fkey(g.title, f)] = f.value)));
    return m;
  }, [spec]);

  const [vals, setVals] = useState<Record<string, string>>(() => ({ ...initial }));
  const [applied, setApplied] = useState(false);

  const changed = useMemo(() => {
    const arr: { label: string; from: string; to: string }[] = [];
    spec.groups.forEach((g) =>
      g.fields.forEach((f) => {
        const k = fkey(g.title, f);
        if (vals[k] !== f.value) arr.push({ label: f.label, from: f.value, to: vals[k] });
      }),
    );
    return arr;
  }, [spec, vals]);

  const setVal = (k: string, v: string) => {
    setApplied(false);
    setVals((s) => ({ ...s, [k]: v }));
  };
  const reset = () => {
    setApplied(false);
    setVals({ ...initial });
  };

  return (
    <div className="mt-5">
      {spec.metrics && spec.metrics.length > 0 && (
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {spec.metrics.map((m) => (
            <KpiStatCard key={m.label} label={m.label} value={m.value} accent={m.accent ?? accent} sublabel={m.sub} hint={m.hint} delta={m.delta} />
          ))}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {spec.groups.map((g) => (
          <div key={g.title} className="rounded-[16px] p-5" style={{ background: "var(--v5-surface)", border: "1px solid var(--v5-border)" }}>
            <div className="flex items-center gap-2.5">
              <span className="inline-block h-3.5 w-[3px] rounded-full" style={{ background: accent }} />
              <span className="font-display text-[14px]" style={{ color: "var(--v5-ink)" }}><AutoGloss>{g.title}</AutoGloss></span>
            </div>
            {g.note && <p className="mt-1 text-[11.5px]" style={{ color: "var(--v5-ink-4)" }}><AutoGloss>{g.note}</AutoGloss></p>}
            <div className="mt-3 flex flex-col">
              {g.fields.map((f, i) => {
                const k = fkey(g.title, f);
                const dirty = vals[k] !== f.value;
                return (
                  <div key={f.label} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5" style={{ borderTop: i === 0 ? "none" : "1px solid var(--v5-border)" }}>
                    <span className="text-[12.5px]" style={{ color: "var(--v5-ink-2)", minWidth: 124 }}><AutoGloss>{f.label}</AutoGloss></span>
                    <input
                      value={vals[k]}
                      onChange={(e) => setVal(k, e.target.value)}
                      aria-label={`${f.label} 配置值`}
                      className="font-mono-tabular rounded-[8px] px-2.5 py-1.5 text-[12.5px] outline-none transition-colors"
                      style={{ background: "var(--v5-surface-3)", border: `1px solid ${dirty ? accent : "var(--v5-border)"}`, color: "var(--v5-ink)", minWidth: 150, maxWidth: 300, flex: "1 1 160px" }}
                    />
                    {f.range && <span className="font-mono-tabular text-[11px]" style={{ color: "var(--v5-ink-4)" }}>范围 {f.range}</span>}
                    {f.effect && <span className="ml-auto text-[11px]" style={{ color: "var(--v5-ink-3)" }}><AutoGloss>{f.effect}</AutoGloss></span>}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* 下游联动影响 */}
      {spec.impact && spec.impact.length > 0 && (
        <div className="mt-4 rounded-[14px] p-4" style={{ background: "var(--v5-surface-2)", border: "1px solid var(--v5-border)" }}>
          <div className="flex items-center gap-2">
            <ShieldAlert size={14} style={{ color: "var(--v5-warning)" }} aria-hidden />
            <span className="text-[12.5px]" style={{ color: "var(--v5-ink-2)", fontWeight: 600 }}>变更影响预览(下游联动)</span>
          </div>
          <ul className="mt-2 flex flex-col gap-1">
            {spec.impact.map((it) => (
              <li key={it} className="flex items-start gap-2 text-[12px]" style={{ color: "var(--v5-ink-3)" }}>
                <span className="mt-1.5 inline-block h-1 w-1 shrink-0 rounded-full" style={{ background: accent }} />
                <AutoGloss>{it}</AutoGloss>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 变更发起栏:可编辑 + 脏检测 + 重置 + 应用(角色感知双签) */}
      <div className="mt-4 flex flex-wrap items-center gap-3 rounded-[14px] p-4" style={{ background: "var(--v5-surface)", border: "1px solid var(--v5-border)", borderLeft: `3px solid ${isSuper ? "var(--v5-brand)" : "var(--v5-tech-cyan)"}` }}>
        {isSuper ? <ShieldCheck size={15} style={{ color: "var(--v5-brand)" }} aria-hidden /> : <Lock size={15} style={{ color: "var(--v5-tech-cyan)" }} aria-hidden />}
        <span className="text-[12.5px]" style={{ color: "var(--v5-ink-2)" }}>
          {changed.length > 0
            ? `${changed.length} 项待${isSuper ? "应用" : "提交复核"}${changed.length > 0 ? ` · ${changed.map((c) => c.label).slice(0, 2).join("、")}${changed.length > 2 ? " 等" : ""}` : ""}`
            : isSuper
              ? "总管理员 · 拥有全部权限 · 免双签,改值后即时生效"
              : spec.approval}
        </span>
        <div className="ml-auto flex items-center gap-2.5">
          <button
            type="button"
            onClick={reset}
            disabled={changed.length === 0}
            className="inline-flex items-center gap-1.5 rounded-[9px] px-3 py-2 text-[12.5px] transition-colors hover:bg-[var(--v5-surface-2)] disabled:cursor-not-allowed disabled:opacity-40"
            style={{ border: "1px solid var(--v5-border)", color: "var(--v5-ink-2)" }}
          >
            <RotateCcw size={14} aria-hidden /> 重置
          </button>
          {applied ? (
            <span className="inline-flex items-center gap-1.5 text-[12.5px]" style={{ color: "var(--v5-success)", fontWeight: 500 }}>
              <Check size={14} aria-hidden /> {isSuper ? "已应用 · 即时生效" : "已提交 · 待复核"}(演示)
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setApplied(true)}
              disabled={changed.length === 0}
              className="inline-flex items-center gap-1.5 rounded-[9px] px-4 py-2 text-[13px] font-medium transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              style={{ background: "var(--v5-brand)", color: "var(--v5-on-brand)" }}
            >
              {isSuper ? "应用变更" : "发起变更(双签)"}{changed.length > 0 ? `(${changed.length})` : ""}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

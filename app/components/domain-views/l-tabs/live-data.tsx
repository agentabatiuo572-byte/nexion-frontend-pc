"use client";

import type { LCtx } from "./types";

export type KpiRow = {
  n: number;
  name: string;
  value: number;
  target: number;
  unit: string;
  dir: "gte" | "lte" | "band";
  band?: number[];
  cohort?: string;
  vis?: string;
  spark: number[];
};

export function rows<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export function rec<T = unknown>(value: unknown): Record<string, T> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, T>) : {};
}

export function str(value: unknown, fallback = "") {
  return typeof value === "string" ? value : value == null ? fallback : String(value);
}

export function num(value: unknown, fallback = 0) {
  if (typeof value === "number") return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function bool(value: unknown, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return ["true", "1", "yes"].includes(value.toLowerCase());
  return fallback;
}

export function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => str(item)).filter(Boolean) : [];
}

export function numberRows(value: unknown): number[] {
  return Array.isArray(value) ? value.map((item) => num(item)).filter((item) => Number.isFinite(item)) : [];
}

export function fmtM(value: number) {
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(0)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

export function kpiState(kpi: KpiRow, offset: number): "g" | "y" | "r" {
  if (kpi.dir === "band") {
    const [low = 0, high = 0] = kpi.band ?? [];
    if (kpi.value >= low && kpi.value <= high) return "g";
    return "y";
  }
  if (kpi.dir === "lte") {
    const yellow = kpi.target * (1 + offset / 100);
    return kpi.value <= kpi.target ? "g" : kpi.value <= yellow ? "y" : "r";
  }
  const yellow = kpi.target * (1 - offset / 100);
  return kpi.value >= kpi.target ? "g" : kpi.value >= yellow ? "y" : "r";
}

export function dataState(ctx: LCtx, label: string) {
  if (ctx.biLoading) return `${label} 数据加载中...`;
  if (ctx.biError) return `${label} 数据加载失败 · ${ctx.biError}`;
  return `${label} 暂无后端数据`;
}

export function LDataState({ ctx, label }: { ctx: LCtx; label: string }) {
  return (
    <section className="l-card">
      <div className="l-b">
        <div className="ltint warn" style={{ fontSize: 12 }}>{dataState(ctx, label)}</div>
      </div>
    </section>
  );
}

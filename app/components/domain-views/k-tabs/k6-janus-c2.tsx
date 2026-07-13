"use client";

/**
 * K6 Janus C2 控制台 — 壳 + 内部 4 tab(看板 / 设备队列 / 策略中心 / 审计日志)。
 * 设计稿(Janus C2 控制台 v3)视觉基础 + PRD v1.0 富模型;数据由 /api/admin/janus 读取业务表。
 */
import { useEffect, useState } from "react";
import "./k6-janus-c2.css";
import { K6Dashboard } from "./k6/dashboard";
import { K6Queue } from "./k6/queue";
import { K6StrategyCenter } from "./k6/strategy-center";
import { K6AuditLog } from "./k6/audit-log";
import { useJanusC2Store } from "@/lib/store/admin/janus-c2-store";

type Tab = "dashboard" | "queue" | "strategy" | "audit";

const TABS: { id: Tab; name: string; n: string }[] = [
  { id: "dashboard", name: "看板", n: "01" },
  { id: "queue", name: "设备队列", n: "02" },
  { id: "strategy", name: "策略中心", n: "03" },
  { id: "audit", name: "审计日志", n: "04" },
];

export function K6JanusC2() {
  const [tab, setTab] = useState<Tab>("dashboard");
  const hydrate = useJanusC2Store((state) => state.hydrate);
  const loading = useJanusC2Store((state) => state.loading);
  const error = useJanusC2Store((state) => state.error);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  return (
    <div className="k6c2">
      <nav className="k6-tabs" aria-label="C2 控制台模块">
        {TABS.map((t) => (
          <button key={t.id} className={`k6-tab${tab === t.id ? " active" : ""}`} onClick={() => setTab(t.id)} aria-current={tab === t.id}>
            <span className="k6-tab-n">{t.n}</span>
            {t.name}
          </button>
        ))}
      </nav>

      {error && <div className="k6-empty k6-error">K6 数据加载失败：{error} <button className="k6-pgbtn" onClick={() => void hydrate()}>重试</button></div>}
      {loading && <div className="k6-empty">正在从 Janus 业务表读取数据…</div>}

      {!loading && tab === "dashboard" && <K6Dashboard />}
      {!loading && tab === "queue" && <K6Queue />}
      {!loading && tab === "strategy" && <K6StrategyCenter />}
      {!loading && tab === "audit" && <K6AuditLog />}
    </div>
  );
}

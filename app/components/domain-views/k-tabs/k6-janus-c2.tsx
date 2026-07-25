"use client";

/**
 * K6 Janus C2 控制台 — 壳 + 内部 5 tab(看板 / 设备队列 / 策略中心 / 批准目标 / 审计日志)。
 * 设计稿(Janus C2 控制台 v3)视觉基础 + PRD v1.0 富模型;数据由 /api/admin/janus 读取业务表。
 */
import { useEffect, useState } from "react";
import "./k6-janus-c2.css";
import { K6Dashboard } from "./k6/dashboard";
import { K6Queue } from "./k6/queue";
import { K6StrategyCenter } from "./k6/strategy-center";
import { K6AuditLog } from "./k6/audit-log";
import { K6RemoteTargetManager } from "./k6/remote-target-manager";
import { useJanusC2Store } from "@/lib/store/admin/janus-c2-store";

type Tab = "dashboard" | "queue" | "strategy" | "targets" | "audit";

const TABS: { id: Tab; name: string; n: string }[] = [
  { id: "dashboard", name: "看板", n: "01" },
  { id: "queue", name: "设备队列", n: "02" },
  { id: "strategy", name: "策略中心", n: "03" },
  { id: "targets", name: "批准目标", n: "04" },
  { id: "audit", name: "审计日志", n: "05" },
];

export function K6JanusC2() {
  const [tab, setTab] = useState<Tab>("dashboard");
  const loadDashboard = useJanusC2Store((state) => state.loadDashboard);
  const loadDevices = useJanusC2Store((state) => state.loadDevices);
  const loadStrategies = useJanusC2Store((state) => state.loadStrategies);
  const loadAudit = useJanusC2Store((state) => state.loadAudit);

  useEffect(() => {
    if (tab === "dashboard") void loadDashboard();
    if (tab === "queue") void loadDevices();
    if (tab === "strategy") void loadStrategies();
    if (tab === "audit") void loadAudit();
  }, [loadAudit, loadDashboard, loadDevices, loadStrategies, tab]);

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

      {tab === "dashboard" && <K6Dashboard />}
      {tab === "queue" && <K6Queue />}
      {tab === "strategy" && <K6StrategyCenter />}
      {tab === "targets" && <K6RemoteTargetManager />}
      {tab === "audit" && <K6AuditLog />}
    </div>
  );
}

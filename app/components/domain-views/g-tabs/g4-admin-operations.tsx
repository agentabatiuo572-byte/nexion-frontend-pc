"use client";

import { useCallback, useEffect, useState } from "react";
import { currentAdminOperator } from "@/lib/admin/current-operator";
import { displayAdminError } from "@/lib/admin/error-messages";
import {
  archiveG4AdminSimulation,
  createG4AdminSimulation,
  fetchG4AdminOperations,
  updateG4AdminOperationConfig,
  type G4AdminOperationsOverview,
} from "@/lib/admin/g4-client";
import type { GCtx } from "./types";
import { useAdminAuth } from "@/lib/store/admin-auth";

const CONFIGS = [
  { key: "eligibility.enabled", label: "资格门启用", kind: "select", options: ["true", "false"] },
  { key: "eligibility.maxPerUser", label: "资格门每人上限", kind: "number" },
  { key: "eligibility.minAccountAgeDays", label: "最低账户龄(天)", kind: "number" },
  { key: "presale.enabled", label: "预售启用", kind: "select", options: ["true", "false"] },
  { key: "presale.showCountdown", label: "展示倒计时", kind: "select", options: ["true", "false"] },
  { key: "presale.unitPrice", label: "预售单价", kind: "number" },
  { key: "presale.maxPerUser", label: "预售每人上限", kind: "number" },
  { key: "presale.startAt", label: "预售开始(UTC)", kind: "text" },
  { key: "presale.endAt", label: "预售结束(UTC)", kind: "text" },
] as const;

export default function G4AdminOperations({ ctx }: { ctx: GCtx }) {
  const session = useAdminAuth((state) => state.session);
  const canWrite = session?.role === "superadmin" || !!session?.authorities.includes("finprod_g4_write");
  const [data, setData] = useState<G4AdminOperationsOverview | null>(null);
  const [error, setError] = useState("");
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [quantity, setQuantity] = useState("1");
  const [unitPrice, setUnitPrice] = useState("1000");

  const load = useCallback(async () => {
    try { setData(await fetchG4AdminOperations()); setError(""); }
    catch (cause) { setError(displayAdminError(cause)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const edit = (definition: (typeof CONFIGS)[number]) => {
    const current = data?.config[definition.key] ?? (definition.kind === "select" ? "false" : "");
    ctx.openActionConfirm({
      action: `G4 运营配置 · ${definition.label}`,
      detail: `${definition.label} 当前 ${current || "未配置"}。配置保存在服务端，不产生用户资产或市场成交。时间须用 ISO-8601 UTC（例如 2026-08-01T00:00:00Z），且开始必须早于结束。`,
      amplifies: false,
      edit: definition.kind === "select"
        ? { kind: "select", current: String(current), options: [...(definition.options ?? [])] }
        : definition.kind === "number"
          ? { kind: "number", current: String(current), min: 0 }
          : { kind: "text", current: String(current) },
      run: async (reason, value) => {
        if (value == null || value === "") return;
        let normalized = value;
        if (definition.key === "presale.startAt" || definition.key === "presale.endAt") {
          if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) || Number.isNaN(Date.parse(value))) {
            throw new Error("请输入 ISO-8601 UTC 时间，例如 2026-08-01T00:00:00Z");
          }
          normalized = new Date(value).toISOString();
          const otherKey = definition.key === "presale.startAt" ? "presale.endAt" : "presale.startAt";
          const other = data?.config[otherKey];
          if (other) {
            const start = definition.key === "presale.startAt" ? normalized : String(other);
            const end = definition.key === "presale.endAt" ? normalized : String(other);
            if (Date.parse(start) >= Date.parse(end)) throw new Error("预售开始时间必须早于结束时间");
          }
        }
        await updateG4AdminOperationConfig(
          definition.key,
          normalized,
          reason,
          currentAdminOperator(),
          String(current),
        );
        await load();
        ctx.toast(`${definition.label} 已更新`);
      },
    });
  };

  const createSimulation = () => ctx.openActionConfirm({
    action: "创建管理端虚拟成交",
    detail: `创建 ${side} ${quantity} × ${unitPrice} 的 SIMULATED 记录。它只用于管理端页面演练，不写钱包、账本、真实成交或市场统计，也不向用户展示。`,
    amplifies: false,
    run: async (reason) => {
      await createG4AdminSimulation(side, quantity, unitPrice, reason, currentAdminOperator());
      await load();
      ctx.toast("SIMULATED 虚拟成交已创建");
    },
  });

  const archive = (id: number, no: string) => ctx.openActionConfirm({
    action: `归档虚拟成交 · ${no}`,
    detail: "仅归档管理端 SIMULATED 记录，不影响真实市场、资产和统计。",
    amplifies: false,
    run: async (reason) => {
      await archiveG4AdminSimulation(id, reason, currentAdminOperator());
      await load();
      ctx.toast(`${no} 已归档`);
    },
  });

  if (!data) {
    return <section className="l-card"><div className="l-b">
      {error ? <>G4 运营工具读取失败 · {error} <button className="l-btn sm" onClick={() => void load()}>重试</button></> : "G4 运营工具加载中..."}
    </div></section>;
  }

  return <>
    {error && <div className="gtint" data-module-health-state="error" style={{ marginBottom: 12 }}>刷新失败，以下为上次成功快照 · {error} <button className="l-btn sm" onClick={() => void load()}>重试</button></div>}
    <section className="l-card" style={{ marginBottom: 16 }}>
      <div className="l-h"><span className="ttl">资格门与预售</span><span className="sub">· 统一配置 · 修改后即时生效</span></div>
      <div className="l-b"><div className="param-grid">{CONFIGS.map((definition) => <div className="p" key={definition.key}><div className="k">{definition.label}</div><div className="v">{data.config[definition.key] ?? "未配置"}{canWrite && <button className="l-btn sm mc" onClick={() => edit(definition)}>调整</button>}</div><div className="s">由平台权威配置统一管理</div></div>)}</div></div>
    </section>
    <section className="l-card" style={{ marginBottom: 16 }}>
      <div className="l-h"><span className="ttl">虚拟成交演练</span><span className="sub">· 明确标记 SIMULATED / ADMIN_ONLY</span></div>
      <div className="l-b">
        <div className="ctint warn" style={{ marginBottom: 12 }}><b>隔离保证</b> · 不写真实钱包/资金台账，不进入成交量、地板价、持有人等市场统计，不对用户端展示。</div>
        <div className="grid g-3" style={{ gap: 10, marginBottom: 12 }}><select className="fld" value={side} onChange={(e) => setSide(e.target.value === "SELL" ? "SELL" : "BUY")}><option value="BUY">模拟买入</option><option value="SELL">模拟卖出</option></select><input className="fld" type="number" min="0.000001" max="999999999999.999999" step="0.000001" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="数量" /><input className="fld" type="number" min="0.000001" max="999999999999.999999" step="0.000001" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} placeholder="单价" /></div>
        {canWrite && <button className="l-btn mc" disabled={!(Number(quantity) > 0) || !(Number(unitPrice) > 0)} onClick={createSimulation}>创建虚拟成交</button>}
      </div>
      <div style={{ overflowX: "auto" }}><table className="l-tbl"><thead><tr><th>编号</th><th>方向</th><th>数量</th><th>单价</th><th>名义额</th><th>类型</th><th>操作人</th>{canWrite && <th>动作</th>}</tr></thead><tbody>{data.simulations.map((row) => <tr key={row.id}><td className="mono">{row.simulationNo}</td><td>{row.side}</td><td>{row.quantity}</td><td>{row.unitPrice}</td><td>{row.notional}</td><td><span className="bdg warn">{row.recordType}</span></td><td>{row.operator}</td>{canWrite && <td><button className="l-btn sm" onClick={() => archive(row.id, row.simulationNo)}>归档</button></td>}</tr>)}{!data.simulations.length && <tr><td colSpan={canWrite ? 8 : 7} style={{ textAlign: "center", padding: 20 }}>暂无虚拟成交记录</td></tr>}</tbody></table></div>
    </section>
  </>;
}

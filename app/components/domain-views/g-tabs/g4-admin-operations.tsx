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

const configValueText = (kind: string, value: unknown): string => value == null || value === "" ? "未配置" : kind === "select" ? value === true || value === "true" ? "已开启" : value === false || value === "false" ? "已关闭" : "状态未知" : String(value);
const sideText = (value: string) => value === "BUY" ? "模拟买入" : value === "SELL" ? "模拟卖出" : "方向未知";
const CONFIGS = [
  { key: "eligibility.enabled", label: "启用购买资格限制", kind: "select", options: ["true", "false"] },
  { key: "eligibility.maxPerUser", label: "每人最多认购", kind: "number" },
  { key: "eligibility.minAccountAgeDays", label: "最少注册天数", kind: "number" },
  { key: "presale.enabled", label: "开启预售", kind: "select", options: ["true", "false"] },
  { key: "presale.showCountdown", label: "显示倒计时", kind: "select", options: ["true", "false"] },
  { key: "presale.unitPrice", label: "预售单价", kind: "number" },
  { key: "presale.maxPerUser", label: "预售每人上限", kind: "number" },
  { key: "presale.startAt", label: "预售开始时间（UTC）", kind: "text" },
  { key: "presale.endAt", label: "预售结束时间（UTC）", kind: "text" },
  { key: "holder.allocationNexPerHolding", label: "每个节点给持有人预留的 UVT", kind: "number" },
  { key: "holder.priorityTop1Percent", label: "前 1% 持有人门槛", kind: "number" },
  { key: "holder.priorityTop3Percent", label: "前 3% 持有人门槛", kind: "number" },
  { key: "holder.priorityTop5Percent", label: "前 5% 持有人门槛", kind: "number" },
  { key: "holder.policyVersion", label: "持有人规则版本", kind: "text" },
  { key: "holder.effectiveAt", label: "持有人规则生效时间（UTC）", kind: "text" },
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
    const configured = data?.config[definition.key];
    const current = configured ?? (definition.kind === "select" ? "false" : "");
    // Missing rows use the backend's empty-string CAS baseline. This keeps a
    // damaged/pre-migration database recoverable from G4 instead of turning the
    // display fallback "false" into an unavoidable first-write conflict.
    const expectedValue = configured == null ? "" : String(configured);
    ctx.openActionConfirm({
      action: `修改创世认购设置 · ${definition.label}`,
      detail: `${definition.label} 当前 ${configValueText(definition.kind, configured)}。只改设置，不会产生用户资产或成交。时间请按 UTC 填写（例如 2026-08-01T00:00:00Z），开始时间要早于结束时间。`,
      amplifies: false,
      edit: definition.kind === "select"
        ? { kind: "select", current: String(current), options: [...(definition.options ?? [])], optionLabels: { true: "已开启", false: "已关闭" } }
        : definition.kind === "number"
          ? { kind: "number", current: String(current), min: 0 }
          : { kind: "text", current: String(current) },
      run: async (reason, value) => {
        if (value == null || value === "") return;
        let normalized = value;
        if (definition.key === "presale.startAt" || definition.key === "presale.endAt" || definition.key === "holder.effectiveAt") {
          if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) || Number.isNaN(Date.parse(value))) {
            throw new Error("请按 UTC 填写时间，例如 2026-08-01T00:00:00Z");
          }
          normalized = new Date(value).toISOString();
          if (definition.key === "presale.startAt" || definition.key === "presale.endAt") {
            const otherKey = definition.key === "presale.startAt" ? "presale.endAt" : "presale.startAt";
            const other = data?.config[otherKey];
            if (other) {
              const start = definition.key === "presale.startAt" ? normalized : String(other);
              const end = definition.key === "presale.endAt" ? normalized : String(other);
              if (Date.parse(start) >= Date.parse(end)) throw new Error("预售开始时间必须早于结束时间");
            }
          }
        }
        await updateG4AdminOperationConfig(
          definition.key,
          normalized,
          reason,
          currentAdminOperator(),
          expectedValue,
        );
        await load();
        ctx.toast(`${definition.label} 已更新`);
      },
    });
  };

  const createSimulation = () => ctx.openActionConfirm({
    action: "创建模拟成交",
    detail: `创建 ${sideText(side)} ${quantity} × ${unitPrice} 的模拟记录。只用于后台演练，不影响钱包、账本、真实成交和市场统计，用户也看不到。`,
    amplifies: false,
    run: async (reason) => {
      await createG4AdminSimulation(side, quantity, unitPrice, reason, currentAdminOperator());
      await load();
      ctx.toast("模拟成交已创建");
    },
  });

  const archive = (id: number, no: string) => ctx.openActionConfirm({
    action: `归档模拟成交 · ${no}`,
    detail: "只归档这条模拟记录，不影响真实市场、资产和统计。",
    amplifies: false,
    run: async (reason) => {
      await archiveG4AdminSimulation(id, reason, currentAdminOperator());
      await load();
      ctx.toast(`${no} 已归档`);
    },
  });

  if (!data) {
    return <section className="l-card"><div className="l-b">
      {error ? <>创世认购设置加载失败 · {error} <button className="l-btn sm" onClick={() => void load()}>重试</button></> : "创世认购设置加载中…"}
    </div></section>;
  }

  return <>
    {error && <div className="gtint" data-module-health-state="error" style={{ marginBottom: 12 }}>刷新失败，下面是上次加载的数据 · {error} <button className="l-btn sm" onClick={() => void load()}>重试</button></div>}
    <section className="l-card" style={{ marginBottom: 16 }}>
      <div className="l-h"><span className="ttl">创世认购与预售设置</span><span className="sub">· 修改后 App 马上生效</span></div>
      <div className="l-b">
        <div className="gtint" style={{ marginBottom: 12 }}><b>购买资格</b> · 只看 <span>资格开关、每人上限和最少注册天数</span>。以前的入金、旗舰设备、V 等级、邀请码条件已停用。设备商城的购买条件在另一个页面，不受影响。</div>
        <div className="param-grid">{CONFIGS.map((definition) => <div className="p" key={definition.key}><div className="k">{definition.label}</div><div className="v">{configValueText(definition.kind, data.config[definition.key])}{canWrite && <button className="l-btn sm mc" aria-label={`调整${definition.label}`} onClick={() => edit(definition)}>调整</button>}</div></div>)}</div>
      </div>
    </section>
    <section className="l-card" style={{ marginBottom: 16 }}>
      <div className="l-h"><span className="ttl">模拟成交演练</span><span className="sub">· 只在后台可见，标记为模拟记录</span></div>
      <div className="l-b">
        <div className="ctint warn" style={{ marginBottom: 12 }}><b>不影响真实数据</b> · 不进钱包和资金账本，不计入成交量、地板价、持有人等统计，用户看不到。</div>
        <div className="grid g-3" style={{ gap: 10, marginBottom: 12 }}><select className="fld" aria-label="模拟成交方向" value={side} onChange={(e) => setSide(e.target.value === "SELL" ? "SELL" : "BUY")}><option value="BUY">模拟买入</option><option value="SELL">模拟卖出</option></select><input className="fld" type="number" min="0.000001" max="999999999999.999999" step="0.000001" value={quantity} aria-label="模拟成交数量" onChange={(e) => setQuantity(e.target.value)} placeholder="数量" /><input className="fld" type="number" min="0.000001" max="999999999999.999999" step="0.000001" value={unitPrice} aria-label="模拟成交单价" onChange={(e) => setUnitPrice(e.target.value)} placeholder="单价" /></div>
        {canWrite && <button className="l-btn mc" disabled={!(Number(quantity) > 0) || !(Number(unitPrice) > 0)} onClick={createSimulation}>创建模拟成交</button>}
      </div>
      <div style={{ overflowX: "auto" }}><table className="l-tbl"><thead><tr><th>编号</th><th>方向</th><th>数量</th><th>单价</th><th>金额</th><th>类型</th><th>操作人</th>{canWrite && <th>动作</th>}</tr></thead><tbody>{data.simulations.map((row) => <tr key={row.id}><td className="mono">{row.simulationNo}</td><td>{sideText(row.side)}</td><td>{row.quantity}</td><td>{row.unitPrice}</td><td>{row.notional}</td><td><span className="bdg warn">{row.recordType === "SIMULATED" ? "模拟记录" : "类型未知"}</span></td><td>{row.operator}</td>{canWrite && <td><button className="l-btn sm" onClick={() => archive(row.id, row.simulationNo)}>归档</button></td>}</tr>)}{!data.simulations.length && <tr><td colSpan={canWrite ? 8 : 7} style={{ textAlign: "center", padding: 20 }}>暂无模拟成交记录</td></tr>}</tbody></table></div>
    </section>
  </>;
}

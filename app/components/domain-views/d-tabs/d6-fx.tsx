"use client";

import { useEffect, useState } from "react";
import {
  loadD6FxQuote,
  updateD6FxQuote,
  type D6FxQuote,
} from "@/lib/admin/d-client";
import { useAdminAuth } from "@/lib/store/admin-auth";
import type { DCtx } from "./types";

const PARAMS = [
  { key: "baseRateVndPerUsdt", label: "基准价", unit: "₫/USDT", min: 20_000, max: 35_000, step: 1 },
  { key: "buySpreadPct", label: "买入点差", unit: "%", min: 0, max: 3, step: 0.01 },
  { key: "lockWindowMinutes", label: "锁价窗", unit: "分钟", min: 5, max: 120, step: 1 },
] as const;

function vnd(value: number) {
  return `${Number(value).toLocaleString("en-US")}₫`;
}

function timeText(value: string) {
  return value ? value.replace("T", " ").slice(0, 19) : "—";
}

export function D6Fx({ ctx }: { ctx: DCtx }) {
  const { toast, openActionConfirm } = ctx;
  const session = useAdminAuth((state) => state.session);
  const operator = session?.operator || session?.username || "";
  const authorities = session?.authorities ?? [];
  const canManage = session?.role === "superadmin" || session?.role === "super"
    || authorities.includes("finance_d6_manage");
  const [data, setData] = useState<D6FxQuote | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      setData(await loadD6FxQuote());
    } catch (err) {
      setData(null);
      setError(err instanceof Error ? err.message : "D6 汇率牌价读取失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const editParam = (param: (typeof PARAMS)[number]) => {
    if (!data) return;
    const current = data[param.key];
    openActionConfirm({
      action: `汇率牌价调整 · ${param.label}`,
      detail: `${param.label}当前为 ${current} ${param.unit}，合法范围 ${param.min.toLocaleString("en-US")}–${param.max.toLocaleString("en-US")}。只影响新付款单；在途付款单继续使用下单时的锁价快照。`,
      edit: { kind: "number", current: String(current), unit: param.unit, min: param.min, max: param.max, step: param.step },
      run: async (reason, value) => {
        const nextValue = Number(value);
        if (!Number.isFinite(nextValue) || nextValue < param.min || nextValue > param.max) {
          throw new Error(`${param.label}超出合法范围`);
        }
        setBusy(true);
        setError("");
        try {
          const next = await updateD6FxQuote({
            baseRateVndPerUsdt: param.key === "baseRateVndPerUsdt" ? nextValue : data.baseRateVndPerUsdt,
            buySpreadPct: param.key === "buySpreadPct" ? nextValue : data.buySpreadPct,
            lockWindowMinutes: param.key === "lockWindowMinutes" ? nextValue : data.lockWindowMinutes,
          }, data.version, reason, operator);
          setData(next);
          toast(`${param.label}已更新，仅新付款单取新值`);
        } catch (err) {
          setData(null);
          setError(`写入结果未确认，已停止展示旧牌价 · ${err instanceof Error ? err.message : "D6 写入失败"}`);
          throw err;
        } finally {
          setBusy(false);
        }
      },
    });
  };

  if (loading && !data) {
    return <section className="l-card"><div className="l-b">D6 汇率牌价加载中...</div></section>;
  }
  if (error && !data) {
    return <section className="l-card"><div className="l-b"><div className="dtint warn">{error}</div><button className="l-btn primary" disabled={loading || busy} style={{ marginTop: 12 }} onClick={() => void load()}>重试读取</button></div></section>;
  }

  return (
    <>
      {error && <div className="dtint warn" style={{ marginBottom: 12 }}>{error}</div>}
      <div className="f-stats">
        <div className="f-stat ok"><div className="k">当前牌价（现场派生）</div><div className="v">1 USDT ≈ {vnd(data?.quoteRateVndPerUsdt ?? 0)}</div><div className="sub">不存第二份派生牌价</div></div>
        <div className="f-stat"><div className="k">基准价</div><div className="v">{vnd(data?.baseRateVndPerUsdt ?? 0)}</div><div className="sub">手动维护 · 20,000–35,000</div></div>
        <div className="f-stat cyan"><div className="k">买入点差</div><div className="v">{data?.buySpreadPct ?? 0}%</div><div className="sub">合法范围 0–3%</div></div>
        <div className="f-stat warn"><div className="k">锁价窗</div><div className="v">{data?.lockWindowMinutes ?? 0} 分钟</div><div className="sub">付款单下单即锁定</div></div>
      </div>

      <div className="two-col r11">
        <section className="l-card">
          <div className="l-h"><span className="ttl">牌价配置（操作确认）</span><span className="sub">· 真实后端单源 · CAS + 防重 + 审计</span><div className="r"><button className="l-btn sm" disabled={loading || busy} onClick={() => void load()}>刷新</button></div></div>
          <div className="l-b">
            {PARAMS.map((param) => (
              <div className="p-row" key={param.key}>
                <div className="txt"><div className="k">{param.label}</div><div className="s">仅对新付款单生效；非法值由服务器 422 拒绝</div></div>
                <span className="v">{param.key === "baseRateVndPerUsdt" ? vnd(data?.[param.key] ?? 0) : `${data?.[param.key] ?? 0} ${param.unit}`}</span>
                {canManage && <button className="l-btn sm mc" disabled={loading || busy} onClick={() => editParam(param)}>调整</button>}
              </div>
            ))}
            <div className="dtint ok" style={{ marginTop: 12 }}>
              <b>牌价怎么算</b> · 基准价 ×（1 + 买入点差），在整数域取整到十位。当前 {vnd(data?.baseRateVndPerUsdt ?? 0)} ×（1 + {data?.buySpreadPct ?? 0}%）= <b>{vnd(data?.quoteRateVndPerUsdt ?? 0)}</b>。
            </div>
            <div className="dtint warn" style={{ marginTop: 10 }}>
              <b>调价不影响在途单</b> · 付款单上的牌价是下单时锁定的快照；本页调价只影响之后新建的付款单，不重算、不追差。
            </div>
          </div>
        </section>

        <section className="l-card">
          <div className="l-h"><span className="ttl">生效历史</span><span className="sub">· 服务端历史，与必写审计同一事务</span></div>
          <div style={{ overflowX: "auto" }}>
            <table className="l-tbl" style={{ minWidth: 720 }}>
              <thead><tr><th>时间</th><th>基准价</th><th>点差</th><th>锁价窗</th><th>操作者</th><th>理由</th></tr></thead>
              <tbody>
                {(data?.history ?? []).length === 0 ? (
                  <tr><td colSpan={6} style={{ textAlign: "center", padding: 24, color: "var(--ink-4)" }}>暂无调价历史</td></tr>
                ) : data?.history.map((row) => (
                  <tr key={row.id}>
                    <td className="mono">{timeText(row.createdAt)}</td>
                    <td>{vnd(row.beforeBaseRateVndPerUsdt)} → <b>{vnd(row.baseRateVndPerUsdt)}</b></td>
                    <td>{row.beforeBuySpreadPct}% → <b>{row.buySpreadPct}%</b></td>
                    <td>{row.beforeLockWindowMinutes} → <b>{row.lockWindowMinutes} 分钟</b></td>
                    <td>{row.operator}</td><td>{row.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}

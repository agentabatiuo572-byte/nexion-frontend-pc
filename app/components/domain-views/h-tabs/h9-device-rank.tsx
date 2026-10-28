"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchDeviceRankConfig, updateDeviceRankConfig } from "@/lib/admin/device-rank-client";
import { deviceRankConfigError, type DeviceRankConfig, type DeviceRankTierDraft } from "@/lib/admin/device-rank-config";
import { h9DraftNumber } from "@/lib/admin/h9-validation";
import type { HCtx } from "./types";

const tierDrafts = (config: DeviceRankConfig): DeviceRankTierDraft[] => config.tiers.map((tier) => ({
  name: tier.name, sharePct: String(tier.sharePct), minTops: String(tier.minTops), maxTops: String(tier.maxTops),
}));

export function H9DeviceRank({ ctx }: { ctx: HCtx }) {
  const canWrite = ctx.can("growth_h9_write");
  const [data, setData] = useState<DeviceRankConfig | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [rows, setRows] = useState<DeviceRankTierDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const accept = (next: DeviceRankConfig) => {
    setData(next); setEnabled(next.enabled); setRows(tierDrafts(next)); setError(""); setConflict(false);
  };
  const load = useCallback(async () => {
    setLoading(true);
    try { accept(await fetchDeviceRankConfig()); }
    catch (cause) { setData(null); setError(cause instanceof Error ? cause.message : "配置读取失败，请重试。"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const tiers = rows.map((row) => ({ name: row.name.trim(), sharePct: h9DraftNumber(row.sharePct), minTops: h9DraftNumber(row.minTops), maxTops: h9DraftNumber(row.maxTops) }));
  const validation = deviceRankConfigError(enabled, tiers);
  const dirty = !!data && (enabled !== data.enabled || JSON.stringify(tiers) !== JSON.stringify(data.tiers));
  const locked = !canWrite || !data || loading || saving || conflict;
  const change = (index: number, key: keyof DeviceRankTierDraft, value: string) => setRows((current) => current.map((row, i) => i === index ? { ...row, [key]: value } : row));
  const save = () => {
    if (locked || !data || validation || !dirty) return;
    const submitted = { version: data.version, enabled, tiers };
    ctx.openActionConfirm({
      action: "保存设备预估排名", reasonMin: 8, reasonMax: 200,
      completionCopy: "保存后马上生效，并记入操作记录。",
      detail: <>
        <div>状态：{data.enabled ? "已开启" : "已关闭"} → {enabled ? "开启" : "关闭"}；配置版本 v{data.version}。</div>
        {tiers.map((tier, index) => <div key={index}>{tier.name}：{tier.sharePct}%，{tier.minTops}–{tier.maxTops} TOPS</div>)}
        <div>在线设备数取自「首页数字增长」。改了档位分布会重新生成参考；只开关不会。不影响真实算力、收益和奖励。</div>
      </>,
      run: async (reason) => {
        setSaving(true);
        try {
          const saved = await updateDeviceRankConfig(submitted, reason);
          accept(saved);
          ctx.toast(`设备预估排名已保存 · 版本 v${saved.version}`);
        } catch (cause) {
          const status = (cause as { status?: number })?.status;
          setConflict(status === 409);
          setError(status === 409 ? "设置刚被别人改过，请刷新后重新修改。" : `${cause instanceof Error ? cause.message : "保存结果暂未确认。"} 请刷新核对是否已生效；直接重试不会重复保存。`);
          throw cause;
        } finally { setSaving(false); }
      },
    });
  };
  return <section className="l-card" aria-label="设备预估排名" style={{ marginBottom: 24 }}>
    <div className="l-h"><span className="ttl">设备预估排名</span><span className="sub">{data ? `已保存：${data.enabled ? "开启" : "关闭"} · v${data.version}` : "未加载"}</span></div>
    <div className="l-b">
      <p className="htint">按「首页数字增长」的在线设备数和下方档位，给用户算一个估计排名，用户手机按自己的算力参与比较。这不是真实榜单，不影响收益和奖励。</p>
      <p className="sub">在线设备数要在 1–1000 万台之间，否则 App 显示「排名暂不可用」。</p>
      {loading && <p role="status">设备预估排名配置加载中…</p>}
      {error && <p className="htint danger" role="alert">{error}</p>}
      {data && <>
        <label style={{ display: "block", margin: "16px 0" }}><input type="checkbox" role="switch" aria-label="启用设备预估排名" checked={enabled} disabled={locked} onChange={(event) => setEnabled(event.target.checked)} /> 启用设备预估排名（保存后生效）</label>
        <div style={{ overflowX: "auto" }}><table className="l-table">
          <thead><tr><th>档位名称</th><th>占比（%）</th><th>最低算力（TOPS）</th><th>最高算力（TOPS）</th><th>操作</th></tr></thead>
          <tbody>{rows.map((row, index) => <tr key={index}>
            {(["name", "sharePct", "minTops", "maxTops"] as const).map((key) => <td key={key}><input className="l-inp" style={{ width: "100%", minWidth: key === "name" ? 120 : 90 }} type="text" inputMode={key === "name" ? "text" : "decimal"} aria-label={`第${index + 1}档${{ name: "名称", sharePct: "占比", minTops: "最低算力", maxTops: "最高算力" }[key]}`} value={row[key]} disabled={locked} onChange={(event) => change(index, key, event.target.value)} /></td>)}
            <td><button className="l-btn sm" aria-label={`删除第${index + 1}档`} disabled={locked} onClick={() => setRows((current) => current.filter((_, i) => i !== index))}>删除</button></td>
          </tr>)}</tbody>
        </table></div>
        <p className="sub">最多 20 档，名称 1–60 字；占比最多两位小数且合计 100%；算力范围为 0–1000000000 TOPS，最多六位小数。关闭时允许空档位。</p>
        {validation && <p className="ferr" role="alert">{validation}</p>}
        {!canWrite && <p>你只能查看。</p>}
      </>}
    </div>
    <div className="l-h" style={{ borderTop: "1px solid var(--border)", borderBottom: 0 }}>
      <span className="sub">单独保存，不受本页其他设置影响。</span><div className="r">
        <button className="l-btn sm" disabled={loading || saving} onClick={() => void load()}>刷新</button>
        {canWrite && <>
          <button className="l-btn sm" disabled={locked || rows.length >= 20} onClick={() => setRows((current) => [...current, { name: "", sharePct: "", minTops: "", maxTops: "" }])}>添加档位</button>
          <button className="l-btn sm" disabled={locked || !dirty} onClick={() => data && accept(data)}>放弃改动</button>
          <button className="l-btn mc" disabled={locked || !dirty || !!validation} onClick={save}>{saving ? "保存中…" : "保存设备预估排名"}</button>
        </>}
      </div>
    </div>
  </section>;
}


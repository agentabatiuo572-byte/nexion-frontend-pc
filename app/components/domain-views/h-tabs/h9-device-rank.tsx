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
      completionCopy: "保存设备预估排名配置并写入审计",
      detail: <>
        <div>状态：{data.enabled ? "已开启" : "已关闭"} → {enabled ? "开启" : "关闭"}；配置版本 v{data.version}。</div>
        {tiers.map((tier, index) => <div key={index}>{tier.name}：{tier.sharePct}%，{tier.minTops}–{tier.maxTops} TOPS</div>)}
        <div>在线规模来自 H9 首页数字增长。档位分布变化后建立新模拟参考；开关切换保留原模型，不改变真实设备算力、收益或奖励。</div>
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
          setError(status === 409 ? "配置已被其他操作员修改，请重新读取后核对并修改。" : `${cause instanceof Error ? cause.message : "保存回执未取得。"} 请重新读取核对是否生效；原样重试会复用同一提交编号。`);
          throw cause;
        } finally { setSaving(false); }
      },
    });
  };
  return <section className="l-card" aria-label="设备预估排名" style={{ marginBottom: 24 }}>
    <div className="l-h"><span className="ttl">设备预估排名</span><span className="sub">{data ? `已保存：${data.enabled ? "开启" : "关闭"} · v${data.version}` : "配置未读取"}</span></div>
    <div className="l-b">
      <p className="htint">按 H9「首页数字增长」的在线设备规模和下方档位生成模拟参考，当前手机按自身有效算力参与比较。这不是实测设备榜单，不影响收益或奖励。</p>
      <p className="sub">支持在线规模 1–1000 万台；在线展示量为 0 或超过 1000 万台时，App 显示排名暂不可用。切换开关保留原参考模型，档位分布变化才重新生成。</p>
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
        {!canWrite && <p>当前角色只读。</p>}
      </>}
    </div>
    <div className="l-h" style={{ borderTop: "1px solid var(--border)", borderBottom: 0 }}>
      <span className="sub">独立保存，其他 H9 设置不会覆盖本配置。</span><div className="r">
        <button className="l-btn sm" disabled={loading || saving} onClick={() => void load()}>重新读取设备排名配置</button>
        {canWrite && <>
          <button className="l-btn sm" disabled={locked || rows.length >= 20} onClick={() => setRows((current) => [...current, { name: "", sharePct: "", minTops: "", maxTops: "" }])}>添加档位</button>
          <button className="l-btn sm" disabled={locked || !dirty} onClick={() => data && accept(data)}>放弃排名改动</button>
          <button className="l-btn mc" disabled={locked || !dirty || !!validation} onClick={save}>{saving ? "保存中…" : "保存设备预估排名"}</button>
        </>}
      </div>
    </div>
  </section>;
}


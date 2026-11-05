"use client";

import { useEffect, useState } from "react";
import { parseGlobeDisplay, type GlobeDisplayConfig } from "@/lib/admin/globe-display-config";
import { updateH9PublicStats, type H9PublicStatsOverview } from "@/lib/admin/h9-client";
import { h9DraftNumber } from "@/lib/admin/h9-validation";
import type { HCtx } from "./types";

type ScalarKey = "intervalMs" | "throughputMin" | "throughputMax" | "latencyJitterMs";
type Draft = Record<ScalarKey, string> & { centers: { id: string; sharePct: string; latencyMs: string }[] };
const FIELDS: { key: ScalarKey; label: string; unit: string; scale?: number }[] = [
  { key: "intervalMs", label: "数据变化间隔", unit: "秒", scale: 1000 },
  { key: "throughputMin", label: "每任务小时处理量下限", unit: "个" },
  { key: "throughputMax", label: "每任务小时处理量上限", unit: "个" },
  { key: "latencyJitterMs", label: "延迟浮动上限", unit: "毫秒" },
];
const CENTER_NAMES: Record<string, string> = { sg: "新加坡", jp: "东京", vn: "胡志明市", uk: "伦敦", fr: "巴黎", de: "法兰克福", "us-ny": "纽约", "us-sj": "圣何塞" };
const hasShares = (config: GlobeDisplayConfig) => config.centers.every(center => center.sharePct !== undefined);
/** 后端还没下发分布比例时,按现有节点数换算一份参考比例,只读展示。 */
function shareText(config: GlobeDisplayConfig, center: GlobeDisplayConfig["centers"][number]): string {
  if (center.sharePct !== undefined) return String(center.sharePct);
  const total = config.centers.reduce((sum, row) => sum + (row.nodes ?? 0), 0);
  return total > 0 ? ((center.nodes ?? 0) / total * 100).toFixed(2) : "";
}
function draftsFrom(config: GlobeDisplayConfig): Draft {
  return { ...Object.fromEntries(FIELDS.map(field => [field.key, String(config[field.key] / (field.scale ?? 1))])),
    centers: config.centers.map(center => ({ id: center.id, sharePct: shareText(config, center), latencyMs: String(center.latencyMs) })) } as Draft;
}

export function H9GlobeDisplay({ ctx, data, refreshing, onSaved, onRefresh }: {
  ctx: HCtx; data: H9PublicStatsOverview; refreshing: boolean; onSaved: (next: H9PublicStatsOverview) => void;
  onRefresh: () => Promise<H9PublicStatsOverview | undefined>;
}) {
  const saved = data.values.globeDisplay;
  const savedKey = JSON.stringify(saved);
  const [baseline, setBaseline] = useState(saved);
  const [draft, setDraft] = useState<Draft | null>(saved ? draftsFrom(saved) : null);
  const [saving, setSaving] = useState(false);
  const dirty = !!baseline && !!draft && JSON.stringify(draft) !== JSON.stringify(draftsFrom(baseline));
  const conflict = dirty && JSON.stringify(baseline) !== savedKey;
  useEffect(() => { if (!dirty) { setBaseline(saved); setDraft(saved ? draftsFrom(saved) : null); } }, [savedKey, dirty]);
  const accept = (config: GlobeDisplayConfig) => { setBaseline(config); setDraft(draftsFrom(config)); };
  const canWrite = ctx.can("growth_h9_write");
  const locked = !canWrite || saving || refreshing;
  const sharesSupported = !!saved && hasShares(saved);
  // 不再编辑的字段(节点数、节点浮动、任务占比)按当前已保存值原样回传;后端未支持前不提交分布比例。
  const next = draft && saved ? parseGlobeDisplay({
    ...saved,
    ...Object.fromEntries(FIELDS.map(field => [field.key, field.scale
      ? /^\d+(?:\.\d{1,3})?$/.test(draft[field.key].trim()) ? Math.round(h9DraftNumber(draft[field.key]) * field.scale) : NaN
      : h9DraftNumber(draft[field.key])])),
    centers: draft.centers.map(center => ({ ...saved.centers.find(row => row.id === center.id)!, latencyMs: h9DraftNumber(center.latencyMs),
      ...(sharesSupported ? { sharePct: h9DraftNumber(center.sharePct) } : {}) })),
  }) : undefined;
  const shareTotal = draft ? draft.centers.reduce((sum, center) => sum + Math.round(h9DraftNumber(center.sharePct) * 100), 0) / 100 : Number.NaN;
  const shareError = sharesSupported && shareTotal !== 100
    ? `8 个中心的分布比例合计要等于 100%，现在是 ${Number.isFinite(shareTotal) ? shareTotal.toFixed(2) : "—"}%` : "";
  const save = () => {
    if (locked || conflict || !next || !dirty) return;
    const { registeredUsersAnchorAt: _anchor, ...current } = data.values;
    ctx.openActionConfirm({ briefKind: "config",
      action: "保存全球网络展示", reasonMin: 8, reasonMax: 200,
      completionCopy: "保存后生效，并记入操作记录。",
      detail: <>
        <div>只修改全球网络的{sharesSupported ? "分布比例、" : ""}每小时任务量与延迟展示参数；首页数字、注册用户和设备排名保持当前配置。</div>
        {FIELDS.map(field => <div key={field.key}>{field.label}：{saved![field.key] / (field.scale ?? 1)} → {next[field.key] / (field.scale ?? 1)} {field.unit}</div>)}
        {next.centers.map(center => { const before = saved!.centers.find(row => row.id === center.id)!;
          return <div key={center.id}>{CENTER_NAMES[center.id]}：{sharesSupported ? `分布比例 ${before.sharePct}% → ${center.sharePct}%，` : ""}基础延迟 {before.latencyMs} → {center.latencyMs} 毫秒</div>; })}
        <div>只用于模拟展示，不改变真实设备、任务、收益或资金。</div>
      </>,
      run: async reason => {
        setSaving(true);
        try {
          const result = await updateH9PublicStats({ ...current, globeDisplay: next }, data.version, reason);
          onSaved(result);
          if (result.values.globeDisplay) accept(result.values.globeDisplay);
          ctx.toast("全球网络展示已保存");
        } finally { setSaving(false); }
      },
    });
  };
  return <section className="l-card h9-editor" aria-label="全球网络展示">
    <div className="l-h"><span className="ttl">全球网络展示</span><span className="sub">分布比例、任务与中心详情 · v{data.version}</span></div>
    <div className="l-b">
      <div className="htint">用于 App「全球网络」的模拟展示。在线节点总数就是「首页数字增长」里的在线设备（与介绍页、网络脉搏显示同一个数）；进行中任务总数就是赚取页任务中心「N 个全球作业进行中」的数（真实进行中作业数 + 全球作业基座）。下面的分布比例只决定这两个总数怎么分到 8 个中心；每小时任务量和延迟由以下参数计算。</div>
      {conflict && <div className="htint warn" role="alert">全球网络设置已被其他操作员修改，草稿已保留。请刷新本模块后重新修改。</div>}
      {!draft ? <div className="htint warn">全球网络配置暂不可用，请刷新配置后重试。</div> : <>
        <div className="h9-form-grid">{FIELDS.map(field => <label key={field.key}>
          <span>{field.label}（{field.unit}）</span><input className="l-inp" type="text" inputMode="decimal" aria-label={`全球网络${field.label}`} value={draft[field.key]} disabled={locked}
            onChange={event => setDraft({ ...draft, [field.key]: event.target.value })} />
        </label>)}</div>
        {!sharesSupported && <div className="htint warn">分布比例后端待支持，暂时不能修改；下表的比例按现有设置换算，仅供参考。其他参数照常保存。</div>}
        <div className="h9-table-wrap"><table className="l-tbl"><thead><tr><th>中心</th><th>分布比例 %{sharesSupported ? "" : "（后端待支持）"}</th><th>基础延迟（毫秒）</th></tr></thead><tbody>
          {draft.centers.map((center, index) => <tr key={center.id}><td>{CENTER_NAMES[center.id]}</td>
            {(["sharePct", "latencyMs"] as const).map(key => <td key={key}><input className="l-inp" type="text" inputMode={key === "sharePct" ? "decimal" : "numeric"} aria-label={`${CENTER_NAMES[center.id]}${key === "sharePct" ? "分布比例" : "基础延迟"}`} value={center[key]}
              disabled={locked || key === "sharePct" && !sharesSupported}
              onChange={event => setDraft({ ...draft, centers: draft.centers.map((row, i) => i === index ? { ...row, [key]: event.target.value } : row) })} /></td>)}
          </tr>)}
          {sharesSupported && <tr><td>合计</td><td>{Number.isFinite(shareTotal) ? shareTotal.toFixed(2) : "—"}%</td><td /></tr>}
        </tbody></table></div>
        <div className="h9-help">间隔 1–86400 秒、最多三位小数；每任务小时处理量 0–10000、最多六位小数；基础延迟及浮动为 0–60000 的整数毫秒；分布比例 0–100%、最多两位小数，8 个中心合计 100%。下限不能大于上限。</div>
        {shareError && <div className="ferr" role="alert">{shareError}</div>}
        {!next && !shareError && <div className="ferr" role="alert">请检查填写范围、整数要求以及上下限顺序。</div>}
      </>}
    </div>
    <div className="l-h h9-footer"><span className="sub">单独保存，不提交其他模块的草稿。</span><div className="r">
      <button className="l-btn sm" disabled={saving || refreshing} onClick={async () => { const result = await onRefresh(); if (result?.values.globeDisplay) accept(result.values.globeDisplay); }}>刷新</button>
      {canWrite && <><button className="l-btn sm" disabled={!dirty || saving || refreshing} onClick={() => saved && accept(saved)}>放弃改动</button>
        <button className="l-btn mc" disabled={locked || conflict || !dirty || !next} onClick={save}>{saving ? "保存中…" : "保存全球网络展示"}</button></>}
    </div></div>
  </section>;
}

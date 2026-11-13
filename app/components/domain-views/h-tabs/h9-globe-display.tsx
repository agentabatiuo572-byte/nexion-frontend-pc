"use client";

/**
 * 全球网络：8 个中心的占比、延迟和吞吐。一张八行的对照表，每行带占比条，合计是不是 100% 写在表尾。
 * 和主配置同一个版本：单独保存只是把这一块的草稿合进已保存的全量值提交，不带别的块的草稿。
 */
import { useEffect, useState } from "react";
import { Globe2, RefreshCw } from "lucide-react";
import { Button, Change, DiffList, Fact, Facts, Field, Notice, NumberInput, Panel, RatioBar, StatusTag, Table, Td, Th, Tr, type DiffRow } from "@/app/components/rd";
import { parseGlobeDisplay, type GlobeDisplayConfig } from "@/lib/admin/globe-display-config";
import { updateH9PublicStats, type H9PublicStatsOverview } from "@/lib/admin/h9-client";
import { h9DraftNumber } from "@/lib/admin/h9-validation";
import type { HCtx } from "./types";
import { ModuleToolbar, count } from "./h9-parts";

type ScalarKey = "intervalMs" | "throughputMin" | "throughputMax" | "latencyJitterMs";
type Draft = Record<ScalarKey, string> & { centers: { id: string; sharePct: string; latencyMs: string }[] };
const FIELDS: { key: ScalarKey; label: string; unit: string; scale?: number; hint: string; what: string }[] = [
  { key: "intervalMs", label: "数据变化间隔", unit: "秒", scale: 1000, hint: "1–86,400 秒，最多三位小数", what: "App 全球网络页的模拟数字每隔这么久变一次。" },
  { key: "throughputMin", label: "每任务小时处理量下限", unit: "个", hint: "0–10,000，最多六位小数", what: "每小时任务量 = 进行中作业数 × 下限到上限之间的一个波动值。" },
  { key: "throughputMax", label: "每任务小时处理量上限", unit: "个", hint: "0–10,000，最多六位小数，不小于下限", what: "每小时任务量 = 进行中作业数 × 下限到上限之间的一个波动值。" },
  { key: "latencyJitterMs", label: "延迟浮动上限", unit: "毫秒", hint: "0–60,000 的整数", what: "App 上的延迟 = 基础延迟 + 0 到这个数之间的波动，只往上浮。" },
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

export function H9GlobeDisplay({ ctx, data, refreshing, onSaved, onRefresh, onIssue }: {
  ctx: HCtx; data: H9PublicStatsOverview; refreshing: boolean; onSaved: (next: H9PublicStatsOverview) => void;
  onRefresh: () => Promise<H9PublicStatsOverview | undefined>;
  /** 保存没得到明确结果时交给页面，写进页面上方的提醒。 */
  onIssue: (cause: unknown, change: string) => void;
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

  const diffRows = (target: GlobeDisplayConfig): DiffRow[] => {
    const before = saved!;
    const rows: DiffRow[] = FIELDS.map(field => ({ key: field.key, label: field.label,
      before: `${count(before[field.key] / (field.scale ?? 1))} ${field.unit}`, after: `${count(target[field.key] / (field.scale ?? 1))} ${field.unit}` }));
    for (const center of target.centers) {
      const old = before.centers.find(row => row.id === center.id)!;
      if (sharesSupported) rows.push({ key: `${center.id}-share`, label: `${CENTER_NAMES[center.id]} · 占比`, before: `${old.sharePct}%`, after: `${center.sharePct}%` });
      rows.push({ key: `${center.id}-latency`, label: `${CENTER_NAMES[center.id]} · 基础延迟`, before: `${count(old.latencyMs)} 毫秒`, after: `${count(center.latencyMs)} 毫秒` });
    }
    return rows;
  };

  const save = () => {
    if (locked || conflict || !next || !dirty) return;
    const { registeredUsersAnchorAt: _anchor, ...current } = data.values;
    const rows = diffRows(next);
    const changed = rows.filter(row => row.before !== row.after);
    ctx.openActionConfirm({ briefKind: "config",
      action: "保存全球网络展示", reasonMin: 8, reasonMax: 200,
      title: "保存全球网络",
      effect: <StatusTag tone="progress" filled>立即生效</StatusTag>,
      confirmLabel: "确认保存",
      statedBrief: { impact: "保存后 App 全球网络页按新的占比、延迟和吞吐模拟展示；首页数字、注册人数和设备排名不变。", check: "核对改动和 8 个中心的占比合计，理由写清调整依据。" },
      reasonPlaceholder: "例如：运营活动安排、工单号",
      facts: <>
        <Facts>
          <Fact k="改的是">全球网络{sharesSupported ? "（占比、" : "（"}每小时任务量与延迟）</Fact>
          <Fact k="主配置版本"><Change from={`v${data.version}`} to={`v${data.version + 1}`} /></Fact>
          <Fact k="操作记录">记一条高风险操作记录（不走审批）</Fact>
        </Facts>
        <DiffList rows={rows} emptyNote="参数没有改动" restTitle="没改的项" />
      </>,
      detail: "只用于模拟展示，不改变真实设备、任务、收益或资金。别的块没保存的草稿不会带上。",
      run: async reason => {
        setSaving(true);
        try {
          const result = await updateH9PublicStats({ ...current, globeDisplay: next }, data.version, reason);
          onSaved(result);
          if (result.values.globeDisplay) accept(result.values.globeDisplay);
          ctx.toast("全球网络展示已保存", "success");
        } catch (cause) {
          onIssue(cause, changed.slice(0, 2).map(row => `${row.label} ${row.before} → ${row.after}`).join("；") + (changed.length > 2 ? `；等 ${changed.length} 项` : ""));
          throw cause;
        } finally { setSaving(false); }
      },
    });
  };

  const saveBlock = refreshing ? "正在读取最新数据，读完再保存" : saving ? "正在保存" : conflict ? "这块已被别人改过，先刷新这一块" : !dirty ? "没有改动" : shareError ? "8 个中心的占比合计要等于 100%" : !next ? "有填错的项，按提示改" : undefined;
  const note = refreshing ? "正在读取…" : !dirty ? "没有改动" : shareError || !next ? "有要改的地方" : "有改动，还没保存";
  const jitter = draft ? h9DraftNumber(draft.latencyJitterMs) : Number.NaN;
  const shareGap = Number((100 - shareTotal).toFixed(2));

  return <section aria-label="全球网络展示">
    <Panel title="全球网络 · 8 个中心" icon={Globe2} tone="role-2" sub={`主配置 v${data.version}`}
      explain={<>
        <p>App「全球网络」页的模拟展示。在线节点总数就是首页数字增长里的在线设备，进行中任务总数就是赚取页任务中心显示的数（真实进行中作业数 + 全球作业基座）。</p>
        <p>占比只决定这两个总数怎么分到 8 个中心，各中心加起来正好等于总数；每小时任务量和延迟按下面的参数模拟。这些都不是实测遥测。</p>
      </>}>
      {conflict && <Notice tone="warn" title="这块已被别人改过" action={<Button size="sm" disabled={saving || refreshing} onClick={async () => { const result = await onRefresh(); if (result?.values.globeDisplay) accept(result.values.globeDisplay); }}>刷新这一块</Button>}>
        你填的内容还在。刷新会读最新值并放弃这一块没保存的改动，再按最新值重新改。
      </Notice>}
      {!draft ? <Notice tone="warn" title="全球网络还没有配置">后端没返回这一块，刷新后再看；一直没有请找后端同事核对。</Notice> : <>
        {!sharesSupported && <Notice tone="warn" title="占比暂时只读">旧格式的配置没有占比，下表的比例按各中心节点数换算，只供参考，不能改；其他参数照常保存。</Notice>}
        <div className="h9-globe-fields">{FIELDS.map(field => <Field key={field.key} label={field.label} hint={field.hint} explain={field.what}>
          {(control) => <NumberInput {...control} aria-label={`全球网络${field.label}`} unit={field.unit} min={0} inputMode="decimal" value={draft[field.key]} disabled={locked}
            onChange={event => setDraft({ ...draft, [field.key]: event.target.value })} />}
        </Field>)}</div>
        <Table label="8 个中心的占比和延迟" className="h9-centers">
          <thead><tr><Th>中心</Th><Th>占比</Th><Th>基础延迟</Th><Th align="right">App 上的延迟</Th></tr></thead>
          <tbody>
            {draft.centers.map((center, index) => {
              const share = h9DraftNumber(center.sharePct);
              const base = h9DraftNumber(center.latencyMs);
              return <Tr key={center.id}>
                <Td>{CENTER_NAMES[center.id]}</Td>
                <Td><span className="h9-share">
                  <NumberInput aria-label={`${CENTER_NAMES[center.id]}${"分布比例"}`} unit="%" min={0} max={100} inputMode="decimal" value={center.sharePct}
                    disabled={locked || !sharesSupported}
                    onChange={event => setDraft({ ...draft, centers: draft.centers.map((row, i) => i === index ? { ...row, sharePct: event.target.value } : row) })} />
                  {Number.isFinite(share) && share >= 0 && share <= 100 && <RatioBar compact quiet label="占比" value={share} total={100} valueText={`占 ${share}%`} tone="role-2" />}
                </span></Td>
                <Td><NumberInput aria-label={`${CENTER_NAMES[center.id]}${"基础延迟"}`} unit="毫秒" min={0} max={60000} inputMode="numeric" value={center.latencyMs} disabled={locked}
                  onChange={event => setDraft({ ...draft, centers: draft.centers.map((row, i) => i === index ? { ...row, latencyMs: event.target.value } : row) })} /></Td>
                <Td align="right">{Number.isFinite(base) && Number.isFinite(jitter) ? `${count(base)}–${count(base + jitter)} 毫秒` : "—"}</Td>
              </Tr>;
            })}
            <Tr>
              <Td><b>合计</b></Td>
              <Td><span className="h9-share-total">
                <b>{Number.isFinite(shareTotal) ? `${shareTotal.toFixed(2)}%` : "—"}</b>
                {!sharesSupported ? <StatusTag tone="neutral">按节点数换算</StatusTag>
                  : shareTotal === 100 ? <StatusTag tone="ok">等于 100%</StatusTag>
                    : Number.isFinite(shareTotal) ? <StatusTag tone="warn">{shareGap > 0 ? `还差 ${shareGap}%` : `多了 ${-shareGap}%`}</StatusTag> : null}
              </span></Td>
              <Td />
              <Td />
            </Tr>
          </tbody>
        </Table>
        <p className="h9-band-rule">占比 0–100%、最多两位小数，8 个中心合计 100%；基础延迟 0–60,000 的整数毫秒。</p>
        {shareError && <Notice tone="warn">{shareError}</Notice>}
        {!next && !shareError && <Notice tone="warn">请检查填写范围、整数要求以及上下限顺序。</Notice>}
      </>}
      <ModuleToolbar note={note} tone={dirty && (!!shareError || !next) ? "warn" : undefined}>
        <Button variant="ghost" size="sm" icon={<RefreshCw size={14} aria-hidden />} disabled={saving || refreshing} onClick={async () => { const result = await onRefresh(); if (result?.values.globeDisplay) accept(result.values.globeDisplay); }}>刷新这一块</Button>
        {canWrite && <>
          <Button size="sm" disabled={!dirty || saving || refreshing} onClick={() => saved && accept(saved)}>放弃改动</Button>
          <Button variant="primary" size="sm" loading={saving} loadingText="保存中…" disabledReason={saving ? undefined : saveBlock} onClick={save}>保存全球网络展示</Button>
        </>}
      </ModuleToolbar>
    </Panel>
  </section>;
}


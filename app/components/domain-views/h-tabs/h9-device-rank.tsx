"use client";

/**
 * 设备预估排名：独立的一套设置（自己的读取、版本和保存），和主配置的五块分开放，冲突和结果未知的提醒也分开。
 * 档位表一行一档，占比带比例条，合计是不是 100% 写在表尾。
 */
import { useCallback, useEffect, useState } from "react";
import { Plus, RefreshCw, Trophy } from "lucide-react";
import { BlockState, Button, Change, Explain, Fact, Input, Notice, NumberInput, Panel, RatioBar, Segments, StatusTag, Table, TableMessage, Td, Th, Tr, type DiffRow } from "@/app/components/rd";
import { fetchDeviceRankConfig, updateDeviceRankConfig } from "@/lib/admin/device-rank-client";
import { deviceRankConfigError, type DeviceRankConfig, type DeviceRankTierDraft } from "@/lib/admin/device-rank-config";
import { h9DraftNumber } from "@/lib/admin/h9-validation";
import type { HCtx } from "./types";
import type { RankSnapshot } from "./h9-overview";
import { AppPreview, ConfirmFacts, H9RecoveryNotice, ModuleToolbar, count, saveIssueKind, type SaveIssueKind } from "./h9-parts";

const tierDrafts = (config: DeviceRankConfig): DeviceRankTierDraft[] => config.tiers.map((tier) => ({
  name: tier.name, sharePct: String(tier.sharePct), minTops: String(tier.minTops), maxTops: String(tier.maxTops),
}));

const tierText = (tier: DeviceRankConfig["tiers"][number]) => `${tier.sharePct}% · ${count(tier.minTops)}–${count(tier.maxTops)} TOPS`;

export function H9DeviceRank({ ctx, onData }: { ctx: HCtx; onData: (snapshot: RankSnapshot) => void }) {
  const canWrite = ctx.can("growth_h9_write");
  const [data, setData] = useState<DeviceRankConfig | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [rows, setRows] = useState<DeviceRankTierDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  /** 上次保存失败按哪种写：只决定提醒的位置和颜色。 */
  const [issue, setIssue] = useState<{ kind: SaveIssueKind; change: string; at: number } | null>(null);
  const accept = (next: DeviceRankConfig) => {
    setData(next); setEnabled(next.enabled); setRows(tierDrafts(next)); setError(""); setConflict(false); setIssue(null);
    onData({ state: "ready", config: next });
  };
  const load = useCallback(async () => {
    setLoading(true);
    try { accept(await fetchDeviceRankConfig()); }
    catch (cause) { setData(null); setError(cause instanceof Error ? cause.message : "配置读取失败，请重试。"); onData({ state: "failed" }); }
    finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // 只比较占比和上下界（按顺序），不比较名称：和后端 sameDistribution 同一个口径，只用来写确认框里的一句。
    const sameDistribution = tiers.length === data.tiers.length && tiers.every((tier, index) => tier.sharePct === data.tiers[index].sharePct
      && tier.minTops === data.tiers[index].minTops && tier.maxTops === data.tiers[index].maxTops);
    const diff: DiffRow[] = [
      { key: "enabled", label: "状态", before: data.enabled ? "已开启" : "已关闭", after: enabled ? "已开启" : "已关闭" },
      ...Array.from({ length: Math.max(tiers.length, data.tiers.length) }, (_, index): DiffRow[] => {
        const before = data.tiers[index];
        const after = tiers[index];
        const name = after?.name || before?.name || `第 ${index + 1} 档`;
        if (!before) return [{ key: `tier-${index}`, label: `新增 · ${name}`, before: "没有", after: tierText(after!) }];
        if (!after) return [{ key: `tier-${index}`, label: `删除 · ${name}`, before: tierText(before), after: "删除" }];
        return [
          { key: `tier-${index}-name`, label: `第 ${index + 1} 档名称`, before: before.name, after: after.name },
          { key: `tier-${index}-share`, label: `${name} · 占比`, before: `${before.sharePct}%`, after: `${after.sharePct}%` },
          { key: `tier-${index}-tops`, label: `${name} · 算力`, before: `${count(before.minTops)}–${count(before.maxTops)} TOPS`, after: `${count(after.minTops)}–${count(after.maxTops)} TOPS` },
        ];
      }).flat(),
    ];
    const changed = diff.filter((row) => row.before !== row.after);
    ctx.openActionConfirm({ briefKind: "config",
      action: "保存设备预估排名", reasonMin: 8, reasonMax: 200,
      title: "保存设备预估排名",
      effect: <StatusTag tone="progress" filled>立即生效</StatusTag>,
      confirmLabel: "确认保存",
      statedBrief: { impact: enabled ? "保存后 App 按新档位给用户估一个设备排名（参考，不是真实榜单），不影响真实算力、收益和奖励。" : "保存后 App 不再显示设备排名，改为占位说明；档位留着，下次开启照用。", check: "核对档位占比合计 100% 和算力范围，理由写清调整依据。" },
      reasonPlaceholder: "例如：运营活动安排、工单号",
      facts: <ConfirmFacts rows={diff} rest="没改的档" facts={<>
        <Fact k="排名设置版本"><Change from={`v${data.version}`} to={`v${data.version + 1}`} /></Fact>
        <Fact k="参考样本">{sameDistribution ? "不变（只改了开关或名称）" : "按新的档位分布重新生成"}</Fact>
        <Fact k="操作记录">记一条高风险操作记录（不走审批）</Fact>
      </>} />,
      detail: "在线设备数取自首页数字增长。排名是独立的一套设置，不受本页其他块的保存影响。",
      run: async (reason) => {
        setSaving(true);
        try {
          const saved = await updateDeviceRankConfig(submitted, reason);
          accept(saved);
          ctx.toast(`设备预估排名已保存 · 版本 v${saved.version}`, "success");
        } catch (cause) {
          const status = (cause as { status?: number })?.status;
          const kind = saveIssueKind(cause, ["DEVICE_RANK_VERSION_CONFLICT"]);
          setConflict(status === 409);
          setIssue({ kind, change: changed.slice(0, 2).map((row) => `${row.label} ${row.before} → ${row.after}`).join("；") + (changed.length > 2 ? `；等 ${changed.length} 项` : ""), at: Date.now() });
          setError(cause instanceof Error ? cause.message : "保存没有得到确定结果。");
          throw cause;
        } finally { setSaving(false); }
      },
    });
  };

  const shareTotal = tiers.reduce((sum, tier) => sum + (Number.isFinite(tier.sharePct) ? Math.round(tier.sharePct * 100) : 0), 0) / 100;
  const shareGap = Number((100 - shareTotal).toFixed(2));
  const saveBlock = loading ? "正在读取最新数据，读完再保存" : saving ? undefined : conflict ? issue?.kind === "conflict" ? "排名设置已被别人改过，先刷新这一块" : "这次保存没得到确定结果，先刷新这一块" : !dirty ? "没有改动" : validation || undefined;
  const note = loading ? "正在读取…" : !canWrite ? "只能查看" : !dirty ? "没有改动" : validation ? validation : "有改动，还没保存";
  const refresh = <Button variant="ghost" size="sm" icon={<RefreshCw size={14} aria-hidden />} disabled={loading || saving} onClick={() => void load()}>刷新这一块</Button>;

  const issueNotice = issue && (issue.kind === "conflict"
    ? <Notice tone="warn" title="保存没成功：排名设置已被别人改过" action={<Button size="sm" disabled={loading} onClick={() => void load()}>刷新这一块</Button>}>这次没有保存。刷新读到最新值后再改，避免盖掉别人的设置。</Notice>
    : issue.kind === "rejected"
      ? <Notice tone="danger" title="保存被拒">{error} 这次没有保存，按原因改好后再保存。</Notice>
      : <H9RecoveryNotice explain={<>
        <p>提交时没收到确定结果：这次保存可能已经生效，也可能没有。{error}</p>
        <p>先点「刷新核对」看现在的设置是不是你要的。原样重试（同样的档位、同样的理由）后端认得出是同一次提交，不会重复保存。</p>
      </>} rows={[{ key: "rank", name: "设备预估排名", change: issue.change, submittedAt: issue.at,
        actions: <Button size="sm" disabled={loading} onClick={() => void load()}>刷新核对</Button> }]} />);

  return <section className="h9-rank" aria-label="设备预估排名">
    {issueNotice}
    <Panel title="设备预估排名" icon={Trophy} tone="role-4" sub={data ? `排名设置 v${data.version} · 单独保存` : undefined}
      explain="独立的一套设置：自己的版本、自己保存，不受本页其他块影响。App 用首页数字增长的在线设备数和这里的档位估一个排名；这不是真实榜单，不影响收益和奖励。">
      {loading && !data && <BlockState state="loading" title="设备预估排名读取中…" />}
      {!loading && !data && <BlockState state="error" title="设备预估排名读取失败" detail={`${error} 这一块看不到也改不了，其余五块不受影响。`} onRetry={() => void load()} />}
      {data && <>
        <AppPreview where="App 首页 · 网络脉搏" explain="App 拿服务端记录的手机算力和这些档位比，估一个名次（参考，不是真实榜单）。在线设备不在 1–10,000,000 台之间时显示「暂不可用」；没有手机算力时显示「未排名」。">
          <div className="h9-rank-state">
            <StatusTag tone={data.enabled ? "ok" : "neutral"}>{data.enabled ? "已开启" : "已关闭"}</StatusTag>
            <span>{data.enabled ? `App 按 ${data.tiers.length} 档分布给用户估设备排名` : "App 显示占位，说明排名没有开启"}</span>
          </div>
        </AppPreview>
        <div className="h9-rank-switch">
          <span className="h9-rank-switch-label">状态<Explain label="状态的说明" content="保存后生效。关闭时可以没有档位；开启时至少 1 档。" /></span>
          <Segments label="启用设备预估排名" value={enabled ? "on" : "off"} onChange={(value) => { if (!locked) setEnabled(value === "on"); }}
            items={[{ value: "on", label: "开启", disabled: locked }, { value: "off", label: "关闭", disabled: locked }]} />
        </div>
        <Table label="排名档位" className="h9-tiers">
          <thead><tr><Th>档位名称</Th><Th>占比</Th><Th>最低算力</Th><Th>最高算力</Th>{canWrite && <Th align="right">操作</Th>}</tr></thead>
          <tbody>
            {rows.map((row, index) => {
              const share = h9DraftNumber(row.sharePct);
              return <Tr key={index}>
                <Td><Input aria-label={`第${index + 1}档${"名称"}`} value={row.name} disabled={locked} onChange={(event) => change(index, "name", event.target.value)} /></Td>
                <Td><span className="h9-share">
                  {Number.isFinite(share) && share >= 0 && share <= 100 && <RatioBar compact quiet label="占比" value={share} total={100} valueText={`占 ${share}%`} tone="role-4" />}
                  <NumberInput aria-label={`第${index + 1}档${"占比"}`} unit="%" min={0} max={100} inputMode="decimal" value={row.sharePct} disabled={locked} onChange={(event) => change(index, "sharePct", event.target.value)} />
                </span></Td>
                <Td><NumberInput aria-label={`第${index + 1}档${"最低算力"}`} unit="TOPS" min={0} max={1_000_000_000} inputMode="decimal" value={row.minTops} disabled={locked} onChange={(event) => change(index, "minTops", event.target.value)} /></Td>
                <Td><NumberInput aria-label={`第${index + 1}档${"最高算力"}`} unit="TOPS" min={0} max={1_000_000_000} inputMode="decimal" value={row.maxTops} disabled={locked} onChange={(event) => change(index, "maxTops", event.target.value)} /></Td>
                {canWrite && <Td align="right"><Button size="sm" variant="ghost" aria-label={`删除第${index + 1}档`} disabled={locked} onClick={() => setRows((current) => current.filter((_, i) => i !== index))}>删除</Button></Td>}
              </Tr>;
            })}
            {rows.length === 0 && <TableMessage columns={canWrite ? 5 : 4}>还没有档位。关闭时可以没有档位；开启前至少加 1 档。</TableMessage>}
            {rows.length > 0 && <Tr>
              <Td><b>合计</b></Td>
              <Td><span className="h9-share-total">
                <b>{shareTotal.toFixed(2)}%</b>
                {shareTotal === 100 ? <StatusTag tone="ok">等于 100%</StatusTag> : <StatusTag tone="warn">{shareGap > 0 ? `还差 ${shareGap}%` : `多了 ${-shareGap}%`}</StatusTag>}
              </span></Td>
              <Td /><Td />{canWrite && <Td />}
            </Tr>}
          </tbody>
        </Table>
        <p className="h9-band-rule">最多 20 档，名称 1–60 字；占比最多两位小数、合计 100%；算力 0–1,000,000,000 TOPS，<span className="rd-keep">最多六位小数，最低不大于最高。</span></p>
      </>}
      <ModuleToolbar note={note} tone={dirty && validation ? "warn" : undefined}>
        {refresh}
        {canWrite && data && <>
          <Button size="sm" icon={<Plus size={14} aria-hidden />} disabledReason={rows.length >= 20 ? "最多 20 档" : undefined} disabled={locked} onClick={() => setRows((current) => [...current, { name: "", sharePct: "", minTops: "", maxTops: "" }])}>添加档位</Button>
          <Button size="sm" disabled={locked || !dirty} onClick={() => data && accept(data)}>放弃改动</Button>
          <Button variant="primary" size="sm" loading={saving} loadingText="保存中…" disabledReason={saving ? undefined : saveBlock} disabled={!canWrite || !data} onClick={save}>保存设备预估排名</Button>
        </>}
      </ModuleToolbar>
    </Panel>
  </section>;
}

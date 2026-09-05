"use client";

/**
 * H9「对外公布数据」—— 规格 FEAT-HOME02b 后台单元。
 *
 * 运营在这里配置前端首页对外公布的平台规模(设备总数 / 在线占比 / 注册用户)与名次口径
 * (虚拟人口 + 算力分位表)。7 个参数 + 1 张分位表整组原子保存:
 * 确认弹窗给前后值 diff → 必填理由 → 服务端落审计 + 幂等键,任一项非法整组不落库。
 *
 * 🔴 页面里没有任何平台数字的字面量:当前值、默认种子、公布日产锚都从服务端读模型来。
 *    「改了设备总数会连带改掉哪些金额」由下方影响预览现算给运营看(规格 ②异常2),
 *    不靠运营自己心算,也不在后台另存一份日产档。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PaginationExemption } from "../design-kit";
import { formatAdminApiError } from "@/lib/admin/error-messages";
import {
  H9_FIELDS,
  fetchH9PublicStats,
  updateH9PublicStats,
  type H9EditableValues,
  type H9FieldDef,
  type H9PercentileBand,
  type H9PublicStatsOverview,
  type H9PublicStatsValues,
} from "@/lib/admin/h9-client";
// 🔴 分位表值域规则唯一来源(与前端 network-rank.ts 行为等价,契约测试钉着)——
//    面板不许手写第二份判据;parity 门查的是「用途位」出现,不是 import 位。
import {
  H9_BAND_MIN,
  H9_BAND_TOPS_MIN,
  h9BandRowErrors,
  h9DraftNumber as num,
  h9PlaceholderCopy,
  type H9BandDraft as BandDraft,
} from "@/lib/admin/h9-validation";
import type { HCtx } from "./types";

type ScalarKey = H9FieldDef["key"];
type ScalarDrafts = Record<ScalarKey, string>;

const SECTIONS: { title: string; sub: string; keys: ScalarKey[] }[] = [
  { title: "平台规模", sub: "首页「在线设备」这一格,以及全部对外公布的平台级金额都从这里派生", keys: ["fleetDevices", "onlineRatePct", "onlineJitter"] },
  { title: "用户规模", sub: "首页「注册用户」这一格的展示基数与增速", keys: ["registeredUsersBase", "registeredUsersMonthlyGrowthPct"] },
  { title: "名次口径", sub: "决定用户在首页看到的「你的排名」怎么算出来", keys: ["virtualUserCount"] },
];

const int = (value: number) => (Number.isFinite(value) ? Math.round(value).toLocaleString("en-US") : "—");
const money = (value: number) => (Number.isFinite(value) ? `$${Math.round(value).toLocaleString("en-US")}` : "—");
const money2 = (value: number) => (Number.isFinite(value) ? `$${value.toFixed(2)}` : "—");
const when = (ms: number) => (Number.isFinite(ms) && ms > 0 ? new Date(ms).toLocaleString("zh-CN", { hour12: false }) : "—");

function draftsFrom(values: H9PublicStatsValues): ScalarDrafts {
  return Object.fromEntries(H9_FIELDS.map((field) => [field.key, String(values[field.key])])) as ScalarDrafts;
}

function bandDraftsFrom(values: H9PublicStatsValues): BandDraft[] {
  return values.hashratePercentileTable.map((band) => ({ tops: String(band.tops), cumPct: String(band.cumPct) }));
}

/** 单个数值参数的合法域校验 → 返回运营看得懂的红字,合法返回空串。 */
function scalarError(field: H9FieldDef, raw: string): string {
  const value = num(raw);
  if (!Number.isFinite(value)) return "请填数字";
  if (value < field.min || value > field.max) return `超出合法范围 ${field.min}–${field.max}${field.unit}`;
  if (field.integer && !Number.isInteger(value)) return "只能填整数";
  return "";
}

function sameBands(a: H9PercentileBand[], b: H9PercentileBand[]) {
  return a.length === b.length && a.every((row, index) => row.tops === b[index].tops && row.cumPct === b[index].cumPct);
}

function bandsText(rows: H9PercentileBand[]) {
  return rows.map((row) => `${row.tops} 算力→${row.cumPct}%`).join(" · ") || "(空)";
}

export function H9PublicStats({ ctx }: { ctx: HCtx }) {
  const canWrite = ctx.can("growth_h9_write");
  const [data, setData] = useState<H9PublicStatsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<ScalarDrafts | null>(null);
  const [bands, setBands] = useState<BandDraft[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await fetchH9PublicStats();
      setData(next);
      setDrafts(draftsFrom(next.values));
      setBands(bandDraftsFrom(next.values));
      setError(null);
      setSaveError(null);
    } catch (cause) {
      setData(null);
      setDrafts(null);
      setBands([]);
      // 运营面只出中文:解析错 / 网络错的机器码都过一遍共享错误字典。
      setError(formatAdminApiError(cause instanceof Error ? cause.message : null, "H9_DATA_LOAD_FAILED"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const fieldErrors = useMemo(() => {
    if (!drafts) return {} as Record<ScalarKey, string>;
    return Object.fromEntries(H9_FIELDS.map((field) => [field.key, scalarError(field, drafts[field.key])])) as Record<ScalarKey, string>;
  }, [drafts]);

  const rowErrors = useMemo(() => h9BandRowErrors(bands), [bands]);
  const bandCountError = bands.length < H9_BAND_MIN
    ? `分位表至少要有 ${H9_BAND_MIN} 档,现在 ${bands.length} 档`
    : "";
  const allValid = Object.values(fieldErrors).every((text) => !text) && rowErrors.every((text) => !text) && !bandCountError;

  /** 草稿 → 可提交值(仅在 allValid 时有意义)。 */
  const nextValues: H9EditableValues | null = useMemo(() => {
    if (!drafts || !allValid) return null;
    return {
      ...(Object.fromEntries(H9_FIELDS.map((field) => [field.key, num(drafts[field.key])])) as Record<ScalarKey, number>),
      hashratePercentileTable: bands.map((row) => ({ tops: num(row.tops), cumPct: num(row.cumPct) })),
    } as H9EditableValues;
  }, [drafts, allValid, bands]);

  const dirty = useMemo(() => {
    if (!data || !drafts) return false;
    if (H9_FIELDS.some((field) => drafts[field.key].trim() !== String(data.values[field.key]))) return true;
    return bands.length !== data.values.hashratePercentileTable.length
      || bands.some((row, index) => {
        const saved = data.values.hashratePercentileTable[index];
        return row.tops.trim() !== String(saved.tops) || row.cumPct.trim() !== String(saved.cumPct);
      });
  }, [data, drafts, bands]);

  /** 影响预览:同一组公式分别代入「当前值」与「保存后」,让运营直接看到差在哪。 */
  const impact = useMemo(() => {
    if (!data) return null;
    const perDevice = data.publishedDailyUsdPerDevice;
    const derive = (fleet: number, ratePct: number, virtualCount: number) => ({
      online: fleet * ratePct / 100,
      daily: fleet * perDevice,
      perSec: fleet * perDevice / 86_400,
      monthly: fleet * perDevice * 30,
      denominator: data.realUserCount + virtualCount,
    });
    const current = derive(data.values.fleetDevices, data.values.onlineRatePct, data.values.virtualUserCount);
    const draftFleet = drafts ? num(drafts.fleetDevices) : Number.NaN;
    const draftRate = drafts ? num(drafts.onlineRatePct) : Number.NaN;
    const draftVirtual = drafts ? num(drafts.virtualUserCount) : Number.NaN;
    return { perDevice, current, next: derive(draftFleet, draftRate, draftVirtual) };
  }, [data, drafts]);

  const setDraft = (key: ScalarKey, value: string) => setDrafts((current) => (current ? { ...current, [key]: value } : current));
  const setBand = (index: number, key: keyof BandDraft, value: string) =>
    setBands((current) => current.map((row, i) => (i === index ? { ...row, [key]: value } : row)));
  const addBand = () => setBands((current) => [...current, { tops: "", cumPct: "" }]);
  const removeBand = (index: number) => setBands((current) => current.filter((_, i) => i !== index));
  const restoreCurrent = () => {
    if (!data) return;
    setDrafts(draftsFrom(data.values));
    setBands(bandDraftsFrom(data.values));
    setSaveError(null);
  };
  const fillDefaults = () => {
    if (!data) return;
    setDrafts(draftsFrom(data.defaults));
    setBands(bandDraftsFrom(data.defaults));
    ctx.toast("已回填出厂默认值 —— 还没保存,点「保存变更」走确认后才生效");
  };

  const save = () => {
    if (!data || !nextValues) return;
    // 🔴 这里不铸幂等键:键由 updateH9PublicStats 从槽位存储按「值 + 版本 + 理由」取,
    //    否则每点一次「保存变更」都是一条全新命令,失败横幅承诺的「同一个幂等键」就是空的。
    const diffs = H9_FIELDS
      .filter((field) => nextValues[field.key] !== data.values[field.key])
      .map((field) => `${field.label}:${data.values[field.key]}${field.unit} → ${nextValues[field.key]}${field.unit}`);
    if (!sameBands(nextValues.hashratePercentileTable, data.values.hashratePercentileTable)) {
      diffs.push(`算力分位表:${bandsText(data.values.hashratePercentileTable)} → ${bandsText(nextValues.hashratePercentileTable)}`);
    }
    const fleetChanged = nextValues.fleetDevices !== data.values.fleetDevices;
    const baseChanged = nextValues.registeredUsersBase !== data.values.registeredUsersBase;
    const virtualZero = nextValues.virtualUserCount === 0 && data.values.virtualUserCount !== 0;
    const nextDaily = nextValues.fleetDevices * data.publishedDailyUsdPerDevice;

    ctx.openActionConfirm({
      action: "保存对外公布数据",
      detail: <>
        <div>本次改动({diffs.length} 项):</div>
        {diffs.map((line) => <div key={line}>· {line}</div>)}
        {fleetChanged && <div>
          ⚠️ 设备总数变了,对外公布的日支付额同步从 {money(data.values.fleetDevices * data.publishedDailyUsdPerDevice)} 变成 {money(nextDaily)}
          (每台每日 {money2(data.publishedDailyUsdPerDevice)} 不变),每秒支付流与本月累计一并跟着变。介绍页与信任页读取这组公开统计，会一起变；全球网络使用独立区域投影，不受此字段驱动。
        </div>}
        {baseChanged && <div>⚠️ 改了注册用户基数,推算起点会重置为本次保存时刻 —— 前端从新起点按增速往后推算,不会回退。</div>}
        {virtualZero && <div>⚠️ 虚拟人口填了 0:名次分母只剩真实注册人口({int(data.realUserCount)} 人),用户看到的名次会大幅提前。确认这是有意为之。</div>}
        <div>本次提交基于配置版本 v{data.version};并发改动会返回 409,任何一项不合法都整组不落库。</div>
        <div>保存后影响前端展示与派生金额口径,操作理由会写入审计。</div>
      </>,
      // 🔴 不挂 amplifies:它的语义是「放大资金流出方向,系统会先检查备付金覆盖率」(K 域契约),
      //    而本页改的是**对外公布口径**,一分钱都不流出,也没传 coverage —— 挂上等于在弹窗里
      //    向运营承诺一道根本没跑的资金闸。改设备总数的警示由上方 fleetChanged 段落负责。
      reasonMin: 8,
      reasonMax: 200,
      completionCopy: "保存成功后立即对前端生效并写入审计",
      run: async (reason) => {
        try {
          const saved = await updateH9PublicStats(nextValues, data.version, reason);
          setData(saved);
          setDrafts(draftsFrom(saved.values));
          setBands(bandDraftsFrom(saved.values));
          setSaveError(null);
          ctx.toast(`对外公布数据已保存 · 版本 v${saved.version} · 已记审计`);
        } catch (cause) {
          const message = formatAdminApiError(cause instanceof Error ? cause.message : null, "H9_SAVE_FAILED");
          setSaveError(message);
          ctx.toast(`保存失败 · ${message} —— 未生效,可原样重试`);
          throw cause;
        }
      },
    });
  };

  if (loading && !data) return <section className="l-card"><div className="l-b">对外公布数据加载中...</div></section>;

  if (!data || !drafts) {
    return <section className="l-card">
      <div className="l-h"><span className="ttl">对外公布数据暂时读不到</span></div>
      <div className="l-b">
        {/* 文案拼接走 h9PlaceholderCopy:字典整句自带句号,直接再拼「。」就是双句号(P2-15 回归)。 */}
        <div className="htint danger">{h9PlaceholderCopy(error)}</div>
        <div style={{ marginTop: 10 }}><button className="l-btn" onClick={() => void load()}>重试</button></div>
      </div>
    </section>;
  }

  return <>
    <div className="f-stats">
      <div className="f-stat cyan"><div className="k">对外公布设备总数</div><div className="v">{int(data.values.fleetDevices)}</div><div className="sub">首页在线设备与平台金额的共同来源</div></div>
      <div className="f-stat"><div className="k">首页在线设备</div><div className="v">{int(data.values.fleetDevices * data.values.onlineRatePct / 100)}</div><div className="sub">设备总数 × 在线占比 {data.values.onlineRatePct}%</div></div>
      <div className="f-stat"><div className="k">对外公布注册用户</div><div className="v">{int(data.values.registeredUsersBase)}</div><div className="sub">按 {data.values.registeredUsersMonthlyGrowthPct}%/月 往后推算展示</div></div>
      <div className="f-stat ok"><div className="k">名次分母</div><div className="v">{int(data.realUserCount + data.values.virtualUserCount)}</div><div className="sub">真实注册人口 + 虚拟人口</div></div>
    </div>

    {saveError && <div className="htint danger" style={{ marginBottom: 12 }}>
      上次保存没成功:{saveError} —— <b>本次改动没有生效,也没有落审计</b>。
      如果是别人同时改了这页,先点「刷新」拿最新值再改;其它情况可以直接再点「保存变更」原样重试
      —— 值、版本与理由都不变时用的是同一个幂等键(刷新页面也还是它),服务端不会重复落账;
      或先「放弃改动」把页面回填成当前生效值。
    </div>}

    <div className="two-col">
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">对外公布数据</span>
          <span className="sub">· 生效版本 v{data.version} · {when(Date.parse(data.effectiveAt))} · {canWrite ? "可改" : "当前角色只读"}</span>
          <div className="r">
            <button className="l-btn sm" onClick={() => void load()}>刷新</button>
            {canWrite && <button className="l-btn sm" onClick={fillDefaults}>恢复默认</button>}
            {canWrite && <button className="l-btn sm" disabled={!dirty} onClick={restoreCurrent}>放弃改动</button>}
            {canWrite && <button className="l-btn mc" disabled={!dirty || !allValid} title={!dirty ? "没有改动" : !allValid ? "有参数不合法,先按红字改" : undefined} onClick={save}>保存变更</button>}
          </div>
        </div>
        <div className="l-b">
          {SECTIONS.map((section) => <div key={section.title}>
            <div className="hgrp"><span className="t">{section.title}</span><span className="s">{section.sub}</span></div>
            {section.keys.map((key) => {
              const field = H9_FIELDS.find((item) => item.key === key)!;
              return <div className="p-row" key={key}>
                <div className="txt">
                  <div className="k">{field.label} <span className="hcode">{field.key}</span></div>
                  <div className="s">合法范围 {field.min}–{field.max}{field.unit}{field.integer ? "(整数)" : ""} · {field.hint}</div>
                  {fieldErrors[key] && <div className="ferr">{fieldErrors[key]}</div>}
                </div>
                <input
                  aria-label={`${field.label}目标值`}
                  className="l-inp"
                  type="number"
                  min={field.min}
                  max={field.max}
                  step={field.step}
                  value={drafts[key]}
                  disabled={!canWrite}
                  onChange={(event) => setDraft(key, event.target.value)}
                />
                <span className="unit">{field.unit}</span>
              </div>;
            })}
          </div>)}
          <div className="p-row">
            <div className="txt">
              <div className="k">注册用户推算起点 <span className="hcode">registeredUsersAnchorAt</span></div>
              <div className="s">前端从这个时刻按月增长率往后推算当前注册数。不用手填 —— 改了注册用户基数,保存时自动重置为保存时刻。</div>
            </div>
            <span className="v">{when(data.values.registeredUsersAnchorAt)}</span>
          </div>
        </div>
      </section>

      <section className="l-card">
        <div className="l-h"><span className="ttl">改动影响预览</span><span className="sub">· 按当前草稿现算,保存前就能看见</span></div>
        <div className="l-b">
          <div className="htint cyan">
            对外公布的每台每日产出 <b>{money2(impact?.perDevice ?? Number.NaN)}</b> 是既有公布口径,本页不改它;
            改设备总数就等于按这个单价改掉下面这一整列金额。
          </div>
          <table className="l-tbl" style={{ marginTop: 10 }}>
            <thead><tr><th>指标</th><th className="num">当前生效</th><th className="num">保存后</th></tr></thead>
            <tbody>
              {[
                { label: "首页在线设备", now: int(impact?.current.online ?? Number.NaN), next: int(impact?.next.online ?? Number.NaN) },
                { label: "平台日支付额", now: money(impact?.current.daily ?? Number.NaN), next: money(impact?.next.daily ?? Number.NaN) },
                { label: "每秒支付流", now: money2(impact?.current.perSec ?? Number.NaN), next: money2(impact?.next.perSec ?? Number.NaN) },
                { label: "本月支付额(按 30 天)", now: money(impact?.current.monthly ?? Number.NaN), next: money(impact?.next.monthly ?? Number.NaN) },
                { label: "名次分母", now: int(impact?.current.denominator ?? Number.NaN), next: int(impact?.next.denominator ?? Number.NaN) },
              ].map((row) => <tr key={row.label}>
                <td>{row.label}</td>
                <td className="num">{row.now}</td>
                <td className={`num${row.now === row.next ? "" : " chg"}`}>{row.next}</td>
              </tr>)}
            </tbody>
          </table>
          <div className="htint warn" style={{ marginTop: 10 }}>
            介绍页 / 信任页 / 分享海报读的是同一个设备总数,改完会一起变。全球网络读取独立区域投影，不受此字段驱动。金额口径变化会写进审计,便于事后追溯。
          </div>
        </div>
      </section>
    </div>

    <section className="l-card">
      <div className="l-h">
        <span className="ttl">算力分位表</span>
        <span className="sub">· 把用户算力换算成「超过百分之多少的人」,决定首页名次</span>
        <div className="r">
          <PaginationExemption label="算力分位表" reason="整表原子保存,分页会切断行间单调性校验" maxRows={bands.length} kind="fixed-matrix" />
          {canWrite && <button className="l-btn sm" onClick={addBand}>添加档</button>}
        </div>
      </div>
      <div className="l-b">
        {bandCountError && <div className="htint danger" style={{ marginBottom: 10 }}>{bandCountError}。{bands.length < H9_BAND_MIN ? "点右上角「添加档」补齐 —— 少于两档没法把算力换算成百分比。" : ""}</div>}
        {bands.length === 0
          ? <div className="htint">还没有任何档位。至少添加 {H9_BAND_MIN} 档,首页名次才算得出来。</div>
          : <table className="l-tbl">
              <thead><tr><th>档</th><th>算力档位 <span className="hcode">tops</span></th><th>累计占比(%) <span className="hcode">cumPct</span></th><th>含义</th><th /></tr></thead>
              <tbody>
                {bands.map((row, index) => <tr key={index}>
                  <td className="mono">{index + 1}</td>
                  <td><input aria-label={`第 ${index + 1} 档算力档位`} className="l-inp" type="number" min={H9_BAND_TOPS_MIN} step={0.1} value={row.tops} disabled={!canWrite} onChange={(event) => setBand(index, "tops", event.target.value)} /></td>
                  <td><input aria-label={`第 ${index + 1} 档累计占比`} className="l-inp" type="number" min={0} max={100} step={0.1} value={row.cumPct} disabled={!canWrite} onChange={(event) => setBand(index, "cumPct", event.target.value)} /></td>
                  <td>{rowErrors[index]
                    ? <span className="ferr">{rowErrors[index]}</span>
                    : `算力到 ${row.tops || "—"} 的用户,超过 ${row.cumPct || "—"}% 的人`}</td>
                  <td><button className="l-btn sm" disabled={!canWrite} onClick={() => removeBand(index)}>删除</button></td>
                </tr>)}
              </tbody>
            </table>}
        <div className="htint" style={{ marginTop: 10 }}>
          填表规则:算力档位从小到大排,累计占比只能一行比一行大或持平,最高不超过 100%。
          最高档一般留点余量(比如停在 96%),免得算力最高的用户一上来就是「第 1 名」这种不可信的结果。
        </div>
      </div>
    </section>

    <p className="f-foot">
      <b>这页的数会去哪</b>:保存 → 服务端落库 + 写审计 → 前端下次进首页(或下拉刷新)读到新值 → 首页脉搏三格(注册用户 / 在线设备 / 你的排名)随之变化。
      设备总数还会带着介绍页、信任页、分享海报一起变；全球网络读取独立区域投影。改动记录去{" "}
      <Link href="/platform/audit" className="l-btn sm">A2 审批与审计</Link>{" "}查。
    </p>
  </>;
}

export default H9PublicStats;

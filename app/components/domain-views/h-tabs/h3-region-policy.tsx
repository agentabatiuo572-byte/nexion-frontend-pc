"use client";

/** H3 weekly regions keep their existing panel and draft UI.
 * Proposals and original-command recovery are supplied by H3's mutation owner. */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Globe, Pencil, Plus, RefreshCw, Shuffle, Trash2, TriangleAlert } from "lucide-react";
import {
  BlockState, Button, Cell, Change, Explain, Fact, Facts, IconButton, Input, Notice, Panel, StatusTag, Table, TableMessage, Td, Th, Tr,
} from "@/app/components/rd";
import {
  fetchH3WeeklyRegionPolicy,
  h3WeeklyRegionPolicyParams,
  validateH3WeeklyRegionMappings,
  type H3AssignedWeeklyWindow,
  type H3ActualWeeklyAssignments,
  type H3WeeklyAllocationState,
  type H3WeeklyRegionMapping,
  type H3WeeklyRegionPolicy,
} from "@/lib/admin/h-client";
import { fetchA2Overview } from "@/lib/admin/a2-client";
import { displayAdminError, displayAdminReadError } from "@/lib/admin/error-messages";
import { rebaseTerminalDraft, type TerminalDraft } from "@/lib/admin/use-terminal-drafts";
import { findHighOp } from "@/lib/admin/high-ops-registry";
import { businessStamp, businessZone } from "@/lib/admin/business-time";
import type { HCtx } from "./types";

const DEFAULT_ZONE = "Asia/Ho_Chi_Minh";
const ZONE_NAMES: Record<string, string> = { "Asia/Ho_Chi_Minh": "越南时间", "Asia/Shanghai": "中国时间", "Asia/Bangkok": "泰国时间", "Asia/Jakarta": "印尼西部时间", "Asia/Manila": "菲律宾时间", "Asia/Singapore": "新加坡时间", "Asia/Tokyo": "日本时间", "Asia/Seoul": "韩国时间" };
export const REGION_APPROVER = "另一位管理员";

/** Read policy/A2 authority and preserve the draft baseline until an explicit submission. */
export function useH3RegionPolicy(ctx: HCtx, submitProposal: (params: ReturnType<typeof h3WeeklyRegionPolicyParams>, reason: string, before: string, after: string, baseline: H3WeeklyRegionMapping[]) => Promise<void>,
  commandState: () => { pending: boolean; blocked: boolean }, recoveredDraft: () => (TerminalDraft<H3WeeklyRegionMapping[]> & { revision?: number }) | undefined) {
  const canRead = ctx.can("growth_h3_read");
  const canWrite = ctx.can("growth_h3_write");
  const [policy, setPolicy] = useState<H3WeeklyRegionPolicy | null>(null);
  const [draft, setDraft] = useState<H3WeeklyRegionMapping[] | null>(null);
  const [draftBase, setDraftBase] = useState<H3WeeklyRegionPolicy | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const canReadA2 = ctx.can("platform_a2_read");
  const [pendingReview, setPendingReview] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const generation = useRef(0);
  const fresh = useRef(false);
  const rebaseMappings = (beforeRows: H3WeeklyRegionMapping[], desiredRows: H3WeeklyRegionMapping[], currentRows: H3WeeklyRegionMapping[]) => {
    const byCode = (rows: H3WeeklyRegionMapping[]) => Object.fromEntries(rows.map(row => [row.callingCode, row.zoneId]));
    const before = byCode(beforeRows), desired = byCode(desiredRows), latest = byCode(currentRows);
    const codes = new Set([...Object.keys(before), ...Object.keys(desired), ...Object.keys(latest)]);
    const extend = (values: Record<string, string>) => Object.fromEntries([...codes].map(code => [code, values[code]]));
    const rebased = rebaseTerminalDraft(extend(before), extend(desired), extend(latest));
    for (const code of rebased.overlap) rebased.value[code] = latest[code];
    if (rebased.others.length) {
      const others = rebased.others.map(code => `${code} ${before[code] ?? "未设置"} → ${latest[code] ?? "未设置"}`);
      const mine = rebased.mine.map(code => `${code} ${desired[code] ?? "移除"}`);
      ctx.toast(`别人改过：${others.join("、")}。原拟改：${mine.join("、") || "无"}。${rebased.overlap.length ? `请重新选择 ${rebased.overlap.join("、")} 的规则。` : "请核对合并后的规则。"}`, "warn");
    }
    return Object.entries(rebased.value).filter(([, zoneId]) => zoneId).map(([callingCode, zoneId]) => ({ callingCode, zoneId }));
  };
  const reload = async (rebase = false) => {
    const request = ++generation.current;
    fresh.current = false;
    setLoading(true);
    try {
      const [rules, audit] = await Promise.allSettled([
        fetchH3WeeklyRegionPolicy(),
        canReadA2 ? fetchA2Overview({ object: "growth.h3.weekly-region-policy" }) : Promise.resolve(null),
      ]);
      if (request !== generation.current) return;
      if (rules.status === "rejected") throw rules.reason;
      setPolicy(rules.value);
      if (rebase) {
        if (draftBase && draft) setDraft(rebaseMappings(draftBase.mappings, draft, rules.value.mappings));
        setDraftBase(rules.value);
      }
      fresh.current = true;
      setError(null);
      if (audit.status === "rejected") {
        setReviewError("审批进度读取失败，请刷新后重试；暂不能再次提交。");
      } else {
        setReviewError(null);
        if (audit.value) {
          const waiting = audit.value.operationQueue.some(row => row.obj === "growth.h3.weekly-region-policy" && row.status === "pending");
          setPendingReview(waiting);
        } else {
          setPendingReview(false);
        }
      }
    } catch (cause) {
      if (request === generation.current) setError(displayAdminReadError(cause));
    } finally {
      if (request === generation.current) setLoading(false);
    }
  };
  useEffect(() => {
    if (canRead) void reload();
    return () => { generation.current += 1; };
  }, [canRead, canReadA2]);
  const invalid = draft ? validateH3WeeklyRegionMappings(draft) : null;
  const pending = pendingReview || commandState().pending;
  const commandBlocked = commandState().blocked;
  const staleDraft = draftBase && policy && (draftBase.revision !== policy.revision
    || JSON.stringify(draftBase.nextActivation) !== JSON.stringify(policy.nextActivation));
  const describe = (rows: H3WeeklyRegionMapping[]) => rows.length
    ? rows.map(row => `${row.callingCode} → ${row.zoneId}`).join("；") : "全部区号使用越南时间";
  const openEditor = () => {
    if (!policy || commandBlocked || pending) return;
    setDraftBase(policy);
    const saved = recoveredDraft();
    if (!saved?.before) {
      if (saved && saved.revision !== policy.revision) ctx.toast("原区号规则缺少修改前的内容，已显示最新规则，请重新选择拟改项。", "warn");
      setDraft((saved?.revision === policy.revision ? saved.desired : policy.mappings).map(row => ({ ...row })));
      return;
    }
    setDraft(rebaseMappings(saved.before, saved.desired, policy.mappings));
  };
  const submit = () => {
    if (!policy || !draftBase || !draft || invalid || loading || error || reviewError || pending || commandBlocked || staleDraft || !canWrite) return;
    const params = h3WeeklyRegionPolicyParams(draftBase, draft);
    const def = findHighOp("h3_weekly_region_policy")!;
    const firstFrom = draftBase.revision === 0 ? draftBase.nextActivation!.effectiveFrom : null;
    ctx.openActionConfirm({ briefKind: "config",
      action: def.action,
      title: "提交每周任务地区规则",
      detail: <>按注册手机号区号决定每周从哪个时区切换。批准前什么都不变；批准后，每个用户从他自己的下一周开始按新规则，本周已开始的不变。</>,
      effect: <StatusTag tone="progress" filled explain={`${REGION_APPROVER}在「操作记录与审批」批准后才发布；提交人不能批自己的。批准前仍按现在的规则，规则被锁住，不能再提交。`}>批准后生效</StatusTag>,
      facts: <Facts>
        <Fact k="区号规则"><Change from={describe(draftBase.mappings)} to={describe(params.mappings)} /></Fact>
        <Fact k="没设置的区号">越南时间（Asia/Ho_Chi_Minh）</Fact>
        <Fact k="本周已开始的用户">这一周不变，下一周按新规则</Fact>
        {firstFrom && <Fact k="首次生效">{`${businessStamp(Date.parse(firstFrom))}（${businessZone().label}）；过了这个时间要刷新后重新提交`}</Fact>}
        <Fact k="不受影响">团队和财务的周期</Fact>
        <Fact k="谁来批">{`${REGION_APPROVER}，不能是提交人`}</Fact>
        <Fact k="需有权限">审批批准权限、增长与活动的访问权和用户任务修改权限；发起人另需审批提案权限</Fact>
      </Facts>,
      statedBrief: { impact: "只改之后每个用户新一周的切换时区；已开始的一周、已发布的每周任务不重写。", check: "核对每个区号对应的时区；理由写清依据或工单号。" },
      confirmLabel: "提交审批",
      coverageLead: "这项修改要另一位管理员批准",
      amplifies: true,
      run: async reason => {
        if (loading || error || reviewError || staleDraft || commandState().blocked) throw new Error("请先查询原结果并刷新地区规则，再发起新的修改。");
        await submitProposal(params, reason, describe(draftBase.mappings), describe(params.mappings), draftBase.mappings);
        await reload();
        setDraft(null);
      },
    });
  };
  return {
    canRead, canWrite, canReadA2, policy, draft, setDraft, draftBase, setDraftBase, loading, error, reviewError,
    invalid, commandBlocked, pending: !!pending, staleDraft: !!staleDraft, reload, submit, openEditor, isReady: () => fresh.current,
  };
}

export type H3RegionState = ReturnType<typeof useH3RegionPolicy>;

// ===== 「本周是几号几点到几号几点」示意：只读计算，按这个时区的周一 00:00 =====
function wallOf(zone: string, at: number) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short" })
    .formatToParts(at).map((part) => [part.type, part.value]));
  return parts;
}
function instantOfWall(zone: string, wall: number) {
  let guess = wall;
  for (let i = 0; i < 3; i += 1) {
    const parts = wallOf(zone, guess);
    const seen = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    guess += wall - seen;
  }
  return guess;
}
const WEEKDAY: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
export function weekWindow(zone: string, now: number): { start: number; end: number } | null {
  if (!/^[A-Za-z_]+(?:\/[A-Za-z0-9_+\-]+)+$/.test(zone)) return null;
  try {
    const parts = wallOf(zone, now);
    const monday = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) - (WEEKDAY[parts.weekday] - 1));
    return { start: instantOfWall(zone, monday), end: instantOfWall(zone, monday + 7 * 86_400_000) };
  } catch {
    return null;
  }
}
const weekdayText = (at: number) => new Intl.DateTimeFormat("zh-CN", { timeZone: businessZone().zoneId, weekday: "short" }).format(at);
function windowText(zone: string, now: number) {
  const window = weekWindow(zone, now);
  if (!window) return "—";
  return <Cell main={`${businessStamp(window.start)}（${weekdayText(window.start)}）起`} sub={`到 ${businessStamp(window.end)}（${weekdayText(window.end)}）`} />;
}
const zoneLabel = (zone: string) => ZONE_NAMES[zone] ?? "";

// ===== 用户现在实际在的一周（H3-BE-09，后端 5278e138 WeeklyRegionPolicyService.actualAssignments）=====
// 按分配时记下的区号分组；同一区号可以有几段。和「常规的一周」对不上时标出来，原因只写后端能证明的：时区不同、不是整周、旧规则。
const people = (count: number) => `${count.toLocaleString("en-US")} 人`;
/** 不在本周的几种情况，按运营关心的顺序；缺记录、记录有误另起一行提醒。 */
const OTHER_STATE: Array<[H3WeeklyAllocationState, string]> = [
  ["UNASSIGNED", "还没分配"],
  ["EXPIRED_ASSIGNMENT", "上一周已结束"],
  ["FUTURE_ASSIGNMENT", "下一周才开始"],
];
/** 和「常规的一周」比：一样返回 null；不一样返回原因，只写后端能证明的（不是整周、旧规则、时区不同）。区号没记下时只看是不是整周。 */
function windowDiff(window: H3AssignedWeeklyWindow, zone: string | undefined, now: number): string | null {
  const nonstandard = "不是周一到周一的整周：规则第一次生效或用户换了区号的那一周，从原来那一周结束时接上。";
  if (window.boundaryShape === "NONSTANDARD_WEEK_BOUNDARIES") return nonstandard;
  const regular = zone ? weekWindow(zone, now) : null;
  if (!regular || !window.assignedFrom || !window.assignedUntil
    || Date.parse(window.assignedFrom) === regular.start && Date.parse(window.assignedUntil) === regular.end) return null;
  if (window.boundaryShape === "LEGACY_FROZEN") return "按旧规则分配的一周（北京时间），用户从自己的下一周开始换。";
  if (window.timeZone && window.timeZone !== zone) return `按 ${zoneLabel(window.timeZone) || window.timeZone}（${window.timeZone}）分配，和现在的规则不同；用户从自己的下一周开始换。`;
  return "和按规则算的这一周起止不同。";
}
function ActualWindows({ windows, zone, now, showCode }: { windows: H3AssignedWeeklyWindow[]; zone?: string; now: number; showCode?: boolean }) {
  if (windows.length === 0) return <Cell main="—" sub="现在没人" />;
  // 和常规的一周一样的合成一行只写人数，不再重复起止；不一样的每段写全起止并标出来。
  const same = zone ? windows.filter(window => !windowDiff(window, zone, now)) : [];
  const codes = (rows: H3AssignedWeeklyWindow[]) => showCode ? [...new Set(rows.map(window => window.callingCode).filter(Boolean))].join("、") : "";
  return <div className="h3-actual">
    {same.length > 0 && <div className="h3-actual-row"><Cell main={people(same.reduce((sum, window) => sum + window.users, 0))} sub={`和常规的一周相同${codes(same) ? ` · ${codes(same)}` : ""}`} /></div>}
    {windows.filter(window => !same.includes(window)).sort((a, b) => (a.assignedFrom ?? "").localeCompare(b.assignedFrom ?? "")).map((window, index) => {
      const diff = windowDiff(window, zone, now);
      const code = showCode && window.callingCode ? ` · ${window.callingCode}` : "";
      const from = window.assignedFrom ? Date.parse(window.assignedFrom) : null;
      const until = window.assignedUntil ? Date.parse(window.assignedUntil) : null;
      return <div key={index} className="h3-actual-row">
        <Cell main={from === null ? "起始时间没记下" : `${businessStamp(from)}（${weekdayText(from)}）起`}
          sub={`${until === null ? "结束时间没记下" : `到 ${businessStamp(until)}（${weekdayText(until)}）`} · ${people(window.users)}${code}`} />
        {diff && <StatusTag tone="neutral" icon={Shuffle} explain={diff}>和规则不同</StatusTag>}
      </div>;
    })}
  </div>;
}
function ActualSummary({ actual }: { actual: H3ActualWeeklyAssignments }) {
  const others = OTHER_STATE.map(([state, label]) => [label, actual.allocationStateCounts[state] ?? 0] as const).filter(([, users]) => users > 0);
  const broken = (actual.allocationStateCounts.HEADER_MISSING ?? 0) + (actual.allocationStateCounts.HEADER_INVALID ?? 0);
  return <div className="h3-actual-sum">
    <p>{`本周已分到 ${people(actual.knownCurrentAssignedUsers)}，共 ${people(actual.scopeUsers)}`}
      {others.length > 0 && `；${others.map(([label, users]) => `${label} ${people(users)}`).join("，")}`}
      <Explain label="人数怎么算" content={<>
        <p>只算正常状态、不是测试账户的用户，每人看最近一次分到的那一周。「上一周已结束」是最近一次分到的那一周已经过了，还没分到新的一周。</p>
        <p>区号是分配那一刻记下的，不按用户现在的手机号重新算。</p>
        <p>{`截至 ${businessStamp(Date.parse(actual.asOf))}（${businessZone().label}）。`}</p>
      </>} /></p>
    {broken > 0 && <p className="h3-actual-warn"><TriangleAlert size={14} aria-hidden />{`${people(broken)}的每周记录缺失或有误，上面的人数不全。`}</p>}
  </div>;
}

export function H3RegionPanel({ region, canAudit }: { region: H3RegionState; canAudit: boolean }) {
  const { canRead, canWrite, canReadA2, policy, draft, setDraft, draftBase, loading, error, reviewError, invalid, pending, commandBlocked, staleDraft, reload, submit, openEditor } = region;
  if (!canRead) return null;
  const now = Date.now();
  const firstUnset = policy?.revision === 0 && !policy.nextActivation;
  const editBlock = loading ? "正在读取地区规则" : error ? "地区规则读取失败，读到后才能编辑" : reviewError ? reviewError : pending ? "已有一份修改在等批准，批准或驳回前不能再改" : commandBlocked ? "这一项结果未知，请先查询原结果" : firstUnset ? "首次生效时间还没确定，暂时不能提交修改" : undefined;
  const rows = draft ?? policy?.mappings ?? [];
  // 编辑时只看规则本身；实际一列只在查看时出现，旧后端没给就不出现。
  const actual = !draft ? policy?.actualAssignments : undefined;
  const mapped = new Set((policy?.mappings ?? []).map(row => row.callingCode));
  const actualOf = (code: string) => actual?.currentWindows.filter(window => window.callingCodeKnown && window.callingCode === code) ?? [];
  const actualOther = actual?.currentWindows.filter(window => window.callingCodeKnown && !mapped.has(window.callingCode ?? "")) ?? [];
  const actualUnknown = actual?.currentWindows.filter(window => !window.callingCodeKnown) ?? [];
  const sub = policy ? `${policy.source === "DEFAULT" ? "默认规则，还没发布过" : `已发布第 ${policy.revision} 版`} · ${rows.length} 个区号 · 时间为${businessZone().label}` : undefined;
  const actions = <>
    <Button size="sm" variant="ghost" icon={<RefreshCw size={14} aria-hidden />} loading={loading} onClick={() => void reload()}>刷新</Button>
    {canWrite && !draft && policy && <Button size="sm" icon={<Pencil size={14} aria-hidden />} disabledReason={editBlock}
      onClick={openEditor}>编辑区号规则</Button>}
  </>;
  return (
    <Panel title="每周从哪个时区切换" icon={Globe} tone="role-3" sub={sub} actions={actions} data-proof="h3-weekly-region"
      explain={<>
        <p>按用户注册手机号的区号决定时区，每周一 00:00（那个时区）开始新的一周。没设置的区号用越南时间。看的是注册时的区号，不是语言或现在的 IP。</p>
        <p>修改要提交审批，{REGION_APPROVER}批准后，每个用户从他自己的下一周开始按新规则；本周已开始的不变。团队和财务的周期不受影响。</p>
      </>}>
      {loading && !policy && <BlockState state="loading" title="地区规则读取中…" />}
      {error && <BlockState state="error" title="地区规则读取失败" detail={`${error} · 读到之前不能编辑。`} onRetry={() => void reload()} />}
      {pending && <Notice tone="warn" title="区号规则的修改在等批准">
        <p>{`${REGION_APPROVER}批准前仍按下面的规则；批准后刷新这里核对。`}{canReadA2 ? "" : "你没有查看审批的权限，请让有权限的同事核对结果。"}</p>
        {canReadA2 && canAudit && <p><Link className="rd-link" href="/platform/audit" prefetch={false}>查看审批进度</Link></p>}
      </Notice>}
      {reviewError && <Notice tone="danger">{reviewError}</Notice>}
      {policy && firstUnset && !draft && <Notice tone="neutral">首次生效时间还没确定，暂时不能提交修改。</Notice>}
      {policy && policy.revision === 0 && policy.nextActivation && <p className="h3-region-first">
        {`还没发布过。第一次批准后从 ${businessStamp(Date.parse(policy.nextActivation.effectiveFrom))} 起生效；过了这个时间要刷新后重新提交。`}
      </p>}
      {policy && <Table label="区号对应的时区" className="h3-region-table">
        <thead>
          <tr>
            <Th>手机号区号</Th>
            <Th>时区</Th>
            <Th>{`常规的一周（${businessZone().label}）`}<Explain label="这一列怎么算" content={`按这个时区周一 00:00 到下周一 00:00 算的示意，换成${businessZone().label}写。${actual ? "用户实际的一周看右边一列。" : "规则第一次生效和用户换了区号的那一周，从用户原来那一周结束时接上。"}改动后用户从自己的下一周开始换。`} /></Th>
            {actual && <Th>{`现在实际（${businessZone().label}）`}<Explain label="这一列怎么算" content="用户现在实际在的这一周和人数，按分配时记下的区号。同一区号可能有几段：规则改过或用户换了区号，那一周从原来那一周结束时接上。" /></Th>}
            {draft && <Th sticky="end"><span className="rd-sr-only">删除</span></Th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => draft ? (
            <Tr key={index}>
              <Td><Input disabled={!!(loading || error || reviewError || pending || commandBlocked)} aria-label={`电话区号 ${index + 1}`} value={row.callingCode} placeholder="+84" size={6}
                onChange={event => setDraft(draft.map((item, i) => i === index ? { ...item, callingCode: event.target.value.trim() } : item))} /></Td>
              <Td><Input disabled={!!(loading || error || reviewError || pending || commandBlocked)} aria-label={`任务时区 ${index + 1}`} value={row.zoneId} placeholder="Asia/Shanghai" size={18}
                onChange={event => setDraft(draft.map((item, i) => i === index ? { ...item, zoneId: event.target.value.trim() } : item))} /></Td>
              <Td>{windowText(row.zoneId, now)}</Td>
              <Td sticky="end" data-fit=""><IconButton disabled={!!(loading || error || reviewError || pending || commandBlocked)} aria-label={`删除 ${row.callingCode || index + 1}`} onClick={() => setDraft(draft.filter((_, i) => i !== index))}><Trash2 size={14} aria-hidden /></IconButton></Td>
            </Tr>
          ) : (
            <Tr key={row.callingCode}>
              <Td><b>{row.callingCode}</b></Td>
              <Td><span data-mono="">{row.zoneId}</span>{zoneLabel(row.zoneId) && <span className="h3-region-zone">{zoneLabel(row.zoneId)}</span>}</Td>
              <Td>{windowText(row.zoneId, now)}</Td>
              {actual && <Td><ActualWindows windows={actualOf(row.callingCode)} zone={row.zoneId} now={now} /></Td>}
            </Tr>
          ))}
          {draft && draft.length === 0 && <TableMessage columns={4}>全部删除后，以后所有用户都用越南时间。</TableMessage>}
          <Tr>
            <Td><span className="h3-region-other">其他区号</span></Td>
            <Td><span data-mono="">{DEFAULT_ZONE}</span><span className="h3-region-zone">越南时间 · 默认</span></Td>
            <Td>{windowText(DEFAULT_ZONE, now)}</Td>
            {actual && <Td><ActualWindows windows={actualOther} zone={DEFAULT_ZONE} now={now} showCode /></Td>}
            {draft && <Td sticky="end" data-fit="" />}
          </Tr>
          {actualUnknown.length > 0 && <Tr>
            <Td><span className="h3-region-other">区号没记下</span></Td>
            <Td>—</Td>
            <Td>—</Td>
            <Td><ActualWindows windows={actualUnknown} now={now} /></Td>
          </Tr>}
        </tbody>
      </Table>}
      {actual && <ActualSummary actual={actual} />}
      {canWrite && draft && <div className="h3-region-edit">
        {invalid && <Notice tone="warn">{invalid}</Notice>}
        {staleDraft && <Notice tone="warn">规则刚被别人修改过，你填写的内容还在。请取消编辑、刷新后重新修改。</Notice>}
        <div className="rd-toolbar" data-end="">
          <Button size="sm" icon={<Plus size={14} aria-hidden />} disabledReason={draft.length >= 999 ? "最多 999 个区号" : undefined} onClick={() => setDraft([...draft, { callingCode: "", zoneId: "" }])}>添加区号</Button>
          <span className="h3-region-gap" />
          <Button size="sm" onClick={() => setDraft(null)}>取消编辑</Button>
          <Button size="sm" variant="primary" disabledReason={invalid ? invalid : staleDraft ? "规则刚被别人修改过，请取消编辑、刷新后重新修改" : !draftBase || (draftBase.revision === 0 && !draftBase.nextActivation) ? "首次生效时间还没确定" : loading || error || reviewError || pending || commandBlocked ? editBlock ?? "现在不能提交" : undefined}
            onClick={submit}>提交审批</Button>
        </div>
      </div>}
    </Panel>
  );
}

"use client";

/**
 * H3 每周任务地区规则：按注册手机号的区号决定每周从哪个时区的周一 00:00 切换。
 * 读取、草稿、锁和提交审批照旧页面 H3WeeklyRegionPolicyPanel 原样搬过来（useH3RegionPolicy），
 * 请求、校验、同版锁和解除时机都不变；这里只换界面。旧文件里的那份不删、不改。
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Globe, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import {
  BlockState, Button, Change, Explain, Fact, Facts, IconButton, Input, Notice, Panel, StatusTag, Table, TableMessage, Td, Th, Tr,
} from "@/app/components/rd";
import {
  fetchH3WeeklyRegionPolicy,
  h3WeeklyRegionPolicyParams,
  validateH3WeeklyRegionMappings,
  withH3WeeklyRegionProposalKey,
  type H3WeeklyRegionMapping,
  type H3WeeklyRegionPolicy,
} from "@/lib/admin/h-client";
import { fetchA2Overview } from "@/lib/admin/a2-client";
import { displayAdminError } from "@/lib/admin/error-messages";
import { usePropose } from "@/lib/admin/use-propose";
import { findHighOp } from "@/lib/admin/high-ops-registry";
import { businessStamp, businessZone } from "@/lib/admin/business-time";
import type { HCtx } from "./types";

const DEFAULT_ZONE = "Asia/Ho_Chi_Minh";
const ZONE_NAMES: Record<string, string> = { "Asia/Ho_Chi_Minh": "越南时间", "Asia/Shanghai": "中国时间", "Asia/Bangkok": "泰国时间", "Asia/Jakarta": "印尼西部时间", "Asia/Manila": "菲律宾时间", "Asia/Singapore": "新加坡时间", "Asia/Tokyo": "日本时间", "Asia/Seoul": "韩国时间" };
export const REGION_APPROVER = "另一位管理员";

/** 照旧页面原样：读取、草稿、同版锁、提交审批。 */
export function useH3RegionPolicy(ctx: HCtx) {
  const canRead = ctx.can("growth_h3_read");
  const canWrite = ctx.can("growth_h3_write");
  const propose = usePropose();
  const [policy, setPolicy] = useState<H3WeeklyRegionPolicy | null>(null);
  const [draft, setDraft] = useState<H3WeeklyRegionMapping[] | null>(null);
  const [draftBase, setDraftBase] = useState<H3WeeklyRegionPolicy | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submittedRevision, setSubmittedRevision] = useState<number | null>(null);
  const canReadA2 = ctx.can("platform_a2_read");
  const [pendingReview, setPendingReview] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const generation = useRef(0);
  const reload = async () => {
    const request = ++generation.current;
    setLoading(true);
    try {
      const [rules, audit] = await Promise.allSettled([
        fetchH3WeeklyRegionPolicy(),
        canReadA2 ? fetchA2Overview({ object: "growth.h3.weekly-region-policy" }) : Promise.resolve(null),
      ]);
      if (request !== generation.current) return;
      if (rules.status === "rejected") throw rules.reason;
      setPolicy(rules.value);
      setError(null);
      if (audit.status === "rejected") {
        setReviewError("审批进度读取失败，请刷新后重试；暂不能再次提交。");
      } else {
        setReviewError(null);
        if (audit.value) {
          const waiting = audit.value.operationQueue.some(row => row.obj === "growth.h3.weekly-region-policy" && row.status === "pending");
          setPendingReview(waiting);
          if (!waiting) setSubmittedRevision(null);
        } else if (submittedRevision !== rules.value.revision) {
          setSubmittedRevision(null);
          setPendingReview(false);
        }
      }
    } catch (cause) {
      if (request === generation.current) setError(displayAdminError(cause));
    } finally {
      if (request === generation.current) setLoading(false);
    }
  };
  useEffect(() => {
    if (canRead) void reload();
    return () => { generation.current += 1; };
  }, [canRead, canReadA2]);
  const invalid = draft ? validateH3WeeklyRegionMappings(draft) : null;
  const pending = pendingReview || (policy && submittedRevision === policy.revision);
  const staleDraft = draftBase && policy && (draftBase.revision !== policy.revision
    || JSON.stringify(draftBase.nextActivation) !== JSON.stringify(policy.nextActivation));
  const describe = (rows: H3WeeklyRegionMapping[]) => rows.length
    ? rows.map(row => `${row.callingCode} → ${row.zoneId}`).join("；") : "全部区号使用越南时间";
  const submit = () => {
    if (!policy || !draftBase || !draft || invalid || loading || error || reviewError || pending || staleDraft || !canWrite) return;
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
        await withH3WeeklyRegionProposalKey(params, reason, commandKey => propose(ctx.toast, {
          action: def.action, obj: "growth.h3.weekly-region-policy",
          before: describe(draftBase.mappings), after: describe(params.mappings),
          type: def.type, amplifies: true, gate: { roles: [] }, gateLabel: def.gateLabel,
          reason, sourceDomain: "H", commandKey,
          command: def.buildCommand(params), target: def.buildTarget(params),
        }));
        generation.current += 1;
        setLoading(false);
        setSubmittedRevision(draftBase.revision);
        setPendingReview(true);
        setDraft(null);
      },
    });
  };
  return {
    canRead, canWrite, canReadA2, policy, draft, setDraft, draftBase, setDraftBase, loading, error, reviewError,
    invalid, pending: !!pending, staleDraft: !!staleDraft, reload, submit,
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
  return `${businessStamp(window.start)}（${weekdayText(window.start)}）至 ${businessStamp(window.end)}（${weekdayText(window.end)}）`;
}
const zoneLabel = (zone: string) => ZONE_NAMES[zone] ?? "";

export function H3RegionPanel({ region, canAudit }: { region: H3RegionState; canAudit: boolean }) {
  const { canRead, canWrite, canReadA2, policy, draft, setDraft, setDraftBase, draftBase, loading, error, reviewError, invalid, pending, staleDraft, reload, submit } = region;
  if (!canRead) return null;
  const now = Date.now();
  const firstUnset = policy?.revision === 0 && !policy.nextActivation;
  const editBlock = loading ? "正在读取地区规则" : error ? "地区规则读取失败，读到后才能编辑" : reviewError ? reviewError : pending ? "已有一份修改在等批准，批准或驳回前不能再改" : firstUnset ? "首次生效时间还没确定，暂时不能提交修改" : undefined;
  const rows = draft ?? policy?.mappings ?? [];
  const sub = policy ? `${policy.source === "DEFAULT" ? "默认规则，还没发布过" : `已发布第 ${policy.revision} 版`} · ${rows.length} 个区号 · 时间为${businessZone().label}` : undefined;
  const actions = <>
    <Button size="sm" variant="ghost" icon={<RefreshCw size={14} aria-hidden />} loading={loading} onClick={() => void reload()}>刷新</Button>
    {canWrite && !draft && policy && <Button size="sm" icon={<Pencil size={14} aria-hidden />} disabledReason={editBlock}
      onClick={() => { setDraftBase(policy); setDraft(policy.mappings.map(row => ({ ...row }))); }}>编辑区号规则</Button>}
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
            <Th>{`这个区号的用户本周（${businessZone().label}）`}<Explain label="本周怎么算" content="示意：按这个时区的周一 00:00 到下周一 00:00，换成北京时间显示。规则改动后，用户从他自己的下一周开始换。" /></Th>
            {draft && <Th sticky="end"><span className="rd-sr-only">删除</span></Th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => draft ? (
            <Tr key={index}>
              <Td><Input disabled={!!(loading || error || reviewError || pending)} aria-label={`电话区号 ${index + 1}`} value={row.callingCode} placeholder="+84" size={8}
                onChange={event => setDraft(draft.map((item, i) => i === index ? { ...item, callingCode: event.target.value.trim() } : item))} /></Td>
              <Td><Input disabled={!!(loading || error || reviewError || pending)} aria-label={`任务时区 ${index + 1}`} value={row.zoneId} placeholder="Asia/Shanghai" size={22}
                onChange={event => setDraft(draft.map((item, i) => i === index ? { ...item, zoneId: event.target.value.trim() } : item))} /></Td>
              <Td>{windowText(row.zoneId, now)}</Td>
              <Td sticky="end" data-fit=""><IconButton disabled={!!(loading || error || reviewError || pending)} aria-label={`删除 ${row.callingCode || index + 1}`} onClick={() => setDraft(draft.filter((_, i) => i !== index))}><Trash2 size={14} aria-hidden /></IconButton></Td>
            </Tr>
          ) : (
            <Tr key={row.callingCode}>
              <Td><b>{row.callingCode}</b></Td>
              <Td><span data-mono="">{row.zoneId}</span>{zoneLabel(row.zoneId) && <span className="h3-region-zone">{zoneLabel(row.zoneId)}</span>}</Td>
              <Td>{windowText(row.zoneId, now)}</Td>
            </Tr>
          ))}
          {draft && draft.length === 0 && <TableMessage columns={4}>全部删除后，以后所有用户都用越南时间。</TableMessage>}
          <Tr>
            <Td><span className="h3-region-other">其他区号</span></Td>
            <Td><span data-mono="">{DEFAULT_ZONE}</span><span className="h3-region-zone">越南时间 · 默认</span></Td>
            <Td>{windowText(DEFAULT_ZONE, now)}</Td>
            {draft && <Td sticky="end" data-fit="" />}
          </Tr>
        </tbody>
      </Table>}
      {canWrite && draft && <div className="h3-region-edit">
        {invalid && <Notice tone="warn">{invalid}</Notice>}
        {staleDraft && <Notice tone="warn">规则刚被别人修改过，你填写的内容还在。请取消编辑、刷新后重新修改。</Notice>}
        <div className="rd-toolbar" data-end="">
          <Button size="sm" icon={<Plus size={14} aria-hidden />} disabledReason={draft.length >= 999 ? "最多 999 个区号" : undefined} onClick={() => setDraft([...draft, { callingCode: "", zoneId: "" }])}>添加区号</Button>
          <span className="h3-region-gap" />
          <Button size="sm" onClick={() => setDraft(null)}>取消编辑</Button>
          <Button size="sm" variant="primary" disabledReason={invalid ? invalid : staleDraft ? "规则刚被别人修改过，请取消编辑、刷新后重新修改" : !draftBase || (draftBase.revision === 0 && !draftBase.nextActivation) ? "首次生效时间还没确定" : loading || error || reviewError || pending ? editBlock ?? "现在不能提交" : undefined}
            onClick={submit}>提交审批</Button>
        </div>
      </div>}
    </Panel>
  );
}

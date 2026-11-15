"use client";

import { HConflictReviewRequired, hConflictFields } from "@/lib/admin/h-conflict-review";
import { isHGrowthReadConflict } from "@/lib/admin/h-write-conflict";
import { HApprovalRequired } from "@/lib/admin/h-approval-required";
import { useEffect, useRef, useState } from "react";
import { Plus, Ticket, Trash2, Trophy } from "lucide-react";
import type { HCtx } from "./types";
import { fetchAdminRaffles, saveAdminRaffle, raffleDraftError, type AdminRaffle, type RaffleDraft, type RafflePrize } from "@/lib/admin/genesis-raffle-client";
import { assertH4Fresh, h4ReadVersion, h4Blocked, h4PendingFor, pendingH4Commands, retryH4Command, isH4ApprovalReceipt, confirmedH4Saves } from "@/lib/admin/h4-mutations";
import { currentAdminOperator } from "@/lib/admin/current-operator";
import { displayAdminError } from "@/lib/admin/error-messages";
import { BlockState, Button, Decision, Drawer, Fact, Facts, Field, Input, Notice, Panel, Segments, Select, StatusTag, Steps } from "@/app/components/rd";
import { amountText, formatTime } from "./h4-promotion-ui";
import { ApprovalFact, effectApproval, effectDirect } from "./h4-legacy-parts";
import { H4ConflictCompare, h4ConflictGroups, type H4ConflictGroup } from "./h4-conflict-compare";
import { hApprovalReconfirm } from "./h-approval-reconfirm";

const empty = (): RaffleDraft => ({ id: "", titleZh: "", titleEn: "", titleVi: "", startsAt: "", drawAt: "", prizes: [] });
const dateInput = (value: string) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString().slice(0, 19) : "";
const STATUS: Record<AdminRaffle["status"], { label: string; tone: "neutral" | "ok" | "progress" | "done"; step: number; explain: string }> = {
  DRAFT: { label: "草稿", tone: "neutral", step: 0, explain: "还没对用户开放，可以随便改。" },
  OPEN: { label: "开放报名", tone: "ok", step: 1, explain: "用户可以用创世抽奖券报名。还没人报名时可以关闭回草稿再改；有人报名后奖项和时间锁定，也不能再关闭。" },
  PROCESSING: { label: "开奖处理中", tone: "progress", step: 2, explain: "到了开奖时间，系统正在自动开奖、发奖。不能改。" },
  DRAWN: { label: "已开奖", tone: "done", step: 3, explain: "已开奖发奖，只能查看。" },
};
const PRIZE_UNIT: Record<RafflePrize["rewardType"], string> = { UVT: "UVT", USDT: "USDT", DEVICE: "台" };
const prizeText = (prize: RafflePrize) => prize.rewardType === "DEVICE" ? `设备 ${prize.productNo || "未选"} × 1 台` : `${amountText(String(prize.amount))} ${PRIZE_UNIT[prize.rewardType]}`;
const seats = (prizes: RafflePrize[]) => prizes.reduce((sum, prize) => sum + prize.quantity, 0);

export default function H4GenesisRaffle({ ctx, onRowsChange }: { ctx: HCtx; onRowsChange?: (rows: AdminRaffle[] | null) => void }) {
  const [rows, setRows] = useState<AdminRaffle[]>([]), [base, setBase] = useState<AdminRaffle | null>(null), [draft, setDraft] = useState<RaffleDraft | null>(null);
  const [enabled, setEnabled] = useState(false), [loading, setLoading] = useState(true), [saving, setSaving] = useState(false), [error, setError] = useState("");
  const generation = useRef(0), operator = currentAdminOperator();
  const read = ctx.can("growth_h4_read"), write = ctx.can("growth_h4_write"), locked = !!base && base.status !== "DRAFT";
  const [, pendingChanged] = useState(0);
  /** 保存被「别人先改过」拒绝、已重读后的提醒；只决定显示。 */
  const [stale, setStale] = useState("");
  const conflictReview = useRef<HConflictReviewRequired | null>(null);
  /** 合并后回到表单：放回了几项自己改的。只决定显示。 */
  const [merged, setMerged] = useState(0);
  const load = async () => {
    const own = ++generation.current; setLoading(true); setError("");
    try { const values = await fetchAdminRaffles(); if (own === generation.current) { setRows(values); return values; } return null; }
    catch (cause) { if (own === generation.current) setError(displayAdminError(cause)); return null; }
    finally { if (own === generation.current) setLoading(false); }
  };
  useEffect(() => { setSaving(false); setError(""); setRows([]); setDraft(null); setBase(null); if (read) void load(); else setLoading(false); return () => { generation.current += 1; }; }, [read, operator]);
  useEffect(() => { onRowsChange?.(loading || !read ? null : rows); }, [rows, loading, read]);
  useEffect(() => {
    const changed = () => pendingChanged(v => v + 1);
    const readback = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail.raffles) setRows(detail.raffles);
      setBase(null); setDraft(null); setError(detail.raffleError);
    };
    window.addEventListener("admin-h4-pending-changed", changed);
    window.addEventListener("admin-h4-readback", readback);
    return () => { window.removeEventListener("admin-h4-pending-changed", changed); window.removeEventListener("admin-h4-readback", readback); };
  }, []);
  const choose = (row: AdminRaffle | null) => { conflictReview.current = null; setStale(""); setMerged(0); setBase(row); setDraft(row ? { id: row.id, titleZh: row.titleZh, titleEn: row.titleEn, titleVi: row.titleVi, startsAt: row.startsAt, drawAt: row.drawAt, prizes: row.prizes.map(prize => ({ ...prize })) } : empty()); setEnabled(row?.status === "OPEN"); setError(""); };
  const prizePatch = (id: string, values: Partial<RafflePrize>) => setDraft(current => current ? { ...current, prizes: current.prizes.map(prize => prize.id === id ? { ...prize, ...values } : prize) } : null);
  const saveBlocked = !!base && (base.status === "PROCESSING" || base.status === "DRAWN" || (base.status === "OPEN" && base.totalEntries > 0));
  const save = (rebased?: { base: AdminRaffle; draft: RaffleDraft; enabled: boolean; reason: string }) => {
    if (conflictReview.current) { setError(displayAdminError(conflictReview.current)); return; }
    const savedDraft = rebased?.draft ?? draft, previous = rebased?.base ?? base, nextEnabled = rebased?.enabled ?? (!!base && enabled);
    if (!savedDraft || !write || !rebased && saving || (previous && (previous.status === "PROCESSING" || previous.status === "DRAWN" || (previous.status === "OPEN" && previous.totalEntries > 0)))) return;
    const invalid = raffleDraftError(savedDraft); if (invalid) { setError(invalid); return; }
    const opening = nextEnabled && previous?.status === "DRAFT";
    const closing = !nextEnabled && previous?.status === "OPEN";
    const readVersion = h4ReadVersion("raffles");
    let originalKey: string | undefined;
    ctx.openActionConfirm({ initialReason: rebased?.reason, getPendingReason: () => h4PendingFor(`H/h4_genesis_raffle/${savedDraft.id}`)?.reason, briefKind: "config", action: `${nextEnabled ? "保存并开启" : "保存抽奖配置"} · ${savedDraft.titleZh}`, amplifies: nextEnabled,
      title: opening ? "开放抽奖报名" : closing ? "关闭报名回草稿" : previous ? "保存抽奖配置" : "保存抽奖草稿",
      effect: opening ? effectApproval("这一期") : effectDirect,
      detail: <>本期共 {seats(savedDraft.prizes)} 个中奖名额。{nextEnabled ? "开启后用户可按公布时段使用抽奖券报名；开奖时发放配置的奖品。" : "新建轮次保存为草稿，不会对用户开放。"}</>,
      facts: <>
        <Facts>
          <Fact k="这一期">{savedDraft.titleZh || "—"} · {savedDraft.id}</Fact>
          <Fact k="报名开始 → 开奖（北京时间）">{formatTime(savedDraft.startsAt, "Asia/Shanghai")} → {formatTime(savedDraft.drawAt, "Asia/Shanghai")}</Fact>
          <Fact k="奖项">{savedDraft.prizes.length} 项 · 共 {seats(savedDraft.prizes)} 个名额：{savedDraft.prizes.map((prize) => `${prize.nameZh || "未命名"} ${prizeText(prize)} × ${prize.quantity}`).join("；")}</Fact>
          {opening && <Fact k="开放后">用户可以用创世抽奖券报名；到开奖时间系统自动开奖、按奖项发奖</Fact>}
          {nextEnabled && <Fact k="之后能不能改">还没人报名时可以关闭回草稿再改；有人报名后奖项和时间锁定，也不能再关闭</Fact>}
          {closing && <Fact k="关闭后">回到草稿，用户不能再报名；改好后可以再申请开放</Fact>}
          {!previous && <Fact k="保存后">新的一期先是草稿，不对用户开放；保存后再打开它申请开放</Fact>}
          {opening && <ApprovalFact amplify="从草稿开放报名" object="这一期" />}
        </Facts>
      </>,
      confirmLabel: opening ? "提交审批" : previous ? "保存配置" : "保存草稿",
      reasonPlaceholder: opening ? "例如：奖项和时间已确认，申请开放报名" : "例如：按活动方案配置这一期",
      run: async reason => {
        if (operator !== currentAdminOperator() || !ctx.can("growth_h4_write")) throw new Error("登录身份或权限已变化，请重新打开配置。");
        const own = generation.current; setSaving(true); setError("");
        try {
          const original = originalKey ? pendingH4Commands().find(r => r.commandKey === originalKey) : undefined;
          if (!original) assertH4Fresh("raffles", readVersion);
          const result = original ? await retryH4Command(original) : await saveAdminRaffle(savedDraft, previous?.revision ?? null, nextEnabled, reason, opening);
          if (own !== generation.current) return;
          await load(); setDraft(null); setBase(null);
          ctx.toast(isH4ApprovalReceipt(result) ? result.ticket.status === "pending" ? "已提交，等待审批后执行" : "已查询到原审批单，请在操作记录核对执行状态" : "创世抽奖设置已保存");
        } catch (cause) {
          // 直接保存被判定要走审批：换成审批确认，内容和理由沿用（H-改走审批）。
          if (cause instanceof HApprovalRequired) {
            ctx.openActionConfirm(null);
            ctx.openConfirm(hApprovalReconfirm(cause, { action: `${nextEnabled ? "保存并开启" : "保存抽奖配置"} · ${savedDraft.titleZh}`, title: "保存抽奖配置", reason,
              approver: "另一位超级管理员", holds: "这一期", extra: <Fact k="这一期">{savedDraft.titleZh || "—"} · {savedDraft.id}</Fact> }));
            return;
          }
          if (own === generation.current) setError(displayAdminError(cause));
          if (isHGrowthReadConflict(cause)) setStale(savedDraft.titleZh || savedDraft.id);
          if (isHGrowthReadConflict(cause) && !originalKey) {
            ctx.openActionConfirm(null);
            const values = await load(), latest = values?.find(row => row.id === savedDraft.id);
            if (latest && previous) {
              setBase(latest); setDraft(savedDraft); setEnabled(nextEnabled);
              const comparable = (row: AdminRaffle) => ({ id: row.id, titleZh: row.titleZh, titleEn: row.titleEn, titleVi: row.titleVi,
                startsAt: row.startsAt, drawAt: row.drawAt, prizes: Object.fromEntries(row.prizes.map(prize => [encodeURIComponent(prize.id).replace(/\./g, "%2E"), prize])), enabled: row.status === "OPEN" });
              conflictReview.current = new HConflictReviewRequired(displayAdminError(cause), hConflictFields(comparable(previous), comparable(latest), { ...savedDraft, prizes: Object.fromEntries(savedDraft.prizes.map(prize => [encodeURIComponent(prize.id).replace(/\./g, "%2E"), prize])), enabled: nextEnabled }), () => {
                conflictReview.current = null;
                save({ base: latest, draft: savedDraft, enabled: nextEnabled, reason });
              });
            }
          } else if (isHGrowthReadConflict(cause) || originalKey && !h4PendingFor(`H/h4_genesis_raffle/${savedDraft.id}`)) { ctx.openActionConfirm(null); setDraft(null); setBase(null); await load(); }
          throw cause;
        }
        finally { originalKey = h4PendingFor(`H/h4_genesis_raffle/${savedDraft.id}`)?.commandKey; setSaving(false); }
      },
    });
  };
  const close = () => { conflictReview.current = null; setDraft(null); setBase(null); setError(""); };
  // 三方对比：奖项逐项逐字段列，名称、金额、名额原样写，不舍入。
  const review = base && draft ? conflictReview.current : null;
  const PRIZE_FIELD: Record<string, string> = { nameZh: "中文名称", nameEn: "英文名称", nameVi: "越南语名称", rewardType: "奖励类型", amount: "每名金额", productNo: "设备商品编号", quantity: "中奖名额", id: "奖项" };
  const compareGroups: H4ConflictGroup[] = review ? h4ConflictGroups(review.fields,
    path => path.startsWith("prizes.") ? path.split(".").slice(0, 3).join(".") : path.split(".")[0],
    key => {
      const [, id, field] = key.split(".");
      if (key.startsWith("prizes.")) return `奖项 ${review.fields.filter(item => /^prizes\.[^.]+\.id$/.test(item.path)).findIndex(item => item.path === `prizes.${id}.id`) + 1} · ${PRIZE_FIELD[field] ?? "其他"}`;
      return ({ enabled: "开放报名", titleZh: "抽奖名称 · 中文", titleEn: "抽奖名称 · 英文", titleVi: "抽奖名称 · 越南语", startsAt: "报名开始", drawAt: "开奖时间", id: "本期编号" } as Record<string, string>)[key] ?? "其他";
    },
    (key, raw, which) => key === "enabled" ? raw === true ? "开放" : raw === false ? "关闭" : "—"
      : key === "startsAt" || key === "drawAt" ? raw ? `${formatTime(raw as string, "Asia/Shanghai")}（北京时间）` : "未配置"
      : key.endsWith(".rewardType") ? raw === "DEVICE" ? "设备" : raw === undefined ? "—" : String(raw)
      : key.startsWith("prizes.") && raw === undefined ? "没有这一项"
      : key.endsWith(".amount") ? `${amountText(String(raw))} ${PRIZE_UNIT[review.fields.find(field => field.path === `${key.slice(0, -7)}.rewardType`)?.[which] as RafflePrize["rewardType"]]}`
      : raw === undefined || raw === null || raw === "" ? "—" : String(raw)) : [];
  // Identity sets are compared with the opened snapshot on both sides. Reordering is harmless;
  // additions/deletions require the explicit whole-draft choice, never an implicit replacement.
  const prizeChanges = (which: "latest" | "mine") => {
    const ids = review?.fields.filter(field => /^prizes\.[^.]+\.id$/.test(field.path)) ?? [];
    return {
      added: ids.filter(field => field.opened === undefined && field[which] !== undefined).map(field => String(field[which])),
      removed: ids.filter(field => field.opened !== undefined && field[which] === undefined).map(field => String(field.opened)),
    };
  };
  const structureChanges = { latest: prizeChanges("latest"), mine: prizeChanges("mine") };
  const mergeBlocked = Object.values(structureChanges).some(change => change.added.length || change.removed.length);
  // Latest configuration plus only the draft's changed fields, matched by prize id.
  const mergeConflict = () => {
    if (!base || !draft || mergeBlocked) return;
    const latest = base, mine = draft, kept = compareGroups.filter(group => group.byMe);
    const next: RaffleDraft = { id: latest.id, titleZh: latest.titleZh, titleEn: latest.titleEn, titleVi: latest.titleVi, startsAt: latest.startsAt, drawAt: latest.drawAt,
      prizes: latest.prizes.map(prize => ({ ...prize })) };
    let nextEnabled = latest.status === "OPEN";
    for (const group of kept) {
      const [top, id, field] = group.key.split(".");
      if (top === "enabled") nextEnabled = enabled;
      else if (top === "prizes") {
        const target = next.prizes.find(prize => prize.id === decodeURIComponent(id));
        const source = mine.prizes.find(prize => prize.id === decodeURIComponent(id));
        if (target && source) Object.assign(target, { [field]: source[field as keyof RafflePrize] });
      }
      else if (top === "titleZh" || top === "titleEn" || top === "titleVi" || top === "startsAt" || top === "drawAt") next[top] = mine[top];
    }
    choose(latest); setDraft(next); setEnabled(nextEnabled); setMerged(kept.length);
  };
  const keepMine = () => { const current = conflictReview.current; if (!current) return; setError(""); current.confirm(); pendingChanged(v => v + 1); };
  const savedUnread = !!draft && confirmedH4Saves().some(record => record.scope === `H/h4_genesis_raffle/${draft.id}`);
  if (!read) return <BlockState state="denied" title="没有查看创世抽奖的权限" detail="创世抽奖需要「活动中心查看」权限。" />;

  const formLocked = !write || saving || !!draft && h4Blocked(`H/h4_genesis_raffle/${draft.id}`) || !!review;
  const enableBlocked = !!base && (base.status === "PROCESSING" || base.status === "DRAWN" || base.totalEntries > 0);
  return <Panel id="h4l-raffle" title="创世抽奖" icon={Trophy} tone="role-4" sub={loading ? undefined : `最近 ${rows.length} 期`}
    explain={<><p>用户用创世抽奖券报名，到开奖时间系统自动开奖、发奖；这里没有人工开奖或补发。</p><p>从草稿开放报名要另一位超级管理员批准。还没人报名时可以关闭回草稿再改；有人报名后奖项和时间锁定。只显示最近 50 期。</p></>}
    actions={<><Button disabledReason={loading ? "正在读取" : saving ? "正在保存" : draft ? "先关掉正在改的这一期" : undefined} onClick={() => void load()}>刷新</Button><Button icon={<Plus size={14} aria-hidden />} disabledReason={!write ? "没有修改创世抽奖的权限" : loading ? "正在读取" : saving ? "正在保存" : draft ? "先关掉正在改的这一期" : undefined} onClick={() => choose(null)}>新建一期</Button></>}>
    {loading ? <BlockState state="loading" title="正在加载抽奖设置" />
      : !rows.length && error && !draft ? <BlockState state="error" title="创世抽奖没有读到" detail={error} onRetry={() => void load()} />
      : !rows.length ? <BlockState state="empty" title="暂无抽奖轮次" detail="点右上角「新建一期」。" />
      : <ol className="h4l-draws" aria-label="抽奖期，最新的在上">{rows.map(row => {
        const status = STATUS[row.status];
        return <li key={row.id} className="h4l-draw" data-state={row.status}>
          <span className="h4l-draw-dot" aria-hidden />
          <div className="h4l-draw-body">
            <header className="h4-card-head">
              <div className="h4-card-title"><h3>{row.titleZh || "中文名称未配置"}</h3><span className="h4-card-meta"><span className="h4-mono" title={row.id}>{row.id}</span></span></div>
              <span className="h4l-tags"><StatusTag tone={status.tone} explain={status.explain}>{status.label}</StatusTag><Button size="sm" disabledReason={saving ? "正在保存" : draft ? "先关掉正在改的这一期" : undefined} onClick={() => choose(row)}>{row.status === "DRAFT" || (row.status === "OPEN" && row.totalEntries === 0) ? "查看和修改" : "查看"}</Button></span>
            </header>
            <Steps label={`${row.titleZh || row.id} 走到哪`} items={["草稿", "开放报名", "开奖处理中", "已开奖"].map((label, index) => ({ label, state: index < status.step ? "done" as const : index === status.step ? "current" as const : "todo" as const }))} />
            <dl className="h4l-facts">
              <div><dt>报名开始</dt><dd className="h4-num">{formatTime(row.startsAt, "Asia/Shanghai")}</dd></div>
              <div><dt>开奖</dt><dd className="h4-num">{formatTime(row.drawAt, "Asia/Shanghai")}</dd></div>
              <div><dt><Ticket size={14} aria-hidden />已报名</dt><dd><span><b className="h4-num">{row.totalEntries}</b> 票</span><small>按报名用掉的抽奖券数，不是人数</small></dd></div>
              <div><dt><Trophy size={14} aria-hidden />奖项</dt><dd>{row.prizes.length ? <><span><b className="h4-num">{seats(row.prizes)}</b> 个名额</span><small>{row.prizes.map((prize) => `${prize.nameZh || "未命名"} ${prizeText(prize)} × ${prize.quantity}`).join("；")}</small></> : <span className="h4-dim">还没配奖项</span>}</dd></div>
            </dl>
          </div>
        </li>;
      })}</ol>}
    {rows.length > 0 && error && !draft && <Notice tone="danger" title="创世抽奖没有读到最新的">{error}</Notice>}
    {stale && !draft && <Notice tone="warn" title={`没有保存：「${stale}」已被别人改过`} action={<Button size="sm" variant="ghost" onClick={() => setStale("")}>知道了</Button>}>{error ? "你这次改的没有提交。" : "已读到最新配置。你这次改的没有提交，关掉时已丢弃；要改就重新打开。"}</Notice>}
    {!loading && rows.length > 0 && <p className="h4l-note">时间为北京时间</p>}
    <Drawer open={!!draft} onClose={close} busy={saving} wide title={base ? "这一期的配置" : "新建一期抽奖"} sub={base ? base.id : undefined}
      explain="保存前先在这里填完整：三语名称、时间和奖项。关闭这个抽屉会丢掉没保存的改动。"
      footer={<Decision note={!write ? "没有修改创世抽奖的权限" : saveBlocked ? (base?.status === "OPEN" ? "已有人报名：奖项和时间锁定，也不能关闭" : "已开奖或正在开奖，只能查看") : undefined}
        others={<Button disabled={saving} onClick={close}>关闭配置</Button>}
        primary={<Button variant="primary" loading={saving} loadingText="正在保存…" disabledReason={!write ? "没有修改创世抽奖的权限" : saveBlocked ? "这一期不能再改" : review ? "先在上面选一种继续" : undefined} onClick={() => save()}>{base ? "保存配置" : "保存草稿"}</Button>} />}>
      {draft && <div className="h4-dialog-body">
        {review && <H4ConflictCompare groups={compareGroups} mergeDisabledReason={mergeBlocked ? review.message : undefined} onMerge={mergeConflict} onKeepMine={keepMine} />}
        {merged > 0 && <Notice tone="neutral" title="已合并，还没保存" action={<Button size="sm" variant="ghost" onClick={() => setMerged(0)}>知道了</Button>}>{`表单是最新的这一期，放回了你改的 ${merged} 项。核对后点「保存配置」。`}</Notice>}
        <fieldset disabled={formLocked} className="h4-fieldset">
        {base && <Field label="开放报名" explain={enableBlocked ? (base.totalEntries > 0 ? "已有人报名，不能再关闭。" : "已开奖或正在开奖。") : "开放要另一位超级管理员批准；还没人报名时可以关回草稿。"}>
          <Segments label="开放创世抽奖报名" value={String(enabled)} onChange={v => setEnabled(v === "true")} items={[
            { value: "false", label: "关闭", disabled: formLocked || enableBlocked },
            { value: "true", label: "开启", disabled: formLocked || enableBlocked },
          ]} />
        </Field>}
        {locked && <Notice tone="neutral" title="这一期已不是草稿">{base?.status === "OPEN" ? (base.totalEntries > 0 ? "已有人报名：奖项和时间锁定，不能再关闭。" : "开放中：要改奖项和时间，先把「开放报名」选成关闭并保存，回到草稿再改。") : "已开奖或正在开奖，只能查看。"}</Notice>}
        <fieldset disabled={locked} className="h4-fieldset">
          <div className="rd-form-grid" data-cols="2" data-dense="">
            <Field label="本期编号" help={base ? "建好后不能改" : "1–64 位字母、数字、_ 或 -"}><Input value={draft.id} disabled={!!base} onChange={event => setDraft({ ...draft, id: event.target.value })} /></Field>
            {(["Zh", "En", "Vi"] as const).map((lang, index) => <Field key={lang} label={`抽奖名称 · ${["中文", "英文", "越南语"][index]}`}><Input value={draft[`title${lang}`]} onChange={event => setDraft({ ...draft, [`title${lang}`]: event.target.value })} /></Field>)}
            {(["startsAt", "drawAt"] as const).map((key, index) => <Field key={key} label={`${index ? "开奖时间" : "报名开始"}（UTC）`} help={draft[key] && Number.isFinite(Date.parse(draft[key])) ? `北京时间 ${formatTime(draft[key], "Asia/Shanghai")}` : "未配置"}><Input type="datetime-local" step={1} value={dateInput(draft[key])} onChange={event => setDraft({ ...draft, [key]: event.target.value ? new Date(`${event.target.value}Z`).toISOString() : "" })} /></Field>)}
          </div>
          <ol className="h4l-prizes" aria-label="奖项">
            {draft.prizes.map((prize, index) => <li key={prize.id} className="h4l-prize">
              <header><b>奖项 {index + 1}</b><span className="h4-dim">{prizeText(prize)} × {prize.quantity}</span><Button size="sm" variant="danger-outline" icon={<Trash2 size={13} aria-hidden />} disabled={formLocked || locked} onClick={() => setDraft({ ...draft, prizes: draft.prizes.filter(item => item.id !== prize.id) })}>移除</Button></header>
              <div className="rd-form-grid" data-cols="2" data-dense="">
                {(["Zh", "En", "Vi"] as const).map((lang, i) => <Field key={lang} label={`奖项名称 · ${["中文", "英文", "越南语"][i]}`}><Input value={prize[`name${lang}`]} onChange={event => prizePatch(prize.id, { [`name${lang}`]: event.target.value })} /></Field>)}
                <Field label="奖励类型"><Select aria-label="奖励类型" disabled={formLocked || locked} value={prize.rewardType} onChange={v => prizePatch(prize.id, { rewardType: v as RafflePrize["rewardType"], ...(v === "DEVICE" ? { amount: 1 } : {}) })} options={[{ value: "UVT", label: "UVT" }, { value: "USDT", label: "USDT" }, { value: "DEVICE", label: "设备" }]} /></Field>
                {prize.rewardType === "DEVICE"
                  ? <Field label="设备商品编号" help="每个中奖名额发放一台。"><Input value={prize.productNo ?? ""} onChange={event => prizePatch(prize.id, { productNo: event.target.value })} /></Field>
                  : <Field label={`每名奖励金额（${prize.rewardType}）`}><Input type="number" min="0.000001" step="any" value={prize.amount} onChange={event => prizePatch(prize.id, { amount: event.target.value })} /></Field>}
                <Field label="中奖名额" hint="1–100"><Input type="number" min={1} max={100} step={1} value={prize.quantity} onChange={event => prizePatch(prize.id, { quantity: Number(event.target.value) })} /></Field>
              </div>
            </li>)}
          </ol>
          <div className="rd-toolbar" data-end="">
            <span className="rd-toolbar-note" data-tone={seats(draft.prizes) > 100 ? "warn" : undefined}>本期总名额 <b className="h4-num">{seats(draft.prizes)}</b> / 100 · 奖项 {draft.prizes.length} / 20</span>
            <Button size="sm" icon={<Plus size={13} aria-hidden />} disabled={formLocked || locked || draft.prizes.length >= 20} onClick={() => setDraft({ ...draft, prizes: [...draft.prizes, { id: `prize-${Date.now().toString(36)}-${draft.prizes.length}`, nameZh: "", nameEn: "", nameVi: "", rewardType: "UVT", amount: "", quantity: 1 }] })}>添加奖项</Button>
          </div>
        </fieldset>
        {error && !review && <Notice tone={savedUnread ? "warn" : "danger"} title={savedUnread ? "已保存，但没读到最新的这一期" : stale ? "没有保存：最新的这一期也没读到" : "没有保存"}>{savedUnread ? "不用重新提交；关掉后点「刷新」，读到后再改。" : error}</Notice>}
      </fieldset></div>}
    </Drawer>
  </Panel>;
}

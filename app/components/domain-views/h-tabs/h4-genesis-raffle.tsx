"use client";

import { englishCopyHint, isEnglishCopy } from "@/lib/admin/content-language-rules";
import { getRequiredContentLanguages, OPERATING_LANGUAGE_CODES, type OperatingLanguageCode } from "@/lib/admin/platform-experience-client";
import { ConfirmReadConflict, PendingConfirmRejected, hConflictFields, type HConflictField } from "@/lib/admin/h-conflict-review";
import { compareH3Decimal, h3Decimal } from "@/lib/admin/h3-contract";
import { isH4ReadConflict } from "@/lib/admin/h-write-conflict";
import { HApprovalRequired } from "@/lib/admin/h-approval-required";
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { Plus, Ticket, Trash2, Trophy } from "lucide-react";
import type { HCtx } from "./types";
import { fetchAdminRaffle, fetchAdminRaffles, parseAdminRaffle, saveAdminRaffle, raffleDraftError, raffleLocalizedDraft, RAFFLE_LANGUAGES, RAFFLE_READBACK_ADVANCED, RAFFLE_SAVE_PENDING, type AdminRaffle, type RaffleDraft, type RafflePrize } from "@/lib/admin/genesis-raffle-client";
import { assertH4Fresh, h4ReadVersion, h4Blocked, h4ApprovalLockedReason, h4PendingFor, h4PendingConfirmRecovery, pendingH4Commands, retryH4Command, isH4ApprovalReceipt, h4TicketResult, confirmedH4Saves, h4RaffleSaveNeedsVerification, type H4ReopenRejected } from "@/lib/admin/h4-mutations";
import { currentAdminOperator } from "@/lib/admin/current-operator";
import { displayAdminError } from "@/lib/admin/error-messages";
import { isOutcomeUnknownError } from "@/lib/admin/outcome-classification";
import { useH4EditGuard, useH4Editor } from "./h4-edit-guard";
import { BlockState, Button, Decision, Drawer, Fact, Facts, Field, Input, Notice, Panel, Segments, Select, StatusTag, Steps } from "@/app/components/rd";
import { amountText, formatTime } from "./h4-promotion-ui";
import { ApprovalFact, h4ReadConflict, H4StaleNote, H4_MISSING_ORIGINAL, H4_OLD_RECORD_REJECTED, H4_UNKNOWN_SAVE, effectApproval, effectDirect, effectDraft, useH4DrawerFocus } from "./h4-legacy-parts";
import { H4ConflictCompare, h4ConflictGroups, type H4CompareSection, type H4ConflictGroup } from "./h4-conflict-compare";
import { hApprovalReconfirm } from "./h-approval-reconfirm";

const empty = (): RaffleDraft => ({ id: "", titleZh: "", titleEn: "", titleVi: "", startsAt: "", drawAt: "", prizes: [] });
const editableRaffle = (row: AdminRaffle, required: readonly OperatingLanguageCode[]) => raffleLocalizedDraft({
  id: row.id, titleZh: row.titleZh, titleEn: row.titleEn, titleVi: row.titleVi,
  startsAt: row.startsAt, drawAt: row.drawAt, prizes: row.prizes,
}, required, "edit");
const prizeKey = (id: string) => encodeURIComponent(id).replace(/\./g, "%2E");
function equalRaffleField(path: string, left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (/^prizes\.[^.]+\.amount$/.test(path) && (typeof left === "string" || typeof left === "number")
    && (typeof right === "string" || typeof right === "number")) {
    const a = h3Decimal(String(left)), b = h3Decimal(String(right));
    return a !== null && b !== null && compareH3Decimal(a, b) === 0;
  }
  if ((path === "startsAt" || path === "drawAt") && typeof left === "string" && typeof right === "string") {
    const time = Date.parse(left);
    // The database stores microseconds. Compare any digits beyond Date's millisecond precision too.
    const submillis = (value: string) => (value.match(/\.\d{3}(\d+)/)?.[1] ?? "").replace(/0+$/, "");
    return Number.isFinite(time) && time === Date.parse(right) && submillis(left) === submillis(right);
  }
  return false;
}

function isUnchangedRaffle(base: AdminRaffle | null, submitted: RaffleDraft, enabled: boolean, required: readonly OperatingLanguageCode[]) {
  if (!base || (base.status !== "DRAFT" && (base.status !== "OPEN" || base.totalEntries !== 0))) return false;
  if (enabled !== (base.status === "OPEN")) return false;
  const original = raffleLocalizedDraft(editableRaffle(base, required), required, "submit");
  return !hConflictFields(original, original, submitted, equalRaffleField).some(field => field.changedByMe);
}

const dateInput = (value: string) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString().slice(0, 16) : "";
const STATUS: Record<AdminRaffle["status"], { label: string; tone: "neutral" | "ok" | "progress" | "done"; step: number; explain: string }> = {
  DRAFT: { label: "草稿", tone: "neutral", step: 0, explain: "还没对用户开放，可以随便改。" },
  OPEN: { label: "开放报名", tone: "ok", step: 1, explain: "用户可以用创世抽奖券报名。还没人报名时可以关闭回草稿再改；有人报名后奖项和时间锁定，也不能再关闭。" },
  PROCESSING: { label: "开奖处理中", tone: "progress", step: 2, explain: "到了开奖时间，系统正在自动开奖、发奖。不能改。" },
  DRAWN: { label: "已开奖", tone: "done", step: 3, explain: "已开奖发奖，只能查看。" },
};
const PRIZE_UNIT: Record<RafflePrize["rewardType"], string> = { UVT: "UVT", USDT: "USDT", DEVICE: "台" };
const prizeText = (prize: RafflePrize) => prize.rewardType === "DEVICE" ? `设备 ${prize.productNo || "未选"} × 1 台` : `${amountText(String(prize.amount))} ${PRIZE_UNIT[prize.rewardType]}`;
const seats = (prizes: RafflePrize[]) => prizes.reduce((sum, prize) => sum + prize.quantity, 0);

export function useH4RaffleReadback(ctx: HCtx) {
  const read = ctx.can("growth_h4_read"), operator = currentAdminOperator();
  const [rows, setRows] = useState<AdminRaffle[]>([]);
  const [loading, setLoading] = useState(read), [readError, setReadError] = useState("");
  const generation = useRef(0), active = useRef(false);
  const isActive = () => active.current && read && operator === currentAdminOperator();
  useLayoutEffect(() => {
    active.current = true;
    setRows([]); setReadError(""); setLoading(read);
    return () => { active.current = false; generation.current += 1; };
  }, [read, operator]);

  const load = async (afterWrite = false) => {
    if (!isActive()) return null;
    const own = ++generation.current; setLoading(true); setReadError("");
    const isCurrent = () => own === generation.current && isActive();
    try {
      const result = await fetchAdminRaffles(isCurrent);
      if (!result || !isCurrent()) return null;
      setRows(result.rows);
      for (const id of result.missing) ctx.toast(`本次保存已成功，但编号 ${id} 的这一期已不存在。`, "warn");
      if (result.advanced) ctx.toast(RAFFLE_READBACK_ADVANCED);
      else if (result.saved) ctx.toast("创世抽奖设置已保存");
      return result;
    } catch (cause) {
      if (!isCurrent()) return null;
      setReadError(displayAdminError(cause));
      if (afterWrite && isOutcomeUnknownError(cause)) throw cause;
      return null;
    }
    finally { if (isCurrent()) setLoading(false); }
  };
  return { read, operator, rows, loading, readError, load, isActive };
}

export default function H4GenesisRaffle({ ctx, readback, onApprovalCompleted, confirmRecovery, reopenRejected, readSaved }: { ctx: HCtx; readback: ReturnType<typeof useH4RaffleReadback>; onApprovalCompleted?: () => Promise<void>; confirmRecovery: typeof h4PendingConfirmRecovery; reopenRejected: RefObject<H4ReopenRejected | null>; readSaved: RefObject<((shouldClose: (scope: string) => boolean) => Promise<boolean>) | null> }) {
  const { read, operator, rows, loading, readError, load, isActive } = readback;
  const [error, setError] = useState("");
  const [requiredLanguages, setRequiredLanguages] = useState<readonly OperatingLanguageCode[]>(OPERATING_LANGUAGE_CODES);
  const [base, setBase] = useState<AdminRaffle | null>(null), [draft, setDraft] = useState<RaffleDraft | null>(null);
  const [enabled, setEnabled] = useState(false), [saving, setSaving] = useState(false);
  const write = ctx.can("growth_h4_write"), locked = !!base && base.status !== "DRAFT";
  const [, pendingChanged] = useState(0);
  /** 保存被「别人先改过」拒绝、已重读后的提醒；只决定显示。 */
  const [stale, setStale] = useState("");
  const [conflictFields, setConflictFields] = useState<HConflictField[] | null>(null);
  /** 合并后回到表单：放回了几项自己改的。只决定显示。 */
  const [merged, setMerged] = useState(0);
  useEffect(() => { setSaving(false); if (read) void load(); }, [read, operator]);
  useEffect(() => { setDraft(null); setBase(null); setError(""); }, [read, operator]);
  useEffect(() => {
    const changed = () => pendingChanged(v => v + 1);
    window.addEventListener("admin-h4-pending-changed", changed);
    return () => window.removeEventListener("admin-h4-pending-changed", changed);
  }, []);
  const choose = (row: AdminRaffle | null, required = requiredLanguages) => {
    const initial = row ? editableRaffle(row, required) : empty();
    setConflictFields(null); setStale(""); setMerged(0); setBase(row); setDraft(initial); setEnabled(row?.status === "OPEN"); setError("");
  };
  const openRaffle = async (row: AdminRaffle | null, button: HTMLElement) => {
    const required = await getRequiredContentLanguages();
    if (!isActive()) return;
    // 等语言的时候运营已经在别的确认框或离开框里了：先让那边做完，这次打开作废。
    if (document.querySelector('.rd-modal[data-state="open"]')) return;
    // 另一个抽屉可能已经打开：按现在的样子再问一次（OP-29）。
    leave.attempt(() => {
      setRequiredLanguages(required);
      // 抽屉要等语言读完才开，焦点记的是点的那个按钮。
      focus.from(button);
      choose(row, required);
    });
  };
  const prizePatch = (id: string, values: Partial<RafflePrize>) => setDraft(current => current ? { ...current, prizes: current.prizes.map(prize => prize.id === id ? { ...prize, ...values } : prize) } : null);
  const saveBlocked = !!base && (base.status === "PROCESSING" || base.status === "DRAWN" || (base.status === "OPEN" && base.totalEntries > 0));
  const save = (restored?: { base: AdminRaffle | null; draft: RaffleDraft; enabled: boolean; rejection: PendingConfirmRejected }, after?: () => void) => {
    // 要去的地方只属于这一次保存：被拒、结果未知就作废，之后的普通关闭只关这个抽屉。
    let onward = after;
    /** 有了确定的成功，发出去成功和查到原结果走同一个后续。 */
    const finished = () => {
      if (onward) { close(); onward(); }
    };
    const previous = restored ? restored.base : base, savedDraft = restored?.draft ?? draft;
    const nextEnabled = restored?.enabled ?? (!!base && enabled);
    if (savedDraft && confirmedH4Saves().some(record => record.scope === `H/h4_genesis_raffle/${savedDraft.id}`)) return;
    if (!savedDraft || !write || !restored && (saving || saveBlocked || conflictFields)) return;
    const unchanged = isUnchangedRaffle(previous, raffleLocalizedDraft(savedDraft, requiredLanguages, "submit"), nextEnabled, requiredLanguages);
    if (unchanged && !restored) return;
    const invalid = !restored && raffleDraftError(savedDraft, requiredLanguages); if (invalid) { setError(invalid); return; }
    const opening = nextEnabled && previous?.status === "DRAFT";
    const closing = !nextEnabled && previous?.status === "OPEN";
    // 还是草稿、不开放：只存草稿（OP-25）。
    const draftOnly = !nextEnabled && (!previous || previous.status === "DRAFT");
    const readVersion = h4ReadVersion("raffles");
    const rereadConflict = () => h4ReadConflict(async () => {
      const values = await load();
      if (!values) throw new Error("最新的这一期加载失败");
      const latest = values.rows.find(row => row.id === savedDraft.id) ?? await fetchAdminRaffle(savedDraft.id);
      if (!isActive()) return;
      if (!previous) {
        if (latest) throw new ConfirmReadConflict(undefined, "RAFFLE_ALREADY_EXISTS");
        ctx.openActionConfirm(null);
        return;
      }
      if (!latest) throw new ConfirmReadConflict(undefined, restored ? H4_MISSING_ORIGINAL : "最新读取里没有这一期");
      setBase(latest); setDraft(savedDraft); setEnabled(nextEnabled);
      const comparable = (value: RaffleDraft, enabled: boolean) => ({ ...value,
        prizes: Object.fromEntries(value.prizes.map(prize => [prizeKey(prize.id), prize])), enabled });
      setConflictFields(hConflictFields(comparable(editableRaffle(previous, requiredLanguages), previous.status === "OPEN"),
        comparable(editableRaffle(latest, requiredLanguages), latest.status === "OPEN"), comparable(savedDraft, nextEnabled), equalRaffleField));
      setStale(savedDraft.titleZh || savedDraft.id);
      ctx.openActionConfirm(null);
    });
    const rejected = (error: PendingConfirmRejected) => isH4ReadConflict(error) ? rereadConflict() : error;
    let originalKey: string | undefined;
    const pending = () => originalKey ? pendingH4Commands().find(record => record.commandKey === originalKey) : h4PendingFor(`H/h4_genesis_raffle/${savedDraft.id}`);
    ctx.openActionConfirm({ formKey: restored ? 0 : undefined, initialRejection: restored && rejected(restored.rejection), getPendingReason: () => pending()?.reason, briefKind: "config", action: `${nextEnabled ? "保存并开启" : "保存抽奖配置"} · ${savedDraft.titleZh || savedDraft.titleEn || savedDraft.id}`, amplifies: nextEnabled,
      getPendingRecovery: () => confirmRecovery(pending(), async () => {
        if (opening) await onApprovalCompleted?.();
        if (!await load()) throw new Error("已保存，但最新数据加载失败");
        close();
        ctx.openActionConfirm(null);
        // 保存结果由 load 提示，这里只接后续。
        finished();
      },
        rejected),
      title: opening ? "开放抽奖报名" : closing ? "关闭报名回草稿" : draftOnly ? "保存抽奖草稿" : "保存抽奖配置",
      // 影响写这次保存的真实后果（OP-53）：开放、关闭、存草稿各不相同；开放中的一期后端不让直接改。
      statedBrief: opening ? { impact: "批准后这一期开放报名。", check: "核对时间、奖项和名额，理由写清依据。" }
        : closing ? { impact: "这一期马上停止报名。", check: "确认还没人报名，理由写清依据。" }
        : previous && previous.status !== "DRAFT" ? { impact: "开放中的一期不能直接改：先关闭报名回草稿，改好再申请开放。", check: "核对这一期现在的状态。" }
        : { impact: previous ? "只保存这一期的配置，仍是草稿，不对用户开放。" : "新的一期存成草稿，不对用户开放。", check: "核对时间、奖项和名额，理由写清依据。" },
      effect: opening ? effectApproval("这一期") : draftOnly ? effectDraft : effectDirect,
      detail: <>本期共 {seats(savedDraft.prizes)} 个中奖名额。{nextEnabled ? "开启后用户可按公布时段使用抽奖券报名；开奖时发放配置的奖品。" : closing ? "关闭后停止报名，这一期回到草稿。" : previous ? "保存成草稿，不会对用户开放。" : "新建轮次保存为草稿，不会对用户开放。"}</>,
      facts: <>
        {merged > 0 && <H4StaleNote />}
        <Facts>
          <Fact k="这一期">{savedDraft.titleZh || savedDraft.titleEn || "—"} · {savedDraft.id}</Fact>
          <Fact k="报名开始 → 开奖（北京时间）">{formatTime(savedDraft.startsAt, "Asia/Shanghai")} → {formatTime(savedDraft.drawAt, "Asia/Shanghai")}</Fact>
          <Fact k="奖项">{savedDraft.prizes.length} 项 · 共 {seats(savedDraft.prizes)} 个名额：{savedDraft.prizes.map((prize) => `${prize.nameZh || prize.nameEn || "未命名"} ${prizeText(prize)} × ${prize.quantity}`).join("；")}</Fact>
          {opening && <Fact k="开放后">用户可以用创世抽奖券报名；到开奖时间系统自动开奖、按奖项发奖</Fact>}
          {nextEnabled && <Fact k="之后能不能改">还没人报名时可以关闭回草稿再改；有人报名后奖项和时间锁定，也不能再关闭</Fact>}
          {closing && <Fact k="关闭后">回到草稿，用户不能再报名；改好后可以再申请开放</Fact>}
          {!previous && <Fact k="保存后">新的一期先是草稿，不对用户开放；保存后再打开它申请开放</Fact>}
          {opening && <ApprovalFact amplify="开放报名" object="这一期" />}
        </Facts>
      </>,
      confirmLabel: opening ? "提交审批" : draftOnly ? "保存草稿" : closing ? "确认关闭" : "保存配置",
      blockedReason: unchanged ? "没有改动" : undefined,
      reasonPlaceholder: opening ? "例如：奖项和时间已确认，申请开放报名" : "例如：按活动方案配置这一期",
      run: async reason => {
        if (operator !== currentAdminOperator() || !ctx.can("growth_h4_write")) throw new Error("登录身份或权限已变化，请重新打开配置。");
        setSaving(true); setError("");
        const complete = async (result: unknown) => {
          if (!isActive()) return;
          const approval = isH4ApprovalReceipt(result);
          if (approval) {
            await onApprovalCompleted?.();
            if (!isActive()) return;
            setDraft(null); setBase(null);
            ctx.toast(h4TicketResult(result.ticket));
          }
          // A refresh started before the write response may have missed its receipt.
          if (await load(!approval)) close();
          finished();
        };
        try {
          const original = originalKey ? pendingH4Commands().find(r => r.commandKey === originalKey) : undefined;
          if (!original) assertH4Fresh("raffles", readVersion);
          let result;
          if (original) result = await retryH4Command(original);
          else {
            const required = await getRequiredContentLanguages();
            setRequiredLanguages(required);
            const problem = raffleDraftError(savedDraft, required);
            if (problem) throw new Error(problem);
            const submitted = raffleLocalizedDraft(savedDraft, required, "submit");
            if (isUnchangedRaffle(previous, submitted, nextEnabled, required)) throw new Error("没有改动");
            result = await saveAdminRaffle(submitted, previous?.revision ?? null, nextEnabled, reason, opening, previous);
          }
          await complete(result);
        } catch (cause) {
          // 直接保存被判定要走审批：换成审批确认，内容和理由沿用（H-改走审批）。
          if (!(cause instanceof HApprovalRequired)) onward = undefined;
          if (cause instanceof HApprovalRequired) {
            ctx.openActionConfirm(null);
            ctx.openConfirm(hApprovalReconfirm(cause, { action: `${nextEnabled ? "保存并开启" : "保存抽奖配置"} · ${savedDraft.titleZh || savedDraft.titleEn || savedDraft.id}`, title: "保存抽奖配置", reason,
              completed: complete, hasPending: () => !!h4PendingFor(`H/h4_genesis_raffle/${savedDraft.id}`),
              onUnknown: () => { ctx.closeConfirm?.(); setDraft(null); setBase(null); }, approver: "另一位超级管理员", holds: "这一期", extra: <Fact k="这一期">{savedDraft.titleZh || savedDraft.titleEn || "—"} · {savedDraft.id}</Fact> }));
            return;
          }
          if (isH4ReadConflict(cause) && !originalKey) {
            throw rereadConflict();
          }
          if (isActive()) setError(displayAdminError(cause));
          if (originalKey && !h4PendingFor(`H/h4_genesis_raffle/${savedDraft.id}`)) { ctx.openActionConfirm(null); setDraft(null); setBase(null); await load(); }
          throw cause;
        }
        finally { originalKey = h4PendingFor(`H/h4_genesis_raffle/${savedDraft.id}`)?.commandKey; setSaving(false); }
      },
    });
  };
  useLayoutEffect(() => {
    reopenRejected.current = async (record, rejection) => {
      if ("proposal" in record.request) return;
      const body = JSON.parse(record.request.body) as RaffleDraft & { enabled?: boolean; expectedRevision?: number };
      const { id } = body;
      const creating = record.request.method === "POST";
      const latest = await load();
      if (!latest) throw new ConfirmReadConflict(undefined, "最新的这一期加载失败");
      const current = latest.rows.find(row => row.id === id) ?? await fetchAdminRaffle(id);
      if (!isActive()) return;
      if (!creating && !current) throw new ConfirmReadConflict(undefined, H4_MISSING_ORIGINAL, true);
      if (rejection.reasonCode === "RAFFLE_NOT_FOUND") throw new ConfirmReadConflict(undefined, current
        ? "这一期已被别人改过，原来的操作现在不能再做；你填的内容没有提交，请按最新状态重新操作。" : H4_MISSING_ORIGINAL, true);
      if (!ctx.can("growth_h4_write")) return;
      const previous = record.opened ? parseAdminRaffle(record.opened) : creating ? null : current;
      if (creating ? record.opened !== null : !previous || previous.id !== id || previous.revision !== body.expectedRevision) {
        return () => { choose(current); setError(H4_OLD_RECORD_REJECTED); };
      }
      if (previous?.status === "OPEN" && body.enabled === false && current) {
        const reason = current.status === "DRAFT" ? "这一期已回到草稿" : current.status !== "OPEN" ? "已开奖或正在开奖，只能查看"
          : current.totalEntries > 0 ? "已有人报名，不能再关闭" : undefined;
        if (reason) throw new ConfirmReadConflict(undefined, `${reason}。你填的内容没有提交。`, true);
      }
      const { titleZh, titleEn, titleVi, startsAt, drawAt, prizes } = body;
      const draft = raffleLocalizedDraft({ id, titleZh, titleEn, titleVi, startsAt, drawAt, prizes }, requiredLanguages, "edit");
      const enabled = body.enabled === true;
      const error = current?.revision === previous?.revision || isH4ReadConflict(rejection) ? rejection : new PendingConfirmRejected("H4_REFRESH_REQUIRED");
      return () => {
        choose(previous); setDraft(draft); setEnabled(enabled);
        save({ base: previous, draft, enabled, rejection: error });
      };
    };
    return () => { reopenRejected.current = null; };
  });
  const close = () => { setConflictFields(null); setDraft(null); setBase(null); setError(""); };
  // 三方对比：奖项逐项逐字段列，名称、金额、名额原样写，不舍入。
  const review = base && draft ? conflictFields : null;
  const PRIZE_FIELD: Record<string, string> = { nameZh: "中文名称", nameEn: "英文名称", nameVi: "越南语名称", rewardType: "奖励类型", amount: "每名金额", productNo: "设备商品编号", quantity: "中奖名额", id: "奖项" };
  const prizeName = (id: string) => {
    const leaf = review?.find(field => field.path === `prizes.${prizeKey(id)}.nameZh`);
    // 空名不算有名字：最新一份没写中文名时用你填的或打开时的名字。
    return [leaf?.latest, leaf?.mine, leaf?.opened].map(name => name == null ? "" : String(name).trim()).find(Boolean) || "未命名奖项";
  };
  const compareGroups: H4ConflictGroup[] = review ? h4ConflictGroups(review,
    path => path.startsWith("prizes.") ? path.split(".").slice(0, 3).join(".") : path.split(".")[0],
    key => {
      const [, id, field] = key.split(".");
      if (key.startsWith("prizes.")) return `${prizeName(decodeURIComponent(id))} · ${PRIZE_FIELD[field] ?? "其他"}`;
      return ({ enabled: "开放报名", titleZh: "抽奖名称 · 中文", titleEn: "抽奖名称 · 英文", titleVi: "抽奖名称 · 越南语", startsAt: "报名开始（北京时间）", drawAt: "开奖时间（北京时间）", id: "本期编号" } as Record<string, string>)[key] ?? "其他";
    },
    (key, raw, which) => key === "enabled" ? raw === true ? "开放" : raw === false ? "关闭" : "—"
      : key === "startsAt" || key === "drawAt" ? raw ? formatTime(raw as string, "Asia/Shanghai") : "未配置"
      : key.endsWith(".rewardType") ? raw === "DEVICE" ? "设备" : raw === undefined ? "—" : String(raw)
      : key.startsWith("prizes.") && raw === undefined ? "—"
      : key.endsWith(".amount") ? (type => type === "DEVICE" ? `${Number(raw)} 台` : `${amountText(String(raw))} ${PRIZE_UNIT[type]}`)(review.find(field => field.path === `${key.slice(0, -7)}.rewardType`)?.[which] as RafflePrize["rewardType"])
      : raw === undefined || raw === null || raw === "" ? "—" : String(raw)) : [];
  const prizeFields = (id: string) => review?.filter(field => field.path.startsWith(`prizes.${prizeKey(id)}.`)) ?? [];
  /** 从对比数据里按奖项拼回某一份的奖项；那一份没有这一项时是 undefined。 */
  const prizeAt = (id: string, which: "opened" | "latest" | "mine") => {
    const leaves = prizeFields(id);
    if (leaves.find(field => field.path === `prizes.${prizeKey(id)}.id`)?.[which] === undefined) return undefined;
    return Object.fromEntries(leaves.map(field => [field.path.split(".")[2], field[which]])) as unknown as RafflePrize;
  };
  const prizeChanges = (which: "latest" | "mine") => {
    const ids = review?.filter(field => /^prizes\.[^.]+\.id$/.test(field.path)) ?? [];
    return {
      added: ids.filter(field => field.opened === undefined && field[which] !== undefined).map(field => String(field[which])),
      removed: ids.filter(field => field.opened !== undefined && field[which] === undefined).map(field => String(field.opened)),
    };
  };
  const structureChanges = { latest: prizeChanges("latest"), mine: prizeChanges("mine") };
  // 对比表按奖项分组：最新的顺序，然后是你新加的、两边都没有了的；增删过的奖项整项比一行。
  const prizeIds = [...new Set([...(base?.prizes.map(prize => prize.id) ?? []), ...(draft?.prizes.map(prize => prize.id) ?? []),
    ...(review?.filter(field => /^prizes\.[^.]+\.id$/.test(field.path) && field.opened !== undefined).map(field => String(field.opened)) ?? [])])];
  const prizeSummary = (prize: RafflePrize | undefined) => prize ? `${prize.nameZh || prize.nameEn || "未命名"} ${prizeText(prize)} × ${prize.quantity}` : "没有这一项";
  const marks = (id: string) => [
    structureChanges.latest.added.includes(id) && "别人新加", structureChanges.latest.removed.includes(id) && "别人删了",
    structureChanges.mine.added.includes(id) && "你新加的", structureChanges.mine.removed.includes(id) && "你删了",
  ].filter((mark): mark is string => !!mark);
  const prizeSections: H4CompareSection[] = review ? [
    { key: "raffle", rows: compareGroups.filter(group => !group.key.startsWith("prizes.")) },
    ...prizeIds.map(id => {
      const opened = prizeAt(id, "opened"), latest = prizeAt(id, "latest"), mine = prizeAt(id, "mine"), tags = marks(id);
      const rows = compareGroups.filter(group => group.key.startsWith(`prizes.${prizeKey(id)}.`)
        && (!tags.length || !!opened && (latest && !mine && group.byOther || mine && !latest && group.byMe)))
        .map(group => ({ ...group, label: PRIZE_FIELD[group.key.split(".")[2]] ?? "其他" }));
      const fields = prizeFields(id);
      const whole = tags.length ? { opened: prizeSummary(opened), latest: prizeSummary(latest), byOther: fields.some(field => field.changedByOther), byMe: fields.some(field => field.changedByMe),
        mine: prizeSummary(mine) } : undefined;
      return { key: id, title: prizeName(id), tags: tags.map(mark => <StatusTag key={mark} tone={mark.startsWith("别人") ? "warn" : "neutral"}>{mark}</StatusTag>), rows, whole };
    }),
  ].filter((section: H4CompareSection) => section.rows.length || section.whole) : [];
  const overlappingRemoval = (removed: string[], other: "latest" | "mine", changed: "changedByOther" | "changedByMe") =>
    removed.some(id => prizeAt(id, other) && prizeFields(id).some(field => field[changed]));
  const mergeBlockedReason = overlappingRemoval(structureChanges.mine.removed, "latest", "changedByOther") || overlappingRemoval(structureChanges.latest.removed, "mine", "changedByMe")
    ? "同一个奖项一边被删除、一边被修改，不能合并。关闭后读取最新一期，再重新编辑。"
    : saveBlocked || base?.status === "OPEN" && compareGroups.some(group => group.byMe && (group.key !== "enabled" || enabled)) ? "这一期不能再改" : undefined;
  // Latest configuration plus only the draft's changed fields, matched by prize id.
  const mergeConflict = () => {
    if (!base || !draft || mergeBlockedReason) return;
    const latest = base, mine = draft, kept = compareGroups.filter(group => group.byMe);
    const next = editableRaffle(latest, requiredLanguages);
    next.prizes = next.prizes.filter(prize => !structureChanges.mine.removed.includes(prize.id));
    next.prizes.push(...mine.prizes.filter(prize => structureChanges.mine.added.includes(prize.id)));
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
  const pendingSave = draft ? h4PendingFor(`H/h4_genesis_raffle/${draft.id}`) : undefined;
  const awaitingRead = draft ? confirmedH4Saves().find(record => record.scope === `H/h4_genesis_raffle/${draft.id}`) : undefined;
  const savedUnread = !!awaitingRead;
  const needsVerification = !!awaitingRead && h4RaffleSaveNeedsVerification(awaitingRead);
  const unchanged = base && draft
    && isUnchangedRaffle(base, raffleLocalizedDraft(draft, requiredLanguages, "submit"), enabled, requiredLanguages);
  const focus = useH4DrawerFocus(!!draft, "h4l-raffle");
  const leave = useH4EditGuard();
  // 改过没有：和保存按钮同一个判断（同值的金额不算改动）；新建的和空白比。只能查看的一期不算。
  const dirty = !!draft && !savedUnread && (base ? !saveBlocked && unchanged === false : JSON.stringify(draft) !== JSON.stringify(empty()));
  const scope = draft ? `H/h4_genesis_raffle/${draft.id}` : "";
  const openScope = useRef(scope);
  useLayoutEffect(() => {
    openScope.current = scope;
    readSaved.current = async shouldClose => {
      const result = await load();
      if (result && shouldClose(openScope.current)) close();
      return !!result;
    };
    return () => { readSaved.current = null; };
  });
  const draftOnly = !enabled && (!base || base.status === "DRAFT");
  const saveLabel = draftOnly ? "保存草稿" : "保存配置";
  const saveReason = !write ? "没有修改创世抽奖的权限" : savedUnread ? needsVerification ? "保存结果待核对；关掉后点「刷新」。" : "不用重新提交；关掉后点「刷新」，读到后再改。" : saveBlocked ? "这一期不能再改" : h4ReadVersion("raffles") === undefined ? displayAdminError(new Error("H4_REFRESH_REQUIRED")) : review ? "先在上面选一种继续" : draft ? h4ApprovalLockedReason(scope) ?? (pendingSave ? H4_UNKNOWN_SAVE : unchanged ? "没有改动" : undefined) : undefined;
  // 保存动作按真实路径命名（OP-29）：开放走审批，关闭报名立即生效，其余存成草稿。
  useH4Editor(draft ? {
    scope, dirty, saveReason, close,
    saveName: base?.status === "DRAFT" && enabled ? "提交审批后继续" : base?.status === "OPEN" && !enabled ? "保存并立即生效" : "保存草稿后继续",
    save: after => save(undefined, after),
  } : null);
  if (!read) return <BlockState state="denied" title="没有查看创世抽奖的权限" detail="创世抽奖需要「活动中心查看」权限。" />;

  const showSaved = savedUnread && (!error || !!readError);
  const saveNoticeTitle = showSaved ? needsVerification ? RAFFLE_SAVE_PENDING : "已保存，但没读到最新的这一期" : pendingSave && !pendingSave.acknowledged ? "操作结果未知"
    : stale ? "没有保存：最新的这一期也没读到" : "没有保存";
  const formLocked = !write || saving || savedUnread || !!draft && h4Blocked(`H/h4_genesis_raffle/${draft.id}`) || !!review;
  const enableBlocked = !!base && (base.status === "PROCESSING" || base.status === "DRAWN" || base.totalEntries > 0);
  return <Panel id="h4l-raffle" title="创世抽奖" icon={Trophy} tone="role-4" sub={loading ? undefined : `最近 ${rows.length} 期`}
    explain={<><p>用户用创世抽奖券报名，到开奖时间系统自动开奖、发奖；这里没有人工开奖或补发。</p><p>从草稿开放报名要另一位超级管理员批准。还没人报名时可以关闭回草稿再改；有人报名后奖项和时间锁定。只显示最近 50 期。</p></>}
    actions={<><Button disabledReason={loading ? "正在读取" : saving ? "正在保存" : draft ? "先关掉正在改的这一期" : undefined} onClick={() => void load()}>刷新</Button><Button icon={<Plus size={14} aria-hidden />} disabledReason={!write ? "没有修改创世抽奖的权限" : loading ? "正在读取" : saving ? "正在保存" : draft ? "先关掉正在改的这一期" : undefined} onClick={event => { const button = event.currentTarget; leave.attempt(() => void openRaffle(null, button)); }}>新建一期</Button></>}>
    {loading ? <BlockState state="loading" title="正在加载抽奖设置" />
      : readError ? <BlockState state="error" title="创世抽奖没有读到" detail={readError} onRetry={() => void load()} />
      : !rows.length ? <BlockState state="empty" title="暂无抽奖轮次" detail="点右上角「新建一期」。" />
      : <ol className="h4l-draws" aria-label="抽奖期，最新的在上">{rows.map(row => {
        const status = STATUS[row.status];
        return <li key={row.id} data-code={row.id} className="h4l-draw" data-state={row.status}>
          <span className="h4l-draw-dot" aria-hidden />
          <div className="h4l-draw-body">
            <header className="h4-card-head">
              <div className="h4-card-title"><h3>{row.titleZh || row.titleEn || "中文名称未配置"}</h3><span className="h4-card-meta"><span className="h4-mono" title={row.id}>{row.id}</span></span></div>
              <span className="h4l-tags"><StatusTag tone={status.tone} explain={status.explain}>{status.label}</StatusTag><Button size="sm" disabledReason={saving ? "正在保存" : draft ? "先关掉正在改的这一期" : undefined} onClick={event => { const button = event.currentTarget; leave.attempt(() => void openRaffle(row, button)); }}>{row.status === "DRAFT" || (row.status === "OPEN" && row.totalEntries === 0) ? "查看和修改" : "查看"}</Button></span>
            </header>
            <Steps label={`${row.titleZh || row.titleEn || row.id} 走到哪`} items={["草稿", "开放报名", "开奖处理中", "已开奖"].map((label, index) => ({ label, state: index < status.step ? "done" as const : index === status.step ? "current" as const : "todo" as const }))} />
            <dl className="h4l-facts">
              <div><dt>报名开始</dt><dd className="h4-num">{formatTime(row.startsAt, "Asia/Shanghai")}</dd></div>
              <div><dt>开奖</dt><dd className="h4-num">{formatTime(row.drawAt, "Asia/Shanghai")}</dd></div>
              <div><dt><Ticket size={14} aria-hidden />已报名</dt><dd><span><b className="h4-num">{row.totalEntries}</b> 票</span><small>按报名用掉的抽奖券数，不是人数</small></dd></div>
              <div><dt><Trophy size={14} aria-hidden />奖项</dt><dd>{row.prizes.length ? <><span><b className="h4-num">{seats(row.prizes)}</b> 个名额</span><small>{row.prizes.map((prize) => `${prize.nameZh || prize.nameEn || "未命名"} ${prizeText(prize)} × ${prize.quantity}`).join("；")}</small></> : <span className="h4-dim">还没配奖项</span>}</dd></div>
            </dl>
          </div>
        </li>;
      })}</ol>}
    {rows.length > 0 && error && !draft && <Notice tone="danger" title="创世抽奖没有读到最新的">{error}</Notice>}
    {stale && !draft && <Notice tone="warn" title={`没有保存：「${stale}」已被别人改过`} action={<Button size="sm" variant="ghost" onClick={() => setStale("")}>知道了</Button>}>{error ? "你这次改的没有提交。" : "已读到最新配置。你这次改的没有提交，关掉时已丢弃；要改就重新打开。"}</Notice>}
    {!loading && rows.length > 0 && <p className="h4l-note">时间为北京时间</p>}
    <Drawer open={!!draft} onClose={dirty ? leave.askClose : close} keepOnControls={dirty} busy={saving} title={base ? "这一期的配置" : "新建一期抽奖"} sub={base ? base.id : undefined} icon={Trophy} tone="role-4"
      explain="保存前先在这里填完整：三语名称、时间和奖项。没保存的改动，关闭时会先问。"
      footer={<Decision note={!write ? "没有修改创世抽奖的权限" : saveBlocked ? (base?.status === "OPEN" ? "已有人报名：奖项和时间锁定，也不能关闭" : "已开奖或正在开奖，只能查看") : undefined}
        others={<Button disabled={saving} onClick={leave.askClose}>取消</Button>}
        primary={<Button variant="primary" loading={saving} loadingText="正在保存…" disabledReason={saveReason} onClick={() => save()}>{saveLabel}</Button>} />}>
      {draft && <div className="h4-dialog-body">
        {review && <H4ConflictCompare groups={compareGroups} sections={prizeSections} mergeDisabledReason={mergeBlockedReason} onMerge={mergeConflict} />}
        {merged > 0 && <Notice tone="neutral" title="已合并，还没保存" action={<Button size="sm" variant="ghost" onClick={() => setMerged(0)}>知道了</Button>}>{`表单是最新的这一期，放回了你改的 ${merged} 项。核对后点「${saveLabel}」。`}</Notice>}
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
            {(["zh", "en", "vi"] as const).map(locale => {
              const { label, suffix } = RAFFLE_LANGUAGES[locale];
              const required = requiredLanguages.includes(locale);
              const copied = locale !== "en" && required && isEnglishCopy(
                { title: draft.titleEn, names: draft.prizes.map(prize => prize.nameEn) },
                { title: draft[`title${suffix}`], names: draft.prizes.map(prize => prize[`name${suffix}`]) },
              );
              return <Field key={locale} label={`抽奖名称 · ${label}`} required={required} help={copied ? englishCopyHint(locale) : undefined}><Input value={draft[`title${suffix}`]} onChange={event => setDraft({ ...draft, [`title${suffix}`]: event.target.value })} /></Field>;
            })}
            {(["startsAt", "drawAt"] as const).map((key, index) => <Field key={key} label={`${index ? "开奖时间" : "报名开始"}（UTC）`} help={draft[key] && Number.isFinite(Date.parse(draft[key])) ? `北京时间 ${formatTime(draft[key], "Asia/Shanghai")}` : "未配置"}><Input type="datetime-local" step={60} value={dateInput(draft[key])} onChange={event => setDraft({ ...draft, [key]: event.target.value ? new Date(`${event.target.value}Z`).toISOString() : "" })} /></Field>)}
          </div>
          <ol className="h4l-prizes" aria-label="奖项">
            {draft.prizes.map((prize, index) => <li key={prize.id} className="h4l-prize">
              <header><b>奖项 {index + 1}{(prize.nameZh.trim() || prize.nameEn.trim()) ? ` · ${prize.nameZh.trim() || prize.nameEn.trim()}` : ""}</b><span className="h4-dim">{prizeText(prize)} × {prize.quantity}</span><Button size="sm" variant="danger-outline" icon={<Trash2 size={13} aria-hidden />} disabled={formLocked || locked} onClick={() => setDraft({ ...draft, prizes: draft.prizes.filter(item => item.id !== prize.id) })}>移除</Button></header>
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
        {(error || savedUnread) && !review && <Notice tone={showSaved || pendingSave && !pendingSave.acknowledged ? "warn" : "danger"} title={saveNoticeTitle}>{showSaved ? needsVerification ? "关掉后点「刷新」，读到这一期才能确认是否保存。" : "不用重新提交；关掉后点「刷新」，读到后再改。" : error}</Notice>}
      </fieldset></div>}
    </Drawer>
  </Panel>;
}

"use client";

/**
 * H7 代金券 — 运营管代金券模板：看有哪些券在投放、各发出多少、用了多少、作废多少；
 * 新增、编辑满减券或折扣券，暂停或投放（直接生效）；删除券模板、作废这张券下所有还没用的券（提交审批，另一位管理员批准后执行）。
 *
 * 真写后端 growth/vouchers 接口。新增、编辑先在页面自己的填写抽屉里填，再进共用确认框写理由；
 * 提交内容仍由 parseVoucher 从同一套表单值生成，请求和改版前一样。删除和作废走 A2，原提案的保存和恢复沿用 h7-voucher-approval。
 * 代金券是促销折扣、非 NEX 负债 → 不挂 amplifies / B1 红线(与 H2 试用折扣同口径)。
 */
import { isHGrowthReadConflict } from "@/lib/admin/h-write-conflict";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Ban, BellOff, LayoutGrid, List, Pencil, Play, Pause, Plus, ReceiptText, RefreshCw, Send, Ticket, TicketCheck, Trash2 } from "lucide-react";
import {
  BlockState, Button, Cell, Change, Conclusion, Decision, DiffList, Drawer, Explain, Fact, Facts, FilterBar, Fold, IrreversibleTag, Notice,
  PageHeader, Panel, RatioBar, ReleaseModal, Segments, Stat, StatBand, StatusTag, Table, TableMessage, Td, Th, Tr,
} from "@/app/components/rd";
import {
  fetchH7Vouchers, type H7Overview,
} from "@/lib/admin/h-client";
import {
  H7_VOUCHER_ACTIONS, canRetryH7VoucherApproval,
  pendingH7VoucherApprovals,
  releaseExpiredH7VoucherApproval,
  submitH7VoucherApproval,
  type H7VoucherApprovalInput,
  type H7VoucherApprovalMode,
} from "@/lib/admin/h7-voucher-approval";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { businessClock, businessZone } from "@/lib/admin/business-time";
import { useReach } from "@/lib/nav/use-reach";
import type { HCtx } from "./types";
import { displayAdminError, displayAdminReadError } from "@/lib/admin/error-messages";
import { h7DateInput as toDateInput, h7DateMs as toMs, h7EditedDateMs, H7_TIME_ZONE } from "@/lib/admin/h7-voucher-time";
import { createH7VoucherMutation, pendingH7VoucherMutations, requireH7Actor, sendH7VoucherMutation, type H7DirectContext, type H7DirectMutation } from "@/lib/admin/h7-voucher-mutation";
import { isRetryExpired, RETRY_EXPIRED_TEXT } from "@/lib/admin/pending-mutation-store";
import {
  AUDIENCE_LABEL, H7RecoveryNotice, UNIT, UsageBar, VoucherCard, VoucherFace, VoucherTags, acknowledgedTag, amountText, conditionLines, countText, expiredTag,
  endDetailText, faceValue, limitReached, pendingFacts, pendingTag, periodText, skuText, startDetailText, surfacesText, unknownTag, voucherPhase, voucherSentence, type H7RecoveryRow, type H7Voucher,
} from "./h7-voucher-parts";
import { H7VoucherForm, changedRows, initialForm, type H7FormValue } from "./h7-voucher-form";

type OpsVoucher = H7Voucher;

/** businessValue → OpsVoucher(逗号串拆 SKU/入口 · 日期转 ms · 数值清洗)。 */
function parseVoucher(bv: Record<string, string>, id: string, version = 1, original?: OpsVoucher): OpsVoucher {
  const type: OpsVoucher["type"] = bv.type === "percent" ? "percent" : "fixed";
  const skus = (bv.applicableSkus ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const surfaces = (bv.claimSurfaces ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return {
    id,
    name: bv.name ?? "",
    type,
    amountUSD: type === "fixed" ? Number(bv.amountUSD) || 0 : undefined,
    percent: type === "percent" ? Number(bv.percent) || 0 : undefined,
    minPurchaseUSD: Number(bv.minPurchaseUSD) || 0,
    maxDiscountUSD: Number(bv.maxDiscountUSD) || 0,
    applicableSkus: skus,
    audience: bv.audience === "new" ? "new" : "all",
    startAt: h7EditedDateMs(bv.startDate, original?.startAt),
    endAt: h7EditedDateMs(bv.endDate, original?.endAt, true),
    claimSurfaces: surfaces,
    popupEnabled: bv.popupEnabled !== "false",
    popupDelayMs: Number.isFinite(Number(bv.popupDelayMs)) ? Number(bv.popupDelayMs) : 1300,
    popupCooldownHours: Number.isFinite(Number(bv.popupCooldownHours)) ? Number(bv.popupCooldownHours) : 24,
    popupMaxPerSession: Number.isFinite(Number(bv.popupMaxPerSession)) ? Number(bv.popupMaxPerSession) : 1,
    popupCadenceEnabled: bv.popupCadenceEnabled !== "false",
    stackWithTrial: bv.stackWithTrial === "true",
    stackWithOthers: bv.stackWithOthers === "true",
    splittable: bv.splittable === "true",
    issuanceLimit: Number(bv.issuanceLimit) || 0,
    version,
    issuedCount: 0,
    availableCount: 0,
    redeemedCount: 0,
    revokedCount: 0,
    batchCount: 0,
    status: bv.status === "paused" ? "paused" : "active",
  };
}

/** 谁来批：后端要另一位有效管理员，有审批权限和代金券修改权限，不限超级管理员。 */
const APPROVER = "另一位管理员";
const LOCAL_PENDING = "这张券有结果未知的删除或作废申请，先处理页面上方的提醒";

type Filter = "all" | "active" | "paused";
type View = "cards" | "table";
type FormState = { voucher?: OpsVoucher; initial: H7FormValue; before?: H7FormValue; key: number };

export function H7VoucherConfig({ ctx }: { ctx: HCtx }) {
  const { toast, openActionConfirm } = ctx;
  const canWrite = ctx.can("growth_h7_write");
  const session = useAdminAuth((state) => state.session);
  const adminId = session?.adminId;
  const reach = useReach();
  const [pendingApprovals, setPendingApprovals] = useState<ReturnType<typeof pendingH7VoucherApprovals>>([]);
  const [directUnknown, setDirectUnknown] = useState<H7DirectMutation[]>([]);
  const fresh = useRef(false);
  const currentData = useRef<OpsVoucher[]>([]);
  const [data, setData] = useState<Omit<H7Overview, "stats"> & { stats?: H7Overview["stats"] }>({
    vouchers: [],
    skus: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [readAt, setReadAt] = useState<number | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [view, setView] = useState<View>("cards");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [releasing, setReleasing] = useState<ReturnType<typeof pendingH7VoucherApprovals>[number] | null>(null);

  useEffect(() => {
    const lookups = session ? pendingH7VoucherApprovals(session.adminId).map(record =>
      submitH7VoucherApproval(session, record, record.reason, "lookup")) : [];
    syncPending();
    if (session) void Promise.allSettled(lookups).then(results => {
      if (useAdminAuth.getState().session?.adminId !== session.adminId) return;
      syncPending();
      for (const result of results) if (result.status === "rejected") toast(displayAdminError(result.reason));
    });
  }, [adminId]);

  const syncPending = () => {
    setPendingApprovals(adminId === undefined ? [] : pendingH7VoucherApprovals(adminId));
    setDirectUnknown(adminId === undefined ? [] : pendingH7VoucherMutations(adminId));
  };
  const applyResponse = (payload: H7Overview) => {
    currentData.current = payload.vouchers;
    fresh.current = true;
    setData(payload);
    setReadAt(Date.now());
  };

  useEffect(() => {
    let alive = true;
    fresh.current = false;
    setReadAt(null);
    setLoading(true);
    fetchH7Vouchers()
      .then((payload) => {
        if (!alive) return;
        applyResponse(payload);
        setError(null);
      })
      .catch((err) => {
        if (!alive) return;
        setError(displayAdminReadError(err));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => { alive = false; };
  }, [adminId]);

  const reload = async (preserveDraft = false) => {
    fresh.current = false;
    if (!preserveDraft) { openActionConfirm(null); setForm(null); }
    setLoading(true);
    try {
      applyResponse(await fetchH7Vouchers());
      setError(null);
      return true;
    } catch (err) {
      setError(displayAdminReadError(err));
      return false;
    } finally {
      setLoading(false);
    }
  };

  const list = data.vouchers;
  // 适用 SKU 下拉选项 = 后端返回的在售 SKU;value=产品 id(对齐前端 applicableSkus),label=中文名(运营友好)。
  const skuList = data.skus;
  const activeSkus = skuList.filter((s) => (s.status || "on") === "on");
  const skuOptions = activeSkus.map((s) => s.id ?? s.name);
  const skuLabels: Record<string, string> = Object.fromEntries(activeSkus.map((s) => [s.id ?? s.name, (s.name)]));

  const total = data.stats?.total ?? list.length;
  const activeN = data.stats?.active ?? list.filter((v) => v.status === "active").length;
  const pausedN = data.stats?.paused ?? list.filter((v) => v.status === "paused").length;
  const popupN = data.stats?.popup ?? list.filter((v) => v.popupEnabled && v.popupCadenceEnabled && v.status === "active").length;
  const issuedSum = list.reduce((sum, voucher) => sum + voucher.issuedCount, 0);
  const redeemedSum = list.reduce((sum, voucher) => sum + voucher.redeemedCount, 0);
  const availableSum = list.reduce((sum, voucher) => sum + voucher.availableCount, 0);
  const revokedSum = list.reduce((sum, voucher) => sum + voucher.revokedCount, 0);

  const closeForm = () => setForm(null);

  const directRecord = (id: string) => adminId === undefined ? undefined : pendingH7VoucherMutations(adminId).find(r => r.voucherId === id);
  const blockNew = (id?: string) => !canWrite ? "你只能查看；新增、编辑和处置代金券要有这页的修改权限。"
    : !fresh.current ? loading ? "正在读取最新数据，读完再操作" : "读取失败，读到最新数据后才能新增"
      : id && directRecord(id) ? displayAdminError(new Error("H7_RESULT_UNKNOWN"))
        : id && adminId !== undefined && pendingH7VoucherApprovals(adminId).some(r => r.voucherId === id) ? pendingH7VoucherApprovals(adminId).some(r => r.voucherId === id && r.ticket) ? "这张券已有等批准的申请，审批结束前不能再提交" : LOCAL_PENDING
        : id && currentData.current.find(v => v.id === id)?.pendingApproval ? "这张券已有等批准的申请，审批结束前不能再提交" : undefined;
  const assertNew = (id?: string) => {
    if (adminId === undefined) throw new Error("ADMIN_AUTH_REQUIRED");
    requireH7Actor(adminId, true);
    const blocked = blockNew(id);
    if (blocked) throw new Error(blocked);
  };
  const openAdd = () => { if (blockNew()) return; setForm({ initial: initialForm(), key: Date.now() }); };
  const openEdit = (v: OpsVoucher) => { if (blockNew(v.id)) return; setForm({ voucher: v, initial: initialForm(v, toDateInput), key: Date.now() }); };
  const queryDirect = async (record: H7DirectMutation) => {
    requireH7Actor(record.adminId, false);
    await reload();
  };
  const executeDirect = async (record: H7DirectMutation, recovering: boolean) => {
    try {
      await sendH7VoucherMutation(record, recovering);
    } catch (cause) {
      if (isHGrowthReadConflict(cause)) {
        if (await reload() && record.context.kind === "update") {
          const latest = currentData.current.find(v => v.id === record.voucherId);
          if (latest) setForm({ voucher: latest, initial: record.context.values as H7FormValue, before: initialForm(latest, toDateInput), key: Date.now() });
        }
      } else if (recovering && !directRecord(record.voucherId)) await reload();
      else if (directRecord(record.voucherId)) closeForm();
      throw cause;
    } finally { syncPending(); }
    await reload();
    toast(record.success);
  };
  const runDirect = async (context: H7DirectContext, next: OpsVoucher, reason: string) => {
    const original = directRecord(next.id);
    if (original) { await executeDirect(original, true); return; }
    assertNew(context.kind === "create" ? undefined : next.id);
    if (context.kind !== "create" && currentData.current.find(v => v.id === next.id)?.version !== context.voucher.version) throw new Error("H7_VOUCHER_STALE");
    await executeDirect(createH7VoucherMutation(session!, context, next, reason), false);
  };
  const directRecovery = (id: string, restored?: H7DirectMutation, initialRecovery: "lookup" | "retry" = "retry") => ({
    pending: !!restored, initialRecovery,
    get expired() { const saved = directRecord(id); return !!saved && isRetryExpired(saved); },
    resolve: () => undefined,
    get disabledReason() {
      const saved = directRecord(id);
      return !useAdminAuth.getState().session?.authorities.includes("growth_h7_write") ? "请查询原结果" : saved && isRetryExpired(saved) ? RETRY_EXPIRED_TEXT : undefined;
    },
    recover: async () => { const saved = directRecord(id); if (saved) await queryDirect(saved); return true; },
    retry: async () => { const saved = directRecord(id); if (!saved) throw new Error("H7_ORIGINAL_RESOLVED"); await executeDirect(saved, true); },
  });

  /** 新增：填写抽屉的「下一步」进确认框；提交内容和改版前一样由 parseVoucher 生成。 */
  const reviewAdd = (bv: H7FormValue, restored?: H7DirectMutation, initialRecovery?: "lookup" | "retry") => {
    if (!restored && blockNew()) return;
    const id = restored?.voucherId ?? `vc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const labels = restored?.context.skuLabels ?? skuLabels;
    const preview = parseVoucher(bv, id);
    openActionConfirm({ briefKind: "config",
      action: "新增代金券",
      title: "新增代金券",
      detail: "新增一张代金券模板：满减或折扣、使用门槛、适用商品、发给谁、有效期和领取入口。只是券的规则，不给任何人发券；代金券只抵扣订单金额，不增加平台应付款。",
      effect: <StatusTag tone="progress" filled>立即生效</StatusTag>,
      statedBrief: {
        impact: preview.status === "active" ? "保存后就是投放中，符合条件的用户可以领；不会自动发给任何人。" : "保存后是已暂停，用户还领不到；之后点「投放」才开始。",
        check: "核对券面、门槛、适用商品、发给谁和有效期，理由写清依据或工单号。",
      },
      facts: (
        <Facts>
          <Fact k="名称">{bv.name.trim()}</Fact>
          <Fact k="券面" lead={preview.type === "fixed"} unit={preview.type === "fixed" ? UNIT : undefined}>{preview.type === "fixed" ? amountText(preview.amountUSD) : faceValue(preview).value}</Fact>
          <Fact k="怎么用">{voucherSentence(preview, labels)}</Fact>
          <Fact k="领取入口">{surfacesText(preview.claimSurfaces)}</Fact>
          <Fact k="发行上限">{preview.issuanceLimit === 0 ? "不限量" : `${countText(preview.issuanceLimit)} 张`}</Fact>
          <Fact k="保存后">{preview.status === "active" ? "投放中" : "已暂停"}</Fact>
        </Facts>
      ),
      confirmLabel: "确认新增",
      reasonPlaceholder: "例如：活动方案或工单号",
      initialReason: restored?.reason,
      getPendingReason: () => directRecord(id)?.reason,
      inlineApproval: directRecovery(id, restored, initialRecovery),
      run: (reason) => runDirect({ kind: "create", values: bv, skuLabels: labels }, preview, reason),
    });
  };

  /** 编辑：确认框只列改了的项；提交内容和改版前一样（原 id、原版本）。 */
  const reviewEdit = (v: OpsVoucher, before: H7FormValue, bv: H7FormValue, restored?: H7DirectMutation, initialRecovery?: "lookup" | "retry") => {
    if (!restored && blockNew(v.id)) return;
    const labels = restored?.context.skuLabels ?? skuLabels;
    const rows = changedRows(before, bv, labels, toMs, v.issuedCount, v);
    const touchesIssued = v.issuedCount > 0 && rows.some((row) => "note" in row);
    openActionConfirm({ briefKind: "config",
      action: `编辑代金券 · ${v.name}`,
      title: "编辑代金券",
      detail: `${v.name} · 改面值、门槛、适用商品、发给谁、有效期、领取入口或弹窗设置。${v.issuedCount > 0 ? "已发券的模板类型不可修改。" : "尚未发券，可修改类型。"}代金券不算平台负债，不受覆盖率限制。`,
      effect: <StatusTag tone="progress" filled>立即生效</StatusTag>,
      statedBrief: {
        impact: touchesIssued
          ? `保存后立即按新规则生效：已发出还没用的 ${countText(v.availableCount)} 张也按新规则使用，已用掉的 ${countText(v.redeemedCount)} 张和已完成的订单不变。`
          : "保存后立即按新规则生效，之后领券和用券都按新规则。",
        check: "核对每一项改前改后，理由写清依据或工单号。",
      },
      facts: (
        <div className="rd-stack">
          {rows.length === 1
            ? <Facts><Fact k="代金券">{v.name}</Fact><Fact k={rows[0].label}><Change from={rows[0].before} to={rows[0].after} /></Fact>
              {"note" in rows[0] && rows[0].note?.startsWith("改了日期") && <Fact k="怎么算">{rows[0].note.split("；")[0]}</Fact>}</Facts>
            : <><Facts><Fact k="代金券">{v.name}</Fact></Facts><DiffList rows={rows} emptyNote="没有改动的项；仍会保存一次并记下理由。" /></>}
          {v.issuedCount > 0 && <Facts>
            <Fact k="已发出">{`${countText(v.issuedCount)} 张`}</Fact>
            <Fact k="还没用">{`${countText(v.availableCount)} 张`}</Fact>
            <Fact k="已使用">{`${countText(v.redeemedCount)} 张`}</Fact>
          </Facts>}
        </div>
      ),
      confirmLabel: "确认保存",
      reasonPlaceholder: "例如：活动调整依据或工单号",
      initialReason: restored?.reason,
      getPendingReason: () => directRecord(v.id)?.reason,
      inlineApproval: directRecovery(v.id, restored, initialRecovery),
      run: (reason) => runDirect({ kind: "update", voucher: v, before, values: bv, skuLabels: labels }, parseVoucher(bv, v.id, v.version, v), reason),
    });
  };

  const openToggle = (v: OpsVoucher, restored?: H7DirectMutation, initialRecovery?: "lookup" | "retry") => {
    if (!restored && blockNew(v.id)) return;
    const next = v.status === "active" ? "paused" : "active";
    const label = next === "active" ? "投放" : "暂停";
    openActionConfirm({ briefKind: "content",
      action: `${label}代金券 · ${v.name}`,
      title: `${label}代金券`,
      detail: next === "paused"
        ? `${v.name} · 暂停后用户不能再领这张券；已领到的不收回，有效期内仍能用。`
        : `${v.name} · 投放后符合条件的用户可以领；还要符合有效期、发给谁、发行上限和领取入口。`,
      effect: <StatusTag tone="progress" filled>立即生效</StatusTag>,
      statedBrief: next === "paused"
        ? { impact: `用户不能再领这张券；已领到还没用的 ${countText(v.availableCount)} 张不收回，有效期内仍能用。`, check: "确认是停止新领取，不是收回已发的券。" }
        : { impact: "符合条件的用户可以领：还要在有效期内、符合发给谁、没到发行上限、从开放的入口领；不会自动发给任何人。", check: "确认有效期和发行上限，App 下次读取时才看到变化。" },
      facts: (
        <Facts>
          <Fact k="代金券">{v.name}</Fact>
          <Fact k="状态"><Change from={v.status === "active" ? "投放中" : "已暂停"} to={next === "active" ? "投放中" : "已暂停"} /></Fact>
          <Fact k="有效期" tone={next === "active" && voucherPhase(v, Date.now()) === "expired" ? "warn" : undefined}>{next === "active" && voucherPhase(v, Date.now()) === "expired"
            ? `${periodText(v)}，已过期：投放后用户仍领不到、用不了；要继续发，先编辑有效期` : periodText(v)}</Fact>
          <Fact k="还没用">{`${countText(v.availableCount)} 张`}</Fact>
        </Facts>
      ),
      confirmLabel: `确认${label}`,
      initialReason: restored?.reason,
      getPendingReason: () => directRecord(v.id)?.reason,
      inlineApproval: directRecovery(v.id, restored, initialRecovery),
      run: (reason) => runDirect({ kind: "status", voucher: v, skuLabels: restored?.context.skuLabels ?? skuLabels }, v, reason),
    });
  };

  const openDisposition = (input: H7VoucherApprovalInput, initialRecovery?: "lookup" | "retry") => {
    if (!session) return;
    const original = () => pendingH7VoucherApprovals(session.adminId)
      .find((record) => record.voucherId === input.voucherId);
    const pending = original();
    if (!pending && blockNew(input.voucherId)) return;
    input = pending ?? input;
    const run = async (reason: string, mode: H7VoucherApprovalMode = "submit") => {
      const wasRetained = !!original();
      if (useAdminAuth.getState().session?.adminId !== session.adminId) {
        throw new Error("登录账号已变化，请关闭弹窗后重新操作。");
      }
      try {
        if (!original() && mode === "submit") assertNew(input.voucherId);
        const lookup = submitH7VoucherApproval(session, input, reason, mode);
        syncPending();
        const ticket = await lookup;
        if (!ticket) return false;
        if (ticket.status === "pending") {
          toast(`已提交审批 · 审批单 ${ticket.id} · 等待${APPROVER}批准`);
        } else {
          toast(`已找到原审批单 ${ticket.id}，请在操作记录查看处理结果`);
        }
        await reload();
        return true;
      } catch (cause) {
        if (isHGrowthReadConflict(cause) || wasRetained && !original()) await reload();
        throw cause;
      } finally {
        syncPending();
      }
    };
    const deletion = input.op === "h7_voucher_delete";
    const v = input.voucher;
    const completionCopy = deletion
      ? `批准前券模板和已发出的券都不变。批准后券模板从列表消失、用户不能再领；已发出的券不收回，还没用的仍可按现有规则在有效期内使用。只想临时停发用「暂停」。`
      : `批准前什么都不变。批准时把这张券届时还没用的全部作废（含已过有效期还没用的）；已用掉的不变，券模板照常投放，之后还能继续发。`;
    openActionConfirm({
      briefKind: "record",
      action: `${H7_VOUCHER_ACTIONS[input.op]} · ${input.voucherName}`,
      title: H7_VOUCHER_ACTIONS[input.op],
      detail: completionCopy,
      effect: <><StatusTag tone="progress" filled explain={`${APPROVER}批准后才执行。`}>批准后生效</StatusTag><IrreversibleTag /></>,
      confirmTone: "danger",
      statedBrief: deletion
        ? { impact: "删除券模板：不作废、不收回已发出的券，也不退已经抵扣的金额。", check: "确认是要永久删除这张券的模板；页面上没有恢复入口。" }
        : { impact: "只作废还没用的券：不删除券模板、不暂停投放、不收回已经抵扣的金额。", check: "作废的张数以批准那一刻还没用的为准，不是现在这个数。" },
      facts: (
        <Facts>
          {deletion
            ? <Fact k="已发出" lead unit="张">{v ? countText(v.issuedCount) : "—"}</Fact>
            : <Fact k="现在还没用" lead unit="张">{v ? countText(v.availableCount) : "—"}</Fact>}
          <Fact k="代金券">{input.voucherName}</Fact>
          {v && (deletion ? <>
            <Fact k="还没用">{`${countText(v.availableCount)} 张，不收回`}</Fact>
            <Fact k="已使用">{`${countText(v.redeemedCount)} 张`}</Fact>
          </> : <Fact k="已使用">{`${countText(v.redeemedCount)} 张，不变`}</Fact>)}
          {v && <Fact k="券模板">{deletion ? <Change from={v.status === "active" ? "投放中" : "已暂停"} to="删除（批准后）" tone="danger" /> : `${v.status === "active" ? "投放中" : "已暂停"}，批准后不变`}</Fact>}
          <Fact k="谁来批">{`${APPROVER}，不能是提交人`}</Fact>
          <Fact k="需有权限">审批权限和代金券修改权限</Fact>
        </Facts>
      ),
      initialReason: pending?.reason,
      getPendingReason: () => original()?.reason,
      inlineApproval: {
        pending: !!pending,
        get expired() { const saved = original(); return !!saved && isRetryExpired(saved); },
        get disabledReason() {
          const saved = original();
          return !useAdminAuth.getState().session?.authorities.includes("growth_h7_write") || saved && !canRetryH7VoucherApproval(saved) ? "请查询原结果" : undefined;
        },
        initialRecovery: pending ? initialRecovery : undefined,
        resolve: () => ({
          heading: `${APPROVER}批准后才执行`,
          completionCopy,
        }),
        recover: () => run("", "lookup"),
        retry: async () => { await run("", "retry"); },
      },
      run: async (reason) => { await run(reason); },
    });
  };

  const disposeInput = (v: OpsVoucher, op: H7VoucherApprovalInput["op"]): H7VoucherApprovalInput => ({ op, voucherId: v.id, voucherName: v.name, expectedVersion: v.version, voucher: v });
  const auditHref = "/platform/audit?domain=H";
  const canAudit = reach("/platform/audit");

  const openDirectRecovery = (record: H7DirectMutation, mode: "lookup" | "retry" = "retry") => {
    const c = record.context;
    if (c.kind === "create") reviewAdd(c.values, record, mode);
    else if (c.kind === "update") reviewEdit(c.voucher, c.before, c.values, record, mode);
    else openToggle(c.voucher, record, mode);
  };
  // 每条原操作改了什么：普通写用保存的原确认内容，处置写处置后的样子。
  const directChange = (record: H7DirectMutation) => {
    const c = record.context;
    if (c.kind === "status") return <Change from={c.voucher.status === "active" ? "投放中" : "已暂停"} to={c.voucher.status === "active" ? "已暂停" : "投放中"} />;
    if (c.kind === "create") return voucherSentence(parseVoucher(c.values, record.voucherId), c.skuLabels);
    const rows = changedRows(c.before, c.values, c.skuLabels, toMs, c.voucher.issuedCount, c.voucher);
    if (rows.length === 0) return "没有改动的项";
    return <>{rows.slice(0, 2).map((row, i) => <span key={row.key}>{i > 0 && "；"}{row.label} <Change from={row.before} to={row.after} /></span>)}{rows.length > 2 && `；另 ${rows.length - 2} 项`}</>;
  };
  const releasable = (record: (typeof pendingApprovals)[number]) => isRetryExpired(record) && !record.acknowledged && !record.ticket;
  const recoveryRows: H7RecoveryRow[] = [
    ...pendingApprovals.map((record) => {
      const expired = isRetryExpired(record);
      return {
        key: record.commandKey,
        name: H7_VOUCHER_ACTIONS[record.op],
        object: `「${record.voucherName}」`,
        change: record.op === "h7_voucher_delete" ? "删除券模板，已发出的券不收回"
          : `作废还没用的券${record.voucher ? `（提交时 ${countText(record.voucher.availableCount)} 张）` : ""}`,
        submittedAt: record.createdAt,
        tag: record.ticket ? pendingTag() : record.acknowledged ? acknowledgedTag() : expired ? expiredTag("approval") : unknownTag("approval"),
        ticket: record.ticket?.id,
        actions: <>
          <Button size="sm" onClick={() => openDisposition(record, "lookup")}>查询原结果</Button>
          {!expired && !record.ticket && !record.acknowledged && <Button size="sm" disabledReason={!canWrite || !canRetryH7VoucherApproval(record) ? "请查询原结果" : undefined} onClick={() => openDisposition(record, "retry")}>按原请求重试</Button>}
          {releasable(record) && <Button size="sm" variant="ghost" onClick={() => setReleasing(record)}>查无此单时解除</Button>}
        </>,
      };
    }),
    ...directUnknown.map((record) => ({ key: record.commandKey, name: record.action, object: `「${record.voucherName}」`, change: directChange(record), submittedAt: record.createdAt,
      tag: isRetryExpired(record) ? expiredTag("direct") : unknownTag("direct"), actions: <>
        <Button size="sm" onClick={() => openDirectRecovery(record, "lookup")}>查询原结果</Button>
        {!isRetryExpired(record) && <Button size="sm" disabledReason={!canWrite ? "请查询原结果" : undefined} onClick={() => openDirectRecovery(record)}>按原请求重试</Button>}
      </> })),
  ];
  const pendingCount = pendingApprovals.filter(r => r.ticket).length;
  const builtCount = pendingApprovals.filter(r => !r.ticket && r.acknowledged).length;
  const unknownCount = recoveryRows.length - pendingCount - builtCount;
  const releaseModal = releasing && session && <ReleaseModal label={<>{H7_VOUCHER_ACTIONS[releasing.op]} · 「{releasing.voucherName}」</>}
    explain={<><p>原申请已超过 24 小时，不会再重发。</p><p>确认时先按原申请再查一次：明确查不到这张审批单才解除，说明申请没建成；查到了就按它现在的状态显示，不解除。</p></>}
    onCancel={() => setReleasing(null)} onConfirm={() => {
      const record = releasing;
      setReleasing(null);
      void releaseExpiredH7VoucherApproval(session, record)
        .then(() => { toast("已解除这条记录，可以重新提交。"); return reload(true); })
        .catch(cause => toast(displayAdminError(cause)))
        .finally(syncPending);
    }} />;
  const recovery = (
    <H7RecoveryNotice title={[unknownCount && `${unknownCount} 个操作结果未知`, pendingCount && `${pendingCount} 个申请在等批准`, builtCount && `${builtCount} 个申请没查到进度`].filter(Boolean).join("；")} rows={recoveryRows}
      explain={<>
        <p>原操作（哪张券、做了什么、理由）保存在这个浏览器标签页里。</p>
        <p>结果未知：提交时没收到确定结果。没过 24 小时可以「按原请求重试」，不会重复执行或建第二张审批单；过了 24 小时只能查询。</p>
        <p>新增、编辑、暂停、投放的「查询原结果」只是重读现在的券，证明不了原操作成没成。删除和作废查的是原审批单。</p>
        <p>结果确认之前，这张券不能再改。</p>
      </>}
      link={canAudit ? <Link className="rd-link" href={auditHref} prefetch={false}>到操作记录与审批核对</Link> : undefined} />
  );

  const header = (
    <PageHeader
      pageId="H7"
      title="代金券"
      summary="看券的投放和使用，新增、编辑、暂停或投放。"
      meta={readAt ? <span className="rd-toolbar">
        <span>{`${businessClock(readAt)} 读取（${businessZone().label}）· 打开时读取`}</span>
        <Button variant="ghost" size="sm" loading={loading} icon={<RefreshCw size={14} aria-hidden />} onClick={() => void reload()}>刷新</Button>
      </span> : undefined}
      actions={canWrite ? <Button variant="primary" icon={<Plus size={14} aria-hidden />} disabledReason={error ? "读取失败，读到最新数据后才能新增" : loading || !fresh.current ? "正在读取" : undefined} onClick={openAdd}>新增代金券</Button> : undefined}
      readOnly={!canWrite ? "你只能查看；新增、编辑和处置代金券要有这页的修改权限。" : undefined}
    />
  );

  // 填写抽屉在两种状态里都渲染（同一个 key）：旧操作收尾后的重读失败时不卸掉，提示没读到、读到前不能进下一步。
  const formDrawer = form && <H7VoucherForm key={form.key} voucher={form.voucher} initial={form.initial} latest={form.before} skuOptions={skuOptions} skuLabels={skuLabels} toMs={toMs}
    readFailed={error ? { retrying: loading, onRetry: () => void reload(true) } : undefined}
    onClose={closeForm}
    onReview={(bv) => (form.voucher ? reviewEdit(form.voucher, form.before ?? form.initial, bv) : reviewAdd(bv))} />;

  if (loading && !readAt) return <div className="h7-page">{header}{recovery}{releaseModal}<BlockState state="loading" title="代金券读取中…" /></div>;
  if (error) return (
    <div className="h7-page">
      {header}
      {recovery}
      {releaseModal}
      <BlockState state="error" title="代金券读取失败" detail={`${error} · 为避免误操作，读到之前不能新增、编辑和处置。`} onRetry={() => void reload()} />
      {formDrawer}
    </div>
  );

  const now = Date.now();
  const expiredActive = list.filter((v) => v.status === "active" && voucherPhase(v, now) === "expired");
  const fullActive = list.filter((v) => v.status === "active" && voucherPhase(v, now) !== "expired" && limitReached(v));
  const shown = list.filter((v) => filter === "all" || v.status === filter);
  const detail = detailId ? list.find((v) => v.id === detailId) ?? null : null;
  const detailIndex = detail ? shown.findIndex((v) => v.id === detail.id) : -1;
  const serverPendingOf = (id: string) => list.find(v => v.id === id)?.pendingApproval;

  const rowActions = (v: OpsVoucher, size: "sm" | "md" = "sm") => canWrite && <>
    <Button size={size} icon={<Pencil size={14} aria-hidden />} disabledReason={blockNew(v.id)} onClick={() => openEdit(v)}>编辑</Button>
    <Button size={size} icon={v.status === "active" ? <Pause size={14} aria-hidden /> : <Play size={14} aria-hidden />} aria-label={`${v.status === "active" ? "暂停" : "投放"} ${v.name}`} disabledReason={blockNew(v.id)} onClick={() => openToggle(v)}>{v.status === "active" ? "暂停" : "投放"}</Button>
  </>;

  const conclusion = list.length === 0
    ? <Conclusion state="neutral" icon={Ticket} hint={canWrite ? "点右上角「新增代金券」建第一张。" : undefined}>还没有代金券</Conclusion>
    : <Conclusion state={expiredActive.length || fullActive.length || unknownCount ? "warn" : "ok"}
      explain={<>
        <p>投放中只看券的状态，不核对有效期、发给谁、发行上限和用户是否已领，不是「现在有多少人能领」。</p>
        <p>发出和使用是这页现有券的合计，按领取记录数算（不是人数）；删掉的券不再计入。</p>
        <p>有删除或作废在等批准的券，卡上标「待审批」，不论是谁提交的；审批结束前这张券不能再改。</p>
      </>}
      action={canAudit ? <Link className="rd-link" href={auditHref} prefetch={false}>看待批准的申请</Link> : undefined}>
      {`${countText(activeN)} 张券在投放，共发出 ${countText(issuedSum)} 张，已用 ${countText(redeemedSum)} 张`}
      {expiredActive.length > 0 && `；${expiredActive.length} 张已过有效期但还是投放中，可以暂停`}
      {fullActive.length > 0 && `；${fullActive.length} 张已发完，用户领不到`}
      {unknownCount > 0 && `；${unknownCount} 个操作结果未知`}
    </Conclusion>;

  return (
    <div className="h7-page">
      {header}
      {recovery}
      {releaseModal}
      {conclusion}

      <StatBand label="代金券概况">
        <Stat tone="role-4" icon={TicketCheck} label="投放中" value={countText(activeN)} unit="张" sub={`共 ${countText(total)} 张 · 已暂停 ${countText(pausedN)} 张`}
          explain="只看券的状态。已过有效期但没暂停的也算在内；用户能不能领还要看有效期、发给谁、发行上限和领取入口。" />
        <Stat tone="role-2" icon={Send} label="已发出" value={countText(issuedSum)} unit="张" sub={`未使用 ${countText(availableSum)} 张`}
          explain="这页现有券的领取记录合计，不是人数；删掉的券不再计入。未使用包括已过有效期还没用的。" />
        <Stat tone="role-2" icon={ReceiptText} label="已使用" value={countText(redeemedSum)} unit="张" sub={`已作废 ${countText(revokedSum)} 张`}
          explain="下单时用掉的张数，一张只能用一次（目前整张核销）。作废的是批准作废时还没用的券。" />
        <Stat tone="role-other" icon={BellOff} label="参与首页弹窗" value={countText(popupN)} unit="张" sub="App 目前不自动弹出"
          explain="投放中、参与首页弹窗、节奏开关也开着的券。App 现在不会自动弹出代金券，这个数只说明设置，不代表用户看到了弹窗。" />
      </StatBand>

      <Panel title="代金券" icon={Ticket} tone="role-4" data-proof="h7-voucher-config"
        sub={`${shown.length} 张 · 时间为${H7_TIME_ZONE.label}`}
        explain="每张卡是一张券的模板：左边是券面，右边是谁能用、什么时候能用，下面是已发出的券用了多少。点「详情」看全部设置；删除和作废在详情里。"
        >
        <FilterBar scope={<Segments label="按状态筛选" value={filter} onChange={setFilter} items={[
          { value: "all", label: "全部", count: list.length },
          { value: "active", label: "投放中", count: list.filter((v) => v.status === "active").length },
          { value: "paused", label: "已暂停", count: list.filter((v) => v.status === "paused").length },
        ]} />} sort={<Segments label="显示方式" value={view} onChange={setView} items={[
          { value: "cards", label: <><LayoutGrid size={14} aria-hidden /> 卡片</> },
          { value: "table", label: <><List size={14} aria-hidden /> 列表</> },
        ]} />} />
        {shown.length === 0
          ? <BlockState state="empty" title={list.length === 0 ? "新增的代金券会显示在这里" : "这个状态下没有代金券"} detail={list.length === 0 ? (canWrite ? undefined : "有修改权限的同事新增后会显示在这里。") : "换一个状态看看。"} />
          : view === "cards"
            ? <div className="h7-cards">
              {shown.map((v) => <VoucherCard key={v.id} v={v} now={now} skuLabels={skuLabels} selected={v.id === detailId} onOpen={() => setDetailId(v.id)} actions={rowActions(v)} />)}
            </div>
            : <Table label="代金券列表" className="h7-table">
              <thead>
                <tr>
                  <Th>代金券</Th>
                  <Th>状态</Th>
                  <Th>适用</Th>
                  <Th>有效期</Th>
                  <Th align="right">已使用 / 已发出</Th>
                  {canWrite && <Th sticky="end">操作</Th>}
                </tr>
              </thead>
              <tbody>
                {shown.map((v) => (
                  <Tr key={v.id} selected={v.id === detailId} onOpen={() => setDetailId(v.id)}>
                    <Td grow><Cell main={v.name} title={v.name} sub={`${faceValue(v).value}${faceValue(v).unit ? ` ${faceValue(v).unit}` : ""} · ${conditionLines(v).join(" · ")}`} /></Td>
                    <Td><VoucherTags v={v} now={now} /></Td>
                    <Td><Cell main={skuText(v.applicableSkus, skuLabels)} sub={AUDIENCE_LABEL[v.audience]} /></Td>
                    <Td><Cell main={periodText(v)} /></Td>
                    <Td align="right"><span className="h7-table-usage">
                      <Cell num main={`${countText(v.redeemedCount)} / ${countText(v.issuedCount)}`} sub={v.issuanceLimit > 0 ? `上限 ${countText(v.issuanceLimit)}` : "不限量"} />
                      {v.issuedCount > 0 ? <RatioBar compact quiet label="已使用占已发出" value={v.redeemedCount} total={v.issuedCount} valueText={`已使用 ${v.redeemedCount}，已发出 ${v.issuedCount}`} /> : <span aria-hidden />}
                    </span></Td>
                    {canWrite && <Td sticky="end"><span className="rd-row-actions">{rowActions(v)}</span></Td>}
                  </Tr>
                ))}
                {shown.length === 0 && <TableMessage columns={canWrite ? 6 : 5}>没有代金券</TableMessage>}
              </tbody>
            </Table>}
      </Panel>

      <Drawer open={!!detail} onClose={() => setDetailId(null)} title="代金券详情" icon={Ticket} tone="role-4"
        sub={detail?.name}
        nav={{ hasPrev: detailIndex > 0, hasNext: detailIndex >= 0 && detailIndex < shown.length - 1, onPrev: () => setDetailId(shown[detailIndex - 1].id), onNext: () => setDetailId(shown[detailIndex + 1].id) }}
        footer={detail && canWrite ? <Decision others={rowActions(detail, "md")} /> : undefined}>
        {detail && (() => {
          const v = detail;
          const serverPending = serverPendingOf(v.id);
          const disposeBlock = blockNew(v.id);
          return <>
            <div className="h7-detail-ticket">
              <VoucherFace v={v} size="large" />
              <div className="h7-detail-head">
                <VoucherTags v={v} now={now} showPending={false} />
                <p className="h7-preview-sentence">{voucherSentence(v, skuLabels)}</p>
              </div>
            </div>
            {serverPending && <Notice tone="warn" title={serverPending.action ? `${serverPending.action}在等批准` : "这张券有一张没结束的审批"}>
              {`${pendingFacts(serverPending) ?? "没读出是哪张单、谁提交的，到「操作记录与审批」核对"}。审批结束前不能编辑、暂停、投放、删除或作废。`}
            </Notice>}
            <section className="h7-detail-block" aria-label="使用情况">
              <h3 className="h7-form-title">使用情况</h3>
              <UsageBar v={v} />
              <Facts>
                <Fact k="未使用">{`${countText(v.availableCount)} 张（含已过有效期还没用的）`}</Fact>
                <Fact k="已作废">{`${countText(v.revokedCount)} 张`}</Fact>
                <Fact k="发放批次">{v.batchCount === 0 ? "—" : `${countText(v.batchCount)} 批`}</Fact>
              </Facts>
            </section>
            <section className="h7-detail-block" aria-label="规则">
              <h3 className="h7-form-title">规则</h3>
              <Facts>
                <Fact k="类型">{faceValue(v).kind}</Fact>
                <Fact k={v.type === "fixed" ? "面额" : "减百分之几"}>{v.type === "fixed" ? `${amountText(v.amountUSD)} ${UNIT}` : `${v.percent ?? "—"}%（App 显示「${v.percent ?? "—"}% 折扣」）`}</Fact>
                <Fact k="使用门槛">{(v.minPurchaseUSD ?? 0) > 0 ? `满 ${amountText(v.minPurchaseUSD)} ${UNIT}` : "无门槛"}</Fact>
                <Fact k="最多减">{(v.maxDiscountUSD ?? 0) > 0 ? `${amountText(v.maxDiscountUSD)} ${UNIT}` : "不封顶"}</Fact>
                <Fact k="适用商品">{v.applicableSkus.length ? v.applicableSkus.map((id) => skuLabels[id] ?? `已不在当前目录（${id}）`).join("、") : "全部商品"}</Fact>
                <Fact k="发给谁">{AUDIENCE_LABEL[v.audience]}</Fact>
                <Fact k="领取入口">{surfacesText(v.claimSurfaces)}</Fact>
                <Fact k="开始">{startDetailText(v.startAt)}</Fact>
                <Fact k="结束">{endDetailText(v.endAt)}</Fact>
                <Fact k="发行上限">{v.issuanceLimit === 0 ? "不限量" : `${countText(v.issuanceLimit)} 张`}</Fact>
              </Facts>
            </section>
            <Fold title="首页弹窗" icon={BellOff} tone="role-other" inset summary={`App 目前不自动弹出 · ${v.popupEnabled ? "参与" : "不参与"}`}>
              <Facts>
                <Fact k="参与首页弹窗">{v.popupEnabled ? "是" : "否"}</Fact>
                <Fact k="弹窗节奏开关">{v.popupCadenceEnabled ? "开" : "关"}</Fact>
                <Fact k="进入后多久弹出">{`${countText(v.popupDelayMs)} 毫秒`}</Fact>
                <Fact k="再次弹出间隔">{`${countText(v.popupCooldownHours)} 小时`}</Fact>
                <Fact k="单次打开最多弹出">{`${v.popupMaxPerSession} 次`}</Fact>
              </Facts>
            </Fold>
            <Fold title="叠加与拆分" tone="role-other" inset summary={[v.splittable && "可拆分", v.stackWithTrial && "可与试用收益叠加", v.stackWithOthers && "可与其它优惠叠加"].filter(Boolean).join("、") || "都不允许"}>
              <Facts>
                <Fact k="可拆分">{v.splittable ? "是（目前整张核销，不会分次使用）" : "否"}</Fact>
                <Fact k="可与试用收益叠加">{v.stackWithTrial ? "是（试用转购目前用不了代金券，暂不起作用）" : "否"}</Fact>
                <Fact k="可与其它优惠叠加">{v.stackWithOthers ? "是" : "否"}</Fact>
              </Facts>
            </Fold>
            <Fold title="技术信息" tone="role-other" inset summary={`版本 ${v.version}`}>
              <Facts>
                <Fact k="编号"><span data-mono="">{v.id}</span></Fact>
                <Fact k="版本">{String(v.version)}</Fact>
              </Facts>
            </Fold>
            {canWrite && <section className="h7-dispose" aria-label="删除和作废">
              <h3 className="h7-form-title">删除和作废<Explain label="删除和作废有什么不同" content={<>
                <p>作废未使用的券：只把还没用的券作废，券模板照常投放。</p>
                <p>删除代金券：删掉券模板，已发出的券不收回、还能用。</p>
                <p>两样都要{APPROVER}批准后才执行；只想停发用「暂停」。</p>
              </>} /></h3>
              <div className="h7-dispose-item">
                <div>
                  <b>作废未使用的券</b>
                  <p>{v.availableCount > 0 ? `把还没用的 ${countText(v.availableCount)} 张作废；已用的不变，券照常投放。` : "现在没有还没用的券，不需要作废。"}</p>
                </div>
                {v.availableCount > 0 ? <Button variant="danger-outline" icon={<Ban size={14} aria-hidden />} aria-label={`作废未使用的代金券 · ${v.name}`} disabledReason={disposeBlock} onClick={() => openDisposition(disposeInput(v, "h7_voucher_revoke_available"))}>作废未使用的券</Button> : null}
              </div>
              <div className="h7-dispose-item">
                <div>
                  <b>删除代金券</b>
                  <p>{`删掉这张券的模板，不能再领；已发出的 ${countText(v.issuedCount)} 张不收回。`}</p>
                </div>
                <Button variant="danger-outline" icon={<Trash2 size={14} aria-hidden />} aria-label={`删除代金券 · ${v.name}`} disabledReason={disposeBlock} onClick={() => openDisposition(disposeInput(v, "h7_voucher_delete"))}>删除代金券</Button>
              </div>
            </section>}
          </>;
        })()}
      </Drawer>

      {formDrawer}
    </div>
  );
}

export default H7VoucherConfig;

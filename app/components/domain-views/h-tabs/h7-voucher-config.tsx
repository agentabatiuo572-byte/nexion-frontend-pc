"use client";

/**
 * H7 代金券 — 运营管代金券模板：看有哪些券在投放、各发出多少、用了多少、作废多少；
 * 新增、编辑满减券或折扣券，暂停或投放（直接生效）；删除券模板、作废这张券下所有还没用的券（提交审批，另一位管理员批准后执行）。
 *
 * 真写后端 growth/vouchers 接口。新增、编辑先在页面自己的填写抽屉里填，再进共用确认框写理由；
 * 提交内容仍由 parseVoucher 从同一套表单值生成，请求和改版前一样。删除和作废走 A2，原提案的保存和恢复沿用 h7-voucher-approval。
 * 代金券是促销折扣、非 NEX 负债 → 不挂 amplifies / B1 红线(与 H2 试用折扣同口径)。
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { Ban, BellOff, LayoutGrid, List, Pencil, Play, Pause, Plus, ReceiptText, RefreshCw, Send, Ticket, TicketCheck, Trash2 } from "lucide-react";
import {
  BlockState, Button, Cell, Change, Conclusion, Decision, DiffList, Drawer, Explain, Fact, Facts, Fold, IrreversibleTag, Notice,
  PageHeader, Panel, RatioBar, Segments, Stat, StatBand, StatusTag, Table, TableMessage, Td, Th, Tr,
} from "@/app/components/rd";
import {
  createH7Voucher,
  fetchH7Vouchers,
  updateH7Voucher,
  updateH7VoucherStatus,
} from "@/lib/admin/h-client";
import {
  H7_VOUCHER_ACTIONS,
  pendingH7VoucherApprovals,
  submitH7VoucherApproval,
  type H7VoucherApprovalInput,
  type H7VoucherApprovalMode,
} from "@/lib/admin/h7-voucher-approval";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { businessClock, businessZone } from "@/lib/admin/business-time";
import { useReach } from "@/lib/nav/use-reach";
import type { HCtx } from "./types";
import { displayAdminError } from "@/lib/admin/error-messages";
import {
  AUDIENCE_LABEL, H7RecoveryNotice, UNIT, UsageBar, VoucherCard, VoucherFace, VoucherTags, amountText, conditionLines, countText, endText, expiredTag,
  faceValue, limitReached, periodText, skuText, startText, surfacesText, unknownTag, voucherPhase, voucherSentence, type H7RecoveryRow, type H7Voucher,
} from "./h7-voucher-parts";
import { H7VoucherForm, changedRows, initialForm, type H7FormValue } from "./h7-voucher-form";

type OpsSku = {
  id?: string;
  name: string;
  status?: string;
};

type OpsVoucher = H7Voucher;

// UTC getters — stored ms are UTC midnights (seed uses Date.UTC; toMs parses
// date-only strings as UTC per ES spec), so the round-trip stays TZ-stable
// (a negative-offset operator would otherwise see the date drift one day).
function toDateInput(ms: number): string {
  if (!ms) return "";
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
function toMs(date: string): number {
  if (!date) return 0;
  const ms = Date.parse(date);
  return Number.isFinite(ms) ? ms : 0;
}

/** businessValue → OpsVoucher(逗号串拆 SKU/入口 · 日期转 ms · 数值清洗)。 */
function parseVoucher(bv: Record<string, string>, id: string, version = 1): OpsVoucher {
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
    startAt: toMs(bv.startDate),
    endAt: toMs(bv.endDate),
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

function parseServerVoucher(raw: unknown): OpsVoucher {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("H7_VOUCHER_RESPONSE_INVALID");
  const row = raw as Record<string, unknown>;
  const number = (key: string) => {
    const value = Number(row[key]);
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`H7_VOUCHER_RESPONSE_INVALID:${key}`);
    return value;
  };
  const cadenceNumber = (key: string, min: number, max: number) => {
    const value = number(key);
    if (value < min || value > max) throw new Error(`H7_VOUCHER_CADENCE_INVALID:${key}`);
    return value;
  };
  const status = row.status === "active" || row.status === "paused" ? row.status : null;
  if (typeof row.id !== "string" || !row.id.trim()
      || typeof row.name !== "string" || !row.name.trim()
      || (row.type !== "fixed" && row.type !== "percent")
      || !Array.isArray(row.applicableSkus)
      || !Array.isArray(row.claimSurfaces)
      || (row.audience !== "new" && row.audience !== "all")
      || !status) {
    throw new Error("H7_VOUCHER_RESPONSE_INVALID");
  }
  return {
    ...(row as unknown as OpsVoucher),
    id: row.id.trim(),
    name: row.name.trim(),
    type: row.type,
    applicableSkus: row.applicableSkus.map(String),
    claimSurfaces: row.claimSurfaces.map(String),
    audience: row.audience,
    status,
    startAt: number("startAt"),
    endAt: number("endAt"),
    issuanceLimit: number("issuanceLimit"),
    version: number("version"),
    issuedCount: number("issuedCount"),
    availableCount: number("availableCount"),
    redeemedCount: number("redeemedCount"),
    revokedCount: number("revokedCount"),
    batchCount: number("batchCount"),
    popupDelayMs: cadenceNumber("popupDelayMs", 0, 60000),
    popupCooldownHours: cadenceNumber("popupCooldownHours", 0, 720),
    popupMaxPerSession: cadenceNumber("popupMaxPerSession", 1, 10),
    popupCadenceEnabled: row.popupCadenceEnabled !== false,
  };
}

/** 谁来批：后端要另一位有效管理员，有审批权限和代金券修改权限，不限超级管理员。 */
const APPROVER = "另一位管理员";
const APPROVER_NEED = "需有审批权限和代金券修改权限，不能是提交人自己";
const LOCAL_PENDING = "这张券有结果未知的删除或作废申请，先处理页面上方的提醒";

/**
 * 界面已备好、等代码 worker 接逻辑的两类状态（见重构说明「五、弹窗的排法」）：
 * - 普通写（新增、编辑、暂停、投放）结果未知后的本机原记录：现在不保存（F01），这里恒为空；
 * - 本人提交后仍在等批准的删除、作废申请（服务端对象锁 H/voucher/{id}）：列表接口不返回，这里恒为空（X02）。
 * 接上后按同一个提醒列表和券卡上的「待审批」标签显示，不另画。
 */
type DirectUnknown = { key: string; action: string; voucherName: string; submittedAt: number; expired: boolean };
type ServerPending = { voucherId: string; op: keyof typeof H7_VOUCHER_ACTIONS; ticketId: string; submittedAt?: number };
const DIRECT_UNKNOWN: DirectUnknown[] = [];
const SERVER_PENDING: ServerPending[] = [];

type Filter = "all" | "active" | "paused";
type View = "cards" | "table";
type FormState = { voucher?: OpsVoucher; initial: H7FormValue; key: number };

export function H7VoucherConfig({ ctx }: { ctx: HCtx }) {
  const { toast, openActionConfirm } = ctx;
  const canWrite = ctx.can("growth_h7_write");
  const session = useAdminAuth((state) => state.session);
  const adminId = session?.adminId;
  const reach = useReach();
  const [pendingApprovals, setPendingApprovals] = useState<ReturnType<typeof pendingH7VoucherApprovals>>([]);
  const [data, setData] = useState<{ vouchers: OpsVoucher[]; skus: OpsSku[]; stats?: Record<string, number> }>({
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

  useEffect(() => {
    setPendingApprovals(adminId === undefined ? [] : pendingH7VoucherApprovals(adminId));
  }, [adminId]);

  const applyResponse = (payload: Record<string, any>) => {
    if (!Array.isArray(payload.vouchers) || !Array.isArray(payload.skus)) {
      throw new Error("H7_VOUCHER_RESPONSE_INVALID");
    }
    setData({
      vouchers: payload.vouchers.map(parseServerVoucher),
      skus: payload.skus,
      stats: payload.stats ?? undefined,
    });
    setReadAt(Date.now());
  };

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchH7Vouchers()
      .then((payload) => {
        if (!alive) return;
        applyResponse(payload);
        setError(null);
      })
      .catch((err) => {
        if (!alive) return;
        setError(displayAdminError(err));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => { alive = false; };
  }, []);

  const reload = async () => {
    setLoading(true);
    try {
      applyResponse(await fetchH7Vouchers());
      setError(null);
    } catch (err) {
      setError(displayAdminError(err));
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

  const openAdd = () => setForm({ initial: initialForm(), key: Date.now() });
  const openEdit = (v: OpsVoucher) => setForm({ voucher: v, initial: initialForm(v, toDateInput), key: Date.now() });

  /** 新增：填写抽屉的「下一步」进确认框；提交内容和改版前一样由 parseVoucher 生成。 */
  const reviewAdd = (bv: H7FormValue) => {
    const preview = parseVoucher(bv, "preview");
    openActionConfirm({ briefKind: "config",
      action: "新增代金券",
      title: `新增代金券 · ${bv.name.trim()}`,
      detail: "新增一张代金券模板：满减或折扣、使用门槛、适用商品、发给谁、有效期和领取入口。只是券的规则，不给任何人发券；代金券只抵扣订单金额，不增加平台应付款。",
      effect: <StatusTag tone="progress" filled>立即生效</StatusTag>,
      statedBrief: {
        impact: preview.status === "active" ? "保存后就是投放中，符合条件的用户可以领；不会自动发给任何人。" : "保存后是已暂停，用户还领不到；之后点「投放」才开始。",
        check: "核对券面、门槛、适用商品、发给谁和有效期，理由写清依据或工单号。",
      },
      facts: (
        <Facts>
          <Fact k="券面" lead={preview.type === "fixed"} unit={preview.type === "fixed" ? UNIT : undefined}>{preview.type === "fixed" ? amountText(preview.amountUSD) : faceValue(preview).value}</Fact>
          <Fact k="怎么用">{voucherSentence(preview, skuLabels)}</Fact>
          <Fact k="领取入口">{surfacesText(preview.claimSurfaces)}</Fact>
          <Fact k="发行上限">{preview.issuanceLimit === 0 ? "不限量" : `${countText(preview.issuanceLimit)} 张`}</Fact>
          <Fact k="保存后">{preview.status === "active" ? "投放中" : "已暂停"}</Fact>
        </Facts>
      ),
      confirmLabel: "确认新增",
      reasonPlaceholder: "例如：活动方案或工单号",
      run: async (reason) => {
        const id = `vc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        const next = parseVoucher(bv, id);
        applyResponse(await createH7Voucher(next, reason));
        toast(`代金券「${next.name}」已新增`);
        closeForm();
      },
    });
  };

  /** 编辑：确认框只列改了的项；提交内容和改版前一样（原 id、原版本）。 */
  const reviewEdit = (v: OpsVoucher, before: H7FormValue, bv: H7FormValue) => {
    const rows = changedRows(before, bv, skuLabels, toMs, v.issuedCount);
    const touchesIssued = v.issuedCount > 0 && rows.some((row) => "note" in row);
    openActionConfirm({ briefKind: "config",
      action: `编辑代金券 · ${v.name}`,
      title: `编辑代金券 · ${v.name}`,
      detail: `${v.name} · 改面值、门槛、适用商品、发给谁、有效期、领取入口或弹窗设置。${v.issuedCount > 0 ? "已发券的模板类型不可修改。" : "尚未发券，可修改类型。"}代金券不算平台负债，不受覆盖率限制。`,
      effect: <StatusTag tone="progress" filled>立即生效</StatusTag>,
      statedBrief: {
        impact: touchesIssued
          ? `保存后立即按新规则生效：已发出还没用的 ${countText(v.availableCount)} 张也按新规则使用，已用掉的 ${countText(v.redeemedCount)} 张和已完成的订单不变。`
          : "保存后立即按新规则生效，之后领券和用券都按新规则。",
        check: "核对每一项改前改后，理由写清依据或工单号。",
      },
      facts: (
        <>
          <DiffList rows={rows} emptyNote="没有改动的项；仍会保存一次并记下理由。" />
          {v.issuedCount > 0 && <Facts>
            <Fact k="已发出">{`${countText(v.issuedCount)} 张 · 未使用 ${countText(v.availableCount)} · 已使用 ${countText(v.redeemedCount)}`}</Fact>
          </Facts>}
        </>
      ),
      confirmLabel: "确认保存",
      reasonPlaceholder: "例如：活动调整依据或工单号",
      run: async (reason) => {
        const next = parseVoucher(bv, v.id, v.version);
        applyResponse(await updateH7Voucher(v.id, next, reason, v.version));
        toast(`代金券「${next.name}」已更新`);
        closeForm();
      },
    });
  };

  const openToggle = (v: OpsVoucher) => {
    const next = v.status === "active" ? "paused" : "active";
    const label = next === "active" ? "投放" : "暂停";
    openActionConfirm({ briefKind: "content",
      action: `${label}代金券 · ${v.name}`,
      title: `${label}代金券 · ${v.name}`,
      detail: next === "paused"
        ? `${v.name} · 暂停后用户不能再领这张券；已领到的不收回，有效期内仍能用。`
        : `${v.name} · 投放后符合条件的用户可以领；还要符合有效期、发给谁、发行上限和领取入口。`,
      effect: <StatusTag tone="progress" filled>立即生效</StatusTag>,
      statedBrief: next === "paused"
        ? { impact: `用户不能再领这张券；已领到还没用的 ${countText(v.availableCount)} 张不收回，有效期内仍能用。`, check: "确认是停止新领取，不是收回已发的券。" }
        : { impact: "符合条件的用户可以领：还要在有效期内、符合发给谁、没到发行上限、从开放的入口领；不会自动发给任何人。", check: "确认有效期和发行上限，App 下次读取时才看到变化。" },
      facts: (
        <Facts>
          <Fact k="状态"><Change from={v.status === "active" ? "投放中" : "已暂停"} to={next === "active" ? "投放中" : "已暂停"} /></Fact>
          <Fact k="有效期">{periodText(v)}</Fact>
          <Fact k="已发出">{`${countText(v.issuedCount)} 张 · 未使用 ${countText(v.availableCount)}`}</Fact>
        </Facts>
      ),
      confirmLabel: `确认${label}`,
      run: async (reason) => {
        applyResponse(await updateH7VoucherStatus(v.id, next, reason, v.version));
        toast(`${v.name} 已${label}`);
      },
    });
  };

  const openDisposition = (input: H7VoucherApprovalInput, initialRecovery?: "lookup" | "retry") => {
    if (!session || !canWrite) return;
    const original = () => pendingH7VoucherApprovals(session.adminId)
      .find((record) => record.voucherId === input.voucherId);
    const pending = original();
    const run = async (reason: string, mode: H7VoucherApprovalMode = "submit") => {
      if (useAdminAuth.getState().session?.adminId !== session.adminId) {
        throw new Error("登录账号已变化，请关闭弹窗后重新操作。");
      }
      try {
        const ticket = await submitH7VoucherApproval(session, input, reason, mode);
        if (!ticket) return false;
        if (ticket.status === "pending") {
          toast(`已提交审批 · 审批单 ${ticket.id} · 等待${APPROVER}批准`);
        } else {
          toast(`已找到原审批单 ${ticket.id}，请在操作记录查看处理结果`);
          if (ticket.status === "approved") void reload();
        }
        openActionConfirm(null);
        return true;
      } finally {
        setPendingApprovals(pendingH7VoucherApprovals(session.adminId));
      }
    };
    const deletion = input.op === "h7_voucher_delete";
    const v = list.find((item) => item.id === input.voucherId);
    const completionCopy = deletion
      ? `批准前券模板和已发出的券都不变。批准后券模板从列表消失、用户不能再领；已发出的券不收回，还没用的仍可按现有规则在有效期内使用。只想临时停发用「暂停」。`
      : `批准前什么都不变。批准时把这张券届时还没用的全部作废（含已过有效期还没用的）；已用掉的不变，券模板照常投放，之后还能继续发。`;
    openActionConfirm({
      briefKind: "record",
      action: `${H7_VOUCHER_ACTIONS[input.op]} · ${input.voucherName}`,
      title: `${H7_VOUCHER_ACTIONS[input.op]} · ${input.voucherName}`,
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
          {v && <Fact k="其中">{deletion
            ? `未使用 ${countText(v.availableCount)} · 已使用 ${countText(v.redeemedCount)} · 已作废 ${countText(v.revokedCount)}`
            : `已发出 ${countText(v.issuedCount)} · 已使用 ${countText(v.redeemedCount)}（不变）`}</Fact>}
          {v && <Fact k="券模板">{deletion ? <Change from={v.status === "active" ? "投放中" : "已暂停"} to="删除（批准后）" tone="danger" /> : `${v.status === "active" ? "投放中" : "已暂停"}，批准后不变`}</Fact>}
          <Fact k="谁来批">{`${APPROVER}（${APPROVER_NEED}）`}</Fact>
        </Facts>
      ),
      getPendingReason: () => original()?.reason,
      inlineApproval: {
        pending: !!pending,
        expired: !!pending && pending.expiresAt <= Date.now(),
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

  const disposeInput = (v: OpsVoucher, op: H7VoucherApprovalInput["op"]): H7VoucherApprovalInput => ({ op, voucherId: v.id, voucherName: v.name, expectedVersion: v.version });
  const auditHref = "/platform/audit?domain=H";
  const canAudit = reach("/platform/audit");

  const recoveryRows: H7RecoveryRow[] = canWrite ? [
    ...pendingApprovals.map((record) => {
      const expired = record.expiresAt <= Date.now();
      return {
        key: record.commandKey,
        name: H7_VOUCHER_ACTIONS[record.op],
        object: `「${record.voucherName}」`,
        submittedAt: record.createdAt,
        tag: expired ? expiredTag() : unknownTag("approval"),
        actions: <>
          <Button size="sm" onClick={() => openDisposition(record, "lookup")}>查询原结果</Button>
          {!expired && <Button size="sm" onClick={() => openDisposition(record, "retry")}>按原请求重试</Button>}
        </>,
      };
    }),
    ...DIRECT_UNKNOWN.map((record) => ({ key: record.key, name: record.action, object: `「${record.voucherName}」`, submittedAt: record.submittedAt, tag: record.expired ? expiredTag() : unknownTag("direct"), actions: null })),
  ] : [];
  const recovery = (
    <H7RecoveryNotice title={`${recoveryRows.length} 个申请结果未知`} rows={recoveryRows}
      explain={<>
        <p>提交时没收到确定结果，原申请（哪张券、哪种处置、理由和命令号）保存在这个浏览器标签页里。</p>
        <p>先「查询原结果」；查不到、又没过 24 小时，可以「按原请求重试」，后端认得出是同一次提交，不会建第二张审批单。过了 24 小时只能查询。</p>
        <p>结果确认之前，这张券不能再提交删除或作废。</p>
      </>}
      action={canAudit ? <Link className="rd-link" href={auditHref} prefetch={false}>到操作记录与审批核对</Link> : undefined} />
  );

  const header = (
    <PageHeader
      pageId="H7"
      title="代金券"
      summary="看有哪些券在投放、用得怎么样；新增、编辑、暂停或投放。删除和作废要另一位管理员批准。"
      meta={readAt ? <span className="rd-toolbar">
        <span>{`${businessClock(readAt)} 读取（${businessZone().label}）· 打开时读取`}</span>
        <Button variant="ghost" size="sm" loading={loading} icon={<RefreshCw size={14} aria-hidden />} onClick={() => void reload()}>刷新</Button>
      </span> : undefined}
      actions={canWrite ? <Button variant="primary" icon={<Plus size={14} aria-hidden />} disabledReason={error ? "读取失败，读到最新数据后才能新增" : loading && !readAt ? "正在读取" : undefined} onClick={openAdd}>新增代金券</Button> : undefined}
      readOnly={!canWrite ? "你只能查看；新增、编辑和处置代金券要有这页的修改权限。" : undefined}
    />
  );

  if (loading && !readAt) return <div className="h7-page">{header}{recovery}<BlockState state="loading" title="代金券读取中…" /></div>;
  if (error) return (
    <div className="h7-page">
      {header}
      {recovery}
      <BlockState state="error" title="代金券读取失败" detail={`${error} · 为避免误操作，读到之前不能新增、编辑和处置。`} onRetry={() => void reload()} />
    </div>
  );

  const now = Date.now();
  const expiredActive = list.filter((v) => v.status === "active" && voucherPhase(v, now) === "expired");
  const fullActive = list.filter((v) => v.status === "active" && voucherPhase(v, now) !== "expired" && limitReached(v));
  const shown = list.filter((v) => filter === "all" || v.status === filter);
  const detail = detailId ? list.find((v) => v.id === detailId) ?? null : null;
  const detailIndex = detail ? shown.findIndex((v) => v.id === detail.id) : -1;
  const lockedIds = new Set(pendingApprovals.map((record) => record.voucherId));
  const serverPendingOf = (id: string) => SERVER_PENDING.find((item) => item.voucherId === id);

  const rowActions = (v: OpsVoucher, size: "sm" | "md" = "sm") => canWrite && <>
    <Button size={size} icon={<Pencil size={14} aria-hidden />} onClick={() => openEdit(v)}>编辑</Button>
    <Button size={size} icon={v.status === "active" ? <Pause size={14} aria-hidden /> : <Play size={14} aria-hidden />} aria-label={`${v.status === "active" ? "暂停" : "投放"} ${v.name}`} onClick={() => openToggle(v)}>{v.status === "active" ? "暂停" : "投放"}</Button>
  </>;

  const conclusion = list.length === 0
    ? <Conclusion state="neutral" icon={Ticket} hint={canWrite ? "点右上角「新增代金券」建第一张。" : undefined}>还没有代金券</Conclusion>
    : <Conclusion state={expiredActive.length || fullActive.length ? "warn" : "ok"}
      explain={<>
        <p>投放中只看券的状态，不核对有效期、发给谁、发行上限和用户是否已领，不是「现在有多少人能领」。</p>
        <p>发出和使用是这页现有券的合计，按领取记录数算（不是人数）；删掉的券不再计入。</p>
        <p>本人刚提交、正在等批准的删除和作废申请这页读不到，到「操作记录与审批」看。</p>
      </>}
      action={canAudit ? <Link className="rd-link" href={auditHref} prefetch={false}>看待批准的申请</Link> : undefined}>
      {`${countText(activeN)} 张券在投放，共发出 ${countText(issuedSum)} 张，已用 ${countText(redeemedSum)} 张`}
      {expiredActive.length > 0 && `；${expiredActive.length} 张已过有效期但还是投放中，可以暂停`}
      {fullActive.length > 0 && `；${fullActive.length} 张已发完，用户领不到`}
    </Conclusion>;

  return (
    <div className="h7-page">
      {header}
      {recovery}
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
        sub={`${shown.length} 张 · 时间为${businessZone().label}`}
        explain="每张卡是一张券的模板：左边是券面，右边是谁能用、什么时候能用，下面是已发出的券用了多少。点名字或「详情」看全部设置；删除和作废在详情里。"
        actions={<span className="h7-panel-tools">
          <Segments label="按状态筛选" value={filter} onChange={setFilter} items={[
            { value: "all", label: "全部", count: list.length },
            { value: "active", label: "投放中", count: list.filter((v) => v.status === "active").length },
            { value: "paused", label: "已暂停", count: list.filter((v) => v.status === "paused").length },
          ]} />
          <Segments label="显示方式" value={view} onChange={setView} items={[
            { value: "cards", label: <><LayoutGrid size={14} aria-hidden /> 卡片</> },
            { value: "table", label: <><List size={14} aria-hidden /> 列表</> },
          ]} />
        </span>}>
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
          const localPending = lockedIds.has(v.id);
          const serverPending = serverPendingOf(v.id);
          const disposeBlock = localPending ? LOCAL_PENDING : serverPending ? "这张券已有等批准的申请，审批结束前不能再提交" : loading ? "正在读取最新数据，读完再操作" : undefined;
          return <>
            <div className="h7-detail-ticket">
              <VoucherFace v={v} size="large" />
              <div className="h7-detail-head">
                <VoucherTags v={v} now={now} />
                {serverPending && <StatusTag tone="warn">{`${H7_VOUCHER_ACTIONS[serverPending.op]}待审批`}</StatusTag>}
                <p className="h7-preview-sentence">{voucherSentence(v, skuLabels)}</p>
              </div>
            </div>
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
                <Fact k="开始">{startText(v.startAt)}</Fact>
                <Fact k="结束">{endText(v.endAt)}</Fact>
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
                <Fact k="可与试用收益叠加">{v.stackWithTrial ? "是（下单时后端目前不检查）" : "否"}</Fact>
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
                <p>两样都要{APPROVER}批准后才执行（{APPROVER_NEED}）；只想停发用「暂停」。</p>
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

      {form && <H7VoucherForm key={form.key} voucher={form.voucher} initial={form.initial} skuOptions={skuOptions} skuLabels={skuLabels} toMs={toMs}
        onClose={closeForm}
        onReview={(bv) => (form.voucher ? reviewEdit(form.voucher, form.initial, bv) : reviewAdd(bv))} />}
    </div>
  );
}

export default H7VoucherConfig;

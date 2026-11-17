"use client";
import { eCommandClosureOffer } from "@/lib/admin/e-command-investigation";

/**
 * I2 消息推送（改版页，原名 Nova 消息推送）。服务端把平台上真实发生的事做成业务推送，发到 App「消息 · 通知」；运营在这里管频道、
 * 中越英模板、五类事件概率和真实事件素材。16 个写动作都直接生效，不走审批（见重构说明「写操作合同」）。
 * 统一来源：后端 /content/nova/overview 和 /social-events；空库时保持后端空态，不补前端业务样例。
 * 请求、校验、命令号和结果处理照改版前的写法（runBackend、两类共用确认框），这里只换界面。
 * amplifies = false：只动推送节奏与文案，不动费率、奖励、价格。
 */
import { useEffect, useRef, useState } from "react";
import { Ban, Database, Eye, FileText, History, Pencil, Percent, Plus, Power, PowerOff, Radio, RefreshCw, RotateCcw, Send, Shuffle, Timer, Trash2 } from "lucide-react";
import {
  BlockState, Button, Cell, Change, Conclusion, Decision, Drawer, Explain, Fact, Facts, FilterBar, FilterField, Fold, IrreversibleTag, MoreMenu, Notice,
  PageHeader, PageTabs, Pager, Panel, SegmentBar, Select, Stat, StatBand, StatusTag, Table, TableLoading, TableMessage, Td, Th, Tr, DiffList, useTabIds,
} from "@/app/components/rd";
import { PaginationExemptionList, useDataListPager } from "../design-kit";
import {
  formatNovaDuration,
  parseNovaDuration,
  validateNovaCadence,
} from "../../../../lib/admin/nova-cadence";
import type { ActionConfirmReq, ConfirmReq, ICtx } from "./types";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { displayAdminError } from "@/lib/admin/error-messages";
import { businessClock, businessZone, formatBusinessTimeCompact } from "@/lib/admin/business-time";
import { nexGridBrandText } from "@/lib/admin/brand-copy";
import { operatorCopyText } from "@/lib/admin/operator-copy";
import { useReach } from "@/lib/nav/use-reach";
import { fetchI2NovaOverview, type NovaOverview, pendingI2Commands, queryI2Command, retryI2Command, type I2Command, type NovaSocialEventSampleView } from "@/lib/admin/i-client";
import { fundCommandSettled, type FundCommandEvidence, type FundCommandRecord, type FundInvestigationOutcome } from "@/lib/admin/fund-command-investigation";
import { FundCheckButtons, FundClosureModal, FundRecoveryPanel, type FundRecoveryRow, type FundSettled } from "../fund-command-check";
import { isOutcomeUnknownError } from "@/lib/admin/outcome-classification";
import { useIConflictReview } from "@/lib/admin/i-conflict-review";
import { conflictRow, IConflictModal, IConflictPending, useIConflictView } from "./i-conflict";
import { isRetryExpired } from "@/lib/admin/pending-mutation-store";
import {
  AppNotice, ChannelCard, DIST_SLOT, NO_SOURCE, PHASE_CHANNELS, PhaseNote, SOCIAL_CHANNEL, TEMPLATE_STATE_TEXT, TemplateTag,
  catalogName, channelName, cooldownSentence, durationText, noticeCategory, readable, orderDist, placeholdersOf, previewText, sourceText, tickSentence,
} from "./i2-parts";
import { ChannelDrawer, DistDrawer, TemplateDrawer, UNREACHABLE_CTA, UNREACHABLE_TEXT, ctaLabel, type ChannelFormValue, type TemplateFormValue } from "./i2-forms";

type NovaForm = ChannelFormValue;
type TemplateForm = TemplateFormValue;
const EMPTY_FORM: NovaForm = {
  name: "",
  runtimeSource: "",
  tickValue: "",
  tickUnit: "minutes",
  cooldownValue: "",
  cooldownUnit: "hours",
};
const EMPTY_TEMPLATE: TemplateForm = {
  channel: "", name: "", cta: "", version: "v1",
  titleZh: "", bodyZh: "", titleVi: "", bodyVi: "", titleEn: "", bodyEn: "",
};
type OpsNova = { key: string; name: string; trigger: string; tick: string; cd: string; phaseKeyed: string; ctr: number; on: boolean };

const normalizeNovaKey = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);

const slug = (s: string) => normalizeNovaKey(s) || "untitled";

const LIVE = <StatusTag tone="progress" filled>立即生效</StatusTag>;
export function I2Nova({ ctx }: { ctx: ICtx }) {
  const { toast, actions, content, contentLoading, contentError } = ctx;
  const reach = useReach();
  const session = useAdminAuth((state) => state.session);
  const canWriteI2 = session?.role === "superadmin" || !!session?.authorities.includes("content_i2_write");
  const canReadI2 = session?.role === "superadmin" || !!session?.authorities.includes("content_i2_read");
  const data = content.nova;
  const conflictReview = useIConflictReview<NovaOverview, { reason: string; value?: string; form?: Record<string, string> }>();
  const reviewConflict = (error: unknown, reason: string, value?: string, form?: Record<string, string>) =>
    conflictReview.reject(error, { reason, value, form }, async () => {
      const latest = await fetchI2NovaOverview();
      await actions.reloadIContent();
      return latest;
    });
  const [pending, setPending] = useState<I2Command[]>([]);
  const [recovering, setRecovering] = useState<string | null>(null);
  const recoveryInFlight = useRef(false);
  const [requiresReload, setRequiresReload] = useState(false);
  const readBarrier = useRef(data);
  const latestRead = useRef(data);
  latestRead.current = data;
  const newMutationReason = conflictReview.blockedReason() ?? (!data ? "读到数据后才能新增" : contentError || contentLoading || requiresReload ? "最新数据没读到" : !canWriteI2 ? "当前账号没有这项操作权限，请查询原结果。" : undefined);
  const newMutationBlocked = useRef(newMutationReason);
  newMutationBlocked.current = newMutationReason;
  const syncPending = () => setPending(pendingI2Commands());
  useEffect(() => { setPending(pendingI2Commands()); }, [session?.adminId]);
  useEffect(() => {
    const nextExpiry = pending.filter((row) => !isRetryExpired(row)).reduce((next, row) => Math.min(next, row.expiresAt), Infinity);
    if (!Number.isFinite(nextExpiry)) return;
    const timer = setTimeout(() => setPending(pendingI2Commands()), Math.max(1, nextExpiry - Date.now()));
    return () => clearTimeout(timer);
  }, [pending]);
  useEffect(() => {
    if (requiresReload && data && data !== readBarrier.current && !contentLoading && !contentError) setRequiresReload(false);
  }, [requiresReload, data, contentLoading, contentError]);

  const lockReason = (target: string) => newMutationReason || (pending.some((row) => !row.original || row.target === target
    || target.startsWith("channel-name:") && row.original.method === "POST" && row.original.path === "/nova/channels"
      && row.object.trim() === target.slice("channel-name:".length)) ? "此对象有结果未知的原操作，请先到页面上方核对。" : undefined);
  const recoveryConfirm = useRef<{ key: () => string | undefined; close: () => void } | null>(null);
  const recoveryEditors = useRef<{ drawer: string | null }>({ drawer: null });
  const refreshAfterMutation = async (record?: I2Command) => {
    // Idempotent replay returns a historical receipt. Preserve other drafts while requiring a fresh overview.
    readBarrier.current = latestRead.current;
    newMutationBlocked.current = "最新数据没读到";
    setRequiresReload(true);
    if (record) {
      const confirmation = recoveryConfirm.current;
      if (confirmation?.key() === record.commandKey) confirmation.close();
      if (recoveryEditors.current.drawer === record.commandKey) { setNovaDrawer(false); setDrawerPendingKey(null); }
    } else {
      ctx.closeActionConfirm();
      ctx.closeConfirm();
      setNovaDrawer(false);
      setDrawerPendingKey(null);
      setTplDrawer(false);
      setDistDrawer(false);
    }
    syncPending();
    await actions.reloadIContent();
  };
  /** 结果未知不是失败，不加「操作失败」。 */
  const failText = (error: unknown) => isOutcomeUnknownError(error) ? displayAdminError(error) : `操作失败：${displayAdminError(error)}`;
  /** 按原请求查到的结论只用来给运营看；解除与否由 queryI2Command 按后端结论决定。 */
  const [outcomes, setOutcomes] = useState<Record<string, FundInvestigationOutcome>>({});
  const [checking, setChecking] = useState<string | null>(null);
  const [closing, setClosing] = useState<I2Command | null>(null);
  const [settledRows, setSettledRows] = useState<FundSettled[]>([]);
  const settle = (record: I2Command, receipt: NonNullable<Awaited<ReturnType<typeof queryI2Command>>>) =>
    setSettledRows((current) => [...current.filter((item) => item.key !== record.commandKey), { key: record.commandKey, label: `${record.action} · ${unknownObject(record)}`, status: receipt.originalStatus }]);
  const queryOriginal = async (record: I2Command) => {
    let settled = false;
    setChecking(record.commandKey);
    try {
      const receipt = await queryI2Command(record);
      if (record.original) setOutcomes((current) => ({ ...current, [record.commandKey]: { receipt } }));
      settled = fundCommandSettled(receipt);
      if (settled) settle(record, receipt!);
    } catch (error) {
      /* Receipt failure must not prevent the existing content read. */
      setOutcomes((current) => ({ ...current, [record.commandKey]: { error: displayAdminError(error) } }));
    } finally { setChecking(null); }
    if (settled) { await refreshAfterMutation(record); return; }
    await actions.reloadIContent();
    toast("已重新读取；现在的状态不能证明原操作的结果，记录继续保留。");
  };
  const replay = async (record: I2Command) => {
    try {
      await retryI2Command(record);
    } catch (error) {
      syncPending();
      if (!pendingI2Commands().some((row) => row.commandKey === record.commandKey)) {
        await refreshAfterMutation(record);
        toast(failText(error));
        return false;
      }
      throw new Error(failText(error));
    }
    await refreshAfterMutation(record);
    toast(`${record.action} · ${record.object}`);
  };
  const openActionConfirm = (req: ActionConfirmReq) => {
    if (newMutationBlocked.current) { toast(newMutationBlocked.current); return; }
    const openedData = data;
    let pendingKey: string | undefined;
    const original = () => pendingI2Commands().find((row) => row.commandKey === pendingKey);
    const confirmation: ActionConfirmReq = { ...req, getPendingReason: () => original()?.reason,
      run: async (reason, value, businessForm) => {
        if (pendingKey) {
          const record = original();
          if (!record) { ctx.closeActionConfirm(); return false; }
          return replay(record);
        }
        if (conflictReview.blockedReason()) throw new Error(conflictReview.blockedReason());
        if (newMutationBlocked.current || latestRead.current !== openedData) {
          ctx.closeActionConfirm();
          throw new Error(newMutationBlocked.current ?? "数据已更新，请重新核对原操作。");
        }
        try { return await req.run(reason, value, businessForm); }
        catch (error) {
          if (isOutcomeUnknownError(error)) pendingKey = (error as { commandKey?: string }).commandKey;
          if (await reviewConflict(error, reason, value, businessForm)) ctx.closeActionConfirm();
          syncPending();
          // First-attempt refusals stay in the original confirmation, including business 403s.
          throw new Error(failText(error));
        }
      },
    };
    recoveryConfirm.current = { key: () => pendingKey, close: () => ctx.closeActionConfirm(confirmation) };
    ctx.openActionConfirm(confirmation);
  };
  const openConfirm = (req: ConfirmReq) => {
    if (newMutationBlocked.current) { toast(newMutationBlocked.current); return; }
    const openedData = data;
    let pendingKey: string | undefined;
    const original = () => pendingI2Commands().find((row) => row.commandKey === pendingKey);
    // 结果未知后框里冻结的是原请求，主按钮和别处一样叫「按原请求重试」（全站-结果未知叫法）。
    const confirmation: ConfirmReq = { ...req, get okLabel() { return pendingKey ? "按原请求重试" : req.okLabel; }, errorHandled: false, freezePendingInput: true, replayPendingInput: true, getPendingBlockReason: () => req.blockedReason, getPendingReason: () => original()?.reason,
      run: async (reason, value) => {
        if (pendingKey) {
          const record = original();
          if (!record) { ctx.closeConfirm(); return false; }
          return replay(record);
        }
        if (conflictReview.blockedReason()) throw new Error(conflictReview.blockedReason());
        if (newMutationBlocked.current || latestRead.current !== openedData) {
          ctx.closeConfirm();
          throw new Error(newMutationBlocked.current ?? "数据已更新，请重新核对原操作。");
        }
        try { return await req.run(reason, value); }
        catch (error) {
          if (isOutcomeUnknownError(error)) {
            pendingKey = (error as { commandKey?: string }).commandKey;
            setTplDrawer(false);
            setDistDrawer(false);
          }
          if (await reviewConflict(error, reason, value)) ctx.closeConfirm();
          syncPending();
          throw new Error(failText(error));
        }
      },
    };
    recoveryConfirm.current = { key: () => pendingKey, close: () => ctx.closeConfirm(confirmation) };
    ctx.openConfirm(confirmation);
  };
  const restore = async (record: I2Command) => {
    if (recoveryInFlight.current) return;
    recoveryInFlight.current = true;
    setRecovering(record.commandKey);
    try { await replay(record); }
    catch (error) { toast(displayAdminError(error)); }
    finally { recoveryInFlight.current = false; setRecovering(null); }
  };
  const I2_STATS = data?.stats ?? { todayDelivered: "—", ctr: "—", ctrTarget: 0, onlineChannels: 0, totalChannels: 0, weeklySocial: "—" };
  const novas: OpsNova[] = (data?.channels ?? []).map((n) => ({
    key: n.key,
    name: n.name,
    trigger: n.trigger,
    tick: n.tick,
    cd: n.cooldown,
    phaseKeyed: n.phaseKeyed,
    ctr: Number(n.ctr),
    on: n.enabled,
  }));
  const NOVA_EVENT_DRIVEN = (data?.eventDriven ?? []).map((r) => ({ name: r.name, why: r.reason, owner: r.owner, tone: r.tone, st: r.status }));
  const NOVA_TPLS = (data?.templates ?? []).map((t) => ({
    ch: t.channel, name: t.name, cta: t.cta, v: t.version, status: t.status,
    titleZh: t.titleZh, bodyZh: t.bodyZh, titleVi: t.titleVi, bodyVi: t.bodyVi,
    titleEn: t.titleEn, bodyEn: t.bodyEn,
  }));
  const templatePager = useDataListPager(NOVA_TPLS, { initialPageSize: 7 });
  const CTA_OPTIONS = data?.templateCtaOptions ?? [];
  const RUNTIME_SOURCE_OPTIONS = data?.runtimeSourceOptions ?? [];
  const SOCIAL_DIST = data?.socialDistribution ?? [];
  const INITIAL_SOCIAL_EVENTS = data?.socialEvents ?? [];
  const SOCIAL_EVENT_TYPE_OPTIONS = data?.socialEventTypes ?? [];
  const SOCIAL_EVENT_STATUS_OPTIONS = data?.socialEventStatuses ?? [];

  // 这页读到数据的时间，只用来写页头「HH:mm 读取」。
  const [readAt, setReadAt] = useState<number | null>(null);
  useEffect(() => { if (data) setReadAt(Date.now()); }, [data]);

  // 失败时确认框或抽屉还开着，错误写在那里，不再弹一遍。
  const runBackend = (task: Promise<void>, ok: string, onSuccess?: () => void) => task
      .then(() => refreshAfterMutation())
      .then(() => { toast(ok); onSuccess?.(); });

  // ── 频道抽屉(新增 / 编辑复用同一抽屉)──
  const [novaDrawer, setNovaDrawer] = useState(false);
  const [editNovaKey, setEditNovaKey] = useState<string | null>(null);
  const [form, setForm] = useState<NovaForm>(EMPTY_FORM);
  const [drawerPendingKey, setDrawerPendingKey] = useState<string | null>(null);
  recoveryEditors.current = { drawer: drawerPendingKey };
  const [drawerSubmitting, setDrawerSubmitting] = useState(false);
  const [drawerError, setDrawerError] = useState<string | null>(null);
  const drawerInFlight = useRef(false);
  const drawerSource = useRef(data);

  const openNewNova = () => {
    const blocked = lockReason("channel-create");
    if (blocked) { toast(blocked); return; }
    drawerSource.current = data;
    setDrawerPendingKey(null); setEditNovaKey(null); setForm(EMPTY_FORM); setNovaDrawer(true);
  };
  const openEditNova = (n: OpsNova) => {
    const blocked = lockReason(`channel:${n.key}`);
    if (blocked) { toast(blocked); return; }
    drawerSource.current = data;
    setDrawerPendingKey(null);
    const tick = parseNovaDuration(n.tick, "minutes");
    const cooldown = parseNovaDuration(n.cd, "hours");
    setEditNovaKey(n.key);
    setForm({
      name: n.name,
      runtimeSource: n.trigger.startsWith("a4:") ? n.trigger : "",
      tickValue: tick.value,
      tickUnit: tick.unit,
      cooldownValue: cooldown.value,
      cooldownUnit: cooldown.unit,
    });
    setNovaDrawer(true);
  };
  const closeDrawer = () => { if (drawerInFlight.current) return; setNovaDrawer(false); setEditNovaKey(null); setForm(EMPTY_FORM); setDrawerPendingKey(null); setDrawerError(null); };

  const cadenceError = validateNovaCadence(
    form.tickValue,
    form.tickUnit,
    form.cooldownValue,
    form.cooldownUnit,
  );

  const submitDrawer = async () => {
    if (drawerInFlight.current) return;
    if (drawerPendingKey) {
      const original = pendingI2Commands().find((row) => row.commandKey === drawerPendingKey);
      if (original) await restore(original);
      else closeDrawer();
      return;
    }
    if (newMutationBlocked.current || latestRead.current !== drawerSource.current) {
      closeDrawer();
      toast(newMutationBlocked.current ?? "数据已更新，请重新核对原操作。");
      return;
    }
    const name = form.name.trim();
    if (!name) return;
    const blocked = lockReason(editNovaKey ? `channel:${editNovaKey}` : `channel-name:${name}`);
    if (blocked) { toast(blocked); return; }
    if (cadenceError) {
      toast(cadenceError);
      return;
    }
    const tick = formatNovaDuration(form.tickValue, form.tickUnit);
    const cd = formatNovaDuration(form.cooldownValue, form.cooldownUnit);
    drawerInFlight.current = true;
    setDrawerSubmitting(true);
    setDrawerError(null);
    try {
      if (editNovaKey) {
        const prev = novas.find((x) => x.key === editNovaKey);
        await runBackend(actions.updateI2NovaChannel(editNovaKey, {
          name,
          trigger: form.runtimeSource || prev?.trigger || "",
          tick,
          cooldown: cd,
          ctr: prev?.ctr ?? 0,
          enabled: prev?.on ?? true,
        }, "后台编辑 消息频道"), `消息频道已更新:${prev?.name ?? editNovaKey} → ${name}`);
      } else {
        const key = `${slug(name).slice(0, 50)}-${Date.now().toString(36).slice(-6)}`;
        await runBackend(actions.createI2NovaChannel({
          key,
          name,
          trigger: form.runtimeSource,
          tick,
          cooldown: cd,
          ctr: 0,
          enabled: false,
        }, "后台新增 消息频道"), `消息频道已新增:${name}`);
      }
    } catch (error) {
      if (isOutcomeUnknownError(error)) setDrawerPendingKey((error as { commandKey?: string }).commandKey ?? null);
      else { setDrawerError(displayAdminError(error)); await reviewConflict(error, "", undefined, form); }
      syncPending();
      // runBackend displays the refusal. Keep the drawer and its inputs; unknown requests freeze below.
    } finally {
      drawerInFlight.current = false;
      setDrawerSubmitting(false);
    }
  };

  const tplStatus = (ch: string): string => NOVA_TPLS.find((t) => t.ch === ch)?.status?.toLowerCase() ?? "missing";
  const tplOf = (ch: string) => NOVA_TPLS.find((t) => t.ch === ch);
  const displayOf = (key: string) => { const n = novas.find((x) => x.key === key); return n ? channelName(n.key, n.name) : key; };
  const tplFact = (ch: string) => {
    const t = tplOf(ch);
    return t ? `${t.name} · ${t.v}（${TEMPLATE_STATE_TEXT[tplStatus(ch)] ?? tplStatus(ch)}）` : "没有模板";
  };

  // ── 单频道 停用 / 启用:走操作确认(不传 edit) ──
  const toggleNova = (n: OpsNova) => openActionConfirm({ briefKind: "config",
    action: <>{n.on ? "停推" : "恢复"} 消息频道 · {n.name}</>,
    title: `${n.on ? "停用" : "启用"}频道`,
    detail: n.on
      ? <>停用后系统扫描时跳过这个频道，不再给它生成新消息；已经发出的消息不撤回。要再推时点「启用」。</>
      : <>启用只打开开关：系统按扫描间隔检查业务事件，有满足条件的事、这个人又过了个人间隔，才会发出。</>,
    effect: LIVE,
    statedBrief: n.on
      ? { impact: "这个频道不再生成新消息；已经发出的不撤回。", check: "确认停的是这个频道；要再推时点「启用」。" }
      : { impact: "开关打开后按扫描间隔检查；有素材、过了个人间隔才会真正发出。", check: "确认模板内容已核对过。" },
    facts: (
      <Facts>
        <Fact k="频道">{channelName(n.key, n.name)}</Fact>
        <Fact k="状态"><Change from={n.on ? "已启用" : "已停用"} to={n.on ? "已停用" : "已启用"} /></Fact>
        <Fact k="模板">{tplFact(n.key)}</Fact>
        <Fact k="扫描">{tickSentence(n.tick)}</Fact>
        <Fact k="个人间隔">{cooldownSentence(n.cd)}</Fact>
        {!n.on && <Fact k="紧急停用时">不发；关停期间也能启用，解除后照常发</Fact>}
      </Facts>
    ),
    confirmLabel: n.on ? "确认停用" : "确认启用",
    reasonPlaceholder: n.on ? "例如：文案有误，先停推核对" : "例如：模板已核对，恢复推送",
    amplifies: false,
    reasonMax: 200,
    run: (reason) => {
      if (!n.on && tplStatus(n.key) !== "published") {
        toast("先给它发布模板才能启用");
        throw new Error("NOVA_PUBLISHED_TEMPLATE_REQUIRED");
      }
      return runBackend(actions.updateI2NovaChannelStatus(n.key, !n.on, reason), `${channelName(n.key, n.name)} ${n.on ? "已停用" : "已启用"}`);
    },
  });

  // ── 删除频道:走普通确认(原因必填 + 留痕) ──
  const removeNova = (n: OpsNova) => openConfirm({ briefKind: "content",
    errorHandled: true,
    action: <>删除推送通道 · {n.name}</>,
    title: "删除频道",
    detail: <>删除这个频道，连它的模板一起删除（已发布的也删）；之后不再推送。已经发出的消息不撤回。</>,
    effect: <>{LIVE}<IrreversibleTag /></>,
    statedBrief: { impact: tplOf(n.key) ? "频道和它的模板一起删除，包括已发布的模板；已经发出的消息不撤回。" : "频道删除后不再推送；已经发出的消息不撤回。", check: "页面上没有恢复入口；只想暂停用「停用」。" },
    content: (
      <Facts>
        <Fact k="频道">{channelName(n.key, n.name)}</Fact>
        <Fact k="状态">{n.on ? "已启用" : "已停用"}</Fact>
        <Fact k="一起删除的模板" tone={tplOf(n.key) ? "danger" : undefined}>{tplOf(n.key) ? tplFact(n.key) : "—"}</Fact>
      </Facts>
    ),
    confirmTone: "danger",
    reasonPlaceholder: "例如：频道已下线，工单号",
    reason: true,
    okLabel: "确认删除",
    run: (reason) => {
      return runBackend(actions.deleteI2NovaChannel(n.key, reason), `消息频道已删除:${n.name}`);
    },
  });

  const publishTpl = (ch: string, name: string) => {
    const n = novas.find((x) => x.key === ch);
    const t = tplOf(ch);
    return openActionConfirm({ briefKind: "content",
      action: <>发布模板 · {name}</>,
      title: "发布模板",
      detail: <>频道 <b>{ch}</b>。发布后，这个频道之后生成的消息用这份内容；频道不会自动启用。中文和越南语必须完整、正文变量一致（英文可选），含已退役品牌词时会被拒。</>,
      effect: LIVE,
      statedBrief: { impact: "这个频道之后生成的消息用这份内容；频道不会自动启用，已经发出的不变。", check: "提交时会查中文、越南语是否完整、正文变量是否一致、有没有已退役的品牌词；真实动态以外的频道带变量也会被拒。" },
      facts: (
        <Facts>
          <Fact k="模板">{name}</Fact>
          <Fact k="频道">{displayOf(ch)}</Fact>
          <Fact k="模板状态"><Change from="草稿" to="已发布" /></Fact>
          <Fact k="版本">{t?.v ?? "—"}</Fact>
          <Fact k="语言">{t && t.titleEn.trim() && t.bodyEn.trim() ? "中文、越南语、英语" : "中文、越南语（英语没填）"}</Fact>
          {t && ch !== SOCIAL_CHANNEL && (() => {
            const used = [...new Set([t.titleZh, t.bodyZh, t.titleVi, t.bodyVi, t.titleEn, t.bodyEn].flatMap(placeholdersOf))];
            return used.length ? <Fact k="变量" tone="danger">{`有 ${used.join("、")}：这个频道填不了，发布会被拒`}</Fact> : null;
          })()}
          <Fact k="频道状态" tone={n && !n.on ? "warn" : undefined}>{n ? (n.on ? "已启用" : "已停用，发布后要另外点「启用」") : "—"}</Fact>
        </Facts>
      ),
      confirmLabel: "确认发布",
      reasonPlaceholder: "例如：文案已审核，工单号",
      amplifies: false,
      reasonMax: 200,
      run: (reason) => {
        return runBackend(actions.updateI2TemplateStatus(ch, "PUBLISHED", reason, data?.templates.find(t => t.channel === ch)), `${name} 已发布`);
      },
    });
  };
  const archiveTpl = (ch: string, name: string) => {
    const n = novas.find((x) => x.key === ch);
    return openActionConfirm({ briefKind: "content",
      action: <>归档模板 · {name}</>,
      title: "归档模板",
      detail: <>归档后这个模板不再使用，对应频道如果开着会同时被停用；已经发出的消息不撤回。归档后不能改回草稿，要换内容就删掉归档的模板再新建。</>,
      effect: LIVE,
      statedBrief: n?.on
        ? { impact: `模板不再使用，「${channelName(n.key, n.name)}」频道会同时被停用；已发出的不撤回。`, check: "归档后不能改回草稿；要换内容，先删掉归档的模板再新建。" }
        : { impact: "模板不再使用；已发出的不撤回。", check: "归档后不能改回草稿；要换内容，先删掉归档的模板再新建。" },
      facts: (
        <Facts>
          <Fact k="模板">{name}</Fact>
          <Fact k="频道">{displayOf(ch)}</Fact>
          <Fact k="模板状态"><Change from="已发布" to="已归档" /></Fact>
          <Fact k="频道状态">{n?.on ? <Change from="已启用" to="已停用" tone="warn" /> : n ? "已停用，不变" : "—"}</Fact>
        </Facts>
      ),
      confirmLabel: "确认归档",
      reasonPlaceholder: "例如：活动结束，换新文案",
      amplifies: false,
      reasonMax: 200,
      run: (reason) => {
        return runBackend(actions.updateI2TemplateStatus(ch, "ARCHIVED", reason), `${name} 已归档`);
      },
    });
  };

  const [tplDrawer, setTplDrawer] = useState(false);
  const [editTplChannel, setEditTplChannel] = useState<string | null>(null);
  const [tplForm, setTplForm] = useState<TemplateForm>(EMPTY_TEMPLATE);
  const newTpl = () => {
    const firstChannel = novas.find((n) => !NOVA_TPLS.some((t) => t.ch === n.key))?.key ?? "";
    setEditTplChannel(null);
    setTplForm({ ...EMPTY_TEMPLATE, channel: firstChannel, cta: CTA_OPTIONS[0]?.value ?? "" });
    setTplDrawer(true);
  };
  const editTpl = (t: (typeof NOVA_TPLS)[number]) => {
    setEditTplChannel(t.ch);
    setTplForm({ channel: t.ch, name: t.name, cta: t.cta, version: t.v,
      titleZh: t.titleZh, bodyZh: t.bodyZh, titleVi: t.titleVi, bodyVi: t.bodyVi,
      titleEn: t.titleEn, bodyEn: t.bodyEn });
    setTplDrawer(true);
  };
  const closeTplDrawer = () => { setTplDrawer(false); setEditTplChannel(null); setTplForm(EMPTY_TEMPLATE); };
  const submitTpl = () => {
    const n = novas.find((x) => x.key === tplForm.channel);
    return openConfirm({ briefKind: "config",
      errorHandled: true,
      action: <>{editTplChannel ? "编辑" : "新增"}推送模板 · {tplForm.name}</>,
      title: editTplChannel ? "保存模板草稿" : "新建模板草稿",
      detail: <>保存后是草稿，用户还看不到；发布前会再检查中文、越南语是否完整、正文变量是否一致。对应频道如果开着，保存后会被停用。</>,
      effect: n?.on ? <><StatusTag tone="done" filled>保存为草稿</StatusTag><StatusTag tone="warn">频道会被停用</StatusTag></> : <StatusTag tone="done" filled>保存为草稿</StatusTag>,
      statedBrief: n?.on
        ? { impact: `保存后是草稿；「${channelName(n.key, n.name)}」频道会被停用，发布模板后要再手动启用。`, check: "发布时会再查中文、越南语是否完整、正文变量是否一致。" }
        : { impact: "保存后是草稿，用户还看不到；发布后频道才用新内容。", check: "发布时会再查中文、越南语是否完整、正文变量是否一致。" },
      content: (
        <Facts>
          <Fact k="频道">{n ? channelName(n.key, n.name) : tplForm.channel}</Fact>
          <Fact k="模板">{`${tplForm.name} · ${tplForm.version}`}</Fact>
          <Fact k="语言">{tplForm.titleEn.trim() && tplForm.bodyEn.trim() ? "中文、越南语、英语" : "中文、越南语（英语没填）"}</Fact>
          <Fact k="点击后去哪" tone={UNREACHABLE_CTA.has(tplForm.cta) ? "warn" : undefined}>{`${ctaLabel(CTA_OPTIONS, tplForm.cta)}${UNREACHABLE_CTA.has(tplForm.cta) ? `（${UNREACHABLE_TEXT}）` : ""}`}</Fact>
          {n?.on && <Fact k="频道状态"><Change from="已启用" to="已停用" tone="warn" /></Fact>}
        </Facts>
      ),
      reasonPlaceholder: "例如：新活动文案，工单号",
      reason: true,
      okLabel: "保存草稿",
      run: (reason) => {
        const body = { ...tplForm };
        return runBackend(editTplChannel
          ? actions.updateI2Template(editTplChannel, body, reason, data?.templates.find(t => t.channel === editTplChannel))
          : actions.createI2Template(body, reason),
        `模板 ${tplForm.name} 已保存为草稿`, closeTplDrawer);
      },
    });
  };
  const removeTpl = (t: (typeof NOVA_TPLS)[number]) => openConfirm({ briefKind: "content",
    errorHandled: true,
    action: <>删除推送模板 · {t.name}</>,
    title: "删除模板",
    detail: <>已发布模板不能直接删除，要先归档。删除后对应频道启用不了，要先新建并发布模板。</>,
    effect: <>{LIVE}<IrreversibleTag /></>,
    statedBrief: { impact: "删除后这个频道启用不了，要先新建并发布模板；已经发出的不撤回。", check: "只有草稿和已归档的模板能删；页面上没有恢复入口。" },
    content: (
      <Facts>
        <Fact k="频道">{displayOf(t.ch)}</Fact>
        <Fact k="模板">{`${t.name} · ${t.v}（${TEMPLATE_STATE_TEXT[tplStatus(t.ch)] ?? tplStatus(t.ch)}）`}</Fact>
      </Facts>
    ),
    confirmTone: "danger",
    reasonPlaceholder: "例如：草稿作废，重新写",
    reason: true,
    okLabel: "确认删除",
    run: (reason) => runBackend(actions.deleteI2Template(t.ch, reason), `模板 ${t.name} 已删除`),
  });

  // ── 真实事件的五类概率:一次编辑全部类型，不静默改动另一类。──
  const [distDrawer, setDistDrawer] = useState(false);
  const [distDraft, setDistDraft] = useState<Record<string, string>>({});
  const [distReason, setDistReason] = useState("");
  const openDistDrawer = () => {
    setDistReason("");
    setDistDraft(Object.fromEntries(SOCIAL_DIST.map((item) => [item.key, String(item.pct)])));
    setDistDrawer(true);
  };
  const distDraftTotal = SOCIAL_DIST.reduce((sum, item) => sum + Number(distDraft[item.key] ?? 0), 0);
  const distDraftValid = SOCIAL_DIST.length > 0
    && SOCIAL_DIST.every((item) => {
      const value = Number(distDraft[item.key]);
      return Number.isFinite(value) && Number.isInteger(value) && value >= 0 && value <= 100;
    })
    && distDraftTotal === 100;
  const submitDistribution = () => openConfirm({ briefKind: "config",
    initialReason: distReason,
    errorHandled: true,
    action: <>保存 业务动态事件概率分布</>,
    title: "保存事件概率",
    detail: <>本次整组替换五类真实事件的概率；合计必须为 100%，不会自动改动别的类。保存时如果别人刚改过，会被拒绝。</>,
    effect: LIVE,
    statedBrief: { impact: "之后真实动态按新概率选事件；已经发出的消息和事件本身不变。", check: "五类一起保存，不会自动调别的类；别人刚改过会被拒。" },
    content: (
      <DiffList rows={orderDist(SOCIAL_DIST)
        .filter((item) => String(Number(distDraft[item.key] ?? 0)) !== String(Number(item.pct)))
        .map((item) => ({ key: item.key, label: operatorCopyText(item.name), before: `${Number(item.pct)}%`, after: `${Number(distDraft[item.key] ?? 0)}%`, note: item.key === NO_SOURCE && Number(distDraft[item.key] ?? 0) > 0 ? "这类没有真实数据源，设了也抽不到。" : undefined }))}
        emptyNote="五类都没改；仍会保存一次并记下理由。" />
    ),
    reasonPlaceholder: "例如：本周多推提现到账",
    reason: true,
    okLabel: "确认保存",
    run: (reason) => {
      const items = SOCIAL_DIST.map((item) => ({ key: item.key, pct: Number(distDraft[item.key] ?? 0) }));
      const expectedItems = SOCIAL_DIST.map((item) => ({ key: item.key, pct: Number(item.pct) }));
      return runBackend(actions.updateI2Distribution(items, expectedItems, reason), "事件出现概率已更新", () => setDistDrawer(false));
    },
  });

  // ── 刚被别人改过：五类概率被别人先改了，看最新的和自己填的，确认后按最新的重新保存。──
  const conflictView = useIConflictView(conflictReview.review);
  const conflictUi = (() => {
    const conflict = conflictReview.review;
    if (!conflict) return null;
    const latest = conflict.latest?.socialDistribution ?? [];
    const finish = (task: () => void) => {
      if (!conflictReview.confirm(conflict, () => undefined)) return;
      conflictView.show();
      window.setTimeout(task, 0);
    };
    const subject = "业务动态事件概率";
    return conflictView.open
      ? <IConflictModal review={conflict} subject={subject} columns={["现在", "你填的"]} rebuildLabel="按最新的重新填写"
          rows={orderDist(latest).map((item) => conflictRow(operatorCopyText(item.name), `${Number(item.pct)}%`, distDraft[item.key] === undefined ? "—" : `${Number(distDraft[item.key])}%`))}
          note="理由会带进确认框；核对后再点「保存概率」。"
          onReread={() => void conflictReview.reread()} onClose={conflictView.hide}
          onRebuild={() => finish(() => { setDistReason(conflict.requested.reason); setDistDrawer(true); })} onDiscard={() => finish(() => setDistDrawer(false))} />
      : <IConflictPending subject={subject} onOpen={conflictView.show} />;
  })();

  // ── 真实事件生命周期:事件只能从受信业务表同步，管理端不提供伪造入口。──
  const [eventTypeFilter, setEventTypeFilter] = useState("");
  const [eventStatusFilter, setEventStatusFilter] = useState("");
  const [previewLanguage, setPreviewLanguage] = useState<"ZH" | "VI" | "EN">("VI");
  const [eventPage, setEventPage] = useState(1);
  const [eventBusy, setEventBusy] = useState<string | null>(null);
  const [eventRefreshKey, setEventRefreshKey] = useState(0);
  const [SOCIAL_EVENTS, setSocialEvents] = useState(INITIAL_SOCIAL_EVENTS);
  const [eventTotal, setEventTotal] = useState(INITIAL_SOCIAL_EVENTS.length);
  const [eventLoading, setEventLoading] = useState(false);
  const [eventRead, setEventRead] = useState<{
    source: typeof data; type: string; status: string; page: number; error: string | null;
  } | null>(null);
  const EVENT_PAGE_SIZE = 20;
  const eventReadMatches = eventRead?.source === data && eventRead?.type === eventTypeFilter
    && eventRead?.status === eventStatusFilter && eventRead?.page === eventPage;
  const eventError = eventReadMatches ? eventRead?.error : null;
  const eventReadable = eventReadMatches && !eventError;
  const visibleEventTotal = eventReadable ? eventTotal : 0;
  const visibleSocialEvents = eventReadable ? SOCIAL_EVENTS : [];
  useEffect(() => {
    setEventRead(null);
    if (!data) {
      setEventLoading(false);
      return;
    }
    let active = true;
    setEventLoading(true);
    actions.listI2SocialEvents(eventTypeFilter, eventStatusFilter, eventPage, EVENT_PAGE_SIZE)
      .then((result) => {
        if (!active) return;
        const lastPage = Math.max(1, Math.ceil(result.total / EVENT_PAGE_SIZE));
        if (eventPage > lastPage) {
          setEventPage(lastPage);
          return;
        }
        setSocialEvents(result.items);
        setEventTotal(result.total);
        setEventRead({ source: data, type: eventTypeFilter, status: eventStatusFilter, page: eventPage, error: null });
      })
      .catch((error) => {
        if (!active) return;
        const message = `事件列表加载失败:${displayAdminError(error)}`;
        setEventRead({ source: data, type: eventTypeFilter, status: eventStatusFilter, page: eventPage, error: message });
        toast(message);
      })
      .finally(() => active && setEventLoading(false));
    return () => { active = false; };
  }, [actions.listI2SocialEvents, data, eventPage, eventRefreshKey, eventStatusFilter, eventTypeFilter, toast]);
  const optionLabel = (options: { value: string; label: string }[], value: string) =>
    options.find((option) => option.value === value)?.label ?? "类型未知";
  const statusLabel = (value: string) => SOCIAL_EVENT_STATUS_OPTIONS.find((option) => option.value === value)?.label
    ?? ({ ACTIVE: "已验证", DISABLED: "已停用", EXPIRED: "已过期" } as Record<string, string>)[value]
    ?? "状态未知";
  const formatEventTime = (value?: string | null) => formatBusinessTimeCompact(value, "—");
  const canRestoreEvent = (expiresAt: string) => new Date(expiresAt).getTime() > Date.now();
  type SocialEvent = (typeof SOCIAL_EVENTS)[number];
  // 来源备注是后端受信备注：提现的两个状态码写人话，其余（等级变化、系列号）原样。
  const noteText = (note?: string) => !note ? "来源已核验" : note === "LEGACY_COMPLETED" ? "提现已完成（历史状态）" : note === "SUCCESS" ? "提现已完成" : note.replace(/^(V\d+)→(V\d+)$/, "$1 → $2");
  // 表格一行：第一行是「类型 · 金额或变化」，第二行是谁、在哪、来源备注。
  const eventHead = (event: SocialEvent) => [eventType(event), event.amountDisplay || (event.eventType === "vrank" ? noteText(event.sourceNote) : "")].filter(Boolean).join(" · ");
  const eventWho = (event: SocialEvent) => [event.actorDisplay, event.cityDisplay, event.eventType === "vrank" || !event.sourceNote ? "" : noteText(event.sourceNote)].filter(Boolean).join(" · ") || "来源已核验";
  const eventText = (event: SocialEvent) => [event.actorDisplay, event.cityDisplay, event.amountDisplay].filter(Boolean).join(" · ") || "聚合事件";
  const eventType = (event: SocialEvent) => operatorCopyText(event.eventTypeLabel || optionLabel(SOCIAL_EVENT_TYPE_OPTIONS, event.eventType));
  const eventTag = (status: string) => status === "ACTIVE" ? <StatusTag tone="ok">{statusLabel(status)}</StatusTag>
    : <StatusTag tone="done">{statusLabel(status)}</StatusTag>;
  const eventFacts = (event: SocialEvent, change?: { to: string; tone?: "warn" }) => (
    <Facts>
      <Fact k="事件">{`#${event.id} · ${eventText(event)}`}</Fact>
      <Fact k="类型">{eventType(event)}</Fact>
      <Fact k="状态">{change ? <Change from={statusLabel(event.status)} to={change.to} tone={change.tone} /> : statusLabel(event.status)}</Fact>
      <Fact k="过期时间">{`${formatEventTime(event.expiresAt)}（${businessZone().label}）`}</Fact>
    </Facts>
  );
  const syncSocialEvents = () => openConfirm({ briefKind: "record",
    errorHandled: true,
    action: <>同步真实业务事件</>,
    title: "同步真实事件",
    detail: <>从提现、V 等级、创世节点成交和整点新增注册这些业务表取最近 24 小时的新事件，每条从发生起 12 小时后过期。重复来源跳过，删过的不会再同步回来；AI 客户消费没有真实数据源，跳过。后台大约每 10 分钟也会自动同步一次。</>,
    effect: LIVE,
    statedBrief: { impact: "只把新发生的真实事件加进素材；不发消息，不改业务数据，重复的跳过。", check: "删过的事件不会再同步回来；后台大约每 10 分钟也会自动同步。" },
    content: (
      <Facts>
        <Fact k="从哪取">提现、V 等级、创世节点成交、整点注册</Fact>
        <Fact k="时间范围">最近 24 小时</Fact>
        <Fact k="新事件有效期">发生后 12 小时</Fact>
        <Fact k="AI 客户消费">没有数据源，跳过</Fact>
      </Facts>
    ),
    reasonPlaceholder: "例如：活动开始前补一次素材",
    reason: true,
    okLabel: "开始同步",
    run: (reason) => {
      setEventBusy("sync");
      return actions.syncI2SocialEvents(reason)
        .then((result) => refreshAfterMutation().then(() => result))
        .then((result) => {
          setEventRefreshKey((key) => key + 1);
          toast(`同步完成：发现 ${result.discovered} 条，新增 ${result.inserted} 条，重复 ${result.duplicates} 条`);
        })
        .finally(() => setEventBusy(null));
    },
  });
  const [sample, setSample] = useState<{ value: NovaSocialEventSampleView | null; lang: "ZH" | "VI" | "EN"; at: number } | null>(null);
  const previewSocialEvent = () => {
    setEventBusy("preview");
    actions.previewI2SocialEvent(previewLanguage)
      .then((value) => setSample({ value, lang: previewLanguage, at: Date.now() }))
      .catch((error) => toast(`抽样失败:${displayAdminError(error)}`))
      .finally(() => setEventBusy(null));
  };
  const STATUS_COPY = {
    DISABLED: { verb: "停用", impact: "这条事件暂时不会被抽到，过期前可以恢复；人物、金额、时间不能改，已经发出的不撤回。", check: "只想永久不用，选「立即过期」。", place: "例如：内容需要核对，先停用" },
    ACTIVE: { verb: "恢复", impact: "这条事件重新可以被抽到，直到原过期时间；发过的之后也可能再被抽到。", check: "过期时间不变，到期后自动失效。", place: "例如：核对无误，恢复使用" },
    EXPIRED: { verb: "立即过期", impact: "这条事件永久不再被抽到，不能恢复；原过期时间不变，已经发出的不撤回。", check: "只想暂时不用，选「停用」。", place: "例如：事件已过时" },
  } as const;
  const changeSocialEventStatus = (event: SocialEvent, status: "ACTIVE" | "DISABLED" | "EXPIRED") => openConfirm({ briefKind: "content",
    errorHandled: true,
    action: <>{status === "ACTIVE" ? "恢复" : status === "DISABLED" ? "停用" : "立即过期"}真实事件 · #{event.id}</>,
    title: `${STATUS_COPY[status].verb}事件`,
    detail: <>只能控制这条事件是否推送，不能改来源、人物、金额和时间。</>,
    effect: status === "EXPIRED" ? <>{LIVE}<IrreversibleTag /></> : LIVE,
    statedBrief: { impact: STATUS_COPY[status].impact, check: STATUS_COPY[status].check },
    content: eventFacts(event, { to: statusLabel(status), tone: status === "EXPIRED" ? "warn" : undefined }),
    confirmTone: status === "EXPIRED" ? "danger" : undefined,
    reasonPlaceholder: STATUS_COPY[status].place,
    reason: true,
    okLabel: `确认${STATUS_COPY[status].verb}`,
    run: (reason) => {
      setEventBusy(`status-${event.id}`);
      return runBackend(actions.updateI2SocialEventStatus(event.id, status, reason), "事件状态已更新",
        () => setEventRefreshKey((key) => key + 1))
        .finally(() => setEventBusy(null));
    },
  });
  const deleteSocialEvent = (event: SocialEvent) => openConfirm({ briefKind: "record",
    errorHandled: true,
    action: <>删除真实事件 · #{event.id}</>,
    title: "删除事件",
    detail: <>删除后不再推送；已推送的记录仍保留。同一来源不会再同步回来，原业务记录不变。</>,
    effect: <>{LIVE}<IrreversibleTag /></>,
    statedBrief: { impact: "从列表里删掉，之后不会再被抽到；同一来源不会再同步回来。已经发出的消息和原业务记录都不变。", check: "只想暂时不用，选「停用」。" },
    content: eventFacts(event),
    confirmTone: "danger",
    reasonPlaceholder: "例如：事件内容有误",
    reason: true,
    okLabel: "确认删除",
    run: (reason) => {
      setEventBusy(`delete-${event.id}`);
      return runBackend(actions.deleteI2SocialEvent(event.id, reason), "事件已删除",
        () => setEventRefreshKey((key) => key + 1))
        .finally(() => setEventBusy(null));
    },
  });

  // 页内两个页签：模板和真实动态素材，一屏只露一个主列表（DP-67）。
  const lowerIds = useTabIds();
  const [lower, setLower] = useState<"templates" | "material">("templates");
  const [detailTpl, setDetailTpl] = useState<string | null>(null);
  const [detailEvent, setDetailEvent] = useState<number | null>(null);

  const onlineCount = novas.filter((n) => n.on).length;
  // 「不在频道里的推送」由服务端目录减去已有频道得出，不写死名单(#146)。
  const cadenceKeys = new Set(novas.map((n) => n.key));
  const offTableChannels = NOVA_EVENT_DRIVEN.filter((r) => !cadenceKeys.has(r.name));
  const cadenceChannelCount = novas.length;
  const offTableTitle = offTableChannels.length
    ? `不在 ${cadenceChannelCount} 频道里的推送(统计规则闭合)`
    : `全部 ${cadenceChannelCount} 频道均已在节奏表内(统计规则闭合)`;
  // 点击率达标判定按同一数值口径算；服务端没给可解析的点击率时不判达标也不判未达标。
  const ctrValue = Number.parseFloat(String(I2_STATS.ctr).replace("%", "").trim());
  const ctrTargetValue = Number(I2_STATS.ctrTarget);
  const ctrComparable = Number.isFinite(ctrValue) && Number.isFinite(ctrTargetValue) && String(I2_STATS.ctr).trim() !== "—";

  const header = (
    <PageHeader pageId="I2" title="消息推送" summary="管发到 App 消息通知里的业务推送。"
      readOnly={!canWriteI2 ? "你只能查看；改频道、模板、概率和事件要有这页的修改权限。" : undefined}
      meta={readAt ? <span className="rd-toolbar">
        <span>{`${businessClock(readAt)} 读取（${businessZone().label}）`}</span>
        <Button variant="ghost" size="sm" icon={<RefreshCw size={14} aria-hidden />} loading={contentLoading} onClick={() => void actions.reloadIContent()}>刷新</Button>
      </span> : undefined}
      actions={canWriteI2 ? <Button variant="primary" icon={<Plus size={14} aria-hidden />} disabledReason={lockReason("channel-create")} onClick={openNewNova}>新增频道</Button> : undefined} />
  );
  // 恢复行写频道名字，不写频道键；新增、编辑频道的两个间隔写成中文。
  const unknownObject = (row: I2Command) => {
    const key = row.target.startsWith("channel:") ? row.target.slice("channel:".length) : "";
    return key && row.object === key ? channelName(key, novas.find((n) => n.key === key)?.name ?? "") : row.object;
  };
  const unknownChange = (row: I2Command) => {
    // 事件概率只写改了的几类，用中文名，不露类别键。
    if (row.target === "distribution") return row.change.split(" · ").map((part) => /^(\S+) (\S+)% → (\d+)%$/.exec(part))
      .filter((match): match is RegExpExecArray => !!match && match[2] !== match[3])
      .sort((left, right) => orderDist(SOCIAL_DIST).findIndex((item) => item.key === left[1]) - orderDist(SOCIAL_DIST).findIndex((item) => item.key === right[1]))
      .map(([, key, before, after]) => `${operatorCopyText(SOCIAL_DIST.find((item) => item.key === key)?.name ?? key)} ${before}% → ${after}%`).join(" · ");
    if (row.action !== "编辑频道" && row.action !== "新增频道") return row.change;
    const { tick = "", cooldown = "" } = row.cadence ?? {};
    return `扫描间隔 ${durationText(tick).text} · 个人间隔 ${durationText(cooldown).text}`;
  };
  /** 没存出处的记录按原请求和原操作人查，和 queryI2Command 一致。 */
  const investigationRecord = (row: I2Command): FundCommandRecord | undefined => row.original && { ...row, commandOrigin: row.original.commandOrigin
    ?? { originalMethod: row.original.method as "POST", originalPath: `/api/admin/content${row.original.path}`, readAuthority: "content_i2_read", originalAdminId: String(row.original.owner) } };
  const recoveryRows: FundRecoveryRow[] = pending.map((row) => {
    const expired = isRetryExpired(row);
    const label = `${row.action} · ${unknownObject(row)}`;
    const target = investigationRecord(row);
    const query = () => { void queryOriginal(row).catch((error) => toast(displayAdminError(error))); };
    const retryBlocked = recovering ? "等当前操作完成" : !row.original ? "原操作记录不完整，只能查询核对，不能重试。" : !canWriteI2 ? "当前账号没有这项操作权限，请查询原结果。" : undefined;
    return {
      key: row.commandKey, title: <span title={label}>{label}</span>, record: target, outcome: outcomes[row.commandKey], createdAt: row.createdAt, expired,
      canRetry: !expired && !!row.original && canWriteI2, canQuery: canReadI2,
      status: target ? undefined : { tone: "warn", label: expired ? "已过期" : "结果未知", line: "这条记录不完整，查不了原结果，只能重读现在的状态核对。" },
      actions: <>
        {target ? <FundCheckButtons record={target} outcome={outcomes[row.commandKey]} expired={expired} busy={!!checking || !!recovering} checking={checking === row.commandKey}
          onCheck={query} onClose={() => setClosing(row)} />
          : <Button size="sm" loading={checking === row.commandKey} disabled={!!checking} disabledReason={!canReadI2 ? "当前账号没有读取权限" : recovering ? "等当前操作完成" : undefined} onClick={query}>查询原结果</Button>}
        {!expired && <Button size="sm" disabled={!!checking} disabledReason={retryBlocked} onClick={() => void restore(row)}>按原请求重试</Button>}
      </>,
      detail: unknownChange(row) ? <p>{unknownChange(row)}</p> : undefined,
    };
  });
  const unknownNotice = <>
    <FundRecoveryPanel rows={recoveryRows} settled={settledRows} onDismissSettled={(key) => setSettledRows((current) => current.filter((item) => item.key !== key))} />
    {closing && <FundClosureModal label={`${closing.action} · ${unknownObject(closing)}`} createdAt={closing.createdAt} offer={eCommandClosureOffer(outcomes[closing.commandKey], isRetryExpired(closing))}
      facts={unknownChange(closing) ? <Fact k="改动">{unknownChange(closing)}</Fact> : undefined}
      onClose={() => setClosing(null)} onSubmit={async (evidence: FundCommandEvidence) => {
        const record = closing;
        const next = await queryI2Command(record, evidence);
        setOutcomes((current) => ({ ...current, [record.commandKey]: { receipt: next } }));
        setClosing(null);
        if (fundCommandSettled(next)) { settle(record, next!); await refreshAfterMutation(record); }
      }} />}
  </>;

  if (contentLoading && !data) {
    return <>{header}{unknownNotice}{conflictUi}<BlockState state="loading" title="正在读取推送数据…" /></>;
  }
  if (!data) {
    return <>{header}{unknownNotice}{conflictUi}{contentError
      ? <BlockState state="error" title="推送数据读取失败" detail={contentError} onRetry={() => void actions.reloadIContent()} retryLabel="重新加载" />
      : <BlockState state="empty" title="暂无推送数据" />}</>;
  }

  // ── 首屏结论：几个频道在推、有没有推不出去的、素材够不够 ──
  const noPublished = novas.filter((n) => tplStatus(n.key) !== "published");
  const socialChannel = novas.find((n) => n.key === SOCIAL_CHANNEL);
  const recentActive = INITIAL_SOCIAL_EVENTS.filter((event) => event.status === "ACTIVE").length;
  const socialDry = !!socialChannel?.on && recentActive === 0;
  const distTotal = SOCIAL_DIST.reduce((sum, item) => sum + Number(item.pct), 0);
  const distBad = SOCIAL_DIST.length > 0 && distTotal !== 100;
  const problems = noPublished.length > 0 || socialDry || distBad;
  const conclusion = novas.length === 0
    ? <Conclusion state="neutral" icon={Radio} hint={canWriteI2 ? "点右上角「新增频道」建第一个。" : undefined}>还没有频道</Conclusion>
    : <Conclusion state={problems ? "warn" : "ok"} icon={Radio}
      hint={noPublished.length > 0 ? "到「消息模板」给它们写好模板并发布。" : socialDry ? "到「真实动态素材」点「同步事件」取新素材。" : undefined}
      explain={<>
        <p>在推＝频道已启用。启用只说明开关开着；真正发出还要有已发布模板、有素材、到了扫描时间、过了个人间隔，用户也要允许系统通知。</p>
        <p>紧急停用开关把五项业务全部关停时，所有频道都不发；读不到开关状态时也不发。只关停其中几项不影响推送。</p>
        <p>素材按最近读到的 20 条真实事件看，只对「真实动态」频道有意义；发送时每类查最近 100 条，读到的 20 条之外可能还有能用的。</p>
      </>}>
      {`${onlineCount} 个频道在推，共 ${novas.length} 个`}
      {noPublished.length > 0 && `；${noPublished.length} 个没有已发布的模板，启用不了`}
      {socialDry && "；最近读到的 20 条真实事件里没有有效的，可能发不出"}
      {distBad && `；事件概率合计 ${distTotal}%，不是 100%`}
    </Conclusion>;

  const ctrNumber = String(I2_STATS.ctr).replace("%", "").trim() || "—";
  const stats = (
    <StatBand label="推送概况">
      <Stat tone="role-2" icon={Radio} label="已启用频道" value={String(onlineCount)} unit="个" sub={`共 ${novas.length} 个 · 已停用 ${novas.length - onlineCount} 个`}
        explain="频道开关开着的个数，不代表一定发得出。" />
      <Stat tone="role-2" icon={Send} label="今日真实动态" value={String(I2_STATS.todayDelivered)} unit="条" sub="只数真实动态频道"
        explain={`真实动态频道今天（业务日，${businessZone().label}）已发出的通知条数；不含其他频道，也不代表都到了用户手机的系统推送。`} />
      <Stat tone="role-3" icon={History} label="投递批次（累计）" value={String(I2_STATS.weeklySocial)} unit="次" sub="近 7 天投递过的事件"
        explain="最近 7 天投递过的真实事件，各自累计被投递的批次数之和，不只算这 7 天；一批可能发给很多人，不是人数。" />
      <Stat tone="role-4" icon={Timer} label="频道点击率均值" value={ctrNumber} unit={ctrNumber === "—" ? undefined : "%"}
        sub={ctrComparable ? `目标均值 ${ctrTargetValue}% · ${ctrValue > ctrTargetValue ? "已高于目标" : "未到目标"}` : "暂不能和目标比较"}
        explain="各频道存下来的点击率取平均，不是按点击÷送达实时算的；目前没有查到点击后会更新这个值。" />
    </StatBand>
  );

  // ── 频道卡 ──
  const channelCards = novas.map((n) => {
    const st = tplStatus(n.key);
    const t = tplOf(n.key);
    const phase = PHASE_CHANNELS.has(n.key);
    const social = n.key === SOCIAL_CHANNEL;
    const warn = st !== "published"
      ? <StatusTag tone="warn">{st === "missing" ? "没有模板，启用不了" : `模板是${TEMPLATE_STATE_TEXT[st] ?? st}，启用不了`}</StatusTag>
      : social && n.on && recentActive === 0 ? <StatusTag tone="warn" explain="只看了最近读到的 20 条；发送时每类查最近 100 条，可能还有能用的。">最近 20 条里没有有效事件</StatusTag>
        : undefined;
    const toggleBlocked = lockReason(`channel:${n.key}`) || (!n.on && st !== "published" ? "先给它发布模板才能启用" : undefined);
    const cardActions = canWriteI2 ? <>
      <Button size="sm" icon={n.on ? <PowerOff size={14} aria-hidden /> : <Power size={14} aria-hidden />} disabledReason={toggleBlocked} aria-label={`${n.on ? "停用" : "启用"} ${channelName(n.key, n.name)}`} onClick={() => toggleNova(n)}>{n.on ? "停用" : "启用"}</Button>
      <Button size="sm" icon={<Pencil size={14} aria-hidden />} disabledReason={lockReason(`channel:${n.key}`) || (phase ? "跟随「运营阶段设置」，这里不能改" : undefined)} aria-label={`编辑 ${channelName(n.key, n.name)}`} onClick={() => openEditNova(n)}>编辑</Button>
      <MoreMenu label={`${channelName(n.key, n.name)} 的更多操作`} disabled={!!lockReason(`channel:${n.key}`)} items={[{ key: "delete", label: "删除频道", danger: true, onSelect: () => removeNova(n) }]} />
    </> : undefined;
    return (
      <ChannelCard key={n.key} name={channelName(n.key, n.name)} keyText={n.key} on={n.on}
        source={social ? "提现到账等五类真实事件" : sourceText(n.trigger, n.name, RUNTIME_SOURCE_OPTIONS)}
        tick={n.tick} cooldown={n.cd} phase={phase ? <PhaseNote text={n.phaseKeyed} /> : undefined}
        template={t ? { name: t.name, version: t.v } : undefined} templateState={st} warn={warn}
        stats={social ? <div><dt><Send size={14} aria-label="推送量" /></dt><dd>{`今日 ${I2_STATS.todayDelivered} 条 · 累计 ${I2_STATS.weeklySocial} 次`}</dd></div> : undefined}
        ctr={Number.isFinite(n.ctr) ? `${n.ctr}%` : "—"}
        actions={cardActions} onTemplate={t ? () => setDetailTpl(t.ch) : undefined} />
    );
  });

  // ── 事件概率 ──
  const distSegments = orderDist(SOCIAL_DIST).map((item) => ({
    key: item.key, label: operatorCopyText(item.name), value: Number(item.pct), slot: DIST_SLOT[item.key] ?? "other" as const,
    text: `${operatorCopyText(item.name)} ${Number(item.pct)}%${item.key === NO_SOURCE ? "（没有数据源）" : ""}`,
  }));

  // ── 模板 ──
  const sampleEvent = INITIAL_SOCIAL_EVENTS.find((event) => event.status === "ACTIVE") ?? INITIAL_SOCIAL_EVENTS[0] ?? null;
  const langState = (title: string, body: string) => !!title.trim() && !!body.trim();
  const tplRowActions = (t: (typeof NOVA_TPLS)[number], size: "sm" | "md" = "sm") => {
    if (!canWriteI2) return null;
    const st = tplStatus(t.ch);
    const blocked = lockReason(`channel:${t.ch}`);
    if (size === "md") return <>
      {st === "draft" && <Button variant="primary" disabledReason={blocked} icon={<Send size={14} aria-hidden />} onClick={() => publishTpl(t.ch, t.name)}>发布</Button>}
      {st === "draft" && <Button disabledReason={blocked} icon={<Pencil size={14} aria-hidden />} onClick={() => editTpl(t)}>编辑</Button>}
      {st === "published" && <Button disabledReason={blocked} icon={<Ban size={14} aria-hidden />} onClick={() => archiveTpl(t.ch, t.name)}>归档</Button>}
      {st !== "published" && <Button variant="danger-outline" disabledReason={blocked} icon={<Trash2 size={14} aria-hidden />} onClick={() => removeTpl(t)}>删除模板</Button>}
    </>;
    return <>
      {st === "draft" && <Button size="sm" disabledReason={blocked} icon={<Send size={14} aria-hidden />} aria-label={`发布模板 ${t.name}`} onClick={() => publishTpl(t.ch, t.name)}>发布</Button>}
      {st === "published" && <Button size="sm" disabledReason={blocked} icon={<Ban size={14} aria-hidden />} aria-label={`归档模板 ${t.name}`} onClick={() => archiveTpl(t.ch, t.name)}>归档</Button>}
      {st !== "published" && <MoreMenu label={`模板 ${t.name} 的更多操作`} disabled={!!blocked} items={[
        ...(st === "draft" ? [{ key: "edit", label: "编辑", onSelect: () => editTpl(t) }] : []),
        { key: "delete", label: "删除模板", danger: true, onSelect: () => removeTpl(t) },
      ]} />}
    </>;
  };
  const templateChannelOptions = novas.filter((n) => editTplChannel === n.key || !NOVA_TPLS.some((t) => t.ch === n.key))
    .map((n) => ({ value: n.key, label: `${channelName(n.key, n.name)}（${n.key}）` }));
  const tplBlocked = lockReason(`channel:${tplForm.channel}`) || (!tplForm.channel ? "选择频道" : !tplForm.name.trim() ? "填写模板名称" : !tplForm.version.trim() ? "填写版本" : !tplForm.cta ? "选择点击后去哪"
    : !tplForm.titleZh.trim() || !tplForm.bodyZh.trim() ? "填写中文标题和正文" : !tplForm.titleVi.trim() || !tplForm.bodyVi.trim() ? "填写越南语标题和正文"
      : (!!tplForm.titleEn.trim() !== !!tplForm.bodyEn.trim()) ? "英语标题和正文要么都填，要么都空" : undefined);
  const currentTpl = detailTpl ? tplOf(detailTpl) ?? null : null;
  const currentEvent = detailEvent !== null ? visibleSocialEvents.find((event) => event.id === detailEvent) ?? null : null;
  const zone = businessZone().label;
  const eventFiltered = !!eventTypeFilter || !!eventStatusFilter;

  return (
    <div className="i2-page">
      {header}
      {unknownNotice}
      {conflictUi}
      {contentError && <Notice tone="danger" title="最新数据没读到" action={<Button size="sm" onClick={() => void actions.reloadIContent()}>重新加载</Button>}>{`${contentError}下面仍是 ${readAt ? businessClock(readAt) : "上次"} 读到的数据。`}</Notice>}
      {conclusion}
      {stats}

      <Panel title="频道" icon={Radio} tone="role-2" sub={`${novas.length} 个 · 已启用 ${onlineCount} 个`}
        explain="每张卡是一个频道：从哪类事情取材、多久找一次、同一个人隔多久才再收到一条。停用后不再生成新消息，已经发出的不撤回。">
        {novas.length === 0
          ? <BlockState state="empty" title="新增的频道会显示在这里" detail={canWriteI2 ? "新增后先写好模板并发布，再启用。" : undefined} />
          : <div className="i2-channels">{channelCards}</div>}
        <Fold title="不在频道里的推送" inset summary={offTableChannels.length ? `${offTableChannels.length} 条 · 节奏由别处的设置决定` : "没有"}
          explain="市场行情和市场事件通知是两个独立频道，可以分别启停、设间隔。">
          {offTableChannels.length === 0
            ? <p className="i2-muted">节奏表里的频道都在上面；通知活动等别的通知不在这页。</p>
            : <Table label="不在频道里的推送">
              <thead><tr><Th>推送</Th><Th>什么时候推</Th><Th>节奏归谁</Th><Th>状态</Th></tr></thead>
              <tbody>
                {offTableChannels.map((r) => (
                  <Tr key={r.name}>
                    <Td><Cell main={catalogName(r.name)} /></Td>
                    <Td grow><Cell main={readable(r.why)} title={readable(r.why)} /></Td>
                    <Td><Cell main={readable(r.owner)} /></Td>
                    <Td><StatusTag tone={r.tone === "ok" ? "ok" : "done"}>{operatorCopyText(r.st)}</StatusTag></Td>
                  </Tr>
                ))}
              </tbody>
            </Table>}
        </Fold>
      </Panel>

      <PageTabs ids={lowerIds} label="模板和真实动态素材" value={lower} onChange={setLower}
        items={[{ value: "templates", label: "消息模板" }, { value: "material", label: "真实动态素材" }]} />
      <div {...lowerIds.panel("templates")} hidden={lower !== "templates"} className="rd-tab-pane">
      <Panel title="消息模板" icon={FileText} tone="role-4" sub={`${templatePager.total} 个 · 每个频道一个`}
        explain="模板就是用户收到的标题和正文。中文、越南语必填，英语可选；草稿 → 发布 → 归档。点一行看三种语言并排和 App 里的样子。"
        actions={canWriteI2 ? <Button icon={<Plus size={14} aria-hidden />} disabledReason={newMutationReason || (templateChannelOptions.length === 0 ? "每个频道都有模板了；要换内容，先删掉旧模板" : undefined)} onClick={newTpl}>新建模板</Button> : undefined}>
        <Table label="消息模板" className="i2-tpl-table">
          <thead>
            <tr><Th>模板</Th><Th>状态</Th><Th>语言</Th><Th>内容（中文）</Th><Th>点击后去哪</Th>{canWriteI2 && <Th sticky="end">操作</Th>}</tr>
          </thead>
          <tbody>
            {templatePager.pageRows.map((t) => {
              const st = tplStatus(t.ch);
              return (
                <Tr key={t.ch} selected={t.ch === detailTpl} onOpen={() => setDetailTpl(t.ch)}>
                  <Td><Cell main={t.name} sub={`${displayOf(t.ch)} · ${t.v}`} title={t.name} /></Td>
                  <Td><TemplateTag state={st} /></Td>
                  <Td><span className="i2-lang-chips">
                    {([["中", t.titleZh, t.bodyZh, true], ["越", t.titleVi, t.bodyVi, true], ["英", t.titleEn, t.bodyEn, false]] as const).map(([label, title, body, req]) => (
                      <span key={label} data-state={langState(title, body) ? "ok" : req ? "missing" : "empty"} title={`${label === "中" ? "中文" : label === "越" ? "越南语" : "英语"}${langState(title, body) ? "已填" : req ? "缺" : "没填（可选）"}`}>{label}</span>
                    ))}
                  </span></Td>
                  <Td grow><Cell main={nexGridBrandText(t.titleZh) || "—"} sub={nexGridBrandText(t.bodyZh)} title={`${t.titleZh} · ${t.bodyZh}`} /></Td>
                  <Td><Cell main={ctaLabel(CTA_OPTIONS, t.cta)} sub={UNREACHABLE_CTA.has(t.cta) ? "App 打不开" : undefined} title={UNREACHABLE_CTA.has(t.cta) ? UNREACHABLE_TEXT : undefined} /></Td>
                  {canWriteI2 && <Td sticky="end"><span className="rd-row-actions">{tplRowActions(t)}</span></Td>}
                </Tr>
              );
            })}
            {templatePager.total === 0 && <TableMessage columns={canWriteI2 ? 6 : 5}>还没有模板</TableMessage>}
          </tbody>
        </Table>
        {templatePager.total > templatePager.pageSize && <Pager label="消息模板" total={templatePager.total} page={templatePager.page} pageSize={templatePager.pageSize} sizes={[7]} onPage={templatePager.setPage} onPageSize={templatePager.setPageSize} />}
      </Panel>

      </div>
      <div {...lowerIds.panel("material")} hidden={lower !== "material"} className="rd-tab-pane">
      <Panel title="事件概率" icon={Percent} tone="role-2" sub={`五类 · 合计 ${distTotal}%`}
        explain="只管「真实动态」频道：每次先按这组概率选一类，再从这一类有效的最近 100 条里随机取一条。某一类没有有效事件，就按其余几类的比例重新分。"
        actions={canWriteI2 ? <Button icon={<Percent size={14} aria-hidden />} disabledReason={lockReason("distribution") || (SOCIAL_DIST.length === 0 ? "没有读到五类概率" : undefined)} onClick={openDistDrawer}>调整概率</Button> : undefined}>
        {SOCIAL_DIST.length === 0
          ? <BlockState state="empty" title="没有读到事件概率" compact />
          : <div className="i2-dist">
            <SegmentBar label="五类事件概率" segments={distSegments} />
            {distBad && <Notice tone="warn">{`五类合计 ${distTotal}%，不是 100%，点「调整概率」改好。`}</Notice>}
          </div>}
      </Panel>

      <Panel title="真实事件" icon={Database} tone="role-3" sub={eventReadable ? `${visibleEventTotal} 条${eventFiltered ? "（已筛选）" : ""} · 时间为${zone}` : `时间为${zone}`}
        explain={<>
          <p>「真实动态」频道的素材，都从业务表同步来，不能手工添加人物、金额和时间；人物和地区只露第一个字，金额写成区间。</p>
          <p>同步事件：取提现、V 等级、创世节点成交、整点新增注册最近 24 小时的新事件，每条从发生起 12 小时后过期；不发消息、不改业务数据，重复的跳过，删过的不会再同步回来。后台大约每 10 分钟也会自动同步。</p>
        </>}
        actions={canWriteI2 ? <Button icon={<Shuffle size={14} aria-hidden />} loading={eventBusy === "sync"} disabledReason={lockReason("sync") || (eventBusy !== null && eventBusy !== "sync" ? "等当前操作完成" : undefined)} onClick={syncSocialEvents}>同步事件</Button> : undefined}>
        {sample && (
          <div className="i2-sample">
            {sample.value
              ? <>
                <AppNotice lang={sample.lang} title={sample.value.title ?? ""} body={sample.value.body} category={noticeCategory(SOCIAL_CHANNEL)} />
                <p className="i2-sentence">{`${businessClock(sample.at)} 抽到${sample.value.id !== undefined ? ` #${sample.value.id}` : ""}：只是预览，不会发出，也不计投递次数。`}</p>
              </>
              : <Notice tone="warn">这次没抽到能发的真实事件；有新素材时照常推送。</Notice>}
          </div>
        )}
        <FilterBar onClear={() => { setEventTypeFilter(""); setEventStatusFilter(""); setEventPage(1); }} canClear={eventFiltered}
          sort={<span className="rd-row-actions">
            <Select aria-label="预览语言" value={previewLanguage} onChange={(value) => setPreviewLanguage(value as "ZH" | "VI" | "EN")}
              options={[{ value: "VI", label: "越南语" }, { value: "ZH", label: "中文" }, { value: "EN", label: "英语" }]} />
            <Button icon={<Eye size={14} aria-hidden />} loading={eventBusy === "preview"} disabledReason={eventBusy !== null && eventBusy !== "preview" ? "等当前操作完成" : undefined} onClick={previewSocialEvent}>抽一条预览</Button>
          </span>}>
          <FilterField label="类型">
            <Select aria-label="事件类型筛选" value={eventTypeFilter} onChange={(value) => { setEventTypeFilter(value); setEventPage(1); }} placeholder="全部类型"
              options={SOCIAL_EVENT_TYPE_OPTIONS.map((option) => ({ value: option.value, label: operatorCopyText(option.label) }))} />
          </FilterField>
          <FilterField label="状态">
            <Select aria-label="事件状态筛选" value={eventStatusFilter} onChange={(value) => { setEventStatusFilter(value); setEventPage(1); }} placeholder="全部状态"
              options={SOCIAL_EVENT_STATUS_OPTIONS.map((option) => ({ value: option.value, label: operatorCopyText(option.label) }))} />
          </FilterField>
        </FilterBar>
        {!eventError && !eventLoading && eventReadable && visibleEventTotal === 0 && !eventFiltered
          ? <BlockState state="empty" title="还没有真实事件" detail={`没有素材就不发送，不会造假内容。${canWriteI2 ? "点「同步事件」取新事件。" : ""}`} />
          : <Table label="真实事件" className="i2-event-table">
            <thead>
              <tr><Th>事件</Th><Th>状态</Th><Th>发生时间</Th><Th>过期时间</Th><Th align="right">投递</Th>{canWriteI2 && <Th sticky="end">操作</Th>}</tr>
            </thead>
            <tbody>
              {eventError ? <TableMessage columns={canWriteI2 ? 6 : 5} role="alert">
                {eventError} <Button size="sm" onClick={() => setEventRefreshKey((key) => key + 1)}>重新加载事件</Button>
              </TableMessage>
                : eventLoading || !eventReadable ? <TableLoading columns={canWriteI2 ? 6 : 5} />
                  : visibleEventTotal === 0 ? <TableMessage columns={canWriteI2 ? 6 : 5}>这个筛选下没有事件</TableMessage>
                    : visibleSocialEvents.map((event) => (
                      <Tr key={event.id} selected={event.id === detailEvent} onOpen={() => setDetailEvent(event.id)}>
                        <Td grow><Cell main={eventHead(event)} sub={eventWho(event)} title={`${eventHead(event)} · ${eventWho(event)}`} /></Td>
                        <Td>{eventTag(event.status)}</Td>
                        <Td><Cell num main={formatEventTime(event.occurredAt)} /></Td>
                        <Td><Cell num main={formatEventTime(event.expiresAt)} sub={event.status === "DISABLED" && !canRestoreEvent(event.expiresAt) ? "已到期，不能恢复" : undefined} /></Td>
                        <Td align="right"><Cell num main={`${event.dispatchCount ?? 0} 次`} /></Td>
                        {canWriteI2 && <Td sticky="end"><span className="rd-row-actions">
                          {event.status === "ACTIVE" && <Button size="sm" disabledReason={lockReason(`event:${event.id}`) || (eventBusy !== null ? "等当前操作完成" : undefined)} onClick={() => changeSocialEventStatus(event, "DISABLED")}>停用</Button>}
                          {event.status === "DISABLED" && canRestoreEvent(event.expiresAt) && <Button size="sm" disabledReason={lockReason(`event:${event.id}`) || (eventBusy !== null ? "等当前操作完成" : undefined)} onClick={() => changeSocialEventStatus(event, "ACTIVE")}>恢复</Button>}
                          <MoreMenu label={`事件 #${event.id} 的更多操作`} disabled={eventBusy !== null || !!lockReason(`event:${event.id}`)} items={[
                            ...(event.status !== "EXPIRED" ? [{ key: "expire", label: "立即过期", onSelect: () => changeSocialEventStatus(event, "EXPIRED") }] : []),
                            { key: "delete", label: "删除事件", danger: true, onSelect: () => deleteSocialEvent(event) },
                          ]} />
                        </span></Td>}
                      </Tr>
                    ))}
            </tbody>
          </Table>}
        {eventReadable && !eventLoading && visibleEventTotal > EVENT_PAGE_SIZE && (
          <Pager label="真实事件" total={visibleEventTotal} page={eventPage} pageSize={EVENT_PAGE_SIZE} sizes={[EVENT_PAGE_SIZE]} onPage={setEventPage} onPageSize={() => undefined} />
        )}
      </Panel>

      </div>

      <PaginationExemptionList
        items={[
          {
            label: "可调通道节奏表",
            kind: "reference-catalog",
            maxRows: 10,
            reason: "首屏同屏校验通道的检查间隔与个人冷却时间",
          },
          {
            label: offTableTitle,
            maxRows: Math.max(offTableChannels.length, 1),
            reason: offTableChannels.length
              ? "剩余不可调频道只做统计规则闭合说明"
              : "所有频道都在上方节奏表里",
          },
        ]}
      />

      <Drawer open={!!currentTpl} wide onClose={() => setDetailTpl(null)} title="模板详情" icon={FileText} tone="role-4" sub={currentTpl?.name}
        footer={currentTpl && canWriteI2 ? <Decision others={tplRowActions(currentTpl, "md")} /> : undefined}>
        {currentTpl && (() => {
          const t = currentTpl;
          const social = t.ch === SOCIAL_CHANNEL;
          const used = [...new Set([t.titleZh, t.bodyZh, t.titleVi, t.bodyVi, t.titleEn, t.bodyEn].flatMap(placeholdersOf))];
          const ctaNote = UNREACHABLE_CTA.has(t.cta) ? <StatusTag tone="warn">{UNREACHABLE_TEXT}</StatusTag> : undefined;
          return <div className="rd-stack">
            <Facts>
              <Fact k="频道">{displayOf(t.ch)}</Fact>
              <Fact k="状态">{TEMPLATE_STATE_TEXT[tplStatus(t.ch)] ?? tplStatus(t.ch)}</Fact>
              <Fact k="版本">{t.v}</Fact>
              <Fact k="点击后去哪" tone={UNREACHABLE_CTA.has(t.cta) ? "warn" : undefined}>{`${ctaLabel(CTA_OPTIONS, t.cta)}${UNREACHABLE_CTA.has(t.cta) ? `（${UNREACHABLE_TEXT}）` : ""}`}</Fact>
            </Facts>
            {!social && used.length > 0 && <Notice tone="warn">{tplStatus(t.ch) === "published"
              ? `这个频道不替换变量，用户会看到原样的 ${used.join("、")}。换新模板时要删掉变量，否则保存会被拒。`
              : `这个频道不替换变量，带着 ${used.join("、")} 保存或发布都会被拒，先编辑删掉。`}</Notice>}
            <div className="i2-langs">
              {([["ZH", "中文", t.titleZh, t.bodyZh, true], ["VI", "越南语", t.titleVi, t.bodyVi, true], ["EN", "英语", t.titleEn, t.bodyEn, false]] as const).map(([lang, label, title, body, req]) => {
                const filled = langState(title, body);
                const shown = social ? previewText(title, body, lang, sampleEvent) : { title, body };
                return <section key={lang} className="i2-lang" aria-label={label}>
                  <h3 className="i2-lang-head">{label}{filled ? <StatusTag tone="ok">已填</StatusTag> : req ? <StatusTag tone="warn">缺</StatusTag> : <StatusTag tone="done">可选，未填</StatusTag>}</h3>
                  <dl className="i2-lang-text">
                    <div><dt>标题</dt><dd>{nexGridBrandText(title) || "—"}</dd></div>
                    <div><dt>正文</dt><dd>{nexGridBrandText(body) || "—"}</dd></div>
                  </dl>
                  <AppNotice lang={lang} title={shown.title} body={shown.body} cta={t.cta} ctaNote={ctaNote} raw={!social} category={noticeCategory(t.ch)}
                    missing={filled ? undefined : req ? `${label}没填，发布会被拒` : "没填英语：中文、越南语以外的用户收到通用英文提示，有译文的语言用译文"} />
                </section>;
              })}
            </div>
            <p className="i2-sentence">{social
              ? sampleEvent ? `预览用最近一条真实事件 #${sampleEvent.id} 填进变量；用户收到时换成当时抽到的事件。` : "现在没有真实事件，预览里变量原样显示。"
              : "这个频道发送时直接用模板原文。"}</p>
          </div>;
        })()}
      </Drawer>

      <Drawer open={!!currentEvent} onClose={() => setDetailEvent(null)} title="事件详情" icon={Database} tone="role-3" sub={currentEvent ? `#${currentEvent.id} · 时间为${zone}` : undefined}>
        {currentEvent && (() => {
          const event = currentEvent;
          const busy = lockReason(`event:${event.id}`) || (eventBusy !== null ? "等当前操作完成" : undefined);
          const restorable = event.status === "DISABLED" && canRestoreEvent(event.expiresAt);
          return <div className="rd-stack">
            <Facts>
              <Fact k="事件">{eventText(event)}</Fact>
              <Fact k="来源备注">{noteText(event.sourceNote)}</Fact>
              <Fact k="类型">{eventType(event)}</Fact>
              <Fact k="状态">{statusLabel(event.status)}</Fact>
              <Fact k="发生时间">{formatEventTime(event.occurredAt)}</Fact>
              <Fact k="过期时间">{formatEventTime(event.expiresAt)}</Fact>
              <Fact k="核验时间">{formatEventTime(event.verifiedAt)}</Fact>
              <Fact k="最近投递">{formatEventTime(event.lastDispatchedAt)}</Fact>
              <Fact k="投递次数">{`${event.dispatchCount ?? 0} 次（按批次）`}</Fact>
              <Fact k="来源">{({ WITHDRAWAL: "提现记录", V_RANK: "会员等级记录", GENESIS: "创世节点记录", REGISTRATION: "注册记录" } as Record<string, string>)[event.sourceSystem ?? ""] ?? "业务系统"}</Fact>
              <Fact k="来源编号"><span data-mono="">{event.sourceEventId || "已脱敏"}</span></Fact>
            </Facts>
            {canWriteI2 && <section className="i2-event-ops" aria-label="能做什么">
              <h3 className="i2-lang-head">能做什么</h3>
              {event.status === "ACTIVE" && <div className="i2-event-op"><div><b>停用</b><p>暂时不用，过期前可以恢复。</p></div><Button disabledReason={busy} onClick={() => changeSocialEventStatus(event, "DISABLED")}>停用</Button></div>}
              {event.status === "DISABLED" && <div className="i2-event-op"><div><b>恢复</b><p>{restorable ? "重新可以被抽到，直到原过期时间。" : "已过过期时间，不能恢复。"}</p></div>{restorable && <Button icon={<RotateCcw size={14} aria-hidden />} disabledReason={busy} onClick={() => changeSocialEventStatus(event, "ACTIVE")}>恢复</Button>}</div>}
              {event.status !== "EXPIRED" && <div className="i2-event-op"><div><b>立即过期</b><p>永久不再被抽到，不能恢复；原过期时间不变。</p></div><Button variant="danger-outline" disabledReason={busy} onClick={() => changeSocialEventStatus(event, "EXPIRED")}>立即过期</Button></div>}
              <div className="i2-event-op"><div><b>删除</b><p>从列表删掉；同一来源不会再同步回来，原业务记录不变。</p></div><Button variant="danger-outline" icon={<Trash2 size={14} aria-hidden />} disabledReason={busy} onClick={() => deleteSocialEvent(event)}>删除事件</Button></div>
              <p className="i2-sentence">这几种都不撤回已经发出的消息。</p>
            </section>}
          </div>;
        })()}
      </Drawer>

      {distDrawer && (
        <DistDrawer items={orderDist(SOCIAL_DIST)} draft={distDraft} setDraft={setDistDraft} total={distDraftTotal} valid={distDraftValid}
          onClose={() => setDistDrawer(false)} onSubmit={submitDistribution} />
      )}
      {novaDrawer && (
        <ChannelDrawer editing={!!editNovaKey} form={form} setForm={setForm} cadenceError={cadenceError} sources={RUNTIME_SOURCE_OPTIONS}
          locked={drawerSubmitting || !!drawerPendingKey} saving={drawerSubmitting} retry={!!drawerPendingKey} error={drawerPendingKey ? null : drawerError}
          blocked={drawerPendingKey ? (() => { const row = pending.find((item) => item.commandKey === drawerPendingKey); return row && isRetryExpired(row) ? "已超过 24 小时，不能再重试，只能查询。" : !canWriteI2 ? "当前账号没有这项操作权限，请查询原结果。" : undefined; })() : lockReason(editNovaKey ? `channel:${editNovaKey}` : `channel-name:${form.name.trim()}`)}
          fixedSource={editNovaKey && !form.runtimeSource ? (() => { const prev = drawerSource.current?.channels.find((x) => x.key === editNovaKey); return prev ? sourceText(prev.trigger, prev.name, drawerSource.current?.runtimeSourceOptions ?? []) : ""; })() : undefined}
          onClose={closeDrawer} onSubmit={() => void submitDrawer()} />
      )}
      {tplDrawer && (
        <TemplateDrawer editing={!!editTplChannel} form={tplForm} setForm={setTplForm} channels={templateChannelOptions} ctaOptions={CTA_OPTIONS}
          social={tplForm.channel === SOCIAL_CHANNEL} sample={sampleEvent} blocked={tplBlocked} onClose={closeTplDrawer} onSubmit={submitTpl} />
      )}
    </div>
  );
}

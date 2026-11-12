"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { BellDot, BellRing, CircleHelp, FilePenLine, PenLine, History, RefreshCw, RotateCcw, Scale, ShieldAlert, ShieldCheck, TriangleAlert, SlidersHorizontal, Upload, UserRound, Users } from "lucide-react";
import {
  BlockState, Button, Cell, Change, Conclusion, Decision, Drawer, Explain, Fact, Facts, Fold, IrreversibleTag, JudgmentPoints,
  Notice, PageHeader, PageTabs, Pager, Panel, ScaleBar, SearchSelect, StatusTag, Table, TableMessage, Td, Th, Tr, useTabIds,
} from "@/app/components/rd";
import { displayAdminError } from "@/lib/admin/error-messages";
import {
  K1OutcomeUncertainError,
  K4_DIMENSION_KEYS,
  fetchK4WithdrawalAlerts,
  markK4WithdrawalAlertRead,
  newK1CommandKey,
  type K4Model,
  type K4ModelDraftInput,
  type K4ScoreHistory,
  type K4ScoreMappingKey,
  type K4User,
  type K4UserOption,
  type K4WithdrawalAlert,
} from "@/lib/admin/k-client";
import { createSlotAttemptStore, type SlotAttemptRecord } from "@/lib/admin/pending-mutation-store";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { useReach } from "@/lib/nav/use-reach";
import type { KCtx } from "./types";
import {
  BandAxis, BandValues, ContributionTable, Distribution, K4_MAPPING_FIELDS, MAPPING_GROUPS, MappingEditGroup, MappingView, ModelDiff,
  NumberEditRow, VersionFacts, WeightEditRow, WeightTable, changedCount, editableModel, fieldName, fmt, modelDiffRows, type EditableModel,
} from "./k4-parts";

/** 一个操作槽位(`override:用户号` / `model-publish` / …)同时只有一次在途尝试:
 *  输入指纹没变就复用命令号,变了铸新号并丢弃旧号。落 sessionStorage,刷新后重试仍去重。 */
const commandAttempts = createSlotAttemptStore({
  storageKey: "nexion-admin-k4-scoring-commands-v1",
});

function errorText(error: unknown) {
  return error instanceof Error ? displayAdminError(error) : "操作失败，请稍后重试";
}

type K4Tab = "model" | "users" | "alerts";

/**
 * 从用户详情「去风险评分规则」带进来的用户（`/risk/scoring?userCode=…&returnTo=…`）。
 * 界面已备好：带着用户进来时直接打开「用户分数」并查这位用户，顶上给「返回用户详情」。
 * 待代码 worker 接线：从网址读 userCode / returnTo 填到这里（现在没有读，见重构说明 B01）。
 */
const INBOUND_USER: { userNo: string; returnTo: string | null } | null = null;

/** 待确认记录的槽位名换成运营看得懂的操作名。 */
function slotLabel(slot: string) {
  if (slot === "model-draft") return "保存评分规则草稿";
  if (slot === "model-publish") return "发布评分规则草稿";
  if (slot === "batch-recompute") return "全部恢复系统评分";
  if (slot.startsWith("model-restore-")) return `把旧版本 v${slot.slice("model-restore-".length)} 恢复为草稿`;
  if (slot.startsWith("override:")) return `手动改分 · ${slot.slice("override:".length)}`;
  if (slot.startsWith("recompute:")) return `恢复系统评分 · ${slot.slice("recompute:".length)}`;
  return "评分操作";
}

const timeText = (value: number) => {
  const date = new Date(value);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const STATE_TEXT: Record<string, string> = { active: "生效中", draft: "草稿", archived: "已归档" };
const SCORE_STATE_TEXT: Record<string, string> = { "manually-overridden": "人工改分", "model-scored": "系统评分" };
const PRIORITY_TEXT: Record<string, string> = { ESCALATED: "已转人工审核" };
const bandOf = (score: number, model: Pick<K4Model, "bandLowMax" | "bandHighMin">) => score >= model.bandHighMin ? "高风险" : score >= model.bandLowMax ? "中风险" : "低风险";
/** 分档标签：低风险对勾、中风险警示、高风险盾牌，不用时钟。 */
function BandTag({ tone, children }: { tone: string; children: ReactNode }) {
  const state = bandState(tone);
  return <StatusTag tone={state} icon={state === "danger" ? ShieldAlert : state === "warn" ? TriangleAlert : ShieldCheck}>{children}</StatusTag>;
}
const bandState = (tone: string) => (tone === "bad" || tone === "danger" ? "danger" : tone === "warn" ? "warn" : "ok") as "danger" | "warn" | "ok";

export function K4HeaderActions() {
  return null;
}

export function K4Scoring({ ctx }: { ctx: KCtx }) {
  const session = useAdminAuth((state) => state.session);
  const authorities = session?.authorities ?? [];
  const isSuperAdmin = session?.role === "superadmin";
  const canModelWrite = authorities.includes("risk_k4_write");
  const canPublish = isSuperAdmin && authorities.includes("risk_k4_write");
  const canOverride = authorities.includes("risk_k4_user_override");
  const canRecompute = authorities.includes("risk_k4_user_recompute");
  const canReadWithdrawalAlerts = canOverride || isSuperAdmin;
  const reach = useReach();
  const overview = ctx.risk.scoring;
  const [modelDraft, setModelDraft] = useState<EditableModel | null>(null);
  const [userSearch, setUserSearch] = useState("");
  const [userOptions, setUserOptions] = useState<K4UserOption[]>([]);
  const [userSearchFor, setUserSearchFor] = useState<string | null>(null);
  const [userSearchLoading, setUserSearchLoading] = useState(false);
  const [userSearchError, setUserSearchError] = useState<string | null>(null);
  const [lookupUser, setLookupUser] = useState<K4User | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [overridePage, setOverridePage] = useState(1);
  const [overridePageSize, setOverridePageSize] = useState(5);
  const [withdrawalAlerts, setWithdrawalAlerts] = useState<K4WithdrawalAlert[]>([]);
  const [withdrawalAlertError, setWithdrawalAlertError] = useState<string | null>(null);
  const [alertsLoaded, setAlertsLoaded] = useState(false);
  const [alertsReading, setAlertsReading] = useState(false);
  const [alertBusy, setAlertBusy] = useState<string | null>(null);
  const [alertUnknown, setAlertUnknown] = useState<string[]>([]);
  const [tab, setTab] = useState<K4Tab>(INBOUND_USER ? "users" : "model");
  const [editorOpen, setEditorOpen] = useState(false);
  const [historyEntry, setHistoryEntry] = useState<K4ScoreHistory | null>(null);
  const [pending, setPending] = useState<SlotAttemptRecord[]>([]);
  const [readAt, setReadAt] = useState<number | null>(null);
  const tabIds = useTabIds();
  const pageEffectMounted = useRef(false);
  const lookupSequence = useRef(0);
  const inboundLoaded = useRef(false);

  const syncPending = useCallback(() => setPending(commandAttempts.list()), []);
  useEffect(() => { syncPending(); }, [syncPending]);
  useEffect(() => { if (overview) setReadAt(Date.now()); }, [overview]);

  const sourceModel = overview ? (overview.draft ?? overview.model) : null;
  const sourceSignature = sourceModel
    ? `${sourceModel.state}:${sourceModel.version}:${sourceModel.rowVersion}:${JSON.stringify(sourceModel.weights)}:${JSON.stringify(sourceModel.inputSources)}:${JSON.stringify(sourceModel.scoreMappings)}:${sourceModel.bandLowMax}:${sourceModel.bandHighMin}:${sourceModel.autoEscalateScore}`
    : "";

  useEffect(() => {
    if (sourceModel) setModelDraft(editableModel(sourceModel));
    else setModelDraft(null);
    // sourceSignature captures every editable authoritative field.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceSignature]);

  const reloadCurrentScoring = () => ctx.reloadKRisk({
    scoring: { overridePageNum: overridePage, overridePageSize },
  });

  useEffect(() => {
    if (!pageEffectMounted.current) {
      pageEffectMounted.current = true;
      return;
    }
    void reloadCurrentScoring();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overridePage, overridePageSize]);

  const readWithdrawalAlerts = useCallback(() => {
    let alive = true;
    setAlertsReading(true);
    fetchK4WithdrawalAlerts()
      .then((data) => {
        if (!alive) return;
        setWithdrawalAlerts(data.alerts);
        setWithdrawalAlertError(null);
        setAlertUnknown([]);
      })
      .catch((error) => {
        if (!alive) return;
        setWithdrawalAlerts([]);
        setWithdrawalAlertError(errorText(error));
      })
      .finally(() => {
        if (!alive) return;
        setAlertsLoaded(true);
        setAlertsReading(false);
      });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!canReadWithdrawalAlerts) return;
    return readWithdrawalAlerts();
  }, [canReadWithdrawalAlerts, readWithdrawalAlerts]);

  useEffect(() => {
    if (!overview) return;
    let alive = true;
    const timer = window.setTimeout(() => {
      setUserSearchLoading(true);
      setUserSearchError(null);
      ctx.actions.searchK4Users(userSearch)
        .then((options) => {
          if (alive) setUserOptions(options);
        })
        .catch((error) => {
          if (!alive) return;
          setUserOptions([]);
          setUserSearchError(errorText(error));
        })
        .finally(() => {
          if (!alive) return;
          setUserSearchLoading(false);
          setUserSearchFor(userSearch);
        });
    }, 240);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [ctx.actions, overview, userSearch]);

  const runAction = async (
    operation: string,
    fingerprint: string,
    work: (commandKey: string) => Promise<void>,
    successText: string,
    afterReload?: () => Promise<unknown>,
  ) => {
    const commandKey = commandAttempts.resolve(operation, fingerprint, newK1CommandKey);
    let writeConfirmed = false;
    try {
      await work(commandKey);
      writeConfirmed = true;
      commandAttempts.forget(operation);
      try {
        await reloadCurrentScoring();
        if (afterReload) await afterReload();
      } catch (error) {
        ctx.toast(`操作已生效，但页面刷新失败。请不要重复提交，点「重新加载」核对 · ${errorText(error)}`);
        return;
      }
      ctx.toast(successText);
    } catch (error) {
      if (writeConfirmed) return;
      if (error instanceof K1OutcomeUncertainError) {
        ctx.toast(`结果暂未确认 · 请保留弹窗直接重试，或先核对 · 命令号 ${commandKey}`);
      } else {
        commandAttempts.forget(operation);
        ctx.toast(`操作失败 · ${errorText(error)}`);
      }
      throw error;
    } finally {
      syncPending();
    }
  };

  const loadUser = async (id: string): Promise<K4User | null> => {
    const sequence = ++lookupSequence.current;
    const userNo = id.trim();
    setLookupUser(null);
    setLookupError(null);
    setLookupLoading(false);
    if (!userNo) {
      setLookupError("请输入用户编号后再查询");
      return null;
    }
    setLookupLoading(true);
    try {
      const user = await ctx.actions.fetchK4User(userNo);
      if (sequence !== lookupSequence.current) return null;
      setLookupUser(user);
      setUserSearch(user.userNo);
      return user;
    } catch (error) {
      if (sequence !== lookupSequence.current) return null;
      setLookupUser(null);
      setLookupError(errorText(error));
      ctx.toast(`查询失败 · ${errorText(error)}`);
      return null;
    } finally {
      if (sequence === lookupSequence.current) setLookupLoading(false);
    }
  };

  const selectLookupUser = async (option: K4UserOption) => {
    setUserSearch(option.userNo);
    await loadUser(option.userNo);
  };

  const userFacts = (user: K4User) => (
    <Facts>
      <Fact k="用户">{user.userNo}</Fact>
      <Fact k="现在的有效分">{user.effectiveScore} 分 · {user.bandLabel}{user.overridden ? "（人工改分）" : ""}</Fact>
      <Fact k="系统评分">{user.modelScore} 分 · 规则版本 {user.modelVersion}</Fact>
    </Facts>
  );

  const openOverride = (user: K4User) => {
    ctx.openConfirm({ briefKind: "judgment",
      errorHandled: true,
      action: `手动改分 · ${user.userNo}`,
      title: "手动改分",
      effect: <StatusTag tone="progress" filled>立即生效</StatusTag>,
      detail: `把这个用户的风险分从 ${user.effectiveScore} 改成指定分数，马上生效，并记入操作记录。`,
      content: userFacts(user),
      statedBrief: {
        impact: "有效分立即改成新分数，提现审核和提现升级告警按它判断；之后系统评分照常更新，但发布新规则、后台重算都保留这个改分，直到有人点「恢复系统评分」或「全部恢复系统评分」。",
        check: "提交前已核对：分数是 0–100 的整数；这位用户的评分在你打开后没有被别人改过（按版本号核对）。",
      },
      reasonPlaceholder: "写清依据，例如：工单号、核实过的关联证据",
      reason: true,
      input: { label: "新的风险分（0–100）", placeholder: "例如 35", kind: "number", min: 0, max: 100, step: 1,
        validate: (value) => value.trim() === "" ? undefined : /^\d+$/.test(value.trim()) && Number(value) <= 100 ? undefined : "要填 0–100 的整数" },
      okLabel: "确认改分",
      run: (reason, value) => {
        const score = Number(value);
        if (!Number.isInteger(score) || score < 0 || score > 100) {
          ctx.toast("风险分要填 0–100 的整数");
          throw new Error("SCORE_OVERRIDE_INVALID");
        }
        const fingerprint = JSON.stringify({ userNo: user.userNo, score, expectedVersion: user.rowVersion, reason });
        return runAction(
          `override:${user.userNo}`,
          fingerprint,
          (commandKey) => ctx.actions.overrideK4Score(user.userNo, score, user.rowVersion, reason, commandKey),
          `用户 ${user.userNo} 的风险分已修改`,
          async () => { await loadUser(user.userNo); },
        );
      },
    });
  };

  const openRecompute = (user: K4User) => {
    ctx.openConfirm({ briefKind: "judgment",
      errorHandled: true,
      action: `恢复系统评分 · ${user.userNo}`,
      title: "恢复系统评分",
      effect: <StatusTag tone="progress" filled>立即生效</StatusTag>,
      detail: `取消人工改的分，按当前评分规则重新计算。当前分 ${user.effectiveScore}，系统算的分 ${user.modelScore}。`,
      content: <>{userFacts(user)}{overview && <Notice tone="progress">按当前生效的 v{overview.model.version} 重新计算这一位用户，不是恢复成以前存的旧分；没有人工改分时也可以用它马上重算。</Notice>}</>,
      statedBrief: {
        impact: "清除这位用户的人工改分，按当前生效的规则重新计算系统评分，算出的分立即生效。",
        check: "提交前已核对：这位用户的评分在你打开后没有被别人改过（按版本号核对）。",
      },
      reasonPlaceholder: "写清依据，例如：工单号、申诉已核实",
      reason: true,
      okLabel: "确认重算",
      run: (reason) => {
        const fingerprint = JSON.stringify({ userNo: user.userNo, expectedVersion: user.rowVersion, reason });
        return runAction(
          `recompute:${user.userNo}`,
          fingerprint,
          (commandKey) => ctx.actions.recomputeK4Score(user.userNo, user.rowVersion, reason, commandKey),
          `用户 ${user.userNo} 已恢复系统评分`,
          async () => { await loadUser(user.userNo); },
        );
      },
    });
  };

  const prepareRecompute = async (userNo: string) => {
    const user = await loadUser(userNo);
    if (user) openRecompute(user);
  };

  useEffect(() => {
    if (!overview || overview.recomputePending <= 0) return;
    let cancelled = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        await ctx.refreshK4Scoring({ overridePageNum: overridePage, overridePageSize });
        if (!cancelled && lookupUser
            && lookupUser.modelVersion !== `k4-v${overview.model.version}`) {
          await loadUser(lookupUser.userNo);
        }
      } catch {
        // Keep the last authoritative snapshot visible; the next poll retries only the read.
      } finally {
        if (!cancelled) timer = window.setTimeout(poll, 1500);
      }
    };
    timer = window.setTimeout(poll, 1500);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
    // Re-arm only when queue or selected-user version changes; ctx methods are stable in KDomainView.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overview?.recomputePending, overview?.model.version, overridePage, overridePageSize,
    lookupUser?.userNo, lookupUser?.modelVersion]);

  // 带着用户进来：概览读到后查一次这位用户（入口见 INBOUND_USER）。
  useEffect(() => {
    if (!overview || !INBOUND_USER || inboundLoaded.current) return;
    inboundLoaded.current = true;
    setUserSearch(INBOUND_USER.userNo);
    void loadUser(INBOUND_USER.userNo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overview]);

  const markAlertRead = async (alert: K4WithdrawalAlert) => {
    setAlertBusy(alert.id);
    try {
      await markK4WithdrawalAlertRead(alert.id);
      setWithdrawalAlerts((current) => current.map((item) => item.id === alert.id ? { ...item, read: true } : item));
    } catch (error) {
      ctx.toast(`标记已读失败 · ${errorText(error)}`);
      // 告警已读后端不按命令号去重：结果未知只给读回核对，不给原样重试。
      if (error instanceof K1OutcomeUncertainError) setAlertUnknown((current) => [...current, alert.id]);
    } finally {
      setAlertBusy(null);
    }
  };

  const unreadAlerts = withdrawalAlerts.filter((alert) => !alert.read).length;

  const header = (
    <PageHeader pageId="K4" title="风险评分规则" summary="维护给用户打风险分的模型，查单个用户为什么是这个分。"
      meta={readAt && overview && !ctx.contentError ? `读取于 ${timeText(readAt)}（本机时间）· 待重新计算时每 1.5 秒自动刷新，其余手动刷新` : undefined}
      readOnly={canModelWrite || canOverride || canRecompute ? undefined : "当前账号只能查看这页"}
      actions={<Button icon={<RefreshCw size={14} aria-hidden />} loading={ctx.contentLoading && Boolean(overview)} onClick={() => void reloadCurrentScoring().catch(() => undefined)}>刷新</Button>} />
  );

  const pendingBars = pending.length > 0 && (
    <div className="k4-pending">
      {pending.map((record) => (
        <Notice key={record.commandKey} tone="warn" title={`${slotLabel(record.fingerprint)} · 结果待确认`} actionBelow
          action={<Button size="sm" icon={<RefreshCw size={14} aria-hidden />} onClick={() => void reloadCurrentScoring().catch(() => undefined)}>重新读取核对</Button>}>
          <p>上次提交没有收到明确结果，可能已经生效。先重新读取核对；确认没生效，再用原来的内容和理由重新提交，系统沿用同一个命令号，不会重复执行。</p>
          <p className="k4-quiet">命令号 <span data-mono="">{record.commandKey}</span> · 本页记录到 {timeText(record.expiresAt)} 失效</p>
        </Notice>
      ))}
    </div>
  );

  const inboundNotice = INBOUND_USER && (
    <Notice tone="progress" title={`从用户详情带入 ${INBOUND_USER.userNo}`}
      action={INBOUND_USER.returnTo ? <Link className="rd-link" href={INBOUND_USER.returnTo}>返回用户详情</Link> : undefined}>
      已打开「用户分数」并查这位用户的评分。
    </Notice>
  );

  if (ctx.contentLoading) {
    return (
      <>
        {header}
        {pendingBars}
        <div className="k4-loading" aria-label="正在读取风险评分">
          <div className="rd-skeleton k4-skel-line" />
          <div className="rd-skeleton k4-skel-tabs" />
          <div className="k4-skel-grid"><div className="rd-skeleton" /><div className="rd-skeleton" /></div>
          <div className="rd-skeleton k4-skel-block" />
        </div>
      </>
    );
  }

  if (ctx.contentError) {
    return (
      <>
        {header}
        {pendingBars}
        <Conclusion state="unknown" icon={ShieldCheck}>风险评分读取失败，这页没有判断</Conclusion>
        <Panel title="风险评分">
          <BlockState state="error" title="风险评分加载失败" detail={<><p>{ctx.contentError}</p><p>为避免误判，不显示旧数据，也不能保存、发布或改分。</p></>}
            retryLabel="重新加载" onRetry={() => void reloadCurrentScoring().catch(() => undefined)} />
        </Panel>
      </>
    );
  }

  if (!overview || !sourceModel) {
    return (
      <>
        {header}
        {pendingBars}
        <Conclusion state="unknown" icon={ShieldCheck}>风险评分暂不可用，这页没有判断</Conclusion>
        <Panel title="风险评分">
          <BlockState state="error" title="没有拿到当前生效的评分规则" detail="后端没有返回生效模型，这页不拿默认值代替。请重新加载，仍然没有就联系值班人员。"
            retryLabel="重新加载" onRetry={() => void reloadCurrentScoring().catch(() => undefined)} />
        </Panel>
      </>
    );
  }

  const edit = modelDraft ?? editableModel(sourceModel);
  const modelDirty = JSON.stringify(edit) !== JSON.stringify(editableModel(sourceModel));
  const weightTotal = K4_DIMENSION_KEYS.reduce((total, key) => total + edit.weights[key], 0);
  const modelInput: K4ModelDraftInput = {
    expectedVersion: overview.draft?.rowVersion ?? overview.model.rowVersion,
    weights: edit.weights,
    inputSources: edit.inputSources,
    scoreMappings: edit.scoreMappings,
    lowMax: edit.bandLowMax,
    highMin: edit.bandHighMin,
    autoEscalateScore: edit.autoEscalateScore,
  };
  const modelValid = weightTotal === 100
    && K4_DIMENSION_KEYS.every((key) => Number.isInteger(edit.weights[key]) && edit.weights[key] >= 0 && edit.weights[key] <= 100)
    && Number.isInteger(edit.bandLowMax) && edit.bandLowMax >= 0 && edit.bandLowMax < edit.bandHighMin
    && Number.isInteger(edit.bandHighMin) && edit.bandHighMin <= 100
    && Number.isInteger(edit.autoEscalateScore) && edit.autoEscalateScore >= 70
    && edit.autoEscalateScore >= edit.bandHighMin && edit.autoEscalateScore <= 100;
  const orderedMappings = (...keys: K4ScoreMappingKey[]) => keys.every((key, index) => index === 0
    || edit.scoreMappings[keys[index - 1]] <= edit.scoreMappings[key]);
  const mappingsValid = K4_MAPPING_FIELDS.every((field) => {
    const value = edit.scoreMappings[field.key];
    return Number.isInteger(value) && value >= field.min && value <= field.max;
  }) && edit.scoreMappings["multiAccount.mediumMin"] < edit.scoreMappings["multiAccount.highMin"]
    && edit.scoreMappings["account.newDays"] < edit.scoreMappings["account.matureDays"]
    && orderedMappings("multiAccount.mediumScore", "multiAccount.highScore", "multiAccount.fraudScore")
    && orderedMappings("arbitrage.singleScore", "arbitrage.repeatScore", "arbitrage.severeScore")
    && orderedMappings("withdraw.baselineScore", "withdraw.highScore")
    && orderedMappings("account.middleScore", "account.newLargeScore")
    && orderedMappings("anomaly.lowScore", "anomaly.tamperScore");
  const dist = overview.distribution;
  const overridesPage = overview.overrides;
  const overrides = overridesPage.records;
  const activeEdit = editableModel(overview.model);
  const draftEdit = overview.draft ? editableModel(overview.draft) : null;
  const draftRows = draftEdit ? modelDiffRows(activeEdit, draftEdit, overview.dimensions) : [];
  const nextDraftVersion = overview.draft?.version ?? Math.max(overview.model.version, ...overview.modelHistory.map((model) => model.version)) + 1;
  const names = new Map(overview.dimensions.map((item) => [item.dimKey, item.name]));

  // 编辑抽屉里每一项的填错提示：只把旧页面已有的整体校验拆到对应字段，规则不变。
  const issues: Record<string, string | undefined> = {};
  for (const key of K4_DIMENSION_KEYS) {
    const value = edit.weights[key];
    if (!Number.isInteger(value) || value < 0 || value > 100) issues[`w-${key}`] = "要填 0–100 的整数";
  }
  if (weightTotal !== 100) issues.weightTotal = `五项权重合计 ${weightTotal}%，要正好等于 100%（不参与评分的维度也算在内）`;
  if (!Number.isInteger(edit.bandLowMax) || edit.bandLowMax < 0 || edit.bandLowMax > 100) issues.low = "要填 0–100 的整数";
  else if (edit.bandLowMax >= edit.bandHighMin) issues.low = "要小于高风险起始分";
  if (!Number.isInteger(edit.bandHighMin) || edit.bandHighMin < 0 || edit.bandHighMin > 100) issues.high = "要填 0–100 的整数";
  if (!Number.isInteger(edit.autoEscalateScore) || edit.autoEscalateScore < 70 || edit.autoEscalateScore > 100) issues.esc = "要填 70–100 的整数";
  else if (edit.autoEscalateScore < edit.bandHighMin) issues.esc = "不能低于高风险起始分";
  for (const field of K4_MAPPING_FIELDS) {
    const value = edit.scoreMappings[field.key];
    if (!Number.isInteger(value) || value < field.min || value > field.max) issues[field.key] = `要填 ${fmt(field.min)}–${fmt(field.max)} 的整数`;
  }
  const after = (later: K4ScoreMappingKey, earlier: K4ScoreMappingKey, text: string, strict = false) => {
    if (issues[later]) return;
    const a = edit.scoreMappings[earlier];
    const b = edit.scoreMappings[later];
    if (strict ? !(a < b) : !(a <= b)) issues[later] = text;
  };
  after("multiAccount.highMin", "multiAccount.mediumMin", "要大于中风险关联组最少账号数", true);
  after("account.matureDays", "account.newDays", "要大于新账户天数", true);
  after("multiAccount.highScore", "multiAccount.mediumScore", "不能低于中风险关联账户的分");
  after("multiAccount.fraudScore", "multiAccount.highScore", "不能低于高风险关联账户的分");
  after("arbitrage.repeatScore", "arbitrage.singleScore", "不能低于单次异常套利的分");
  after("arbitrage.severeScore", "arbitrage.repeatScore", "不能低于重复套利的分");
  after("withdraw.highScore", "withdraw.baselineScore", "不能低于超过平时水平的分");
  after("account.newLargeScore", "account.middleScore", "不能低于普通新账户的分");
  after("anomaly.tamperScore", "anomaly.lowScore", "不能低于一般异常的分");
  const issueCount = Object.values(issues).filter(Boolean).length;
  const editRows = modelDiffRows(editableModel(sourceModel), edit, overview.dimensions);
  const editChanged = changedCount(editRows);

  const saveModel = () => {
    if (!modelValid || !mappingsValid) {
      ctx.toast("设置有误：权重加起来要等于 100%，自动升级线不能低于高风险下限，各档分数要从低到高");
      return;
    }
    if (!modelDirty) {
      ctx.toast("没有待保存的模型修改");
      return;
    }
    ctx.openActionConfirm({ briefKind: "config",
      action: "保存评分规则草稿",
      title: "保存评分规则草稿",
      effect: <StatusTag tone="neutral" filled>只存草稿，不改线上评分</StatusTag>,
      confirmLabel: "保存草稿",
      detail: `在当前${overview.draft ? "草稿" : "生效规则"}的基础上保存。保存后不影响线上评分，需要超级管理员另外发布。`,
      facts: (
        <Facts>
          <Fact k="保存为">{overview.draft ? `草稿 v${overview.draft.version}（覆盖现在的草稿）` : `新草稿 v${nextDraftVersion}`}</Fact>
          <Fact k="线上">仍按生效的 v{overview.model.version} 评分</Fact>
        </Facts>
      ),
      content: <div className="rd-impact"><p className="rd-impact-title">这次改的 {editChanged} 项（和{overview.draft ? `草稿 v${overview.draft.version}` : `生效 v${overview.model.version}`} 比）</p><ModelDiff rows={editRows} /></div>,
      statedBrief: {
        impact: "只保存草稿，线上评分、用户分数和提现审核都不变；要有发布权限的超级管理员发布后才生效。",
        check: "提交前已核对：五项权重合计 100%，分档线从低到高，自动升级线在 70–100 分且不低于高风险起始分，20 项细则都在范围内、次序正确。",
      },
      reasonPlaceholder: "写清为什么调整，例如：复盘结论、工单号",
      run: async (reason) => {
        const fingerprint = JSON.stringify({ ...modelInput, reason });
        await runAction(
          "model-draft",
          fingerprint,
          (commandKey) => ctx.actions.saveK4ModelDraft(modelInput, reason, commandKey),
          "评分规则草稿已保存，线上评分不变",
        );
        setEditorOpen(false);
      },
    });
  };

  const publishModel = () => {
    const draft = overview.draft;
    if (!draft) {
      ctx.toast("当前没有可发布的模型草稿");
      return;
    }
    if (modelDirty) {
      ctx.toast("请先保存当前修改，再发布最新草稿");
      return;
    }
    ctx.openActionConfirm({ briefKind: "judgment",
      action: "发布评分规则草稿",
      title: `发布评分规则 v${draft.version}`,
      effect: <StatusTag tone="progress" filled>立即生效</StatusTag>,
      confirmLabel: "确认发布",
      detail: `生效模型 v${overview.model.version} → 草稿 v${draft.version}，共改 ${changedCount(draftRows)} 项。`,
      facts: (
        <Facts>
          <Fact k="生效版本"><Change from={`v${overview.model.version}`} to={`v${draft.version}`} /></Fact>
          <Fact k="草稿">{draft.createdBy} 保存于 {draft.createdAt}</Fact>
          <Fact k="评分用户">{fmt(overview.totalUsers)} 人，其中人工改分 {fmt(overview.overrideActive)} 人</Fact>
        </Facts>
      ),
      content: (
        <>
          <div className="rd-impact"><p className="rd-impact-title">发布后改变的配置（{changedCount(draftRows)} 项）</p><ModelDiff rows={draftRows} /></div>
          <Notice tone="progress" title="发布后分数怎么变">
            <p>发布这一刻先按 v{draft.version} 重算最多 200 人，其余由后台每轮最多 200 人继续，进度看页面上的「待重新计算」，没有完成时限保证。</p>
            <p>人工改过的分会保留，只更新这些人的系统评分；不用再点「全部恢复系统评分」，那个操作会清掉所有人工改分。</p>
            <p>已经提交的提现不会重新判断；之后的提现按当时的分数和 v{draft.version} 的自动升级线 {draft.autoEscalateScore} 分转人工审核。</p>
          </Notice>
        </>
      ),
      statedBrief: {
        impact: `v${draft.version} 立即成为生效版本，v${overview.model.version} 自动归档；全部评分用户分批按新规则重算，人工改分保留。`,
        check: "提交前已核对：草稿没有未保存的修改；发布人是有评分规则修改权限的超级管理员（后端会再核一次）。",
      },
      reasonPlaceholder: "写清发布依据，例如：复盘结论、审批记录号",
      run: (reason) => {
        const fingerprint = JSON.stringify({ expectedVersion: draft.rowVersion, reason });
        return runAction(
          "model-publish",
          fingerprint,
          (commandKey) => ctx.actions.publishK4ModelDraft(draft.rowVersion, reason, commandKey),
          `评分规则 v${draft.version} 已发布，旧版本已归档`,
          async () => { if (lookupUser) await loadUser(lookupUser.userNo); },
        );
      },
    });
  };

  const restoreModel = (model: K4Model) => ctx.openActionConfirm({ briefKind: "config",
    action: `把旧版本 v${model.version} 恢复为草稿`,
    title: `把 v${model.version} 恢复为草稿`,
    effect: <StatusTag tone="neutral" filled>只改草稿，不改线上评分</StatusTag>,
    confirmLabel: "恢复为草稿",
    detail: `用 v${model.version} 覆盖当前草稿，线上的 v${overview.model.version} 不变；恢复后还要核对并发布才会生效。`,
    facts: (
      <Facts>
        <Fact k="恢复的版本">v{model.version} · {model.createdBy} 起草于 {model.createdAt}</Fact>
        <Fact k="现在的草稿">{overview.draft ? `v${overview.draft.version}，会被 v${model.version} 的配置覆盖` : "没有，恢复后生成新草稿"}</Fact>
        <Fact k="线上">仍按生效的 v{overview.model.version} 评分</Fact>
      </Facts>
    ),
    content: <div className="rd-impact"><p className="rd-impact-title">恢复后草稿和生效 v{overview.model.version} 的差别</p><ModelDiff rows={modelDiffRows(activeEdit, editableModel(model), overview.dimensions)} /></div>,
    statedBrief: {
      impact: `把 v${model.version} 的权重、参与评分、20 项细则和分档线复制成草稿；线上 v${overview.model.version} 不变，之后还要核对并发布才生效。`,
      check: "提交前已核对：页面没有未保存的修改。",
    },
    reasonPlaceholder: "写清为什么恢复旧版本",
    run: (reason) => runAction(
      `model-restore-${model.version}`,
      JSON.stringify({ modelVersion: model.version, expectedVersion: modelInput.expectedVersion, reason }),
      (commandKey) => ctx.actions.restoreK4ModelDraft(model.version, modelInput.expectedVersion, reason, commandKey),
      `历史模型 v${model.version} 已恢复为草稿`,
    ),
  });

  const recomputeAll = () => ctx.openActionConfirm({ briefKind: "judgment",
    action: "重新计算所有用户的风险分",
    title: "全部恢复系统评分",
    effect: <><StatusTag tone="progress" filled>立即生效</StatusTag><IrreversibleTag>人工改分全部清除</IrreversibleTag></>,
    confirmTone: "danger",
    confirmLabel: "确认全部重算",
    detail: `按当前评分规则 v${overview.model.version} 重新计算 ${overview.totalUsers} 个用户的风险分，人工改过的分会被清除。手动一次最多 1000 人。`,
    facts: (
      <Facts>
        <Fact k="评分用户" lead unit="人">{fmt(overview.totalUsers)}</Fact>
        <Fact k="规则版本">按生效的 v{overview.model.version} 计算</Fact>
        <Fact k="人工改分" tone={overview.overrideActive > 0 ? "warn" : undefined}>{overview.overrideActive > 0 ? `${fmt(overview.overrideActive)} 人的人工改分会被清除` : "现在没有生效的人工改分"}</Fact>
      </Facts>
    ),
    content: <Notice tone="warn">在这一次请求里把全部评分用户算完才返回（最多 1000 人），人数多时要等一会儿；有一人算失败整次都不生效。评分历史和人工改分记录保留，但改分不再生效。</Notice>,
    statedBrief: {
      impact: `当前全部评分用户按 v${overview.model.version} 重新计算并清除人工改分，新分数立即生效。`,
      check: "提交前已核对：评分用户不超过 1000 人；后端按提交那一刻的实际名单再核一次，名单变了会拒绝。",
    },
    reasonPlaceholder: "写清为什么要全部重算",
    run: (reason) => runAction(
      "batch-recompute",
      JSON.stringify({ modelVersion: overview.model.version, reason }),
      (commandKey) => ctx.actions.recomputeK4Scores([], overview.model.version, reason, commandKey),
      "所有用户的风险分已重新计算",
      async () => { if (lookupUser) await loadUser(lookupUser.userNo); },
    ),
  });

  // ── 首屏一句话 ──
  const conclusionExplain = <><p>生效版本和草稿取自后端的评分模型；待重新计算是后端这一刻还没按生效规则算好的人数。</p><p>提现升级告警只数发给你本人的最近 50 条里没读的。</p></>;
  const clauses: string[] = [];
  if (canReadWithdrawalAlerts && unreadAlerts > 0) clauses.push(`有 ${unreadAlerts} 条提现升级告警未读`);
  if (overview.recomputePending > 0) clauses.push(`${fmt(overview.recomputePending)} 人正在按 v${overview.model.version} 排队重算`);
  if (overview.draft) clauses.push(`草稿 v${overview.draft.version} 待发布`);
  const alertsFirst = canReadWithdrawalAlerts && unreadAlerts > 0;
  const status = `评分规则 v${overview.model.version} 生效中${clauses.filter((text) => !text.includes("告警")).map((text) => `，${text}`).join("")}`;
  const conclusion = alertsFirst ? (
    <Conclusion state="warn" lead icon={BellRing} explain={conclusionExplain}
      hint={`${status}。到「提现升级告警」逐条核对，处理后标为已读。`}
      action={tab !== "alerts" ? <Button size="sm" onClick={() => setTab("alerts")}>查看告警</Button> : undefined}>
      有 {unreadAlerts} 条提现升级告警未读
    </Conclusion>
  ) : (
    <Conclusion state={overview.draft || overview.recomputePending > 0 ? "neutral" : "ok"} icon={ShieldCheck} explain={conclusionExplain}
      hint={overview.draft && canPublish ? "核对草稿改了什么，没问题就发布。" : undefined}>
      {clauses.length > 0 ? status : `评分规则 v${overview.model.version} 生效中，全部评分用户都已按它算好`}
    </Conclusion>
  );

  const tabs = (
    <PageTabs label="风险评分规则" value={tab} onChange={setTab} ids={tabIds} items={[
      { value: "model", label: "评分模型" },
      { value: "users", label: "用户分数" },
      ...(canReadWithdrawalAlerts ? [{ value: "alerts" as const, label: "提现升级告警", count: alertsLoaded ? (withdrawalAlertError ? "—" : unreadAlerts) : undefined }] : []),
    ]} />
  );

  // ── 评分模型 ──
  const publishBlocked = modelDirty ? "有未保存的修改，先保存草稿或放弃修改" : undefined;
  const versionCards = (
    <div className="rd-split k4-versions" data-even="">
      <Panel title={`生效中 · v${overview.model.version}`} icon={ShieldCheck} tone="ok"
        explain="线上的用户分数、提现审核和提现升级告警都按这一版算。时间是服务端时间，后端没有给时区。">
        <VersionFacts rows={[
          { key: "pub", label: "发布", value: overview.model.publishedAt ? `${overview.model.publishedBy ?? "—"} · ${overview.model.publishedAt}` : "—" },
          { key: "by", label: "起草", value: `${overview.model.createdBy} · ${overview.model.createdAt}` },
          { key: "why", label: "理由", value: overview.model.reason },
        ]} />
      </Panel>
      <Panel title={overview.draft ? `草稿 · v${overview.draft.version}` : "草稿"} icon={FilePenLine} tone={overview.draft ? "warn" : "role-other"}
        explain="草稿只存在后台，不影响线上评分。有评分规则修改权限的人可以起草；有这项权限的超级管理员才能发布。"
        actions={<span className="k4-actions">
          {canModelWrite && <Button icon={<SlidersHorizontal size={14} aria-hidden />} onClick={() => setEditorOpen(true)}>{modelDirty ? "继续编辑" : overview.draft ? "编辑草稿" : "起草新版本"}</Button>}
          {canPublish && overview.draft && <Button variant="primary" icon={<Upload size={14} aria-hidden />} disabledReason={publishBlocked} onClick={publishModel}>发布草稿</Button>}
        </span>}>
        {overview.draft ? (
          <VersionFacts rows={[
            { key: "saved", label: "保存", value: `${overview.draft.createdBy} · ${overview.draft.createdAt}` },
            { key: "diff", label: "和生效版比", value: changedCount(draftRows) > 0 ? `改了 ${changedCount(draftRows)} 项，见下面标出的值` : "配置无变化" },
            { key: "why", label: "理由", value: overview.draft.reason },
          ]} />
        ) : <p className="k4-quiet">暂无草稿</p>}
        {!canModelWrite && <p className="k4-quiet">你没有修改评分规则的权限，请联系管理员在「角色管理」里开通。</p>}
        {canModelWrite && !canPublish && overview.draft && <p className="k4-quiet">发布要由有评分规则修改权限的超级管理员操作。</p>}
      </Panel>
    </div>
  );

  const modelTab = (
    <div {...tabIds.panel("model")} className="k4-tab">
      {modelDirty && !editorOpen && (
        <Notice tone="warn" title={`有 ${editChanged} 项修改还没保存`}
          action={<span className="k4-actions"><Button size="sm" onClick={() => setEditorOpen(true)}>继续编辑</Button><Button size="sm" variant="ghost" onClick={() => setModelDraft(editableModel(sourceModel))}>放弃修改</Button></span>}>
          修改只在这个页面里，刷新或离开就没了；保存草稿后才能发布或恢复旧版本。
        </Notice>
      )}
      {overview.recomputePending > 0 && (
        <Notice tone="progress" title={`正在按 v${overview.model.version} 重新计算：还有 ${fmt(overview.recomputePending)} 人`}>
          后台每轮最多算 200 人，页面每 1.5 秒自动刷新；还没算到的人暂时用旧分数。
        </Notice>
      )}
      {versionCards}
      <Panel title="五维权重" icon={Scale} tone="role-4" sub="合计 100%"
        explain={<><p>系统评分 = 五个维度各自「子分 × 权重」之和，每一维单独四舍五入到整数，总分在 0–100 之间。</p><p>不参与评分的维度贡献记 0，但权重仍算在合计里，其余维度不会自动补上。</p></>}>
        <WeightTable dimensions={overview.dimensions} active={activeEdit} draft={draftEdit ?? undefined} activeLabel={`生效 v${overview.model.version}`} draftLabel={overview.draft ? `草稿 v${overview.draft.version}` : undefined} />
      </Panel>
      <Panel title="分档线和各档人数" icon={Users} tone="role-3"
        explain={<><p>有效分低于中风险起始分是低风险，达到高风险起始分是高风险，中间是中风险。</p><p>新提现时用户的风险分达到自动升级线，这笔提现转人工审核，并给有改分权限的管理员发提现升级告警；分数本身不冻结账户、不动钱包。</p><p>各档人数按每个人现在存的有效分统计，排队重算的人按旧分数计入；占比保留一位小数，相加不一定正好 100%。</p></>}>
        <div className="k4-bands">
          <div className="k4-axis-block">
            <div className="k4-axis-row"><span className="k4-axis-label">生效 v{overview.model.version}</span><BandAxis model={activeEdit} label={`生效 v${overview.model.version} 的分档线`} /></div>
            {draftEdit && <div className="k4-axis-row"><span className="k4-axis-label">草稿 v{overview.draft!.version}</span><BandAxis model={draftEdit} label={`草稿 v${overview.draft!.version} 的分档线`} /></div>}
            <BandValues model={draftEdit ?? activeEdit} before={draftEdit ? activeEdit : undefined} />
          </div>
          <div className="k4-dist-block">
            <p className="k4-block-title">各档人数 <span className="k4-quiet">按生效 v{overview.model.version} 的线 · 共 {fmt(overview.totalUsers)} 人</span></p>
            <Distribution rows={dist} total={overview.totalUsers} />
          </div>
        </div>
      </Panel>
      <Fold title="20 项计分细则" icon={SlidersHorizontal} tone="role-4"
        summary={draftEdit ? `5 个维度 · 草稿改了 ${K4_MAPPING_FIELDS.filter((item) => draftEdit.scoreMappings[item.key] !== activeEdit.scoreMappings[item.key]).length} 项` : "5 个维度 · 生效值"}
        explain="每一维先按这些细则算出 0–100 的子分，再乘权重。随评分规则版本一起保存，发布后才生效。">
        <MappingView dimensions={overview.dimensions} active={activeEdit} draft={draftEdit ?? undefined} />
      </Fold>
      <Fold title="版本历史" icon={History} summary={`共 ${overview.modelHistory.length} 个版本 · ${overview.modelHistory.filter((model) => model.state === "archived").length} 个已归档`}
        explain="所有没删除的版本，按版本号从新到旧，不分页。已归档的版本可以恢复成草稿，核对后再发布；恢复不会直接改线上评分。">
        <Table label="版本历史" className="k4-history">
          <thead><tr><Th>版本</Th><Th>起草</Th><Th>发布</Th><Th>理由</Th><Th align="right">操作</Th></tr></thead>
          <tbody>
            {overview.modelHistory.map((model) => (
              <Tr key={`${model.version}-${model.state}`}>
                <Td><span className="k4-version">v{model.version}<StatusTag tone={model.state === "active" ? "ok" : model.state === "draft" ? "warn" : "done"}>{STATE_TEXT[model.state] ?? "状态未知"}</StatusTag></span></Td>
                <Td><Cell main={model.createdBy} sub={model.createdAt} /></Td>
                <Td><Cell main={model.publishedBy ?? "—"} sub={model.publishedAt ?? "未发布"} /></Td>
                <Td grow><Cell main={model.reason} title={model.reason} /></Td>
                <Td align="right" data-fit="">
                  {canModelWrite && model.state === "archived"
                    ? <Button size="sm" icon={<RotateCcw size={14} aria-hidden />} disabledReason={modelDirty ? "有未保存的修改，先保存草稿或放弃修改" : undefined} onClick={() => restoreModel(model)}>恢复为草稿</Button>
                    : <span className="k4-quiet">—</span>}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Fold>
    </div>
  );

  // ── 编辑草稿 ──
  const sourceEdit = editableModel(sourceModel);
  const baseLabel = overview.draft ? "草稿" : "生效";
  const setWeight = (key: (typeof K4_DIMENSION_KEYS)[number], value: number) => setModelDraft({ ...edit, weights: { ...edit.weights, [key]: value } });
  const editor = canModelWrite && (
    <Drawer open={editorOpen} onClose={() => setEditorOpen(false)} icon={SlidersHorizontal} tone="role-4"
      title="编辑评分规则草稿" sub={overview.draft ? `基于草稿 v${overview.draft.version}` : `基于生效 v${overview.model.version}`}
      explain="修改只在这个页面里，保存后成为草稿，线上评分不变；关掉抽屉修改还在，页面上会提示。"
      footer={<Decision note={issueCount > 0 ? `有 ${issueCount} 处要改正` : modelDirty ? `改了 ${editChanged} 项` : undefined}
        others={<Button variant="ghost" disabledReason={modelDirty ? undefined : "没有改动"} onClick={() => setModelDraft(editableModel(sourceModel))}>放弃修改</Button>}
        primary={<Button variant="primary" disabledReason={issueCount > 0 ? "先改正标出的项" : !modelDirty ? "没有改动" : undefined} onClick={saveModel}>保存草稿</Button>} />}>
      <section className="k4-edit-section" aria-labelledby="k4-edit-weights">
        <h3 id="k4-edit-weights" className="k4-edit-title">五维权重 <span className={issues.weightTotal ? "k4-sum" : "k4-sum k4-quiet"} data-bad={issues.weightTotal ? "" : undefined}>合计 {weightTotal}%</span></h3>
        {issues.weightTotal && <div className="rd-form-error" role="alert">{issues.weightTotal}</div>}
        {overview.dimensions.map((item) => (
          <WeightEditRow key={item.dimKey} item={item} value={edit.weights[item.dimKey]} on={edit.inputSources[item.dimKey]}
            activeValue={sourceEdit.weights[item.dimKey]} activeOn={sourceEdit.inputSources[item.dimKey]} baseLabel={baseLabel} disabled={false} error={issues[`w-${item.dimKey}`]}
            onValue={(value) => setWeight(item.dimKey, value)}
            onSource={(on) => setModelDraft({ ...edit, inputSources: { ...edit.inputSources, [item.dimKey]: on } })} />
        ))}
      </section>
      <section className="k4-edit-section" aria-labelledby="k4-edit-bands">
        <h3 id="k4-edit-bands" className="k4-edit-title">分档线和自动升级线</h3>
        <p className="k4-axis-row"><span className="k4-axis-label">改后</span><BandAxis model={edit} label="改后的分档线" /></p>
        <NumberEditRow label="中风险起始分" unit="分" min={0} max={100} value={edit.bandLowMax} baseLabel={baseLabel} activeValue={sourceEdit.bandLowMax} disabled={false} error={issues.low} ariaLabel="中风险起始分"
          onValue={(value) => setModelDraft({ ...edit, bandLowMax: value })} />
        <NumberEditRow label="高风险起始分" unit="分" min={0} max={100} value={edit.bandHighMin} baseLabel={baseLabel} activeValue={sourceEdit.bandHighMin} disabled={false} error={issues.high} ariaLabel="高风险起始分"
          onValue={(value) => setModelDraft({ ...edit, bandHighMin: value })} />
        <NumberEditRow label="自动升级线" unit="分" min={70} max={100} value={edit.autoEscalateScore} baseLabel={baseLabel} activeValue={sourceEdit.autoEscalateScore} disabled={false} error={issues.esc} ariaLabel="自动升级线"
          onValue={(value) => setModelDraft({ ...edit, autoEscalateScore: value })} />
      </section>
      <section className="k4-edit-section" aria-labelledby="k4-edit-maps">
        <h3 id="k4-edit-maps" className="k4-edit-title">20 项计分细则</h3>
        {MAPPING_GROUPS.map((group) => {
          const bad = group.keys.filter((key) => issues[key]).length;
          const changed = group.keys.filter((key) => edit.scoreMappings[key] !== sourceEdit.scoreMappings[key]).length;
          return (
            <MappingEditGroup key={group.dimKey} title={names.get(group.dimKey) ?? group.dimKey} explain={group.explain} alert={bad > 0}
              summary={bad > 0 ? `${bad} 项要改正` : changed > 0 ? `改了 ${changed} 项` : `${group.keys.length} 项`}>
              {group.keys.map((key) => {
                const item = K4_MAPPING_FIELDS.find((entry) => entry.key === key)!;
                return <NumberEditRow key={key} label={fieldName(item.label)} unit={item.unit} min={item.min} max={item.max} value={edit.scoreMappings[key]}
                  baseLabel={baseLabel} activeValue={sourceEdit.scoreMappings[key]} disabled={false} error={issues[key]} ariaLabel={item.label}
                  onValue={(value) => setModelDraft({ ...edit, scoreMappings: { ...edit.scoreMappings, [key]: value } })} />;
              })}
            </MappingEditGroup>
          );
        })}
      </section>
    </Drawer>
  );

  // ── 用户分数 ──
  const userHref = (userNo: string) => `/users/search/${encodeURIComponent(userNo)}`;
  const userRef = (userNo: string) => reach(userHref(userNo), "user_c1_read")
    ? <Link className="rd-link" href={userHref(userNo)}>{userNo}</Link> : userNo;
  const oldModel = lookupUser && lookupUser.modelVersion !== `k4-v${overview.model.version}`;
  const escalated = lookupUser ? lookupUser.effectiveScore >= overview.model.autoEscalateScore : false;
  const scoreTicks = [0, overview.model.bandLowMax, overview.model.bandHighMin, overview.model.autoEscalateScore, 100]
    .filter((value, index, list) => list.indexOf(value) === index).map((value) => ({ value, text: String(value) }));

  const lookup = (
    <Panel title="查用户的风险分" icon={UserRound} tone="role-3" explain="可以按用户编号、昵称、手机号或推荐码查；候选最多 8 个，按 Enter 选第一个，选中后看分数怎么来的。">
      <div className="k4-lookup" onKeyDown={(event) => {
        // 没有可选的候选时，Enter 按输入的编号直接查（旧页面行为）；有候选时由下拉选第一项。
        if (event.key === "Enter" && !event.defaultPrevented && !event.nativeEvent.isComposing && (event.target as HTMLElement).tagName === "INPUT") {
          event.preventDefault();
          void loadUser(userSearch);
        }
      }}>
        <SearchSelect aria-label="搜索用户编号或用户名" placeholder="搜索用户编号 / 用户名 / 手机号"
          value={userSearch}
          onChange={(next) => {
            lookupSequence.current += 1;
            setLookupUser(null);
            setUserOptions([]);
            setUserSearchError(null);
            setLookupError(null);
            setLookupLoading(false);
            setUserSearch(next);
          }}
          options={userOptions.map((option) => ({ value: option.userNo, label: option.label, extra: <BandTag tone={option.bandTone}>{option.bandLabel}{option.overridden ? " · 人工改分" : ""}</BandTag> }))}
          optionsFor={userSearchLoading ? null : userSearchFor}
          loading={userSearchLoading}
          error={userSearchError ? `候选加载失败 · ${userSearchError}` : undefined}
          empty="暂无匹配用户"
          selected={lookupUser?.userNo}
          onSelect={(value) => { const option = userOptions.find((item) => item.userNo === value); if (option) void selectLookupUser(option); }} />
        <Button variant="primary" loading={lookupLoading} onClick={() => void loadUser(userSearch)}>查询</Button>
      </div>
    </Panel>
  );

  const userResult = lookupLoading
    ? <Panel title="用户评分" id="k4-user"><BlockState state="loading" title="正在加载…" /></Panel>
    : lookupError
      ? <Panel title="用户评分" id="k4-user"><BlockState state="error" title="查询失败" detail={lookupError} onRetry={userSearch.trim() ? () => void loadUser(userSearch) : undefined} /></Panel>
      : !lookupUser
        ? <Panel title="用户评分" id="k4-user"><BlockState state="empty" title="请选择用户，查看风险分怎么来的" /></Panel>
        : (
          <Panel id="k4-user" title={<span className="k4-user-title">{userRef(lookupUser.userNo)}<BandTag tone={lookupUser.bandTone}>{lookupUser.bandLabel}</BandTag>{lookupUser.overridden && <StatusTag tone="warn" icon={PenLine}>人工改分</StatusTag>}</span>}
            sub={`评分时间 ${lookupUser.asOf}`}
            actions={<span className="k4-actions">
              {canOverride && <Button onClick={() => openOverride(lookupUser)}>手动改分</Button>}
              {canRecompute && <Button onClick={() => openRecompute(lookupUser)}>恢复系统评分</Button>}
            </span>}>
            {oldModel && (
              <Notice tone="warn">这个用户还在排队重新计算，这里显示的是 {lookupUser.modelVersion} 下的分{canRecompute ? `；可以点「恢复系统评分」马上按 v${overview.model.version} 计算` : ""}。</Notice>
            )}
            <div className="k4-user-top">
              <div className="k4-score">
                <span className="k4-score-k">有效分<Explain label="有效分是什么" content="提现审核、提现升级告警和分布统计都用有效分：有生效的人工改分就是改后的分，否则等于系统评分。" /></span>
                <span className="k4-score-v" data-tone={bandState(lookupUser.bandTone)}>{lookupUser.effectiveScore}<span className="k4-unit">分</span></span>
                <span className="k4-score-sub">{lookupUser.overridden ? "人工改分" : "等于系统评分"} · 系统评分 <b>{lookupUser.modelScore}</b> 分（{bandOf(lookupUser.modelScore, overview.model)}）· 规则版本 {lookupUser.modelVersion}</span>
              </div>
              <div className="k4-user-scale">
                <ScaleBar label="有效分在分数轴上的位置" valueText={`有效分 ${lookupUser.effectiveScore} 分；中风险从 ${overview.model.bandLowMax} 分，高风险从 ${overview.model.bandHighMin} 分，自动升级线 ${overview.model.autoEscalateScore} 分`}
                  max={100} value={lookupUser.effectiveScore} fill target={overview.model.autoEscalateScore} ticks={scoreTicks} tone={bandState(lookupUser.bandTone)} />
                <p className={escalated ? "k4-escalate" : "k4-quiet"}>{escalated
                  ? `已达到自动升级线 ${overview.model.autoEscalateScore} 分：这位用户的新提现会转人工审核`
                  : `离自动升级线 ${overview.model.autoEscalateScore} 分还差 ${overview.model.autoEscalateScore - lookupUser.effectiveScore} 分`}</p>
              </div>
            </div>
            {!canOverride && !canRecompute && <p className="k4-quiet">你没有修改用户风险分的权限。</p>}
            <ContributionTable rows={lookupUser.contributions} total={lookupUser.modelScore} label={`${lookupUser.userNo} 的五维贡献`} />
            <Fold title="最近评分记录" icon={History} summary={lookupUser.history.length > 0 ? `最近 ${lookupUser.history.length} 次 · 最新 ${lookupUser.history[0].createdAt}` : "暂无记录"}
              explain="后端只给最近 20 次，按时间从新到旧；点一行看那一次的五维明细和理由。">
              {lookupUser.history.length === 0 ? <p className="k4-quiet">暂无历史评分。</p> : (
                <Table label="最近评分记录" className="k4-score-history">
                  <thead><tr><Th>时间</Th><Th>来源</Th><Th>规则版本</Th><Th align="right">系统评分 → 有效分</Th><Th>操作人</Th></tr></thead>
                  <tbody>
                    {lookupUser.history.map((row, index) => (
                      <Tr key={`${row.createdAt}-${row.modelVersion}-${index}`} selected={historyEntry === row} onOpen={() => setHistoryEntry(row)}>
                        <Td><Cell num main={row.createdAt} /></Td>
                        <Td>{row.scoreState === "manually-overridden" ? <StatusTag tone="warn" icon={PenLine}>人工改分</StatusTag> : <StatusTag tone="neutral">{SCORE_STATE_TEXT[row.scoreState] ?? "来源未知"}</StatusTag>}</Td>
                        <Td>v{row.modelVersion}</Td>
                        <Td align="right"><Cell num main={row.modelScore === row.effectiveScore ? `${row.effectiveScore} 分` : `${row.modelScore} → ${row.effectiveScore} 分`} /></Td>
                        <Td><Cell main={row.operator} /></Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Fold>
          </Panel>
        );

  const overrideTable = (
    <Panel title="手动改分记录" icon={FilePenLine} tone="role-other" sub={`共 ${fmt(overridesPage.total)} 条 · 生效中 ${fmt(overview.overrideActive)} 人`}
      explain={<><p>谁、改了谁的分、从多少改到多少、为什么。生效中的排在前面。</p><p>「系统评分」是改分那一刻的系统评分快照，之后不随重算变化。「已失效」表示这次改分已经不生效：可能被恢复了系统评分，也可能被之后的又一次改分替换。</p></>}
      actions={canRecompute ? <Button variant="danger-outline" disabledReason={overview.totalUsers > 1000 ? "超过 1000 人不能手动全部重算；发布评分规则会分批重算，但保留人工改分" : undefined} onClick={recomputeAll}>全部恢复系统评分</Button> : undefined}
      flush>
      <Table label="手动改分记录" className="k4-overrides">
        <thead><tr><Th>用户</Th><Th align="right">系统评分 → 改后</Th><Th>原因</Th><Th>操作人 · 时间</Th><Th>状态</Th><Th align="right">操作</Th></tr></thead>
        <tbody>
          {overrides.length === 0 && <TableMessage columns={6}>暂无手动改分记录</TableMessage>}
          {overrides.map((row) => (
            <Tr key={`${row.userNo}-${row.timeText}`} selected={lookupUser?.userNo === row.userNo && row.active}>
              <Td><Cell mono main={<button type="button" className="rd-link k4-user-link" onClick={() => { setUserSearch(row.userNo); void loadUser(row.userNo).then(() => document.getElementById("k4-user")?.scrollIntoView({ block: "start", behavior: "instant" as ScrollBehavior })); }}>{row.userNo}</button>} /></Td>
              <Td align="right"><span className="k4-change"><Change from={String(row.modelScore)} to={String(row.overrideScore)} settled={!row.active} tone={row.active ? (row.overrideScore > row.modelScore ? "danger" : "ok") : undefined} /> <span className="k4-unit">分</span></span></Td>
              <Td grow><Cell main={row.reason} title={row.reason} /></Td>
              <Td><Cell main={row.operator} sub={row.timeText} /></Td>
              <Td>{row.active ? <StatusTag tone="progress" icon={PenLine}>生效中</StatusTag> : <StatusTag tone="done">已失效</StatusTag>}</Td>
              <Td align="right" data-fit="">
                {row.active && canRecompute
                  ? <Button size="sm" onClick={async () => { await prepareRecompute(row.userNo); }}>恢复系统评分</Button>
                  : <span className="k4-quiet">{row.active ? "无权限" : "—"}</span>}
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>
      {overridesPage.total > 0 && <Pager label="手动改分记录" total={overridesPage.total} page={overridesPage.pageNum} pageSize={overridesPage.pageSize} sizes={[5, 10, 20, 50]}
        onPage={setOverridePage} onPageSize={(next) => { setOverridePageSize(next); setOverridePage(1); }} />}
    </Panel>
  );

  const usersTab = (
    <div {...tabIds.panel("users")} className="k4-tab">
      {lookup}
      {userResult}
      {overrideTable}
    </div>
  );

  // ── 提现升级告警 ──
  const alertsTab = canReadWithdrawalAlerts && (
    <div {...tabIds.panel("alerts")} className="k4-tab">
      <Panel title="我的提现升级告警" icon={BellRing} tone="role-other" flush
        sub={alertsLoaded && !withdrawalAlertError ? `最近 ${withdrawalAlerts.length} 条 · 未读 ${unreadAlerts}` : undefined}
        explain={<><p>新提现时用户的风险分达到当时的自动升级线，这笔提现转人工审核，同时给当时有改分权限的管理员和超级管理员各发一条。</p><p>这里只有发给你本人的最近 50 条；标为已读只改你自己的收件状态，不影响提现，也不影响别人的未读。</p></>}
        actions={<Button size="sm" icon={<RefreshCw size={14} aria-hidden />} loading={alertsReading} onClick={() => void readWithdrawalAlerts()}>重新读取</Button>}>
        {!alertsLoaded ? <BlockState state="loading" title="正在读取告警" />
          : withdrawalAlertError ? <BlockState state="error" title="告警加载失败" detail={withdrawalAlertError} onRetry={() => void readWithdrawalAlerts()} />
            : withdrawalAlerts.length === 0 ? <BlockState state="empty" title="暂无提现升级告警" detail="有新提现达到自动升级线时，会在这里提醒你。" />
              : (
                <Table label="我的提现升级告警" className="k4-alerts">
                  <thead><tr><Th>提现单号</Th><Th align="right">风险分</Th><Th>规则版本 · 评分时间</Th><Th>收到时间</Th><Th>状态</Th><Th align="right">操作</Th></tr></thead>
                  <tbody>
                    {withdrawalAlerts.map((alert) => {
                      const unknown = alertUnknown.includes(alert.id);
                      return (
                        <Tr key={alert.id}>
                          <Td><Cell mono full main={alert.withdrawalNo} sub={PRIORITY_TEXT[alert.priority] ?? alert.priority} /></Td>
                          <Td align="right"><Cell num main={alert.riskScore == null ? "—" : `${alert.riskScore} 分`} /></Td>
                          <Td><Cell main={alert.modelVersion ?? "—"} sub={alert.scoreAsOf ?? "—"} /></Td>
                          <Td><Cell num main={alert.createdAt.replace("T", " ").slice(0, 19)} /></Td>
                          <Td>{alert.read ? <StatusTag tone="done">已读</StatusTag> : unknown ? <StatusTag tone="warn" icon={CircleHelp}>结果待核对</StatusTag> : <StatusTag tone="warn" icon={BellDot}>未读</StatusTag>}</Td>
                          <Td align="right" data-fit="">
                            {alert.read ? <span className="k4-quiet">—</span>
                              : unknown ? <Button size="sm" loading={alertsReading} onClick={() => void readWithdrawalAlerts()}>重新读取核对</Button>
                                : <Button size="sm" loading={alertBusy === alert.id} onClick={() => void markAlertRead(alert)}>标为已读</Button>}
                          </Td>
                        </Tr>
                      );
                    })}
                  </tbody>
                </Table>
              )}
        {alertUnknown.length > 0 && !withdrawalAlertError && <div className="k4-panel-note"><Notice tone="warn">标为已读没有收到明确结果。这个操作不按命令号去重，不提供原样重试；点「重新读取核对」看后端记下的状态。</Notice></div>}
      </Panel>
    </div>
  );

  // ── 单次评分明细 ──
  const historyDrawer = (
    <Drawer open={Boolean(historyEntry && lookupUser)} onClose={() => setHistoryEntry(null)} wide title="这次评分的明细" icon={History}
      sub={historyEntry ? `${lookupUser?.userNo ?? ""} · ${historyEntry.createdAt}` : undefined}>
      {historyEntry && <>
        <JudgmentPoints rows={[
          { label: "来源", value: SCORE_STATE_TEXT[historyEntry.scoreState] ?? "来源未知", state: historyEntry.scoreState === "manually-overridden" ? "warn" : undefined },
          { label: "有效分", value: `${historyEntry.effectiveScore} 分` },
          { label: "系统评分", value: `${historyEntry.modelScore} 分 · 规则版本 v${historyEntry.modelVersion}` },
          { label: "操作人", value: historyEntry.operator },
          { label: "理由", value: historyEntry.reason },
        ]} />
        <ContributionTable rows={historyEntry.contributions} total={historyEntry.modelScore} label="这次评分的五维贡献" />
      </>}
    </Drawer>
  );

  return (
    <>
      {header}
      {pendingBars}
      {inboundNotice}
      {conclusion}
      {tabs}
      {tab === "model" && modelTab}
      {tab === "users" && usersTab}
      {tab === "alerts" && alertsTab}
      {editor}
      {historyDrawer}
    </>
  );
}

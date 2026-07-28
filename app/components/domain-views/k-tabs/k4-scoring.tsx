"use client";

import { useEffect, useId, useRef, useState } from "react";
import { DataListPager } from "../design-kit";
import {
  K1OutcomeUncertainError,
  K4_DIMENSION_KEYS,
  K4_SCORE_MAPPING_KEYS,
  fetchK4WithdrawalAlerts,
  markK4WithdrawalAlertRead,
  newK1CommandKey,
  type K4DimensionKey,
  type K4Distribution,
  type K4Dimension,
  type K4Model,
  type K4ModelDraftInput,
  type K4ScoreMappingKey,
  type K4ScoreMappings,
  type K4User,
  type K4UserOption,
  type K4WithdrawalAlert,
} from "@/lib/admin/k-client";
import { useAdminAuth } from "@/lib/store/admin-auth";
import type { KCtx } from "./types";

const fmt = (value: number) => value.toLocaleString("en-US");

function errorText(error: unknown) {
  return error instanceof Error ? error.message : "操作失败，请稍后重试";
}

function scoreColor(score: number, lowMax: number, highMin: number) {
  return score >= highMin ? "var(--danger)" : score >= lowMax ? "var(--warning)" : "var(--success)";
}

type EditableModel = {
  weights: Record<K4DimensionKey, number>;
  inputSources: Record<K4DimensionKey, boolean>;
  scoreMappings: K4ScoreMappings;
  bandLowMax: number;
  bandHighMin: number;
  autoEscalateScore: number;
};

function editableModel(model: K4Model): EditableModel {
  return {
    weights: { ...model.weights },
    inputSources: { ...model.inputSources },
    scoreMappings: { ...model.scoreMappings },
    bandLowMax: model.bandLowMax,
    bandHighMin: model.bandHighMin,
    autoEscalateScore: model.autoEscalateScore,
  };
}

const K4_MAPPING_FIELDS: Array<{ key: K4ScoreMappingKey; label: string; min: number; max: number }> = [
  { key: "multiAccount.mediumMin", label: "多账户中风险最小簇", min: 1, max: 100 },
  { key: "multiAccount.highMin", label: "多账户高风险最小簇", min: 1, max: 100 },
  { key: "multiAccount.mediumScore", label: "多账户中风险子分", min: 0, max: 100 },
  { key: "multiAccount.highScore", label: "多账户高风险子分", min: 0, max: 100 },
  { key: "multiAccount.fraudScore", label: "欺诈团伙子分", min: 0, max: 100 },
  { key: "arbitrage.singleScore", label: "单次套利子分", min: 0, max: 100 },
  { key: "arbitrage.repeatMin", label: "重复套利最小次数", min: 2, max: 100 },
  { key: "arbitrage.repeatScore", label: "重复套利子分", min: 0, max: 100 },
  { key: "arbitrage.severeScore", label: "高危套利子分", min: 0, max: 100 },
  { key: "kyc.reviewScore", label: "KYC 复核中子分", min: 0, max: 100 },
  { key: "kyc.pendingScore", label: "KYC 待审核子分", min: 0, max: 100 },
  { key: "kyc.rejectedScore", label: "KYC 拒绝子分", min: 0, max: 100 },
  { key: "kyc.sanctionedScore", label: "制裁命中子分", min: 0, max: 100 },
  { key: "withdraw.baselineMultiplierPct", label: "提现基线倍数（%）", min: 100, max: 1000 },
  { key: "withdraw.baselineScore", label: "超基线子分", min: 0, max: 100 },
  { key: "withdraw.highFrequency24h", label: "24h 高频最小笔数", min: 1, max: 100 },
  { key: "withdraw.largeAmountUsd", label: "大额单笔阈值（USD）", min: 1, max: 1000000 },
  { key: "withdraw.highScore", label: "高频大额子分", min: 0, max: 100 },
  { key: "account.matureDays", label: "成熟账户天数", min: 1, max: 10000 },
  { key: "account.newDays", label: "新账户天数", min: 1, max: 10000 },
  { key: "account.middleScore", label: "普通新账户子分", min: 0, max: 100 },
  { key: "account.newLargeScore", label: "新账户大额动作子分", min: 0, max: 100 },
  { key: "anomaly.lowScore", label: "一般异常子分", min: 0, max: 100 },
  { key: "anomaly.tamperScore", label: "篡改拦截子分", min: 0, max: 100 },
];

function modelPublishDiff(active: K4Model, draft: K4Model, dimensions: K4Dimension[]) {
  const names = new Map(dimensions.map((dimension) => [dimension.dimKey, dimension.name]));
  const changes: string[] = [];
  for (const key of K4_DIMENSION_KEYS) {
    if (active.weights[key] !== draft.weights[key]) {
      changes.push(`${names.get(key) ?? key}权重 ${active.weights[key]}%→${draft.weights[key]}%`);
    }
    if (active.inputSources[key] !== draft.inputSources[key]) {
      changes.push(`${names.get(key) ?? key}输入源 ${active.inputSources[key] ? "启用" : "停用"}→${draft.inputSources[key] ? "启用" : "停用"}`);
    }
  }
  for (const key of K4_SCORE_MAPPING_KEYS) {
    if (active.scoreMappings[key] !== draft.scoreMappings[key]) {
      changes.push(`${K4_MAPPING_FIELDS.find((field) => field.key === key)?.label ?? key} ${active.scoreMappings[key]}→${draft.scoreMappings[key]}`);
    }
  }
  if (active.bandLowMax !== draft.bandLowMax) {
    changes.push(`中风险起始分 ${active.bandLowMax}→${draft.bandLowMax}`);
  }
  if (active.bandHighMin !== draft.bandHighMin) {
    changes.push(`高风险起始分 ${active.bandHighMin}→${draft.bandHighMin}`);
  }
  if (active.autoEscalateScore !== draft.autoEscalateScore) {
    changes.push(`自动升级线 ${active.autoEscalateScore}→${draft.autoEscalateScore}`);
  }
  return changes.length > 0 ? changes.join("；") : "配置无变化";
}

export function K4HeaderActions() {
  return <span className="f-ro"><span className="d" />全平台唯一评分源 · 别处只引用不重算</span>;
}

function BandDonut({ dist, totalUsers }: { dist: K4Distribution[]; totalUsers: number }) {
  const gid = useId();
  const circumference = 2 * Math.PI * 64;
  let offset = 0;
  return (
    <div className="donut">
      <svg viewBox="0 0 168 168" aria-label="风险分档分布">
        <circle cx={84} cy={84} r={64} fill="none" stroke="var(--surface-3)" strokeWidth={17} />
        {dist.map((row) => {
          const length = Math.max((circumference * row.percentage) / 100 - 3, 2);
          const segment = (
            <circle
              key={`${gid}-${row.band}`}
              cx={84}
              cy={84}
              r={64}
              fill="none"
              stroke={row.color}
              strokeWidth={17}
              strokeDasharray={`${length.toFixed(1)} ${circumference.toFixed(1)}`}
              strokeDashoffset={(-offset).toFixed(1)}
            >
              <title>{`${row.band} ${row.percentage}%`}</title>
            </circle>
          );
          offset += (circumference * row.percentage) / 100;
          return segment;
        })}
      </svg>
      <div className="c"><div><div className="n">{fmt(totalUsers)}</div><div className="l">在册用户</div></div></div>
    </div>
  );
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
  const overview = ctx.risk.scoring;
  const [modelDraft, setModelDraft] = useState<EditableModel | null>(null);
  const [userSearch, setUserSearch] = useState("");
  const [userOptions, setUserOptions] = useState<K4UserOption[]>([]);
  const [userSearchOpen, setUserSearchOpen] = useState(false);
  const [userSearchLoading, setUserSearchLoading] = useState(false);
  const [userSearchError, setUserSearchError] = useState<string | null>(null);
  const [lookupUser, setLookupUser] = useState<K4User | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [overridePage, setOverridePage] = useState(1);
  const [overridePageSize, setOverridePageSize] = useState(5);
  const [withdrawalAlerts, setWithdrawalAlerts] = useState<K4WithdrawalAlert[]>([]);
  const [withdrawalAlertError, setWithdrawalAlertError] = useState<string | null>(null);
  const userOptionsId = useId();
  const pageEffectMounted = useRef(false);
  const lookupSequence = useRef(0);
  const commandAttempts = useRef(new Map<string, { fingerprint: string; commandKey: string }>());

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

  useEffect(() => {
    if (!canReadWithdrawalAlerts) return;
    let alive = true;
    fetchK4WithdrawalAlerts()
      .then((data) => {
        if (!alive) return;
        setWithdrawalAlerts(data.alerts);
        setWithdrawalAlertError(null);
      })
      .catch((error) => {
        if (!alive) return;
        setWithdrawalAlerts([]);
        setWithdrawalAlertError(errorText(error));
      });
    return () => { alive = false; };
  }, [canReadWithdrawalAlerts]);

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
          if (alive) setUserSearchLoading(false);
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
    const saved = commandAttempts.current.get(operation);
    const commandKey = saved?.fingerprint === fingerprint ? saved.commandKey : newK1CommandKey();
    commandAttempts.current.set(operation, { fingerprint, commandKey });
    let writeConfirmed = false;
    try {
      await work(commandKey);
      writeConfirmed = true;
      commandAttempts.current.delete(operation);
      try {
        await reloadCurrentScoring();
        if (afterReload) await afterReload();
      } catch (error) {
        ctx.toast(`操作已生效但最新状态读取失败，不要重复提交；请仅重试 K4 读取 · ${errorText(error)}`);
        return;
      }
      ctx.toast(successText);
    } catch (error) {
      if (writeConfirmed) return;
      if (error instanceof K1OutcomeUncertainError) {
        ctx.toast(`K4 结果未知 · 请保留确认框并使用同一请求重试或先核对 · 请求号 ${commandKey}`);
      } else {
        commandAttempts.current.delete(operation);
        ctx.toast(`K4 操作失败 · ${errorText(error)}`);
      }
      throw error;
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
      ctx.toast(`K4 查询失败 · ${errorText(error)}`);
      return null;
    } finally {
      if (sequence === lookupSequence.current) setLookupLoading(false);
    }
  };

  const selectLookupUser = async (option: K4UserOption) => {
    setUserSearch(option.userNo);
    setUserSearchOpen(false);
    await loadUser(option.userNo);
  };

  const openOverride = (user: K4User) => {
    ctx.openConfirm({
      action: `人工覆盖评分 · ${user.userNo}`,
      detail: `把用户评分从 ${user.effectiveScore} 调整到指定分数。该动作直接写入 K4，并保留操作理由与版本。`,
      chips: [["单用户直接操作", "ready"], ["可重算回模型分", "done"]],
      reason: true,
      input: { label: "覆盖分（0-100）", placeholder: "例如 35", kind: "number", min: 0, max: 100, step: 1 },
      okLabel: "确认覆盖",
      run: (reason, value) => {
        const score = Number(value);
        if (!Number.isInteger(score) || score < 0 || score > 100) {
          ctx.toast("覆盖分必须是 0-100 的整数");
          throw new Error("SCORE_OVERRIDE_INVALID");
        }
        const fingerprint = JSON.stringify({ userNo: user.userNo, score, expectedVersion: user.rowVersion, reason });
        return runAction(
          `override:${user.userNo}`,
          fingerprint,
          (commandKey) => ctx.actions.overrideK4Score(user.userNo, score, user.rowVersion, reason, commandKey),
          `用户 ${user.userNo} 的人工覆盖已生效`,
          async () => { await loadUser(user.userNo); },
        );
      },
    });
  };

  const openRecompute = (user: K4User) => {
    ctx.openConfirm({
      action: `重算回模型分 · ${user.userNo}`,
      detail: `移除人工覆盖，并按当前生效模型重新计算。当前有效分 ${user.effectiveScore}，模型分 ${user.modelScore}。`,
      chips: [["直接回归模型", "done"], ["前后分留痕", "ready"]],
      reason: true,
      okLabel: "确认重算",
      run: (reason) => {
        const fingerprint = JSON.stringify({ userNo: user.userNo, expectedVersion: user.rowVersion, reason });
        return runAction(
          `recompute:${user.userNo}`,
          fingerprint,
          (commandKey) => ctx.actions.recomputeK4Score(user.userNo, user.rowVersion, reason, commandKey),
          `用户 ${user.userNo} 已按当前模型重算`,
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

  if (ctx.contentLoading) {
    return <section className="l-card"><div className="l-h"><span className="ttl">K4 数据加载中</span><span className="sub">· 正在读取独立评分接口</span></div></section>;
  }

  if (ctx.contentError) {
    return (
      <section className="l-card">
        <div className="l-h"><span className="ttl">K4 读取失败</span><span className="sub">· 未展示缓存值或推测值</span></div>
        <div className="l-b">
          <div className="ktint bad">{ctx.contentError}</div>
          <button className="l-btn mc" style={{ marginTop: 12 }} onClick={() => reloadCurrentScoring()}>仅重试 K4</button>
        </div>
      </section>
    );
  }

  if (!overview || !sourceModel) {
    return (
      <section className="l-card">
        <div className="l-h"><span className="ttl">K4 数据不可用</span><span className="sub">· 服务端未返回可验证的生效模型</span></div>
        <div className="l-b"><button className="l-btn mc" onClick={() => reloadCurrentScoring()}>仅重试 K4</button></div>
      </section>
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
    && orderedMappings("kyc.reviewScore", "kyc.pendingScore", "kyc.rejectedScore", "kyc.sanctionedScore")
    && orderedMappings("withdraw.baselineScore", "withdraw.highScore")
    && orderedMappings("account.middleScore", "account.newLargeScore")
    && orderedMappings("anomaly.lowScore", "anomaly.tamperScore");
  const dist = overview.distribution;
  const overridesPage = overview.overrides;
  const overrides = overridesPage.records;
  const shown = lookupUser?.effectiveScore ?? 0;
  const color = scoreColor(shown, overview.model.bandLowMax, overview.model.bandHighMin);
  const maxPoints = Math.max(...(lookupUser?.contributions ?? []).map((row) => row.points), 1);

  const saveModel = () => {
    if (!modelValid || !mappingsValid) {
      ctx.toast("模型参数无效：权重合计须为 100%，升级线不得低于高风险下限，阈值和风险子分须保序");
      return;
    }
    if (!modelDirty) {
      ctx.toast("没有待保存的模型修改");
      return;
    }
    ctx.openActionConfirm({
      action: "保存 K4 评分模型草稿",
      detail: `以当前 ${overview.draft ? "草稿" : "生效模型"} 修订号 ${modelInput.expectedVersion} 为基准保存。保存后不会影响线上评分，须由超级管理员另行发布。`,
      run: (reason) => {
        const fingerprint = JSON.stringify({ ...modelInput, reason });
        return runAction(
          "model-draft",
          fingerprint,
          (commandKey) => ctx.actions.saveK4ModelDraft(modelInput, reason, commandKey),
          "K4 模型草稿已保存，线上模型未改变",
        );
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
    ctx.openActionConfirm({
      action: "发布 K4 评分模型草稿",
      detail: `生效模型 v${overview.model.version} → 草稿 v${draft.version}。变更：${modelPublishDiff(overview.model, draft, overview.dimensions)}。发布即触发按 200 人分片的全量重算，进度会在页面持续显示；影响 D2 路由、B5 点亮与 C1 展示分，旧生效版本自动归档并保留版本快照。`,
      run: (reason) => {
        const fingerprint = JSON.stringify({ expectedVersion: draft.rowVersion, reason });
        return runAction(
          "model-publish",
          fingerprint,
          (commandKey) => ctx.actions.publishK4ModelDraft(draft.rowVersion, reason, commandKey),
          `K4 模型 v${draft.version} 已发布，旧版本已归档`,
          async () => { if (lookupUser) await loadUser(lookupUser.userNo); },
        );
      },
    });
  };

  return (
    <div>
      <div className="f-stats">
        {dist.map((row) => (
          <div className={`f-stat ${row.tone}`} key={row.band}>
            <div className="k">{row.band}</div>
            <div className="v">{row.percentage}%</div>
            <div className="sub">{fmt(row.count)} 人 · {row.rangeText}</div>
          </div>
        ))}
        {overview.totalUsers === 0 && <div className="f-stat"><div className="k">评分用户</div><div className="v">0</div><div className="sub">暂无风险评分用户</div></div>}
        <div className="f-stat cyan"><div className="k">人工覆盖中</div><div className="v">{overview.overrideActive}</div><div className="sub">全部带原因留痕 · 可回归模型</div></div>
        <div className={`f-stat ${overview.recomputePending > 0 ? "warn" : "good"}`}><div className="k">模型重算队列</div><div className="v">{overview.recomputePending}</div><div className="sub">{overview.recomputePending > 0 ? "后台按 200 人分片推进，每秒续跑" : "全部用户已对齐当前模型"}</div></div>
      </div>

      {canReadWithdrawalAlerts && <section className="l-card" aria-label="K4 提现升级告警">
        <div className="l-h"><span className="ttl">K4 提现升级告警</span><span className="sub">· A6 权限 risk_k4_user_override / 超管 · 持久化逐人送达</span><div className="r"><span className={`bdg ${withdrawalAlerts.some((alert) => !alert.read) ? "bad" : "done"}`}>{withdrawalAlerts.filter((alert) => !alert.read).length} 条未读</span></div></div>
        <div className="l-b">
          {withdrawalAlertError && <div className="dtint warn">告警读取失败 · {withdrawalAlertError} · 未展示缓存值</div>}
          {!withdrawalAlertError && withdrawalAlerts.length === 0 && <div className="note">暂无提现升级告警。</div>}
          {!withdrawalAlertError && withdrawalAlerts.map((alert) => <div key={alert.id} className="dtint warn" style={{ marginBottom: 8 }}>
            <strong>{alert.title} · {alert.withdrawalNo}</strong> · {alert.hint} · 模型 {alert.modelVersion} · {alert.createdAt.replace("T", " ").slice(0, 19)}
            {!alert.read && <button className="l-btn sm" style={{ marginLeft: 8 }} onClick={async () => {
              try {
                await markK4WithdrawalAlertRead(alert.id);
                setWithdrawalAlerts((current) => current.map((item) => item.id === alert.id ? { ...item, read: true } : item));
              } catch (error) {
                ctx.toast(`K4 告警确认失败 · ${errorText(error)}`);
              }
            }}>标为已读</button>}
          </div>)}
        </div>
      </section>}

      <section className="l-card">
        <div className="l-h">
          <span className="ttl">K4 评分模型</span>
          <span className="sub">· 生效版本 v{overview.model.version} · 状态 已生效 · 修订号 {overview.model.rowVersion}</span>
          <div className="r">
            {overview.draft
              ? <span className="bdg warn">草稿 v{overview.draft.version} · 修订号 {overview.draft.rowVersion}</span>
              : <span className="bdg done">暂无未发布草稿</span>}
          </div>
        </div>
        <div className="l-b">
          <div className="two-col">
            <div>
              <div className="note" style={{ marginBottom: 10 }}>六个维度权重合计必须为 100%；关闭输入源后该维度不参与新评分。</div>
              {overview.dimensions.map((dimension) => (
                <div className="w-row" key={dimension.dimKey}>
                  <span className="nm">{dimension.name}<span className="src">{dimension.source}</span></span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    disabled={!canModelWrite}
                    value={edit.weights[dimension.dimKey]}
                    onChange={(event) => setModelDraft({ ...edit, weights: { ...edit.weights, [dimension.dimKey]: Number(event.target.value) } })}
                    aria-label={`${dimension.name} 权重滑块`}
                  />
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    disabled={!canModelWrite}
                    value={edit.weights[dimension.dimKey]}
                    onChange={(event) => setModelDraft({ ...edit, weights: { ...edit.weights, [dimension.dimKey]: Number(event.target.value) } })}
                    aria-label={`${dimension.name} 权重百分比`}
                    style={{ width: 68 }}
                  />
                  <span className="val">%</span>
                  <label className="note" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <input
                      type="checkbox"
                      disabled={!canModelWrite}
                      checked={edit.inputSources[dimension.dimKey]}
                      onChange={(event) => setModelDraft({ ...edit, inputSources: { ...edit.inputSources, [dimension.dimKey]: event.target.checked } })}
                    />
                    {edit.inputSources[dimension.dimKey] ? "输入源已启用" : "输入源已停用"}
                  </label>
                </div>
              ))}
              <div className={`w-sum ${weightTotal === 100 ? "ok" : "bad"}`}>权重合计 {weightTotal}% · 必须等于 100%</div>
            </div>
            <div style={{ display: "grid", gap: 12, alignContent: "start" }}>
              <label className="ktint">
                <span className="tx"><b>中风险起始分</b> · 低风险低于此分数</span>
                <input type="number" min={0} max={100} step={1} disabled={!canModelWrite} value={edit.bandLowMax} onChange={(event) => setModelDraft({ ...edit, bandLowMax: Number(event.target.value) })} style={{ width: 86 }} />
              </label>
              <label className="ktint">
                <span className="tx"><b>高风险下限</b> · 高风险分档从此分数开始</span>
                <input type="number" min={0} max={100} step={1} disabled={!canModelWrite} value={edit.bandHighMin} onChange={(event) => setModelDraft({ ...edit, bandHighMin: Number(event.target.value) })} style={{ width: 86 }} />
              </label>
              <label className="ktint warn">
                <span className="tx"><b>自动升级线</b> · 达线后建议提现转人工，且不得低于高风险下限</span>
                <input type="number" min={0} max={100} step={1} disabled={!canModelWrite} value={edit.autoEscalateScore} onChange={(event) => setModelDraft({ ...edit, autoEscalateScore: Number(event.target.value) })} style={{ width: 86 }} />
              </label>
              {edit.autoEscalateScore < edit.bandHighMin && (
                <div className="ktint bad">自动升级线不能低于高风险下限；请先调整这两个阈值。</div>
              )}
            </div>
          </div>
          <details style={{ marginTop: 14 }}>
            <summary className="note" style={{ cursor: "pointer" }}>子分映射版本快照 · 24h/7d 提现基线与六维阈值随模型版本保存</summary>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 10, marginTop: 12 }}>
              {K4_MAPPING_FIELDS.map((field) => (
                <label className="ktint" key={field.key}>
                  <span className="tx"><b>{field.label}</b></span>
                  <input
                    type="number"
                    min={field.min}
                    max={field.max}
                    step={1}
                    disabled={!canModelWrite}
                    value={edit.scoreMappings[field.key]}
                    onChange={(event) => setModelDraft({
                      ...edit,
                      scoreMappings: { ...edit.scoreMappings, [field.key]: Number(event.target.value) },
                    })}
                    style={{ width: 100 }}
                  />
                </label>
              ))}
            </div>
          </details>
          <div className="w-foot" style={{ marginTop: 14 }}>
            {canModelWrite && <button className="l-btn mc" disabled={!modelValid || !mappingsValid || !modelDirty} onClick={saveModel}>保存模型草稿</button>}
            {canPublish && overview.draft && <button className="l-btn danger" disabled={modelDirty} onClick={publishModel}>发布模型草稿</button>}
            {canPublish && overview.draft && modelDirty && <span className="note">当前有未保存修改，请先保存草稿后再发布。</span>}
            <button className="l-btn" onClick={() => setModelDraft(editableModel(sourceModel))}>还原当前{overview.draft ? "草稿" : "生效模型"}</button>
            {!canModelWrite && <span className="note">当前账号没有 K4 模型草稿写入权限；请由权限管理员在 A6 授予对应能力。</span>}
          </div>
        </div>
      </section>

      <section className="l-card">
        <div className="l-h"><span className="ttl">模型版本历史</span><span className="sub">· active / draft / archived 完整快照，可恢复为草稿后再发布</span></div>
        <div className="l-b">
          {overview.modelHistory.map((model) => (
            <div className="ktint" key={`${model.version}-${model.state}`} style={{ marginBottom: 8 }}>
              <span className="tx"><b>v{model.version}</b> · {model.state} · {model.createdBy} · {model.createdAt} · {model.reason}</span>
              {canModelWrite && model.state === "archived" && (
                <button className="l-btn" disabled={modelDirty} onClick={() => ctx.openActionConfirm({
                  action: `恢复 K4 历史模型 v${model.version} 为草稿`,
                  detail: `将用历史 v${model.version} 完整覆盖当前待发布草稿，但不改变线上 v${overview.model.version}；恢复后仍须另行核对差异并发布。`,
                  run: (reason) => runAction(
                    `model-restore-${model.version}`,
                    JSON.stringify({ modelVersion: model.version, expectedVersion: modelInput.expectedVersion, reason }),
                    (commandKey) => ctx.actions.restoreK4ModelDraft(model.version, modelInput.expectedVersion, reason, commandKey),
                    `历史模型 v${model.version} 已恢复为草稿`,
                  ),
                })}>恢复为草稿</button>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="l-card">
        <div className="l-h"><span className="ttl">分档与全平台分布</span><span className="sub">· 雷达告警线只引用当前生效模型</span>
          {canRecompute && <div className="r"><button className="l-btn" disabled={overview.totalUsers > 1000} onClick={() => ctx.openActionConfirm({
            action: "全量重算 K4 风险分",
            detail: `按当前生效模型 v${overview.model.version} 原子重算 ${overview.totalUsers} 名在册用户，清除活动人工覆盖并保留历史版本快照。单次人工全量上限为 1000 人；更大规模由模型发布后的后台分片队列完成。`,
            run: (reason) => runAction(
              "batch-recompute",
              JSON.stringify({ modelVersion: overview.model.version, reason }),
              (commandKey) => ctx.actions.recomputeK4Scores([], overview.model.version, reason, commandKey),
              "K4 全量评分已重算并留痕",
              async () => { if (lookupUser) await loadUser(lookupUser.userNo); },
            ),
          })}>全量重算回模型分</button>{overview.totalUsers > 1000 && <span className="note">超过 1000 人时请通过发布模型触发后台分片重算。</span>}</div>}
        </div>
        <div className="l-b">
          {dist.length === 0 ? (
            <div className="ktint">暂无风险分布数据</div>
          ) : (
            <div className="dist-wrap">
              <BandDonut dist={dist} totalUsers={overview.totalUsers} />
              <div className="dist-rows">
                {dist.map((row) => (
                  <div className="r" key={row.band}>
                    <span className="dot2" style={{ background: row.color }} />
                    <span className="nm">{row.band} <small>{row.rangeText}</small></span>
                    <span className="ct">{fmt(row.count)}</span>
                    <span className="pc">{row.percentage}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="l-card">
        <div className="l-h">
          <span className="ttl">单用户风险分查询</span>
          <span className="sub">· 先读最新版本，再允许直接覆盖或重算</span>
          <div className="r" style={{ display: "flex", gap: 8 }}>
            <div className="lookup" style={{ width: 360, position: "relative" }}>
              <input
                value={userSearch}
                onChange={(event) => {
                  lookupSequence.current += 1;
                  setLookupUser(null);
                  setUserOptions([]);
                  setUserSearchError(null);
                  setLookupError(null);
                  setLookupLoading(false);
                  setUserSearch(event.target.value);
                  setUserSearchOpen(true);
                }}
                onFocus={() => setUserSearchOpen(true)}
                onBlur={() => window.setTimeout(() => setUserSearchOpen(false), 140)}
                onKeyDown={async (event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    if (userOptions[0]) await selectLookupUser(userOptions[0]);
                    else await loadUser(userSearch);
                  }
                  if (event.key === "Escape") setUserSearchOpen(false);
                }}
                placeholder="搜索用户编号 / 用户名 / 手机号"
                aria-label="搜索用户编号或用户名"
                aria-autocomplete="list"
                aria-controls={userOptionsId}
                aria-expanded={userSearchOpen}
                role="combobox"
              />
              {userSearchOpen && (
                <div id={userOptionsId} role="listbox" style={{ position: "absolute", left: 0, right: 0, top: "calc(100% + 6px)", zIndex: 20, display: "grid", gap: 6, padding: 8, border: "1px solid var(--line)", borderRadius: 8, background: "var(--surface)", boxShadow: "var(--shadow-lg)" }}>
                  {userSearchLoading && <div className="note" style={{ padding: "8px 10px" }}>搜索中...</div>}
                  {!userSearchLoading && userSearchError && <div className="note" style={{ padding: "8px 10px", color: "var(--danger)" }}>候选加载失败 · {userSearchError}</div>}
                  {!userSearchLoading && !userSearchError && userOptions.length === 0 && <div className="note" style={{ padding: "8px 10px" }}>暂无匹配用户</div>}
                  {!userSearchLoading && !userSearchError && userOptions.map((option) => (
                    <button
                      type="button"
                      role="option"
                      key={option.userNo}
                      aria-selected={lookupUser?.userNo === option.userNo}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => selectLookupUser(option)}
                      className="l-btn"
                      style={{ width: "100%", height: "auto", justifyContent: "space-between", gap: 12, padding: "9px 10px", textAlign: "left" }}
                    >
                      <span style={{ display: "grid", gap: 3, minWidth: 0 }}>
                        <span style={{ fontWeight: 700, color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{option.label}</span>
                        <span className="note">{option.sub}</span>
                      </span>
                      <span className={`bdg ${option.bandTone}`}>{option.bandLabel}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button className="l-btn mc" onClick={() => loadUser(userSearch)}>查询</button>
          </div>
        </div>
        <div className="l-b">
          {lookupLoading && <div className="ktint" style={{ marginBottom: 12 }}>正在读取用户最新风险分...</div>}
          {lookupError && <div className="ktint bad" style={{ marginBottom: 12 }}>查询失败 · {lookupError}</div>}
          {!lookupLoading && !lookupError && !lookupUser && <div className="ktint">请选择用户查看评分来源。</div>}
          {lookupUser && (
            <>
              <div className="score-hero">
                <div className="score-ring" style={{ background: `conic-gradient(${color} ${shown}%, var(--surface-3) 0)` }}><div className="in" style={{ color }}>{shown}</div></div>
                <div style={{ flex: 1, minWidth: 220 }}>
                  <div style={{ fontSize: 15, fontWeight: 600, color: "var(--ink)", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    {lookupUser.userNo} <span className={`bdg ${lookupUser.bandTone}`}>{lookupUser.bandLabel}</span>
                    {shown >= overview.model.autoEscalateScore && <span className="bdg warn">超过自动升级线 {overview.model.autoEscalateScore}</span>}
                  </div>
                  <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 5 }}>
                    模型分 {lookupUser.modelScore} · {lookupUser.overridden ? `人工覆盖后 ${lookupUser.effectiveScore}` : "未被人工覆盖"} · 模型版本 {lookupUser.modelVersion} · 用户修订号 {lookupUser.rowVersion} · 截止 {lookupUser.asOf}
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                    {canOverride && <button className="l-btn" onClick={() => openOverride(lookupUser)}>人工覆盖评分</button>}
                    {canRecompute && <button className="l-btn" onClick={() => openRecompute(lookupUser)}>重算回模型分</button>}
                    {!canOverride && !canRecompute && <span className="note">当前账号没有单用户评分写权限。</span>}
                  </div>
                </div>
              </div>
              <div>
                {lookupUser.contributions.map((row) => (
                  <div key={row.dimKey}>
                    <div className="dim-row">
                      <span className="nm">{row.name}</span>
                      <span>{row.hit ? <span className="bdg warn">命中</span> : <span className="bdg dim">未命中</span>}</span>
                      <span className="track"><i style={{ width: `${(row.points / maxPoints) * 100}%` }} /></span>
                      <span className="pt">{row.points} 分</span>
                    </div>
                    <div className="dim-note">子分 {row.subScore} × 权重 {row.weightPct}% = {row.points} 分{row.evidence ? ` · ${row.evidence}` : ""}</div>
                  </div>
                ))}
              </div>
              <details style={{ marginTop: 14 }}>
                <summary className="note" style={{ cursor: "pointer" }}>评分历史回放 · 最近 {lookupUser.history.length} 次</summary>
                <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
                  {lookupUser.history.length === 0 && <div className="ktint">暂无历史评分；下一次覆盖或模型重算后会保留完整六维快照。</div>}
                  {lookupUser.history.map((row, index) => (
                    <details className="ktint" key={`${row.createdAt}-${row.modelVersion}-${index}`}>
                      <summary style={{ cursor: "pointer" }}>
                        v{row.modelVersion} · 模型分 {row.modelScore} · 有效分 {row.effectiveScore} · {row.scoreState} · {row.operator} · {row.createdAt}
                      </summary>
                      <div className="note" style={{ marginTop: 8 }}>{row.reason}</div>
                      <div style={{ display: "grid", gap: 4, marginTop: 6 }}>
                        {row.contributions.map((item) => (
                          <div className="note" key={item.dimKey}>
                            {item.name} · {item.hit ? "命中" : "未命中"} · 子分 {item.subScore} × 权重 {item.weightPct}% = {item.points} 分{item.evidence ? ` · ${item.evidence}` : ""}
                          </div>
                        ))}
                      </div>
                    </details>
                  ))}
                </div>
              </details>
              {lookupUser.modelVersion !== `k4-v${overview.model.version}` && (
                <div className="ktint warn" style={{ marginTop: 10 }}>该用户仍在后台分片重算队列中；当前卡片是旧模型快照，可点击“回归模型分”立即按 v{overview.model.version} 重算。</div>
              )}
            </>
          )}
        </div>
      </section>

      <section className="l-card">
        <div className="l-h"><span className="ttl">人工覆盖记录</span><span className="sub">· 谁、把谁的分、从多少改到多少、为什么</span></div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 780 }}>
            <thead><tr><th>账户</th><th className="num">模型分</th><th className="num">覆盖分</th><th>原因</th><th>操作人</th><th>时间</th><th style={{ textAlign: "right" }}>动作</th></tr></thead>
            <tbody>
              {overrides.length === 0 && <tr><td colSpan={7} style={{ textAlign: "center", color: "var(--ink-4)" }}>暂无人工覆盖记录</td></tr>}
              {overrides.map((row) => (
                <tr key={`${row.userNo}-${row.timeText}`} style={!row.active ? { opacity: 0.62 } : undefined}>
                  <td className="mono" style={{ color: "var(--ink)" }}>{row.userNo}</td>
                  <td className="num mono">{row.modelScore}</td>
                  <td className="num mono" style={{ fontWeight: 700, color: row.overrideScore > row.modelScore ? "var(--danger)" : "var(--success)" }}>{row.overrideScore}</td>
                  <td style={{ fontSize: 12.5, color: "var(--ink-3)" }}>{row.reason}</td>
                  <td className="mono" style={{ fontSize: 11.5 }}>{row.operator}</td>
                  <td className="mono" style={{ fontSize: 11.5, color: "var(--ink-4)" }}>{row.timeText}</td>
                  <td style={{ textAlign: "right" }}>
                    {row.active && canRecompute
                      ? <button className="l-btn sm" onClick={async () => { await prepareRecompute(row.userNo); }}>回模型分</button>
                      : <span className="bdg dim">{row.active ? "无重算权限" : "已回模型分"}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <DataListPager
          label="人工覆盖记录"
          page={overridesPage.pageNum}
          pageSize={overridesPage.pageSize}
          total={overridesPage.total}
          onPageChange={setOverridePage}
          onPageSizeChange={(next) => { setOverridePageSize(next); setOverridePage(1); }}
          pageSizeOptions={[5, 10, 20, 50]}
        />
      </section>
    </div>
  );
}

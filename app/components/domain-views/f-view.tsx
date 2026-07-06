"use client";

import { currentAdminOperator } from "@/lib/admin/current-operator";
/**
 * F 分销与团队 — 设计稿 design_handoff_f_domain 内容视图(F1–F5)。
 * 标签:F1 V-Rank 晋升 / F2 网络版税费率 / F3 双轨结算引擎 / F4 池·配额·大使·榜 / F5 佣金事件审计。
 * 导航已按设计稿收编为 F1–F5(旧 F6 硬件配额 / F7 区域大使 / F8 排行榜&反欺诈 已并入 F4「池/配额/大使/榜」聚合视图)。
 *
 * 本 shell 只持有后端快照 state + OperationConfirmModal;各 tab 视觉/布局拆到 f-tabs/*(复用 design-kit 原语 + f-domain.css 设计类)。
 * 真写落点:F1 走后端 teams/ranks;F2/F3/F4/F5 走后端 teams/{rates|binary|leadership-pool|commissions} + commissions/config。
 * - 调参类(op:"param"):F1 V-Rank 字段、F2 费率/参数、F3 双轨配置、F4 池/配额/大使/榜配置写后端;未知 key 直接失败。
 * - 处置类(op:"dispose"):写入固定状态值(approved/rejected/disqualified/frozen/unlocked …)。
 * - 放大资金流出(amplify):OperationConfirmModal amplifies={true} → B1 兑付覆盖率护栏。
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { OperationConfirmModal, useToast, useDomainNav } from "./design-kit";
import { DomainHeader, type DomainViewMeta } from "./domain-header";
import {
  addF1VRankReward,
  fetchF3BinaryOverview,
  fetchF4LeadershipPoolOverview,
  fetchF5CommissionAuditOverview,
  fetchF2RatesOverview,
  fetchF1VRankOverview,
  removeF1VRankReward,
  updateF3TeamConfig,
  updateF4TeamConfig,
  updateF5TeamConfig,
  updateFTeamConfig,
  updateF1TeamConfig,
  updateF1VRankReward,
  updateF1VRankThreshold,
  type F3BinaryOverview,
  type F4LeadershipPoolOverview,
  type F5CommissionAuditOverview,
  type F2RatesOverview,
  type F1VRankOverview,
} from "@/lib/admin/f1-client";
import type { Mc, FViewCtx } from "./f-tabs/types";
import { F1Vrank } from "./f-tabs/f1-vrank";
import { F2Rates } from "./f-tabs/f2-rates";
import { F3Binary } from "./f-tabs/f3-binary";
import { F4Ops } from "./f-tabs/f4-ops";
import { F5Audit } from "./f-tabs/f5-audit";
import "./f-domain.css";

const FOLD: Record<string, string> = { F1: "F1", F2: "F2", F3: "F3", F4: "F4", F5: "F5" };
const ADMIN_OPERATOR = currentAdminOperator;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || "UNKNOWN_ERROR");
}

function f1ThresholdTarget(paramKey?: string) {
  const match = paramKey?.match(/^F\.vrank\.(V\d{1,2})\.([A-Za-z]+)$/);
  return match ? { rank: match[1], field: match[2] } : null;
}

export function FDomainView({ meta }: { meta: DomainViewMeta }) {
  const [toastNode, setToast] = useToast();
  const nav = useDomainNav();
  const router = useRouter();
  const routeTab = FOLD[meta.l2Id] ?? "F2";
  const [tab, setTab] = useState(routeTab);
  const [mc, setActionConfirm] = useState<Mc>(null);
  const [f1Overview, setF1Overview] = useState<F1VRankOverview | null>(null);
  const [f1Loading, setF1Loading] = useState(tab === "F1");
  const [f1Error, setF1Error] = useState<string | null>(null);
  const [f2Overview, setF2Overview] = useState<F2RatesOverview | null>(null);
  const [f2Loading, setF2Loading] = useState(tab === "F2");
  const [f2Error, setF2Error] = useState<string | null>(null);
  const [f3Overview, setF3Overview] = useState<F3BinaryOverview | null>(null);
  const [f3Loading, setF3Loading] = useState(tab === "F3");
  const [f3Error, setF3Error] = useState<string | null>(null);
  const [f4Overview, setF4Overview] = useState<F4LeadershipPoolOverview | null>(null);
  const [f4Loading, setF4Loading] = useState(tab === "F4");
  const [f4Error, setF4Error] = useState<string | null>(null);
  const [f5Overview, setF5Overview] = useState<F5CommissionAuditOverview | null>(null);
  const [f5Loading, setF5Loading] = useState(tab === "F5");
  const [f5Error, setF5Error] = useState<string | null>(null);
  useEffect(() => {
    setTab(routeTab);
  }, [routeTab]);

  const refreshF1 = useCallback(async () => {
    setF1Loading(true);
    setF1Error(null);
    try {
      setF1Overview(await fetchF1VRankOverview());
    } catch (error) {
      setF1Error(errorMessage(error));
    } finally {
      setF1Loading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === "F1") void refreshF1();
  }, [refreshF1, tab]);

  const refreshF2 = useCallback(async () => {
    setF2Loading(true);
    setF2Error(null);
    try {
      setF2Overview(await fetchF2RatesOverview());
    } catch (error) {
      setF2Error(errorMessage(error));
    } finally {
      setF2Loading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === "F2") void refreshF2();
  }, [refreshF2, tab]);

  const refreshF3 = useCallback(async () => {
    setF3Loading(true);
    setF3Error(null);
    try {
      setF3Overview(await fetchF3BinaryOverview());
    } catch (error) {
      setF3Error(errorMessage(error));
    } finally {
      setF3Loading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === "F3") void refreshF3();
  }, [refreshF3, tab]);

  const refreshF4 = useCallback(async () => {
    setF4Loading(true);
    setF4Error(null);
    try {
      setF4Overview(await fetchF4LeadershipPoolOverview());
    } catch (error) {
      setF4Error(errorMessage(error));
    } finally {
      setF4Loading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === "F4") void refreshF4();
  }, [refreshF4, tab]);

  const refreshF5 = useCallback(async () => {
    setF5Loading(true);
    setF5Error(null);
    try {
      setF5Overview(await fetchF5CommissionAuditOverview());
    } catch (error) {
      setF5Error(errorMessage(error));
    } finally {
      setF5Loading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === "F5") void refreshF5();
  }, [refreshF5, tab]);

  const ctx: FViewCtx = {
    openActionConfirm: (m) => setActionConfirm(m),
    nav,
    toast: (msg) => setToast(msg),
    vrankRows: f1Overview?.rows ?? [],
    leadership: f1Overview?.leadership ?? null,
    f1Loading,
    f1Error,
    refreshF1,
    updateVRankThreshold: async (rank, field, value, reason) => {
      setF1Overview(await updateF1VRankThreshold(rank, field, value, reason, ADMIN_OPERATOR()));
      setF1Error(null);
    },
    updateF1Config: async (key, value, reason) => {
      setF1Overview(await updateF1TeamConfig(key, value, reason, ADMIN_OPERATOR()));
      setF1Error(null);
    },
    rewards: f1Overview?.rewards ?? {},
    addReward: async (level, item, reason) => {
      const { id: _id, ...payload } = item;
      setF1Overview(await addF1VRankReward(level, payload, reason, ADMIN_OPERATOR()));
      setF1Error(null);
    },
    updateReward: async (level, id, patch, reason) => {
      if (!patch.type) throw new Error("请选择奖励类型。");
      setF1Overview(await updateF1VRankReward(level, id, {
        type: patch.type,
        amount: patch.amount,
        voucherId: patch.voucherId,
        skuId: patch.skuId,
        custom: patch.custom,
      }, reason, ADMIN_OPERATOR()));
      setF1Error(null);
    },
    removeReward: async (level, id, reason) => {
      setF1Overview(await removeF1VRankReward(level, id, reason, ADMIN_OPERATOR()));
      setF1Error(null);
    },
    voucherOptions: f1Overview?.voucherOptions ?? [],
    voucherLabels: f1Overview?.voucherLabels ?? {},
    skuOptions: f1Overview?.skuOptions ?? [],
    skuLabels: f1Overview?.skuLabels ?? {},
    f1ConfigValues: f1Overview?.configValues ?? {},
    f2Metrics: f2Overview?.metrics ?? [],
    f2Unilevel: f2Overview?.unilevel ?? [],
    f2RateTiers: f2Overview?.rateTiers ?? [],
    f2Params: f2Overview?.params ?? [],
    f2CommissionPolicy: f2Overview?.commissionPolicy ?? {},
    f2Guardrails: f2Overview?.guardrails ?? [],
    f2ConfigValues: f2Overview?.configValues ?? {},
    f2Loading,
    f2Error,
    refreshF2,
    updateF2Config: async (key, value, reason) => {
      setF2Overview(await updateFTeamConfig(key, value, reason, ADMIN_OPERATOR()));
      setF2Error(null);
    },
    f3Metrics: f3Overview?.metrics ?? [],
    f3Formula: f3Overview?.formula ?? null,
    f3Settlements: f3Overview?.settlements ?? [],
    f3MaxTrackGmv: f3Overview?.maxTrackGmv ?? 1,
    f3Config: f3Overview?.config ?? null,
    f3ConfigValues: f3Overview?.configValues ?? {},
    f3DailyCap: f3Overview?.dailyCap ?? null,
    f3ParticipantCount: f3Overview?.participantCount ?? 0,
    f3BlockedCount: f3Overview?.blockedCount ?? 0,
    f3MonthlyMatchedUsd: f3Overview?.monthlyMatchedUsd ?? 0,
    f3AutoPlacement7dCount: f3Overview?.autoPlacement7dCount ?? 0,
    f3DailyMatchUsd: f3Overview?.dailyMatchUsd ?? 0,
    f3Loading,
    f3Error,
    refreshF3,
    updateF3Config: async (key, value, reason) => {
      setF3Overview(await updateF3TeamConfig(key, value, reason, ADMIN_OPERATOR()));
      setF3Error(null);
    },
    f4Overview,
    f4Loading,
    f4Error,
    refreshF4,
    updateF4Config: async (key, value, reason) => {
      setF4Overview(await updateF4TeamConfig(key, value, reason, ADMIN_OPERATOR()));
      setF4Error(null);
    },
    f5Overview,
    f5Loading,
    f5Error,
    refreshF5,
    updateF5Config: async (key, value, reason) => {
      setF5Overview(await updateF5TeamConfig(key, value, reason, ADMIN_OPERATOR()));
      setF5Error(null);
    },
  };

  // 跨域 / 跨标签跳转 CTA(放进 DomainHeader 的 right 槽,不改 DomainHeader 组件)
  const CTA: Record<string, { label: string; onClick: () => void }> = {
    F1: { label: "领导池票数权重 →", onClick: () => { setTab("F4"); router.push("/network/leadership-pool"); setToast("已跳转 F4 · 领导池票数权重"); } },
    F2: { label: "合并出口护栏 →", onClick: () => setToast("查看合并出口护栏(§1.8)") },
    F3: { label: "B5 风险雷达 →", onClick: () => nav("B") },
    F4: { label: "F5 佣金审计 →", onClick: () => { setTab("F5"); router.push("/network/commissions"); setToast("已跳转 F5 · 佣金事件审计"); } },
    F5: { label: "导出 CSV →", onClick: () => setToast("导出当前筛选 CSV") },
  };
  const cta = CTA[tab];

  return (
    <div className="dkpage fdom">
      <DomainHeader {...meta} right={cta ? <button className="f-cta" onClick={cta.onClick}>{cta.label}</button> : undefined} />

      {tab === "F1" && <F1Vrank ctx={ctx} />}
      {tab === "F2" && <F2Rates ctx={ctx} />}
      {tab === "F3" && <F3Binary ctx={ctx} />}
      {tab === "F4" && <F4Ops ctx={ctx} />}
      {tab === "F5" && <F5Audit ctx={ctx} />}

      {mc && <OperationConfirmModal
        action={mc.name}
        detail={mc.detail ?? "server-canonical · 改后对下一笔结算生效,不回溯已计提"}
        amplifies={!!mc.amplify}
        edit={mc.edit}
        businessForm={mc.businessForm}
        onClose={() => setActionConfirm(null)}
        onConfirm={async (reason, newVal, businessValue) => {
          try {
          if (mc.run) {
            await mc.run(reason, businessValue, newVal);
          } else if (mc.op === "param" && mc.paramKey) {
            if (!newVal) { setToast("请填写目标新值"); return; }
            const target = f1ThresholdTarget(mc.paramKey);
            if (target) {
              await ctx.updateVRankThreshold(target.rank, target.field, newVal, reason);
            } else if (tab === "F2") {
              await ctx.updateF2Config(mc.paramKey, newVal, reason);
            } else if (tab === "F3") {
              await ctx.updateF3Config(mc.paramKey, newVal, reason);
            } else if (tab === "F4") {
              await ctx.updateF4Config(mc.paramKey, newVal, reason);
            } else if (tab === "F1") {
              await ctx.updateF1Config(mc.paramKey, newVal, reason);
            } else {
              throw new Error(`F_BACKEND_ROUTE_MISSING:${mc.paramKey}`);
            }
            setToast(mc.name + " 已确认生效 · 新值 " + newVal);
          } else if (mc.op === "param-multi" && mc.paramKeys && businessValue) {
            // 多字段调参:每字段写到自己的 param key;F3/F4 经后端持久化,其它 key 不允许本地兜底。
            if (tab === "F3") {
              for (const { key, paramKey } of mc.paramKeys) {
                const value = String(businessValue[key] ?? "").trim();
                if (value) await ctx.updateF3Config(paramKey, value, reason);
              }
            } else if (tab === "F4") {
              for (const { key, paramKey } of mc.paramKeys) {
                const value = String(businessValue[key] ?? "").trim();
                if (value) await ctx.updateF4Config(paramKey, value, reason);
              }
            } else {
              throw new Error(`F_BACKEND_ROUTE_MISSING:${mc.paramKeys.map((item) => item.paramKey).join(",")}`);
            }
            const summary = mc.paramKeys.map(({ key }) => String(businessValue[key] ?? "").trim()).join(" / ");
            setToast(mc.name + " 已确认生效 · " + summary);
          } else if (mc.op === "dispose" && mc.paramKey && mc.fixedVal) {
            if (tab === "F1") {
              await ctx.updateF1Config(mc.paramKey, mc.fixedVal, reason);
            } else if (tab === "F2") {
              await ctx.updateF2Config(mc.paramKey, mc.fixedVal, reason);
            } else if (tab === "F3") {
              await ctx.updateF3Config(mc.paramKey, mc.fixedVal, reason);
            } else if (tab === "F4") {
              await ctx.updateF4Config(mc.paramKey, mc.fixedVal, reason);
            } else if (tab === "F5") {
              await ctx.updateF5Config(mc.paramKey, mc.fixedVal, reason);
            } else {
              throw new Error(`F_BACKEND_ROUTE_MISSING:${mc.paramKey}`);
            }
            setToast(mc.name + " 已确认生效");
          } else {
            setToast("已确认生效");
          }
          setActionConfirm(null);
          } catch (error) {
            setToast("F 域数据提交失败 · " + errorMessage(error));
          }
        }} />}
      {toastNode}
    </div>
  );
}

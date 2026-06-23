"use client";

/**
 * F 分销与团队 — 设计稿 design_handoff_f_domain 内容视图(F1–F5)。
 * 标签:F1 V-Rank 晋升 / F2 网络版税费率 / F3 双轨结算引擎 / F4 池·配额·大使·榜 / F5 佣金事件审计。
 * 导航已按设计稿收编为 F1–F5(旧 F6 硬件配额 / F7 区域大使 / F8 排行榜&反欺诈 已并入 F4「池/配额/大使/榜」聚合视图)。
 *
 * 本 shell 只持有共享 store 接线 + OperationConfirmModal;各 tab 视觉/布局拆到 f-tabs/*(复用 design-kit 原语 + f-domain.css 设计类)。
 * 真写落点:运营处置 / 调参统一进 platform-config-store(setParam keyed 状态 + 审计),persist + 水合门。
 * - 调参类(op:"param"):OperationConfirmModal 出「目标新值」→ onConfirm 的 newVal 真写,派生显示 pget(key) ?? mock 原值。
 * - 处置类(op:"dispose"):写入固定状态值(approved/rejected/disqualified/frozen/unlocked …)。
 * - 放大资金流出(amplify):OperationConfirmModal amplifies={true} → B1 兑付覆盖率护栏。
 */
import { useState, useEffect } from "react";
import { OperationConfirmModal, useToast, useDomainNav } from "./design-kit";
import { DomainHeader, type DomainViewMeta } from "./domain-header";
import { usePlatformConfig, type OpsSku } from "@/lib/store/admin/platform-config-store";
import { useOpsHydrated } from "@/lib/store/admin/user-ops-store";
import { VRANK_REWARD_SEED } from "./f-tabs/data";
import { VOUCHER_SEED } from "@/lib/mock/admin/vouchers";
import { SKUS } from "@/lib/mock/admin/design-data";
import type { Mc, FViewCtx } from "./f-tabs/types";
import { F1Vrank } from "./f-tabs/f1-vrank";
import { F2Rates } from "./f-tabs/f2-rates";
import { F3Binary } from "./f-tabs/f3-binary";
import { F4Ops } from "./f-tabs/f4-ops";
import { F5Audit } from "./f-tabs/f5-audit";
import "./f-domain.css";

const FOLD: Record<string, string> = { F1: "F1", F2: "F2", F3: "F3", F4: "F4", F5: "F5" };

export function FDomainView({ meta }: { meta: DomainViewMeta }) {
  const [toastNode, setToast] = useToast();
  const nav = useDomainNav();
  const [tab] = useState(FOLD[meta.l2Id] ?? "F2");
  const [mc, setActionConfirm] = useState<Mc>(null);
  const setParam = usePlatformConfig((s) => s.setParam);
  const params = usePlatformConfig((s) => s.params);
  // V-Rank 等级奖励切片 + 代金券 / SKU(供奖励下拉选项)
  const vRankRewards = usePlatformConfig((s) => s.vRankRewards);
  const ensureVRankRewards = usePlatformConfig((s) => s.ensureVRankRewards);
  const addVRankReward = usePlatformConfig((s) => s.addVRankReward);
  const updateVRankReward = usePlatformConfig((s) => s.updateVRankReward);
  const removeVRankReward = usePlatformConfig((s) => s.removeVRankReward);
  const vouchers = usePlatformConfig((s) => s.vouchers);
  const ensureVouchers = usePlatformConfig((s) => s.ensureVouchers);
  const skus = usePlatformConfig((s) => s.skus);
  const ensureSkus = usePlatformConfig((s) => s.ensureSkus);
  const logAudit = usePlatformConfig((s) => s.logAudit);
  const hydrated = useOpsHydrated();
  const pget = (k: string): string | undefined => (hydrated ? (params?.[k] as string | undefined) : undefined);

  useEffect(() => {
    ensureVRankRewards(VRANK_REWARD_SEED);
    ensureVouchers(VOUCHER_SEED);
    ensureSkus(SKUS as OpsSku[]);
  }, [ensureVRankRewards, ensureVouchers, ensureSkus]);

  // 首帧 / SSR 用 seed;hydrate 后用真 store(hydration 安全)。
  const rewards = hydrated && vRankRewards ? vRankRewards : VRANK_REWARD_SEED;
  const voucherList = hydrated && vouchers ? vouchers : VOUCHER_SEED;
  const activeVouchers = voucherList.filter((v) => (v.status ?? "active") === "active");
  const voucherOptions = activeVouchers.map((v) => v.id);
  const voucherLabels: Record<string, string> = Object.fromEntries(activeVouchers.map((v) => [v.id, v.name]));
  const skuList = hydrated && skus ? skus : (SKUS as OpsSku[]);
  const activeSkus = skuList.filter((s) => (s.status || "on") === "on");
  const skuOptions = activeSkus.map((s) => s.id ?? s.name);
  const skuLabels: Record<string, string> = Object.fromEntries(activeSkus.map((s) => [s.id ?? s.name, s.name]));

  const ctx: FViewCtx = {
    pget,
    openActionConfirm: (m) => setActionConfirm(m),
    nav,
    toast: (msg) => setToast(msg),
    rewards,
    addReward: (level, item, reason) => {
      addVRankReward(level, item);
      logAudit({ actor: "总管理员", action: `F1 ${level} 新增奖励`, target: `F.vrank.${level}.reward.${item.id}`, reason });
    },
    updateReward: (level, id, patch, reason) => {
      updateVRankReward(level, id, patch);
      logAudit({ actor: "总管理员", action: `F1 ${level} 编辑奖励`, target: `F.vrank.${level}.reward.${id}`, reason });
    },
    removeReward: (level, id, reason) => {
      removeVRankReward(level, id);
      logAudit({ actor: "总管理员", action: `F1 ${level} 移除奖励`, target: `F.vrank.${level}.reward.${id}`, reason });
    },
    voucherOptions,
    voucherLabels,
    skuOptions,
    skuLabels,
  };

  // 跨域 / 跨标签跳转 CTA(放进 DomainHeader 的 right 槽,不改 DomainHeader 组件)
  const CTA: Record<string, { label: string; onClick: () => void }> = {
    F1: { label: "领导池票数权重 →", onClick: () => setToast("跳转 F4 · 领导池票数权重") },
    F2: { label: "合并出口护栏 →", onClick: () => setToast("查看合并出口护栏(§1.8)") },
    F3: { label: "B5 风险雷达 →", onClick: () => nav("B") },
    F4: { label: "F5 佣金审计 →", onClick: () => setToast("跳转 F5 · 佣金事件审计") },
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
        onConfirm={(reason, newVal, businessValue) => {
          if (mc.run) {
            mc.run(reason, businessValue);
          } else if (mc.op === "param" && mc.paramKey) {
            if (!newVal) { setToast("请填写目标新值"); return; }
            setParam(mc.paramKey, newVal, { action: mc.name, reason });
            setToast(mc.name + " 已确认生效 · 新值 " + newVal);
          } else if (mc.op === "param-multi" && mc.paramKeys && businessValue) {
            // 多字段调参:每字段写到自己的 param key(各值独立 backend-replaceable),镜像 E 域 shell。
            for (const { key, paramKey } of mc.paramKeys) {
              setParam(paramKey, String(businessValue[key] ?? "").trim(), { action: mc.name, reason });
            }
            const summary = mc.paramKeys.map(({ key }) => String(businessValue[key] ?? "").trim()).join(" / ");
            setToast(mc.name + " 已确认生效 · " + summary);
          } else if (mc.op === "dispose" && mc.paramKey && mc.fixedVal) {
            setParam(mc.paramKey, mc.fixedVal, { action: mc.name, reason });
            setToast(mc.name + " 已确认生效");
          } else {
            setToast("已确认生效");
          }
          setActionConfirm(null);
        }} />}
      {toastNode}
    </div>
  );
}

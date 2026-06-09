"use client";

/**
 * F 分销与团队 — 设计稿 design_handoff_f_domain 内容视图(F1–F5)。
 * 标签:F1 V-Rank 晋升 / F2 网络版税费率 / F3 双轨结算引擎 / F4 池·配额·大使·榜 / F5 佣金事件审计。
 * 导航已按设计稿收编为 F1–F5(旧 F6 硬件配额 / F7 区域大使 / F8 排行榜&反欺诈 已并入 F4「池/配额/大使/榜」聚合视图)。
 *
 * 本 shell 只持有共享 store 接线 + MakerCheckerModal;各 tab 视觉/布局拆到 f-tabs/*(复用 design-kit 原语 + f-domain.css 设计类)。
 * 真写落点:运营处置 / 调参统一进 platform-config-store(setParam keyed 状态 + 审计),persist + 水合门。
 * - 调参类(op:"param"):MakerCheckerModal 出「目标新值」→ onConfirm 的 newVal 真写,派生显示 pget(key) ?? mock 原值。
 * - 处置类(op:"dispose"):写入固定状态值(approved/rejected/disqualified/frozen/unlocked …)。
 * - 放大资金流出(amplify):MakerCheckerModal amplifies={true} → B1 兑付覆盖率护栏。
 */
import { useState } from "react";
import { MakerCheckerModal, useToast, useDomainNav } from "./design-kit";
import { DomainHeader, type DomainViewMeta } from "./domain-header";
import { usePlatformConfig } from "@/lib/store/admin/platform-config-store";
import { useOpsHydrated } from "@/lib/store/admin/user-ops-store";
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
  const [mc, setMc] = useState<Mc>(null);
  const setParam = usePlatformConfig((s) => s.setParam);
  const params = usePlatformConfig((s) => s.params);
  const hydrated = useOpsHydrated();
  const pget = (k: string): string | undefined => (hydrated ? (params?.[k] as string | undefined) : undefined);

  const ctx: FViewCtx = { pget, openMc: (m) => setMc(m), nav, toast: (msg) => setToast(msg) };

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

      {mc && <MakerCheckerModal
        action={mc.name}
        detail={mc.detail ?? "server-canonical · 改后对下一笔结算生效,不回溯已计提"}
        amplifies={!!mc.amplify}
        edit={mc.edit}
        onClose={() => setMc(null)}
        onConfirm={(reason, newVal) => {
          if (mc.op === "param" && mc.paramKey) {
            if (!newVal) { setToast("请填写目标新值"); return; }
            setParam(mc.paramKey, newVal, { action: mc.name, reason });
            setToast(mc.name + " 已提交复核 · 新值 " + newVal);
          } else if (mc.op === "dispose" && mc.paramKey && mc.fixedVal) {
            setParam(mc.paramKey, mc.fixedVal, { action: mc.name, reason });
            setToast(mc.name + " 已提交复核");
          } else {
            setToast("已提交复核");
          }
          setMc(null);
        }} />}
      {toastNode}
    </div>
  );
}

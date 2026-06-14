"use client";

/**
 * H 增长与运营节奏 — design_handoff_h_domain port(2026-06-12 重构)。
 * 4 子页 = 6 子模块映射:H1 节奏调度器 / H2 免费试用引擎 / H3 任务与活动(含 H4) / H5 签到与里程碑(含 H6)。
 *   FOLD: H4→H3, H6→H5(handoff 4 张设计稿 1:1 映射)。
 * 三类弹窗:OperationConfirmModal(操作确认,显式 edit 契约)/ KConfirmModal(普通确认,复用 K 域原语)/ Drawer。
 * 真写 18 类键(H.* / H1.* / H2.* / H3.* / H4.* / H5.* / H6.*),沿用旧 h-view 同 H.phase.dial.<k>。
 * amplifies 仅放大流出方向(放松 dial / 升奖励 / 升概率 / 升 NEX 奖励 / 降门槛 / 真实奖)。
 * 单源:design-data.PHASE + LEDGER + h-tabs/data.ts。
 */
import { useMemo, useState } from "react";
import "./h-domain.css";
import { OperationConfirmModal, useToast } from "./design-kit";
import { DomainHeader, type DomainViewMeta } from "./domain-header";
import { usePlatformConfig } from "@/lib/store/admin/platform-config-store";
import { useOpsHydrated } from "@/lib/store/admin/user-ops-store";
import { KConfirmModal } from "./k-tabs/confirm-modal";
import { PHASE } from "@/lib/mock/admin/design-data";
import H1Phase from "./h-tabs/h1-phase";
import H2Trial from "./h-tabs/h2-trial";
import H3QuestEvents from "./h-tabs/h3-quest-events";
import H5DailyMilestones from "./h-tabs/h5-daily-milestones";
import type { ConfirmReq, HCtx, ActionConfirmReq } from "./h-tabs/types";

/** L2 6→4 FOLD:H4→H3(任务与活动同页);H6→H5(签到与里程碑同页)。 */
const FOLD: Record<string, string> = { H1: "H1", H2: "H2", H3: "H3", H4: "H3", H5: "H5", H6: "H5" };

const RO_LIVE: Record<string, [ro: string, live: string]> = {
  H1: ["阶段流转只能服务器推进 · 客户端不能写", `${PHASE.current} · 月 ${PHASE.month} · 每月 1 日 00:00 UTC 自动推进`],
  H2: ["扣款失败概率仅 server 可见 · 永不下发前端", "auto-push 1.5s 急停实时 · 进行中按开始时锁定值结算"],
  H3: ["转盘 RNG 在 server · 概率公开但裁决不在前端", "in-flight 按入窗/入周/跨档快照结算 · 不追溯"],
  H5: ["签到/转盘裁决 server-canonical · 客户端只显示结果", "幸运两档和 ≤100% 422 · 里程碑严格保序 422"],
};

export function HDomainView({ meta }: { meta: DomainViewMeta }) {
  const [toastNode, setToast] = useToast();
  const tab = useMemo(() => FOLD[meta.l2Id] ?? "H1", [meta.l2Id]);
  const setParam = usePlatformConfig((s) => s.setParam);
  const logAudit = usePlatformConfig((s) => s.logAudit);
  const params = usePlatformConfig((s) => s.params);
  const hydrated = useOpsHydrated();
  const [mc, setActionConfirm] = useState<ActionConfirmReq | null>(null);
  const [cf, setCf] = useState<ConfirmReq | null>(null);

  const ctx: HCtx = {
    pget: (k) => (hydrated ? (params?.[k] as string | undefined) : undefined),
    params: hydrated && params ? params : {},
    setParam,
    logAudit,
    toast: setToast,
    openActionConfirm: setActionConfirm,
    openConfirm: setCf,
  };

  const [ro, live] = RO_LIVE[tab];
  const right = (
    <>
      <span className="f-ro"><span className="d" />{ro}</span>
      <span className="f-live"><span className="dot" />{live}</span>
    </>
  );

  return (
    <div className="dkpage hdom">
      <DomainHeader {...meta} right={right} />

      {tab === "H1" && <H1Phase ctx={ctx} />}
      {tab === "H2" && <H2Trial ctx={ctx} />}
      {tab === "H3" && <H3QuestEvents ctx={ctx} />}
      {tab === "H5" && <H5DailyMilestones ctx={ctx} />}

      {mc && (
        <OperationConfirmModal
          action={mc.action}
          detail={mc.detail}
          amplifies={mc.amplifies}
          edit={mc.edit}
          businessForm={mc.businessForm}
          onClose={() => setActionConfirm(null)}
          onConfirm={(reason, newValue, businessValue) => { mc.run(reason, newValue, businessValue); setActionConfirm(null); }}
        />
      )}
      {cf && <KConfirmModal req={cf} onClose={() => setCf(null)} />}
      {toastNode}
    </div>
  );
}

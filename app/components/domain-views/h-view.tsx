"use client";

/**
 * H 增长与活动 — design_handoff_h_domain port(2026-06-12 重构)。
 * H3 用户任务管理和 H4 活动中心来自高保真同页顶部分段,在控制台菜单层拆成两个独立入口。
 * PC 端只保留 H5 签到与里程碑页,不再暴露独立里程碑入口。
 * 三类弹窗:OperationConfirmModal(操作确认,显式 edit 契约)/ KConfirmModal(普通确认,复用 K 域原语)/ Drawer。
 * H1-H9 有效数据源统一走后端 /api/admin/growth/*,历史 platform-config 本地状态不再作为数据源。
 * H9 历史数据展示设置整组原子写；正式 App 对外事实另读服务端实测聚合。
 * amplifies 仅放大流出方向(放松 dial / 升奖励 / 升概率 / 升 NEX 奖励 / 降门槛 / 真实奖)。
 * 统一来源:后端 /api/admin/growth/* 读模型。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import "./h-domain.css";
import { OperationConfirmModal, useToast } from "./design-kit";
import { DomainHeader, type DomainViewMeta } from "./domain-header";
import { KConfirmModal } from "./k-tabs/confirm-modal";
import H1Phase from "./h-tabs/h1-phase";
import H2Trial from "./h-tabs/h2-trial";
import H3QuestEvents, { H4ActivityCenter } from "./h-tabs/h3-quest-events";
import H5DailyMilestones from "./h-tabs/h5-daily-milestones";
import H7VoucherConfig from "./h-tabs/h7-voucher-config";
import H8ReferralRewards from "./h-tabs/h8-referral-rewards";
import H9PublicStats from "./h-tabs/h9-public-stats";
import H4Promotions from "./h-tabs/h4-promotions";
import type { ConfirmReq, HCtx, ActionConfirmReq } from "./h-tabs/types";
import { fetchH1Rhythm, describeH1Schedule, type H1RhythmOverview } from "@/lib/admin/h-client";
import { displayAdminError } from "@/lib/admin/error-messages";
import { useAdminAuth } from "@/lib/store/admin-auth";

/** L2 映射:H3/H4 分别渲染高保真里的任务分段/活动分段;H5 承载签到与里程碑。 */
// H6 折进 H5 同页（里程碑配置就在签到页里）；侧栏只保留服务端登记的 H5，
// H5 页面内用明确分区承载里程碑，旧 /growth/milestones 地址只做兼容迁移。
const FOLD: Record<string, string> = { H1: "H1", H2: "H2", H3: "H3", H4: "H4", H5: "H5", H6: "H5", H7: "H7", H8: "H8", H9: "H9" };



export function HDomainView({ meta }: { meta: DomainViewMeta }) {
  const [toastNode, setToast] = useToast();
  const access = useAdminAuth(useShallow((state) => [state.authEpoch, state.session?.role, ...(state.session?.authorities ?? [])]));
  const tab = useMemo(() => FOLD[meta.l2Id] ?? "H1", [meta.l2Id]);
  const [rhythm, setRhythm] = useState<H1RhythmOverview | null>(null);
  const [mc, setActionConfirm] = useState<ActionConfirmReq | null>(null);
  const [cf, setCf] = useState<ConfirmReq | null>(null);
  const can = useCallback((authority: string) => {
    return access[1] === "superadmin" || access[1] === "super" || access.slice(2).includes(authority);
  }, [access]);

  const ctx: HCtx = {
    toast: setToast,
    openActionConfirm: setActionConfirm,
    openConfirm: setCf,
    can,
  };

  useEffect(() => {
    if (tab !== "H1") return;
    let cancelled = false;
    fetchH1Rhythm()
      .then((next) => {
        if (!cancelled) setRhythm(next);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [tab]);

  const right = tab === "H1" && rhythm
    ? <span className="f-live"><span className="dot" />{`${rhythm.currentPhase} · 第 ${rhythm.currentMonth}/${rhythm.totalMonths} 月 · ${describeH1Schedule(rhythm.schedule)}`}</span>
    : null;

  return (
    <div className={tab === "H4" ? "hdom" : "dkpage hdom"}>
      {tab !== "H4" && <DomainHeader {...meta} right={right} />}

      {tab === "H1" && <H1Phase ctx={ctx} />}
      {tab === "H2" && <H2Trial ctx={ctx} />}
      {tab === "H3" && <H3QuestEvents ctx={ctx} />}
      {tab === "H4" && <H4Promotions ctx={ctx} legacy={<><DomainHeader {...meta} right={right} /><H4ActivityCenter ctx={ctx} /></>} />}
      {tab === "H5" && <H5DailyMilestones ctx={ctx} />}
      {tab === "H7" && <H7VoucherConfig ctx={ctx} />}
      {tab === "H8" && <H8ReferralRewards ctx={ctx} />}
      {tab === "H9" && <H9PublicStats ctx={ctx} />}

      {mc && (
        <OperationConfirmModal
          action={mc.action}
          detail={mc.detail}
          amplifies={mc.amplifies}
          edit={mc.edit}
          businessForm={mc.businessForm}
          onClose={() => setActionConfirm(null)}
          onConfirm={async (reason, newValue, businessValue) => {
            try {
              await mc.run(reason, newValue, businessValue);
              setActionConfirm(null);
            } catch (error) {
              setToast(error instanceof Error ? displayAdminError(error) : "操作失败");
              throw error;
            }
          }}
        />
      )}
      {cf && <KConfirmModal req={cf} onClose={() => setCf(null)} />}
      {toastNode}
    </div>
  );
}

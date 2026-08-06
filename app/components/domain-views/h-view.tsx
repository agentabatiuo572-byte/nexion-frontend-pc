"use client";

/**
 * H 增长与运营节奏 — design_handoff_h_domain port(2026-06-12 重构)。
 * H3 任务引擎和 H4 活动中心来自高保真同页顶部分段,在控制台菜单层拆成两个独立入口。
 * PC 端只保留 H5 签到与里程碑页,不再暴露独立里程碑入口。
 * 三类弹窗:OperationConfirmModal(操作确认,显式 edit 契约)/ KConfirmModal(普通确认,复用 K 域原语)/ Drawer。
 * H1-H9 有效数据源统一走后端 /api/admin/growth/*,历史 platform-config 本地状态不再作为数据源。
 * H9 对外公布数据(前端首页平台规模与名次口径)整组原子写,不拆成逐参数提交。
 * amplifies 仅放大流出方向(放松 dial / 升奖励 / 升概率 / 升 NEX 奖励 / 降门槛 / 真实奖)。
 * 单源:后端 /api/admin/growth/* 读模型。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
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
import type { ConfirmReq, HCtx, ActionConfirmReq } from "./h-tabs/types";
import { fetchH1Rhythm, type H1RhythmOverview } from "@/lib/admin/h-client";
import { displayAdminError } from "@/lib/admin/error-messages";
import { useAdminAuth } from "@/lib/store/admin-auth";

/** L2 映射:H3/H4 分别渲染高保真里的任务分段/活动分段;H5 承载签到与里程碑。 */
// H6 折进 H5 同页(里程碑配置就在签到页里),但导航保留独立入口:折叠是布局决定,
// 不该让功能从导航上消失 —— 运营找「里程碑」不该靠知道它藏在签到页下半屏。
const FOLD: Record<string, string> = { H1: "H1", H2: "H2", H3: "H3", H4: "H4", H5: "H5", H6: "H5", H7: "H7", H8: "H8", H9: "H9" };

const RO_COPY: Record<string, [ro: string, live: string]> = {
  H1: ["阶段流转只能服务器推进 · 客户端不能改", ""],
  H2: ["扣款失败概率只在服务器 · 永不下发前端", "自动推送 1.5 秒即时急停 · 进行中的按开始时锁定值结算"],
  H3: ["任务完成态和奖励结算由服务器裁决", "进行中的按入窗/入周/跨档快照结算 · 不追溯"],
  H4: ["转盘抽奖在服务器跑 · 概率公开,但中没中不由前端定", "主推唯一性、活动状态、转盘护栏均由后端校验"],
  H5: ["签到/转盘的结果由服务器定 · 客户端只显示", "幸运两档概率之和 ≤100% · 里程碑阈值严格从低到高"],
  H7: ["代金券领取/核销在服务器裁决 · 客户端只展示与跳转", "改参即时对前端领券弹窗 + banner 生效 · 促销折扣非负债不走 B1"],
  H8: ["邀请关系和是否已结算由服务器裁决", "真实钱包 + 资金台账 · 同一新人唯一结算"],
  H9: ["对外公布的数由服务器下发 · 客户端只展示", "整组原子保存 · 改设备总数连带改公布金额口径"],
};

export function HDomainView({ meta }: { meta: DomainViewMeta }) {
  const [toastNode, setToast] = useToast();
  const session = useAdminAuth((state) => state.session);
  const tab = useMemo(() => FOLD[meta.l2Id] ?? "H1", [meta.l2Id]);
  const [rhythm, setRhythm] = useState<H1RhythmOverview | null>(null);
  const [mc, setActionConfirm] = useState<ActionConfirmReq | null>(null);
  const [cf, setCf] = useState<ConfirmReq | null>(null);
  const can = useCallback((authority: string) => {
    const role = session?.role;
    const authorities = session?.authorities ?? [];
    return role === "superadmin" || role === "super" || authorities.includes(authority);
  }, [session]);

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

  const [ro, liveSeed] = RO_COPY[tab];
  const live = tab === "H1"
    ? rhythm
      ? `${rhythm.currentPhase} · 月 ${rhythm.currentMonth}/${rhythm.totalMonths} · 每月 1 日 00:00 UTC 自动推进`
      : "0"
    : liveSeed;
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
      {tab === "H4" && <H4ActivityCenter ctx={ctx} />}
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

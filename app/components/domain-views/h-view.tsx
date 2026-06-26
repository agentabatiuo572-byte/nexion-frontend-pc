"use client";

/**
 * H 增长与运营节奏 — design_handoff_h_domain port(2026-06-12 重构)。
 * 4 子页 = 6 子模块映射:H1 节奏调度器 / H2 免费试用引擎 / H3 任务与活动(含 H4) / H5 签到与里程碑(含 H6)。
 *   FOLD: H4→H3, H6→H5(handoff 4 张设计稿 1:1 映射)。
 * 三类弹窗:OperationConfirmModal(操作确认,显式 edit 契约)/ KConfirmModal(普通确认,复用 K 域原语)/ Drawer。
 * H1-H7 有效数据源统一走后端 /api/admin/growth/*,历史 platform-config 本地状态不再作为数据源。
 * amplifies 仅放大流出方向(放松 dial / 升奖励 / 升概率 / 升 NEX 奖励 / 降门槛 / 真实奖)。
 * 单源:后端 /api/admin/growth/* 读模型 + MySQL nx_config_item 种子数据。
 */
import { useEffect, useMemo, useState } from "react";
import "./h-domain.css";
import { OperationConfirmModal, useToast } from "./design-kit";
import { DomainHeader, type DomainViewMeta } from "./domain-header";
import { KConfirmModal } from "./k-tabs/confirm-modal";
import H1Phase from "./h-tabs/h1-phase";
import H2Trial from "./h-tabs/h2-trial";
import H3QuestEvents from "./h-tabs/h3-quest-events";
import H5DailyMilestones from "./h-tabs/h5-daily-milestones";
import H7VoucherConfig from "./h-tabs/h7-voucher-config";
import type { ConfirmReq, HCtx, ActionConfirmReq } from "./h-tabs/types";
import { fetchH1Rhythm, type H1RhythmOverview } from "@/lib/admin/h-client";

/** L2 6→4 FOLD:H4→H3(任务与活动同页);H6→H5(签到与里程碑同页)。 */
const FOLD: Record<string, string> = { H1: "H1", H2: "H2", H3: "H3", H4: "H3", H5: "H5", H6: "H5", H7: "H7" };

const RO_LIVE: Record<string, [ro: string, live: string]> = {
  H1: ["阶段流转只能服务器推进 · 客户端不能改", "每月 1 日 00:00 UTC 自动推进"], // live 恒由下方 rs 分支覆盖,此 seed 不渲染(不依赖 PHASE)
  H2: ["扣款失败概率只在服务器 · 永不下发前端", "自动推送 1.5 秒即时急停 · 进行中的按开始时锁定值结算"],
  H3: ["转盘抽奖在服务器跑 · 概率公开,但中没中不由前端定", "进行中的按入窗/入周/跨档快照结算 · 不追溯"],
  H5: ["签到/转盘的结果由服务器定 · 客户端只显示", "幸运两档概率之和 ≤100% · 里程碑阈值严格从低到高"],
  H7: ["代金券领取/核销在服务器裁决 · 客户端只展示与跳转", "改参即时对前端领券弹窗 + banner 生效 · 促销折扣非负债不走 B1"],
};

export function HDomainView({ meta }: { meta: DomainViewMeta }) {
  const [toastNode, setToast] = useToast();
  const tab = useMemo(() => FOLD[meta.l2Id] ?? "H1", [meta.l2Id]);
  const [rhythm, setRhythm] = useState<H1RhythmOverview | null>(null);
  const [mc, setActionConfirm] = useState<ActionConfirmReq | null>(null);
  const [cf, setCf] = useState<ConfirmReq | null>(null);

  const ctx: HCtx = {
    pget: () => undefined,
    params: {},
    setParam: () => undefined,
    logAudit: () => undefined,
    toast: setToast,
    openActionConfirm: setActionConfirm,
    openConfirm: setCf,
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

  const [ro, liveSeed] = RO_LIVE[tab];
  const live = tab === "H1" && rhythm
    ? `${rhythm.currentPhase} · 月 ${rhythm.currentMonth}/${rhythm.totalMonths} · 每月 1 日 00:00 UTC 自动推进`
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
      {tab === "H5" && <H5DailyMilestones ctx={ctx} />}
      {tab === "H7" && <H7VoucherConfig ctx={ctx} />}

      {mc && (
        <OperationConfirmModal
          action={mc.action}
          detail={mc.detail}
          amplifies={mc.amplifies}
          edit={mc.edit}
          businessForm={mc.businessForm}
          onClose={() => setActionConfirm(null)}
          onConfirm={(reason, newValue, businessValue) => {
            try {
              const result = mc.run(reason, newValue, businessValue) as unknown;
              if (result && typeof (result as Promise<unknown>).then === "function") {
                void (result as Promise<unknown>).catch((error) => {
                  setToast(error instanceof Error ? error.message : "操作失败");
                });
              }
            } finally {
              setActionConfirm(null);
            }
          }}
        />
      )}
      {cf && <KConfirmModal req={cf} onClose={() => setCf(null)} />}
      {toastNode}
    </div>
  );
}

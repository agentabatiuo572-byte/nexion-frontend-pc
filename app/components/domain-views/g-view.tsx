"use client";

/**
 * G 金融产品 — design_handoff_g_domain 设计稿 port(2026-06-11;2026-06-15 下线 Premium/NEX v2)。
 * 5 子页:G1 Staking / G2 兑换风控 / G3 NEX 行情引擎 / G4 Genesis 经济 / G7 复投激励。
 * 三类弹窗:OperationConfirmModal(操作确认 + 显式 edit 契约)/ KConfirmModal(普通确认,复用 K 原语)/ Drawer(详情下钻)。
 * 真写沿用旧契约(G.staking.* / G.exchange.* / G.market.* / G.genesis.* / G.repurchase.*);
 * 产品级熔断改写 J.killswitch.<staking|exchange|genesis> 与 J1/首页/B5 同键真联动。
 * 单源:LEDGER 科目体系(在锁/利息/到期应付,含 #5 NEX v2 存量在锁负债仍计兑付)/ NEX_MARKET(G2/G7 定价源)/ GEOBLOCK(J2)/ MATURITY(Genesis 派发流量)。
 * amplifies = 放大流出方向(升 APY/降罚款/放宽 caps/拉价/升 pump/升排放/升倍率/恢复熔断/恢复开售)。
 */
import { useMemo, useState } from "react";
import "./g-domain.css";
import { OperationConfirmModal, useToast } from "./design-kit";
import { DomainHeader, type DomainViewMeta } from "./domain-header";
import { usePlatformConfig } from "@/lib/store/admin/platform-config-store";
import { useOpsHydrated } from "@/lib/store/admin/user-ops-store";
import { KConfirmModal } from "./k-tabs/confirm-modal";
import { G1Staking } from "./g-tabs/g1-staking";
import { G2Exchange } from "./g-tabs/g2-exchange";
import { G3Market } from "./g-tabs/g3-market";
import { G4Genesis } from "./g-tabs/g4-genesis";
import { G7Repurchase } from "./g-tabs/g7-repurchase";
import type { ConfirmReq, GCtx, ActionConfirmReq } from "./g-tabs/types";

const FOLD: Record<string, string> = { G1: "G1", G2: "G2", G3: "G3", G4: "G4", G7: "G7" };

// 每页两枚签名 chip(设计稿 f-bar):f-ro = server-canonical 不变量,f-live = 节奏/红线。
const RO_LIVE: Record<string, [ro: string, live: string]> = {
  G1: ["在锁本金、利息、状态都以服务器为准", "调高年化、调低罚金先过备付金红线"],
  G2: ["拦截判定都在服务器 · 客户端绕不过", "放宽额度先过备付金红线"],
  G3: ["价格 100% 由服务器定 · 是兑换/复投的定价来源", "每 4 秒喂一次价"],
  G4: ["持有、排放、成交都以服务器为准", "排放率 0.1%/天已裁定"],
  G7: ["限时倍率由 H1 派发 · 这页只读", "调高年化、倍率或调低罚金过备付金红线"],
};

export function GDomainView({ meta }: { meta: DomainViewMeta }) {
  const [toastNode, setToast] = useToast();
  const tab = useMemo(() => FOLD[meta.l2Id] ?? "G1", [meta.l2Id]);
  const setParam = usePlatformConfig((s) => s.setParam);
  const params = usePlatformConfig((s) => s.params);
  const hydrated = useOpsHydrated();
  const [mc, setActionConfirm] = useState<ActionConfirmReq | null>(null);
  const [cf, setCf] = useState<ConfirmReq | null>(null);

  const ctx: GCtx = {
    pget: (k) => (hydrated ? (params?.[k] as string | undefined) : undefined),
    params: hydrated && params ? params : {},
    setParam,
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
    <div className="dkpage gdom">
      <DomainHeader {...meta} right={right} />

      {tab === "G1" && <G1Staking ctx={ctx} />}
      {tab === "G2" && <G2Exchange ctx={ctx} />}
      {tab === "G3" && <G3Market ctx={ctx} />}
      {tab === "G4" && <G4Genesis ctx={ctx} />}
      {tab === "G7" && <G7Repurchase ctx={ctx} />}

      {mc && (
        <OperationConfirmModal
          action={mc.action}
          detail={mc.detail}
          amplifies={mc.amplifies}
          edit={mc.edit}
          onClose={() => setActionConfirm(null)}
          onConfirm={(reason, newValue) => { mc.run(reason, newValue); setActionConfirm(null); }}
        />
      )}
      {cf && <KConfirmModal req={cf} onClose={() => setCf(null)} />}
      {toastNode}
    </div>
  );
}

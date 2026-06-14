"use client";

/**
 * G 金融产品 — design_handoff_g_domain 设计稿 port(2026-06-11 重构)。
 * 5 子页:G1 Staking / G2 兑换风控 / G3 NEX 行情引擎 / G4 Genesis 经济 / G5–G7 订阅·锁仓·复投(segmented)。
 * 路由折叠:nav G5/G6/G7 → 合并页(按 l2Id 预选 segment)。
 * 三类弹窗:OperationConfirmModal(操作确认 + 显式 edit 契约)/ KConfirmModal(普通确认,复用 K 原语)/ Drawer(详情下钻)。
 * 真写沿用旧契约(G.staking.* / G.exchange.* / G.market.* / G.genesis.* / G.premium.* / G.nexv2.* / G.repurchase.*);
 * 产品级熔断改写 J.killswitch.<staking|exchange|genesis|premium|nexv2> 与 J1/首页/B5 同键真联动。
 * 单源:LEDGER 科目体系(在锁/利息/到期应付)/ NEX_MARKET(G2/G7 定价源)/ GEOBLOCK(J2)/ MATURITY(Genesis 派发流量)。
 * amplifies = 放大流出方向(升 APY/降罚款/放宽 caps/拉价/升 pump/升分红/升权益/升倍率/恢复熔断/恢复开售)。
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
import { G5Products } from "./g-tabs/g5-products";
import type { ConfirmReq, GCtx, ActionConfirmReq } from "./g-tabs/types";

const FOLD: Record<string, string> = { G1: "G1", G2: "G2", G3: "G3", G4: "G4", G5: "G5", G6: "G5", G7: "G5" };
const SEG: Record<string, "g5" | "g6" | "g7"> = { G5: "g5", G6: "g6", G7: "g7" };

// 每页两枚签名 chip(设计稿 f-bar):f-ro = server-canonical 不变量,f-live = 节奏/红线。
const RO_LIVE: Record<string, [ro: string, live: string]> = {
  G1: ["在锁本金/利息/状态全服务器为准", "升息/降罚先过备付金红线"],
  G2: ["拦截判定全服务器 · 客户端绕不过", "放宽额度先过备付金红线"],
  G3: ["价格 100% 服务端驱动 · 是兑换/复投的定价源", "喂价 1 tick / 4s"],
  G4: ["持有/分红/成交全服务器为准", "分红率 0.1%/日已裁定"],
  G5: ["阶段开关归 H1 派发 · 这里只读", "升息/升权益过备付金红线"],
};

export function GDomainView({ meta }: { meta: DomainViewMeta }) {
  const [toastNode, setToast] = useToast();
  const tab = useMemo(() => FOLD[meta.l2Id] ?? "G1", [meta.l2Id]);
  const initialSeg = SEG[meta.l2Id] ?? "g5";
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
      {tab === "G5" && <G5Products ctx={ctx} initialSeg={initialSeg} />}

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

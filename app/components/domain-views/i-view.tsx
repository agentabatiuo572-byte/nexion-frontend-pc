"use client";

/**
 * I 内容与合规 CMS — design_handoff_i_domain 设计稿 port(2026-06-11 重构)。
 * 6 子页覆盖 8 PRD 子模块:I1 转化文案 A/B / I2 Nova 推送运营 / I3 通知 Campaign /
 *   I4+I5 信任中心与披露(合并) / I6+I7 i18n 与教程(合并) / I8 客服支持 CMS。
 * 三类弹窗:OperationConfirmModal(操作确认,显式 edit 契约)/ KConfirmModal(普通确认,复用 K 域原语)。
 * 真写统一 platform-config setParam(I.*)+ usePlatformConfig.novas 共享 store(I2 旧 i-view 已建)。
 * 单源:NOVA(design-data,Nova 通道单源)/ COPY_POOL / CAMPAIGNS / TRUST_SECTIONS / JURISDICTIONS /
 *   NAMESPACES / COURSES(i-tabs/data 文件头裁定)。
 * amplifies 唯一流出方向 = I7 课程奖励上调(B1 红线核验,SPEC §4 注:拒绝码 V4 目标 422,B1 现行 403)。
 */
import { useMemo, useState } from "react";
import "./i-domain.css";
import { OperationConfirmModal, useToast } from "./design-kit";
import { DomainHeader, type DomainViewMeta } from "./domain-header";
import { usePlatformConfig } from "@/lib/store/admin/platform-config-store";
import { useOpsHydrated } from "@/lib/store/admin/user-ops-store";
import { KConfirmModal } from "./k-tabs/confirm-modal";
import { I1CopyAb } from "./i-tabs/i1-copy-ab";
import { I2Nova } from "./i-tabs/i2-nova";
import { I3Campaign } from "./i-tabs/i3-campaign";
import { I4Trust } from "./i-tabs/i4-trust";
import { I6I18n } from "./i-tabs/i6-i18n";
import { I8Support } from "./i-tabs/i8-support";
import { I9Conversation } from "./i-tabs/i9-conversation";
import type { ConfirmReq, ICtx, ActionConfirmReq } from "./i-tabs/types";

const FOLD: Record<string, string> = {
  I1: "I1",
  I2: "I2",
  I3: "I3",
  I4: "I4",
  I5: "I4", // I5 披露合并入 I4 信任中心页
  I6: "I6",
  I7: "I6", // I7 课程合并入 I6 i18n 页
  I8: "I8",
  I9: "I9",
};

const RO_LIVE: Record<string, [ro: string, live: string]> = {
  I1: ["版本和实验分组都在服务器 · 用户侧改不了", "进行中实验:3 个"],
  I2: ["10 通道节奏 server-canonical · 整体停 Nova 才入 J 域", "Nova 点击率 27.4% · 目标 >25% ✓"],
  I3: ["通知唯一账本在服务器 · App 端只是显示窗口", "critical 通道:永不淘汰"],
  I4: ["条款和确认状态都在服务器 · client 篡改无效", "SFC 辖区 re-ack 进行中 · 72%"],
  I6: ["词条 server 单源 · 单语言发布闸不许关", "完整性问题:10 处"],
  I8: ["客服回复和关闭都写平台审计 · 资金/账户处置回业务域", "处理中工单:3 · 高优先级:3"],
  I9: ["会话/话术/策略单源在服务器 · 坐席回复写审计", "进行中会话:2 · 待回复:1"],
};

export function IDomainView({ meta }: { meta: DomainViewMeta }) {
  const [toastNode, setToast] = useToast();
  const tab = useMemo(() => FOLD[meta.l2Id] ?? "I1", [meta.l2Id]);
  const setParam = usePlatformConfig((s) => s.setParam);
  const logAudit = usePlatformConfig((s) => s.logAudit);
  const params = usePlatformConfig((s) => s.params);
  const hydrated = useOpsHydrated();
  const [mc, setActionConfirm] = useState<ActionConfirmReq | null>(null);
  const [cf, setCf] = useState<ConfirmReq | null>(null);

  const ctx: ICtx = {
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
    <div className="dkpage idom">
      <DomainHeader {...meta} right={right} />

      {tab === "I1" && <I1CopyAb ctx={ctx} />}
      {tab === "I2" && <I2Nova ctx={ctx} />}
      {tab === "I3" && <I3Campaign ctx={ctx} />}
      {tab === "I4" && <I4Trust ctx={ctx} />}
      {tab === "I6" && <I6I18n ctx={ctx} />}
      {tab === "I8" && <I8Support ctx={ctx} />}
      {tab === "I9" && <I9Conversation ctx={ctx} />}

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

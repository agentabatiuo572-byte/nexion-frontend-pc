"use client";

/**
 * C 用户与账户 — design_handoff_c_domain 设计稿 port(2026-06-11 重构)。
 * 6 子页:C1 检索画像 / C2 账户操作 / C3 余额资产调整 / C4 KYC 合规台账 / C5 安全会话 / C6 注册登录风控。
 * 三类弹窗:OperationConfirmModal(操作确认,显式 edit 契约)/ KConfirmModal(普通确认,复用 K 域原语)。
 * 真写统一 platform-config setParam(C.adjust.* / C.kyc.<id>.st / C.user.<id>.pwReset /
 * C.impersonate.* / C.session.<ssid>.forcedOut + C.session.user.<uid>.allOut / C.list.* /
 * C.twofa.* / C.lock.* / C.sess.* / C.regrisk.*;旧 C.user.<id>.restricted 已弃,被名单取代)+
 * 冻结/资产走 useUserOps 共享 store(setFrozen / earningAppend,与 /users/search/[id] 360 页同源)。
 * 单源:USERS(K4 同分)/ K_RISK(K1 簇与冻结口径)/ K5_TICKETS 引用 / LEDGER(覆盖率红线)/
 * REGISTERED_USERS(C4 三段闭合)/ WITHDRAWALS(冻结原子联动 D.withdraw.<id>.st 同键)。
 * amplifies 仅放大资金流出方向(C2 解冻 / C3 加钱与重新放行 / C4 人工标记已验证)。
 */
import { useMemo, useState } from "react";
import "./c-domain.css";
import { OperationConfirmModal, useToast } from "./design-kit";
import { DomainHeader, type DomainViewMeta } from "./domain-header";
import { usePlatformConfig } from "@/lib/store/admin/platform-config-store";
import { useOpsHydrated } from "@/lib/store/admin/user-ops-store";
import { KConfirmModal } from "./k-tabs/confirm-modal";
import { ImpersonateMirror } from "@/app/components/impersonate/impersonate-mirror";
import { USERS } from "@/lib/mock/admin/design-data";
import { C1Search, C1HeaderActions } from "./c-tabs/c1-search";
import { C2Actions } from "./c-tabs/c2-actions";
import { C3Adjust } from "./c-tabs/c3-adjust";
import { C4Kyc, C4HeaderActions } from "./c-tabs/c4-kyc";
import { C5Security } from "./c-tabs/c5-security";
import { C6Regrisk } from "./c-tabs/c6-regrisk";
import type { CCtx, ConfirmReq, ActionConfirmReq } from "./c-tabs/types";

const FOLD: Record<string, string> = { C1: "C1", C2: "C2", C3: "C3", C4: "C4", C5: "C5", C6: "C6" };

// 每页两枚签名 chip(设计稿 f-bar):f-ro = server-canonical 不变量,f-live = 节奏/留痕承诺。
const RO_LIVE: Record<string, [ro: string, live: string]> = {
  C1: ["只读检索 · 处置去对应页面", "敏感查看全留痕"],
  C2: ["冻结台账的权威落在这页", "模拟登录全程只读 + 限时"],
  C3: ["每笔都落账本 · 不是开后门的地方", "加钱方向盯着覆盖率红线"],
  C4: ["实名状态的唯一真相源", "提现/兑换/复审都来这里取真值"],
  C5: ["账户解锁的处置权统一在这页", "高敏操作 = 操作确认 + 实名二验"],
  C6: ["只配「何时锁」 · 解锁去 C5", "验证码与锁定全在服务器执行"],
};

type MirrorUser = (typeof USERS)[number];

export function CDomainView({ meta }: { meta: DomainViewMeta }) {
  const [toastNode, setToast] = useToast();
  const tab = useMemo(() => FOLD[meta.l2Id] ?? "C1", [meta.l2Id]);
  const setParam = usePlatformConfig((s) => s.setParam);
  const logAudit = usePlatformConfig((s) => s.logAudit);
  const params = usePlatformConfig((s) => s.params);
  const hydrated = useOpsHydrated();
  const [mc, setActionConfirm] = useState<ActionConfirmReq | null>(null);
  const [cf, setCf] = useState<ConfirmReq | null>(null);
  const [impUser, setImpUser] = useState<MirrorUser | null>(null);

  const ctx: CCtx = {
    pget: (k) => (hydrated ? (params?.[k] as string | undefined) : undefined),
    params: hydrated && params ? params : {},
    setParam,
    logAudit,
    toast: setToast,
    openActionConfirm: setActionConfirm,
    openConfirm: setCf,
    startMirror: (userId) => {
      const u = USERS.find((x) => x.id === userId);
      if (u) setImpUser(u);
      else setToast(`模拟登录 ${userId} 已授权 · 只读 30min(该账户无可载入的镜像画面,轨迹照常留痕)`);
    },
  };

  const [ro, live] = RO_LIVE[tab];
  const right = (
    <>
      <span className="f-ro"><span className="d" />{ro}</span>
      <span className="f-live"><span className="dot" />{live}</span>
      {tab === "C1" && <C1HeaderActions ctx={ctx} />}
      {tab === "C4" && <C4HeaderActions ctx={ctx} />}
    </>
  );

  return (
    <div className="dkpage cdom">
      <DomainHeader {...meta} right={right} />

      {tab === "C1" && <C1Search ctx={ctx} />}
      {tab === "C2" && <C2Actions ctx={ctx} />}
      {tab === "C3" && <C3Adjust ctx={ctx} />}
      {tab === "C4" && <C4Kyc ctx={ctx} />}
      {tab === "C5" && <C5Security ctx={ctx} />}
      {tab === "C6" && <C6Regrisk ctx={ctx} />}

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
      {impUser && <ImpersonateMirror user={impUser} onExit={() => setImpUser(null)} />}
      {toastNode}
    </div>
  );
}

"use client";

/**
 * I 内容与合规 CMS — design_handoff_i_domain 设计稿 port(2026-06-11 重构;2026-06-15 客服 I8/I9 迁出至域 M 客服中心)。
 * 5 子页覆盖 7 PRD 子模块:I1 转化文案 A/B / I2 Nova 推送运营 / I3 通知 Campaign /
 *   I4 信任中心与披露(合并) / I6 i18n 与教程(合并)。
 * 三类弹窗:OperationConfirmModal(操作确认,显式 edit 契约)/ KConfirmModal(普通确认,复用 K 域原语)。
 * 真写统一走后端 /content/* 接口;概览为空时由后端写入 MySQL 种子后再查出。
 * amplifies 唯一流出方向 = 课程奖励上调(B1 红线核验,SPEC §4 注:拒绝码 V4 目标 422,B1 现行 403)。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import "./i-domain.css";
import { OperationConfirmModal, useToast } from "./design-kit";
import { DomainHeader, type DomainViewMeta } from "./domain-header";
import { fetchIContentOverviews, iContentActions, type IContentData } from "@/lib/admin/i-client";
import { KConfirmModal } from "./k-tabs/confirm-modal";
import { I1CopyAb } from "./i-tabs/i1-copy-ab";
import { I2Nova } from "./i-tabs/i2-nova";
import { I3Campaign } from "./i-tabs/i3-campaign";
import { I4Trust } from "./i-tabs/i4-trust";
import { I6I18n } from "./i-tabs/i6-i18n";
import type { ConfirmReq, ICtx, ActionConfirmReq } from "./i-tabs/types";

const FOLD: Record<string, string> = {
  I1: "I1",
  I2: "I2",
  I3: "I3",
  I4: "I4",
  I6: "I6",
};

const RO_LIVE: Record<string, [ro: string, live: string]> = {
  I1: ["版本和实验分组都在服务器 · 用户侧改不了", "进行中实验:3 个"],
  I2: ["10 个通道节奏以服务器为准 · 整体停 Nova 才轮到 J 域", "Nova 点击率 27.4% · 目标 >25% ✓"],
  I3: ["通知唯一账本在服务器 · App 端只是显示窗口", "紧急通道:永不丢弃"],
  I4: ["条款和确认状态都在服务器 · 客户端篡改无效", "SFC 辖区重新确认进行中 · 72%"],
  I6: ["词条以服务器为唯一来源 · 单语言发布闸不许关", "完整性问题:10 处"],
};

export function IDomainView({ meta }: { meta: DomainViewMeta }) {
  const [toastNode, setToast] = useToast();
  const tab = useMemo(() => FOLD[meta.l2Id] ?? "I1", [meta.l2Id]);
  const [mc, setActionConfirm] = useState<ActionConfirmReq | null>(null);
  const [cf, setCf] = useState<ConfirmReq | null>(null);
  const [content, setContent] = useState<IContentData>({});
  const [contentLoading, setContentLoading] = useState(true);
  const [contentError, setContentError] = useState<string | null>(null);

  const reloadIContent = useCallback(async () => {
    setContentLoading(true);
    setContentError(null);
    try {
      setContent(await fetchIContentOverviews());
    } catch (error) {
      setContentError(error instanceof Error ? error.message : "I_CONTENT_LOAD_FAILED");
    } finally {
      setContentLoading(false);
    }
  }, []);

  useEffect(() => {
    void reloadIContent();
  }, [reloadIContent]);

  const actions = useMemo(
    () => ({
      ...iContentActions,
      reloadIContent,
    }),
    [reloadIContent],
  );

  const ctx: ICtx = {
    pget: () => undefined,
    params: {},
    setParam: () => undefined,
    logAudit: () => undefined,
    toast: setToast,
    openActionConfirm: setActionConfirm,
    openConfirm: setCf,
    content,
    actions,
    contentLoading,
    contentError,
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

      {contentError && (
        <section className="l-card">
          <div className="l-b">
            <div className="itint danger">
              <b>I 域数据加载失败</b> · {contentError}
            </div>
          </div>
        </section>
      )}

      {tab === "I1" && <I1CopyAb ctx={ctx} />}
      {tab === "I2" && <I2Nova ctx={ctx} />}
      {tab === "I3" && <I3Campaign ctx={ctx} />}
      {tab === "I4" && <I4Trust ctx={ctx} />}
      {tab === "I6" && <I6I18n ctx={ctx} />}

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

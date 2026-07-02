"use client";

/**
 * I 内容与合规 CMS — design_handoff_i_domain 设计稿 port(2026-06-11 重构;2026-06-15 客服 I8/I9 迁出至域 M 客服中心)。
 * 5 子页覆盖 7 PRD 子模块:I1 转化文案 A/B / I2 Nova 推送运营 / I3 通知 Campaign /
 *   I4 信任中心与披露(合并) / I6 i18n 与教程(合并)。
 * 三类弹窗:OperationConfirmModal(操作确认,显式 edit 契约)/ KConfirmModal(普通确认,复用 K 域原语)。
 * 真写统一走后端 /content/* 接口;概览为空时保持空态,不在前端补业务样例。
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

const RO_COPY: Record<string, string> = {
  I1: "版本和实验分组都在服务器 · 用户侧改不了",
  I2: "通道节奏以服务器为准 · 整体停 Nova 才轮到 J 域",
  I3: "通知唯一账本在服务器 · App 端只是显示窗口",
  I4: "条款和确认状态都在服务器 · 客户端篡改无效",
  I6: "词条以服务器为唯一来源 · 单语言发布闸不许关",
};

function countText(value?: number) {
  return Number(value ?? 0).toLocaleString();
}

function liveFromBackend(tab: string, content: IContentData, loading: boolean, error: string | null) {
  if (loading) return "数据加载中";
  if (error) return "接口异常";
  if (tab === "I1") {
    const stats = content.copyAb?.stats;
    return stats ? `进行中实验:${countText(stats.runningExps)} 个 · 管理文案:${countText(stats.managedCopies)} 条` : "暂无后端业务数据";
  }
  if (tab === "I2") {
    const stats = content.nova?.stats;
    return stats ? `Nova 点击率 ${stats.ctr} · 在线 ${countText(stats.onlineChannels)}/${countText(stats.totalChannels)}` : "暂无后端业务数据";
  }
  if (tab === "I3") {
    const stats = content.campaigns?.stats;
    return stats ? `紧急通道:${countText(stats.criticalInflight)} 条在途 · 本月发送 ${stats.monthSent}` : "暂无后端业务数据";
  }
  if (tab === "I4") {
    const stats = content.trustDisclosure?.stats;
    if (!stats) return "暂无后端业务数据";
    return stats.reackPct !== undefined
      ? `${stats.reackJurisdiction || "法域"} 重新确认 ${stats.reackPct}% · 待确认用户 ${countText(stats.staleAckUsers)}`
      : `待确认用户 ${countText(stats.staleAckUsers)} · 本周阻断 ${countText(stats.weeklyGateBlocked)}`;
  }
  if (tab === "I6") {
    const stats = content.i18nLearning?.stats;
    return stats ? `完整性问题:${countText(stats.integrityIssues)} 处 · 在线课程:${countText(stats.coursesOnline)} 门` : "暂无后端业务数据";
  }
  return "暂无后端业务数据";
}

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
    toast: setToast,
    openActionConfirm: setActionConfirm,
    openConfirm: setCf,
    content,
    actions,
    contentLoading,
    contentError,
  };

  const ro = RO_COPY[tab];
  const live = liveFromBackend(tab, content, contentLoading, contentError);
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

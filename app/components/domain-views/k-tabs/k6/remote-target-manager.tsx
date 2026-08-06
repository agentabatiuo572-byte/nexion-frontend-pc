"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createK6RemoteTargetVersion,
  disableK6RemoteTarget,
  fetchK6RemoteTargetOrigins,
  fetchK6RemoteTargets,
  K6OutcomeUncertainError,
} from "@/lib/admin/k6-client";
import { displayAdminError } from "@/lib/admin/error-messages";
import type { K6RemoteTarget } from "@/lib/admin/k6-remote-target-contract";
import { useAdminAuth } from "@/lib/store/admin-auth";

type LoadState = "loading" | "ready" | "error";
type PendingDisable = Pick<K6RemoteTarget,
  "catalogVersion" | "remoteTargetKey" | "remoteTargetVersion" | "label" | "lockVersion">;

function errorText(error: unknown) {
  return error instanceof Error && error.message ? displayAdminError(error) : "批准目标操作失败";
}

function validHttps(value: string) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:"
      && !parsed.username
      && !parsed.password
      && !parsed.search
      && !parsed.hash;
  } catch {
    return false;
  }
}

export function K6RemoteTargetManager() {
  const authorities = useAdminAuth((state) => state.session?.authorities ?? []);
  const canManage = authorities.includes("risk_k6_target_manage");
  const [targets, setTargets] = useState<K6RemoteTarget[]>([]);
  const [allowedOrigins, setAllowedOrigins] = useState<string[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [message, setMessage] = useState("");
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("https://");
  const [owner, setOwner] = useState("");
  const [reason, setReason] = useState("");
  const [impact, setImpact] = useState("");
  const [pendingDisable, setPendingDisable] = useState<PendingDisable | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async (committed = false) => {
    setLoadState("loading");
    try {
      const [targetRows, originRows] = await Promise.all([
        fetchK6RemoteTargets(),
        fetchK6RemoteTargetOrigins(),
      ]);
      setTargets(targetRows);
      setAllowedOrigins(originRows);
      setLoadState("ready");
      if (!committed) setMessage("");
      return true;
    } catch (error) {
      setLoadState("error");
      setMessage(committed
        ? `操作已写入，但最新数据回读失败；请勿重复提交，稍后点“重试读取”。${errorText(error)}`
        : errorText(error));
      return false;
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const latestVersions = useMemo(() => {
    const result = new Map<string, number>();
    targets.forEach((target) => result.set(
      target.remoteTargetKey,
      Math.max(result.get(target.remoteTargetKey) ?? 0, target.remoteTargetVersion),
    ));
    return result;
  }, [targets]);
  const catalogVersion = targets.reduce((max, target) => Math.max(max, target.catalogVersion), 0);
  const urlOrigin = (() => {
    try {
      return new URL(url.trim()).origin;
    } catch {
      return "";
    }
  })();
  const createValid = loadState === "ready"
    && /^[a-z][a-z0-9-]{1,63}$/.test(key.trim())
    && label.trim().length >= 2 && label.trim().length <= 96
    && owner.trim().length >= 2 && owner.trim().length <= 96
    && validHttps(url.trim())
    && allowedOrigins.includes(urlOrigin)
    && reason.trim().length >= 8 && reason.trim().length <= 500
    && impact.trim().length >= 8 && impact.trim().length <= 500;
  const disableValid = reason.trim().length >= 8 && reason.trim().length <= 500
    && impact.trim().length >= 8 && impact.trim().length <= 500;

  const clearDraft = () => {
    setKey("");
    setLabel("");
    setUrl("https://");
    setOwner("");
    setReason("");
    setImpact("");
  };

  const startVersion = (target?: K6RemoteTarget) => {
    setKey(target?.remoteTargetKey ?? "");
    setLabel(target?.label ?? "");
    setUrl(target?.url ?? "https://");
    setOwner(target?.ownerId ?? "");
    setReason("");
    setImpact("");
    setMessage("");
  };

  const submitVersion = async () => {
    if (!canManage || !createValid || submitting) return;
    setSubmitting(true);
    setMessage("");
    try {
      await createK6RemoteTargetVersion({
        remoteTargetKey: key.trim(),
        label: label.trim(),
        url: url.trim(),
        ownerId: owner.trim(),
        expectedLatestVersion: latestVersions.get(key.trim()) ?? 0,
        reason: reason.trim(),
        impact: impact.trim(),
      });
      clearDraft();
      setMessage("不可变目标版本已创建并写入审计。");
      await load(true);
    } catch (error) {
      setMessage(error instanceof K6OutcomeUncertainError
        ? error.message
        : `创建失败，本次写入未生效，当前输入已保留。${errorText(error)}`);
    } finally {
      setSubmitting(false);
    }
  };

  const confirmDisable = async () => {
    if (!pendingDisable || !canManage || !disableValid || submitting) return;
    setSubmitting(true);
    setMessage("");
    try {
      const result = await disableK6RemoteTarget(
        pendingDisable.remoteTargetKey,
        pendingDisable.remoteTargetVersion,
        {
          expectedVersion: pendingDisable.lockVersion,
          expectedCatalogVersion: pendingDisable.catalogVersion,
          reason: reason.trim(),
          impact: impact.trim(),
        },
      );
      setPendingDisable(null);
      setReason("");
      setImpact("");
      setMessage(`目标已停用；服务端取消 ${result.cancelledCommandCount} 条未领取命令，未把取消冒充为设备执行成功。`);
      await load(true);
    } catch (error) {
      setMessage(error instanceof K6OutcomeUncertainError
        ? error.message
        : `停用失败，本次写入未生效，输入已保留。${errorText(error)}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="k6-panel" data-proof="k6-approved-targets">
      <div className="k6-sec-head">
        <div>
          <div className="k6-kicker">服务端批准目标目录</div>
          <h3>RemoteTarget 版本管理</h3>
          <p>数据直接来自 Janus；换 URL 只能新增不可变版本，历史版本不会被覆盖。</p>
        </div>
        <span className="k6-bdg cyan">目录 v{catalogVersion}</span>
      </div>
      <div className="k6-body">
        <div className="k6-explain" style={{ marginBottom: 14 }}>
          允许来源：{allowedOrigins.length ? allowedOrigins.join("、") : "未配置（失败关闭，无法新增目标）"}
        </div>
        {message && <div className="k6-explain" role="status" style={{ marginBottom: 14 }}>{message}</div>}
        {canManage ? (
          <div className="k6-ovr-brief" style={{ marginBottom: 14 }}>
            <h4>新增不可变版本</h4>
            <div className="k6-form-row">
              <div className="k6-ovr-field"><label htmlFor="rt-key">目标键<i>小写字母开头</i></label><input id="rt-key" className="k6-field" value={key} maxLength={64} onChange={(event) => setKey(event.target.value)} placeholder="如 finance-main" /></div>
              <div className="k6-ovr-field"><label htmlFor="rt-label">运营名称<i>必填</i></label><input id="rt-label" className="k6-field" value={label} maxLength={96} onChange={(event) => setLabel(event.target.value)} /></div>
              <div className="k6-ovr-field"><label htmlFor="rt-owner">负责人<i>必填</i></label><input id="rt-owner" className="k6-field" value={owner} maxLength={96} onChange={(event) => setOwner(event.target.value)} /></div>
            </div>
            <div className="k6-ovr-field"><label htmlFor="rt-url">HTTPS 地址<i>必填</i></label><input id="rt-url" className="k6-field" type="url" value={url} maxLength={1024} onChange={(event) => setUrl(event.target.value)} /></div>
            <div className="k6-form-row">
              <div className="k6-ovr-field"><label htmlFor="rt-reason">变更原因<i>8–500 字</i></label><textarea id="rt-reason" className="k6-field" value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} /></div>
              <div className="k6-ovr-field"><label htmlFor="rt-impact">影响确认<i>8–500 字</i></label><textarea id="rt-impact" className="k6-field" value={impact} maxLength={500} onChange={(event) => setImpact(event.target.value)} placeholder="说明受影响策略、命令与迁移安排" /></div>
            </div>
            <button className="k6-ovr-confirm" data-proof="k6-target-create" disabled={!createValid || submitting} onClick={() => void submitVersion()}>{submitting ? "提交中…" : "确认新增不可变版本"}</button>
          </div>
        ) : (
          <div className="k6-explain" style={{ marginBottom: 14 }}>当前账号只有 risk_k6_read；需要 risk_k6_target_manage 才能新增版本或停用目标。</div>
        )}

        {loadState === "loading" && <div className="k6-explain">正在读取真实批准目标目录…</div>}
        {loadState === "error" && <div className="k6-explain"><button className="k6-pgbtn" onClick={() => void load()}>重试读取</button></div>}
        {loadState === "ready" && (
          <div className="k6-strat-list">
            {!targets.length && <div className="k6-explain">尚未配置批准目标；系统不会生成虚构目录数据。</div>}
            {targets.map((target) => (
              <div className="k6-strat-card" key={`${target.remoteTargetKey}:${target.remoteTargetVersion}`}>
                <div className="k6-strat-top">
                  <b>{target.label}</b>
                  <span className={`k6-bdg ${target.status === "ACTIVE" ? "good" : "dim"}`}>{target.status === "ACTIVE" ? "可用" : "已停用"}</span>
                  <span className="k6-bdg dim">目标 v{target.remoteTargetVersion} · 目录 v{target.catalogVersion}</span>
                </div>
                <div className="k6-strat-meta">键 {target.remoteTargetKey} · 负责人 {target.ownerId} · {target.updatedBy} 更新</div>
                <div className="k6-strat-meta">URL {target.url}</div>
                <div className="k6-strat-meta">精确版本引用：{target.strategyCount} 条策略 · {target.pendingCommandCount} 条未领取命令</div>
                {canManage && <div className="k6-strat-actions">
                  <button className="k6-pgbtn" onClick={() => startVersion(target)}>以此新增版本 / 换 URL</button>
                  {target.status === "ACTIVE" && <button className="k6-pgbtn" style={{ color: "var(--danger)" }} onClick={() => { setPendingDisable(target); setReason(""); setImpact(""); setMessage(""); }}>停用</button>}
                </div>}
              </div>
            ))}
          </div>
        )}
      </div>

      {pendingDisable && <div className="k6-modal-overlay" onClick={() => setPendingDisable(null)}>
        <div className="k6c2 k6-modal k6-modal-sm" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="停用批准目标">
          <div className="k6-modal-head"><div className="ttl">停用 {pendingDisable.label} · v{pendingDisable.remoteTargetVersion}</div></div>
          <div className="k6-modal-body">
            <div className="k6-ovr-warn">停用只会取消引用该目标精确版本且尚未领取的命令；同键其他版本、已领取与历史命令均不受影响，也不会冒充设备已撤销。</div>
            <div className="k6-ovr-field"><label htmlFor="rt-disable-reason">停用原因<i>8–500 字</i></label><textarea id="rt-disable-reason" className="k6-field" maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} /></div>
            <div className="k6-ovr-field"><label htmlFor="rt-disable-impact">影响确认<i>8–500 字</i></label><textarea id="rt-disable-impact" className="k6-field" maxLength={500} value={impact} onChange={(event) => setImpact(event.target.value)} /></div>
          </div>
          <div className="k6-ovr-foot">
            <button className="k6-ovr-cancel" disabled={submitting} onClick={() => setPendingDisable(null)}>取消</button>
            <button className="k6-ovr-confirm" data-proof="k6-target-disable" disabled={!disableValid || submitting} onClick={() => void confirmDisable()}>{submitting ? "停用中…" : "确认停用并写入审计"}</button>
          </div>
        </div>
      </div>}
    </div>
  );
}

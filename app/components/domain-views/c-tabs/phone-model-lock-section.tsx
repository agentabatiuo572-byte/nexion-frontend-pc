"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Lock, RefreshCw, Unlock } from "lucide-react";
import { OperationConfirmModal } from "../design-kit";
import { PhoneApiError, fetchPhoneModelLocks, releasePhoneModelLock, type PhoneModelLock } from "@/lib/admin/phone-replacement-client";
import { PHONE_GRANT } from "@/lib/admin/phone-replacement-contract";
import { phoneTime } from "../phone-replacement-receipt";

const platformLabel = (platform: string | null) => platform === "ios" ? "iPhone" : platform === "android" ? "Android" : "未知";
function status(lock: PhoneModelLock): { text: string; tone: string } {
  if (lock.released) return { text: "已解除，等用户重新校准", tone: "cyan" };
  if (lock.held) return { text: "换报机型被拦截", tone: "warn" };
  return lock.releasable ? { text: "已锁定", tone: "ok" } : { text: "未锁定（下次校准锁定）", tone: "dim" };
}

/**
 * C5 support: each installation locks the model it first calibrated with. A customer who moved
 * to a new phone with the old installation (for example a restored backup) is held as "机型待核验";
 * support verifies and releases the lock, and the next calibration locks the new model.
 */
export function PhoneModelLockSection({ userId, rights }: { userId: string; rights: string[] }) {
  const canRelease = rights.includes(PHONE_GRANT);
  const [locks, setLocks] = useState<PhoneModelLock[] | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  // One key per confirmation, so a retry after an unknown outcome is the same command.
  const [target, setTarget] = useState<{ lock: PhoneModelLock; key: string } | null>(null);
  const live = useRef(true), generation = useRef(0);

  const load = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true); setError("");
    try {
      const next = await fetchPhoneModelLocks(userId);
      if (live.current && request === generation.current) setLocks(next);
    } catch (failure) {
      if (live.current && request === generation.current) { setLocks(null); setError(failure instanceof Error ? failure.message : "查询暂不可用，请稍后重试。"); }
    } finally { if (live.current && request === generation.current) setLoading(false); }
  }, [userId]);
  useEffect(() => { live.current = true; void load(); return () => { live.current = false; generation.current++; }; }, [load]);

  return <section className="l-card phone-admin-panel phone-account-panel" data-proof="c5-phone-model-lock" aria-label="手机机型锁">
    <div className="l-h">
      <div className="phone-panel-heading"><Lock size={16} aria-hidden="true" /><h3>手机机型锁</h3></div>
      <div className="r"><button className="l-btn sm" disabled={loading || !!target} onClick={() => void load()}><RefreshCw size={13} aria-hidden="true" />{loading ? "刷新中…" : "刷新"}</button></div>
    </div>
    <div className="l-b">
      <p className="phone-intro">每台手机第一次校准后锁定机型，之后换报其他机型会显示「机型待核验」。用户确实换了新手机却沿用旧安装（例如从 iCloud 备份恢复）时，核实后解除；用户重新校准即锁定新机型。</p>
      {error && <div role="alert" className="ctint warn phone-feedback">{error}</div>}
      {message && <div role="status" className="ctint cyan phone-feedback">{message}</div>}
      {loading && !locks ? <div className="phone-loading" role="status"><RefreshCw size={16} aria-hidden="true" />正在读取手机校准记录…</div>
        : !locks ? null : locks.length === 0 ? <p>这个用户还没有手机校准记录。</p>
        : <div style={{ overflowX: "auto" }}><table className="l-tbl" style={{ minWidth: 760 }}>
          <thead><tr>{["手机", "锁定机型", "最近上报机型", "状态", "更新时间", "操作"].map(label => <th key={label}>{label}</th>)}</tr></thead>
          <tbody>{locks.map(lock => {
            const state = status(lock);
            return <tr key={lock.installationId}>
              <td>{platformLabel(lock.platform)}<br /><small className="mono" style={{ overflowWrap: "anywhere" }}>{lock.installationId}</small></td>
              <td>{lock.lockedModel ?? "—"}</td>
              <td>{lock.reportedModel ?? "—"}</td>
              <td><span className={`bdg ${state.tone}`}>{state.text}</span></td>
              <td>{phoneTime(lock.updatedAt)}</td>
              <td>{lock.releasable && canRelease
                ? <button className="l-btn sm" disabled={!!target || loading} onClick={() => { setMessage(""); setTarget({ lock, key: crypto.randomUUID() }); }}><Unlock size={13} aria-hidden="true" />解除机型锁</button>
                : lock.releasable ? <small>需要换机特批权限</small> : "—"}</td>
            </tr>;
          })}</tbody>
        </table></div>}
    </div>
    {target && <OperationConfirmModal action="解除手机机型锁"
      detail={<>{platformLabel(target.lock.platform)} · 锁定机型 {target.lock.lockedModel ?? "—"}{target.lock.reportedModel && target.lock.reportedModel !== target.lock.lockedModel ? `，最近上报 ${target.lock.reportedModel}` : ""}。
        <br />解除后，用户在这台手机上重新校准即锁定新机型，并按新机型分配算力。只在核实用户确实更换了手机后操作。</>}
      reasonMin={8} reasonMax={200} onClose={() => setTarget(null)} onConfirm={async reason => {
        if (!canRelease) throw new Error("当前账号无权执行此操作");
        try {
          await releasePhoneModelLock(userId, target.lock, reason, target.key);
        } catch (failure) {
          throw failure instanceof PhoneApiError && failure.unknownOutcome
            ? new Error("提交结果暂不确定，请刷新列表核对，不要重复提交。") : failure;
        }
        if (!live.current) return;
        setTarget(null);
        setMessage("已解除机型锁。请告诉用户在 App 里重新校准。");
        await load();
      }} />}
  </section>;
}

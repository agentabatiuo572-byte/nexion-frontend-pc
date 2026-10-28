"use client";
import { useEffect, useRef, useState } from "react";
import { Btn, OperationConfirmModal } from "../design-kit";
import { displayAdminError } from "@/lib/admin/error-messages";
import { RISK_CHECKS, RISK_CODE_LABELS, RISK_MODE_LABELS, fetchPhoneRisk, riskSettingsError, savePhoneRisk,
  type PhoneRiskOverview, type PhoneRiskUpdate } from "@/lib/admin/phone-risk-client";

const grid = { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12 };
const draftOf = ({ settings }: PhoneRiskOverview): PhoneRiskUpdate => ({
  installModelLock: settings.installModelLock, osVersion: settings.osVersion, screenScale: settings.screenScale,
  screenSize: settings.screenSize, missingSignals: settings.missingSignals, accountModelChurn: settings.accountModelChurn,
  churnWindowDays: settings.churnWindowDays, churnModelCount: settings.churnModelCount, reason: "",
});
const platformLabel = (platform: string) => platform === "ios" ? "iPhone" : platform === "android" ? "Android" : platform || "未知";

/** E6 "机型风控": checks run before a phone calibration draws a value. Saved directly; the server audits each save. */
export function PhoneRiskSection({ canWrite, toast }: { canWrite: boolean; toast: (message: string) => void }) {
  const [overview, setOverview] = useState<PhoneRiskOverview | null>(null);
  const [draft, setDraft] = useState<PhoneRiskUpdate | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const live = useRef(true);

  async function load() {
    setBusy(true); setError("");
    try {
      const next = await fetchPhoneRisk();
      if (live.current) { setOverview(next); setDraft(draftOf(next)); }
    } catch (failure) {
      if (live.current) setError(displayAdminError(failure));
    } finally { if (live.current) setBusy(false); }
  }
  useEffect(() => { live.current = true; void load(); return () => { live.current = false; }; }, []);

  const saved = overview ? draftOf(overview) : null;
  const changed = !!draft && !!saved && RISK_CHECKS.some(check => draft[check.key] !== saved[check.key])
    || !!draft && !!saved && (draft.churnWindowDays !== saved.churnWindowDays || draft.churnModelCount !== saved.churnModelCount);
  const validation = draft ? riskSettingsError({ ...draft, reason: "占位理由，仅用于校验" }) : null;
  const editable = canWrite && !busy && !!overview;
  const statsOf = (code: string) => overview?.stats.checks.find(row => row.code === code);
  const summary = draft && saved ? [
    ...RISK_CHECKS.filter(check => draft[check.key] !== saved[check.key])
      .map(check => `${check.label}：${RISK_MODE_LABELS[saved[check.key]]} → ${RISK_MODE_LABELS[draft[check.key]]}`),
    ...(draft.churnWindowDays !== saved.churnWindowDays ? [`统计窗口：${saved.churnWindowDays} → ${draft.churnWindowDays} 天`] : []),
    ...(draft.churnModelCount !== saved.churnModelCount ? [`机型数上限：${saved.churnModelCount} → ${draft.churnModelCount} 个`] : []),
  ] : [];

  return <fieldset className="phone-risk" aria-label="机型风控">
    <legend>机型风控（保存即生效，不走审批）</legend>
    <p className="f-foot">检查在分配算力之前执行。观察：照常校准，只记录命中；拦截：这次校准进入待核验，不分配算力、不能激活。用户只看到「机型待核验」，不会知道命中了哪一项。已激活的手机不受影响。</p>
    {error && <p role="alert">{error}</p>}
    {!overview || !draft ? <p role="status">{busy ? "正在加载…" : "设置加载失败，请刷新重试。"}</p> : <>
      <p role="status">版本 {overview.settings.revision}{overview.settings.updatedAt
        ? ` · ${new Date(overview.settings.updatedAt).toLocaleString("zh-CN", { hour12: false })} 修改：${overview.settings.reason ?? "—"}`
        : " · 默认设置：同一手机换报机型直接拦截，其余只观察"}</p>
      {!canWrite && <p>你只能查看，修改需要设备配置权限。</p>}
      <div className="ui-table-scroll"><table>
        <thead><tr>{["检查项", "说明", "处理方式", `最近 ${overview.stats.days} 天`].map(label => <th key={label}>{label}</th>)}</tr></thead>
        <tbody>{RISK_CHECKS.map(check => {
          const stats = statsOf(check.code);
          return <tr key={check.key}>
            <td><strong>{check.label}</strong></td>
            <td><small>{check.detail}</small></td>
            <td><select aria-label={`${check.label}的处理方式`} value={draft[check.key]} disabled={!editable}
              onChange={event => setDraft({ ...draft, [check.key]: event.target.value })}>
              {check.modes.map(mode => <option key={mode} value={mode}>{RISK_MODE_LABELS[mode]}</option>)}</select></td>
            <td>{stats ? <>命中 {stats.flagged} 次 · 拦截 {stats.held} 次<br /><small>{stats.accounts} 个账号</small></> : "无命中"}</td>
          </tr>;
        })}</tbody>
      </table></div>
      <div style={grid}>
        <label>同一账号多机型 · 统计窗口（天）<input type="number" min="1" max="365" step="1" value={draft.churnWindowDays} disabled={!editable}
          onChange={event => setDraft({ ...draft, churnWindowDays: Number(event.target.value) })} /></label>
        <label>同一账号多机型 · 达到几个机型算命中<input type="number" min="2" max="20" step="1" value={draft.churnModelCount} disabled={!editable}
          onChange={event => setDraft({ ...draft, churnModelCount: Number(event.target.value) })} /></label>
      </div>
      {validation && <p role="alert">{validation}</p>}
      <div className="ios-actions">
        <Btn variant="primary" disabled={!editable || !changed || !!validation} onClick={() => setConfirming(true)}>保存并生效</Btn>
        <Btn disabled={busy || !changed} onClick={() => setDraft(draftOf(overview))}>撤销修改</Btn>
        <Btn disabled={busy} onClick={() => void load()}>刷新</Btn>
      </div>
      {overview.stats.models.length > 0 && <details><summary>命中较多的机型（最近 {overview.stats.days} 天，最多 50 组）</summary>
        <div className="ui-table-scroll"><table>
          <thead><tr>{["检查项", "平台", "上报机型", "命中", "拦截"].map(label => <th key={label}>{label}</th>)}</tr></thead>
          <tbody>{overview.stats.models.map(row => <tr key={`${row.code}:${row.platform}:${row.model}`}>
            <td>{RISK_CODE_LABELS[row.code] ?? row.code}</td><td>{platformLabel(row.platform)}</td>
            <td style={{ overflowWrap: "anywhere" }}>{row.model || "未上报"}</td><td>{row.flagged}</td><td>{row.held}</td>
          </tr>)}</tbody>
        </table></div>
        <p className="f-foot">被拦下的正常用户（例如从备份恢复到新手机）由客服在「用户 · 手机绑定与换机特批」中解除机型锁。</p>
      </details>}
    </>}
    {confirming && draft && overview && <OperationConfirmModal action="保存机型风控设置"
      detail={<>{summary.map(line => <span key={line}>{line}<br /></span>)}保存后立即用于之后的校准，不走审批；已激活的手机和历史结算不受影响。</>}
      reasonMin={8} reasonMax={200} onClose={() => setConfirming(false)} onConfirm={async reason => {
        if (!canWrite) throw new Error("你没有修改设备配置的权限");
        const next = await savePhoneRisk(overview.settings.revision, { ...draft, reason }, crypto.randomUUID());
        if (!live.current) return;
        setOverview(next); setDraft(draftOf(next)); setConfirming(false);
        toast("机型风控设置已生效");
      }} />}
  </fieldset>;
}

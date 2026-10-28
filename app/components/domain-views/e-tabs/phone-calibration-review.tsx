import type { PhoneProposalView } from "@/lib/admin/phone-calibration-client";
import { IOS_CHANGE_LABELS, diffIosRules, formatRange } from "@/lib/admin/ios-model-rules";

export function PhoneCalibrationReview({ proposal }: { proposal: PhoneProposalView }) {
  const inherited = proposal.iosRulesInherited;
  // The server reads the baseline when the ticket is viewed; once another version is published
  // (this proposal's own publish included) a diff against it would describe the wrong change.
  const stale = !!proposal.baseline && proposal.baseline.revision !== proposal.expectedRevision;
  const baseline = stale ? null : proposal.baseline;
  const iosChanges = baseline && !inherited ? diffIosRules(baseline.iosModelRules, proposal.iosModelRules) : [];
  return <section className="phone-calibration-review" aria-label="待发布的手机算力规则">
    <header><h4>待发布的手机算力规则</h4><p>只影响后续校准。已分配的算力、已激活设备和历史结算保持不变。</p></header>
    <div className="ui-review-facts">
      <div><small>基准版本与生效时间</small>版本 {proposal.expectedRevision}<br />{proposal.effectiveAt === 0 ? "审批通过后立即生效" : new Date(proposal.effectiveAt).toLocaleString("zh-CN")}</div>
      <div><small>T1–T5 平台算力分界</small>{proposal.thresholds.join(" / ")}<p>分界值归入较高档位。</p></div>
      <div><small>Android 硬件规则</small>{proposal.rules.length} 条<p>{proposal.rules.length === 0 ? "这次申请会清空 Android 规则，Android 新校准均进入待核验。" : "审批前请核对以下规则。"}</p></div>
      <div><small>iPhone 机型规则</small>{inherited ? "沿用已发布规则" : `${proposal.iosModelRules.length} 个 · 启用 ${proposal.iosModelRules.filter(rule => rule.enabled).length}`}
        <p>{inherited ? "这次申请没有改 iPhone 机型规则，发布时保留当时已发布的版本。"
          : proposal.iosModelRules.length === 0 ? "这次申请没有 iPhone 机型规则，iOS 新校准均进入待核验。" : "范围是运营预设，不是 Apple 性能指标。"}</p></div>
    </div>
    {!inherited && <h5>iPhone 机型变化{baseline ? `（对比当前已发布 v${baseline.revision}）` : ""}</h5>}
    {inherited ? null : !baseline ? <p role="status">{stale
        ? `申请基于版本 ${proposal.expectedRevision}，当前已发布版本 ${proposal.baseline!.revision}，无法对比差异；以下是申请里的全部 iPhone 机型。`
        : "当前已发布的规则加载失败，无法对比差异；以下是申请里的全部 iPhone 机型。"}</p>
      : iosChanges.length === 0 ? <p>iPhone 机型规则没有变化。</p>
      : <div className="ui-table-scroll"><table>
        <thead><tr>{["变化", "机型", "范围（前 → 后）", "明细"].map(label => <th key={label}>{label}</th>)}</tr></thead>
        <tbody>{iosChanges.map(change => {
          const before = change.before ? formatRange(change.before) : "—";
          const after = change.after ? formatRange(change.after) : "—";
          return <tr key={change.kind + change.id}>
            <td>{IOS_CHANGE_LABELS[change.kind]}</td>
            <td>{(change.after ?? change.before)!.model}<br /><small className="mono">{change.id}</small></td>
            <td>{before === after ? `${after}（不变）` : `${before} → ${after}`}</td>
            <td style={{ overflowWrap: "anywhere" }}>{change.details.join("；") || "—"}</td>
          </tr>;
        })}</tbody>
      </table></div>}
    {!inherited && !baseline && proposal.iosModelRules.length > 0 && <div className="ui-table-scroll"><table>
      <thead><tr>{["编号", "机型", "别名", "范围", "状态"].map(label => <th key={label}>{label}</th>)}</tr></thead>
      <tbody>{proposal.iosModelRules.map(rule => <tr key={rule.id}>
        <td><small className="mono">{rule.id}</small></td><td>{rule.model}</td><td>{rule.aliases.join("、") || "—"}</td>
        <td>{formatRange(rule)}</td><td>{rule.enabled ? "启用" : "停用"}</td>
      </tr>)}</tbody>
    </table></div>}
    {proposal.rules.length > 0 && <><h5>Android 硬件规则</h5><div className="ui-table-scroll"><table>
      <thead><tr>{["编号", "平台 / 型号", "SoC / GPU", "内存 GB", "平台算力", "核验依据"].map(label => <th key={label}>{label}</th>)}</tr></thead>
      <tbody>{proposal.rules.map(rule => <tr key={rule.id}>
        <td>{rule.id}</td><td>{rule.platform}<br />{rule.model || "同芯片通用"}</td>
        <td>{rule.soc}<br />{rule.gpu}</td><td>[{rule.minMemoryGb}, {rule.maxMemoryGb})</td>
        <td>{rule.computeValue}</td><td style={{ overflowWrap: "anywhere" }}>{rule.evidence}</td>
      </tr>)}</tbody>
    </table></div></>}
  </section>;
}

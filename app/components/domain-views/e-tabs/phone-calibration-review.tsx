import type { PhonePolicyProposal } from "@/lib/admin/phone-calibration-client";

export function PhoneCalibrationReview({ proposal }: { proposal: PhonePolicyProposal }) {
  return <section className="phone-calibration-review" aria-label="待发布的手机算力规则">
    <header><h4>待发布的手机算力规则</h4><p>只影响后续校准，历史结算不变。</p></header>
    <div className="ui-review-facts">
      <div><small>基准版本与生效时间</small>版本 {proposal.expectedRevision}<br />{proposal.effectiveAt === 0 ? "审批通过后立即生效" : new Date(proposal.effectiveAt).toLocaleString("zh-CN")}</div>
      <div><small>T1–T5 平台算力分界</small>{proposal.thresholds.join(" / ")}<p>分界值归入较高档位。</p></div>
      <div><small>规则数量</small>{proposal.rules.length} 条<p>{proposal.rules.length === 0 ? "本提案将清空规则，所有新校准均进入待核验。" : "审批前请核对以下规则。"}</p></div>
    </div>
    {proposal.rules.length > 0 && <div className="ui-table-scroll"><table>
      <thead><tr>{["编号", "平台 / 型号", "SoC / GPU", "内存 GB", "平台算力", "核验依据"].map(label => <th key={label}>{label}</th>)}</tr></thead>
      <tbody>{proposal.rules.map(rule => <tr key={rule.id}>
        <td>{rule.id}</td><td>{rule.platform}<br />{rule.model || "同芯片通用"}</td>
        <td>{rule.soc}<br />{rule.gpu}</td><td>[{rule.minMemoryGb}, {rule.maxMemoryGb})</td>
        <td>{rule.computeValue}</td><td style={{ overflowWrap: "anywhere" }}>{rule.evidence}</td>
      </tr>)}</tbody>
    </table></div>}
  </section>;
}

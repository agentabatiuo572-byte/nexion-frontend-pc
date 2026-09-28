import type { PhonePolicyProposal } from "@/lib/admin/phone-calibration-client";

export function PhoneCalibrationReview({ proposal }: { proposal: PhonePolicyProposal }) {
  return <section aria-label="待发布的手机算力规则" style={{ marginBlock: 16, overflowX: "auto" }}>
    <h4>待发布的手机算力规则</h4>
    <p>基于版本 {proposal.expectedRevision} · 生效时间：{proposal.effectiveAt === 0 ? "审批通过后立即生效" : new Date(proposal.effectiveAt).toLocaleString("zh-CN")}</p>
    <p>T1–T5 分界：{proposal.thresholds.join(" / ")} 平台算力；分界值归入较高档位。</p>
    <p>只影响后续校准，历史结算不变。{proposal.rules.length === 0 ? "本提案将清空规则，所有新校准均进入待核验。" : `共 ${proposal.rules.length} 条规则。`}</p>
    {proposal.rules.length > 0 && <table style={{ minWidth: 650, width: "100%", textAlign: "left" }}>
      <thead><tr>{["编号", "平台 / 型号", "SoC / GPU", "内存 GB", "平台算力", "核验依据"].map(label => <th key={label}>{label}</th>)}</tr></thead>
      <tbody>{proposal.rules.map(rule => <tr key={rule.id}>
        <td>{rule.id}</td><td>{rule.platform}<br />{rule.model || "同芯片通用"}</td>
        <td>{rule.soc}<br />{rule.gpu}</td><td>[{rule.minMemoryGb}, {rule.maxMemoryGb})</td>
        <td>{rule.computeValue}</td><td style={{ overflowWrap: "anywhere" }}>{rule.evidence}</td>
      </tr>)}</tbody>
    </table>}
  </section>;
}

"use client";
import { businessZone, businessZoneText } from "@/lib/admin/business-time";
import { phoneLabel, record, type PhoneReceipt } from "@/lib/admin/phone-replacement-contract";
import "./phone-replacement.css";
export const phoneTime = (value: unknown) => typeof value === "number" && Number.isFinite(value)
    ? new Date(value).toLocaleString("zh-CN", { hour12: false, timeZone: businessZone().zoneId }) : "待核实";
const fields: Record<string, string> = {
    operationId: "操作号", auditRef: "审计引用", requestId: "申请号", requestNo: "申请编号", grantId: "授权号",
    targetInstallationId: "目标安装", installationId: "绑定安装", oldInstallationId: "原安装", newInstallationId: "新安装",
    bindingVersion: "绑定版本", oldBindingVersion: "原绑定版本", newBindingVersion: "新绑定版本", policyVersion: "策略版本",
    issuedAt: "签发时间", expiresAt: "到期时间", createdAt: "创建时间", closedAt: "关闭时间", consumedAt: "使用时间",
    submittedAt: "提交时间", completedAt: "完成时间", committedAt: "换机成功时间", changedAt: "绑定变更时间",
    reason: "理由", closeReason: "关闭说明", evidenceRef: "核实记录", operatorId: "处置人编号", verifiedAt: "核实时间",
    verifiedBy: "核实人编号", issueOperationId: "签发操作", consumedOperationId: "使用操作", supportRef: "客服会话引用",
    remainingUses: "剩余使用次数", waiveCount: "豁免次数限制", waiveInterval: "豁免间隔限制", status: "状态",
    commandType: "操作", a2OperationId: "审批单号", previousPolicyVersion: "原策略版本", allowReplacement: "允许换机",
    minReplacementIntervalDays: "最短间隔（天）", replacementWindowDays: "滚动窗口（天）", maxReplacementsInWindow: "窗口内上限（次）",
    terminalAt: "终结时间", occurredAt: "发生时间", actorId: "操作者编号", userId: "账号编号",
    conflictType: "未完成原因",
};
export function PhoneFacts({ value }: {
    value: unknown;
}) {
    if (!record(value))
        return <p>暂无可核对的状态。</p>;
    const nested = record(value.policy) ? value.policy : record(value.binding) ? value.binding : null;
    return <><dl className="phone-facts">{Object.entries(fields).filter(([key]) => value[key] != null).map(([key, label]) => {
            const raw = value[key];
            const text = /At$/.test(key) ? phoneTime(raw) : ["status", "commandType", "conflictType"].includes(key) ? phoneLabel(raw)
                : typeof raw === "boolean" ? raw ? "是" : "否" : typeof raw === "string" || typeof raw === "number" ? String(raw) : "待核实";
            return <div key={key}><dt>{label}</dt><dd>{text}</dd></div>;
        })}</dl>{nested && <PhoneFacts value={nested}/>}</>;
}
export function PhoneReceiptView({ receipt }: {
    receipt: PhoneReceipt;
}) {
    return <section className="phone-receipt" aria-label="原操作回执">
    <h4>{phoneLabel(receipt.commandType)} · {phoneLabel(receipt.status)}</h4>
    <p>操作号：{receipt.operationId} · 提交：{phoneTime(receipt.submittedAt)} · 审计引用：{receipt.auditRef ?? "待生成"}</p>
    <div className="phone-grid"><div><h4>原操作结果</h4><PhoneFacts value={receipt.originalResult}/></div>
      <div><h4>当前状态</h4><PhoneFacts value={receipt.currentResource}/></div></div>
    <p className="phone-note">时间均为{businessZoneText()}。原成功事实不会随当前状态变化而改写。查询不会重新发布、续期或再次授权。</p>
  </section>;
}

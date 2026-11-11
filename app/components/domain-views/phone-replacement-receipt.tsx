"use client";
import { Fact, Facts, Fold, Notice, StatusTag, useRdSurface } from "@/app/components/rd";
import { businessZone, businessZoneText, formatBusinessTimeCompact } from "@/lib/admin/business-time";
import { phoneLabel, record, type PhoneReceipt } from "@/lib/admin/phone-replacement-contract";
import "./phone-replacement.css";
/** A phone installation keeps its distinguishing suffix when the column narrows. */
export function PhoneIdentifier({ value }: { value: string }) {
    return <span className="c5-phone-id" title={value} tabIndex={0}><span>{value.length > 12 ? value.slice(0, -8) : value}</span>{value.length > 12 && <span>{value.slice(-8)}</span>}</span>;
}
export const phoneTime = (value: unknown) => typeof value === "number" && Number.isFinite(value)
    ? new Date(value).toLocaleString("zh-CN", { hour12: false, timeZone: businessZone().zoneId }) : "待核实";
/** C5 shows times the way the rest of that page does (2026-11-12 08:00); E6 keeps phoneTime. */
export const phoneTimeCompact = (value: unknown) => typeof value === "number" && Number.isFinite(value)
    ? formatBusinessTimeCompact(new Date(value).toISOString(), "待核实") : "待核实";
const fields: Record<string, string> = {
    eventId: "换机事件号", sourceKind: "记录来源", sourceId: "来源记录号", sourceEnvironment: "数据环境", runId: "沙盒运行号", resourceId: "关联对象号",
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
export function PhoneFacts({ value, time = phoneTime }: {
    value: unknown;
    time?: (value: unknown) => string;
}) {
    const surface = useRdSurface();
    if (!record(value))
        return <p>暂无可核对的状态。</p>;
    const nested = record(value.policy) ? value.policy : record(value.binding) ? value.binding : null;
    if (surface) return <><Facts>{Object.entries(fields).filter(([key]) => value[key] != null).map(([key, label]) => {
        const raw = value[key];
        const shown = /At$/.test(key) ? time(raw) : ["status", "commandType", "conflictType"].includes(key) ? phoneLabel(raw)
            : typeof raw === "boolean" ? raw ? "是" : "否" : typeof raw === "string" || typeof raw === "number" ? String(raw) : "待核实";
        return <Fact key={key} k={label}>{shown}</Fact>;
    })}</Facts>{nested && <PhoneFacts value={nested} time={time} />}</>;
    return <><dl className="phone-facts">{Object.entries(fields).filter(([key]) => value[key] != null).map(([key, label]) => {
            const raw = value[key];
            const text = /At$/.test(key) ? phoneTime(raw) : ["status", "commandType", "conflictType"].includes(key) ? phoneLabel(raw)
                : typeof raw === "boolean" ? raw ? "是" : "否" : typeof raw === "string" || typeof raw === "number" ? String(raw) : "待核实";
            return <div key={key}><dt>{label}</dt><dd>{text}</dd></div>;
        })}</dl>{nested && <PhoneFacts value={nested}/>}</>;
}
export function PhoneReceiptView({ receipt, time = phoneTime }: {
    receipt: PhoneReceipt;
    time?: (value: unknown) => string;
}) {
    const surface = useRdSurface();
    if (surface) return <div className="c5-phone-receipt"><Facts><Fact k="操作">{phoneLabel(receipt.commandType)}</Fact><Fact k="结果"><StatusTag tone={receipt.status === "PENDING" ? "warn" : receipt.status === "FAILED" ? "warn" : "done"}>{phoneLabel(receipt.status)}</StatusTag></Fact><Fact k="操作号">{receipt.operationId}</Fact><Fact k="提交时间">{time(receipt.submittedAt)}</Fact><Fact k="审计引用">{receipt.auditRef ?? "待生成"}</Fact></Facts><Fold title="原操作结果" summary="原响应事实" open><PhoneFacts value={receipt.originalResult} time={time} /></Fold><Fold title="当前状态" summary="读取时的资源状态" open><PhoneFacts value={receipt.currentResource} time={time} /></Fold><Notice tone="neutral">原成功事实与当前状态分别核对。查询只读，不会再次授权。</Notice></div>;
    return <section className="phone-receipt" aria-label="原操作回执">
    <h4>{phoneLabel(receipt.commandType)} · {phoneLabel(receipt.status)}</h4>
    <p>操作号：{receipt.operationId} · 提交：{phoneTime(receipt.submittedAt)} · 审计引用：{receipt.auditRef ?? "待生成"}</p>
    <div className="phone-grid"><div><h4>原操作结果</h4><PhoneFacts value={receipt.originalResult}/></div>
      <div><h4>当前状态</h4><PhoneFacts value={receipt.currentResource}/></div></div>
    <p className="phone-note">时间均为{businessZoneText()}。原成功事实不会随当前状态变化而改写。查询不会重新发布、续期或再次授权。</p>
  </section>;
}

/**
 * F4「区域大使确认」分档的展示口径。
 *
 * 分档 `id` 是服务端封闭枚举(venue / kol / print / dev),但 `title` 与 `rule` 是运营
 * 手输的英文原文,PC 此前直接渲染,于是中文界面里出现 Event venue / Host an in-person
 * event 这样的英文整段(缺陷 35)。App 的 /pages/team/agent 早已按同一份字典中文化,
 * 两端因此长期不一致。
 *
 * 这里把字典放到 PC 侧,并按 id 解析可见文案:服务端原文保留为**未知 id 的兜底**,
 * 这样未来新增分档在翻译上线前仍能显示,而不是变成空白。
 */

const BUCKET_COPY: Record<string, { title: string; rule: string }> = {
  venue: { title: "线下大会场地", rule: "扫码签到 ≥ 100 人" },
  kol: { title: "达人推广预算", rule: "结束后提交发票 + 流量数据" },
  print: { title: "印制物料", rule: "横幅 / 手册 / 名片" },
  dev: { title: "开发工具 / 技术支持", rule: "为顶级客户定制集成" },
};

/** 分档可见名:命中字典用中文,否则退回服务端原文(绝不显示空白)。 */
export function formatF4AmbassadorBucketTitle(id: string, serverTitle: string): string {
  return BUCKET_COPY[id]?.title ?? serverTitle;
}

/** 分档可见规则:同上。 */
export function formatF4AmbassadorBucketRule(id: string, serverRule: string): string {
  return BUCKET_COPY[id]?.rule ?? serverRule;
}

export const F4_MATERIAL_PERMISSIONS = [
  { code: "network_f4_ambassador_material_review", label: "大使业务材料核验" },
  { code: "network_f4_ambassador_finance_review", label: "大使费用材料核验" },
] as const;

export function ambassadorBucketLabel(bucket: string | null | undefined) {
  return ({ venue: "线下活动", kol: "KOL推广", print: "物料", dev: "开发支持" } as Record<string, string>)[bucket ?? ""] ?? "待申请人补齐类别";
}

export function ambassadorMaterialStateLabel(state: string | undefined) {
  return ({ NOT_SUBMITTED: "未提交材料", PENDING: "待核验", NEEDS_MORE: "需补材料", PASSED: "核验通过" } as Record<string, string>)[state ?? ""] ?? "材料状态待核实";
}

const MATERIAL_BLOCKERS: Record<string, string> = {
  MATERIALS_NOT_SUBMITTED: "申请人尚未提交材料",
  MATERIALS_NEEDS_MORE: "请申请人按核验意见补交材料",
  BUSINESS_REVIEW_REQUIRED: "业务材料尚未核验通过",
  FINANCE_REVIEW_REQUIRED: "费用材料尚未核验通过",
  RECOGNIZED_AMOUNT_INSUFFICIENT: "认可金额低于申请金额，请申请人下调原申请金额后重新提交材料",
  EVENT_NOT_COMPLETED: "活动或服务尚未完成，暂不能批准",
  SELF_REVIEW_APPROVAL_FORBIDDEN: "核验人与最终批准人必须不同，请由另一位有权限的管理员批准",
  MATERIAL_REVISION_STALE: "材料版本已变化，旧提案不能执行，请刷新后重新发起",
  APPLICATION_BUCKET_REQUIRED: "请申请人明确补齐申请类别",
  APPLICATION_NOT_PENDING: "申请已处理，不能再次批准或修改材料",
  PERMISSION_DENIED: "当前账号没有最终批准权限",
  A2_PROPOSAL_PERMISSION_REQUIRED: "当前账号没有发起审批的权限，请由具备提案权限的管理员发起",
  MATERIALS_INCOMPLETE: "必要材料尚未齐全",
  AMBASSADOR_REQUIRED_MATERIAL_MISSING: "必要材料尚未齐全",
  AMBASSADOR_VERIFIED_ATTENDEES_INVALID: "线下活动的有效去重人数须至少100人",
  VERIFIED_ATTENDEES_INSUFFICIENT: "线下活动的有效去重人数须至少100人",
};

export function ambassadorApprovalBlocker(code: string) {
  return MATERIAL_BLOCKERS[code] ?? "本申请尚未满足批准条件，请核对材料与核验意见";
}

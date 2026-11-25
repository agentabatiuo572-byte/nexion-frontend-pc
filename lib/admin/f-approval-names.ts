export const A2_APPROVE_PERMISSION = "A2 执行/放行(高敏工单)";

export const F_APPROVAL_PERMISSION_NAMES: Readonly<Record<string, string>> = {
  network_f2_royalty_rate: "L1-L7 团队购买奖励比例放宽",
  network_f2_policy_amplify: "Partner 档位与费率杠杆参数",
  network_f2_write: "F2 团队奖励设置 - 常规写",
  network_f3_match_rate: "平衡匹配比例调整",
  network_f3_engine_pause: "暂停团队平衡奖励发放",
  network_f3_write: "F3 团队平衡奖励 - 常规写",
  network_f4_pool_fund: "奖池资金类调整",
  network_f4_write: "F4 池配额大使榜 - 常规写",
  network_f4_leaderboard_control: "排行榜控制(暂停/取消资格)",
  network_f4_ambassador_approve: "区域大使审批",
};

export function fApprovalPermissionText(...names: string[]) {
  const text = [A2_APPROVE_PERMISSION, ...names].map(name => `「${name}」权限`).join("和");
  // 末尾几个字用不可见的连接符粘住，折行时最后一行不会只剩「权限」两个字（TL-01）。
  return text.slice(0, -6) + text.slice(-6).split("").join("\u2060");
}

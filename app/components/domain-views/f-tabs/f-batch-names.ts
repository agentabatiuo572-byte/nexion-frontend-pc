import { fConfigBatchPermissionIssue } from "@/lib/admin/f-config-batch";

/** 整批申请里每一项在页面上的名字（F2 按层暂停、F3 周期和残额）；内部配置名不给运营看。 */
const BATCH_ITEM_NAMES: Record<string, string> = {
  "F.binary.settlePeriod": "结算周期",
  "F.binary.residualPolicy": "没匹配上的订单额",
};

const itemName = (key: string) => BATCH_ITEM_NAMES[key] ?? key.match(/^F\.unilevel\.(L[1-7])\.paused$/)?.[1]?.concat(" 按层暂停");

/**
 * 整批权限的说法：判断照用 fConfigBatchPermissionIssue（逐项、按顺序取第一个缺的），
 * 只把它句首的内部配置名换成这一项在页面上的名字。
 */
export function fBatchIssueText(keys: readonly string[], authorities: readonly string[]): string | undefined {
  const issue = fConfigBatchPermissionIssue(keys, authorities);
  if (!issue) return undefined;
  const key = keys.find((item) => fConfigBatchPermissionIssue([item], authorities));
  const name = key ? itemName(key.trim()) : undefined;
  const reason = key ? issue.slice(`${key} · `.length) : issue;
  return name ? `「${name}」：${reason}` : reason;
}

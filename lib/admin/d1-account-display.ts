/**
 * D1 收款账户池「熔断原因」的运营展示口径。
 *
 * 后端 `nx_vietqr_bank_account.fuse_reason` 存的是内部迁移/风控枚举,PC 侧原样拼进
 * 账户行副标题,运营直接看到 `MIGRATED_CIPHERTEXT_REQUIRES_REPROVISION` 这类实现细节。
 * 这是展示层问题,不改后端契约:在 PC 侧映射成可执行的中文状态与处理建议,
 * 原始枚举降级为次级技术信息(见 `technical`)。
 */

const FUSE_REASON_LABELS: Record<string, { label: string; action: string }> = {
  DAILY_CAP_EXCEEDED_AFTER_RECEIPT: {
    label: "单日收款超上限，已熔断",
    action: "核对当日到账后可恢复；恢复前不再分配新付款单。",
  },
  MIGRATED_CIPHERTEXT_REQUIRES_REPROVISION: {
    label: "历史账户待重新配置收款信息",
    action: "旧账号密文无法解密，需重新录入银行账号后才能恢复使用；恢复前不分配新付款单。",
  },
};

/**
 * 熔断原因 → `{ label, technical }`。
 * 未知枚举不臆造含义:给出通用可执行说明,并把原始值降级到 `technical`。
 */
export function formatD1FuseReason(value: unknown): { label: string; technical: string } {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return { label: "", technical: "" };
  const mapped = FUSE_REASON_LABELS[raw.toUpperCase()];
  if (mapped) return { label: `${mapped.label} · ${mapped.action}`, technical: raw };
  return { label: "账户已熔断，需财务核对后恢复 · 恢复前不再分配新付款单。", technical: raw };
}

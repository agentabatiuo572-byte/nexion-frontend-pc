# CGM-K · 风控反作弊(字段级控制矩阵)

> 自动生成于 Batch 0 全运营面 inventory。完整 serverCanonical/source/querySurface 见 `cgm.manifest.json`。coverage 默认 gap,per-batch 回源后升级 built/spec_only。

本域 5 行。

| id | scope | type | frontendField | opsPurpose | crudActions | 操作确认 | endpoint | cov |
|---|---|---|---|---|---|---|---|---|
| CGM-K-001 | per-user | data-CRUD | profileKycVerifiedChip / profileKycPendingChip … | content_compliance,fund_safety,risk | 合规运营推进/拒绝 KYC 审核、切换状态 Pending→Verified、触发重新验证;状态变更驱动出金/质押放行 | Y | 读 GET /api/me/kyc-status;写 POST /api/admin/users/… | gap |
| CGM-K-002 | per-user | function-action | useRiskDisclosure.accepted (acknowledgment gate) | fund_safety,content_compliance,platform… | 合规运营核查确认记录;争议时回看 timestamped acknowledgment;监管要求时强制用户重新确认(reset accep… | Y | 读+写 TBD·建议 GET /api/me/risk-acknowledgment + POST… | gap |
| CGM-K-003 | per-user | function-action | useSecurity.changePassword / passwordChangedAt | fund_safety,platform_integrity,risk | 风控触发强制改密(挂失/疑似盗号);核查改密后是否已失效其他会话 | Y | 写 POST /api/me/password { oldPassword, newPasswor… | gap |
| CGM-K-004 | per-user | function-action | useSecurity.sessions / revokeSession / revokeAl… | fund_safety,risk,platform_integrity | 风控强制吊销可疑会话(revokeSession)或一键踢出其他所有会话(revokeAllOthers);异常 IP 触发会话冻结 | Y | 读 GET /api/me/sessions;写 DELETE /api/me/sessions/… | gap |
| CGM-K-005 | per-user | function-action | useSecurity.setTwoFactor / twoFactorEnabled | fund_safety,platform_integrity,risk | 风控强制要求高风险/大额账户开启 2FA;争议时核查 2FA 状态;可强制重置 2FA(挂失/换设备) | Y | 读 GET /api/me/security;写 POST /api/me/2fa/{enable… | gap |

# CGM-J · 紧急合规(字段级控制矩阵)

> 自动生成于 Batch 0 全运营面 inventory。完整 serverCanonical/source/querySurface 见 `cgm.manifest.json`。coverage 默认 gap,per-batch 回源后升级 built/spec_only。

本域 3 行。

| id | scope | type | frontendField | opsPurpose | crudActions | MC | endpoint | cov |
|---|---|---|---|---|---|---|---|---|
| CGM-J-001 | platform | function-action | useLuckySpin.realPrizeSoldOut / coverageDegrade… | fund_safety,payout_pacing,platform_inte… | 运营手动开/关真实奖(kill-switch)、触发覆盖率红线降级 | Y | 写 POST /api/admin/lucky-spin/{pause-real/degrade}… | gap |
| CGM-J-002 | platform | function-action | useUI.confirm / toast (global confirm-dialog + … | fund_safety,content_compliance,platform… | 合规运营核查/编辑确认弹窗披露文案与按钮措辞(确保扣款/锁仓类有明确 danger 披露);统一 cancel 弱化权重 | Y | 读+写(披露文案) TBD·建议 GET/PUT /api/admin/cms/confirm-d… | gap |
| CGM-J-003 | platform | function-action | useUI.showNetError / hideNetError / netError (b… | platform_integrity,risk,fund_safety | 紧急运营下发全站拥堵/维护遮罩文案与重试倒计时(retryAfterMs);故障期暂停操作并给出 manual-retry;恢复后下线遮罩 | Y | 读+写 TBD·建议 GET /api/platform/status (SSE) + POST … | gap |

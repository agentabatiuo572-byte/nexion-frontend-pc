# KYC 清理跨端验收

- 验收日期：2026-08-09（Asia/Tokyo）
- 锁定候选：UniApp `f689bde6...`；backend `728731a0...`；PC `d42da750...`
- 裁决：**源码清理与后端契约局部通过，跨端用户闭环不通过，不可发布。**

## 通过项

| 范围 | 结果 |
|---|---|
| UniApp KYC removal | 3/3 PASS |
| PC KYC removal | 5/5 PASS |
| Backend KYC removal | 4/4 PASS |
| PC K4 当前五维模型 | 12/12 PASS |
| Backend K4/J3 防篡改定向 | 20/20 PASS |
| Backend 全量 | 2,979 tests，0 failure，0 error，5 skipped |

K4 仍为 `multiAccount / arbitrage / withdrawVelocity / accountAge / anomalyBehavior` 五维；J3 的服务端权威篡改事件及 K4/B5 投影链仍在，未因 KYC 删除而被误删。

## 阻断项

1. **P1：历史 KYC 深链死页。** 当前 5173 打开 `#/pages/me/kyc` 后 10 秒正文仍为空、hash 不变且无可见出口；`#/pages/me/security` 对照正常。现有 removal 契约只证明“无残留”，没有钉住“旧入口必须安全迁移”的正向合同。
2. **PC 真实 UI HOLD。** 真实账号密码登录已到 MFA，但未绕过 OTP；KYC 菜单缺失、K4/J3/B3 页面真实点击未补验。
3. **PC 运行态漂移。** 验收基线中的 3002 是 19:51 启动的旧 `next start`；源码已无 KYC，但旧 `.next` 仍含退役 KYC 文案。技术验收在 00:46–00:47 重建 `.next` 后没有重启 3002，因此 build 后 3002 也不能代表当前候选已部署。
4. **PC J3 机械门红。** 定向合同 17/18；实现使用正确的括号化 fail-closed 表达式，失败来自静态 regex 仍匹配旧文本。属于门禁/实现漂移，不是已证明 J3 功能丢失，但红门不得签发。
5. **PC 全量 verify 红。** 在 10/58 被既有 `no-double-sign` 文案哨兵三处命中挡住；虽然范围外，仓库级发布门仍为红。

## 原始证据

- `D:\workspace\bug-pic\acceptance\HANDOFF-selected-20260809\root\baseline-20260809.md`
- `D:\workspace\bug-pic\acceptance\HANDOFF-selected-20260809\first-time-user\FINAL-REPORT.md`
- `D:\workspace\bug-pic\acceptance\HANDOFF-selected-20260809\first-time-user\pw-h5-03-retired-kyc-route.png`
- `D:\workspace\bug-pic\acceptance\HANDOFF-selected-20260809\technical\FINAL-REPORT.md`
- `D:\workspace\bug-pic\acceptance\HANDOFF-selected-20260809\murphy\FINAL-REPORT.md`

## 解除条件

1. 恢复历史 `#/pages/me/kyc` 到 security 或等价安全页的迁移，并显示“流程已下线”说明；覆盖直接打开、刷新、返回和多次进出。
2. 用同一 commit/build id 重建并重启 3002，再锁定 PID、BUILD_ID 与浏览器证据。
3. 在真实 MFA 会话中从可见入口复核 KYC 缺失及 K4/J3/B3 页面。
4. 修正 J3 语义合同并使 PC 完整 verify 全绿。


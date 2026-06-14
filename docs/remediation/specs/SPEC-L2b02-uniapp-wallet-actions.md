# SPEC-L2b02-uniapp-wallet-actions

| 字段 | 值 |
|---|---|
| 状态 | verified |
| 层/工作流 | L2b 前端缺陷分流 / UniApp 钱包动作 |
| 端 | uniapp |
| 模型层级 | spec=T0; 实现=T1 |
| 关联缺陷 id | FR-005, FR-006, FR-007 |
| 关联规格卡 | - |

## 1. 背景与问题

UniApp 钱包相关动作采样显示三类死控: 新绑卡页默认卡开关无可观察变化, 提现跟踪空态 `Submit a new withdrawal` 无路由, 交易哈希页 `Copy hash` 无反馈。代码中存在 `cards.setDefault`, `goWithdraw`, `uni.setClipboardData` 与 toast, 但真实 H5 证据仍为无变化, 说明事件绑定、反馈层或 H5 fallback 不可靠。

## 2. 目标与非目标

目标: 钱包动作必须在真实浏览器里可操作、可观察、可持久化。默认卡开关要改变 UI 状态并影响保存结果; 提现 CTA 要进入提现表单; copy hash 要复制或给出明确失败反馈。

非目标: 不实现真实 PSP/链上查询; 不改提现风控状态机。

## 3. 改动文件面声明

- `D:\WORKS\PLAN\Nexion-uniapp\src\pages\me\wallet-cards-new.vue`
- `D:\WORKS\PLAN\Nexion-uniapp\src\store\cards.ts`
- `D:\WORKS\PLAN\Nexion-uniapp\src\pages\me\wallet-withdraw-tracking.vue`
- `D:\WORKS\PLAN\Nexion-uniapp\src\pages\me\wallet-bills.vue`
- `D:\WORKS\PLAN\Nexion-uniapp\src\pages\tx\hash.vue`
- `D:\WORKS\PLAN\Nexion-uniapp\src\i18n\messages\en.ts`
- `D:\WORKS\PLAN\Nexion-uniapp\src\i18n\messages\zh.ts`

## 4. 方案

1. 默认卡开关改为 native `checkbox-group` + 显式 `onDefaultGroupChange()` handler, 给 checkbox 增加可测文本/状态, 并确保保存结果由 `cardsStore.add(..., { makeDefault })` 决定。
2. 提现跟踪空态 CTA 使用统一路由 helper 进入 `/pages/me/wallet-withdraw`; 若提现被 KYC/余额门禁阻断, 必须展示原因并给下一步入口。
3. `copyHash()` 增加 H5 fallback: 优先 `navigator.clipboard.writeText`, 再 `uni.setClipboardData`; 成功/失败均通过 `toast` 或内联 copied state 可见。
4. 钱包账单行补齐可点击语义, 点击进入 `/pages/tx/hash?hash=...`, 让账单流水与 hash 明细形成闭环。
5. 绑定卡提交增加 `isBinding`/`canSubmit` 幂等保护, 防止 H5 同时触发 `tap` 与 `click` 时重复写入。

## 5. 同形全站扫描范围

- `rg -n "setClipboardData|navigator\\.clipboard|copyHash|Copy" D:\WORKS\PLAN\Nexion-uniapp\src`
- `rg -n "setDefault|defaultTokenId|Set as default|formDefaultCheckbox" D:\WORKS\PLAN\Nexion-uniapp\src`
- `rg -n "wallet-withdraw|Submit a new withdrawal|goWithdraw" D:\WORKS\PLAN\Nexion-uniapp\src`

## 6. 验收断言（机器可测）

1. `cd D:\WORKS\PLAN\Nexion-uniapp; npm run type-check` 通过。
2. `cd D:\WORKS\PLAN\Nexion-admin-prototype; $env:FRONT_ACTION_SAMPLE_LIMIT='3'; node scripts\remediation-runtime-front-action-sample.mjs UNI-FR-05` 后 FR-005/006/007 相关动作不再为 `no-observable-change`。
3. 默认卡开关点击前后 DOM/文本/checkbox 样式至少一项变化; 提交有效卡后 `nexion-cards-v1.defaultTokenId` 为新 token。
4. `/pages/me/wallet-withdraw-tracking` 空态 CTA 后 URL 变为 `/#/pages/me/wallet-withdraw` 或出现明确门禁原因。
5. `/pages/tx/hash?hash=0xdemo` 点击 copy 后出现 `hashCopied` 类成功反馈; clipboard 不可用时出现失败反馈而不是静默。

## 7. 拟新增哨兵

- 扩展 front action sampler 对 copy/default-toggle/empty-state-route 三类动作的强断言。
- 可选新增 `scripts/uniapp-wallet-actions-e2e.mjs`, 绑定 FR-005/006/007。

---

## 完成回执（实现完成时回填）

- 验证证据：
  - `D:\WORKS\PLAN\Nexion-uniapp`: `npm run type-check` PASS。
  - `D:\WORKS\PLAN\Nexion-uniapp`: `bash scripts/verify.sh` PASS, 14 pass / 0 fail; H5 route probe skipped because this run uses `http://localhost:5174` instead of the script default `5173`。
  - `D:\WORKS\PLAN\Nexion-admin-prototype`: `UNI_BASE_URL=http://localhost:5174 FRONT_ACTION_SAMPLE_LIMIT=3 node scripts\remediation-runtime-front-action-sample.mjs UNI-FR-05` PASS, `errors=0`, `noObservableChange=0`, `clickTargetMissing=0`, `hashOnlyNoContent=0`。
  - 浏览器实景：默认卡 OFF 保存 1 张卡且 `defaultTokenId=null`; 默认卡 ON 保存 1 张卡且 `defaultTokenId` 指向该卡; 提现空态 CTA 进入 `/#/pages/me/wallet-withdraw`; `Copy hash` 显示 `Transaction hash copied`; 账单行进入 `/#/pages/tx/hash?hash=ORD-20260612-6021`。
  - 证据文档：`docs/audit/uniapp-wallet-actions-runtime-evidence.md`。
- 同形扫描结果：
  - `setClipboardData|navigator.clipboard|copyHash|Copy`: tx hash copy 已有 H5 fallback + visible success/fail state; 非本 spec 的分享/copy 面已显示 copied/toast 或归入后续外链/分享工作流。
  - `setDefault|defaultTokenId|Set as default|formDefaultCheckbox|formDefaultOn|formDefaultOff|makeDefault`: 默认卡 intent 显示和持久化链路在位。
  - `wallet-withdraw|Submit a new withdrawal|goWithdraw|submitNewWithdrawal`: 空态入口已路由到提现表单。
- 哨兵：
  - `UNI-FR-05` front action sampler 作为 FR-005/FR-006/FR-007 回归哨兵, 当前 `noObservableChange=0`。
  - Playwright 手工回证补充 storage/URL/feedback 三类断言, 发现并修复 H5 双事件重复提交。
- PR：
  - 本地整改批次, 未创建远端 PR。
- 台账更新：
  - `FR-005`, `FR-006`, `FR-007` 更新为 `verified`, 证据绑定 `docs/audit/uniapp-wallet-actions-runtime-evidence.md` 与 `docs/audit/shards/uni-fr-05-front-action-sample.ndjson`。

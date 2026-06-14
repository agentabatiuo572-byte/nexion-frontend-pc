# SPEC-L2b03-uniapp-account-support-trial

| 字段 | 值 |
|---|---|
| 状态 | verified |
| 层/工作流 | L2b 前端缺陷分流 / UniApp 账户支持与试用 |
| 端 | uniapp |
| 模型层级 | spec=T0; 实现=T1 |
| 关联缺陷 id | FR-009, FR-010, FR-011 |
| 关联规格卡 | - |

## 1. 背景与问题

UniApp 账户域动作采样显示: Help/Support/Tickets 的支持 CTA 无响应, Profile 的 `Save Changes` 假写, Me/Trial 的 `Claim trial` 不启动试用流。三者都属于“用户想完成一件事但没有业务落点”的阻塞。

## 2. 目标与非目标

目标: 支持入口能创建/查看 ticket; profile 保存能改本地 profile store 并刷新仍在; trial CTA 能打开领取 sheet、进入绑卡或展示资格原因。

非目标: 不接真实客服系统; 不改变试用价格/冷却期口径。

## 3. 改动文件面声明

- `D:\WORKS\PLAN\Nexion-uniapp\src\pages\me\help.vue`
- `D:\WORKS\PLAN\Nexion-uniapp\src\pages\me\support.vue`
- `D:\WORKS\PLAN\Nexion-uniapp\src\pages\me\support-tickets.vue`
- `D:\WORKS\PLAN\Nexion-uniapp\src\pages\me\profile.vue`
- `D:\WORKS\PLAN\Nexion-uniapp\src\pages\me\me.vue`
- `D:\WORKS\PLAN\Nexion-uniapp\src\pages\me\trial.vue`
- `D:\WORKS\PLAN\Nexion-uniapp\src\store\profile.ts`
- `D:\WORKS\PLAN\Nexion-uniapp\src\store\free-trial.ts`
- `D:\WORKS\PLAN\Nexion-uniapp\src\store\trial-claim-sheet.ts`
- `D:\WORKS\PLAN\Nexion-uniapp\src\mock\tickets.ts`
- `D:\WORKS\PLAN\Nexion-uniapp\src\i18n\messages\en.ts`
- `D:\WORKS\PLAN\Nexion-uniapp\src\i18n\messages\zh.ts`

## 4. 方案

1. Support 三页统一 ticket workflow: contact/open-ticket 打开 ticket 创建 sheet 或进入 `/pages/me/support`; ticket row 的 `Open` 打开详情 drawer/route。
2. Profile 表单字段绑定到 `profile.ts`; save 做字段校验、写 storage、显示保存成功, 刷新页面后仍为新值。
3. Claim trial 复用 `trial-claim-sheet` 与 `free-trial` store: 有资格则打开领取 sheet; 需绑卡则路由 `/pages/me/wallet-cards-new?trial=1&returnTo=/pages/me/trial`; 无资格展示具体原因。
4. 支持/试用所有按钮必须避免仅 toast 成功, 必须有状态变化、路由或可继续操作的 sheet。

## 5. 同形全站扫描范围

- `rg -n "Contact support|Open a ticket|support-tickets|ticket|Open" D:\WORKS\PLAN\Nexion-uniapp\src\pages\me D:\WORKS\PLAN\Nexion-uniapp\src\components\me`
- `rg -n "Save Changes|profile|useProfile|setStorageSync" D:\WORKS\PLAN\Nexion-uniapp\src\pages\me D:\WORKS\PLAN\Nexion-uniapp\src\store`
- `rg -n "Claim trial|trial-claim|free-trial|wallet-cards-new\\?trial" D:\WORKS\PLAN\Nexion-uniapp\src`

## 6. 验收断言（机器可测）

1. `cd D:\WORKS\PLAN\Nexion-uniapp; npm run type-check` 通过。
2. `cd D:\WORKS\PLAN\Nexion-admin-prototype; $env:FRONT_ACTION_SAMPLE_LIMIT='2'; node scripts\remediation-runtime-front-action-sample.mjs UNI-FR-06` 后 FR-009/010 相关动作不再为 `no-observable-change` / 弱 fake-write。
3. `cd D:\WORKS\PLAN\Nexion-admin-prototype; $env:FRONT_ACTION_SAMPLE_LIMIT='2'; node scripts\remediation-runtime-front-action-sample.mjs UNI-FR-10` 后 `Claim trial` 不再无响应。
4. Profile 改名保存后刷新, 页面显示新值且 storage 对应 profile key 已更新。
5. Support 新 ticket 创建后 tickets 列表可见; ticket `Open` 可打开详情。
6. Claim trial 有三种可测分支: open sheet / route bind-card / show eligibility reason。

## 7. 拟新增哨兵

- 新增/扩展 UniApp account task walkthrough: support-ticket-create, profile-save-persist, trial-claim-entry。

---

## 完成回执（实现完成时回填）

- 验证证据：`docs/audit/uniapp-account-support-trial-runtime-evidence.md`
- 同形扫描结果：support/help CTAs、profile save、trial claim sheet/bind-card、goals save 同形项已扫描；`FM-018` / `SD-005` 支持后台缺面保留 open。
- 哨兵：`UNI_BASE_URL=http://localhost:5174 FRONT_ACTION_SAMPLE_LIMIT=2 node scripts\remediation-runtime-front-action-sample.mjs UNI-FR-06` => `noObservableChange=0`; `UNI-FR-10` => `noObservableChange=0`。
- PR：本地整改批次，未创建远端 PR。
- 台账更新：`FR-009`、`FR-010`、`FR-011` 转 `verified`。

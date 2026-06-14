# SPEC-L3c02-uniapp-persona-walkthroughs

| 字段 | 值 |
|---|---|
| 状态 | verified |
| 层/工作流 | L3c UniApp persona walkthrough gate |
| 端 | uniapp |
| 模型层级 | spec=T0; 实现=T1 |
| 关联缺陷 id | FR-014; FT-013; FT-014; FT-015 |
| 关联规格卡 | - |

## 1. 背景与问题

`SPEC-L3c01` 已证明 UniApp 全路由存在且泛动作采样 0 阻断,但 `task-walkthrough-matrix.md` 仍有三条任务需要端到端 persona proof:

- `FT-013`: KYC 后提交提现表单。
- `FT-014`: 兑换 NEX/USDT 后回购,并验证账单/积分/仓位。
- `FT-015`: 团队页进入佣金、V Rank、Balance Match、Leadership Pool 业务页。

本轮 proof 发现一个同根因 UX 阻塞簇:UniApp H5 的 `<input>` / `<view @click>` 在视觉上存在,但缺稳定的真实操作目标。提现地址输入框内层 `.uni-input-input` 高度为 0,键盘焦点留在金额框;提现、回购、团队入口用纯文案定位时能看到按钮但不稳定触发业务事件。

## 2. 目标与非目标

目标:

1. 建立可重跑的 `scripts/uniapp-persona-walkthrough-proof.mjs`,证明 `FT-013`~`FT-015` 的业务结果,不是只证明路由渲染。
2. 修复提现地址输入框真实可聚焦/可输入问题。
3. 给提现提交、回购提交、团队关键入口补业务选择器,proof 用真实 browser click 触发。
4. 将该 proof 接入 admin `npm run verify`。

非目标:

1. 不声明 L5 终验完成。
2. 不补未覆盖的 top-up/staking/unilevel/i18n/switches persona flow。
3. 不把 JS 直接调用业务函数作为交互证明;必须从浏览器 DOM 控件触发。

## 3. 改动文件面声明

- `D:\WORKS\PLAN\Nexion-admin-prototype\scripts\uniapp-persona-walkthrough-proof.mjs`
- `D:\WORKS\PLAN\Nexion-admin-prototype\scripts\verify.sh`
- `D:\WORKS\PLAN\Nexion-admin-prototype\docs\audit\shards\uniapp-persona-walkthrough-proof.ndjson`
- `D:\WORKS\PLAN\Nexion-admin-prototype\docs\audit\uniapp-persona-walkthrough-runtime-evidence.md`
- `D:\WORKS\PLAN\Nexion-admin-prototype\docs\audit\task-walkthrough-matrix.md`
- `D:\WORKS\PLAN\Nexion-admin-prototype\docs\audit\ledger.ndjson`
- `D:\WORKS\PLAN\Nexion-admin-prototype\docs\audit\LEDGER.md`
- `D:\WORKS\PLAN\Nexion-admin-prototype\docs\remediation\MASTER-PLAN.md`
- `D:\WORKS\PLAN\Nexion-uniapp\src\pages\me\wallet-withdraw.vue`
- `D:\WORKS\PLAN\Nexion-uniapp\src\pages\me\wallet-repurchase.vue`
- `D:\WORKS\PLAN\Nexion-uniapp\src\pages\team\team.vue`
- `D:\WORKS\PLAN\Nexion-uniapp\src\components\team\team-ledger-card.vue`
- `D:\WORKS\PLAN\Nexion-uniapp\docs\PORT-PITFALLS.md`
- `D:\WORKS\PLAN\Nexion-uniapp\docs\PORT-LEDGER.md`

## 4. 方案

- 新增 persona proof:
  - seed KYC pairing / risk disclosure / contribution points。
  - `FT-013`:真实 fill amount + address,真实 click submit,断言 tracking URL、WD id、地址、扣 5 点、withdraw bill。
  - `FT-014A`:真实打开 exchange confirm modal,断言 modal 内有 `NEX 10 -> USDT` 业务内容和 primary 操作,提交后验证 swap history、v3 cap、双 bill。
  - `FT-014B`:真实点击 repurchase CTA,断言 points +100、staking position、stake bill。
  - `FT-015A~D`:真实点击 team hub 入口,断言目标页 URL 与业务关键词。
- 为 H5 运行时稳定性做 proof 隔离:
  - 默认使用唯一 agent-browser session,避免旧弹窗/旧 store 污染。
  - seed 后 reload,确保 Pinia/composable 从 storage 重读。
  - 路由结果用 poll,不靠固定 sleep。
- 修复真实 UI 阻塞:
  - 提现地址 input 加 `nx-withdraw-address-input` 并设置内层 `.uni-input-input` 高度。
  - 关键业务 CTA/入口加稳定选择器:`nx-withdraw-submit-cta`,`nx-repurchase-submit-cta`,`nx-team-commissions-link`,`nx-team-rank-link`,`nx-team-binary-link`,`nx-team-leadership-pool-link`。

## 5. 同形全站扫描范围

- 同形一:UniApp H5 输入控件视觉 host 存在但内层 input 高度/焦点不可用。已在提现地址输入处用 browser fill + activeClass + value 双验。
- 同形二:文本 locator 找到 `<view>` 文案但未触发业务事件。已在提现、回购、团队四入口改为业务 selector + browser click,并将该模式写入 `PORT-PITFALLS.md`。
- 同形三:弹窗 proof 不能只看弹层出现。exchange confirm modal 必须断言交易方向/数量/币种、primary button、swap history、cap state、双 bill。

## 6. 验收断言

1. `UNI_BASE_URL=http://localhost:5173 node scripts\uniapp-persona-walkthrough-proof.mjs`: `status=passed`,7 个 step 全 pass。
2. `FT-013`: tracking URL 为 `/#/pages/me/wallet-withdraw-tracking`,正文有 WD id、金额、网络、提现地址;points=95;withdraw bill pending。
3. `FT-014A`: exchange modal 有业务内容;swap history 写入 NEX debit / USDT credit;v3 cap >0;swap bills=2。
4. `FT-014B`: points 95 -> 195;staking active position amount=200 / term=90;stake bill 存在。
5. `FT-015A~D`: team hub 入口分别进入 commissions/rank/binary/leadership-pool,目标页业务关键词存在。
6. `npm run verify` 必须包含 `uniapp-persona-walkthrough` gate。

## 7. 拟新增哨兵

- `scripts/uniapp-persona-walkthrough-proof.mjs`
- `scripts/verify.sh` 中新增 `UniApp persona walkthrough gate(提现/兑换回购/team finance 导航)`。
- `docs/audit/shards/uniapp-persona-walkthrough-proof.ndjson` 作为 task matrix 可复核证据。

---

## 完成回执

- `UNI_BASE_URL=http://localhost:5173 node scripts\uniapp-persona-walkthrough-proof.mjs`: PASS,7/7 step passed,证据写入 `docs/audit/shards/uniapp-persona-walkthrough-proof.ndjson`。
- `FT-013`: WD `WD-20260613-5234`,pointsAfter=95,trackingHasAddress=true。
- `FT-014A`: modal 文案含 `NEX 10 -> USDT`,swapId=`SW-WD70S`,toAmount=0.8240,v3TodayUsed=0.8240,billCount=2。
- `FT-014B`: points 95 -> 195,positionId=`stk-1781327445517`,billRef=`REINVEST-MQBWD9N1`。
- `FT-015A~D`: commissions/rank/binary/leadership-pool 四个目标页均 route + business needles 通过。
- 台账更新:`FR-014` verified;`FT-013`~`FT-015` 转 verified。

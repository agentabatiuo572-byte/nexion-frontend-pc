# D7 法币提现参数(FEAT-VND01b)· 方案 B 假数据配置面

状态:**Aligned**(主人 2026-08-06 换号前当场拍板方案 B,停等门已过 — 见 `D:\WORKS\PLAN\SESSION-HANDOFF-20260806.md` §二)

## Why

包 B(FEAT-PAYOUT-VND01 银行卡法币提现轨)的后台单元 [FEAT-VND01b] 完全未做。同类模块 D6/D5 是真后端驱动(nexion-backend 本机不存在),照抄会违反「不写后端服务接口」标准指令。主人拍板方案 B:新开独立假数据配置面。

## What changes

- 新增 `lib/admin/payout-vnd-local.ts`:本地假数据层,d-client 形状(async load/update + version + reason + operator),localStorage 持久(`nexion-admin-payout-vnd-v1`)。**接真后端时整文件替换为 fetch 版,页面零改。**
- 新增 `app/components/domain-views/d-tabs/d7-payout-vnd.tsx`:视觉与交互抄 D6/D5(f-stats / l-card / p-row / openActionConfirm edit 契约 / 生效历史表)。
- 接线:`d-view.tsx`(FOLD + RO_LIVE + 分发)、`lib/nav/console-nav.ts`(D 域 D7 行)、`lib/admin/registry/d.ts`(summary)、`docs/ops-actions.manifest.json`(OPS-D 新行,restActions 锚)。
- 新增 `tests/d7-payout-vnd-contract.test.mjs` 挂 verify GEARS(与实现同一提交,机器门与被判实现同落地)。

## Out of scope(硬边界)

- 🔴 `d6-fx.tsx` / `d5-params.tsx` **一行不改**;不碰 `app/api/admin/**` 代理路由;不改 `lib/admin/d-client.ts`。假字段绝不混进真后端页面。
- 不写任何后端服务接口;不新增真实 API 调用。
- 前端 uniapp 侧(FEAT-VND01 用户端)不动 —— 原型已完成。

## 字段(规格 §③ 数据字典,11 项全做)

汇率组:baseRate 26000(**只读**,单源语义归 D6 基准价,不建第二可写源)· buySpreadPct 1.5(0–3)· sellSpreadPct 1.5(0–3,新增)· quoteTtlMinWithdraw 10(1–60)· requoteTolerancePct 2(0–10)
费率组:feeRatePct 1.0(0–5)· feeMinUsd 1 · feeMaxUsd 25 · minAmountUsd 20 / maxAmountUsd 5000
开关:channelEnabled false(默认关)
派生(不缓存):buyRate = round10(base×(1+buy%));sellRate = round10(base×(1−sell%))

## Done-when(P6 逐条回测)

1. 越界值(任一字段超合法域)保存被拒:字段级红字,不落库、不产生历史记录。
2. 倒挂(sellRate ≥ buyRate)默认拒绝;仅 superadmin/super 可走强制确认路径(带风险声明),确认后落库并记历史。
3. feeMinUsd ≥ minAmountUsd 组合保存被拒(用户到手为负/零提示)。
4. 通道启停走确认 + 理由(≥8 字)+ 历史落账;开启标记放大资金流出方向。
5. 保存成功后刷新页面(重新 load),新值仍在(localStorage 持久证明);历史表追加一行(时间/前值→后值/操作者/理由)。
6. 版本冲突(旧 version 提交)被拒,提示刷新重试;`d6-fx.tsx`/`d5-params.tsx`/`d-client.ts` git diff 为空。
7. 契约测试挂进 verify GEARS 且红测过(注掉倒挂校验 → 测试红)。

审计修复轮追加(R2,2026-08-06 四路独立审计后):

8. 倒挂态下不碰点差的变更(停用/开启通道、费率调整)放行——止血动作永不被倒挂闸锁死(红测:退回旧闸 → 5 用例红)。
9. 倒挂强制保存 = 二次身份确认(输入指定短语)+ 风险声明 + diff/理由确认,三段式(规格 §⑥)。
10. 通道启停收超管门(规格异常5 GWT 严口径;§⑥ 与 ② 矛盾已记欠账待 PRD 收口统一)。
11. 跨标签页 CAS 真拦:旧 version 提交被拒,先写方改动与历史保留(浏览器分支契约用例)。
12. 脏持久数据:history 坏行过滤、数值越界回种子,不白屏;persist 写失败报运营可读中文,原值保留。
13. D7 确认弹窗零 A2 假承诺(auditSink="local-history" 全链文案:chip/理由 label/执行摘要/coverage 说明)。

## 审计裁决记录(main 回源逐条裁决四份独立报告)

- **已修**:倒挂锁死(S1/S2/S3 交叉)· 跨 tab CAS(S1)· 脏数据白屏+域校验(S1)· 通道超管门(S2 P0-1,取 GWT 严)· 二次身份确认(S2 P1-6)· 弹窗 A2 假承诺(S2 P1-2,经 auditSink 可选 prop,默认行为零变化)· persist 英文报错(S1)· 空串=0(S1/S2)· 越界仍出预览(t4,「报价只对能提交的输入出」)· 历史行无单位(t4)· changes 白名单(S3)· verify 齿 strip-types flag(S3)· manifest 锚精度 togglePayoutVndChannel(S3)· 边界锚强化 d1-d6+正则+本体禁令(S3/S1)· 「本地配置」措辞(S3)· 恢复默认作用域文案(S1/S2/S3)· `.ddom .l-inp` 样式补块(S2;D5 输入框顺带获得正确样式,交底:此前两域都靠浏览器原生兜底)。
- **不采纳/降级(理由)**:接真 B1 coverage(S2 P1-3)——LEDGER 在 runtime-mock 黑名单,假 coverage 红线闸比无闸更糟,改为弹窗文案诚实交底;加载骨架(S2)——与 D5/D6 全域文本惯例一致;design-kit 折叠摘要默认展开(t4)——横向共享组件行为,出界记台账。

## 欠账清单(接真后端 / 后续批次)

- `finance_d7_manage` 权限码为悬空新码(方案 B 禁写后端 seed):接 nexion-backend 时补 RBAC 迁移 + role seed + 契约钉扎。
- 接后端时:本地假数据层整文件换 fetch 版;`baseRateVndPerUsdt`/`buySpreadPct` 与 D6 同源,删本地副本;跨仓逐键 parity 哨兵扩到卖出方向;账本分录口径(冻结/付款/退回)与账本文档对齐。
- 规格内部矛盾待 PRD 收口澄清:② 异常5「超管确认」vs ⑥「确认+理由」(实现取严=超管);② 阳光路径「日限」vs ③ 数据字典无日限(实现按字典,未做日限)。
- design-kit 横向台账:执行摘要默认折叠态零变更信息;「当前弹窗不使用前端兜底值」工程口吻。
- 样式全局硬化单:`.l-inp` 13px → 13.5(9 档对齐,H/D 域同步);`--admin-danger` token 全仓未定义(现均走 hex 回退,D5 先例)。

## 实施拆解

- [x] T1 假数据层 + 契约测试挂 GEARS(报告:契约 12 用例全绿 + 2 轮红测证明门真;后随修复轮扩至 18 用例 + 第 3 轮红测)
- [x] T2 页面组件 + 四处接线(报告:tsc 0;nav/registry/d-view/manifest 四处接线,verify 42 齿链亲证 D7 齿在跑)
- [x] T3 机器门(报告:tsc 0 · verify 42 齿 37 跑 5 缺仓跳过 exit 0,两轮全量;跳过齿=channel-parity/FE-BE/J1/J2/K2,全因本机无 nexion-backend)
- [x] T4 实景走查 + 独立 audit(报告:R1 独立 tester 11/11 AC PASS;3 skeptic 对抗审计 → 修复轮 16 项落码;R2 回归 23 项断言实质全过,见 `2026-08-06-d7-payout-vnd-config-t4-test.md`)
- [ ] T5 commit 87674ab 已落;追加提交与推送 nexion-ops-console 新分支执行中(完成与否以收尾汇报为准,本文件不回改)

# APP 剩余模块真实接口验收报告

- 日期：2026-08-15
- 范围：`NX1.0-UniApp`、`nexion-backend`、`nexion-ops-console`
- 方法：`D:\nexion\页面业务逻辑通顺性验收方法.md`
- 结论：通过；P0=0，P1=0

## 1. 验收边界

本轮完成 APP 剩余本地假数据、客户端自判真值和未接真实接口模块的收口。能由 Nexion 服务端提供的数据必须读取服务端并权威回读；确实依赖银行、PSP、链上、安装包等外部提供方的数据，在显式 Sandbox 使用带 `source=mock`、`sourceEnvironment=SANDBOX` 的隔离 Mock，并按用户口径标记完成；生产没有提供方时保持 HOLD，禁止静默回退 Mock。

未执行真实购买、提现、结算、派奖、链上转账、银行或 PSP 动作；未提交、未推送、未部署。

## 2. 失败—修复—复验记录

### 2.1 独立初审未通过

首次独立初审为 94/100，低于 96 分门槛：

1. 远端 `market` 仍渲染本地固定的比较币和交易所数据；
2. 远端交易详情仍从 hash 派生区块、Gas、地址和确认数。

修复后，远端只显示服务端 NEX 行情；比较币和链上明细在无权威接口时显示明确 HOLD。本地固定数据仅保留在 Mock 模式。

### 2.2 可见商城走查发现的运行时问题

真实账号的登录、商城、刷新和重登走查暴露并修复：重复 bootstrap 覆盖新登录会话、无 session 预取触发全局未授权、旧 recovery latch 抢占新会话、Sandbox 用户读取生产提现地址接口返回 403。最终采用 session/账号代际保护；无 session 预取本地失败关闭；显式 Sandbox 提现地址改为账号隔离 Mock 并显示来源，production 仍只认服务端地址簿。

### 2.3 完整门链首次失败后继续修复

第一次完整 `npm run verify` 发现 5 项失败：远端刷新韧性、旧品牌环境变量名、value-ladder 字号、zero-border Sandbox banner、提现自检的异步 sessionVault 桩。全部修复后重跑通过。

Murphy 复审又发现 3 项 P2：跨仓测试硬编码旧目录、H1/E1 Phase 注释混淆、锁定商品只显示通用 Coming soon。现已改为可配置的真实兄弟仓路径并纳入主 `verify`；锁定卡保存并展示服务端 `releaseState/releasePhaseId`，绝不由 H1 P1–P6 推导 E1 可购性。

## 3. 真实、Mock 与 HOLD 矩阵

| 分类 | 当前结论 |
| --- | --- |
| 服务端真实真值 | 商城 catalog/订单/库存/发布门、Lucky Spin、Sponsor/注册回执、VietQR 报价与时窗、服务端回单、设备收益与规格、Trade-in、排行/任务/Genesis、商城社会事实、远端取消与权威状态回读 |
| 显式 Sandbox Mock | 验收 catalog、提现地址、缺少外部银行账号等数据；必须账号隔离并显示 `mock/SANDBOX`，不得进入 production |
| 生产 HOLD | F4 真实出款、未配置的 PSP/银行/链上提供方、链上交易详情、外部比较币行情、正式安装包元数据 |

## 4. 逻辑验收结果

- 真实账号可见路径：登录 → 商城 → catalog 回读 → 刷新 → 重登 → 商城回读，PASS；页面错误 0、失败响应 0、未分类导航取消 0。
- 商城分类：`StellarBox Pro` 位于正常商品区；`NexionBox Pro v2` 存在并按服务端 E1 节奏保持阶段锁定，不是数据缺失。
- App 完整门链：legacy `441 pass / 0 fail / 0 skip`；跨仓门 `8/8`；Vitest `35 files / 91 tests`；H5 build PASS；H5 runtime `20 scenarios + 5 direct probes`；提现权威状态镜像 `25/25`。
- Backend：Maven `3748 tests / 0 failures / 0 errors / 12 skipped`。
- PC：完整 `verify 65/65`。
- 端口归属：App 5173、PC 3002、Backend 8110 均为真实项目；App 根页面 200，PC 根页面 200，受保护的后端健康端点与 PC session 端点未登录返回 401，代理/监听链路存在。

证据：

- `D:\workspace\bug-pic\acceptance\APP-REMAINING-20260815\app-verify-final-after-review.log`
- `D:\workspace\bug-pic\acceptance\APP-REMAINING-20260815\backend-maven-test.log`
- `D:\workspace\bug-pic\acceptance\APP-REMAINING-20260815\pc-verify.log`
- `D:\workspace\bug-pic\acceptance\APP-REMAINING-20260815\real-account-store-smoke-result.json`
- `D:\workspace\bug-pic\acceptance\APP-REMAINING-20260815\store-after-refresh.png`

## 5. 独立评分

- 首次独立初审：94/100，不通过，继续修复。
- 修复后独立初审：97.6/100，P0=0、P1=0，通过。
- Murphy 终复审：99.6/100，P0=0、P1=0，通过。

保留 3 个已登记的非运行阻断旧契约：一项与当前提现产品决策相反、两项已被更新契约等价覆盖。它们不属于当前 P0/P1，但后续应迁移或删除，避免把“登记覆盖”误读成“每个历史脚本都实际执行”。三仓当前均为共享脏工作树，本报告绑定的是当前文件态和证据日志，并非不可变提交快照。

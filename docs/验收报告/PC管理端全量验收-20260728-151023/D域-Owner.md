# D 域 Owner 验收报告

## 结论

- Run ID：`pc-full-acceptance-20260728-151023`
- 范围：D1–D6，共 6 个模块。
- 锁定基线：PC `91d1c2d`、后端 `a1cc2a7`、App `0e2178b`。
- 最终候选环境：PC `127.0.0.1:3002`（Build ID `zMwYtaTe1oUh_8OZpPPq9`，PID 6104）、后端 `127.0.0.1:8110`（PID 20820）、隔离库 `nexion_acceptance_20260728_151023`、Redis DB 14。
- Owner 裁决：**D1–D6 技术轨、readonly/no-write/no-menu 五层权限轨、独立 maker/checker 高风险轨全部通过。D 域 Owner PASS，进入非 Owner 轮换复审。**
- 初审评分：**98.4/100，通过**（门槛 >96）。
- 未关闭产品缺陷：`P0/P1/P2/P3 = 0/0/0/0`。
- 已关闭验收载具缺陷：`D-AUTO-001`、`D-AUTO-002`（均为 P3、非产品缺陷）。

历史通过结论未被复用。本轮先完成 D1–D6 主链，再在修复后候选上用全新浏览器上下文补齐 readonly、有菜单无写、无菜单和独立 maker/checker。D1–D6 的只读账号均从可见侧栏进入，六个读取接口均为 200、六个绕过 UI 的写接口均为 403；无菜单账号的菜单、直达路由及六组读写接口全部被拒绝，刷新和退出重登没有恢复陈旧权限。D2 隔离提现由 maker 从侧栏真实延迟、checker 新上下文核验并以合法陈旧动作取得 409；随后完成数据库、A2、A4/outbox、consumer 核对、精确恢复及零残留清理。最终 D 主链在 Build ID `zMwYtaTe1oUh_8OZpPPq9` 上再次 `4/4` 通过。

## 模块逐项结果

| 模块 | 入口 | Owner 技术轨结果 | 权限/高风险轨 | 最终模块裁决 |
|---|---|---|---|---|
| D1 充值对账中心 | `/finance/recon` | 五个服务端视图 `matched/orphan/mismatch/late/inflight` 均真实 200；VietQR 配置完成页面写入、CAS 409、稳定幂等重放、精确恢复、刷新重登和 A2 历史核对；App 远程 intent/渠道策略合同通过 | readonly/no-write 读 200、配置写 403；无菜单读写 403、直达拒绝；刷新重登不漂移 | **PASS** |
| D2 提现审核队列 | `/finance/withdrawals` | 队列、详情依赖、D5/K3/K4/C4 权威事实真实读取；合法空态与现存 `REVIEW_PENDING/REFUNDED` 数据均不伪造；匿名 401；App canonical 提现合同通过 | readonly/no-write 读 200、处置写 403；无菜单读写 403；maker/checker 真实隔离延迟、409 并发拒绝、恢复与清理通过 | **PASS** |
| D3 资金池水位仪表盘 | `/finance/pool` | 九类应付负债、储备、到期预测、净敞口均由后端权威接口返回；页面未泄露表名；D1 待核实入金口径合同通过 | readonly/no-write 读 200、储备注入写 403；无菜单读写 403；写按钮不渲染 | **PASS** |
| D4 账本/账单审计 | `/finance/ledger` | `充值/提现/收益/佣金/兑换/退款/奖励` 七类逐项真实 200；服务端分页与唯一账本语义通过；匿名 401 | readonly/no-write 读 200、导出写 403且按钮显示不可导出；无菜单读写 403 | **PASS** |
| D5 提现参数配置 | `/finance/params` | D5 四组自有参数与 H1 只读参数边界可见；0.80→0.81 放大尝试前端按钮禁用且服务端 422，版本和值不变；刷新重登保持；A2 拒绝审计存在 | readonly/no-write 读 200、参数写 403；无菜单读写 403；四组提交按钮不渲染 | **PASS** |
| D6 汇率牌价 | `/finance/fx-rate` | 26000 基准价、1.50% 点差、30 分钟锁价均为服务端单源；页面调价、幂等重放、CAS 409、精确恢复、刷新重登、注入 500 失败关闭与恢复全部通过；App 报价合同通过 | readonly/no-write 读 200、调价写 403；无菜单读写 403；调整按钮不渲染 | **PASS** |

## 十步验收记录

### 1. 页面与动作盘点

- 唯一范围源 `lib/nav/console-nav.ts`：D1 `/finance/recon`、D2 `/finance/withdrawals`、D3 `/finance/pool`、D4 `/finance/ledger`、D5 `/finance/params`、D6 `/finance/fx-rate`。
- D1 动作：五视图、收款账户、回单与配置；D2 动作：查询、详情、放行、延迟、冻结、解冻、拒绝/退款及批量；D3 为储备/负债/到期/敞口权威读面；D4 为七类账单与单用户流水；D5 为日限、余额比例、网络费、NEX 抵扣及 H1 只读派发；D6 为基准价、点差、锁价窗口与历史。

### 2. 字段到数据库的完整溯源

| 模块 | 主要接口 | 权威表/来源 | 关键下游 |
|---|---|---|---|
| D1 | `/api/admin/finance/topup/*`、`/api/admin/finance/vietqr/*`、App `/api/app/deposits/vietqr/intents` | `nx_vietqr_intent`、`nx_vietqr_reconciliation`、`nx_vietqr_bank_account`、`nx_vietqr_config` | 钱包、累计入金、D3、D4、A2/A4、App |
| D2 | `/api/admin/finance/withdrawals*`、App 提现 API | `nx_withdrawal_order`；K3 `nx_admin_risk_withdraw_hit/rule`；K4/C4/K5/D5/J1 事实 | D3/B1、D4、A2/A4、K3/K4/K5、App |
| D3 | `/api/admin/treasury/reserve`、`liabilities`、`maturity-forecast`、`net-exposure`、`b-domain` | 钱包、质押、锁仓、提现、Genesis、VietQR 对账等服务端账本聚合 | B1/B2/L3 |
| D4 | `/api/admin/bills*` | `nx_wallet_bill` 及钱包账本 | C3、D1/D2、L5 |
| D5 | `/api/admin/withdraw/limits` | `nx_config_item` 的 `withdrawal.*` / `wallet.withdrawal.*` 与 `withdrawal.d5.version`；H1 参数只读 | App 提现、D2、B1、H1、A2/A4 |
| D6 | `/api/admin/finance/fx-quote`、App `/api/app/payments/fx-quote` | `nx_finance_fx_quote_config`、`nx_finance_fx_quote_history` | App VietQR 锁价、D1 |

### 3. 真实 Chromium 用户路径

- D1–D6 分别用独立 `workers=1` Playwright 任务，从 `/` 的真实登录门登录，从可见侧栏点击进入，不使用隐藏 URL 作为首轮入口。
- 六个模块均完成首轮、刷新、退出、重新登录和再次从侧栏进入；结果 `6/6`。
- 扩展用例 `tests/e2e/d-final-independent-20260725.spec.ts` 最终 `4/4`：
  1. D1 五视图 + D3 九类科目；
  2. D2/D4/D5 权威读取 + D5 红线失败关闭；
  3. D1/D6 写入、CAS、幂等、审计、恢复和重登；
  4. D6 401/500 失败关闭与恢复。
- 监控范围内页面异常 `0`、非预期 `/api/admin/*` 5xx `0`。

### 4. 主流程、空态、刷新、返回、退出重登

- D1 五视图当前均为合法空集合，页面显示空态而非伪造记录；隔离库开放 VietQR intent 为 `0`。
- D2 隔离库存在 `REVIEW_PENDING=2/$200`、`REFUNDED=2/$40`，页面按服务端返回展示。
- D3 展示九类负债；D4 精确七类逐项查询；D5/D6 刷新与重登后均回读服务端值。
- D1/D6 的验收写入均恢复原值，重登后仍一致。

### 5. 五层权限

- 匿名轨：D2/D4/D5 PC BFF 为 401；D6 PC BFF 与后端直连均为 401；静态 RBAC/Controller 合同通过。
- readonly 与有菜单无写轨：分别使用独立账号和全新上下文登录，侧栏只显示 D 域 6 个模块。D1–D6 均能从可见侧栏进入，读取接口全部 200 且含服务端 `data`；D1 配置、D2 处置、D3 储备注入、D4 导出、D5 参数、D6 调价六个绕过 UI 的写请求全部 403。各模块写按钮不渲染或明确禁用，不依赖前端隐藏作为最终权限。
- 无菜单轨：侧栏不存在任何 `/finance/*` 菜单；直接访问 `/finance/recon` 被重定向且不渲染 `.ddom`；D1–D6 六个读接口和六个写接口全部 403。
- 缓存与重登：三类受限账号均在权限夹具已关闭旧会话后，以全新浏览器上下文执行；完成刷新、可见账号菜单退出、重新输入账号/MFA 登录。readonly/no-write 仍为“读 200、写 403”，no-menu 仍为“读写 403、菜单 0”，未出现旧权限缓存回流。
- 独立 maker/checker：maker 与 checker 使用两个同时独立的浏览器上下文，不共享 Cookie、token 或页面状态。maker 只有获授的 D2 延迟等权限，无法看到冻结/解冻/退款按钮；checker 使用单独会话核验状态、详情、A2 与 A4。

### 6. 异常与失败关闭

- 401：匿名访问按预期拒绝。
- 409：D1、D6 旧版本写入均返回 409，页面显示中文“未覆盖”指引并停止展示可能过期的权威事实。
- 422：D5 在 B1 覆盖率低于红线时，余额可提比例 0.80→0.81 的放大方向被前端禁用、后端拒绝；值和版本均未变化。
- 500：D6 受控注入 `FX_QUOTE_CONFIG_UNAVAILABLE` 后清除旧牌价并关闭写入口；解除注入后恢复。
- 静态合同同时覆盖 403/404、畸形 200、依赖事实缺失、状态冲突和未知结果；实际受限角色轨已补齐 D1–D6 写 403、无菜单读写 403 与 D2 陈旧状态 409。

### 7. 幂等、CAS 与并发

- D1、D6：页面首次写、相同幂等键重放、同资源旧版本 CAS 409、精确恢复全部通过；最终值与原值一致。
- D5：前后端双重红线判定；拒绝写不增加版本，不改变权威值。
- D2：状态机、稳定幂等键和批量拆分源码合同通过。隔离提现从 `REVIEW_PENDING/version=0` 由 maker 真实执行 `DELAY`，成为 `EXTENDED_HOLD/version=1`；checker 新上下文提交字段合法但状态已陈旧的相同动作，服务端返回 409。成功动作和冲突动作均形成幂等记录，未发生第二次状态推进。

### 8. 数据库、A2、A4/outbox 与上下游

- D1 最终：`nx_vietqr_config.tolerance_vnd=1000`，`per_tx_limit_usd=5000.00`，配置版本 28。
- D6 最终：`VND_USDT=26000`、`buy_spread_pct=1.50`、`lock_window_minutes=30`、版本 26；更新理由为本 Run 最终候选的精确恢复。
- A2：本轮 D1/D6 成功写与 CAS 拒绝均有记录；最新 D1 为 `VIETQR_CONFIG_UPDATED` / `D1_VIETQR_CONFIG_REJECTED`，D6 为 `FX_QUOTE_UPDATED` / `D6_FX_QUOTE_REJECTED`。
- D5：A2 `D5_WITHDRAWAL_LIMITS_REJECTED` 记录 422；隔离恢复写记录 `D5_WITHDRAWAL_PARAM_CHANGED`。A4/outbox `admin.withdraw_limit_changed` 已为 `PUBLISHED`、重试 0、无错误。
- D2 maker/checker 闭环：隔离动作的 A2 为 `D2_WITHDRAWAL_REVIEW_DELAY / SUCCESS / HIGH`；A4/outbox 为 `withdraw.delayed / PUBLISHED / retry=0 / lastError=null`；`d2-withdrawal-lifecycle-observer` consumer receipt 为 `SUCCESS`、一次处理。checker 能从新会话读取 A2/A4；数据库状态与页面均为 `EXTENDED_HOLD` 后才进入恢复步骤。
- App 交叉合同：VietQR 远程状态、支付 API、核心卡渠道策略、提现 canonical 映射、remote 模式不回退 mock、Remote 地址换绑安全下线均通过。

### 9. 精确清理与可重放性

- D1 容差恢复 1000；D6 恢复 26000 / 1.50% / 30 分钟。
- 修复后候选完整重跑使审计版本自然前进；最终数据库为 D1 版本 28、D6 版本 26，业务值与锁定原值完全一致。
- D5 最终：
  - `wallet.dual-ledger.redline-pct=100.0`
  - `withdrawal.max_balance_pct=0.8`
  - `wallet.withdrawal.max_balance_pct=0.8`
  - `withdrawal.d5.version=3`
- D5 恢复说明：隔离库中先验证收紧 0.80→0.79；恢复 0.79→0.80 属放大方向，被当前红线正确拒绝。仅在隔离库临时把红线降为 0，通过真实 `PUT /api/admin/withdraw/limits` 恢复，再在 `finally` 精确恢复红线 100.0；最终配置、A2 与 outbox 已复核。
- D2 隔离夹具先精确恢复为 `REVIEW_PENDING/version=0`，并确认 `holdUntil/lifecycleOwner/failureReason` 均为空；随后删除隔离提现及其幂等、A2、outbox、consumer receipt、risk hit、K4 alert receipt，七类残留计数均为 0。未处理任何既有提现。
- D/I 共享权限账号按主智能体要求保留，未由 D Owner 清理；其余 D 业务夹具残留为 0。不存在新增 VietQR 开放 intent。

### 10. 初审评分

**98.4/100，通过。**

- D1–D6 主链、空态/刷新/重登、异常关闭、CAS/幂等：39.4/40。
- 菜单、路由、按钮、接口、数据五层权限及缓存失效：29.7/30。
- D2 独立 maker/checker、A2/A4/consumer 与恢复清理：19.6/20。
- 证据、可重放性与零残留：9.7/10。

扣分项仅为验收载具在首次权限轨中出现自动刷新竞态、会话响应形状误读和陈旧请求载荷不合法，均已作为 `D-AUTO-002` 修复，并从全新上下文完整重跑。产品缺陷为 0。下一门槛为非 Owner 复审 >98。

## 缺陷闭环

### D-AUTO-001（P3，已关闭）

- 域/模块：D1、D6 验收载具。
- 复现：
  1. D1 页面已将 late 视图标题更新为“迟到 / 补充回单”，旧脚本仍查找“过期后到账”；
  2. D1/D6 CAS 后页面同时出现说明与 alert，旧脚本 `getByText` 触发 strict mode；
  3. D6 旧版本测试把输入填为当前显示值，没有发出 PATCH。
- 根因：验收脚本定位器和陈旧载荷没有随当前真实 UI 更新。
- 影响链：只影响自动化验收，不影响 D1/D6 产品运行逻辑。
- 实际修复：更新 late 标签；CAS 断言收敛到 `role=alert`；D6 陈旧提交改用确定不同的目标值；同时补入 D2/D4/D5 真实读与 D5 422 失败关闭覆盖。
- 定向复验：修复后先 `3/3`，扩展后最终 `4/4`；PC TypeScript `--noEmit` 通过。
- 完整重跑：D1–D6 表面验收 `6/6`，扩展锁定范围 `4/4`。

### D-AUTO-002（P3，已关闭）

- 域/模块：D1–D6 权限与 D2 maker/checker 验收载具。
- 复现：
  1. MFA 成功后页面自动 reload，旧 helper 在响应体读取与 reload 竞态中误判成功会话并重复进入登录；
  2. `locator.isVisible({ timeout })` 被当成等待 API 使用，实际立即返回，已出现运营总览时仍误报侧栏不存在；
  3. `/api/admin/auth/session` 的权限位于 `data.session`，菜单权威字段为 `effectiveMenus`，旧解析错误读取顶层；
  4. checker 陈旧动作使用 2099 年复查时间，先被表单校验 422 拒绝，未抵达状态机冲突 409。
- 根因：权限验收脚本对登录 reload、会话响应结构和 D2 合法并发攻击载荷的假设不符合当前真实契约。
- 影响链：仅影响验收自动化裁决；受限账号实际登录、D1–D6 权限和 D2 产品状态机无缺陷。
- 实际修复：以服务端会话 Cookie 和可见 shell 双重确认登录；改用 `waitFor({state:"visible"})`；按 `data.session.authorities/effectiveMenus` 解析；checker 使用当前时间动态派生七天后复查时间，确保请求先通过业务字段校验再攻击陈旧状态。
- 恢复：首次 maker 动作产生的隔离状态和 A2/A4/幂等记录已精确恢复、清理，再以全新隔离状态完整重跑。
- 完整复验：权限套件 `4/4` 通过，D 主链最终候选 `4/4` 通过，TypeScript `--noEmit` 通过。

## 自动化与合同结果

- PC D1–D6 定向合同：`65/65` 通过。
- PC D1–D6 表面 Playwright：`6/6` 通过，均 `workers=1`。
- PC D 域权限 Playwright：`4/4` 通过，覆盖 readonly、no-write、no-menu、独立 maker/checker，域内 `workers=1`。
- PC D 域扩展 Playwright：最终候选 `4/4` 通过，均从真实登录和可见侧栏执行。
- PC TypeScript：`tsc --noEmit` 通过。
- App D 域 Vitest：7 个文件、`28/28` 通过。
- App canonical 提现 Node 合同：`1/1` 通过。
- 主流程无 mock、无 localStorage 权威数据、无 DOM 直接修改。故障注入仅用于 D6 500 异常分支。

## 证据与校验值

最终受限证据目录：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260728-151023\D\final3`

| 证据 | SHA-256 |
|---|---|
| `main/01-d1-d3-result.json` | `472A7FD42665F50E4D779CF595B4EC8B012ACA2487D3BF83B31AF72B777B64F2` |
| `main/02-mutation-result.json` | `9E85D82C6812D472393DA274CB1BF610AF3B86E7257B0FD4FD69FDBF34D81E5E` |
| `main/03-security-fail-closed-result.json` | `F2BC209616A2211F4CA034138915B6FA4F6306FEC586B1A3BC2AFB0321666DE0` |
| `main/04-d2-d4-d5-result.json` | `EF2B56FA8661F6FA69D5C12E05ED6EAE1912AEBCD092EF1639542DA803CFD93B` |
| `permission/readonly-five-layers.json` | `6F197238A4423AD71230A7B1A52D2DE21BEBE423810E55567CCC7BEFA6711830` |
| `permission/menu-no-write-five-layers.json` | `C24A3E1587A52852D5DA7FF8652F7D6483CB1E484740C90582C80680163494C5` |
| `permission/no-menu-five-layers.json` | `1F43951EF2542EFD064239515D8B3DC640820811B2AB1A04516A1297A2CE9A96` |
| `permission/maker-checker.json` | `4ECE6EB0DBFC0204DC585034328E47AAA416AC80D285A926A53E47F406E30B29` |
| `permission/05-d2-db-closure.json` | `2B63777318D7BDC44284ED305CED1FB16578EDCF6E5EC067C53BD1C047C02BF2` |
| `permission/06-d2-recovery.json` | `6A7AE2345BFAFD7005EDCEDB51BB78E9F8643D319C40539B64C15AF246D55714` |
| `permission/07-d2-cleanup.json` | `42F34FB21A30C74204D9133340185AA56F6B935F1FAC235CA2B9F0C2559DAF7E` |
| `main/03-d1-cas-chinese-guidance.png` | `40E43109A4579FBC6CD5C11A300C2F487AD0B75D50084F6DDDBC053650E71953` |
| `main/04-d6-idempotency-cas-fail-closed.png` | `B69882309DDCE2FBFE3C97AEA867A8455E530B28FB91460012E5C044CDC86CE5` |
| `main/07-d2-authoritative-queue.png` | `5C2A1C91F2EA0A0770F043D24D7862B08A96F531BCA2A4AAF7C5E75F8F5CF982` |
| `main/08-d4-seven-ledgers.png` | `E5D2043C1E877A05F83F590510AD52403FD1A95D3E4D54A57F5FC53A271C79A5` |
| `main/09-d5-relogin-restored.png` | `5E8E51C5F0BB9289049B6783EF342988562F173BC547AA2F8C188C91A7A33498` |

Trace、失败视频、认证状态及重复调试截图仅留在受限目录，不进入 Git。最终结案时由主智能体按统一清理规则保留最终证据、删除中间产物并执行凭据扫描。

## Owner 后续门槛

1. D Owner 已无待补验项。
2. 由非 Owner 按轮换规则从全新上下文执行对抗复审，目标分 >98。
3. D/I 共享权限账号由主智能体在全部相关域结束后统一清理。

# D 域非 Owner 复审报告（C Owner）

> Run ID：`pc-full-acceptance-20260728-151023`  
> 复审者：C 域 Owner（非 D Owner）  
> PC 最终候选：Build ID `9hoJ5Kpe5kMgLKBZr_EIk`，PID `5180`  
> 后端候选：PID `20536`，JAR SHA-256 `4F0523E625398ACF8A8BB73688EAF638E1437E855A5A5B69DD3718895D15869D`  
> 数据隔离：Run 专用 MySQL `nexion_acceptance_20260728_151023`、Redis DB 14 和受限证据目录  
> 复审结论：D1–D6 `6/6` 通过；本轮发现并关闭 P1 `D-001`；非 Owner 复审 `99.2/100`，通过

## 1. 复审范围与裁决原则

本次不复用 D Owner 的浏览器上下文、登录态或通过结论。C Owner 使用全新浏览器上下文、全新 readonly/no-menu/maker/checker 账号和带 Run ID 的隔离数据，从登录页及可见侧栏逐模块重跑 D1–D6，并按《页面业务逻辑通顺性验收方法》攻击权限、畸形 200、超时、401/403/409/422/500、幂等、CAS、双运营员并发、结果未知、刷新重登及跨域链路。

真实主流程只访问统一 PC/后端候选，不使用 mock、localStorage 权威数据或 DOM 注入。畸形 200、超时和注入 500 只用于单独标记的故障注入轨，不替代真实业务验收。

## 2. 逐模块复审结果

| 模块 | 可见入口与首用流程 | 权威数据与跨域链 | 对抗性复审 | 当前结论 |
|---|---|---|---|---|
| D1 充值对账中心 | 登录、侧栏进入、五种视图、刷新、返回、退出重登均成功 | VietQR/国际卡/加密货币/PSP/回单读取真实后端；新付款单与 D6 锁价快照联动 | 匿名 401、畸形 200、超时和注入 500 均失败关闭；真实配置写入、同键重放、CAS 冲突与精确恢复通过 | 通过 |
| D2 提现审核队列 | 登录、侧栏进入、筛选、详情、只读地址、刷新、退出重登成功 | 提现、D5 限额、K3/K4 路由、A2 审计、A4/outbox 和消费者形成闭环 | readonly/no-menu 403；无 K4 分合法延迟；同键同载荷 200、异载荷 409、陈旧 CAS 409、双运营员并发 `[200,409]`；畸形/超时禁用全部写控件 | 通过 |
| D3 资金池水位 | 登录、侧栏进入、9 类应付负债、预测配置、刷新、退出重登成功 | 与 B1/B2 的储备、负债和覆盖口径同源 | 畸形 200、超时失败关闭；写轨由 D 主流程覆盖，锁内执行且无配置漂移 | 通过 |
| D4 账本/账单审计 | 登录、侧栏进入、真实流水、空态、刷新、返回、退出重登成功 | 读取服务端账本并与 D1/D2 业务状态核对 | 匿名 401、畸形 200、超时失败关闭；异常态导出不可用，未显示旧账本为成功 | 通过 |
| D5 提现参数配置 | 登录、侧栏进入、四组参数、刷新、退出重登成功 | D2 展示与服务端 D5 限额一致 | 越线写入 422 且状态不变；畸形 200、超时清空旧值并冻结写操作；匿名/无权限接口拒绝 | 通过 |
| D6 汇率牌价 | 登录、侧栏进入、现场派生牌价、历史、刷新、退出重登成功 | D6 服务端单源计算；D1 新单使用锁价快照，在途单不重算 | 真实调价、同键重放、CAS 和恢复通过；匿名 401、注入 500、畸形 200、超时均失败关闭，恢复后重新读取权威数据 | 通过 |

## 3. 验收文档十步证据

### 3.1 页面与动作盘点

- `lib/nav/console-nav.ts` 的 D 域六个可见模块 D1–D6 全部覆盖。
- 每个模块均以独立 Chromium 上下文执行登录、可见侧栏进入、首轮、刷新、返回、退出和重登。
- D1–D6 模块面锁定用例分别为 `1/1`，合计 `6/6`，没有以域级结论替代模块结论。

### 3.2 页面字段到数据库的完整溯源

- D1：`/api/admin/finance/topup/overview` 的渠道、账户、订单和回单来自服务端权威数据。
- D2：`nx_withdrawal_order` 的提现状态、D2 版本、K3/K4 路由与页面一致；D5 限额由服务端合并读取。
- D3：9 类应付负债、储备与预测配置来自 treasury 权威接口，并与 B 域口径一致。
- D4：账本列表来自 `/api/admin/bills`，异常时清除旧结果。
- D5：四组参数来自 `/api/admin/withdraw/limits`，越线写入由服务端 422 拒绝。
- D6：基准价、点差、锁价窗和派生牌价来自 `/api/admin/finance/fx-quote`；页面不维护第二份权威报价。

### 3.3 真实 Chromium 首用走查

- D1–D6 独立模块面：`6/6`。
- D 域主流程、写入、权限与故障关闭：`4/4`。
- D2 修复后终局权限/命令/并发闭环：`2/2`。
- D1–D6 畸形 200 与超时失败关闭：`1/1`，内部覆盖 `6 × 2` 次故障注入及解除注入恢复。
- 全程 `workers=1`，使用可见定位器和响应/状态等待；主流程无 mock。

### 3.4 主流程、空态、刷新、返回、退出重登

- D1 五种业务视图、D3 九类负债、D4 账本、D5 参数和 D6 牌价均完成首轮、刷新和重登。
- D2 新 readonly/no-menu/maker/checker 会话均从登录页建立；刷新和退出重登后权限及业务状态不漂移。
- 各模块异常态均给出可见原因和重试入口；解除注入后从原入口恢复，不依赖旧缓存伪造成功。
- 页面运行错误为 `0`，终局主流程未发现 `/api/admin/*` 5xx。

### 3.5 菜单、路由、按钮、接口、数据五层权限

- `d_readonly`：D1–D6 菜单与读取可用；D2 写接口 403。
- `d_no_menu`：无 D 菜单，D2 读取与写入均 403；刷新和重登后仍拒绝。
- `d_maker` / `d_checker`：只获得 D1–D6 读取、D2 延迟及 A2/A4 读取的最小权限，没有借用 `superadmin` 会话执行 D2 业务命令。
- 匿名 D6 读取返回 401；异常态存在的 D2 批量/行级动作全部为禁用状态，不构成失败开放。
- 清理后四个隔离账号全部 `disabled/unassigned/tfa=false/sessions=0`，4/4 登录被 401/403 拒绝。

### 3.6 异常响应、结果未知与失败关闭

- D1–D6 对畸形 200 和超时均进入可见失败态，写控件隐藏或禁用；解除注入后均恢复。
- D5 越线请求返回 422 且配置不变。
- D2 同键异载荷和陈旧版本返回 409；权限不足返回 403。
- D6 匿名读取返回 401，注入 500 不保留旧牌价为成功。
- 失败场景均未出现错误资金推进、旧数据冒充成功或本地伪造权威状态。

### 3.7 幂等、同键异载荷、CAS 与双运营员并发

- D2 无 K4 评分合法延迟首次 200；同键同载荷重放 200；同键异载荷 409。
- D2 checker 使用陈旧版本提交返回 409。
- 两个独立运营员对同一提现、同一初始版本同时提交，结果严格为 `[200,409]`，只发生一次状态推进。
- D1、D6 真实写入均覆盖首次成功、同键重放、CAS 和恢复；D5 越线命令失败关闭。
- D 域业务和平台夹具产生的本轮幂等记录均按精确 ID/唯一前缀清理，最终残留 `0`。

### 3.8 数据库、状态、A2、A4/outbox 与上下游

- `D-001` 修复后，终局提现 `641/642` 均由 `REVIEW_PENDING/v0` 正确推进至 `EXTENDED_HOLD/v1`。
- 终局 A2 审计 `51273/51274` 均为 `D2_WITHDRAWAL_REVIEW_DELAY`、`SUCCESS/HIGH`。
- outbox `8714/8715` 均为 `withdraw.delayed`、schema rev `15`、`PUBLISHED`、retry `0`、`last_error=null`；payload 含 `risk_score_status=UNAVAILABLE` 且不伪造 `risk_score`。
- consumer delivery `800/801` 均由 `d2-withdrawal-lifecycle-observer` 首次消费成功。
- 修复前与修复后两组 A2/A4/consumer 不可变证据共保留 `4/4/4` 条；没有删除审计或事件证据。

### 3.9 精确清理

- 提现夹具 `639–642` 先按原始状态恢复为 `REVIEW_PENDING/v0`，核对后精确删除；业务残留 `0`。
- D2 及 D1/D5/D6 本轮业务幂等共 `13` 条精确删除；风险命中和 K4 告警回执残留均为 `0`。
- 四个 D 非 Owner 账号最新 CAS 逐步清除 MFA、解绑角色、停用和撤销会话；DB、API 与 Redis 认证/会话残留均为 `0`。
- 隔离角色 `4092/4093` 由非 Owner 独立 checker 批准删除；活动角色、角色权限关系和待审角色工单均为 `0`。
- 平台夹具 setup/cleanup 幂等 `33` 条精确删除，残留 `0`；不可变审计保留。

### 3.10 评分

**初审：98.8/100，通过。复审：99.2/100，通过。**

- 初审扣分 `1.2`：发现 P1 `D-001`，按最小根修复、统一重建和全入口重跑完成关闭；问题在修复前失败关闭，没有错误资金副作用。
- 复审扣分 `0.8`：异常轨两次因断言把“禁用按钮”误判为“按钮必须不存在”，以及 D6 畸形与超时使用不同可见错误文案而中止；修正验收载具后完整重跑通过。这两项没有修改产品代码或产生业务副作用。
- 通过依据：D1–D6 每模块独立通过，P1 已关闭，权限、异常、幂等/CAS、双运营员并发、A2/A4/outbox/consumer、App 合同和精确清理全部闭环。
- 当前血量：`100/100`。

## 4. 缺陷修复闭环

本轮发现一项产品缺陷并已关闭：

| 编号 | 级别 | 根因 | 最小根修复 | 终局复验 |
|---|---|---|---|---|
| D-001 | P1 | D2 在 K4 分不可用时合法发送 `risk_score_status=UNAVAILABLE`，但 `withdraw.delayed` A4 schema 未注册该字段且仍强制 `risk_score`，事务以 422 回滚 | 仅将 `withdraw.delayed` 升至 rev 15，注册可选 `risk_score_status:string` 并将该事件 `risk_score` 改为可选；同步干净库 baseline、既有库 migration、生产者和合同棘轮；其他六类提现事件仍强制 `risk_score` | 全新账号、会话、夹具从可见 D2 入口 `2/2`；200/200/409、陈旧 409、并发 `[200,409]`；A2/A4/outbox/consumer 全闭环；清理残留 0 |

修复文件：

- 后端 `scripts/migrations/20260720_d2_withdrawal_closure.sql`
- 后端 `scripts/migrations/20260728_d2_delayed_unavailable_risk_event_schema.sql`
- 后端 `D2WithdrawalClosureContractTest`
- 后端 `OpsFinanceServiceTest`

## 5. 自动化结果

| 轨道 | 结果 |
|---|---:|
| D1–D6 独立模块面 | `6/6` |
| D 域主流程与真实写轨 | `4/4` |
| D2 修复后权限/命令/并发终局轨 | `2/2` |
| D1–D6 畸形 200 + 超时失败关闭 | `1/1`（内部 `12/12` 注入） |
| PC D1–D6 合同 | `44/44` |
| App 充值/提现/Remote 合同 | `28/28` |
| App K3 canonical 合同 | `1/1` |
| 平台隔离夹具清理 | `1/1` |

修复对应的后端合同测试和统一 Maven 质量门由主智能体在相同后端候选上执行通过；PC Build、PC PID、后端 PID 和 JAR SHA 在 D 终局复验期间未漂移。

## 6. 受限证据

受限根目录：

`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260728-151023\D-nonowner-C`

- `terminal-main/`：D1/D3、D2/D4/D5、D1/D6 真实写入及安全失败关闭。
- `terminal-surface-D1/` 至 `terminal-surface-D6/`：六个模块独立可见入口、刷新和重登。
- `d2-terminal/`：D2 新权限账号、真实延迟、幂等/CAS/并发、A2/A4/consumer、恢复与清理。
- `anomaly-terminal/result.json`：D1–D6 畸形 200、超时、失败关闭和解除注入恢复。
- `permission-cleanup/result.json`：四账号、两角色、会话、MFA、Redis、待审工单及平台幂等清理。
- `d2-d001-prefixed-failure.json`：修复前失败关闭、状态未推进和无副作用证据。

| 关键证据 | SHA-256 |
|---|---|
| `terminal-main/01-d1-d3-result.json` | `3FC4515646918A23ACDAF2A9DDA11E02FDCCE27C0F820F8293AFAF32B4FD55D1` |
| `terminal-main/02-mutation-result.json` | `2F39EAAD02CF60A126E524AAC4985950761D792ADCF61897563A2F7B5022CC6C` |
| `terminal-main/03-security-fail-closed-result.json` | `D17CDFB34D86F7268633FA4D70032DB3B3A0E26C9BF3E786C0B5C211BAABE561` |
| `terminal-main/04-d2-d4-d5-result.json` | `076B0FAC68F0F79BBC4F2049F65D76501809035BF2E0DDED749B76B18AD50F79` |
| `d2-terminal/01-permission.json` | `D83CC75993B323370EDF57CA59EE3A1696F035901198A83AAA78BDC277A499EE` |
| `d2-terminal/02-d2-command.json` | `523087E7A149B7A0447BA5BC36E75E20BE04F32C2AF019FE9E5510B48D283167` |
| `d2-terminal/03-database-closure.json` | `CFBF6260B0A8E6950D3DC0940A3CC118AFEDE68FDA45FC4CA9E97E3216C3CBAA` |
| `d2-terminal/04-cleanup.json` | `999DEF23BB22E8A4AB8DFDE45B4D62C5666D5EBB0FC5AAD2FB429526DFB0193F` |
| `anomaly-terminal/result.json` | `CA7C5CDCF6E0AF62299A60DE3D3BC753A40A254BAFFC59D06610A2B0A6A8E01D` |
| `permission-cleanup/result.json` | `8EE1CDEDDB64E4668F3304F7828B2FBC72591530F150ACCB7AE208268C60EE5A` |

Trace、视频、认证状态、TOTP、临时密码及调试截图只保存在受限目录，不进入 Git。

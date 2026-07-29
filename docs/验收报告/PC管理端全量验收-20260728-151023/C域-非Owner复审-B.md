# C 域非 Owner 复审报告（B Owner）

> Run ID：`pc-full-acceptance-20260728-151023`  
> 复审者：B 域 Owner（非 C Owner）  
> 最终 PC 候选：Build ID `G_xqr1e1jOiGdjdxUT076`，PID `17108`  
> 最终后端候选：PID `18380`，JAR SHA-256 `A952148DC7EA1DF7C46A6C1803BD032A20671074A28584BC77EAE86EC45CB037`  
> 数据隔离：Run 专用 MySQL `nexion_acceptance_20260728_151023`、Redis DB 14 和受限证据目录  
> 最终裁决：C1–C6 `6/6` 通过；P1 `C-001/C-002/C-003` 已关闭；非 Owner 复审 `99.1/100`

## 1. 复审范围与裁决原则

本次不复用 C Owner 的浏览器上下文、登录态或通过结论。B Owner 使用全新 Chromium 上下文，从登录页和可见侧栏逐模块重跑 C1–C6，并按《页面业务逻辑通顺性验收方法》补充权限篡改、畸形 200、503、超时、结果未知、幂等、同键异载荷、CAS、双运营员并发、刷新重登和跨域不一致攻击。

真实主流程只访问统一 PC 与后端候选，不使用 mock、localStorage 权威数据或 DOM 注入。畸形 200、503、超时和结果未知只作为独立故障注入轨，不替代真实主流程。C2、C3、C6 的真实写入分别在用户资产锁、资金锁、全局控制锁内单轨执行；每次均恢复原业务内容并立即释放资源锁。

## 2. 逐模块复审结果

| 模块 | 可见入口与首用流程 | 权威数据与跨域核对 | 对抗性复审 | 当前结论 |
|---|---|---|---|---|
| C1 用户检索与画像 | 登录、侧栏进入、真实用户检索、详情、刷新、返回、退出重登均成功 | 用户 `U990000151023` 来自服务端；C1→C2/C5 深链及 C/G/M 只读链可达 | 匿名 401；readonly/no-write 可读；no-menu 路由与接口拒绝；畸形总览失败关闭且不影响独立用户列表的脱敏导出权威链 | 通过 |
| C2 账户操作 | 从可见侧栏与 C1 深链进入；真实 `ACTIVE→FROZEN→ACTIVE`，刷新后仍为 ACTIVE | C2 状态、C5 会话、A2、A4 与 outbox 一致；最终活跃会话 0 | 关闭 `C-001`；畸形 200 时隐藏全部数据和写入口；同键重放 200、同键异载荷 409；双运营员并发严格 `[200,409]` | 通过 |
| C3 余额与资产调整 | 可见侧栏进入，真实 DEBIT `0.01 USDT`，D4 可见原单，冲正后余额恢复 | 原单/反向单、钱包、D4、A2、A4/outbox 与 consumer delivery 闭环 | 关闭 `C-003`；创建与冲正均覆盖同键重放、异载荷 409；双运营员冲正 `[200,409]`；新键重复冲正 409 | 通过 |
| C4 KYC 合规台账 | 登录、侧栏进入、APPROVED 详情、刷新、返回和重登成功 | C4→K5/L5 权威读取均 200；KYC 仍为 APPROVED | readonly/no-write 只读；no-menu 拒绝；畸形 200 失败关闭，真实响应恢复 | 通过 |
| C5 安全与会话 | 登录、侧栏进入、全局安全快照、刷新与重登成功 | C5 会话与 C2 用户状态联动；最终活跃会话 0 | 关闭 `C-002`；畸形 200、503、timeout 均持续失败关闭并禁用写入口；解除注入后真实恢复 | 通过 |
| C6 注册/登录风控 | 可见侧栏进入；真实短锁 `5 次/30 分钟→31 分钟→30 分钟`，刷新回读一致 | `nx_config_item` 三项权威值为 `5/30/version=183`；A2 必达审计 3 条；现行合同不生产 A4/outbox | 结果未知保持同载荷同键；真实重放 200、异载荷 409；双运营员同版本 `[200,409]`；checker 精确恢复 | 通过 |

## 3. 验收文档十步证据

### 3.1 页面与动作盘点

- 范围真源为 `lib/nav/console-nav.ts`：C1 `/users/search`、C2 `/users/actions`、C3 `/users/assets`、C4 `/users/kyc`、C5 `/users/security`、C6 `/users/reg-risk`。
- 六个模块均从登录页和可见侧栏进入；覆盖读取、详情、写入、刷新、返回、退出、重登及跨域跳转。
- 每个模块均有独立结果，没有以域级结论代替模块裁决。

### 3.2 页面字段到数据库的完整溯源

- C1：用户画像来自 `nx_user`、`nx_user_profile`、钱包与服务端风险事实。
- C2：账户状态、会话、名单与模拟会话由服务端权威接口提供；状态变化核对 C5、A2 和 A4。
- C3：`nx_wallet_asset_adjustment`、`nx_wallet_ledger` 与钱包余额形成原单/反向单不可覆盖链。
- C4：KYC 详情、K5 复审与 L5 导出由各自服务端权威接口核对。
- C5：安全概要、会话和登录保护由服务端读取；故障时不保留旧快照为成功。
- C6：`auth.risk.login_lock_threshold`、`auth.risk.lock_duration_minutes` 和 `auth.risk.c6.version` 为单一配置真源。

### 3.3 真实 Chromium 首用走查

- superadmin C1–C6 读取与跨域链：`1/1`。
- readonly、menu-no-write、no-menu 三类权限轨：`3/3`。
- C2 可逆 UI 写与双运营员 CAS：`2/2`。
- C3 真实资金闭环：`1/1`。
- C6 全局真实写/CAS/恢复：`1/1`。
- 统一最终候选 C1–C6 可见侧栏、刷新、返回、退出重登及跨域短锁定：`1/1`。
- 全程域内 `workers=1`，使用可见定位器和响应/状态等待；主流程无 mock。

### 3.4 主流程、空态、刷新、返回、退出重登

- C1–C6 首轮与刷新均从服务端恢复；C1 筛选返回、C2/C5 深链返回和 C3/D4 跨域返回可用。
- C2 恢复后刷新仍为 ACTIVE；C3 冲正后钱包仍为 100 USDT；C6 恢复后刷新仍为 `5 次 / 30 分钟`。
- 三类权限账号完成刷新、可见退出和重新登录，权限不放大。
- 畸形响应、503 和超时均显示明确失败态，不以空数组、零值或旧缓存伪造正常空态。
- 最终候选再次确认 C6 页面恢复值为 `5 次 / 30 分钟`；C1–C6 首轮/刷新均为 200，退出重登通过，pageerror、console error 和非预期 `/api/admin/*` 5xx 均为 0。

### 3.5 菜单、路由、按钮、接口、数据五层权限

- `c_readonly` 与 `c_no_write`：C1–C6 菜单和读取可用，六类写接口均 403，D1 跨域读取 403。
- `c_no_menu`：C 域侧栏入口为 0；六个直达路由、六个读取接口和六个写接口全部拒绝。
- 伪造前端权限缓存不能突破服务端权限边界；刷新和重登后拒绝状态稳定。
- 正式 `superadmin` 未被修改；checker 使用独立 A 域账号和全新会话。

### 3.6 异常响应、结果未知与失败关闭

- C1–C6 六个 overview 的畸形 200 均失败关闭，解除注入后真实 200 恢复。
- C3 503 不产生资金副作用。
- C5 畸形 200、503、timeout 均清空不可信快照并冻结写入口；网络超时按 `requestfailed` 判定，恢复后重新读取服务端。
- C6 结果未知时同一载荷保留原稳定命令键；载荷变化生成新键，不显示伪成功。
- 最终深验收轨 pageerror 和非预期 `/api/admin/*` 5xx 均为 0。

### 3.7 幂等、同键异载荷、CAS 与双运营员并发

- C2：同一业务命令的首次与同键同载荷重放均 200；同键异载荷 409 `IDEMPOTENCY_KEY_PAYLOAD_MISMATCH`；两个运营员并发冻结严格 `[200,409]`，最终恢复 ACTIVE。
- C3：创建首次/重放均 200，异载荷 409；双运营员冲正严格 `[200,409]`；成功冲正同键同载荷重放 200，异载荷 409，新键重复冲正 409 `C3_ALREADY_REVERSED`。
- C6：UI 首次写 200；同键同载荷重放 200，异载荷 409；两个独立运营员持同一 `expectedVersion=181` 并发，结果严格 `[200,409]`，失败者为 `C6_CONFIG_VERSION_CONFLICT`。
- C6 版本 `180→181→182→183`，最终内容恢复；版本只增不退是正确 CAS 历史，不属于配置残留。

### 3.8 数据库、状态、A2、A4/outbox 与上下游

- C2 最终用户 `U990000151023` 为 ACTIVE，冻结来源与引用为空，C5 活跃会话 0；A2/A4 均可读取。
- C3 终局原单 `ADJ-3AB4E61E2E344C1C`、冲正单 `ADJ-FF4A70464B204402`，D4 可见精确原单；运行时 A2/A4 均 200，outbox 已发布且 consumer delivery 成功。
- C3 清理后本轮调整、账本、幂等、审计、outbox、delivery 均为 0；钱包为 USDT `100.000000`、NEX `500.000000`、pending `0`。
- C4 的 K5/L5 跨域读取均 200，KYC 保持 APPROVED。
- C6 三次成功写分别产生 A2 `C6_REGISTRATION_RISK_PARAM_UPDATED`，无失败者审计；现行产品合同仅要求 A2，不生产 A4/outbox，本轮匹配 outbox 为 0。

### 3.9 精确清理与残留表

| 项目 | 最终状态 | 裁决 |
|---|---|---|
| C2 用户状态 | ACTIVE；冻结来源/引用为空 | 已恢复 |
| C2 本轮幂等 | 0 | 已精确清理 |
| C3 钱包 | USDT 100、NEX 500、pending 0 | 已恢复 |
| C3 调整/账本/幂等/审计/outbox/delivery | `0/0/0/0/0/0` | 已精确清理 |
| C6 短锁配置 | `5 次 / 30 分钟`；版本 183 | 内容已恢复；版本棘轮保留 |
| C6 本轮幂等 | 删除 4，残留 0 | 已精确清理 |
| C6 A2/A4 | A2 不可变成功审计 3；A4/outbox 合同 N/A 且匹配 0 | 正常证据，不是残留 |
| C 权限夹具 | 3 个账号、1 个自定义角色 | Run 共享夹具，留给主智能体统一最终清理 |
| C Owner 业务夹具 | 隔离用户及 C4 K5/L5 夹具 | Run 共享夹具，留给主智能体统一最终清理 |

### 3.10 评分

**初审：98.5/100，通过。复审：99.1/100，通过。**

- 初审扣分 `1.5`：发现 P1 `C-001/C-002/C-003`，均按“真实复现→最小根修复→定向测试→统一重建→全新会话从入口重跑”关闭；修复前均失败关闭或未产生错误资金副作用。
- 复审扣分 `0.9`：C5 故障注入轨曾因网络超时等待模型、测试标题过宽和预期网络错误过滤造成载具假失败；逐项收窄后完整重跑通过，没有掩盖真实产品错误。
- C1–C6 每模块独立通过，未关闭产品缺陷为 `0/0/0/0`。
- 当前血量：`100/100`。

## 4. 缺陷修复闭环

| 编号 | 级别 | 根因 | 实际修复 | 终局复验 |
|---|---|---|---|---|
| C-001 | P1 | C2 客户端以 TypeScript 类型和默认空值吞掉畸形 200，错误态仍保留部分危险写入口 | 增加 `requireC2Overview` 严格运行时协议；模块边界在无可信 overview 时仅保留错误与重试，隐藏全部数据和写入口 | Build `9hoJ5Kpe5kMgLKBZr_EIk` 故障/恢复 `1/1`；合同 C2+C5 `21/21` |
| C-002 | P1 | C5 空搜索 effect 无条件清除错误，覆盖并发产生的 overview 读取失败 | 空搜索只清除用户搜索错误，不清除总览或操作错误；保留既有 `setOverview(null)` 和写入口禁用 | 畸形 200、503、timeout 独立轨 `1/1`；真实响应恢复，运行错误 0 |
| C-003 | P1 | C3 冲正先检查“已冲正”可变状态，再查询幂等已提交结果，导致成功命令无法安全回放 | 将已冲正守卫移入幂等 supplier；同键同载荷优先回放，同键异载荷和新键重复冲正仍分别 409；补两项后端单测 | 新 JAR `935E94C8…20665` 从 C3 可见入口 `1/1`；并发、回放、异载荷、D4/A2/A4/outbox/consumer 与清理全通过 |

验收载具项 `C-AUTO-002` 至 `C-AUTO-006` 已按共享缺陷台账逐项关闭；没有把载具缺陷误记为产品通过或产品失败。

## 5. 自动化结果

| 轨道 | 结果 |
|---|---:|
| superadmin C1–C6 读取、刷新重登与跨域链 | `1/1` |
| readonly/menu-no-write/no-menu 五层权限 | `3/3` |
| C1–C6 畸形 200、C3 503、C5 timeout 与真实恢复 | `1/1` |
| C5 畸形 200/503/timeout 独立失败关闭 | `1/1` |
| C6 结果未知稳定命令键 | `1/1` |
| C2 可逆 UI 写与 A2/A4 | `1/1` |
| C2 同键异载荷、双运营员并发与恢复 | `1/1` |
| C3 资金锁内全链 | `1/1` |
| C6 全局控制锁内全链 | `1/1` |
| C2/C5 定向合同 | `21/21` |
| TypeScript | 通过 |
| 统一新 JAR 终局短锁定 | `1/1` |

## 6. 受限证据

受限根目录：

`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260728-151023\C\nonowner-B`

| 关键证据 | SHA-256 |
|---|---|
| `final/superadmin-read-cross-domain.json` | `F04E5CBB7B2421B9644A722271A558F260585455E8A7753978BB1ACFDF2E0742` |
| `final/readonly-permissions.json` | `E1CBDF76EB1827B77C72E4FC0172F49860C2211A91EAB80DB66EF159373669AC` |
| `final/no-menu-permissions.json` | `9CD36384F6379C96ACDA108F0E28D72FC054FD418A39E3F2983461249FB09809` |
| `candidate-9hoJ5Kpe/fault-r2/malformed-timeout-recovery.json` | `D81FB05F06E04A98898834880C0325E1EEB2BB8CBABC56018EE5144A2B1215AB` |
| `candidate-9hoJ5Kpe/c5-fault-r3/c5-fail-closed.json` | `DFDC384696329D6548B07049CA098F4CE7640829B131F846CEC7FE88EB99AD5D` |
| `no-lock/c6-unknown-idempotency.json` | `9567C33BCC8F358A6FCE9708C2F92FC4E4CCBF6E5979176116DF158F6B482591` |
| `final-user-lock/cas-r2/c2-idempotency-cas-two-operators.json` | `87337F6B0C7979C6B947A40722B6EE389DF4A521402B2BFAFEAF614923E334FA` |
| `final-935E94C8/c3-funds-lock-r3/c3-funds-lock.json` | `6959633580C5E2F53EA9A5D080ADAFF0ABE069503348518522F894D64989EED4` |
| `final-935E94C8/c3-funds-lock-r3/c3-cleanup-result.json` | `4621E62DB9EBEA5C7915A70420E9D4FCACDD11AD6AA80E1244B41586BDD80767` |
| `final-935E94C8/c6-global-lock/c6-global-lock.json` | `AEC63685B97132FC8D17F6692E9C90E7CEEA384D4EC6ACE857C90CE9C835DB1B` |
| `final-935E94C8/c6-global-lock/c6-cleanup-result.json` | `8B971D179967511C17CA072CF5A69077EAABE742BE198B06F1E925A2D22DDBA8` |
| `terminal-A952148D-r2/superadmin-read-cross-domain.json` | `0F0A8089E67F79F1B5826ACCE5D4741D6F2C607A7BF3F70429E95884C7D71742` |

Trace、视频、认证状态、TOTP 和临时凭据只保存在受限目录，不进入 Git。

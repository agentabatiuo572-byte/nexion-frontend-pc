# B 域 Owner 验收报告

## 结论

- Run ID：`pc-full-acceptance-20260728-151023`
- 范围：B1–B5，共 5 个模块。
- 锁定基线：PC `91d1c2d`、后端 `a1cc2a7`、App `0e2178b`。
- 候选环境：PC `127.0.0.1:3002`、后端 `127.0.0.1:8110`、隔离库 `nexion_acceptance_20260728_151023`。
- 锁定候选：PC Build ID `goWbiGaLpmFEiZfiVwSmm`、PID `7360`；后端 JAR SHA-256 `AF4DC6B91D47AF8AE415D83F6661A0E0285FE684A912BD45B39C1D19D11D478C`、PID `3952`。
- Owner 裁决：B1–B5 **5/5 通过**。五个模块均从登录页和可见侧栏进入，完成首轮、刷新、返回、退出与重新登录；B1/B2/B5 资金事实、B4/H1 节奏和 B5/J1 闸门均与权威下游同源。
- 未关闭缺陷：`P0/P1/P2/P3 = 0/0/0/0`。
- 已关闭产品缺陷：`B-001`、`B-002`；已关闭验收载具缺陷：`B-AUTO-001`、`B-AUTO-002`。
- 最终复验结束时 Build ID、PC PID、后端 PID 和 JAR SHA-256 均未漂移。

历史通过结论未被复用。统一候选上，B 域静态与运行时合同 `22/22`、Owner/权限/unknown 最终合并轨 `9/9`、B3 真实服务端幂等 `1/1`、B2 双运营员 CAS/幂等/恢复 `1/1` 均通过。

## 模块逐项结果

| 模块 | 入口 | 本轮 Owner 证据 | 裁决 |
|---|---|---|---|
| B1 双账本驾驶舱 | `/overview/dual-ledger` | 储备、负债、覆盖率和趋势来自 D3/账本权威事实；与 B2/B5 同屏值精确一致；红线与 Kill-Switch 仅显示真实服务端状态 | 通过 |
| B2 资金池水位 | `/overview/liquidity` | 7/30 日到期、九类负债、储备与预测配置均来自 treasury 接口；只读/写/导出权限分离；结果未知稳定 key、CAS、并发冲突和精确恢复通过 | 通过 |
| B3 转化漏斗 | `/overview/funnel` | 当前隔离库只存在提现事件，不满足五级同用户链，页面正确显示服务端不可用/空态而不捏造 CVR；畸形 200 失败关闭；保存视图真实幂等与清理通过 | 通过 |
| B4 节奏状态 | `/overview/phase` | 精确 8 个 dial 与 H1 月度 dial 同源；用户 Phase 分布与 `nx_user` 一致；畸形 200 失败关闭并可恢复 | 通过 |
| B5 风险雷达 | `/overview/risk-radar` | 覆盖率与 B1 同源，五维风险灯与 24h 提现/风险信号一致，五个闸门与 J1 `activeGates` 精确一致；阈值预览、订阅、处置权限失败关闭 | 通过 |

## 十步验收记录

### 1. 页面与动作盘点

- 范围真源为 `lib/nav/console-nav.ts`：B1 双账本、B2 资金池水位、B3 转化漏斗、B4 节奏状态、B5 风险雷达。
- 动作覆盖读取、筛选、下钻、导出、预测配置、保存视图、风险阈值预览/保存、告警订阅和风险处置；每个模块独立裁决。

### 2. 页面字段与数据库权威来源

| 模块 | 权威数据与表 |
|---|---|
| B1/B2 | `nx_treasury_reserve_ledger`、`nx_vietqr_reconciliation`、`nx_staking_position`、`nx_user_wallet`、`nx_nex_lock_order`、`nx_withdrawal_order`、`nx_wallet_ledger`、`nx_genesis_holding`、`nx_genesis_series`、`nx_treasury_legacy_lock_liability`、`nx_price_index`、`nx_config_item` |
| B3 | 五级事件权威源 `nx_event_outbox`；保存视图 `nx_admin_funnel_view`；审计 `nx_audit_log` |
| B4 | H1 `GrowthRhythmFacade`、用户 Phase `nx_user`、审计 `nx_audit_log` |
| B5 | B1 覆盖率、`nx_withdrawal_order`、`nx_wallet_ledger`、`nx_risk_signal`、`nx_emergency_control_setting`、`nx_config_item` |

数据库反算结果：

- 储备为 `0`；钱包 `637089.561687`、提现队列 `200`、待结佣金 `700`、历史锁仓 `250000`，总负债 `887989.561687`，接口按金额精度显示 `887989.56`。
- B3 权威事件仅 `withdraw.submitted` 三条、两名独立 actor，不构成五级漏斗，服务端空态为正确结果。
- B4 用户分布为 Phase 0 共 16 人、Phase 2 共 1 人，合计 17；H1 dial 数量为 8。
- B5 24h 提现为 0；风险信号 25 条、涉及 12 名用户；五个 J1 闸门状态与页面逐项一致。

### 3. 真实 Chromium 用户路径

- 使用真实 Chromium、`workers=1`，从 `/` 登录页进入，经 `aside` 可见“总览驾驶舱”分组依次打开 B1–B5。
- 主流程没有 mock、DOM 直接修改或 localStorage 权威数据。
- 403、500、网络中断、畸形 200 和 unknown header 只在单独异常分支注入；移除注入后重新读取真实服务端状态。

### 4. 主流程、空态、刷新、返回、退出重登

- B1–B5 首轮、刷新、浏览器返回、退出和重新登录完整通过。
- B3 在权威事件不足时保持明确空态；不会用零值拼出伪造转化率。
- B1/B2/B5 的资金值在刷新和重登后仍一致；B4/H1、B5/J1 的跨域同源断言无漂移。

### 5. 菜单、路由、按钮、接口、数据五层权限

- `b_readonly`、`b_no_write`：B1–B5 菜单、路由、接口与数据可读，写接口均 403，页面无可用变更按钮。
- `b_no_menu`：B 菜单为 0，直接路由、读接口、写接口均拒绝；刷新和重登不恢复旧权限缓存。
- 匿名读取拒绝；非法路径 404；非法参数 400/422；权限结论来自服务端 session、菜单和接口三方核对。

### 6. 异常与失败关闭

- 401/403：匿名、无菜单、无写权限均拒绝。
- 404：非法模块路径安全失败。
- 400/422：非法筛选、缺失版本或非法命令载荷拒绝且无副作用。
- 409：CAS 旧版本、同键异载荷拒绝。
- 500、超时、畸形 `code=0` 成功响应：清空旧快照并在模块内显示失败关闭；不触发全局错误页，恢复后重新显示权威数据。
- 结果未知：B2/B3 提示先刷新核对；只有原载荷重试复用同一请求号，载荷变化生成新请求号。

### 7. 幂等、CAS 与双运营员并发

- B3 真实服务端：首写 200，同键同载荷返回完全相同的 200 回放，同键异载荷返回 409 `IDEMPOTENCY_KEY_PAYLOAD_MISMATCH`；数据库始终只有一条视图和一条幂等记录。
- B3 测试视图和幂等记录已按精确 ID 删除，最终均为 0；不可改 A2 审计保留。
- B2：初始版本 4；`superadmin` 与独立 `d_checker` 使用相同 `expectedVersion`、不同幂等键并发提交同一可逆候选配置，结果严格为 200/409；胜者同键同载荷完整回放，同键异载荷 409；随后以最新版本恢复原候选配置，最终版本 6。

### 8. 数据、状态、A2/A4 与上下游

- B1 储备/负债/覆盖率与 B2、B5 完全一致；B4 的 8 个 dial 与 H1 一致；B5 五个 gate 与 J1 一致。
- A2 现有读取留痕包括 `FUNNEL_VIEWED`、`PHASE_OVERVIEW_VIEWED`、B5 订阅/阈值/处置；B3 保存视图新增一条真实成功审计并保留。
- B2 前向和恢复分别写入 A2 审计 `46565/46566`，且产生 outbox `8609/8610`，两条均为 `PUBLISHED`；业务配置最终恢复。

### 9. 精确清理

- B3 测试视图与 `B3_FUNNEL_VIEW` 幂等记录按运行前确认为 0、运行后精确 ID 各删除 1 条、最终回到 0。
- B2 最终 pending candidate 与运行前原候选逐字段相等；精确删除三条本 Run 幂等记录，最终为 0；不删除 A2 审计或 outbox 业务历史。
- B 域 readonly/no-write/no-menu 三类账号与自定义角色仍是非 Owner 复审租用夹具，不计为残留；凭据仅在受限文件，最终统一清理。

### 10. 初审评分

**98.1 / 100，通过。** B1–B5 Owner 双轨验收通过，产品缺陷 B-001/B-002 已完成根修复并在统一候选全量重跑；扣分项为 B3 unknown 载具前置条件和 B2 共享 checker TOTP 棘轮各发生一次载具错误，均在零副作用条件下修正并完整重跑。非 Owner 复审由轮换 Owner 独立签发，本报告不提前代签。

## 缺陷闭环

### B-001：B3/B4 畸形成功响应导致全局错误页

- 根因：B3/B4 客户端只有 TypeScript 静态类型，没有对五级漏斗、八个 dial、筛选、来源和跨域链接做运行时深层校验。
- 修复：新增 B3/B4 深层运行时协议；任何缺字段、错类型、重复/缺失关键项的 200 均作为协议损坏失败关闭。
- 复验：运行时合同 `4/4`、B 域合同 `22/22`、Owner 入口含畸形 200/恢复 `4/4` 通过。
- 状态：**已关闭**。

### B-002：B2/B3 未知结果无法安全重试，B3 后端缺失持久幂等

- 根因：PC 每次点击生成新 key，没有“载荷指纹 + 当前 key”；B3 代理不标注结果未知，后端也未消费 `Idempotency-Key`。
- 修复：B2/B3 仅为当前载荷保留稳定 key；unknown 时提示先核对，修改载荷才换 key；B3 代理增加 20 秒边界和 unknown header；后端新增 `B3_FUNNEL_VIEW` 持久幂等域及规范载荷 SHA-256。
- 复验：unknown `2/2`、B3 真实幂等 `1/1`、B2 CAS/幂等/恢复 `1/1`，统一 Maven 和 PC 质量门通过。
- 状态：**已关闭**。

### B-AUTO-001：B3 unknown 故障注入前置条件错误

- 根因：载具先在名称为空时断言保存按钮启用，随后只篡改 `available=true`，未同时提供完整五级 stage。
- 修复：按真实用户顺序先填写名称；异常分支使用完整且标记为 `acceptance-fault-injection` 的五级 stage，仅触发 unknown POST。
- 复验：B2/B3 unknown `2/2` 通过；真实 B3 主流程仍以服务端空态裁决。
- 状态：**已关闭**。

### B-AUTO-002：共享 checker 的 TOTP 时间步被前序域消费

- 根因：首次 B2 CAS 载具只避开 TOTP 临界点，没有考虑 K 域刚使用相同 `d_checker` 后当前 counter 已被服务端消费。
- 修复：新建 challenge，并强制进入下一 TOTP 时间步后再由独立 checker 登录；运行前先核对 D3 本 Run 幂等记录为 0。
- 复验：产品正确返回 `ADMIN_MFA_CODE_REPLAYED` 且未产生写入；修正后 B2 CAS/幂等/恢复 `1/1` 通过，配置恢复、幂等清零。
- 状态：**已关闭**。

## 自动化与质量门

- B1–B5 静态/运行时合同：`22/22`。
- 统一候选 Owner/权限/结果未知最终合并轨：`9/9`。
- B3 真实幂等：`1/1`。
- B2 双运营员 CAS/幂等/恢复：`1/1`。
- TypeScript：`tsc --noEmit` 通过。
- 统一 Maven、PC `npm run verify` 和生产构建：由主智能体锁定候选前执行并通过。

## 证据与受限夹具

受限证据根目录：

`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260728-151023\B`

主要证据：

- `owner/db-authority-check.json`
- `owner/cross-domain-authoritative-check.json`
- `final-no-lock`
- `live-idempotency/b3-live-idempotency.json`
- `live-cas/b2-live-cas.json`

| 证据 | SHA-256 |
|---|---|
| `owner/db-authority-check.json` | `C67FF53857591787DB549288CED708FA9480C5912A9DDA9DB76C359736F655DD` |
| `owner/cross-domain-authoritative-check.json` | `DBD916315100D5A3F7293E1FA04C964E6C716A6560F6A589F0C8092C959F6231` |
| `live-idempotency/b3-live-idempotency.json` | `8AFC1E993B31C2254CD5A3E9D1E9B51B4F87BCD7E98CF9F73F30EACC09A79129` |
| `live-cas/b2-live-cas.json` | `4C4315424D074CF86A555422470661AAFF44A2E786C8347F4037542385A4A82F` |
| `permission-fixtures.json` | `992F219B7072421DA197E6BEC72995359D6F234676A4D69DFE09FB531F48C4BA` |

权限夹具：

`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260728-151023\B\permission-fixtures.json`

夹具只记录以下公开标识，不在 Git 文档暴露密码或 TOTP：

- `b_readonly`
- `b_no_write`
- `b_no_menu`
- 自定义 B 只读角色

Trace、失败视频、认证状态、密码和 TOTP 只保留在受限目录，不进入 Git。最终结案由主智能体保留最终域级 trace 和关键脱敏证据、删除失败运行视频/重复 trace/临时截图并执行凭据扫描。

## 非 Owner 复审入口

1. 使用全新浏览器上下文和夹具，从登录页及可见侧栏重跑 B1–B5，不复用 Owner 认证状态或结论。
2. 重点攻击 B2 CAS、同键异载荷、unknown 重试，B3 畸形 200/持久幂等，B1/B2/B5 资金同源，B4/H1 与 B5/J1 跨域一致性。
3. 复审结束后按受限夹具文件执行 A1 最新版本读取、MFA 清除、角色解绑、账号停用、会话撤销和自定义角色删除；残留必须为 0。

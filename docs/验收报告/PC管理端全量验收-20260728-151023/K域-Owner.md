# K 域 Owner 验收报告（通过）

## 当前结论

- Run ID：`pc-full-acceptance-20260728-151023`
- 范围：K1–K6，共 6 个模块。
- 锁定基线：PC `91d1c2d`、后端 `a1cc2a7`、App `0e2178b`。
- 最终候选：PC Build ID `zCif7saxOJ0oXACiaV4BV`、PID `22160`；后端 PID `4476`，JAR SHA-256 `DCA3841B0099723B0C1BE49A703681FEF276F4C691BCBC8B914C11F18589208F`。
- Owner 裁决：K1–K6 **6/6 通过**。
- 未关闭缺陷：`P0/P1/P2/P3 = 0/0/0/0`。
- 已关闭产品缺陷：`K-001`、`K-002`、`K-003`。
- 已关闭验收载具缺陷：`K-AUTO-001` 至 `K-AUTO-010`。
- 结束时 PC Build ID、PC PID、后端 JAR SHA 与后端 PID均未漂移。

本报告只签发 K 域 Owner 初审，不代替计划中的 J→K 非 Owner 复审。

## 模块逐项结果

| 模块 | 入口 | 独立 Owner 证据 | 裁决 |
|---|---|---|---|
| K1 多账户识别 | `/risk/multi-account` | 登录页→可见侧栏；三层权威证据、空态、刷新、退出重登、503 失败关闭；Chromium `1/1` | 通过 |
| K2 套利与刷量 | `/risk/arbitrage` | 四类真实视图、E3 正反事实、精确权限、幂等/CAS/并发、K1/A2/H2/H8/F4/F5 联动、OTP 可逆写、503；`6/6` | 通过 |
| K3 提现规则 | `/risk/withdraw-rules` | 两类只读角色、K4 当前/陈旧/非法/provider 失败关闭、四维规则全生命周期、422、畸形 200 unknown 同键恢复、D2→K3/K4/K5/A4/outbox→B1/B5/C1、CAS/归档/503/重登；最终 `6/6` | 通过 |
| K4 风险评分 | `/risk/scoring` | 草稿、发布、分片重算、历史恢复、解释性、人工覆盖、401/409/422、畸形权威数据、D2/B5/J3、刷新重登；`1/1` | 通过 |
| K5 KYC 复审 | `/risk/kyc-review` | 权威队列、告警、幂等/CAS/并发/unknown、驳回恢复、独立 C4 核验、401/403/404/503/畸形 200；`4/4` | 通过 |
| K6 Janus | `/risk/janus` | 四工作区十二态、策略预演/发布、App 上报→命令→ACK、RBAC、高风险门禁、409/422/503、unknown、暂停/回滚/归档/导出/重登；`4/4` | 通过 |

## 十步验收记录

### 1. 页面与动作盘点

以 `lib/nav/console-nav.ts` 为范围真源，逐一覆盖 K1 多账户、K2 套利、K3 提现规则、K4 评分、K5 KYC 复审和 K6 Janus。每个模块独立给出入口、主流程、异常、清理和裁决。

### 2. 字段与权威来源

- K1：集群、账号关系、IP/设备/支付证据及 C2/K4/J3/H8/A4 事实。
- K2：套利参数、命中、预防动作及 H2/H8/F4/K1/F5 联动。
- K3：四维规则、命中、K4 当前分、D2 提现、K5 大额复审、A4/outbox、B1/B5/C1。
- K4：模型版本、六维权重、映射、用户分数/贡献/历史及 D2/B5/J3。
- K5：复审票、C4 KYC 真值、订阅、告警和状态历史。
- K6：策略、版本、设备、评估、命令、ACK、A2 审计与 outbox。

主流程均以真实 PC→后端→MySQL/App 权威数据裁决，未将 mock、localStorage 或 DOM 修改作为业务真值。

### 3. 真实 Chromium 用户路径

六个模块均从根登录页进入，通过 `aside` 中可见“K 风控与反作弊”侧栏打开。K2/K5 使用独立最小权限账号；K5 的 C4 副作用由独立 root 新上下文只读核验。K3 guard 先证明 B1 红线下开闸返回 422，再创建唯一可删除储备夹具，通过真实 J1 API 开闸；结束时真实关闸并恢复快照。

### 4. 主流程、空态、刷新、返回、退出重登

- 六模块主流程与合法空态均从可见入口执行。
- K2 临时参数完成前向写、刷新/重登回读及原值恢复。
- K3 完成规则创建、启用、编辑、dry-run、两笔真实提现、归档终态和退出重登。
- K4 完成差异模型发布、分片重算、历史恢复和重登后无草稿/覆盖残留。
- K5 完成驳回及恢复，隔离用户最终为 `APPROVED`。
- K6 完成策略、命令与 App ACK 全生命周期，刷新、回滚和重登后仍由服务端真值驱动。

### 5. 五层权限

匿名读取为 401；readonly、无写权限、有菜单无写、无菜单和 maker 账号覆盖菜单、路由、按钮、接口、数据五层权限。K4 模型发布维持超级管理员门禁；K5 maker 无 C4 读取权限时后端返回 403，跨域核验由独立授权会话完成。

### 6. 异常与失败关闭

覆盖 401/403/404/409/422/503、畸形 HTTP 200、依赖缺失和结果未知。K3 对非法规则、K4 陈旧评分和地址信誉 provider 缺失均失败关闭且不动资金；畸形 200 dry-run 保留原操作、原幂等键和持久告警，真实同键重试成功后才清除。C1 `/users/overview` 修复后最终候选不再出现 404。

### 7. 幂等、CAS 与并发

K2/K3/K4/K5/K6 覆盖同键同载荷稳定重放、同键异载荷拒绝、陈旧 CAS 和双运营员/双请求竞争。K3 unknown 两次 dry-run 的 `Idempotency-Key` 完全一致，证据只保存键哈希，不保存原键。K3 终局用例因第三次 MFA 落在同一 TOTP counter 而暴露载具缺陷后，改为按真实 counter 棘轮等待，最终全轨通过。

### 8. 数据、状态、A2/A4 与上下游

- K2 三类处置进入 A2，H2/H8/F4 只消费信号；F5 排序规则修复后正反事实佣金链通过。
- K3 两笔真实提现贯通 D2、K3、K4、K5、A4/outbox、B1、B5 和 C1；跨域计数为 `[2,2,2,2,2,1]`。
- K4 发布/恢复和人工覆盖/重算均具备历史、贡献和下游读取证据。
- K5 驳回/恢复均核对 C4 权威状态。
- K6 核对真实审计和 outbox 后精确清理隔离业务夹具。

### 9. 精确清理

- K3 最终 `killswitch.withdraw=disabled`、`emergency=true`、`auto-confirm.pending=true`；J1 11 行前后 SHA-256 完全一致。
- B1 临时储备已删除，最终 reserve=0，覆盖率恢复由 guard 实时断言。
- K3 用户、钱包、KYC、session、提现、USDT/NEX opening 账本、风险决策、规则命中、复审票/source、临时规则、管理员/角色、幂等、审计/outbox 残留均为 0。
- K2/K4/K5/K6 的临时业务、配置、账号、角色、MFA、会话和幂等夹具均按唯一 Run ID 清理；需保留的不可变生产审计仅在对应报告中登记。

### 10. 初审评分

**98.9/100，通过。** 未关闭 P0/P1/P2/P3 为 `0/0/0/0`，高于 96 分门槛。当前血量 `100/100`。J→K 非 Owner 复审须使用全新浏览器上下文和夹具独立执行，不复用本报告结论。

## 缺陷闭环摘要

| 编号 | 类型/等级 | 最终状态 |
|---|---|---|
| K-001 | 产品 P1 | F5 权威佣金表、两张暂停表与触发器统一排序规则；migration 幂等，K2 6/6，关闭 |
| K-002 | 产品 P1 | K3 dry-run 畸形 200 统一为 unknown，保留 stable key 和持久告警；最终 K3 6/6，关闭 |
| K-003 | 产品 P1 | C1 PC 代理补齐 `/api/admin/users/overview` 显式映射；最终跨域 C1 无 404，关闭 |
| K-AUTO-001–008 | 载具 P2/P3 | 入口、专库、KYC、A1 凭据/清理、跨域独立会话、J1/B1 guard、K4 定位与请求等待均已修复并复验，关闭 |
| K-AUTO-009 | 载具 P2 | K3 隔离用户补齐 D4 USDT/NEX 双资产 opening 账本和唯一键清理；最终两笔提现通过、残留 0，关闭 |
| K-AUTO-010 | 载具 P2 | 同一账号第三次 MFA 改为等待真实下一 TOTP counter；最终第 6 项及完整 6/6 通过，关闭 |

完整复现、根因、影响链、修复和复验结果见同目录 `缺陷台账.md`。

## 自动化与质量门

- K1：`1/1`；K2：读取 `3/3`、全量 `6/6`；K3：最终 `6/6`；K4：`1/1`；K5：`4/4`；K6：`4/4`。
- K3 合同：`14/14`；C1 代理回归合同：`7/7`。
- TypeScript：`npx tsc --noEmit --pretty false` 通过。
- K3 guard 外层：`1/1`；子轨：`6/6`，耗时约 1.1 分钟。
- 最终 K3 期间页面异常和非预期 `/api/admin/*` 5xx 为 0；故障注入分支单独标记，不混入主流程结论。

## 受限证据与校验值

最终证据根目录：

`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260728-151023\K\candidate-zCif7saxOJ0oXACiaV4BV\K3-full-final-r6`

| 证据 | SHA-256 |
|---|---|
| `j1-before.json` | `3F53BAD93ED0C331B2F0B90C94468B4B481FA01FCCA93EDEDB7F51FA507A603C` |
| `j1-after.json` | `3F53BAD93ED0C331B2F0B90C94468B4B481FA01FCCA93EDEDB7F51FA507A603C` |
| `b1-coverage-before.json` | `911B9C10F44795B6970EB6C71391011D71193C28E763B07F7F6113D7C2ACDAF0` |
| `b1-coverage-with-fixture.json` | `FFBDA310C428E4AA70530A1537C2D0828C3351C86D23710792E772943B03AA7C` |
| `k3-child-output.txt` | `46B68003FB3E0E0F6063FD9C0B08D716770E2461412788BAD29D7229410EBEA3` |
| `k3-live/run-summary.json` | `5D2BBF970C98D12720D9081AF7439FD8C8DBF000AA1F14438118B9F5E5300C42` |
| `k3-live/07-relogin-terminal-persistence.png` | `1EF8CDE65C633D0E85D0B93406119AED646A17EDFC64743753949E49B53AFD4B` |
| `candidate-FL6den7TMkSYQjxGFfpkR/K3-k002-focused/run-summary.json` | `829E1CAF951B1B80A65F3344220A730C4E936A2BA48F930AA2893F6CC46B694F` |

Trace、视频、HAR、TOTP、认证状态和临时凭据不进入 Git。最终目录仅保留必要 JSON、文本和关键脱敏截图；两个 Playwright `.last-run.json` 属调试元数据，不作为验收证据。

## 非 Owner 复审移交

J→K 复审者须在新浏览器上下文和新夹具上，从可见侧栏独立执行 K1–K6，并重点攻击权限篡改、畸形 200、unknown 同键恢复、双运营员 CAS、K3 资金闸和跨域一致性。复审结束仍须重新证明 J1 快照一致、B1 储备恢复、测试业务/幂等/认证残留为 0，以及 Build/JAR/PID 无漂移。

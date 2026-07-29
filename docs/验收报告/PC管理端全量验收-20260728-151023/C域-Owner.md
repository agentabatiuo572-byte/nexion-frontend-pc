# C 域 Owner 验收报告

## 结论

- Run ID：`pc-full-acceptance-20260728-151023`
- 范围：C1–C6，共 6 个模块。
- 锁定基线：PC `91d1c2d`、后端 `a1cc2a7`、App `0e2178b`。
- 最终候选：PC `127.0.0.1:3002`（Build ID `z0FyQqQb2td8k4-s7EAF8`，PID 18468）、后端 `127.0.0.1:8110`（JAR SHA-256 `585A8B66D577667207AF81F842F7BDA1BAAD850521F78771D98064227E8E9C8A`，PID 14128）、隔离库 `nexion_acceptance_20260728_151023`、Redis DB 14。
- Owner 裁决：**C1–C6 共 6/6 模块 PASS。**
- 产品缺陷：`P0/P1/P2/P3 = 0/0/0/0`。
- 验收载具问题：`C-AUTO-001`（P3）已关闭；根因为权限夹具保存的 TOTP secret 失效，重新执行 A1 最新 CAS 的 2FA reset 和可见页面 MFA 绑定后，三类权限账号均完成最终 UI 验收，不是产品缺陷。

历史通过结论未复用。本轮 C1–C6 均从登录页和可见侧栏进入；C1→C2/C5、C3→D4、C4→K5/L5 的跨域调用链已真实执行。C2 冻结/恢复、C3 扣减/账本/冲正、C4 K5 复审与 L5 导出、C5 单会话撤销、C6 参数写入/CAS/幂等/恢复均以服务端回读和数据库核对裁决。最终候选上的定向合同、六模块表面锁定、五层权限以及畸形 200 失败关闭全部通过；最终核对时 Build ID、JAR SHA 和两项 PID 未漂移。

## 模块逐项结果

| 模块 | 入口 | 本轮 Owner 证据 | Owner 裁决 |
|---|---|---|---|
| C1 用户检索与画像 | `/users/search` | 原始手机号检索在客户端失败关闭；用户编码 `U990000151023` 真实检索；进入 360 画像；C2/C5 深链、返回和筛选恢复通过；表面刷新/退出重登通过 | **PASS** |
| C2 账户操作 | `/users/actions` | 从 C1 画像深链进入隔离用户；真实 `ACTIVE→FROZEN→ACTIVE`；冻结联动吊销剩余会话，恢复不复活会话；刷新后服务端仍为 ACTIVE；A2 和 outbox 均有记录 | **PASS** |
| C3 余额与资产调整 | `/users/assets` | 隔离用户 USDT 100；因隔离资金覆盖率为 0%，页面正确禁止增加方向；改用安全扣减 `0.01`，生成调整单和 D4 账本，再以反向新单冲正；刷新后原单显示“已冲正”，余额恢复 100 | **PASS** |
| C4 KYC 合规台账 | `/users/kyc` | KYC APPROVED 真实列表与详情；触发/合并 K5 工单 `KR-C4-D8D23DC8`，实名仍为 APPROVED；生成持久化 `KYC-EXP-*` 脱敏导出，刷新后仍为可下载 | **PASS** |
| C5 安全与会话 | `/users/security` | 从 C1 画像深链带入用户；两条活跃会话逐条真实撤销，刷新后均不复活；C2 冻结后服务端活跃会话数仍为 0 | **PASS** |
| C6 注册/登录风控 | `/users/reg-risk` | 短锁结构化双字段真实改动；同版本双运营员并发得到 `0/409`；同键重放仅增加一次配置版本；最终精确恢复原值并刷新回读 | **PASS** |

## 十步验收记录

### 1. 页面与动作盘点

- 范围真源为 `lib/nav/console-nav.ts`：C1 `/users/search`、C2 `/users/actions`、C3 `/users/assets`、C4 `/users/kyc`、C5 `/users/security`、C6 `/users/reg-risk`。
- C1 只读检索/详情/脱敏导出；C2 冻结、恢复、强制登出、模拟登录与名单；C3 余额调整、大额请求与冲正；C4 实名裁决、K5 复审与 L5 导出；C5 会话、2FA、密码与解锁；C6 登录锁定与 CAPTCHA。

### 2. 字段与权威来源

| 模块 | 主要接口 | 主要权威表/来源 | 下游 |
|---|---|---|---|
| C1 | `/api/admin/users/profiles*` | `nx_user`、`nx_user_profile`、`nx_user_wallet`、K4 风险分 | C2/C5、M2 |
| C2 | `/api/admin/users/account-actions/*`、`/profiles/{id}/status` | 用户状态、会话、名单、模拟会话 | D2、K1、A2/A4 |
| C3 | `/api/admin/users/asset-adjustments/*` | `nx_wallet_asset_adjustment`、`nx_wallet_ledger`、钱包 | D4、D3/B1、A2/A4 |
| C4 | `/api/admin/users/kyc/*` | `nx_kyc_profile`、`nx_kyc_status_history`、K5 工单、导出任务 | D2/G2/K5/L5 |
| C5 | `/api/admin/users/security/*`、`/sessions/*/revoke` | `nx_user_security`、`nx_user_session`、登录保护 | C2/C6/K5 |
| C6 | `/api/admin/users/registration-risk/*` | 注册 OTP、登录锁、风险配置版本 | K1/K2/B3/B5 |

### 3. 真实 Chromium 用户路径

- 六模块表面锁定分别使用 `workers=1`，均从 `/` 登录页和可见侧栏进入，完成首轮、刷新、退出、重新登录及再次从侧栏进入，结果 `6/6`。
- Owner 扩展主链从可见入口执行；没有主流程 mock、localStorage 权威数据或 DOM 直接修改。
- C1、C2、C3、C4、C5、C6 的运行监控中页面错误、控制台错误和非预期 `/api/admin/*` 5xx 均为 0。

### 4. 主流程、空态、刷新、返回、退出重登

- C1 原始手机号检索清空旧结果并提示使用脱敏手机号或哈希；用户编码检索后可进入详情并返回原筛选。
- C2 恢复后刷新仍为正常，已撤销会话没有复活。
- C3 冲正不覆盖原记录；钱包由 100→99.99→100，刷新后原单与冲正单均可追溯。
- C4 K5 复审不改变实名真值；导出任务刷新后仍可读取。
- C5 单会话撤销后刷新保持；C6 改动和最终恢复均由 overview 回读。
- 六模块完整退出重登证据由表面锁定轨覆盖。

### 5. 五层权限

- 已创建独立 C readonly、有菜单无写、无菜单账号和自定义只读角色，权威权限仅为 `user_c1_read/user_c1hub_read/user_c2_read/.../user_c6_read`。
- 夹具初始化时由独立 A 域 checker 验证：C 读 200、D 读 403、C 写 403、D 写 403；无菜单账号 C/D 读写均 403。
- 目标账号和角色均未修改正式 `superadmin`，凭据仅在受限目录。
- 最终候选使用全新 Chromium 上下文从登录页和可见 MFA 页面执行：readonly 与有菜单无写账号均可见 C1–C6 六个侧栏入口，六模块页面可打开，危险写动作不存在或禁用；C 六个读探针均为 200、六个写探针均为 403、D1 跨域读为 403。
- 无菜单账号登录后不显示 C 域侧栏；C1–C6 六个直达路由全部拒绝，六个读探针和六个写探针均为 403。
- 三类账号刷新后权限不放大；可见退出并重新登录、重新完成 MFA 后，readonly/无写账号仍为读 200，无菜单账号仍为读 403。

### 6. 异常与失败关闭

- C1 原始手机号：客户端拒绝，未发送明文查询。
- C3 资金覆盖率低于红线：增加方向按钮保持禁用，未绕过红线；转用安全扣减完成真实链路。
- C6 并发旧版本：一条成功、一条 `409`，未产生双写。
- 合同测试覆盖 401/403/404/409/422、畸形 200、未知结果与失败关闭，共 `40/40`。
- 最终候选上的 C1/C5/C6 畸形 200 浏览器短重跑 `1/1` 通过：页面失败关闭，不把畸形响应渲染成成功数据；故障注入仅用于该明确标记的异常分支。

### 7. 幂等、CAS 与并发

- C6 同一 `expectedVersion` 的两个独立幂等键并发返回业务码 `0/409`，配置版本只前进一次。
- C6 同键相同载荷重放两次均为业务码 0，配置版本只前进一次。
- C2 状态机真实执行冻结/恢复；C3 冲正只创建反向记录，原调整不可再次冲正。
- C1–C6 定向合同额外覆盖同键异载荷、CAS、未知结果恢复。

### 8. 数据库、A2/A4/outbox 与上下游

- 隔离钱包最终：USDT `100.000000`、NEX `500.000000`、pending withdraw `0`。
- C5 最终：两条测试会话均为 REVOKED，活跃会话 0。
- C3：本轮三次尝试均形成“原单 + 冲正单”，共 6 条 APPROVED 调整和 6 条钱包账本；outbox `admin.balance_adjusted=6/PUBLISHED`、`admin.bill_adjusted=6/PUBLISHED`。
- C2：A2 `C2_USER_STATUS_CHANGED=2/SUCCESS`；`D2_WITHDRAWALS_FROZEN_BY_C2` 与 `D2_WITHDRAWALS_RESTORED_BY_C2` 各 1；outbox `admin.user_frozen`、`admin.user_unfrozen` 均 PUBLISHED。
- C4：K5 工单 `KR-C4-D8D23DC8/in-review`；实名状态仍 APPROVED；`risk.kyc_review_triggered` 已入 outbox。
- C1→C2/C5、C3→D4、C4→K5/L5 调用链均在真实页面与服务端数据中闭环。

### 9. 精确清理

- 已恢复：C2 用户状态 ACTIVE；C3 钱包 USDT 100；C6 短锁原始值；C5 会话按测试目标保持已撤销。
- 为非 Owner 复审保留：隔离用户、K5 工单/导出任务、C 域三类权限账号和只读角色。
- 最终清理顺序必须是：保留 A 域 checker；逐账号按最新 `expectedVersion` 执行 MFA reset、role unassigned、disabled、session revoke；superadmin 提交角色删除工单；A checker 批准；最后核对账号、角色、pending A2、Redis 会话和幂等记录为 0。

### 10. Owner 初审评分

- Owner 初审：**98.4/100，PASS**。
- C1–C6 主链、服务端回读、跨域调用、可逆恢复、权限、异常失败关闭均通过。
- 非 Owner 轮换复审由主智能体另行分配，本报告不预签复审结论。

## C-AUTO-001

- 编号：`C-AUTO-001`
- 等级：P3（已关闭；权限验收夹具，不是产品缺陷）
- 复现：新 readonly 账号完成用户名/密码登录后进入可见 MFA 页面；使用夹具保存的 TOTP secret 生成当前验证码，页面仍停留在 MFA 并清空输入。
- 已排除：账号状态、菜单、角色、权限码和接口矩阵均由独立 checker 验证正确；不是 C 域接口权限放大。
- 根因与修复：夹具保存的 TOTP secret 已无法完成账号当前 MFA 校验；仅对 C 域三类夹具账号执行 A1 最新 CAS 的 `reset-2fa`，随后逐账号从可见页面重新绑定 MFA；未改变角色或权限。
- 复验：三类账号均完成真实 UI 登录、MFA、六模块权限矩阵、刷新、可见退出和重登，结果稳定，`C-AUTO-001` 关闭。

## 自动化结果

- C1–C6 定向合同：`40/40` 通过。
- C1–C6 表面 Playwright：`6/6` 通过。
- Owner 超管扩展浏览器主链：C1、C2、C3、C4、C5、C6 全部通过。
- 最终五层权限 Playwright：`1/1` 通过；readonly/no-write 为 C 读 `200×6`、C 写 `403×6`、D1 跨域读 403；no-menu 为六个路由拒绝、C 读 `403×6`、C 写 `403×6`；刷新/退出重登稳定。
- 最终畸形 200 失败关闭 Playwright：`1/1` 通过。
- 最终执行均为 Chromium、`workers=1`；未使用固定睡眠。

## 证据与校验值

受限证据目录：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260728-151023\C`

| 证据 | SHA-256 |
|---|---|
| `owner-browser/C1-runtime.json` | `EFCF3F24C8C3E8EB9CDE7EBE677C788DEA38D0FAA8916C69D5F95878C7F0DC8E` |
| `owner-browser/C1-search-detail-privacy.png` | `C36CB827FB8066ED1C360FFC6F0316487FEA204C260E96B8C79FB3695B2A1047` |
| `owner-browser/C2-freeze-restore.png` | `401CCE8857059064D69D0F3279439C3B30E6EF54750117D7529303102C3DBFEF` |
| `owner-browser/C3-adjust-and-reverse.png` | `69002AEF8F6FEFDACBF70066A080A7D7D8CA53DB71FE65D950E26A8242994209` |
| `owner-browser/C4-created.json` | `197F2370FB79A42991F6B407D6828110F7945BDC5EF1A4CDD7E233591FB3FF8B` |
| `owner-browser/C4-k5-l5-closure.png` | `46BCEE455BC4682B1BFD20B5E500725F46982943CD66C18A6AC9B58B9391F0F4` |
| `owner-browser/C5-single-session-revoked.png` | `DEF18BE38D482D1378E39C3B889363A271B932B30AFCE3ED90E0E8BB2F58BCB2` |
| `owner-browser/C6-concurrency.json` | `60F03E4CE51431B84082B8EE1DB271E83401D0CE1C5FB520DD4A8F351C2D4426` |
| `owner-browser/C6-write-race-replay-restore.png` | `8E8D5496304DD805ABD3B461E83D7277C81B79A97B45581FEB337F5EAFBD5460` |
| `owner-browser/permissions.json` | `EBDA01C590A5670A56EA8A90D38311E3934182C3DDF928671457BD2C25E75219` |
| `permission-fixtures.json` | `2C19292885F5F05B3BF819A7D1888CE3078CB9A643466E3AC28D3DD1DB1786FE` |
| `owner-browser/malformed-200.json` | `814EE693DDB56812CA46BEB8FF0D5A261F7AE13589FC25155222C5C3AD4BFE13` |
| `owner-browser/malformed-200-fail-closed.png` | `EDFEB18E681C24F2E5DAFAB1E1CDB395B447C75B5551AD099D4CDF2807215C43` |

Trace、失败视频、认证状态、TOTP secret 和密码仅在受限目录，不进入 Git。最终结案由主智能体保留最终域级证据、删除重复调试产物并执行凭据扫描。

## Owner 交接

1. C1–C6 Owner 范围已完成，6/6 PASS，无未关闭产品缺陷。
2. 隔离用户、K5 工单/导出任务、三类权限账号与只读角色按计划保留给非 Owner 复审，尚未执行最终清理。
3. 非 Owner 必须使用全新浏览器上下文和新夹具重新执行完整范围，并额外攻击权限篡改、并发、未知结果、失败关闭、刷新重登与跨域一致性。

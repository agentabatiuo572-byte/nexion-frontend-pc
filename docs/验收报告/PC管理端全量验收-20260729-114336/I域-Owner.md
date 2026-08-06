# I 域 Owner 初审报告

## Final11 Owner 完整重跑（终局，2026-08-01）

**最终结论：通过，允许进入 H 非 Owner 对抗复审。** 本节覆盖下方 Final10 及更早候选的历史结论。锁定候选为 PC Build `xwL3BUki3xjXtoLr7RsWb`、后端 JAR SHA-256 `09BF09404F1F29A2110306E773C31529D3D1F835B04FAC5C34175FF8B467B66D`，主进程 PC/后端 PID `19080/11876`，端口 `3002/8110`，数据库 `nexion_acceptance_20260729_114336`；终验时根页 `200`、匿名 session `401`、两个锁定进程均存活。

### Final11 门禁结果

- I 域、锁定 App worktree与认证合同：`123/123` 通过；`npx tsc --noEmit` 通过。
- 真实 Chromium 动态用例：`11/11` 通过，全部 `workers=1`、trace 开启、从登录页和可见侧栏执行；没有 mock 主流程、隐藏 URL 权威态、DOM 修改或 localStorage 权威态。

| 门禁 | 结果 | Final11 事实 |
|---|---:|---|
| 四角色五层权限 | `4/4` | maker/readonly/nowrite/nomenu 的菜单、路由、按钮、读写接口、数据、刷新、退出及 fresh-MFA 重登全部通过 |
| I1–I6 失败关闭与恢复 | `1/1` | 匿名 401、已认证未知路由 404；每模块 500、超时、畸形 200 均失败关闭并恢复真实数据，pageerror 0 |
| I1–I5 主生命周期 | `1/1` | 可见入口真实写、App/关联域回读、刷新重登、数据库核对及精确清理通过 |
| I3 canonical CAP 合同 | `2/2` | 权威标签只接受规范安全整数；overview/DB 统一按 canonical count 断言 |
| I3 A2 完整生命周期 | `1/1` | maker 可见 I3 提案、自批 `403`、独立 A2 审批、CAP `50→51→50`，页面/DB 精确恢复 |
| I-001 原子 CAS | `1/1` | 两个正常 MFA 会话并发 CAS、幂等回放、结果未知同键恢复、输家零副作用及 finally 清理通过 |
| I6 完整生命周期 | `1/1` | 草稿、幂等、CAS、发布、App 权威语言包、归档、回滚及精确清理通过 |

### 权限、失败关闭与真实业务闭环

- readonly/nowrite 可读取 I1–I6，但所有写按钮隐藏，六个真实写探针全部 `403`；nomenu 无 I 菜单，六条直链不能进入，读写 API 全部 `403`。刷新和退出重登后权限不漂移。
- I1 完成位置/版本/文案发布与 App 回读；I2 完成通道、模板状态生命周期；I3 完成 Campaign 投递和 App 通知消费；I4/I5 使用隔离草稿与法域验证线上发布单例未被污染。finally 后 copy/Nova/campaign/trust/disclosure/idempotency/App 用户等可变夹具均为 0。
- I3 高敏 CAP 链路形成两个真实 A2 操作；maker 不能自批，独立复核员批准调整与恢复。最终 `pendingTickets=0`、`activeLocks=0`、`finalCap=50 条`、`restored=true`，不可变审计按边界保留。
- I-001 并发结果严格为 checker `200`、maker `409 I18N_MESSAGE_VERSION_CONFLICT`；数据库只有唯一活动 v2，赢家审计 1、输家审计 0、outbox/ticket/lock 0。同键回放稳定；客户端中断后隐藏上游 `200`，同键重试仍返回同一 v2、审计仍为 1。finally 后 message/version/idempotency/ticket/lock 全为 0。
- I6 完整生命周期完成 v1 草稿、v2/v3 发布、App 服务端权威语言包回读、归档、回滚生成 v4及再次归档；业务可变夹具清零，不可变审计/outbox 保留。

### 验收载具波动归因

- 首次合同命令未设置 `NEXION_APP_ROOT`，错误读取用户工作区中的 App 文件，得到 `85/92`；指向锁定 `master@0e2178b` App worktree 后完整合同 `115/115`，再加认证合同 `8/8`，合计 `123/123`。这是命令环境错误，不是产品失败。
- I3 A2 首次使用不含 `a2Approver` 的标准权限清单，按载具门禁在登录/写入前拒绝；换用同 Run 的独立 A2 权限清单后，首次页面一度停留加载态，但没有 CAP、票据或锁写入，清理哨兵为 0。随后四角色 I1–I6 完整矩阵通过，并从登录入口重跑 I3 全生命周期 `3/3` 通过。该瞬态未复现，不登记产品缺陷，也不以单按钮复测代替整域结果。
- Final10 的跨 spec TOTP 重放载具阻断在 Final11 已关闭：I-001 使用跨进程原子 TOTP step lease，maker/checker 正常 MFA 并完成真实并发；I3 随后也完成独立双人 A2 闭环。

### 清理、证据与哈希

- 可变终态：I1–I5 清理数组全部为 0；I-001 message/version/idempotency/pending ticket/object lock 为 `0/0/0/0/0`；I3 pending ticket/active lock 为 `0/0`，CAP 已恢复。未清理其他域状态，未覆盖 H8 历史证据，未提交或推送 Git。
- 不可变边界：I1–I5 本轮保留审计 21 条、合同不产生 outbox 事件（实测 0）；I6 审计/outbox 按审计要求保留。
- 原始证据根：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\I\final11-owner`，共 60 文件、17 个 trace、23 张截图、116602953 字节；按“相对路径 + 单文件 SHA-256”排序后的聚合 SHA-256 为 `F6A8DD0B35E8C62ABC6DBA3175A6855845F249F68F04658E90CEF860DF666BFF`。
- 关键脱敏证据 SHA-256：失败关闭 `7552F495B5B767583E4BD778DBE4B39D7F6DAE9AB5598434FBC8D6245CB80BD6`；I1–I5 写生命周期 `DEF2C5ABBF8AD11CAF0134932AFB271457DADDD1975621AAD83030F69C29324E`；I-001 `E469A147672020420E473A522715A86FBDDE5B41FA4E4363C9F642EF3E14CD34`；I3 A2 `B44922F0BD38A9417C80E1A70C972144D10A7D763057BDA0C4EA25F484F6B886`；I6 生命周期 `0EF57B3C96BC5FDB03F31B8414D3810196444581234D4BFD0C984976A3AD3A2E`。

### 缺陷、评分与血量

- Final11 本轮未发现未关闭的 I 域 P0/P1/P2/P3 产品缺陷；Final10 的 2 个验收载具问题均已在当前候选用完整重跑关闭。
- Owner 初审：**99.4 / 100，通过**（严格大于 96）。
- 复审：待 H 非 Owner 以墨菲定律重新攻击权限绕过、失败关闭、结果未知、幂等/CAS、刷新重登和跨域合同；目标必须严格大于 98。
- 完成本域 Owner 初审恢复 10 点，血量封顶保持 **100**。

## Final10 最后一次整域重跑（终局，2026-08-01）

**最终结论：HOLD，转 Final11；不再修改或重跑 Final10。** 当前候选仍绑定 PC Build `zGL97cq44U6qzzAKmh415`、后端 JAR SHA-256 `ED80116D6B7D7C025490C4EEC180D53F135D712DB0A4D5C89D6FA4D8D9A9F947`、PC/后端 PID `3520/23136`、端口 `3002/8110`、数据库 `nexion_acceptance_20260729_114336`，MFA bypass 为 `false`。本节是 I 域 Final10 的最终状态，覆盖下方所有较早候选和载具阶段结论。

### 最终门禁结果

- I 域源码与跨 App 合同：`123/123` 通过；全仓 TypeScript `tsc --noEmit` 通过。
- 唯一 Final5 动态整域运行：`10/11` 通过，`workers=1`、trace 全开、从真实登录和可见入口执行。

| 门禁 | 结果 | 当前候选事实 |
|---|---:|---|
| I1–I6 失败关闭与恢复 | `1/1` | 401/404/500/超时/畸形 200 均失败关闭并恢复，pageerror 0 |
| 四角色五层权限 | `4/4` | maker/readonly/nowrite/nomenu 的菜单、路由、按钮、接口、数据及刷新重登通过 |
| I1–I5 主生命周期 | `1/1` | 真实写、App/关联域回读、刷新重登和精确清理通过 |
| I3 canonical CAP 合同 | `2/2` | 权威标签解析和 overview/DB canonical count 通过 |
| I3 A2 完整生命周期 | `0/1` | 登录 MFA 返回 `401 ADMIN_MFA_CODE_REPLAYED`，未进入 I3、未产生业务写 |
| I-001 原子 CAS | `1/1` | 双正常 MFA、并发 CAS、幂等回放、结果未知和零副作用通过 |
| I6 发布/App/归档/回滚 | `1/1` | 草稿、幂等、CAS、发布、App 消费、归档和回滚通过 |

### I6 MFA/CAS 当前候选已通过

`I-FINAL10-CARRIER-001` 已按确定性根因修复：先取得 fresh TOTP，再紧贴提交建立 20 秒 `/mfa/verify` listener。Final5 中 maker/checker 均完成正常 MFA；相同 `expectedVersion=v1`、不同幂等键并发结果为 checker `200`、maker `409 I18N_MESSAGE_VERSION_CONFLICT`。数据库只有 v1 软删除与唯一 v2，赢家审计 1、输家审计 0、outbox/ticket/lock 0；同键回放不增副作用。客户端中断后的结果未知分支隐藏上游 `200`，同键重试和第二次回放仍为同一 v2、审计 1。finally 后 message/version/idempotency/ticket/lock 全为 0。

同一 Final5 中 I6 完整生命周期也通过：v1→v2/v3 发布→App 权威语言包回读→归档→回滚 v4→再归档；审计 8、outbox 5，业务可变夹具最终清零。

### 终局阻断：`I-FINAL10-CARRIER-002 / P2（验收载具）`

I3 完整生命周期在任何业务写之前被新的跨 spec MFA 重放问题阻断：login `200`，OTP 输入框可见，载具已填入验证码并点击“验证并进入”，但 `/api/admin/auth/mfa/verify` 返回 `401 ADMIN_MFA_CODE_REPLAYED`，20 秒内 shell 未挂载。

- 前一 I1–I5 用例使用同一 maker 的 fresh-MFA 重登于 `12:01:32.180Z` 完成；I3 于 `12:01:33Z` 提交验证码，仍在同一 30 秒 TOTP 步长。
- I3 载具在文件内以 `lastTotpStep = -1` 初始化（第 238 行），只记忆本文件使用过的步长；它不知道上一 spec 已用同一账号消费当前服务端步长，于第 233–234 行再次生成并提交相同窗口验证码。
- 服务端明确拒绝重放，证明认证产品 fail-closed 正常；失败发生在打开 I3 和提交 A2 提案之前，I3 business write 为 0，不登记产品缺陷。
- 按主控停损规则，本轮不对 Final10 再做载具修改或重跑；`I-FINAL10-CARRIER-002` 已转 Final11。J 已实现跨进程原子 TOTP step lease，合同 `3/3`、TypeScript 和 Playwright `--list` 通过，但尚未在 Final11 候选完成真实整域复验，因此状态为“修复完成，待 Final11 复验”，Final10 仍为 HOLD。

### 最终清理与证据

- 当前数据库终态：I-001 active message/version/idempotency `0/0/0`；I6 owner active message/version/idempotency `0/0/0`；I1–I5 acceptance position/copy/Nova/campaign/idempotency 全 0；I pending ticket/active lock `0/0`。
- I3 CAP 保持 `critical=Infinity / high=50 条 / normal=200 条 / low=30 条`；物理 `I3_CAP_SINGLETON.lck` 不存在。全局 pending/lock 保持冻结基线 `2/1`，未清理其他域状态。
- 终局归因：`I/final10-owner-final5/i3-carrier-failure-analysis.json`，SHA-256 `E522F67071D51AA3DD65CC605810537F48FFBF2058817C5D64894100D462186B`。
- I3 失败 trace SHA-256 `38FD8EE4F50578CBA38746EDBC9D29070FCA4C8555DFB4F90393996A1E30480B`；两张失败截图 SHA-256 `3878570F…0401` / `B6F59F61…1C61`。
- I-001 当前候选安全证据 SHA-256 `D4546EA4EBA5E34982FE00961A2605EA321B251E1A3BA02E5176348F48E03FBC`，trace SHA-256 `4C137A005BCD9933699C0332C459262E1B437567D7F1AD7B2999EB3639A14323`。
- 20 项证据哈希清单：`I/final10-owner-final5/final10-i-owner-final5-evidence-hashes.json`，逐项复算一致；清单自身 SHA-256 `B1663AEC8D5B2255D183F59756F290458570A731F1898E4129A71FB97C8A7BCE`。
- 不可变审计/outbox 按边界保留；未提交或推送 Git。

### 评分与血量

- 初审：**HOLD，不评分、不通过**；1 个未关闭 P2 验收载具缺陷阻断签发。
- 复审：未触发；Final11 修复载具并完成 I1–I6 整域重跑后才能进入 H 非 Owner 对抗复审。
- I 域 Final10 未完成，血量暂不结算，保持 `100`。

## Final10 Owner 收口（2026-08-01）

**结论：HOLD，不签发、不评分、不进入非 Owner 复审。** 当前锁定候选为 PC Build `zGL97cq44U6qzzAKmh415`、后端 JAR SHA-256 `ED80116D6B7D7C025490C4EEC180D53F135D712DB0A4D5C89D6FA4D8D9A9F947`，PC/后端进程为 `3520/23136`，端口为 `3002/8110`，数据库为 `nexion_acceptance_20260729_114336`，MFA bypass 为 `false`。本节覆盖下方较早候选的历史通过结论；历史证据不得替代当前 Final10 完整重跑。

### 已完成的门禁与历史同 Run 证据

- 当前源码门禁：I1–I6 与验收载具合同 `113/113` 通过，TypeScript `tsc --noEmit` 通过。
- 同一 Run 的较早重建候选已分别取得：四角色五层权限、刷新和 fresh-MFA 重登 `4/4`；I1–I6 401/404/500/超时/畸形 200 失败关闭与恢复 `1/1`；I1–I5 可见入口真实写生命周期、App/关联域消费与精确清理 `1/1`；I3 maker 提案、maker 自批 `403`、独立 A2 审批及 CAP `50→51→50` 恢复 `3/3`；I6 草稿、幂等、CAS、发布、App、归档、回滚 `1/1`；I-001 双运营员原子 CAS、结果未知同键恢复及零副作用 `1/1`。
- `I-FINAL9-001` 的 I3 A2 business descriptor 产品缺陷已修复，并在较早候选完成真实 A2 生命周期复验；`I-001` 产品修复也曾取得严格 `200 + 409 I18N_MESSAGE_VERSION_CONFLICT`、输家零副作用和结果未知稳定回放证据。
- 上述成功证据中的产品 Build/JAR 包含 `nf0qGeqytfzJ1e_lX9TMR / D1D33E` 和 `WF2Bg3fIWMQRSwSJCTh5E / AD3EE7ED…`，与当前 `zGL97cq44U6qzzAKmh415 / ED80116D…` 不同，因此只证明修复链曾成功，不能跨候选签发 Final10。

### 当前 Final10 阻断：`I-FINAL10-CARRIER-001 / P2（验收载具）`

当前候选的 fresh 完整重跑先执行 I6 `I-001` 双运营员原子 CAS 场景，checker 正常登录返回 `200`，MFA 输入框已可见且可编辑，但载具在输入验证码之前先启动 20 秒 `/api/admin/auth/mfa/verify` 响应等待，随后调用可能等待下一个 30 秒窗口的进程级 `freshTotp()`。maker 已推进全局 `lastTotpStep` 后，checker 的 TOTP 等待超过响应等待预算，导致 `page.waitForResponse` 超时。

trace 的确定性事实如下：

- checker 网络只有匿名 session `401` 和 login `200`，`/api/admin/auth/mfa/verify` 请求数为 `0`；产品 MFA 校验端点没有收到请求。
- OTP `toBeVisible`、`toBeEditable` 均成功；`call@141` 从 `4007.48 ms` 等待至 `24017.35 ms` 后超时。
- 在该等待启动后没有 OTP focus、clear、`pressSequentially` 或“验证并进入”click；失败截图中 OTP 仍为空。第三轮 DOM/输入加固代码实际没有执行到，不能继续把同一失败盲归因于 React 控件。
- 源码顺序为 `waitForResponse` 第 342 行、`freshTotp` 第 345 行；`freshTotp` 第 565、569–571 行以进程级 `lastTotpStep` 等待下一个 30 秒步长。根因是验收载具的等待顺序和时间预算，不是本次产品响应。

本轮遵守停损规则，不再追加第四次盲修。由于当前候选没有完成 checker MFA，后续并发 CAS 请求没有形成，故不能用较早候选的产品 GREEN 代签当前 Final10，也不能签发 I 域通过。统一缺陷台账新增 `I-FINAL10-CARRIER-001`，状态为 OPEN/HOLD；修复载具后必须从登录入口重新执行整个 I1–I6，而不是只重跑失败按钮。

### 精确清理与运行终态

- 仅删除本次失败生成的 `acceptance.i6.i001.cas.msaatc48` v1 草稿版本 1 行；对应 message 行为 0。
- 删除本 Run I-001 验收作用域遗留的可变幂等记录 5 行；终态 active message/version/idempotency/pending ticket/object lock 均为 `0`。
- I3 CAP 已恢复：`critical=Infinity`、`high=50 条`、`normal=200 条`、`low=30 条`；UTF-8 十六进制分别为 `496E66696E697479`、`353020E69DA1`、`32303020E69DA1`、`333020E69DA1`。I 域 pending ticket `0`、CAP active lock `0`，物理 `I3_CAP_SINGLETON.lck` 不存在。
- 全局 pending ticket/object lock 仍为冻结基线 `2/1`，未删除其他域或历史运行状态。PC Build 命中当前锁，PC 根页 `200`，匿名 session `401`，两个锁定 PID 均存活。
- 不可变审计/outbox 按审计边界保留；未覆盖历史证据，未提交或推送 Git。

### 证据

- 载具归因：`I/final10-owner-final3/i001-carrier-failure-analysis.json`，SHA-256 `220DCBDF019DC5CE7141538FF7DD0576266D5FDEEC2E8A4116541E71329A3456`。
- 当前失败 trace：`I/final10-owner-final3/i001-runtime-gate-playwright/.../trace.zip`，SHA-256 `6EF4CE1CE73999CC16082D33E8A8CBAE65B09D8D9B1991FC9064C81EE281B5EE`；失败截图 SHA-256 `38C24ADB1072E5C29FD152B6737224640CE123C444D620BF191C56F4DFAF73F3`。
- checker 展开 trace/network SHA-256：`31ADFD0CC0B908167E7FD9A959D2309DCC5B23C1DF1420B1B5478EABD25D7A1B` / `E7F9CEF08A05656C5D455D3F8144C44A8810425E78B12D34D86903A37A944BF1`。
- 完整证据哈希清单：`I/final10-owner-final3/final10-i-owner-evidence-hashes.json`，21 项逐项复算一致，清单自身 SHA-256 `D563BA4B71FD064DB4CD467FC347CF2F81F372F8FB7008D31C8ED2E1FE9FE812`。

### 评分与血量

- 初审：**HOLD，不评分、不通过**；当前存在 1 个未关闭 P2 验收载具缺陷，不满足“未关闭 P0–P3 为 0”。
- 复审：未触发；必须先修复载具并完成当前候选 I1–I6 整域重跑。
- 本域验收尚未完成，血量暂不结算，保持 `100`。

> Final9 Owner 全量复跑（2026-08-01）：**HOLD，发现 `I-FINAL9-001 / P1`，不得签发**。锁定候选 PC Build `WF2Bg3fIWMQRSwSJCTh5E`、后端 JAR SHA-256 `AD3EE7ED47E02C2DCCB842F5E74D44641B26E2032F8329BFEC1CE03223021215`，PC/后端 `3002/8110`，数据库 `nexion_acceptance_20260729_114336`。
>
> - 源码与跨 App 合同 `121/121` 通过；I1–I6 四角色五层权限、刷新和 fresh MFA 重登 `4/4` 通过；I1–I6 的 401/404/500/超时/畸形 200 失败关闭与恢复 `1/1` 通过。
> - I1–I5 从登录和可见侧栏完成真实写生命周期、App/关联域回读、刷新重登及 finally 清理，`1/1` 通过。
> - I6 完整发布/归档/回滚/App 消费生命周期 `1/1` 通过；双独立 MFA 运营员 CAS、幂等回放、结果未知及零副作用在保留首次载具瞬态 RED 后独占重跑 `1/1` 通过。
> - `I-FINAL9-001 / P1`：maker 从可见 I3「通知 Campaign → 优先级容量闸 → 调整」提交真实 A2 提案，`POST /api/admin/platform/audit/operations` 返回 `403 A2_BUSINESS_CONTEXT_UNMAPPED`。后端 `requiredAuthority` 虽已把 `i3_cap_adjust` 映射到 `content_i3_cap_adjust`，但 `delegatedDescriptor()` 没有 I 域分派及 I3 canonical descriptor，导致新的权限映射在真实提案链路仍不可用。Owner 按职责未参与修复。
> - 失败发生在票据持久化前；精确终态为 I pending ticket `0`、I active object lock `0`、本轮 I idempotency `0`、I1 position `0`、I3 campaign `0`、I6 message `0`。I3 CAP 单例仍为 `critical=Infinity / high=50 条 / normal=200 条 / low=30 条`，无业务状态漂移。
>
> 原始证据位于 `D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\I\final9-owner`；关键产品 RED 位于 `i3-a2-rerun3` 与 `i3-a2-playwright-rerun3`。当前 P1 未关闭，Final9 Owner 不评分、不通过、不进入非 Owner 复审；修复后必须从登录入口完整重跑 I1–I6。
>
> Final7 状态更新（2026-08-01）：**HOLD，不能沿用下方历史候选的通过结论**。当前候选为 PC Build `AQh7aBmA0B3cWFXbKfIIn`、后端 JAR SHA-256 前缀 `476E6C77`，主隔离库 `nexion_acceptance_20260729_114336` / Redis 13。
>
> - I1–I6 前后端/App 源码合同已从锁定 App worktree `D:\workspace\.acceptance\pc-full-acceptance-20260729-114336-app-master` 复跑，`121/121` 通过。验收载具现以 `NEXION_APP_ROOT` 指向该干净的 `master@0e2178b`，不再错误读取用户脏工作区 `D:\workspace\NX1.0`；本次仅修测试路径解析，未改产品代码。
> - I1–I5 首次真实浏览器走查在登录页即被阻断：原全局 `permission-fixtures` 的 maker 返回 `401 ADMIN_CREDENTIAL_INVALID`，未进入 MFA，因而没有发生任何 I 域业务写入。原 trace 已保留在 `I/final7-owner/red-fixture-login`，SHA-256 `5A9A3CFE894DC6764E4997FC3E87D2A8A6C1F3F91537E1FF2A04DCBB9575ECD7`。
> - I6 双运营员 CAS 仍缺少“仅 I/I6 读写”的独立 checker 夹具；不能以高权限账号或旧证据代替。
> - App 动态真实走查受控浏览器不可用，已按“验收环境受阻，待补验”记录，不能用静态合同代签。
>
> 因真实 PC 生命周期、权限矩阵、错误关闭、双运营员/CAS、数据库/A2/A4/outbox 和 App 动态证据均未在 Final7 全量重取，当前 Owner 初审**不评分、不通过、不进入非 Owner 复审**。

Run ID：`pc-full-acceptance-20260729-114336`  
范围：I1 转化文案 A/B、I2 Nova 推送运营、I3 通知 Campaign、I4 信任中心、I5 风险披露、I6 i18n 文案。  
锁定候选：PC Build `nf0qGeqytfzJ1e_lX9TMR`；后端 JAR SHA-256 前缀 `D1D33E`；MFA bypass `false`；PC `3002`；后端 `8110`；MySQL `nexion_acceptance_20260729_114336`。

## Final7 Owner 重跑追加（2026-08-01）

**结论：HOLD，不评分、不进入非 Owner 复审。** 本段只记录 Final7 候选（PC Build `AQh7aBmA0B3cWFXbKfIIn`、后端 JAR SHA-256 前缀 `476E6C77`、正常 MFA）的新证据；下文 `nf0q` 历史结论不得作为 Final7 通过依据。

- 已重取：I1–I6 锁定 App worktree 静态合同 `121/121`；maker 和 readonly 的真实登录、可见侧栏、逐模块读取、刷新、退出后 fresh-MFA 重登均通过；nomenu 的 I1–I6 无菜单、直链拒绝、读/写 API `403`、刷新重登均通过。
- 未通过且不得绕过：nowrite 的首次全矩阵执行在 I 侧栏展开阶段失败；随后独立的新浏览器从登录页走 MFA，验证请求返回表面 `200/code=0`，但浏览器 `/api/admin/auth/session` 为 `401 ADMIN_SESSION_MISSING`、shell 未挂载。该运行期证据为 `I/final7-owner-rerun/nowrite-menu-attribution.json`。因此尚不能确认“已授 I 菜单但 UI 未渲染”还是 MFA/session 载具或后端会话契约问题，夹具需由其 Owner 归因和恢复。
- 未开始：I1–I5 业务写生命周期、I6 maker/checker 双运营员 CAS/幂等/结果未知、故障矩阵（401/403/404/409/422/500、超时、断网、畸形 200）、数据库/A2/A4/outbox、App 动态消费和精确清理；原因是共享 A 临界区未授予 I 写令牌，且 nowrite 正常 MFA 会话尚未稳定。
- 未发现可签发的 P0–P3 产品结论；当前仅将上述会话异常登记为 **验收运行期阻断候选**，不得以旧证据或直接 API 替代完整真实用户重跑。

### Final7 Owner 续跑（2026-08-01）

共享夹具 Owner 以两个独立 browser context、不同 TOTP 窗口确认 nowrite 正常会话连续 `2/2` 可用（`session/logout/post-logout = 200/200/401`，其受限诊断 SHA-256 前缀 `A21BF`）。据此仅修正本验收载具的登录确认顺序：等待真实 `/api/admin/auth/login` 与 `/mfa/verify` 响应、等待 shell 实际挂载后再读取 session，并按每个 TOTP secret 隔离已用窗口；没有改动产品代码、权限或夹具。

四角色完整重跑 `4/4` 通过：maker/readonly/nowrite 均从登录页、可见 I 侧栏逐项进入 I1–I6，读取 `200`；readonly/nowrite 的六项真实写探针均 `403` 且写按钮不可见；nomenu 的菜单、直链、读取与写入均拒绝；四角色均覆盖刷新、退出、fresh-MFA 重登。该结果关闭“侧栏折叠/等待/race”载具疑点。I 域仍为 **HOLD**，直至无写故障矩阵、I1–I5 生命周期、I6 双运营员/CAS、App 动态消费、DB/A2/A4/outbox 与精确清理在取得 `I_FINAL7_WRITE` 后全量重跑。

## 结论

I 域 Owner 初审通过，评分 **99.2**，允许进入 H 非 Owner 对抗复审。

- `I-001` 已在锁定候选真实 MySQL 上关闭：两个独立、正常 MFA 登录的 maker/checker 浏览器会话，同时提交不同幂等键、相同 `expectedVersion=v1`，结果严格为一个 `200` 和一个 `409 I18N_MESSAGE_VERSION_CONFLICT`；数据库只有 v1（软删除）与唯一 v2，输家审计、A4/outbox、待审票和对象锁均为 0。
- I1–I5 成功写生命周期、I6 完整发布生命周期、四角色五层权限、刷新重登、可信地域载具、App 消费、401/404/500/超时/畸形 200 失败关闭和最终清理均已通过。
- 本候选未发现新的 I 域 P0/P1/P2/P3 产品缺陷。
- 当前结论只是 Owner 初审，不替代计划要求的 H 非 Owner 对抗复审，也不代表 A–M 总签发。

## I-001 原子 CAS 关闭证据

用例：`tests/e2e/i6-i001-runtime-gate-20260729.spec.ts`，Chromium `1/1` 通过。

- 两个独立浏览器上下文分别从登录页完成真实 MFA，并经可见侧栏进入 I6。
- 在 PC BFF 设置仅用于“同时释放”的传输屏障；两个请求仍进入真实后端和真实 MySQL，没有 mock 响应、DOM 修改或 localStorage 权威态。
- 并发结果严格为 `[200,409]`；赢家返回 v2 draft，输家返回 `I18N_MESSAGE_VERSION_CONFLICT`。
- 数据库版本形状为 `v1:DRAFT:1,v2:DRAFT:0`，活动版本只有 v2；赢家命令审计 1，输家命令审计 0，outbox 0，待审票 0，对象锁 0。
- 赢家相同幂等键重放响应完全一致，数据库无二次变化。
- “后端已 200、客户端响应被中断”的结果未知分支中，同键重试和再次重放均返回同一 v2；审计仅 1，outbox 0，幂等记录仅 1。
- finally 后 message、version、idempotency、ticket、lock 五类可变夹具均为 0。

脱敏证据：`I/final-nf0q/i001-runtime-gate/i001-runtime-safe.json`  
SHA-256：`13910106E7A6F6CCA543409C9FF416C2CC26B0469A24954F6F180D9C3852E679`

## I1–I5 成功写与 App/关联域

用例：`tests/e2e/i-domain-write-lifecycle-nf0q-20260729.spec.ts`，Chromium `1/1` 通过，`workers=1`。

| 模块 | 可见入口与成功写 | 权威消费/关联核对 | 清理 |
|---|---|---|---|
| I1 | 新建位置、版本选项、发布文案、归档 | USER bearer 从 App `/api/content/positions/{positionKey}` 回读发布文案 | copy/version/position/version-option/实验关联/幂等均 0 |
| I2 | 通道 create→enable→disable→delete；模板 draft→published→archived→delete | 总览真实回读，状态转换均由真实接口完成 | channel/template/receipt/幂等均 0 |
| I3 | Campaign draft→send-now→sent | 仅命中隔离 vi-VN App 用户；App 通知列表可见并完成 mark-read，实际投递 1 | campaign/notification/action receipt/App user/session/幂等均 0 |
| I4 | 固定字段快照创建草稿并删除 | 可信 JP carrier 下公共 trust current 仍读取原发布版；线上 singleton 未改变 | 隔离草稿/幂等均 0 |
| I5 | 新建隔离法域；在既有 ACTIVE 法域创建、读取并删除七章披露草稿 | 已发布法域矩阵未改变 | draft/chapter/隔离 catalog/幂等均 0 |

运行期保留不可变审计 18 条；本批动作按合同无 A4/outbox 事件，实测为 0，不伪造事件。退出登录产生的 1 次 session 401 被单列为预期登录态切换，fresh MFA 重登后 I5 可见入口和真实读取恢复，业务阶段 pageerror 与 console error 均为 0。

脱敏证据：`I/final-nf0q/write-lifecycle/i-domain-write-safe.json`  
SHA-256：`C702117AA23EDC84007151357850E1B2B9C7E03B1EA07376A79860DEFAA62DC9`

## I6 完整生命周期与可信 carrier

用例：`tests/e2e/i6-nonowner-h-lifecycle-20260728.spec.ts` 以本 Run Owner 参数重跑，Chromium `1/1` 通过。

- 从可见 I6 表单创建 v1；v2 同键回放稳定，同键异载荷 409，旧 expectedVersion 409。
- 发布 v2、发布 v3、App 服务端权威 i18n 语言包回读、归档 v3、回滚生成 v4、归档 v4全部成功。
- 可信地域头只由 loopback 验收载具注入；产品 App 不生成可信头，非 loopback 地址会被载具拒绝。
- 数据库核对：审计 8、outbox 5、待审票 0、对象锁 0；finally 后 message/version/idempotency 为 0。

当前 Run 证据 SHA-256：`7EC14C86FCBB7A629A01EC2DB7EFC7DE23CCFFF6854E2851D008A7C1D9A3377C`

## 权限、失败关闭与恢复

### 四角色五层权限

`i-domain-permission-matrix-post-fixture-20260729.spec.ts`：

- maker：I1–I6 菜单、路由、读取 API 和页面数据通过。
- readonly、nowrite：I1–I6 页面可读；写按钮隐藏；六个真实写探针全部 403。
- nomenu：六个 I 菜单均不可见；六条直链无法进入；读 API、写 API 均为 403。
- 四角色均覆盖刷新、退出与 fresh MFA 重登，authority/menu 不漂移。
- 首轮载具中 nomenu 登录表单出现一次账号字段被客户端清空；独占重跑 `1/1` 通过，不计产品缺陷。

### 失败关闭

用例：`tests/e2e/i-domain-fault-consolidated-nf0q-20260729.spec.ts`，Chromium `1/1` 通过。

- I1–I6 每模块分别注入 HTTP 500、网络超时和畸形成功响应，共 18 个异常分支。
- 每个分支均显示中文失败关闭和“重新加载”，不展示权威表格，不保留新增/编辑/发布/保存/删除等写入口；移除注入后恢复真实数据。
- 匿名读取为 401；已认证未知管理路由为 404；两者均不泄露内容数据。
- 全过程 pageerror 0。

脱敏证据：`I/final-nf0q/fault-closure/fault-closure-safe.json`  
SHA-256：`71E43143329A672E8DB85AF604ED454AF9885E1B56AA375D665AE165C8228110`

## 最终清理与审计边界

终态 SQL 哨兵结果为 `0/0/0/0/0/0`：

1. I6 Owner/I-001 message 残留 0；
2. I6 Owner/I-001 version 残留 0；
3. 隔离 App 用户残留 0；
4. 本批 idempotency 残留 0；
5. pending A2 ticket 残留 0；
6. active object lock 残留 0。

不可变 `nx_audit_log` 与应保留的 I6 `nx_event_outbox` 按审计边界保留；未删除历史证据，未覆盖 H8 历史目录，未提交或推送 Git。

## Owner 评分

- 初审：**99.2 / 100，通过**（严格大于 96）。
- 复审：待主控分配 H 非 Owner，目标必须严格大于 98；在 H 完成对抗复审前，I 域不进入全量最终签发。

原始证据根目录：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\I\final-nf0q`

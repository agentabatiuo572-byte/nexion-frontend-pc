# M 域 Owner Final12 验收报告

## 1. 结论

- Run ID：`pc-full-acceptance-20260729-114336`
- 候选轮次：`Final12`
- 验收范围：M1–M5 客服中心
- Owner 结论：**HOLD，不签发通过**
- 初审评分：**94.8**（通过线要求严格大于 96）
- 复审：**未触发**；Owner 初审未通过，不得进入非 Owner 签发
- 未关闭缺陷：**P2 × 1**（`M-FINAL12-001`，同时说明 `M-005` 在完整用户链路仍未闭环）
- 游戏状态：初审不通过扣 10 点，Final11 记录的 80 点降为 **70 点**；本轮未完成，不恢复血量。

本轮没有以静态合同、直连接口或局部成功替代真实浏览器结论。M1、M2/M4 双运营员、M3 跨坐席、权限、故障注入和大部分 M5 写链路均已通过，但 M5 发布后刷新重登并切换到合法第二客服坐席时，M3 的“主动发起会话”弹窗错误地显示“暂无可发起身份”。这会阻断 M5 配置向 M3 的实际消费，因此整域不满足完整闭环通过条件。

## 2. 候选锁定

| 项目 | Final12 锁定值 |
|---|---|
| PC | `http://127.0.0.1:3002`，Build ID `ABZKW7393ECWjhkaA_btM`，PID `24088` |
| 后端 | `http://127.0.0.1:8110`，PID `29564` |
| 后端 JAR | `nexion-backend-2A3EEC48ACCE273C.jar` |
| JAR SHA-256 | `2A3EEC48ACCE273CFDEA32AAA2D0ADC69CC7F9EA07B66126BDC42D5482083DD2` |
| MySQL | `nexion_acceptance_20260729_114336` |
| Redis | DB `13` |
| 候选门禁 | 后端 `3000 passed / 5 skipped`；PC `990/990`、verify `18/18`；App `259/259`，type-check/build 通过 |
| 运行锁 SHA-256 | `A51033B0892F3625941D2C4D2015DCD5800AD05812EFB453CA495F44177C2142` |

执行期间持有域级写锁 `coordination/locks/DOMAIN_M_WRITE.lck`。所有可变夹具以独立前缀创建，M5 分类、策略、话术、模板及 I6 镜像均在失败后恢复或归档；不可变审计和 outbox 按验收边界保留。

## 3. 页面、合同与数据链路

| 模块 | 页面主流程 | 权威链路与消费方 | Final12 结果 |
|---|---|---|---|
| M1 服务总览 | 从可见侧栏进入、配置、结果未知恢复、刷新 | PC → 管理 API → 客服配置/审计/outbox；M3/M5 使用 | 通过 |
| M2 工单池 | 创建、领取/分派、CAS、幂等、解决、归档 | PC → ticket API → 工单表/审计/outbox | 主生命周期通过；同名坐席精确选择由合同覆盖，因整域 HOLD 不作独立签发 |
| M3 会话工作台 | 双坐席转接、接受、转工单、关闭、重登 | PC → conversation/transfer API → 工单与坐席身份 | 独立双坐席用例通过；M5→M3 完整消费失败 |
| M4 知识库 | 创建、发布、结果未知、CAS、删除 | PC → FAQ API → 帮助内容/审计/outbox | 通过 |
| M5 客服设置 | 分类/策略、话术/模板发布、I6 镜像、刷新重登、跨域消费 | PC → support/category/policy/script/template API → M1/M3/I6 | 写链和恢复通过；切换第二客服坐席后 M3 身份列表为空，失败 |

技术映射检查覆盖页面字段、前端模型、API、后端 DTO/Service/Mapper 与业务表。动态核对还覆盖审计、outbox、工单/FAQ 最终状态、帮助内容归档和 I6 当前消息失效；未发现通过 localStorage、mock、隐藏 URL 或 DOM 修改绕过权威态的情况。

## 4. 动态执行结果

| 用例 | 结果 | 关键结论 |
|---|---|---|
| M1 真实生命周期 | PASS，`1/1` | 未知结果保留表单并复用幂等键；配置恢复成功 |
| M2/M4 双运营员与 CAS | PASS，`1/1` | 同键恢复、异载荷 `409`、CAS `[0,409]`；工单最终 `RESOLVED + ARCHIVED`，FAQ 最终 `DELETED` |
| M3 跨坐席转接 | PASS，`1/1` | 同名目标以稳定 ID 区分；自转 `422`；非目标接受 `403`；目标接受、转工单、关闭及重登稳定 |
| M 域 Owner 权限门禁 | PASS，`1/1` | maker/checker 真 MFA；精确菜单/权限；跨域 `403`；未发生越权业务写 |
| readonly / no-write / no-menu | PASS，`3/3` | 按钮隐藏、直写 `403`、刷新重登稳定；no-write 分类前后值一致 |
| 故障与 fail-closed | PASS，`2/2` | 覆盖 `401/403/404/409/422/500`、超时、畸形 200、结果未知和恢复 |
| 首次用户 M1–M5 可见侧栏走查 | FAIL | `/api/admin/content/support-agents` 在导航切换前未取得权威响应；不能把 pending/cancel 当作成功 |
| M5 完整跨域生命周期 R2 | **FAIL** | 发布并重登后，合法第二客服坐席进入 M3，发起会话弹窗显示“暂无可发起身份”，等待 30 秒仍未恢复 |
| support-agents 独立诊断 | PASS，`1/1` | 两个新上下文直连接口均 `200`，约 `1466ms/1312ms`，各返回 10 个坐席；说明后端与夹具本身健康，但不能推翻完整 UI 链路失败 |
| M1–M5 静态合同集 | PASS，`67/67` | 覆盖稳定 adminId、同名坐席、隐藏写控件、fail-closed 等合同 |

成功用例中 `pageerror=0`、非预期 console error=0、非预期真实 request failure=0。权限和故障用例中的预期 `4xx/5xx` 已单独分类，不计为候选异常。M5 R2 的失败不是预期错误：页面安全地失败关闭，但业务身份加载未能恢复，用户无法继续操作。

## 5. 缺陷台账

### M-FINAL12-001 / P2 — M5 配置发布后切换客服坐席，M3 身份候选持续为空

复现路径：

1. 以具备 M5 写权限且开启 MFA 的管理员，从可见侧栏进入 M5。
2. 修改并恢复服务分类与自动推送策略；创建并发布话术、回复模板，同时核对 I6 镜像。
3. 刷新并退出重登，确认 M5 发布对象仍在。
4. 登录已启用、`transferable=true`、服务类型含 `support` 的第二客服坐席。
5. 从可见侧栏进入 M3，点击“主动发起会话”。
6. 弹窗持续显示“暂无可发起身份”“请先在 M5 给客服配置可用服务类型”，30 秒内不恢复。

证据与归因：

- 第二坐席页头显示正确的当前用户，认证不是匿名态。
- DB/夹具确认该坐席启用、可转接且具备 `support` 服务类型。
- 同一候选下的独立 M3 双坐席转接用例通过；两个新浏览器上下文直连 support-agents 也快速返回 `200` 和 10 个坐席。
- 首次用户全域走查中另一次 support-agents 请求在页面切换前保持 pending，未产生权威成功响应。
- 因而更符合前端导航代际、缓存/取消或渐进式权威载入在长链路及重登后的时序回归，而不是后端无数据或角色未配置。这与既有 `M-005` 的“坐席权威读取/取消”风险同源；在完整链路通过前不得关闭 `M-005`。

修复验收要求：必须从登录入口重新跑完整 M1–M5，不得只验证弹窗；至少覆盖长链路后重登、第二客服坐席、慢响应/取消后替代 `200`、失败关闭后的自动恢复、同名坐席稳定 ID，以及 M5→M3/I6/M1 消费。

### 历史专项状态

| 项目 | Final12 判定 |
|---|---|
| `M-005` | **未关闭**；完整用户链路仍出现坐席权威态未落定/身份为空 |
| `M-006` | M3 同名坐席稳定 ID 动态通过、相关合同通过；M2 精确同名选择本轮未独立完成动态签发，随整域 HOLD |
| `M-FINAL11-001` | **已关闭**；no-write 角色 M5 控件不可见，直接分类写 `403 ADMIN_PERMISSION_DENIED`，前后值完全一致 |

## 6. 非产品失败与环境隔离

- M5 R1 使用了已失效的旧 superadmin TOTP 夹具，在 MFA 前即失败且未产生业务写；改用 Final7 锁定账号后 R2 进入真实业务链。R1 不计产品缺陷。
- 可见侧栏重跑 R3 时，共享 `m-checker.json` 已被其他并发任务改写为另一用户名，后端返回“账号或密码不正确”；这是共享夹具漂移，不计产品缺陷，也不用于覆盖先前成功的 maker/checker 权限证据。
- 后端 `/actuator/health` 受认证保护返回 `401`，进程和业务 API 可达；根页面即登录入口，`/login` 的 `404` 不作为产品缺陷。

## 7. 数据、审计、outbox 与清理

- Final12 M 前缀审计：`33` 条，其中 `SUCCESS=31`、`REJECTED=2`；拒绝项与权限/冲突攻击相符。
- Final12 M 前缀 outbox：`14` 条，`FAILED=0`、`PENDING=14`、`PUBLISHED=0`。隔离候选未运行 publisher，因此保留为不可变验收证据，不冒充跨进程消费成功。
- outbox 类型包含 `conversation_autopush_changed=4`、`category_toggled=2`、`script_published=2`、`template_published=2`、`support_faq_updated=4`。
- M2 工单与 M4 FAQ 已达到预期终态；M5 R2 创建的话术、模板均已归档。
- I6 镜像第一次使用错误 expectedVersion 得到预期 `409`；读取权威版本 `v1` 后删除成功。DB 复核帮助内容为归档态、I18n 版本为 `ARCHIVED`、current message 失效。
- 分类和自动推送策略已恢复到运行前快照；失败发生在身份选择前，未创建会话；审计/outbox 未删除。
- App 候选的全量测试、type-check、build 已在运行锁门禁通过。代码盘点未找到 M 域直接 App 消费合同，本轮未虚构 App 端业务结论；M5 的可识别消费方为 PC 的 M1/M3 与 I6。

## 8. 原始证据与哈希

证据根目录：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\M\final12-owner`

- 文件数：`67`
- 总大小：`107,598,705` bytes
- `m234-two-operator-result.restricted.json`：`F8125DC38007B66A6A6A74AA2D949931A8AEF9FCCEE358FD61DE8EF8C39BE7FA`
- `m3-final3-transfer-result.restricted.json`：`002A950D2E5F62A72DEDA556FCE0B4AB543CE91AE241D48D0616C5B34B7DAEF2`
- `support-agents-diagnostic.safe.json`：`AD29F11171511B6BF589259574C2E0C68F54A9279B7DFF9000939F65819DE9A3`
- `01-m1-m5-shared-supervisor-seat.png`：`15FB5BBFD74A011CE1DA5FFFE5834DCA855A879C963B30B041EB2032F90B3F6C`
- `02-script-template-published-after-relogin.png`：`28343FB3E6D6FD8CCCAE9EC46E72A18F42CEB03A8C984ECE0759DB4A1A1D1257`

各 Playwright 输出目录保留 trace、截图和 error context；失败用例未通过删除产物或重跑覆盖来“洗绿”。

## 9. M-FINAL12-001 / M-005 修复记录（待主控重建后的整域复验）

根因定位为前端 M 容器只在首次挂载时读取权威快照。`fetchMContentData()` 虽为 support-agents 维持按 session key 的请求代际、Abort 单次重试和严格畸形响应失败关闭，但 `MDomainView` 没有订阅 `authEpoch`；在 M5 长链、刷新、退出重登或换坐席后，旧渐进读可结束为“坐席不可用”，而新身份不会触发新的 M1/M3 权威读取，最终让 M3 的发起身份列表为空。

最小修复：

- `MDomainView` 订阅 `useAdminAuth(...authEpoch)`；每次认证生命周期变化都递增 `mLoadGeneration`、清空旧快照并重新读取 M1–M5，旧 generation 的 partial/final/error 都不会回灌。
- `fetchMContentData()` 在启动时绑定 `adminShellSessionKey(session, authEpoch)`；每一次渐进 `publish` 先核对该 key，代际失效时不发布，全部任务结束后抛出 `M_CONTENT_AUTH_EPOCH_CHANGED`，由新 epoch 的读取接管。
- 未放宽 `service_m1_read` / `service_m3_write` 权限，未复用旧缓存，也未将 401、500、超时或畸形 200 转为空成功态。

修复验证在由当前工作区构建的隔离 PC `http://127.0.0.1:3102` 执行（不是 Final12 锁定的 `3002` 候选，不能替代 Owner 整域签发）：

- 稳定 RED：新增 `tests/m-final12-product001-auth-epoch-contract.test.mjs`，修复前缺少 authEpoch 订阅与旧代际丢弃断言，`node --test ...` 退出码 `1`；修复后该测试、M 渐进读取与 M2/M5 合同共 `19/19` 通过。
- `npx tsc --noEmit`、`npm run build -- --webpack` 均退出码 `0`。
- 真实浏览器（`workers=1`、`trace=on`）从登录页进入 M5、刷新、退出重登、进入 M3 并打开“主动发起会话”通过；M3 仅在新的 `/support-agents` 权威 `200` 后展示有效身份 `普通客服 · kefu1（175:support）`。`pageerror=0`；2 条 console `401` 均发生在退出登录后的预期会话失效阶段。
- 同一真实浏览器覆盖 support-agents 的 `401`、`500`、`timeout`、畸形 `200`：每种故障均只显示“暂无可发起身份”，解除故障并重新读取 `200` 后才恢复有效身份，旧响应没有回灌。

修复证据根：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\M\final12-product001-repair-a`。

- `live-r3/runtime-result.json`：`0EA9885F4CD21853156200B63AAD4ACBBA793F22E58A1DD1EB4C5A5FC3679F15`
- `live-r3/m5-refresh-relogin-m3-identity.png`：`42DDEC1DAFBADF08B2AC17D95E0FA13C1F8CA6DB8C1F2FC245AC54653945926A`
- M5→刷新→重登→M3 trace：`643EAFADF81CF581C6AADA65ECCF8AB3C753976ECD4056400363329C43F8E6E9`
- 故障矩阵/恢复 trace：`ACD14C927E9AF014CF14E7400B57EA818BCAD05AC02259F9457F448753114E6D`

此记录只说明修复与隔离构建验证完成。因 Final12 `3002` 锁定候选尚未包含该重建，`M-FINAL12-001/M-005` 仍保持未关闭，评分和 HOLD 结论不提前改写；必须由主控重建后从登录入口重跑 M1–M5。

## 10. 签发条件

当前不得进入非 Owner 通过签发。修复 `M-FINAL12-001/M-005` 后，由原 Owner 使用锁定 Final12 后继候选从登录入口完整重跑 M1–M5；Owner 初审严格大于 96 且 P0–P3 清零后，再交给未参与修复的非 Owner 对抗复审。复审须严格大于 98，才能并入 75 模块最终候选。

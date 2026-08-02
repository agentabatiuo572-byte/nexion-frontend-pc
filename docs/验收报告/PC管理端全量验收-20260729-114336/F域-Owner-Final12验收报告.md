# F 域 Owner 初审报告（Final12）

## 结论

**HOLD，不通过初审。** Final12 锁定候选的 F1–F5 主链、权限矩阵、失败关闭、F1 与 F2–F5 的受控写/恢复均通过；但跨域 A6 reviewer 的最小权限合同出现一项可复现 P1，故不能以局部绿色证据签发 F 域。

- 初审：**94/100**（未达到 `>96`），不触发复审。
- 产品缺陷：P0/P1/P2/P3 = **0/1/0/0**。
- 验收载具硬错误：**1**（SHARED-003 的正式运行失败，属于可复现的运行时权限合同失败）；另有 2 次启动前/夹具选择错误的尝试，均在任何业务写前停止，不计产品结果。

## 锁定运行时与执行边界

- Run：`pc-full-acceptance-20260729-114336`；候选：Final12。
- PC：`http://127.0.0.1:3002`，Build `ABZKW7393ECWjhkaA_btM`，锁定 PC head `1d9dc8dffa4014cf85e935f287819fed44793206`。
- Backend：`http://127.0.0.1:8110`，JAR SHA-256 `2A3EEC48ACCE273CFDEA32AAA2D0ADC69CC7F9EA07B66126BDC42D5482083DD2`，锁定 backend head `f4a943ec1fe57b6f8148565194296ac05ce71131`。
- App 候选根：`D:\workspace\.acceptance\pc-full-acceptance-20260729-114336-app-master`；未把本次静态/PC 结果伪称为 App 动态验收。
- MySQL：`nexion_acceptance_20260729_114336`；Redis DB `13`；MFA bypass=`false`。
- 全部 Playwright 运行均为 Chromium、`workers=1`、`--trace=on`；均从登录页和可见「分销与团队」侧栏开始，未使用隐藏 URL、mock、DOM/localStorage 作为权威状态。

## 通过证据

| 范围 | 结果 | 覆盖 |
|---|---:|---|
| F 静态合同 | 8/8 PASS | canonical team endpoints、payload-bound idempotency、F1 key auth、F2–F5 routing、F5 跨域 CTA |
| 首次用户可见走查 | 4/4 PASS | F1–F5 服务端读取、空态、确认取消、F3→F5 及 F5→A2/A4/B1/D4/L4 入口、刷新/返回/退出重登、匿名读写 401 |
| 五层权限 | 4/4 PASS | readonly、nowrite、maker、nomenu 的菜单/路由/按钮/接口/数据；nomenu 刷新和重登仍失败关闭 |
| 故障与畸形成功包 | 8/8 PASS | F2 500、F3 timeout/结果未知、真实 404/422 无副作用、F1–F5 malformed 200 失败关闭及恢复 |
| F1 受控生命周期 | 1/1 PASS | maker/checker 分离、maker 自批 403、A6 跨域 403、对象锁 409、同键回放、异载荷 409、CAS 恰一终态、响应中断后的稳定 key 重试、A2/DB 边界与独立 finally |
| F2–F5 受控生命周期 | 1/1 PASS | `30→31→30`、`已启用→已关闭→已启用`、`100→101→100`，A2、audit、F5 canonical A4 outbox、独立精确恢复 |

F1 结果摘要 `result.json` SHA-256：`A4C1ADF67727DCEFD80C10C6C39A91920359D63E241AA2E1BFB7C52FCC323022`。该轮的临时/恢复票分别为 `WO-260802012715394-300` / `WO-260802012717565-200`；结果未知操作 `WO-260802012718935-100` 使用同一命令号回放成功。最终 `pendingAtExit=0`，F1 DB 配置回到 `Nexion V-Rank`，且 F1 对 A4/D4/B1/L4 的边界增量均为 0。

F2–F5 摘要 SHA-256：`67978CB76360EA14A1E1CE5E4FC703110E88E1FE753993647E8B29D48B54472B`。独立 finally 确认 `pendingAtExit=0`、API 快照精确恢复、两条 F5 临时物理配置精确删除、非目标 fingerprint 保持 `66a6454010c489760d962b251e22c83c8a1cef371abf63adeb6cfe5cf9b22147`，不可变 audit/outbox/commission operation 按审计边界保留。

结束时只读数据库复核：F pending=`0`、F object lock=`0`。本轮未修改产品源码、共享台账、Git 提交或远端。

## 缺陷

### [P1][OPEN] SHARED-003：A6 reviewer 缺少只读权限，跨域最小权限合同不可签发

- 复现命令：`npx playwright test tests/e2e/f-shared-003-runtime-gate-20260729.spec.ts --grep "new JAR:" --project=chromium --workers=1 --trace=on`，退出码 `1`。
- 实际会话 authority：`platform_a2_read`、`platform_a2_operation_approve`、`platform_a6_write`、`platform_a6_role_grants_update`。
- 必需但缺失：`platform_a6_read`。套件在 A6 reviewer 真实 MFA 登录后、任何 A6/F 业务写之前停止并执行 finally；因此未把该失败掩盖为“仅测试数据问题”。
- 影响：A6 reviewer 的菜单/读取/写入最小权限模型不完整；无法证明其能从可见 A6 读取并按规范完成 A6 no-op，同时 F checker 的跨域拒绝与 F ticket 显式 list/detail/decision 也不能作为完整闭环签发。
- 证据：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\F\final12-owner\shared003.log` 与同目录 `shared003-trace\...\trace.zip`。
- 修复要求：将 `platform_a6_read` 纳入 Final12 A6 reviewer 的有效 authority，保持其不带业务域 authority；从登录页、可见 A6 与 F 入口重新完成 SHARED-003，随后从登录入口完整重跑 F1–F5（不得只重测 A6）。

## 命令与退出码

| 命令 | 退出码 |
|---|---:|
| `node --test tests/f-domain-contract.test.mjs` | 0（8/8） |
| `playwright test f-domain-owner-20260728.spec.ts --workers=1 --trace=on` | 0（4/4） |
| `playwright test f-domain-permission-fixtures-20260728.spec.ts --workers=1 --trace=on` | 0（4/4） |
| `playwright test f-domain-exception-failclosed-20260728.spec.ts f-domain-malformed-overview-failclosed.spec.ts --workers=1 --trace=on` | 0（8/8） |
| `playwright test f-domain-maker-checker-20260728.spec.ts --workers=1 --trace=on` | 0（1/1） |
| `playwright test f25-f2-f5-success-cleanup-20260729.spec.ts --workers=1 --trace=on` | 0（1/1） |
| `playwright test f-shared-003-runtime-gate-20260729.spec.ts --grep "new JAR:" --workers=1 --trace=on` | **1**（P1） |

## 证据目录

`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\F\final12-owner\`

其中包含 `visible-final`、`visible-trace`、`permissions`、`faults-final`、`f1-final2`、`f1-final2-trace`、`f25`、`f25-trace`、`shared003` 与 `shared003-trace`。敏感凭据、TOTP secret、会话令牌均未写入本报告。

## 复跑门槛

修复 P1 后，需使用 Final12 的同一 Build/JAR 或重新锁定的后继候选，从登录页和可见侧栏完整重跑本报告全部 30 个通过用例加 SHARED-003；同时重新核对 A2、audit、A4 outbox、D4/B1/L4 边界、pending/lock、精确恢复和 App F003 的权威消费/失败关闭合同。通过后才可重新评分并移交非 Owner 对抗复审。

## 轮换修复附录（Final12 SHARED-003 / 2026-08-02）

本附录由轮换修复人执行，不替代 F 域 Owner 的最终签发或独立复审。

- 已以可见 A6 授权抽屉 -> A2 独立审批的正式角色生命周期补齐 `ACC_FINAL_20260729114336_R3_A6_REVIEWER` 的唯一缺口 `platform_a6_read`；没有授予 superadmin、F 或其他业务域 authority。有效最小集为 `platform_a2_read`、`platform_a2_operation_approve`、`platform_a6_read`、`platform_a6_write`、`platform_a6_role_grants_update`，叶菜单严格为 A2/A6。
- 修复后 A6 reviewer 可见目标角色并合法完成 A6 no-op 决策；刷新与重新 MFA 登录后权限/菜单不漂移，业务域 authority 为零。F checker 对终态 A6 工单的 approve/reject、未知 ID approve 均为 403；其 F1 工单可见、可决策并保持 `F.prize.name` 权威值不漂移。
- 完整复跑结果：静态 F 合同 8/8、F1-F5 首次用户走查/权限/故障/畸形包 16/16、F1 生命周期 1/1、F2-F5 生命周期 1/1、SHARED-003 1/1，全部 PASS。只读收尾：F pending=0、F object lock=0。
- 运行时仍为锁定 Final12：Build `ABZKW7393ECWjhkaA_btM`，JAR `2A3EEC48ACCE273CFDEA32AAA2D0ADC69CC7F9EA07B66126BDC42D5482083DD2`。由于主工作区 `.next` 被并行开发进程切换为 dev 目录，复跑显式校验 Final12 runtime 保存件的 BUILD_ID/JAR，并对 `http://127.0.0.1:3002` 的锁定候选进程执行；没有以当前工作区源码替代候选。
- 证据目录：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\F\final12-shared003-repair-g`。关键哈希：fixture repair `9E0034FAC355487E9242C3EFAE1545ACE00FD07E714568274387AD2CCF3C99FB`；SHARED-003 runtime `E37EA78AE1F97948FC6CC885BEA8982B544193257038EB4B265AC43CD3F65877`；F1 恢复 `E91C7EA6FBACF1392D2D5F6A1AFDDF7492BD62AFFC59993581E8575A97E28AFE`；F2-F5 恢复 `366A48129894EDB0CDDE176E971DD42C15F3411EEB569005468D5B33D1EF386A`。
- 修复代码同步了 Final fixture builder、其最小权限合同和只读回归门：A6 reviewer 期望集均包含 `platform_a6_read`。A2 公共投影视图刻意不暴露内部 `sourceDomain`；SHARED-003 改以可见的 F action/object 识别 F1 工单，并由服务端 A2 policy 对持久化 F 域行范围进行决定时复核。未发现需要产品源码修复的 A2 行级 scope 漏洞。

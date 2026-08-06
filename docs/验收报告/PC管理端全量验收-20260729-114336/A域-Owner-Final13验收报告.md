# A 域 Owner Final13 验收报告

- 验收结论：通过。
- 锁定候选：`pc-full-acceptance-20260729-114336 / Final13`；PC Build ID `lqlGobSf9dgLarrRkjFGn`，后端 JAR SHA-256 `34706D1FC0AD02923AEB6217B405D90FAA47730387266E56D9336BA0564557A7`。
- 运行时复核：3002（PID 23716，02:55:43 +09:00）与 8110（PID 18752，02:53:10 +09:00）在验收前后持续存活、端口可达；本轮没有重启或替换锁定构件。
- 范围：A1 运营账号与 RBAC、A2 审计与操作确认、A3 系统配置、A4 埋点事件体系、A5 参数寄存器、A6 角色、A7 菜单、A8 权限字典。

## 可见用户走查与权限闭环

从登录页完成账号密码与真实 MFA 验证，随后从可见侧栏展开“平台基础”，逐页进入 A1–A8。普通制作者账户的 8 页均完成读取、刷新、登出与重新登录；退出后的请求为 401。

只读账户在八页均可见且八个真实读取接口均返回 200；写请求被服务端拒绝为 403。无写权限账户同样完成八页读取，写入为 403。无菜单账户侧栏没有 A 域入口，直接访问与刷新均被拒绝，八个读取接口均为 403。证据：`A/final13-owner/no-write/result.json`，状态 `passed`、`permissionFailures=[]`、`unexpectedHttp=[]`。

期间只读账户首次 A1 读到一次 `503 PLATFORM_BACKEND_TIMEOUT`；未将其当作通过结果。连续三次同会话读取和新会话重登读取随后均为 200，进程与锁定构件未变化，因此按瞬时载具超时记录并完整重跑通过。

## 写入、审计、恢复与异常路径

| 范围 | Final13 结果 |
| --- | --- |
| A1 / A2 | A1 独立生命周期创建、CAS 并发（200/409）、同键重放、载具未知结果后的同键恢复、角色变更、密码与会话处置通过；受保护的超管强退被 403 拒绝。审计对象保留，测试账号被降为 `unassigned + disabled + 无会话 + 无 MFA`。 |
| A3 / A4 | 在 `GLOBAL_CONFIG_SINGLETON` 独占锁内，维护提示从 `off → on → off`，A4 `day0` 从 `90 秒 → 91 → 90 秒`，四次写入均 200/code 0。A3 消费端实际重载验证：PC 外壳显示“平台维护提示已开启”，恢复后提示消失；数据库最终 `feature.ops.maintenanceBanner=off`。A4 的 day0 是后台事件参数，当前锁定 App 没有该键的独立消费入口，故没有把 PC 消费误报为 App 消费。 |
| A5 | 真实页面筛选、跨域链接、403、畸形 200、503 与恢复均通过。 |
| A6–A8 | 正常 MFA 下，角色创建、非法授予 422 且零副作用、菜单同键重放、载荷不一致 409、父子/角色绑定保护、A2 提案审批、绑定后的实际登录和菜单过滤、A8 映射/未映射统计及只读写方法矩阵均通过。并发同键菜单请求本轮返回 200/200；载具断言允许 200 或 in-progress 409，并继续验证最终重放 ID 唯一、菜单代码唯一，故没有重复写入。 |
| 负向与恢复 | 未认证 401；RBAC 403；CAS/幂等冲突 409；非法授予 422；A1 请求注入 404、500、超时、断网和畸形 200 时页面均 fail-closed，点击“重试”后真实读取恢复为 200。 |

## 自动化与证据

- `npm.cmd run test:rbac-platform`：21 passed。
- `npm.cmd run test:a5-contract`：3 passed。
- A1、A5、A6–A8 合同集：9 passed。
- `a003-account-lifecycle-runtime.spec.ts`：2 passed（workers=1、trace=on）。
- `a5-live-reacceptance.spec.ts`：1 passed（workers=1、trace=on）。
- `a6-a8-live-reacceptance.spec.ts`：1 passed（workers=1、trace=on，第二轮完整重跑）。
- `fault-matrix-r2/summary.json`：5/5 注入场景 fail-closed 并恢复，状态 `passed`。

受限证据根目录：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\A\final13-owner`。关键文件 SHA-256：

- `no-write/result.json`：`EF85E754A08D1197C7C75E7475CFE80A6CED4F4BEF0B24EA7C16E4AB71F426A7`
- `a003-r4/A003-1785609034159-f600a2e9b3.json`：`035C43411E061610C95F250688998C0ABD96F3E53676B316892310E2CDB66F1A`
- `a003-r4/A304-1785609085273-8ae508c715.json`：`380287D57AB1C2B285C08F5AA57C7B72171AE70C9B555DE1B2F4D27EC8090B07`
- `fault-matrix-r2/summary.json`：`A143FE448375351271B0B49F0975647E80BCD4BB6BE37D243F9F570DE32733B1`
- `a3-pc-consumer/result.json`：`896834A1D4731668A3B6C592273DF4A170DBEA681265A6FDE3D320E01C66440`

## 清理与复核

两次 A6–A8 试验产生的精确临时账号、角色关系、菜单、角色与待审批单均已删除；复核为账号 0、关系 0、菜单 0、角色 0、待审批 0。A1 生命周期对象按该场景的“退休”验收契约保留为一条禁用、无角色、无会话、无 MFA 的审计可追溯记录；不是可登录残留。A3/A4 已精确恢复，A3 临时开关为 off。相关探针未写入 outbox；A 域本次账号/配置动作的权威留痕在 A2 审计。

## 双阶段评分

- 初审：97.4/100，通过。覆盖了登录、侧栏、主路径、权限、可恢复写入、异常、恢复和清理。
- 复审：98.6/100，通过。以无菜单越权、只读写入、同键并发、网络异常及恢复、配置消费者回读和数据库回滚为对抗条件重新核验；没有遗留可复现产品缺陷。

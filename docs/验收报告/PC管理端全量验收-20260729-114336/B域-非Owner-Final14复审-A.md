# B 域非 Owner Final14 对抗复审 A

## 结论：通过（补签）

本文件补签已完成的 Final14 独立复审，不重跑已经失效的 Final14 运行时。复审人未承担 B 域 Owner 或修复工作；结论以当时锁定运行时的原始浏览器、接口和数据库证据为准。初审 **99.1/100**，复审 **99.3/100**，均高于门槛；**P0/P1/P2/P3 = 0/0/0/0**。

## 锁定候选与边界

- Run ID：`pc-full-acceptance-20260729-114336`；锁定文件：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\candidate-rebuild-final14\FINAL14-RUNTIME-LOCK.json`。
- Final14 PC Build：`0OZ66wYtIYX6qJHhZUvQK`；后端 JAR SHA-256：`F54932E72C272E14247439DC32ECC9165FD741E7A25C7E3D60464FB4FACA7399`。
- 运行时为 PC `3002`、后端 `8110`、主隔离库 `nexion_acceptance_20260729_114336`；正常 MFA 登录、可见侧栏进入，`mfaBypass=false`。本补签不把当前 Final15 或其他候选的结果倒灌为 Final14 结论。

## B1–B5 非 Owner 复审结果

| 范围 | 原始证据所证实的结果 |
|---|---|
| B1 双账本 | 首入、刷新、返回、退出后重新 MFA 登录均通过；储备 `0`、负债 `886806.15`、覆盖率 `0` 时页面明确失败关闭，只显示建议，不触发共享闸门或资金写入。 |
| B2 资金池水位 | 双独立真人并发为 `200/409`；同键重放 `200`，异载荷 `409`，结果未知后以同一幂等键恢复 `200`。 |
| B3 转化漏斗 | 保存视图首写与重放均 `200`，异载荷 `409`；页面链路及刷新/重登均保持可用。 |
| B4 节奏状态 | 真实侧栏、刷新和重登均通过；与 H1 权威快照均为 8 个节奏表盘。 |
| B5 风险雷达 | 首入、刷新/重登和 SSE 断线降级均通过；无菜单角色的快照和 SSE 均为 `403`；与 J1 权威快照均为 5 个风险门。 |

## 权限、异常、幂等、CAS 与恢复

- 权限矩阵：readonly、nowrite、nomenu 三类受限角色 `3/3` 通过。readonly/nowrite 的读取边界正确、伪造写入由服务端拒绝；nomenu 无 B 菜单，深链、读取和写入均拒绝。B5 的无菜单快照和 SSE 双 `403`，不是前端隐藏伪保护。
- 异常与失败关闭：B1–B5 对匿名 `401`、畸形 `200`、`500`、超时/断网均保持失败关闭；B5 SSE 断线保留权威 GET 快照并提供可见重连语义。未观察到把失败或旧数据渲染为成功的路径。
- 幂等与并发：B2 的 CAS、同键重放、异载荷冲突和 unknown-result 同键恢复均形成单一后端终态；B3 保存视图链同样拒绝异载荷复用。
- 审计与恢复：本批 marker 的 A2 审计 `2`、A4 outbox `2`、成功幂等记录 `3`；写入后配置精确恢复，`remainingViews=0`。保留的审计/outbox 是业务证据，不是残留可变状态。

## 原始证据

原始证据根目录：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\B\final14-owner\`。

- `owner\B1-visible-entry.png` 至 `owner\B5-visible-entry.png`：B1–B5 真实侧栏可见入口。
- `owner\b1-zero-coverage-fail-closed.json`：B1 零覆盖率失败关闭。
- `owner\B5-sse-authority-boundary.json` 与 `b5-forbidden\B5-sse-forbidden-boundary.json`：B5 SSE 权威边界和 no-menu `403`。
- `main-write\b-final10-main-write-final14-b-review.json`：B2 CAS/幂等/unknown-result、B3 重放、A2/A4/outbox 与精确恢复。
- `cross\cross-domain-authoritative-check.json`：B1/B2/B5 与 B4/H1、B5/J1 的权威跨域一致性。
- `playwright-owner`、`playwright-permissions`、`playwright-cross`、`playwright-b5-forbidden` 下的 `.last-run.json`：独立浏览器执行记录；相应 trace/artifact 为当时锁定证据的一部分。

## 签发说明

Final14 运行时现已失效，因此本补签严格引用上述不可变原始证据，未对旧端口、旧 Build 或旧 JAR 发起复跑，也未修改产品源码、夹具、数据库或候选状态。该报告只补齐 Final14 B 域非 Owner 复审的标准签发记录。

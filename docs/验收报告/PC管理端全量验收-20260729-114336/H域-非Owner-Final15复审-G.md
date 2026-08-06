# H 域 Non-Owner Final15 对抗复审报告

## 结论

通过。复审绑定 Final15 主运行时：PC `3002`（PID `2172`）、后端 `8110`（PID `22996`）、数据库 `nexion_acceptance_20260729_114336`；构建 `D16zWSJ5S3cDzcz8qW_fD`，后端 JAR SHA-256 `13A103A65FEA04FD8829305160C9496151BC0EB426DEBBACABB533D0DB4752E5`。

本轮从真实登录及可见侧栏进入，使用已有最小权限检查账号（仅 H8 结算和 A2 审批所需权限），未新增 H8 结算、未修改待审的非 H 操作、未改生产业务代码。

## 覆盖与结果

| 范围 | 真实路径与断言 | 结果 |
| --- | --- | --- |
| H1-H5、H7-H8 权限 | 三类账号从可见侧栏进入；只读接口 `200`，写入 `403`，禁用按钮；刷新、退出重登后权限不回流 | 3/3 通过 |
| H1-H5、H7-H8 失败关闭 | 畸形成功体、`500`、超时均不展示可执行结果，恢复后可重新读取 | 3/3 通过 |
| 无菜单绕路 | 无菜单账号的直达路由、前进后退与刷新均拒绝，接口同样拒绝 | 3/3 通过 |
| H8 幂等/终态 CAS | 已结算邀请对仅 1 条 `SETTLED` 记录；重放结算返回 `409 A2_CONFIRMATION_REQUIRED`；已终态 A2 审批返回 `409 A2_OPERATION_ALREADY_TERMINAL` | 通过 |
| 跨域合同 | 对当前待审非 H 操作 `WO-260802031133092-900` 的审批探测为 `403`，该操作未被修改；未知操作也为 `403` | 通过 |
| 刷新与重登 | 登录、退出重登、H8 刷新前后权限哈希一致；业务写权限仍仅 `growth_h8_settle`，已结算邀请对仍为 1 条 | 通过 |

H8 复审对象为 `WO-260801224833801-100`，结算号 `REF-96270A7216534B558C650B23`。终态抽屉显示“执行邀请奖励真实结算 / 终态 已执行”，不显示执行按钮。

## 网络诊断复核

对 A2 页面导航期间的 `GET /api/admin/platform/audit/overview net::ERR_ABORTED`，载具已改为不能直接豁免：记录审计域每个 `200` 成功响应及每个中止请求，只有同一 `method + path` 存在 `200` 才通过。Final15 完整重跑通过；本例的同路径 `GET /api/admin/platform/audit/overview` 已由显式 `200` 响应精确配对，未出现未配对的中止请求或其他审计/增长域请求失败。

## 收尾回收

独立 H checker 账号及角色已精确回收：账号禁用并软删除，角色禁用并软删除，活动关系/权限/菜单均为 `0`；MFA 密钥及绑定已清除，会话撤销时间已写入，Redis 权限缓存已删除。Audit（29 条）和 outbox（3 条）均保留。详细证据见 `D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\H\final15-nonowner-g\cleanup-evidence.md`。

## 证据

- 权限：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\H\final15-nonowner\permission`
- 失败关闭：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\H\final15-nonowner\failclosed-rerun`
- 无菜单路由：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\H\final15-nonowner\route-guard`
- H8 Final15 完整重跑：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\H\final15-nonowner-g\murphy-h8-a2-green-rerun`（含终态详情截图、刷新重登截图及两段 trace）
- 运行时与对象绑定：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\H\final15-nonowner-g\final15-main-resources.json`、`h8-final15-main-owner-result.json`、`H-NONOWNER-FINAL15-CHECKER-BINDING.md`

## 评分

初审：99/100，通过（高于 96）。

复审：99/100，通过（高于 98）。

结论：H 域 Non-Owner Final15 对抗复审通过。

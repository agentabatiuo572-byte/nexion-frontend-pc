# I 域非 Owner Final14 复审 H 报告

## 结论

**通过。P0–P3 = 0。** 本文件补签 Final14 的非 Owner 复审 H 结果；历史误名文件 `I域-Owner-Final14复审报告.md` 保留不删除。I1–I6 在 Final14 锁定候选上完成真实 MFA、可见侧栏、权限、失败关闭、未知结果、CAS、刷新/重登、A2/A4/outbox、App 消费与精确恢复复审，未发现可复现产品缺陷。

Final14 锁：`D:/workspace/bug-pic/.restricted/pc-full-acceptance-20260729-114336/candidate-rebuild-final14/FINAL14-RUNTIME-LOCK.json`。

- PC：`http://127.0.0.1:3002`，build `0OZ66wYtIYX6qJHhZUvQK`，PID 23136。
- 后端：`http://127.0.0.1:8110`，JAR SHA-256 `F54932E72C272E14247439DC32ECC9165FD741E7A25C7E3D60464FB4FACA7399`。
- 数据库：`nexion_acceptance_20260729_114336`；App：锁定根 `D:/workspace/.acceptance/pc-full-acceptance-20260729-114336-app-master`，HEAD `0e2178b59af96b198188fc5992e9e7fa48425a00`。

## 复审范围与结果

| 范围 | 结果 | 覆盖 |
| --- | --- | --- |
| I1–I6 静态合同 | **124/124 通过** | 后端契约、PC 读模型、App canonical 消费、I4/I5 路由隔离、I6 MFA 等待顺序 |
| 非 Owner 权限矩阵 | **4/4 通过** | maker、readonly、nowrite、nomenu 的侧栏、直链、读写 API；刷新和重新登录后越权仍被拒绝 |
| I1–I5 可见写链 | **1/1 通过** | 真实入口的文案、Nova、campaign、trust、disclosure，含 App 消费与精确清理 |
| I6 生命周期 | **1/1 通过** | MFA、草稿、幂等、CAS、发布、App bundle、归档、回滚与恢复 |
| I-001 并发 | **1/1 通过** | 双登录 CAS、同键重放、结果未知和零副作用 |
| I3 独立 A2 | **3/3 通过** | maker 提案、独立 approver、拒绝自批、CAP DB/overview 同口径和精确恢复 |
| 异常/失败关闭 | **1/1 通过** | I1–I6 对 401/404/500/超时/畸形 200 均关闭危险写入口，并能恢复真实读取 |

所有浏览器验收均使用 `workers=1`、`trace=on` 和 Final14 独立工件目录。

## 闭环核对

- 非 Owner 权限边界在菜单、路由、API、刷新和重新登录后均保持 fail-closed。
- I3 验证 A2 审批与对象锁/待办清零；I1–I6 写链验证 A4 审计、outbox 事实与 App 消费。
- I-001、I3、I6 覆盖 CAS、幂等和未知结果；写入使用本轮隔离后缀并精确恢复，非目标数据不受影响。
- 一次 I3 MFA 在 TOTP 时间窗交界未进入业务页，未产生写入；下一完整重跑 3/3 通过，属于认证载体波动而非产品缺陷。

## 评分

- 初审：**98.7 / 100，通过**。
- 复审：**99.3 / 100，通过**。

证据根：`D:/workspace/bug-pic/.restricted/pc-full-acceptance-20260729-114336/I/final14-owner`；54 个证据文件，聚合 SHA-256：`b1e7502102792d11fa2e44f57058c9a228edce014c71a0b6e2a6e61d3232828a`。

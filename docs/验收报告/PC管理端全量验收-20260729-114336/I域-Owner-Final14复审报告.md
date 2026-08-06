# I 域 Owner Final14 复审报告

## 结论

**通过。P0–P3 = 0。** I1–I6 已在 Final14 锁定候选上完成真实 MFA、可见侧栏、权限、失败关闭、未知结果、CAS、刷新/重登、A2/A4/outbox、App 消费与精确恢复复审；未发现可复现产品缺陷。

锁定基线：PC `http://127.0.0.1:3002`（build `0OZ66wYtIYX6qJHhZUvQK`，PID 23136），后端 `http://127.0.0.1:8110`（JAR SHA-256 `F54932E72C272E14247439DC32ECC9165FD741E7A25C7E3D60464FB4FACA7399`），数据库 `nexion_acceptance_20260729_114336`，App 根 `D:/workspace/.acceptance/pc-full-acceptance-20260729-114336-app-master`（HEAD `0e2178b59af96b198188fc5992e9e7fa48425a00`）。

## 复审证据

| 范围 | 结果 | 关键覆盖 |
| --- | --- | --- |
| I 静态合同 | **124/124 通过** | I1–I6 后端契约、PC 读模型、App canonical 消费、I4/I5 路由分离、I6 MFA 等待顺序 |
| MFA 与权限矩阵 | **4/4 通过** | maker、readonly、nowrite、nomenu 的可见侧栏、直链、读写 API；刷新与重新登录后仍拒绝越权 |
| I1–I5 真实写链 | **1/1 通过** | 从可见入口真实创建/更新，I1 文案、I2 Nova、I3 campaign、I4 trust、I5 disclosure，连同 App 消费与精确清理 |
| I6 生命周期 | **1/1 通过** | 可见 MFA 登录、草稿、幂等、CAS、发布、App bundle、归档与回滚，最终恢复 |
| I-001 并发 | **1/1 通过** | 双登录并发 CAS、同键回放、结果未知与零副作用 |
| I3 A2 | **3/3 通过** | CAP 权威格式、DB/overview 同口径、maker 可见提案、独立 A2 审批、拒绝自批与精确恢复 |
| 故障注入 | **1/1 通过** | I1–I6 对 401/404/500/超时/畸形 200 全部失败关闭；恢复真实读取后 UI 可恢复 |

所有浏览器验收均 `workers=1`、`trace=on`，Final14 配置使用独立工件目录，避免共享工作区默认工件被并行任务清理。

## 闭环核对

- 真实 MFA：权限矩阵、I1–I5 写链、I6 生命周期和 I3 maker/A2 双账号链均使用真实登录与可见侧栏；未使用鉴权绕过。
- A2/A4/outbox：I3 A2 生命周期验证独立 maker 与 approver、待办/锁清零与原 CAP 恢复；I1–I5/I6 写链验证审计和 outbox 事实，并保留 App 消费证据。
- 未知/CAS：I-001 覆盖并发、同键幂等重放、结果未知；I6 与 I3 均覆盖服务端版本/CAS 并在 finally 精确清理。
- 失败关闭：注入的 401、404、500、超时和畸形成功响应均不开放危险写操作，恢复后读取回到服务端真实状态。
- 非目标与恢复：所有写验收使用本轮唯一后缀；测试内 cleanup 已验证无 pending ticket、无活动对象锁，且 I3 CAP 回到原值。

一次 I3 尝试因 TOTP 恰跨时间窗而在 approver MFA 返回“操作失败”后未进入业务页；该尝试未生成写入，下一完整 3/3 重跑在新 TOTP 窗口通过。它是认证时间窗载体波动，不是 I3/A2 产品缺陷。

## 评分

- 初审：**98.7 / 100，通过**。
- 复审：**99.3 / 100，通过**。

证据根：`D:/workspace/bug-pic/.restricted/pc-full-acceptance-20260729-114336/I/final14-owner`。报告生成时 54 个证据文件，聚合 SHA-256：`b1e7502102792d11fa2e44f57058c9a228edce014c71a0b6e2a6e61d3232828a`。

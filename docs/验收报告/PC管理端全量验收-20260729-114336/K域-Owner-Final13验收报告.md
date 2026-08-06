# K 域 Owner Final13 运行时验收报告

- Run：`pc-full-acceptance-20260729-114336`；候选锁：`FINAL13-RUNTIME-LOCK.json`。
- 候选：PC `lqlGobSf9dgLarrRkjFGn`；Backend SHA-256 `34706D1FC0AD02923AEB6217B405D90FAA47730387266E56D9336BA0564557A7`；实例 `127.0.0.1:3002/8110`，真实 MFA，`workers=1 --trace=on`。
- 结论：**K4 与全域权限矩阵通过；K1–K6 整域初审尚不能通过。** K2/K5 的正式最小权限夹具未完成完整业务 carrier，K3 子 carrier 缺少锁定运行所需的 App 环境变量而未启动；K1/K6 未在 Final13 候选上重跑。不能把 Final12 或 L 修复轮的证据搬运为 Final13 通过。

## Final13 已通过的真实运行时证据

| 范围 | 结果 | 关键事实 |
| --- | --- | --- |
| K4 正向生命周期 | `k4-final7-owner-carrier.spec.ts`：1/1 | 从登录及可见侧栏进入；启动时由 Owner 恢复至 `v112` 语义基线，历史 `v114` 保持 archived；新草稿/发布版本单调分配（本轮终态 active `v118`），CAS 为 200/409、同键重放与结果未知回放均通过，模型配置语义精确恢复。 |
| K4 逆序并发 | `k4-final11-inverse-batch-concurrency.spec.ts`：1/1 | 两名正常 MFA 运营员逆序重算相同两用户，200/409、无 K4 死锁、审计证据保留且可变幂等记录清理。 |
| K1–K6 权限矩阵 | `k-domain-permission-fixtures-20260728.spec.ts`：4/4 | readonly、nowrite、maker、nomenu 均从登录/侧栏到直链、读写 API、刷新与重登验证五层权限边界。 |

证据目录：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\K\final13-owner`。

## K4 基线、历史与终态

本轮开始前，前序修复轮留下 active `v116`；为满足锁定验收的基线条件，Owner 在 K4 全局锁内以 `id/modelVersion/rowVersion/state` 前置条件归档 `120/v116`、恢复 `113/v112`，并写入 `K4_FINAL13_BASELINE_RECOVERY` 审计。没有删除历史 `v114`、A2/A4 审计或 outbox。

正向 carrier 后数据库复核：唯一 active `122/v118/rowVersion=1`、draft=0、`v114` archived、active override=0、K4/risk mutex=0、K4/risk processing idempotency=0。该终态符合“配置语义恢复、不可变历史只增长”的锁定规则；不应误称为原版本身份恢复。

## 未闭环项

1. K2/K5：正式最小权限角色创建过程在首次账号登录的 OTP 到改密页面瞬态中被派生夹具超时中断；随后用 K 最小 checker 审批 A6 角色删除提案得到 `platform_a6_write` 403。该 403 是 A6 删除的合理双门禁，不是 K2/K5 产品缺陷。Owner 已补偿禁用半创建账号、软删除三条 run-scoped 角色授权关系，并保留所有审计/outbox；应使用受限 A 域 cleanup actor 或 superadmin 正常 MFA 完成下一轮角色生命周期，再从登录入口跑完整 K2/K5 carrier。
2. K3：wrapper 可见 B1/J1 阶段已执行，但派生的 K3 child carrier 缺 `ADMIN_E2E_PASSWORD`、`K3_APP_PASSWORD`、`K3_APP_PASSWORD_HASH`、`K3_FIXTURE_TAG`、`K3_APP_USER_ID`、`K3_APP_PHONE`，因此 child 未启动。afterAll 的可见 MFA 清理遇到 OTP replay，但数据库快照恢复已成功；提现开关仍为 `disabled`，本轮 voucher 残留为 0。补齐锁定 App 载具后应重跑完整 K3。
3. K1、K6：尚未在 Final13 候选执行新的真实用户 carrier，因而未纳入通过分。

## 清理与安全边界

- K4 全局写锁仅覆盖本轮 K4 模型操作；遗留 Final11 锁文件候选不匹配，未被删除或复用。
- K2/K5 夹具补偿只影响 role id `4531–4533` 与 disabled account `99928`；未删除不可变审计/outbox。
- 无源码改动、无提交、无推送。

## 复审条件

补齐 K3 App 载具、以 A 域 cleanup actor 完成 K2/K5 正式最小权限角色生命周期，并从可见登录入口完整重跑 K1–K6 后，才能进行要求超过 98 分的复审。

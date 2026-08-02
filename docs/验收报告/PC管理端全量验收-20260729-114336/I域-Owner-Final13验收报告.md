# I 域 Owner Final13 初审验收报告

- Run ID：`pc-full-acceptance-20260729-114336`
- 范围：I1–I6（转化文案、Nova、通知 Campaign、信任中心、风险披露、i18n）。
- 候选运行锁：`candidate-rebuild-final13/FINAL13-RUNTIME-LOCK.json`，SHA-256 `E01C6DEB2E93203067670156BFD22F0C42DF0672CE4CA58B0A5F9A2D142AC15E`。
- 运行态：PC `3002`、Build `lqlGobSf9dgLarrRkjFGn`；后端 `8110`、JAR `34706D1F…557A7`；库 `nexion_acceptance_20260729_114336`；MFA bypass=`false`。
- App 强制绑定：`NEXION_APP_ROOT=D:\workspace\.acceptance\pc-full-acceptance-20260729-114336-app-master`，未读取旧 `D:\workspace\NX1.0`。

## 初审结论

**通过，可进入独立非 Owner 对抗复审。** Final13 本候选从登录页和可见侧栏完整重跑，Chromium `workers=1`、`trace=on`，最终 `11/11` GREEN、硬错误 `0`、P0/P1/P2/P3=`0/0/0/0`。未复用 Final12 结论。

| 波次 | 结果 | 验证事实 |
|---|---:|---|
| 权限五层、刷新、重登 | `4/4` | maker/readonly/nowrite/nomenu 覆盖菜单、路由、按钮、读取/写入 API 和数据；非写角色六写探针 `403`，无菜单角色六条直链及读写接口均拒绝。 |
| I1–I6 故障矩阵 | `1/1` | 匿名 `401`、未知路由 `404`；每模块 `500`、超时、畸形 `200` 均失败关闭，恢复后重新读取真实数据。 |
| I1–I5 生命周期 | `1/1` | I1 发布/归档与 App 回读；I2 通道/模板生命周期；I3 投递、App 通知读取与标读；I4/I5 隔离草稿与法域，已发布单例未污染；刷新、退出、fresh-MFA 重登后恢复。 |
| I3 双运营员 A2 | `3/3` | maker 从可见 I3 页面提 CAP，maker 自批 `403`，独立 A2 在可见 A2 页面审批；`50→51→50`，DB/页面/ticket/lock 均恢复。 |
| I6 双运营员 CAS | `1/1` | 两正常 MFA 会话并发得到严格 `200/409`；输家 `I18N_MESSAGE_VERSION_CONFLICT` 且无审计副作用；同键回放稳定；隐藏上游 `200` 后同键安全恢复。 |
| I6 生命周期/App | `1/1` | 可见表单创建，幂等/CAS、v2/v3 发布、App 服务端权威语言包、归档、回滚 v4、再归档完整闭环。 |

## 数据、审计与清理

- I-001：`v1:DRAFT:1,v2:DRAFT:0`；赢家审计 `1`、输家审计 `0`、outbox `0`、pending ticket/object lock `0`；finally 后 message/version/idempotency 均 `0`。
- I3：不可变 A2 审计 `7` 条；终态 I3 pending=`0`、I object lock=`0`、high CAP=`50 条`。
- I1–I5：copy/version/position/version-option、Nova、Campaign/notification、trust/disclosure 草稿、隔离 App 用户及本轮幂等均精确清零；保留不可变审计，不伪造 A4/outbox。
- I6 生命周期：A4/outbox 实测 `5` 条；业务可变 message/version/idempotency/ticket/lock 已清零。
- 执行前表级快照：`I\final13-owner\snapshot\i-domain-before.sql`，SHA-256 `EFC628FE6D6B1E7635620A315BADCAD4058288AD178D9AB1A4D5C08088378331`。每波次 finally 精确恢复可变夹具，未用全表回灌覆盖其他域或删除不可变记录。

## 运行与证据

- 根页 `200`；匿名 session `401`；陈旧 `3005` listener=`0`。
- 原始受限证据：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\I\final13-owner`；最终 trace `11` 份。
- 核心证据 SHA-256：故障关闭 `875B462C112B5457C4E84DD84BCCB6663D5D616D05B0431D4B799399C5C67D47`；I1–I5 `569DE1F62C99E554336779E9A74DBFF4FEEE4E61F5B3C45818F82402D608BCCD`；I-001 `F2EF5E6EB93B971C094A402E25D1ADD2AD2B913AC64B7AE9B8D3700C91B30360`；I3 A2 `9BF9D246063CFD311CF6E4475208BBC86848212186607141678E5A04E100B2E0`。
- 证据清单 SHA-256：`BFED84F7752A8125A2D9651C1AB0244BB2447C625213CCE813DB2983A2CA48C4`。

## 评分

- Owner 初审：**99.6 / 100，通过**（严格大于 96）。
- 复审：待独立非 Owner 按墨菲定律重跑同范围；本报告不替代复审。
- 本轮未改产品源码、共享台账，未提交或推送。

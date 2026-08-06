# I 域 Owner Final12 初审验收报告

- Run ID：`pc-full-acceptance-20260729-114336`
- 范围：I1 转化文案 A/B、I2 Nova 推送运营、I3 通知 Campaign、I4 信任中心、I5 风险披露、I6 i18n 文案。
- 候选运行锁：`candidate-rebuild-final12/FINAL12-RUNTIME-LOCK.json`，SHA-256 `A51033B0892F3625941D2C4D2015DCD5800AD05812EFB453CA495F44177C2142`。
- 实际运行态：PC `http://127.0.0.1:3002`（Build `ABZKW7393ECWjhkaA_btM`）、后端 `http://127.0.0.1:8110`（JAR `2A3EEC48…083DD2`）、隔离库 `nexion_acceptance_20260729_114336`、MFA bypass=`false`。根页 `200`、匿名 session `401`、陈旧 `3005` 监听数 `0`。
- App 候选强制绑定：`NEXION_APP_ROOT=D:\workspace\.acceptance\pc-full-acceptance-20260729-114336-app-master`；未读取旧 `D:\workspace\NX1.0`。

## 初审结论

**通过，可进入非 Owner 对抗复审。** 最终 GREEN 波次共 `11/11`，全部 Chromium、`workers=1`、`trace=on`，从真实登录及可见侧栏进入；无 mock 主流程、隐藏 URL、DOM/localStorage 权威态。

| 验收项 | 结果 | 关键事实 |
|---|---:|---|
| 五层权限与刷新/重登 | `4/4` | maker、readonly、nowrite、nomenu 覆盖菜单、路由、按钮、接口与数据；非写角色六个写探针均 `403`，无菜单角色六条直链/read/write 均拒绝。 |
| I1–I6 故障矩阵 | `1/1` | 匿名 `401`、未知路由 `404`，每模块 `500`、超时、畸形 `200` 均失败关闭，移除故障后恢复真实数据。 |
| I1–I5 生命周期与跨端消费 | `1/1` | I1 发布/归档并由 App 回读；I2 通道和模板完整生命周期；I3 campaign 投递、App 通知读取/标记已读；I4/I5 隔离草稿与法域，线上发布单例未污染；刷新、退出、fresh-MFA 重登后可继续读取。 |
| I3 A2 双运营员链路 | `3/3` | maker 从可见 I3 入口提交 CAP 调整；自批 `403`；独立 A2 操作员可见审批；`50→51→50`，DB、页面、票据与锁均恢复。 |
| I6 双运营员 CAS/幂等/未知结果 | `1/1` | 两个正常 MFA 会话并发严格为 `200/409`；输家 `I18N_MESSAGE_VERSION_CONFLICT` 且零审计副作用；同键回放稳定；上游已 `200`、客户端中断后同键恢复仍为唯一 v2。 |
| I6 发布/App/归档/回滚 | `1/1` | 可见表单创建、幂等/CAS、发布 v2/v3、App 服务端权威语言包、归档、回滚 v4、再归档全闭环。 |

## 权威数据、审计与清理

- I-001 数据库形状：`v1:DRAFT:1,v2:DRAFT:0`；赢家审计 `1`、输家审计 `0`、outbox `0`、pending ticket/object lock `0`。结果未知重试仍为 v2、审计 `1`、幂等 `1`。
- I3 A2 保留不可变审计 `7` 条；Final12 终态 `pending I3 ticket=0`、`I object lock=0`、`high CAP=50 条`。
- I1–I5 终态：copy/version/position/version option、Nova channel/template、campaign/notification、trust/disclosure 草稿、幂等和隔离 App 用户均为 `0`；保留不可变审计，未伪造 A4/outbox。
- I6 生命周期验证 A4/outbox `5` 条；其业务可变 message/version/idempotency/ticket/lock 已精确清零。
- 执行前已生成 I 域表级快照 `snapshot/i-domain-before.sql`；各波次 finally 精确恢复可变夹具，未使用全表回灌覆盖其他域或删除不可变审计/outbox。

## 异常与缺陷

- 最终硬错误：`0`；P0/P1/P2/P3：`0/0/0/0`。
- I3 首次载具运行曾在此前窗口复用 maker 的 TOTP 而停留在 MFA 错误提示，未创建业务写入；等待新 TOTP 窗口后从登录入口完整重跑 `3/3` GREEN。该项为已关闭验收载具瞬态，不是产品缺陷，失败 trace 仅保留取证，不计入本候选硬错误。

## 证据

- 受限原始证据根：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\I\final12-owner`。
- 最终 GREEN trace：`11` 份；关键 trace SHA-256：权限矩阵目录的 final rerun、故障矩阵 `AF8327B21AC562F642C9FBDB119E0B199ED19351CB1799A1FB94080AF8D2AE0A`、I-001 `415BEE94C5037228970E03D96674BB4A1AC0C933BA5E9CDD6CC59274EB709D2A`、I3 A2 rerun `7918DF590507DFEC84DFE0786A227019B5CAA7B116F064BEB90AAC139EDA76E5`、I6 生命周期 `FCA8B5E1AB92752A7EA3F0C94962B9FF5A6E0610F124D9892A1FACD95626D080`。
- 关键安全证据 SHA-256：I1–I5 `60BEF51D0CF1F7CD1D51AA2A10B8923635163E3AF7C1D8111E852449E067A988`；故障关闭 `3BFD1D06A56F61181C5E2F61E30350E8A09586321403CC6A9D4D5F487B10FCF1`；I-001 `A543DDAD63A63BAAC5B6B204A8F61EA130D0364FA10C6A120D39F9E9683E3855`；I3 A2 `EE639BBAE848FC197E03EF8D403F2BE058C8CBC8121DE1E4CCE9DB7E4D5F4793`。
- 证据清单 `SHA256SUMS.txt` SHA-256：`3BAFA634827FB19DF7368F492F29E2611B2A8FDF5922C3A9755C6CC61EE031CC`。

## 评分

- Owner 初审：**99.5 / 100，通过**（严格大于 96）。
- 复审：待独立非 Owner 按墨菲定律重跑同一 I1–I6 范围；不得以本初审替代。
- 本轮未改产品源码、共享台账，也未提交或推送。

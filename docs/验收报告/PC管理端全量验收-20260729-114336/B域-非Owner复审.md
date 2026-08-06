# B 域非 Owner 对抗复审报告

## 复审身份与结论

- Run ID：`pc-full-acceptance-20260729-114336`。
- 目标域：B1–B5。
- 复审方：A 域智能体；未参与 B 域 R7 修复。
- 复审方法：按墨菲定律只读复核权限绕过、失败关闭、结果未知、幂等/CAS、刷新重登、跨域合同、B5 GET/SSE 双通道和清理闭环。
- **复审评分：99.0/100，PASS（严格大于 98）**。
- 阻断项：`0`；未关闭 P0/P1/P2/P3：`0/0/0/0`。

## 对抗复核结果

- 权限：maker 的 J1 写入前后均为 `403 ADMIN_PERMISSION_DENIED`；secondWriter 只有 B2/B3 为 `200`，B1/B4/B5/J1 在前后快照中均为 `403`。
- 结果未知：B2/B3 均以原 Idempotency-Key 恢复到服务端已完成结果，未重复执行；B3 对空分母返回 `EMPTY_REGISTRATION_DENOMINATOR` 并停止计算。
- 幂等/CAS：B2 并发只有一个赢家、另一方 `409`；B2/B3 同 key 同载荷回放成功，同 key 异载荷拒绝；命名空间包含 R7 attempt 和 fixture token，不再与旧轮次碰撞。
- 跨域：B1/B2/B5 的资金事实一致，B4/H1 的 8 个 dial 一致，B5/J1 的 5 个 gate 按 canonical `key/enabled` 投影一致。
- B5 SSE：首次、刷新、退出重登三次 stream `200`；断线时保留已确认 GET 快照并显示重连告警；无权限 GET/SSE 双 `403`、匿名 stream `401`；GET 畸形 `200` 或 `500` 且 SSE 失败时只显示加载失败，不渲染旧“挤兑预警”。
- 清理：closeout `status=passed`；角色和三个临时账号禁用解绑，无 TFA；pending `0`、runLocks `0`、R7 视图 `0`、受限凭据 `credentialsRetained=false`。可变配置精确恢复，不可变审计/outbox/幂等证据保留。

## 主要证据

- 写链结果：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\B\child-write-r7-xNJR\b-child-write-lifecycle.json`，SHA-256 `3D691D41282C56063CEA2DA6CF1D968A1CE0DBDD2C3D79D576EBAFDD14358527`。
- closeout：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\B\second-writer-fixture-final2\R7-closeout-result.json`，SHA-256 `00126267DFDAF9FD6904BB4F29D4303ACA88475576C2FC1332DC78DEE2B3BF37`。
- SSE 正常/刷新/重登/断线：JSON SHA-256 `D87B314D382294807056B6007A56A8D32CBC4B5CE7A5AB2504D0C42224AED627`；trace SHA-256 `4E6FFD36D0AED98587924359FA3EC2166B70EE45E247841B89F88E41EC224AD1`。
- SSE 无权限：JSON SHA-256 `C091707ADCD3FA7832FAFBF6174EE4CC4BCE717636623F87A27BCDF8120C9BCB`；trace SHA-256 `BDA9F400B389B499AE14E1112BC88B8256DDDDD4BDE4168B89D931137BE7B66B`。
- 匿名边界 trace SHA-256 `DA7B6BA747A32C35F65DE362F6D251A3D215FCB2D8A5BB6D6B6B8150410F10BF`；malformed/500 + SSE 失败关闭 trace SHA-256 `93A1963181216CE190BAD9E9D3E2C0A725924952103CE650375EBFFA87ADD870`。

## 签发边界

B 域在锁定的 xNJR/B426 候选上通过非 Owner 对抗复审。此结论不替代主智能体对统一最终候选执行的 75 模块串行终验，也不授权提交或推送。

# G2 Owner 独占波次报告

## 结论

- Run ID：`pc-full-acceptance-20260729-114336`
- 范围：G2 兑换风控在 D disposable child 上的真实成功写、权限、幂等、结果未知、保护性回滚、A2/A4/outbox、资金不变量和会话清理。
- 结果：**G2 Owner 波次 PASS**。
- G 域总报告仍保持“待继续，不评分”：D child 尚由后续消费者 C 使用，最终销毁、统一候选等价性和非 Owner 对抗复审尚未闭环。

## 冻结候选

- PC：`3303 / PID 13404 / Build xNJR-cEeID2fPRwrRvOrb`
- 后端：`18120 / PID 28428 / JAR SHA-256 B426C1ED9CFCE970F247D041A28DC7EDAFAC927C112AC0089755ACB70F954B3B`
- DB / Redis / MinIO：`nexion_acceptance_20260729_114336_d / 14 / nexion-acc-20260729-114336-d`
- normal launcher 的 temporary super-admin MFA bypass 为 `false`；共享 `8110` 与 H child 未进入本波次。

## 验收结果

| 检查项 | 结果 |
|---|---:|
| 真实登录、可见侧栏进入 G2、手续费收紧、管理面与公共投影一致 | 1/1 PASS |
| 同 key 重放 / 异载荷冲突 | `200 / 409` |
| B1 below-redline 下放松回滚 | `422 COVERAGE_BELOW_REDLINE` |
| 结果未知同 key / 确定性失败换 key | 2/2 PASS |
| readonly / no-write / no-menu，刷新与退出重登 | 3/3 PASS |
| 匿名 PC/后端 GET、PATCH | 4/4 均 401 |
| A2 / A4 / outbox | 精确可见 |
| pageerror / 非预期 console / 非预期 5xx / 目标 request failure | `0 / 0 / 0 / 0` |
| TypeScript / G2 静态合同 | PASS / 3/3 PASS |

两次载具 RED 都发生在有效收紧已经提交之后，分别由 A2 行级角色选错和预期匿名 session 401 误报造成。修复载具后从登录入口完整重跑为 GREEN，RED trace 和 JSON 均保留。由于 fee 从 `0.04` 回到更低值属于放松风险，B1 红线会正确拒绝，未用 SQL 或放宽校验回退。

## 数据闭环

- fee：`0.01 → 0.02 → 0.03 → 0.04`，最终 child 候选 `0.04`。
- 幂等：`SUCCEEDED=3 / FAILED=3`；同 key 同 payload `200`，异 payload `409`。
- A2：3 条 `G2_EXCHANGE_PARAM_CHANGED`。
- outbox：3 条 `admin.exchange_fee_changed`，值依次 `0.02/0.03/0.04`。
- G2 fee 活跃对象锁：0。
- 11 张资金/钱包/账本表的 checksum 与波次前一致。
- G2 scalar fee API 没有版本字段或 CAS 合同；并发边界由独占 lease、A2 对象锁和 request-hash 幂等覆盖，CAS 记为不适用。

## 清理与交接

- 精确删除本波次 11 个 Redis 管理会话；目标 hash/index 均为 0。
- 不删除审计、outbox、幂等和 fee；D child 按主控顺序保留给 C。
- `G2_RELEASED_TO_CONTROLLER`、postflight JSON、GREEN/RED Playwright 结果、trace 和截图均位于：
  `D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\G\g2-owner-dchild-G2-final`
- 本报告不包含 lease、密码、TOTP、Cookie 或完整 Idempotency-Key。

## 评分

- 波次初审：99.0。
- 波次复审：99.2。
- G 域总分：暂不填写。
- 当前血量：100。

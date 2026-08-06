# L 域非 Owner Final18 对抗复审报告（K）

## 结论

Final18 候选在 L1–L6 锁定范围内通过非 Owner 对抗复审。可见登录、MFA、侧栏进入、逐页刷新、退出重登、五层权限、失败关闭、结果未知、幂等/CAS、L3 专用快照隔离、边界值和 L6 跨域合同均有证据闭环；未发现产品缺陷，P0/P1/P2/P3 均为 0。

- 初审：98.7 分，通过（要求 >96）。
- 复审：99.2 分，通过（要求 >98）。
- 本轮未改产品源码，仅新增本报告及隔离验收证据。
- 精确清理已完成，可变业务对象、隔离账号/角色、幂等记录和 Redis 会话/权限键残留均为 0；A2/A4 不可变审计证据保留。

## 候选锁

| 项目 | 锁定值 | 终检 |
| --- | --- | --- |
| Final18 runtime lock SHA-256 | `871CD8374D9E14AA2683F626858832C9864536BB07707CFEA17D57259F6603C8` | 一致 |
| PC | `http://127.0.0.1:3002`，Build `9mltIBkb8GykArkvwXDY1`，PID `3888` | 存活 |
| 后端 | `http://127.0.0.1:8110`，PID `21696` | 存活 |
| 后端 JAR SHA-256 | `77DABEDE10CCA3AD3D82AA506A09A706724679CB703172725BB3C0CBECF85E70` | 一致 |
| 数据隔离 | MySQL `nexion_acceptance_20260729_114336`、Redis DB 13 | 一致 |
| 执行约束 | `workers=1`、`trace=on` | 已遵守 |

锁证据：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\L\final18-nonowner-k\L_FINAL18_NONOWNER_K.lock.json`。

## 复审结果

| 攻击面 | 结果 | 核心证据 |
| --- | --- | --- |
| L1–L6 可见入口、刷新、退出重登 | 通过 | 从真实登录/MFA和侧栏依次进入六页；每页刷新后重新读取权威接口，退出后再次登录仍保持正确菜单和页面真值。`owner-visible`，1/1 |
| 静态合同与跨域约束 | 通过 | L 域合同 85/85；含 L6 跨域闭环、L3 权限边界、专用快照路由及 `REPEATABLE_READ` 合同。`pc-l-contracts.junit.xml` |
| 五层权限 | 通过 | Owner、只读、无写权限、无菜单，以及后端直接越权均按层关闭；只读可见但写控件禁用，无菜单同时阻止深链。`permission-five-layer`，3/3 |
| L3 专用 snapshot / generic treasury 隔离 | 通过 | `/api/admin/bi/finance/treasury-snapshot` 返回 200、`serverAuthoritative=true`；通用 treasury liabilities、7d/30d maturity 接口均为 403；可见 L3 页面未发出通用 treasury 请求。`l3-snapshot-adversarial` |
| L3 畸形源和事务快照失败关闭 | 通过 | 注入 `serverAuthoritative=false` 后页面显示协议失败、两个导出入口禁用；解除注入后同页恢复。静态合同确认专用快照使用 `REPEATABLE_READ`。`l3-snapshot-adversarial`、`pc-l-contracts.junit.xml` |
| L3 `momDelta` 边界 | 通过 | `-100` 合法展示；`<-100` 协议失败关闭；恢复源后重新读取成功。`L3-boundary-evidence`，1/1 |
| L1 404/500/超时/离线/畸形 200 | 通过 | 五种故障均不展示 KPI 卡片、导出禁用；每种解除故障后恢复为准确 8 项且导出重新启用。`l1-fault-matrix`，5/5 |
| L4/L5/L6 畸形 200 | 通过 | 三模块均拒绝伪成功数据并可恢复。`malformed-matrix`，3/3 |
| 结果未知与请求重放 | 通过 | 首次写已提交但响应被替换为 503；UI 自动重试严格复用同一幂等键和同一请求体；同键同载荷返回同一报告 200，同键异载荷返回 409。`l1-unknown-idempotency` |
| Maker/Checker 与 CAS | 通过 | 创建/重放 200，异载荷 409，maker 自批 403，两名独立 checker 竞争为 200/409，下载成功且脱敏。`maker-checker`，1/1 |

本轮可计数自动化断言载具合计 104 项通过：静态合同 85 项，权限夹具建立 3 项，可见 L1–L6 1 项，L3 边界 1 项，五层权限 3 项，L4–L6 畸形矩阵 3 项，Maker/Checker 1 项，L1 故障矩阵 5 项，L1 结果未知 1 项，L3 专用 snapshot 1 项。

## 重点对抗证据

### L-only Treasury 快照

L3 的页面读模型只消费 L 域专用快照。专用接口在当前 L Owner 权限下为 200，而 D3/B2 通用 treasury 接口在相同会话下均为 403，且浏览器请求日志证明 L3 页面没有偷用通用接口。这样同时验证了“L 可读”与“跨域最小授权”并存，不以扩大通用 treasury 权限换取页面成功。

### 失败关闭与恢复

404、500、网络超时、离线和结构完整但业务畸形的 200 响应均被视为不可信。页面不保留旧 KPI，不展示伪卡片，也不允许导出；故障解除后通过“重新读取”回到 8 项权威数据。L3 的 `serverAuthoritative=false`、`momDelta < -100` 同样失败关闭，而 `momDelta = -100` 保持合法边界。

### 结果未知、幂等与 CAS

结果未知用真实“服务端已提交、浏览器收到 503”构造，而不是简单阻断请求。客户端两次请求的幂等键与字节级请求体一致；服务端对重放返回同一个 `EXP-153A11EC`，异载荷冲突返回 409。L3 双 checker 对同一待批报告竞争仅一方成功，另一方得到 409，未出现双批或覆盖。

## 载具偏差说明

旧 `l-domain-final-write-20260729.spec.ts` 在首次 L1 写入前因按钮文案仍锁定为“导出 KPI 序列 CSV”而停止；当前候选在趋势数据不足的合法降级态使用“导出 KPI 当前汇总 CSV”。该失败发生于任何写操作之前，属于测试载具文案漂移，不是产品缺陷。已用本轮专用未知结果载具覆盖原目标，并保留失败 trace，未修改产品源码或旧载具。

旧权限清理载具的 root 凭据在 Final18 运行时已出现 TOTP 漂移，两次均停留在 MFA 页且未进入清理写入。随后按账号 ID、用户名、角色 ID/编码、幂等前缀和 Redis DB 13 的精确集合执行隔离清理，没有扩大删除范围。

## 精确清理与恢复

业务对象先对账后清理：

- `EXP-153A11EC`：DB READY、8 行、MinIO SHA/大小一致、A2 1 条、A4 revision 302 1 条。
- `EXP-E397F104`：DB READY、63 行、MinIO SHA/大小一致、A2 3 条、A4 revision 302 1 条。
- 清理后两个报告的可变报告、artifact、download grant 和 MinIO 对象均为 0；5 条写入幂等记录为 0；A2/A4 不可变证据保留。
- 隔离账号 `99990–99995`、账号状态、角色关系、角色 `4584/4585`、角色菜单、角色权限、14 条夹具幂等、pending 工单和精确 Redis 键全部为 0。

清理证据：

- `D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\L\final18-nonowner-k\business-exact-cleanup\db-a2-a4-minio-pre-cleanup.json`
- `D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\L\final18-nonowner-k\business-exact-cleanup\exact-cleanup-result.json`
- `D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\L\final18-nonowner-k\fixture-exact-cleanup.json`

## 缺陷与残余风险

| 级别 | 数量 | 说明 |
| --- | ---: | --- |
| P0 | 0 | 无 |
| P1 | 0 | 无 |
| P2 | 0 | 无 |
| P3 | 0 | 无 |

本轮锁定候选范围内无阻断发布的产品风险。保留的两类载具偏差均已被更精确的专用载具或精确清理闭环覆盖，不影响产品结论。

## 证据根目录

`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\L\final18-nonowner-k`


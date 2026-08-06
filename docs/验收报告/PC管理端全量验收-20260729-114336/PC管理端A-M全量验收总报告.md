# PC 管理端 A–M 全量验收总报告

## 签发结论

Run `pc-full-acceptance-20260729-114336` 通过全量验收，可以签发。范围为 `lib/nav/console-nav.ts` 定义的 A–M 13 个域、75 个模块；未关闭产品缺陷 `P0/P1/P2/P3 = 0/0/0/0`。

本结论由两部分共同组成：

1. 分阶段域级签发链：13 个域均有 Owner 初审和独立非 Owner 对抗复审，Owner 初审均严格大于 96，非 Owner 复审均严格大于 98。
2. Final19 最终候选统一终验：首轮侧栏 75/75、逐页刷新 75/75、退出重登后 75/75，错误门禁全部为 0。

域级签发跨 Final13、Final14、Final15、Final18、Final19 候选，不表述为“13 域都在 Final19 完成了完整双人域重跑”。Final16 明确失败，Final17 仅为 E1 预检；Final18 完整替代 E/L，Final19 完整替代 M 并承担最终统一终验。

## 最终候选

- PC Build ID：`cIXso0KJblmHHCLNiokFZ`
- 后端 JAR SHA-256：`8166F07EB1993579982938A3FC1AD73BC9BE7CD801B69404C7825355FA2057F6`
- 运行锁 SHA-256：`9760C329569C809EDFA0FD8DCA22C0A17BD7E2F1BB8E1A5E2244C3EB69AFEB20`
- MFA 临时绕过：主、子环境均为 `false`
- 隔离环境：主库 `nexion_acceptance_20260729_114336` / Redis 13 / bucket `nexion-acceptance-20260729-114336`；子库 `nexion_acceptance_20260729_114336_d` / Redis 14 / bucket `nexion-acc-20260729-114336-d`

## 域级签发矩阵

| 域 | Owner 初审 | 非 Owner 复审 | 权威报告 | 结论 |
|---|---:|---:|---|---|
| A | 97.4 | 99.2 | `A域-Owner-Final13验收报告.md` / `A域-非Owner-Final15复审-M.md` | 通过 |
| B | 98.5 | 99.3 | `B域-Owner-Final13验收报告.md` / `B域-非Owner-Final14复审-A.md` | 通过 |
| C | 97.0 | 99.3 | `C域-Owner-Final13验收报告.md` / `C域-非Owner-Final14复审-B.md` | 通过 |
| D | 97.0 | 99.0 | `D域-Owner-Final13验收报告.md` / `D域-非Owner-Final14复审-C.md` | 通过 |
| E | 98.0 | 99.4 | `E域-Owner-Final18验收报告.md` / `E域-非Owner-Final18复审-D.md` | 通过 |
| F | 98.0 | 99.0 | `F域-Owner-Final14验收报告.md` / `F域-非Owner-Final14复审-E.md` | 通过 |
| G | 99.0 | 99.1 | `G域-Owner-Final15验收报告.md` / `G域-非Owner-Final15复审-F.md` | 通过 |
| H | 97.6 | 99.0 | `H域-Owner-Final13验收报告.md` / `H域-非Owner-Final15复审-G.md` | 通过 |
| I | 99.6 | 99.3 | `I域-Owner-Final13验收报告.md` / `I域-非Owner-Final14复审-H.md` | 通过 |
| J | 97.2 | 99.3 | `J域-Owner-Final13验收报告.md` / `J域-非Owner-Final14复审-I.md` | 通过 |
| K | 97.4 | 98.4 | `K域-Owner-Final14验收报告.md` / `K域-非Owner-Final14复审-J.md` | 通过 |
| L | 97.4 | 99.2 | `L域-Owner-Final18验收报告.md` / `L域-非Owner-Final18复审-K.md` | 通过 |
| M | 98.2 | 99.3 | `M域-Owner-Final19验收报告.md` / `M域-非Owner-Final19复审-L.md` | 通过 |

B 的 Final14 非 Owner 报告是基于当时不可变浏览器/API/DB 证据的补签；I 域只引用 Final13 Owner 与 Final14 非 Owner，历史误名文件不作为 Owner 签发依据。

## 最终质量门

| 门禁 | 结果 |
|---|---|
| 后端全量 | `mvn clean package`，3015 tests，0 failure，0 error，5 skipped |
| PC 合同 | 1005/1005 |
| PC TypeScript | 通过 |
| PC verify | 18/18 |
| PC production build | 通过 |
| App 锁定候选 | 58 files / 267 tests、type-check、H5 build 通过；Final19 修复未触及 App |
| 真实登录 / MFA | 主、子环境均通过；bypass=false |

## 统一终验

| 项目 | 结果 |
|---|---:|
| 可见侧栏首轮 | 75/75 |
| 逐页刷新 | 75/75 |
| 退出重登后复跑 | 75/75 |
| pageerror | 0 |
| 非预期 console error | 0 |
| 管理接口非预期 4xx/5xx | 0 |
| 管理接口 request failure | 0 |
| 真实 request failure | 0 |
| 导航取消 | 109 |
| 未配对导航取消 | 0 |

第一次 Final19 统一终验因 M1 7 个未配对头像取消而拒绝签发；修正真实用户等待节奏后从登录入口完整重跑通过。严格豁免规则没有放宽。最终运行 JSON SHA-256：`871DE77C03BD6FE5FFB640F556110266A654BFE83353D54FBE8C556EDD36AA88`。

## 最后修复闭环

- E1：持久化过期 presign 不再直接挂载，改为认证 preview-url 动态刷新并失败关闭。
- L3：`momDelta=-100` 合法，低于 `-100` 失败关闭；使用 L3 专用聚合端点、单一 `REPEATABLE_READ` 事务且不扩大通用 Treasury 权限。
- M3：SSE 认证后立即发送 `: ready`，首帧从约 25 秒降至 Owner 296.2 ms、非 Owner 5.9 ms；发送失败注销并关闭。
- Final75 载体：请求在发起时冻结模块阶段，完成/失败按原始阶段归因；M1 媒体完成加载后再离开。

## 清理与审计保留

验收账号、状态、角色、角色关系、菜单、权限、幂等记录、可变工单、对象锁、Redis 13/14、两个专用 MinIO bucket、协调锁和四个候选端口监听均已清零。不可变审计保留 15,759 条，outbox 保留 512 条并导出哈希。`nx_config_item` 未进行无快照删除：主库 Run 标记备注为 0，子库保留 31 条已恢复原值的 M1 负载配置备注；因缺少原备注完整快照，不擅自覆盖，其清单已导出。

## 证据与配套文档

- 原始证据：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336`
- `运行基线.md`
- `缺陷台账.md`
- `75模块-Final19统一终验报告.md`
- `清理清单.md`
- `证据哈希清单.md`

## 任务评分

- 初审：99.1/100，通过。
- 复审：99.5/100，通过。
- 当前血量：100。

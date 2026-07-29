# F 域 Owner 验收报告

- Run ID：`pc-full-acceptance-20260728-151023`
- 范围：F1–F5（5/5 模块）
- 锁定源码基线：PC `91d1c2d`、后端 `a1cc2a7`、App `0e2178b`，以及本轮未提交修复
- 最终 PC 候选：Build `lwVpU_zYt9FH9Zgon5PVf`，PID `4196`
- 后端候选：PID `19416`，JAR SHA256 `37BA6F7D9AC5947CEEE781CE251D021AFA83F3A6FA1A524581A4D35B4FFF88CB`
- 隔离数据库：`nexion_acceptance_20260728_151023`
- Owner 结论：**5/5 通过；Owner 初审 98.8/100**
- 当前未关闭 F 域产品缺陷：`0`

## 逐模块结论

| 模块 | 页面与权威来源 | 主流程 / 恢复 | 权限、异常与调用链 | 独立结论 |
|---|---|---|---|---|
| F1 V-Rank | `/api/admin/teams/ranks`、promotion-log、reward-payouts；`nx_v_rank_config`、`nx_team_member`、`nx_v_rank_reward_rule`、`nx_v_rank_reward_payout`、`nx_user_level_log`、`nx_order`、`nx_janus_device` | 13 阶、奖励、晋升与派发流水；空态、取消、刷新、返回、退出重登 | 运行时协议失败关闭；常规写、永久保护、人工晋升、补发、冲正精确分权；App `/api/config/v-ranks`、`/api/team/rank` 契约通过 | **通过** |
| F2 费率与政策 | `/api/admin/teams/rates`；`nx_commission_rule`、`nx_config_item`、`nx_team_member`、`nx_commission_event` | 费率/政策读取、空态、刷新重登 | 费率、政策放大与暂停分别守权；500、畸形 200 均清空快照并由真实上游恢复；App `/api/config/commission/rates` 通过 | **通过** |
| F3 双轨结算 | `/api/admin/teams/binary`、binary/settlements；`nx_binary_commission_settlement`、分配/游标、`nx_commission_event` | 匹配公式、当日结算、搜索空态、刷新重登 | 配置、匹配率、结算和引擎暂停精确分权；超时/结果未知失败关闭；与 H1/B1、D4/A4 口径一致 | **通过** |
| F4 领导池与团队运营 | `/api/admin/teams/leadership-pool`；`nx_v_rank_config.leadership_votes`、`nx_team_hardware_quota_*`、大使/榜单/风险/结算互斥表 | 领导池、票权、硬件配额、大使与榜单；空态、刷新重登 | 常规配置、池资金、大使审批、榜单控制互不替代；D 域 maker 跨域提案 403 且无泄漏工单；B1/D4/A2/A4 链一致 | **通过** |
| F5 佣金审计 | `/api/admin/teams/commissions`；`nx_commission_event`、处置/暂停表 | 事件搜索、处置视图、空态、刷新重登 | 阈值、处置、驳回分别守权；404/422 无副作用，畸形 200 失败关闭；D4/B1/L4/A2/A4 跳转与数据源一致 | **通过** |

## 按验收方法执行

1. 页面与动作盘点：以 `lib/nav/console-nav.ts` 的 F1–F5 为唯一范围，逐页盘点读取、筛选、刷新、编辑、提案、处置和跨域跳转。
2. 数据溯源：页面字段经 PC BFF/客户端进入后端 F 域聚合，源表见上表；五个 overview 均由与页面相同的运行时解析器校验，不再把协议缺失补成空值或零值。
3. 真实用户走查：首轮从登录页和可见侧栏进入真实 Chromium；主流程不使用 mock、localStorage 权威数据或 DOM 修改。仅异常轨使用路由故障注入，并单独裁决。
4. 常规状态：覆盖主流程、合法空态、筛选清空、取消确认、跨域入口、刷新、返回、退出重登及错误后的可见重新加载。
5. 五层权限：独立 readonly、no-write、no-menu 三账号覆盖菜单、路由、按钮、接口、数据。readonly/no-write 的 F1–F5 读为 200、写为 403且写按钮隐藏；no-menu 的侧栏、直接路由和读写接口均失败关闭，刷新重登不由缓存恢复。
6. 异常边界：匿名 401、权限 403、404、422、HTTP 500、网络超时/结果未知及五模块畸形 200；所有歧义均清空旧快照、隐藏写入口并保留真实恢复出口。
7. 并发与幂等：F1 可恢复展示配置使用独立 maker/checker。自批 403；同键同载荷返回同一工单；同键异载荷 409；第二操作者同目标竞争 409；approve/reject 并发仅一方成功，结果为 `[200,409]`。
8. 落库与上下游：前向工单 `WO-260728180640290-499`、恢复工单 `WO-260728180642895-599`、幂等/CAS 工单 `WO-260728180644056-0` 均完成。A2 审计 `44543/44545/44546`、`44553/44554/44555`、`44556/44557/44558` 完整，A4 overview 为 200。该 F1 展示配置按产品契约仅写 A2 审计，不产生业务 outbox，F 关联 outbox 为 0。
9. 精确清理：`team.ui.F.prize.name` 已恢复为 `Nexion V-Rank`；F pending `0`、活动对象锁 `0`、F 验收幂等记录 `0`。四个权限账号按主控要求留给非 Owner 复审，已登记统一清理目标，未修改正式 `superadmin`。
10. 初审：F1–F5 均独立通过；`F-001`、`F-002`、`F-003` 完成根修复，并在最终 Build/JAR 上从入口重跑。

## 缺陷闭环

| 编号 | 模块 | 根因与修复 | 最终复验 |
|---|---|---|---|
| F-001 | F1–F5 | 五个客户端 normalizer 吞掉运行时协议缺失；新增严格 overview 协议，并在错误时清空全部旧快照、隐藏写入口 | 五模块畸形 200 `5/5`，500/超时/真实恢复 `3/3`，通过 |
| F-002 | F1–F5 | F 域未接 session authority，写控件无条件渲染；上下文接入 `can(authority)`，22 个动作按后端精确权限守卫 | readonly/no-write/no-menu `3/3`，菜单/路由/按钮/接口/数据五层通过 |
| F-003 | F1–F4 | A2 回放权限映射漏掉 `f_config`、`f_ui_config`、`f_unilevel_rule`；后端按配置 key 和 sourceDomain 单源映射，未知 key 失败关闭 | 合法 F maker 完整 maker/checker `1/1`；D maker 跨域 403；对象锁、幂等/CAS、恢复通过 |

## 最终验证清单

- F1–F5 最终锁定 Chromium：`16/16`（workers=`1`，trace=`on`）
  - Owner 入口/主流程/刷新重登/匿名：`4/4`
  - 三类权限账号：`3/3`
  - 五模块畸形 200：`5/5`
  - 500、超时/未知结果、404/422：`3/3`
  - 跨域权限攻击：`1/1`
- 独立 maker/checker：`1/1`
- F 运行时协议与 UI 权限棘轮合同：`13/13`
- PC TypeScript：通过
- 受影响 App 合同：`4` 文件、`12/12`
- 页面脚本错误：`0`
- 主流程非预期 `/api/admin/*` 5xx：`0`

受限证据位于 `D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260728-151023\F`，不进入 Git。核心证据：

- `final-locked-results`：最终 16 条独立 trace。
- `maker-checker/result.json`：maker/checker、对象锁、幂等、CAS 和精确恢复。
- `cross-authority/result.json`：D 域 maker 跨域攻击 403。
- `owner`：F1–F5 可见侧栏、空态、刷新重登和服务端快照。
- SHA256：`maker-checker/result.json` 为 `F172F9E3D55EE18C426107D2DEE626F4619DBECE8FD98AEA14E6E0DEE4D206AB`；`final-locked-playwright.log` 为 `1A75E80844A1CDD359981CF46201E1A1FC208465F041676110C9B72A530ECB3A`。

## 裁决与剩余门

F 域 Owner 验收通过，初审 `98.8/100`，本任务完成恢复 10 点血量，当前血量 `100/100`。资金/全局控制锁已释放。非 Owner 轮换复审以及四个交付权限账号的最终清理由主控按总计划执行；这些是全局结案门，不改变 F1–F5 当前 Owner 产品结论。

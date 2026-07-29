# L 域非 Owner 复审报告（K→L）

## 1. 裁决

- Run ID：`pc-full-acceptance-20260728-151023`
- 复审角色：K 域 Owner 轮换复审 L 域
- 范围：L1 KPI、L2 漏斗/cohort/留存、L3 财务报表、L4 设备/任务/网络报表、L5 导出与监管报告、L6 用户行为热力图
- 锁定 PC：Build `q2cNmpfQ_JFRzTMXb2oiR`，PID `15084`
- 锁定后端：JAR SHA-256 `199B656A05B43CF43D0252C9E9DC93CF94D4C7F605609345B0B738C4AFB97F9D`，PID `2672`
- 数据库：`nexion_acceptance_20260728_151023`
- Redis：DB 14
- MinIO：`nexion-acceptance-20260728-151023`
- 结论：**L1–L6 6/6 通过；L-003、L-004、L-005 全部关闭；未关闭产品缺陷 0；mutable 业务与缓存残留 0**
- 非 Owner 复审评分：**99.2 / 100，通过**

本次没有复用 L Owner 的通过结论或认证状态。统一重建后，以新浏览器上下文从登录页和可见侧栏重跑主流程、刷新、退出重登、五层权限、故障恢复、高风险导出、幂等、maker/checker、CAS、A2、A4/outbox、MinIO 和精确清理。

## 2. 逐模块结论

| 模块 | 首次用户与主流程 | 权限与异常攻击 | 权威状态及跨域链 | 结论 |
|---|---|---|---|---|
| L1 KPI | 可见侧栏进入，八项 KPI、服务端筛选、下钻、趋势、刷新和聚合 CSV 完成 | readonly/no-write 写按钮禁用且接口 403；no-menu 菜单、路由和读写接口拒绝；空态不冒充 0%；畸形 200、500/503 失败关闭并恢复 | KPI 导出 `EXP-8D0DD5CE` 对应 MinIO SHA、A2 `56055` 与 A4/outbox `8869`，canonical `KPI_SERIES` | **通过** |
| L2 漏斗/cohort/留存 | 从可见入口完成漏斗、cohort、留存筛选及真实空态；刷新、退出重登保持服务端真值 | 三类权限轨通过；畸形 200 禁用导出；503 后可恢复；匿名读取 401 | 五级漏斗和来源由深层协议约束，没有用本地持久状态制造统计；空数据时不生成伪报表 | **通过** |
| L3 财务报表 | 收入、兑付、净敞口、负债到期四报表及七条权威读取通过；脱敏资金明细创建、审批、下载通过 | 三类权限轨通过；畸形 200 禁用聚合与明细导出；500 恢复；同键同载荷回放、同键异载荷 409、自批 403、双 Checker CAS `[200,409]` | `EXP-F6448281` 由 L Owner 发起，独立 `d_checker` 唯一批准；A2 `56285/56303/56318`、A4 `8874`、MinIO SHA 一致，CSV 含脱敏用户编码且无 phone/email/passport | **通过** |
| L4 设备/任务/网络 | 四报表、周/月/自定义周期、Phase、保存视图、空态、聚合导出和团队树下载完成 | 三类权限轨通过；畸形 200 明确显示后端异常并禁用导出；500/503 后恢复；同键异载荷 409 | 两个独立团队树命令各自产生唯一 report、artifact、A2 与 canonical A4；L4→E/F/H1/L5 调用链不再把协议损坏当空态 | **通过** |
| L5 导出与监管 | 可见入口完成四类聚合、D4 七账单、四监管模板、限时下载、刷新和退出重登 | 三类权限轨通过；畸形 200 隐藏全部权威写入口；500 后恢复；匿名监管 options 401；不提供解密导出 | 四聚合 outbox `8875–8878`、D4 `8879`、四监管 `8880–8883` 均为注册、服务端权威的 `admin.report_exported`；MinIO artifact 与下载 SHA 一致 | **通过** |
| L6 用户行为热力图 | 可见入口完成空筛选、ALL+ALL+7d 真数据、聚合下钻、单页坐标热力、`l6-behavior.csv` 和刷新 | 三类权限轨通过；畸形 200 和 500 失败关闭，解除注入后恢复；无原始用户身份导出 | A2 `56337` 与 A4/outbox `8884` 共享 `L6-3153C718`；事件为 canonical `BEHAVIOR_AGGREGATE`，`containsPii=false`、`maskingPolicy=AGGREGATED` | **通过** |

## 3. 验收方法十步

1. 页面与动作：以 `lib/nav/console-nav.ts` 的 L1–L6 为范围真源，逐页核对读取、筛选、下钻、导出、审批和下载入口。
2. 数据溯源：核对 BI report、artifact、download grant、D4 账单、A2、A4/outbox、MinIO SHA 与权限会话。
3. 真实浏览器：全部从 `/` 登录页和可见侧栏进入；没有直接改 DOM，没有用 mock 或 localStorage 充当权威业务数据。
4. 用户流程：完成首轮、空态、筛选、刷新、返回、退出和重新登录；错误态保留可理解的恢复出口。
5. 五层权限：`l_readonly`、`l_no_write`、`l_no_menu` 共 `3/3`；覆盖菜单、路由、按钮、接口和权威数据。
6. 异常矩阵：匿名 401、无权 403、未知路径合同、幂等/CAS 409、输入/理由校验 400/422、500/503、畸形 200、网络结果未知均失败关闭；解除注入后真实恢复。
7. 并发与幂等：L3 同键同载荷回放同一 report、异载荷 409、自批 403、双 Checker `[200,409]`；L4 同键重放不重复 report/MinIO/A4，同键异载荷 409。
8. 数据与事件：L1、L3、L4、L5、D4、L6 导出均核对 A2 与 canonical `admin.report_exported`；事件注册且服务端权威。
9. 精确清理：仅按本轮 report、artifact、grant、idempotency、outbox 与 MinIO object 精确删除；不可变 A2 保留。
10. 裁决：六个模块分别给出结论，没有用域级总分替代模块验收。

## 4. L4 canonical A4 与幂等证明

两条 outbox 不是同一命令的重复事件：

| 命令 | Idempotency-Key | Report | Artifact | A4/outbox | 唯一性 |
|---|---|---|---|---|---|
| A：页面团队树 depth=3 | `l4-network-tree-1785257245011-fhvkauhi` | `L4TREE-524EB926` | `bi-reports/l4tree-524eb926.csv` | `8871` | `1 idem + 1 report + 1 artifact + 1 outbox` |
| B：独立重复意图 depth=2 | `99104-l4-duplicate-1785257245127` | `L4TREE-9AFCFCCD` | `bi-reports/l4tree-9afcfccd.csv` | `8872` | `1 idem + 1 report + 1 artifact + 1 outbox` |

- 命令 B 以相同 key 和相同载荷再次执行返回 200，仍为 `L4TREE-9AFCFCCD`。
- 命令 B 以相同 key 但把 `depth=2` 改为 `depth=3`，返回 `409 IDEMPOTENCY_KEY_PAYLOAD_MISMATCH`。
- 重放和冲突后，命令 B 仍只有一行 idempotency、一行 report、一行 artifact 和一条 A4；没有重复 MinIO object。
- `8871/8872` 均为 `admin.report_exported`，`schema_registered=1`、`is_server_authoritative=1`、状态 `PENDING`；payload 同时包含 canonical camel/snake 双键，`exportType=NETWORK_TREE`、`containsPii=true`、`maskingPolicy=PARTIAL`、`rowCount=4`。

因此 L-005 的根因已在新 JAR 中闭环，不是用第二条事件掩盖第一条命令的重复发布。

## 5. L3 / D4 高风险闭环

- maker：`acc_lowner_r151023_c8c38b`。
- checker A：`acc_d_checker_r151023_ajuki`；checker B：`superadmin`。
- 报告：`EXP-F6448281`，状态从 `PENDING_CONFIRM` 由唯一 checker 推进为 `READY`。
- 创建命令同键同载荷返回同一 report；同键异载荷返回 409。
- maker 自批返回 403。
- 两个隔离浏览器上下文同时批准，排序结果为 `[200,409]`，只有 `d_checker` 的 A2 `56303` 为成功批准。
- 下载令牌绑定发起管理员且限时；CSV 下载 200，包含“用户编码（脱敏）”，不含 phone、email、passport。
- D4 七账单直接导出产生 A2 `56327` 与 A4 `8879`，`exportType=BILL_CSV`、`containsPii=true`、`maskingPolicy=MASKED`、`rowCount=59`。

一次载具失败仅因登录 helper 强制等待 MFA 输入，没有接受“已进入认证后 shell”这一合法终态。helper 已改为无固定睡眠地等待“MFA challenge 或可见控制台”，产品认证代码未改；随后三个隔离上下文完成上述真实 CAS 与下载闭环。

## 6. 质量门

| 质量门 | 结果 |
|---|---:|
| L1 浏览器轨 | `6/6` |
| L2 浏览器轨 | `5/5` |
| L3 浏览器轨 | `4/4` |
| L4 浏览器轨 | `4/4` |
| L5 浏览器轨 | `2/2` |
| L6 浏览器轨 | `1/1` |
| L4/L5/L6 畸形 200 独立轨 | `3/3` |
| L1–L6 可见侧栏、刷新、退出重登 | `1/1` |
| readonly/no-write/no-menu 五层权限 | `3/3` |
| L1–L6 精确 500 注入与真实恢复 | `6/6` |
| L3 maker/checker、幂等、CAS、脱敏下载 | 通过 |
| L4 同键重放与异载荷冲突 | `200 / 409` |
| L4/L5/L6 定向合同 | `29/29` |
| TypeScript | 通过 |
| `git diff --check` | 通过 |
| 页面未处理错误 | `0` |
| 最终主调用非预期 `/api/admin/*` 5xx | `0` |

## 7. 缺陷关闭

| 编号 | 等级 | 新候选复验 |
|---|---:|---|
| L-003 | P1 | L5 畸形成功响应不再显示伪 0，权威写入口全部关闭；真实四聚合、D4、监管和下载无回归 |
| L-004 | P2 | L4 畸形成功响应明确显示后端异常，导出禁用；真实空态、刷新和导出正常 |
| L-005 | P2 | 两个独立 L4 命令各发布唯一 canonical A4；重放不重复，异载荷 409 |
| L-AUTO-008 | P3 | 登录 helper 接受 MFA 或已认证 shell 双终态；独立 CAS 实测通过 |

未发现新的产品缺陷。未关闭 P0/P1/P2/P3 为 `0/0/0/0`。

## 8. 清理与候选稳定性

- 删除 report：`14`
- 删除 MinIO artifact metadata：`14`
- 删除 download grant：`12`
- 删除本轮 idempotency：`18`
- 删除本轮 A4/outbox：`16`
- 删除 MinIO object：`14`
- Redis DB14 按本轮 report、命令 key、D4/L6 event ID 扫描残留：`0`
- DB report/artifact/grant/idempotency/outbox 残留：`0/0/0/0/0`
- 不可变 A2 保留：`32`
- PC Build/PID 结束核对：`q2cNmpfQ_JFRzTMXb2oiR / 15084`
- JAR SHA/PID 结束核对：`199B656A…97F9D / 2672`

## 9. 证据

受限证据根目录：

`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260728-151023\L\candidate-q2cNmpfQ_JFRzTMXb2oiR`

关键证据：

- 最终 L1–L6 可见侧栏 trace：`nonowner-k-owner-final\...\trace.zip`
- 五层权限结果：`nonowner-k-permissions`
- L1 主流程、空态、畸形、故障和真实导出截图：`nonowner-k-l1`
- L3 四报表与畸形 200 截图：`nonowner-k-l3-results`
- L5 四聚合与监管截图：`nonowner-k-l5`
- L6 可见入口、筛选下钻与导出截图：`nonowner-k-l6`
- L-005 修复前真实红证据：`candidate-wFMibyXH-QAZp3csVOjUx\nonowner-k-l4-content\l4-l005-runtime-evidence.json`

最终域级 trace SHA-256：

`563B1CC5FFDA4B58232C5E193631DC3AA389DFDF141599C7808D719F6C849510`

## 10. 评分

- 初审：**98.7 / 100，通过**
- 非 Owner 复审：**99.2 / 100，通过**
- 扣分 0.8：L3 Checker helper 出现一次零副作用的认证终态兼容问题；已定位为载具缺陷、修正双终态，并以隔离浏览器完成真实业务闭环。
- 当前血量：**100 / 100**

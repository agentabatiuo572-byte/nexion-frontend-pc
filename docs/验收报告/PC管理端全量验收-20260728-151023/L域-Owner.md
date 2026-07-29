# L 域 Owner 验收报告

## 结论

- Run ID：`pc-full-acceptance-20260728-151023`
- 范围：L1 KPI 看板、L2 漏斗/cohort/留存、L3 财务报表、L4 运营报表、L5 导出与监管报告、L6 用户行为热力图，共 6 个模块。
- 锁定基线：PC `91d1c2d`、后端 `a1cc2a7`、App `0e2178b`。
- 最终修复候选：PC Build ID `FL6den7TMkSYQjxGFfpkR`（PID `16912`）；后端 JAR SHA-256 `DCA3841B0099723B0C1BE49A703681FEF276F4C691BCBC8B914C11F18589208F`（PID `4476`）；隔离库 `nexion_acceptance_20260728_151023`，Redis DB `14`，MinIO bucket `nexion-acceptance-20260728-151023`。
- Owner 裁决：**L1/L2/L3/L4/L5/L6 全部通过初审，进入非 Owner 轮换复审。**
- 初审评分：**98.8/100，通过**（门槛 >96）。
- 未关闭产品缺陷：`P0/P1/P2/P3 = 0/0/0/0`。
- 权限复审夹具账号 `99446/99447/99448/99449`、角色 `4074/4075` 按统一计划保留；密码和 MFA 秘钥只在受限目录，不写入 Git。

本轮没有复用旧通过结论。六个模块都从真实登录页和可见侧栏进入，以 Chromium 完成点击、输入、空态、刷新、退出重登、权限绕过、异常恢复和跨域回读。最终候选结果为 L1 `6/6`、L2 `5/5`、L3 `4/4`、L4 `4/4`、L5 `2/2`、L6 强制导出 `1/1`、权限轨 `3/3`、Owner 全入口锁定 `1/1`、maker/checker `1/1`；L 合同 `52/52`、App 行为分析合同 `6/6`、后端 Mapper 合同 `1/1`。主流程未使用 mock、localStorage 权威数据、直接修改 DOM 或固定睡眠。

## 模块逐项结果

| 模块 | 可见入口 | 权威数据与调用链 | 重点复验 | Owner 裁决 | 评分 |
|---|---|---|---|---:|---:|
| L1 KPI 看板 | `/analytics/kpi` | B/C/D/E/F/G/H/K 等域的服务端 KPI 聚合；A4 schema/outbox 驱动序列与趋势 | 八项 KPI、筛选、下钻、趋势、空态、畸形 200、503 恢复、无 PII 聚合导出 | **PASS** | 98.8 |
| L2 漏斗/cohort/留存 | `/analytics/funnel` | 注册、KYC、结账、复投、提现五阶段事件及 A4 权威事件 | 首次用户理解、完整分析、空态、畸形 200、503、刷新重登、匿名 401 | **PASS** | 98.6 |
| L3 财务报表 | `/analytics/finance` | D4 七类账本、储备、负债、到期、收入事实；L5 审批与令牌下载 | 四类报表、九字段脱敏明细、幂等、maker/checker、自批 403、双 Checker CAS 200/409 | **PASS** | 99.0 |
| L4 运营报表 | `/analytics/operations` | E 设备/任务、F 网络/佣金、H Phase 和 A4 事件聚合 | 自定义周期草稿、日期顺序、保存视图、503 恢复、网络树脱敏导出和重复意图 | **PASS** | 98.8 |
| L5 导出与监管报告 | `/analytics/export` | `nx_admin_fourth_batch_report`、artifact、download grant 与 MinIO；关联 D4/C4/I5/J4/A2/A4 | 四类聚合、D4 七账单、四模板监管报告、匿名 401、刷新重登和令牌下载 | **PASS** | 98.7 |
| L6 用户行为热力图 | `/analytics/behavior-heatmap` | `nx_behavior_event_fact`、`nx_behavior_page_catalog` 与 App 路由/事件单源；A2/A4 导出留痕 | 活动、筛选、L1 聚合、单页坐标热力、空态、真实 CSV、刷新重登 | **PASS** | 99.1 |

## 十步验收记录

### 1. 页面与动作盘点

- 范围真源 `lib/nav/console-nav.ts` 中 L 域共 6 个模块。
- L1：KPI、筛选、下钻、趋势、聚合导出；L2：漏斗、cohort、留存、维度筛选和导出；L3：收入/兑付/净敞口/负债到期及资金明细导出；L4：设备、任务、网络、佣金、Phase 报表和视图；L5：聚合、账单、监管报告、审批、令牌下载；L6：行为趋势、活动矩阵、粒度/设备/Locale/时间窗筛选、坐标热力和聚合 CSV。
- 所有首轮入口均来自可见侧栏，没有以直达 URL 替代用户入口证据。

### 2. 页面字段到数据库的完整溯源

| 模块 | 前端/后端主链 | 权威表或服务 | 上下游 |
|---|---|---|---|
| L1 | `l1-kpi.tsx` → `l-client.ts` → BI KPI API | 各业务域权威聚合、A4 schema/outbox | B–K 指标、L5 聚合导出 |
| L2 | `l2-funnel.tsx` → funnel API | 注册、KYC、checkout、reinvest、withdraw 权威事件 | C3/C4、E4、G1/G7、D2、A4 |
| L3 | `l3-finance.tsx` → finance/report API | D4 七类账本、treasury、liabilities、maturity、revenue | B1/B2/B5、D3/D4、L5 |
| L4 | `l4-ops.tsx` → operations/network API | E 设备与任务、F 网络与佣金、H Phase、A4 事件 | E2/E5/E6、F1–F5、H1、L5 |
| L5 | `l5-export.tsx` → BI/regulatory/D4 API | `nx_admin_fourth_batch_report`、`nx_bi_report_artifact`、`nx_bi_report_download_grant`、MinIO | C4、D4、I5、J4、A2、A4 |
| L6 | `l6-behavior-heatmap.tsx` → behavior/page-catalog/export API | `nx_behavior_event_fact`、`nx_behavior_page_catalog`、App `pages.json` 与行为事件 | App 页面埋点、L1 聚合、A2 审计、A4/outbox |

### 3. 真实 Chromium 点击、输入与等待

- L1 `6/6`、L2 `5/5`、L3 `4/4`、L4 `4/4`、L5 `2/2`、L6 最终强制导出 `1/1`。
- 权限轨 `3/3`；Owner 从可见侧栏逐模块进入、刷新、退出重登锁定 `1/1`；L3 maker/checker `1/1`。
- L6 最终不允许空态条件跳过：从 `H5 + zh-CN + 24h` 合法空态恢复到 `ALL + ALL + 7d`，强制出现活动行、单页坐标热力并下载 `l6-behavior.csv`。
- trace 和关键脱敏截图仅存于受限 L 证据目录，不上传 GitHub。

### 4. 主流程、空态、刷新、返回与退出重登

- L1–L6 均验证首轮数据、真实空态、逐模块刷新和退出重登。
- L4 自定义日期未完整填写时不发请求、不清空当前权威数据；开始日期晚于结束日期明确阻止提交。
- L5 监管报告刷新、重登后仍可回读和令牌下载；L6 切换为空筛选时明确不可导出，恢复有数据筛选后才开放导出。
- 加载失败或响应畸形时不把旧数据、缺字段或空对象伪装成合法空态。

### 5. 菜单、路由、按钮、接口、数据五层权限

- `l_readonly`、`l_no_write`：L1–L6 读取 200，写控件隐藏或禁用，直接绕过页面写接口为 403。
- `l_no_menu`：L 域菜单和路由不可见，L1–L6 直接读取、写入均为 403；刷新和重登后不漂移。
- `l_owner` 仅持 L1–L6 必需读写、L3 明细、L4 网络树、L5 监管生成、L6 导出及 A2 提案权限；明确不含 `bi_l5_task_approve` 与解密导出权限。
- 正式 `superadmin` 未修改。

### 6. 异常、超时与失败关闭

- 覆盖 401、403、404、409、422、500/503、超时、HTTP 200 畸形结构和结果未知。
- L1/L2/L3/L4 对畸形 200 清空不可确认快照并禁用导出；L4 503 恢复后才重新开放。
- L5 参数不足、陈旧披露版本和匿名请求分别按 422/401 失败关闭，不产生报告。
- Owner 最终锁定中 pageerror 与 `/api/admin/*` 5xx 均为 0；最小权限壳层预期 401/403 由独立权限断言精确核对。

### 7. 幂等键、同键异载荷、CAS 与双运营员并发

- L3 敏感报告同键同载荷重放返回同一报告；同键异载荷 409。
- maker 自批为 403；d_checker 与 superadmin 两个隔离浏览器上下文同时批准，唯一 200、另一方 409。
- L4 网络树重复意图不覆盖第一份证据；L5 聚合/监管任务均使用稳定幂等键。
- 敏感明细批准后只允许令牌化下载，CSV 仅含九项白名单字段，用户编码脱敏且不含手机号、昵称、备注、真实姓名。

### 8. 数据库、状态、A2/A4 与跨域核对

- L3 报表与 D4 七类账本、treasury/reserve/liability/maturity/revenue 同源；L4 与 E/F/H 事实同源；L5 四模板分别回指 I5、A2、J4、C4/D4/L3/L4。
- 最终业务报告链产生 31 条不可变审计和 13 条 outbox 证据；清理业务夹具后仍保留。
- L6 强制导出的 A2 审计 `48425` 与 A4/outbox `8634` 共享资源 ID `L6-23CD2A8C`，动作均为 `admin.report_exported`。
- L6 Mapper 已把 SELECT 顺序修正为 `dwellMs,bounceRate,pageCount`；后端合同 `1/1`、PC L 合同 `52/52`、App 行为分析合同 `6/6`。

### 9. 精确清理

- 精确删除本轮 L 业务报告 15 条、MinIO 对象 15 个、下载 grant 12 条、L 幂等记录 20 条。
- 清理后 report/artifact/grant/idempotency 残留 `0/0/0/0`；MinIO `bi-reports` 仅剩本轮开始前的 C4 KYC 对象；Redis DB 14 的 `l-maker/99105/EXP/L4TREE/REG` 目标模式残留均为 0。
- A2 审计、A4/outbox 按不可变证据保留；L6 直接 CSV 不生成持久化报告、artifact、grant 或幂等记录。
- 账号 `99446–99449` 与角色 `4074/4075` 仅为非 Owner 复审保留，复审完成后由主智能体在平台锁下执行现成 cleanup 载具。

### 10. 初审评分

**98.8/100，通过。**

- 六模块真实浏览器主链与跨域调用链：39.7/40。
- 五层权限、异常、失败关闭和未知结果：29.6/30。
- 幂等、CAS、双运营员、审计与上下游一致性：19.7/20。
- 证据隔离、精准清理和候选锁定：9.8/10。

扣分项：权限复审账号按统一计划暂未清理；不可变审计/outbox 按合规要求保留。两项均为验收边界，不构成产品缺陷。

## 缺陷闭环

| 编号 | 模块 | 等级 | 闭环 |
|---|---|---:|---|
| L-001 | L4 | P1 | 自定义周期草稿与提交态分离，日期顺序校验补齐；最终 L4 `4/4` |
| L-002 | L6 | P1 | Mapper 列顺序与 record 对齐，PC 保持严格协议；最终 L6 强制活动/下钻/导出 `1/1` |
| L-AUTO-001 | 权限载具 | P3 | L5/L6 路由与真实客户端单源对齐；五层权限 `3/3` |
| L-AUTO-002 | L6 启动参数 | P3 | 补齐显式用户名与受限证据路径；新会话通过 |
| L-AUTO-003 | 最终锁定控制台监控 | P3 | 只排除明确预期的 401/403 通用资源诊断，pageerror 与 5xx 仍零容忍；`1/1` |
| L-AUTO-004 | L3 字段白名单 | P3 | 改用九项真实允许字段；maker/checker `1/1` |
| L-AUTO-005 | 双 Checker 登录 | P3 | 先稳定 root，再完成 MFA Checker；并发批准 `200/409` |
| L-AUTO-006 | L6 导出条件跳过 | P2 | 空态后强制恢复有数据筛选、下钻和真实 CSV；审计/outbox 对齐 |
| L-AUTO-007 | L6 时间窗定位器 | P3 | 使用完整可访问名；最终导出 `1/1` |

所有产品缺陷和验收载具项均关闭；没有以降低断言、放宽数据协议或引入 mock 成功态换取通过。

## 证据索引

- 受限目录：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260728-151023\L`
- 最终候选根：`candidate-FL6den7TMkSYQjxGFfpkR`
- L1–L4：`owner-l1-l4-results`
- L5：`owner-l5-l6-results` 与 `L5`
- L6 最终强制导出：`owner-l6-final-export-rerun-results` 与 `L6-final-export-rerun`
- 五层权限：`permissions-final-lock-results`
- Owner 全入口锁定：`owner-final-lock-rerun-results`
- L3 maker/checker：`maker-checker-final-results` 与 `maker-checker-final/runtime-evidence.json`
- 权限夹具：L 根目录 `permission-fixtures.json`
- 缺陷台账：同目录上级 `缺陷台账.md`

## 复审交接

- 按轮换规则由 M 域非 Owner 使用全新浏览器上下文复审 L1–L6。
- 复审必须重新执行可见侧栏首轮、逐模块刷新、退出重登、菜单/路由/按钮/接口/数据权限篡改、畸形 200、未知结果、同键异载荷、CAS、maker/checker 和跨域一致性。
- 复审账号为 `99446/99447/99448/99449`；凭据只能从受限 `permission-fixtures.json` 读取。
- 复审门槛 >98。复审完成后必须执行 `tests/e2e/l-domain-permission-fixture-cleanup-20260728.spec.ts`，核对账号禁用/解绑/MFA/会话、角色、Redis、幂等与临时业务数据残留全部为 0。

# E 域 Owner 初审报告

执行日期：2026-07-29  
Run ID：`pc-full-acceptance-20260729-114336`  
范围：E1 商品目录与上架门、E2 收益与任务引擎、E3 生命周期与 Trade-in、E4 订单状态机、E5 设备运维、E6 算力与设备配置。  
最终候选基线：PC Build `ODaNTve-ln2-d4L6DPMKG`；后端 JAR `55B9E011...82CE6`；`nexion_acceptance_20260729_114336` / Redis DB 13 / MinIO `nexion-acceptance-20260729-114336`。

## 本轮 Owner 结果

### 最终候选无写重跑（14:xx JST）

在 A 域统一角色修复后的专属 E 夹具上，重新从登录页和可见侧栏执行，不进行成功业务写。E maker 对 E1–E6 的权威读取均为 `200`，六个入口可见；刷新、退出重登和 E-001/E-002 面向运营人员的文案回归均通过。`readonly`、`nowrite` 的六页菜单、路由、读取和写入拒绝为 `2/2` 通过；最终 `nomenu` 语义为权限与菜单双空、侧栏 0、直链拒绝、读写均 `403`，刷新重登后不恢复菜单（不再沿用旧载具的“无菜单仍可读 200”假设）。

本次同时发现并打开 `E-003`：E2 收到畸形成功响应 `{code:0,data:{}}` 时，错误地显示零任务/零分类并保留“调整全局饱和因子”写入口；没有进入“E2 数据读取失败 + 重试”的失败关闭状态。此项为 P1，轮换修复方 F 尚未修复，因此 E 域不能签发。

受限原始证据：`E/final-no-write-rerun/owner/owner-nowrite-result.json`（SHA-256 `759C4BA6…B53B16`）、`owner-e1-e6-refresh-relogin.png`（`1E869BDF…459FE8`）、畸形响应 RED 截图（`DDD46715…513483`）；所有成功业务写为 0。

全部浏览器检查均以真实 Chromium 从登录页和可见侧栏进入，`workers=1`；没有以隐藏 URL、mock 权威态或本地状态捷径替代用户路径。

| 项目 | 结果 | 本轮证据 |
|---|---:|---|
| E1 / E4 / E5 / E6 首次走查、空态、刷新、退出重登 | 6/6 通过 | `final-ODaNTve/e1-e4-e5-e6-output` |
| E1 / E4 / E5 / E6 畸形 200 失败关闭与可见恢复 | 4/4 通过 | 同上（trace、截图、视频） |
| E1 / E4 / E5 / E6 匿名边界、非法/缺失幂等键零副作用拒绝 | 通过 | 同上 |
| E2 首次走查、筛选、表单前置校验、刷新、重登、503 与畸形 200 失败关闭 | 4/4 通过 | `final-ODaNTve/e2-output` |
| E2 读取故障关闭/可见重试、匿名与错误分支 | 通过 | 同上 |
| E3 首次走查、操作手册、安全调整入口、刷新、重登 | 3/3 通过 | `final-ODaNTve/e3-output` |
| E3 读取故障关闭/恢复、接口来源、未知参数零副作用拒绝 | 通过 | 同上 |
| E1–E6 五层权限 | 3/3 通过 | `final-ODaNTve/permission-output`、`final-ODaNTve/permission` |
| E1–E6 专属 maker 无写全路径、E-001/E-002、E no-menu、SHARED-001 | 4/4 通过 | `final-ODaNTve/nowrite-output`、`final-ODaNTve/nowrite` |
| E2 合同及运营文案 | 13/13 通过 | `tests/e2-acceptance-contract.test.mjs` |

权限矩阵使用 A 域本轮统一隔离夹具，而未创建重复账号或角色：

- `readonly`、`menu-no-write`：六页可见、路由与数据读取正常；所有写请求均为 `403`，按钮隐藏；刷新、退出重登后不漂移。
- `no-menu`：最终统一夹具为 `unassigned`，权限与有效菜单均为 0；E 直达路由、读取和写入均被拒绝（`403`），刷新、退出重登后保持无菜单。此前“无菜单仍保留全域纯读”的描述是旧载具契约，不能作为本轮最终结论。

## 修复回归

本轮初检发现的三项 P3 均由轮换修复方 F 修复，Owner 在最终候选上重新走查：

- `E-UI-001`：E2 不再向运营人员显示接口地址、字段缩写或 `Server Canonical`；最终候选的 E2 3/3 和运营文案合同 13/13 通过。
- `E-UI-002`：E3 不再显示 `nx_user_device`、`server-canonical` 等实现术语；E3 Owner 3/3 重跑通过。
- `E-003`：E2 的 `task-pricing` 畸形 200 现会报告 `E2_TASK_PRICING_PROTOCOL_INVALID`、清空数据并关闭所有写入口。真实 Chromium 复验已覆盖：已打开抽屉后刷新为畸形 200（抽屉/确认框/顶部调整/任务操作均为 0）、503 错误、延迟加载中均无可用写入口；撤销注入后由可见重试恢复。负值收益、反向收益区间、饱和度越界三条授权接口探针均被 `422` 拒绝，分别返回 `TASK_REWARD_RANGE_INVALID`、`TASK_REWARD_RANGE_INVALID`、`TASK_SATURATION_INVALID`，成功业务写为 0。截图：`final-ODaNTve/e003-malformed-drawer-confirm-failclosed.png`、`final-ODaNTve/e003-loading-failclosed.png`。

`SHARED-001` 关闭：E 专属 maker 从真实登录进入 E1 后，CDP 请求记录中 B/L/M/A2/A3 无 `4xx`，`denied` 为空，`pageerror` 为空；登录启动阶段有一条 `/api/admin/auth/session` 的预登录 `401` console 记录，及 J1/A2 预取取消记录，均未形成对应权限拒绝响应。原始记录：`final-ODaNTve/nowrite/maker-cross-domain-403.json`。

修复同时暴露两处验收载具陈旧断言：E2 仍断言旧标题、E 权限 no-menu 仍按旧独立夹具要求“无 read authority/读 403”。均已由 F 按当前产品和 A 统一夹具契约修复，并保留首次 RED 证据；它们不是产品缺陷。修复后的 E2 3/3、权限 3/3 全量重跑均通过。

## 数据与关联核对

隔离数据库只读核对：活动任务 12、SKU 91、订单 2、数据中心 1、E3 配置 44、`E.compute.*` 配置 9；`nx_audit_log`、`nx_audit_object_lock`、`nx_event_outbox` 等审计/事件表均存在。

| 模块 | 权威数据/关联 |
|---|---|
| E1 | `nx_admin_device_sku`、`nx_admin_device_generation_gate`；规格供 C1 使用 |
| E2 | `nx_admin_device_task`、`nx_config_item`；任务与收益配置受权限及幂等校验保护 |
| E3 | `nx_compute_e3_config`、置换/设备事实；由 App Trade-in 消费，关联 K2/L4 |
| E4 | `nx_admin_device_order`；资金侧关联 D 域 |
| E5 | `nx_compute_datacenter`、`nx_compute_dc_ops_state` |
| E6 | `nx_config_item` 的 `E.compute.*` |

后端 `OpsDeviceController` 对 E1–E6 采用细粒度读写权限；E4/E5/E6 高风险动作受 A2 业务守卫、对象锁和相关权限保护。

## 未完成的签发前提

本轮主控明确未发放 E 业务写令牌，因而没有为满足形式而创建重复 maker/角色或改动 E 配置。下列正向写链路不能由本报告冒充已验：E6 maker-checker 的 A2 提案/批准/精确恢复、相应 A4/outbox 落库及 App/商城消费端的写后回归；CAS/双运营员的真实写冲突也同理。

申请 `E_WRITE_TOKEN` 时必须一次性锁定并恢复：

- E6 的 `E.compute.download.zhGuide` 原始中英文本及版本；maker 提案、独立 checker 批准、maker 精确恢复，随后核对 A2、A4/outbox 与前台/商城消费结果。
- E3 生命周期/Trade-in 的单一隔离夹具对象及其版本；双运营员竞争同一预期版本，预期一方成功、另一方 `409`，然后精确恢复并核对审计和消费端。
- 令牌覆盖期内不得并发改动上述对象；每项动作使用本 Run 幂等键，操作前后保存数据库、缓存、对象锁和事件快照。

最终候选仅执行无成功业务写的验证；所有权限探针写请求均被后端以 `403` 拒绝，未创建账号、角色或业务对象。

## 跨域 403 原始证据（共享缺陷 SHARED-001）

E maker 仅持 E 域权限。本项使用 Chromium CDP 记录 method、path、完成态 status、资源类型和静态调用链；不记录 header、cookie、请求体、账号或令牌。登录完成后静候 2 秒，再从可见侧栏打开 E1 并静候 2 秒。记录结果为完成态 `Fetch` 且 `initiator.type=script`，不是导航取消；`pageerror=[]`。浏览器 console 先有启动阶段的会话 `401`，随后有与下表 15 个完成态 `403` 一一对应的资源加载错误。

| 触发页面/时点 | Method / path / status | 次数 | 前端归因 |
|---|---|---:|---|
| 登录后 Shell 静候 | `GET /api/admin/bi/overview → 403` | 1 | `app/_console/page.tsx` 的无条件 `fetchLBiOverviews()` |
| 登录后 Shell 静候 | `GET /api/admin/treasury/b-domain → 403` | 1 | `app/_console/page.tsx` 的无条件 `useBDomainDashboard()` |
| 登录后 Shell 静候 | `GET /api/admin/content/conversations → 403` | 1 | 侧栏/顶栏 `use-service-badges.ts` 无条件 `fetchMContentData()` |
| 登录后 Shell 静候 | `GET /api/admin/content/knowledge/overview → 403` | 1 | 同上 |
| 登录后 Shell 静候 | `GET /api/admin/content/session-templates/overview → 403` | 1 | 同上 |
| 登录后 Shell 静候 | `GET /api/admin/content/support-agents → 403` | 1 | 同上 |
| 登录后 Shell 静候 | `GET /api/admin/content/tickets → 403` | 1 | 同上 |
| 登录后 Shell 静候 | `GET /api/admin/content/tickets/load-config → 403` | 1 | 同上 |
| E1（可见侧栏打开）后静候 | `GET /api/admin/treasury/b-domain → 403` | 1 | 公共 Shell `useBDomainDashboard()` 再次预取 |
| E1（可见侧栏打开）后静候 | `GET /api/admin/content/conversations → 403` | 1 | 侧栏/顶栏服务徽标再次预取 |
| E1（可见侧栏打开）后静候 | `GET /api/admin/content/knowledge/overview → 403` | 1 | 同上 |
| E1（可见侧栏打开）后静候 | `GET /api/admin/content/session-templates/overview → 403` | 1 | 同上 |
| E1（可见侧栏打开）后静候 | `GET /api/admin/content/support-agents → 403` | 1 | 同上 |
| E1（可见侧栏打开）后静候 | `GET /api/admin/content/tickets → 403` | 1 | 同上 |
| E1（可见侧栏打开）后静候 | `GET /api/admin/content/tickets/load-config → 403` | 1 | 同上 |

CDP 堆栈将内容/资金请求定位到服务徽标及公共 Shell 引入的动态 chunk，BI 请求定位到公共 Shell 的 L BI 预取；源码可回溯到 `app/components/shell/use-service-badges.ts`、`app/components/shell/sidebar.tsx`、`app/components/shell/topbar.tsx`、`app/_console/page.tsx`、`lib/admin/m-client.ts`、`lib/admin/b-client.ts`、`lib/admin/l-client.ts`。这是客户端在未授权域主动预取，并非登录失败或 E 页面本身的读写请求。后端 `403` 是正确失败关闭，缺陷在前端未按权限阻断预取及未保持最终 console/4xx 零异常门禁。

本 Owner 不修改公共 Shell。已登记为 `SHARED-001` P2，交由主控串行协调共享修复；修复后须用相同 E maker 路径重跑，并同时验证 M/B/L 正常授权角色仍保留其需要的预取或改为按需加载。

## 初审结论

已完成的无写 Owner 范围：E1–E6 可见侧栏、读取、刷新重登、E-001/E-002 文案与最终权限语义通过；`E-003` P1 开放。  
初审评分：不评分，不能签发。  
原因：上述正向写、A2/A4/outbox、App/商城消费和真实 CAS/双运营员链路尚无本 Run 原始证据；同时 `E-003` 未修复，另有全局 Shell 在 E 专属角色登录时对其他域后台读取产生多项预期外 `403`，须由主控纳入最终零异常门禁。另仍须由非 Owner 完成对抗复审。  
是否允许作为 E 域全量通过结论：否，待补齐签发前提。

原始证据根目录：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\E\final-ODaNTve`。不覆盖历史 H8 证据。

## 新 checker 与统一候选前置（18:xx JST）

D 域轮换修复方已通过正式 A6 授权链为本 Run 独立 checker 补齐 E6 批准所需的最小业务权限；安全摘要确认未授予 `device_e6_flag_toggle` 或其他 E 写权限、菜单集合不变，旧会话已撤销，并完成新 MFA、刷新、退出重登。operator 自批、E maker 直接调用 A6 审批和无关 E5 写探针均为 `403`；旧 E6 业务票仍保持 `rejected`，未被批准。脱敏证据：`E/checker-fixture-repair/safe-e6-checker-repair-summary.json`，SHA-256 `00040B0D7ACB6B5CA0B731578698FAE2DA2DB6AECD977008B33B2DB8D916D1AD`。

共享缺陷 `SHARED-003` 的代码候选已收敛为同一 A2 行级授权策略：custom role 只从显式业务权限推导可见域，approve/reject 在控制器预检后，还会在事务锁定票据上于 replay、解锁和状态更新前二次复核；未知、畸形、超长和越域 operationId 均失败关闭。该修复的相关后端合同 `121/121`、PC A2 合同 `8/8` 通过，并经非 Owner 二次静态对抗复核 PASS。

当前运行中的 8110 仍是旧 JAR，不能用它签发 `SHARED-003` 或 E6 新批准链。本次只完成不依赖新 JAR 的前置：E1–E6、E456 runtime、E6 delegated/checker-repair 静态合同 `62/62` 通过，`tsc --noEmit` 通过，3002 首页可达。执行载体未向本 E Owner 暴露可用浏览器，因此没有复用旧会话、隐藏 URL、直接 API 或 SQL 冒充新的“登录页 → 可见侧栏”走查，也没有新增业务写。

结论：**验收环境受阻，待补验，不评分**。统一新候选重建并提供真实浏览器载体后，必须用新 MFA 从登录页重新执行 E1–E6 无写完整范围，再执行 E6 成功批准/精确恢复、E3 双运营员 CAS、A2/A4/outbox/关联消费与清理；旧证据和本节静态前置不能替代上述终验。

## E_WRITE_TOKEN 执行记录

2026-07-29 主控发放仅限 E 专属对象的写令牌后，E 专属 maker 从真实登录发起 E6 下载页四项文案的临时 A2 提案（`WO-260729180749943-300`），并预置原值精确恢复方案。独立 E checker 在批准环节被后端拒绝：`403 A2_BUSINESS_PERMISSION_DENIED:device_e6_write`。因此提案始终未应用，E6 与公共配置投影均未改变；这是夹具最小权限缺失，非产品修复项。

按主控随后发放的仅清理令牌，使用独立临时超管从可见 A2“审计 & 操作确认”入口取消该待办，而非由 maker 自批或批准：`POST .../reject` 返回 200。数据库复核该工单状态为 `rejected`，`E.compute.download.zhGuide` 不含本轮临时标记，pending 为 0；不可变 A2 留痕保留。清理截图：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\E\write\e6-pending-rejected-a2-visible.png`。

因独立 checker 无 `device_e6_write` 批准权，未继续任何成功业务写、双运营员/CAS、outbox 或 App 写后消费测试；E_WRITE_TOKEN 已停止使用。该阻断使“初审不评分、不能签发”的结论保持不变。

## 统一候选 `nf0qGeqytfzJ1e_lX9TMR` 补验（19:xx JST）

主控统一重建后，本 Owner 锁定并复核了 PC Build `nf0qGeqytfzJ1e_lX9TMR` 与后端 JAR SHA-256 `D1D33E75931ADF7F1FA3E21CB26E739EC84B12ECF6D02EBCAD1FA2D0AB75540E`。使用 E 域专属 maker / readonly / menu-no-write / no-menu 账号，从登录页与可见侧栏重新执行：

- E1–E6 六页权威读取 `6/6` 为 `200`，刷新、退出重登、E-001/E-002 运营文案通过；
- E2/E3 畸形成功与故障响应均失败关闭，撤销注入后由可见“重试”恢复；
- no-menu 的菜单、直链、读写接口均失败关闭；
- maker 登录及 E1 首次进入不再主动预取无权限域接口；
- 五层权限矩阵 `readonly`、`menu-no-write`、`no-menu` 共 `3/3` 通过，刷新重登不漂移；
- 当前树 `tsc --noEmit` 通过。

无写完整路径为 `4/4`，权限矩阵为 `3/3`。原始证据位于 `E/final-nf0qGeqytfzJ1e_lX9TMR/owner-nowrite-r3`、`playwright-nowrite-r3`、`permission-matrix` 与 `playwright-permissions`。`e3-owner-acceptance-20260727.spec.ts` 仍按旧的“superadmin 无 MFA”载具登录，三条均停在登录门禁；这属于陈旧验收载具，不计产品失败，也没有触发业务请求。

### 写前门禁与停写

本次严格先验证 `SHARED-003`，通过后才允许创建 E6 工单。统一夹具中的通用 checker 虽已具备 `device_e6_write`，但它同时保留 A–M 广泛 `*_read` 与多项专项动作权限；后端 `A2AccessPolicy` 的现行合同及单测明确以业务读权限推导 A2 行可见域。因此它不是 E-only checker，不能证明“E 同域可见/决策、跨域已知工单 403”：

- 旧 A6 工单对该 checker 并非越域且其具备 A6 专项动作权限，终态重放为 `409`；
- 更换既有 J1 工单并修正跨目标幂等键复用后，响应为 `422 J4_ACTION_NOT_EXECUTABLE:B1`；说明该行仍处于其广泛可见域，而不是跨域策略拒绝；
- 未知 canonical 工单为 `403`，证明 unknown fail-closed 正常；
- 中间一次 `409 IDEMPOTENCY_KEY_PAYLOAD_MISMATCH` 已定位为验收载具跨目标复用同一幂等键，现已将幂等键绑定 operationId；不计产品缺陷。

主控已明确不豁免跨域门禁，并判定为夹具选择错误：下次统一重建后的临时 fixture-admin 窗口创建全新 E-only checker，仅保留 `platform_a2_read`、`platform_a2_operation_approve`、`device_e6_read`、`device_e6_write` 及必需菜单，再从登录入口重跑。当前通用 checker 不再用于 E 域对抗门禁。

所有尝试都在 E6 提案创建前停止。数据库只读复核：

- `E.compute.download.zhGuide` SHA-256 为 `2d7b053a969e81a1627e0d941e18c981e7d12f0e562e25a3b6bc4e2b451aa4b6`，不含本轮标记；
- 本轮标记关联 A2 工单 `0`、对象锁 `0`、outbox `0`；
- 成功业务写 `0`，无需业务回滚。

零残留证据：`E/final-nf0qGeqytfzJ1e_lX9TMR/prewrite-stop-zero-residue.json`，SHA-256 `04D89B6441AD63F59EF3509C791F578E424BA8B004A18EF2DE9BE65FCFC08C9E`。写前门禁结构化证据：`e6-maker-checker-r5/00-a2-prewrite-gate.json`；相关失败 trace 全部保留，未覆盖 7 月 28 日或 H8 历史证据。

### 当前结论

统一候选的 E1–E6 无写 Owner 路径与五层权限已通过；成功写、A2 apply/reject/replay、E3 CAS/结果未知、DB/A4/outbox/App 消费、精确恢复和非 Owner 对抗复审尚未开始。原因是主控要求的 E-only checker 尚未建立，属于验收夹具受阻，不是产品通过或产品失败。

初审评分：不评分。  
复审评分：未触发。  
是否允许作为 E 域全量通过结论：否。  
后续唯一闭环：主控创建并激活 E-only checker → 重新锁定候选 → 从登录页完整重跑 E1–E6 → E6 驳回/批准/重放/精确恢复 → E3 双运营员 CAS/幂等/结果未知 → DB/A2/A4/outbox/App/关联域核对 → 清理 → 非 Owner 对抗复审。

## final3 候选 `B9Ondo82Dj7NKNNE6ZcgB` Owner 执行（23:06 JST）

本轮锁定 PC Build `B9Ondo82Dj7NKNNE6ZcgB`、后端 JAR SHA-256 `54B25D49CC36BAB02E1E36627CE5D9296AE92717FBACEFD5F222EE04528E59E4`，PC/后端进程分别为 `2180`、`27812`，bypass=false。E-only checker 为 `ffix.e3e6_checker.1fec8ec7` / `ACC_FINAL_20260729114336_R3_E6_CHECKER`，权限和菜单均与 final fixture manifest 完全一致。

在同一候选上，E1–E6 从真实登录和可见侧栏执行的无写 Owner 范围两轮均为 `7/7 PASS`；E 静态合同为 `67/67 PASS`，`npx tsc --noEmit` 通过，10 条计划 Playwright 用例可列出。第二轮证据位于 `E/final3-B9Ondo82Dj7NKNNE6ZcgB/owner-nowrite-r2`、`permissions-r2`、`playwright-nowrite-permissions-r2`。

### E6 写链 RED 与停写

主控签发的单次令牌 `E-WRITE-F3-R3-efbf3c26fc0f45e5ad3b4cf76e6df384` 在首次 E6 A2 探针提案 `WO-260730000614046-900` 创建时即消耗。E-only checker 已从可见 A2 找到该 pending 行，但验收载具等待按钮文案“驳回”，候选实际可见按钮文案为“取消”；对应组件仍将该按钮绑定到 `rejectWo(w)`。Playwright 在该可见操作处超时，E6 未进入临时配置 apply，E3 未启动，也未重用令牌。此项分类为验收载具 locator 与候选可见文案不一致，不据此登记产品缺陷，也不能据此签发产品通过。

失败后 `finally` 使用同一 checker 对该探针执行精确 reject；数据库独立复核如下：

- `WO-260730000614046-900` 为 `rejected`，decision reason 为本 Run 的 finally 清理理由；
- `E.compute.download.zhGuide` SHA-256 恢复并保持 `2d7b053a969e81a1627e0d941e18c981e7d12f0e562e25a3b6bc4e2b451aa4b6`；
- `[F3R3-efbf3c26-E6]` 在配置中出现 `0` 次，本轮标记配置行 `0`；
- 活跃对象锁 `0`，匹配 outbox `0`；A2 不可变审计日志保留 `2` 条；
- PC/后端候选进程在清理后仍存活。

结构化清理证明：`E/final3-B9Ondo82Dj7NKNNE6ZcgB/e6-maker-checker-r4/carrier-red-cleanup-proof.json`。失败截图、上下文和 trace 位于相邻 `playwright-e6-r4` 目录。

### final3 当前结论

结论：**验收载具受阻，待补验，不评分**。  
初审评分：不评分；复审未触发；E 域不能签发全量通过。  
停写边界：R3 令牌已消耗并关闭，未继续 E3 或任何其他 E 写。  
下一步必须由主控发放新的单次写令牌后，先将载具定位与候选可见“取消”文案对齐，再从登录入口重新执行完整 E6 写链；随后才可继续 E3 CAS/幂等/结果未知、写后 E1–E6 整域重跑、DB/A2/A4/outbox/App 核对和非 Owner 对抗复审。

## final3 R4 写链（2026-07-30 00:14 JST）

R4 前置先以 TDD 将 A2 可见取消合同锁定为：按 exact operationId 文本定位唯一表格行，点击候选真实文案“取消”，等待精确 `POST /api/admin/platform/audit/operations/{operationId}/reject`，断言 HTTP 200、业务 `code=0` 与可见“已取消”。静态合同同时锁定候选 `取消 -> rejectWo(w)`，禁止继续假设“驳回”按钮文案。修后 E 合同 `67/67`、`npx tsc --noEmit`、Playwright `10 tests / 4 files --list` 均通过；载具 SHA-256 为 `A1BE749DC44BE78C031DAD1EE054593ACFE6CE23E449A1246E3E95D287E0D9ED`，静态合同 SHA-256 为 `E489ABD44325A62241A7B3A34DA8D7912ABDAFAA3FE34004E32B2C129F43546F`。

主控随后签发一次性令牌 `E-WRITE-F3-R4-34c6e3d79b9844c7b272ed0ba15f2c3c`。候选仍为 PC Build `B9Ondo82Dj7NKNNE6ZcgB`、后端 JAR SHA-256 `54B25D49CC36BAB02E1E36627CE5D9296AE92717FBACEFD5F222EE04528E59E4`；两份载具哈希、进程和 Build 均在首写前复核一致。

### E6：PASS 并精确恢复

E6 从真实登录和可见侧栏完成独立 maker/checker 写链：

- 驳回探针 `WO-260730001428053-900` 通过可见“取消”进入 `rejected`，原值无副作用；
- 临时变更 `WO-260730001429336-700` 由独立 checker 执行为 `approved`，页面与服务端均看到 R4 标记；
- 对已批准工单的终态重放为 `409 A2_OPERATION_ALREADY_TERMINAL`，无重复副作用；
- 精确恢复 `WO-260730001431473-400` 为 `approved`，配置 SHA-256 回到 `2d7b053a969e81a1627e0d941e18c981e7d12f0e562e25a3b6bc4e2b451aa4b6`，R4 marker 为 0；
- A2 查询为 200，E-only checker 对 A4 为 403；主控 DB 通道核到两条 `compute.config_changed` outbox，按不可变边界保留。

原始结果位于 `E/final3-B9Ondo82Dj7NKNNE6ZcgB/e6-maker-checker-r4-token`，trace 位于相邻 `playwright-e6-r4-token`。

### E3：产品 RED，停止后续写链

E3 maker 从真实登录和可见 E3“调整”入口提交 canonical `capacitySubsidyDays` 提案时，后端返回：

`HTTP 403 / code 403 / A2_BUSINESS_PERMISSION_UNMAPPED`

请求合同为 `domain=E`、`op=e3_config`、`key=E.device.capacity.subsidyDays`，target 为 `E/device_e3_config/capacitySubsidyDays`。后端当前 `AuditReplayBusinessPermissionGuard` 的 E 域权限映射只覆盖 E4、E5、E6，没有 `e3_config -> device_e3_write`；E 域 delegated descriptor 同样只覆盖 E5、E6，没有 E3 canonical descriptor。因此这是当前候选的后端产品合同缺口，不是载具 locator 或账号权限漂移。登记 `E-004`，严重度 P1：授权 E3 maker 无法从可见入口创建 A2 提案，E3 双运营员对象锁、CAS、批准和恢复主链均被阻断。本 Owner 按约束不修产品代码。

R4 令牌在首次 E6 提案时已消耗并关闭，E3 RED 后没有继续结果未知测试、写后整域重跑或任何其他写。清理/只读复核：

- E3 本次 403 没有创建新 ticket、object lock 或 outbox；
- `capacitySubsidyDays` 仍为原值 `30`，SHA-256 `624b60c58c9d8bfb6ff1886c2fd605d2adeb6ea4da576068201b6c6958ce93f4`；
- R4 三个 E6 工单全部终态，R4 创建的 pending E ticket 为 0；
- E 域活动对象锁为 0；E6 已精确恢复；不可变 A2/outbox 保留。

结构化证明：`E/final3-B9Ondo82Dj7NKNNE6ZcgB/e3-cas-r4-token/r4-product-red-cleanup-proof.json`。E3 失败截图、请求/响应 trace 位于相邻 `playwright-e3-r4-token`。

### R4 结论

E6 写链通过并精确恢复；E3 存在未关闭 P1 `E-004`。因此 E 域初审不能通过，不评分；复审未触发，不能签发全量通过。必须先由轮换修复方补齐 E3 A2 权限映射、canonical descriptor、回放及测试合同，重建候选后使用新令牌从登录入口完整重跑 E1–E6。

## final4 候选 `1znYVcf5Jn3HxNvPctH1v` Owner 闭环（2026-07-30 01:xx JST）

本轮重新锁定 PC Build `1znYVcf5Jn3HxNvPctH1v`、PC PID `7040`、后端 PID `21360` 与后端 JAR SHA-256 `76D17B09663DBE435D92D0ED129CDABBDA7FE93F0B40F2090669739F01466DBB`。终验后再次核对：PC 首页 `200`、真实静态资源 `200`、匿名会话 `401`，进程和 Build/JAR 均未漂移，bypass=false。

轮换修复方已在该候选关闭 `E-004`。主控签发一次性令牌 `E-WRITE-F4-R5-7516b7aa7bc84bab91a0b61a1861f6ed`；令牌在首个 E3 提案创建时消耗，E3 与 E6 按预定义的同一 E 域写序列执行，完成后关闭，未复用。

### E3：提案、对象锁、CAS、独立批准、结果未知与精确恢复全部通过

- maker 从真实登录和可见 E3“调整”入口对 canonical `capacitySubsidyDays` 提案：`WO-260730013627472-900`；
- 第二运营员直接写同一对象为 `409 OBJECT_LOCKED_BY_A2`，maker 自批为 `403`；独立 E-only checker 批准后，临时值从 `30` 变为 `31`；
- 相同幂等键/相同载荷返回同一 operationId，相同键/不同载荷为 `409`；
- 恢复工单 `WO-260730013629481-400` 经独立 checker 批准，最终值精确回到 `30`；
- 单独结果未知用例覆盖注入 `503` 与畸形 `200`，弹窗保留、同载荷重试复用同一命令键，真实配置未被触碰。

E3 结果：`e3-cas-r5/e006-result.json`，SHA-256 `C350EFD2AEA541BCBC3D7C3CE09545BB5ACF184843F93BBCA76C11F341BB9496`；结果未知：`e3-cas-r5/e3-unknown-result.json`，SHA-256 `382B73FD5A5054300647E6A7BC3E325B35BA1BBFC28B8ED8EDADA98FF2A82CD9`。两条 Playwright trace 均保留并哈希。

### E6：驳回、批准、终态重放、A2/A4 与精确恢复全部通过

- 驳回探针 `WO-260730013705030-500` 通过可见“取消”进入 `rejected`，没有配置副作用；
- 临时变更 `WO-260730013706704-100` 由独立 E-only checker 批准，页面和服务端均看到 `[F4R5-7516b7aa-E6]`；
- 对已批准工单重放为 `409 A2_OPERATION_ALREADY_TERMINAL`，无重复副作用；
- 恢复工单 `WO-260730013708621-200` 经独立 checker 批准，`E.compute.download.zhGuide` 精确恢复；
- A2 审计查询为 `200`；E-only checker 读取 A4 为 `403`，符合最小权限；授权 DB 通道核到 E3 两条、E6 两条 outbox，均按不可变审计边界保留。

E6 结构化结果：`e6-maker-checker-r5/result.json`，SHA-256 `E74534E953F534AA7B56293D6F28E00536E07BDCE07872C7977B780FE5F0F141`；写链 trace SHA-256 `DFE34839D2C918C399F42C82BEACB412909AE4A291459DC7F9416CBCEB067B84`。

### 写后整域重跑、权限与失败关闭

写链结束后，原 Owner 从登录入口重新执行完整 E1–E6，不只复测改动按钮：

- E1–E6 可见侧栏与权威读取 `6/6` 为 `200`，逐页打开、刷新、退出重登、E-001/E-002 运营文案全部通过；
- E2/E3 畸形成功响应均失败关闭，撤销注入后由可见“重试/刷新”恢复；
- maker 登录与 E1 首次进入没有完成态跨域 `403`，`pageerror=[]`，E 域非预期响应为 `0`；
- readonly 与 menu-no-write：E1–E6 读均为 `200`、写均为 `403`；no-menu：菜单与直链拒绝，E1–E6 读写均为 `403`；三类账号刷新、退出重登后不漂移；
- E 静态合同 `67/67 PASS`，`npx tsc --noEmit` PASS。

写后 Owner Playwright 为 `4/4 PASS`，结构化结果 `owner-postwrite-r5/owner-nowrite-result.json`，SHA-256 `36C055CC0533FC399EAA9CEEDC3096A80AF45FFAC9AB986171FB4EC51975B1A9`。写后权限 Playwright 为 `3/3 PASS`；三份五层权限结果 SHA-256 分别为 readonly `F38868A4F37A53F041331A64BB425DD9A0E8CBDFBC556244D23DFC0D6CC9108C`、menu-no-write `368CFCFA2D6BB4234FC1A641362FE8E7D75FC9B34B5E6E09DE98DE127FD854EF`、no-menu `D596F3DBDB6472A7C5780B81419439DDAF48AD1C711C1F3DCF011B105F671CF9`。

两次写后整域尝试遇到的登录状态瞬时切换是验收载具竞态：密码登录可能直接形成服务端会话并进入 Shell，也可能进入 MFA；旧载具在状态切换后仍强等 MFA 输入框。按 TDD 先新增 RED 合同，再将登录判定改为服务端 `/api/admin/auth/session` 权威状态，并同时等待“已认证 Shell / MFA challenge”两种合法转换；没有修改产品代码。最终载具 SHA-256 `4524681608EFD616CFDF51173705D2C94964A06983489A1C3258FFB122E9E4BA`，静态载具合同 SHA-256 `90836B16F7C4B4FEA318DA9B93247106EA3E5273467142DE73F2A94F96622AC9`。最终 `4/4` 和 `3/3` 均在修正载具后独立重跑为绿。

### DB、A2、A4/outbox 与清理

授权 DB 只读复核结果：

- E3 `capacitySubsidyDays=30`，SHA-256 `624b60c58c9d8bfb6ff1886c2fd605d2adeb6ea4da576068201b6c6958ce93f4`；
- E6 `E.compute.download.zhGuide` SHA-256 `2d7b053a969e81a1627e0d941e18c981e7d12f0e562e25a3b6bc4e2b451aa4b6`，可变配置中 R5 marker 出现 `0` 次；
- 五个 A2 工单全部终态：E3 两个 `approved`；E6 一个 `rejected`、两个 `approved`；
- 五个工单共保留 A2 审计 `10` 行；E3/E6 共四条 outbox 按审计边界保留，未删除；
- R5 开始后 E 域 pending ticket `0`，E 域活动对象锁 `0`，R5 两个目标活动锁 `0`；
- 写后浏览器成功业务写 `0`，可变业务残留 `0`。

结构化清理证明：`final4-r5-cleanup-proof.json`，SHA-256 `0362563F76AF9B0B148C8F7DD63BF196B0FACEC7A08F932FB4770AAB26D841E1`。原始证据根目录为 `D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\E\final4-1znYVcf5Jn3HxNvPctH1v`，未覆盖 H8 或既有历史证据。

### final4 Owner 初审结论

`E-004` 在 final4 候选上已由真实链路验证关闭。E1–E6 Owner 初审范围、E3/E6 正向写链、双运营员/CAS、结果未知、幂等/终态重放、五层权限、A2/A4/outbox、写后整域重跑和精确清理全部通过，未关闭 P0/P1/P2/P3 为 `0`。

初审评分：`99/100`，严格大于 96，**Owner 初审 PASS**。  
复审评分：不由 Owner 代打，等待表定非 Owner（F 域智能体）对抗复审；在非 Owner 严格大于 98 前，不将本节冒充 E 域最终签发。

## Final7 候选 Owner 复跑（2026-08-01）

本节只记录 Final7 的新证据，不复用此前候选绿结论。锁定 PC Build `AQh7aBmA0B3cWFXbKfIIn`、后端 JAR SHA-256 `476E6C77BCDC39935865A656EED1399EB3EA56A760E0645D0949790A919D70E2`，运行于主隔离环境 `3002/8110`，MFA bypass 为 `false`。

### 已完成

- E1–E6 从真实 MFA 登录页和可见 E 侧栏进入，权威读取、刷新、退出重登及 E-001/E-002 运营文案为 `1/1 PASS`；无成功业务写。
- E2/E3 对畸形 `200` 均进入失败关闭，撤销注入后可通过页面可见重试/刷新恢复，`1/1 PASS`。
- maker 登录后至首次 E1 进入的共享 Shell 跨域预取监测为 `1/1 PASS`；无 `pageerror`。
- E1–E6 静态前后端合同 `61/61 PASS`；全局 `npx tsc --noEmit` PASS。

受限证据：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\E\final7-owner\nowrite` 与相邻 `nowrite-playwright`。

### 未完成及结论

旧的 `A/permission-fixtures/permission-fixtures.json` 中 maker 在 Final7 登录返回 `401 ADMIN_CREDENTIAL_INVALID`；新的 Final7 manifest 仅包含正常 MFA 的超级管理员 maker/checker/cleanup，不包含 E 域 readonly、menu-no-write、no-menu 角色，也未发放 E3/E6 独立 maker-checker 写锁。因此五层权限、E3/E6 双运营员/CAS/幂等/结果未知、A2/A4/outbox、App 消费与精确清理均未重新执行。

这一项按“验收夹具受阻，待补验”处理，不计产品缺陷，亦不能以历史 Final6 结果替代。本轮未登记新的 E 域产品缺陷；未关闭的验收项不评分，不触发复审，也不得签发 E 域通过。

## Final7 夹具刷新后 Owner 无写全量重跑（2026-08-01）

锁定候选仍为 PC Build `AQh7aBmA0B3cWFXbKfIIn`、后端 JAR SHA-256 `476E6C77BCDC39935865A656EED1399EB3EA56A760E0645D0949790A919D70E2`、`3002/8110`，MFA bypass=`false`。本节使用 A1/A6/A2 可见路径新建的 Final7 E maker、readonly、menu-no-write、no-menu 正常 MFA 夹具；没有使用失效的旧 `permission-fixtures` 账号，也没有成功业务写。

- 从登录页与可见 E 侧栏执行 E1–E6、权威读取、刷新、退出重登、E-001/E-002 文案：`4/4 PASS`。E2/E3 畸形 `200` 后均关闭写入口，撤销注入后通过可见“重试/刷新”恢复；E maker 登录至首次 E1 不发生完成态越域 `403`。
- 五层权限矩阵在 E 专属独占 Playwright 输出目录重跑：readonly、menu-no-write、no-menu 为 `3/3 PASS`。前两者六页读 `200`、写 `403`、按钮隐藏；no-menu 菜单/直链/读写均为 `403`，刷新和退出重登后不漂移。
- 匿名 E2 读取为真实 `401`；E2 权威读取被分别注入 `404/409/422/500`、超时和断网后，界面均显示读取失败、保留可见重试并关闭“调整全局饱和因子”，恢复真实请求后重新健康加载。该项是客户端失败关闭测试，不会产生服务端业务写。
- `npx tsc --noEmit` 通过。首次权限试跑出现的 `ENOENT` 仅为多个并行 Playwright 进程争抢默认 `test-results` 中 trace 归档路径；改为本域独占 `--output` 后同一完整权限矩阵 `3/3` 通过，故不计产品缺陷。

本节原始证据位于 `D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\E\final7-owner-rerun\`。关键安全结果哈希：无写整域 `36C055CC0533FC399EAA9CEEDC3096A80AF45FFAC9AB986171FB4EC51975B1A9`；readonly `F38868A4F37A53F041331A64BB425DD9A0E8CBDFBC556244D23DFC0D6CC9108C`；menu-no-write `368CFCFA2D6BB4234FC1A641362FE8E7D75FC9B34B5E6E09DE98DE127FD854EF`；no-menu `D596F3DBDB6472A7C5780B81419439DDAF48AD1C711C1F3DCF011B105F671CF9`。

### 本轮签发状态

**HOLD，不评分。** 现有 Final7 E manifest 仅含 maker/readonly/menu-no-write/no-menu；没有与 maker 独立的 E3/E6 checker。故 E3/E6 成功写、双运营员/CAS、幂等与终态重放、结果未知、A2/A4/outbox、跨 App 消费、精确恢复和清理均未执行，不能用旧候选证据替代。主控建立新的独立 normal-MFA checker 并签发 `E_FINAL7_WRITE` 后，必须从登录入口补齐完整写链，并在写后再跑全域 E1–E6，方可评分及进入 F 非 Owner 复审。

## Final9 Owner 重跑（2026-08-01）

本轮重新锁定运行态，而未把仓库旧 `.next` 或旧 `target` 当成候选真源：PC Build `WF2Bg3fIWMQRSwSJCTh5E`，后端 JAR SHA-256 `AD3EE7ED47E02C2DCCB842F5E74D44641B26E2032F8329BFEC1CE03223021215`，运行库 `nexion_acceptance_20260729_114336`。`final9-runtime-lock.json`、运行态 `.next/BUILD_ID` 与运行 JAR 实测一致；冻结 Final9 源码 `tsc --noEmit` 通过。

先从真实登录和可见侧栏完成成功业务写为 0 的全域门禁：E1–E6 权威读取、刷新、退出重登、畸形 200、匿名 401、404/409/422/500、超时、断网、失败关闭及可见重试为 `5/5 PASS`；readonly、menu-no-write、no-menu 的菜单、路由、按钮、接口、数据五层权限为 `3/3 PASS`。E 合同为 `70/70 PASS`，随后新增的不可变运行候选与 scoped-write 载体合同为 `7/7 PASS`。首轮故障矩阵暴露一次 Next hydration 清空用户名的载体竞态；按 TDD 先补 RED，再要求账号与密码稳定回读后点击，随后从登录入口整域 `5/5` 重跑通过。该项仅修复验收载体，不计产品缺陷。

无写最终证据：`E/final9-owner/prewrite-nowrite-rerun1/owner-nowrite-result.json`，SHA-256 `36C055CC0533FC399EAA9CEEDC3096A80AF45FFAC9AB986171FB4EC51975B1A9`；权限 trace 分别为 `D17A431C...AAAC01B7`、`6832158E...5DFC4905`、`B5DEC2E6...AFDE0E0`。所有 Playwright 进程均为 `workers=1` 且使用 E Final9 专属 `--output`，没有删除或复用共享 `test-results`。

### E-FINAL9-001（P1，开放）

取得 `E_FINAL9_SCOPED_WRITE` 后，E3 maker 从可见页面创建 canonical `capacitySubsidyDays` 工单；相同幂等键同载荷返回同一工单、同键异载荷为 409，maker 与独立第二运营员在 pending 期间直写均为 409，maker 自批为 403。独立 E-only checker 随后从可见 A2 点击批准，却收到 `403 A2_BUSINESS_PERMISSION_DENIED:device_e3_write`，无法完成批准与精确恢复闭环。

根因是 Final9 的 A2 决策阶段再次执行业务权限映射，E3/E6 分别强制要求 `device_e3_write` / `device_e6_write`；统一 checker 按职责隔离只持 A2 approve 与 E3/E6 read。直接给 checker 增加 business write 会使其具备业务直写能力，与“checker 直写 403”的最小职责模型冲突，不能作为夹具放宽处理。本 Owner 未修改产品代码，已按轮换规则交 F 修复。

失败后 finally 已将 `WO-260801181140328-600` 置为 rejected，原始 E3 值精确未变，对象锁为 0；E6 未启动，避免制造同类残留。结构化清理证据 `E/final9-owner/e3-write/e006-result.json`，SHA-256 `B254CC0A3301B2FC029EF7107D4D64B29B14BC8FC74DBCDB3D33AA275CD6751B`；失败 trace SHA-256 `53D52DA9A0CDC6E5A007DFD1D67B73943B57804B7ACA9EA90897FA6B2142F4E2`。

主控指定的旧 A6 跨域工单 `WO-260801171303781-0` 已只读确认 status=rejected、source=A、active locks=0；本轮 scoped E 写令牌禁止 A6 写，因此没有重放或重建该工单，也未用历史跨域证据冒充 Final9 新证据。

Final9 初审结论：**HOLD，不评分**。无写范围通过，但 `E-FINAL9-001` P1 未关闭，E3/E6 成功批准、终态重放、结果未知、DB/A4/outbox、关联消费与完整写后重跑尚未完成；不允许签发 E 域全量通过。修复后必须重建候选，从登录入口重跑 E1–E6 全范围，再执行非 Owner 对抗复审。

## Final10 候选 Owner 完整重跑（2026-08-01）

### 运行锁与门禁

本轮只以 Final10 冻结候选和实际运行进程为真源：PC Build `zGL97cq44U6qzzAKmh415`、后端 JAR SHA-256 `ED80116D6B7D7C025490C4EEC180D53F135D712DB0A4D5C89D6FA4D8D9A9F947`，PC/后端运行于 `3002/8110`，隔离库为 `nexion_acceptance_20260729_114336`、Redis DB 13，MFA bypass=`false`。终验后 PC PID `3520`、后端 PID `23136`、App 载具 PID `15252` 均存活，Build/JAR 未漂移。

总门禁证明为：后端 Maven `2956` tests、失败/错误 `0`、跳过 `4`；PC verify、TypeScript、生产 build 均通过，定向合同 `66/66`；App `250/250` tests、type-check、H5 build 均通过。E 域在冻结 Final10 源码上另跑静态合同 `71/71 PASS` 和 `npx tsc --noEmit` PASS。门禁只证明构建和合同成立，不能替代下述真实浏览器与消费端检查。

### 技术链路盘点

| 模块 | 页面/前端合同 | 后端与权威数据 | 关联消费者 |
|---|---|---|---|
| E1 | 可见侧栏 E1；Admin E1/device 客户端与同源 BFF | `OpsDeviceController` 细粒度读写权限；`nx_admin_device_sku`、`nx_admin_device_generation_gate` | C1 设备规格与商城展示 |
| E2 | E2 client、任务/收益与全局饱和因子表单 | 任务与配置 Service/Mapper；`nx_admin_device_task`、`nx_config_item` | 任务执行及收益计算 |
| E3 | E3 client、生命周期与 Trade-in 安全调整 | `nx_compute_e3_config`；A2 工单、对象锁、审计与 outbox | App Trade-in、K2/L4 |
| E4 | E4 client、订单列表及状态操作 | 订单 Service/Mapper；`nx_admin_device_order` | D 域资金、App 订单 |
| E5 | E5 client、设备与数据中心运维 | 设备/数据中心 Service/Mapper；`nx_compute_datacenter`、`nx_compute_dc_ops_state` | App 设备与收益 |
| E6 | E6 client、算力及下载配置 | `nx_config_item` 的九项 `E.compute.*`；A2 工单、对象锁、审计与 outbox | 公共 `/api/config/platform`、App 算力入口 |

所有浏览器用例均为 `workers=1`，从真实登录页完成 MFA 后通过可见侧栏进入，不以隐藏 URL、mock、DOM 修改或 localStorage 权威态替代用户路径；每一组使用独立 Playwright 输出目录。

### 首次用户、失败矩阵与五层权限

成功业务写之前，E1–E6 首次打开、权威读取、空态、可见侧栏、刷新、退出重登、E-001/E-002 运营文案、E2/E3 畸形 `200` 失败关闭与可见恢复、共享 Shell 越域预取检查为 `5/5 PASS`。匿名 `401` 以及注入 `404/409/422/500`、超时、断网均显示失败并关闭写入口；撤销注入后只能通过页面可见“重试/刷新”恢复。

readonly、menu-no-write、no-menu 在写前和写后分别完整执行一次，均为 `3/3 PASS`：前两类角色的 E1–E6 菜单、路由与数据读取正常，写按钮不可用且写接口 `403`；no-menu 的菜单、直链、读取和写入均拒绝，刷新及退出重登后权限不漂移。写后原 Owner 再从登录入口整域执行 E1–E6，结果 `5/5 PASS`，没有只复测 E3/E6 变更按钮。

首次载具运行曾遇到三项可复现的执行时序问题并保留失败材料：Next hydration 清空已填凭据而未发出登录 POST；180 秒命令载具超时前已完成 `4/5`；同一 TOTP 窗口重启导致三次 `401`。这些均没有形成业务请求或产品副作用；等待新 TOTP 窗口后，从登录入口完整重跑为 `5/5 PASS`，未用局部成功掩盖失败尝试。

### E-FINAL9-001 关闭证明：最小职责 checker 可批准但不能直写

Final10 继续复用受控 Final7 E 夹具清单，checker 的权威权限精确为：

`platform_a2_read`、`platform_a2_operation_approve`、`device_e3_read`、`device_e6_read`

checker 不持 `device_e3_write` 或 `device_e6_write`。实际可见链路结果如下：

- E3 maker 创建 canonical `capacitySubsidyDays` 提案 `WO-260801200135485-100`；相同幂等键/相同载荷返回同一 operationId，同键异载荷 `409`；pending 期间第二运营员和 maker 直写均 `409`，maker 自批 `403`；最小权限 checker 从可见 A2 批准为 `200`，同时 checker 业务直写仍为 `403`。
- E3 临时值从 `30` 变为 `31`；恢复工单 `WO-260801200141594-300` 由同一最小权限 checker 可见批准为 `200`，最终精确回到 `30`；已终态工单重放 `409`。独立结果未知用例覆盖 `503` 和畸形 `200`，弹窗及幂等键保留，配置未被触碰。E3 为 `2/2 PASS`。
- E6 驳回探针 `WO-260801200327109-100` 进入 `rejected` 且零副作用；临时变更 `WO-260801200329066-100` 和恢复工单 `WO-260801200331204-800` 均由最小权限 checker 从可见 A2 批准为 `200`。pending 期间 maker/第二运营员直写 `409`，checker 业务直写 `403`，maker 自批 `403`，终态重放 `409`；A2 审计读取 `200`，checker 对 A4 为 `403`，符合最小权限。E6 为 `1/1 PASS`。

因此 `E-FINAL9-001` 已在 Final10 真实运行候选上关闭：A2 决策权限与业务直接写权限被正确分离，没有通过给 checker 增加业务写权限来放宽夹具。

### DB、A2、outbox、恢复与清理

E3 写前值和最终值均为 `30`，最终 SHA-256 `624b60c58c9d8bfb6ff1886c2fd605d2adeb6ea4da576068201b6c6958ce93f4`。E6 九项 `E.compute.*` 的写后 SHA-256 与写前基线逐项一致。E3 两个工单均 `approved`；E6 驳回探针为 `rejected`，变更/恢复两个工单均 `approved`；E 域 pending 工单 `0`、活动对象锁 `0`。

四条不可变 outbox 按审计边界保留：E3 `9681b0202b534906a73cea4e3148f569`、`6ddc7a6d815d4e3aae153b2690e8ae58`，E6 `fe32f86ca88d434ca9a6613a39a25c1c`、`7722c47d9b4042cca6513f5618a69be4`。本轮精确删除 19 条 E3/E6 幂等记录，按 ID 复核剩余 `0`；Final7 复审角色按主控约束保留。App 诊断手机号 `20260801201001` 对应用户和 OTP 均为 `0` 行，未发生注册请求。E3/E6 单例协调锁均经 ownership 核验后释放，终态文件不存在；未触碰其他域锁。

结构化清理证明：`E/final10-owner/final10-cleanup-proof.json`，SHA-256 `172DBBE5E168A518B4AEA1EFA45A8714BEE6FAD66B085E33D0C0C943CD83B787`。

### E-FINAL10-APP-001（P1，开放）：Final10 App H5 打包缺少 HTTPS API base

锁定的 Final10 App H5 在 `https://127.0.0.1:5176` 以首次用户浏览器打开后，30 秒内仍停留在空白骨架，`.cta-primary` 不出现，页面抛出两次 `API_HTTPS_REQUIRED`。对 `/api/config/platform`、`/api/orders`、`/api/devices/earnings` 的请求数均为 `0`，因此 E4/E5/E6 的 App 消费链根本没有机会执行。

该结果不是 App 业务源码断言失败，而是当前候选打包配置缺陷：锁定 index SHA-256 `255FF4E2BB36F29F029FFA97D4E9B0E5F3970E664E96C61F3433E60D5FED4C5B`，其引用的 `assets/index-Cl9qkYiG.js` SHA-256 为 `AEB08C2DA2371689D3426067D4DE8A709A44B227F56FAAB13B1C0CFF4E36440D`；bundle 读取 `VITE_NEXGRID_API_BASE_URL`，但生产环境对象没有注入该值，继而回退到 `http://127.0.0.1:8110` 并被 HTTPS 守卫拒绝。Owner 按职责未修改源码、重建候选或重启共享服务。

修复方必须以 `VITE_NEXGRID_API_BASE_URL=https://127.0.0.1:18116` 重建 App 候选，重新执行全部 App 门禁及 E/H 消费链，不能用 PC、API 或旧 App 构建结果替代。结构化证明：`E/final10-owner/app-e456-packaging-proof.json`，SHA-256 `D075F972135320D9B559836C3A3016FAE4969CDBE5890A0008C83A8878C1A774`；失败浏览器结果、截图、trace SHA-256 分别为 `2F0221B7725DC54C4A7791E7B23A9A7CD0A56A394232B1C8BB2DCEF5E1284C02`、`BE76DF63E12C1512C3AF8F9E2670466CD08BC40D6029C7100669D2554A275ED9`、`E0F0074E60CAE10A77DA38D477F0AD689027B6BADF300ACA57D825B475BC77C0`。

### Final10 Owner 结论与评分

PC E1–E6、五层权限、失败矩阵、E3/E6 双运营员/CAS/幂等/结果未知、A2 最小职责批准、A4 拒绝边界、DB/outbox、精确恢复、写后整域重跑及清理均已完成；除已登记的 App 打包缺陷外，没有发现新的 E 域产品缺陷。`E-FINAL9-001` 状态为 **CLOSED**。

但是 `E-FINAL10-APP-001` P1 仍开放，E4/E5/E6 App 消费证据为不可执行而不是通过。未关闭 P0/P1/P2/P3 为 `0/1/0/0`，故本轮整体结论为 **HOLD，不签发 E 域 PASS，也不触发 F 域非 Owner 最终复审**。

PC 子范围质量分：`99/100`。按包含 App 消费的完整 Owner 范围初审评分：`94/100`，未严格大于 96，初审不通过；依规则扣除 10 点血量，当前血量 `90/100`。复审评分：未触发。待修复并重建后，原 Owner 必须从登录入口重新执行 E1–E6 与 App E4/E5/E6 消费链，初审严格大于 96 且 P0–P3 清零后，才可交由 F 域智能体进行严格大于 98 的对抗复审。

本轮原始证据根为 `D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\E\final10-owner`，共 `63` 个文件；按“相对路径 + SHA-256 + 字节数”排序清单计算的聚合 SHA-256 为 `B004EDF6EF505AFD65CA3E7807EEF1C3D013BEAE1ABF3BD8169F54973BF24BD1`。该目录为 Final10/E 独占，没有覆盖 H8 或任何历史证据。

## Final11 候选 Owner 全量复验（2026-08-01）

### 运行锁、无写全域与五层权限

本节只采用实际运行的 Final11：PC Build `xwL3BUki3xjXtoLr7RsWb`、后端 JAR SHA-256 `09BF09404F1F29A2110306E773C31529D3D1F835B04FAC5C34175FF8B467B66D`，运行于 `3002/8110`，Redis DB `13`，MFA bypass=`false`。PC `5/5 PASS`：从真实登录页和可见 E1–E6 侧栏进入，六页权威读取均 `200`，刷新、退出重登、E-001/E-002 文案通过；E2/E3 畸形成功响应失败关闭并可见恢复；匿名 `401`，`404/409/422/500`、超时和断网均关闭写入口；无跨域完成态预取、无页面错误、无成功业务写。

readonly、menu-no-write、no-menu 的独占权限复验为 `3/3 PASS`：前两类 E1–E6 均可读 `200`、写 `403`；no-menu 的菜单、直链、读取、写入均拒绝；刷新和退出重登后不漂移。证据分别位于 `E/final11-owner/pc-nowrite`、`permissions`、`playwright-nowrite`、`playwright-permissions`。

### E3/E6 写链、最小权限与恢复

- E3 `E-006`：maker 由可见 E3 创建 canonical `capacitySubsidyDays` 工单 `WO-260801222552749-900`；同键同载荷复用工单、同键异载荷 `409`；第二运营员/ maker pending 直写 `409`，checker 直写与 maker 自批均 `403`，终态重放 `409`。独立 checker 可见批准后值由 `30` 变为 `31`，恢复工单 `WO-260801222603249-300` 批准后精确回到 `30`。结果未知覆盖注入 `503` 与畸形 `200`：弹窗和命令键保留、无真实写。E3 Playwright `2/2 PASS`。
- E6：驳回探针 `WO-260801222419375-200` 无副作用；变更 `WO-260801222420861-600` 与恢复 `WO-260801222422891-100` 经独立 checker 可见批准。pending 状态 maker/第二运营员写 `409`、checker 直写 `403`、maker 自批 `403`；终态重放 `409`，A2 审计 `200`，checker 读取 A4 为 `403`，恢复精确。E6 Playwright `1/1 PASS`。

授权 MySQL 只读复核五个工单状态分别为 E3 `approved/approved`、E6 `rejected/approved/approved`；E 域 pending 工单 `0`、活动对象锁 `0`。按本轮时间窗，`nx_event_outbox` 精确保留 E6 `compute.config_changed` 两条和 E3 `admin.tradein_config_changed` 两条；驳回探针没有 outbox 副作用，未删除该不可变审计边界。A2/A4 权限结果由载具在主授权 DB 通道留存。没有创建 App 测试用户：诊断手机号 `+1 20260801014531` 在 `nx_user` 为 `0` 行。证据 `e3-cas/e006-result.json`、`e3-cas/e3-unknown-result.json`、`e6-maker-checker/result.json` 与相邻截图/trace。

### E-FINAL11-APP-001（P1，开放）：App 首屏可见交互失效，E4/E5/E6 动态消费不可达

Final10 的 HTTPS base 缺失已不再复现：真实 Chromium 从 `https://127.0.0.1:5176/?nx_device=off` 打开，初始请求通过 HTTPS 代理 `https://127.0.0.1:18116` 获得 `/api/content/i18n`、`/api/config/phone-tiers`、`/api/config/task-pricing`、`/api/config/referral-rewards` 与 `/api/config/platform`，均为 `200`，且无 console/pageerror。

但真实首次用户页面的可见交互均不响应，构成新的跨端 P1：

- 可见“立即注册” `.lg-footer__link` 执行 click 后，URL 仍为 `#/pages/login/login`，注册输入 `.rg-phone__in` 仍为 `0`；
- 可见“改用验证码登录” `.lg-switch` 执行 click 后，验证码输入 `.lg-otp__in` 仍为 `0`，密码输入仍为 `1`；
- 两条路径均无 console/pageerror，故不是浏览器脚本异常可见失败；但用户无法通过可见入口注册、验证码登录或进入已认证 shell，`/api/orders` 与 `/api/devices/earnings` 无法在真实 App 消费链触发。

这不是载具通过隐藏 URL、会话注入或 mock 得出的结论：两次均只从 H5 首页进入并点击可见控件。精确 DOM/URL/网络证据为 `E/final11-owner/app-e456-interaction-proof/interaction-proof.json`，包含点击前后 selector 数量、URL 和所有 API 响应；相邻 `registration-before/after.png`、`code-login-before/after.png` 及失败 Playwright trace 共同保留。此前试图执行完整 E4–E6 App 用户链的用例在真正提交注册前即被此阻断，没有 OTP、注册、订单或收益业务写；受限载具文件仅存于证据根，未改冻结候选源码。

### Final11 Owner 结论与评分

PC E1–E6、失败矩阵、五层权限、E3/E6 双运营员/CAS/幂等/终态重放/结果未知、A2 最小职责、A4 拒绝边界、DB/outbox、精确恢复和锁/夹具清理均通过。`E-FINAL10-APP-001`（HTTPS base）已关闭，但新的 `E-FINAL11-APP-001` P1 使真实用户无法到达 App E4/E5/E6 的 `/api/orders`、`/api/devices/earnings` 消费链。

因此完整 E 域为 **HOLD，不签发 PASS**；未关闭 P0/P1/P2/P3 为 `0/1/0/0`。初审评分 `94/100`，未严格大于 96，复审不触发。按任务规则初审失败扣除 10 点，当前血量 `80/100`。修复方必须在不改变 HTTPS 代理约束的前提下修复首次用户登录页事件/路由，重建候选后由 Owner 从 H5 首页的可见注册或登录入口重新执行 App E4/E5/E6 动态消费、刷新/重登和失败关闭；同时重跑完整 E1–E6 后，方可再评分。

Final11 证据根：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\E\final11-owner`。本 Owner 未修改冻结候选源码；E 域 pending ticket、活动 object lock、App 诊断用户均已只读复核为 `0`。

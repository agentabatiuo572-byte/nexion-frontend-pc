# A 域 Owner 初审（Final10）

## Final11 Owner 全量验收（2026-08-01，阻断）

**未评分、未通过。** 锁定候选为 PC Build `xwL3BUki3xjXtoLr7RsWb`（3002）和后端 JAR `09BF09404F1F29A2110306E773C31529D3D1F835B04FAC5C34175FF8B467B66D`（8110）；首次用户无写链已用真实 Chromium 从根登录、可见“平台基础 A”侧栏完成 A1–A8 点击、逐页刷新、退出刷新重登和四角色五层权限矩阵，A1–A8 读取均为 `200`，readonly/nowrite 写为 `403`，nomenu 读写、直达路由和刷新均拒绝，`pageerror=0`。A5 的真实导航、筛选和 403/畸形200/503 失败关闭恢复亦 `1/1` 通过。

但 A1 真实生命周期在 `GLOBAL_CONFIG_SINGLETON` 原子锁内连续两次发生 `PLATFORM_BACKEND_TIMEOUT`：首次 finally 状态清理请求约 98 秒后 `503`，重跑 finally 的账户 overview 约 113 秒后再次 `503`。同时后端 `2026-08-01 22:27:47` 记录 idempotency expiry scheduler 与账户幂等写的 MySQL deadlock。按主控定级为共享 `SHARED-FINAL11-IDEMPOTENCY-001 / P1`，停止新增 A 写，候选必须修复重建后再从登录入口完整重验，不能沿用 Final10 的通过分数。

本轮精确恢复：第一次临时账号 `99873` 已由同键完成 cleanup，第二次残留 `99874` 在核对为 `status=enabled`、`super_admin=0`、角色关联已软删除、MFA secret/boundAt 为空、sessions 已撤销、12 条本轮幂等均为 `SUCCEEDED` 后，仅将该 run 专属账号状态精确恢复为 `disabled`（version `6→7`）；未删除审计、outbox 或幂等不可变记录。恢复后 `99874` 为 disabled/unassigned/MFA 未绑定/sessions revoked，`GLOBAL_CONFIG_SINGLETON` 已释放。

证据：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\A\final11-owner\no-write-r2\`、`a5\`、`a1a3a4\`、`a1a3a4-rerun\` 与 Playwright `test-results\a003-account-lifecycle-run-d1179-cle-is-CAS-safe-and-retired-chromium\`；运行锁：`coordination\FINAL11_RUNTIME_LOCK.json`。

## Final10 Owner 全量复跑结论（2026-08-01）

**Owner 初审通过：99 分；本 Agent 同范围交付复审 99 分；P0/P1/P2/P3 未关闭数均为 0。** 该复审只用于本 Owner 交付自检，不替代计划中由 B 域 Agent 执行的非 Owner 对抗复审；A 域最终签发仍以 B 域复审严格大于 98 分为门禁。任务血量：100。

### 候选与运行绑定

- Run ID：`pc-full-acceptance-20260729-114336`；候选：`Final10`。
- PC：Build `zGL97cq44U6qzzAKmh415`，PID `3520`，端口 `3002`；现场重新读取根页面为 `200`，HTML 命中该 Build ID。
- 后端：JAR SHA-256 `ED80116D6B7D7C025490C4EEC180D53F135D712DB0A4D5C89D6FA4D8D9A9F947`，PID `23136`，端口 `8110`；未认证 `/api/admin/auth/me` 为预期 `401`。
- 隔离资源：MySQL `nexion_acceptance_20260729_114336`、Redis DB `13`、MinIO bucket `nexion-acceptance-20260729-114336`；MFA bypass=`false`。
- 执行时源码记录：PC `main@1d9dc8dffa4014cf85e935f287819fed44793206`（dirty 323）、后端 `main@f4a943ec1fe57b6f8148565194296ac05ce71131`（dirty 94）、App `UniApp@d1e788e20e389a305bd4c5179ea95f05d253cebf`（dirty 14）。dirty 数只记录并行验收现场，不用来替代 Build/JAR 运行绑定。

### A1–A8 技术链路映射

| 模块 | 可见页面与前端模型 | PC BFF / 后端链路 | 业务真源 |
|---|---|---|---|
| A1 | `/platform/rbac`；`a1-accounts.tsx` → `a1-client.ts` | `/api/admin/platform/accounts/**` → `OpsAdminAccountController` / `OpsAdminAccountService` / Admin mappers | `nx_admin`、`nx_admin_account_state`、`nx_admin_security_baseline`、角色关系表 |
| A2 | `/platform/audit`；`a2-audit.tsx` → `a2-client.ts` | `/api/admin/platform/audit/**` → `OpsAuditController` / `OpsAuditCenterService` | `nx_audit_operation_ticket`、`nx_audit_operation_history`、`nx_audit_object_lock`、`nx_audit_log` |
| A3 | `/platform/config`；`a3-config.tsx` → `a3-client.ts` | `/api/admin/platform/config/**` → `OpsPlatformConfigController` / `OpsPlatformConfigService` | `nx_config_item` |
| A4 | `/platform/events`；`a4-events.tsx` → `a4-client.ts` | `/api/admin/platform/events/**` → `OpsEventCenterController` / `OpsEventCenterService` | `nx_event_schema_registry`、schema/revision/domain-extension、`nx_event_outbox` |
| A5 | `/platform/params-registry`；`params-registry-client.tsx` → `a5-client.ts` | `/api/admin/platform/params-registry` → `OpsPlatformParamRegistryController` / `OpsPlatformParamRegistryService` | `nx_config_item` 与 J1/J2 应急配置聚合；只读 |
| A6 | `/platform/roles`；`a6-roles.tsx` → `a6-client.ts` | `/api/admin/platform/roles/**` → `OpsPlatformRoleController` / `OpsPlatformRoleService` | `nx_admin_role`、`nx_admin_role_menu`、`nx_admin_role_permission`、`nx_admin_role_relation` |
| A7 | `/platform/menus`；`a7-menus.tsx` → `a7-client.ts` | `/api/admin/platform/menus/**` → `OpsPlatformMenuController` / `OpsPlatformMenuService` | `nx_admin_menu`、`nx_admin_role_menu` |
| A8 | `/platform/permissions`；`a8-permissions.tsx` → `a8-client.ts` | `/api/admin/platform/permissions` → `OpsPlatformPermissionController` / `OpsPlatformPermissionDictionaryService` | `nx_admin_permission`、`nx_admin_role_permission`；字典只读 |

共享写合同同时落 `nx_admin_idempotency_record` 与 `nx_audit_log`；需双人确认的 A6 操作进入 A2 ticket/history/object-lock。A1/A3/A4/A6/A7 本轮操作没有定义业务事件投递合同，因此对应 outbox=`0` 是预期，而非漏发。

### 真实浏览器与对抗结果

- 技术合同：A1 安全、A2、A2 结果未知、A3、A4、A5、RBAC、认证退出与菜单状态共 `68/68` 通过；`npx tsc --noEmit` 通过。
- 整域首次用户与五层权限：普通 MFA 从根登录页进入，展开可见“平台基础 A”，A1–A8 侧栏点击、权威读取和逐页刷新 `8/8`；API logout 后按真实页面刷新验证旧 session=`401`、旧侧栏/数据清空，再次 MFA 登录成功。readonly、nowrite 各 A1–A8 可见/读取 `8/8` 且受限写 `403`；nomenu 可见菜单 `0`、八模块读写均 `403`、直接路由和刷新均拒绝。`pageerror=0`、非预期 console error=`0`。
- A1 生命周期：从可见 A1→A2→A4→A1，创建一次性临时账号；两个独立运营员同版本 CAS 得到 `200/409`；同键回放 `200` 且版本不二次递增，异载荷同键 `409`；结果未知后以权威读取和原键回放确认一次提交。A2 审计 `3`，finally 精确删除临时账号，residual=`0`。
- A3/A4：持有 `GLOBAL_CONFIG_SINGLETON` 原子目录锁，A3 `ops.maintenanceBanner off→on→off`、A4 `day0 90 秒→91→90 秒`，四次写均 `200/code=0`；快照恢复后释放锁。
- A5：真实服务寄存器读取、owner 下钻/返回、筛选/下拉、`403`、畸形 `200` 一致性失败关闭、`503` 与恢复均通过，Playwright `1/1`。
- A6–A8：持有 `GLOBAL_RBAC_SINGLETON` 原子目录锁，覆盖匿名真实 `401`、普通 MFA、A6 未知授权原子 `422`、maker-checker+A2 批准、关系保护、A7 同键回放/异载荷 `409`/并发同键 `200+409`、A8 权威字典 `319` 条与未映射 `31` 条、异常失败关闭、AUDITOR 只读与 A6/A7 写 `403`、A8 写 `405`。最终 Playwright `1/1`（2.9 分钟），锁已释放。
- A1 故障矩阵：从可见侧栏重新进入 A1，分别注入 `404`、`500`、timeout、disconnect、畸形 `200`；五种情况均不展示权威账号数据或可用写入口，解除故障后真实 `200/code=0` 恢复且 `operatorCount=709`，Playwright `1/1`、`pageerror=0`。控制注入产生的 404/500/网络失败 console/requestfailed 已归类为预期故障证据，不计最终正常候选错误。
- 其余错误合同由整套用例共同闭合：401、403、404、409、422、500、503、超时、断网、畸形 200、结果未知、幂等键复用与 CAS 冲突全部有本候选证据。

### A2 / A4 / 数据库 / 清理核对

- A1 probe：`nx_audit_log` 中创建 `1`、profile 更新 `2`，共 `3` 条成功审计；幂等记录 `4` 条且全为 `SUCCEEDED`；临时账号 residual=`0`。
- A3/A4 probe：A3 feature flag 审计 `2`、A4 day0 审计 `2`；幂等记录 `4` 条且全为 `SUCCEEDED`；数据库权威值已恢复为 maintenance banner=`off`、day0=`90 秒`。
- A6–A8 r4：A2 tickets `3` 条均为 `approved`，作用域 pending=`0`、object lock=`0`；A6/A7/A8 相关审计均保留。幂等记录 `41` 条且全为 `SUCCEEDED`；全库过期 `PROCESSING=0`。
- 对以上 A 作用域 probe 查询 `nx_event_outbox` 为 `0`，与账户/配置/RBAC 操作不发布业务事件的合同一致。
- r3 中断夹具已由 r4 开场精确回收：3 个账号均 disabled/unassigned、MFA secret 与 boundAt 均为空、sessions 已撤销；临时 role/menu 删除，pending/lock 为 `0`。r4 自身 active role=`0`、active menu=`0`、pending=`0`；3 个临时账号同样为 disabled/unassigned、TFA 未绑定、sessions=`0`、登录 `403`。
- 保留不可变 A2 审计、已决 ticket/history、outbox 查询结果和幂等证据；没有清理其他域账号、角色、菜单或 Final10 冻结时已有的跨域 ticket/object lock。

### 证据与载具判定

- Final10 原始证据根：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\A\final10-owner\`；96 个 JSON/trace/截图/视频/失败载具证据均逐文件 SHA-256，清单 `evidence-sha256.txt`，清单自身 SHA-256=`9AE44DFE50C4FADD72AAB9500FAF717DA4E145661250C1340DEF28DCA1A5FB68`。
- 最终绿色证据：`no-write-r2/`、`a1-lifecycle/`、`a3a4/`、`a5/`、`a6-a8-r4/`、`fault-matrix-r3/` 及对应 `*-output/`。
- 首轮 no-write 失败源于 APIRequestContext logout 后载具未触发页面 reload；A6–A8 前三轮失败源于已配置 MFA 的 VERIFY 页没有 provisioning `<code>`、响应体在认证跳转时不可读取，以及载具未等待后端 TOTP 防重放窗口；fault-matrix 前两轮为旧菜单名/路由与过强 UI 用户名断言。上述均由 trace 定位为验收载具问题，不是产品缺陷；所有临时载具修改已还原，成功业务中断夹具已回收，失败证据未删除。

### Owner 判定

按第一性原理，本轮判定只认 Final10 运行候选、服务端权威数据与真实用户可见入口；按奥卡姆剃刀，已由 trace 能唯一解释的载具错误不升级为产品缺陷；按贝叶斯更新，静态合同、真实浏览器、API、数据库、A2/A4 与清理证据相互独立并共同支持通过结论；按墨菲定律补齐了失败关闭、并发、重放、刷新重登和载具中断清理。

Owner 初审 `99`（严格大于 96），本 Agent 同范围交付复审 `99`（严格大于 98），当前血量 `100`。A 域 Owner 阶段通过，交由 B 域非 Owner 对抗复审；在 B 域复审完成前，不把本节扩写为全量 13 域最终通过。

---

## 历史候选记录（不参与 Final10 结论）

Run ID：`pc-full-acceptance-20260729-114336`  
范围：A1–A8 平台基础  
执行器：Playwright Chromium headless；内置交互浏览器不可用后按验收方法降级。  
基线：PC `1d9dc8d` / Build `HciWo04kGu-p9BzkRAqW4`；后端 `f4a943e` / JAR `F1DF1420…A260`；MySQL `nexion_acceptance_20260729_114336`、Redis DB 13。

## 当前结论

**Final9 Owner 初审进行中，尚未评分、未签发通过。**

### Final9 首次 A1 写链（载具误判，已安全收口）

- 锁定候选：PC Build `WF2Bg3fIWMQRSwSJCTh5E`、后端 JAR SHA-256 `AD3EE7ED47E02C2DCCB842F5E74D44641B26E2032F8329BFEC1CE03223021215`、MFA bypass=`false`。
- 从可见登录页进入 A1、A2 后回到 A1，真实执行临时账号创建、双运营员 profile CAS、同键回放、异载荷冲突与结果未知后的权威读取。A2 审计实际产生 `3` 条，临时目标 finally 精确清理后 residual=`0`；作用域 pending ticket、object lock、`PROCESSING` 幂等记录均为 `0`。
- 载具在断言 A1 必须产生 `admin.account_list_upserted` 时失败，实际 outbox=`0`。代码溯源确认该事件属于 C2 `USER_ACCOUNT_LIST`，由 `OpsUserService` 发布；`OpsAdminAccountService` 的 A1 创建和资料修改合同只有 A2 审计，并没有该 C2 outbox 合同。故本次失败归因为验收载具错误，不记产品缺陷，也不能据此签发通过。
- 原始 trace、视频和截图：`A/final9-owner/a1-lifecycle-output/`；脱敏运行摘要和 DB 快照：`A/final9-owner/a1-lifecycle/`。等待非 Owner 修正载具后，必须重新从登录入口执行完整 A1–A8。

### Final9 整域无写与权限五层重跑（通过）

- 真实 Chromium 从登录入口完成普通 MFA，展开可见“平台基础 A”侧栏，依次点击 A1–A8；8 个页面权威读取均为 `200`，逐页刷新后路由与数据保持。退出后 session=`401`、侧栏和旧数据清空，再次真实 MFA 登录成功。
- maker：可见 A1–A8 `8/8`；readonly、nowrite：各 `8/8` 页面可见且读取 `200`，受限写探针均 `403`；nomenu：A 域菜单 `0`、八个读取接口 `403`、八个写接口 `403`，直接路由和刷新均被拒绝。
- `pageerror=0`、非预期 console error=`0`；仅记录退出过程预期的 session/runtime flag `401`。
- 用例 `1/1` 通过，原始 trace 与结果在 `A/final9-owner/no-write-output/`，脱敏结果在 `A/final9-owner/no-write/a004-final-owner.json`。运行页面 HTML 明确包含锁定 Build `WF2Bg3fIWMQRSwSJCTh5E`；JSON 中 `build=AQh7a...` 是载具从当前源码树 `.next/BUILD_ID` 读取的陈旧元数据，不代表实际连接的 `3002` 候选。

锁定候选已切换为 PC Build `AQh7aBmA0B3cWFXbKfIIn`（`3002`）与后端 JAR SHA-256 `476E6C77BCDC39935865A656EED1399EB3EA56A760E0645D0949790A919D70E2`（`8110`），MFA bypass=`false`。2026-08-01 的无写门禁结果如下：

- 服务可达性：PC 首页 `200`、未认证 session `401`、后端 actuator 未认证 `401`，均符合预期；未以此替代真实登录证据。
- 匿名真实 Chromium：从产品根入口打开登录页，标题为“`Nexion 运营控制台`”、可见登录输入控件 `2` 个，`pageerror=0`、真实 request failure=`0`；截图 `A/final7-owner/01-anonymous-login.png`。未使用隐藏 URL、token 或本地状态。
- A1–A5、A2 结果未知、A3/A4/A5 与 Final7 A1 生命周期合同共 `40/40` 通过；TypeScript/整包构建由主控 Final7 门禁通过。
- 已复核 A1–A8 的唯一可见侧栏入口、PC BFF 路由以及后端 `OpsAdminAccountController`、`OpsAuditController`、`OpsPlatformConfigController`、`OpsEventCenterController`、`OpsPlatformParamRegistryController`、`OpsPlatformRoleController`、`OpsPlatformMenuController`、`OpsPlatformPermissionController` 对应关系。
- 共享 A1/A6/A2 最小权限夹具仍在 C/E/I/H 域刷新窗口中。为避免全局角色、菜单和审计单例发生并发覆盖，本 Owner 尚未执行任何 A 域成功写入，也未申请或取得 `A_FINAL7_WRITE`；因此真实登录、8 页可见侧栏逐页走查、刷新重登、五层权限、故障矩阵、CAS/幂等/结果未知、A2/A4/outbox/数据库核对和精确清理仍待窗口释放后从登录入口完整重跑。

### A1 Final7 载具独立复核（准备通过，未执行写入）

- 已独立审查新载具：只接收 `A_FINAL7_BASE_URL`，强制 loopback `3002`；只接收 `final7-a-fixture-manifest.json`，不再接受 Final6 manifest；MFA bypass 必须为 `false`；账号密码、TOTP、数据库口令、写令牌都只能由必填运行环境传入，源文件、报告快照和 console 均不保存认证材料。
- 载具合同 `3/3`、`tsc --noEmit` 均通过；用占位环境进行 `playwright --list`，可发现唯一的串行 A1 生命周期用例 `1/1`。该命令未启动浏览器、未请求服务、未发生数据库写入。
- 载具从可见登录页进入 A1 和 A2，覆盖两运营员 CAS、同键回放、异载荷冲突、结果未知后的权威读与精确回放、A2/A4/outbox/数据库核对及临时账号精确清理。其后仍必须由本 Owner 在共享写窗正式释放后执行；准备通过不是验收通过。

本节只记录 Final7 当前事实；其后的历史候选证据不得作为 Final7 通过依据。

不是产品缺陷：全域并发浏览器负载下，A 域首次用户脚本在 A1 后无法稳定推进，公共权限夹具也在首个页面/登录阶段超时。已按主控指令停止所有 A 域浏览器和写入进程，避免错误夹具和残留写入。

## 最终候选无写重跑（2026-07-29）

- 锁定候选：PC Build `sgca8V_8FEA8-6ai3edh9`（PID 18832 / 3002）；后端 JAR `BFFCE45DDB34F1F447663313CBC3FC5F09710B6E332460B656CF2404CFA9F43F`（PID 25948 / 8110）。
- 专属夹具：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\A\domain-permission-fixtures\A.json`；仅进行了登录、读取及预期 403 写探针，没有成功业务写入。
- 首轮无效证据：`final-candidate-sgca8V_8FEA8-6ai3edh9\owner-no-write-walkthrough.json`。脚本在未展开“平台基础 A”侧栏时等待 A1 可见链接，属于走查脚本错误，不计产品结果。
- 修正后重跑证据：`final-candidate-sgca8V_8FEA8-6ai3edh9\owner-no-write-walkthrough-rerun.json`。登录页经可见侧栏展开逻辑后，专属 maker 的 MFA 响应在至多一个真实 TOTP 窗口内仍未进入侧栏（页面停在 OTP），未进入 A1–A8、未发出成功写请求。
- 因认证夹具/并发环境阻断，不能以静态或旧候选证据替代本候选的首次用户、刷新重登、故障态和五层权限矩阵；不签分。

### 等待 A_WRITE_TOKEN 的 A-002 运行时 CAS 与写链

须以两个运营员读取同一版本、并发提交不同 payload 的方式覆盖：账户状态、资料、角色、密码重置及相应的会话撤销、角色关联、权限缓存、审计和幂等副作用。要求仅一方成功、另一方 `409 ACCOUNT_VERSION_STALE`，成功后版本严格递增，旧版本/旧幂等键不得重复产生副作用；并补 A3/A6/A7 可逆写入、A2/A4 审计和 outbox 核对后才可评分。

## 最终候选专属夹具无写重跑（完成读链，仍不评分）

候选仍为 PC Build `sgca8V_8FEA8-6ai3edh9`、后端 JAR `BFFCE45DDB34F1F447663313CBC3FC5F09710B6E332460B656CF2404CFA9F43F`。使用 A 专属四账号夹具，未以 superadmin 替代，未执行成功业务写。

- 合同与类型门禁：A1–A5、A2 不确定结果、RBAC 等 57/57 通过；`tsc --noEmit` 通过。
- maker：从登录页展开可见“平台基础 A”后，A1–A8 逐项真实点击并读取 8/8 `200`；A8 刷新 `200`；退出重登后 A5 `200`。截图与原始记录：`final-candidate-sgca8V_8FEA8-6ai3edh9\owner-no-write-final.json`、`final-A1.png` 至 `final-A8.png`。
- readonly / nowrite：各 8/8 A 域菜单可见、读取 `200`；每项重复的受限账户状态写探针均 `403`（16 次），未写入。
- nomenu：A 域菜单为 0；8/8 直接路由均拒绝，A1–A8 读和写接口均 `403`，刷新后未从缓存恢复权限。
- 故障态：maker 仅对 A1 权威读取注入受控 `401`，页面显示“后端数据加载失败”与“重试”，未保留可写的空/旧数据；证据 `a1-controlled-401.json`、`a1-controlled-401.png`。

本阶段仍缺 A-002 多运营员成功写 CAS、A1/A3/A4/A6/A7 写后恢复、A2 审批、A4 outbox/审计及数据库核对；在 A_WRITE_TOKEN 发放前不评分、不判通过。

## A_WRITE_TOKEN 后的 A-002 受控运行（2026-07-29，阻断）

- 启动前核对前一轮 probe `99535` 的精确清理证据：初始与恢复后的 profile/status、role、sessions、TFA 一致，版本单调 `4→6`；本次只保留审计/outbox/幂等不可变证据，未删除它们。证据：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\A\a002-cas\runtime-final-J_2lEoPlAOsQpy_5AFCCk\A002-pc-full-acceptance-20260729-114336-1785315704519-332d318a-cleanup.json`。
- 使用更新后的 status-only A-002 harness 运行一次。临时本地 super MFA-bypass 仅作第二运营员和 finally 清理者；maker 未获新增权限，未做 profile 写。
- 运行在并发 CAS 首步停止：临时 super 对 probe 状态变更成功 `200/code=0`，maker 以相同版本提交返回 `403 ACCOUNT_STATUS_FORBIDDEN`，而非可验证 CAS 的 `409 ACCOUNT_VERSION_STALE`。由于其后条件未成立，未继续 replay/mismatch/unknown 链。
- finally 已由第二运营员精确恢复 probe 的 status；最终 API/DB 为初始 profile/status，version `6→8`；本次仅留下两个业务审计、0 outbox、3 条幂等记录。原始无密 JSON：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\A\a002-cas\runtime-final-J_2lEoPlAOsQpy_5AFCCk\A002-pc-full-acceptance-20260729-114336-1785316092742-a2e23060.json`。

这是验收夹具/载具权限不匹配（A-AUTO-002），不是对 A1 CAS 修复的通过或失败结论。已停止 A 域写入；须由主控提供两个均具状态写权限的临时、可回收运营员，且不得扩大现有 maker 权限或放宽产品鉴权后，重新从登录入口完整运行 A-002。此前 A1–A8 Owner 全量重跑、初审评分和通过结论均不得签发。

## A-002 重新交接后复验（通过）

- 新受限 manifest 绑定本 Run、probe `99535` 与独立正常 MFA actors `99622/99623`；两人均为 super-policy 且具有 A1 status authority。fixture-admin 未参与任何业务断言，仅在 finally 登录并精确恢复 probe。
- Playwright Chromium：handoff 只读预检与 CAS probe 共 `2/2` 通过。两名运营员读取同版本并发状态变更得到 `200/code=0` 与 `409 ACCOUNT_VERSION_STALE` 各一次；同键回放不二次递增版本，异载荷为 `409 IDEMPOTENCY_KEY_PAYLOAD_MISMATCH`；结果未知后经权威读取与原 key 回放确认一次性提交。
- 数据证据：业务验证结束时 A2 audit `3`、A4 outbox `0`、idempotency `4`；finally 仅恢复 probe status，最终 profile/role/sessions/TFA 均与写前一致，version `11→12`，保留 audit/outbox/idempotency。无凭据、JWT 或 OTP 写入证据。
- 原始证据：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\A\a-auto-002\runtime-final-J_2lEoPlAOsQpy_5AFCCk\A002-pc-full-acceptance-20260729-114336-1785317320722-84d07436.json`；SHA-256 `E5D32AD958EE7A882EAAF466E3CDB5AF1789D514A65EDCAFF0C2E252B3C0D445`。

## 当前整域门禁

本候选的 A-002、A5、A6–A8 与 A2 权限浏览器链均已重跑通过，前端 A1–A5 合同 `34/34` 与 TypeScript 通过；但后端当前源树 Maven 在编译阶段失败（`MybatisI18nLearningRepository.retireDraftCas` 调用参数与 mapper 签名不一致）。这阻断了计划要求的 Maven 门禁、最终重建以及 A1–A8 从登录入口的完整终验。因此本报告仍不评分、不签发通过；待主控修复共享编译错误并重建锁定候选后，须重跑整域。

## A-003 / A3-A4 专属写链补验（通过，待统一终验）

- A1 专属临时账号 `99628`（仅本 Run 前缀）由两个独立正常 MFA super-policy actors 驱动：profile 并发 CAS 为一方 `200`、一方 `409 ACCOUNT_VERSION_STALE`；同键 replay 不二次写入、异载荷 `409 IDEMPOTENCY_KEY_PAYLOAD_MISMATCH`、结果未知后经权威读与原 key replay 确认一次性提交。角色赋予与密码重置的旧版本请求均 `409`；临时 super 的强制登出正确 `403 FORCE_LOGOUT_SUPER_TARGET_FORBIDDEN`，降级为 unassigned 后 session revoke 成功。finally 经 fixture-admin 恢复 profile 并将该临时账号 unassigned/disabled、sessions `0`、TFA `false`；未记录密码、JWT 或 OTP。
- A3 从可见侧栏进入后，将 `ops.maintenanceBanner` `off→on→off`，两次均 `200/code=0`；A4 从可见侧栏进入后，将 Day0 `90 秒→91→90 秒`，两次均 `200/code=0`。写前后均恢复权威值，不触碰真实管理员或其他域业务配置。
- DB：A-003 识别到 A2 audit `10`、A4 outbox `0`；A3/A4 识别到 A2 audit `4`、A4 outbox `0`，符合该类账户/运行时参数操作的审计而非投递合同。
- 原始证据（均脱敏）：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\A\a003-lifecycle\runtime-final-J_2lEoPlAOsQpy_5AFCCk\A003-1785318290918-d3712a77f2.json`（SHA-256 `71928C622026E3816CA173E1601ECC89B3EB52A69C497C20765F38BE5A773819`）；`A304-1785318405415-4181b6fa28.json`（SHA-256 `D6A07B080E42DBF78CDB55C4720522A66838AB78EAF00A601C3AEE9D131CC54A`）。

该阶段已完成 A1–A8 的写链补齐，但不替代统一候选重建后的登录入口整域重跑、Maven 门禁及非 Owner 复审；故仍不评分、不签发通过。

## 已完成证据

- 前端 A1–A5 合同：36/36 通过，`a-contracts.log`。
- 后端 A 定向控制器测试：28/28 通过，`backend-a-targeted-tests.log`。
- A5 真实 Chromium 流程：1/1 通过；包含登录、参数寄存器读取、A3/J1/J2 owner 跳转与返回、筛选、403、畸形 200、503 和恢复，`formal-owner/a5/`、`formal-owner/a5-output/`。
- 数据溯源已确认：A1 `nx_admin`/`nx_admin_account_state`/`nx_admin_security_baseline`；A2 `nx_audit_operation_ticket`/`nx_audit_operation_history`/`nx_audit_object_lock`；A3 `nx_config_item`；A4 `nx_event_schema_registry`/`nx_event_outbox`；A6 `nx_admin_role`/角色关联与授权表；A7 `nx_admin_menu`/`nx_admin_role_menu`；A8 `nx_admin_permission`/`nx_admin_role_permission`。

## 公共权限夹具

唯一成功创建的 checker：`acc_checker_114336`（ID `99531`，SUPER_ADMIN，已完成首次改密）。未创建自定义角色、授权、菜单或其他四类账号；完整状态见 `D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\A\permission-fixtures\permission-fixtures-incomplete.json`。

## 待补验范围

1. 从登录页、可见侧栏完整走 A1–A8，逐页刷新、退出重登，并采集 trace/截图/网络结果。
2. 建立 readonly、no-write、no-menu、maker 四类公共账号；真实登录后核对菜单、路由、按钮、接口和数据五层授权。
3. 重跑 A6–A8 角色、菜单、授权、A2 回放、幂等、CAS、清理及审计/outbox 链；补 A1–A4 写链、异常矩阵和 DB/A2/A4 核对。
4. 待 A Owner 完整重跑后，再交由 B 域 Agent 做非 Owner 复审。

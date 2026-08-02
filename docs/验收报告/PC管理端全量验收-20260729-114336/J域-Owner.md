# J 域 Owner 初审（Final11）

> Final11 运行基线：PC `3002` / backend `8110`、PC Build `xwL3BUki3xjXtoLr7RsWb`、后端 JAR SHA-256 `09BF09404F1F29A2110306E773C31529D3D1F835B04FAC5C34175FF8B467B66D`、DB `nexion_acceptance_20260729_114336`、Redis DB13、MinIO bucket `nexion-acceptance-20260729-114336`；MFA bypass=false。本节及 `J/final11-owner/` 为当前权威结论，后续 Final10 及更早内容只作历史参考。

## Final11 Owner 权威结果（2026-08-01）

- 静态合同：J1 `15/15`、J2 `20/20`、J3 `18/18`、J4 `25/25`，合计 `78/78`。
- 三类权限角色 `3/3`：readonly/no-write 的读取 `200`、写入 `403` 且菜单可见；no-menu 的菜单、直接路由、读取和写入均失败关闭；刷新、退出和重登后结论不变。
- J1：首次执行的业务生命周期已成功，但后台 A2 overview 因全局共享幂等调度器死锁而超时，首红 trace 原样保留并归入 `SHARED-FINAL11-IDEMPOTENCY-001 / P1`；共享阻塞消退后从真实登录和可见侧栏整模块重跑 `4/4`，覆盖五闸矩阵、unknown result 同幂等键重试、trial 关停/刷新/恢复/重登、canonical read `503` 失败关闭和可见重试。终态 `killswitch.trial=enabled`、emergency=false。
- J2 `3/3`：首次用户走查、刷新重登、国家 emergency block/limited/endpoint 派生策略临时变更与精确恢复、`503` 失败关闭和重试均通过；终态 country policy 基线为 allowed=3，endpoint 临时策略为 0。
- J3 `1/1`：真实登录/可见侧栏、30d 视图、结构化配置临时变更与恢复、`503` 失败关闭、刷新和重登均通过；终态 threshold=10、feedK4=true。
- J4 可见入口/动作目录/刷新/重登 `1/1`。专属 normal-MFA checker 的精确权限仅为 `platform_a2_read`、`platform_a2_operation_approve`、`emergency_j4_read`、`emergency_j4_playbook_execute`，精确菜单仅 A/A2/J/J4，直接 J1 接口为 `403`；checker 从可见 A2 批准并执行 maker 的 J4 operation 成功，证明 Final10 的目标域权限误拦截已在 Final11 候选中闭环。
- J4 墨菲链：独立 operation `WO-260801225227093-900` 首次 rollback 在真实 B1 低覆盖下返回 `422 COVERAGE_BELOW_REDLINE`，Genesis 保持 disabled/emergency=true；取得 J 专属 B1 令牌后只创建带 Run ID 的临时储备行，250k 同 execution 重试仍为 `422`，将同一行调整到 900k 后仍以同一 execution 重试为 `200` 并进入 `ROLLED_BACK`。随后只删除该行，储备 `count=4/net=0` 且前后哈希一致，Genesis 精确恢复为 enabled/emergency=false。
- J4 CAS/快照：operation `WO-260801230207820-200` 在 proposal 后对 playbook 版本作受控瞬时漂移，专属 checker 经可见 A2 执行得到 `409 J4_PLAYBOOK_SNAPSHOT_CHANGED`，目标动作未运行；timestamp 精确恢复后 proposal 从可见 A2 驳回。
- A2/A4/DB：Final11 精确 J4 审计 `30` 条、outbox `12` 条按不可变审计边界保留；SOP-CUSTOM-10/11 playbook/action/execution、4 张精确 ticket、26 条精确幂等记录、checker account/role/session/Redis、J pending 与活动对象锁均清理为 `0`。一次与 H 域令牌窗口重叠导致的 rollback `200` 已明确标为污染红证据，不计入通过结论，随后以独立 clean chain 重新证明 `422 → 同 execution 重试 → 200`。
- 通过链没有 pageerror、非预期 console error、非预期 request failure 或未解释的管理接口 4xx/5xx；原始 trace、截图、请求/DB/恢复证据均隔离于 `J/final11-owner/`。
- 证据固化：受限目录共 `110` 个证据文件逐文件计算 SHA-256，清单位于 `J/final11-owner/evidence-sha256.txt`，清单自身 SHA-256 为 `408B36FA47B98251110CDB176CF4031F3F4316C22146B13A0704EAAAEDB49339`；临时 checker 凭据和验收载具均已删除。最终可达性门禁为 PC `200`、匿名后端 J1 `401`，运行中 PC 的 `xwL3BUki3xjXtoLr7RsWb` build manifest 返回 `200`。

## 评分与放行

**J 域自身初审：99.4/100（严格大于 96，J 域产品范围通过）**  
**复审：未触发；须待共享 P1 关闭并重建候选后，由非 Owner 按轮换关系执行。**  
**J 域自身未关闭缺陷：P0/P1/P2/P3=0。**  
**总候选状态：HOLD；唯一已知阻塞为全局共享 `SHARED-FINAL11-IDEMPOTENCY-001 / P1`，不得据本报告签发全量通过。**

---

## Final10 及更早历史（不得作为 Final11 签发证据）

> Final9 已因关联 I3 P1 修复而失效，不能将其局部绿证签为 J 域通过。本报告以下历史段落仅保留链路与用例参考；当前权威结论是 HOLD，待 Final10 从登录和可见侧栏完整重跑 J1–J4。

## Final9 阶段交接（2026-08-01）

- 绑定 child Final9：后端 18120（PID 13668）、PC 3304、数据库 nexion_acceptance_20260729_114336_d、PC Build WF2Bg3fIWMQRSwSJCTh5E、JAR AD3EE7ED…23021215。
- J4 夹具通过真实 A1/A2 可见路径恢复：两名独立临时超管完成正常 MFA；专属 checker acc_j4_checker_114336_0801 正常 MFA 登录 2/2，其精确权限为 platform_a2_read、platform_a2_operation_approve、emergency_j4_read、emergency_j4_playbook_execute；可见菜单包含 A2/J4。
- 临时 superadmin MFA bypass 仅用于创建两名独立超管的最短窗口，已立即重启恢复；实际进程 CLI 为 --nexion.admin.mfa.temporary-superadmin-bypass-enabled=false，匿名 J4 请求仍为 401。
- CAS/Murphy 夹具结论：过期账户版本的 J4 checker 2FA 工单被后端以 409 ACCOUNT_VERSION_STALE 失败关闭，旧票通过 A2 可见路径驳回；刷新账号快照后，新 2FA 工单由不同 normal-MFA super 批准，随后重置密码、首次绑定 MFA 与二次登录均成功。checker account=99645 当前 pending=0、活动对象锁=0。
- 原始证据：D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\J\final9\bootstrap\、J\final9\checker-recovery\、J\final9\playwright\checker-recovery-r7\；凭据仅存在 restricted manifest，未写入本报告。
- 本轮 I3 关联 P1 已修复：为 i3_cap_adjust 补齐 canonical A2 descriptor 与 notification_cap:tier 精确锁、CAS 必填校验；AuditReplayBusinessPermissionGuardTest 34/34。该修复必须进入 Final10 后由 I Owner 整域重跑，亦使 Final9 J 不能评分。

## Final9 评分与放行

初审：HOLD（未评分）  
复审：未触发  
P0–P3：J 域本阶段未新增未关闭缺陷；关联 I3 P1 已修复待新候选验证。  
放行：否。Final10 必须从真实登录页、可见 J 侧栏重跑 J1–J4，覆盖权限五层、失败关闭、幂等/CAS、刷新重登、A2/A4/outbox/DB 和最终可见清理后才可评分。

---

# 历史执行链路与用例参考（不得作为 Final9/Final10 签发证据）

Run ID：`pc-full-acceptance-20260729-114336`  
范围：J1 Kill-Switch 矩阵、J2 Geo-block、J3 篡改防御监控、J4 监管点名应急 SOP。  
基线：首轮 PC Build `HciWo04kGu-p9BzkRAqW4`／后端 JAR `F1DF1420…A260`；最终候选 PC Build `sgca8V_8FEA8-6ai3edh9`／后端 JAR `BFFCE45D…A9F43F`；`nexion_acceptance_20260729_114336` / Redis DB13 / MinIO `nexion-acceptance-20260729-114336`。  
执行器：Playwright Chromium headless，`workers=1`；从真实登录页和可见“紧急与合规控制”侧栏进入。内置浏览器连接不可用，按验收方法降级为 Playwright。

## 当前结论

初审尚未评分、不可签通过。J1–J3 的已运行主链、异常和精确恢复均通过；J4 完成只读的可见入口、V4 六域动作目录、刷新与退出重登绿证。全局账号/写锁生效后，J4 maker/checker、J1/J2/J3 五层权限、J4 422→同 execution 回滚、DB/A2/A4/outbox 对账及最终清理仍待统一候选和 `J_WRITE_TOKEN` 后从登录入口重跑。

## J_WRITE_TOKEN 阶段：ENV-007 历史补录清理与暂停

- 已从真实登录页和可见 J1 侧栏读取完整矩阵快照；历史 `withdraw` 自动关停待补录以 UI 的“补录结论 → 维持关停”完成。该动作只关闭待补录，不伪称恢复业务。
- 浏览器、接口和数据库三方一致：补录后 `autoConfirmations=0`；审计 `nx_audit_log.id=59426` 为 `J1_AUTO_KILLSWITCH_CONFIRMED`，operator 为 `superadmin`，decision=`keep_disabled`，保留原 incident `J1-AUTO-a90bb857-7517-4c3d-b530-6bc94158913a`。
- 当前五闸不是可验收的干净基线：`withdraw` 仍为 disabled/emergency（历史 R1 自动关停），`exchange` 为 disabled（历史人工切换）；`staking`、`genesis`、`trial` 为 enabled。二者均属需要 B1 覆盖率前置的放大流出闸。
- B1 权威 `/api/admin/treasury/coverage` 返回 reserve=`0`、liability=`887989.56`、coverage=`0%`、redline=`100%`、`redlineBreached=true`、source=`B1 双账本`。因此 J1 UI 正确不提供可执行的恢复按钮；未修改 B1，也未绕过前置条件。
- 自动关停补录服务只写 A2 审计记录、不发布 A4 `J1_KILLSWITCH_CHANGED` outbox；数据库复核未发现本次确认派生的 J1 outbox。该缺失符合当前服务实现，不能冒充 A4 已投递。
- 按主控“无法得到 enabled/no-pending 立即停”的裁定，未继续 J1–J4 其余写链、maker/checker、J4 422/回滚、权限或临时夹具清理；待 B 域在独立令牌下恢复可信覆盖率并由主控重新发放 J 写窗口。

证据：`J/env-007/before-matrix.json`、`after-confirmation-matrix.json`、`b1-coverage-source.json`、Chromium trace/截图。新增只包含验收载具 `tests/e2e/j-env-007-baseline-cleanup-20260729.spec.ts`，未修改产品代码。

## 最终候选只读重跑（未签分）

- 候选已按主控指令切换为 PC Build `sgca8V_8FEA8-6ai3edh9`、后端 JAR `BFFCE45D…A9F43F`，服务端口为 `3002/8110`；全程使用 `J.json` 的既有受控权限夹具，Playwright Chromium `workers=1`。
- 真实登录和可见侧栏重跑：J1 首次用户矩阵与读取失败关闭/可见重试 `2/2`；J2 首次用户、刷新重登和墨菲读取故障矩阵 `2/2`；J3 空态/结构化告警与 C2 不存在用户链 `2/2`；J4 V4 可见入口、六域真调用目录、刷新和退出重登 `1/1`。所有通过证据均位于 `J/final-sgca8V/`。
- `readonly`、`menu-no-write`、`no-menu` 三种既有夹具完成 J1–J4 菜单、直接路由、按钮、接口、数据、刷新和重登五层矩阵 `3/3`：读取均为 `200` 且含数据；所有写探针均为后端 `403`，没有成功业务写。
- 静态合同在最终候选重跑为 J1 `15/15`、J2 `20/20`、J3 `18/18`、J4 `24/24`，合计 `77/77`；`tsc --noEmit` 通过。J3 首次因载具未注入 `NEXION_ADMIN_PASSWORD` 而未启动，补齐同一既有认证变量后 `2/2` 通过；这是载具环境配置缺失，不是产品失败。
- 共享主库继续保持 B1 coverage=`0%` 与现有 withdraw/exchange 闸状态，未恢复、未变更 B1、未创建业务对象。J2/J3/J4 的可逆写入主库用例本轮按“无成功业务写”约束不执行；J1 恢复链明确留在具备独立账本与恢复前置的 child 环境，不能在当前共享库绕过 coverage 门禁。故本段只补足可见、刷新重登、权限和故障证据，不替代受阻的可逆写链，也不签分。

### 角色快照后的重新执行门

- 此前 `J/final-sgca8V/permission/` 的权限绿证早于 `A/domain-permission-fixtures/safe-role-summary.json.generatedAt=2026-07-29T06:56:05.283Z`，不能作为角色双人批准后的最终证据。
- 使用 15:56 生成的新 `J.json` 从登录页实际重跑后，`readonly` 和 `menu-no-write` 已通过；`no-menu` 在载具旧假设处红灯：真实 session 的 `authorities=[]`、`effectiveMenus=[]`。权威角色快照也记录该账号为 `unassigned`、`0 authority`、`0 menu`。
- 主控已裁定 no-menu 采用 fail-closed B：侧栏/直接路由拒绝，J1–J4 的读取与写入 API 均应为 `403`。现有 J 载具仍错误要求 no-menu 拥有 J-read 且读取 `200`，故不能把此次红灯记录成产品缺陷，也不能沿用旧绿证。红证据保留于 `J/final-sgca8V/permission-post-roles-1556-output/`；由轮换 K 修复载具后，Owner 将从真实登录入口完整重跑并更新本报告。
- 轮换 K 修复后，使用同一份 15:56 `J.json` 的 `readonly`、`menu-no-write`、`no-menu` 三个角色从真实登录入口完整重跑已绿 `3/3`：前两者 J1–J4 读取 `200` 含权威数据、写探针 `403`；no-menu 的菜单/直链/读/写均 `403`，刷新与重登后仍失败关闭。新证据为 `J/final-sgca8V/permission-post-roles-1604/` 与对应 trace 输出目录。
- maker 的独立无写可见遍历补充载具在 MFA 阶段收到 `401 ADMIN_MFA_CODE_REPLAYED`（多次跨时间窗均一致），未发出任何业务命令。该代码代表有效 TOTP counter 已被并发会话占用，不能通过重放或重置 MFA 绕过；保留 `J/final-sgca8V/maker-post-roles-1615/` 红证据，待主控分配未被同时使用的登录窗口或独立 maker 后补验。
- 主控随后在下一标准 TOTP 时间步建立新的 password challenge 并完成 maker 的真实无写走查 `1/1`；未修改 MFA replay 防护、未重放旧验证码、未重置账号。认证 POST 已从 mutation 观测中正确排除，业务写为 `0`；maker 从可见登录/侧栏遍历 J1–J4，逐页刷新并退出重登均通过。绿证位于 `J/final-sgca8V/maker-post-roles-root-final/playwright/`。

## 最终候选 ODaNTve 无写 Owner 重跑（未评分）

- 候选：PC Build `ODaNTve-ln2-d4L6DPMKG`，后端 JAR `55B9E011…82CE6`。以当前 `J.json`、Chromium `workers=1` 从真实登录和可见侧栏执行，证据根目录为 `J/final-ODaNTve/`。
- 四账号无写证据：readonly、nowrite、nomenu 的 J1–J4 五层权限、刷新及重登 `3/3` 通过；maker 的无写可见遍历 `1/1` 通过。maker 遇到 `ADMIN_MFA_CODE_REPLAYED` 时只等待下一 30 秒标准 TOTP 时间步，再创建新的 password challenge；未重放、重置或削弱 MFA 防护。所有认证 POST 均排除在业务 mutation 之外，业务成功写 `0`。
- 主链/墨菲证据：J1 可见矩阵、未知结果同键重试、读取失败关闭/可见重试 `3/3`；J2 首次用户/刷新重登及读取故障失败关闭 `2/2`；J3 真实空态和 C2 不存在用户链 `2/2`；J4 可见入口、六域动作目录、刷新和重登 `1/1`。J1 恢复链未在共享主库运行，未改变 B1 coverage 或任何现有闸状态。
- 静态：J1 `15/15`、J2 `20/20`、J3 `18/18`、J4 `24/24`，合计 `77/77`；`tsc --noEmit` 通过。J3 过度语法断言已由主控仅调整测试合同，使其匹配先以 `?? []` 归一后的 `authorities.includes(...)` 安全权限检查；本 Owner 已复跑 J3 合同确认 `18/18`。无运行时代码放宽。受共享主库的 J1 恢复链/可逆写链仍留 child 环境限制，本轮仍不评分、不签全域。

## 已完成的真实证据

## 可销毁 child 的 J1 不可逆链（未评分，服务保留）

- 主环境 `8110/3002`、主库、Redis DB13 均未触碰。child 固定为同一最终候选：后端 `18110`（PID `20408`，JAR SHA-256 `55B9E011088B341738A656FC5C0BA1A8D53D105BAD2D37B7C6113B8039882CE6`），PC `3302`（PID `15104`，Build `ODaNTve-ln2-d4L6DPMKG`）；资源状态记录于 `J/child-final-ODaNTve/child-resources.json`。child 使用独立数据库 `nexion_acceptance_20260729_114336_irreversible`、Redis DB15 和独立 MinIO bucket `nexion-acceptance-20260729-114336-irreversible`，保留供 K/H 后续验收。
- 未认证边界：PC BFF 与后端的 J1 `GET /api/admin/emergency/kill-switches` 均为 `401`；响应证据保存在 `unauth-j1-body.json` 与 `unauth-backend-j1-body.json`。健康端点同样受认证保护，未把 `401` 误记为服务不可达。
- 为复用 K3 的 J1/B1 守卫载具，仅在 child 基线将历史已确认的 withdraw 自动确认元数据还原为“待补录”形态；随后先在 B1 coverage=`0%` 下验证恢复被正确拒绝为 `422 COVERAGE_BELOW_REDLINE`，再插入带 Run ID 的 child-only 储备夹具使 coverage=`105%`，完成 withdraw 恢复路径。载具的 finally 精确恢复：withdraw=disabled、emergency=true、pending=true、储备夹具=0、三条 `k3-j1-*` 幂等记录=0。
- 该守卫载具的嵌套 K3 套件在无关 K4 App 凭证登录处收到 `USER_CREDENTIAL_INVALID`，故整个 K3 载具不可报绿；J1/B1 前置、`422` 拒绝和 finally 恢复已有独立 DB 复核，记录为关联域环境/凭证阻塞，不冒充 J1 产品失败或完整 K3 通过。
- 真实登录和可见 J1 侧栏的 child 浏览器链 `3/3`：未知结果保持弹窗并以同一幂等键重试；trial 关停→刷新→恢复→退出重登；读取 `503` 时失败关闭且可见重试恢复。没有使用隐藏 URL、mock、DOM 修改或 localStorage 权威态。
- 数据核对：child `nx_audit_log` 留有 `J1_KILLSWITCH_TOGGLED` 与 `J1_COVERAGE_RESTORE_BLOCKED` 审计；A4 outbox 留有 `J1_KILLSWITCH_CHANGED` 的 PENDING 事件。浏览器链结束后当前 child 设置为 trial=enabled、withdraw=disabled、withdraw emergency=true、auto-confirm pending=true，与恢复后基线一致。原始 trace、截图、接口、B1 快照和 guard 输出均隔离在 `J/child-final-ODaNTve/`。
- 结论：J1 的可逆恢复链在独立环境已证明低覆盖失败关闭、达标后可执行、未知结果同键重试、审计/outbox 可追溯和精确恢复；但嵌套 K3 的 K4 凭证阻塞尚未解除，且 child 仍供后续域使用，因此不评分、不签发 J 域或全量通过。

| 模块 | 从可见入口的实际结果 | 证据 |
|---|---|---|
| J1 | 五闸矩阵可发现；未知结果保留确认框且同一幂等键重试；真实 trial 关停→刷新→恢复→退出重登保持在线；503 时清空矩阵、隐藏控制并可见重试恢复。 | `J/J1-owner/`，核心截图 SHA256：`FA0438D2…D9CB`、`B53F1B41…B5C`、`A9197567…591`、`89FAE4A7…DAB`；trial trace `E77D4E59…586`。 |
| J2 | 登录/侧栏/刷新重登；隔离国家 emergency block、limited 列表和端点派生策略均由可见控件写入并恢复；503 注入失败关闭后真实重新读取恢复。 | `J/J2-owner/`，三条 Chromium 流程 `3/3`；写入恢复 trace `80522F3B…B2E`，503 trace `E9404F55…D89`。 |
| J3 | 30d 窗口刷新保持；阈值结构化校验、临时变更、刷新核验、精确恢复；503 注入隐藏写入口后可见重试；退出重登、匿名写 401 通过。 | `J/J3-owner/`，主 trace `9E746249…C7A`，浏览器结果 `085E747A…047`。 |
| J4 | 真实登录→可见 J 侧栏→J4；页面展示 A2 双人复核门和 `J1/J2/C2/K1/I3/I5` 六域动作，刷新、退出重登无降级。J4 V4 只读载具修复后 Chromium `1/1`。 | `J/J4-owner-read-fixed3/`，绿 trace `345BC132…4B9`。 |

静态合同：J1–J4 合计 `77/77` 通过；J4 定向合同 `24/24`，`tsc --noEmit` 通过。静态结果只用于链路追溯，不替代待补的权限和双人闭环。

## J4 验收载具缺陷与最小修复

- 红证据已保留：旧 J4 V4 helper 将 Chromium 已消费、不可再读取的 HTTP 200 登录响应 JSON 当作必须含顶层 `code`，并把合法 RSC/客户端缓存误判为“点击侧栏后必须再发一次 GET”。
- 修复仅限 `tests/e2e/j4-v4-post-deploy-acceptance.spec.ts`：登录以 HTTP 200 后真实可见 MFA/控制台转场为准；J4 仍必须经可见登录和侧栏进入，以页面上的双人复核门、六域真实动作目录、刷新及重登验证运行态，不再把合法缓存当失败。
- 修后绿证：Chromium `1/1`（13.9s）；未通过直接 API 或隐藏 URL 替代用户入口，未执行任何 J4 写操作。

## 数据溯源与关联域

| 模块 | 前端/接口 | 后端与权威记录 | 关联 |
|---|---|---|---|
| J1 | `j1-killswitch.tsx` → `/emergency/kill-switches` | `OpsKillSwitchService`、`nx_emergency_control_setting`、审计/outbox | B1 覆盖率、D2 提现、G staking/exchange/genesis、H2 trial、A2/A4 |
| J2 | `j2-geoblock.tsx` → `/emergency/geo-block` | `OpsEmergencyControlService`、Geo policy、`nx_geo_block_event` | App 资金/奖励入口、A2/A4 |
| J3 | `j3-tamper.tsx` → `/emergency/tamper/overview`、alert-config、reports | tamper event/report、`nx_config_item` | C2、K1/K4、B5、A2/A4 |
| J4 | `j4-sop.tsx` → `/emergency/sop/playbooks` | playbook/action/execution、A2 operation/lock、审计/outbox | J1/J2/C2/K1/I3/I5、B1、A2/A4 |

## 待补矩阵与清理门

- A 公共权限夹具就绪后：readonly/no-write/no-menu 覆盖菜单、路由、按钮、接口、数据五层权限；J4 maker/checker 必须为不同运营员。
- 获得 `J_WRITE_TOKEN` 后：J4 专用可逆 Genesis 剧本→maker 提案→checker 执行→低覆盖 422→同 execution 达标回滚→J1 恢复；核对 B1、A2、A4/outbox、审计、CAS、同键重放和未知结果。
- 对 J1/J2/J3 的每项高风险载具，复查运行前后快照，清除 Run ID 的国家策略、配置、SOP/执行、A2 工单/锁、临时账号/角色/会话、幂等与可变夹具；不可变审计/outbox 按边界保留。
- 统一候选重启后，从可见登录入口完整重跑 J1–J4；仅在未关闭 P0/P1/P2/P3 为 `0/0/0/0` 且初审严格大于 96 后评分。

## J2/J3/J4 借用 D child 的串行载具（仅准备，未执行）

- 已锁定借用接口：`nexion_acceptance_20260729_114336_d`、后端 `18120`、PC `3303`、JAR `D1D33E7…540E`、Build `nf0qGeqytfzJ1e_lX9TMR`。主库 `nexion_acceptance_20260729_114336` 明确禁写。
- 新增 J2/J3 unknown/CAS/幂等载具：真实后端先提交，再向浏览器合成 `X-Nexion-Upstream-Outcome: unknown`；只允许原 key 重放，同 key 异体和旧 expected state 必须 409，finally 只在状态等于本载具预期时精确恢复，遇并发漂移立即失败关闭。
- J2 原载具现支持既有 MFA seed 的进程内注入；J3 原载具现支持 MFA 和动态 child `baseURL`。三个 J2/J3 文件经 `playwright --list` 发现 8 条用例，`tsc --noEmit` 通过。
- J4 固化为两阶段：maker/checker+A2 执行后先取得 `422 COVERAGE_BELOW_REDLINE` 并锁定 execution ID；暂停并由主控重新发放 `B1_COVERAGE_LOCK`，coverage Owner 只在 child 提高覆盖率；随后仅重试同一 execution 并恢复 Genesis。禁止新 execution、复用 D idempotency key 或绕过 B1。
- DB 核对脚本已覆盖 J2/J3 前镜像、A2 audit、A4/outbox、幂等状态、J4 execution、pending ticket、object lock 和 Genesis 恢复；不可变 audit/outbox/execution 保留。
- D Owner 当前仍持锁且尚未释放。其 clean handoff 要求为 D 全波次和补偿完成、净资金变化 0、coverage/reserve/liability/config/账号/KYC/J gate/session 恢复、无 pending A2/unknown/object lock、child 服务停止和 DB 连接 0，之后由主智能体重新启动并发放 `J_WRITE_TOKEN`/`B1_COVERAGE_LOCK`。
- 交接包：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\J\child-j234-D-handoff\`。本阶段只创建载具和只读校验，J2/J3/J4 child 成功写为 `0`，主库写为 `0`；因此仍不评分、不签发。

## J child 后续波次门禁加固（取代上一节的旧候选绑定）

- J 的执行顺序现锁定为 `B → G2 → C → J`。B 尚未释放时禁止进入；B 完成后仍必须等待 G2 和 C 各自完整执行、独立 finally 与清理，再由主控把同一 child 独占释放给 J。
- 旧 `D1D33E7…540E / nf0q…` 只保留为历史准备事实；当前观测到的 `B426C1…F954B3B / xNJR-cEeID2fPRwrRvOrb` 也不构成执行授权。正式执行只接受 post-B/G2/C 的 root 签名 release、分层 baseline hash、资源 hash、JAR、Build、PID 和 `bypass=false`。
- B 已保留 `b2-pc-full-acceptance-20260729-114336-`、`b3-pc-full-acceptance-20260729-114336-`；G2/C 前缀必须在 release 中补齐。J Run ID 与任一前序前缀重叠即失败关闭。
- 新增独立 finally：在 J 主波次之外使用单独的 `J_INDEPENDENT_FINALLY_TOKEN`；J4 仍需新 `B1_COVERAGE_LOCK`。独立载具保存 J2 blocked/limited/endpoints/edge、J3 threshold/feedK4、Genesis 前镜像；失败路径先重试同一 J4 execution，再逐字段恢复并核对 pending A2、对象锁和 unsettled idempotency 为 0。
- `Verify` 被硬门禁为必须先通过 `IndependentFinally`。不可变 audit/outbox/execution 保留，不以删除证据冒充恢复。
- 当前仍为静态准备：没有启动浏览器或服务，没有访问 API/DB/Redis/MinIO，环境写入 `0`、业务代码修改 `0`；J 域继续不评分、不签发。

## G2 handoff 后的 baseline 纠偏

- G2 尚未执行，也未释放 D child；J 当前标志只能是 `NOT_RELEASED`。不得因为 `18120/3303` 可达、旧 manifest 存在或已知 Build/JAR 就启动。
- G2 的预期最终态是 tightened fee 成功保留、放松回滚按真实 below-redline coverage 返回 422。该 fee/coverage/reserve/liability 是后续 C 清理后交给 J 的继承 baseline，不要求回到 G2 前值。
- J 禁止复用任何 `pc-full-acceptance-20260729-114336-g2-*` command key，禁止读取/转发 lease token，禁止 SQL 修改 B1/G2。
- J4 若需达线回滚同一 execution，只能在 root 新签 `B1_COVERAGE_LOCK` 后由 coverage Owner 通过真实产品路径临时调整；主控若不授权该动作，则只保留 422 证据并停止，不能签发 J4 完整通过。
- J4 恢复 Genesis 后，coverage Owner 还必须通过产品路径补偿回 G2 继承 baseline，并提供 before/after hash、资金值、`directSqlWrites=0`、`g2FeeChanged=false`、pending/lock/unknown=0。独立 finally 在该 handoff 通过前失败关闭。

## 失败清理与正式复跑门禁（静态补强，未执行）

- 当前 release 状态明确为 `NOT_RELEASED_WAITING_B_G2_C`；只有 B=`COMPLETED_CLEAN`、G2=`COMPLETED_BASELINE_RETAINED`、C=`COMPLETED_CLEAN_TO_G2_BASELINE` 且 root 新签 `status=G2_RELEASED_TO_J` 的独占 J lease 后才可运行。G2 tightened fee、真实 below-redline coverage/reserve/liability 是继承 baseline，不回退到 G2 前值。
- 复核发现原 J2/J3/J4 单载具的局部 `finally` 不能覆盖所有中断点：J2 在 endpoint 变更后异常、J3 在配置写后异常、J4 在 proposal/approval/rollback 任一点异常，都可能在主用例红灯后留下可变状态。现由 API 前镜像和独立恢复载具兜底 J2 blocked/limited/endpoints/edge、J3 threshold/feedK4。
- 新增失败专用 `EmergencyCleanup`。它先恢复 J2/J3；J4 仅停在 `A2_PENDING` 时，由不同 checker 从可见 A2 精确驳回同一 operation。J4 已批准或已生成 execution 后，清理载具拒绝替代 execution、SQL 调账或盲切 Genesis，必须由主控授权同一 execution 回滚，并由 coverage Owner 通过真实产品路径补偿回 G2 继承 baseline。
- `EmergencyCleanup` 永远写明 `ownerAcceptanceSigned=false`、`verifyUnlocked=false`，不能生成成功签发文件；正式 `Verify` 仍只接受完整 `IndependentFinally`。因此当前无 runtime 绿证、无评分、无 J 域通过结论。
- 所需夹具固定为 `A/domain-permission-fixtures/J.json` 的 maker、独立 checker、readonly、nowrite、nomenu；maker/checker 必须为不同 canonical 账号并具 MFA。运行令牌为 root 新签 `J_CHILD_RELEASE_MANIFEST`、成功写阶段 `J_WRITE_TOKEN`、J4 新 `B1_COVERAGE_LOCK`、独立清理 `J_INDEPENDENT_FINALLY_TOKEN`，值均不得落盘。

# J 域 Owner 验收报告

- Run ID：`pc-full-acceptance-20260728-151023`
- 范围：J1–J4（4/4 模块）
- 验收方法：`D:\nexion\页面业务逻辑通顺性验收方法.md`
- 最终候选：PC Build `FL6den7TMkSYQjxGFfpkR`、PID `16912`；后端 PID `4476`、JAR SHA256 `DCA3841B0099723B0C1BE49A703681FEF276F4C691BCBC8B914C11F18589208F`
- 隔离数据库：`nexion_acceptance_20260728_151023`
- Owner 结论：**J1–J4 4/4 通过；J 域未关闭产品缺陷 0；测试业务夹具、A2 工单、活动锁、幂等记录和临时资金残留 0**

## 逐模块结论

| 模块 | 页面、接口与权威来源 | 主流程与恢复 | 权限、异常及跨域链 | 结论 |
|---|---|---|---|---|
| J1 Kill-Switch | `/api/admin/emergency/kill-switches`；`nx_emergency_control_setting`、B1 coverage、`nx_audit_log`、`nx_event_outbox` | 五门真实读取；trial 关闭/恢复；Genesis 经 J4 关闭，低覆盖拒绝恢复，达标后恢复；刷新、退出重登均保持权威真值 | 读取/关闭/恢复/批量关闭精确分权；匿名 401、无权 403、低覆盖 422、503 和畸形 200 失败关闭；同键未知结果不重复改变 gate | **通过** |
| J2 Geo-block | `/api/admin/emergency/geo-block`；国家/端点策略、block event、control setting | 国家 emergency block、limited/allowed 切换、端点国家策略变更及精确恢复；刷新重登 | country/list/endpoint/edge/emergency-block 分权；服务端业务入口强制；A2/A4 审计可见 | **通过** |
| J3 篡改防御 | `/api/admin/emergency/tamper/overview`、alert-config、reports；tamper event、report、control setting | 24h/7d/30d、分页、脱敏 CSV、阈值与 K4 feed 临时变更/恢复；刷新重登 | 配置与导出分权；匿名 401；503/畸形 200 清空旧快照并隐藏写入口；账户处置只读 | **通过** |
| J4 应急 SOP | `/api/admin/emergency/sop/playbooks`；playbook/action/execution、A2 ticket/lock、J4/J1 审计 | 六域真动作目录；新增、演练、maker 提案、独立 checker 执行、逐步追溯；低覆盖 422 后同 execution 达标回滚 200 | J4 write/execute、J1 target authority、A2 proposal 五层分权；软删除编号不复用；rollback 使用独立新事务；J4→J1→B1→A2/A4 双向事件闭环 | **通过** |

## 按十步验收方法执行

1. 以 `lib/nav/console-nav.ts` 的 J1–J4 为唯一范围，盘点读取、筛选、配置、关停、恢复、演练、提案、执行、追溯与回滚。
2. J1 以 canonical gate setting 和 B1 coverage 为真源；J2 以国家/端点服务端策略为真源；J3 以拦截事件、报告和配置为真源；J4 以 playbook/action/execution、A2 与 J1 gate 为真源。
3. 所有主流程从登录页、MFA 和可见侧栏进入真实 Chromium；未使用 mock、localStorage 权威数据或 DOM 修改。
4. 覆盖首轮、合法空态、取消、刷新、返回、退出重登；所有临时业务变更均恢复原值。
5. readonly、no-write、no-menu、maker/checker 覆盖菜单、路由、按钮、接口、数据五层权限。
6. 覆盖 401/403/404/409/422/503、畸形 200、超时和结果未知；失败时不继续暴露旧数据或写入口。
7. 覆盖持久幂等、同键异载荷、CAS、双运营员、maker/checker 分离和 ownership token。
8. 核对状态、数据库、A2 审计、A4/outbox 及 B1/J1/J4 上下游一致性。
9. 精确删除 Run ID 资金夹具、SOP、执行、工单和幂等记录；不可变审计/outbox 保留。
10. 在最终 Build/JAR/PID 未漂移条件下完成 Owner 初审并裁决通过。

## 缺陷闭环

| 编号 | 模块 | 根因与修复 | 最终复验 |
|---|---|---|---|
| J-001 | J4 | 新编号只查看活动剧本，复用受唯一键约束的软删除编号；仓储改为跨活动/软删除行取最大序号 | 成功创建 `SOP-CUSTOM-10` 并演练；J4 合同 23/23，关闭 |
| J-002 | J4→J1/B1 | rollback 默认加入外层幂等事务，B1 业务拒绝把外层标为 rollback-only，提交时变成 500；rollback claim/CAS、J1 恢复及完成元数据改用 `REQUIRES_NEW` | 同一 execution 低覆盖稳定返回 422，ownership 保留；达标后 200 回滚且 Genesis 恢复，关闭 |
| J-003 | J4→J1/A4 | J4 恢复绕过 linked-domain 的统一广播与审计 | `recordLinkedGateChange` 统一关闭/恢复事件边界；最终审计 `47102/47488`、outbox `8611/8625` 分别覆盖 `true→false` 与 `false→true`，关闭 |
| J-AUTO-001 | J4 载具 | stale replay SQL 固定日常库 | 数据库名参数化并锁定专库，关闭 |
| J-AUTO-002 | J3 载具 | 证据目录固定旧 Run | 使用 `J3_EVIDENCE_DIR` 路由受限目录，关闭 |
| J-AUTO-003 | J4 MFA 载具 | 未等待 MFA，且复用已消费 challenge/TOTP | 新 challenge + TOTP step 棘轮，maker/checker 多次登录通过，关闭 |
| J-AUTO-004 | J4 A2 夹具 | maker 漏 `platform_a2_proposal_create` | superadmin 提交权限变更、独立 checker 批准，新会话核对，关闭 |

## J-003 最终运行证据

- execution：`SOP-CUSTOM-10-9245E8BD`。
- 低覆盖轨：真实 `POST rollback` 返回 `422 COVERAGE_BELOW_REDLINE`；Genesis 保持 `enabled=false/emergency=true`；审计 `47184 J4_SOP_PLAYBOOK_ROLLBACK_REJECTED`，无 `/api/admin/*` 5xx。
- 达标轨：插入唯一隔离 reserve 后，对同一 execution 重试真实 rollback 返回 200；execution 进入 `ROLLED_BACK`，Genesis 恢复 `enabled=true/emergency=false`。
- 双事件：J1 审计 `47102`（`true→false`）与 `47488`（`false→true`）；A4/outbox `8611` 与 `8625` 均为 `J1_KILLSWITCH_CHANGED`，关闭与恢复完整对称。
- 清理后最终可见入口、刷新、退出重登 `1/1` 通过。
- 422 trace SHA256：`ED9B65D86CF5E1FBA09F08F97477E3ABBCDFEC895363F9CC91D2352566AD0DEB`。
- 200 trace SHA256：`27354D9F8B4A3F693190B6B4C340D27110EC832B0B00516935C1B4F00E30A582`。
- 清理后可见入口 trace SHA256：`C635D518C30FC34039A7038A6FF4EEB3F8952EF1FEBFB1D91EFFADCA47937C12`。

受限证据位于 `D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260728-151023\J`，不进入 Git。

## 质量门与清理

- J 静态合同：J1 `15/15`、J2 `18/18`、J3 `18/18`、J4 `23/23`，合计 `74/74`。
- J1 主流程 `4/4`；J2 主流程 `1/1`；J3 独立走查 `1/1`；J4 读取 `1/1`。
- 权限轨：setup `1/1`、readonly/no-write/no-menu `3/3`；maker A2 权限补齐 `1/1`。
- J4 maker→checker→追溯→B1 422 `1/1`；同 execution 达标回滚 `1/1`；清理后可见入口 `1/1`。
- J-002/J-003 后端定向测试 `2/2`；PC TypeScript 与 Playwright collection 通过。
- 最终候选全量质量门继承主智能体锁定结果：Maven `2825` 项通过；PC `verify 18/18` 与生产构建通过。
- 清理：临时 reserve 删除 `1` 行，恢复为活动 `2` 行、净额 `0.000000`、marker `0`；`SOP-CUSTOM-10` playbook/action/execution 残留 `0/0/0`；A2 ticket/lock 残留 `0/0`；J 验收幂等残留 `0`。不可变 audit/outbox 保留。
- 服务未漂移：PC Build/PID `FL6den7TMkSYQjxGFfpkR/16912`；后端 JAR/PID `DCA3841B…208F/4476`。

## 评分与裁决

- Owner 初审：**99.1/100，超过 96 分，通过**。
- 扣分：0.9 分；原因是最终破坏性链第一次在第三次登录等待响应时发生验收载具超时。该次未发起回滚请求，随后沿用同一 execution 在新浏览器上下文完成 422→200→恢复→清理闭环，未形成产品缺陷或残留。
- J 域最终裁决：**4/4 模块通过，P0/P1/P2/P3 未关闭为 0/0/0/0**。
- 当前血量：**100/100**。

> 非 Owner 复审分由轮换复审者 K 域 Owner 独立出具，本报告不代替复审结论。

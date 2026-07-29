# J 域非 Owner 复审报告（I→J）

## 1. 裁决

- Run ID：`pc-full-acceptance-20260728-151023`
- 复审角色：I 域 Owner 轮换复审 J 域
- 范围：J1 Kill-Switch、J2 Geo-block、J3 篡改防御、J4 应急 SOP
- 锁定 PC：Build `wFMibyXH-QAZp3csVOjUx`，PID `6060`
- 锁定后端：JAR SHA-256 `2DD86F9B409761C2274CCF08D9BAB670BCB5F78822547C0AC2E4351149713E79`，PID `10992`
- 数据库：`nexion_acceptance_20260728_151023`
- Redis：DB 14
- 结论：**J1–J4 4/4 通过；未关闭产品缺陷 0；本轮业务、权限、资金和缓存残留 0**
- 非 Owner 复审评分：**99.1 / 100，通过**

本次没有复用 J Owner 的认证状态或模块结论。统一候选重建后，使用新浏览器上下文从登录页和可见侧栏重新执行模块主轨、权限轨、故障轨和高风险 maker/checker 轨。

## 2. 逐模块结论

| 模块 | 首次用户与主流程 | 权限与异常攻击 | 权威状态及跨域链 | 结论 |
|---|---|---|---|---|
| J1 Kill-Switch | 五个业务闸从可见侧栏读取；trial 真实关闭、刷新、退出重登和恢复；最终 Genesis/trial 为 enabled、withdraw 为 disabled | readonly/no-write 无写按钮且写接口 403；no-menu 菜单和直达路由拒绝；unknown 结果保留表单并复用命令键；503 失败关闭后可见重试恢复；Genesis 低覆盖恢复真实返回 422 | `nx_emergency_control_setting` 与 B1/B5 同源；J4 两次关闭/恢复均生成对称 J1 审计和 A4/outbox | **通过** |
| J2 Geo-block | 黑名单、受限名单、端点派生均由可见控件真实变更并完整恢复；首轮、刷新、返回、退出重登通过 | readonly/no-write 页面无写入口且绕过写入 403；超管告警读取对只读角色 403；503 时隐藏控制项并失败关闭；国家和状态校验拒绝非法输入 | 页面、接口、Geo 策略与最近变更审计一致；App 资金和奖励边界的受限策略由合同棘轮覆盖；本轮动态账号、角色、A2 工单和幂等记录已清零 | **通过** |
| J3 篡改防御 | 24h/7d 窗口、分页、刷新、返回和重登保持；空态诚实；有结果时只允许真实脱敏 CSV | 匿名写入 401；readonly/no-write 写接口 403；告警配置按 expected snapshot 执行；503 后页面失败关闭且恢复读取；畸形和未知结果由运行时合同阻断 | threshold=`10`、feedK4=`true` 完整恢复；J3→C2/K1/K4/B5 深链参数和服务端来源由合同及页面入口双查 | **通过** |
| J4 应急 SOP | V4 返回 J1/J2/C2/K1/I3/I5 六个真执行域；新增专用 Genesis 剧本、演练、maker 提案、独立 checker 执行、逐步追溯和刷新重登通过 | 五层权限通过；低覆盖时同一 execution 回滚稳定返回 422，Genesis 保持关闭且 ownership 不丢失；隔离 reserve 达标后同 execution 回滚 200；无 `/api/admin/*` 5xx | 最终锁定轨 execution `SOP-CUSTOM-11-2A839FC1`：A2 双人复核→J4→J1→B1→A4 完整；审计 `55361–55366、55395–55396`，outbox `8866/8868`；专用 SOP、execution、ticket 和 reserve 已精确清理 | **通过** |

## 3. 验收方法十步执行结果

1. 页面与动作：以 `lib/nav/console-nav.ts` 的 J1–J4 为范围真源，逐页核对读、写、导出、演练、执行和回滚入口。
2. 数据溯源：核对 `nx_emergency_control_setting`、Geo 策略、J3 报告/配置、SOP playbook/action/execution、A2、B1、A4/outbox。
3. 真实浏览器：所有模块均从 `/` 登录页和可见侧栏进入；未直接改 DOM，未把 mock 或 localStorage 当权威数据。
4. 用户流程：完成首轮、刷新、返回、退出和重新登录；空态、失败态和恢复入口均可理解。
5. 五层权限：`j_readonly`、`j_no_write`、`j_no_menu` 三夹具共 `3/3`；覆盖菜单、路由、按钮、接口和数据。
6. 异常矩阵：匿名 401、无权 403、未知资源 404/合同棘轮、幂等/CAS 冲突 409、业务校验/覆盖红线 422、服务端 500/503、超时、畸形 200 和 unknown 均按失败关闭处理；本轮主调用 5xx 为 0。
7. 并发与幂等：J1 unknown 同键重试、J2 expected snapshot、J3 stable mutation、J4 A2 maker/checker 和同 execution 低覆盖→达标重试均通过；同键异载荷、stale CAS 和重复副作用由 77 条最终静态/运行时棘轮覆盖。
8. 数据与事件：两轮 J4 execution 的关闭/恢复均有 `J1_LINKED_DOMAIN_GATE_CHANGED` 和 `J1_KILLSWITCH_CHANGED`；J4 执行、拒绝和回滚审计与最终 Genesis 真值一致。
9. 精确清理：只按本轮账号 ID、SOP code、execution ID、A2 operation ID、幂等记录 ID 和唯一 reserve marker 清理；不可变 audit/outbox 保留。
10. 裁决：四模块独立通过，未用域级结果替代模块结果。

## 4. 最终质量门

| 质量门 | 结果 |
|---|---:|
| J1 合同 | `15/15` |
| J2 合同 | `20/20` |
| J3 合同 | `18/18` |
| J4 合同 | `24/24` |
| 五层权限 | `3/3` |
| J1 最终浏览器轨 | `4/4` |
| J2 最终浏览器轨 | `5/5` |
| J3 最终浏览器轨 | `1/1` |
| J4 首次用户读轨 | `1/1` |
| J4 maker→checker→追溯→B1 422 | `1/1` |
| J4 同 execution 达标恢复 | `1/1` |
| J4 清理后可见入口 | `1/1` |
| 页面未处理错误 | `0` |
| `/api/admin/*` 主调用 5xx | `0` |

## 5. 高风险闭环与恢复

- 最终专用剧本：`SOP-CUSTOM-11`。
- maker：J 域独立 maker；checker：A 域独立 `d_checker`；二者不是同一账号。
- execution：`SOP-CUSTOM-11-2A839FC1`。
- 低覆盖轨：真实回滚返回 `422 COVERAGE_BELOW_REDLINE`；Genesis 保持 `disabled`，无 500。
- 达标轨：插入唯一 reserve `RSV-J4-NONOWNER-I-WFM-20260729`，金额 `932389.05`，对同一 execution 重试回滚 200。
- 恢复结果：Genesis=`enabled`；reserve 精确删除 1 行；资金基线恢复为活动 2 行、净额 `0.000000`。
- 双向事件：关闭和恢复共 4 条 `J1_KILLSWITCH_CHANGED` outbox，最终轮为 `8866/8868`；J4/J1 审计与执行状态一致。

## 6. 缺陷与修复

未发现新的产品缺陷。发现并关闭两类验收载具缺陷：

| 编号 | 级别 | 复现与根因 | 修复与复验 |
|---|---|---|---|
| J-AUTO-005 | P2 | J2 临时账号清理未传 A1 最新 `expectedVersion`；创建账号后错误地使用 caller 提供的 `initialPassword`，而后端只认返回的 `temporaryPassword` | 清理按最新版本依次 reset-2fa、解除角色、停用、撤销会话；登录改用服务端一次性密码；合同红灯后 `20/20`，最终 J2 `5/5` |
| J-AUTO-006 | P2 | J4 checker→maker 切换后新账号 shell 已出现，但 helper 在 2 秒窗口后仍强等用户名输入，误报登录失败 | helper 在登录入口缺失时继续识别已认证 shell；合同红灯后 J4 `24/24`，全新上下文 maker/checker 完整轨通过 |

两项均只修验收载具，未改产品运行代码。

## 7. 最终残留与候选指纹

- J2 本轮动态账号：`0`
- J2 临时活动角色：`0`
- J4 临时 playbook/action/execution：`0/0/0`
- J4 A2 ticket/mutex：`0/0`
- J 本轮幂等记录：`0`
- 唯一 reserve marker：`0`
- Redis DB14 按 Run ID、账号 ID/用户名、SOP code、reserve marker 扫描：`0`
- J1/J3 配置恢复：Genesis=`enabled`、trial=`enabled`、withdraw=`disabled`、J3 threshold=`10`、feedK4=`true`
- PC Build/PID 结束时仍为 `wFMibyXH-QAZp3csVOjUx / 6060`
- 后端 JAR/PID 结束时仍为 `2DD86F9B…3E79 / 10992`

## 8. 证据

受限证据根目录：

`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260728-151023\J\non-owner-I\final-wFMibyXH-QAZp3csVOjUx`

关键证据：

- 权限 JSON：`permission\*.json`
- 权限 trace：`permission-playwright`
- J1 最终 trace：`J1-playwright`
- J2 最终截图、摘要和 trace：`J2`、`J2-playwright`
- J3 最终 trace：`J3-rerun-playwright`
- J4 完整 maker/checker trace：`J4-maker-checker-full-rerun-playwright`
- J4 同 execution 恢复 trace：`J4-maker-checker-full-rerun-recovery-playwright`
- J4 清理后读轨：`J4-post-cleanup-read-playwright`

关键校验值：

- J4 maker/checker trace：`347122D8D1705BBBA4FD8ADCE6FACC6BB9E6A1DBA741CE7C02D138A9611B72CC`
- J4 达标恢复 trace：`FF0B9E4ED99CF605058A5905FAEC57B5DDE3C6367CEED4072AB1E496F4BF7E3D`
- J4 清理后读轨 trace：`ACB5D8BFD31F493911F28A6F4E00800130E81A930E6F1B7BAA2246B87065A147`
- readonly 权限 JSON：`2824C0967D877F4B5FD812D7243322DD937CA9330D4C55835A75AE492AD78368`
- no-write 权限 JSON：`D7BD5C2C670B2C87C2F4DB8BB251D36A549B9D5DEC4F52F4ACF8A65F7862945A`
- no-menu 权限 JSON：`FE5782617909F4DBF7E16C7ECF892418AA0C339B9D8894A74E2709EB66589471`

## 9. 评分

- 初审：**98.4 / 100，通过**
- 非 Owner 复审：**99.1 / 100，通过**
- 扣分 0.9：J3 首轮漏传专用环境变量、J4 首轮账号切换 helper 时序分别产生一次零副作用载具失败；均完成 TDD 根修或正确重跑，并在最终候选从新上下文完整闭环。
- 当前血量：**100 / 100**

# K 域非 Owner 复审报告（J→K）

- Run ID：`pc-full-acceptance-20260728-151023`
- 复审者：J 域 Owner（非 K 域 Owner）
- PC 最终候选：Build `zfPfSm8yHDpNEEN8zcqdN`，PID `13288`
- 后端最终候选：JAR SHA-256 `F1DF14205D3FC6809376135735F1A7907D64271F2CDE121590DCA3FDE8B1A260`，PID `21012`
- 隔离环境：MySQL `nexion_acceptance_20260728_151023`，Redis DB `14`
- 最终裁决：K1–K6 六模块全部通过；未关闭 P0/P1/P2/P3 为 `0/0/0/0`

## 1. 复审原则与范围

以 `lib/nav/console-nav.ts` 为范围真源，独立复审 K1 多账户、K2 套利、K3 提现规则、K4 评分、K5 KYC 复审、K6 Janus。浏览器轨均从根登录页和可见侧栏进入，使用全新 Chromium 上下文、账号、会话和业务夹具；不复用 K Owner 的登录态或通过结论。

主流程未使用 mock、localStorage 权威数据或 DOM 注入。路由拦截只用于畸形 200、500/503、断网和结果未知等异常分支，解除注入后必须由同一页面的模块级恢复重新读取真实后端。

## 2. 分模块最终裁决

| 模块 | 用户入口与真实读取 | 权限与失败关闭 | 写入、并发及跨域闭环 | 清理 | 裁决 |
|---|---|---|---|---|---|
| K1 多账户 | 登录、侧栏、刷新、退出重登通过；canonical/domain/sources 严格核对 | readonly/no-write/no-menu 五层拒绝；畸形 200、500 清空旧快照并隐藏写入口 | K2 关联冻结经 K1 当前版本与 A2 独立审批，K1/H2/H8/F4/A4 一致 | 临时簇、账号、幂等、锁为 0 | 通过 |
| K2 套利 | 四类真实视图、统计、参数、分页和来源通过 | 精确动作权限、422、409、503、未知结果与恢复通过 | 直接 flag/blockgift/boardflag、K1 linked-freeze、同键重放/异载荷、CAS、A2/A4、H2/H8/F4 全闭环；E3 正事实新投影强制 `level=3` | 用户、置换、佣金、账本、投影、幂等为 0 | 通过 |
| K3 提现规则 | 可见侧栏、四维规则、结构化表单、dry-run、刷新重登通过 | readonly、非法规则、provider 缺失、畸形 200、503、unknown 同键及归档门通过 | J1 pending CAS；B1 红线下 422；隔离储备达标后真实开闸；D2 双资产账本、K4/K5/A4/B1/B5 与两笔提现闭环；最终按快照关闸 | 用户、KYC、地址、钱包、账本、提现、储备、幂等为 0；J1 恢复 `disabled/emergency=true` | 通过 |
| K4 风控评分 | 权威模型、解释性、分布、用户详情与恢复通过 | 权限、畸形响应、陈旧模型/用户版本及批量上限失败关闭 | 草稿/发布/回滚、人工覆盖/重算、A4 与下游通过；两运营员同版本竞争为 root/checker=`409/200`，canonical winner history 唯一，v34→v36 恢复 | active draft/override、幂等为 0 | 通过 |
| K5 KYC 复审 | 队列、详情、告警、订阅、刷新重登通过 | readonly/匿名/不存在用户、畸形 200、503、断网和陈旧版本拒绝通过 | 并发合并、unknown 同键、驳回后通过恢复 C4；两运营员同票竞争为 root/checker=`409/200`，最终 C4=`APPROVED` | 四张临时票、source、history、subscription、幂等为 0 | 通过 |
| K6 Janus | 五工作区、十二状态、真实设备与策略读取通过 | writer/senior/admin 精确权限、目标白名单、409/422/503 与畸形成功失败关闭 | 策略创建、预演、发布、App report/command/ACK、并发幂等、unknown 同键、暂停/恢复、回滚、复制删除、归档、审计导出与 A4 通过 | strategy、version、command、device、evaluation、quota、临时账号及幂等为 0 | 通过 |

## 3. 最终候选执行结果

| 验收轨 | 结果 |
|---|---:|
| K1–K6 入口、真实读取、刷新、退出重登、畸形 200、500 与恢复 | `7/7` |
| 权限夹具创建与独立批准 | `1/1` |
| readonly/no-write/no-menu 菜单、路由、按钮、接口、数据五层权限 | `3/3` |
| K2 完整真实写与跨域轨 | `6/6` |
| K3 J1/B1 安全 guard | `1/1` |
| K3 guard 内完整子轨 | `6/6` |
| K4 首次用户全轨 | `1/1` |
| K4 两运营员 CAS 竞争 | `1/1` |
| K5 完整真实轨 | `4/4` |
| K5 两运营员终态竞争 | `1/1` |
| K6 完整真实轨 | `4/4` |
| 权限夹具精确清理与独立批准角色删除 | `1/1` |
| K1–K6 加共享 A2 合同 | `92/92` |
| TypeScript | 通过 |

浏览器轨全程监控 `pageerror`、控制台异常和 `/api/admin/*` 非预期 5xx；除用例主动注入并显式断言的故障外均为 0。最终候选执行期间 Build、JAR SHA 与服务 PID 未漂移。

## 4. 缺陷闭环

### K-004（P1）K1/K2 权威响应协议

畸形成功包曾被归一化为伪空态。PC 增加完整运行时协议，后端提供 canonical/domain/sources 与实时 K2 统计；K1 元数据由 service 最终所有。最终候选入口/异常轨 `7/7`，关闭。

### K-005（P2）K3 页头失败关闭

正文失败时 dry-run 曾仍可点击。页头动作现同时绑定精确权限、loading 与 contentError；畸形 200/500 时禁用，真实恢复后重新可用，关闭。

### K-006（P1）E3→K2 等级越界

旧候选把合法 E3 高频换新事实硬编码成 K2 `level=4`，超出产品协议 `0..3`，导致 PC 正确失败关闭。后端投影归一化为最高合法值 3，两个 Mapper 合同同时强制 3 并禁止 4；PC 严格协议未放宽。

最终候选用全新 E3 正反事实夹具直接证明：正事实 overview 200、页面可用、投影 `level=3`；负佣金和未完成置换不投影。K2 `6/6` 与全域入口/权限/异常轨通过，关闭。

### K-AUTO-011 / K-AUTO-012（P3）

- K-AUTO-011：K1 合同历史文案漂移，已同步共享 A2“结果暂不确定/同一命令号”语义，合同 `92/92`。
- K-AUTO-012：权限 fixture 保留客户端大写用户名，但服务端审计使用 canonical 小写身份，造成 K4 winner 假阴性；setup 统一小写，双运营员载具改读认证会话 canonical username，并把失败路径恢复放入 `finally`。新 Run `K4-J-2OP-1785260939774` 通过。

## 5. 最终恢复与残留核对

- K 专用账号 active=`0`，角色和角色关系 active=`0`；MFA、会话及 Redis 关联键=`0`。
- K2/K3 临时用户、KYC、地址、钱包、双资产账本、提现、置换、佣金、风险投影和隔离储备=`0`。
- K4 active override=`0`；K5 临时票/source/history/subscription=`0`；C4 用户 52=`APPROVED`。
- K6 strategy/version/command/device/evaluation/quota 和临时账号=`0`。
- K 域 pending A2 ticket=`0`，pending object lock=`0`，本轮测试幂等记录=`0`。
- J1 提现闸=`disabled`、emergency=`true`；K3 guard 前后快照一致。
- 不可变 A2 审计与 A4/outbox 证据按验收要求保留；调试 trace、视频和临时截图不进入 Git。

## 6. 评分

- 初审：`97.9/100`，通过。
- 非 Owner 复审：`99.4/100`，通过。
- 当前血量：`100/100`。

结论：K1–K6 六模块在锁定最终候选上满足入口、数据、权限、异常、幂等、CAS、双运营员、跨域一致性、恢复与零可变残留门槛，可进入主控 75 模块统一终验。

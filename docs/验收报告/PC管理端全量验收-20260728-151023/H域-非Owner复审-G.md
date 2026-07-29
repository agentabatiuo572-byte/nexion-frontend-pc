# H 域非 Owner 复审报告（G→H）

- Run ID：`pc-full-acceptance-20260728-151023`
- 复审者：G 域 Owner，按 `G→H` 轮换执行
- 范围：H1、H2、H3、H4、H5、H7、H8（7/7 模块）
- 锁定源码基线：PC `91d1c2d`、后端 `a1cc2a7`、App `0e2178b`，以及本轮未提交修复
- 最终 PC 候选：Build `yscCV52TBV-tx4G22DXJz`，PID `17064`
- 最终后端候选：PID `14284`，JAR SHA-256 `2B96413C7D26AD4E514E67B65FDC4AF384744B2CBEC07068CA671084465D1EF2`
- 隔离数据库：`nexion_acceptance_20260728_151023`；Redis DB `14`
- Owner 初审：`99.0/100`
- 非 Owner 复审：**`99.1/100`**
- 最终结论：**H 域 7/7 模块通过；未关闭 P0/P1/P2/P3 为 `0/0/0/0`**

## 逐模块独立结论

| 模块 | 复审范围 | 对抗性证据 | 评分 / 结论 |
|---|---|---|---|
| H1 Phase | `/api/admin/growth/phases`、rhythm、B4/D5/F3/G7、App Phase | 从登录页与可见侧栏进入；沙盒只读；真实调整阶段进度、刷新与重登后可见并恢复为 `0`；同键回放 200、异载荷 409，401/404/422 失败关闭；B4、D5、F3、G7 同一节奏快照 | `99.1` / **通过** |
| H2 试用 | `/api/admin/growth/trials`、Model A、App 试用接口 | 四道资格闸、七态、空态及服务端字段完整；`trialOffsetCapUSD` 可见修改、刷新与重登后保留并恢复为 `50`；未知参数、缺幂等、短理由、同键冲突、500 与超时均失败关闭 | `99.0` / **通过** |
| H3 Quest | `/api/admin/growth/quest-events/tasks`、任务事实、H1/H8 下游 | 两名独立运营员基于同一旧值并发，仅一个 200，另一个 422 `QUEST_CONFIG_STALE`；`promoBanner.countdownDays` 恢复为 `4`；H8 结算真实生成邀请人 completion fact 与 mission，清理后为 0 | `99.2` / **通过** |
| H4 活动 | `/api/admin/growth/quest-events/events-overview`、主推治理 | 从可见入口完成活动读取、空态和下游核对；真实切换 `EVT-SPRING-SPIN` 主推、刷新确认、陈旧写拒绝并恢复；最终活动主推数为 `0` | `99.0` / **通过** |
| H5 签到 | `/api/admin/growth/check-in`、里程碑与 H6 并入边界 | 真实修改检查间隔、刷新确认并恢复为 `11 秒`；签到、里程碑、退役积分输出与 H6 并入判定一致；读取 500 后写入口关闭，真实上游恢复 | `99.0` / **通过** |
| H7 代金券 | `/api/admin/growth/vouchers`、App 券消费 | 从侧栏创建隔离券 `vc-ms4tzoc2-2xkhv5`，完成编辑、暂停、刷新、退出重登、删除及失败恢复；最终券定义与 grant 均为 0，同批幂等记录清零 | `99.1` / **通过** |
| H8 新人礼 | `/api/admin/growth/referral-rewards`、A2、B1、D4、H3、K1/K2/K4、App 公共投影 | 临时隔离储备把 B1 覆盖率提升至 `1126.14%`；独立 maker/checker 结算 `REF-382A1783182E4842ABD62A40`，新人获 0.015 USDT + 0.015 NEX、邀请人获 0.015 NEX，D4 三账一致；绕过 A2 为 409；结算后全量恢复 | `99.3` / **通过** |

## 按验收文档十步复审

1. 页面与动作盘点：以 `lib/nav/console-nav.ts` 为范围真源，逐项盘点 H1/H2/H3/H4/H5/H7/H8 的读取、筛选、空态、编辑、恢复、高风险动作和跨域入口。
2. 数据溯源：PC BFF 只调用 `8110` 真实接口；复核 `nx_config_item`、试用策略、任务/活动、签到、券、邀请结算、钱包与 D4 账本，不以 mock、localStorage 或 DOM 修改替代权威数据。
3. 真实用户轨：全新 Chromium 上下文从登录页与可见侧栏完成 7 模块首轮、刷新、返回、退出重登；最终锁定可见轨 `1/1`、逐模块只读轨 `7/7`。
4. 五层权限：`h_readonly`、`h_no_write`、`h_no_menu` 覆盖菜单、路由、按钮、接口与数据；前两类七模块读取 200、写 403且没有可用写按钮；no-menu 的菜单、直接路由、读写 API 在刷新重登后仍拒绝，`3/3` 通过。
5. 异常边界：七模块逐一覆盖畸形 200、HTTP 500、timeout，共 21 个读取故障分支全部清空不可信快照、关闭写入口并可由真实请求恢复；模块写轨同时覆盖 401/403/404/409/422。
6. 幂等、CAS 与并发：H1/H2 同键同载荷精确回放、同键异载荷 409；H3 双运营员 CAS 得到 200 + 422；H4 陈旧写拒绝；H8 只能由 A2 已批准命令回放执行，未知结果合同保留原幂等键和对话框。
7. 高风险隔离：H1/H8 使用资金/全局控制锁，H2/H3/H4/H5/H7 使用内容运营锁；不同锁不重叠。H8 使用全新邀请关系、独立 maker/checker 和临时 1000 万 USDT 隔离储备，未修改正式 `superadmin`。
8. 落库与上下游：H8 工单 `WO-260729004652836-300` approved，D4 三笔账本、H3 completion fact、A2 审计、A4/outbox 与页面一致；H1 的 B4/D5/F3/G7 和 App 边界一致。
9. 精确清理：本轮 H 幂等为 0；H8 用户、钱包、账本、结算、储备、H3 fact/mission、K4 score/contribution/history均为 0；H7 隔离券/grant 为 0；配置恢复为 H1 `0`、H2 `50`、H3 `4`、H4 主推 `0`、H5 `11 秒`。
10. 最终锁定：最终写轨完成后，再次从可见入口完整执行只读 `7/7` 与侧栏/刷新/退出重登 `1/1`；Build、JAR 和 PID 未漂移，页面错误与主流程非预期 `/api/admin/*` 5xx 为 0。

## 缺陷与墨菲复审

| 编号 | 范围 | 根因与实际修复 | 最终复验 |
|---|---|---|---|
| H-001（Owner 已关闭） | H1–H7 权限 | 页面原先未统一读取 session authority；Owner 已按精确 H 权限点守卫按钮及非按钮交互 | 最终候选权限轨 `3/3`、PC 权限合同通过，关闭 |

本次 G→H 独立复审未发现新的 H 域产品缺陷。执行中出现两类测试载体波动：首次 H5/H7 命令遗漏必需的密码环境变量，以及与其他域并发登录时 `superadmin` 登录页瞬时未进入侧栏。两者均未发出失败的业务写请求；补齐载具条件并用 `workers=1`、全新上下文整组重跑后分别为 `2/2`、`7/7`，最终证据目录已无失败截图、视频或 trace。

## 最终验证汇总

- 最终权限轨：`3/3`
- 七模块畸形 200 / 500 / timeout：`3/3`，共 21 个模块故障分支
- 最终逐模块首轮只读：`7/7`
- 最终侧栏首轮、刷新、退出重登及跨域核对：`1/1`
- H1 完整轨：`4/4`
- H2 完整轨：`4/4`
- H3 双运营员 CAS：`1/1`
- H4 主推切换、陈旧写及恢复：`1/1`
- H5/H7 首次用户真实写轨：`2/2`
- H8 maker/checker 真实结算：`1/1`
- PC H 域与权限合同：`59/59`
- App H 关联测试：`6` 个文件、`21/21`
- 主控最终后端门：Maven `2838/0/0/skip 2`

## 残留、不可变证据与权限夹具

最终隔离库核对：

- 本轮 H 幂等记录：`0`
- H8 用户 / 钱包 / D4账本 / 结算 / 临时储备：`0 / 0 / 0 / 0 / 0`
- H8→H3 fact / mission：`0 / 0`
- H8→K4 score / contribution / history：`0 / 0 / 0`
- H7 隔离券 / grant：`0 / 0`
- Redis DB 14 中 `H1-OWNER`、`H8G` 与 Run ID 临时键：`0 / 0 / 0`
- A2 工单、审计、A4/outbox 与 consumer delivery 按不可变证据保留，不属于可清理业务残留

H 域权限账号仍属于主控统一 75 模块回归夹具；本复审未越权提前停用。主控应在统一用例结束后按 A 域清理流程撤销其 MFA、角色与会话并验证旧凭据失效。

## 最终证据

受限目录：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260728-151023\H`。本报告只引用 `nonowner-g-final4*`，约 `0.41 MiB`，失败视频、失败截图和失败 trace 为 0，不进入 Git。

| 证据 | SHA-256 |
|---|---|
| `nonowner-g-final4-permissions.json` | `69438C110AFCF8A879B76083CD138EC5892B0AB7CAC7BE2F4CC67F48B56406D5` |
| `nonowner-g-final4-failclosed.json` | `CA599321231E9D7DC830BA3EE430729E250D38B1D07AD68FDD9B63ED59036255` |
| `nonowner-g-final4-read.json` | `E48171F552815BAE5727B63931E7DE58D9BC430896B3463EA0814341562EF264` |
| `nonowner-g-final4-visible.json` | `6FD31DAA95D3EEC1A8438EF90E07D976978782F65F76676ECBF9D32CA256D69E` |
| `nonowner-g-final4-h1.json` | `96E2079113D7A1FD2C18C087813FD06502BFBB124155D165358D879329CF5B85` |
| `nonowner-g-final4-h2.json` | `7D267372B6C97C8A24FD2AD71428E2305BA88AC2376888FA5A19760B17AFBCF0` |
| `nonowner-g-final4-h3-cas.json` | `88D6CACDE017D26C192817A4ABA76793052738315291CB68221D3E7FF4965ED5` |
| `nonowner-g-final4-h4.json` | `B24915F3FF9BE8F55BC474B1EA07550B9500996FB55D816DB0BEDA495385120F` |
| `nonowner-g-final4-h57.json` | `80371F9F0F87D09BC687807D7B7C669FA2FEBC72D866027381B5DE235CD692B6` |
| `nonowner-g-final4-h8/result.json` | `87A1527D6C43ADEE668645D035863359A04F2FACECF3B51BD3A950287595A842` |

## 评分与健康值

Owner 初审 `99.0/100`，超过 `96` 门槛；G→H 非 Owner 复审 `99.1/100`，超过 `98` 门槛。H1/H2/H3/H4/H5/H7/H8 分别为 `99.1 / 99.0 / 99.2 / 99.0 / 99.0 / 99.1 / 99.3`，无未关闭缺陷或不可恢复数据漂移。初始血量 `100/100`，本轮无评分扣血，完成任务恢复值受上限约束，最终健康值 **`100/100`**。

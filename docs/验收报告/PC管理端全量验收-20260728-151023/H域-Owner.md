# H 域 Owner 验收报告

- Run ID：`pc-full-acceptance-20260728-151023`
- 范围：H1、H2、H3、H4、H5、H7、H8（7/7 模块）
- 最终 PC 候选：Build `4QKkqEM_9AH1_6bkQWmha`，PID `21324`
- 后端候选：PID `14128`，JAR SHA256 `585A8B66D577667207AF81F842F7BDA1BAAD850521F78771D98064227E8E9C8A`
- 隔离数据库：`nexion_acceptance_20260728_151023`
- Owner 结论：**7/7 通过；Owner 初审 99.0/100**
- 当前未关闭 H 域产品缺陷：`0`

## 逐模块结论

| 模块 | 页面与权威来源 | 主流程 / 跨域闭环 | 权限、异常与并发 | 独立结论 |
|---|---|---|---|---|
| H1 Phase 调度器 | `/api/admin/growth/phases`、`/rhythm/*`；`nx_admin_phase_config` 与 H1 配置 | 登录页和侧栏进入、节奏骨架、沙盒、阶段位置真实写入、刷新、A2/A4、精确回退；与 B4/D5/F3/G7 同快照 | finance 只读账号读 200、写 403、可操作写入口 0；匿名、404、缺幂等、短理由、同键异载荷及恢复通过 | **通过** |
| H2 免费试用 | `/api/admin/growth/trials`；`nx_growth_trial_gate`、`nx_growth_trial_policy`、`nx_trial_claim` | 四道前置闸、奖励和会话状态；抵扣上限可见修改、刷新、退出重登后保持并恢复；App 关闭仍由服务端生命周期推进 | 只读写 403；500 失败关闭及可见重试；缺幂等、未知参数、短理由、同键冲突通过 | **通过** |
| H3 Quest | `/api/admin/growth/quest-events/tasks`；`nx_mission`、`nx_user_mission`、`nx_monthly_challenge`、`nx_growth_promo_banner`、completion fact | 任务契约、周/月任务、促销与 H1 倍率；H8 结算真实触发邀请人的 `H3_REFERRAL_SETTLED` 完成事实 | 两名独立运营员同基线并发只允许一笔 200，另一笔 422 `QUEST_CONFIG_STALE`；A2 审计、A4 outbox、精确恢复通过 | **通过** |
| H4 活动中心 | `/api/admin/growth/quest-events/events-overview`；`nx_event_quest`、`nx_growth_wheel_tier`、`nx_growth_wheel_guard` | 活动 CMS、状态、主推、转盘治理；从可见按钮临时切换主推，刷新核对并恢复原值 | 陈旧 featured 写 422 `EVENT_CONFIG_STALE`；无既有主推时以任一进行中活动完成 `false→true→false` 可逆闭环；只读写 403 | **通过** |
| H5 签到与 NEX | `/api/admin/growth/check-in`、earn-milestones；`nx_growth_checkin_rule`、`nx_streak_milestone`、`nx_streak_power_up`、用户 streak 表 | 签到规则、NEX 奖励、Saver/Power-Up、H6 并入说明；检查间隔真实修改、刷新、恢复 | 读取故障隐藏写入口；三权限轨、稳定标识/CAS、真实恢复通过 | **通过** |
| H7 代金券 | `/api/admin/growth/vouchers`；`nx_growth_voucher`、`nx_growth_voucher_grant` | 首次用户从侧栏创建临时券，依次编辑、暂停、刷新、退出重登、删除并再次刷新 | 只读写 403；500 时新增入口关闭；临时券最终物理清理，业务残留 0 | **通过** |
| H8 新人礼与邀请奖励 | `/api/admin/growth/referral-rewards`、settlement；配置项、`nx_referral_reward_settlement`、`nx_user_wallet`、`nx_wallet_ledger` | 真实邀请关系经 H1 1.5 倍后，新用户 0.015 USDT + 0.015 NEX、邀请人 0.015 NEX；D4 三笔账本、H3 任务、A2/A4 全链一致 | 直接绕过 A2 返回 409；独立 maker/checker 批准唯一结算；K1/K2、B1、幂等、刷新重登和失败关闭均通过 | **通过** |

## 按验收方法执行

1. 页面与动作盘点：以 `lib/nav/console-nav.ts` 的 H1/H2/H3/H4/H5/H7/H8 为唯一范围，从可见侧栏逐页核对读取、筛选、编辑、恢复、跨域入口和高风险动作。
2. 数据溯源：页面经 PC BFF 调用 `8110` 真实后端，业务表见上表；H8 额外核对邀请关系、结算、钱包、D4 账本、H3 completion fact、A2 审计与 A4 outbox。
3. 真实用户走查：首轮从登录页进入 Chromium；使用页面可见输入、按钮和等待，不直接改 DOM，不使用 mock、localStorage 权威数据或伪成功。
4. 常规状态：覆盖主流程、合法空态、刷新、返回、退出重登、读取失败后的可见重试与真实恢复。
5. 五层权限：独立 `h_readonly`、`h_no_write`、`h_no_menu` 三账号覆盖菜单、路由、按钮、接口、数据；前两类 H1–H8 读 200、写 403、写入口 0；no-menu 菜单、直达路由及读写接口均拒绝，刷新重登不漂移。
6. 异常边界：H1–H8 分别注入畸形 200、500、timeout，共 21 个读取故障分支全部失败关闭并由真实请求恢复；同时覆盖 401、403、404、409、422、缺幂等、同键异载荷及未知结果。
7. 幂等与并发：H1/H2/H5 可逆写后恢复；H3 双运营员以全新幂等键并发，精确得到 200 + 422；H4 陈旧页写拒绝；H8 直接结算绕过 A2 被 409 拒绝。
8. 落库与上下游：H8 工单 `WO-260728172125564-999` approved，结算 `REF-5532B12F445344E0BB2416F7` 生成三笔精确账本；`wallet.ledger_posted`、`H8_REFERRAL_REWARD_SETTLED` 与 batch outbox 均为服务器权威事件，H3 自动产生完成事实。
9. 精确清理：H8 两用户、KYC、钱包、三账本、结算、储备金、H3 mission/fact、K4 派生评分和三条幂等记录全部为 0；H1/H2/H3/H4/H5/H7 的 27 条验收幂等记录为 0；H3 `countdownDays` 恢复为 4，H4 主推恢复为 0，H7 临时券硬清除且残留 0。A2 工单、审计和 outbox 作为不可变证据保留。
10. 初审：七个模块逐一裁决均通过；唯一产品缺陷 `H-001` 已在最终候选从登录/MFA/可见侧栏完整复跑关闭。

## 缺陷闭环

| 编号 | 模块 | 根因与实际修复 | 最终复验 |
|---|---|---|---|
| H-001 | H1–H7 按钮权限 | H 域页面原先没有读取当前 session authority，导致只读账号仍看到可点击写入口；H 上下文现统一接入 `can(authority)`，并分别守卫 H1 普通写/PIN/撤销、H2 参数/取消/扣款、H3、H4 普通写/奖池、H5 和 H7 写入口，非按钮交互区同步失败关闭 | Build `4QKkqEM_9AH1_6bkQWmha` 下，finance 只读真实登录与 MFA 后读 200、写 403、可操作写入口 0；H 三账号权限轨 3/3、UI 权限合同 5/5，通过并关闭 |

## 验证清单

- H1 Owner：`4/4`
- H2 Owner：`4/4`
- H3 可见入口 + 双运营 CAS：`2/2`
- H4 可见入口 + 主推可逆写/陈旧写：`2/2`
- H5/H7 首次用户真实写闭环：`2/2`
- H8 可见入口 + 真实高风险结算：`2/2`
- H5/H7/H8 inventory：`1/1`
- H 域三账号五层权限：`3/3`；夹具创建/激活：`1/1`
- H1 跨域 finance 只读探针：`1/1`
- 七模块畸形 200 / 500 / timeout：Playwright `3/3`，模块故障分支 `21/21`
- H Owner/权限合同：`29/29`；本轮前置 H 合同：`54/54`
- 受影响 App H 合同：`41/41`
- TypeScript：通过；`git diff --check`：通过
- 页面脚本错误：`0`；非故障注入 `/api/admin/*` 5xx：`0`

H3/H4 新验收脚本在首轮执行中暴露两项“测试假红”并已校正：H3 陈旧写的产品合同为 422 而非 409，且并发键必须每次唯一，避免重跑命中旧幂等回放；H4 当前基线没有主推活动，脚本改为选择任一进行中活动执行可逆切换，并区分列表按钮“设主推”和确认按钮“设为主推”。两项均未改变产品代码或业务数据。

受限证据位于 `D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260728-151023\H`，不进入 Git。核心证据：

- `h8-real-settlement/result.json`：A2 maker/checker、唯一结算、三账本、D4、H3、A4/outbox 与直接绕过拒绝。
- `owner-write-final`：H5/H7 最终 trace、关键脱敏截图和结果 JSON。
- `failclosed-final`：七模块三类读取故障的最终 trace。
- `permission-fixtures.json`：供非 Owner 复审使用的受限账号清单；最终统一复审后由主控停用、解绑、清 MFA/会话。

## 裁决与剩余门

H 域 Owner 验收通过，初审 `99.0/100`，本任务完成恢复 10 点血量，当前血量 `100/100`。H 域未关闭 P0/P1/P2/P3 为 `0/0/0/0`，高风险隔离流程已真实执行并恢复，业务与幂等残留为 0。非 Owner 轮换复审、交付权限夹具最终清理和 75 模块统一锁定用例由主控按全局计划执行，不改变本报告的 Owner 结论。

# 2026-09-05 晚间 App / PC / Java Bug 修复报告

范围：本轮检查确认的 11 项代码缺陷及复验时发现的首页任务倒计时问题。仅正式 UniApp、PC 和 Java；不含真实支付、短信、链上及硬件交付验收。本报告不替代全 App 业务验收。

## 修复清单

| 问题 | 已实施修复 | 主要位置 |
| --- | --- | --- |
| 待停用设备仍占用容量，App 与 PC E5 不一致 | App 容量规则与 Java E5 查询统一排除 pendingDeactivate | App device-slot-policy；Java DeviceOpsMapper |
| 停售质押池仍可进入确认，首页状态陈旧 | 列表、弹层、提交三处检查有效状态；首页返回时刷新并区分停售、加载和失败 | App staking-canonical、staking、stake-sheet、quick-action-row |
| 过期任务进入当前任务列表及待办计数 | 统一资格时间和状态筛选；保留有效周期已领奖记录，但不计待办 | App actionable-quest、weekly-quest、weekly-quest-hero |
| 余额比例额度误称单笔限额 | 中英越改为当前余额可提额度，不将其冒充独立单笔或每日规则 | App 三语文案 |
| PC 首页漏斗混用财务笔数 | 接入 B3 独立用户阶段数据；移除首页及 b-client 对旧 funnel 的依赖；纠正上阶段比较文案 | PC funnel-bars、b-client、首页 |
| PC 未知 KPI 被转为零并判通过 | 严格数字解析，保留 null，显示暂不可计算 | PC dashboard-number、kpi-wall |
| 安全页会话固定使用 30 天 | 读取 PC auth.session.idle_ttl_days，应用 7–90 天有效范围和默认值 | Java AppUserSecurityMapper / Service |
| 修改密码遇到未知结果不能可靠恢复 | 用户+命令键事务回执、用户行锁、跨登录只读回执查询；客户端重试先查询、保留未确认命令键，不重复撤销会话 | App security / account-api；Java AppUserSecurity；迁移 nx_user_password_command |
| 客服旧请求收尾清掉新账号加载状态 | finally 同样检查当前请求和账号围栏 | App help.vue |
| App 与 PC 领导池预计金额及周口径不一致 | 使用共享结算事实，预计金额按 GMV×比例且受月剩余额度限制；本周已结算则显示实付；PC 明确区分实付和预计，非法值不变零 | Java LeadershipPoolProjection、TeamCommissionMapper；PC f1-client / F4 |
| Genesis 历史全量读取、达到页数上限失败 | 成交、个人订单、排放各自首屏一页并按需加载；去重、循环游标保护、旧请求围栏；排放总额独立聚合 | App genesis-api / genesis store / activity-pager；Java AppGenesisMapper / Service |

附加修复：首页周任务倒计时按任务实际 eligibleUntil 计算，不再使用运营展示的固定天数；F3 标签明确日基准与周期额度；F4 可选大使策略请求失败不再清空领导池主面板。

密码回执表不保存密码、请求正文或密码摘要；正常认证和 MFA 未被绕过。本轮未执行真实购买、转账、奖励领取或真实账号改密测试。

## 验证结果

- App：`npm run type-check` 通过；最终全量 Vitest **344 文件、1663 用例通过**；`npm run build:h5` 通过。
- Java：AppUserSecurityService 22、Controller 2、DeviceOpsMapperSql 5、AppGenesisHistoryService 5、AppGenesisService 25、AppTeamInsightsService 26、LeadershipPoolProjection 2、OpsTeamService 85，共 **172 用例，0 失败、0 错误**。这不是整个后端全量测试或覆盖率报告。
- PC：本轮两份新增定向测试共 3 用例通过；生产构建及构建内类型检查通过。新 BUILD_ID 为 `hpZpfpM1fkusR-HXF4NxI`，HTML 引用的 15 个静态资源全部 HTTP 200。
- 真实 App 页面：设备容量 2/3；四个停售质押池均禁用；当前周任务不再混入过期任务；首页倒计时 1d 06h 与任务中心约 30 小时一致；Genesis 入口、市场空列表及活动页的一笔历史交易正常展示。现有数据不足以完成真实多页、千页压力及资金写入验收，这些边界本轮由回归测试覆盖。
- 独立只读复审：PC / 团队 Agent 对最终修改静态复审通过；不等于真实业务验收通过。
- 认证 / Genesis Agent 复审确认核心围栏和恢复逻辑，并发现旧三列主键缺少升级迁移。已补 `20260905_password_command_user_scope.sql` 并纳入启动迁移；隔离 MySQL 验证旧主键升级、重复执行、保留原回执均通过。构造跨会话重复命令时迁移明确报 1062，原两条记录及旧主键均保留，没有静默去重。隔离测试库仅含本次合成数据，验证后已删除；正式库只执行可重跑迁移，没有删除业务数据。

## 重启与运行状态

已重启受影响的正式 App、PC 和 Java。2026-09-05 18:29（本机时区）检查：App 5173 / PID 14764，PC 3002 / PID 40048，Java 8110 / PID 34436；均核对正式项目归属。MinIO 9000 / PID 5636、Gemma 8010 / PID 16976 保持运行，未停止共享基础设施。

App、PC 首页、App 代理 `/api/genesis/state`、MinIO 存活检查及 Gemma IPv6 本机健康接口均 HTTP 200。端口和 PID 是检查时快照，不是永久保证。

18:35 补充：升级迁移纳入启动流程后再次正常启动 Java，最新 PID 18628 / 8110，项目归属已核实；App、PC、App Genesis 代理、MinIO、Gemma 再次全部 HTTP 200。F4 比例配置仍为 INVALID_RATE，调度按既有保护停用，未擅自更改资金参数。

PC 旧生产构建保留于 `.next-backup-20260905-1816`，未删除。密码回执表使用新增迁移并纳入启动迁移；如回退，先保留回执数据并评估前后端版本兼容，勿直接删表。所有原有未提交改动均保留；本轮未提交或推送 Git。

## 尚未完成的验收与能力缺口

1. PC 正常 MFA 已过期，需要用户重新登录。登录后的首页漏斗、KPI、F4 以及 PC 配置写入→持久化→App 读回尚未完成本轮真实页面复验。
2. 修改密码成功、未知响应恢复及并发重放经过定向测试，未在真实用户上改密或主动撤销其他会话。
3. 独立单笔/每日提现额度、F4 多周期资格与月库存约束等此前识别的能力差距，不等同于本轮展示和读取缺陷；本轮未擅自制定或启用新资金规则。
4. 隐私正式发布仍需真实运营主体等资料；本轮不编造、不发布法律身份信息。已有课程未被删除或覆盖。
5. 配置无效导致的 F3/F4 保护性停用不通过填默认值掩盖；真实支付、短信、链上与设备交付对接仍在本轮范围外。

结论：修复代码、自动回归、构建和服务加载已完成；PC 登录后验收及上述业务写入边界待补，不能宣称全部功能验收通过。升级迁移补齐后，两名独立 Agent 的对应静态复审均通过。修复交付自评初审 97、复审 99，仅评价已完成的代码与验证工作，不将分数当作全 App 业务验收结果。

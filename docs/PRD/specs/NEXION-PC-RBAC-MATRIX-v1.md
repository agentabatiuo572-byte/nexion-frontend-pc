# Nexion PC 运营后台 75 模块权限矩阵 v1.0

> **现行裁决(2026-08-07)**:全项目已取消 KYC、钱包配对、C4 与 K5；本文相关旧字段、门禁、用例、权限或流程仅保留为历史基线，不得作为现行实现、运营或验收依据。

> 状态：Target Baseline
>
> 编制日期：2026-08-04
>
> 范围真源：`lib/nav/console-nav.ts`，A–M 共 75 个模块

## 1. CAPABILITY

本矩阵定义 PC 后台每个模块的菜单、页面、按钮、API 和数据五层权限。目标是让运营员只能看到职责范围内的入口、数据和动作，同时保证后端对隐藏按钮、直接 URL、直接 API 和跨数据范围访问继续失败关闭。

本矩阵是“目标最小授权”，不是把 `SUPER_ADMIN` 的权限复制给其他角色。当前数据库授权与本矩阵不一致时，应收敛数据库、专属测试角色和验收夹具，不能放宽矩阵迁就历史超集角色。

## 2. CONSTRAINTS

### 2.1 五层权限不变量

| 层 | 必须成立 | 拒绝方式 |
|---|---|---|
| 菜单 | 只有拥有模块菜单授权的会话才显示域和 L2 入口 | 不显示；不得留下可点击空壳 |
| 页面 | 直接输入 URL 仍需模块 read 权限 | 403/无权限页，不渲染敏感数据 |
| 按钮 | 每个写动作绑定独立 action permission | 隐藏或禁用；后端仍再次校验 |
| API | read/write/approve/export/decrypt 等权限分离 | 403，零业务副作用 |
| 数据 | 查询必须叠加组织、辖区、队列、字段和敏感级别范围 | 返回最小数据集；越权对象按 403/404 策略处理 |

附加不变量：

- `nomenu` 角色的 `permissionCodes=[]` 且 `menuIds=[]`。
- `readonly` 只含本域 read 权限；`nowrite` 与 readonly 等集，不得偷偷拥有写权限。
- 发起人角色不得拥有目标动作的批准、解密或 RBAC 授权权限。
- 相同操作者不得批准自己发起的高风险待执行项；若产品最终采用“按执行门槛分流”，也必须由有权操作者重新确认并由服务端记录身份。
- 所有权限数组按等集校验，不使用“包含即可”的超集断言。
- 前端角色名、页面标签和 localStorage 不能成为授权依据；只采信登录会话及服务端权限字典。

### 2.2 当前角色代码

| 代码 | 角色 | 默认职责 |
|---|---|---|
| `SUPER_ADMIN` | 超级管理员 | 应急兜底与平台治理；日常业务不默认使用 |
| `CONFIG_ADMIN` | 平台配置管理员 | A 域配置、参数、菜单与权限字典治理 |
| `FINANCE` | 财务运营 | 日常入金、提现、账务、财务只读与低风险处置 |
| `FINANCE_LEAD` | 财务主管 | 高金额、退款、放行、资金参数和敏感财务导出 |
| `RISK` | 风控运营 | 账户限制、KYC、反作弊、规则和合规处置 |
| `GROWTH` | 增长运营 | 商品、分销、增长活动和金融产品运营 |
| `CONTENT` | 内容运营 | 内容、消息、信任中心与多语言内容 |
| `SUPPORT` | 客服运营 | 工单、会话、知识库；只在专门授权下发起补偿 |
| `AUDITOR` | 审计员 | 跨域只读、脱敏取证；无业务写、批准和解密权限 |

`checker` 是职责而非默认全局角色。应按动作创建最小权限角色或临时授权，不得建立一个跨 A–M 的万能批准账号。

### 2.3 矩阵记号

- `R`：菜单、页面和 read API 三层同时要求该模块的 `*_read` 权限。
- `W`：普通写；仍要求 reason、幂等键、审计和必要的 CAS。
- `H`：高风险写；在 W 基础上增加 B1/风险守卫和独立执行门槛。
- `X`：敏感导出/解密；默认脱敏，解密单独授权并记录下载审计。
- 数据范围：`ALL` 全平台、`REGION` 辖区、`QUEUE` 队列/工单池、`MASKED` 脱敏、`SELF-CONFIG` 个人偏好。

## 3. IMPLEMENTATION CONTRACT：75 模块矩阵

### 3.1 A 平台基础（8）

| 模块 | R 权限 | 可读角色 | W/H/X 角色 | 数据范围与关键限制 |
|---|---|---|---|---|
| A1 运营账号 & RBAC | `platform_a1_read` | SUPER_ADMIN、CONFIG_ADMIN、AUDITOR | W/H：SUPER_ADMIN；CONFIG_ADMIN 仅账号生命周期 | ALL；授权更新与账号启停分权，禁止自授予 |
| A2 审计 & 操作确认 | `platform_a2_read` | 全角色按本域证据、AUDITOR 全量 | W：有本域发起权；H：目标动作独立执行人 | 发起人只看本人/本域；AUDITOR MASKED 全量；审计不可改 |
| A3 系统配置 | `platform_a3_read` | SUPER_ADMIN、CONFIG_ADMIN、AUDITOR | W：CONFIG_ADMIN；H：SUPER_ADMIN | ALL；单例写加全局锁、版本、快照和恢复 |
| A4 埋点事件体系 | `platform_a4_read` | SUPER_ADMIN、CONFIG_ADMIN、AUDITOR；域 Owner 看本域 | W：CONFIG_ADMIN；schema 发布 H：SUPER_ADMIN | 域级；历史事件不可改，schema 只新增 revision |
| A5 平台参数寄存器 | `platform_a5_read` | SUPER_ADMIN、CONFIG_ADMIN、AUDITOR | W：CONFIG_ADMIN；敏感参数 H：SUPER_ADMIN | ALL；Owner、类型、范围、生效面必填 |
| A6 角色管理 | `platform_a6_read` | SUPER_ADMIN、CONFIG_ADMIN、AUDITOR | H：SUPER_ADMIN | ALL；禁止编辑 SUPER_ADMIN 使其失控，禁止自批 |
| A7 菜单管理 | `platform_a7_read` | SUPER_ADMIN、CONFIG_ADMIN、AUDITOR | W：CONFIG_ADMIN；根菜单/删除 H：SUPER_ADMIN | ALL；父子、角色授权和路由完整性保护 |
| A8 权限字典 | `platform_a8_read` | SUPER_ADMIN、CONFIG_ADMIN、AUDITOR | H：SUPER_ADMIN | ALL；permission code 发布后不可改语义，只能停用/新建 |

### 3.2 B 总览驾驶舱（5）

| 模块 | R 权限 | 可读角色 | W/H/X 角色 | 数据范围与关键限制 |
|---|---|---|---|---|
| B1 双账本总览 | `overview_b1_read` | FINANCE、FINANCE_LEAD、RISK、GROWTH、AUDITOR | W/H：FINANCE_LEAD（确认告警、红线） | ALL 聚合；账本明细按 D4 权限，B1 不改账 |
| B2 资金池水位 | `overview_b2_read` | FINANCE、FINANCE_LEAD、RISK、GROWTH、AUDITOR | W：FINANCE_LEAD；X：FINANCE/LEAD/RISK/AUDITOR | 聚合默认；导出 MASKED，增长无导出 |
| B3 转化漏斗 | `overview_b3_read` | FINANCE、GROWTH、RISK、CONTENT、AUDITOR | W/X：GROWTH、FINANCE | 聚合 cohort；小样本抑制，禁止用户级反查 |
| B4 节奏状态 | `overview_b4_read` | FINANCE、GROWTH、RISK、CONFIG_ADMIN、AUDITOR | 无写；跳转 H1 | 聚合；H1 为唯一配置 Owner |
| B5 风险雷达 | `overview_b5_read` | RISK、FINANCE、GROWTH、AUDITOR | 无写；跳转 K/J | 聚合；不得从雷达直接处置用户 |

### 3.3 C 用户与账户（6）

| 模块 | R 权限 | 可读角色 | W/H/X 角色 | 数据范围与关键限制 |
|---|---|---|---|---|
| C1 检索 & 画像 | `user_c1_read` | RISK、FINANCE、GROWTH、SUPPORT、AUDITOR | W：GROWTH 仅脱敏名单；X：AUDITOR/FINANCE_LEAD | REGION/MASKED；手机号、邮箱、证件按字段权限 |
| C2 账户操作 | `user_c2_read` | RISK、SUPPORT、AUDITOR | W：RISK；H：冻结/解冻/模拟登录由 RISK lead 或 SUPER_ADMIN | REGION；模拟登录独立权限、限时、全程审计 |
| C3 余额 & 资产调整 | `user_c3_read` | FINANCE、FINANCE_LEAD、RISK、SUPPORT、AUDITOR | 发起：FINANCE/SUPPORT；批准/冲正：FINANCE_LEAD | MASKED；账本不删除，发起人与执行人隔离 |
| C4 KYC 合规台账 | `user_c4_read` | RISK、FINANCE、SUPPORT、AUDITOR | W：RISK；X：监管导出专权 | REGION/MASKED；证件影像默认不可下载 |
| C5 安全 & 会话 | `user_c5_read` | RISK、SUPPORT、AUDITOR | W：RISK；H：强退/MFA 重置/设备解绑 | REGION；会话 token 永不回显 |
| C6 注册/登录风控 | `user_c6_read` | RISK、GROWTH、AUDITOR | W：RISK；增长只读 | ALL/REGION；OTP/滑块阈值不归增长修改 |

### 3.4 D 资金与财务（6）

| 模块 | R 权限 | 可读角色 | W/H/X 角色 | 数据范围与关键限制 |
|---|---|---|---|---|
| D1 充值对账中心 | `finance_d1_read` | FINANCE、FINANCE_LEAD、RISK、AUDITOR | W/H：FINANCE_LEAD；风险锁：RISK；PSP 切换：SUPER_ADMIN | ALL；银行账号只显尾号，密文不回传 |
| D2 提现审核队列 | `finance_d2_read` | FINANCE、FINANCE_LEAD、RISK、AUDITOR | 审核：FINANCE；冻结：RISK；放行/退款/解冻：FINANCE_LEAD+对应风控门 | REGION/ALL；地址与 tx 敏感字段按需显示 |
| D3 资金池水位仪表盘 | `finance_d3_read` | FINANCE、FINANCE_LEAD、RISK、AUDITOR | W：FINANCE_LEAD（储备/处置命令） | ALL；读模型不直接改账 |
| D4 账本/账单审计 | `finance_d4_read` | FINANCE、FINANCE_LEAD、RISK、AUDITOR | X：FINANCE_LEAD/AUDITOR；无原记录修改 | MASKED；冲正为新流水 |
| D5 提现参数配置 | `finance_d5_read` | FINANCE、FINANCE_LEAD、RISK、AUDITOR | H：FINANCE_LEAD；风险参数需 RISK 共同门禁 | ALL；版本/CAS、B1、H1 只读边界 |
| D6 汇率牌价 | `finance_d6_read` | FINANCE、FINANCE_LEAD、GROWTH、AUDITOR | W/H：FINANCE_LEAD | ALL；锁价版本不可回写历史订单 |

### 3.5 E 设备与商城（6）

| 模块 | R 权限 | 可读角色 | W/H/X 角色 | 数据范围与关键限制 |
|---|---|---|---|---|
| E1 商品目录 & 上架门 | `device_e1_read` | GROWTH、FINANCE、SUPPORT、AUDITOR | W：GROWTH；上架/删除 H：GROWTH lead | ALL；关联订单、券、奖励完整性保护 |
| E2 收益 & 任务引擎 | `device_e2_read` | GROWTH、RISK、AUDITOR | W/H：GROWTH lead | ALL；规则版本只影响明确批次 |
| E3 生命周期 & Trade-in | `device_e3_read` | GROWTH、SUPPORT、FINANCE、AUDITOR | W：GROWTH；回收恢复/抵扣规则 H | REGION；设备归属、实付价、累计产出不可伪造 |
| E4 订单状态机 | `device_e4_read` | GROWTH、FINANCE、SUPPORT、AUDITOR | W：SUPPORT/GROWTH；退款 H：FINANCE_LEAD | REGION/QUEUE；订单单向迁移、退款走账本 |
| E5 设备运维 | `device_e5_read` | GROWTH、SUPPORT、RISK、AUDITOR | W：GROWTH/SUPPORT；force/unbind H | REGION；批量动作限制目标集与上限 |
| E6 算力与设备配置 | `device_e6_read` | GROWTH、CONFIG_ADMIN、AUDITOR | W/H：GROWTH lead/CONFIG_ADMIN | ALL；App 投影版本、唯一六档、失败关闭 |

### 3.6 F 分销与团队（5）

| 模块 | R 权限 | 可读角色 | W/H/X 角色 | 数据范围与关键限制 |
|---|---|---|---|---|
| F1 V-Rank 晋升 | `network_f1_read` | GROWTH、FINANCE、AUDITOR | W：GROWTH；人工覆盖/奖励补发/冲正 H | REGION/MASKED；逐阶、配置版本、账本幂等 |
| F2 网络版税费率 | `network_f2_read` | GROWTH、FINANCE、AUDITOR | H：GROWTH lead+资金守卫 | ALL；费率和≤上限，历史结算不重算 |
| F3 双轨结算引擎 | `network_f3_read` | GROWTH、FINANCE、AUDITOR | W/H：GROWTH lead | ALL；暂停与结算批次分离 |
| F4 池/配额/大使/榜 | `network_f4_read` | GROWTH、FINANCE、AUDITOR | W：GROWTH；资金池动作 H | REGION/ALL；榜单信号不得直接冻结账户 |
| F5 佣金事件审计 | `network_f5_read` | GROWTH、FINANCE、RISK、AUDITOR | 处置：GROWTH/FINANCE；撤销/补发 H：FINANCE_LEAD | MASKED；原事件不可改，纠错建新事件 |

### 3.7 G 金融产品（5）

| 模块 | R 权限 | 可读角色 | W/H/X 角色 | 数据范围与关键限制 |
|---|---|---|---|---|
| G1 Staking 池配置 | `finprod_g1_read` | FINANCE、GROWTH、RISK、AUDITOR | H：FINANCE_LEAD/GROWTH lead | ALL；Kill-Switch、B1、已开仓快照边界 |
| G2 兑换风控 | `finprod_g2_read` | FINANCE、RISK、AUDITOR | W：RISK/FINANCE；放行 H | REGION；门禁和排队状态以后端为准 |
| G3 NEX 行情引擎 | `finprod_g3_read` | FINANCE、GROWTH、RISK、AUDITOR | H：FINANCE_LEAD（暂停/恢复/参数） | ALL；价格是连续值，历史价格不可重写 |
| G4 Genesis 经济 | `finprod_g4_read` | FINANCE、GROWTH、AUDITOR | W/H：GROWTH lead+资金守卫 | REGION/MASKED；持有/挂牌/售出单向迁移 |
| G7 复投激励 | `finprod_g7_read` | FINANCE、GROWTH、RISK、AUDITOR | H：GROWTH lead/FINANCE_LEAD | ALL；H1 倍率只读，仓位复用 G1 规则 |

### 3.8 H 增长与运营节奏（7）

| 模块 | R 权限 | 可读角色 | W/H/X 角色 | 数据范围与关键限制 |
|---|---|---|---|---|
| H1 Phase 调度器 | `growth_h1_read` | GROWTH、CONFIG_ADMIN、FINANCE、RISK、AUDITOR | H：GROWTH lead/CONFIG_ADMIN | ALL；单例锁、版本、影响面预览 |
| H2 免费试用引擎 | `growth_h2_read` | GROWTH、SUPPORT、RISK、AUDITOR | W：GROWTH；强制取消/扣款 H | REGION；Trial shadow 非余额 |
| H3 任务引擎 | `growth_h3_read` | GROWTH、SUPPORT、AUDITOR | W/H：GROWTH | ALL；发奖幂等、H1 倍率只读 |
| H4 活动中心 | `growth_h4_read` | GROWTH、CONTENT、SUPPORT、AUDITOR | W：GROWTH；奖池/上线 H | ALL；活动与用户参与状态分离 |
| H5 签到 & NEX | `growth_h5_read` | GROWTH、SUPPORT、AUDITOR | W/H：GROWTH | ALL；RNG server-only，里程碑只触发一次 |
| H7 代金券 | `growth_h7_read` | GROWTH、SUPPORT、FINANCE、AUDITOR | W：GROWTH；批量撤券/删除 H | REGION；仅撤 AVAILABLE，USED 不可改 |
| H8 新人礼与邀请奖励 | `growth_h8_read` | GROWTH、FINANCE、RISK、AUDITOR | 配置/结算 H：GROWTH lead+资金守卫 | ALL/MASKED；风险门禁、SETTLED 唯一事实 |

### 3.9 I 内容与合规（6）

| 模块 | R 权限 | 可读角色 | W/H/X 角色 | 数据范围与关键限制 |
|---|---|---|---|---|
| I1 转化文案 A/B | `content_i1_read` | CONTENT、GROWTH、AUDITOR | W：CONTENT；采纳/发布 H：CONTENT lead | ALL；实验结论与发布分离 |
| I2 Nova 推送运营 | `content_i2_read` | CONTENT、SUPPORT、AUDITOR | W：CONTENT；通道 kill H | ALL；禁用不抹历史送达 |
| I3 通知 Campaign | `content_i3_read` | CONTENT、GROWTH、SUPPORT、AUDITOR | W：CONTENT；立即全量发送 H | REGION/ALL；已发送不可撤回 |
| I4 信任中心 | `content_i4_read` | CONTENT、RISK、FINANCE、AUDITOR | 发布/回滚/下架 H：CONTENT lead+合规权限 | REGION；公开证明版本不可覆盖 |
| I5 风险披露 | `content_i5_read` | CONTENT、RISK、FINANCE、AUDITOR | H：RISK/CONTENT lead | JURISDICTION；版本确认和资金门禁联动 |
| I6 i18n 文案 | `content_i6_read` | CONTENT、GROWTH、SUPPORT、AUDITOR | W：CONTENT；namespace 发布 H | locale/namespace；占位符等集、禁词门禁 |

### 3.10 J 紧急与合规控制（4）

| 模块 | R 权限 | 可读角色 | W/H/X 角色 | 数据范围与关键限制 |
|---|---|---|---|---|
| J1 Kill-Switch 矩阵 | `emergency_j1_read` | RISK、CONFIG_ADMIN、FINANCE_LEAD、AUDITOR | H：RISK lead/SUPER_ADMIN | ALL；关停优先，恢复需 B1 与版本守卫 |
| J2 Geo-block | `emergency_j2_read` | RISK、CONFIG_ADMIN、SUPPORT、AUDITOR | H：RISK lead；边缘判定源：CONFIG_ADMIN | REGION；完整名单+差异、并发不覆盖紧急封锁 |
| J3 篡改防御监控 | `emergency_j3_read` | RISK、CONFIG_ADMIN、AUDITOR | W：告警配置；X：RISK/AUDITOR 脱敏 | ALL/MASKED；处置跳转 C2/K1，不在本页改账户 |
| J4 监管点名应急 SOP | `emergency_j4_read` | RISK、CONFIG_ADMIN、FINANCE_LEAD、AUDITOR | H：RISK lead/SUPER_ADMIN | ALL；版本、全局锁、步骤证据、补偿命令 |

### 3.11 K 风控与反作弊（6）

| 模块 | R 权限 | 可读角色 | W/H/X 角色 | 数据范围与关键限制 |
|---|---|---|---|---|
| K1 反多账户引擎 | `risk_k1_read` | RISK、FINANCE、SUPPORT、AUDITOR | W/H：RISK；解冻/释放需更高门槛 | REGION；簇历史永久，目标集精确 |
| K2 套利 & 刷量检测 | `risk_k2_read` | RISK、GROWTH、AUDITOR | W：RISK；联动冻结 H | REGION；检测信号不等于业务处分 |
| K3 提现风控规则引擎 | `risk_k3_read` | RISK、FINANCE、AUDITOR | W/H：RISK lead | ALL；archived 终态、provider 失败关闭 |
| K4 风险评分模型 | `risk_k4_read` | RISK、FINANCE、AUDITOR | H：RISK lead/CONFIG_ADMIN | ALL/REGION；权重和=1、模型版本留存 |
| K5 大额 KYC 复审 | `risk_k5_read` | RISK、FINANCE、AUDITOR | W：RISK；通过/驳回 H | REGION；通过解冻方向受 B1，C4 条件回写 |
| K6 Janus C2 控制台 | `risk_k6_read` | RISK、CONFIG_ADMIN、AUDITOR | W：RISK；强制/目标目录 H：senior/admin | REGION；BLOCKED→MANUAL_FORCED 禁批量，命令与 ACK 分离 |

### 3.12 L 数据与分析（6）

| 模块 | R 权限 | 可读角色 | W/H/X 角色 | 数据范围与关键限制 |
|---|---|---|---|---|
| L1 KPI 看板 | `bi_l1_read` | 全业务角色、AUDITOR | 聚合导出：域 Owner；无业务写 | 聚合；指标不可反写源域 |
| L2 漏斗/cohort/留存 | `bi_l2_read` | GROWTH、CONTENT、FINANCE、AUDITOR | 聚合导出：GROWTH | 聚合；小样本抑制 |
| L3 财务报表 | `bi_l3_read` | FINANCE、FINANCE_LEAD、RISK、AUDITOR | X：FINANCE_LEAD；批准独立权限 | MASKED；明细/解密分权 |
| L4 设备/任务/网络报表 | `bi_l4_read` | GROWTH、FINANCE、RISK、AUDITOR | X：GROWTH lead/FINANCE_LEAD | MASKED；团队树敏感导出单独授权 |
| L5 导出 & 监管报告 | `bi_l5_read` | FINANCE_LEAD、RISK、AUDITOR | H/X：模板 Owner+独立批准人 | JURISDICTION/MASKED；READY 才能下载，24h 过期 |
| L6 用户行为热力图 | `bi_l6_read` | GROWTH、CONTENT、RISK、AUDITOR | X：GROWTH/CONTENT，仅聚合 | 聚合；禁止回放单用户敏感操作轨迹 |

### 3.13 M 客服中心（5）

| 模块 | R 权限 | 可读角色 | W/H/X 角色 | 数据范围与关键限制 |
|---|---|---|---|---|
| M1 客服总览 | `service_m1_read` | SUPPORT、RISK、AUDITOR | W：SUPPORT lead（负载配置） | QUEUE/聚合；无用户资产写 |
| M2 工单台 | `service_m2_read` | SUPPORT、RISK、AUDITOR | W：SUPPORT；升级/跨队列 H：SUPPORT lead | QUEUE；负责人、状态、归档、SLA 分离 |
| M3 即时会话台 | `service_m3_read` | SUPPORT、RISK、AUDITOR | W：SUPPORT；强制转交 H | QUEUE；CAS 转交，关闭后不可普通发言 |
| M4 知识库与 SLA | `service_m4_read` | SUPPORT、CONTENT、AUDITOR | W：SUPPORT；SLA H：SUPPORT lead | REGION/QUEUE；FAQ 版本与发布状态分离 |
| M5 话术与模板配置 | `service_m5_read` | SUPPORT、CONTENT、AUDITOR | W：SUPPORT/CONTENT；全局发布 H | locale/queue；变量白名单、禁词与预览 |

## 4. 跨层执行合同

### 4.1 页面和 API

每个模块必须满足：

1. 菜单授权与 read permission 同时存在才显示入口。
2. 页面加载先读 session authority，再发业务请求；无权限不进行预加载。
3. 写按钮必须绑定精确 action code，不能复用模块 `*_write` 覆盖所有高风险动作。
4. API 过滤器校验 action code，Service 再校验对象状态、数据范围、角色边界和职责分离。
5. 导出任务在生成、批准、下载三个时点分别校验权限和数据范围。

### 4.2 高风险分级

| 等级 | 示例 | 最低控制 |
|---|---|---|
| P0 紧急全局 | J1 全局关停、J4 生产执行、超级管理员授权 | 强确认、全局锁、独立执行人、不可变证据、恢复计划 |
| P1 资金/身份 | 资产调整、提现放行、退款、KYC 通过、解密导出 | reason、稳定幂等、CAS、B1/风险守卫、独立执行门槛 |
| P2 业务配置 | 费率、奖励、SKU 上架、Campaign 全量发送 | reason、版本、影响预览、审计、必要时复核 |
| P3 日常运营 | 工单更新、内容草稿、普通配置 | 精确权限、reason（适用时）、幂等/CAS、审计 |

## 5. NON-GOALS

- 不在本文穷举每个按钮的全部 permission code；精确 action code 仍以 A8 权限字典和当前后端授权守卫为真源。
- 不把历史全局 maker/readonly manifest 视为合格最小权限载具。
- 不允许因页面隐藏而省略 API 或数据权限测试。
- 不决定 `OPEN-001` 的最终审批拓扑；无论采用哪种拓扑，职责分离、身份留痕和失败关闭不变。

## 6. OPEN QUESTIONS

| 编号 | 问题 | 临时处理 |
|---|---|---|
| RBAC-OPEN-001 | maker/checker 与“按执行门槛分流”的最终术语和角色模型 | 测试中使用独立发起人与执行人，禁止同人自批 |
| RBAC-OPEN-002 | I 域历史 `MENU_CONTENT_I4/I5` 与导航 `I4/I5` 映射 | 新夹具按导航 code 等集授权，旧 code 仅做迁移兼容 |
| RBAC-OPEN-003 | REGION 数据范围按注册地、KYC 辖区还是当前服务辖区 | 涉资金/合规时取更严格交集，待产品裁决 |
| RBAC-OPEN-004 | SUPPORT 发起 C3 补偿的金额上限 | 未裁决前只允许发起，不允许批准或直接入账 |
| RBAC-OPEN-005 | K6 senior/admin 是否映射独立持久角色 | 未落角色前采用最小临时授权并设置到期时间 |

## 7. HANDOFF

- A8 权限字典以本矩阵检查 75 个 read code 和高风险 action code。
- 测试资源按每域 `readonly/nowrite/nomenu/maker` 加独立执行人建立，权限和菜单全部做等集断言。
- 验收用例对每个模块覆盖菜单、直接 URL、按钮、直接 API 和数据越权五层。
- 任何新模块必须先补本矩阵，再新增导航和接口；不得先上页面后补权限。

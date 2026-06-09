# Nexion 运营后台 — 前端杠杆 ↔ 后台控制 核对表(CONTROL-MAP)

> 逐域核对:每个 APP 前端可见的数据/杠杆,后台是否有**可控可配的对应控制面**(不只是展示)。
> 控制类型:**config**(可编辑参数页)· **list rowActions**(行级操作)· **list primaryAction**(新增入口)· **dashboard controlLink**(跳关联 config)· **旗舰**(bespoke 完整页)。
> 2026-06-02 · `/goal` 逐域(A–L)核对产出。
>
> **字段级第三层(CGM)**:本表为**模块级**核对(每域有无对应控制面)。字段级 1:1(每个前端 store 字段 / 业务常量 → 一个后台控制)见 `docs/cgm/cgm.manifest.json`(185 行机读单一真源)+ 渲染面:旗舰 `/platform/params-registry`(88 平台参数回源真值索引)、per-user 旗舰 `/users/search/[id]`(11 张 360 HUB 卡:投入/提现/设备/收益/邀请/V级/财务/互动/订单商城/账户安全/通知)。覆盖门 `scripts/cgm-coverage.mjs`(默认 B9 = 全 185 行 built/waived,0 gap 常驻 tripwire)。

## 控制原语(archetype 级,全站通用)
- **config archetype**:参数 = 受控输入 + 脏检测 + 重置 + 应用变更(总管理员免双签即时生效 / 其余 Maker-Checker 双签)。
- **list archetype**:行详情抽屉 `rowActions`(按真实状态门控的行级操作:冻结/退款/通过/下架…)+ 待办行默认双签(通过/驳回)+ `primaryAction` 新增入口(目录/CMS)。
- **dashboard archetype**:`controlLink` 跳关联 config(分析只读,操作落在 config 模块)。
- **全站**:总管理员全权限 + 全面免双签;其余角色双签 + 发起人不可自审 + A2 留痕。
- 说明:控制为 mock(本地 state / 确认,server-canonical 结构),按主人指令**不接真前端原型**,只保证后台有完整可控可配的操作面。

## 逐域核对(12 域 / 67 模块)

### A 平台基础
| 模块 | 前端杠杆 | 后台控制 | 类型 |
|---|---|---|---|
| A1 运营账号&RBAC | 账号→角色→权限 | 新增账号 + 停用/启用/重置2FA/改角色 | list rowActions+primaryAction |
| A2 审计&Maker-Checker | 敏感操作复核 | 待复核行 通过/驳回(双签) | list 默认双签 |
| A3 系统配置 | 维护模式/限流/特性开关 | 可编辑配置 + 应用 | config |
| A4 埋点事件 | 事件 schema | 新增事件 + 灰度/全量/停用 | list rowActions+primaryAction |

### B 总览驾驶舱
| 模块 | 前端杠杆 | 后台控制 | 类型 |
|---|---|---|---|
| B1 双账本 | 兑付覆盖率/储备/负债 | bespoke(对账导出/红线核验) | 旗舰 |
| B2 资金池水位 | 水位/负债构成 | controlLink→/finance/params | dashboard |
| B3 转化漏斗 | L1→L5 转化 | controlLink→/growth/phase | dashboard |
| B4 节奏状态 | 12月 Phase | controlLink→/growth/phase | dashboard |
| B5 风险雷达 | 挤兑/异常/kill | controlLink→/emergency/kill-switch | dashboard |

### C 用户与账户
| 模块 | 前端杠杆 | 后台控制 | 类型 |
|---|---|---|---|
| C1 检索&画像 | 用户档案 | bespoke(L3 详情+操作) | 旗舰 |
| C2 账户操作 | 冻结/解冻/限制 | 冻结/解冻/限制提现/重置密码 | list rowActions |
| C3 余额&资产调整 | 调账 | 通过/驳回(双签) | list rowActions |
| C4 KYC 台账 | KYC 裁决 | 通过/驳回/要求补件 | list rowActions |
| C5 安全&会话 | 会话/设备 | 强制下线/锁定账户 | list rowActions |
| C6 注册风控 | 风险分布 | controlLink→/risk/multi-account | dashboard |

### D 资金与财务
| 模块 | 前端杠杆 | 后台控制 | 类型 |
|---|---|---|---|
| D1 充值对账 | 逐笔对账 | 核销差异/挂账/标记复核 | list rowActions |
| D2 提现审核队列 | 提现放行 | bespoke(放行/延迟/冻结+红线) | 旗舰 |
| D3 资金池仪表盘 | 水位 | controlLink→/finance/params | dashboard |
| D4 账本审计 | 双账本流水 | 导出凭证/标记复核 | list rowActions |
| D5 提现参数 | 日限/费率/冷却 | 可编辑参数 + 提交(红线核验) | 旗舰 config |

### E 设备与商城
| 模块 | 前端杠杆 | 后台控制 | 类型 |
|---|---|---|---|
| E1 商品目录&定价 | SKU/价/库存 | 新增 SKU + 上架/下架/改价/促销 | list rowActions+primaryAction |
| E2 代际发布门 | 代际开关/节奏 | 可编辑配置 + 应用 | config |
| E3 收益&任务引擎 | baseRate/任务 | 可编辑配置 + 应用 | config |
| E4 设备生命周期 | 衰减/到期 | controlLink→/devices/generation | dashboard |
| E5 Trade-in | 折抵率/持有期 | 可编辑配置 + 应用 | config |
| E6 订单状态机 | 订单流转 | 退款/重试开通/取消 | list rowActions |
| E7 设备运维 | 健康/工单 | 强制下线/补偿计酬/派工单 | list rowActions |

### F 分销与团队
| 模块 | 前端杠杆 | 后台控制 | 类型 |
|---|---|---|---|
| F1 V-Rank | 晋升门槛 | 可编辑配置 + 应用 | config |
| F2 网络版税 | Direct Royalty 10% | 可编辑配置 + 应用 | config |
| F3 双轨结算 | 平衡匹配/封顶 | 可编辑配置 + 应用 | config |
| F4 池 / 配额 / 大使 / 榜 | 池比例/配额门槛/大使审批/榜池(聚合 F6/F7/F8) | 可编辑配置 + 处置(双签) | config + list/dashboard 聚合 |
| F5 佣金审计 | 佣金事件 | 冻结佣金/解锁/驳回 | list rowActions |

### G 金融产品
| 模块 | 前端杠杆 | 后台控制 | 类型 |
|---|---|---|---|
| G1 Staking 池 | APY/锁期/容量 | 可编辑配置 + 应用 | config |
| G2 兑换风控 | 费率/滑点/限额 | 可编辑配置 + 应用 | config |
| G3 NEX 行情 | 价格/成交 | controlLink→/finance-products/exchange | dashboard |
| G4 Genesis 经济 | 供给/分红/版税 | 可编辑配置 + 应用 | config |
| G5 Premium 订阅 | 档位/权益 | 可编辑配置 + 应用 | config |
| G6 NEX v2 Vault | 锁期/释放 | 可编辑配置 + 应用 | config |
| G7 复投激励 | 奖励率/门槛 | 可编辑配置 + 应用 | config |

### H 增长与运营节奏
| 模块 | 前端杠杆 | 后台控制 | 类型 |
|---|---|---|---|
| H1 Phase 调度 | 10 dial | 可编辑配置 + 应用 | config |
| H2 免费试用 | 名额/抵扣/时长 | 可编辑配置 + 应用 | config |
| H3 Quest 引擎 | 任务/奖励 | 可编辑配置 + 应用 | config |
| H4 活动 CMS | 活动 | 上线/下线/暂停 | list rowActions |
| H5 签到&积分 | 签到/兑换 | 可编辑配置 + 应用 | config |
| H6 里程碑 | 里程碑派奖 | 启用/停用 | list rowActions |

### I 内容与合规 CMS
| 模块 | 前端杠杆 | 后台控制 | 类型 |
|---|---|---|---|
| I1 文案 A/B | 分流文案 | 设为胜出/停止实验 | list rowActions |
| I2 Nova 推送 | 推送 | 发布/停投 | list rowActions |
| I3 通知 Campaign | 多渠道触达 | 新建 Campaign + 发送/停发 | list rowActions+primaryAction |
| I4 信任中心 | 合规条目 | 新增条目 + 发布/下架 | list rowActions+primaryAction |
| I5 风险披露 | 披露版本 | 发布新版/归档 | list rowActions |
| I6 i18n | 双语键值 | 补全/发布 | list rowActions |
| I7 教程中心 | 教程 | 新建教程 + 发布/下架 | list rowActions+primaryAction |

### J 紧急与合规控制
| 模块 | 前端杠杆 | 后台控制 | 类型 |
|---|---|---|---|
| J1 Kill-Switch | 7 闸熔断 | 可编辑 toggle + 应用 | config |
| J2 Geo-block | 准入名单 | 可编辑 + 应用 | config |
| J3 篡改防御 | 篡改告警 | 确认拦截/标记误报/封禁账户 | list rowActions |
| J4 应急 SOP | 剧本演练 | 启动演练/标记完成 | list rowActions |

### K 风控与反作弊
| 模块 | 前端杠杆 | 后台控制 | 类型 |
|---|---|---|---|
| K1 反多账户 | 关联簇 | 确认关联/解除/封禁全簇 | list rowActions |
| K2 套利&刷量 | 违规事件 | 确认违规/标记误报/冻结账户 | list rowActions |
| K3 提现规则 | 阈值/速率 | 可编辑配置 + 应用 | config |
| K4 风险评分 | 维度/权重 | 可编辑配置 + 应用 | config |
| K5 大额 KYC 复审 | 复审裁决 | 通过/驳回/要求补件 | list rowActions |

### L 数据与分析 BI
| 模块 | 前端杠杆 | 后台控制 | 类型 |
|---|---|---|---|
| L1 KPI 看板 | 八项 KPI | controlLink→/platform/events(口径) | dashboard |
| L2 漏斗/cohort | 留存 | controlLink→/platform/events | dashboard |
| L3 财务报表 | 收入/兑付 | controlLink→/finance/params | dashboard |
| L4 运营报表 | 设备/任务/网络 | controlLink→/devices/tasks | dashboard |
| L5 导出&监管 | 报告 | 新建报告 + 生成/下载/重跑 | list rowActions+primaryAction |

## 结论
- **config 模块(~28)**:全部为可编辑配置页(受控输入+应用)✓
- **list 模块**:行级操作 + 目录新增入口齐全 ✓(行操作按真实状态门控)
- **dashboard 模块**:controlLink 跳关联 config ✓(分析只读)
- **旗舰页 B1/C1/D2/D5**:bespoke 完整控制 ✓
- **已知限制**:控制为 mock 演示,不接真前端原型(按主人指令);C2 已重构为账户实时态列表(acctState 列 · 冻结/解冻/限制按真实状态值门控)。

## 2026-06-03 复核(设计稿 restyle 后逐域控制审计)
> 机器可检(Playwright)逐域代表模块断言控制面存在且可交互:**15/15 PASS**。restyle(token/字体/shell/页头标签)未触碰 list/config/dashboard archetype 控制逻辑,控制层零回归。

| 类型 | 代表模块审计结果 |
|---|---|
| config(A3/E2/F2/G1/H1/J1) | 可编辑输入(≥1)+ 应用/发起变更栏 ✓(J1 11 项闸门 toggle + apply) |
| list 行操作(A1/A2/C2/D1/E1/I4/K1) | 行详情抽屉出操作按钮 ✓(K1=确认关联/解除/封禁全簇;A2=复核通过/驳回;C2=解冻 等,按真实状态门控) |
| list 新增入口(A1/E1/I4) | primaryAction 按钮在位 ✓(新增账号 / 新增 SKU / 新增条目) |
| dashboard controlLink(B2/L1) | 跳关联配置 ✓(B2→/finance/params;L1→/platform/events) |

## 2026-06-03 内容页复刻设计稿(导航不变 · 内容按设计稿)
> 按主人指令「导航栏保持现状,内容页参考设计稿改」:11 域(A/C/D/E/F/G/H/I/J/K/L)内容页替换为**设计稿域整页视图**(域标题 + KPI 行 + 子模块 Tab 切换 + 富内容)。导航栏(手风琴 + 多彩图标)零改动。B 总览/指挥台沿用既有(已是设计稿 overview 风格)。
> **控制机制随设计稿改变**:由「archetype 可编辑输入 + 应用栏」改为设计稿的「**动作按钮(定价/调整/调价/受理/复核/pause)→ Maker-Checker 弹窗** + 开关 Toggle(kill-switch/staking 各档)+ 新增入口(新增 SKU 抽屉,拖拽+1:1 裁剪)」。每域控制面仍齐备且角色感知(总管理员免双签),只是交互形态对齐设计稿。
> 旗舰 D2 提现/D5 参数/C1 检索显式路由也指向设计 D/C 视图,保证**域内布局一致**;/users/search/[id] 深度用户档案保留(设计稿之外补充)。

## 2026-06-03 逐域逐 Tab 控制审计(设计视图层 · /goal)
> 机器可检(Playwright)逐域(A–L)逐 Tab 统计控制面(操作按钮 / 开关 / 可编辑输入),零控制 Tab = 缺口。
> **首轮审计:22 个零控制 Tab**(设计稿原为纯展示):A1/A3/A4 · F1/F4 · G2/G3 · H2-H6 · I1/I3/I4/I5/I6/I7 · J3 · K1/K3/K4。
> **逐条补齐**(7 agent 并行,中性语言,复用各视图 Maker-Checker + useToast):
> - **config 型**(A3 系统配置 / G2 兑换阈值 / G3 做市参数 / H2-H6 试用·Quest·签到·里程碑 / K3 提现规则 / K4 评分权重):每参数行加「调整」按钮 → MC(放大流出项 amplifies=true 触发 B1 覆盖率核验)。
> - **list/审批 型**(A1 账号·A4 事件·F4 大使·I1 文案·I3 Campaign·I4 信任·I5 披露·I6 i18n·I7 教程·J3 篡改/SOP·K1 关联簇):行级操作(停用/改角色/确认/封禁/发布/下架/设为胜出/确认拦截/启动演练…)+ 新增入口(新增账号/事件/Campaign/教程,部分带 Drawer)→ MC。
> - **F1 V-Rank**:门槛调整 + 实物发货队列(培育奖 NEX amplifies)。
> **复审:0 零控制 Tab** — 全 12 域、每个 Tab 均有 ≥1 可操作控制面(角色感知,总管理员免双签)。功能抽验 E1 定价→MC 弹窗 ✓。tsc 0 · verify 114/0 · 浏览器自检 0 报错。

# 客服中心统计与分级界面设计包

适用：33041 客服改版预览业务线。统计字体与主管分组数据设计已修订，并已细化实施依赖、文件责任和112项验收。2026-10-07主人已授权详细方案完成后恢复完整实施，使用新的前后端工作树；旧暂停树及合并状态保留。工作树执行会话最低为GPT-6.1 Sol High。现行33041服务仍作为参考，产品验收尚未通过。

## 先看这三份

1. [可点击设计稿](../../design/support-analytics-20261006/prototype.html)：三角色首页、客户列表、即时会话、业绩榜、分组看板、服务规则；支持两名主管范围切换、数字下钻及设计四态演示。业绩榜位于即时会话之后、分组看板之前，三角色可见，个人首页保留短入口。
2. [详细交互设计](../../design/support-analytics-20261006/DESIGN.md)：布局、动效、旧资料保留与新统计位置。
3. [功能契约](CONTRACTS.md)：首充、金额、邀请、历史归属、权限和无限继承规则。

实施入口：[详细实施方案](IMPLEMENTATION.md)，包含I0–I7及I5R排行榜的依赖、现有能力与缺口、接口交接、迁移/恢复、具体检查和112项主责映射。

配套：[七项功能规格](SPEC.md)、[分组与多角度看板契约](GROUPS.md)、[旧能力覆盖清单](LEGACY-COVERAGE.md)、[基础及统一服务/IDC验收](ACCEPTANCE.md)、[设计审查及证据](REVIEW.md)、[业绩榜契约](LEADERBOARD.md)。原69项基础+25项分组+4项统一服务+2项IDC+12项排行榜，共112项产品验收，全部为NOT-RUN。业绩榜已加入静态可点稿，以单个主排名表演示查询、公开摘要与返回；每日变化比较昨日末固定基线，缺基线显示不可比，新入榜不当作0位变化。静态可点稿还未还原最终视觉，不作为产品完成证据。

视觉以当前后台黑灰令牌为准，五张采用稿为 `concept-*-black.png`，主管追加数据优先修订稿。此前偏蓝稿停止采用。最新会话实景：[专属客服与IDC托管](../../design/support-analytics-20261006/assets/verified-dedicated-support-idc.png)、[窄屏资料](../../design/support-analytics-20261006/assets/verified-idc-profile-1000.png)。上一轮布局/字号证据：[主管总览](../../design/support-analytics-20261006/assets/verified-supervisor-overview-data.jpg)、[按组客服](../../design/support-analytics-20261006/assets/verified-supervisor-staff-data.jpg)、[总管理员字号](../../design/support-analytics-20261006/assets/verified-admin-readable.jpg)。

业绩榜唯一采用稿为主人指定的[成绩领奖台原图](../../design/support-analytics-20261006/assets/leaderboard-approved-20261007.png)，1351×1164。删除无业务含义的头像下百分比条，保留原图构图。严格像素还原、允许差异、截图对比和独立agent反复验收要求见[视觉验收基线](../../design/support-analytics-20261006/LEADERBOARD-BASELINE.md)。其它探索图停止作为还原目标。

## 主人裁决与方案细化

| 项目 | 确定方向 |
|---|---|
| 继承默认 | 无限；既有明确有限配置保留，明确未配置经版本迁移变无限，均不自动重排旧绑定与旧池 |
| 首充 | 成功充值或正式购机取每客第一次；赠送和免费试用不算，真实付费试用转购可算 |
| 邀请 | 直属与全后代分别列，排除本人；跨客服聚合不扩大个人读取权 |
| 归属 | 当前客户画像按现归属，期间首充/充值按事件发生时归属；历史未知不补造 |
| 管理范围 | 专属客服本人；主管仅本人负责组；总管全部组及未分组/未路由数据，独立首页 |
| 分组看板 | 组范围与总览/客服/客户/资金/设备/活跃视角独立，每次一个主要长列表；当前资产按现组，历史业绩留在事件时组 |
| 多主管与下钻 | 可设多名主管，各管一个或多个组；总管查看主管数量与统计；统计数字/图表点可逐级下钻 |
| 主管首页重点 | 全部/单组Tab；先看组总数据与组间对比，再看按组展示的客服及绑定客户；分配、调度、审阅为次要处理入口 |
| 旧版还原 | 头像/昵称/UID/等级/风险/资金/账户设备/标签/快捷入口保留；仅已确认退役项移除 |
| 统一服务 | 只有专属客服一种服务类型和客户端入口；主管/总管理员是管理权限，原绑定与历史不因改名重置 |
| IDC托管 | 删除设备闲置与到家收货样例；持续托管，真实运行异常和未知仍须如实表达 |
| 业绩排行 | 所有客服可看公开成绩；四个独立榜，充值为本期成功充值额且不允许退款，购机为原单成功金额扣截至榜单时已成功退款，跨月退款归原购买月份及原客服；两者不相加，候选/并列/重算/下钻边界见LEADERBOARD |

本方案细化口径：零实付不计首充、购机正额差价计入、购机退款保留首次成功历史、旧未配置按版本迁移且不追溯。这些沿主人授权的推荐方案落实，不冒称逐项口头确认。充值榜不以缺充值退款源禁榜；缺真实成功充值历史/归属或来源失败仍未知，未分配不摊派，真实0须完整证据；不因此推定购机退款源或资格历史完整。

## 本期与后续

本期围绕七项：可信首充/金额、三角色首页、客户邀请与排序、旧M3完整还原增强、无限默认、客服分组及多角度看板、独立业绩排行。统一专属客服与IDC规则贯穿原页面。服务质量先用已有待回复/维护/首次联系，排行榜不替代服务任务，不新增综合分或奖金结算。

后续可选：首响与解决时长分布、复购及注册批次转化率，需要可信事件与明确运营用途再做。本期分组保持一层服务组，不扩成多级组织体系，也不新增CRM框架、支付通道、另一套账本或Janus开发。

恢复后按 IMPLEMENTATION 的依赖顺序推进，ACCEPTANCE、GROUPS 与 LEADERBOARD 保持验收真源。先证明数据与权限，再把页面接上；静态图和可点击示例不能替代真实API、分页聚合、并发迁移或产品浏览器验收。

## 已核对的事实来源

| 来源 | 快照与作用 |
|---|---|
| 主人附件 | [旧原型截图](../../design/support-analytics-20261006/assets/legacy-reference.png)，有效字段与视觉基线 |
| 当前改版源码 | `cs-enhance-ui-20261001-admin`，HEAD `03c078fc` 加未提交WIP；89个增强文件与33041进程目录 `cs-click-m3-20261005` 逐文件SHA256一致。运行目录无独立Git，构建ID为 `2Cr97jm8hcbtOBmZ8yGQx`；此证据不替代功能验收 |
| 本设计独立树 | `codex/cs-analytics-design-20261006` 从 `origin/test=f0423708` 创建，避免夹带候选树未提交改动 |
| 当前设计修订树 | `codex/cs-analytics-preview-20261006` 从 `origin/test=582f27b` 创建，只提交设计修订；暂停的产品合并留在原实施树 |
| 旧原型和现行规则 | [M域旧HTML](../../m-redesign/客服中心-M域-v3.html)、[9/29契约](../support-redesign-20260929/CONTRACTS.md)：全量旧能力与跨会话待回复、有效活动窗口、继承L=0等不变量 |
| 钱包支付边界 | [已退役外部直付草案的状态声明](../../PRD/specs/PAY-HDPAY-COMMERCE-DIRECT-CHECKOUT-SRS-v1.md)：商城当前只能钱包付款，不因“购机首充”恢复旧直付 |
| 后端订单与账本 | 指定只读树 `cs-e3-publication-fix-20261006-r2@8fa8fc6`；普通/组合购、置换/保留旧机另购、试用转购各自的正式结算证据 |
| 正式APP | 只读 `cs-current-app-20261006-r3@19dfad4`；调研时远端test为 `470fa7d1`，新增提交不改购机结算分支 |

后端实施应回源核对：`commerce/application/AppOrderCommandService.java`（普通购机与零额券）、`device/mapper/AppTradeinMapper.java`（TRADE_IN/CAPACITY_KEEP）、`growth/application/AppTrialLifecycleService.java` 与 `growth/mapper/AppTrialLifecycleMapper.java`（TRIAL_CONVERT/POSTED，转购设备仍可能标TRIAL）、`finance/mapper/SupportFinanceSql.java`（真实充值与账本匹配）。本设计不把这些内部枚举放入客服页面。

## 查看与检查

可直接打开 HTML；或在 `docs/design/support-analytics-20261006` 运行 `python -m http.server 33106 --bind 127.0.0.1` 后访问 `http://127.0.0.1:33106/prototype.html`。此为设计专用服务，不替换33041。

在本仓根目录运行以下三个设计检查入口：

```text
node docs/design/support-analytics-20261006/verify-prototype.mjs
node docs/design/support-analytics-20261006/verify-select-controls.mjs
node docs/design/support-analytics-20261006/verify-leaderboard.mjs
```

三项仅验证静态设计稿的结构、下拉样式约束和模拟交互/榜单计算，不验证真实API、产品持久化、浏览器布局或生产权限；通过不能转记产品PASS。规格检查：`node C:/Users/jason/.agents/skills/nexion-spec/spec-lint.mjs docs/specs/support-analytics-20261006/SPEC.md --strict`。设计原型静态检查与实际浏览器证据见REVIEW；实施按IMPLEMENTATION执行，全部112项产品用例在取得新证据前保持NOT-RUN。

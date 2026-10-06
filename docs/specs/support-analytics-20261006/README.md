# 客服中心统计与分级界面设计包

适用：33041 客服改版预览业务线。统计字体与主管分组数据设计已修订，并已细化实施依赖、文件责任和94项验收。当前按主人要求保留产品实施暂停状态；已开始的实施合并留在原任务工作树，未混入设计/方案提交。现行33041服务和生产配置不变。

## 先看这三份

1. [可点击设计稿](../../design/support-analytics-20261006/prototype.html)：三角色首页、客户列表、即时会话、分组看板、服务规则；支持两名主管范围切换、数字下钻及设计四态演示。
2. [详细交互设计](../../design/support-analytics-20261006/DESIGN.md)：布局、动效、旧资料保留与新统计位置。
3. [功能契约](CONTRACTS.md)：首充、金额、邀请、历史归属、权限和无限继承规则。

实施入口：[详细实施方案](IMPLEMENTATION.md)，包含I0–I7依赖、现有能力与缺口、接口交接、迁移/恢复、具体检查和94项主责映射。

配套：[六项功能规格](SPEC.md)、[分组与多角度看板契约](GROUPS.md)、[旧能力覆盖清单](LEGACY-COVERAGE.md)、[基础69项实施验收](ACCEPTANCE.md)、[设计审查及证据](REVIEW.md)。分组25项独立列在 GROUPS，合计94项产品验收要求，均待实施。

视觉以当前后台黑灰令牌为准，五张采用稿为 `concept-*-black.png`，主管追加数据优先修订稿。此前偏蓝稿停止采用。当前实景：[主管总览](../../design/support-analytics-20261006/assets/verified-supervisor-overview-data.jpg)、[按组客服](../../design/support-analytics-20261006/assets/verified-supervisor-staff-data.jpg)、[总管理员字号](../../design/support-analytics-20261006/assets/verified-admin-readable.jpg)、[窄屏会话](../../design/support-analytics-20261006/assets/verified-m3-readable-1000.jpg)。

## 主人裁决与方案细化

| 项目 | 确定方向 |
|---|---|
| 继承默认 | 无限；既有明确有限配置保留，明确未配置经版本迁移变无限，均不自动重排旧绑定与旧池 |
| 首充 | 成功充值或正式购机取每客第一次；赠送和免费试用不算，真实付费试用转购可算 |
| 邀请 | 直属与全后代分别列，排除本人；跨顾问聚合不扩大个人读取权 |
| 归属 | 当前客户画像按现归属，期间首充/充值按事件发生时归属；历史未知不补造 |
| 管理范围 | 普通客服本人；主管仅本人负责组；总管全部组及未分组/未路由数据，独立首页 |
| 分组看板 | 组范围与总览/客服/客户/资金/设备/活跃视角独立，每次一个主要长列表；当前资产按现组，历史业绩留在事件时组 |
| 多主管与下钻 | 可设多名主管，各管一个或多个组；总管查看主管数量与统计；统计数字/图表点可逐级下钻 |
| 主管首页重点 | 全部/单组Tab；先看组总数据与组间对比，再看按组展示的客服及绑定客户；分配、调度、审阅为次要处理入口 |
| 旧版还原 | 头像/昵称/UID/等级/风险/资金/账户设备/标签/快捷入口保留；仅已确认退役项移除 |

本方案细化建议：零实付不计首充、购机正额差价计入、退款保留首次成功历史、旧未配置按版本迁移且不追溯。这些已明确写入契约，不冒称主人逐项口头确认。后续评审针对整份方案；本轮不需要额外资料才能交设计。

## 本期与后续

本期围绕六项：可信首充/金额、三角色首页、客户邀请与排序、旧M3完整还原增强、无限默认、客服分组及多角度看板。服务质量先用已有待回复/维护/首次联系，不为首页新增评分或排名系统。

后续可选：首响与解决时长分布、复购及注册批次转化率，需要可信事件与明确运营用途再做。本期分组保持一层服务组，不扩成多级组织体系，也不新增CRM框架、支付通道、另一套账本或Janus开发。

恢复后按 IMPLEMENTATION 的依赖顺序推进，ACCEPTANCE 与 GROUPS 保持验收真源。先证明数据与权限，再把页面接上；静态图和可点击示例不能替代真实API、分页聚合、并发迁移或产品浏览器验收。

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

规格检查：`node C:/Users/jason/.agents/skills/nexion-spec/spec-lint.mjs docs/specs/support-analytics-20261006/SPEC.md --strict`。设计原型静态检查与实际浏览器证据见 REVIEW；产品69项基础用例及25项分组用例仍保持待实施状态。

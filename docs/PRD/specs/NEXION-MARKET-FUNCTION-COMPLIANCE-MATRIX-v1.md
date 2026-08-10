# NEXION 国家 × 功能合规矩阵 v1

> **现行裁决(2026-08-07)**:全项目已取消 KYC、钱包配对、C4 与 K5；本文相关旧字段、门禁、用例、权限或流程仅保留为历史基线，不得作为现行实现、运营或验收依据。

> 截止日期：2026-08-04（Asia/Tokyo）  
> 文档性质：产品准入门禁，不是法律意见、牌照证明或商店预审结果。  
> 当前候选市场：越南为详细评估对象；美国、欧盟/EEA、日本仅因现有文案引用 MSB、MiCA、FDIC/SIPC、OFAC 或可能全球上架而列为风险对照，不能视为已决定进入。

## 1. 结论先行

- 当前可以继续设计和内部测试的是账号、安全、帮助内容、客服、非金融设备管理及有真实履约能力的实物商城；正式上线仍须完成隐私、消费者权益和支付通道审查。
- NEX 发行/奖励、USDT 充值提现、钱包托管、兑换、行情、锁仓/APY、创世资产、网络分成在所有市场均处于 `BLOCKED`，直到法律主体、产品分类、牌照/持牌合作方、资金流和商店申报逐项关闭。
- Apple 明确限制加密货币钱包、挖矿、交易所和任务奖励：交易所只能在有适当许可的地区提供；加密 App 不得因下载其他 App、拉新下载或发布社交内容等任务发放货币。现有 NEX 任务/邀请路径必须按具体任务逐条整改。
- Google Play 要求申报金融功能和代币化数字资产；链上资产的购买、持有或兑换应由受监管地区的合格服务提供，设备端加密挖矿禁止，远程管理挖矿可以存在，但不得美化通过游戏/交易获得潜在收益。
- Janus/C2 仅能承担已审核功能的合规配置与内容分发；白壳审核后切换未审业务、下载可执行代码或隐藏金融功能属于 `PROHIBITED_DESIGN`。

## 2. 状态定义

| 状态 | 含义 |
|---|---|
| `ALLOW_CONDITIONAL` | 产品类型本身不构成当前已知硬阻断，但仍需主体、隐私、消费者、支付和商店材料完备 |
| `COUNSEL_REQUIRED` | 需目标地区律师确认分类、合同、营销和运营边界 |
| `DEVELOPER_STORE_ELIGIBILITY_REQUIRED` | 开发者账号主体、组织类型或商店表单尚不满足专门上架资格；这不是金融业务许可 |
| `LEGAL_PROVIDER_OR_LICENSE_REQUIRED` | 需由实际提供者持有覆盖实体、功能和地区的许可；“找合作方”只有在职责、资金/数据流和许可范围完整覆盖时才可能关闭 |
| `BLOCKED` | 当前缺关键事实/资质/证据，不得对真实用户开放或公开推广 |
| `STORE_RESTRICTED` | 商店政策有明确限制，必须改产品或满足其专门条件 |
| `PROHIBITED_DESIGN` | 设计目的本身与审核透明性冲突，不进入实现 |

状态以 `+` 连接时表示累计门禁，列出的每一项都必须分别关闭；任一未关闭即不得发布，不能选择其中较容易的一项替代另一项。

## 3. 功能分类

| 功能 ID | 功能 | 必须明确的产品事实 |
|---|---|---|
| F01 | 注册、登录、MFA、账号安全 | 法律实体、最低年龄、身份数据、删除与申诉 |
| F02 | KYC/活体与制裁筛查 | 谁决定、谁持有原件、适用阈值、人工复核、跨境传输 |
| F03 | 实物设备商城、订单、退款、置换 | 卖方、履约地区、保修、退货、税费、折抵是否影响法定权利 |
| F04 | 法币/VND 收款与退款 | 商户/支付服务角色、支付机构、结算账户、退款和拒付 |
| F05 | USDT 充值、提现和地址管理 | 托管/非托管、私钥控制、链、Travel Rule/AML、资金归属 |
| F06 | NEX 发放、余额、销毁 | 发行主体、链上/数据库、权利、供应、可转让/可兑换性 |
| F07 | NEX/USDT 兑换、行情、K 线 | 交易对手、订单撮合、流动性、价格源、牌照和市场操纵控制 |
| F08 | Staking/锁仓/APY/提前赎回 | 收益来源、资产控制、损失、合同、投资/证券/存款分类 |
| F09 | Genesis/OG/代币化资产/NFT | 底层权利、发行、二级交易、稀缺性和披露 |
| F10 | 设备能力、云任务、收益分配 | 是否真实计算、任务客户、交付回执、收入来源、设备端处理 |
| F11 | 新人、签到、任务、邀请 NEX 奖励 | 奖励是否加密资产、任务类型、预算、反作弊、商店限制 |
| F12 | 直推佣金、网络奖金、等级 | 资金来源、层级、消费/投资条件、传销/证券/促销分类 |
| F13 | 内容、学习、风险披露、客服 | 不得变相撮合或作个性化投资建议；声明需有证据 |
| F14 | Janus/C2 远程模式与配置 | 包内能力、下载内容类型、审核披露、切换审计、失败关闭 |

## 4. 越南详细矩阵

越南《数字技术产业法》71/2025/QH15 自 2026-01-01 生效；《个人数据保护法》91/2025/QH15 同日生效。政府第 05/2025/NQ-CP 号决议自 2025-09-09 起开展为期五年的加密资产市场试点，覆盖发行、交易市场、自营、托管和发行平台等活动，并设置许可/参与框架。官方说明还指出，试点内加密资产的发行、交易和支付使用越南盾。以下因此采取保守门禁，最终应由越南执业律师按真实资金流出具书面意见。

| 功能 | 越南状态 | 核心问题 | 当前可执行门禁 | 关闭证据 |
|---|---|---|---|---|
| F01 账号安全 | ALLOW_CONDITIONAL | 年龄、条款主体、个人数据和删除 | 未成年门禁、隐私告知、App 内/外删除、会话吊销 | 主体证明、隐私文本、删除 E2E |
| F02 KYC | COUNSEL_REQUIRED | 敏感数据、跨境、处理者、自动决定 | 仅沙箱；不保留生物模板；人工申诉 | 数据流、DPA、法律基础、删除回执 |
| F03 实物商城 | COUNSEL_REQUIRED | 卖方、电子商务、保修退货、折抵 | 真实卖方与售后未定前不收款 | 商业登记、销售条款、退换/税务意见 |
| F04 VND 支付 | LEGAL_PROVIDER_OR_LICENSE_REQUIRED | NEXION 是普通商户还是支付/中介服务提供者 | 只通过实际主体、功能和地区均被许可覆盖的机构；NEXION 不代持不明资金 | 通道合同、许可官方记录与范围、结算和退款图 |
| F05 USDT 充值提现 | BLOCKED | 托管、转移、AML、试点参与资格、支付币种 | Geo 阻断真实用户入口；不得以“钱包”命名模拟余额 | 越南法律意见、试点/持牌合作证明、资金流 |
| F06 NEX 发行奖励 | BLOCKED | 是否为加密资产、发行主体与底层资产 | 不发行、不承诺价值、不公开获取 | 法律分类、发行文件、批准市场清单 |
| F07 兑换行情 | BLOCKED | 交易市场/自营/托管资格；VND 规则 | 关闭兑换、虚拟行情和“上所”文案 | 许可/合作、订单与价格源、市场监控 |
| F08 锁仓/APY | BLOCKED | 投资、证券、资产管理或加密服务分类 | 关闭可操作入口和年化宣传 | 书面分类、合同、牌照、风险与适当性 |
| F09 Genesis/NFT | BLOCKED | 资产发行、底层权利、交易和披露 | 不售卖、不做虚假限量或二级价格 | 底层权属、发行资格、白皮书/披露批准 |
| F10 设备/云任务收益 | COUNSEL_REQUIRED | 实物服务还是投资合同；收入是否真实 | 仅显示可验证任务与已结算款；禁“保收益” | 客户合同、任务日志、发票、账本对账 |
| F11 任务 NEX | BLOCKED | 加密奖励、促销与商店任务限制 | 所有 NEX 任务奖励关闭；非资产积分另行分类 | 法律意见、商店映射、活动规则 |
| F12 推荐/网络奖金 | BLOCKED | 多层营销、收益来源、购买/投资条件 | 只保留无资产奖励的单层真实推荐候选，仍待审 | 法律意见、资金来源、层级与上限 |
| F13 内容/客服 | ALLOW_CONDITIONAL | 不得形成无牌照招揽或误导声明 | 声明必须映射 CLM 台账；客服不承诺收益/时限 | 话术审核、页面抽检、投诉闭环 |
| F14 Janus/C2 | PROHIBITED_DESIGN | 审核透明、远程代码、实际功能一致性 | 只允许已审白名单配置；禁止白壳变脸 | 包体清单、审核备注、签名配置、切换审计 |

## 5. 其他市场风险对照

| 市场 | F05 钱包/转移 | F07 兑换 | F08 锁仓/APY | F11 任务代币 | F12 网络奖金 | 当前结论 |
|---|---|---|---|---|---|---|
| 美国 | LEGAL_PROVIDER_OR_LICENSE_REQUIRED + DEVELOPER_STORE_ELIGIBILITY_REQUIRED | LEGAL_PROVIDER_OR_LICENSE_REQUIRED + DEVELOPER_STORE_ELIGIBILITY_REQUIRED | COUNSEL_REQUIRED | STORE_RESTRICTED | COUNSEL_REQUIRED | 现有占位 MSB 号和 FDIC/SIPC 文案无效；无实际主体、联邦/州范围与产品分类，不进入 |
| 欧盟/EEA | LEGAL_PROVIDER_OR_LICENSE_REQUIRED + DEVELOPER_STORE_ELIGIBILITY_REQUIRED | LEGAL_PROVIDER_OR_LICENSE_REQUIRED + DEVELOPER_STORE_ELIGIBILITY_REQUIRED | COUNSEL_REQUIRED | STORE_RESTRICTED | COUNSEL_REQUIRED | 现有“符合 MiCA”无证据；Google 对相关地区要求 CASP 授权并仍需满足本地要求 |
| 日本 | LEGAL_PROVIDER_OR_LICENSE_REQUIRED + DEVELOPER_STORE_ELIGIBILITY_REQUIRED | LEGAL_PROVIDER_OR_LICENSE_REQUIRED + DEVELOPER_STORE_ELIGIBILITY_REQUIRED | COUNSEL_REQUIRED | STORE_RESTRICTED | COUNSEL_REQUIRED | Google 列明交易所需日本金融厅注册；无实际主体许可即不定向发布 |
| 其他未选市场 | BLOCKED | BLOCKED | BLOCKED | STORE_RESTRICTED | BLOCKED | “商店未列出专门表格”不等于合法；逐国调查后才可从阻断转出 |

## 6. Apple / Google 功能门禁

| 功能 | Apple | Google Play | NEXION 当前动作 |
|---|---|---|---|
| 钱包 | 组织开发者可提供虚拟货币存储，仍需合法合规 | 需金融功能申报；特定市场需要许可材料，非托管钱包是否超出专门政策也不免除当地法律 | 先明确托管模式、开发者主体和地区；当前 BLOCKED |
| 交易所/转移 | 只允许获适当许可且仅在获准地区提供 | 应由受监管地区的合格服务提供；按地区提交材料 | 无许可/合作与 Geo 证据不得上架 |
| 挖矿/设备算力 | 设备端挖矿禁止，云端处理可存在 | 设备端挖矿禁止，允许远程管理挖矿 | 分开证明设备资源采集、远程管理、真实客户任务、交付回执、结算来源、法律分类和商店披露；当前“手机实时算力/挖矿收益”不得混为一项 |
| 任务/邀请代币 | 加密 App 不得因下载其他 App、鼓励下载、发社交内容等任务发货币 | 代币化资产需申报，不得美化游戏/交易潜在收益 | 将每个任务映射政策；邀请下载、分享等 NEX 奖励先关闭 |
| 数字内容/功能解锁 | 通常需 IAP；不得用加密货币/钱包等自有机制解锁 | 数字功能/内容通常需 Play Billing，除明确例外 | 建立 SKU 分类；实物、数字服务、代币不得共用一个支付假设 |
| 账号删除 | 支持创建账号必须允许在 App 内发起完整删除 | 需 App 内路径和外部网页链接；冻结不算删除 | 发布前完成端到端删除及例外保留披露 |
| 隐私申报 | App Privacy 必须覆盖自身和第三方伙伴 | Data safety 覆盖所有分发版本和 SDK 的收集/共享 | 双模式、旧版本和第三方 SDK 取最大集合如实申报 |
| 远程模式/内容 | 欺骗审核可能下架并逐出开发者计划；功能和商业模式需清楚说明 | App 必须透明交付承诺价值，不得欺骗或隐瞒 | C2 白名单、签名、版本、回滚、审核说明；禁止未审变脸 |

## 7. 上市国家审批单

每增加一个国家，必须复制并完成以下清单，禁止直接复用别国答案：

```text
国家/地区与商店 storefront：
法律主体、开发者账号主体、合同卖方：
开放功能 ID：
资金/资产流和私钥控制：
需要的牌照、自有还是合作方、覆盖范围：
支付/IAP/退款/税务：
KYC/AML/制裁与申诉：
数据存储、跨境、处理者、删除与事件通知：
年龄与消费者权利：
全部对外声明 ID：
Geo 执行层（商店、API、数据、客服）：
律师姓名/机构/意见日期/有效期：
法律意见 ID、委托主体、事实假设、功能/地区/版本范围、排除项：
产品事实证据 Owner、证据路径/哈希、有效期：
状态变更审批人、批准记录、批准日期与到期日（到期自动回退原阻断状态）：
商店申报与审核备注：
回归、监控、Kill-Switch 和退出方案：
```

`Geo` 必须至少同时作用于商店可用地区、注册、服务端接口、支付/钱包、内容/活动和客服操作；仅隐藏前端菜单不构成合规阻断。

律师意见只回答其明确事实假设和范围内的法律问题，不能替代开发者账号资格、商店审核或产品事实验证。商店政策是最低分发门槛，也不能证明当地业务合法。

## 8. 当前发布决策

1. 越南：仅 F01、F13 可在完成主体/隐私等基础门禁后进入公开候选；F03、F04、F10 需专项确认；F05–F12 中的金融/代币能力保持关闭。
2. 美国、欧盟/EEA、日本：未被批准为目标市场；不得用现有占位资质文案推断可发布。
3. Apple 与 Google：不得提交包含审核后“变脸”意图的构建；NEX 任务、上所、180% APY、虚构资质和虚构行情均为送审阻断。

## 9. 官方依据（执行时需重新核对最新版）

### 9.1 法规版本锁

| 来源 | 本轮确认日期 | 影响功能 | 当前处理 | 律师确认/复核 |
|---|---|---|---|---|
| 越南 05/2025/NQ-CP 试点决议 | 2026-08-04 | F05–F12 | 当前关于发行、交易和支付使用 VND 的摘要仅作待核法律问题，不作为可执行放行事实 | `TBD` 条款号、官方附件 SHA-256、越南语/中文翻译责任人与律师复核 |
| 越南 Decision 96/QĐ-BTC 许可程序及 2026-01-20 开始受理的官方通告 | 2026-08-04 | F05–F09、可能涉及 F10–F12 | 作为试点后续许可程序的新事实；完成实际主体/业务模式映射前不解除 `BLOCKED` | `TBD` 条款/附件哈希；目标发布日前和意见签发时复核 |
| 越南 Decree 284/2026/NĐ-CP 加密资产行政处罚文件目录（2026-07-16） | 2026-08-04 | F05–F12、对外声明 | 处罚边界尚未由越南律师映射到 NEXION；不得因“试点开放”推断可以经营 | `TBD` 法规全文、条款/附件哈希、翻译责任人和律师书面意见 |

任何法规更新只会触发重新评估，不会自动把功能从 `BLOCKED` 移出。每次候选冻结必须记录来源快照、抓取/发布日期、律师意见 ID、适用事实和下一复核日。

- Apple：[App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)、[Offering account deletion in your app](https://developer.apple.com/support/offering-account-deletion-in-your-app)、[Manage app privacy](https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy)。
- Google Play：[Cryptocurrency Exchanges and Software Wallets](https://support.google.com/googleplay/android-developer/answer/16329703?hl=en)、[Blockchain-based Content](https://support.google.com/googleplay/android-developer/answer/13607354?hl=en)、[Payments](https://support.google.com/googleplay/android-developer/answer/9858738?hl=en)、[Account deletion](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en-EN)、[Data safety](https://support.google.com/googleplay/android-developer/answer/10787469?hl=en)、[User Data](https://support.google.com/googleplay/android-developer/answer/10144311?hl=en)。
- 越南政府：[71/2025/QH15 数字技术产业法](https://vanban.chinhphu.vn/?docid=214609&pageid=27160)、[91/2025/QH15 个人数据保护法](https://vanban.chinhphu.vn/?classid=1&docid=214590&pageid=27160&typegroupid=3)、[05/2025/NQ-CP 加密资产市场试点](https://chinhphu.vn/?classid=1&docid=215249&pageid=27160)、[52/2024/NĐ-CP 非现金支付](https://congbaocdn.chinhphu.vn/CongBaoCP/VanBan/2024/5/41938/50259-1-2024679-68052-2024-nd-cp.pdf)、[2026-01-20 开始受理加密资产市场许可申请的官方通告](https://baochinhphu.vn/bat-dau-tiep-nhan-ho-so-cap-phep-thi-truong-tai-san-ma-hoa-tu-ngay-20-1-102260120185611897.htm)、[Decree 284/2026/NĐ-CP 官方法规目录](https://vanban.chinhphu.vn/he-thong-van-ban?classid=1&mode=1&typegroupid=6%2F1000)。

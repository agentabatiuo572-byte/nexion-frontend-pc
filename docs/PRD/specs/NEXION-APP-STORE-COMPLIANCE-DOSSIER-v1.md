# NEXION 应用商店合规材料与上架门禁 v1

> **现行裁决(2026-08-07)**:全项目已取消 KYC、钱包配对、C4 与 K5；本文相关旧字段、门禁、用例、权限或流程仅保留为历史基线，不得作为现行实现、运营或验收依据。

> 结论先行：**当前代码与材料不具备直接提交 App Store / Google Play 的条件**。阻断项包括法律主体/牌照和上架地区未锁定、App 身份字段为空、Android 宽泛权限未收敛、隐私政策/注销闭环未完成、第三方 SDK 与真实数据流未核验，以及 Janus/C2“白壳后远程切正式能力”可能构成隐藏功能或规避审核。
> 本文件是送审资料包的可执行骨架，不是法律意见、牌照结论或商店批准保证。平台规则会变化，每次送审当日必须复核官方原文。

## 1. 当前事实快照（2026-08-04）

### 1.1 发布包身份

`D:\workspace\NX1.0\src\manifest.json` 当前：

- `name`、`appid`、`description` 为空；`versionName=1.0.0`、`versionCode=100`。
- `app-plus.modules={}`、`sdkConfigs={}`、`uniStatistics.enable=false`。
- iOS distribute 配置为空。
- Android 声明 CAMERA、READ_PHONE_STATE、GET_ACCOUNTS、READ_LOGS、WRITE_SETTINGS、Wi-Fi/网络变更、挂载文件系统等权限；现有源码检索没有证明所有权限都有真实、用户可见且不可替代的用途。
- 代码会读取设备品牌/型号、OS、内存/CPU/GPU/屏幕密度并本地缓存安装级 `deviceId`/能力基线；是否上传生产服务端必须以最终 API 与抓包确认。

### 1.2 产品与合规暴露面

- App 包含账户、KYC、钱包、充值/提现、NEX、锁仓/Staking、兑换、Genesis、推荐/佣金、设备“收益/任务”、活动奖励和风险披露等高度受管功能语义。
- 注册文案提到隐私政策，但现有 PRD 曾明确隐私政策为占位，需验证最终 App 内是否有可点击、公开可访问且与实际处理一致的独立页面。
- 当前源码存在任务/签到/邀请/活动发放 NEX 的设计。Apple 对加密货币 App 的任务奖励有明确限制，必须逐任务进行法律与审核政策判定。
- 后端/PC 存在 Janus 策略管理和设备命令；任何“审核时白壳、审核后 C2 远程切换正式金融/加密功能”的方案都按一票否决处理。

## 2. 一票否决项

以下任一未关闭，不得上传正式审核：

| ID | 阻断项 | 关闭证据 | Owner |
|---|---|---|---|
| STORE-B01 | 开发者法律主体、服务提供主体、商店主体不一致或未核验 | 公司注册、开发者账号、合同主体一致性表 | 法务/管理层 |
| STORE-B02 | 钱包、兑换、金融交易/资金管理、KYC/支付在目标地区缺必要牌照/许可 | 每国家×功能官方牌照和律师签字矩阵 | 法务/合规 |
| STORE-B03 | Janus/C2 根据审核者、时间、名单或远端指令隐藏/激活未披露能力 | 架构证明：审核者与普通用户功能一致；所有可激活能力在元数据和 Review Notes 披露 | 架构/法务 |
| STORE-B04 | 动态下载并执行审核包中不存在的代码/页面以引入新功能 | 最终包/SBOM/网络抓包；远端仅下发内容与已审核配置，不执行新代码 | App/安全 |
| STORE-B05 | App Store/Play 元数据、截图与实际功能不一致 | 每张截图与 build 路径映射；全功能清单签字 | 产品/市场 |
| STORE-B06 | App 内无易发现的完整账户删除入口，或只做停用 | 真机视频、API/数据清理证据、保留例外说明 | C/隐私 |
| STORE-B07 | 无公开隐私政策、数据安全表不准确或漏第三方 SDK/WebView | URL、数据流/SDK BOM、抓包、Apple/Google 表单签字 | 隐私/安全 |
| STORE-B08 | 宽泛/敏感权限无可见核心用途、无显著告知或拒绝后不可用 | 最终 manifest diff、权限触发视频、拒绝/撤回路径 | App/安全 |
| STORE-B09 | 加密任务奖励、云端“挖矿/算力收益”、APY/收益宣传未通过政策和法律审查 | 功能逐项审查表、文案证据、服务端计算与风险披露 | 法务/G/H/E |
| STORE-B10 | 审核账号不能访问全部功能、依赖服务不在线或受地域/OTP 阻断 | 可复用 demo 账号、固定 MFA/审核绕行、审核日探针 | QA/运营 |
| STORE-B11 | App 有崩溃、占位、死链、mock 假成功、结果未知被当失败 | 发布候选真机/E2E/服务端对账报告 | QA/工程 |
| STORE-B12 | 商店付款规则未定：数字功能/内容在 iOS 内用自有支付或加密钱包解锁 | SKU/能力逐项 StoreKit/IAP/实体商品判断 | 产品/法务 |

## 3. Janus/C2 与双模式的审核边界

### 3.1 禁止模式

以下设计高度符合“隐藏、休眠、未记录功能/规避审核”的风险特征，应直接禁止：

- 审核期间只展示白壳；审核通过后按时间、设备、账号、地区或 C2 命令切出未披露正式功能。
- 审核账号与普通用户看到不同能力，或检测审核环境后改变行为。
- 从远端下载 H5/JS/脚本/插件，在 WebView 中执行审核包里不存在的资金、加密、交易、奖励或设备功能。
- 商店截图/描述只写工具或资讯，实际用户可进入钱包、提现、兑换、Staking、佣金或代币奖励。
- 用混淆、加密配置或多分支专门隐藏受管能力。

Google Play 的 Behavior Transparency 明确禁止隐藏、休眠、未记录功能、审核规避，以及从远端下载并执行会引入审核时不存在功能的代码。Apple 也要求准确元数据、完整可审功能，并警告试图欺骗审核体系会导致移除或开发者计划处罚。

### 3.2 只有满足全部条件才可考虑的远端配置

1. 功能代码已在提交包中，远端只调整审核已知的内容、阈值、灰度和安全开关，不引入新的产品能力。
2. 所有可能启用的功能都在商店描述、隐私声明、Review Notes、牌照/地区矩阵中披露，审核账号可完整访问。
3. 开关不识别审核员/审核网络，不以审核完成时间为触发，不用于绕过 IAP、牌照、隐私或内容政策。
4. 关闭时用户看到真实解释；启用仍受服务端权限、地域、牌照、KYC、风险、覆盖率等闸约束。
5. 每个开关有 Owner、目的、范围、版本、A2 审计、回滚、健康阈值和防误开测试。
6. 架构和法务共同签字后再向商店明确解释；“包内已有所以可以隐藏”不是充分条件。

## 4. 法律主体、功能与地区矩阵

每一行只有 `APPROVED` 才能在对应商店地区开放。`申请中`、销售口头承诺、海外牌照或合作方 Logo 不等于批准。

| 国家/地区 | 商店 | 服务法律实体 | 功能 | 自有/合作方角色 | 牌照/许可号与官方链接 | 合同范围 | 地域 gate | 状态 |
|---|---|---|---|---|---|---|---|---|
| VN | Apple | TBD | 账户/KYC | TBD | TBD | TBD | server + store availability | BLOCKED |
| VN | Apple | TBD | VND 入金/USDT 出金/钱包/兑换 | TBD | TBD | 精确到资产、网络、SKU | server + store availability | BLOCKED |
| VN | Apple | TBD | Staking/Genesis/NEX 奖励 | TBD | TBD | 产品分类与营销范围 | server + store availability | BLOCKED |
| VN | Google | TBD | 同上 | TBD | TBD | 同上 | server + Play country targeting | BLOCKED |

新增市场必须复制行逐功能审批。Apple 3.1.5 对钱包、云端挖矿、交易所和加密证券分别设条件，3.2.1(viii)要求金融交易/投资/资金管理 App 由提供服务的金融机构提交并具备目标地区许可；Google Play 也要求在 Financial Features Declaration 中声明相关功能，并按目标地区满足加密交易/钱包要求。

## 5. 权限与原生能力清单

### 5.1 Android 当前声明决策

| 权限/能力 | 当前源码可见用途 | 默认决定 | 上线证据 |
|---|---|---|---|
| INTERNET / NETWORK_STATE | API 与网络态 | 保留最小项 | 域名清单、TLS、离线降级 |
| ACCESS_WIFI_STATE | 设备能力/网络展示候选 | 无必要则删除 | 真实入口与用户价值 |
| CAMERA | 未在本轮检索证明必需；可能用于 KYC/扫码 | 默认删除；若保留则按用户动作临时申请 | 可见入口、告知、拒绝/撤回、无后台采集 |
| READ_PHONE_STATE | 未证明；高风险持久标识能力 | 删除 | 最终 manifest 无此权限 |
| GET_ACCOUNTS | 未证明 | 删除 | 最终 manifest 无此权限 |
| READ_LOGS | 普通 App 不应需要 | 删除 | 最终 manifest 无此权限 |
| WRITE_SETTINGS | 未证明且会改变设备设置 | 删除 | 最终 manifest 无此权限 |
| CHANGE_WIFI_STATE / CHANGE_NETWORK_STATE | 未证明 | 删除 | 最终 manifest 无此权限 |
| MOUNT_UNMOUNT_FILESYSTEMS | 未证明 | 删除 | 最终 manifest 无此权限 |
| VIBRATE / WAKE_LOCK | 通知/前台任务候选 | 有真实功能再保留 | 能耗、触发、关闭方式 |
| FLASHLIGHT / camera feature | 未证明 | 删除 | 最终 manifest 无此能力 |

Google Play User Data policy 对设备信息、第三方代码和持久设备标识有明确透明/限制要求；IMEI/IMSI/SIM Serial 等不得与个人敏感数据或可重置 ID 随意关联。NEXION 应使用服务端签发的最小安装标识，不能把 READ_PHONE_STATE 当设备风控捷径。

### 5.2 iOS 目的字符串

最终包若含相机、照片、推送、Face ID 等能力，必须逐项写与真实入口一致的 `UsageDescription`，并在拒绝后仍能使用不依赖该权限的功能。没有能力就不声明；不得用“改善体验”一类空泛理由。

## 6. 数据隐私表单工作包

权威输入为《NEXION 数据与隐私清单 v1》和最终运行证据。Apple 要求披露 App 与集成第三方代码的实际收集；WebView 内业务流量同样可能需要申报。Google Data safety 对生产、公开/封闭/开放测试轨道均有要求（仅内部测试例外规则须按当日官方核对），开发者对 SDK 行为和声明准确性负责。

### 6.1 运行证据

- [ ] 最终 IPA/AAB 静态权限、entitlement、SDK、隐私 manifest/SBOM 扫描。
- [ ] 新装→注册→登录→KYC→充值→提现→商城→设备→团队→客服→注销全流程抓包。
- [ ] 同意前、同意后、拒绝权限、退出分析、注销后的网络差异。
- [ ] 服务端 API→表/Redis/MinIO/outbox/log/第三方逐字段落点和保存期。
- [ ] SDK 域名、后台上传、自动初始化、崩溃前后和无登录态行为。

### 6.2 Apple App Privacy 交付表

每种数据填写：是否收集、用途、是否 linked to user、是否 tracking、是否第三方收集、可选披露条件证据。候选数据至少包括 Contact Info、Financial Info、User ID、Device ID、Purchases、Product Interaction、Customer Support、Photos/Videos（KYC/附件）、Sensitive Info、Diagnostics、Coarse Location（若由 IP 用途触发）。

### 6.3 Google Data safety 交付表

每种数据填写：collected/shared、必需/可选、处理是否 ephemeral、目的、传输加密、删除机制、第三方 SDK。另提交公开隐私政策 URL、App 内注销与网页删除请求 URL。

## 7. 账户删除与隐私入口验收

Apple 要求支持创建账户的 App 允许用户在 App 内发起删除整个账户，单纯停用不够；若转网页完成，应直达具体删除页。Google 也有账户删除与数据删除声明要求。

### 最小流程

`设置 → 隐私与账户 → 删除账户 → 影响说明 → 重新认证 → 明确确认 → 请求号/状态 → 完成通知`

- 不能要求非高监管业务用户必须打电话、发邮件或先找客服。
- 可说明法定保留的交易/KYC/审计类别和期限，但不能借“合规”无限保留全部资料。
- 撤销会话、MFA、推送 token、可选分析标识；向处理方发删除任务并追踪失败。
- 余额、未完成提现/订单/申诉有清晰分支；不能吞资金或静默失败。
- 删除后旧凭据不能登录，公开/推荐/客服可删资料已匿名化，法定账本保留最小关联。

## 8. 金融、加密、奖励与付款审查

### 8.1 功能逐项表

| 功能 | 用户投入/获得 | 托管/交易角色 | 商店政策问题 | 必需结论 |
|---|---|---|---|---|
| USDT/NEX 钱包 | 持有、转入/转出 | TBD | Apple 钱包需组织开发者；Google Financial Features | 法律实体、托管模型、牌照、地区 |
| NEX↔USDT 兑换 | 加密交易 | TBD | 交易所/金融交易地区许可 | 获批 exchange/VASP 与 geo gate |
| Staking/Genesis | 锁仓、收益/代币 | TBD | 投资/证券/加密产品分类，IAP 边界 | 产品法律意见、许可、风险与地区 |
| 设备购买 | 实体硬件或数字能力 | TBD | 实体商品 vs 数字功能解锁 | SKU 逐项 IAP/外部支付判断 |
| Cloud Share/设备收益 | 用户购买后获 USDT/NEX/展示收益 | TBD | 云端挖矿/投资/误导性收益风险 | 真实技术/资金流与法律分类证明 |
| 任务/签到/邀请奖励 NEX | 完成行为获代币 | 平台发放 | Apple 3.1.5(v) 任务奖励限制；反作弊/促邀风险 | 每任务保留/删除决定和法务签字 |
| 代金券/优惠券 | 抵扣 | 平台 | 数字商品券的 IAP 规则 | 可抵扣对象与购买路径 |

### 8.2 文案硬门

- 收益、APY、币价、到账时间、保险、牌照、交易所上架、合作方、储备、审计等每条声明必须有证据 ID、Owner、有效期和下架开关。
- 禁止“稳赚、保本、零风险、稳定收益、手机真实挖矿”等不可证明表述。
- 设备评分/展示算力不得暗示手机在本地执行加密挖矿或 AI 任务，除非有可复现技术证据；Apple 只允许加密挖矿处理在设备外进行。
- 风险披露不能修复一个本身不合法、未持牌或误导的产品。

## 9. 商店元数据材料包

在法律与产品定位锁定前，不生成营销成稿，先准备证据化字段：

| 材料 | 内容 | 门禁 |
|---|---|---|
| App 名称/副标题/简短说明 | 与最终功能、主体和品牌一致 | 禁止白壳名与真实功能不符 |
| 完整描述 | 核心用途、金融/加密/设备/奖励实情、地区限制 | 每个能力可由审核账号访问 |
| 关键词/分类 | 真实类别 | 不用错误分类降低审查 |
| 图标/截图/视频 | 真机最终 build、无虚假余额/收益/牌照 | 每张映射页面、数据来源、build hash |
| 支持 URL | 公开、可用、含联系和 SLA | 上线期持续可达 |
| 隐私政策 URL | 公开、无需登录、多语言、与数据清单一致 | App 内也易达 |
| 隐私选择/删除 URL | 直达请求页 | 不跳首页或要求搜索 |
| Terms / Risk Disclosure | 法律主体、产品条款、风险和投诉路径 | 版本/法域/语言一致 |
| 年龄分级/内容问卷 | 按金融/加密/用户内容真实回答 | 法务/产品签字 |
| 出口合规/加密声明 | iOS 加密使用情况 | 安全/法务签字 |

### 截图证据表模板

| 图号 | 页面/状态 | 展示声明 | 数据源 | 测试账号 | build hash | 法务证据 | 状态 |
|---|---|---|---|---|---|---|---|
| SS-01 | TBD | TBD | API/静态内容版本 | REVIEW-* | TBD | CLAIM-* | BLOCKED |

## 10. 审核账号与 Review Notes

### 10.1 账号包

至少准备两套始终有效、可复用、跨审核地区可访问的账号：

- `REVIEW-FULL`：已完成 KYC 的合成审核账号，能访问钱包/资金/设备/团队/内容/客服等全部送审功能；资金操作接明确沙箱或无需真实支付的审核路径。
- `REVIEW-EMPTY`：新用户/空状态，用于注册和首次体验。

要求：密码不过期；MFA/OTP 提供审核可复用的明确方式；不依赖私人手机；后端在审核期间 24×7 可用；不得识别审核账号后隐藏或放开普通用户没有的功能。Google 要求登录信息持续有效、可复用并以英语提供；Apple 也要求提供有效 demo 账号/完整 demo mode 和所有必要资源。

### 10.2 Review Notes 模板（英语提交前母语审校）

```text
App purpose:
[One accurate paragraph describing every material capability.]

Legal entity and availability:
[Entity, target countries, regulated functions, license references, partner roles.]

How to review:
1. Sign in with REVIEW-FULL: [credential reference, not pasted into repository].
2. Navigate to: [exact visible paths for KYC, wallet, deposit, withdrawal, store, device, staking/exchange, rewards, support, account deletion].
3. [Explain sandboxed transactions and expected states.]

Remote configuration:
[List every remote flag that can affect visible functionality. Confirm it does not identify reviewers, download executable code, or activate undisclosed features.]

Data and permissions:
[Why each sensitive permission is used, trigger point, denial behavior, privacy policy and deletion URLs.]

Attachments:
[Licenses/legal opinions, architecture/data-flow diagram, demo video, test QR/static resources, support contact.]
```

Review Notes 必须解释业务模式、非显而易见能力、购买/收益/代币流、远端配置和审核路径，不能用模糊语句弱化受管功能。

## 11. 最终候选验收

### 构建与供应链

- [ ] 干净 tag/commit 产出 IPA/AAB；签名、bundle/package ID、版本、entitlement 固定。
- [ ] SBOM、许可证、SDK 签名/隐私 manifest、漏洞扫描通过；无调试菜单、测试证书、mock 成功、硬编码秘密。
- [ ] 服务器与 remote config 版本快照锁定；审核期间不切隐藏能力。

### 真机与业务

- [ ] 新装、升级、弱网、拒绝权限、后台/前台、崩溃恢复、注销重装通过。
- [ ] 三语言无缺 key/占位符，金融/合规越南语经母语和法务审校。
- [ ] 充值/提现/订单/设备/锁仓/兑换/奖励结果以服务端权威闭环，无客户端假成功。
- [ ] 所有链接、截图、支持/隐私/删除 URL 在审核网络可达。

### 审核一致性

- [ ] 审核账号与同条件普通账号得到相同功能和策略。
- [ ] 商店元数据覆盖包内和远端可启用的全部实质功能。
- [ ] 目标国家与 server geo gate、牌照矩阵、商店 availability 一致。
- [ ] Apple/Google 隐私答案与最终抓包/SDK/服务端落库一致。
- [ ] 无未关闭 STORE-B01..B12、P0/P1/P2/P3。

## 12. 送审后运营

1. 审核中冻结功能性 remote config；安全止血例外须记录并主动在 Review 沟通中解释。
2. 保持 demo 账号、后端、支持/隐私/删除 URL 和审核联系人可用。
3. 收到拒绝时按具体 guideline 建事实/证据/修复表，不用换壳、改名、换账号规避。
4. 上线后每次 SDK、权限、数据目的、金融功能、地区、法律主体、付款或远端能力变化都触发重新合规评估与表单更新。
5. 保存每次 submission 的 build hash、元数据、截图、隐私答案、Review Notes、附件、沟通和决定，形成可追溯版本。

## 13. 当前阻断清单

| ID | 现状 | 下一产物 |
|---|---|---|
| APP-OQ-01 | `name/appid/description` 为空，bundle/package identity 未锁定 | 商店身份决策与签名配置 |
| APP-OQ-02 | Android 宽泛权限未证明必要 | 最小 manifest + 真机权限映射报告 |
| APP-OQ-03 | 隐私政策与注销实际入口未确认 | 公开 URL + App 真机闭环 |
| APP-OQ-04 | 服务法律主体、牌照、地区和合作方均 TBD | 国家×功能牌照矩阵 |
| APP-OQ-05 | NEX、兑换、Staking、Genesis、收益/任务奖励分类未签字 | Apple/Google/当地法律逐功能意见 |
| APP-OQ-06 | Janus/C2 远端策略可能用于双模式 | 完整规则树、动作、代码下载路径和审核一致性证明 |
| APP-OQ-07 | 最终第三方 SDK/域名/数据流未知 | 最终包 SBOM + 抓包 + 数据清单 |
| APP-OQ-08 | iOS/Android 支付与 IAP 边界未定 | SKU×数字/实体×付款路径矩阵 |
| APP-OQ-09 | 审核账号、沙箱、Review Notes、附件未创建 | 可复用 review pack |
| APP-OQ-10 | 当前多处收益/任务/NEX 文案可能触发误导或政策风险 | Claims ledger + 全文案法律审查 |

## 14. 官方基线链接

- Apple：[App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)、[App privacy details](https://developer.apple.com/app-store/app-privacy-details/)、[Offering account deletion](https://developer.apple.com/support/offering-account-deletion-in-your-app)、[App Review](https://developer.apple.com/app-store/review/)。
- Google Play：[Deceptive Behavior](https://support.google.com/googleplay/android-developer/answer/17006354?hl=en)、[User Data](https://support.google.com/googleplay/android-developer/answer/10144311?hl=en)、[Data safety](https://support.google.com/googleplay/android-developer/answer/10787469?hl=en)、[Account deletion](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en-EN)、[Review sign-in details](https://support.google.com/googleplay/android-developer/answer/15748846?hl=en)、[Cryptocurrency exchanges and software wallets](https://support.google.com/googleplay/android-developer/answer/16329703?hl=en)、[Blockchain-based content](https://support.google.com/googleplay/android-developer/answer/13607354?hl=en)。
- 越南：[Luật số 91/2025/QH15 - Luật Bảo vệ dữ liệu cá nhân](https://vanban.chinhphu.vn/?classid=1&docid=214590&pageid=27160&typegroup=)，官方页面显示 2026-01-01 生效。

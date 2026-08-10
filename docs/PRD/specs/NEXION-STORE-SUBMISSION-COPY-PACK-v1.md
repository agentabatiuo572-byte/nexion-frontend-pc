# NEXION 应用商店送审文字材料包 v1

> **现行裁决(2026-08-07)**:全项目已取消 KYC、钱包配对、C4 与 K5；本文相关旧字段、门禁、用例、权限或流程仅保留为历史基线，不得作为现行实现、运营或验收依据。

> 截止日期：2026-08-04  
> 文档状态：`BLOCKED — NOT READY TO SUBMIT`  
> 用途：集中准备 Apple App Store / Google Play 所需元数据、审核备注、隐私/删除/权限文字和拒审回复模板。占位符未替换、产品事实未验证或法律/声明门禁未关闭时，不得复制到商店后台。

## 1. 当前阻断事实

| ID | 当前事实 | 结论 |
|---|---|---|
| STORE-C01 | `D:\workspace\NX1.0\src\manifest.json` 的 `name`、`appid`、`description` 为空；Android/iOS 最终包身份未锁定 | BLOCKED |
| STORE-C02 | Android 当前声明 `READ_LOGS`、`GET_ACCOUNTS`、`READ_PHONE_STATE`、`WRITE_SETTINGS`、`MOUNT_UNMOUNT_FILESYSTEMS`、网络/Wi-Fi 修改等广泛权限 | BLOCKED；先按功能最小化，不能靠文案解释 |
| STORE-C03 | 法律实体、开发者账号主体、支持/隐私/删除 URL、地址和联系人未确认 | BLOCKED |
| STORE-C04 | NEX、钱包、USDT、兑换、锁仓/APY、Genesis、奖励的法律分类与目标市场未批准 | BLOCKED |
| STORE-C05 | 代码文案含占位 MSB 号、MiCA、Chainalysis、PwC、180% APY、上所和统计排名等未证实声明 | BLOCKED_REMOVE（见 CLM 台账） |
| STORE-C06 | Janus/C2 双模式的审核披露、功能白名单、数据共享和服务端 Geo 边界未关闭 | BLOCKED；禁止审核后变脸 |
| STORE-C07 | App 内与外部网页的账号删除、处理状态、供应商删除回执未形成证据 | BLOCKED |
| STORE-C08 | 实际 SDK、域名、字段、设备标识、跨境和第三方共享清单未冻结 | BLOCKED；无法准确填 App Privacy/Data safety |
| STORE-C09 | 审核账号、沙箱数据、稳定演示路径和审核人员操作说明未验证 | BLOCKED |
| STORE-C10 | 商店截图、预览视频和元数据尚未与最终构建逐页核对 | BLOCKED |
| STORE-C11 | 设备任务/在线/算力与 NEX、USDT 或任何可兑换/可转让资产的关系未形成逐任务矩阵 | BLOCKED；命中商店禁止的任务发币或设备端挖矿即移除，不能用免责声明或 Geo 绕过 |
| STORE-C12 | 最终 iOS 隐私清单、第三方 SDK Privacy Manifest、Required Reason API 和实际 tracking/ATT 状态未随 IPA 锁定 | BLOCKED |

因此本文只提供“可填写模板”和“保守候选文案”，不声称当前 App 可以过审。

## 2. 提交封面

```text
Submission Run ID: STORE-<yyyyMMdd-HHmmss>
Platform: iOS / Android
App name: <APP_NAME>
Bundle ID / package name: <BUNDLE_OR_PACKAGE>
Version / build: <VERSION> / <BUILD>
Git commit / Build artifact SHA-256: <COMMIT> / <HASH>
Developer account legal entity: <LEGAL_ENTITY>
Contract seller / service provider: <ENTITY>
Target storefronts: <EXACT_COUNTRY_LIST>
Enabled feature IDs (F01-F14): <LIST>
Remote config version and allowlist hash: <VERSION/HASH>
Privacy policy URL: <HTTPS_URL>
Account deletion URL: <HTTPS_URL>
Support URL/email: <HTTPS_URL> / <ROLE_EMAIL>
Review account reference: <SECRET_MANAGER_REFERENCE, NOT PASSWORD>
Product/Legal/Privacy/Security approval references: <TICKETS>
```

## 3. 商店元数据候选

以下候选只描述账号、设备/订单查看、帮助内容与支持，不含收益、代币、资质、全球规模或“AI 算力已交付”等未证实承诺。最终名称和功能仍以提交构建为准。

### 3.1 简短描述 / Subtitle

| 语言 | 候选文本 |
|---|---|
| 中文 | 管理账号、设备、订单与服务支持 |
| English | Manage your account, devices, orders, and support |
| Tiếng Việt | Quản lý tài khoản, thiết bị, đơn hàng và hỗ trợ |

### 3.2 完整描述

**中文候选**

> `<APP_NAME>` 为用户提供统一的账号与安全设置、设备和订单信息、通知、帮助内容及客服入口。可用功能会因所在国家或地区、账号状态、设备类型和当前版本而不同。所有重要操作均以应用内显示的当前状态和正式条款为准。  
> `<ONLY AFTER RUN-ID EVIDENCE: 在最终候选验证权限按需请求和账号删除路径后，填入对应的准确说明；验证前删除本句。>`  
> 支持：`<SUPPORT_URL_OR_EMAIL>`；隐私政策：`<PRIVACY_URL>`。

**English candidate**

> `<APP_NAME>` provides account and security settings, device and order information, notifications, help content, and access to customer support. Available features may vary by country or region, account status, device type, and app version. Important actions are governed by the current in-app status and effective terms.  
> `<ONLY AFTER RUN-ID EVIDENCE: insert an accurate statement about just-in-time permissions and account deletion only after both are verified in the final build; otherwise remove this sentence.>`  
> Support: `<SUPPORT_URL_OR_EMAIL>`; Privacy Policy: `<PRIVACY_URL>`.

**Bản tiếng Việt đề xuất**

> `<APP_NAME>` cung cấp cài đặt tài khoản và bảo mật, thông tin thiết bị và đơn hàng, thông báo, nội dung trợ giúp và kênh liên hệ hỗ trợ khách hàng. Tính năng khả dụng có thể khác nhau tùy quốc gia hoặc khu vực, trạng thái tài khoản, loại thiết bị và phiên bản ứng dụng. Các thao tác quan trọng căn cứ vào trạng thái hiện tại và điều khoản có hiệu lực hiển thị trong ứng dụng.  
> `<CHỈ SAU KHI CÓ BẰNG CHỨNG RUN ID: chỉ thêm mô tả chính xác về quyền truy cập theo nhu cầu và xóa tài khoản sau khi đã xác minh trên bản dựng cuối; nếu chưa, hãy xóa câu này.>`  
> Hỗ trợ: `<SUPPORT_URL_OR_EMAIL>`; Chính sách quyền riêng tư: `<PRIVACY_URL>`.

### 3.3 关键词与宣传文本禁止项

在 CLM 获批前不得使用：`180% APY`、固定/被动/保证收益、挖矿赚钱、上所、NEX 价格增长、跑赢 88%/前 2%、限量倒计时、FinCEN MSB、MiCA、Chainalysis、PwC 审计储备、FDIC/SIPC、监管要求、全球最大/最安全/最快。

Apple Promotional Text、Google Short Description、截图标题、推送、审核演示数据和客服宏都受同一限制，不能只清理完整描述。

## 4. Apple Review Notes 模板

```text
App Review Notes — <APP_NAME> <VERSION>(<BUILD>)

Legal entity and service scope
- Developer account entity: <LEGAL_ENTITY>
- Contracting/service entity: <ENTITY>
- This build is distributed only in: <COUNTRIES>

How to review
1. Launch the app and select <LANGUAGE/REGION IF NEEDED>.
2. Sign in with the review account referenced in App Store Connect.
3. Review account/security at: <VISIBLE NAVIGATION STEPS>.
4. Review device/order information at: <VISIBLE NAVIGATION STEPS>.
5. Open Help and Support at: <VISIBLE NAVIGATION STEPS>.
6. Initiate account deletion at: <VISIBLE NAVIGATION STEPS>. The review account uses synthetic data and may be reset after review.

Business model and payments
- Physical goods/services offered in this build: <NONE OR EXACT LIST>.
- Digital content/features sold in this build: <NONE OR EXACT LIST AND IAP IDs>.
- Cryptocurrency wallet/exchange/tokenized assets/staking/rewards: <EXACT TRUTH; DO NOT OMIT>.
- Payment method and why it complies: <FACT + POLICY MAPPING>.

Remote configuration / Janus / web content
- This build receives signed configuration for: <EXACT ALLOWLIST>.
- It does not download executable code or enable features outside the reviewed binary and the server-side market allowlist.
- Review and production accounts receive the same product capability for the same country, account state, and configuration version.
- Current configuration version/hash: <VERSION/HASH>; fallback behavior: <SAFE DEFAULT>.

Permissions and data
- Camera: <ACTUAL USER-FACING FEATURE AND NAVIGATION>.
- Other sensitive permissions: <LIST OR NONE>.
- App Privacy answers include data collected by all integrated third-party SDKs: <SDK LIST/REFERENCE>.
- Privacy Policy: <URL>; account deletion: <IN-APP PATH + URL>.

Contact
- Review contact: <ROLE, NAME, PHONE, EMAIL>
- Available hours/time zone: <HOURS/TZ>
```

不得写“此功能不会被审核账号看到”或仅为审核账号提供白壳路径。若金融/代币功能存在于同一构建、H5 或远程配置能力内，应如实说明并按地区/许可提供证据。

## 5. Google Play 审核与金融功能申报模板

### 5.1 App access

```text
Access instructions
- Account reference: <PLAY_CONSOLE_SECURE_CREDENTIAL_FIELD>
- MFA/OTP handling: <STABLE REVIEW METHOD>
- Navigation: <VISIBLE STEPS>
- Region/account prerequisites: <EXACT CONDITIONS>
- Synthetic data reset: <METHOD>
- Support contact if access fails: <ROLE CONTACT>
```

凭证只放 Play Console/App Store Connect 的安全字段或秘密管理器，不写入 Git、PRD、截图、工单或本文。

### 5.2 Financial features declaration worksheet

| 功能 | 当前代码/文案迹象 | 提交时答案 | 必须证据 |
|---|---|---|---|
| Cryptocurrency wallet/storage | 钱包、USDT/NEX 余额/地址 | `TBD — answer exact build truth` | 托管模式、开发者主体、牌照/地区、密钥控制 |
| Cryptocurrency exchange/transfer | NEX/USDT 兑换、充值提现 | `TBD/BLOCKED` | 持牌实体/合作方、市场清单、Geo、KYC/AML |
| Tokenized digital assets | NEX/Genesis/OG/奖励 | `TBD/BLOCKED` | 法律分类、发行/权利、Play 申报、活动规则 |
| Staking/earning | 30–365d、APY 文案 | `TBD/BLOCKED` | 法律/商店批准、合同、风险、地区 |
| On-device crypto mining | “手机算力/挖矿收益”文案 | 必须用技术事实回答，当前 `BLOCKED` | 包体/CPU/GPU/网络证据，证明是否设备端挖矿 |
| Financial advice/trading signals | 行情、曲线、预测 | `TBD/BLOCKED` | 数据源、功能分类、免责声明不能代替许可 |

不得因为入口由 C2 关闭就回答“没有”；Play 的 Data safety/功能申报需要覆盖当前分发版本和实际可达配置。

### 5.3 Apple 金融/加密不可替代门禁

- 钱包只有在实际提供者以组织身份加入 Apple Developer Program、产品和地区均合法且审核材料完整时才进入候选；一般公司名称或合作方营销材料不能替代该条件。
- 加密交易/传输只能在具备相应许可与权限的地区、通过获批准的交易所提供；必须证明开发者、品牌、客户关系、资金/私钥控制和交易所角色，不能仅签一家“持牌伙伴”就推定满足。
- 最终二进制、远程 H5/C2、任务和奖励链路不得包含设备端加密挖矿，也不得以下载、拉新下载、发布社交内容等任务发放加密货币。每项任务必须记录奖励是否为加密资产、是否可兑换/转让、触发行为和平台结论；命中禁止项即删除功能和全部渠道文案。
- 上述为 Apple 商店最低门禁，不替代目标国家法律、隐私、支付和产品真实性审查。

## 6. 隐私申报工作表

### 6.1 字段到商店类别

| 数据类别 | NEXION 候选字段 | 收集/共享/用途必须核实 | 证据 |
|---|---|---|---|
| Contact info | 电话、邮箱（若有）、支持联系 | 账号、认证、服务消息、营销是否分开同意 | 网络抓包、字段字典、SDK/供应商 |
| Identifiers | userId、设备/会话 ID、广告/安装 ID（若有） | 是否跨 App/模式/设备关联 | SDK 清单、运行抓包、删除测试 |
| Financial info | 订单、支付、钱包地址、余额/流水 | 支付、资产、风控、客服、共享对象 | 资金流、DPA、权限、保留 |
| User content | 工单消息、附件、头像、反馈 | 支持/安全；是否用于模型训练 | 对象清单、内容供应商合同 |
| Sensitive info | KYC、证件、活体/生物结果、风险 | 供应商处理、跨境、人工复核 | 数据流、法律基础、删除回执 |
| Device info | 型号、系统、网络、能力/指纹 | 兼容性、反欺诈、收益/资格是否受影响 | API/SDK 抓包、DEC-025 |
| Usage/diagnostics | 页面事件、崩溃、性能、日志 | 分析/稳定性；同意前行为 | 事件字典、SDK 配置、保留 |
| Location | IP 推断、精确/粗略位置（若有） | Geo/安全；是否请求系统权限 | Manifest、抓包、服务端日志 |

逐类别回答：是否收集、是否与身份关联、是否共享、是否跟踪、目的、必需/可选、加密、删除。Apple App Privacy 需包含第三方伙伴；Google Data safety 是每 package 的全局答案，应覆盖当前分发版本中最广的数据实践。

### 6.2 隐私政策必须出现

- 法律实体与联系、适用产品/包名、发布日期/版本。
- 逐类数据、来源、目的、必需/可选、自动决定与申诉。
- 供应商/子处理者类别和实际名称、地区/跨境、保护措施。
- 保留和删除，不用“业务需要时永久保留”。
- 用户访问、更正、导出、删除、撤回同意和投诉路径。
- 安全事件沟通、未成年人、政策变更的显式重新同意边界。
- Janus/正式模式和不同版本的数据差异必须如实覆盖。

## 7. 账号删除文字

### 7.1 App 内页面

**中文**

> 删除账号将停止你对该账号的访问，并删除与账号关联、我们没有法律义务继续保留的个人数据。尚未完成的订单、资金处理、安全调查或法定记录可能需要先处理或在限定期间保留；页面会列出具体类别和状态。账号停用不等于删除完成。提交后，你可以使用申请编号查看处理进度，完成时会收到确认。

**English**

> Deleting your account ends access to the account and removes associated personal data that we are not legally required to retain. Pending orders, financial processing, security investigations, or legally required records may need to be resolved or retained for a limited period; the app will identify the relevant category and status. Deactivation is not account deletion. After submitting, you can track the request using its reference number and will receive confirmation when it is complete.

**Tiếng Việt**

> Việc xóa tài khoản sẽ chấm dứt quyền truy cập và xóa dữ liệu cá nhân liên quan mà chúng tôi không có nghĩa vụ pháp lý phải tiếp tục lưu giữ. Đơn hàng, giao dịch tài chính, điều tra bảo mật hoặc hồ sơ bắt buộc theo pháp luật có thể cần được xử lý trước hoặc lưu giữ trong thời hạn giới hạn; ứng dụng sẽ nêu rõ loại dữ liệu và trạng thái liên quan. Vô hiệu hóa không đồng nghĩa với xóa tài khoản. Sau khi gửi yêu cầu, bạn có thể theo dõi bằng mã yêu cầu và sẽ nhận được xác nhận khi hoàn tất.

### 7.2 外部删除网页最低内容

`<DELETE_URL>` 必须公开可访问、HTTPS，并明确 App/开发者主体和完整账号删除请求。Google 需要 App 内路径与外部网页资源；外部资源可以是可用、显著且准确标识 App/开发者的删除表单或受控请求渠道，但不能只宣传普通客服而不说明如何删除。Apple 要求支持账号创建的 App 可在 App 内发起删除；若跳转网页完成，应直达可完成删除的页面。两端都不能把冻结/停用当删除。

## 8. 权限决策与用途文案

原则：先删除不必要权限，再为真正用户触发的最小权限写用途。文案不能把后台采集包装成用户功能。

| 当前 Android 声明 | 默认决策 | 仅在何种证据下保留 |
|---|---|---|
| `CAMERA` / camera feature / autofocus | REVIEW | KYC 拍摄、扫码或用户主动上传的真实路径；运行时请求、拒绝可降级 |
| `FLASHLIGHT` | REMOVE unless verified | 仅用户主动打开相机补光且最终合并 Manifest/真机路径证明需要时保留 |
| `ACCESS_NETWORK_STATE` | REVIEW/通常可由框架需要 | 构建合并清单和真实使用证明 |
| `ACCESS_WIFI_STATE` | REMOVE unless essential | 不能仅为设备指纹/收益资格采集 |
| `CHANGE_NETWORK_STATE` / `CHANGE_WIFI_STATE` | REMOVE | 普通用户 App 通常不应修改网络状态；需核心功能与审核证明 |
| `READ_PHONE_STATE` | REMOVE | 不得为获取手机型号而请求；标准设备型号 API 不需要该权限 |
| `GET_ACCOUNTS` | REMOVE | 当前无核心、可见的系统账号读取需求 |
| `READ_LOGS` | REMOVE | 普通 App 不应读取系统日志；崩溃只采自身最小诊断 |
| `WRITE_SETTINGS` | REMOVE | 不得要求修改系统设置来维持在线/收益 |
| `MOUNT_UNMOUNT_FILESYSTEMS` | REMOVE | 旧/高风险权限，无当前必要性证据 |
| `WAKE_LOCK` | REVIEW | 仅真实、披露的长任务且有电量控制；不可伪装挖矿 |
| `VIBRATE` | REVIEW | 用户触发通知/反馈，可关闭 |

### 相机用途文案（只有保留时使用）

- 中文：`用于你主动扫描二维码或拍摄身份核验材料。只有在你打开相关功能时才会请求相机权限。`
- English: `Used when you choose to scan a QR code or capture identity-verification material. Camera access is requested only when you open the relevant feature.`
- Tiếng Việt: `Được sử dụng khi bạn chủ động quét mã QR hoặc chụp tài liệu xác minh danh tính. Quyền truy cập camera chỉ được yêu cầu khi bạn mở tính năng liên quan.`

若实际用途不是上述两项，必须重写并重新评估，不能复用模板。

### 8.1 iOS 隐私清单与 Tracking 门禁

- 从最终 IPA 导出 App 自身和所有第三方 SDK 的 Privacy Manifest，核对声明的数据、域名和 Required Reason API；SDK 版本变化自动重新审查。
- 对每个 Required Reason API 记录实际调用、允许原因代码、调用路径和移除可能；不以“框架自动带入”跳过。
- 只有实际发生跨公司/跨 App tracking 或访问广告标识符等受 ATT 约束的行为时，才按真实用途配置 ATT 并在访问前取得授权；若不需要 tracking，移除相关 SDK/调用和声明，不用弹窗为过量采集免责。
- App Privacy、二进制 Privacy Manifest、网络抓包和隐私政策必须一致；任一不一致保持 STORE-C12 阻断。

## 9. 截图与预览文字清单

截图必须来自同一最终候选、真实审核账号和批准地区，不通过 Photoshop/DOM 修改制造功能。

| 序号 | 候选画面 | 安全文案候选 | 禁止出现 |
|---|---|---|---|
| 1 | 账号与安全 | “集中管理账号与安全设置” | 收益数字、资质徽章 |
| 2 | 设备列表 | “查看已关联设备及当前状态” | 未证实算力/收益倍数 |
| 3 | 订单 | “跟踪订单和服务进度” | 虚假库存/倒计时 |
| 4 | 通知 | “接收与你的账号和服务相关的更新” | 代币价格/高收益 Push |
| 5 | 帮助与客服 | “从应用内获取帮助并跟踪工单” | 未批准 SLA |
| 6 | 隐私与删除 | `<ONLY AFTER DELETE E2E RUN-ID: 管理隐私选择并发起账号删除>` | 在 STORE-C07 关闭前使用该截图/标题，或把冻结说成删除 |

若最终构建不包含某画面，删除该截图；第 6 张只有在删除 E2E Run ID、最终构建截图和供应商回执关闭 STORE-C07 后才可使用。若包含金融/代币能力，不能用上述六张“干净截图”隐瞒。

## 10. 常见审核问询回复模板

### 10.1 “我们发现未在备注说明的金融/代币功能”

```text
Thank you for identifying the discrepancy. We have paused this submission and are reviewing the exact build, remote configuration, and storefront scope. We will not use account-specific or review-specific configuration to hide functionality. Before resubmitting, we will either remove the capability from the distributed build and server access path, or provide complete feature, licensing, market, payment, privacy, and review instructions. The next submission will include the relevant build and configuration hashes.
```

### 10.2 “账号删除不完整”

```text
Thank you. The updated build provides a discoverable in-app path at <PATH> to initiate deletion of the entire account, and an external request page at <URL>. Deactivation is not treated as deletion. The flow shows pending processing and legally required retention categories, propagates deletion to applicable processors, and provides completion status using reference <FORMAT>. Review steps: <STEPS>.
```

### 10.3 “权限与核心功能不匹配”

```text
We agree that permissions must be limited to current user-facing functionality. In build <BUILD>, we removed <PERMISSIONS>. The remaining permission <PERMISSION> is requested only after the user opens <FEATURE>, is optional where applicable, and has the following fallback when denied: <FALLBACK>. Attached evidence: merged manifest, runtime-permission walkthrough, and network/data capture.
```

回复必须描述已经完成且可验证的变化；不得用“计划在下个版本修复”冒充本次已合规。

## 11. 提交前最终核对

- [ ] 身份字段、主体、包名、版本、商店国家和制品哈希锁定。
- [ ] `manifest` 合并结果与二进制权限扫描完成；广泛权限已删除。
- [ ] 目标国家 × 功能矩阵逐格批准，服务端 Geo 和商店区域一致。
- [ ] 金融功能、IAP/Play Billing、实物支付分类和申报如实完成。
- [ ] CLM 全量扫描无 `BLOCKED_REMOVE`；截图/推送/客服/旧 C2 内容同步。
- [ ] SDK、域名、数据字段、第三方、跨境、保留和删除与隐私申报一致。
- [ ] App 内/外账号删除、供应商传播、例外和完成通知端到端通过。
- [ ] Janus/C2 白名单、签名、版本单调、安全默认、审核/生产一致性通过。
- [ ] 审核账号无需人工临时开权限即可走完路径；不含真实用户数据。
- [ ] 冷启动、拒绝权限、离线、刷新、重登、404/超时/畸形响应均可理解且失败关闭。
- [ ] 审核备注、支持联系人和三语元数据由产品、法务、隐私、安全共同签字。
- [ ] 最终截图/视频由同一构建生成，所有链接可公开访问且无测试占位。

## 12. 官方政策链接（提交当日重新核对）

- Apple：[App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)、[Offering account deletion in your app](https://developer.apple.com/support/offering-account-deletion-in-your-app)、[Manage app privacy](https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy)。
- Google Play：[Cryptocurrency Exchanges and Software Wallets](https://support.google.com/googleplay/android-developer/answer/16329703?hl=en)、[Blockchain-based Content](https://support.google.com/googleplay/android-developer/answer/13607354?hl=en)、[Payments](https://support.google.com/googleplay/android-developer/answer/9858738?hl=en)、[Account deletion](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en-EN)、[Data safety](https://support.google.com/googleplay/android-developer/answer/10787469?hl=en)、[User Data](https://support.google.com/googleplay/android-developer/answer/10144311?hl=en)。

完成本文不等于可以提交；只有第 1 节全部阻断项关闭、第 11 节全绿、最终构建真实走查通过并由对应 Owner 签字后，状态才能从 `BLOCKED` 改为 `READY FOR SUBMISSION`。

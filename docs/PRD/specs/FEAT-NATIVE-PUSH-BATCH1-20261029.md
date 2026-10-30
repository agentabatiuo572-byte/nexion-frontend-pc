# 安卓/iOS 业务推送第一批

日期：2026-10-29；通道修订：2026-10-30。依据：用户要求补齐第一批，“设备到期”限定现有试用设备结束与抵扣保留期结束。现场确认 DCloud 国际应用没有 UniPush 入口后，用户选择保留国际应用，Android 直连 FCM、iOS 直连 APNs；后续要求 TEST 与正式统一使用 ai.uvel.app 标识及推送私钥，避免提交生产时人工更换配置，取代此前 ai.uvel.app.test 的 TEST 标识方案。

## 用户结果与范围

用户在安卓/iOS App接收与本人有关的试用到期、设备持续异常、资金结果、账号安全、客服新回复。App内消息继续持久可读；允许系统通知且外部通道配置完成时，可以通过系统通知进入App查看当前业务详情。通知不执行付款、提现、结算、设备停用或其他业务命令。

本批不包含营销群发、行情播报、团队收益高频逐笔推送、浏览器系统推送。已购设备没有固定到期日，不从E3图表的cycleMonths推导设备失效，也不新增已购设备期限。

## 消息与触发事实

| 类型 | 用户触发结果 | 权威来源与限制 | 落地入口 |
|---|---|---|---|
| DEVICE_EXPIRY | 试用即将结束、试用结束；抵扣保留期即将结束/已结束 | 正式nx_trial_claim领取快照、截止时间、实际状态与现行宽限规则。提前24小时/1小时按适用阶段提醒；同领取同截止同阶段一次，不推送无截止日已购设备 | 试用详情 |
| DEVICE_ALERT | 当前有效设备持续离线/异常 | 服务端已确认运行态，持续15分钟防短暂抖动；同异常周期一次，正常恢复后新异常可再次提醒。主动停用/退役不当作故障 | 对应设备详情 |
| FUNDS_RESULT | 充值到账、提现完成/失败/退回、退款结果 | 已成功提交的账务/支付终态及原单；通知不改变资金结果、不触发资金重放，不把待处理写成完成 | 钱包/原单详情 |
| ACCOUNT_SECURITY | 新登录环境、密码或支付方式等安全变化 | 成功的服务端会话/审计事实，重复同环境登录不轰炸；不能把客户端自报安装标识当物理设备证明 | 账号/安全设置 |
| SUPPORT_REPLY | 专属客服新回复 | 已持久化、获准会话中的正式客服ADMIN回复；只发给客户本人，不通知消息作者，不按机器人中间输出发消息 | 专属客服会话 |

消息正文按用户中文/英文/越南语生成。锁屏使用概括提示，不含余额、收款地址、完整手机号、密码、令牌、客服正文或推送绑定证明；查看详情必须恢复登录并通过当前权限校验。资金/账号安全为critical，其他三类为high并遵循现有系统/服务偏好；五类均不由营销开关控制。操作系统通知权限始终由用户决定。

## 绑定、点击与账号隔离

- 原生安装在已有APP会话下绑定真实供应商令牌（Android FCM / iOS APNs），后端仅从认证会话取用户与合法安装身份；H5不能凭浏览器字段注册原生推送。平台与 provider 必须匹配。
- 安装绑定需要随机绑定证明，客户端先持久化再发送，服务端只存哈希；注册首次响应丢失可用原证明重试，不把令牌放入URL或日志。
- 登出、换账号、令牌/供应商轮换与会话撤销使旧绑定/旧代际待投递失效。投递前再次核验用户、会话和绑定，不能把旧账号通知发到新账号安装。旧 UniPush 绑定不转换为直连令牌，需要新版本重新注册。
- 安全吊销或限制后的旧安装不绕过会话检查接收系统推送。用户完成正常重新登录后，当前有效安装可补收本次功能基线之后、最近24小时内的critical账号安全消息各一次，避免密码重置/新登录消息早于令牌绑定而丢失；其他类型不补发绑定前消息。
- 通知载荷只携带通知标识。点击后向服务端读取当前用户获准目标，仅允许已登记的内部详情页；不信任供应商载荷中的URL、金额或账号字段。
- 已登录客户查看本人通知并进入其合法目标，不要求先完成设备初始化校准、购买或激活设备。客户端仍须真实远端认证、界面账号与服务端账号一致、当前页面路由就绪，且不处于登录/公开流程或静态预览；保留结账离开保护。先读取本人通知并验证通知标识与内部路由，再定位对应业务详情，导航成功后登记opened；客服回复进入该通知实际会话的cid，不只打开App或停留首页。
- 冷启动/未登录时先恢复正常登录流程，再核验通知归属；他人通知或过期权限拒绝后，不显示旧私有内容，也不执行通知中携带的动作。
- 拒绝系统权限仍可正常使用站内消息；客户端撤销当前安装绑定并关闭原生注册，避免 iOS 拒绝授权无令牌时遗留旧绑定。恢复系统权限后，前台绑定刷新恢复后续投递，不反复弹窗请求。

### 偏好设置与系统通知入口（2026-10-30 用户确认）

App「偏好设置」隐藏「质押到期」通知选项，仅移除当前页面的展示与交互；保留后端 staking 偏好字段、既有值及历史通知，不因页面保存其他偏好而重置隐藏值。该隐藏决定不删除业务通知数据，也不新增质押到期推送能力。

系统通知权限区复用设置页现有玻璃卡片（`nx-glass-card` / `cardStyle`）及图标行，完整显示标题、真实权限状态和明确的开启/设置动作；卡片间距、图标、文字层级及点击区域与其他设置项一致，不能显示成缺少卡片和操作辨识的裸文字。未知权限时发起正常系统授权；已授权或已拒绝时打开本应用系统设置，返回 App 后重新读取真实权限并刷新显示。原生 Token 获取或后端登记失败单独显示连接异常和重试，不覆盖真实系统权限；当前账号、会话与令牌代际匹配且登记成功后才清除连接异常。权限状态和动作结果不能由旧页面状态或本地成功提示代替。

iOS 使用 Apple 公开的本应用设置入口（`app-settings:`，参见 [`UIApplication.openSettingsURLString`](https://developer.apple.com/documentation/uikit/uiapplication/opensettingsurlstring)）；当前 App 通过 HTML5+ `openURL` 调用，处理打开失败与同步异常。失败时向用户说明未能打开，提供从系统「设置」进入 UVEL 通知设置的手动路径，不静默无反应或显示成功。Android 同样进入本应用通知设置，失败有明确反馈。此处定义用户行为与界面合同；源码测试、资源构建、完整原生包及双平台手机实际操作分别验收，不以源码通过或旧签名包结果宣称本轮已在手机生效。

## 投递与恢复合同

业务消息统一使用NATIVE1:业务键与上述五类类型，按事实唯一键幂等。迁移/启用建立持久基线，不给历史用户补发大量旧提醒；重启不重置基线。外部推送以安装和通知为唯一投递对象；明确的临时拒绝有界重试，失效令牌停用。FCM/APNs 不提供本系统投递编号的严格幂等保证，发送后响应丢失、进程中断或发送租约过期进入 UNKNOWN，不盲目重发；用户仍可读取持久站内消息。

状态分开记录：业务站内消息、待投递、供应商已接受、投递失败/失效、用户已打开。旧nx_notification.push_status=DELIVERED只代表既有站内投影，不能当作APNs/安卓设备送达。供应商成功受理也不能标成“用户已收到”；双平台真机通知栏证据单独保留。

Android 使用官方 Firebase Messaging SDK 获取 FCM token，Java 通过 FCM HTTP v1 和服务账号短期 OAuth 令牌发送；iOS 使用 APNs 原生注册、通知点击生命周期，Java 通过 HTTP/2 与 ES256 短期认证发送。Android 通知渠道为 uvel_notifications，载荷只含概括内容与 notificationId。客户端不包含服务端私钥，不能匿名群发。APNs topic 必须与实际 Bundle ID 匹配，sandbox 与 production 显式区分；配置不完整不伪报成功。私钥从部署安全文件提供，不提交到仓库、PRD或验收报告。

FCM 依赖可用 Google Play 服务和网络；没有 GMS 的安卓设备明确表现为系统推送不可用，站内消息保持正常。本批不宣称覆盖国内厂商离线通道。普通调试基座没有新增原生插件，必须重建自定义基座/安装包；JS 构建通过不等于 Kotlin/Swift 原生编译或真机送达通过。

本批 Android 安装包最低为 Android 6.0（API 23）；iOS 原生插件最低要求 iOS 13，最终安装包仍需签名后核对。Android 13 及以上使用目标 API 33 或更高版本，让通知权限在登录后的业务授权流程中发起。已有拒绝状态在升级后保留，用户从系统设置重新开启后恢复注册。资源编译器与原生 SDK 的运行版本必须一致，启动版本警告未解决时不判为真机验收通过。

### iOS Hook 与原生打包前置

DCloud 官方 [UTS 生命周期回调说明](https://uniapp.dcloud.net.cn/plugin/uts-plugin.html#应用程序生命周期函数监听)要求推送相关 Hook 配合基础 Push 模块、具备推送能力的证书及正确 `aps-environment`；自定义 Hook 类按协议自动注册。当前直连方案在 manifest 仅加入基础 `Push: {}`，不选择 UniPush 版本或供应商，两平台 `pushRegisterMode` 均为 `manual`，由现有授权流程发起原生注册；iOS 该字段语义见 [manifest 配置](https://uniapp.dcloud.net.cn/collocation/manifest-app.html#app-ios)。此基础模块不把 FCM/APNs 直连改回 UniPush，不恢复 CID 或 UniCloud 依赖。

插件持久保存 `UTS.entitlements` 的 `aps-environment=production`，与已批准 TestFlight 分发签名一致；完整新包仍须核对最终签名权限及匹配 profile，源码文件不代替签名证据。3003 静态制品中的成功/失败 Hook selector 已存在，但 manifest 缺少上述基础 Push 模块；这是已确认的打包前置缺口，不能仅凭 selector 或补配置断定3779未取得 APNs Token 的唯一实机根因。

## API合同

| 方法/路径 | 输入 | 约束 |
|---|---|---|
| PUT /api/me/push-installations/{installationId} | clientId（真实令牌）,provider（FCM/APNS）,platform,permission,appVersion；X-Push-Binding-Token | 当前APP会话、安装身份与绑定证明；Android=FCM、iOS=APNS；不接受body授权userId |
| DELETE /api/me/push-installations/{installationId} | X-Push-Binding-Token | 只撤销当前合法绑定 |
| GET /api/me/push-notifications/{notificationId} | 无 | 当前用户所有权，返回字符串notificationId与合法内部route |
| POST /api/me/push-notifications/{notificationId}/opened | installationId | 当前用户与安装归属，幂等记录打开；不等同设备送达回执 |

原生安装登记/撤销、本人通知详情读取与点击定位、通知打开回执属于基础设施操作，不要求客户先完成初始化校准或购买/激活设备。初始化未完成时也允许上述合法方法和完整路径；认证、当前 APP 会话、安装归属、绑定证明及回执校验继续由原服务执行。此例外不扩大订单、付款等业务命令，也不放行相似路径、错误方法或非法标识。

## 开通、发布与验收

当前方案：保留 DCloud 国际应用 UVELProduction（__UNI__G77FFD9D），不依赖 UniPush/UniCloud。TEST 与正式的 Android 包名/iOS Bundle ID 统一为 ai.uvel.app，共用同一 Firebase 项目/Android 客户端/FCM 私钥与同一 Apple App ID。已试配 Firebase 项目为 uvel-test-push，其 ai.uvel.app.test 客户端保留；统一标识客户端、FCM 发送账号/私钥和 APNs 私钥已获用户确认并创建，私钥仅在受限安全配置中保存。APNs 新建密钥只支持一个环境；共用一把的候选方案为两环境均走 Production 通道，iOS TEST 使用匹配 production entitlement 的分发签名（例如 TestFlight），用户已确认此签名及共享凭据方案；本机原有分发签名已核对，新版 TestFlight profile 已重新生成并验证 production 推送权限。开发签名 Sandbox 包仍需额外密钥，不修改描述文件冒充 Production。签名/密钥/通道匹配后重建原生包；配置核验前保持投递关闭，TEST真机验收按获准设备与持久初始边界受控启用，未验范围继续单列，生产启用另需批准。

API、数据库、会话、消息队列与推送启停按业务环境独立配置，通过构建/部署安全注入避免人工改源码换密钥。统一包名不能同机并存，共用凭据也不提供跨后端令牌归属互斥；环境切换前需在线撤销旧绑定并退出登录，测试发送只面向获准安装。现有所有权和事实去重在各自数据库内执行，不把共用凭据表述为跨环境投递隔离。统一标识/密钥不包含生产发布批准。

必要验证：五类消息真实事实映射/去重；过期/持续异常边界；资金事实不改变；用户、安装、会话隔离；签名、超时、失败重试和中断恢复；冷启动与点击权限；三语言与H5隔离。安卓与iOS分别覆盖前台、后台、结束进程、权限拒绝和重新开启的系统通知栏实际结果。

验收状态按代码测试、隔离数据库/HTTP、TEST部署、安卓真机、iOS真机分别记录。第一批业务测试计划：D:/workspace/output/push-batch1-20261029/TEST-PLAN.md；直连通道测试计划：D:/workspace/output/push-direct-20261030/TEST-PLAN.md。最终交付回执与代码配置说明记录实际完成情况，不能把计划或供应商受理当作真机通过。

### 2026-10-30 Android3003历史烟测

Android 已完成单目标供应商/客户端烟测：冻结候选为 `54a3e566 + 53b6f010 / 1dfc0b74`，实际 APK 版本 `2026103003`，资源编译器与原生 SDK 均为 5.33，minSdk 23、targetSdk 33，同签名安装并连接 TEST。真实 FCM 令牌长度 142，当前 APP 会话与安装登记匹配；首次系统授权、从设置关闭通知后重新开启均已验证。

前台（通知 43814）、后台（43815）及冷启动（43816）三次单目标发送均获 FCM HTTP 200/ACCEPTED，有实际系统通知记录，点击均进入安全页。冷态通过 Home 后 `am kill` 确认进程不存在，未测试 force-stop。三条通知的 GET 路由解析与 POST opened 请求在服务访问日志中均为 HTTP 200，证据见 `D:/workspace/output/push-direct-20261030/android-push-click-http-readback.json`。

本轮只使用三条明确标记 TEST 的验收消息，没有真实账号安全事件、权威业务事实或 native delivery 行。上述 HTTP 200 仅证明请求被接受，不证明 opened_at 已持久化；五类真实业务触发、dispatcher、租约与打开回执持久化仍待端到端实测。令牌轮换、登出/切号尚未完成真机全测；iOS 已取得下述完整 IPA，真机验收仍未完成。其余证据与剩余项见 `D:/workspace/output/push-direct-20261030/REPORT.md`，不得将本次 Android 烟测扩展为双平台或完整业务链通过。

上述 Android 3003 烟测阶段由本地安全发送器仅向已核验安装发送三条消息，当时未部署服务端供应商私钥或修改服务配置；该历史烟测不代表 TEST 业务自动队列或生产推送已启用。后续运行状态以下方本轮配置记录为准。

### 2026-10-30 iOS3003历史完整包交付

Swift 编译修复已进入 App `test` 提交 `4f36f857`。完整云打包成功并已下载 `UVEL-TEST-2026103003.ipa`（36,697,634 bytes；SHA256 `3efc157150bb6ac55412ad0fcad7a4499d1ec6c6ce0a796959810333e355e454`）。实际 Bundle ID 为 ai.uvel.app，连接 TEST，包及全部内嵌 framework 的最低系统为 iOS 15.0，因此 iOS 16 位于声明支持范围；尚未作 iOS 16 实机运行验证。原生 Bridge 与 Hook 已进入独立推送 framework，包内签名权限及匹配描述文件的 APNs 环境均为 production；未发现供应商私钥文件或 PEM 私钥标记。

本包使用 TestFlight 分发签名，不能把 IPA 下载链接当作直接安装入口。经用户批准，已上传 Apple：上传状态 COMPLETE、构建处理状态 VALID，无错误或警告。内部组 UVEL TEST Push 关闭自动分发和公开链接，仅手动关联构建 2026103003 与用户指定的单个账号；构建状态为 IN_BETA_TESTING，该账号在 Apple 页面显示已邀请（2026-10-30），未确认邀请邮件收件箱送达。

上述 3003 交付回执当时未完成 iPhone 安装、iOS 16 实机运行或真实 APNs 投递，本地亦未独立进行密码学验签。Apple 处理和定向内部邀请不补齐尚缺的业务链/双平台实机验收，也不构成公开发布。产物检查与分发证据位于 `D:/workspace/output/push-direct-20261030/`：`native-ipa-inspection-2026103003.json`、`independent-ios-ipa-review-2026103003.md`、`testflight-upload-receipt.json`、`testflight-processed-build.json`、`testflight-distribution-readback.json`、`testflight-invitation-readback.json`、`testflight-internal-testing-ready.png`。

### 2026-10-30 本轮修订与分层验收

App `test` 已提交并推送 `4c6f1362`（本轮 11 文件）：偏好卡片与设置失败反馈、隐藏质押展示、系统权限与连接状态分离，以及基础 Push、手动注册和持久 production entitlement。95 项定向行为测试及新增配置检查通过；这些是源码层验证。

iPhone 用户已确认 3004 的系统通知卡片可打开系统设置、通知权限为已允许、质押到期选项隐藏。3004 实际包检查记录为基础 Push 模块存在、宿主手动注册及 production 签名权限匹配，见 `D:/workspace/output/push-direct-20261030/native-ipa-inspection-2026103004.json`。这部分单独记为界面/权限操作，实际系统通知与点击结果见下文。

Android 在 Samsung 上以同签名 3003 原生宿主加 `4c6f1362` 资源测试包，实际验证卡片、隐藏质押选项、打开系统设置及返回 App；这不是完整 3004 云包。Android 完整云包被 DCloud 当日打包配额阻挡，资源测试不能证明新增原生打包配置已在新宿主生效，相关日志及页面图见 `D:/workspace/output/push-direct-20261030/`。

后端 #686 初始化门禁例外修复 `81c3b58d` 的61项定向测试通过。3779同一安装的登记PUT于10:05:44及10:07:16 UTC均HTTP200；18:07:16+08数据库读回APNS、ios、granted、active1、epoch2，token_digest长度64，仅保留长度、不记录令牌或散列值。界面缺陷683及登记缺陷686已由主控通过官方流程关闭，这两项不代替投递或点击验收。

业务扫描性能修复 #687 / `47fccfed` 在真实runtime407相同RR快照下，旧OR完整查询2,976,340μs、新CASE85,767μs，2候选的完整五字段与顺序一致；索引迁移APPLIED、内容hash及查询计划匹配，19项专项通过。正常投影观察窗三来源待处理为0、累计35facts；期间独立发现 #688 通知页留存与通知INSERT的secondary-gap死锁。688仅将page事务改为READ_COMMITTED，留存规则与其他写事务保持，真实Spring+MySQL并发红绿及26项专项通过。Jenkins408已SUCCESS且可信DEPLOYED，runtime为`c2e3a0bb`，config/API200；这不扩大为所有并发故障已覆盖。

TEST当前business/native/scheduler三开关均true，FCM/APNS配置客户端均为CONFIGURED。首次native边界在UTC10:54:25.334943按RC事务、control→cursor顺序加锁，三源pending0、全部待发queue0、control1及双baseline非空时，CAS1将43810一次推进至43889，提交后读回一致；baseline不变、没有历史重放，此后边界固定，不周期推进MAX。本次发送仅面向获准TEST安装，不构成生产发布。

单条真实客服验收从独立PC页仅向3779发送`[TEST 推送验收1030-01]`：human3811（ADMIN1、assignment18）提交于UTC10:56:19.687646→fact SUPPORT:3811→notification43890/SUPPORT_REPLY、会话CV-APP-20261030124047266-a859d9c4→native delivery1/APNS_ACCEPTED/ACCEPTED、attempt1，供应商回执BEF5678E-A539-503C-FE2B-4F3042825F30。用户确认3004在后台实际收到系统通知；点击只打开App、未进入对应客服模块。该通知GET与opened POST观测请求次数均为0，opened_at为NULL，点击定位及打开回执未通过；3779既有assignment18/admin1/version1/MANUAL保持。

点击缺陷 #689 已以App `test / c05b12c5` 修复设备初始化对本人通知导航的额外阻挡，保留认证、账号一致、路由就绪及原有安全保护。实际App旧源热/冷两例先红，新9项行为、controller63项、adapter20项共92项结果与类型检查通过，独立复核无阻塞；五类目标路由/页面参数协议及客服真实cid经源码核对，尚不是五类真机验收。精确该源码的3005 stage、真实5.33资源及官方CLI资源编译成功，但20:14:07云端明确返回当日免费打包配额耗尽；仅尝试一次，未生成云包/IPA、未上传Apple，未重试、换账号、付费或绕过额度。当前App没有既有runtime.install/WGT资源更新执行通道，资源包不能替代TestFlight安装。

手机当前仍为3004。结论限于TEST后端配置、单条客服业务投递至真实APNs接受及iOS后台展示通过；689源码已修，3005受外部配额阻塞尚未发布，手机跳转客服与打开回执仍未通过。五类业务、iOS前台/后台/冷启动与点击全覆盖、首次拒绝/恢复、Token轮换及登出/切号缺口继续保留，后续新包需按精确通知ID重新验收。证据索引见 `D:/workspace/output/push-direct-20261030/REPORT.md` 与 `TEST-PLAN.md`。

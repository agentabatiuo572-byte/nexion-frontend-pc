# UVEL App/H5 高频 Tab 只读呈现与请求规则

日期：2026-10-27。来源：用户全站静默刷新要求及本轮 Team 快切真机诊断。适用：首页、赚取、商城、团队、我的普通底栏导航中的只读展示；本候选具体实现 Network、团队佣金事件与邀请奖励读取。其他模块由对应修复负责人实现。

## 已确认问题

真机诊断资源 20e554bb 对应独立诊断源码 ac4d2f9。Team 同实例、同绑定、目录有效且已确认展示仍存在时，目录 runtime 轮换把佣金状态短暂置为 idle，旧呈现选择器将四个收入值判为不可见。更晚的快速切换产生当前 Network 与 Commission HTTP 429；旧实现清除已确认收入，后续读又显示加载文字。原仅检查 nextTick 后状态的测试漏掉同步 idle 转移。

## 展示与操作

- 团队收入的静态标题、单位与布局始终保留。首读未知数字为“—”，首读及暖读均不显示“正在读取团队网络”文案。
- 同账号、绑定、环境与查询的已有确认数字用于只读展示；正常后台读和目录 runtime 的 idle/loading 转移不清空该展示。
- HTTP 429 属于暂时读取失败：保留当前 owner 的历史数字，同时显示真实失败和重试。读取状态仍为 error，佣金权威证据仍清空，不伪装 ready；历史数字不授予余额、库存、报价、资格、支付或其他命令权。
- 401/403、认证、业务、协议及配置拒绝等严格失败清除私有历史数字。账号/绑定/环境/接口地址/语言呈现作用域改变清除旧展示；旧请求不得回填新 owner。
- 错误或未决读取期间，收入展开控件仍不可操作；重试入口保留。重试受服务端冷却约束，不因按钮可见而越过 Retry-After。

## 只读请求

- 普通 Team onShow 使用 Network/Commission ensure：同一当前账号、绑定及 runtime 的未结请求合并，不为每次返回另起请求。
- 最近成功结果对普通读取保持 15 秒 freshness；成功空结果同样有效。超过窗口后的普通读取可以新读。
- 显式刷新与业务失效发起新读取，不受普通 freshness 阻挡；原请求代次与账号/runtime 响应围栏保留。
- 当前 HTTP 429 按 ApiError.retryAfterMs 记录冷却，尊重有效的 0；没有有效头时使用 30 秒。冷却期间普通返回、runtime 自动重读及手动重试均不新增该读取请求。
- 冷却到期不安排自动循环或无限重试；下次已授权的普通读取/显式重试可以新读，成功恢复 ready 与新数字。
- 冷却仅属于当前账号/绑定/环境，不把旧请求的失败或成功用于新 owner。运行中更换 API 环境/地址使当前客户端失效，清空旧状态并等待应用正常重载建立新客户端。
- 以上机制仅用于本次只读路径，不进入全局 transport，不缓存业务命令，不更改实时资金/库存/资格判定。

## 邀请奖励与分享权限

- 已确认的“每位好友达标可获”奖励数字仅保留在当前 InviteEarnCard owner 的内存只读呈现中，不落盘，不保存邀请码、链接、钱包余额或分享资格。
- 邀请接口不套用 15 秒 live freshness；每次普通返回仍需当前读取，仅合并同账号/绑定/runtime/limit 的未结请求，避免将旧邀请码或资格当作新确认。
- 当前 429 按相同 Retry-After/缺省 30 秒冷却保留奖励历史数字，保留真实错误与重试；store live snapshot 仍为 null，四个复制/链接/海报/分享入口的可操作条件与 handler 均只认当前有效 snapshot，历史数字不能恢复这些操作。
- 成功重试以当前已确认值替换，确认零显示零；奖励关闭或严格拒绝清除原奖励数字。账号/绑定/环境/接口地址/语言改变清除旧呈现，旧请求不能重新建立当前 owner 的奖励数字或邀请码。
- 奖励关闭后是否允许无奖励分享仍按原服务端确认结果和现有分享规则处理，本次不新增奖励或分享权限。

## 验证边界

覆盖真实 Team SFC 与实际 stores 的同步转移、快速返回、请求计数、逆序回调、15 秒边界、429 的 0/显式/缺省期限、冷却中 runtime/manual 调用、当前重试恢复及严格拒绝/账号/环境边界。源码与离线测试不是发布或真机验收通过；原生/H5 实景、独立复核、双端同步与最终发布由主任务分别记录。

## 语言 A-B-A 的读取围栏补充

语言变化不仅清除当前数字，还同步使三个 store 的旧读取 owner 失效：旧 locale 的未结成功/失败不能再建立 Network/Commission 证据或 Referral live snapshot，旧邀请码不能恢复复制/链接/海报/分享操作。即使语言回到原值，旧代次仍无效。

该失效清除只读 freshness 和未结合并入口，不自动发送新请求；下一次当前作用域的正常进入或显式读取可建立新确认值。语言变化保留同账号的有效 429 截止时间，普通 ensure、runtime 与手动刷新都不能通过切语言绕过 Retry-After。

## 主 Team 成员人数的只读消费补充

仅主 Team 页的“我的团队”成员数、直接邀请人数与七层网络快捷入口人数，在当前 Network HTTP 429 且已有当前 owner 有效 snapshot 时保留历史数值；内部扩展人数选择器采用同一只读条件。错误状态和重试明确保留，不将错误改成 ready。“我的团队”卡的导航箭头、canOpen 与实际 open handler 继续要求实时 status=ready；历史人数不能授权进入。

主 Team 成员卡冷态 idle/loading 未知时保留静态标题、成员/直接邀请标签与“—”，不插入读取文字或额外状态行；真正错误仍显示失败与重试。严格拒绝、账号/绑定/语言/API 作用域变化及旧 owner 响应围栏沿用原规则，成功当前重试原位更新人数。本项不扩展到 Network 其他次页，不更改 store 请求、分享工具或资格。

本遗漏通过源码与实际 SFC/真实 Network store 定向测试确认；原诊断视频对应下方成员卡不在可见范围，不将旧片作为该区域实景通过证据，主任务仍需新资源原生/H5复验。

## 主 Team 等级读取与权限分离补充

主任务在新资源真机滚动后观察到“我的等级 V—”未恢复；原录屏该卡位于视口外，不把旧片当作等级区域证据。现有源码已订阅目录 runtime 更新并接续读取，不能将现场未经日志确证的原因写成“没有订阅”或直接断言为429。

V-rank 的 ladder/current 作为同一当前 owner 读取：主 Team 普通 onShow 只合并当前账号/绑定/语言代次/runtime 的未结请求；完成后下次进入仍重新读取，不对有权限含义的 live rank 套15秒TTL。既有 runtime 接续保持并新起当前代次，旧runtime/旧账号/旧locale/旧API客户端响应不能恢复等级。

当前HTTP429遵守有效Retry-After（含0），无有效头时30秒；普通进入、runtime读取和显式重试都不能绕过。Team只保当前owner已确认的等级数字，明确显示真实错误与重试；live remoteReady仍false、ladder/progress/capabilities清空，历史V数字不授购买、晋级或领奖资格。真正严格拒绝及账号/绑定/语言/API作用域变化清除历史数字，当前正常新读可恢复真实等级（含V0）。

两条GET的当前严格拒绝必须被观察到，不能因另一条先返回429而忽略晚到403。500毫秒的单次冷恢复仅适用于本地同时无HTTP状态且无响应code的AUTH_SESSION_REQUIRED；服务端角色/认证拒绝不使用该定时重试。冷恢复期间另一条GET若产生429或严格拒绝，应停止第二轮；若合法第二轮已开始，第一轮迟到结果不能清除第二轮当前成功。此逻辑限于V-rank单次读取，不扩展全局transport或持久缓存。

验证以真实Team SFC与真实v-rank store的请求计数、当前429/严格拒绝、两腿逆序、runtime恢复、locale/账号/环境围栏及新当前恢复为依据；源码结果仍需主任务独审与新原生/H5等级区域复验。
## 2026-10-28：明确暂时读取失败的主 Team 历史展示

本节将上述仅 HTTP429 保留数字的范围扩展为：明确 ApiError kind=network（包含断网/timeout）、kind=http 且 HTTP status 500–599、以及明确 kind=http 的 status/code429。仅影响已经确认、同当前 owner 的只读数字；首次未知仍为—，不将未知写零。

- Network 保留该 owner 已确认的 snapshot，但 remoteStatus 仍 error。主 Team ledger、成员/直接邀请/七层人数的只读显示使用暂时失败标记；成员卡 canOpen 与实际 handler 仍要求 ready，错误和重试不隐藏。
- Commission error 时 live eventsEvidence 清除；Team 仅保留此前已确认的ledger四金额，不从旧证据恢复权限。事件列表、展开入口及命令原守卫不变。
- Referral error 时 live snapshot 仍 null；InviteEarnCard 仅保此前确认的奖励数字。邀请码、链接、复制、海报和分享资格不保留，四实际 handler 仍要求当前有效 code。成功确认关闭奖励清掉旧奖励数字。
- V-rank error 时 remoteReady=false、ladder/progress/capabilities 清除；Team 仅保已确认的等级数字。live rank 不加 TTL，不恢复购买、晋级或领奖资格；同轮两GET任何一条严格拒绝会撤销历史，不能被另一条晚到暂时失败重新放行。
- auth/401/403、所有业务拒绝、protocol/schema、configuration、未知错误类型及其它非暂时错误都严格清历史。auth/business/protocol/configuration 即便含数字429/5xx，也不属于可暂留或限流冷却。未知 Error 不能经通用 asApiError 变换成 network 后保留。
- 真正的冷却仅由明确 kind=http 的429建立；已知HTTP status优先，code429仅在status缺失时作为明确http的回退。HTTP404+code429仍严格清，HTTP503+code429仅属5xx暂时失败而不建立429冷却，status429+认证code403仍严格拒绝。retryAfterMs原值含0、无值30秒；普通show/runtime/manual统一遵守。network/timeout/普通5xx不伪造429冷却，无新增自动重试循环。原 Network/Commission 15秒被动freshness与Referral/V-rank无live TTL合同不变。
- 账号/绑定/locale/环境/baseUrl与旧响应围栏保持，作用域变化先清本地历史。语言ABA不能复活旧数字或code，也不能绕已经收到的429 deadline。当前owner正常新读成功后原位替换数字并恢复相应live状态。

真实本轮现场是临时断网后Team已有数字丢失，不能称本轮手机复现了429/401；本地actual SFC+真实stores验证明确暂时失败、严格拒绝、旧owner、冷unknown、两GET逆序及恢复，不替代新候选原生复验。目录失败的只读上下文证明另由目录owner处理，不能以live canonical错误时true来授权；四链修复本身不声称全App离线验收通过。

## 2026-10-28：目录只读证明的主 Team 消费

当当前目录读取明确暂时失败时，目录 live status 仍error、serverCanonical仍false且兼容目录清空；Team/Invite仅用productCatalogDisplayProof及isProductCatalogDisplayCurrent确认旧数字仍处于同一只读上下文，不能据此购买、报价、恢复库存或资格。各数字仍必须来自四链已确认且匹配当前owner的私有presentation，proof本身没有数字、产品或操作权限。

目录自身发布的runtime通知保持只读proof连续，包含同步watch更新，不因标记变化短暂清空已知数字；外部业务写入/runtime更新、目录prepare、strict拒绝或环境/账号变更撤销proof后，Team/Invite立即清历史，并阻止旧数字重建。成员计数的snapshot回退也要求当前显示proof。写入前未决目录回执不能重新建立新命名空间的证明。localeABA沿现有本地同步清数与四store owner失效，旧语言回执不能借目录证明复活数字或code。

当前目录与四链重新成功确认后，才能建立新的只读数字并恢复各自实时状态。实际SFC+真实目录/store已验证目录network/503与四链一起失败时历史保留、同步状态无短暂false、strict/外部write/旧目录回执/localeABA清除及current恢复；此为本地组合证据，仍待独立复核和原生断网原路径复验。

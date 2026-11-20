# 五 Tab 快切保护：1秒内3次变化，3秒退出

更新日期：2026-10-28。本版本取代固定10秒被动读取规则，适用于 App/H5 的首页、赚取、商城、团队、我的及实际递归展示消费者。

## 当前规则

1. 正常有效导航产生新访问，读取最新数据。同一次访问的页面、共享外壳、子组件 mounted/show 和 App 路由任务读取共用显式资源结果；未完成的同 scope、同对象查询读取始终共用。
2. 在1秒（含边界）内发生至少3次不同五 Tab 之间的有效变化时，从第3次变化开始进入保护。首次启动、重复 onShow、同当前 Tab 点击、同 Tab 的查询变化以及子页往返不计入这3次。
3. 保护持续3秒；只有再次满足1秒内3次变化才能从该次变化续期。孤立慢切不续期。3秒结束不触发后台刷新；之后下一次正常访问读取最新数据。
4. 保护期间只复用同 scope 已成功且仍有效的展示结果。尚无成功结果、已失效或失败的资源仍需读取；一次访问内的重复失败仍合并。HTTP429原有服务端重试时间独立遵守。手动重试和必要业务资格校验始终真实执行。
5. 子页进入及返回建立新访问，避免保护之外永久复用旧结果。原生宿主确认恢复时先记录访问，再把 retained 子页变为可见；导航失败撤销本次快切计数，不把未完成目标当作当前页面。弹窗拦截硬返回时不依据返回意图提前修改访问。
6. 账号、绑定、环境、接口地址、语言、业务版本、对象或查询变化仍隔离；旧响应不得恢复新上下文。只读展示不能扩大购买、领取、设备执行或安全操作资格。普通同 Tab 点击、时钟、标题、原滚动恢复、静态页面权限及心跳规则保持。
7. 内存结果只服务显式展示资源，不持久保存，不新增产品界面的工程说明。已有有效网络卡在配置暖加载时保持原节点，真实失败/authority失效继续撤销展示。

## 实际调用与导航

原生五 Tab 宿主在 select 更新 location 之前记录变化，早于目标 child show/read。原生普通导航采用现有 Uni API invoke interceptor，在 destination setup/show 前记录；失败调用原 fail 回调并撤销该次记录，不改 URL、query 或页面栈。硬返回不新增全局 onBackPress；真实宿主 onShow 先记录再恢复子页。H5 使用现有 Vue Router beforeResolve（目标组件 setup 前）和 afterEach failure，包括浏览器历史返回，不新增路由系统。

递归读取包括 App 路由任务、Nova 会话、ProductCard→购买 Gate→Genesis 配置、Home→NetworkSnapshot→NetworkPulse、真实打开后的 InviteRuleContent、TradeinSheets 配置及五 Tab 原有读取组。Nova 不请求其界面无消费的 notifications/Genesis；TaskCenter 不发送无消费的 route GET，lockedTeasers 本地计算保持。

通知分页成功但缺省可选 actionableUnread 汇总仍是有效展示缓存，汇总未知继续保留原未知含义；Genesis 沿用既有聚合读取的独立投影成功语义，public成功但account/eligibility不可用的合法分项结果可以保留展示，权限与资格仍不可用，全部失败不视为成功缓存。返回 void 的 Store 以 loaded/ready/error 等真实状态判断可复用展示；订单的抛错读取仅在成功完成后确认结果。失败、false、null 和失效状态不得被当作保护缓存。手动恢复使旧结果/错误失效。

## 验证边界

用实际 retained tabs.vue / NativeTabContent 生命周期、真实 Quest Store/API/ApiClient transport 检查正常五 Tab 循环真实读取、第三次快速变化已生效、保护内无新增、孤立慢切不续期、退出无 flush、子页返回新访问。另使用实际 Vue Router 的历史返回和失败导航、原生 invoke rollback，以及递归 Nova/Genesis/Network/Invite 消费测试。离线 transport 不访问业务服务；本地通过不能代替主线程的新资源真机验收。历史真机风暴与既有导航/header约4帧不同步问题保留为独立未关闭证据。

离线重复读取补充：仍有效的同作用域目录展示凭据覆盖正常读取、暂时失败后的再次加载和再次失败，使 Team/Invite 原数字保持；实时目录授权继续关闭。参见[团队静默暖刷新](../../PRD/UVEL_团队静默暖刷新_20261027.md)的只读展示连续性规则。

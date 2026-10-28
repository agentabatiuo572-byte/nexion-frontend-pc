# 非团队页面静默暖刷新与静态常驻补充（2026-10-27）

适用正式 App 的 Goals、Proof、Learn 中心/课程、Trust NEX、Security、Trial、Devices 通用库存槽位与 Genesis Marketplace；沿用现有版式和文案。已有内容（包括服务端确认的空集合）同账号、绑定 epoch、环境、语言及页面对象再次只读同步时继续显示，固定标题、说明、图标与按钮名不因只读 pending 隐藏或变灰。未知动态值用 —，首次读取和真实失败仍准确显示加载/错误/重试。

- Goals 保留已确认目标及推荐文字；Setter/Save 静态常驻。推荐旧文字仅展示，旧推荐不能恢复商城跳转或保存资格。列表成功归属依实际成功 revision、账号与内部 read binding epoch；不修改目标写入与幂等语义。
- Proof 卡片、变体、品牌和分享入口冷态常驻；暖读保留事实，所有分享、剪贴板及图片导出仍须当前 proofReady 和原 scope。任何实际读取错误清旧事实。
- Learn 中心保留成功列表；课程仅保留已发布正文和已确认结果元数据。live 课程、答案、start 确认及未决收据按原流程重建；新版本不复用旧答案/提交权限；普通 401/403 清相应正文。
- Trust NEX 的已发布当前语言内容在暖读取时继续解析；未知标题为 —；真实错误或该语言未发布不借用其他语言/本地营销文案。固定说明常驻。
- Security 仅保留日期、2FA 已确认状态与会话元数据；口令、OTP、挑战、确认和操作 authority 不进入展示副本。401/403 清所有对应 metadata 与私密交互；撤销会话在确认前后均要求当前 live read。2FA 盾牌颜色仍代表真实 enabled 状态。ThirdPartyAuth 仅稳定 Provider 名称/图标，原 OAuth 外部返回生命周期保持。
- Trial 购买名称使用现有通用购买文案；只读 pending 不灰、不替换成目录同步文案；真实缺货和读取错误仍准确阻断。Devices 冷态仅通用槽位标题、— 与去商城入口，不制造 active 分组/设备。
- Marketplace 复用 store 已确认 entities，不新增持仓/挂单缓存。public/account 各自依据实际当前成功 revision + read binding scope 建展示归属；旧 ready、吞错 Promise、旧绑定计数推进均不能认成功。买/卖/撤销、报价、余额与现有 fresh guards 保留；成功空集合可静默刷新，真失败/paused/hold 仍准确。

本批没有持久通用缓存、secret 缓存或全局运行态门禁改动。本地行为与 type 验证不代替 TEST 真机页面、滚动和 OAuth 原生返回验收；这些由主任务安排。

# Team 次页静默刷新与固定展示

本轮来源：用户明确要求所有页面同作用域暖读默默更新；固定标题、说明、图标和按钮不应因为读取中而灰白切换、换成读取文案或卸载。关联 #660 本轮 Team 次页消费者；不重置原 576 功能触达编号。

## 读展示

- Tree 复用 network 已确认快照标志，仅 ready 或 loading+已有快照可读；真实错误和首读未知保留原反馈。
- Commissions/Binary 的同实例展示保存最后一次实际 ready 的只读结果。正常目录 runtime 重读清空共享 source 时，仅展示继续保留；真实 store 仍按原 fence 进入 idle/loading，原失败清 source 契约不变。金额、事件状态与日期只从原结果呈现，不回写余额、费用、结算或任何资格。
- Leaderboard、Leadership Pool/How、Unilevel 同账号/epoch/语言与相同 period/filter 的已确认结果在暖读中保留。新暂停、hold、schema/dataAvailable 变更和真实失败采用新的业务状态，旧内容不得替代失败或继续分页。权重和阈值缺失仍未知，不生成动态分桶或资格。
- Rank How/Commissions How 仅保留已完整合法读取的同作用域 published 内容。更换账号、epoch、语言、权限或环境时同步清空并废弃旧资源；旧响应不得重新标记为当前成功。未发布、文档不完整、无法解析或真实读错保留原错误与重试，不用旧文档遮盖。
- 环境配置继续按编译期/重建页面合同使用；同实例检测到 environment/baseUrl 改动后只读展示保守失效，A→B→A 也不复用旧请求，重新进入新页面实例才可建立新结果。

## 固定框架与操作

- Agent 的本地固定标题、图标、说明、表单标签和申请按钮壳在首次未知时即存在；动态 BUCKETS、预算范围、申请记录仍须实际读回。同作用域暖读保留已读规则与记录，所有输入、类别选择及申请命令继续要求本页实时 ready，并保留原实时 rank/提交/幂等/账号围栏。固定申请按钮名不以 loading 或资格未知替换；真实限制仍在资格反馈区表达。
- QuotaTierCard 读取中的按钮保留产品购买固定名称与图标，外观不因纯 read pending 降灰，disabled/tabindex/点击拦截仍有效。库存、资格、进度保持原实时 ready 判定，未知显示 —；未解锁、缺货与停售结果不伪装可买。
- 分页读取中的固定“加载更多”标签不换为读取文案；真实分页错误仍提供原重试。冷态读取、真实错误、hold、paused、文档缺失、提交状态与倒计时不静默伪成成功。

边界：这是页面内存中的只读展示与固定壳，不新增通用持久缓存，不修改 API/store/runtime 权威状态和资金计算。真实错误和业务内容变化可合法改变高度；不承诺错误、新活动或不同筛选结果的像素高度固定。自动化与离线结构检查不代替 TEST H5/Android 原入口验收。

## 独审补充：事件守卫、组合读失败与期效数据例外

- Agent 的类别 click/keyboard、输入 setter、丢弃草稿 handler 必须与 aria-disabled 一致：本页非 ready、隐藏或提交中不修改表单。三条读取任一失败后先撤销本轮 generation，再清结果并结束为 error；迟到 policy/latest/history 不能回填规则、预算或记录。用户显式重试建立新的读 owner。
- Binary 左右翼复用同一个仅展示的 memberDetailsReadable，网络暖读不卸右侧成员或改成另一口径人数；真实成员读取错误仍降级，权限未改变。
- Leadership Pool 响应只有 nextPayoutAt，没有同作用域 serverNow/generatedAt/asOf；不得从设备 Date.now 断言平台已跨周，也不借 mockServerNow 或其他模块时钟造 Pool 时基。当期“本周”数字属于例外：隐藏时同步清 period 投影与旧请求，返回未知占位直接等 fresh 结果，不先画旧值再清空。How 的当期票数/份额/分布同样清；固定标题、入口与同 scope 已确认的非时效 unlockRank/injectRate、配置权重保留。真实失败/hold 与 scope 改变仍清相关规则。
- 同一可见页面内普通暖读仍保留已读投影；现有 payout 显示时钟到界提示仅保守清展示并重读。它不改变派发、结算、权重、资格、领取命令或服务端周期。没有可信 Pool 时基前不签跨 hide 的本周数字缓存。
- 其他期相关消费者：Leaderboard/Unilevel 有原 period/filter 与 generatedAt/snapshotAt，Commissions 有生成时间/月合计，Binary 有 asOfDate/settlePeriod；本轮没有把设备时区推导成新的自然周/月，也没有新增服务端当前期合同。其同 scope 只读结果仍是最后成功读取的快照；超长可见会话或自然期切换的新鲜度须以 fresh 响应确认，不能据这些页面旧展示授予操作。

- Pool How distribution shows the no-records copy only for a current successful snapshot with an empty distribution. While the current-period projection is unknown after hide/show, retain the static heading and show —; unknown is not zero records. Error, hold, and retry feedback remain unchanged.

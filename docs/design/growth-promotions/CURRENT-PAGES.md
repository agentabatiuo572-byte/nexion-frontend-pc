# 现有页面分析与设计接入依据

分析范围为正式APP `nexion-frontend-uniapp/test@e7f471b69d3d12b68ce1328c2bdab9938b1d0304`，H5同步来源pin匹配该提交。本文分析先于最新版APP设计；早期 `concept-admin-app.png` 和原型独立活动页仅为初稿，不能作为最终APP购机流程或像素验收基准。

证据类型：当前源码逐路径阅读；仓内历史截图仅作辅助，部分被里程碑弹窗遮盖，不作为当前页面运行通过或精确基线。当前没有可确认来源的正式APP运行服务，本文不声称完成正式APP实景验收。设计原型的运行证据另存，不能替代产品运行证据。

| 现有面 | 当前事实 | 本次接入 |
|---|---|---|
| 首页 `src/pages/index/index.vue` | GreetingHeader/TechMoneyCard之后是TrialGhostSlot、手机提醒、home-task-carousel；轮播有新人任务与ConversionBanner；后续为LiveFeed/学习/快捷入口/设备等 | 复用推广轮播容器增加受活动资格控制的购机广告条目，不替换资产信息、手机提醒和任务；无活动不占空白 |
| 首页 `src/components/home/conversion-banner.vue` | 现有周任务卡，managed position=`home.conversion-banner`，使用weeklyQuest.snapshot.promoBanner和actionRoute；已有nx-glass-action | 复用展示结构和交互材质，营销读模型独立来自活动服务；不得写成每周任务数据。广告CTA指向带活动上下文的现有商城 |
| 商城 `src/pages/store/store.vue` | 现有商品目录、商品卡以及既有组合入口 | 保留目录，活动上下文提供显式筛选/定位和清除；不能仅靠前端筛选宣称合格 |
| 商品卡 `src/components/store/product-card.vue` | 方形商品图、名称/原商品内容、价格+购买按钮；卡体goDetail，onBuy阻止冒泡进checkout；nx-glass-card实际按共享CSS是扁平内容面 | 在名称/价格相邻区域加入一行赠奖摘要和规则入口；静态奖励不再套玻璃卡；购买按钮保持原事件语义并用Liquid Glass |
| 商品详情 `src/pages/store/detail.vue` | 既有商品信息与购买入口 | 追加该SKU实际活动及权益说明；继续进入原checkout，不另造促销详情代替商品详情 |
| 下单 `src/pages/store/checkout.vue` | AppChassis外壳，select-payment/confirm/awaiting/confirmed/activating/live等状态；需区分正式remote分支与遗留模拟分支；不能从文件头注释判断真实支付链 | 现有确认内容加入购机项→赠奖项，实付保持独立；付款前形成服务端快照；结果显示订单与奖励各自状态 |
| 返回 `app-chassis.vue`/`lib/route.ts` | 顶栏经navBack离开，checkout.cancelCheckout也有直接navBack；无已覆盖所有入口的通用离页守卫 | 页面级统一requestLeave意图，接顶栏返回/显式退出/相关路由切换；保持深链fallback和订单读回；不泛改全站返回 |
| 现有票据取消/支付 | 已有票据取消确认和离页保留/恢复能力 | 原交易确认优先；促销文案并入必要确认，不能一串弹两次；不以营销返回销毁活票 |
| 通用确认 `src/components/global-ui.vue` | nx-glass-sheet、确认队列、按钮键盘语义、useDialogA11y | 复用可访问性和弹层能力；如果需调整按钮只对本功能明确适用，不无依据重写全站资金确认 |
| 玻璃 `src/styles/glass-surfaces.css` | nx-glass-action/hero/sheet；静态卡片扁平；交互装饰层按压、reduced-motion/transparency/forced-colors回退 | 购买/继续/返回/挽留弹窗按钮使用现有Liquid Glass规范；正文、商品卡、账单不玻璃套娃；文字和点击区域不随装饰层变形 |

两项接入限制需特别保留：现有 CanonicalPromoBanner 只有 countdownDays/countdownHours，缺少权威 endsAt/serverTime；新促销必须从活动服务提供真实时间，不能用旧周任务倒计时拼出结束时间。现有导航确实使用 LiquidGlass 组件，而 ProductCard 的购买按钮和通用确认按钮仍是常规填充/描边；不能因外层存在 nx-glass 类就判定这些按钮已经达到新要求。

结账确认区当前数量展示为1，详情页的数量也不能假定已经贯通至结账。此次多设备赠礼需同时补齐详情/组合→报价→建单→展示的数量合同；正式能力须由服务端统一校验。

## 主交互链

```mermaid
flowchart LR
 H[现有首页推广卡] --> S[现有商城活动商品]
 S --> D[现有商品详情]
 S --> C[现有结账]
 D --> C
 C --> P[付款及原单结果]
 P --> R[订单内奖励明细]
 C -->|主动离开且应提示| M[一次挽留确认]
 M -->|继续购买| C
 M -->|确认退出| B[原返回目标或商城]
```

后续设计画板必须呈现：①首页广告嵌入已有内容顺序；②现有商品卡赠奖信息和Liquid Glass购买按钮；③原结账页赠品区及付款CTA；④真实期限的退出确认。常规商品、不合格人群、结束、预算不足、支付未知、减少透明效果等状态在规格/原型中分别覆盖。

## 文案基线

- 首页：规则确为1台送1台时用“购机赠礼 · 买 A 赠 B”；混合活动用“指定设备购机赠礼”。CTA“查看活动商品”。
- 商品卡：“购买本款，可获赠 B × 1”或“符合条件可返 20 USDT（示例）”；只有资格已确认才省略“符合条件”。
- 下单：“本单活动奖励”；每个购买项下列实际赠品、币量及到账条件，不能写成已到账。
- 未建单退出：“本次选购预计可获赠「B × 1」。活动将于{时间+时区}结束。是否离开下单页？”
- 已建单退出：“本单奖励已预留至{付款截止}。退出后可在订单中继续支付，逾期订单将关闭。”
- 挽留按钮：“继续购买”“确认退出”。两者均可正常聚焦/操作，不能把退出做成不易发现的文字或二次劝留。

所有示例文案应以真实数据插值并同步zh/en/vi；不展示虚假库存、重置倒计时、确定收益或不真实的资格。实际文案及动态分支以PRD P4.3和APP规格为准。

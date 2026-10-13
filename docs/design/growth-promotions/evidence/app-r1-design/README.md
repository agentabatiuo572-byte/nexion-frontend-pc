# APP R1 历史独立设计画板 v2

本目录保留历史独立设计画板及其导出，不证明真实APP/H5接口、交易、资产持久化或生产启用。主人已明确APP/H5按现有APP设计元素接入，每完成一页截图验证；旧画板只供业务参考，当前决定见 [APP-SCOPE-DECISION-20261008.md](../../APP-SCOPE-DECISION-20261008.md)。本目录旧PASS不延伸为当前产品验收。

当前首页只在原轮播增加广告、原快捷入口保持原样；奖励沿现有记录入口增加第四类活动奖励，进入 `/pages/me/rewards-list?cat=promotion`，旧events奖励页仅兼容包装。旧画板中的新quick-grid、shell坐标和独立奖励入口不作为实施要求。当前APP/H5要求逐页运行截图、功能/状态操作与两名独立agent的功能、UX、一致性审查，PC原有像素门保留。

## 历史source与报告

修订前15个report输入均与旧report记录hash匹配，完整source按原相对路径保存于 `v2-source/`，并保存原report与原README。`source-hashes.json` 记录副本与原件SHA-256。report.json保留原文，其2,560组合、827张截图与10个交互组只证明历史设计导出；826等旧计数也不代表产品运行截图。未修改HTML、runtime、checker或旧导出截图，不重新运行画板导出。

以下为历史v2的说明，不作为当前APP视觉或产品门。

- 入口：../../app-r1-baseline.html。运行逻辑为本目录artboard-runtime.js，独立于产品源码。
- 清单：../../app-r1-baseline.json，含尺寸、字体、颜色、材质、触控边界、固定样例、未冻结事实与设计变更决定。
- 复跑：PC仓执行 node docs/design/growth-promotions/app-r1-baseline-check.mjs --full。仅用Playwright file:，无HTTP服务或外部请求。
- 历史画板通过依据：report.json，记录HTML、运行脚本、清单、检查脚本、交互检查、概念图和素材的SHA-256；每张截图另记哈希、视口、平台、安全区、滚动位置。原清单可从v2-source读取；修订后的活动清单仅标记当前使用边界，不能用旧report证明其新hash。
- 主矩阵19页面×7状态×3语言×2主题×3宽度；另有9个业务语义变体各覆盖3语言/2主题/3宽度，及4个中文暗色390的H5零安全区对照，共2,560组合。
- 主画板390×844，补充320/430；正常态全组合留图，中文暗色390含滚动续图。原字体、亮暗品牌图、三款真实SKU图均来自固定APP基线，未修改图片像素，保留字体许可。
- Glass是独立CSS光学目标，减少透明时实体化，减少动画时关闭变换，不宣称已复现产品WebGL效果。

## 平台和安全区

默认platform=native-illustration为原生样例：顶部24、底部26 CSS px，含示意home indicator，数值未经真实设备测量。

platform=h5导出同布局浏览器对照：顶部0、底部0，无示意home indicator。例如 ?screen=checkout&platform=h5&locale=zh&theme=dark&width=390。对应实际产品nx_device=off一类环境；产品读取自身真实安全区，不能为了对齐原生样例强造inset。正式验收须选相同平台记录；原生实机仍未验。

## 六项返修与实景证据

| 审查点 | v2行为 | 实際检查ID |
|---|---|---|
| 奖励选择与NEX遗漏 | 三类型详情保留所选类型、状态、来源；有凭证才开放对应设备/钱包入口；NEX接商城、结账及原单样例。 | R1-selected-device-usdt-nex-reward-detail-source-and-asset；R1-nex-store-checkout-original-order |
| 付款未知变可付 | 关联订单、刷新及商城再次进入都保留未知原单；只有显式queryResult=unpaid查询样例可转确认待付原单。 | R2-unknown-original-order-query-only-until-explicit-confirmation |
| 重复挽留与预留丢失 | 同作用域保存已提示标记，继续/ESC/遮罩后再次离开直接返回；原单、选择、payBy在恢复和刷新后保留；草稿返回为失效报价。 | R3-single-leave-prompt-scope-reserved-payby-focus-and-reload |
| 权益说明缺项 | 具名设备条款含启用、生效到期、任务、收益、持有等级、置换转赠、售后；资金含可用范围、提现、手续费、限制。terms=missing禁确认。 | R4-named-design-only-device-funds-terms-missing-blocks-confirmation |
| 规则返回丢来源 | 返回原页面、选择、状态与实际滚动位置。 | R5-rule-roundtrip-restores-checkout-selection-and-scroll |
| 数量改变沿旧报价确认 | 撤下旧金额和预计奖励，明确待重报并禁确认；规则往返及改回原数量仍不复活旧报价。 | R6-quantity-invalidates-quote-and-remains-stale-after-navigation |

另外保留只读奖励、已付/退款订单无支付或取消动作的检查，共9项交互组。完整源为interaction-checks.mjs。

## 样例与未冻结边界

金额、日期、奖励、条款均为明确标注的固定样例。entitlementSamples的具名字段属于DESIGN-TERMS-ONLY；其中期限、提现限制、手续费及设备权限不构成生产默认或D01–D11决定。条款完整仅表示样例字段齐全，正式产品仍须使用已批准且完整的服务端条款。

数量按钮不实现报价引擎，只切失效状态；确认入口进入付款未知样例，无真实支付。钱包、设备、客服和分享等外围入口只标明正确资产类型或位置，不实现那些产品页面。待发和售后核验中的奖励不伪造到账凭证；展示凭证以DESIGN命名。

未冻结事项仍含D01–D11、正式API、真实价格/库存/资格/时间、生产权益、原生安全区和实际Glass。状态集是代表性样例，全部业务状态及真实后端联调须产品验收。新哈希和截图仅证明当前候选，不表示独立审查通过。

## 六维自检边界

1. 真落地：点击改变DOM/URL；同浏览器会话作用域提示标记经刷新保留；没有订单或资产真写。
2. 内容完整：对照APP01–09与P5补足所选奖励、未知原单、来源返回、条款字段、NEX链。
3. 交互完整：实际点击六条问题链，查键盘焦点、关闭、单次退出和禁用。
4. 同类全扫：全部声明组合加载，查图片字体、触控区、横向溢出、主题、平台inset、弹窗隔离和运行错误。
5. 不变量：三语/双主题/三宽度/三奖励类型，退出不等于取消、支付与奖励状态分开；H5明确零安全区。
6. 实景回看：截图和hash对应保存的历史独立设计source；正式产品逐页运行截图与两路功能/UX审查不在此宣称通过。

保留历史source和原报告。产品截图单独绑定当前实现，不能替换历史导出或把原PASS重新解释为产品通过；当前范围决定无需新画板或重导旧截图。

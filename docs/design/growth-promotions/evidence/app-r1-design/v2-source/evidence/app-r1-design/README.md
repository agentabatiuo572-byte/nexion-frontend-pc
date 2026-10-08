# APP R1 独立视觉候选基准 v2

本目录证明独立设计画板可运行，不证明真实APP/H5接口、交易、资产持久化或生产启用。v2根据六项独立审查纠正交互契约；没有使用产品运行截图回填设计。

- 入口：../../app-r1-baseline.html。运行逻辑为本目录artboard-runtime.js，独立于产品源码。
- 清单：../../app-r1-baseline.json，含尺寸、字体、颜色、材质、触控边界、固定样例、未冻结事实与设计变更决定。
- 复跑：PC仓执行 node docs/design/growth-promotions/app-r1-baseline-check.mjs --full。仅用Playwright file:，无HTTP服务或外部请求。
- 当前通过依据：report.json，记录HTML、运行脚本、清单、检查脚本、交互检查、概念图和素材的SHA-256；每张截图另记哈希、视口、平台、安全区、滚动位置。历史烟测与旧截图不作为当前通过依据。
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
6. 实景回看：截图和hash对应当前独立设计源码；主线独立复审及正式产品双路逐像素验收仍未在此宣称通过。

不得用产品截图替换基准；修改须记录设计决定和新版本，再生成对应当前快照证据。

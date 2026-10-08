# APP现有样式接入决定

决定版本：`app-existing-style-20261008-r1`。业务契约仍以同包PRODUCT-PRD与APP-H5-PRD为准；本页记录主人明确的范围与验收依据，不增加运营政策。

主人当前要求：“新设计稿与APP风格不一致，按照现有APP设计元素添加功能，业务/交互流程必须正确，每完成一页必须截图验证。”此决定覆盖APP/H5旧稿像素还原要求；PC既有设计、业务与像素验收不受影响。

- 首页仅在已有轮播中增加广告卡，原快捷入口保持原样，不新增quick-grid。
- 个人中心保留原奖励记录入口；`/pages/me/rewards` 的优惠券、USDT、NEX保留，第四类活动奖励进入 `/pages/me/rewards-list?cat=promotion`。
- 挽留弹窗按5秒阅读场景精简为标题、一句真实提示及“继续购买”“退出”。未建单提醒限时赠礼；待支付订单说明限时预留与退出不取消订单。完整赠礼明细及真实活动/付款截止保留在结账主页面；返回、关闭与交易恢复规则不变。
- `/pages/events/promotion-rewards` 仅兼容历史链接，复用同一列表并保留允许的活动/订单筛选，不另造个人中心入口或状态真源。
- 视觉依据取当前APP组件、样式token与实际页面；不按旧稿的shell、QuickActionRow坐标或Liquid Glass材质扩大共享组件改动，不生成新APP稿或重导画板。
- 每完成一页保存该页当前运行截图并实际操作检查数据来源、状态、返回、刷新与错误恢复；两名独立agent审查功能、UX与一致性，修正后复验同一新快照。未运行项如实记录未验收。

## 原图与显示内容

主人提供的黑绿购机赠礼两设备图原文件为 `C:/Users/jason/AppData/Local/Temp/codex-clipboard-b227016b-b8de-4ca1-8755-c3f6fdc2c512.png`。已查看并以原始像素保存为 [owner-buy-gift-banner-20261008.png](assets/owner-buy-gift-banner-20261008.png)。SHA-256：`d47ffec66282a68573f4439455cafa4bd2ed0c49080389ecde02f36a2c7ddb9e`。

此图用于既有轮播广告背景参考；实际标题、适用SKU、奖励摘要与CTA由真实可配置信息覆盖。原图中的设备A/B、条件与按钮文字是样例，不构成服务端活动规则、资格或奖励承诺。

## 历史证据保留

旧画板版本为 `app-r1-20261007-v2`。修订前report的15个输入hash均与当时source一致，source、素材、原report和原README按相对路径保存于 `evidence/app-r1-design/v2-source/`；副本hash见该目录 `source-hashes.json`。

旧原始report SHA-256：`7f1162f880a7174cd76f5e106abd79c33c5b9cd825b778ececd6f48b4d0001fc`。原report保持2,560组合、827张截图、10个交互组及其旧verdict，不改写为本次验收；826/827的设计导出计数均不表示正式APP/H5运行通过。HTML、artboard-runtime.js、checker及旧截图未改写。

活动清单保留旧baselineId，并用本决定版本标记历史业务参考及当前范围。同步证据位于 `D:/CodexData/test-environments/workflow-runs/growth-promotions-20261007/design-scope-sync-report.md` 与同名JSON，记录修订文件hash、保留文件hash、检查结果和未验收边界。该报告只证明文档范围同步，不假冒页面运行或两路独立审查通过。

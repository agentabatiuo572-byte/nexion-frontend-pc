# D7 法币提现参数 — T4 独立黑盒实景走查报告

- 日期:2026-08-06 · 走查人:t4(独立验收 tester,黑盒,真点真输,未读实现代码下结论)
- 被测:`http://127.0.0.1:3002/finance/payout-vnd`(既有 dev 实例,serve 当前工作树;非本走查启动,未动过它)
- 工具:Playwright chromium headless(工程内 playwright 1.61),脚本与全部截图在
  `C:\Users\jason\AppData\Local\Temp\claude\D--WORKS-PLAN\aa33bf99-553d-4a4c-8119-9119bee422e7\scratchpad\`
  (下文截图只写文件名,均在该目录;脚本 `walkthrough.js`、`modal-detail-probe.js`、`loop-probe.js`、结果 `results.json`、console 全量 `console-full.json`)

## 环境铺垫(先排环境假阴)

- 按派单拦截 `**/api/admin/auth/session` 与 `**/api/admin/auth/login` → 200 + superadmin session(不带 effectiveMenus/menuCodes)。登录态生效,右上角显示 `t4-walkthrough / 总管理员`。
- **发现环境级干扰并已隔离**:本机无后端时,shell 级数据 API(tickets/alerts/treasury/audit/flags 等)实际返回 **401**(Next 中间件拒未带真 token 请求),shell 把 401 当「会话失效」→ 强制 logout → 整页重载,形成死循环。实测(`loop-probe.js`):无垫片 12 秒内主 frame 导航 **36 次**;给全部非 auth 的 `**/api/admin/**` 加 **503 垫片**(即协调方描述的预期环境「404/503」)后仅初始 2 次导航,页面稳定。走查全程带此垫片。
- **D7 页面自身全程零 API 请求**(4xx/5xx 清单里没有任何 payout/finance 端点)——「本地配置 v1」属实,垫片不触碰被测对象。
- 走查在同一浏览器 context 内按 AC 顺序连续执行,localStorage 随 reload 保留(AC4 可测),每次全量重跑自动回种子态。

## 逐条 AC 结论

### AC1 导航与渲染 — PASS
- goto `/finance/payout-vnd`:统计条 4 卡(买入牌价/卖出牌价/双向价差/法币提现通道)+「双向牌价与报价」「提现费率与限额」「通道总开关」「生效历史」8/8 needle 命中。证据:`ac1-page.png`。
- 侧边栏点「资金与财务 D」展开,含「法币提现参数」入口,`href=/finance/payout-vnd`,点击后 URL 正确。证据:`ac1-sidebar.png`。

### AC2 默认值 — PASS
- 买入 `1 USDT ≈ 26,390₫`、卖出 `25,610₫`、价差 `780₫`、通道「关闭」、基准价 `26,000₫` 只读(「单源在 D6…不提供第二个写入口」)+「在 D6 调整 →」链接 `href=/finance/fx-rate`。
- 九个输入默认:买入点差 1.5 / 卖出点差 1.5 / 报价有效期 10 / 偏差阈值 2 / 费率 1 / 最低收费 1 / 封顶 25 / 下限 20 / 上限 5000。
- 无改动时两个「预览并提交」均禁用。证据:`ac2-defaults.png`。

### AC3 合法保存链 — PASS
- 卖出点差 → 2:草稿预览实时联动出现 `25,480₫`(`ac3-preview.png`),提交钮解禁。
- 点「预览并提交」→ 确认弹窗出现。**前后值在弹窗内,但在「执行摘要 → 查看详情 ▼」折叠区内**:折叠态无任何变更信息;展开后完整显示「卖出点差:1.5 % → 2 %」+「保存后牌价:买入 26,390₫ / 卖出 25,480₫(当前 26,390₫ / 25,610₫)」+ 方向判定 + 版本并发声明(定向复核 `modal-detail-probe.js`,截图 `probe-fx-modal-collapsed.png` / `probe-fx-modal-expanded.png`)。判 PASS(弹窗含前后值),折叠交互记入「发现」#1。
- 理由「短理由」(3 字):确认钮 disabled(`disabled=true, opacity 0.5, cursor not-allowed`),提示「还需补充 8 字,确认按钮才会启用」实时倒数;强制 force-click 弹窗不动、不提交(`ac3-short-reason.png`)。
- 理由「走查测试理由满八字」→ 确认解禁 → 提交 → toast「已生效」(`ac3-after-confirm.png`)→ 历史新增一行 `2026-08-06 05:12:33 | 卖出点差:1.5 → 2 | t4-walkthrough | 走查测试理由满八字`(`ac3-history.png`)。统计条卖出牌价随生效值变为 25,480₫、价差 910₫(见后续截图)。

### AC4 持久 — PASS
- `page.reload()` 后卖出点差输入仍为 `2`,历史行仍在。证据:`ac4-reload.png`。

### AC5 越界拒 — PASS
- 卖出点差 → 3.5:字段下红字「**卖出点差超出合法范围 0–3 %**」,「预览并提交」禁用(`ac5-outofrange.png`)。
- 改回 2:提示消除、按钮回禁用(无待提交差异)。

### AC6 倒挂路径 — PASS
- 0/0:出现琥珀色警示带「价差倒挂 · 卖出牌价 ≥ 买入牌价,平台两个方向都不再赚取价差,默认拒绝保存。你是超级管理员,可在下方走强制保存(带风险声明)。」普通提交禁用,出现「强制保存(倒挂风险)」按钮(`ac6-inverted-warning.png`)。
- 点强制保存 → 弹窗标题带「(倒挂强制)」+ 风险声明「会增加资金流出 · 系统会先检查 B1 备付金覆盖率…」(`ac6-force-modal.png`)→ 理由确认 → 历史新行带琥珀「倒挂强制」标:`买入点差:1.5 → 0 | 卖出点差:2 → 0 | 倒挂强制`(`ac6-force-history.png`)。
- 改回 1.5/1.5:警示消失、普通提交可用 → 正常确认链还原 → 历史落 `买入点差:0 → 1.5 | 卖出点差:0 → 1.5`(`ac6-restored.png`)。

### AC7 冲突拒 — PASS
- 最低收费 → 25:冲突提示「**最低收费不得大于等于单笔下限,否则最小额提现到手为零或为负**」,费用侧「预览并提交」禁用(`ac7-conflict.png`)。改回 1 复原。

### AC8 通道开关 — PASS
- 「开启通道」→ 确认弹窗(含理由框 + 风险声明「会增加资金流出 · 先检查 B1 备付金覆盖率」)→ 确认 → toast「通道已开启 · 已落变更历史」;开关卡徽章「开启」+ 统计条同步(全页 exact-「开启」徽章 3 处);历史新行 `法币提现通道:关闭 → 开启`(`ac8-open-modal.png`、`ac8-opened.png`)。
- 「停用通道」→ 同链还原:徽章回「关闭」(3 处),历史落 `开启 → 关闭`(`ac8-closed.png`)。

### AC9 恢复默认 — PASS
- 费率 → 2 提交生效(历史 `提现费率:1 → 2`,`ac9-rate2.png`)。
- 点「恢复默认(回填种子,仍需提交)」:费率输入回 `1`(九项输入全部为种子值),**历史行数 6 → 6 无新增**(生效值未变),且费用侧提交钮转为可用 = 存在 2→1 待提交差异(`ac9-after-reset.png`)。
- 再提交:弹窗展开态含 `提现费率:2 % → 1 %`(`probe-fee-modal-expanded.png` 同路径复核)→ 确认 → 历史落 `提现费率:2 → 1`(`ac9-final.png`)。

### AC10 console 纪律 — PASS
- 全程 page console + pageerror + requestfailed 全量收集(`console-full.json`):
  - **D7 自身逻辑错误:0**。零 pageerror、零未捕获异常、零非网络类 console error。
  - 缺后端网络失败(环境固有,垫片后形态):`Failed to load resource: 503 (Service Unavailable)` × 140,全部来自 shell 级端点(content/tickets、content/conversations、support-agents、knowledge、session-templates、treasury/b-domain、emergency/*/alerts、users/account-actions/alerts、platform/audit、platform/flags)。
  - 无垫片时的原生形态(备案):同名端点 401 风暴 + `POST /api/admin/auth/logout net::ERR_ABORTED` + 整页重载循环,见「环境铺垫」。

### AC11 邻页不受影响 — PASS
- `/finance/fx-rate`(D6 汇率牌价):骨架/标题/描述正常,数据区显示读取失败横幅 + 「重试读取」按钮(降级态,环境固有)。`ac11-fx-rate.png`。
- `/finance/params`(D5 提现参数配置):正常渲染,「D5 权威配置不可用…旧值已清空,全部写操作保持冻结」+「重试获取权威快照」(降级 + 写冻结,环境固有)。`ac11-params.png`。
- 两页横幅如实展示了垫片 message 文本("backend unavailable (test shim)"),属环境注入,非页面缺陷。

## 走查发现(全部上报,不设数量预期)

1. **确认弹窗默认折叠态不含任何变更摘要**(可用性,建议关注):「执行摘要」区默认收起,标题和「查看详情 ▼」之间零内容——操作者不点展开就能直接填理由、点「确认提交」,全程看不到自己在确认什么前后值。展开后信息其实非常完整(diff、保存后牌价推演、方向判定、并发版本声明)。建议:折叠态至少显示一行 diff 摘要(如「卖出点差:1.5 % → 2 %」),或高敏变更默认展开。证据:`probe-fx-modal-collapsed.png` vs `probe-fx-modal-expanded.png`。
2. **草稿预览对越界输入照常出数**:卖出点差填 3.5(越界、不可提交)时,草稿牌价预览仍计算并显示 `卖出 25,090₫ / 价差 1,300₫`(旁有红字、提交已禁用)。与平台「报价只对能提交的输入出」的既有原则相悖,可能让操作者对一个不可保存的值形成价格预期。建议越界时预览行置灰或显示「当前输入不合法,无预览」。证据:`ac5-outofrange.png`。
3. **弹窗风险文案偏工程口吻**:「提交时由后端实时校验覆盖率,当前弹窗不使用前端兜底值」——「前端兜底值」是工程词汇,运营可读性一般(项目不变量:页面文案禁工程名词)。建议改为「以提交时系统实时校验结果为准」。出现于放大资金流出类弹窗(开通道/倒挂强制/费率调低)。
4. **数值单位轻微不一致**:弹窗内 diff 带单位(`1.5 % → 2 %`),生效历史行不带(`卖出点差:1.5 → 2`)。上下文可推断,但同一 diff 两处展示口径不同。
5. **环境观察(非 D7 缺陷,给环境/工具链)**:① 无后端时 shell 数据 API 401 会触发「强制登出→整页重载」死循环(12s/36 次导航),任何本地无后台实景走查都会被它打断——建议 walkthrough 工具链固定加 503 垫片,或 shell 区分「会话失效 401」与「后端缺席」;② topbar 同屏并存「兑付覆盖率 同步失败」(红)与「服务端权威 · 已同步」(绿),观感矛盾(环境态下的展示组合)。
6. **正面记录**(不是问题):方向性风险提示(B1 备付金覆盖率)只在放大资金流出的变更出现(费率调低/开通道/倒挂强制),收紧向(卖出点差调高)不出现——语义判定正确;配置版本号随每次提交单调递增(走查内 v1→v7),与弹窗「提交基于配置版本 vN;并发变化会被拒绝」声明闭环;disabled 确认钮有 opacity 0.5 + not-allowed 视觉弱化;弹窗关闭钮有 `aria-label="关闭"`;理由框有「还需补充 N 字」实时倒数与占位示例(工单号/业务依据/影响面/回滚预案)。

## 核对口径说明

- 自动化断言 47 项中 45 项首轮 PASS;2 项(AC3/AC9「弹窗含前后值」)首轮 FAIL 系断言只读了折叠态文本,经真点「查看详情」定向复核确认值存在且正确,改判 PASS,折叠行为本身记为发现 #1。
- 所有 pass 均有截图 + 文本断言双证据;历史行断言含时间/变更内容/操作者/理由四列原文。

## 总结

11 pass / 0 fail

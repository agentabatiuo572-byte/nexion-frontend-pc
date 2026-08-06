本页判定目标=F5 行内冻结/提前解锁/解冻:按钮状态机/弹窗护栏差异/A2 票捕获/503 失败态(来源:任务 AC B1–B4)

# 独立黑盒验收报告 · B 组(F5 /network/commissions)

- 验收人:独立 tester agent(黑盒,不改仓)· 2026-08-06
- 被测:worktree `pkg-restore-midtiers` dev @ http://localhost:3022,页面 `/network/commissions`
- 方法:Playwright 页面级 `page.route`。session 伪造 superadmin(F 域 `can()` role 旁路,canDispose/canReject 均放行);GET `/api/admin/teams/commissions` 注入过 `assertF5Overview` 的 fixture,5 行事件:CM-90001 cooling(coolingDaysLeft=3)/ CM-90002 frozen / CM-90003 unlocked / CM-90004 reversed / CM-90005 withdrawn;POST `/api/admin/platform/audit/operations` 捕获请求头+体后按模式回 200 `{code:0,data:{…ticket}}` 或 503。
- 证据:截图 `scratchpad/t-all/tB-*.png`(b1 表格、b2 三弹窗对比、b3 提交后、b4 失败 toast),机读结果+完整捕获体 `tB-results.json`。

## 逐 AC 结论

| AC | 结论 | 验证方式 | 观察原文 |
|---|---|---|---|
| B1 按钮状态机 | **PASS** | 5 状态行逐行数按钮(getByRole button 精确名) | cooling 行:冻结=1 提前解锁=1 解冻=0;frozen 行:解冻=1 冻结/提前解锁=0;unlocked/reversed/withdrawn 三行:三键全 0;既有「冲正」不受影响(cooling/frozen/unlocked=1,reversed/withdrawn=0,与既有 `status !== reversed/withdrawn` 规则一致);「暂停奖种」5 行全=1 |
| B2 护栏视觉差异 | **PASS** | 三弹窗逐个打开,数 `.alertbar.danger` 护栏条 + 全文扫护栏文案 + 截图对比 | 「冻结佣金 CM-90001」:理由必填 textarea=1,护栏条=0,无「会增加资金流出」字样(截图 tB-b2-freeze-modal.png);「佣金提前解锁 CM-90001」:护栏条=1,含「会增加资金流出 · 系统会先检查 B1 备付金覆盖率」+「提交时由后端实时校验覆盖率,当前弹窗不使用前端兜底值」(tB-b2-unlock-modal.png);「解冻佣金 CM-90002」:护栏条=1 同款文案(tB-b2-unfreeze-modal.png) |
| B3 A2 票捕获 | **PASS** | 确认后在 route 层捕获 POST `/api/admin/platform/audit/operations` 原始请求体 | 冻结票:`command.op="f_commission_status"`,`command.params.key="F.commission.CM-90001.status"`,`command.params.value="frozen"`,`reason="回归验收:冻结该笔佣金观察"`(与所填逐字一致),请求头带 Idempotency-Key;提前解锁票:`params.value="unlocked"` 且 `amplifies=true`,reason 逐字一致 |
| B4 503 失败态 | **PASS** | 把该 POST 切 503 `{code:503,message:"AUDIT_BACKEND_UNAVAILABLE"}` 后确认,等 toast + 检查页面存活 | 可读失败 toast:「F 域数据提交失败 · 操作失败,请检查输入内容或刷新页面后重试。」;页面「佣金流水」仍在;确认弹窗保留(输入不丢);pageerror=0,页面未崩 |

Console:pageerror=0;非网络类 console error=0;未拦截接口 503 网络噪声 35 条(预期环境态)。

## 可疑点(单列,不占 AC)

1. **冻结票的 amplifies 与弹窗视觉不对称**:弹窗按 `mc.amplify=false` 不显护栏,但 propose 层 `amplifies: isFFundAmplifyingKey(key) || def.amplifies` 取 registry `f_commission_status` 的硬编码 `amplifies:true`(注释:「硬=true,动资金 postLedgerEntry」)→ **冻结方向的 A2 票也带资金放大标记**(本轮捕获实测 freeze 票 `amplifies=true`)。方向保守(多标不少标)且代码注释声明有意,但「弹窗不显护栏、A2 队列却标 🔥」的不对称建议产品侧确认口径(若冻结确属收紧方向,票面可考虑按方向传 false)。
2. **B4 失败文案归因不准**:503 后端不可用被 error-messages 兜底映射成「操作失败,请检查输入内容或刷新页面后重试」——可读但把环境故障归因到用户输入,运营会徒劳改输入。建议 backend-unavailable 类 code 单独映射「服务暂不可用,请稍后重试」。
3. (弱观察)B3 成功路径的「已写入 A2 后端待确认队列」toast 在 500ms 采样点未捕获到(弹窗已关、请求已捕获,提交本身成功)——大概率是 toast 时序与采样窗错开,不判缺陷,留档备查。

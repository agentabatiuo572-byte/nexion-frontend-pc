本页判定目标=K1 收益释放参数卡与簇详情收益影响条:7 行中文化/下拉契约/范围门+PATCH 捕获/缺席 fail-closed/簇状态映射(来源:任务 AC C1–C5)

# 独立黑盒验收报告 · C 组(K1 /risk/multi-account)

- 验收人:独立 tester agent(黑盒,不改仓)· 2026-08-06
- 被测:worktree `pkg-restore-midtiers` dev @ http://localhost:3022,页面 `/risk/multi-account`
- 方法:Playwright 页面级 `page.route`。session 伪造 superadmin **并显式带** `risk_k1_write / risk_k1_cluster_flag / risk_k1_cluster_freeze / risk_k1_cluster_release`(K1 写门 `hasAuthority` 不做 superadmin 旁路,见可疑点 1);GET `/api/admin/risk/multi-account/overview` 注入过 `normalizeK1` 严格校验的 fixture(stats 5 整数键、params 恰 5 键值全过 `validateK1ParamValue`、releaseParams 七键全过 `validateK1ReleaseParamValue`、clusters/whitelist 分页体、簇行 giftsJson/nodesJson/edgesJson="[]"、2 簇 status=frozen/detected、sources 含 K1_REQUIRED_SOURCES 全五项);PATCH `/api/admin/risk/multi-account/release-params/*` 捕获后回 200 `{code:0,data:{}}`。
- 首屏环境态说明:`/risk/multi-account` 首轮 `fetchKRiskOverviews` 用 Promise.all 并行拉 K1–K5,K2–K5 后端(:8110)缺席 → 整组落「K1 数据加载失败」(设计内失败态);点「仅重试 K1」只拉 K1 命中 fixture 后正常渲染。此为环境态非缺陷。
- 证据:截图 `scratchpad/t-all/tC-*.png`(c1 卡片、c2 下拉弹窗、c3 超范围+提交、c4 缺席、c5 frozen/detected/缺席三张影响条),机读结果+PATCH 捕获 `tC-results.json`。

## 逐 AC 结论

| AC | 结论 | 验证方式 | 观察原文 |
|---|---|---|---|
| C1 7 行+中文化+无裸串 | **PASS** | 重试 K1 后实测 `[data-proof="k1-risk-release-params"]` 行数 + 全页 body innerText 扫裸串 | 「收益释放参数」卡 7 行;releaseMode 显示「在线证明或人工放行」;freeSlotRequiresBinding 显示「开启」;全页无 `attest_or_manual` / `manual_only`;无裸 `true` / `false`(词边界正则) |
| C2 releaseMode 下拉 | **PASS** | 打开「调整」弹窗实测控件类型 + 理由长度门 | 弹窗「收益释放参数调整 · 释放模式」;`select`=1,选项恰 2 个:「在线证明或人工放行」「仅人工放行」;无任何自由文本/数字输入框(0);理由 2 字 →「确认保存」disabled;≥8 字 → enabled |
| C3 数值范围门+PATCH | **PASS** | 超范围输入实测禁用+红字;合法值提交后 route 层捕获 PATCH | 「待审收益释放时限」弹窗标签含范围「目标值(1 - 720 · 小时)」;填 9999 → 确认禁用 + 红字「必须填写范围内的整数」;填 96 + 理由 ≥8 → 启用;捕获 `PATCH /api/admin/risk/multi-account/release-params/pendingReleaseHours`:请求头 `Idempotency-Key: k-1785952206408-82evvlm7`,体 `{"value":"96","operator":"独立验收 Tester","reason":"回归验收:待审时限调整为 96 小时"}`(value/reason/operator 三键齐);提交后 toast「待审收益释放时限 已更新 · 后续结算与提现分诊按新值执行」 |
| C4 缺席 fail-closed | **PASS** | releaseParams 缺席 fixture 重载(经「仅重试 K1」)后实测卡内按钮与其余区块 | 卡显「服务端尚未下发收益释放参数(后端未升级)· 为避免在错误口径上调参,本卡不提供编辑入口。」;卡内「调整」=0;其余照常:「拦截阈值」卡 5 个参数行「调整」齐在(=5),「三层去重命中列表」在 |
| C5 簇详情收益影响条 | **PASS** | frozen/detected 两簇逐个点行读 `[data-proof="k1-cluster-earning-impact"]`;再用缺席 fixture 复点 | frozen 簇 CL-9001:结论徽标「锁定奖励」;「当前参数」行逐字引用 fixture 三值——「正常释放 2 个手机槽」「第 3 个账号起进入审核中」「第 5 个账号起建议锁定奖励」(2/3/5 = freePhoneSlotsPerCluster/duplicateAccountPendingFrom/duplicateAccountFreezeFrom);detected 簇 CL-9002:「正常槽内可提」;releaseParams 缺席时:「当前参数:服务端尚未下发收益释放参数,以服务端结算口径为准。」 |

Console:pageerror=0;非网络类 console error=0;未拦截接口(K2–K5 等)503 网络噪声 50 条(预期环境态)。

## 可疑点(单列,不占 AC)

1. **K1 权限模型与 F/G 域不对称**:F/G 域 `can()`/`allowed()` 对 `role===superadmin` 旁路,K1 `hasAuthority` 只认显式 authorities——**空 authorities 的 superadmin 会话在 K1 整页无任何「调整」等写入口**(本轮实测:未带 risk_k1_* 时释放参数卡与拦截阈值卡全部无按钮,页面纯只读)。若这是有意的最小权限设计则合理,但跨域不一致会让超管误判「按钮没恢复」;建议统一口径或在页面标注只读原因。
2. **带部分 authorities 的会话会收窄 IA 并重定向越界路由**:session.authorities 只带 risk_k1_* 时,侧栏收窄为「风控与反作弊」1 域 1 模块,访问 `/finance-products/genesis` 被重定向到 K1 页(本轮实测)。与可疑点 1 合看存在层间矛盾:同一会话 F/G 页内权限层放行(role 旁路),IA/路由层却拒——superadmin+部分授权的语义两层不一致,建议产品侧定谳单一口径。
3. **首屏跨模块耦合(设计内,提请知悉)**:K1 首屏与 K2–K5 同生共死(Promise.all),任一模块后端故障整组落错并需点「仅重试 K1」恢复。per-module retry 已具备,属既定设计;但运营视角「K3 坏了 K1 首屏也白屏」是可感知代价。

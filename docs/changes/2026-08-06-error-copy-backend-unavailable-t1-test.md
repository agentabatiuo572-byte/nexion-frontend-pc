本页判定目标=503/网络类失败 toast 归因文案(来源:任务 AC)

# 独立黑盒验收报告 · t1(后端不可达失败 toast 归因)

- 验收人:独立 tester agent(黑盒,未读未改 `lib/admin/error-messages.ts`;仓内零改动,仅本报告落盘)· 2026-08-06
- 被测:worktree `pkg-restore-midtiers` dev @ http://localhost:3022(自起,冷重启:先杀端口上残留 dev PID 6216,确保不吃旧 module graph),页面 `/network/commissions`(F5)
- 方法:Playwright 页面级 `page.route`。session 伪造 superadmin(GET `/api/admin/auth/session` 回 `{code:0,data:{tokenType,session:{role:"superadmin",…}}}`,**不带 menuCodes/effectiveMenus 字段**——显式空数组=显式无授权会导致 0 域可见被重定向,详见可疑点 4);GET `/api/admin/teams/commissions` 注入过 `assertF5Overview` 的 fixture,5 行事件:CM-90001 cooling(coolingDaysLeft=3)/ CM-90002 frozen / CM-90003 unlocked / CM-90004 reversed / CM-90005 withdrawn;其余 `/api/admin/**` catch-all 兜底 `{code:0,data:{}}`(防未拦截 401 触发 `resetAdminSession` reload 循环);POST `/api/admin/platform/audit/operations` 捕获请求头+体后按各 AC 模式回包。每 AC:点 CM-90001 行「冻结」→ 弹窗填理由「回归验收:冻结该笔佣金观察」→「确认提交」→ 100ms 轮询抓 toast 全文。
- route 真拦到的证明(每 AC 各 1 次 POST 捕获):`command.op="f_commission_status"`,`params={"key":"F.commission.CM-90001.status","value":"frozen"}`,`reason` 与所填逐字一致,请求头带 `Idempotency-Key`(如 `f-config-1785987785768-1`)。
- 证据:截图 `scratchpad/error-copy-t1/*.png`(绝对路径 `C:\Users\jason\AppData\Local\Temp\claude\D--WORKS-PLAN\89f5a9bc-bcd9-4e08-83ca-b1f3c9a7aa45\scratchpad\error-copy-t1\`:ac1-failure-toast.png=AC1 失败 toast 在场、ac{1,2,3}-after-submit.png=各 AC 提交后终态、run1-obsolete-*=作废的首轮),机读结果+完整捕获体 `t1-results.json`。

## 逐 AC 结论

| AC | 结论 | 验证方式 | 观察原文(toast 逐字) |
|---|---|---|---|
| AC1 503 `{code:503,message:"AUDIT_BACKEND_UNAVAILABLE"}` | **PASS** | 冻结确认提交,POST 拦为 503+message;轮询 toast 全文;检查弹窗/输入/pageerror | 「F 域数据提交失败 · 后台服务暂时不可达，本次提交未生效；请稍后重试，持续失败时请联系值班人员。」——含「后台服务暂时不可达」✓ 含「本次提交未生效」✓ 不含「检查输入」✓;pageerror=0;确认弹窗保留、理由输入逐字保留(截图 ac1-failure-toast.png:toast 与弹窗同屏) |
| AC2 503 空 JSON `{}` | **PASS** | 同路径,POST 拦为 503 空体 `{}` | 「F 域数据提交失败 · 后台服务暂时不可达，本次提交未生效；请稍后重试，持续失败时请联系值班人员。」——与 AC1 逐字相同(空 message 未回落到「检查输入」兜底)✓;弹窗/输入保留,pageerror=0 |
| AC3 400 `{code:400,message:"REASON_LENGTH_INVALID"}` | **PASS** | 同路径,POST 拦为 400+message(回归:既有映射不被新逻辑吞) | 「F 域数据提交失败 · 操作理由需填写 8-200 个字符。」——具体校验文案在,未被后端不可达文案吞掉 ✓;弹窗/输入保留,pageerror=0 |

## console / pageerror 计数

- pageerror:AC1=0,AC2=0,AC3=0(页面全程未崩,F5 表格与弹窗存活)。
- console error:每 AC 各 1 条,均为浏览器对被拦 POST 自身的网络日志(「Failed to load resource: … 503/400」)——测试激励的预期产物,非页面缺陷;无其它 console error(catch-all 已中和无后端环境的 503/401 噪声)。

## 可疑点(单列,不占 AC)

1. **弹窗理由上限口径不可见**:F5 冻结弹窗理由标签写「必填 · 8 字以上」(该表单未传 reasonMax,无 200 上限提示与 maxLength 截断),而服务端 400 映射文案说「8-200 个字符」。运营可在弹窗里输入 >200 字后才被服务端打回,上限只能从失败文案里得知。弱观察,建议该弹窗与其它 8-200 表单统一带上限。
2. **失败 toast 无角色区分**(信息性):三种失败(后端不可达/参数校验)均以「F 域数据提交失败 · 」前缀 + 具体归因呈现,归因清晰;toast 2.8s 自动消失,弹窗内无常驻错误条(`submitError` alertbar 未走到——域回调吞掉异常自管 toast)。若运营错过 toast,弹窗内没有失败痕迹,仅供产品侧留意,不判缺陷。
3. **3022 上存在外部轮询**:验收结束后 dev 日志仍持续出现 `GET /api/admin/market/nex/genesis/operations` 等请求,疑似本会话其它 agent 或残留浏览器 tab 在使用我自起的 3022 dev。已按任务指令在收尾杀掉自己起的 dev;若有依赖方需自行重启。
4. **首轮作废(tester 环境问题,非 SUT)**:首轮伪造 session 带 `effectiveMenus: []`,命中导航单源「显式空授权集不被静态 IA 覆盖」规则 → 0 域可见、/network/commissions 被重定向总览,三 AC 全 ERROR。证伪环境后去掉该字段(undefined → superadmin 静态 IA 回退)整轮重跑,以上结论均出自重跑轮。印证「失败先证伪环境再判 FAIL」。

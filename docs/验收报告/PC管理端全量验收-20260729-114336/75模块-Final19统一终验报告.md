# PC 管理端 75 模块 Final19 统一终验报告

- Run ID：`pc-full-acceptance-20260729-114336`
- 范围真源：`lib/nav/console-nav.ts`，A–M 13 域、75 模块
- PC Build ID：`cIXso0KJblmHHCLNiokFZ`
- 后端 JAR SHA-256：`8166F07EB1993579982938A3FC1AD73BC9BE7CD801B69404C7825355FA2057F6`
- 执行方式：Chromium、`workers=1`、`trace=on`，从真实登录页和可见侧栏进入

## 结论

Final19 统一终验通过。首轮侧栏进入 `75/75`、逐页刷新 `75/75`、退出并完成真实 MFA 重登后的侧栏复跑 `75/75`。P0/P1/P2/P3 均为 0。

| 门禁 | 结果 |
|---|---:|
| pageerror | 0 |
| 非预期 console error | 0 |
| 管理接口 5xx | 0 |
| 管理接口非预期 4xx | 0 |
| 管理接口 request failure | 0 |
| 真实 request failure | 0 |
| 导航取消 | 109 |
| 未配对导航取消 | 0 |
| 预期匿名 session 401 | 1 |

109 条 `net::ERR_ABORTED` 只有在同阶段、同方法、同路径存在替代成功响应时才计为允许项；没有路径级或模块级的宽泛豁免。

## 第一次执行未签发说明

第一次完整执行已完成三轮 75/75，但 M1 首轮有 7 个头像请求在自动化快速切页时被取消，且同路径没有替代成功响应，因此严格门禁正确判定失败。该次完整 JSON、trace、视频和日志保留在：

`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\final75-final19-attempt1`

验收载体随后仅增加 M1 头像全部完成加载后再离开的真实用户等待，没有放宽请求失败或取消配对规则。载体合同 `4/4`、TypeScript 通过后，从登录入口重新执行整个 75 模块范围，最终通过。

## 原始证据

- 最终证据目录：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\final75-final19`
- 运行结果：`final-75-runtime.json`，SHA-256 `871DE77C03BD6FE5FFB640F556110266A654BFE83353D54FBE8C556EDD36AA88`
- Playwright 日志：`playwright.log`，SHA-256 `AD3531FED17EBD5448E946112066250497FA8DB24544EE1FBC82E519F656E9F9`
- 证据哈希清单：`evidence-sha256.json`，SHA-256 `0E8B2104A2A0D5E98DFD8DED6F5277FD89EB044683B5B759F9B10E2EE4A8D829`

## 评分

- 初审：99.0/100，通过。
- 复审：99.4/100，通过。
- 当前血量：100。

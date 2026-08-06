# C 域非 Owner Final13 对抗复审 B

## 结论：验收载具受阻，未签发复审分数

本次未继承 Final13 Owner 通过结论，也未将载具问题误报为产品缺陷。Final13 锁定运行时要求正常 MFA（`mfaBypass=false`），但既有非 Owner C 域载具的 `loginSuperadmin()` 在密码登录成功后直接等待侧栏，没有处理服务端正常返回的 MFA challenge。因此无法从真实登录页建立会话，C1–C6 全量对抗复审没有可用的真实浏览器完成证据，**不评分、不签发通过**。

## 已执行证据

- 候选锁：`candidate-rebuild-final13/FINAL13-RUNTIME-LOCK.json`；PC `3002`、后端 `8110`、PC build `lqlGobSf9dgLarrRkjFGn`、后端 JAR SHA-256 `34706D1FC0AD02923AEB6217B405D90FAA47730387266E56D9336BA0564557A7`。
- 真实 Chromium / Playwright：`workers=1 --trace=on`，从登录页输入账号密码。
- 命令：`npx playwright test tests/e2e/c-domain-nonowner-b-20260728.spec.ts --project=chromium --workers=1 --trace=on --reporter=line`。
- 退出码：`1`。首个用例在 `loginSuperadmin()` 的侧栏断言处超时；密码登录 HTTP 200 后页面仍处于 MFA challenge，未形成 session。其余 6 个用例因 serial 执行未启动。
- 原始失败证据：`C/final13-nonowner-b/playwright/c-domain-nonowner-b-202607-0c178-录可见侧栏、六模块真实读取、刷新返回重登与跨域事实一致-chromium/`（trace、video、截图、error-context）。

## 归因与后续

- 归因：验收载具的认证状态机缺少 `challenge -> fresh TOTP -> /auth/mfa/verify -> session -> 可见侧栏`，不是 C 域产品接口、权限或数据链路的真实复现。
- P0/P1/P2/P3：不登记。当前没有已证实产品缺陷。
- 未覆盖：C3 maker 自审、checker 权限漂移、同键 in-progress/异载荷、CAS、钱包/反向账本、A2/A4/outbox、App 余额恢复、刷新重登、五层权限及全故障矩阵。
- 补验要求：仅修复载具 MFA 状态机（不放宽断言、不改产品），然后从真实登录页重跑完整 C1–C6 与上述墨菲路径；通过后才可按 `>98` 门槛评分。未修改产品源码、未提交或推送。

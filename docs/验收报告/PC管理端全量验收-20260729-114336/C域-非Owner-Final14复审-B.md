# C 域非 Owner Final14 对抗复审 B

## 结论：通过

Final14 锁定候选已由独立非 Owner 浏览器复审。初审 **99.1/100**，复审 **99.3/100**；均高于门槛。P0–P3 为 0。

本轮从可见登录页使用受限 C fixture 的正常 MFA 链路（密码登录 → MFA challenge → 新 TOTP → `/auth/mfa/verify` 200 → session 200 → 可见侧栏），没有认证旁路。

## 候选与 C1 修复复验

- 锁定文件：`candidate-rebuild-final14/FINAL14-RUNTIME-LOCK.json`。
- PC build：`0OZ66wYtIYX6qJHhZUvQK`；后端 JAR SHA-256：`F54932E72C272E14247439DC32ECC9165FD741E7A25C7E3D60464FB4FACA7399`；`mfaBypass=false`。
- Final13 的真实 C1 缺陷已在 Final14 验证修复：自定义 C maker session 含 `user_c1hub_read`，`GET /api/admin/users/profiles/990000151023/360` 现为 200，且为最小化画像投影。
- C1–C6 均从侧栏进入并在刷新后得到 200；退出并重新 MFA 登录后仍可访问。匿名六个读取均为 401；空检索态、页面错误、管理端 5xx、控制台错误均为 0。

## 对抗范围与结果

- 五层权限：readonly 与 menu-no-write 分别分片覆盖 C1–C3、C4–C6；所有授权读取 200、伪造写入 403，刷新和重登后无权限漂移。no-menu 账号的菜单、深链和六个读取均拒绝（403）。
- 最小权限跨域：C maker 的 C1–C4 明细读取为 200；无 D/K/L/G/M 授权的 D4、K5、L5、G2、M2 均为 403。这是受限角色的正确边界，不再把它误当作全局 superadmin。
- C3 真实链路：创建 200、同键重放 200、同键异载荷 409、maker 自审 403、独立 checker 审核 200、并发冲正仅产生 200/409、重放 200、异载荷 409；审计链存在。钱包在冲正后从 100 精确恢复至 100。
- 失败关闭：C1–C6 畸形 200 均在模块内关闭；C3 503 和 C5 超时可恢复；C4 畸形、C5 500、C6 timeout 均不留下可操作的危险按钮。
- C6 未知结果：同载荷三次重试复用同一 key；理由变更使用新 key；测试不触碰真实配置。

## 证据与清理

- 主复审证据：`C/final14-nonowner-b/playwright-r3/superadmin-read-cross-domain.json`、`playwright-r4a`、`playwright-r4b`、`playwright-r5a`、`playwright-r5b2`、`playwright-r6`、`playwright-r7`、`playwright-r8`、`playwright-r9`，均以 `workers=1 --trace=on` 执行；trace 与页面工件在相应 `artifacts` 目录。
- C3 独立生命周期证据：`C/final14-nonowner-b/c3-lifecycle-r3/c-final13-owner-result.json` 及同目录 trace、C1–C6 截图。
- C3 写入已完成审核与冲正，钱包恢复到基线；没有待处理的资金调整或 C6 参数写入。
- 未由本复审修改产品源码、提交或推送。C1 后端修复由独立修复人完成，本轮只在锁定 Final14 运行时作 live 验证。

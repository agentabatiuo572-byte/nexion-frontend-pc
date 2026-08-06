# C 域 Owner 验收报告（Final10 · HOLD）

Run ID：`pc-full-acceptance-20260729-114336`  
范围：C1 检索与画像、C2 账户操作、C3 余额与资产调整、C4 KYC 合规台账、C5 安全与会话、C6 注册/登录风控。  
候选：PC Build ID `zGL97cq44U6qzzAKmh415`（`http://127.0.0.1:3002`）；后端 JAR SHA-256 `ED80116D6B7D7C025490C4EEC180D53F135D712DB0A4D5C89D6FA4D8D9A9F947`。  
Owner 结论：**HOLD。首次 normal-MFA 登录后的前端引导状态失真，C1–C6 全链不能继续签发；没有新增成功业务写入。**

## Final10 运行时与首次用户证据

- 已绑定 `final10-runtime-lock.json`：主 PC `3002`、后端 `8110`、隔离库 `nexion_acceptance_20260729_114336`、`mfaBypass=false`，候选 Build/JAR 与锁文件一致。
- C maker 在全新浏览器上下文从真实登录页输入账号、密码与 normal MFA 后，`/api/admin/auth/session` 返回 `200`，响应 schema 包含 `tokenType`、完整 `session`、46 项 C 权限和 C1–C6 菜单；浏览器存在 `nexion_admin_token`（HttpOnly、SameSite=Strict）Cookie。
- 同一时刻页面 URL 仍为 `/`、标题为“`Nexion 运营控制台`”，但正文却退回“运营控制台登录”，没有侧栏；首次进入 `/users/search` 仍是登录页。该状态与服务端会话已认证直接矛盾，普通用户无法从登录后的可见侧栏完成首轮页面走查。
- 在一次诊断中，对 `/users/search` 再次刷新后前端才恢复 C1 壳层；此前独立诊断又曾在刷新后持续登录页。无论是否偶发恢复，首次登录后的即时导航状态不确定，不能满足 `75/75` 首轮/逐页刷新门禁。
- network 证据保留 login、MFA、session、`auth/me`、导航、刷新、Cookie 元数据和响应 schema：`auth/me` 为 `404`；login 与 MFA 均为 `200`；没有 Set-Cookie 响应头，但 MFA 后已有认证 Cookie。捕获到一条预期的匿名 bootstrap `401` console error，pageerror 为 `0`；若干被前端路由切换中止的后台请求记录为 `ERR_ABORTED`，未混同为服务端 5xx。
- superadmin 对照确认账号密码登录同样进入 MFA 挑战（`200`、正常 OTP 页面）；该专用测试未持有 superadmin 的 TOTP，因此没有把它伪造为已认证对照或绕过 normal MFA。

## 缺陷台账

| ID | 等级 | 模块 | 归因 | 当前状态 |
|---|---|---|---|---|
| C-F10-P1-001 | P1 | 公共认证/路由引导，阻断 C1–C6 | 服务端认证会话和 HttpOnly Cookie 已建立，但前端首次 MFA 完成后的页面状态仍显示登录；首次可见侧栏导航不稳定 | OPEN |

Owner 阶段没有修复该公共缺陷、没有修改共享源/构建/服务，也没有新增 C3/C5/C6 成功业务命令。此前 Final9 C3 权限矛盾不以旧结论覆盖 Final10；Final10 的 C3 granular create/approve、大额、审核与冲正闭环必须在认证引导修复后的新候选重新验证。

## 证据与清理

- `C/final10-owner/c1-refresh-diagnostic.json`：SHA-256 `6A336ADFAD18961A1A29CDFE35673DEF9A3FCEE5D959E3F4036A4EE1A648D574`。
- `C/final10-owner/c-final10-auth-network.json`：SHA-256 `C0F36D50ACAA772598555AF333BD450D45D28A4AFC93F26B577AFACF108BE8B8`。
- 原始 trace、截图、视频和独立载具位于 `D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\C\final10-owner\`。
- 临时浏览器上下文均已关闭；无对象锁、无待处理 C 域业务对象、无须清理的可变 C3 账务。

## 评分与恢复门禁

- 初审：**不打通过分**（存在未关闭 P1，不能达到 `>96` 的签发标准）。
- 复审：未触发。
- 恢复条件：由非 C Owner 修复认证后前端引导/路由状态并重建部署；本 Owner 在新候选从 normal-MFA 登录入口重跑 C1–C6，全量覆盖 C3 granular create/approve、大额申请/独立审核/冲正、C5/K5、C6 CAS、五层权限、失败关闭、幂等/未知结果、刷新/重登及 DB/A2/A4/outbox。

## 历史说明

Final9 的 C2 恢复和 C3 权限矛盾证据仅作为同一 Run ID 的历史材料保存于受限目录，不能替代 Final10 的独立结论。

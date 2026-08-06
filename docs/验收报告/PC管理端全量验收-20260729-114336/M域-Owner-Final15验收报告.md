# M 域 Owner Final15 验收报告

## 1. 结论

- Run ID：`pc-full-acceptance-20260729-114336`
- 验收范围：M1–M5 客服中心完整 Owner 初审
- 执行日期：2026-08-02
- 结论：**PASS，可进入非 Owner 对抗复审**
- Owner 初审评分：**98.6 / 100**（严格大于 96）
- 未关闭缺陷：**P0=0，P1=0，P2=0，P3=0**
- `M-FINAL13-001`：**关闭**。Final15 中真实浏览器在写后 reload 后稳定保留两个权威 SUPPORT 席位；转接弹窗按稳定 adminId 显示目标，完整完成自转拒绝、跨席位转接、目标接受、转工单、刷新重登和精确清理。
- 本报告只签发 Owner 初审；按 A–M 轮换，仍须由 L Owner 对 M 域执行严格大于 98 的非 Owner 对抗复审。

## 2. 锁定候选与门禁

| 项目 | Final15 锁定值 |
|---|---|
| 候选锁 | `D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\candidate-rebuild-final15\FINAL15-RUNTIME-LOCK.json` |
| 候选锁 SHA-256 | `8C8D6FCB1BFFCE4355D1CF600700F47AE01E5C32C80DB367768C3E6537DE278C` |
| PC | `http://127.0.0.1:3002`，PID `2172`，Build ID `D16zWSJ5S3cDzcz8qW_fD` |
| 后端 | `http://127.0.0.1:8110`，PID `22996` |
| 后端 JAR | `nexion-backend-13A103A65FEA04FD.jar` |
| JAR SHA-256 | `13A103A65FEA04FD8829305160C9496151BC0EB426DEBBACABB533D0DB4752E5` |
| MySQL / Redis | `nexion_acceptance_20260729_114336` / DB `13` |
| 原始证据 | `D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\M\final15-owner` |

候选总门禁：后端 Maven `3005 passed / 5 skipped`；PC Node 合同 `999/999`、typecheck、verify、生产 build 通过；App Vitest `58 files / 267 tests`、typecheck、H5 build 通过。主、子 PC/后端端口与锁定进程均在验收时可达。

## 3. Owner 全量执行结果

域内 Playwright 固定 `workers=1`，所有业务结论来自真实 MFA、可见侧栏和真实后端；未使用隐藏 URL、mock、DOM 修改或 localStorage 作为业务权威态。

| 范围 | 结果 | 关键覆盖 |
|---|---|---|
| M 静态合同 | **101/101 PASS** | M1–M5 合同、渐进失败关闭、authEpoch、同名席位稳定 ID、Final15 generation 防陈旧覆盖 |
| M1 客服运营总览 | **1/1 PASS** | 可见侧栏、KPI 跳转、结果未知、同键安全重试、CAS 与单例配置恢复 |
| M2 工单 | **2/2 PASS** | 初始加载失败关闭、UI 创建/回复、同键幂等、异载荷 409、陈旧 CAS 409、404、422、刷新、重登、解决并归档 |
| M3 会话 | **1/1 PASS** | 两个真实 SUPPORT 角色、写后 reload 候选稳定、自转 422、非目标接受 403、跨席位转接/接受、转工单、刷新重登、会话/工单清理 |
| M4 FAQ/SLA | **2/2 PASS** | 九类 SLA、FAQ 结果未知、同键恢复、并发唯一性、500 失败关闭、M1 消费、刷新重登、删除与 SLA 恢复 |
| M5 设置/话术/模板 | **1/1 PASS** | 分类/策略、500、幂等、CAS 409、422、结果未知、发布、刷新重登、M3/M1/I6 消费、终态归档与策略恢复 |
| 五层权限 | **3/3 PASS** | readonly、nowrite、nomenu 的菜单、路由、按钮、接口、数据；刷新重登不漂移 |
| authEpoch / Murphy 故障 | **2/2 PASS** | M5 刷新退出重登后 M3 身份恢复；401、500、超时、畸形 200 失败关闭，仅新权威 200 恢复 |

动态 Playwright 有效签发合计 **12/12 PASS**。成功用例中 `pageerror=0`；非预期 console error、非预期管理接口 4xx/5xx 和真实 request failure 均为 0。authEpoch 用例记录的两条 console 401 均发生在可见退出登录后的预期会话失效阶段，未作为候选错误豁免业务失败。

## 4. M3 Final15 修复点真实验证

1. 两个独立、同权限集的 SUPPORT 用户完成真实 MFA 登录；权威 `support-agents` 返回两席位均 `enabled=true`、`transferable=true`、`busy=false`。
2. 从可见侧栏进入 M3 并发起真实会话，写后重新加载 M 数据。
3. 转接弹窗稳定显示另一个 SUPPORT 目标，并以 adminId `99969` 选择；当前席位 `99968` 不进入候选。
4. 自转接返回 `422`；非目标接受返回 `403`；目标席位接受成功，转工单后会话为 `CLOSED`。
5. 退出重登后在归档段可读取同一会话；工单 `TK-20260802033754730` 为 `RESOLVED + archived=1`。
6. DB 确认 `nx_conversation_transfer` 为 `ACCEPTED`，`from_agent_id=99968`、`to_id=99969`、`accepted_by` 为目标坐席。

因此 `M-FINAL13-001` 的“写后 reload 丢失跨席位候选”在 Final15 已由真实用户链路关闭，未以静态单测代替运行结论。

## 5. 异常、权限、幂等与并发

- 认证与权限：匿名 401；SUPPORT 非授权高风险写 403；非目标转接接受 403；readonly/nowrite 写接口 403；nomenu 菜单、直链和 M1–M5 读写接口全部失败关闭。
- 业务异常：不存在资源 404、幂等键异载荷和陈旧版本 409、自转/短原因/非法 audience 422、注入 500、超时、畸形 200 均得到预期结果。
- 结果未知：M1、M4、M5 在真实上游已提交但响应丢失时保留表单/快照并复用同一幂等键，恢复后只产生一个业务对象。
- CAS/并发：M2/M4/M5 均使用可见快照版本；陈旧写失败关闭。M4 并发创建保留两个唯一对象，M3 转接按稳定席位 ID，不依赖同名显示文本或列表索引。
- M3 渐进读取：旧 generation 不覆盖新会话权威态；401/500/超时/畸形 200 清空旧转接权限，只有同 authEpoch 的新鲜成功读取可恢复。

## 6. A2、A4、outbox 与跨域消费

- A2：Final15 精确对象/前缀共核对 `SUCCESS=51`、`REJECTED=4`；拒绝项均为刻意构造的 CAS 或业务规则攻击。
- A4/outbox：共 `17` 条，`FAILED=0`、`PENDING=17`。事件包括 autopush `4`、category `2`、script published `2`、template published `2`、support FAQ `7`。
- 隔离候选未运行 publisher，因此只签发“权威落表且无 FAILED”，不把 PENDING 冒充下游已投递。
- M5 发布话术/模板可被 M3 真实选择；归档后从 M3 选择器消失。M1 保持同一主管席位。I6 两个语言镜像均为 `ARCHIVED`。
- SUPPORT 对 A4 总览的 `403` 是最小权限正确结果；Owner 载体不扩大 SUPPORT 权限，A4/outbox 由隔离库权威核对。

## 7. 清理与终态

- M1 负载单例配置恢复。
- M2：Final15 两个验收工单均 `RESOLVED + archived=1`；Final14 中断工单 `TK-20260802031749811` 也已精确归档。
- M3：两个 Final15 会话均 `CLOSED`，开放残留为 0；跨席位转接记录保留为不可变业务证据。
- M4：三个 FAQ 均 `status=0, is_deleted=1`；SLA 恢复。
- M5：分类和自动推送策略恢复；话术、模板均为终态归档；对应 I6 镜像均为 `ARCHIVED`。
- 精确终态 SQL 的五类活动计数均为 0；不可变 A2/outbox 按审计边界保留。

数据证据：`db-a2-a4-outbox.safe.json`、`cleanup-final15.safe.json`。

## 8. 载体异常披露

- M3 前两轮在业务链已成功后，于同一个 30 秒 TOTP 步立即退出重登，触发服务端防重放 401；每轮会话/工单均在 `finally` 中精确关闭和归档。载体增加“同一密钥不得复用 TOTP step”的等待后，从登录入口完整重跑通过。
- M2 旧载体曾把 SUPPORT 对 A4 总览的正确 403 写成固定 200 预期；已改为不扩大权限，并由数据库核对 A4/outbox。随后完整 M2 `2/2` 重跑通过。
- authEpoch 载体只增加对当前 restricted manifest 顶层 `account` 的兼容读取，不改变产品断言。

上述载体修正不修改产品权限、不伪造后端结果，也不用于覆盖失败证据。

## 9. 关键证据与哈希

- M3 跨席位结果：`FB0ECAD4FD22CFD1FA664E80E7DF477B0E35AFE0629D57B84566221F2CFC3ADC`
- M3 通过 trace：`08455EB99854713986875E325D17F560938469704CF6113A0B06106B50839F78`
- M2 结果：`8B2C01EA32485562920FC442342B3AC782F008C568FE1D832AB9CEB53A0ABFD1`
- M2 通过 trace：`F7EB881E86A81A92FCFD31BC7DF99FB016D6C5BCE13663062DBC1C6514AE3DFF`
- M5 结果：`6C2FAD54049102F23A226130C1CF0F06F3D837D391A2EDA1263E27393751D34E`
- authEpoch/M-005 结果：`8843FE52DBEF382EB6FCBBE3C9494C26DBED0F207B8BF9DD9721F24AD019A97B`
- M-005 故障矩阵 trace：`9EAFFA6C319B43050F669F3308EB2201B24E72BE6560893AC464B912F7A0087B`

原始 evidence 在签发前共 `75` 个文件、约 `129.9 MB`；Final14 失败 trace 仍保留，未覆盖或删除，也未触碰 H8 历史证据。

## 10. Owner 签发

M1–M5 Owner 初审达到 **98.6 / 100**，硬性不通过项为 0，P0–P3 清零。M 域现进入 L→M 非 Owner 对抗复审；在复审严格大于 98 前，不单独宣称 A–M 全量最终签发完成。

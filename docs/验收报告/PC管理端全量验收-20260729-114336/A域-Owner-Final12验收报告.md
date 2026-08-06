# A 域 Owner Final12 初审验收报告

- 运行：`pc-full-acceptance-20260729-114336` / `Final12`。
- 锁定运行时：PC `http://127.0.0.1:3002`、后端 `http://127.0.0.1:8110`；页面实际服务 build 与 `FINAL12-RUNTIME-LOCK.json` 一致：`ABZKW7393ECWjhkaA_btM`；后端 jar SHA-256 为 `2A3EEC48ACCE273CFDEA32AAA2D0ADC69CC7F9EA07B66126BDC42D5482083DD2`。
- 方法：Chromium，`workers=1`、`trace=on`；从真实登录页和可见「平台基础 A」侧栏进入，不使用隐藏 URL、mock 或 localStorage 权威态。
- 凭据：仅从锁定的 `A/final7-fixture-refresh/final7-a-fixture-manifest.json` 读取。候选身份由 Final12 runtime lock 绑定，不以本地 `.next/BUILD_ID` 代替服务端 build。
- A3/A4：本轮只有浏览器读链、导航与受控故障注入，没有 A3 配置或 A4 registry 写入；因此未取得 `GLOBAL_CONFIG_SINGLETON.lck`，亦无单例快照待恢复。

## 初审结论：通过

**98.8 / 100，通过。** A1–A8 从登录页开始的可发现性、读链、刷新、登出重登、权限负向链，以及 A1/A2/A4、A5、A6/A7/A8 的真实用户路径均在锁定 Final12 运行时重跑通过。没有发现产品 P0/P1/P2 缺陷。

## 本次载具修复与复验

1. A6/A7/A8 的 cleanup 不再把密码登录后的 MFA challenge 当作 session：统一经过密码登录、MFA challenge、新 TOTP 窗口、`/auth/mfa/verify`、`/auth/session` 和可见侧栏恢复。主断言异常保存为 `primaryError`；cleanup 异常保存为 `cleanupError`，且仅在没有主异常时才作为退出错误，不能掩盖原始失败。
2. A1 故障矩阵改为校验 Final12 runtime lock，并从 Final7 manifest 取得 maker 凭据；真实覆盖 HTTP 404、HTTP 500、超时、断网、畸形 HTTP 200。每一种故障均先失败关闭，再取消路由注入后点击真实「重试」恢复到 200。
3. A1–A8 可见走查载具改为验证页面实际服务的 build 与 runtime lock 一致；本地 `.next` 目录的后续 build 不再被误记为运行候选。A5 与 A1 生命周期载具使用同一受控的新 TOTP 窗口策略。

## 真实用户验收结果

| 范围 | 结果 |
|---|---|
| A1–A8 可发现性、刷新、登录生命周期 | maker 从登录页进入，8 个侧栏项全部可见；8 个读接口均为 200，逐页刷新保持路由；登出后 session 为 401、旧侧栏消失，再次 MFA 登录成功。 |
| 五层权限 | readonly、nowrite 各自 8 个菜单可见、8 个读 200、写 403；nomenu 为 0 个平台菜单、8 个读/写均 403，直接路由和刷新均被拒绝。 |
| A1 / A2 / A4 | 两名独立 MFA 运营员并发 CAS 为 `[409, 200]`；同键重放 200、载荷不一致 409、结果未知仅按同键重放；数据库 A2 审计为 3 条、临时账号残留为 0，A4 overview 正常。 |
| A5 | 参数卡片、域筛选、A3/J1/J2 跳转通过；403、重复 canonical key 的畸形 200 和 503 均失败关闭，取消注入后恢复正常。 |
| A6 / A7 / A8 | 角色创建、无效授权零副作用、菜单同键幂等/不一致载荷拒绝、父子节点与角色绑定保护、关联账号最小可见权限、A8 搜索/未映射服务端真值、只读账号写矩阵 405 均通过；角色、菜单、工单和 3 个临时账号均精确回收。 |
| A1 故障矩阵 | 404、500、超时、断网、畸形 200：`failClosed=true`、`recovered=true`、恢复读链均为 200。 |

## 命令与退出码

| 命令 | 退出码 | 结果 |
|---|---:|---|
| `node ...\\A\\final12-owner\\final12-a-no-write.mjs` | 0 | A1–A8 可见侧栏、刷新、重登、五层权限；实际服务 build 与 Final12 lock 一致。 |
| `npx playwright test tests/e2e/a5-live-reacceptance.spec.ts --project=chromium --workers=1 --trace=on` | 0 | A5 主链、403、畸形 200、503/恢复通过。 |
| `npx playwright test tests/e2e/a-final7-a1-lifecycle.spec.ts --project=chromium --workers=1 --trace=on` | 0 | A1 CAS、幂等、未知结果、A2/DB、A4 读取与精确清理通过。 |
| `npx playwright test tests/e2e/a6-a8-live-reacceptance.spec.ts --project=chromium --workers=1 --trace=on` | 0 | A6/A7/A8 全链路、MFA cleanup、只读与恢复通过。 |
| `node ...\\A\\final12-owner\\final12-a1-fault-matrix.mjs` | 0 | 5 种真实浏览器故障注入均失败关闭并恢复。 |
| `npx tsc --noEmit` | 0 | 载具 TypeScript 校验通过。 |

## 证据与哈希

- `A/final12-carrier-repair-b/no-write/result.json` — `634732BB49E038F4495F64B422423AA811ED3A97284BA399E2F47BEA957D349A`
- `A/final12-carrier-repair-b/no-write/maker-trace.zip` — `F601A2A7651D53D8EC572CAC4DB3E9F0F718BFA89BEB5A9623EFF3E1731FBF22`
- `A/final12-carrier-repair-b/a5/01-live-registry.png` — `0457B1A02669463EE9AAB61585940D32DDA20E7A231D6FB6E91DF53A1AD60C5D`
- `A/final12-carrier-repair-b/a5/05-unavailable-retry.png` — `4D48452792F2EBC5E360166595070B6371B6D8454E119369EBFCA1B327A905E1`
- `A/final12-carrier-repair-b/a1-lifecycle/A1-FINAL7-1785603873489-c5472452-summary.json` — `444C925959A4F5A09BB1A342372C385DFF7067FCCF840B2B9652F823B492545A`
- `A/final12-carrier-repair-b/a6-a8/runtime-evidence.json` — `2EF76AB8C3C48B937FDB885B4C6068FBB518DCFC2BFDE09B67B556E95209D030`
- `A/final12-carrier-repair-b/a6-a8-output/.../trace.zip` — `C89C7F9E7352AD65FD786C1A6F8E85F31FA13D87D8CFBCB36F7382DA00ED1208`
- `A/final12-carrier-repair-b/fault-matrix/summary.json` — `7E7ECD5CAFBF94E8EF3377E0BE110866645094CBD26F1DBA36200CA0BE782D9A`

受控故障期间的 404/500/超时/断网 console 和 request failure 是预期注入证据；矩阵 `pageErrors=[]`，5 个场景均显式断言失败关闭与恢复。主可见走查无 page error、无非预期 API 4xx/5xx；路由切换的 `net::ERR_ABORTED` 按导航取消记录且未影响断言。

## 复审

**99.0 / 100，通过。** 复审独立核对了 Final12 runtime lock、服务端 build 探针、各命令退出码、A1 生命周期数据库摘要、A6/A7/A8 精确 cleanup、A5 截图、trace 与故障矩阵 5/5 恢复结果。旧 P1/P2 均为验收载具缺陷，已由本轮实跑关闭；未发现产品缺陷。未修改生产产品源码，未改共享缺陷台账，未提交或推送。

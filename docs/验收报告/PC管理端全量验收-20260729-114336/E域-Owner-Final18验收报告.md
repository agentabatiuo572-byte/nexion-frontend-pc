# E域 Owner Final18 全量验收报告

## 结论

**通过，允许进入非 Owner 对抗复审。** 已在 Final18 锁定 PC/后端候选上，从真实 MFA 登录和可见侧栏完整重跑 E1–E6；本轮没有产品 P0–P3。

初审：**98/100，通过**。复审：**99/100，通过**。

## 锁定候选

- 运行时锁：`bug-pic/.restricted/pc-full-acceptance-20260729-114336/candidate-rebuild-final18/FINAL18-RUNTIME-LOCK.json`
- PC：`http://127.0.0.1:3002`，构建 `9mltIBkb8GykArkvwXDY1`。
- 后端：`http://127.0.0.1:8110`，JAR SHA-256 `77DABEDE10CCA3AD3D82AA506A09A706724679CB703172725BB3C0CBECF85E70`。
- App：锁定记录为 Final15 后未改动；锁内 H5 门为 58 files/267 tests、typecheck、H5 build 均通过。

## 完整走查结果

- 无写全域：5/5 通过。真实 MFA、E1–E6 可见侧栏、权威读取、逐页刷新、退出重登、无菜单账号、匿名边界、无越权预取，以及 E2/E3 畸形和恢复均通过。
- E1 媒体：1/1 通过。SKU 元数据保留历史 presign 仅作元数据，不作为判定；真实 DOM 运行中 4/4 asset 在首入和刷新均先调用 `/api/admin/media/uploads/{assetId}/preview-url`，再请求新签名媒体。不存在 `X-Amz-Date=20260705` 的实际请求或挂载；图片为 200、视频 Range 为 206；失败态不显示旧媒体并保留重新加载入口。
- E1 的三个 `media net::ERR_ABORTED` 均是浏览器范围/重载取消允许项：2026-08-01 21:50:24.851 两条 `.mov` 分别在 21:50:24.855 与 `.856` 由同对象路径的 206 替代；21:50:25.309 一条 `.mov` 在 `.323` 由同对象路径 206 替代。一次 `/api/admin/auth/session` fetch abort（21:50:24.333）在 `.361` 由同路径 200 替代。路径比较忽略签名 query；四媒体均成功、无失败 UI，因此不构成 P1。
- E1/E4/E5/E6 MFA 故障关闭：1/1 通过。逐模块权威读取、畸形 200 关闭、恢复及匿名 401 均通过。
- E3：2/2 通过。canonical CAS、同载荷幂等、冲突/第二运营员、checker 越权/自审、终态重放和未知结果均关闭；批准后精确恢复。
- E6：1/1 通过。maker/checker 分离、拒绝和批准、pending 409、second writer 409、checker 写 403、自审 403、未知工单 403、终态重放 409、A2 读取 200、checker A4 403、恢复精确一致均通过。
- E6 失败关闭：1/1 通过。401、500、畸形 200、退出前账号迟到成功响应均不显示控制项，也不会污染无菜单账号。

## App、审计与状态恢复

- App 合同采用锁定 Final15 H5 构建门；本轮尝试在独立同源 preview gateway 再跑 8 轮首刷+刷新，但遗留 5176 载具返回空响应，独立 5178 gateway 也在首请求连接重置，未将该环境载具问题计为产品缺陷或覆盖既有锁定门。
- E6 可见流程的批准、拒绝、还原均有独立结果文件；还原后 `restoredExact=true`，终态重放无重复副作用。A2 和 A4 权限结果分别为 200/403。
- 本轮直接 MySQL 只读复核因运行账户认证被拒（1045）未取得新 SQL 行；未猜测或修改数据库凭据。该受限项不替代已锁定的构建门和本轮可见 A2/恢复证据，建议非 Owner 复审使用受授权的数据库通道核验 pending/outbox 终态。

## 证据与恢复

- 证据根目录：`bug-pic/.restricted/pc-full-acceptance-20260729-114336/E/final18-owner`。
- E1 结构化运行证据：`e1-media/e1-media-production-result.json`；含首入/刷新 assetId、preview-url 调用、实际媒体状态、挂载来源和取消配对。
- 所有 Playwright 均 `workers=1`、`trace=on`；本轮未修改业务源码、未提交、未推送。

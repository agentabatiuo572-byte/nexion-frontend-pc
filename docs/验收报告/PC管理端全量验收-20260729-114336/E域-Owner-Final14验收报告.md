# E域 Owner Final14 全量验收报告

## 结论

**通过，允许进入非 Owner 对抗复审。** Final14 已从可见登录入口完整重跑 E1-E6 及锁定 H5 生产构建，未发现产品 P0-P3 缺陷；所有测试写入都已在页面、A2 工单和数据库终态上确认恢复。

初审：**98/100，通过**。复审：**99/100，通过**。

## 锁定候选

- 运行时锁：`bug-pic/.restricted/pc-full-acceptance-20260729-114336/candidate-rebuild-final14/FINAL14-RUNTIME-LOCK.json`
- PC：`http://127.0.0.1:3002`，构建 `0OZ66wYtIYX6qJHhZUvQK`
- 后端：`http://127.0.0.1:8110`，JAR SHA-256 `F54932E72C272E14247439DC32ECC9165FD741E7A25C7E3D60464FB4FACA7399`
- App：`candidate-rebuild-final14/runtime/main/app-h5`，由本地同源 preview gateway 提供；`/api` 同源代理至 8110，不使用显式跨域 API。

## 结果与证据

- PC 无写全域：5/5 通过。真实 MFA 登录、可见 E1-E6 侧栏入口、权威读取、刷新/重新登录、匿名 401、无菜单直链和读写 403、无越权预取，以及 E2/E3 的畸形/404/409/422/500/超时/断网失败关闭与恢复均通过。
- E1/E4/E5/E6：1/1 通过。四个模块各自完成可见入口、权威读取、畸形 200 失败关闭、恢复和匿名 401。
- E3：2/2 通过。canonical 对象锁、同载荷幂等、载荷冲突、第二运营员并发、checker 越权/自审、终态重复和未知结果全部失败关闭；批准后精确恢复原值。
- E6：1/1 通过。maker/checker 分离、拒绝/批准/恢复、pending 写入 409、checker 写入 403、自审 403、终态重放 409、未知工单 403、A2 读取 200、checker A4 403 和精确恢复均通过。
- E6 失败关闭：1/1 通过。匿名 401、500、畸形 200、以及退出前账号后迟到的成功响应，都不会显示 E6 控制项或把旧账号结果带入无菜单账号。
- H5：锁定生产构建连续 **8/8** 首刷+刷新通过（`workers=1`、trace 开启）。每次 `/api/config/platform` 均同源 HTTP 200 且 `h5BaseFactor=0.6`，Vue `#app` 正常挂载，`pageerror=[]`、平台配置 `requestfailed=[]`。

证据根目录：`bug-pic/.restricted/pc-full-acceptance-20260729-114336/E/final14-owner`。

## Final13 H5 缺陷回归

Final13 曾在锁定生产 H5 中捕获一次 `useTickets().bindAccount` 的间歇性页面错误。Final14 更换为新 H5 产物 `index-Vu3c3ZA_.js`（SHA-256 `23E453613AC099401820E05ED5D25D8C57EC1457C066AB24E94C9DD1D69CF173`；候选根和运行时产物哈希一致）。在八次独立测试的首刷与刷新中均未出现 `pageerror` 或请求失败，因此该 hydration 回归门已通过。

## 状态恢复与数据库核对

- 本轮 E3 和 E6 页面写入均通过 checker 批准并执行精确恢复；E6 临时文案的变更、还原工单均为 approved，拒绝探针为 rejected。
- 只读数据库核验：`source_domain='E' AND status='pending'` 为 **0**；最新 E3/E6 工单均是 approved/rejected 终态。
- E6 变更和还原产生 `compute.config_changed` outbox，聚合为 `E6_COMPUTE_CONFIG`，当前状态为 `PENDING`，符合异步投递模型；A2 审计可读取，非授权 checker 的 A4 通道为 403。
- E6 失败关闭首跑曾在 MFA 校验返回一次 401；立即在同一 Final14 锁定候选、稳定 TOTP 时间窗重跑通过，属认证载具边界，不计产品缺陷。

本轮未修改业务源码、未提交、未推送。H5 preview 已停止；`DOMAIN_E_WRITE.lck` 已依照完成条件释放。

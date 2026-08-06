# E域 Owner Final16 全量验收报告

## 结论

**不通过（HOLD）。** Final16 PC/后端锁定候选的 E1-E6 主流程、权限、故障、E3/E6 生命周期和恢复均通过；但 E1 四个权威媒体 URL 在真实首入和刷新验证中不能访问，候选不可放行。

初审：**90/100，未通过**。复审不触发，等待修复后的新候选。

## 锁定候选

- PC `http://127.0.0.1:3002`，Build `WHtnx71HibGEUaMlXb3rk`，PID 7444。
- 后端 `http://127.0.0.1:8110`，PID 22996，JAR SHA-256 `13A103A65FEA04FD8829305160C9496151BC0EB426DEBBACABB533D0DB4752E5`。
- 运行时锁：`bug-pic/.restricted/pc-full-acceptance-20260729-114336/candidate-rebuild-final16/FINAL16-RUNTIME-LOCK.json`。

## P1：E1 权威媒体预签名 URL 已过期

E1 首次从真实 MFA 登录后的可见侧栏进入。权威 `/api/admin/e1/skus` 返回四个 MinIO 媒体 URL，但 URL 都携带 `X-Amz-Date=20260705...` 和 `X-Amz-Expires=900`；在当前 Final16 环境真实 GET 返回 **403**。页面网络仅发生一个 image 请求，未达到四媒体首次进入/刷新均 200 的门槛。

这不是浏览器缓存，也不是对象缺失的证明问题：对象复制完成后，后端仍把历史过期预签名 URL 作为权威 SKU 媒体字段返回。最小修复是后端在读取 E1 SKU 时生成当前隔离 bucket 对象的有效 URL，或提供稳定的受控媒体代理；仅复制 MinIO 对象不能修复该问题。

证据：

- `bug-pic/.restricted/pc-full-acceptance-20260729-114336/E/final16-owner/e1-media-rerun/e1-api-media-candidates.json`
- `.../E/final16-owner/test-results-e1-media-rerun/.../trace.zip`

## 已完成且通过的范围

- E1-E6 可见侧栏、权威读取、刷新、退出重登、匿名边界、无菜单直链/API/写入拒绝、无越权预取：5/5 通过。
- E1/E4/E5/E6 畸形 200 失败关闭与恢复、匿名 401：1/1 通过。
- E2/E3 的畸形/404/409/422/500/超时/断网失败关闭：已通过。
- E3 canonical 对象锁、幂等、CAS、双运营员、checker、自审、未知结果同键重放和精确恢复：先行生命周期 1/1 通过；结果未知独立重跑 1/1 通过。中间一次登录 401 是 TOTP 载具时窗，未计产品缺陷。
- E6 maker/checker、拒绝/批准/恢复、pending/CAS/自审/终态拒绝、A2/A4 权限：1/1 通过；401/500/畸形/跨账号迟到响应失败关闭：1/1 通过。
- 数据库只读复核：E 域 pending 工单为 0；本轮 E6 变更、恢复和拒绝均落在终态，`E6_COMPUTE_CONFIG` outbox 为异步 `PENDING`（30 条累计），没有测试遗留 pending。
- App H5 构建/类型/测试门沿用 Final16 锁中声明的 Final15 不变产物门；本轮 P1 在 PC E1 权威媒体消费处已阻断，因此不以历史 App 结果替代新候选的 E1 媒体放行。

本轮未改业务源码、未提交、未推送。可变 E3/E6 状态已恢复；`DOMAIN_E_WRITE_FINAL16_OWNER.lck` 已释放。

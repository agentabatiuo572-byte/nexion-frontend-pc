# E域 Owner Final13 全量验收报告

## 结论

**HOLD，不能作为发布放行候选。** 初审通过；复审发现 Final13 锁定 H5 生产构建存在一次真实 `pageerror`，虽然该问题随后未能稳定复现，但零运行时错误的验收门槛未满足。E 域写锁继续保留，等待 F 产出新 H5 候选后，从可见登录入口重跑 E1-E6。

## 锁定候选与范围

- 锁：`bug-pic/.restricted/pc-full-acceptance-20260729-114336/candidate-rebuild-final13/FINAL13-RUNTIME-LOCK.json`
- PC：`http://127.0.0.1:3002`（PID 23716，构建 `lqlGobSf9dgLarrRkjFGn`）
- 后端：`http://127.0.0.1:8110`（PID 18752，锁定 JAR SHA-256 `34706D1FC0AD02923AEB6217B405D90FAA47730387266E56D9336BA0564557A7`）
- App：锁定生产产物 `candidate-rebuild-final13/runtime/main/app-h5`；通过同源 Vite preview gateway 访问，`/api` 代理至 8110，未引入显式跨域 API。
- 本轮仅新增受限证据脚本和报告；未改 PC、App 或后端源码，未提交、未推送。

## 初审：98/100，通过

- PC 真实 MFA 登录后，可见侧栏 E1-E6；刷新、重新登录和各页面 canonical 读取均通过。
- E1/E4/E5/E6 对畸形 200 结果失败关闭并可恢复；匿名读取均为 401。
- E2/E3 对畸形、404、409、422、500、超时及网络错误失败关闭并可恢复；无菜单角色的直链、API 和未授权预取均被拒绝。
- E3：同键同载荷幂等返回同一工单；载荷冲突、并发/二次写入、越权审批、自审、终态继续操作均被拒绝；未知结果/畸形结果不触发真实写入，原值保持；变更后精确还原。
- E6：maker/checker 分离、跨域审批/未知工单、pending 写入、checker 写入、自审、终态重复操作均被拒绝；拒绝、批准和还原路径通过，最终配置精确还原。A2 审计读取成功，checker 的 A4 读取为 403。
- E6 500、畸形 200 及跨账号迟到响应都保持失败关闭；迟到的前账号成功响应在退出并换至无 E6 菜单账号后不显示 E6 菜单、URL 或控制项。
- H5 初次生产产物走查：`/api/config/platform` 首刷和刷新均为 HTTP 200，`h5BaseFactor=0.6`，同源 gateway 生效，Vue 正常挂载，且当次无页面错误。
- 数据库只读复核：E 域 `pending_ticket=0`；E6 变更/还原对应 `compute.config_changed` outbox 记录存在，当前为 `PENDING`（20 条 compute 相关待投递记录）；E 工单均已落在 approved/rejected 终态，没有遗留 pending。平台配置接口是 H5 `h5BaseFactor=0.6` 的权威读取路径。

主要初审证据：

- `bug-pic/.restricted/pc-full-acceptance-20260729-114336/E/final13-owner/pc-nowrite`
- `bug-pic/.restricted/pc-full-acceptance-20260729-114336/E/final13-owner/e3-cas`
- `bug-pic/.restricted/pc-full-acceptance-20260729-114336/E/final13-owner/e6-maker-checker`
- `bug-pic/.restricted/pc-full-acceptance-20260729-114336/E/final13-owner/e6-fail-closed/e6-fail-closed-result.json`
- `bug-pic/.restricted/pc-full-acceptance-20260729-114336/E/final13-owner/app-h5/app-e6-production-result.json`

## 复审：89/100，未通过

完整无写入 PC 复跑 5/5、E3 CAS 复跑 2/2、E6 maker/checker 复跑 1/1 均通过。MFA 故障复跑曾在 TOTP 窗口边界出现一次 401，重新取稳定时间窗后 1/1 通过，归类为载具时序而非产品缺陷。

但 H5 正常生产验证的复审中记录到一次真实错误：

```text
TypeError: FR(...).bindAccount is not a function
    at CB (http://127.0.0.1:5175/assets/index-BS4-HusU.js:32:784264)
    at B (http://127.0.0.1:5175/assets/index-BS4-HusU.js:32:812857)
    at http://127.0.0.1:5175/assets/index-BS4-HusU.js:32:813367
```

该次请求仍正确返回平台配置 200 和 `h5BaseFactor=0.6`，但 `pageerror` 不为零，故必须判失败。其后用清空存储、禁用 service worker 的新 context 做了首刷、刷新和新 context 再进入，并连续复跑正常生产验证 5 次，均未再次触发；每次均确认正在服务同一锁定 chunk SHA，排除浏览器旧缓存和外部旧 chunk。问题为间歇性，不可因后续未复现而放行。

根因证据见：`bug-pic/.restricted/pc-full-acceptance-20260729-114336/E/final13-owner/review/h5-bindaccount-root-cause.md`。锁定产物对 `useTickets` 仍是直接 `.bindAccount()` 调用，而当前源码已通过 `bindAccountStore(useTickets, ...)` 做 disposed/partial Pinia store 防护，说明 Final13 H5 构建没有包含该防护。

## 缺陷与后续条件

P1：**Final13 锁定 H5 生产构建的账户作用域 tickets store 存在间歇性 `bindAccount` 运行时异常。** 这会在水合/Pinia setup-store 时序下导致页面错误，违反 H5 正常挂载且零异常的发布条件。

F 的最小修复是从含 `bindAccountStore(useTickets, ...)` 的源码重建 H5，生成新的运行时锁，并证明新产物不再包含 tickets 的直接 `.bindAccount()` 调用。随后 E 域 Owner 必须在新候选中从真实登录入口完整重跑 E1-E6；本报告不能替代该重跑。

协调锁：`DOMAIN_E_WRITE.lck` 依照 HOLD 状态保留，未提前释放。H5 preview 仅用于锁定产物复现和取证，待新候选切换后再清理。

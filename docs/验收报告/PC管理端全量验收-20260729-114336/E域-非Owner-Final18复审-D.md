# E 域非 Owner 对抗复审（Final18 / D）

## 结论

在锁定的 Final18 主运行时，以独立只读、无写权、无菜单、maker、checker 和第二运营员账号，从可见登录页和侧栏完成 E1--E6 复审。所有已执行的业务断言通过，**P0--P3 = 0**；测试产生的 E3/E6 临时变更均精确恢复，验收库没有遗留 E 域 pending 工单或 Final18 测试标记。

| 项目 | 结果 |
| --- | --- |
| 初审 | 99.2 / 100，通过 |
| 复审 | 99.4 / 100，通过（高于 98） |
| P0 / P1 / P2 / P3 | 0 / 0 / 0 / 0 |

## 锁定运行时

- PC：`http://127.0.0.1:3002`，PID `3888`，Build `9mltIBkb8GykArkvwXDY1`。
- 后端：`http://127.0.0.1:8110`，PID `21696`，JAR SHA-256 `77DABEDE10CCA3AD3D82AA506A09A706724679CB703172725BB3C0CBECF85E70`。
- 锁：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\candidate-rebuild-final18\FINAL18-RUNTIME-LOCK.json`。
- 结束复核：PC 根入口 `200`；后端 `/actuator/health` 未认证返回 `401`；Build 与 JAR 哈希均与锁一致。

## E1 媒体：现行预览、过期链接与 Murphy 失败路径

### 实际首入与刷新

只读账号从侧栏进入 E1 `/devices/pricing`，首入并刷新后均观察到四个真实对象：1 个 PNG 与 3 个视频。每个对象首入和刷新至少各有一次实际浏览器请求；PNG 为 `200 image/png`，视频 Range 请求为 `206 video/mp4` 或 `206 video/quicktime`，所有 preview-url 响应为 `200`。

- 真实网络失败：0。
- 页面异常：0。
- 观察到一次视频生命周期 `net::ERR_ABORTED`，同对象在该次刷新中已有替代 `206` 成功响应，未形成展示失败或真实网络错误。

### 禁止使用持久 presign

对四个 SKU 响应注入不可用的“已过期持久 presign”，同时保留真实的认证 preview-url 端点。页面未请求任何注入链接，四个已展示媒体全部来自该次 current preview-url；8 次 preview-url 均为 `200`。该测试没有以临时可用 URL 掩盖现行媒体错误，而是证明持久 URL 即使不可用也不会被挂载。

### preview-url 失败关闭与重试

将每个认证 preview-url 注入 `500` 后，页面展示 4 个“重新加载媒体”按钮、未挂载任何图片或视频，也未产生真实媒体请求失败。移除故障注入并点击重试后，四个媒体恢复，页面异常仍为 0。

证据：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\E\final18-nonowner-d\e1-media`。

## E1--E6 权限、刷新与重登

`e-domain-permission-fixtures-20260728.spec.ts` 按角色拆分执行 **3 / 3 通过**：

- 只读账号：E1--E6 菜单、路由和读态可用；所有写按钮与写接口拒绝；刷新、登出及 MFA 重登后边界不漂移。
- 同菜单无写权账号：可见读态，但业务写入持续关闭。
- 无菜单账号：E 侧栏、直达路由、读写接口和控件均无法恢复。

证据：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\E\final18-nonowner-d\permission` 与 `test-results-permission-*`。

## E3：对象锁、CAS、幂等与结果未知

`e-domain-nonowner-d-20260728.spec.ts` **2 / 2 通过**。

- 同 command key 同载荷为 `200` 且 operation id 不变；同 key 改载荷为 `409`。
- 第二运营员直写 `409`，checker 直写 `403`，pending 直写 `409`，maker 自审 `403`，终态重放 `409`。
- A2 审计入口为 `200`；checker 访问 A4 为 `403`；未知结果保留输入并重用命令键，未触碰真实配置。
- 变更后由独立 checker 处理，`capacitySubsidyDays` 从 `30` 临时变为 `31` 后精确恢复为 `30`。

证据：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\E\final18-nonowner-d\e3-cas\e006-result.json`。

## E6：双人分权、失败关闭、App 合同与 outbox

maker/checker 用例 **1 / 1 通过**：拒绝探针无副作用；pending 时 maker 与第二运营员均为 `409`、checker 为 `403`、maker 自审为 `403`；A2 审批成功；终态重放 `409` 且没有重复副作用；双语临时文案已恢复。checker 的 A4 访问为 `403`，同时 App 公共配置投影可读，未将后台写权限跨域泄露给 App。

E6 Murphy 失败关闭 **1 / 1 通过**：匿名读取 `401`；注入 `500` 与畸形 `200` 时写控件消失且显示可恢复的读取失败；账号切换后，旧账号迟到 `200` 不会把 E6 路由或控件泄露给无菜单账号。

证据：

- `D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\E\final18-nonowner-d\e6-maker-checker\result.json`
- `D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\E\final18-nonowner-d\e6-failclosed\e6-fail-closed-result.json`

## 精确清理与数据库复核

实际主验收库 `nexion_acceptance_20260729_114336` 的只读查询结果：

| 检查 | 结果 |
| --- | ---: |
| E/E3/E6 pending 审批工单 | 0 |
| 实时 E6 配置中的 Final18 测试标记 | 0 |
| 本轮 E3/E6 工单终态 | approved 4，rejected 1 |
| 本轮 E6 `compute.config_changed` outbox | PENDING 2 |

最后一项是已批准“变更/精确恢复”留下的异步派发记录，不是 pending 审批工单；实时配置已回读为原值。所有 Playwright 上下文、路由故障注入和临时业务状态已在用例结束时释放或恢复；未修改产品源码、未提交代码。

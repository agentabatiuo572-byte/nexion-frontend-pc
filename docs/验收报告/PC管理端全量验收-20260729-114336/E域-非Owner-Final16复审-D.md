# E 域非 Owner 对抗复审（Final16 / D）

## 结论

本轮在锁定的 Final16 主运行时完成 E1--E6 非 Owner 全链路复审。E1 的四个首入媒体对象及刷新后的实际 GET 均为 `200`，媒体类型正确，页面错误和浏览器请求失败均为 `0`；E1--E6 五层权限、E3/E6 的命令幂等与对象锁、失败关闭、刷新重登、独立 maker/checker、A2 审批和 App 公共投影均通过。产生的 E3/E6 临时配置均已精确恢复，主验收库没有遗留 E 域 pending 工单或测试标记。

但全量审查已登记“过期 presign 仍可访问”的活跃 **P1**，因此本报告不宣告 Final16 E 域的 P0--P3 为零，也不通过复审；必须在该 P1 修复后，以本报告的同一锁和入口重跑相关媒体链路并复核。

| 项目 | 结果 |
| --- | --- |
| 初审 | 97.2 / 100，超过 96，已通过 |
| 复审 | 97.4 / 100，未达到 98；原因是活跃 P1 未关闭 |
| P0 | 0 |
| P1 | 1（全量审查已登记的 stale presign，待修复复验） |
| P2 / P3 | 0 / 0 |

## 锁与执行边界

- PC：`http://127.0.0.1:3002`，PID `7444`，Build `WHtnx71HibGEUaMlXb3rk`。
- 后端：`http://127.0.0.1:8110`，PID `22996`，JAR SHA-256 `13A103A65FEA04FD8829305160C9496151BC0EB426DEBBACABB533D0DB4752E5`。
- 锁文件：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\candidate-rebuild-final16\FINAL16-RUNTIME-LOCK.json`；后端按锁复用 Final15 的同哈希 JAR。
- 仅使用锁定的独立验收账号和锁内对象；未提交代码、未扩展生产性写入范围。

## E1：四媒体首入、刷新与真实对象请求

从登录侧栏进入 E1 `/devices/pricing`，等待视频 `loadedmetadata` 后刷新，再以浏览器会话实际请求四个首入对象：

| 阶段 | 对象数 | GET 200 | Content-Type | pageerror | requestfailed |
| --- | ---: | ---: | --- | ---: | ---: |
| 首入 | 4 | 4 / 4 | `video/mp4`、`video/quicktime`、`image/png` | 0 | 0 |
| 刷新 | 4 | 4 / 4 | `video/mp4`、`video/quicktime`、`image/png` | 0 | 0 |

刷新会产生新的签名参数，这是正常的 presign 行为；八次请求的 MinIO 对象 pathname 与锁定的四个对象一一一致。本项证明“当前有效签名下的可展示性”，不替代上文已登记的过期签名 P1 复验。

证据：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\E\final16-nonowner-d\e1-media\e1-media-first-entry-refresh.json`，Playwright `final16-e1-media`。

## E1--E6：权限、刷新重登与拒绝面

`e-domain-permission-fixtures-20260728.spec.ts`：**3 / 3 通过**。

- 只读账号：E1--E6 侧栏与路由可见，读取可用，写按钮/写接口不可越权；刷新、退出并重新 MFA 登录后仍保持同一授权边界。
- 同菜单无写权账号：入口与读态存在，所有写能力保持关闭。
- 无菜单账号：E 侧栏、直达路由与业务控件全部拒绝。

证据：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\E\final16-nonowner-d\permission` 和 `test-results-permission`。

## E3：CAS、幂等、结果未知与精确恢复

`e-domain-nonowner-d-20260728.spec.ts`：**2 / 2 通过**。

- 同 command key 同载荷返回 `200` 且保持同一 operation id；同 key 异载荷为 `409`。
- 第二运营员直写 `409`、checker 直写 `403`、pending 时直写 `409`、maker 自审 `403`、终态重放 `409`。
- A2 审批审计 `200`；checker 访问 A4 `403`。结果未知时弹窗保留输入、复用命令键，真实配置不变。
- 以独立 checker 完成变更及恢复，原值 `30` 最终精确恢复。

证据：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\E\final16-nonowner-d\e3-cas\e006-result.json`。

## E6：maker/checker、失败关闭与 App 合同

maker/checker 用例 **1 / 1 通过**：独立上下文的 maker 提案、拒绝探针无副作用、A2 checker 审批和终态重放 `409` 均符合预期；pending 写入分别为 maker `409`、第二运营员 `409`、checker `403`、maker 自审 `403`。双语临时文案在审批后被恢复为原值。checker 业务写入 A4 为 `403`，同时验证 App 公共配置投影可读取，跨域/App 合同未出现越权泄露。

失败关闭用例 **1 / 1 通过**：匿名读取 `401`；注入 `500` 与畸形 `200` 时 E6 显示读取失败且所有写控件隐藏；旧账号的迟到 `200` 响应在切换无菜单账号后不泄露 E6 路由或控件。

证据：

- `D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\E\final16-nonowner-d\e6-maker-checker\result.json`
- `D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\E\final16-nonowner-d\e6-failclosed\e6-fail-closed-result.json`

## 清理与数据库复核

对实际运行的 `nexion_acceptance_20260729_114336` 验收库读取复核：

| 检查 | 结果 |
| --- | ---: |
| E/E3/E6 pending 工单 | 0 |
| 实时 E6 配置中的 Final16 测试标记 | 0 |
| 本轮 E3/E6 工单终态 | approved 4，rejected 1 |
| 本轮 E6 `compute.config_changed` outbox | PENDING 4 |

`PENDING 4` 为已审批的配置变更与精确恢复所产生的异步派发记录，不是 pending 审批工单；配置值已回读为原值。Playwright 上下文在各用例结束时已关闭，未保留浏览器会话或临时业务状态。

# C 域 Owner 初审报告（Final13）

Run ID：`pc-full-acceptance-20260729-114336`  
候选：`Final13`；PC `http://127.0.0.1:3002`；后端 `http://127.0.0.1:8110`；隔离库 `nexion_acceptance_20260729_114336`。  
范围：C1–C6。结论：**初审通过，97/100**。

## 运行时、真实入口与原始证据

- 锁文件：`candidate-rebuild-final13/FINAL13-RUNTIME-LOCK.json`；PC Build `lqlGobSf9dgLarrRkjFGn`；后端 JAR SHA-256 `34706D1FC0AD02923AEB6217B405D90FAA47730387266E56D9336BA0564557A7`；`mfaBypass=false`。
- 执行器：真实 Chromium/Playwright，`workers=1 --trace=on`。maker、独立 checker、只读/无菜单角色均从登录页账号密码与正常 MFA 开始；C1–C6 均从可见「用户与账户」侧栏点击进入，并逐页刷新、截图、退出重登复核。
- 原始脚本、截图、trace、失败视频和 JSON 位于 `D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\C\final13-owner\`。

## 通过证据

- C1–C6：首次登录后六个菜单可见、逐项可打开且刷新后标题保持；maker 登出后重新 normal-MFA 登录，六个页面仍可见。
- 五层权限：匿名六个读取接口均 `401`；无菜单角色无 C 菜单、直接到各路由无模块标题、六个读取接口均 `403`，退出并 normal-MFA 重登后仍全部 `403`；有菜单但无写权角色的 C3 写入 `403`。
- 失败关闭：缺 `Idempotency-Key` 为 `400`，非法 C5 KYC 复核动作 `422`，不存在用户 `404`；C4 畸形 HTTP 200、C5 注入 500、C6 timeout/断网均显示失败态并冻结危险入口，未把非可信数据当成功。

## C3 修复后全生命周期

测试对象为隔离用户 `990000151023`。

1. maker 正常 MFA 后以 `USDT DEBIT 0.01` 创建 `ADJ-A8573F178D654F5F`，状态机为 `PENDING_REVIEW`；同键重放 `200`，同键异载荷 `409`。
2. maker 对自己的调整 approve 返回 `403`。
3. 独立精确 checker（仅 C3 菜单与 `user_c3_adjust_approve/reverse`）approve 返回 `200`；DB 记录 `maker=ffix.cm.final7.e5a56c2fd0`、`checker=ffix.c3c.final7.42c933a78c`，状态 `APPROVED`，账本 `395152`。
4. 两个并发相同 key reverse 结果为 `[409 IDEMPOTENCY_REQUEST_IN_PROGRESS, 200]`，表明仅一笔反向分录可成功；原 key 随后重试 `200`，异载荷 `409`。这符合结果未知/进行中安全收敛，而非重复记账。
5. 反向单 `ADJ-BAC69BF23CA7487F` 为 `USDT CREDIT 0.01`、关联原调整、账本 `395153`；钱包恢复为 USDT `100.000000`、NEX `500.000000`，无 PENDING/PENDING_REVIEW 调整及 Final13 mutex 残留。

## DB、A2、A4/outbox 与关联域

- A2：`C3_ASSET_ADJUSTMENT_CREATED`（maker）、`APPROVED`（独立 checker）、`REVERSED`（checker）均存在。并发进行中与异载荷拒绝均以 `REVERSAL_FAILED/REJECTED` 留痕，未产生第二笔反向账。
- A4/outbox：原调整及反向调整各有 `admin.balance_adjusted`，两笔账本各有 `admin.bill_adjusted`，4 条均为 `PUBLISHED`。
- D4/钱包关联：两条账本 `395152/395153` 与原/反向调整一一对应；恢复后钱包值精确回到基线。锁中的 App 候选已通过 `57 files / 265 tests`、type-check、H5 build 门禁；本轮 C3 写后立即逆向恢复，不保留可对 App 用户态产生持续影响的余额。

## 命令、退出码和统计

| 命令 | 退出码 | 结果 |
|---|---:|---|
| `npx playwright test -c ...C/final13-owner/playwright.config.ts --workers=1 --trace=on` | `0` | C1–C6 可见路径、刷新/重登、权限、C3 maker/checker/CAS/幂等/恢复、失败关闭通过 |
| MySQL 隔离库钱包/调整/A2/outbox/mutex 查询 | `0` | DB、审计、发布和精确恢复通过 |

- 硬错误计数：`0`；页面 `pageerror`：`0`；非故障注入 admin 5xx：`0`。
- 并发 `409 IDEMPOTENCY_REQUEST_IN_PROGRESS` 是受测的安全中间态；同 key 后续真实重试 `200`，不计硬错误。
- 初审评分：**97/100（>96，初审通过）**。扣 3 分：本轮对关联 App 仅以锁定 H5 门禁和恢复后无残留为交叉证据，未保留一个独立 App 真机余额刷新录像；复审应补该观察点并以墨菲路径重新评估。

## 后续

已释放 C 域写锁，未修改产品源码、共享台账或候选构建，未提交或推送。应由非 Owner 以相同 Final13 锁进行复审，重点攻击 C3 in-progress 同键重试、checker 权限漂移、反向分录的账本/outbox 一致性以及 App 恢复后的余额投影。

# G 域 Owner 初审报告（Final12）

- Run ID：`pc-full-acceptance-20260729-114336`
- 范围：`G1–G4、G7`；范围真源为 `lib/nav/console-nav.ts`（五个可见侧栏入口）。
- 候选锁：`candidate-rebuild-final12/FINAL12-RUNTIME-LOCK.json`，PC Build `ABZKW7393ECWjhkaA_btM`（`3002`），后端 JAR `2A3E…83DD2`（`8110`），App 为 `D:\workspace\.acceptance\pc-full-acceptance-20260729-114336-app-master`。
- 结论：**HOLD，不通过，不能签发 >96 分。** Final12 App 对 G-FINAL11-005/006/007 的并发与账户切换修复回归为红；其中 G005/G007 可使旧请求或旧读覆盖当前投影/已成功命令，按跨账户金融持仓与钱包展示风险登记为 P1。

## 已完成的真实验收

- Playwright Chromium（`workers=1 --trace=on`）：Final12 maker 的真实 MFA 登录通过；G readonly、nowrite、nomenu 三角色从登录页完成 G1/G2/G3/G4/G7 的可见侧栏、刷新、重登、菜单/路由/API/按钮/数据五层失败关闭，`3/3` 通过。该次匿名载具因全局 `ADMIN_AUTH_EPOCH_CHANGED` 抛出而未完成；不用它冒充匿名结果。
- 独立无会话 HTTP 核对：5 个管理 G 读端点均 `401`；5 个 App 公共投影无可信边缘均 `503`、受控 `X-Nexion-Edge-Country: JP` 均 `200`；4 个用户命令读取匿名均 `401`。
- G1–G4/G7 静态闭环合同：`node --test tests/g1-staking-closure-contract.test.mjs tests/g2-exchange-closure-contract.test.mjs tests/g3-market-closure-contract.test.mjs tests/g4-genesis-closure-contract.test.mjs tests/g7-repurchase-closure-contract.test.mjs`，退出码 `0`，`23/23` 通过。
- App 原生门禁：`npm.cmd test`，退出码 `0`，`57 files / 259 tests` 通过。该门禁没有覆盖本报告的乱序、账户边界和 command-vs-read 栅栏。

## 阻断缺陷

### G-FINAL12-001（P1）：G005/G007 乱序请求及命令后旧读会回写当前投影

在锁定 App 上执行 Final11 对抗矩阵（`workers=1`）的退出码为 `1`，断言仅 `3/12` 通过。失败项：

- `g005PoolLatestWins=false`：先发的池配置请求在后发请求已完成后仍能覆盖新池。
- G007 的 pool/position/repurchase 三组账户边界与 finally 保护均失败；旧账户请求可在 `bindAccount()` 后继续写回，旧 finally 也会提前清除当前 loading。
- `commandReadBarrierProtectsStaking=false` 与 `commandReadBarrierProtectsOrdersButPublishesConfig=false`：成功命令的权威回执可被并发旧 read 回写。

根因与源码一致：`staking.ts` 的 fetch 在 `finally` 无请求代次/账户 epoch 栅栏（48–58、65–75 行），`repurchase.ts` 以 `Promise.all` 后整体赋值/失败整体清空（38–55 行），均未保护跨请求乱序。

### G-FINAL12-002（P2）：G006 部分成功被整体失败清空

`g006ConfigPublishesOnOrdersFailure=false`、`g006OrdersPublishOnConfigFailure=false`。config 或 orders 任一失败时，另一端已经取得的 server-canonical 成功事实被清空；运维端会把“结果已知的一半”误呈现为不可用。该缺陷不直接产生资金写入，但会误导 G7 复投可用性和后续操作。

## 修复实施与修复前复验

- 修复范围仅为锁定 App 根 `src/store/staking.ts`、`src/store/repurchase.ts` 与新增的对抗回归测试 `tests/g-final12-g005-g007-evidence.test.ts`；未修改 PC 产品代码、后端、共享台账或运行中服务。
- 最小根因修复：G1 以账户 epoch、pool read generation、position read generation 和 command generation 分别保护投影、错误和 loading；账号切换/登出同步失效旧代次，命令成功将既有 position read 失效后才发布 server receipt。G7 对 config 与 orders 采用独立 resource generation：任一成功立即发布，另一资源失败只清自身；订单命令成功只使旧 orders read 失效，不阻断同轮合法 config 发布。
- TDD：新增 12 项动态矩阵先在锁定 App 上稳定 RED（首个断言为旧 pool 覆盖最新 pool，和 G-FINAL12-001 一致），再实施最小代次栅栏至 GREEN。最终矩阵 `12/12`：乱序 pool、两类部分成功、A→B/登出旧响应和 finally、两类新响应、staking command-vs-read、repurchase command-vs-read/config 均通过。
- 最终验证：动态矩阵 `vitest` 退出 `0`；App 全量 `npm.cmd test` 为 `57 files / 265 tests` 通过；`npm.cmd run type-check` 退出 `0`；`npm.cmd run build:h5` 退出 `0`；将 `NEXION_APP_ROOT` 显式指向锁定 App 根后的 PC G1/G2/G3/G4/G7 合同为 `23/23` 通过。未以 last-write-wins、全局清空或隐藏错误处理竞态。
- 受限修复证据：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\G\final12-product-repair-h\g005-g007-matrix-actual.json`，SHA-256 `E33E1FF85CC1A8031C6D6DAC0709AEFF15DB274144E7F507C5BB36338CDD3A7C`。该文件记录锁定 App 根与 `12/12` 矩阵。候选重建、真实入口整域重跑和非 Owner 对抗复审仍由主控后续执行；本段不替代 Owner 验收结论。

## 证据、清理与评分

- 运行锁 SHA-256：`A51033B0892F3625941D2C4D2015DCD5800AD05812EFB453CA495F44177C2142`。
- G005–G007 实测 JSON：`G/final12-owner/g005-g007-rerun.json`，SHA-256 `47F19DD6FD6EF82AB7E4221BBB8FF2B44F8628B91B5021E2C6224CA89483F0D5`。
- 真实浏览器 trace（MFA/可见入口走查）：`G/final12-owner/browser-maker-final12-playwright-output/.../trace.zip`，SHA-256 `B86A94603D54D035587B63A75B141C505EC3811CA41D3EF85E99620A88B9F558`；权限三角色 trace SHA-256 `A6A4442B35876C43848A81EE5D017C57715049DBF7AE202E83842065BD2786CA`。
- 硬错误计数：产品 `P1=1、P2=1、P0=0、P3=0`；验收载具错误 `2`（旧 MFA listener 在等待新 TOTP 前建立而超时、匿名页的 auth epoch 拦截），均保留原始 trace，未计为产品通过。
- 未修改候选源码、共享台账或服务；所有尝试写均为预期 `401/403/4xx` 负向探针。最终 `nx_audit_object_lock(target_domain='G')=0`，`3002/8110` 仍由锁定 PID `24088/29564` 监听。
- 领域初审：**不通过（88.0/100）**，低于签发门槛；执行质量自评初审 `98.0/100`、复审 `98.0/100`。修复后必须从登录和可见侧栏完整重跑 G1–G4/G7，再进行非 Owner 对抗复审。

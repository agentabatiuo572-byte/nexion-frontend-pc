# B 域 Owner 初审报告（Final12）

Run ID：`pc-full-acceptance-20260729-114336`  
候选：`Final12`；PC `http://127.0.0.1:3002`；后端 `http://127.0.0.1:8110`；隔离库 `nexion_acceptance_20260729_114336`。  
范围：B1 双账本总览、B2 资金池水位、B3 转化漏斗、B4 节奏状态、B5 风险雷达。  
结论：**通过（PASS）**。Owner 初审未发现开放缺陷；本报告只签发 B 域 Owner 初审，仍须由非 Owner 按锁定方法进行独立墨菲复审。

## 锁定环境、入口与方法

- 唯一运行时锁：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\candidate-rebuild-final12\FINAL12-RUNTIME-LOCK.json`，SHA-256 `A51033B0892F3625941D2C4D2015DCD5800AD05812EFB453CA495F44177C2142`。
- 已核对锁内 Final12 指纹：PC Build ID `ABZKW7393ECWjhkaA_btM`、后端 JAR SHA-256 `2A3EEC48ACCE273CFDEA32AAA2D0ADC69CC7F9EA07B66126BDC42D5482083DD2`、PC PID `24088`、后端 PID `29564`、`mfaBypass=false`。
- 使用真实 Chromium / Playwright，全部 `workers=1 --trace=on`；测试账号从登录页输入账号、密码和正常 MFA 后，依次通过可见「运营总览」侧栏点击 B1–B5。未以隐藏 URL、mock 登录、DOM 注入或 localStorage 充当权威态。
- 已按 `页面业务逻辑通顺性验收方法.md` 执行可见入口、刷新/返回/退出重登、五层权限、异常失败关闭与数据闭环；导航依据 `lib/nav/console-nav.ts`，PRD/更新日志的 B 域重点为 B1 红线、B2 D3 资金事实、B3 A4 漏斗、B4/H1 与 B5/J1 同源边界。

## 真实用户走查与业务结果

- 正常 MFA 的 checker 从登录页和可见侧栏逐一进入 B1–B5，五页标题、数据与页面证据均可见；刷新、返回、退出后重新 MFA 登录仍可用。对应 trace：`B/final12-owner/visible-a-checker/artifacts/...B1-B5-从登录页.../trace.zip`，SHA-256 `A1544CCA6E0B56B76D8A9D6BBBE38B39768AC74677B55F46CA0039F33DAE530F`。
- B1 真实 0% 覆盖率基线为储备 `0`、负债 `886806.15`、覆盖率 `0`；页面只显示红线和失败关闭建议，未触发共享闸门或资金写入。
- B2 D3 预测配置由两个独立运营员真实并发：一方 `409 D3_FORECAST_CONFIG_VERSION_CONFLICT`，一方 `200`；同键回放 `200`，异载荷复用 `409 IDEMPOTENCY_KEY_PAYLOAD_MISMATCH`。客户端结果未知时服务端只落一次，使用同一键恢复得到与服务端结果一致的 `200`。
- B3 保存视图首写与同键重放均为 `200`，异载荷为 `409 IDEMPOTENCY_KEY_PAYLOAD_MISMATCH`；B2/B3 的写入均在 B 域写锁下进行并精确恢复。
- B5 SSE 在首次进入、刷新、退出重登均为 `200`；主动断线后页面保留权威 GET 快照并显示可见重连提示，没有把旧流数据伪装为新权威态。

## 权限、异常与跨域

- 三类受限角色完整覆盖 B1–B5 五层：有读无写角色可见菜单/路由/数据，但按钮不可写且直调写接口 `403`；无写角色在刷新/重登后仍被拒绝；无菜单角色无侧栏、无页面标题且读写接口均 `403`。B5 无菜单角色快照与 SSE 流均为 `403`。
- 匿名读取为 `401`；非法路由/参数按契约安全失败（含 `404`、`422`）；写入并发/幂等冲突为 `409`；注入畸形 HTTP 200、500、timeout/断网时，B1–B5 都显示失败关闭态，无静默成功或陈旧敏感数据泄漏。
- B1/B2/B5 的储备、负债、覆盖率一致为 `0 / 886806.15 / 0`；B4 与 H1 的节奏表盘均为 `8` 项，B5 与 J1 的风险门均为 `5` 项，证明读取到同一权威快照而非前端拼装。
- App 关联边界：在指定 App 候选根执行 `npm.cmd test -- --run src/api/quest-api.test.ts`，`3/3` 通过，验证 H1 节奏快照的字段解析与来源契约。Vitest 输出有一条开发 WebSocket 端口占用告警，但命令退出 `0`，不影响该无浏览器单测的通过结论。

## 数据、审计、outbox 与恢复

- B2/B3 可写用例使用 `DOMAIN_B_WRITE.lck`（Owner：`/root/final12_owner_b`），执行前快照 `treasury.d3.forecast-config` 和 B3 保存视图；测试脚本结果为 `configRestoredExactly=true`、`remainingViews=0`、`retainedAuditAndOutbox=true`。
- 数据库实查退出 `0`：`nx_admin_funnel_view` 中本次 marker 行为 `0`，`treasury.d3.forecast-config` 保留预期的单条配置记录 `1`。A2 审计 `2` 条、A4/outbox `2` 条、成功幂等记录 `3` 条均作为不可逆业务证据保留。
- 写入证据未包含账号、密码、MFA 密钥或令牌；Final12 兼容运行时清单仅用于将既有 B 可写脚本绑定到本轮锁定 Build/JAR/PID。

## 命令、退出码与证据

| 命令（均在锁定候选上执行） | 退出码 | 结果 |
|---|---:|---|
| `node --test tests/b1-dual-ledger-acceptance-contract.test.mjs tests/b2-liquidity-acceptance-contract.test.mjs tests/b3-funnel-closure-contract.test.mjs tests/b4-rhythm-closure-contract.test.mjs tests/b5-risk-radar-contract.test.mjs tests/b23-outcome-unknown-contract.test.mjs tests/b34-overview-runtime-contract.test.mjs tests/b-domain-owner-carrier-contract.test.mjs tests/b4-cross-repo-sentinel-contract.test.mjs` | `0` | B1–B5、未知结果、B4/H1 与写锁契约 `34/34` 通过 |
| `npx playwright test tests/e2e/b-final10-main-write.spec.ts --project=chromium --workers=1 --trace=on` | `0` | B2 CAS/幂等/未知结果与 B3 保存闭环、A2/A4/outbox、精确恢复通过 |
| `npx playwright test tests/e2e/b-domain-permission-fixtures-20260728.spec.ts --project=chromium --workers=1 --trace=on` | `0` | 三类角色五层权限 `3/3` 通过 |
| `npx playwright test tests/e2e/b-domain-owner-20260728.spec.ts --project=chromium --workers=1 --trace=on --grep '从登录页|B5 SSE 首次|B1 在真实|匿名读取'` | `0` | 首次用户、刷新/重登、SSE、0% 红线及匿名/非法参数 `4/4` 通过 |
| 同脚本 `--grep '跨域快照同源'` | `0` | B1/B2/B5、B4/H1、B5/J1 同源 `1/1` 通过 |
| 同脚本 `--grep '畸形 200、500 与网络超时'` | `0` | B1–B5 fail-closed `1/1` 通过 |
| 同脚本 `--grep 'B5 SSE 无菜单'` | `0` | B5 快照/SSE 双 `403`，`1/1` 通过 |
| App：`npm.cmd test -- --run src/api/quest-api.test.ts` | `0` | H1 节奏快照解析 `3/3` 通过 |

关键原始证据（SHA-256）：

- `B/final12-owner/b-static-contracts.log`：`DC33DF19305F43BA6DB6435B9A45409E7976B9715B140F51A5ADF922C76EAA7B`。
- `B/final12-owner/main-write/b-final10-main-write-final12-b1b5.json`：`EC249B1271D395C96D5CD49D704FAD6E00BEAA0A46C796DED62F4A675E644AAC`。
- `B/final12-owner/visible-a-checker/browser/b1-zero-coverage-fail-closed.json`：`AE35A2E718195010911EE91B79940362A6FF9BF3C60A943668932693CC2C1794`。
- `B/final12-owner/visible-a-checker/browser/B5-sse-authority-boundary.json`：`29E25A129EB788F8CD58EAC9948BA04BED5272A28754439C564A822849D23781`。
- `B/final12-owner/cross/browser/cross-domain-authoritative-check.json`：`B17A416DF726F3C85DBBAF124FB56BA5445416907DAC736D4BAC0D2D9918CD0B`。
- `B/final12-owner/b5-forbidden/browser/B5-sse-forbidden-boundary.json`：`C091707ADCD3FA7832FAFBF6174EE4CC4BCE717636623F87A27BCDF8120C9BCB`。
- `B/final12-owner/failure-closure/artifacts/b-domain-owner-20260728-B1-B5-对畸形-200、500-与网络超时全部失败关闭-chromium/trace.zip`：`7F625BEDB97520E1CD8FCEAC87C244A1A8DCAD204BAD79F22331A8D5A132F9F1`；权限 traces 位于 `B/final12-owner/permissions/artifacts/`。
- `B/final12-owner/app-cross-h1-vitest.log`：`38F25E470820F92A3FA6E30C2BD7BB3F530D94C3F1173427BEF76D58A1C82F54`。

## 初审评分与交接

- P0/P1/P2/P3：`0/0/0/0`；开放硬错误：`0`；页面 `pageerror`：`0`；未归因 admin `5xx`：`0`。
- 初审评分：**98.5/100，通过（高于 >96 门槛）**。扣分仅为 Owner 初审尚不能替代独立复审。
- 写锁已释放，恢复标记已写回 `coordination/locks/DOMAIN_B_WRITE.lck`；未修改产品源代码、共享台账或 Git。
- 交接要求：非 Owner 必须从登录页重跑 B1–B5 全范围，并以墨菲视角复核 RBAC、401/403/404/409/422/500、超时/畸形 200、SSE 断线、双人 CAS/幂等/未知结果、DB/A2/A4/outbox 与 B4/H1、B5/J1、App/H1 契约。

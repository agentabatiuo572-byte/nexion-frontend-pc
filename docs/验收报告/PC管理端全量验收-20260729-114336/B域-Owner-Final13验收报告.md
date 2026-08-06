# B 域 Owner 初审报告（Final13）

## 运行与验收边界

- Run ID：`pc-full-acceptance-20260729-114336`；候选锁：[FINAL13-RUNTIME-LOCK.json](D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\candidate-rebuild-final13\FINAL13-RUNTIME-LOCK.json)。
- 主运行时：PC `http://127.0.0.1:3002`、后端 `http://127.0.0.1:8110`、隔离库 `nexion_acceptance_20260729_114336`；服务首页实际包含锁定 build `lqlGobSf9dgLarrRkjFGn`，锁定后端 JAR SHA-256 为 `34706D1FC0AD02923AEB6217B405D90FAA47730387266E56D9336BA0564557A7`。
- 范围：B1 双账本、B2 资金池水位、B3 转化漏斗、B4 节奏状态、B5 风险雷达，以及 B4/H1、B5/J1、B1/D3、A2/A4/outbox、App/H1 牵连链路。
- 真实交互：Chromium / Playwright、`workers=1 --trace=on`；从登录页输入锁定 fixture 账号、密码和 MFA，再经可见「运营总览」侧栏进入 B1–B5。未以隐藏 URL、mock 登录、DOM/localStorage 作为权威态。
- 写前快照/恢复：B2 forecast config 与 B3 saved view 写前快照，写后精确恢复；最终 `configRestoredExactly=true`、`remainingViews=0`。没有 B4/H1、B5/J1 或 App 配置写入。

## 初审结论：通过

**98.5 / 100，通过（高于 96 分门槛）。** 本轮不继承 Final12 结论：已在 Final13 锁定运行时重跑 B1–B5 的真实用户主链、刷新/返回/重登、五层权限、异常矩阵、B2/B3 CAS/幂等/结果未知、数据库/A2/A4/outbox、B4/H1、B5/J1 和 App/H1 契约。未发现开放 P0/P1/P2/P3 产品缺陷。

## 闭环结果

| 范围 | Final13 实跑结果 |
|---|---|
| B1–B5 首次用户路径 | 从登录页打开可见侧栏，逐页进入、读取、刷新；B5 返回 B4 后路由正常；退出后重新 MFA 登录并再次逐页验证通过。 |
| B1 | 真实基线为储备 `0`、负债 `886806.15`、覆盖率 `0`；页面展示红线和「仅建议、不自动执行」的失败关闭语义，未造成共享闸门或资金写入。 |
| B2 / B3 写闭环 | 两名独立运营员并发 B2 为一方 `200`、一方 `409 D3_FORECAST_CONFIG_VERSION_CONFLICT`；同键重放 `200`、异载荷复用 `409 IDEMPOTENCY_KEY_PAYLOAD_MISMATCH`；客户端结果未知后以原同键恢复仍为一次真实提交。B3 保存视图首写/重放 `200`、异载荷 `409`。 |
| 权限五层 | readonly、nowrite：B1–B5 菜单、路由、读接口可用，按钮与直调写接口均 `403`，刷新/重登后仍成立；nomenu：无 B 菜单，直接路由及读/写均拒绝。B5 快照和 SSE 流对 nomenu 均 `403`。 |
| 故障矩阵 | B1–B5 对畸形 HTTP 200、500、超时/断网均显示失败关闭，未把陈旧数据或失败响应伪装为成功；B5 主 SSE 首次、刷新、重登均 `200`，断线时保留权威 GET 快照并给出可见重连提示。 |
| 跨域 | B1/B2/B5 的储备、负债、覆盖率一致；B4/H1 均为 8 个节奏表盘；B5/J1 均为 5 项风险门。 |
| 数据/A2/A4 | 本次 B2/B3 marker：审计 `2`、outbox `2`、成功幂等记录 `3`、临时保存视图写入时 `1`；清理后保存视图 `0`，配置快照精确恢复。 |
| App/H1 | 锁定 App 候选根运行 `quest-api.test.ts`，H1 节奏快照字段解析 `3/3` 通过。 |

## 命令与退出码

| 命令 | 退出码 | 结果 |
|---|---:|---|
| B1–B5 静态/契约集合 | 0 | `34/34` 通过。 |
| `b-domain-owner-20260728.spec.ts` | 0 | 主链、刷新/重登、B5 SSE、B1 红线、匿名/非法参数、畸形 200/500/超时：`5 passed, 2 skipped`；两个角色专用边界随后独立执行。 |
| `b-domain-permission-fixtures-20260728.spec.ts` | 0 | readonly、nowrite、nomenu：`3/3` 通过。 |
| `b-final10-main-write.spec.ts`（Final13 runtime lock） | 0 | B2 CAS/幂等/未知结果、B3 保存闭环、DB/A2/A4/outbox 和精确恢复：`1/1` 通过。 |
| B5 SSE nomenu 专用用例 | 0 | 快照和 SSE 双 `403`：`1/1` 通过。 |
| B4/H1、B5/J1 跨域专用用例 | 0 | `1/1` 通过。 |
| App：`npm.cmd test -- --run src/api/quest-api.test.ts` | 0 | `3/3` 通过；仅有开发 WebSocket 端口占用告警。 |
| `npx tsc --noEmit` | 0 | 载具类型校验通过。 |

## 关键原始证据

- `B/final13-owner/b-static-contracts.log` — `A8A70EB881826904D0ED8F1A1E3E1AB63C9C1C84361E2C45E5703C0E13247B50`
- `B/final13-owner/main-write/b-final10-main-write-final13-b-owner-rerun.json` — `7D55E57C7F57A1E636A5A17C5E968D14150E395F6ED15DCA1B6625C456B570DE`
- `B/final13-owner/owner/b1-zero-coverage-fail-closed.json` — `AE35A2E718195010911EE91B79940362A6FF9BF3C60A943668932693CC2C1794`
- `B/final13-owner/owner/B5-sse-authority-boundary.json` — `29E25A129EB788F8CD58EAC9948BA04BED5272A28754439C564A822849D23781`
- `B/final13-owner/b5-forbidden/B5-sse-forbidden-boundary.json` — `C091707ADCD3FA7832FAFBF6174EE4CC4BCE717636623F87A27BCDF8120C9BCB`
- `B/final13-owner/cross-checker-o0/cross-domain-authoritative-check.json` — `B17A416DF726F3C85DBBAF124FB56BA5445416907DAC736D4BAC0D2D9918CD0B`
- `B/final13-owner/playwright-owner/.../B1-B5-从登录页.../trace.zip` — `468F2CC0C44D670835DB9E32E7BB812122AC09496070047836BCF19B0E686864`
- `B/final13-owner/playwright-main-write/.../trace.zip` — `A6029974D9D910AF7687891839A9B9CB13C5AE59315A4FEE21F7597ECDFBBC10`
- `B/final13-owner/playwright-permissions/.../trace.zip` — `57774C4998F346D490CBEC8F4D497D6219EA026C482E4DAECB966CFD5D0B238C`
- `B/final13-owner/playwright-cross-checker-o0/.../trace.zip` — `BA8A5B670E13482BCDB3E86F0BEF3BEE4EC1D81DBCDD2BD94BBD64990075676A`
- `B/final13-owner/app-cross-h1-vitest.log` — `B6899955A12CBC860DA90D2CDC5448DDB16C7F40FDA1CE18EC9E3BC590BF51CB`

## 缺陷、恢复与交接

- P0/P1/P2/P3：`0 / 0 / 0 / 0`。没有生产源码修改、共享缺陷台账修改、提交或推送。
- 载具仅作兼容修复：Final13 native runtime lock 适配和显式受控 TOTP 窗口；未放宽任何产品断言或改变产品行为。
- 非 Owner 仍须基于本报告和 `B/final13-owner` 原始证据，按墨菲定律独立复审 B1–B5（包括 401/403/404/409/422/500、SSE、CAS/幂等/未知结果、DB/A2/A4/outbox、跨域和 App）。

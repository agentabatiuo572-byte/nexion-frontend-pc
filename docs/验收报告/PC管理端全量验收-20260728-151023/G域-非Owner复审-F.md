# G 域非 Owner 复审报告（F→G）

- Run ID：`pc-full-acceptance-20260728-151023`
- 复审者：F 域 Owner，按 `F→G` 轮换执行
- 范围：G1、G2、G3、G4、G7（5/5 模块）
- 锁定源码基线：PC `91d1c2d`、后端 `a1cc2a7`、App `0e2178b`，以及本轮未提交修复
- 最终 PC 候选：Build `yscCV52TBV-tx4G22DXJz`，PID `17064`
- 最终后端候选：JAR SHA-256 `2B96413C7D26AD4E514E67B65FDC4AF384744B2CBEC07068CA671084465D1EF2`，PID `14284`
- 隔离数据库：`nexion_acceptance_20260728_151023`
- Owner 初审：`98.4/100`
- 非 Owner 复审：**`99.2/100`**
- 最终结论：**G1/G2/G3/G4/G7 5/5 通过；未关闭 P0/P1/P2/P3 为 `0/0/0/0`**

## 逐模块独立结论

| 模块 | 复审重点 | 最终候选证据 | 结论 |
|---|---|---|---|
| G1 质押产品 | 产品与收益参数、B1/D4/App 投影、权限、失败关闭、结果未知 | 从登录页和可见侧栏完成读取、刷新、重登；安全参数可逆写、同键回放、异载荷 409、恢复通过；畸形 200、500、超时清空不可信快照 | **通过** |
| G2 兑换 | 费率与限额、熔断态、D3/D4/G3/App、幂等 | 熔断态仅收紧手续费 `0.01→0.02→0.01`，真实写与恢复通过；最终公共配置为 `0.01`，无订单、钱包或账本副作用 | **通过** |
| G3 NEX 行情 | 七日曲线、控制面、稳定 key、A2/A4 | 页面安全写与恢复通过；unknown/deterministic 分支保持原 key 或释放 key 的语义通过，同键异载荷 409 | **通过** |
| G4 Genesis | royalty、H1/B1/D4、单审计所有权 | 最终 `royalty=2.5`；每个成功命令数据库恰好一条 `G4_GENESIS_PARAM_CHANGED` required 审计和一条 outbox，不再重复记账 | **通过** |
| G7 复投 | canonical mutation、receipt、G4/D4/App、操作者归因 | 完整 canonical overview、receipt、同键回放 200、异载荷 409；A2 `actor_id` 保留数值 ID，`actor_username` 与 outbox operator 均为真实 maker 用户名；最终锁仓天数 `90` | **通过** |

## 十步复审摘要

1. 以 `lib/nav/console-nav.ts` 的 G1/G2/G3/G4/G7 为唯一范围，重新盘点页面、动作和跨域入口。
2. 复核 PC BFF、五个 G 客户端、后端命令服务、配置/订单/钱包/账本、A2 审计和 A4/outbox；未使用 mock、localStorage 权威数据或 DOM 直改。
3. 使用全新 Chromium 上下文，从真实登录页和可见侧栏进入；覆盖首轮、刷新、返回、退出重登。
4. readonly、no-write、no-menu、maker 账号覆盖菜单、路由、按钮、接口、数据五层权限，最终权限轨 `4/4`。
5. 覆盖 401、403、404、409、422、500、超时、畸形 200 和结果未知；失败时隐藏旧快照和写入口，真实响应恢复后重新加载。
6. 五模块 stable mutation 对同载荷重试复用 key，异载荷 409；确定性拒绝释放 key，网络、5xx 与畸形成功包保留 key。组合轨 `15/16` 后，唯一受登录 hydration 载具波动影响的 G1 以全新上下文独立重跑 `1/1`。
7. G1/G3/G4/G7 页面可逆写及 G2 熔断态收紧均真实执行；G7 canonical/receipt、G4 单审计和 G7 操作者归因均以数据库核对。
8. App/公共投影与 PC 权威值一致；A2、A4/outbox、B1、D4、H1 和 G 模块间调用链无漂移。
9. G2 恢复 `0.01`，G4 恢复 `2.5`，G7 恢复 `90`；本轮 G 幂等、可变审计/outbox 及业务夹具精确清零，保留的不可变证据不计残留。
10. 最终 Build、JAR、PID 无漂移；后端定向 `94/94`、全量 `2838` 项测试失败 0、错误 0、跳过 2；G 跨仓/运行时合同 `32/32`。

## 缺陷闭环

| 编号 | 等级 | 修复与最终复验 |
|---|---:|---|
| G-001 | P1 | G1/G2/G4/G7 增加深层运行时协议；畸形 200、500、超时与真实恢复通过 |
| G-002 | P1 | 五模块统一 stable mutation；unknown 同键重试、deterministic 释键和异载荷 409 通过 |
| G-003 | P1 | G7 成功响应返回完整 canonical overview 和 mutation receipt；真实页面写、回放、冲突与恢复通过 |
| G-004 | P2 | G4 审计所有权收敛到持有 old/new 状态的服务；每命令 1 审计 + 1 outbox 实证通过 |
| G-005 | P2 | G7 统一使用 `AdminActorResolver`；A2/A4 真实 maker 用户名与数值 actorId 同时正确 |

## 残留、证据与评分

- 最终权威值：G2 费率 `0.01`、G4 royalty `2.5`、G7 lockDays `90`。
- 本轮 G 业务夹具、幂等记录、可变测试审计/outbox：`0`。
- 页面错误和非预期 `/api/admin/*` 5xx：`0`；受控故障注入不计非预期错误。
- 受限证据：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260728-151023\G\nonowner-F`。
- 调试失败产物、重复 trace、HTML 报告和视频将在总体验收结案清理，不进入 Git。

Owner 初审 `98.4/100` 已超过 `96`；F→G 非 Owner 复审 `99.2/100` 已超过 `98`。无扣血，健康值 **`100/100`**。

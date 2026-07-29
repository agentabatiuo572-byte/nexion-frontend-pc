# G 域 Owner 验收报告

## 结论

- Run ID：`pc-full-acceptance-20260728-151023`
- 范围：G1、G2、G3、G4、G7，共 5 个模块。
- 锁定基线：PC `91d1c2d`、后端 `a1cc2a7`、App `0e2178b`。
- 初审候选：PC `127.0.0.1:3002`（Build ID `zMwYtaTe1oUh_8OZpPPq9`，PID 6104）、后端 `127.0.0.1:8110`（PID 20820）。
- 统一最终候选：PC Build ID `z0FyQqQb2td8k4-s7EAF8`（PID 18468）、后端 JAR SHA-256 `585A8B66D577667207AF81F842F7BDA1BAAD850521F78771D98064227E8E9C8A`（PID 14128）、隔离库 `nexion_acceptance_20260728_151023`、Redis DB 14。
- Owner 裁决：**G1/G2/G3/G4/G7 全部通过 Owner 初审，进入非 Owner 轮换复审。**
- 初审评分：**98.4/100，通过**（门槛 >96）。
- 未关闭产品缺陷：`P0/P1/P2/P3 = 0/0/0/0`。
- 权限夹具按统一计划保留到非 Owner 复审，凭据仅存放在受限证据目录；未写入仓库或本报告。

本结论未复用 2026-07-27 的通过记录。最终锁定重跑使用全新浏览器上下文，从真实登录页和可见 G 域侧栏进入；主链 `5/5`、权限轨 `3/3`、maker/checker 高风险轨 `2/2` 全部通过。PC G 域合同 `20/20`、App G 域定向测试 `18/18` 通过。测试期间未修改正式 `superadmin`，未使用 mock、localStorage 权威数据、直接 DOM 修改或固定睡眠。

统一重建后又在 Build ID `z0FyQqQb2td8k4-s7EAF8`、后端 JAR SHA-256 `585A8B66...E9C8A` 上完成一次全新上下文短重跑：G1/G2/G3/G4/G7 均从可见侧栏进入并取得真实 200 权威快照；G7 刷新前后逐字段一致；通过页面可见账号菜单退出并重新登录后，G1 快照逐字段一致；G1→B1、G2→D4/D3、G3→G2/G7、G4→B1、G7→账单的页面链路均可见，六组 App/公共端点均为 200 且 `code=0`。短重跑 `1/1` 通过，页面错误和非预期 `/api/admin/*` 5xx 均为 0，因此统一最终候选无 G 域回归。

## 模块逐项结果

| 模块 | 可见入口 | 权威数据及跨端链 | 权限、异常与并发 | Owner 裁决 | 评分 |
|---|---|---|---|---:|---:|
| G1 质押产品 | `/finance/staking` | PC 管理快照与 App `/api/config/staking/pools` 数值同源；用户态 `/api/stakes` 匿名 401；产品、仓位、收益最终落钱包/账本并供 D4/B1 使用 | readonly/no-write 读 200 写 403；no-menu 菜单、路由、接口均拒绝；非法参数 422、缺幂等键 422、未知资源失败关闭，快照不变 | **PASS** | 98.1 |
| G2 兑换 | `/finance/exchange` | 管理快照与 App `/api/config/exchange/caps` 同源；用户态 `/api/exchange` 匿名 401；兑换订单、手续费分配、钱包账本、价格指数闭环 | readonly/no-write 读 200 写 403；no-menu 全拒绝；未知订单真实 404；旧有 G2 Owner 轨在本 Run 重新执行 `1/1`，未复用历史结论 | **PASS** | 98.3 |
| G3 NEX 行情 | `/finance/market` | 管理曲线/控制面与 App `/api/config/market/nex`、`/api/market/nex` 同源；配置写入形成 A2 及 `admin.market_schedule_changed` / `admin.nex_price_curve_changed` outbox | maker 从侧栏真实编辑非活动日波动并恢复；相同幂等键同载荷重放 200、同键异载荷 409；maker/checker CAS 并发恰有一个 200、一个 409；畸形 200、500/请求中断均失败关闭 | **PASS** | 98.8 |
| G4 Genesis | `/finance/genesis` | 管理统计、发行、操作与 App `/api/genesis/state` 同源；用户态 `/api/genesis/account` 匿名 401；真实业务链包含 Genesis 订单、持仓、发行批次、钱包/账本 | maker 从页面创建并归档 `ADMIN_ONLY` 虚拟成交；同键同载荷重放、同键异载荷 409；H1 闸门关闭时发行批次 409；模拟前后真实统计、分红、钱包和账本不变，活动验收模拟残留 0 | **PASS** | 98.7 |
| G7 复投 | `/finance/repurchase` | 管理快照与 App `/api/config/repurchase` 同源；用户态 `/api/repurchase/orders` 匿名 401；复投产品/仓位最终落钱包账本并使用 NEX 权威价 | readonly/no-write 读 200 写 403；no-menu 全拒绝；未知状态和非法配置失败关闭；注入 500 后不显示“真实复投单”伪成功 | **PASS** | 98.2 |

## 十步验收记录

### 1. 页面与动作盘点

- 唯一范围源 `lib/nav/console-nav.ts`：G1 质押、G2 兑换、G3 NEX 行情、G4 Genesis、G7 复投。
- G1：产品参数、收益/罚金和停开控制；G2：用户/平台限额、手续费、兑换队列；G3：七日曲线、PIN/LOOP、价格覆盖和引擎控制；G4：统计、价格、分红、发行与 ADMIN_ONLY 模拟；G7：复投年化、养成参数和开关。
- 首轮入口全部来自可见侧栏，未以直达 URL 代替真实用户路径。

### 2. 页面字段到数据库的完整溯源

| 模块 | PC/后端主链 | 权威表或配置 | App/下游 |
|---|---|---|---|
| G1 | `g1-staking.tsx` → `g1-client.ts` → `OpsStakingController` / `OpsNexMarketService` | `nx_staking_product`、`nx_staking_position`、质押配置及应急控制 | `/api/config/staking/pools`、`/api/stakes` → 钱包/账本、D4、B1、A2/A4 |
| G2 | `g2-exchange.tsx` → `g2-client.ts` → `OpsExchangeController` / `AppExchangeService` | `nx_exchange_order`、`nx_exchange_fee_allocation`、`nx_wallet`、`nx_wallet_ledger`、`nx_price_index`、`nx_config_item` | `/api/config/exchange/caps`、`/api/exchange` → D4/B1、A2/A4 |
| G3 | `g3-market.tsx` → `g3-client.ts` → `OpsNexMarketController` / `OpsNexMarketService` | `wallet.nex_market.*` 配置、`nx_price_index` | `/api/config/market/nex`、`/api/market/nex` → G2/G4/G7、B1、A2/A4 |
| G4 | `g4-genesis.tsx` / `g4-admin-operations.tsx` → `g4-client.ts` → `G4AdminCommandService` / `OpsGenesisSimulationService` | `nx_genesis_series`、`nx_genesis_holding`、`nx_genesis_order`、发行批次/明细、`nx_genesis_admin_simulation`、钱包/账本 | `/api/genesis/state`、`/api/genesis/account` → H1、D4/B1、A2/A4 |
| G7 | `g7-repurchase.tsx` → `g7-client.ts` → `OpsRepurchaseAdminService` / `AppRepurchaseService` | `REPURCHASE_90D` 产品、`nx_staking_position`、`nx_price_index`、钱包/账本 | `/api/config/repurchase`、`/api/repurchase/orders` → G3、D4/B1、A2/A4 |

### 3. 真实 Chromium 点击、输入与等待

- 最终 Owner 浏览器主链：`5/5` 通过；每个模块均从登录页进入并点击可见侧栏，等待精确接口和页面状态。
- 页面截图：`g1-superadmin-read.png`、`g2-superadmin-read.png`、`g3-superadmin-read.png`、`g4-superadmin-read.png`、`g7-superadmin-read.png`。
- 最终 Playwright JSON：`g-owner-final.json`、`g-permissions-final.json`、`g-high-risk-final.json`，均位于受限 G 证据目录。
- 页面错误、未捕获控制台错误和非预期 `/api/admin/*` 5xx：`0`。500 仅为明确标记的受控故障注入。

### 4. 主流程、空态、刷新、返回与退出重登

- 五模块首轮均展示服务器权威快照；刷新后快照逐字段一致。
- 从 G1 完成退出，再用新会话重新登录并从可见侧栏返回 G1，服务器数据与权限均未漂移。
- 合法空态保持为空，不生成占位业务记录；故障态清除旧数据区，不把缓存值显示成成功。

### 5. 菜单、路由、按钮、接口、数据五层权限

- `g_readonly` 与 `g_no_write`：可见 G 域 5 个菜单，五模块真实读取均为 200；页面不提供可用写动作，绕过 UI 的五组写请求均为 403。
- `g_no_menu`：侧栏不存在 G 域入口，直达路由被重定向并显示无权提示；五组读写接口全部 403，未泄露数据。
- 匿名：五个管理接口全部 401；四组 App 用户态接口匿名 401。
- maker/checker：两个独立账号、浏览器上下文和会话；maker 只执行获授 G3/G4 动作，checker 独立复核最终服务端值。正式 `superadmin` 未改权。

### 6. 异常、超时和失败关闭

- 401：匿名管理接口和 App 用户态接口拒绝。
- 403：readonly/no-write 写入及 no-menu 读写拒绝。
- 404：G2 未知订单真实返回 404。
- 409：G3 同键异载荷、CAS 并发；G4 同键异载荷及 H1 闸门关闭。
- 422：G1 缺幂等键/非法参数、G3 非法 oracle、G4 非法模拟。
- 500、超时/中断、畸形 200：分别对 G7、G1、G3 受控注入；页面均失败关闭，不显示伪成功或陈旧数据。
- 未知资源、未知状态和结果未知均未改变数据库权威快照。

### 7. 幂等键、同键异载荷、CAS 与双运营员并发

- G3：相同幂等键与相同载荷重放为 200；同键异载荷 409；maker/checker 同时提交同一版本，恰好一个成功、一个 409。完成后由 checker 新会话复核并恢复原值。
- G4：ADMIN_ONLY 创建和归档均使用稳定幂等键；创建同键同载荷重放不重复生成记录，同键异载荷 409；归档重复调用不产生第二次市场影响。
- G1/G2/G7 的幂等、钱包和账本合同在本 Run 定向合同集 `20/20` 通过；非法调用不前移状态。

### 8. 数据库、A2、A4/outbox 与上下游核对

- A2：本 Run 存在 `G3_CONTROL_CHANGED`、`G3_WEEKLY_CURVE_CHANGED`、`GENESIS_ADMIN_SIMULATION_CREATE/ARCHIVE` 的 SUCCESS 审计。
- A4/outbox：G3 写入持久化为 `admin.market_schedule_changed` 和 `admin.nex_price_curve_changed`。隔离候选未启动异步发布消费者，记录为 PENDING；属于已持久化、待消费者处理，不是事件丢失。
- G4 ADMIN_ONLY 模拟只形成审计，不进入真实订单/钱包/账本；前后统计和分红相同。
- PC 管理快照与五组 App 公共配置/行情端点逐项同源；G1/G2/G4/G7 的真实用户业务事件及账本合同由本 Run `20/20` 合同测试复核。
- 详细数据库计数见受限证据 `db-chain-summary.md`。

### 9. 精确清理

- G3 非活动日波动、PIN/LOOP、当前价格和七日曲线均恢复验收前快照。
- G4 本 Run 的 ADMIN_ONLY 模拟均已归档；`ACC-G4-* / ACTIVE = 0`，真实订单、钱包、账本和分红未改变。
- 调试视频、重复 trace 和临时截图未纳入 Git；最终证据仅保存在受限目录。
- readonly、no-write、no-menu、maker 账号及两个 Run 专用角色按主智能体要求保留到非 Owner 复审。复审后必须按 `账号解绑 → 角色删除` 的顺序由主智能体精确清理。

### 10. 初审评分

**98.4/100，通过。**

- 五模块真实浏览器主链、刷新重登及跨端同源：39.4/40。
- 五层权限、匿名和失败关闭：29.6/30。
- G3/G4 maker/checker、幂等/CAS、A2/A4 与恢复：19.6/20。
- 证据、隔离性与清理：9.8/10。

扣分项：隔离候选未运行 outbox 消费者，因此 G3 事件仅验证到 durable PENDING；G1/G2/G7 未以真实用户资产执行不可逆资金动作，而以隔离管理轨、真实公共/用户态接口和钱包/账本合同覆盖。两项均已明确边界，不构成 PC 管理端产品缺陷。下一门槛为非 Owner 复审 >98。

## 缺陷与验收载具修正

### 产品缺陷

本轮未发现产品缺陷，统一缺陷台账无需新增 G 域产品项。

### 验收载具问题（非产品缺陷，均已关闭）

1. G3 首次网络等待匹配到 `/history` 而非精确 `/curve`；改为精确 pathname 后从入口完整重跑通过。
2. no-menu 用例最初断言文案与真实无权提示不一致；改为稳定权限语义断言后，以全新上下文完整重跑 `1/1`。
3. MFA 一次性验证码在同一时间步重用会被服务端正确拒绝；用例改为等待验证码自然滚动并重登，未绕过 MFA。
4. G4 首次脚本误假设创建响应直接返回 id，留下一个活动模拟；改为按服务端 `simulationNo` 回读定位，并精确归档历史验收标记。最终活动残留为 0。

上述问题均发生在测试脚本或夹具，不涉及产品代码；未为迎合测试修改生产逻辑。

## 证据索引

- 受限目录：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260728-151023\G`
- Owner 最终浏览器轨：`g-owner-final.json`（5/5）
- 统一最终候选短重跑：`g-final-candidate-short-final.json`（1/1）
- 权限最终轨：`g-permissions-final.json`（3/3）
- 高风险最终轨：`g-high-risk-final.json`（2/2）
- G2 独立读取：`g2-superadmin-read.json`（1/1）
- App/PC 同源：`g-cross-app.json`
- 数据库链：`db-chain-summary.md`
- 关键恢复截图：`g3-maker-checker-restored.png`、`g4-admin-only-restored.png`

## 复审交接

- 非 Owner 复审必须使用全新浏览器上下文和新夹具状态，重新攻击权限篡改、并发、结果未知、失败关闭、刷新重登及跨域不一致。
- 权限夹具标识和清理顺序位于受限 `permission-fixtures.json`；不得在报告或 Git 中传播密码/MFA 秘钥。
- 复审完成前不得删除账号/角色；复审完成后由主智能体统一清理，并复核账号、角色、Redis 键、幂等业务夹具和临时配置残留为 0。

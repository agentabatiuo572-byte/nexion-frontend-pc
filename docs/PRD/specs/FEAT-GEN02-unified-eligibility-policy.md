# FEAT-GEN02 · 创世节点认购资格统一配置

> 状态：CURRENT / server-canonical  
> 生效日期：2026-08-27  
> 适用范围：真实运营后台、Java 后端、5173 UniApp、5174 高保真演示

## 1. 当前唯一配置

创世节点资格只接受 `market.genesis.ops.` 命名空间下列三项。运营在 G4「创世认购新配置与预售」中读取、调整并回读；App 不保存另一套可放宽规则，也不自行拼装资格。

| 配置项 | 类型 | 当前基线 | 作用 |
|---|---:|---:|---|
| `eligibility.enabled` | boolean | `true` | 是否启用最低账户龄与资格持有上限。关闭属于放宽资格，但不会绕过预售上限、库存、国家/地区、市场开关和销售时间。 |
| `eligibility.maxPerUser` | integer ≥ 0 | `5` | 资格策略启用时，一级认购与二级承接合计的单账户上限。若预售开启，实际值取本项与 `presale.maxPerUser` 的较小值。 |
| `eligibility.minAccountAgeDays` | integer ≥ 0 | `0` | 资格策略启用时的最低账户注册天数。 |

后端仍必须在成交事务内复核：有效账号、国家/地区完整、地域未禁、销售时间已开放、市场未关闭、库存足够、单账户上限未超。前端资格接口只展示服务端的 `eligible / reasons / ownedCount / maxPerUser / remainingCap / minAccountAgeDays / accountAgeDays` 投影。

5173 标准开发环境直接使用正式 Genesis 业务表和上述三项后台配置，不得用 `20 个 / 0 天` 等本地常量替代，也不得因运行在 `dev` 就切换到 Sandbox。资格查询读取 `nx_user.created_at` 计算账户龄；一级认购与二级承接在扣款和转移持有前再次校验同一份开关、账户龄与持有上限。三项配置缺失、停用、越界或格式错误时，查询返回 `SALE_POLICY_UNAVAILABLE`，成交失败关闭。

## 2. 新旧区别

| 维度 | 旧配置（RETIRED） | 新配置（CURRENT） |
|---|---|---|
| 来源 | 2026-07 原型规格 FEAT-GEN08 / 高保真后台 FEAT-GEN-ADM-G4b | 真实后端 `market.genesis.ops.*` 配置与 G4 管理接口 |
| 判定 | 累计入金、旗舰设备、V 等级、创世邀请码四项组合 | 启用开关、单账户上限、最低账户龄，加服务端交易前置校验 |
| 配置数量 | 8 项（含组合模式、适用范围等） | 3 项资格配置；预售配置另组管理 |
| 权威位置 | 前端 mock 与高保真参数镜像，无法证明真实成交授权 | Java 服务端读取配置并在一级、二级成交事务内复核 |
| 前端职责 | 本地跨 store 拼装条件并决定是否放行 | 仅消费服务端资格投影；5174 仅用同字段离线镜像 |
| 当前状态 | 不再配置、不再返回、不再展示、不再参与判定 | 唯一有效策略 |

旧字段 `mode / minDepositUsdt / flagshipMin / vRankMin / inviteEnabled / perUserCap / appliesTo` 以及创世邀请码作为资格通道的语义全部退役。PC 的创世节点页面、BFF 路由、Java 管理端点和 App 兑换端点均删除邀请码发行、作废、兑换能力；历史数据库记录仅保留用于审计，不能授予创世认购资格。

升级数据库由 `20260827_genesis_unified_eligibility.sql` 幂等补齐当前三项配置及资格投影依赖的预售基础配置；已存在的运营值不覆盖。若旧库只有 `perUserCap`，首次迁移将其值迁到 `maxPerUser`，随后把全部旧字段软删除并停用。干净库在 `schema.sql` 使用同一组基线。即使迁移异常导致配置行缺失，G4 首次写入也以空值做 CAS，不会把界面默认值误当成服务端旧值。

历史邀请码数据只读保留在数据库审计边界内，不再提供签发、作废或兑换接口；任何历史记录都不能改变 `eligible` 或绕过成交前复核。

### 2.1 标准开发环境与专项 Sandbox 的区别

标准 `dev` 启动不设置 Genesis Acceptance RunID：App 读取 `PRODUCTION + runId=""` 的服务端权威回执，认购直接写 `nx_genesis_order / nx_genesis_holding / nx_wallet_ledger`，G4 同源回读。这里的 `PRODUCTION` 表示正式业务数据轨，不代表连接线上生产数据库。

存量开发账号如果因旧 Acceptance 流程仍带 `sandbox=1`，不能只迁订单与持仓：必须在确认其已迁入当前开发库正式业务表后，把该本地账号同步收敛为正式业务账号标记。标准开发环境的 App 认购链与 G4 均只承认 `sandbox=0` 的正式业务账号，不为 `dev + sandbox=1` 另开钱包、资格或台账旁路。否则正式表中的持仓仍会被 App 公共状态、订单回读和持有人聚合过滤，表现为“数据库有记录、页面/G4 仍为 0”。此身份收敛不复制钱包、不新建流水，也不得产生第二次扣款。

显式 `test`/专项验收 Sandbox 才使用 RunID 和 `nx_genesis_sandbox_*`；它不属于普通开发联调，不能由 `start-dev-h5.ps1` 或 `start_ops_console_monolith.ps1` 的默认值隐式开启，也不能聚合进 G4 正式持仓与排放口径。

`nx_genesis_sandbox_wallet.version = 0` 且没有订单、持有或资金镜像流水的历史行仅是旧初始化器留下的惰性种子，不代表账号已经归属于该 Run，也不能单独阻断当前 Run。`version > 0` 的钱包仍按实质事实隔离。App 不展示内部 RunID，只把隔离冲突说明为“测试账号属于另一条验收数据链”；网络、协议或资格接口不可用则显示“资格服务暂时连接失败”，两者都不得伪装成“未通过平台策略”。

账号当前持有数、已售数和可返回 App 的持仓列表仅统计 `ACTIVE / LISTED`。夹具回收或验收撤销留下的 `REVOKED / CANCELLED` 历史行继续保留审计，但不占库存、不占单人上限，也不得进入只接受可持有状态的 App 响应，否则会把无效历史行误报成资格接口故障。

## 3. 与设备商城资格的边界

设备 SKU 的 E1 `purchaseGate` 是当前成交契约；E3 `open / any-of / all-of` 是设备规则编辑器规划语法。两者都属于设备商城，不是创世节点资格。本次只删除创世节点旧四项规则，不修改设备购买资格，也不得把 E3 规划语法接回创世节点。

## 4. 管理与接口

- PC 入口：G 域 → G4 → 创世认购新配置与预售。
- PC 读取：`GET /api/admin/market/nex/genesis/operations`。
- PC 写入：`PUT /api/admin/market/nex/genesis/operations/config/{configKey}`，携带幂等键、理由与期望旧值，服务端做 CAS 与审计。
- App 读取：`GET /api/genesis/eligibility` 与账号态接口中的 `eligibility`。
- 成交复核：一级认购和二级承接均由服务端执行相同策略，不接受客户端布尔值作为授权。

## 5. 验收

1. G4 只出现三项当前资格配置，修改后能回读相同值。
2. 5173 与 5174 源码、资格面板和运行态不再包含旧四项组合规则或邀请码资格入口。
3. 资格响应不再返回旧 `mode / appliesTo / hasGenesisInvite` 字段。
4. 配置缺失、响应畸形或服务不可用时前端失败关闭，不得退回旧本地规则。
5. 设备商城自身的资格规则保持原状。
6. 仅有其他 RunID `version = 0` 惰性钱包种子的账号可正常读取当前 Run 资格；其他 Run 存在订单、持有、流水或 `version > 0` 钱包时仍失败关闭。
7. RunID 隔离冲突、资格服务不可达和真实策略不通过必须显示不同原因，不得统一降级为“暂不符合平台当前认购策略”。
8. 当前 Run 仅有 `REVOKED / CANCELLED` 历史持仓时，账号持有数与已售数均为 0，App 仍能解析资格并进入认购确认面板。

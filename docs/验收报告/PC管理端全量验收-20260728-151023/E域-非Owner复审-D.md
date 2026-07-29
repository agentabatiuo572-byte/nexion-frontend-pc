# E 域非 Owner 复审报告（D Owner）

> Run ID：`pc-full-acceptance-20260728-151023`  
> 复审者：D 域 Owner（非 E Owner）  
> PC 最终候选：Build ID `G_xqr1e1jOiGdjdxUT076`，PID `17108`  
> 后端候选：PID `18380`，JAR SHA-256 `A952148DC7EA1DF7C46A6C1803BD032A20671074A28584BC77EAE86EC45CB037`  
> 数据隔离：Run 专用 MySQL `nexion_acceptance_20260728_151023`、Redis DB 14 和受限证据目录  
> 复审结论：E1–E6 `6/6` 通过；`E-006/E-007/E-008/E-AUTO-001` 全部关闭；非 Owner 复审 `99.3/100`，通过

## 1. 复审范围与裁决原则

本次不复用 E Owner 的浏览器上下文、登录态或通过结论。D Owner 使用全新 Chromium 上下文和隔离的 readonly、no-write、no-menu、maker、checker 账号，从登录页及可见侧栏逐模块重跑 E1–E6，并按《页面业务逻辑通顺性验收方法》攻击权限篡改、畸形 200、401/403/409、结果未知、对象锁、幂等、CAS、双运营员竞争、刷新重登和 PC→后端→App 跨域投影。

真实主流程只访问统一 PC/后端候选，不使用 mock、localStorage 权威数据或 DOM 注入。503 unknown 和畸形 200 只用于单独标记的故障注入轨，不替代真实业务验收。最终候选期间 Build ID、PC PID、后端 PID 和 JAR SHA 未漂移。

## 2. 逐模块复审结果

| 模块 | 可见入口与首用流程 | 权威数据与跨域链 | 对抗性复审 | 结论 |
|---|---|---|---|---|
| E1 SKU 与设备目录 | 登录、侧栏进入、型号/库存/代际门、刷新、返回、退出重登成功 | 页面读取服务端 canonical SKU 与 generation gates，写入以前置快照有效为必要条件 | 畸形 200 时清空不可信快照并隐藏三类写入口；只读及无写权限账号不可写 | 通过 |
| E2 任务配置 | 登录、侧栏进入、任务类型、结构化值、刷新重登成功 | 任务分类、参数和状态来自真实后端，字段语义与 App 任务消费一致 | 读取失败关闭并可重试恢复；五层权限与直接接口绕过均按预期拒绝 | 通过 |
| E3 Trade-in/生命周期 | 登录、侧栏进入、操作说明、安全调整、刷新重登成功 | canonical E3 配置、A2 工单、对象锁、A4 审计和 App 设备展示同源 | 验证 pending 直写 409、自审 403、独立 checker、同键重放/异载荷、CAS；503 unknown 与畸形 200 保留原 key、输入和理由 | 通过 |
| E4 订单管理 | 登录、侧栏进入、真实订单与状态、刷新重登成功 | 订单状态和设备/用户关联来自服务端权威数据 | 只读轨、无写轨、无菜单轨及读取失败关闭通过；无旧快照冒充成功 | 通过 |
| E5 设备运维 | 登录、侧栏进入、设备运行与处置状态、刷新重登成功 | 设备状态、生命周期和处置结果来自后端，并与 E1/E4 上下游一致 | 权限篡改与异常读取失败关闭通过；未出现本地伪造设备状态 | 通过 |
| E6 算力配置 | 登录、侧栏进入、双语下载文案和算力参数、刷新重登成功 | `e6_compute_config_batch` 经 A2 maker/checker 落入服务端配置，并同步 PC 与 App 公共投影 | 最小 maker 可提案；同键重放 200、异载荷 409、双 checker `[200,409]`；逐对象 target 精确校验，未知/跨域/重复 target 失败关闭；前向与恢复均闭环 | 通过 |

## 3. 验收文档十步证据

### 3.1 页面与动作盘点

- `lib/nav/console-nav.ts` 中 E1–E6 六个可见模块全部覆盖，每个模块独立裁决。
- 最终候选从登录页、可见侧栏完成 E1/E4/E5/E6 `1/1`、E2 `1/1`、E3 `1/1`，合计 E1–E6 `6/6`。
- 六模块均覆盖首轮、刷新、返回或侧栏切换、退出重登；pageerror 与 `/api/admin/*` 非预期 5xx 为 `0`。

### 3.2 页面字段到数据库的完整溯源

- E1：SKU、代际门和写入可用性来自 canonical 服务端快照；快照缺失或读取失败时不能写。
- E2：设备任务分类和结构化参数来自真实任务接口，不以演示常量替代权威数据。
- E3：页面别名只用于回放兼容；数据库配置行、幂等资源和对象锁统一使用 canonical key。
- E4/E5：订单、设备运行和处置状态由后端权威数据驱动，并核对相邻模块的一致性。
- E6：双语文案与算力参数以 `ComputeConfigRegistry` 白名单为真源；服务端排序生成 canonical 对象和 targets，App 通过公共配置投影读取相同结果。

### 3.3 真实 Chromium 首用走查

- 旧候选完整 Owner 模块面 `12/12`，权限轨 `3/3`，E3 对抗轨 `2/2`。
- 最终统一候选短锁定覆盖 E1–E6：`3/3`；E6 修复终局 maker/checker：`1/1`。
- 全程 `workers=1`，使用可见定位器和响应/状态等待；真实主流程无 mock。

### 3.4 主流程、空态、刷新、返回、退出重登

- E1–E6 均从登录页和可见侧栏进入；首轮权威数据、可接受空态、刷新和重登状态一致。
- E1–E6 读取失败均显示可见错误并冻结或隐藏依赖该快照的写入口，解除注入后从原入口真实恢复。
- E3 unknown 保留原弹窗、值、理由和命令号；不会把结果未知显示为确定失败。

### 3.5 菜单、路由、按钮、接口、数据五层权限

- readonly：E1–E6 可见、可读，危险写入口不可用。
- no-write：菜单和读取可用，写按钮隐藏/禁用，直接写接口返回 403。
- no-menu：E 菜单不可见，直接读取和写入均被服务端拒绝；刷新重登后不漂移。
- E6 maker 仅具 `device_e6_read`、`device_e6_write`、`platform_a2_proposal_create`，未借用超级管理员会话落票；批准由独立 checker 完成。

### 3.6 异常响应、结果未知与失败关闭

- E1–E6 对读取失败和畸形成功响应均不保留不可信旧值作为成功。
- E3 对 503 unknown 与 `200/code=0/data=null` 统一提示使用同一命令号重试并核对 A2；两次请求 key/body 完全一致，真实配置未写。
- E6 未映射业务上下文在修复前稳定 403 且无 pending 工单、配置或锁副作用；修复后未知 key、空 batch、跨域及重复 target 继续失败关闭。

### 3.7 幂等、同键异载荷、CAS 与双运营员并发

- E3：同键同载荷返回同一工单；同键异载荷 409；pending 期间第二运营员直写 409；自审 403。
- E6：前向工单 `WO-260728232333343-700` 同键同载荷 200 且同 ID，同键异载荷 409；两个独立 checker 并发结果严格为 `[200,409]`，唯一胜者为 `superadmin`。
- E6 恢复工单 `WO-260728232334523-800` 由独立 checker 批准；恢复后服务端、PC 和 App 投影均回到原值。

### 3.8 数据库、状态、A2、A4/outbox 与上下游

- E3 canonical 对象锁修复后，pending 直写不再绕过；批准、页面生效、恢复批准和精确恢复均通过。
- E6 A2 前向/恢复审计为 200，配置审计事件为 `COMPUTE.CONFIG_CHANGED`。
- A4/outbox `8745/8746` 均为 `compute.config_changed`、schema rev `60`、retry `0`、`last_error=null`；当前状态为 `PENDING`。本轮验收确认的是事务内持久化和 A4 可见性，不把尚未发生的消费者投递标记为已发布。
- PC 与 App 公共投影在前向时同步变化，在恢复时同步还原；最终五项文案/URL 与验收前快照完全一致。

### 3.9 精确清理

- 四个隔离账号全部完成 MFA 清除、角色解绑、停用和会话撤销；API/DB 核对 `disabled/unassigned/tfa=false/sessions=0`，登录均被 401/403 拒绝。
- 两个隔离角色 `4051/4102` 已软删除，活动权限关系和菜单关系为 `0`；待审角色工单为 `0`。
- 按精确前缀删除本轮 E 平台幂等 `71` 条，最终残留 `0`；Redis DB14 按 Run ID、账号 ID 和用户名扫描残留 `0`。
- E pending 工单、活动对象锁、marker 配置均为 `0`。不可变 A2/A4 审计与 outbox 证据保留。

### 3.10 评分

**初审：98.7/100，通过。复审：99.3/100，通过。**

- 初审扣分 `1.3`：发现 `E-006/E-007/E-008` 三项跨层缺陷；均在真实失败关闭、最小根修复、统一重建候选和新会话完整重跑后关闭，没有错误业务副作用。
- 复审扣分 `0.7`：E6 最小 maker 首次暴露业务上下文缺口，修复后扩大到恶意 key、空 batch、重复/跨域 targets 和 App 投影进行棘轮复验；全部通过。
- 未关闭 P0/P1/P2/P3 为 `0/0/0/0`。
- 当前血量：`100/100`。

## 4. 缺陷修复闭环

| 编号 | 等级 | 根因 | 最小根修复 | 终局复验 |
|---|---|---|---|---|
| E-006 | P1 | E3 A2 target 使用页面别名，后端直写锁使用 canonical key，pending 对象锁可被绕过 | E3 单字段和批量 target 统一映射 canonical key，不改变回放 command 兼容性 | pending 直写 409、自审 403、独立 checker、幂等/CAS、前向和恢复全通过 |
| E-007 | P1 | A2 unknown 只识别窄响应头，畸形 200 与跨模块错误会被泛化为普通失败 | 统一未知结果错误、边界安全谓词和持久可操作提示；共享 proposer、K2 和确认弹窗同步 | 503 unknown 与畸形 200 均保留同一 key/body、输入和弹窗，未发生配置写入 |
| E-008 | P1 | 后端 delegated E 上下文只映射 E6 单字段，没有映射 PC 实际 `e6_compute_config_batch + targets` | 服务端按 `ComputeConfigRegistry` 校验并排序 values，要求请求 targets 与逐对象 canonical targets 全等；PC 同步稳定键序 | 最小 maker、同键重放/异载荷、双 checker `[200,409]`、A2/A4、PC/App 投影、恢复和清理全部通过 |
| E-AUTO-001 | P3 | 旧合同仍要求 E1 写入口直接使用 `canWriteE1`，与加强后的 canonical 快照门禁不符 | 合同改为锁定 `canUseE1Writes = canWriteE1 && !e1Loading && !e1Error && e1Gates !== null` | E/K2 扩大合同 `70/70`，E1 畸形 200 失败关闭和恢复通过 |

涉及的产品修复包括 PC 的 E1/E3/E6/A2 结果未知边界和 K2 共享判定，以及后端 `AuditReplayBusinessPermissionGuard` 的 E6 batch delegated 校验及其合同测试。后端全量 Maven、统一 PC 生产构建和服务重启由主智能体在相同最终候选上完成，本复审智能体未并发启动服务或 Maven。

## 5. 自动化与质量门

| 轨道 | 结果 |
|---|---:|
| 旧候选 E Owner 模块面 | `12/12` |
| E 五层权限轨 | `3/3` |
| E-006/E-007 对抗轨 | `2/2` |
| 最终候选 E1–E6 可见入口短锁定 | `3/3`（覆盖六模块） |
| E6 最小 maker/checker 终局 | `1/1` |
| 平台权限夹具清理 | `1/1` |
| E/K2 扩大合同 | `70/70` |
| 最终候选定向 PC 合同 | `30/30` |
| App 公共配置定向测试 | `15/15` |
| PC TypeScript / App type-check | 通过 / 通过 |

PC 和后端 `git diff --check` 均通过。最终候选未运行由本智能体自行启动的服务，也未执行 mock 主流程。

## 6. 受限证据

受限根目录：

`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260728-151023\E\nonowner-D`

- `final-9hoJ5Kpe5kMgLKBZr_EIk/`：E1–E6 完整模块面、权限、E-006 和 E-007 对抗证据。
- `final-G_xqr1e1jOiGdjdxUT076/e6-terminal/`：E-008 最终前向、checker 竞争、PC/App 投影和恢复结果。
- `final-G_xqr1e1jOiGdjdxUT076/short-lock-e1456/`、`short-lock-e2/`、`short-lock-e3/`：最终候选六模块可见入口、刷新和重登。
- `final-G_xqr1e1jOiGdjdxUT076/permission-cleanup/`：账号、角色、会话、MFA、幂等和 Redis 精确清理。

| 关键证据 | SHA-256 |
|---|---|
| `final-adversarial/e006-result.json` | `652BBD5459BB6042163EE12923D1981C88B5F0E9E5376F457BD87490E584C8AE` |
| `final-9hoJ5Kpe5kMgLKBZr_EIk/adversarial/e3-unknown-result.json` | `B7BCB3995D4E5FFE57177BD7D0C6D08E257707A19D915BAE74396CA92F488801` |
| `final-G_xqr1e1jOiGdjdxUT076/e6-terminal/result.json` | `8CF43B962FBEE15911E4CD010EA7E9BF4F98C1EF3BBF6DC8B8374578A0E67636` |
| `final-G_xqr1e1jOiGdjdxUT076/permission-cleanup/result.json` | `B25EE7ED1BE4824E925A36A889144507CA653C6213B89E882C998EA7A2E38B1D` |

最终域级 trace、关键脱敏截图和结果 JSON 留在受限目录，不上传 Git；临时密码、TOTP、认证状态、调试视频、重复 trace 和临时截图不进入仓库。

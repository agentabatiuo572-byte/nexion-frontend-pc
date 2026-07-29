# A 域 Owner 验收报告

## 结论

- Run ID：`pc-full-acceptance-20260728-151023`
- 范围：A1–A8，共 8 个模块。
- 锁定基线：PC `91d1c2d`、后端 `a1cc2a7`、App `0e2178b`。
- 候选环境：PC `127.0.0.1:3002`、后端 `127.0.0.1:8110`、隔离库 `nexion_acceptance_20260728_151023`、Redis DB 14。
- 锁定候选：Build ID `PiK9WG2ICz0efJAeLyFZA`，PC PID `19260`，后端 PID `20820`；本轮复验结束时均未漂移。
- Owner 裁决：A1–A8 **8/8 通过**。八个模块均从登录页和可见侧栏进入，完成刷新、退出与重新登录；A3、A4 完成真实可逆写入并恢复，A5 完成真实服务端参数目录、跨域 owner 跳转和故障分支恢复，A6–A8 完成完整权限链。
- 未关闭产品缺陷：`P0/P1/P2/P3 = 0/0/0/0`。
- 已关闭验收载具缺陷：`A-AUTO-001`（P1）、`A-AUTO-002`（P3），均非产品缺陷。

历史通过结论未被复用。统一候选先对 A1–A8 分别启动新 Chromium 上下文执行表面锁定，结果 `8/8`；A3/A4 定向真实链路通过；A5 `1/1` 通过；A6–A8 使用新 Run Token `MS4AXL7H` 从登录页、可见侧栏、独立 maker/checker、新账号、新 MFA、新密码和新业务夹具完整重跑，`1/1` 通过，运行 43.8 秒。最终页面异常、控制台异常和非预期 `/api/admin/*` 5xx 均为 0。

## 模块逐项结果

| 模块 | 入口 | 本轮 Owner 证据 | 当前模块裁决 |
|---|---|---|---|
| A1 运营账号 & RBAC | `/platform/accounts` | 服务端生成临时密码；真实首次登录、MFA 注册、首次改密；账号停用、会话撤销、MFA 清除、角色解除均逐步使用最新 `expectedVersion`；停用后登录 403；账号安全合同 `11/11` | 通过 |
| A2 审计 & 操作确认 | `/platform/audit` | `superadmin` 仅作为 maker；独立临时超管作为 checker；A6 授权工单与角色删除工单均由非 maker 执行；同人审批真实返回 403 的旧脚本问题已消除；A7 三类关系拒绝均进入高风险拒绝审计；A2 合同 `6/6` | 通过 |
| A3 系统配置 | `/platform/config` | 从可见侧栏进入；真实 `ops.maintenanceBanner` 从 `off → on → off`；每次均经目标值、8 字以上理由和服务端 PUT；回读、刷新、退出重登后仍为 `off`；页面错误/5xx 为 0；合同 `6/6` | 通过 |
| A4 埋点事件体系 | `/platform/events` | 从可见侧栏进入；打开 family 事件清单并核对 6 个 family；真实 Day0 从 `90 秒 → 91 秒 → 90 秒`；服务端回读、刷新、退出重登均恢复为 `90 秒`；页面错误/5xx 为 0；合同 `5/5` | 通过 |
| A5 平台参数寄存器 | `/platform/params-registry` | 真实 canonical registry 至少 100 项；A3/J1/J2 owner 跳转、J 域筛选与搜索；403、重复 canonical key 的畸形 200、503 均失败关闭并恢复；合同 `3/3` | 通过 |
| A6 角色管理 | `/platform/roles` | 新建空角色；未知权限/菜单 422 且零副作用；权限+菜单联合授权进入 A2；checker 批准后原子生效；角色删除再次走 A2；最终角色与 pending 工单为 0 | 通过 |
| A7 菜单管理 | `/platform/menus` | 可见 UI 创建父子菜单；同键重放同 ID；同键异载荷拒绝；并发同键为 200/409 后稳定重放；活跃子菜单、角色绑定分别阻止停用/删除；CAS 与理由长度校验；最终菜单为 0 | 通过 |
| A8 权限字典 | `/platform/permissions` | 权限总数 319；未归类 31 条与服务端真值一致；畸形/503 分支失败关闭并可恢复；越界页为空；AUDITOR 可读 A6/A7/A8，POST/PUT/PATCH/DELETE 均 405，字典总数不变 | 通过 |

## 十步验收记录

### 1. 页面与动作盘点

- 范围源为 `lib/nav/console-nav.ts`：A1 账号、A2 审计、A3 配置、A4 事件、A5 参数寄存器、A6 角色、A7 菜单、A8 权限。
- A6–A8 主链覆盖角色、菜单、权限、账号、会话、MFA、A2 审批与审计拒绝，不把一个域级结论代替模块结论。

### 2. 字段与权威来源

- A1：管理员、账号状态、角色关系、MFA 状态和服务端会话。
- A2：操作队列、执行历史与审计日志；maker/checker 身份来自真实会话。
- A3/A4/A5：真实页面与合同均只接受服务端声明值和完整运行时结构，不使用本地持久化真值；可逆写后均以服务端 overview 回读裁决。
- A6/A7/A8：角色、菜单、权限目录由 `/api/admin/platform/*` 权威接口读取；前端不使用 localStorage 作为授权真源。

### 3. 真实 Chromium 用户路径

- A1–A8 各自使用新的 Playwright 进程/上下文从 `/` 登录页进入，并通过 `aside` 内可见“平台基础”分组和对应模块链接导航；表面锁定 `8/8` 通过。
- A3/A4 使用两个独立新上下文执行真实可逆写入、刷新、退出与重新登录；A5 单独新上下文执行真实目录、筛选、owner 跳转及恢复。
- maker 与 checker 使用两个独立浏览器上下文；没有复用认证状态。
- 主流程无 mock、无 DOM 直接修改、无 localStorage 权威数据。A5/A8 的 403、503、畸形响应仅用于异常分支。

### 4. 主流程、空态、刷新、返回、退出重登

- A3 开关真实切换后服务端与页面均显示 `on`，回滚后刷新和重登仍为 `off`。
- A4 Day0 真实调整后服务端与页面均显示 `91 秒`，回滚后刷新和重登仍为 `90 秒`；family 抽屉可查看真实事件清单。
- A5 真实目录、owner 跳转、筛选与搜索均通过；异常注入移除后恢复服务端目录。
- A6 授权后刷新仍为 1 个权限码、2 个菜单。
- 自定义只读账号真实退出、首次重登后只获得 `platform_a6_read` 和授权菜单。
- A8 搜索、未归类、越界空页、失败后重试恢复均按服务端真值展示。

### 5. 五层权限

- 匿名读取 A6/A7/A8 均为 401。
- 自定义角色只有 A6 读权限和授权菜单：A6 200，A7/A8 接口 403。
- AUDITOR 可读 A6/A7/A8，但 A6/A7 无变更权限，A8 写方法为 405。
- D/I 下游夹具另行创建了目标域 readonly、有菜单无写、无菜单三类账号；其目标域读/跨域读/目标域写/跨域写矩阵已实际验证。

### 6. 异常与失败关闭

- 401：匿名访问拒绝。
- 403：同一 maker 审批、只读角色越权、无菜单与跨域访问均失败关闭。
- 409：幂等执行中、同键异载荷、父子/角色绑定关系冲突均没有部分副作用。
- 422：未知授权对象、理由过短、缺失 CAS 版本均拒绝。
- 403/503/畸形 200：A5/A8 清除旧权威数据并展示中文失败关闭或恢复入口；移除异常注入后重新读取服务端真值。

### 7. 幂等、CAS 与并发

- A7 相同幂等键重放得到相同菜单 ID。
- 同键异载荷返回 `IDEMPOTENCY_KEY_PAYLOAD_MISMATCH`。
- 双请求同键并发得到 200/409，稳定重放后数据库中仅一条。
- A1/A7 清理每一步重新读取最新 `version`，不复用上一步 CAS。

### 8. 数据、状态、A2/A4 与上下游

- A6 联合授权在 checker 批准前权限和菜单均为空，批准后一次性同时生效。
- A7 三类关系约束拒绝均产生 `A7_MENU_MUTATION_REJECTED` 高风险审计。
- A3 的前向和回滚写均进入 A2 不可改审计；A4 的 Day0 前向与回滚同样保留理由和服务端留痕。
- A6 删除提案 `WO-260728155618457-900` 由独立 checker 批准后角色消失。
- D/I 权限角色授权工单 `WO-260728154504238-500`、`WO-260728154504386-0` 已由独立 setup checker 批准。

### 9. 精确清理

- A6–A8 最终运行的角色、父菜单、子菜单、并发菜单、linked/auditor/checker 账号关系及会话全部清理；最终为：
  - 活跃角色 0；
  - 活跃菜单 0；
  - pending 工单 0；
  - 临时账号均 `disabled/unassigned/tfa=false/sessions=0`，登录 403。
- A3 已恢复 `ops.maintenanceBanner=off`；A4 已恢复 `day0=90 秒`。A4 临时载具第一次断言中断后，也在继续执行前从可见页面立即恢复，最终没有配置漂移。
- 早期中断留下的 `RTMS49R6TN`、`ZRTMS49VRQ2`、`CRTMS49VRQ2` 与账号 99337 已恢复并清理。
- D/I 的 8 个交付账号与两个自定义角色不是残留，而是本 Run 仍在租用的权限夹具；凭据仅存放在受限文件，最终清理顺序见下节。

### 10. 初审评分

**97.8 / 100，通过。** A1–A8 已完成 Owner 双轨验收，未关闭产品缺陷为 0；扣分项为 A4 临时验收载具曾因单位规范化断言中断，但已即时恢复、修正并完整重跑。非 Owner 复审仍须独立执行，Owner 不提前签发复审分。

## A-AUTO-001 闭环

- 编号：`A-AUTO-001`
- 等级：P1（验收基础设施，不是产品缺陷）
- 复现：
  1. 旧脚本使用 `superadmin` 创建角色后又由同一账号批准删除，后端正确返回 `403 A2_MAKER_CHECKER_REQUIRED`；
  2. A1/A7 写请求没有跟进最新 `expectedVersion` 契约；
  3. 账号创建仍假定客户端提交的密码生效，但后端实际签发随机临时密码；
  4. 侧栏 helper 在分组已展开时仍无条件点击，折叠动画覆盖子链接。
- 根因：验收脚本落后于 maker/checker、服务端临时密码、CAS 和侧栏交互契约。
- 实际修复：
  - 使用独立 checker 浏览器上下文审批 A2；
  - 使用后端返回的 `temporaryPassword` 完成首次登录；
  - A1/A7 每次写前重新读取最新版本；
  - 加入中断夹具恢复和精确清理；
  - 导航限定在 `aside`，仅当目标 link 不可见时展开并显式等待，不使用 `force` 或固定 sleep；
  - A8 未归类改为与服务端动态真值比对，不再硬编码 0。
- 完整复验：统一候选新 Run `MS4AXL7H` 为 `1/1` 通过，43.8 秒；最终清理全部通过。
- 当前状态：**已关闭**。

## A-AUTO-002 闭环

- 编号：`A-AUTO-002`
- 等级：P3（临时验收载具，不是产品缺陷）
- 复现：A4 Day0 已从 `90 秒` 成功写为服务端规范值 `91 秒`，临时脚本却用 `91秒` 做严格字符串断言，误判并在回滚前中断。
- 根因：验收脚本未按服务端“数字 + 空格 + 单位”的规范化格式比较。
- 实际修复：立即从可见 A4 页面把 Day0 恢复到 `90 秒`；随后统一目标值与回读格式，并保留前向、回滚、刷新、退出重登四层断言。
- 完整复验：`90 秒 → 91 秒 → 90 秒` 全链路通过，最终服务端真值为 `90 秒`；页面错误、控制台错误和非预期 5xx 均为 0。
- 当前状态：**已关闭**。

## D/I 权限夹具交付与清理

受限文件：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260728-151023\A\permission-fixtures.json`

交付标识：

- D readonly：`99359 / acc_d_ro_r151023_ajuki`
- D 有菜单无写：`99360 / acc_d_nw_r151023_ajuki`
- D 无菜单：`99361 / acc_d_nm_r151023_ajuki`
- I readonly：`99362 / acc_i_ro_r151023_ajuki`
- I 有菜单无写：`99363 / acc_i_nw_r151023_ajuki`
- I 无菜单：`99364 / acc_i_nm_r151023_ajuki`
- D maker：`99365 / acc_d_maker_r151023_ajuki`
- D checker：`99366 / acc_d_checker_r151023_ajuki`
- 自定义角色：`4036 / ACC_D_NW_R151023_AJUKI`、`4037 / ACC_I_NW_R151023_AJUKI`

验证矩阵：

| 夹具 | D 读 | I 读 | D 写 | I 写 |
|---|---:|---:|---:|---:|
| D readonly / 有菜单无写 | 200 | 403 | 403 | 403 |
| D 无菜单 | 403 | 403 | 403 | 403 |
| I readonly / 有菜单无写 | 403 | 200 | 403 | 403 |
| I 无菜单 | 403 | 403 | 403 | 403 |

清理必须遵守：

1. 保留 D checker，先处理其余 7 个交付账号。
2. 每次账号写前重新 GET 账号 overview，取最新 `expectedVersion`。
3. 依次执行 MFA reset（仅 tfa=true）、role=unassigned、status=disabled、sessions revoke（仅 sessions>0）。
4. 确认 D/I 受限账号解绑后，由 `superadmin` 提交两个自定义角色删除工单。
5. 由仍启用的 D checker 独立批准角色删除。
6. 最后清理 D checker，并核对账号、角色、A2 工单、Redis 会话和幂等记录残留为 0。

## 自动化与合同结果

- A1–A5 + RBAC 前端合同：`54/54` 通过。
- A1–A8 统一候选表面锁定：`8/8` 通过；每模块独立新上下文，均覆盖刷新和退出重登。
- A3/A4 真实可逆主流程：`2/2` 通过；A5 真实 Playwright：`1/1` 通过。
- A6–A8 真实 Playwright：`1/1` 通过，`workers=1`，43.8 秒；`A-AUTO-001` 无回归。
- TypeScript：`tsc --noEmit` 通过。
- 页面异常、控制台异常：0。
- 最终运行未出现非预期 `/api/admin/*` 5xx。

## 证据与校验值

受限证据目录：

- `D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260728-151023\A\candidate-PiK9WG2ICz0efJAeLyFZA\a3-a4-live`
- `D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260728-151023\A\candidate-PiK9WG2ICz0efJAeLyFZA\a5`
- `D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260728-151023\A\candidate-PiK9WG2ICz0efJAeLyFZA\a6-a8`

| 证据 | SHA-256 |
|---|---|
| `a3-a4-live/runtime-evidence.json` | `1B64B9BEE0D63EB548AEAA56AA5AC9E237AB7B80EDFCE1AFE339018EF0F458CA` |
| `a3-a4-live/a2-audit-evidence.json` | `E022099B2A4BAF5C7A147EDCD5E2C87D98C483FEB05A672935E0CFA652ABEFFF` |
| `a5/01-live-registry.png` | `C90E83F344C028B0BD1B8DA1AE42F27A0A600E27A803401223BAFFDF48BA52B2` |
| `a6-a8/runtime-evidence.json` | `7E8C8CDC6AD38683EE95EB3F1A7729DEB409ECBF7E2B16284F15313A86BA18EF` |
| `a6-a8/09-clean-state.png` | `4E3865D84DE04699477863A9DD7FE6AA16F562E547EA0D56C5B6365E12899BB1` |
| `permission-fixtures.json` | `B5E4DABC41CC2ABA450E8681D6A19559618967CFA88706E8090CAD8C86DFD53E` |

Trace、失败视频、认证状态、TOTP 和密码只保留在受限目录，不进入 Git。最终结案时由主智能体保留最终域级证据、删除调试运行产物并执行凭据扫描。

## 非 Owner 复审入口

1. 在同一锁定候选上使用新账号、新浏览器上下文从登录页和可见侧栏完整重跑 A1–A8，不复用 Owner 结论。
2. 使用新浏览器上下文攻击 maker/checker、自身审批、CAS 旧版本、同键异载荷、失败关闭、刷新重登与权限缓存。
3. 复审结束后按受限文件清理 D/I 租用夹具，不得提前清理正在运行的 D/I 权限轨。

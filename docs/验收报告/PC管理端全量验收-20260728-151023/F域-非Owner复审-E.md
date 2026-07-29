# F 域非 Owner 复审报告（E→F）

- Run ID：`pc-full-acceptance-20260728-151023`
- 复审者：E 域 Owner，按 `E→F` 轮换执行
- 范围：F1–F5（5/5 模块）
- 锁定源码基线：PC `91d1c2d`、后端 `a1cc2a7`、App `0e2178b`，以及本轮未提交修复
- 最终 PC 候选：Build `nXIUnp090z-thvAfE4RAj`，PID `13928`
- 最终后端候选：PID `22092`，JAR SHA-256 `D99C951BB40FA6C24B5B75E1040996B1B0ACECBE11F79C5D7F845E9372EBD2CB`
- 隔离数据库：`nexion_acceptance_20260728_151023`
- Owner 初审：`98.8/100`
- 非 Owner 复审：**`99.2/100`**
- 最终结论：**F1–F5 5/5 通过；F 域未关闭 P0/P1/P2/P3 为 `0/0/0/0`**

## 逐模块独立结论

| 模块 | 复审范围 | 对抗性证据 | 独立结论 |
|---|---|---|---|
| F1 V-Rank | `/api/admin/teams/ranks`、晋升日志、奖励派发；13 阶、门槛、奖励、治理与展示配置；App V-Rank 公共投影 | 从登录页和可见侧栏进入，覆盖空态、取消、刷新、返回、退出重登、畸形 200、401/403；`F.prize.name` 同键同载荷精确回放 200、同键异载荷 409、终值保持 `Nexion V-Rank`。修复共享配置端点后，纯 F1 writer 合法、F2–F5 writer 越权 403、未知 key 失败关闭 | **通过** |
| F2 费率与政策 | `/api/admin/teams/rates`；层级费率、政策参数、B1 红线与 App 佣金配置投影 | HTTP 500、畸形 200 清空不可信快照并恢复；`F.influence.clampMin` 同键回放 200、异载荷 409，终值保持 `1.0`；F1 writer 不能改 F2 key | **通过** |
| F3 双轨结算 | `/api/admin/teams/binary`、`/binary/settlements`；H1 节奏、B1 覆盖、D4 账本、A2/A4/outbox | 修复前同 key 可作用两个 owner；修复后同 key 同载荷精确回放、异载荷 409，新 key 可进入业务但同 owner/date 只保留一条 mutex。隔离 owner 不存在时仅返回 `BLOCKED/BINARY_OWNER_NOT_ACTIVE`，settlement、commission、ledger、audit、outbox 均未产生 | **通过** |
| F4 领导池与团队运营 | `/api/admin/teams/leadership-pool`；票权、配额、大使、榜单、周结算及 B1/D4/A2/A4 | 从可见侧栏完成读取、空态、跨域入口、刷新重登；直接结算缺少 A2 确认稳定 409 `A2_CONFIRMATION_REQUIRED`，近五分钟未新增结算 mutex；权限点互不替代 | **通过** |
| F5 佣金审计 | `/api/admin/teams/commissions`；事件筛选、处置、补发、冲正、暂停及 D4/B1/L4 跳转 | 缺失事件冲正 404 且零业务副作用，同 key 异载荷 409；畸形 200、404/422、只读/无菜单权限均失败关闭；D4/B1/L4 路由和权威来源一致 | **通过** |

## 按验收方法复审

1. 页面与动作盘点：以 `lib/nav/console-nav.ts` 的 F1–F5 为唯一范围，重新盘点读取、筛选、空态、编辑/提案、资金处置和跨域入口。
2. 字段与数据溯源：复核 PC BFF、`f1-client`、后端 F 聚合和 `nx_v_rank_config`、`nx_team_member`、`nx_commission_rule`、`nx_binary_*`、`nx_commission_event`、`nx_wallet_ledger`、A2/A4/outbox；未以 mock、localStorage 或 DOM 修改替代权威数据。
3. 真实用户轨：使用全新 Chromium 上下文，从登录页和可见侧栏逐模块点击；主流程、空态、确认取消、返回、刷新和退出重登均重新执行。
4. 五层权限：readonly、no-write、no-menu 三账号覆盖菜单、路由、按钮、接口和数据。F1–F5 只读为 200、写为 403且按钮隐藏；无菜单账号侧栏不可见，直接路由、读取和写入均为 403。
5. 异常边界：覆盖匿名 401、权限 403、404、422、500、网络超时/结果未知和五模块畸形 200；旧快照与写入口在不可信响应下关闭，移除故障注入后由真实上游恢复。
6. 幂等、CAS 与并发：F1/F2/F3 使用持久、载荷绑定的稳定 key；同键同载荷回放、同键异载荷 409、新 key 业务唯一性均有真实 HTTP 与数据库证据。Owner 的独立 maker/checker、自批拒绝、对象锁和 `[200,409]` CAS 证据在新候选上由合同与完整入口回归继续锁定。
7. 权限攻击：D 域 maker 携 A2 proposal-create 尝试创建 F1 配置提案仍为 403、无泄漏工单；`F-005` 用最终 JAR 单元合同覆盖纯 F1 正向、F2/F3/F4/F5→F1 403、F1→其他域 403和未知 key 拒绝。
8. 落库与跨域：F3/F5 安全探针的 settlement、commission、ledger、A2、A4/outbox 均为 0；F1/F2 同值幂等探针各保留一条不可变 `F_TEAM_UI_CONFIG_CHANGED` 审计，不产生 outbox，最终配置值无漂移。
9. 精确清理：删除 F1/F2/F3/F5 与异常/跨域轨测试幂等、F3 mutex；四个权限夹具 `99405–99408` 按最新 CAS 清除 MFA、解绑角色、停用并撤销会话，原凭据登录均 401/403；对应 A1 create/cleanup 幂等精确删除。
10. 最终锁定：Build、JAR、PID 在最终候选期间未漂移；`git diff --check` 通过，调试视频、失败截图、重复 trace 已删除，受限证据不进入 Git。

## 缺陷闭环

| 编号 | 模块 | 根因与修复 | 最终复验 |
|---|---|---|---|
| F-001 | F1–F5 | 五个 normalizer 吞掉运行时协议缺失；新增严格协议并在失败时清空旧快照、隐藏写入口 | 畸形 200 `5/5`，500/超时/真实恢复 `3/3`，通过 |
| F-002 | F1–F5 | 页面未读取 session authority；五个子模块按 22 个精确权限点守卫 | readonly/no-write/no-menu 最终覆盖 `3/3`，通过 |
| F-003 | F1–F4 | A2 guard 漏掉三类 F 配置回放；按 key、op、sourceDomain 单源映射 | D→F 跨域攻击 `1/1` 为 403，Owner maker/checker 全链保持通过 |
| F-004 | F1/F2/F3 | 命令只校验 key 非空，未持久 claim、回放或绑定载荷；接入 `AdminIdempotencyService` 与 SHA-256 规范哈希 | F1/F2 `1/1`、F3 `1/1`、F4/F5 `1/1`；回放、异载荷 409、新 key 唯一性及清理全部通过 |
| F-005 | F1 | 共享配置 controller 漏掉 F1 writer，service 对四类 F1 UI key 无精确映射；补入口资格和 key 级最终授权 | `OpsTeamServiceTest 71/71`、`OpsTeamControllerTest 9/9`、PC F 合同 `36/36`，真实跨域/受限账号轨通过 |

## 验证汇总与载具波动

- 最终锁定核心 Chromium：首轮 `14/15`；唯一未完成项是 `f_no_menu` 首次登录表单瞬时回到空账号/空密码，验证码页未出现，尚未发出 F 域业务请求。
- 该波动未被忽略或改判；使用全新 Chromium 上下文完整重跑同一 no-menu 用例 `1/1`，菜单、路由、读写 403、刷新和退出重登全部通过。
- F1/F2 配置幂等：`1/1`。
- F3 结算幂等：`1/1`。
- F4/F5 高风险失败关闭：`1/1`。
- D→F 跨域权限攻击：`1/1`。
- 权限夹具安全清理：`1/1`。
- F 合同：`36/36`。
- 后端 F-005 定向测试：`80/80`。
- 页面脚本错误：`0`；主流程非预期 `/api/admin/*` 5xx：`0`。

载具波动记录位于受限证据 `non-owner-E/carrier-fluctuation.md`。它只解释首轮为何未完成，不替代全新上下文的通过证据。

## 最终残留与证据

最终数据库核对：

- F 验收幂等：`0`
- F3 mutex / settlement：`0 / 0`
- 隔离 commission / ledger：`0 / 0`
- F pending / 活动对象锁：`0 / 0`
- F 测试 outbox：`0`
- 权限夹具有效角色 / MFA secret / 会话 / 可登录账号：`0 / 0 / 0 / 0`
- 最终配置：`team.ui.F.prize.name=Nexion V-Rank`，`team.ui.F.influence.clampMin=1.0`
- 不可变审计：F1/F2 幂等探针各 `1` 条，作为预期证据保留，不属于可清理残留

受限证据目录：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260728-151023\F\non-owner-E`，共约 `81.9 MiB`；保留 21 个最终/缺陷关键 trace（含权限夹具安全清理 trace），视频为 0。关键校验值：

- `global-config-proof/http-result.json`：`C40E634B20F3E7A5906029FB46411D1A74049E76ECB9212EB6BB5DF584ECDBBC`
- `funds-proof/http-result.json`：`476FAD229E65EB573B4BB8837602D8E2B16A572B237A84BD49A484ADF2828233`
- `funds-proof/f45-http-result.json`：`4A8A14043FE54CDFE8D9BB3D89BF3870BBD574EDB5C8298141253D9BCAB69524`
- `carrier-fluctuation.md`：`B556AC8856CED2706E9EEDA906D758C485FCADB5600149D131A1B9ABE9A29718`

## 范围边界、评分与健康值

`G-002` 属于 G 域 Owner/非 Owner 的缺陷与裁决范围，不计入 F 域缺陷数量或 F1–F5 结论；若它改变共享候选，主控应按 G 域影响面重新锁定，但本报告不越权代替 G 域裁决。

Owner 初审 `98.8/100`，已超过 `96` 门槛；E→F 非 Owner 复审 `99.2/100`，已超过 `98` 门槛。复审过程发现并关闭 `F-004/F-005` 两项 P1，没有未关闭缺陷或不可恢复数据漂移。初始血量 `100/100`，本轮无评分扣血，完成任务恢复值受上限约束，最终健康值 **`100/100`**。

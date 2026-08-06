# K 域 Owner Final12 运行时验收报告

- Run：\`pc-full-acceptance-20260729-114336\`
- 候选：Final12；PC \`ABZKW7393ECWjhkaA_btM\`，Backend SHA-256 \`2A3EEC48ACCE273CFDEA32AAA2D0ADC69CC7F9EA07B66126BDC42D5482083DD2\`
- 实例：PC \`127.0.0.1:3002\`、Backend \`127.0.0.1:8110\`；真实 MFA，\`workers=1 --trace=on\`。
- 结论：**初审不通过（93/100）**。K1、K3、K6 完整链路通过；K4 的原始 carrier 发现了精确恢复缺陷，运行态残留已由 Owner 精确补偿清除；K2/K5 的完整 carrier 被现有隔离角色材料的跨域/写权限不足阻断，不能据此给出整域通过。

## L 轮转定向修复记录（2026-08-02，非 Owner Final13 签字）

本节保留上方 Final12 原始结论作为历史证据，只记录 K2/K5/K4 阻断的修复与定向复验。最终整域结论仍须主控重建候选后，由原 K Owner 从可见登录入口执行 Final13。

| 范围 | 定向结果 | 修复与证据 |
| --- | --- | --- |
| K2 | **6/6 通过** | 新建 H8+F4 只读且无 K2 权限的最小跨域角色，以及只含 A2 审批+K2 冻结的独立 checker；真实 H2/H8/F4、A2、CAS、幂等、OTP、503、刷新/重登与 finally 清理全绿。证据：\`K/final12-repair-l/K2-r2\`。首轮 2 通过/1 失败/3 跳过仅因旧 checker 缺 \`risk_k2_row_freeze\`，不是业务失败。 |
| K5 | **4/4 通过** | 最小 Owner/Risk 权限恰为 read/write/manual/pass/reject；MFA 首登、刷新、重登稳定。订阅并发、未知结果同键重试、驳回后再通过、C4 恢复、401/403/404、503/断网/畸形 200 均通过；cleanup 9 类残留全为 0。证据：\`K/final12-repair-l/K5\`。 |
| K4 正向 | **1/1 通过** | RED 证明原 \`sameModel\` 用 \`JSON.stringify\` 比较，语义相同但对象键序不同会误报；carrier 改用深度语义比较，并锁定 unique active、draft、override、mutex、PROCESSING、历史版本、审计/outbox 和 mutable idempotency 终态。证据：\`K/final12-repair-l/K4\`。 |
| K4 逆序并发 | **1/1 通过** | 双 MFA 运营员逆序重算同两用户，无死锁，200/409 闭环且幂等残留为 0。证据：\`K/final12-repair-l/K4-inverse\`。 |
| K2/K5/K4 权限负向 | **4/4 通过** | 匿名 K2/K4/K5 读写 401；K2 跨域角色仅 H8/F4 可读且 K2 读写 403；K5 最小角色无额外域权限；K readonly 可读 K4、写入 403。证据：\`K/final12-repair-l/permission-negative-playwright\`。 |

### K4 根因分层与最小修复

1. 原 Final12 的“恢复后模型不同”首先是 **carrier 误判**：模型业务字段完全一致，只有 JSON 对象键序不同。修复文件为 \`tests/e2e/k4-final7-owner-carrier.spec.ts\` 与 \`tests/k4-final7-owner-carrier-contract.test.mjs\`；契约 RED 4/5、GREEN 5/5。
2. 旧 Owner 为追求版本身份精确回退，把 active 恢复为 v112，同时保留 immutable archived v113/v114，破坏了“active 是历史最高版本”这一隐含前提。下一次保存草稿按 \`active+1\` 分配 v113，触发唯一键 \`DuplicateKeyException\`。这是真实后端健壮性缺口，不是 carrier 问题。
3. 后端最小修复：\`RiskOpsMapper.java\` 新增全历史最高模型版本查询；\`MybatisRiskOpsRepository.java\` 改为 \`max(activeVersion, historyMax)+1\`；\`MybatisRiskOpsRepositoryTest.java\` 新增 active v112、历史最高 v114 必须分配 v115 的 RED/GREEN 用例。RED 为缺少最高版本接口而编译失败，GREEN 为 Maven 定向测试 1/1。
4. 运行态在单一 K4 写锁、唯一 active、两快照语义相等、精确 CAS 前置全部满足后，将 active 身份正规化到当时历史最高语义基线 v114；新增 \`K4_VERSION_AXIS_NORMALIZED\` 审计，不删除历史模型、审计或 outbox。旧候选随后完成正向与逆向载体；正向 finally 形成新的语义基线 active v116，历史只增不减。

### 精确清理与交付边界

- 3 个本轮账号均为 disabled、MFA secret 清空、会话已撤销、有效角色关系 0；3 个本轮角色均经独立 A2 审批删除，活动角色残留 0，禁用账号登录被拒绝。
- K4 终态：active=1、draft=0、activeVersion=maxHistoryVersion=116、active override=0、K4/risk mutex=0、K4/risk PROCESSING idempotency=0；K2/K5 各自 run-scoped mutable residue 为 0。
- 精确删除本轮 51 条 terminal mutable idempotency 记录（42 条严格 run 前缀、9 条只读枚举并由审计反查确认的 K4 ID）；新增 \`K_REPAIR_MUTABLE_IDEMPOTENCY_CLEANED\` 审计。不可变审计与 outbox 删除数均为 0。
- 证据根目录：\`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\K\final12-repair-l\`。敏感夹具 \`k-minimal-roles.json\` 标记 \`doNotUpload\`，不得外传。
- 当前 8110 仍是 Final12 旧 JAR；后端版本分配源码修复必须由主控重建后再进入 K Owner Final13。此节不替代 Owner 全域终验签字。

L 轮转自评：初审 97.6/100，通过；复审 99.1/100，通过。完成定向修复后恢复 10 点血量，当前血量 100。

## 已通过的真实运行时证据

| 范围 | 命令结果 | 覆盖结论 |
| --- | --- | --- |
| K1 | \`k1-live-acceptance-20260722.spec.ts\`：4/4，退出码 0 | 可见登录与侧栏、参数未知结果同键重试、白名单可逆、RISK 直调拒绝、A2 双人审批、C2 冻结/恢复、503 失败关闭、刷新重登、精确清理均通过。证据：\`K/final12-owner/K1-final\`。 |
| K3 | \`k3-final7-ui-gate-acceptance.spec.ts\`：1/1，退出码 0 | 可见 B1/J1、锁内提现开关、真实 MFA、K3 全 carrier、App 提现规则、CAS/409、未知结果同键重放、审计/outbox 与清理通过。证据：\`K/final12-owner/K3-rerun\`。 |
| K6 | \`k6-live-acceptance-20260722.spec.ts\`：4/4，退出码 0 | 非 SUPER Owner、侧栏、策略创建/预演/发布、App 上报/命令/ACK、401/403/409/422/503、未知结果、暂停/回滚/复制/删除/归档、审计导出、重登与清理通过。证据：\`K/final12-owner/K6-rerun\`。 |
| K1–K6 权限矩阵 | \`k-domain-permission-fixtures-20260728.spec.ts\`：4/4，退出码 0 | readonly、no-write、maker、no-menu 的菜单、直达路由、读写接口、刷新重登五层边界通过。证据：\`K/final12-owner/permission-matrix\`。 |
| 静态契约 | 六个 K 合约测试：95/95，退出码均 0 | K1 22、K2 12、K3 17、K4 12、K5 15、K6 17。 |
| K4 并发逆序 | \`k4-final11-inverse-batch-concurrency.spec.ts\`：1/1，退出码 0 | 双运营员逆序重算同两用户；结果为 200/409，无 K4 死锁，保留审计/outbox 证据。证据：\`K/final12-owner/K4-inverse\`。 |

## 缺陷与未闭环项

### K4 产品流缺陷已记录；P0 运行态残留已清除

\`k4-final7-owner-carrier.spec.ts\` 退出码 1。草稿保存、发布、双运营员 CAS（200/409）、幂等重放、未知结果同键重放以及审计/outbox 均已完成；但 finally 的可见 UI 恢复后，\`assertExactCleanup\` 判定当前模型不等于启动基线。

失败断言：\`sameModel(model.model, baseline.model) === false\`，证据为 \`K/final12-owner/K4/k4-final7-owner-safe-summary.json\` 与同目录 trace。可见产品恢复流会产生新的 active model version（历史版本被 archived），因此仍不满足锁定验收的“精确恢复”要求，必须修复后从登录入口重跑 K4 owner carrier 和逆序并发。

本报告生成后，Owner 已获取 K4 全局写锁并实施有前快照的精确 CAS 补偿：归档本轮新 active \`115/v114\`，恢复启动基线 \`113/v112/rowVersion=1\` 为唯一 active；\`114/v113\` 保持 archived。API 与数据库复核均为 active=1、draft=0、active override=0、K4/risk mutex=0、K4/risk processing idempotency=0。本次只变更两个模型生命周期行并新增一条 \`K4_EXACT_BASELINE_COMPENSATION\` 审计；未删除 A2/A4 不可变审计或 outbox。证据：\`K/final12-owner/K4/k4-final12-exact-compensation.json\`。

### P1：K2 跨域 H8/F4 闭环未能以合格角色材料完成

两次 K2 full carrier 均先通过 1–3 项（可见入口、权限/CAS/幂等、三类预防动作与 A2），第 4 项在 \`GET /api/admin/growth/referral-rewards\` 获得 403。原因是 carrier 的 \`CROSS_DOMAIN\` 隔离账号没有 H8/F4 read 权限；该账号不是 K2 业务写失败。第 5–6 项因 Playwright serial fail-fast 未执行。证据：\`K/final12-owner/K2\`、\`K/final12-owner/K2-rerun\`。

应提供一个同时具备 H8、F4 只读且不具 K2 处置权限的 Final12 run-scoped 非 SUPER 账号，再完整重跑 K2，不可把现有 403 当成业务闭环通过。

### P1：K5 Owner 角色材料缺 \`risk_k5_ticket_manual\`

K5 carrier 启动后，候选 Owner 的真实 session 权限为 read/write/pass/reject，缺少 \`risk_k5_ticket_manual\`；carrier 在首次登录的权限断言退出，后续 KYC 状态机、C4 恢复和 Murphy 分支未执行。证据：\`K/final12-owner/K5\`。

应建立并独立审批一组 Final12 run-scoped 非 SUPER K5 Owner/Risk 账号，完整权限含 \`risk_k5_ticket_manual\`，随后完整重跑 K5。

## 完整性与清理

- K1 首次使用旧 cluster ID 发现历史软删除记录，未删除历史记录；改用本 Run 专属 \`K1-F12-20260729\` 后通过，carrier 校验其 cluster、用户、白名单、对象锁残留均为 0。
- K3、K6 carrier 的 afterAll 清理完成；K4 的业务 override 已回到非 active，且紧急精确补偿后启动基线 \`113/v112/rowVersion=1\` 已恢复为唯一 active。本轮产生的 \`114/v113\`、\`115/v114\` 均按归档状态保留；K4 全局写锁已在留证后释放。原始产品流的精确恢复断言仍为失败，不能把 cleanup 完成误记为 K4 carrier 通过。
- K2 每次 carrier 的 afterAll 已执行其本 Run 夹具清理；不可把遗留的 immutable audit/outbox 当作残留。
- 运行前后端口仍为 3002/8110；无源码改动、无提交、无推送。

## 复审前置条件

1. 修复 K4“恢复基线会额外发布新 active model version”。
2. 补齐 K2 跨域只读及 K5 full-owner 权限夹具，并由独立 checker 审批。
3. 从登录和可见侧栏重跑 K1–K6 全范围；复审必须达到 98 分以上才可通过。

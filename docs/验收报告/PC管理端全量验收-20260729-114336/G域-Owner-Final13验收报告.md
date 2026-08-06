# G 域 Owner 验收报告（Final13）

- Run ID：`pc-full-acceptance-20260729-114336`
- 范围：G1、G2、G3、G4、G7，以及 App staking/repurchase 的资源、账号和命令代际隔离。
- 候选：Final13；PC `3002` Build `lqlGobSf9dgLarrRkjFGn`（PID `23716`），后端 `8110`（PID `18752`），JAR SHA-256 `34706D1FC0AD02923AEB6217B405D90FAA47730387266E56D9336BA0564557A7`。运行锁 SHA-256：`E01C6DEB2E93203067670156BFD22F0C42DF0672CE4CA58B0A5F9A2D142AC15E`。
- 锁定 App 根：`D:\workspace\.acceptance\pc-full-acceptance-20260729-114336-app-master`，HEAD `0e2178b59af96b198188fc5992e9e7fa48425a00`。
- 结论：**HOLD**。App 代际修复、可见入口、权限、失败关闭、未知结果和已执行的可逆写均通过；但 G7 成功审计记录缺少可供 A2 归属为 G 的 domain/sourceDomain，且用于跨域 A2 核验的只读夹具没有 G 域可见范围。不能以 Final13 签发整域通过。

## 通过的验收轨道

- App 动态矩阵：`tests/g-final12-g005-g007-evidence.test.ts` 在锁定 App 根运行，通过 1 个承载 **12/12** 断言的矩阵。覆盖 G005 最新 pool 读胜出、G006 两类部分成功不清除合法资源、G007 账号切换后旧 pool/position/refresh 响应及 finally 不覆盖 B、当前请求正常结算，以及 staking/repurchase 命令回执不被旧读回写。证据 `G/final13-owner/g005-g007-matrix-final13.json`，SHA-256 `95E69A58EAFE4A20277F4A48F3C1D5A53C2B7674E9CB5A95BCBF6C3CD473238E`。
- App 回归：`npm.cmd test` 为 `57 files / 265 tests` 通过；`vue-tsc --noEmit` 返回成功后 H5 编译输出 `Build complete`（命令进程未退出，验收载具在 120 秒超时，未把该超时计为产品失败）。
- G1/G2/G3/G4/G7 静态闭环合同：23/23 通过；`NEXION_APP_ROOT` 明确指向上述锁定 App 根。
- 真实 Chromium、`workers=1 --trace=on`：正常 MFA 登录、首次用户由可见 G 侧栏进入五页、五个管理读端点的 canonical 标记、刷新与重登通过；匿名管理 BFF 401、五个 App 公共投影仅在可信边缘 200、四个用户命令匿名 401 通过。
- 权限：readonly、no-write、no-menu 三角色的菜单/直路由/读写 API/按钮/刷新重登五层检查 `3/3` 通过；匿名分支受 `ADMIN_AUTH_EPOCH_CHANGED` 载具拦截，但已经由独立 Final13 匿名真实 HTTP 核验通过，未冒充为该载具通过。
- 畸形成功包、G7 500、G3 超时/未知并恢复：`6/6` 通过。未知结果与确定性拒绝的 UI 命令键语义：G1、G2、G3、G4、G7 共 `10/10` 通过。
- 已完成可逆写：G4、G7、G3 在真实页面执行成功写、同键 replay、异载荷 409、独立第二运营员 G3 CAS（仅一方成功）、精确 restore 与管理/App 投影一致；对应 trace 保留在 `G/final13-owner/playwright-write-lifecycle`。G1 正向写及真实 unknown-outcome 需要 B1 可恢复子库，当前共享候选红线禁止向下恢复；G2 手续费收紧为不可逆，测试只允许隔离子库执行，均未在共享候选越权尝试。

## 审计与 Outbox 取证

从写 trace 提取的主命令均为 UI 发起且返回 200：

| 域 | method/path | 成功键及结果 |
| --- | --- | --- |
| G4 | `PATCH /api/admin/market/nex/genesis/params/royalty` | 写入 200、同键 replay 200、异载荷 409、restore 200；对象 `royalty` |
| G7 | `PUT /api/admin/market/nex/repurchase/config/lockDays` | 写入 200、同键 replay 200、异载荷 409、restore 200；回执 `76f378dad54543eeab0babaa782de975` |
| G3 | `PUT /api/admin/market/nex/curve` | 写入 200、同键 replay 200、异载荷 409、CAS 第二写 409、restore 200；对象 `wallet.nex_market.weekly_curve` |

- 主库 `nx_audit_log` 在 02:12:46–49 写入同一 maker 的 G4 `G4_GENESIS_PARAM_CHANGED` 2 条、G7 `ADMIN_REPURCHASE_CONFIG_CHANGED` 2 条、G3 `G3_WEEKLY_CURVE_CHANGED` 4 条；每条携带对应 idempotencyKey。故“成功写没有审计”的初始判断已撤回。
- A4 outbox 已在同一事务边界生成：G4 `admin.genesis_param_changed` 2 条、G7 `admin.repurchase_config_changed` 2 条、G3 `admin.nex_price_curve_changed` 4 条。它们为 `PENDING`，与 `EventOutboxDispatchScheduler` 只发布具有同步持久消费者的白名单事件一致，不要求收敛为 `PUBLISHED`。
- 清理后 `nx_audit_object_lock(target_domain='G')=0`，`nx_audit_operation_ticket(source_domain='G', status='pending')=0`；所有真实可逆写均已恢复。

## 阻断项

### G-FINAL13-001（P2）：G7 成功审计无法按 A2 的 G 域筛选发现

G7 的 `ADMIN_REPURCHASE_CONFIG_CHANGED` 审计行已写入，但 `detail_json.domain` 和 `detail_json.sourceDomain` 都为空；A2 mapper 的 domain CASE 因 action/resource 不含 `G7` 标记而回退到 `A`。因此 `domain=G` 查询不会发现这两条 G7 成功变更，G7 的 A2 可追溯性不完整。G3/G4 因 action 含 G3/G4 可归属 G，不能掩盖 G7 的缺口。

### G-FINAL13-002（夹具/角色契约阻断，非写链路缺审计）

`A-final7-audit-reader-manifest.json` 的 auditReader 只有 `platform_a2_read`、`platform_a4_read`。`A2AccessPolicy` 对非 `SUPER_ADMIN`/`AUDITOR` 角色从业务 authority 推导 allowedDomains；该角色没有业务域 authority，结果为 `__NONE__`。真实 MFA 后请求 `/api/admin/platform/audit/overview?domain=G&operator=<maker>` 返回 200 但 `recentLogs=0`，而主库同时间已有上述 8 条审计。应轮换为具备受控 G 审计可见范围但不具备 G 写权限的审计夹具；不得把该现象误判为成功写漏审计。

## 评分与交接

- 领域初审：**95.0/100，不通过**（低于 96；G7 A2 domain 可见性缺陷和审计读夹具阻断未闭环）。
- 执行质量初审：**98.0/100，通过**；复审：**99.0/100，通过**。
- 未改产品源码、未提交、未推送。完成后已释放 `GLOBAL_CONFIG_SINGLETON`；`DOMAIN_G_WRITE` 仅在本报告写入及最终交接前保留。

# L6 App 行为分析 Acceptance Sandbox 验收报告

- 日期：2026-08-12
- 范围：`backend` BI 行为分析、`app` 行为采集、`pc` L6 观察面。
- 状态：冻结，未提交、未启动服务、未执行 Maven 或完整构建。

## 已落实的契约

1. App 只有远端 API 已启用、已认证、onboarding 完成且存在账户主体时才可创建采集器。登出、换号、隐藏会丢弃活跃状态而不是补发停留事件；未认证和非法路由不发请求。
2. 客户端请求 DTO 只允许事件白名单字段；`sourceEnvironment`、采样键及身份字段不在 App payload 中。服务端以配置决定环境，生产由 outbox 决定采样。
3. `SANDBOX` 事件（包括验收 fixture）只写 `nx_behavior_sandbox_fact`；不调用 `EventOutboxService`，不写 `nx_behavior_event_fact`，生产 L6 查询仍固定读取 `PRODUCTION`。
4. Sandbox 侧保留 client-event-id 冲突、去重、单会话乱序、速率及点击节流检查。其 PC 查询端点为 `/api/admin/bi/behavior/acceptance`，返回和界面均固定校验/显示 `source=mock` 与 `SANDBOX`。

## 迁移要求

在启用 `acceptance` 配置并联调前，人工执行 `backend/scripts/migrations/20260812_l6_acceptance_sandbox_fact.sql`。该迁移没有接入 startup/schema runner；表拥有独立的 client event、dedupe、session/time 索引。

## TDD 证据

- 红：新增 App 生命周期合同测试和 PC Sandbox 观察面合同测试后，分别因缺少 `dispose(false)`/`discard()` 与缺少 acceptance client/标识而失败。
- 绿：
  - `app`: `node --test scripts/behavior-analytics-auth-lifecycle-contract.test.mjs`，3/3 通过。
  - `pc`: `node --experimental-strip-types --test tests/l5-l6-acceptance-contract.test.mjs tests/l6-acceptance-sandbox-observability-contract.test.mjs`，5/5 通过。
- 类型：`app` 的 `npm.cmd run type-check` 通过。
- 限制：按任务边界未运行 Maven/完整构建。既有 `behavior-analytics-active-route-catalog-contract.test.mjs` 在该三仓 worktree 因硬编码寻找同级 `nexion-backend` 目录而失败；当前目录名为 `backend`，与本次改动无关，未越界修复。

## 自评

- 初审：97/100，通过。隔离、鉴权/onboarding 门和 PC provenance 已逐项覆盖；未做 JVM 运行验证扣分。
- 复审：99/100，通过。复查确认生产 mapper/outbox 路径与 Sandbox mapper 无交叉，且没有提交或服务状态变更。

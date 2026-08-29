# Nexion Sandbox 环境退役与开发环境数据归并 v2

## 1. 决策

Nexion 不再提供可启动、可访问或可配置的 Sandbox 运行环境。标准本地开发只使用 `dev` profile、本地 `nexion` 数据库和规范业务表；PC、UniApp 与 Java 后端统一读取同一组开发库事实。

开发接口返回的 `sourceEnvironment=PRODUCTION` 表示“规范业务数据轨”，不表示连接线上生产库。自动化测试中保留的 `test` profile 与历史夹具只用于进程内验证或取证，不是第二套可部署环境，不允许承载日常开发数据。

## 2. 数据归并分类

归并不是把所有 `SANDBOX` 字样批量改成 `PRODUCTION`，而是先逐表、逐行精确归档，再按业务语义分类：

| 分类 | 表数 | 源行 / 归档行 | 活动库处理 |
| --- | ---: | ---: | --- |
| `PROMOTE_ACCOUNT_IDENTITY` | 1 | 328 / 328 | 仅 `nx_user` 身份并入开发账号，`sandbox=0` |
| `RESET_WALLET_SCAFFOLD` | 1 | 329 / 329 | 钱包壳保留给开发账号，但所有余额/金额字段归零，`sandbox=0` |
| `ARCHIVE_ONLY_DELETE` | 18 | 387 / 387 | 共享表里的 Sandbox 事实只归档，活动行删除 |
| `ARCHIVE_ONLY_DROP_TABLE` | 60 | 5919 / 5919 | Sandbox 专表完整归档后从活动 schema 删除 |

合计 80 张业务表、6963 行；源/归档差异为 0。Mock 订单、Mock 流水、Mock 收益、Mock 持仓、设备夹具、回调、法务确认和 OAuth 事件都没有被重标为真实交易或真实余额。所有分类和行数保存在开发归档库中，可逐表复核。

## 3. 已执行迁移

- 归档库：`nexion_development_archive_20260828`；
- v2 迁移：`sandbox-to-development-v2-classified`，状态 `COMPLETED`；来源标记 `RETIRED_SOURCE`，目标为 `DEVELOPMENT`；
- v1 宽泛方案已标记 `SUPERSEDED`，不得作为当前口径；
- 活动 Sandbox 命名表：0；活动用户与钱包 Sandbox 标记：0；钱包初次归并时 329/329 完成零余额重置并固化独立证明；
- 钱包逐户证明表：`sandbox_retirement_wallet_reset_item`，329/329 行均记录统一切换点 `2026-08-28 20:33:19.172863`（规范业务时区 UTC+08）、重置结果和切换后账本核对来源；
- 归并后出现非零余额的导入钱包，必须在每次核验时与切换点之后的规范 `SUCCESS` 账本净额逐户、逐资产相等，因此不是历史 Mock 金额复用；数值会随 `DEV-TASK` 正常结算继续增长，不把某次采样余额或笔数写成恒定验收值；
- 迁移清单分别计算并固化真实源行数与归档行数，不再用归档计数代替源计数；80 张表仍为 6963 / 6963，差异 0；
- 迁移脚本已做幂等重跑，第二次执行继续通过全部校验，且不会抹除归并后在开发规范轨上新产生的收益、充值或支出；
- 独立核验脚本通过 9/9 检查，其中第 9 门动态核对切换后活动钱包与规范 `SUCCESS` 账本的逐户等式。

迁移前备份：

- `D:\workspace\bug-pic\sandbox-retirement-20260828-2000\nexion-before-sandbox-retirement.sql`
- SHA-256：`E26D75C47741DF917927EDB4593E126F6C8E685D3637704F9500EE21FE8DE321`

停服冻结备份：

- `D:\workspace\bug-pic\sandbox-retirement-20260828-2000\nexion-frozen-before-sandbox-retirement.sql`
- SHA-256：`75FC9A39D574AD4B35E4AB6E2870DABC2BA4BA4C0C2BB006066B21F19F1B3523`

归并脚本：`nexion-backend/scripts/maintenance/retire_sandbox_to_development.sql`；历史批次逐户取证补强脚本：`nexion-backend/scripts/maintenance/reconcile_legacy_sandbox_wallet_reset_proof.sql`（只写归档证明，不修改活动钱包）；执行器：`nexion-backend/scripts/retire_sandbox_to_development.ps1`；核验器：`nexion-backend/scripts/verify_sandbox_retirement.ps1`。

## 4. 运行时退役范围

### 4.1 Java 后端

- `dev` 与 `prod` 都只使用规范业务轨；普通启动携带 `NEXION_ACCEPTANCE_RUN_ID` 会失败关闭；
- 资金、支付、Cregis、Payout、行为分析、商城、客服、学习、推荐奖励、G2、Genesis 与 Proof 的旧验收控制器不在 `dev` 装配；
- `application-dev.yml` 中资金/支付/验收开关为禁用，设备任务和 Janus 执行器使用规范模式；
- 启动迁移显式排除历史 Sandbox SQL，并有拒绝清单；历史 schema 文件末尾删除旧专表，防止重启复活；
- 新的 CD 财务迁移只创建规范表，不创建隔离资金轨。

### 4.2 PC 管理端

- 删除 D7 Mock 出款、L6 验收观察、E4/G2/M3 Sandbox 面板和 H8/学习验收页面；
- 删除对应客户端、操作清单和 BFF 转发；旧验收 URL 固定返回 `410 SANDBOX_RUNTIME_RETIRED`，不会回源 Java；
- 正常财务、内容、市场和 Genesis 管理接口继续代理本地 8110。

### 4.3 UniApp

- 删除资金 Sandbox API、账本、请求作用域、模拟商城支付 API 及相关 UI；
- Genesis、商城、钱包、收益、法务、学习、质押和回购在 `dev` 与 `prod` 都只接受规范服务端来源；
- 5173 不再选择 Acceptance RunID，不再显示 Sandbox 余额、支付、收益或观察凭据；
- Janus 原生证明协议里的测试枚举只属于独立 Janus 测试协议，不构成 App Sandbox 环境，也不能提供业务数据。

## 5. 验收门槛

1. 80 张表、6963 行源/归档逐表相等，分类合计相等，活动 Sandbox 专表为 0；
2. 328 个账号身份完成归并，329 个钱包壳在统一切换点全部归零并留下 329/329 逐户证明；归并后非零余额必须与切换点后的规范账本净额逐户相等，不能把 Mock 金额变成开发余额；
3. 启动迁移扫描不含 Sandbox 建表引用，迁移幂等重跑和独立核验均通过；
4. 后端全量测试、PC 构建、UniApp 类型检查与 H5 生产构建通过；
5. 8110、3002、5173、9000、8010 由正确服务持有，前端能访问真实后端；
6. 旧验收 URL 返回 404/410，规范接口返回 `sourceEnvironment=PRODUCTION` 且 `runId` 为空。
7. B5 不得用 Sandbox/Mock 邮件回执代替真实 provider；F2 不得用 Acceptance RunID 或环境开关绕过 B1 覆盖率红线。

## 6. 回退

如需回退，必须停掉会写库的应用服务，校验冻结备份 SHA-256 后整库恢复；不得仅反向修改 `sandbox` 标记或重新创建旧路由。归档库和两份备份在验收确认前不得删除。

## 7. 与旧方案的区别

v1 草案的“共享业务表统一改成规范轨”过宽，可能把 Mock 余额、订单和法务事实冒充开发真值。v2 将账号身份、钱包壳和其他业务事实分开：只提升身份、钱包归零、其余事实只归档。开发环境从此只有一套可运行服务和一套规范事实；历史 `test` 夹具不等于可部署 Sandbox。

# 阶段实施与交接计划

输入：[OWNER-DECISIONS.md](OWNER-DECISIONS.md)、[SPEC.md](SPEC.md)、[CONTRACTS.md](CONTRACTS.md)、[ACCEPTANCE.md](ACCEPTANCE.md)、[SOURCE-MAP.md](SOURCE-MAP.md)。默认无部署/生产库写入；分仓计划由各阶段在自己独立工作树激活，不以仓目录名代替branch/SHA。

## 阶段索引与唯一所有权

| 阶段 | 唯一负责人 / 写入范围 | 必要依赖 | 接口交接与退出门 |
|---|---|---|---|
| S1规格 | 本会话；后台`docs/specs/support-redesign-20260929/`除OWNER-DECISIONS | 原始决定、三仓固定源码 | 七块SPEC、C1–C6、AC01–14、严格lint、独立语义审查；协调会话审阅业务/API后可放行S3 |
| S2设计 | 独立设计会话；后台`docs/design/support-redesign-20260929/` | 原始决定；必须与最终S1语义汇合 | image_gen保存、主线逐图检视、语义勘误、可点关键流、选定稿；AC12，未经汇合不得供S5还原 |
| S3归属底座 | 独立后端会话/树；客服归属/注册/安全/迁移及对应测试 | S1规格审阅通过 | C2/C3/C5权限与绑定API、固定SHA迁移、角色grant表、旧旁路收口、AC02–06/11/13；独立审查 |
| S4维护与消息 | 新后端会话/树，基于S3已验收提交；维护/活动/聚合/图片及对应测试 | S3通过，C4/C5字段冻结 | 周期与有效事件、六指标、附件、请求响应样本和错误表；AC01/07–10/13；独立审查 |
| S5后台实现 | 独立后台会话/树；M域页面/client/代理/nav必要改动及测试 | S1+S2语义汇合、S3+S4实际接口交付 | 按稿还原；所有旧入口及dock统一权限；每页面独立人工操作审查，AC01/05–10/12/13 |
| S6客户端对齐 | 独立客户端会话/树；support API/domain/store/pages/thread、必要i18n及测试 | S3+S4实际接口交付；S1行为约束 | 等待分配/归属/图片/重试双端契约；保留工单/FAQ，AC03/06/09/12，可与S5并行 |
| S7集成验收 | 独立验收会话，由协调会话收口；仅明确授权的验收报告位置 | S3–S6均通过；三仓依赖提交固定 | 隔离真实后端全AC、迁移回滚、设计对照、权限与状态组合、done-review；缺项不可报全完成 |

S3/S4同后端文件高度重合，必须顺序；S5/S6分仓可并行。S7发现问题回到对应所有者的新快照修补、重开受影响依赖并独立复验，验收会话不擅改其他树。所有阶段禁止修改原树WIP和其他阶段目录，不默认合入/切分支。

## 分仓允许范围与交接

后端S3：`content/{application,domain,dto,infrastructure,mapper,web,realtime}`的归属及消息授权相关文件；`auth/application/AppUserRegistrationService.java`及必要mapper；账号停用只补客服交接投影/禁止回退，不扩大超管权限；对应`src/test`和`scripts/migrations`。S4接管相同客服目录的维护/图片/聚合，新增活动钩子只在确认来源处，不能改财务计算。实际包前缀见SOURCE-MAP。

后台S5：`app/components/domain-views/m*`、`lib/admin/m*`、必要`app/api/admin/content`二进制代理、shell badge/nav权限、对应tests/scripts与本仓PRD契约引用。S2拥有设计目录，本阶段消费不覆盖。客户端S6：`src/api/support-api.ts`、`src/domain/support.ts`、`src/store/conversations.ts`、`src/pages/support/`、`src/components/support/`、必要求助/工单入口和现有语言文件，禁止扩到网站/native打包/无关a11y WIP。

后台实施基线更新为`248d6da89becb113402046ab3a9f27c48f3e010d`（新权威origin/test），不是S1所在旧checkout。S5允许范围还包含现有`lib/admin/{admin-conversation-realtime,conversation-realtime,use-conversation-stream}.ts`以覆盖真实WS路径；保留新基线m1-pending-command、m3-composer-state、恢复门和business-time语义。新增现有回归清单见SOURCE-MAP。协调会话只搬本目录文档增量，不能将旧源码整分支合入新test。

每次交接提供：完整commit、分支和树路径；本阶段变更集；API真实样例（脱敏）、错误/版本/幂等规则；DDL与可重复迁移/回滚；检查命令、运行结果、日志；独立review findings和已复验证据；未测环境；下一阶段允许消费的字段。S4不能只给接口声明而不给实际读写样例；S5/S6不能把mock样例当真实后端。

## 已存在且核实入口的检查

| 仓 / 阶段 | argv式命令 | 实际覆盖与限制 |
|---|---|---|
| S1 | `node C:/Users/jason/.agents/skills/nexion-spec/spec-lint.mjs docs/specs/support-redesign-20260929/SPEC.md --strict` | 七块结构；不测功能，必须独立语义审查 |
| 后端S3 | Maven `-Dtest=OpsSupportAgentServiceTest,AppSupportServiceTest,OpsConversationServiceTest,MybatisSupportAgentRepositoryTest,MybatisConversationRepositoryTest,AppUserRegistrationServiceTest,AppUserRegistrationReferralLockContractTest,ConversationSocketAccessTest,ConversationAdminReadServiceTest,OpsConversationStreamControllerTest,OpsAdminAccountServiceTest test` | 已有测试类；需扩新契约，旧回退断言有意更新；不依赖生产DB |
| 后端S4 | Maven `-Dtest=AppSupportServiceTest,AppSupportCommandRecoveryTest,OpsConversationServiceTest,BehaviorAnalyticsServiceTest test` | 既有基础回归，维护/图片新测试必须实现后追加；仅这组过不能放行 |
| 后台S5 | `node scripts/verify.mjs`；`node --test tests/m2-acceptance-contract.test.mjs tests/m3-acceptance-contract.test.mjs tests/m4-acceptance-contract.test.mjs tests/m5-acceptance-contract.test.mjs` | 全量verify与M域回归；浏览器另跑，缺兄弟仓SKIP不算跨仓通过 |
| 后台S5 | `node node_modules/@playwright/test/cli.js test tests/e2e/m-support-human-flow.spec.ts --project=chromium --workers=1` | 既有人工流起点，先回读测试安全边界、隔离服务URL；新增场景与真实持久证明不可省 |
| 客户端S6 | `node scripts/verify-chain.mjs --full`；`npm run type-check` | 全量verify才工程门；type-check按package.json使用vue-tsc，不以工具存在证明功能 |
| 三仓S7 | 各仓重跑当前提交完整门+实际隔离服务浏览器脚本 | runtime record生产器须新增；当前不存在可宣称通过的全AC命令 |

Maven实际入口：`D:/WORKS/PLAN/.local-runtime/phone-calibration-tools/apache-maven-3.9.9/bin/mvn.cmd`，Windows机器计划通过显式`cmd.exe /d /c <mvn.cmd> <args...>`启动；仅对受控固定路径使用，不能拼接外部字符串。临时JAVA_HOME采用SOURCE-MAP已存在JDK；本阶段不运行测试或启动数据库。后端MySQL范例`M1SupportAvailabilitySpringTransactionMySqlIntegrationTest`有localhost/随机schema保护，仍须先读fixture再设隔离凭据。任何脚本未验证副作用前不得直接跑全库集成测试。

## schemaVersion2机器计划接入

`plans/`提供按仓的v2契约草案及总索引，所有行为验收来源为本目录普通文件。计划repo目前指可解析的只读基线仓，仅供验证结构：**不得在原树init/start/run**。协调会话创建各阶段树后，在该树获准文档位置复制计划、替换repo为真实独立树绝对路径、base为实际已验收上游SHA、owner为执行会话身份、inputs为固定规格/设计的普通文件路径，并以新task id初始化。跨仓依赖不由单仓CLI自动证明：先验证上游handoff提交与接口证据，作为inputs加入；S5另加入S2选定稿和交互说明。S7分别读取三仓状态/提交，不能用一个repo的hash代表三仓。

新增维护/图片/集成runtime检查还未写，草案中这些检查明确指向**待实现测试/报告生产器**，因此计划不可执行通过；不能换成恒成功、JSON可解析或空报告。后续负责人实现并验证命令真实存在、失败可见、隔离环境安全后才激活。所有ui acceptance映射record+runtime，requiredChecks含对应id；真实报告带WORKFLOW_TASK_ID/STEP_ID/CHECK_ID/RUN_ID/REPO/SNAPSHOT_HASH，不把人工填pass当浏览器证据。

生命周期：init→bind实际session→start→实施→run→独立review→status；所有步通过后integration重跑所有checks+独立coverageReview→finish。状态/报告保存在协调会话授权的仓外证据路径，防止输出改变快照。快照或输入变化reopen最早受影响步骤；中断先证实进程终止才recover，不改JSON机器状态。review只能由实际独立审查者给出，主线不伪造身份。

## 迁移、回滚与放行边界

S3先避免现有ensureSchema去重污染预检，再保存隔离数据映射并演练重跑。S4不补造历史活动/业绩；S5/S6回退不得解除服务端专属门。S7证实回滚仍保留所有消息/附件和绑定历史，不能直接回退为旧广播/转接。没有生产执行授权，不启动生产迁移或部署。

S1文档审阅通过可放行S3的隔离实现；并不表示后端完成。S5必须等待实际接口与设计产物；各阶段“检查通过”只覆盖报告明确列出的能力。后台新权威远端/test与本地调查基线差异由主线核对（见HANDOFF），本会话按调度不push/rebase，不能把本地commit当远端迁入。最终需要主人拍板的只有新的业务范围或真实生产发布决定，本阶段没有额外此类请求。

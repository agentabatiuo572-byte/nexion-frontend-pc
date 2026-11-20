# 支付密码后台界面与服务端交接

更新：2026-10-31。范围：正式 PC 前端 `nexion-frontend-pc`，起点 `origin/test` `89dd52cc30f9e270f13e26681b3e838a13d1b5f2`。本文件供主线汇总至 uvel-docs；未提交、未推送，不表示已完成远端交接。

产品依据：[18 支付密码](https://github.com/agentabatiuo572-byte/uvel-docs/blob/main/handoffs/2026-10-28/app/18-payment-password.md)及配套书面交互。2026-10-30 本轮用户进一步批准正式 APP/H5 和后台界面实施；数据库和服务端仅写待办，不在本轮实现。旧文档“本次不额外建设运营后台配置页面”被这次明确指令扩展；支付规则、6 位数字凭证、5 次/15 分钟/15 分钟不在后台重新定义。

## 实现落点与边界

2026-10-31 后发实施指令：用户明确要求真实现有客户资料原位接入，已获实施指令。C5 已扩展支付异常列表与有能力的人工解除；共享卡原位接入 C1 现有详情、复用的客服客户页、M1 客户详情抽屉、M3 会话右栏/既有完整档案，不创建独立 360 页。早期“不直接解锁”限制仅就本次支付专属解除被该指令替代；登录、账户冻结与其他风险类型不扩大。现行功能合同见 [PRD 增量](PRD/specs/FEAT-PAYPIN-ADMIN-OPERATIONS-20261031.md)；服务端/数据库仍待同事实现，真实接口未确认时保持只读/失败重试。

视觉最终版已由主线亲自查看 1440 全页、支付密码实际区域、确认区域及 1024 版本。只在本区增加局部样式：标题 18/26，正文、控件和表格 14/22，辅助 13/20，规则数字 24/32；时间沿用业务时区，用户区域标一次时区，日期使用既有紧凑格式。实际字形检查确认中文为 Microsoft YaHei、数字为 Manrope，未再回退 NSimSun 或 Consolas。行为测试保留，并新增实际视口内与锚点位置检查。

页首提供“支付密码规则与用户状态”锚点，一次点击滚动到实际支付密码区。设计验收截图针对新增规则确认区域、完整策略与用户锁定区域截取，避免用旧 C5 首屏替代新功能证据。

沿用 `/users/security` 的 C5 用户选择、正式会话权限和视觉样式，不新建一级菜单。`user_c5_read` 查看支付密码规则与选中账号信息；`user_c5_write` 加上服务端返回的 `editable`、数值边界及生效说明后允许调整规则。A5 是跨域参数只读寄存器，其写入口指回所属模块；本次将 C5 作为此规则唯一编辑入口，A5 后续可由原寄存器服务汇总同一配置。

新增界面包含：窗口内输错上限、错误统计窗口、锁定时长；用户的未设置/已设置/暂时锁定、最近设置或修改时间、服务端锁定截止时间，以及分页验证记录。默认/空/加载/错误、重试、只读与无编辑合同均有明确文案。账号未选中不读取任何账号的支付密码数据；切换账号或会话会重建只读数据区，旧响应不能污染新账号。

调整使用三个独立整数输入，允许范围来自服务端，不擅定产品上下限。下一步展示新旧值、生效说明，要求至少 8 字理由与明确勾选确认。提交中同步锁阻止双击；成功必须回读原命令的审计记录。网络/5xx/不完整成功响应保留原命令至共享会话存储，刷新后只有查询出口；不重复 POST。4xx 或明确业务拒绝按现有共享归类合同释放本次命令，保留表单供重新加载与重试。

页面没有查看密码、替用户设置、直接清除密码或新增客服审批系统。人工解除仅处理服务端明确授予能力的本条支付异常，带理由、确认、原版本和原命令审计回查；不解除登录锁定。身份恢复仍沿用 APP/H5 的“忘记支付密码”和既有账号身份核验流程。截止时间过后仍以服务端读取为准，前端不自动解锁。

所有 API 为待服务端实现的窄合同；BFF 仅增加现有代理允许路径与 HTTP 方法，不写业务服务、Java、数据库、SQL 或演示数据。生产页面不提供本地假成功。演示数据仅在 Playwright 测试路由拦截器中，连辅助请求也全部拦截，不访问真实服务端或资金。

## 拟新增 API 合同（需后端落实）

统一沿用 `{ code: 0, data: ... }` 响应与现有管理 Cookie/Bearer 代理。非零业务码与 4xx 必须保证未执行；若无法保证无副作用，代理/服务必须返回 `X-Nexion-Upstream-Outcome: unknown`，客户端保留原命令等待回查。

| 路径 | 方法与权限 | 数据合同 |
|---|---|---|
| `/api/admin/users/security/payment-password-policy` | GET；`user_c5_read` | `PaymentPolicy` |
| 同上 | POST；`user_c5_write` | `{ values, expectedVersion, reason, confirmed:true }`，必传 `Idempotency-Key`，返回非空受理数据；需提供下行命令查询 |
| `/api/admin/users/security/payment-password-policy/commands/{commandKey}` | GET；原操作员或具备审计读取范围的管理员 | `PaymentPolicyReceipt`；与命令精确匹配，不因刷新重复执行 |
| `/api/admin/users/profiles/{userId}/security/payment-password` | GET；`user_c5_read` + 用户可访问范围 | `PaymentPasswordStatus` |
| 同上追加 `/attempts?pageNum=1&pageSize=10` | GET；同上 | `PaymentPasswordAttempts`，支持 10/20/50 分页 |

类型唯一代码来源：`lib/admin/payment-password-contract.ts`。所有外部响应在 client 边界验证并只投影明确字段，未知字段（包括意外出现的密码）不会传入 UI。记录中的访问地址必须已脱敏，原始地址会被拒绝。

`PaymentPolicy`：`version` 非负整数；`values={maxAttempts,windowMinutes,lockMinutes}` 均正整数；`constraints` 为各项 `{min,max}` 或 `null`；`effectDescription` 为可理解中文或 `null`；`editable` 布尔；`updatedAt`、`updatedBy` 可空。缺范围或生效说明仍显示已读值但禁编辑。服务未接通时仅说明方案默认 5/15/15，绝不标成已生效。

`PaymentPasswordStatus`：`userId` 为当前账号的字符串 ID；`state=UNSET|SET|LOCKED`；`updatedAt`、`lockedUntil` 可空，LOCKED 时截止时间必有；`observedAt` 必有。时间请返回含时区的 ISO 8601 字符串。页面沿用后台业务时区格式。

`PaymentPasswordAttempts`：`userId`、`records`、`total`、`pageNum`、`pageSize`。每条为 `id,occurredAt,purpose=PAYMENT|CHANGE,result=SUCCEEDED|INCORRECT|LOCKED|BUSINESS_REJECTED,channel=APP|H5,clientIpMasked`；无记录时明确 `records=[]` 与 `total=0`。密码、哈希、盐、pepper、验证码、重置证明、完整 IP 均不下发。

`PaymentPolicyReceipt`：`commandKey,status=APPLIED|REJECTED|PENDING,auditId,changedAt,changedBy,reason,oldValues,newValues,effectDescription`。APPLIED 必须有完整审计编号、操作者、时间、生效说明；只有这个读回才显示“已保存，审计记录已核对”。PENDING 持续查询；REJECTED 结束原命令，可重新核对当前版本再调整。暂未查到原命令不代表未执行，应返回可区分的非终态，不能鼓励新键重发。

## 后端与数据库待办

1. 复用现有账户范围、RBAC、审计、幂等、CAS 与安全配置基础设施实现上述接口，不能仅根据前端权限展示放行。
2. 将支付 PIN 凭证和登录凭证分开，所有验证、错误计数和锁定由服务端执行；前台购买、置换及修改旧 PIN 共用批准的错误计数。不得给管理员读取任何凭证秘密。
3. 服务负责人明确三项参数可编辑上下限、调整对已有计数/锁定/窗口的生效合同；未明确之前返回 `constraints:null` 或 `effectDescription:null`，页面会只读。
4. 调整原子更新配置版本并写不可变 A2 审计，包含原值、新值、理由、操作员、时间、命令号与生效说明。绑定幂等键与不可变载荷；相同键不同值拒绝；GET 回查不执行变更。
5. 只读状态与验证记录使用真实账号隔离、权限范围和分页；返回明确无记录、服务不可用、无权限，不能用缺字段伪装“未设置”。验证记录不保存或回传 PIN/验证码/重置证明。
6. 复用 A5 寄存器自动归集同一策略并将编辑所属模块指向 C5，不新造第二份配置。正式数据接入后验证 A5 与 C5 同值、同版本。
7. 不新增后台“直接清密/解锁”能力。恢复规则继续归既有账号身份核验与支付密码找回合同。

## 验收与剩余风险

支付密码源码已通过独立审查并修正两项边界：401 重新登录流程不能覆盖明确的“写结果未知”响应头，原命令继续保留；所有新时间字段只接受完整带时区的 ISO 8601 时间。两项正反例纳入真实 client/contract 测试，未修改全局时间或错误分类合同。独立浏览器还验证了明确拒绝后有意重试、撤销权限后的迟到响应、未知状态不降为未设置、PENDING 原命令多次查询才进入 APPLIED。

针对性检查：`npx tsc --noEmit`；`node --experimental-strip-types --test tests/payment-password-contract.test.mjs`；浏览器 `npx playwright test --config playwright.payment-password.config.ts`（本地 3108，全部 API 被测试拦截）。数值边界、账号错配、未知状态、记录脱敏、精确命令审计、4xx/5xx 与网络分类均有契约测试；浏览器覆盖只读、缺合同、加载/空/失败重试、新旧对照、理由、取消返回、双击、未知结果跨刷新查询与 1440/1024 展示。验证产物在主线本任务 output 目录，需随 uvel-docs 交接共享可获取的摘要。

全量 `npm run verify` 首轮因默认跨仓源读到旧本地 backend 和原型 APP 出现 24 个失败（102/102 均执行，生产 build 通过）。2026-10-31 使用下文固定远端只读输入完成最终全量：103/103 均执行，97 PASS、6 FAIL，SKIP/NOT-RUN 均为 0，170.938 秒，运行期间 `treeMoved=false`；生产构建通过（39.3 秒），支付密码专门检查通过。未为剩余失败扩大维护范围，不声称全量通过。真实后端、真实管理员权限、真实审计持久化、APP/H5 同账号锁定均待同事实现后联验；本轮 fixture 不替代这些验收。

大白话：后台界面和前端接口接线已写好并用隔离数据验证；真实数据和保存生效要等后端按合同接好，未提供服务时页面会明确显示未确认。

## 必要验收门维护与本任务区分

本任务产品代码为 C5 新增区、支付密码窄合同/client、BFF 允许路径及定向测试。以下改动用于恢复当前源码的既有验收能力，不扩展业务：

| 维护项 | 证据与最小调整 |
|---|---|
| BFF 测试加载器 | 现有 Cookie 隔离和手机绑定代理测试新增真实支付密码 route helper 导入；原有鉴权与路径断言保留 |
| Promotion 生成类型 | 当前远端后端 `9f8dd491` 的 OpenAPI 与原类型声明逐字节一致，仅源 SHA 注释漂移；用既有生成器重生一个注释行 |
| 触控 hover | 既有联系人列表唯一遗漏的 hover 规则加入精细指针与 hover 能力条件；Chromium 鼠标/触控计算样式均实测通过 |
| 错误中文映射 | 两个既有客服读取错误码补明确的中文重载说明，不把内部码展示给运营 |
| 原命令登记 | 已实际使用共享持久槽的四个入口补登记；只读 SSE 详情 GET 合流容器明确为非写命令。三个 growth 包装器继续委托 h-client 判断 HTTP 结果，不另造失败分类 |
| 机型规则结果分类 | 既有未知保存文案改接全局共享分类谓词，补断网、5xx、坏包、明确拒绝与成功反例；不改任何规则值、模式或权限 |
| KYC 历史标注门 | 将原有 2026-08-07 退役裁定移到文档首屏；扫描词法排除“真实名称”被误读为“实名”的样本，同时保留真实身份要求正例 |

当前权威只读输入固定为后端 `origin/test` `9f8dd491ccd4185eb083e7c42c3c1ae24ec851e8`、APP `origin/test` `89c083bfe4d1b20a1d989188db71b1f1fbea9244`；通过 `NEXION_BACKEND_ROOT`、`NEXION_APP_ROOT` 明确指定。Promotion 截图输出通过已有 `PROMOTION_EVIDENCE_DIR` 重定向本任务产物区。首轮旧输入失败报告保留，不用新的通过记录覆盖失败历史。

客服退役门、动作证据台账由独立维护 agent 按 05 交接修正，产品 PIN 实施者不并行改同一文件。H3/E1/F4 的旧夹具与品牌断言按当前正式源修正：保留源商品名与用户名、保留系统 UVEL 品牌，真实加载活动删除 helper，并正确提供新增只读计数的 hook 状态。H4 领取文案以当前 `FEAT-HOME-EVENTS-20261025` 和只读后端的已获资格/eligible 合同为依据，区分“停止新增参与”和“已获奖励按规则领取”，同时保留待处理、已取消、退款挂起的不可重发反例；不改产品领取逻辑。最终全量验证见下一节，定向通过不能代替全量通过。

## 2026-10-31 最终交付检查记录

`npx tsc --noEmit` 通过；支付密码 6 个契约检查通过；原有 5 组浏览器行为检查在视觉重构后全部通过（15.1 秒），包含字体实际字形、锚点进入视口、1024 无溢出、新旧值与理由确认、双击一次提交、审计读回、只读/缺合同、失败重试、原命令跨刷新查询、返回与取消。主线亲自查看并接受新版视觉方向，独立 reviewer 已关闭本任务 401 结果未知与非 ISO 时间输入两项 finding；最终视觉由独立 reviewer 另做只读复核。

全量剩余 6 项：F5 事件夹具缺当前 `summary.labels`；版税 mutation 旧针未拒绝；客服大组仍有旧工单/VM 变量/名称假设等失败；动作反向扫描仍将多处容器 `add/remove` 等识别为未登记动作；PC 全菜单健康旧检查仍读取已退役 Janus K6 文件；F1 权限测试仍期待旧 V1–V12 键范围。它们与支付密码定向检查分开记录，未全部判定为纯业务缺陷，待各原模块 owner 处理。无 Java、数据库或真实资金操作。

主线可提取的本次最小核心文件为：

- 界面与入口：`app/components/domain-views/c-tabs/c5-security.tsx`、`payment-password-panel.tsx`、`payment-password-panel.css`。
- 前端接口边界：`lib/admin/payment-password-client.ts`、`payment-password-contract.ts`、`payment-password-routes.ts`，以及 `app/api/admin/users/[...path]/route.ts` 的精确允许路径增量。
- 定向验证：`tests/payment-password-contract.test.mjs`、`tests/e2e/payment-password-fixture.spec.ts`、`playwright.payment-password.config.ts`。
- 接线与交接：`scripts/verify.mjs` 中新增支付密码检查、`scripts/pending-idempotency-key-sentinel.mjs` 中支付密码持久命令登记，以及本文。必要旧门维护改动已在上一节单列，不能误称为支付密码新增业务。

本地证据归档：本任务 `output/payment-pin-20261030/admin/` 下的 `verify-final.log`、`verify-final-summary.json`、`verify-final-failures.json`、`playwright-results.json`、`payment-panel-computed-style.json`、`payment-panel-platform-fonts.json` 与新版 01/02/04/1440 截图。它们由主线挑选脱敏摘要与截图共享至 uvel-docs；仅存在本机尚不等于已完成远端交接。本分支未自行 commit/push。

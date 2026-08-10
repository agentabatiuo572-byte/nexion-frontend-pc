# NEXION 测试资源与环境目录 v1

> **现行裁决(2026-08-07)**:全项目已取消 KYC、钱包配对、C4 与 K5；本文相关旧字段、门禁、用例、权限或流程仅保留为历史基线，不得作为现行实现、运营或验收依据。

> 目标：在不依赖页面实现细节的前提下，为 PC 75 模块、后端和 App 准备可重复、可隔离、可清理的账号、角色、数据、设备、网络和异常资源。
> 安全边界：本文只定义资源模板与命名规则，不记录真实密码、令牌、证件、银行卡、私钥或生产数据。凭据由运行时秘密存储注入。

## 1. 每次测试运行的隔离契约

每次执行创建唯一 `RunID = nx-<scope>-<YYYYMMDD-HHmmss>-<shortid>`，所有可变资源必须带此 RunID：

- 数据库：独立 schema 优先；共享实例时每张测试业务表的自然键/备注带 `RunID`，并有可证明的清理查询。
- Redis：独立逻辑库或统一前缀 `test:<RunID>:`；不得使用未隔离的生产/开发会话库。
- MinIO：独立 bucket `nexion-test-<RunID>` 或受限 prefix；对象 metadata 标记 RunID、Owner、过期时间。
- 账号/角色：用户名、邮箱、手机号使用保留测试域和 RunID；禁止发送真实短信/邮件/推送。
- 业务对象：单号前缀含域，如 `A3-<RunID>-001`、`WD-<RunID>-001`。
- 证据：`D:\workspace\bug-pic\.restricted\<RunID>\<domain>\...`，认证证据单独受限并计算 hash。
- 时间：记录时区、服务端时钟、客户端时钟偏移；所有边界用绝对时间而非“今天”。

运行 manifest 必须包含：三端 commit/dirty、Build ID/JAR/App hash、DB/Redis/MinIO 标识、测试账号 ID（不含秘密）、fixture 版本、开始/结束时间、清理状态和证据 hash 清单。

## 2. 账号与角色池

账号按“每个域独立 + 每种权限边界独立”创建，避免一个超级账号掩盖问题。

| 资源 ID | 角色/状态 | 主要用途 | 必须具备 | 必须不具备 |
|---|---|---|---|---|
| ACC-01 | SUPER_ADMIN | 全局基准与恢复动作 | 75 模块、全部 API/数据域、MFA | 不作为普通角色权限用例 |
| ACC-02 | CONFIG_ADMIN | A3/A4/A6/A7/A8 配置治理 | 配置与事件目录受管动作 | 财务资产调整、风控解封 |
| ACC-03 | FINANCE | D/B 财务只读与日常处理 | 对账、提现列表、账本只读 | 高额审批、覆盖率参数、用户安全 |
| ACC-04 | FINANCE_LEAD | 财务高敏动作 | 审批、调整、覆盖率相关动作 | 内容与客服管理 |
| ACC-05 | RISK | K/J/C4 风控处置 | 冻结、复核、止血方向动作 | 恢复资金流出、财务手工调账 |
| ACC-06 | GROWTH | F/H 增长运营 | 活动、试用、奖励规则受限操作 | KYC、提现、熔断恢复 |
| ACC-07 | CONTENT | I 内容运营 | 文案、通知、课程、客服内容 | 资产、用户冻结、风险模型 |
| ACC-08 | SUPPORT | M/I9 客服 | 工单、会话、最小用户视图 | KYC 裁决、余额调整、风险阈值 |
| ACC-09 | AUDITOR | A2/L/只读跨域 | 审计、报表、只读详情 | 任意写按钮/API |
| ACC-10 | NO_WRITE | 有菜单/页面、无写权限 | 目标域读权限 | 所有写权限 |
| ACC-11 | NO_MENU | 无目标菜单但账号有效 | 其他域基本访问 | 目标菜单/路由/API/数据 |
| ACC-12 | DATA_SCOPE_A | 同角色、数据范围 A | 租户/区域/团队 A 数据 | 范围 B 数据 |
| ACC-13 | DATA_SCOPE_B | 同角色、数据范围 B | 范围 B 数据 | 范围 A 数据 |
| ACC-14 | DISABLED_ADMIN | 已停用运营账号 | 登录失败审计 | 任何会话 |
| ACC-15 | MFA_REQUIRED | 需 MFA 的高敏管理员 | 密码后进入 MFA gate | 未验证直接进入后台 |
| ACC-16 | PASSWORD_EXPIRED | 密码过期 | 仅密码更新流程 | 业务页面/API |

每个 Owner 域至少使用：一个授权角色、一个 `NO_WRITE`、一个 `NO_MENU`、一对数据范围角色。双运营员并发使用两套相同角色账号，不能复用同一会话。

## 3. 用户与业务夹具

### 3.1 用户主状态

| 资源 ID | 用户状态 | KYC | 资产/风险 | 目标用例 |
|---|---|---|---|---|
| USR-01 | 新注册 ACTIVE | NONE | 零余额、低风险 | 空状态、新手流程、无对象分支 |
| USR-02 | ACTIVE | PENDING | 小额余额 | KYC 待审门、禁止受管动作 |
| USR-03 | ACTIVE | APPROVED | 正常余额、低风险 | 主成功路径 |
| USR-04 | FROZEN | APPROVED | 有余额/未完成对象 | 冻结时各域 fail closed |
| USR-05 | ACTIVE | REJECTED | 无余额 | KYC 未通过与申诉 |
| USR-06 | ACTIVE | APPROVED | 高风险分、风险簇 | K 域处置和提现复核 |
| USR-07 | ACTIVE | APPROVED | 新钱包地址/首次提现 | D/K 组合门 |
| USR-08 | ACTIVE | APPROVED | 推荐树根节点/V Rank | F 域层级与佣金 |
| USR-09 | ACTIVE | APPROVED | 试用 active/grace 边界 | H2 时间状态机 |
| USR-10 | CLOSED | 历史通过 | 有法定账本无活跃会话 | 注销后隐私与历史保留 |
| USR-11 | ACTIVE | APPROVED | 数据范围 A | 行级权限 |
| USR-12 | ACTIVE | APPROVED | 数据范围 B | 越权枚举/直接 ID 访问 |

用户夹具不得用真实手机号、邮箱、姓名、证件或链上私钥。KYC 原图使用显著标记的合成材料，禁止仿造真实证件号码规则用于外部服务。

### 3.2 资金夹具

| 资源 ID | 状态 | 关键条件 | 预期 |
|---|---|---|---|
| FIN-01 | 充值外部未成功 | 内部无终态 | 不入账 |
| FIN-02 | 外部成功、内部待消费 | 唯一渠道引用 | 受控恢复后仅入账一次 |
| FIN-03 | 充值已完成 | 账本/余额一致 | 重放不重复入账 |
| FIN-04 | 提现待审核 | KYC/披露/风险均通过 | 可批准 |
| FIN-05 | 提现待审核 | 缺 KYC 或披露 stale | server 拒绝批准 |
| FIN-06 | 已批准待渠道 | 已冻结余额 | 幂等执行 |
| FIN-07 | 渠道处理中 | 查询超时 | `RESULT_UNKNOWN`，不可重复出款 |
| FIN-08 | 提现完成 | 渠道引用与账本终态 | 不可逆回处理中 |
| FIN-09 | 提现明确失败 | 未出款 | 余额只释放一次 |
| FIN-10 | 覆盖率临界值下/等于/上 | 精确小数边界 | 恢复/放大流出门按规范比较 |
| FIN-11 | 账本差一分/精度极限 | USDT/NEX 各自 scale | 对账发现且不浮点吞差 |
| FIN-12 | 同幂等键不同 payload | 金额或地址改变 | 409/422，绝不沿用旧成功 |

### 3.3 商城、设备、团队、内容与客服

| 资源 ID | 对象 | 必备状态集 |
|---|---|---|
| EFX-01 | SKU | draft、active、有库存、售罄、delisted、coming-soon |
| EFX-02 | 订单 | created、pending_payment、paid、fulfilling、completed、cancelled、refund_pending |
| EFX-03 | 设备 | inventory、active、offline、task_running、deactivation_pending、unbound |
| EFX-04 | 以旧换新 | eligible、quote_expired、submitted、accepted、rejected、completed |
| FFX-01 | 推荐树 | 直属 0/1/多、深层 6+、断层、注销匿名节点、循环脏数据防御样本 |
| FFX-02 | V Rank | 每一阈值的 `-1 / = / +1` 与降级周期边界 |
| HFX-01 | 试用 | eligible、active、grace、expired、converted、cancelled；时钟前后 1ms |
| HFX-02 | 活动/代金券 | draft、scheduled、active、paused、expired、quota exhausted、重复领取 |
| IFX-01 | 内容版本 | draft、published、archived、rollback target；zh/vi/en 占位符一致/不一致 |
| IFX-02 | 风险披露 | version/jurisdiction 相同、版本 stale、法域变化、未读到底、已确认 |
| MFX-01 | 工单 | new、assigned、in_progress、pending_user、escalated、resolved、reopened、closed |
| MFX-02 | 会话 | AI/人工、排队、接入、转交、超时、关闭、断线重连 |

## 4. 时间与边界资源

测试时钟必须可注入或由服务端固定；不能通过修改本机系统时间污染其他进程。

| 资源 ID | 时间条件 | 覆盖 |
|---|---|---|
| TIME-01 | 生效前 1ms / 等于 / 后 1ms | 配置、内容、活动、SKU 上线 |
| TIME-02 | 到期前 1ms / 等于 / 后 1ms | 试用、券、会话、幂等 TTL |
| TIME-03 | UTC 跨日与越南 UTC+7 跨日 | 日限额、报表、银行到账日 |
| TIME-04 | 月末/年末/闰日 | 结算、排名、周期任务 |
| TIME-05 | 客户端慢/快 5 分钟 | 服务端权威、签名、倒计时显示 |
| TIME-06 | 定时任务重复触发/漏触发后补跑 | 幂等、补偿、告警 |

## 5. 设备与显示矩阵

| 资源 ID | 环境 | 重点 |
|---|---|---|
| DEV-01 | Windows Chrome 当前稳定版 | PC 主验收、下载、快捷键 |
| DEV-02 | Windows Edge 当前稳定版 | 企业环境兼容 |
| DEV-03 | macOS Safari 当前稳定版 | WebKit、日期/下载差异 |
| DEV-04 | iPhone 小屏 320/375 宽 | 安全区、键盘、长文案、权限拒绝 |
| DEV-05 | iPhone 主流 390/430 宽 | iOS 发布候选 |
| DEV-06 | Android 低端 2GB/4 核 | fail-low、性能、离线恢复 |
| DEV-07 | Android 主流/旗舰 | 设备型号/能力分层 |
| DEV-08 | H5 iOS Safari | 无原生型号能力时的降级 |
| DEV-09 | H5 Android Chrome | Web 权限/存储/剪贴板差异 |
| DEV-10 | 字体 200%、系统深色、中文/越南语/英语 | 可访问性与溢出 |

真实机资源登记字段：资产号、系统/版本、型号、分辨率、内存、浏览器/WebView、是否 root/jailbreak、Owner、可用时间、重置方式。设备序列号/IMEI 不进入普通报告。

## 6. 网络与依赖故障矩阵

| 资源 ID | 注入 | 预期验证 |
|---|---|---|
| NET-01 | 离线后恢复 | 保存输入、明确失败/未知、可安全恢复 |
| NET-02 | 2G/高延迟/抖动 | loading、防重复点击、超时语义 |
| NET-03 | 请求发出后断网 | 结果未知 + 幂等查询，不盲重试 |
| NET-04 | DNS/TLS 失败 | 真实 request failure 可见且无假成功 |
| NET-05 | 401 token 过期 | 受控刷新或重新登录，不循环 |
| NET-06 | 403 | 权限解释；不渲染死按钮，不泄露数据 |
| NET-07 | 404 | 对象已删/越权均不泄露存在性 |
| NET-08 | 409 CAS/幂等冲突 | 刷新比较，不覆盖或复用不同 payload |
| NET-09 | 422 业务闸 | 显示可行动理由，不降级绕过 |
| NET-10 | 500 | 不提交本地权威态，保留 trace ID |
| NET-11 | `200` + 畸形 JSON/缺字段/错类型 | fail closed，不用默认值掩盖后端错误 |
| NET-12 | 分页重复/乱序/空页有 next | 去重/终止/告警，不死循环 |
| DEP-01 | Redis 不可用 | 会话/幂等/缓存按设计降级，不扩大写风险 |
| DEP-02 | MySQL 超时/只读 | 写失败无半成功，读有明确退化 |
| DEP-03 | MinIO 超时/对象缺失 | 业务记录不假装附件成功 |
| DEP-04 | MQ/outbox 消费暂停 | 业务写与事件可恢复，积压告警 |
| DEP-05 | 支付/KYC/链节点超时 | 结果查询优先，不重复外部请求 |

故障注入只允许隔离环境；运行 manifest 必须记录代理规则、开始/结束、目标域名/接口和撤销证明。

## 7. 安全与输入样本

| 资源 ID | 样本 | 验证 |
|---|---|---|
| SEC-01 | 空、全空格、超长、Unicode 组合字符、emoji | 长度按规范、无截断歧义 |
| SEC-02 | CSV 公式前缀 `= + - @` | 导出转义，打开不执行公式 |
| SEC-03 | HTML/脚本/Markdown/URL scheme | 输出编码与允许列表 |
| SEC-04 | SQL/JSON 路径/模板表达式字符 | 参数化、无注入、错误不泄栈 |
| SEC-05 | 路径穿越、双扩展名、伪 MIME、压缩炸弹 | 上传拒绝/隔离/扫描 |
| SEC-06 | 直接对象 ID、跨数据域 ID | 404/403 且无存在性泄露 |
| SEC-07 | 重放签名、过期 token、token 互换 | 验证受众/过期/会话绑定 |
| SEC-08 | 日志/埋点 payload 含密码、token、证件、卡号 | sanitizer 阻断并告警 |

攻击样本保存在受限测试资源库，只用合成数据，不通过普通聊天/报告传播真实秘密。

## 8. 75 模块资源包映射

每域 Owner 使用一个最小资源包，另按用例库叠加 `PK-*`：

| 域 | 必备账号 | 必备夹具 | 特殊资源 |
|---|---|---|---|
| A 平台 | ACC-01/02/09/10/11/15/16 | 配置版本、审计、事件、角色 | 双管理员、MFA、Redis/session、schema 冲突 |
| B 总览 | ACC-01/03/04/09/12/13 | 覆盖率、漏斗、节奏、风险聚合 | 指标断流/迟到/重算 |
| C 用户 | ACC-01/05/08/10/11/12/13 | USR-01..12、会话、KYC、资产调整 | 合成 KYC、设备/数据范围 |
| D 财务 | ACC-01/03/04/05/10/11 | FIN-01..12 | 渠道沙箱、链节点、精度/时区 |
| E 设备商城 | ACC-01/06/08/10/11 | EFX-01..04 | DEV-04..09、MinIO |
| F 分销 | ACC-01/06/09/10/11 | FFX-01..02 | 深树/匿名节点/并发结算 |
| G 金融产品 | ACC-01/03/04/05/10/11 | 持仓、到期、市场、Genesis | TIME-01..06、覆盖率边界 |
| H 增长 | ACC-01/06/07/10/11 | HFX-01..02 | 时钟、配额、受众、重复领取 |
| I 内容合规 | ACC-01/05/07/09/10/11 | IFX-01..02 | 三语言、版本/法域、推送沙箱 |
| J 应急 | ACC-01/05/09/10/11 | kill/geo/playbook/tamper | 全局单例锁、恢复红线 |
| K 风控 | ACC-01/05/09/10/11/12/13 | 风险簇、模型、规则、KYC 复审 | 对抗输入、申诉、回放数据 |
| L 数据 | ACC-01/03/05/06/07/09/10 | 事件/报表/实验/导出 | 迟到、重复、乱序、时区、重算 |
| M 客服 | ACC-01/08/10/11/12/13 | MFX-01..02、USR/FIN/E 交叉工单 | 附件、SSE/断线、跨域转交 |

## 9. 证据目录标准

```text
<RunID>/
  manifest.json
  coordination/locks/
  A/ ... M/
    owner/
      report.md
      trace/
      screenshots/
      network/
      data-checks/
    review/
    cleanup/
  shared/
    build-hashes/
    role-snapshots/
    defects/
```

截图/trace 默认可能含 P2/P3 数据，必须进入 `.restricted`；报告只引用证据 ID/hash，不复制秘密。证据文件名用 `<case>-<step>-<timestamp>`，禁止 `final-final2` 一类不可追踪命名。

## 10. 创建与清理顺序

### 创建

1. 预检服务与隔离标识；拒绝连接未标记的生产环境。
2. 创建 DB/Redis/MinIO 隔离资源和 Run manifest。
3. 创建角色→管理员→用户→基础业务对象→跨域对象→时间/故障规则。
4. 保存初始快照与行数/对象数；运行一条只读和一条可逆写哨兵。
5. 验收期间所有手工创建对象追加到资源登记，不依赖记忆清理。

### 清理

1. 停止故障代理、定时任务和测试消费者；释放全局锁。
2. 撤销管理员会话、MFA、角色和测试账号；删除/失效推送 token。
3. 按依赖逆序删除可变业务夹具、幂等记录、Redis key、MinIO 对象/bucket。
4. 不可变审计/outbox 按隔离审计边界保留或整库销毁；不得逐行伪装删除。
5. 查询证明无 RunID 残留；计算清理报告 hash，更新 manifest 为 `CLEAN` 或列明残留 Owner/期限。

破坏性清理只能命中已解析、已验证位于本 RunID 下的绝对目标；禁止对工作区根、数据库实例全集、Redis 全库或 MinIO 全局 bucket 执行泛化删除。

## 11. 就绪与退出门禁

### Ready

- [ ] 账号、角色、数据域和 MFA 边界通过预检。
- [ ] 每域必备夹具存在且状态查询与预期一致。
- [ ] 网络/依赖故障规则可单独启停，不影响其他 Run。
- [ ] 真实机、浏览器、时钟、渠道沙箱和证据磁盘容量可用。
- [ ] 清理脚本/查询已在空 Run 演练，不等测试结束才设计。

### Done

- [ ] 75/75 模块资源覆盖，无共用账号导致的并发污染。
- [ ] 每个缺陷可由 manifest + fixture + 用例 ID 重现。
- [ ] 所有故障注入已撤销，进程/代理/锁无残留。
- [ ] 清理为 CLEAN，或有明确保留依据、Owner、过期时间。
- [ ] 无真实用户数据、秘密或生产凭据进入代码库和普通报告。

## 12. 待决问题

| ID | 必须补齐 | Owner |
|---|---|---|
| TEST-OQ-01 | 独立验收 DB/Redis/MinIO 的固定供给与配额 | 运维 |
| TEST-OQ-02 | 支付、银行、KYC、短信/邮件、推送、链节点沙箱账号 | 各域/采购 |
| TEST-OQ-03 | iOS/Android 真机池及最低支持版本 | App/产品 |
| TEST-OQ-04 | PC 正式支持浏览器/版本矩阵 | PC/产品 |
| TEST-OQ-05 | 可注入服务端时钟与定时任务单步执行接口 | 后端/架构 |
| TEST-OQ-06 | 故障注入代理、权限、审计与隔离策略 | SRE/安全 |
| TEST-OQ-07 | 合成 KYC/银行/链上数据生成器和可公开测试规则 | C/D/法务 |
| TEST-OQ-08 | 证据保留期限、磁盘预算和自动清理作业 | QA/隐私 |

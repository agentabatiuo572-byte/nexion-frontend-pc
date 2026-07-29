# I 域 Owner 验收报告

## 结论

- Run ID：`pc-full-acceptance-20260728-151023`
- 范围：I1–I6，共 6 个模块。
- 锁定代码基线：PC `91d1c2d`、后端 `a1cc2a7`、App `0e2178b`。
- 最终候选：PC Build ID `zMwYtaTe1oUh_8OZpPPq9`、PC PID `6104`、后端 PID `20820`。
- 隔离环境：PC `127.0.0.1:3002`、后端 `127.0.0.1:8110`、数据库 `nexion_acceptance_20260728_151023`、Redis DB 14。
- Owner 裁决：**I1–I6 全部通过；I 域初审通过。**
- 未关闭缺陷：`P0/P1/P2/P3 = 0/0/0/0`。
- 本轮关闭产品缺陷：`I-001`、`I-002`。
- 初审评分：**98.2/100**。

本报告没有复用历史通过结论。Owner 从登录页和可见侧栏重新执行 I1–I6，完成真实 Chromium 主流程、刷新、退出重登、App 消费、畸形 200、401/403/409/422/503、幂等/CAS、数据库、A2、A4/outbox、五层权限和精确清理。最终权限轨及 I-001 回归轨执行期间，Build ID、PC PID 和后端 PID均未漂移。

## 模块逐项结果

| 模块 | 入口 | 核心验收事实 | 权限与异常结果 | 模块裁决 |
|---|---|---|---|---|
| I1 转化文案 A/B | `/content/copy-ab` | 文案池、版本配置、位置、结构化受众、实验和 App 四个投放面均使用服务器事实；合同覆盖曝光分桶与已支付/已完成订单转化 | readonly 可读且无写按钮，六类写探针后端 403；畸形 `copies` 的 HTTP 200 中文失败关闭并可重试恢复 | 通过 |
| I2 Nova 推送运营 | `/content/nova` | 20 个通道、20 个模板、真实社交事件、概率分布与 App canonical 通知账本闭环 | readonly 可读且通道/模板/分布写控件隐藏；写接口 403；畸形模板数组失败关闭并恢复 | 通过 |
| I3 通知 Campaign | `/content/notifications` | 16 个 Campaign、236 条通知、CAP、受众估算、调度和 App 通知跳转均来自服务器 | 修复 I-002 后，普通写、CAP、紧急发送分别绑定精确 authority；readonly/no-write 无写控件且接口 403；畸形目录和 503 均失败关闭 | 通过 |
| I4 信任中心 | `/content/trust` | 7 个版块、13 个版本、结构化字段、A2 待确认锁、发布/回滚/下架和 App 公共快照闭环 | 草稿、普通发布、高敏发布三类权限独立；readonly 无写控件、后端 403；畸形版本字段与 503 失败关闭 | 通过 |
| I5 风险披露 | `/content/disclosures` | 法域目录、版本、七章、国家映射、重确认与 gate 均为服务器单源；App 同版本阅读确认失败关闭 | I5 路由和权限独立于 I4；readonly 无法新建法域/版本/映射或调整 gate；写接口 403；共享 overview 畸形时显示 I5 专属错误 | 通过 |
| I6 i18n 文案与课程 | `/content/i18n` | 词条、不可变版本、课程、完整性、奖励和 App 远程语言包闭环；真实完成草稿、发布、归档、回滚为新版本、再归档 | readonly 可读且词条/课程写控件隐藏；写接口 403；畸形占位符、HTML 400/422、CAS 409 均失败关闭；验收夹具已清零 | 通过 |

## 十步验收记录

### 1. 页面与动作盘点

- 范围真源为 `lib/nav/console-nav.ts`：
  - I1 `/content/copy-ab`
  - I2 `/content/nova`
  - I3 `/content/notifications`
  - I4 `/content/trust`
  - I5 `/content/disclosures`
  - I6 `/content/i18n`
- 动作盘点覆盖文案/版本/实验、Nova 通道/模板/事件、Campaign/CAP、信任版块、披露法域/七章/gate、词条/课程/完整性修复。
- 主流程没有使用 mock、localStorage 权威数据或 DOM 直接修改。

### 2. 页面字段到数据库和下游的完整溯源

| 模块 | 管理端主要接口 | 权威表/事实 | 关键下游 |
|---|---|---|---|
| I1 | `/api/admin/content/copy-ab/*` | `nx_content_copy*`、`nx_content_experiment*` | App home/store/earn/me、订单转化、A2/A4 |
| I2 | `/api/admin/content/nova/*` | `nx_nova_channel`、`nx_nova_template`、`nx_nova_social_*`、`nx_nova_business_event_receipt` | App 通知流、H1 阶段节奏、A4 |
| I3 | `/api/admin/content/campaigns/*` | `nx_notification_campaign`、`nx_notification_cap_rule`、`nx_notification`、`nx_notification_action_receipt` | App 通知、I5/J 域紧急通道、A2/A4 |
| I4 | `/api/admin/content/trust-disclosure/*` | `nx_trust_section`、`nx_trust_section_version`、`nx_trust_section_field` | App 信任中心、A2、A4、BI |
| I5 | `/api/admin/content/trust-disclosure/*` | `nx_disclosure_*` | App 风险披露、重确认/gate、A2/A4 |
| I6 | `/api/admin/content/i18n-learning/*` | `nx_i18n_*`、`nx_learning_*` | App `/api/content/i18n`、课程完成/奖励、A4 |

隔离库最终业务基线：I1 文案 1、版本 3、实验 2；I2 通道 20、模板 20；I3 Campaign 16、通知 236；I4 版块 7、版本 13；I5 披露草稿 5；I6 语言行 9、版本 18。

### 3. 真实 Chromium 用户路径

- 首轮逐模块执行：I1 `1/1`、I2 `1/1`、I3 `2/2`、I4 `2/2`、I5 `2/2`、I6 `2/2`，合计 `10/10`。
- 所有模块均从真实登录页和当前账号可见侧栏进入，域内 `workers=1`，使用可见定位器和响应/状态等待。
- 最终候选再次执行：
  - I-001 I1–I6 畸形 200 与真实恢复：`6/6`。
  - readonly/no-write/no-menu 五层权限：`3/3`，其中 readonly 实际遍历 I1–I6。
- 监听范围内未处理 `pageerror=0`，非预期 `/api/admin/* 5xx=0`。

### 4. 主流程、空态、刷新、返回和退出重登

- I1–I6 首轮、刷新和退出重登后均回到同一服务器事实，没有用本地样例填充空态。
- readonly 账号遍历 I1–I6 后在 I6 刷新，数据与只读边界不漂移；退出后重新登录，再从可见侧栏进入 I1，菜单和数据保持一致。
- no-menu 账号刷新后仍无 I 域菜单；直接输入 I1 URL 被路由守卫移出，缓存不能恢复旧菜单或旧页面。
- I3/I4/I5 在 503 注入时隐藏权威业务面，解除注入后重新读取；I6 表单在 HTML 拒绝后保留可修正输入。

### 5. 菜单、路由、按钮、接口、数据五层权限

- `i_readonly`：
  - I1–I6 菜单可见，六条路由均可从侧栏进入。
  - 六个 overview 均为 200 且返回服务器 `data`。
  - 对应模块写控件全部隐藏或显示只读状态。
  - 六个绕过 UI 的写探针均返回 403，没有产生业务写入。
- `i_no_write`：I3 菜单、路由和数据可读；“新建 Campaign”、调度/立即下发、CAP 调整等写控件为 0；后端写接口 403。
- `i_no_menu`：I 域菜单为 0；直接 I1 路由被拒绝；I1 读写接口均为 403；刷新后仍不能由缓存恢复。
- 三类账号均通过 MFA 使用独立新上下文执行；报告、Git 和公开证据不记录凭据。

### 6. 异常与失败关闭

- 401：匿名 PC/后端管理接口拒绝。
- 403：readonly/no-write/no-menu 的真实接口拒绝与其菜单、路由、按钮状态一致。
- 409：I6 同幂等键异载荷与旧 `expectedVersion` 均拒绝，未覆盖权威数据；I1/I4/I5 合同覆盖服务端 CAS。
- 400/422：I6 原始 HTML 被拒绝，表单可恢复；I3 表单和 CAP 边界、I1/I2 结构化输入均有合同覆盖。
- 503：I3/I4/I5 受控读取故障进入失败关闭，解除后恢复。
- 畸形 200：I1–I6 各用独立新浏览器上下文注入；均显示中文模块化错误、隐藏表格和写控件，只保留“重新加载”，解除注入后恢复真实 200，没有整页错误边界或 `.map` pageerror。

### 7. 幂等、CAS 和并发

- I6 真实写链：
  - 首次草稿 200。
  - 相同幂等键和相同载荷重放 200。
  - 相同幂等键但不同载荷 409。
  - 新幂等键配旧版本 409。
  - 发布 v1、发布 v2、归档、从历史 v2 回滚生成 v3、再次归档全部按服务器状态执行。
- I1/I2/I3/I4/I5 合同覆盖稳定幂等键、未知结果保留键、CAS/行锁和非法状态转换。
- 本轮没有用并发直写绕过服务端，也没有放宽任何 Controller 权限。

### 8. 数据库、A2、A4/outbox 和上下游

- I6 验收键在写链中形成 7 条 A2 审计和 5 条 A4/outbox：
  - 审计覆盖草稿、发布、归档和回滚，actor 为当前运营员。
  - outbox 覆盖 `admin.i18n_published` 与 `admin.i18n_rolledback`；归档和历史恢复由 payload 中的目标状态/目标版本区分。
- App 匿名语言包在 v2 发布后真实返回验收文案；最终归档后不再包含该 key。
- App 定向测试：8 个文件、`28/28`，覆盖 I1 投放、通知、信任、披露、i18n 远程加载及缓存/失败关闭。
- A2 ticket/object lock 对 I6 验收键始终为 0；该链不需要高风险双人审批。

### 9. 精确清理

- 只在隔离库中按完整 I6 验收 key 清理：
  - `nx_i18n_message` 3 行。
  - `nx_i18n_message_version` 3 行。
  - `nx_audit_log` 7 行。
  - `nx_event_outbox` 5 行。
  - `nx_admin_idempotency_record` 8 行。
- 清理后 message/version/audit/outbox/idempotency/A2 ticket/A2 lock 均为 0。
- D/I 共享权限账号未由 I Owner 清理，留给主智能体在所有权限轨完成后统一清理。

### 10. 初审评分

| 维度 | 得分 |
|---|---:|
| 范围、入口与真实用户走查 | 19.8/20 |
| 数据单源与跨端调用链 | 19.7/20 |
| 权限、安全与失败关闭 | 19.8/20 |
| 幂等、CAS、审计与恢复 | 19.4/20 |
| 自动化、证据和精确清理 | 19.5/20 |
| **总分** | **98.2/100** |

初审超过 96，Owner 签发通过。下一阶段仍须由非 Owner 使用全新账号、新浏览器上下文和新夹具执行复审；本报告不代替复审结论。

## 缺陷闭环

### I-001（P1，已关闭）

- 域/模块：I1 首现，影响面扩展至 I1–I6。
- 复现：从可见侧栏进入 I1，注入 HTTP 200 且 `data.copies="malformed"`；修复前触发 `.map is not a function` 并进入英文整页错误边界。
- 根因：I 域客户端把不可信 JSON 直接 TypeScript 强转，渲染器直接使用数组/对象字段。
- 实际修复：
  - 新增 I1–I6 overview 运行时协议校验，覆盖顶层和关键嵌套数组/对象。
  - 各 endpoint 独立失败，不把畸形数据伪装为空数组。
  - 当前模块显示中文失败关闭、隐藏旧数据与写入口、提供真实重试；I5 对共享 I4 endpoint 显示 I5 专属错误。
- TDD：新协议合同先以缺少模块红灯，修复后 `6/6`。
- 完整复验：修复后候选 `PiK9WG2ICz0efJAeLyFZA` 为 `6/6`；I-002 后最终候选 `zMwYtaTe1oUh_8OZpPPq9` 再次 `6/6`，无 pageerror、无非预期 5xx。

### I-002（P1，已关闭）

- 域/模块：I3 通知 Campaign。
- 复现：readonly 从可见侧栏进入 I3 后，修复前可见 14 个写控件，而后端对应写接口为 403。
- 根因：I3 组件未读取当前 session/authority，写按钮无条件渲染。
- 影响链：菜单、路由、按钮、接口权限不一致，误导只读运营并扩大误操作面。
- 实际修复：
  - 普通 Campaign 写操作绑定 `content_i3_write`。
  - CAP 调整绑定 `content_i3_cap_adjust`。
  - 紧急 Campaign 发送在普通写权限之外再要求 `content_i3_critical_send`。
  - 行动作和抽屉二次失败关闭；未使用粗粒度角色替代 authority，未放宽后端。
- TDD：权限合同初始 `2/2` 红，修复后权限及既有 I3 合同 `5/5`。
- 扩展核查：I1/I2/I4/I5/I6 均已有对应 authority 条件渲染；未发现第二处同类无条件写。
- 完整复验：最终候选 readonly/no-write/no-menu `3/3`；readonly 实际遍历 I1–I6，I3 写控件为 0，后端写接口 403，刷新/重登/缓存均不漂移。

## 自动化结果

- PC I 域合同：`110/110`。
- PC I1–I6 首轮真实 Chromium：`10/10`。
- PC I-001 最终候选异常/恢复：`6/6`。
- PC I 域权限轨：`3/3`。
- PC TypeScript：`npx tsc --noEmit` 通过。
- App I 域定向 Vitest：8 个文件、`28/28`。
- PC 最终 Build ID `zMwYtaTe1oUh_8OZpPPq9`、PID `6104`；后端 PID `20820`，验收期间无漂移。

## 受限证据与校验值

证据根目录：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260728-151023\I`

| 证据 | SHA-256 |
|---|---|
| `permission-track-final` readonly trace | `51DF16458C1195A2471600557723521DC0FF8207B07D176F045417797679DD9A` |
| `permission-track-final` no-write trace | `2A064F306B59BD47EF3CDE36A77A7FB13813EF18611491A33779C620F4E7EA4C` |
| `permission-track-final` no-menu trace | `D97CE597A9F8F595EE8992C84E4A3CD365328BC3064AAF649ABA471156A86595` |
| `I-001-final` I1 trace | `5FF89D8367726D7E21F2F678D599ADEF551C481EDCFED28E603860C20B384F72` |
| `I-001-final` I2 trace | `37103B0527CDBDF57DD914B53AAFBC185E33A17D6465F42FC6F55407A6AD1D03` |
| `I-001-final` I3 trace | `0BE55867A9759CB60320C78B77855709A614BB6387688F64516C47F6564BC5D2` |
| `I-001-final` I4 trace | `F7BF0349DDFE94B032E25AD9F905C272ED50E1B62D8B334A4BC2A6DE25D4B085` |
| `I-001-final` I5 trace | `6FC5C73F0B2E8277A182642E0BFE7175FBAA2ADDD0F4827DA9F0A9CF354FD27A` |
| `I-001-final` I6 trace | `AA5F2DE717B16FA1F75305F1990D1F26F3105CA0545A2231C23834919707125B` |

Trace、认证状态和故障注入证据均位于受限目录，不上传 GitHub。最终统一结案时由主智能体删除失败视频、重复 trace、临时截图和过期产物，并执行凭据扫描。

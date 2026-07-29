# I 域非 Owner 复审报告（H）

## 结论

- Run ID：`pc-full-acceptance-20260728-151023`
- 复审关系：H 域 Owner 复审 I 域。
- 范围：I1–I6，共 6 个模块；每个模块独立裁决。
- 锁定基线：PC `91d1c2d`、后端 `a1cc2a7`、App `0e2178b`。
- 最终候选：
  - PC Build ID `yscCV52TBV-tx4G22DXJz`，PID `17064`。
  - 后端 JAR SHA-256 `2B96413C7D26AD4E514E67B65FDC4AF384744B2CBEC07068CA671084465D1EF2`，PID `14284`。
  - 隔离数据库 `nexion_acceptance_20260728_151023`，Redis DB 14。
- 复审裁决：**I1–I6 全部通过；I 域非 Owner 复审通过。**
- 未关闭缺陷：`P0/P1/P2/P3 = 0/0/0/0`。
- 本轮关闭：产品缺陷 `I-003`；自动化缺陷 `I-AUTO-001`。
- 复审评分：**99.2/100**，超过 98 分门槛。

本报告没有复用 Owner 的通过结论。复审者使用全新 Chromium 上下文，从登录页和可见侧栏重跑 I1–I6，并额外攻击五层权限、畸形 200、HTTP 500、网络结果未知、匿名 401、未知路由 404、同键异载荷、陈旧 CAS 和双运营员并发。主流程没有使用 mock、localStorage 权威数据或 DOM 直改；故障注入只用于异常分支。

## 模块独立裁决

| 模块 | 可见入口与主流程 | 权限、异常和跨域核对 | 结果 |
|---|---|---|---|
| I1 转化文案 A/B | 从 `/content/copy-ab` 核对文案位置、版本配置、文案池、内容历史和实验面板；刷新、退出重登后恢复同一服务器事实 | readonly 可读无写、no-menu 路由/API 拒绝；畸形 200、500、网络结果未知均在模块内失败关闭并可恢复；合同继续约束 App 四个投放面和服务端实验分桶/转化 | 通过 |
| I2 Nova 推送运营 | 从 `/content/nova` 核对真实通道、模板、事件和概率分布，刷新重登不漂移 | readonly 不渲染写入口且后端 403；畸形 200、500、结果未知失败关闭；合同覆盖 App canonical 通知账本与服务端事件 | 通过 |
| I3 通知 Campaign | 从 `/content/notifications` 核对 Campaign、通知、CAP、受众和调度；503 后可恢复真实读取 | 普通写、CAP、紧急发送分别按精确 authority 失败关闭；no-write 页面无写控件且接口 403；畸形 200、500、结果未知均不展示伪数据 | 通过 |
| I4 信任中心 | 从 `/content/trust` 核对版块、版本、字段和恢复路径；刷新重登恢复 | 草稿/发布/高敏发布权限分离；A2 待确认锁、回滚和归档合同成立；畸形 200、500、结果未知及 503 均失败关闭 | 通过 |
| I5 风险披露 | 从 `/content/disclosures` 核对法域、七章、版本、国家映射和重确认事实；刷新重登恢复 | I5 路由和权限不继承 I4；畸形共享响应显示 I5 专属错误；500、结果未知和 503 不泄露旧数据 | 通过 |
| I6 i18n 文案与课程 | 从 `/content/i18n` 核对三语词条、历史版本和课程；原始 HTML 422 后保留表单并可恢复 | readonly/无菜单边界一致；双运营员同一 v1 并发严格为 `[200,409]`；草稿、幂等、发布、App 消费、归档、回滚新版本及数据库/A2/A4 全链通过 | 通过 |

## 十步复审

### 1. 页面与动作盘点

范围真源为 `lib/nav/console-nav.ts`：

- I1 `/content/copy-ab`
- I2 `/content/nova`
- I3 `/content/notifications`
- I4 `/content/trust`
- I5 `/content/disclosures`
- I6 `/content/i18n`

动作覆盖文案/版本/实验、Nova 通道/模板/事件、Campaign/CAP、信任版块、披露法域/七章/gate、三语词条/版本/课程。

### 2. 页面到权威数据和下游溯源

| 模块 | 管理接口 | 主要权威事实 | 下游 |
|---|---|---|---|
| I1 | `/api/admin/content/copy-ab/*` | `nx_content_copy*`、`nx_content_experiment*` | App home/store/earn/me、订单转化、A2/A4 |
| I2 | `/api/admin/content/nova/*` | `nx_nova_channel`、`nx_nova_template`、`nx_nova_social_*` | App 通知、H1、A4 |
| I3 | `/api/admin/content/campaigns/*` | `nx_notification_campaign`、`nx_notification_cap_rule`、`nx_notification` | App 通知、I5/J 应急链、A2/A4 |
| I4 | `/api/admin/content/trust-disclosure/*` | `nx_trust_section*` | App 信任中心、A2/A4 |
| I5 | `/api/admin/content/trust-disclosure/*` | `nx_disclosure_*` | App 风险披露、重确认/gate、A2/A4 |
| I6 | `/api/admin/content/i18n-learning/*` | `nx_i18n_message`、`nx_i18n_message_version`、课程事实 | App `/api/content/i18n`、A2/A4 |

### 3. 真实 Chromium 用户路径

- I1–I6 可见主流程/刷新/重登：`10/10`。
- I6 双运营员原子 CAS：`1/1`。
- I6 完整生命周期：`1/1`。
- 所有浏览器轨均为 Chromium、域内 `workers=1`、可见定位器和响应/状态等待。
- 用例监听的非预期页面错误和非预期 `/api/admin/*` 5xx 均为 0。

### 4. 空态、刷新、返回和退出重登

- I1–I6 刷新后继续读取服务器事实，没有本地样例回填。
- I1、I3、I4、I5、I6 完成退出重登；权限轨又以独立账号完成刷新和重登。
- no-menu 账号刷新后仍无 I 域菜单，直接 URL 不能从缓存恢复权限。
- 读取故障解除后通过真实重试恢复，不保留故障前的可写业务面。

### 5. 菜单、路由、按钮、接口、数据五层权限

- readonly：I1–I6 菜单、路由和数据可读；写控件隐藏；六类直接写探针均为 403。
- no-write：I3 菜单、路由和数据可读，普通写/CAP/紧急发送控件按 authority 隐藏，后端写接口 403。
- no-menu：I 域菜单为 0，直接路由被拒绝，读写接口均为 403，刷新后仍不能恢复。
- 最终候选权限轨：`3/3`。

### 6. 异常和失败关闭

- I1–I6 畸形 HTTP 200：`6/6`，均显示模块化中文错误、隐藏旧业务与写控件，真实重试后恢复。
- I1–I6 HTTP 500 与网络结果未知：`12/12`，均在模块内失败关闭并恢复。
- 匿名管理接口 401、已认证未知管理路由 404：`1/1`。
- I3/I4/I5 503、I6 原始 HTML 422 均按预期关闭；I6 表单保留可修正输入。

### 7. 幂等、CAS 和双运营员并发

I6 使用带 Run ID 的新隔离 key 执行：

1. superadmin 从可见 I6 表单建立 `v1` 草稿。
2. 同载荷、同幂等键重放返回相同 `v2`。
3. 同一幂等键不同载荷返回 `409 IDEMPOTENCY_KEY_PAYLOAD_MISMATCH`。
4. 新幂等键配陈旧 `expectedVersion=v1` 返回 `409 I18N_MESSAGE_VERSION_CONFLICT`。
5. superadmin 与独立 MFA checker 对同一 `v1`、不同三语载荷并发，最终严格为 `[200,409]`，只有一方推进版本。

`I-003` 的第一次修复只增加版本但仍可能让旧快照成功，真实复现仍为 `[200,200]`；最终修复改为数据库条件更新：

`id + status='DRAFT' + is_deleted=0`

只有受影响行数为 1 才可插入新版本；竞争者受影响行数为 0，Service 明确映射 409。旧快照不再执行无条件 `updateById`。

### 8. 数据库、App、A2 和 A4/outbox

I6 生命周期的服务器事实：

- 可见入口创建 v1；编辑生成 v2，发布后 App 匿名 `zh-CN` 语言包命中 v2。
- 从 v2 创建并发布 v3，App 切换为 v3。
- 归档 v3 后 App 不再返回该 key。
- 回滚历史 v2 生成新的 v4 published，App 恢复 v2 文案。
- 归档 v4 后 App 再次移除该 key。
- 清理前：语言行 3、活跃版本 3、物理版本 4、软退役版本 1、A2 审计 8、A4/outbox 5、A2 待审 0、对象锁 0。
- 版本接口最终只暴露 `v4/v3/v2` 三个 archived 历史；软退役 v1 不作为活跃历史返回。

### 9. 精确清理和候选稳定

- 最终全前缀核对：
  - `nx_i18n_message = 0`
  - `nx_i18n_message_version = 0`
  - `nx_admin_idempotency_record = 0`
  - A2 pending ticket `= 0`
  - A2 object lock `= 0`
- 按主控要求，不删除不可变证据：两轮红灯、最终 CAS 和生命周期合计 A2 审计 16 条；最终生命周期 A4/outbox 5 条。
- 清理只作用于完整 `acceptance.i6.review_h_r151023_*` 业务夹具，不触碰正式词条。
- 最终复审期间 PC Build/PID 和后端 JAR/PID 未漂移。

### 10. 评分

| 维度 | 得分 |
|---|---:|
| 范围、入口与首次用户走查 | 19.9/20 |
| 数据单源与跨端调用链 | 19.9/20 |
| 权限、安全与失败关闭 | 19.8/20 |
| 幂等、原子 CAS、审计与恢复 | 19.9/20 |
| 自动化、证据与精确清理 | 19.7/20 |
| **总分** | **99.2/100** |

复审超过 98 分，I 域通过。按规则，本任务完成恢复 10 点血量，当前血量保持 `100/100`。

## 缺陷闭环

### I-003（P1，已关闭）

- 复现：两个独立运营员从同一 v1 快照并发提交不同三语文案，修复前双方均得到 200。
- 根因：草稿原地更新同一版本；应用层标签比较和行锁不能形成“旧快照只能成功一次”的数据库不变量。
- 根修复：每次草稿成功编辑分配新版本；原草稿用数据库原子 CAS 软退役，affected rows 必须为 1；竞争失败转 409。
- 棘轮：Repository 成功推进、竞争失败禁止 insert、Service 409 映射、双运营员真实 E2E、完整生命周期 E2E。
- 最终结果：定向后端 `94/94`、后端全量 `2838/2838`（skip 2）；浏览器 CAS `1/1`，严格 `[200,409]`。

### I-AUTO-001（P3，已关闭）

- 现象：I3/I4/I5 的旧 503 自动化仍断言淘汰文案“暂无真实接口数据”。
- 修复：断言同步为当前模块化“数据加载失败，请刷新重试”，不改产品行为。
- 复验：I3/I4/I5 可见失败/恢复轨全部通过；I1–I6 统一 500/结果未知矩阵 `13/13`。

## 自动化汇总

- I 域静态/合同：`119/119`。
- 五层权限：`3/3`。
- 畸形 200：`6/6`。
- I1–I6 可见主流程、刷新和恢复：`10/10`。
- HTTP 500、网络结果未知、401/404：`13/13`。
- I6 双运营员原子 CAS：`1/1`。
- I6 完整生命周期、App/DB/A2/A4：`1/1`。
- 后端定向：`94/94`。
- 后端全量：`2838/2838`，失败 0、错误 0、跳过 2。

## 受限证据与校验

证据根目录：

`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260728-151023\I\review-H`

| 证据 | 数量 | SHA-256 |
|---|---:|---|
| I6 双运营员 CAS trace | 1 | `B01D916FBA8D4ACE84B9AD9A135F4FE27F4E9225B9F2ECE07480BC40445B8874` |
| I6 生命周期 trace | 1 | `7785D318579A6487A85FE04C6D0334A7DAD077C6D6BD63284FCADFAB15932B22` |
| readonly trace | 1 | `56EF53D8003E0210113509FD7ED0D48576DBFE352B0FFC3CD85F3634581DB14F` |
| no-menu trace | 1 | `352CF79A93DBBCD65ABB81BB3071F8E936DC2D8076128731E489D08C24B64F69` |
| no-write trace | 1 | `73A58EC69AD204DD7DD1D59B3352849DA23F7EA10EA0CCE3D2D3B64BF5E333C6` |
| 畸形 200 trace 集合（排序后哈希清单摘要） | 6 | `2C5336BE98BD493E11B452349D16606235601318BEC2AFB26119C69F5538F861` |
| I1–I6 可见轨 trace 集合（排序后哈希清单摘要） | 10 | `DAD94481669D09ED8C98B11B6C835D5F8A7D44BC4F23284CEDB27143968D452B` |
| 500/结果未知/401/404 trace 集合（排序后哈希清单摘要） | 13 | `53938902FDC4625ACD6B3A5C107C47CC30AB37B7D5CB7049AFD8A9F7A9416AEA` |

Trace、截图、认证状态和生命周期 JSON 位于受限目录，不进入 GitHub。最终结案由主智能体统一删除前置红灯/重复 trace、调试视频和临时截图并执行凭据扫描。

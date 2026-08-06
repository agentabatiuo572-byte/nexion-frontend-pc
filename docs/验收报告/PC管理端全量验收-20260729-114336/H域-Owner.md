# H 域 Owner 初审报告

## Final7 候选复跑状态（2026-08-01）

本节覆盖此前 Final3 的结论：当前锁定候选为 PC Build `AQh7aBmA0B3cWFXbKfIIn`（`http://127.0.0.1:3002`）和后端 JAR SHA-256 `476E6C77BCDC39935865A656EED1399EB3EA56A760E0645D0949790A919D70E2`（`http://127.0.0.1:8110`）。

- 已从真实登录页和可见 H 侧栏、单 worker 完成并通过：五层权限 `3/3`、读取故障 `3/3`、H1 `4/4`、H2 `4/4`、H3 可见主链 `1/1`、H4 `1/1`、H5/H7 `2/2`、H8 可见与认证边界 `1/1`，合计 `19/19`。
- 原始 trace、截图及 JSON 结果位于受限目录 `D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\H\final7-owner\`，未覆盖历史 H8 证据。
- 锁定 App 候选 `D:\workspace\.acceptance\pc-full-acceptance-20260729-114336-app-master`（通过 `NEXION_APP_ROOT` 显式指定）上的 H 静态合同为 `60/60`，覆盖 H1–H8 前后端/权限/CAS/A2/App remote consumer，全部通过。先前对当前脏 `NX1.0` 工作区的 `49/54` 结果不属于锁定候选，已撤销且不登记产品缺陷。
- **暂不签发 Final7 H 域通过。** 完整闭环仍缺 H3 双运营员 CAS/结果未知与 H8 App inviter→invitee→A2 maker/checker 结算。原因是主隔离库中的旧 H `secondWriter` 已按上一轮清理移除；该共享认证/跨域夹具须由主控重新发放后再执行，不能以单人、SuperAdmin 或旧子环境证据替代。

### Final7 夹具刷新后的重跑门禁

- 主控已于本轮随后重新发放 H 专用 MFA 夹具；新 manifest 的 SHA-256 为 `725739E5A9BFCEF974FAAE3EEFBCA6FB29AEDE19213B37C7933C4A26EB503294`，凭据只存在于受限目录，未写入本报告。
- 使用新夹具从登录入口执行的权限矩阵为 `3/3 PASS`，证据在 `H/final7-owner-r2/permission-matrix/`。
- 在主控明确要求先保持无写之前，曾误启动一次 H3 CAS 波次；该波次 `1/1 PASS`，且载具 finally 已恢复 `promoBanner.countdownDays`，但**流程违规，不得作为 Owner 通过证据**。其 trace、前后快照与恢复证据保留于 `H/final7-owner/h3-cas/`；待主控释放共享 A 窗口并签发 `H_FINAL7_WRITE` 后，必须从登录入口完整重跑 H1–H5、H7、H8 与 H3 CAS，不能只补跑该点。

执行日期：2026-07-29 至 2026-07-30  
Run ID：`pc-full-acceptance-20260729-114336`  
范围：H1、H2、H3、H4、H5、H7、H8（H6 已按产品定义并入 H5）  
结论：**通过**

## 1. 锁定候选

| 项目 | 锁定值 |
|---|---|
| PC 仓库 | `main@1d9dc8dffa40`，含本轮未提交工作树修复 |
| PC 运行实例 | `http://127.0.0.1:3302`，Build ID `B9Ondo82Dj7NKNNE6ZcgB`，PID `25128` |
| 后端仓库 | `main@f4a943ec1fe5`，含 H3 并发修复及本轮未提交工作树修复 |
| 后端运行实例 | `http://127.0.0.1:18110`，PID `26424` |
| 后端 JAR SHA-256 | `54B25D49CC36BAB02E1E36627CE5D9296AE92717FBACEFD5F222EE04528E59E4` |
| MFA | `temporary-superadmin-bypass=false`，真实账号、密码和 TOTP 登录 |
| 隔离数据 | MySQL `nexion_acceptance_20260729_114336_irreversible`、Redis DB `15`、隔离 MinIO bucket |
| App 仓库基线 | `master@0e2178b59af9` |

候选门禁已核对 PC Build、运行进程、后端 JAR、JAR 后启动进程、MFA bypass 显式关闭、服务可达性、OTP sink、权限夹具哈希以及 Playwright 用例发现。最终 H8-only continuation 还锁定了前序 H3 数据库证明哈希，未重复执行已经通过的写链。

## 2. Owner 最终结论

- Playwright 最终结果：`21/21` 通过，`unexpected=0`、`skipped=0`、`flaky=0`。
- 真实 App 邀请链：`1/1` 通过。
- H1、H2、H3、H4、H5、H7、H8 均从真实登录页和可见侧栏进入；覆盖返回、刷新、退出重登以及失败后的恢复入口。
- 五层权限通过：菜单、路由、按钮、接口和数据同时验证；readonly、nowrite、nomenu 均按预期失败关闭。
- 读取故障矩阵通过：畸形 200、500、超时均不展示伪成功、不开放写入口，恢复后可继续。
- 成功写链、幂等重放、CAS 冲突、结果未知、maker/checker、A2、A4/outbox 和关联域落账均已真实验证。
- 本轮 H 域未关闭 P0/P1/P2/P3：`0`。

Owner 初审评分：**99.2/100**。  
G 域非 Owner 智能体已完成独立对抗复审：静态合同 `60/60`、Playwright `21/21`、App 邀请链 `1/1`，产品 P0–P3 为 `0`，exact cleanup 通过，评分 **99.4/100**。两阶段分数均严格达到门槛，H 域签发通过。

## 3. 最终波次结果

| 波次 | 结果 | 主要覆盖 |
|---|---:|---|
| 权限矩阵 | `3/3` | readonly、nowrite、nomenu；菜单/路由/读写接口；刷新、重登 |
| 读取故障矩阵 | `3/3` | 畸形 200、500、超时；失败关闭与恢复 |
| H1 | `4/4` | 首次用户可发现性；跨域权威读；真实写入、回读、恢复；401/404/422/冲突与幂等 |
| H2 | `4/4` | 试用和奖励语义；写入、刷新、重登、恢复；读取失败与异常参数 |
| H3 可见主链 | `1/1` | 任务引擎可见入口和 H1 关联 |
| H3 双运营员 CAS | `1/1` | 同旧值并发只有一个成功；失败方 422；结果未知同键重放；精确恢复 |
| H4 | `1/1` | 活动中心可见入口和只读真值 |
| H5/H7 | `2/2` | H5/H6 主链、刷新、异常恢复；H7 创建、编辑、暂停、刷新、重登、删除 |
| H8 可见与认证边界 | `1/1` | 可见入口、刷新、重登、失败关闭、未认证/App/ADMIN 边界 |
| H8 App 邀请链 | `PASS` | inviter canonical code → invitee 归因注册 |
| H8 maker/checker 结算 | `1/1` | A2 提案、独立 checker 批准、钱包、D4、A2、A4 |

## 4. H3 并发与结果未知证明

H3 曾出现双运营员同旧值并发时 `[200,500]` 的 MySQL deadlock。修复后使用两名独立 H3 写账号并发提交：

- 一个请求成功，另一个稳定返回 `422 QUEST_CONFIG_STALE`，未再出现 500。
- winner：幂等记录、审计、outbox 为 `1/1/1`。
- loser：服务端以 `SUCCEEDED` 幂等记录保存确定性的 stale 响应；审计/outbox 为 `0/0`。
- 结果未知：首次请求在载具侧可表现为 unknown；使用相同 Idempotency-Key 重放返回 200，幂等记录、审计、outbox 仍为 `1/1/1`，没有重复副作用。
- `promoBanner.countdownDays` 完成后精确恢复为 `4`。

首个 R6 wrapper 错把真实幂等状态 `SUCCEEDED` 断言为 `COMPLETED`，并使用受会话时区影响的数据库时间窗清理，因此在业务用例通过后被载具门禁判 RED。该事件已定性为验收脚本缺陷，不计产品缺陷。最终处理为：

1. 按真实后端合同锁定 `SUCCEEDED`；
2. 只读重算 H3 数据库证明；
3. 对三条证明记录按 Run ID、scope、idempotency key 和行 ID 核身后精确软删除；
4. 清理逻辑改为 Run ID + H scope/key 的 exact manifest，不再依赖 DB/JDBC 时区；
5. 以 H8-only continuation 完成尚未运行的 App 与结算波次，不重复前序成功写链。

## 5. H8 真实 App 与结算闭环

- 独立 inviter 完成真实注册并取得本人 canonical referral code。
- invitee 使用该码完成 OTP 和注册，数据库归因指向 inviter。
- PC maker 从真实登录和可见 H8 入口提交 A2 结算提案。
- 独立 checker 具备显式 `growth_h8_settle` 权限，完成 maker/checker 分离审批。
- 结算结果贯通邀请奖励、用户钱包、D4 台账、A2 审批留痕和 A4/outbox。
- same-actor、越域、未知对象和无业务权限继续失败关闭。
- 测试用户、会话、钱包、security、OTP、结算、台账、操作单、对象锁和临时准备金夹具均精确清理；不可变审计和 outbox 按审计边界保留。

## 6. 缺陷闭环

| 编号 | 现象 | 最终定性与结果 |
|---|---|---|
| H-P1-001 | nomenu 首帧短暂保留 H URL | 异步路由 guard 时序误报；DOM 无 H 数据、接口 403，随后稳定重定向。修正等待条件后权限矩阵 `3/3`。 |
| H-001 | App 推荐码可能受非 canonical/缓存态影响 | 已改为认证 USER 自身最小响应和会话级 canonical 状态；未认证、ADMIN、切号、401、畸形响应均失败关闭；真实 App 链通过。 |
| H-002 | H8 A2 delegated descriptor 缺失 | 已补 H8 canonical descriptor 与业务权限映射；真实 maker/checker 结算通过。 |
| H-003 | App inviter→invitee 注册出现 MySQL deadlock 500 | 已修复并在最终真实 App 链中关闭。 |
| H-004 | H3 双运营员 CAS 出现 MySQL deadlock 500 | 已增加数据库互斥和 H3 stale 冲突映射；最终 CAS、幂等、结果未知及 DB 证明全部通过。 |
| H-CARRIER-001 | R6 proof 期待 `COMPLETED`、cleanup 使用时区时间窗 | 验收载具缺陷；修为 `SUCCEEDED` 和 exact identity cleanup，预检及 continuation 均通过，不登记产品缺陷。 |

## 7. 清理与恢复

最终数据库哨兵：

| 检查项 | 结果 |
|---|---:|
| H3 `countdownDays` | `4` |
| 本 Run H active idempotency | `0` |
| H7 临时代金券 | `0` |
| H8 测试用户、钱包、会话、security | `0/0/0/0` |
| H8 结算、钱包台账、OTP | `0/0/0` |
| H8 操作单、对象锁 | `0/0` |
| H8 临时准备金夹具 | `0` |

Redis DB 15 仅按 H 专用 adminId 核身清理，未执行 flush：账号 `99594–99597`、`99679` 共删除 23 个 session；session membership 和 session key 均为 `0`。共享 checker `99531` 未在域内擅自清理，留给主智能体在确认无其他域占用后执行全局 closeout。

## 8. 证据

受限证据目录：

`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\H\final3-owner`

目录包含：

- 10 个 Playwright 波次的 `results.json`、trace、截图和业务结果；
- H3 `cas-runtime.json`、数据库证明和 exact cleanup proof；
- H8 App 结果、maker/checker 结算 trace、钱包/D4/A2/A4 结果与清理证明；
- candidate preflight、R6/continuation stdout/stderr、Owner summary；
- 受限凭据/清理 manifest（不得上传、不得写入公开报告）。

证据清单：`SHA256SUMS.json`，`78` 个文件；清单 SHA-256：

`18C719BE0FF60FE26C81E61952B9071B4941A1737DE73C19F536D16DFF69E61D`

关键证明 SHA-256：

- H3 DB proof：`2BF929B620BB155C2D8ACFD96E3903668979672CDDC5D29D61D7D0F31853DAD9`
- H3 exact cleanup proof：`BF2DFE7FF4D7215ECCB00BB4C63C8B9271F513151BACB216E8962BAE4D6B2716`
- H8-only Owner summary：以 `SHA256SUMS.json` 中记录为准

独立复审报告：

`docs/验收报告/PC管理端全量验收-20260729-114336/H域-非Owner复审-G.md`

报告 SHA-256：`5F486A32AB67C65BECE2D65291FC40722493A9FA540AE874F8563DF677F94008`。  
非 Owner 受限证据清单共 `72` 个文件，清单 SHA-256：`9B5435A5C89C9CFE04D897D1518952D496A4FA35873A3B2A7B0C4CFEB61E7A8B`，重算 `72/72` 一致。

## 9. 历史阻断说明

本 Run 早期报告中的“待写令牌”“H8 子环境阻断”“checker 权限漂移”“App 注册 deadlock”和旧候选 Build 均为历史过程记录，已经被本报告的 final3 锁定候选、真实运行时证据和清理哨兵取代，不再作为当前阻断项。历史原始证据仍保留在 H 域受限目录，未被覆盖。

## Final10 Owner 全量复跑（2026-08-01）

本节只对应冻结候选 Final10：PC Build `zGL97cq44U6qzzAKmh415`（PID `3520`、`http://127.0.0.1:3002`），后端 JAR SHA-256 `ED80116D6B7D7C025490C4EEC180D53F135D712DB0A4D5C89D6FA4D8D9A9F947`（PID `23136`、`http://127.0.0.1:8110`），主隔离库 `nexion_acceptance_20260729_114336`，MFA bypass 明确为 `false`。H 专属 MFA 夹具已核对 SHA-256 `EBEC17601534027E527DDF61A243A3662CF308D981E96719EF4A2C6BA335A80B`，凭据未写入本报告。

### 已完成且通过

- 静态前后端/App 合同 `22/22 PASS`：H1 `2/2`、H2 `4/4`、H3 `3/3`、H4 `3/3`、H5 `3/3`、H7 `3/3`、H8 `7/7`。
- 从真实登录页及可见 H 侧栏完成：H1 `4/4`、H2 `4/4`、H3 首次用户可见链 `1/1`、H4 `1/1`、H5/H7 `2/2`、H8 可见入口/刷新/退出重登/未认证失败关闭 `1/1`，均无 pageerror、非预期 console error 或管理接口 5xx。
- H3 两名独立运营员 CAS、stale `422`、结果未知同键重放、审计以及精确恢复 `1/1 PASS`。
- 五层权限：readonly、nowrite、nomenu 三角色 `3/3 PASS`；每个角色覆盖 H1/H2/H3/H4/H5/H7/H8 的菜单、路由、按钮、接口、数据及刷新重登。
- 墨菲读取故障：畸形 200、500、超时三波 `3/3 PASS`，页面失败关闭且恢复后可继续。
- H8 App 关联的当前 OTP 载具补充注册链已验证：独立 inviter→canonical code→invitee 归因注册及退出 `PASS`，产生的精确清理清单仅位于受限目录；它不替代 H5 生产包的可见走查。

### H8 环境受阻与安全收口

H8 真实结算的 maker→A2→独立 checker 链已从可见入口走到审批执行，后端返回 `422 B1_COVERAGE_DATA_UNAVAILABLE`。该结果为安全失败关闭：当前 Final10 主隔离库的 Genesis 恢复后覆盖读模型不可用，不能把不可逆准备金写入主库作为验收夹具。

- 已由独立 checker 在可见 A2 页面取消本次未执行提案 `WO-260801201242890-0`；只读数据库复核为 `rejected`、`pending=0`、该 ticket 对应对象锁 `0`。
- 旧 H8 API 验收载具读取已废弃的 OTP `GET /last`，而当前 carrier 只暴露投递端点及受限 OTP 文件；对 TLS proxy 使用明文 HTTP 也会被拒绝。另，H5 生产包 API base 的现状不能作为 H8 可见 App 走查结论。上述均记为**验收环境/载具受阻，待 Final11 修复打包并在独立 disposable H 环境补验**，不登记为产品 P0–P3，也不冒充 H8 通过。

### Final10 结论

**H 域 Owner：HOLD（不评分、不得签发通过）。** H1–H5、H7 与 H3 并发闭环均已重跑通过；H8 的真实资金结算及生产 H5 可见链须在独立可处置环境补验。Final10 本轮未发现新的产品 P0/P1/P2/P3；H8 环境阻断未计入产品缺陷。

受限原始证据：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\H\final10-owner\`，共 `73` 文件，聚合 SHA-256 `B14E1DD93F3B8D3EA39BBCCE94621E807BE0052712200B46144333D739DD3EF5`。历史证据未被覆盖。

## Final11 Owner 全量验收（2026-08-01）

本节仅对应协调运行时锁 `FINAL11_RUNTIME_LOCK.json`：PC Build `xwL3BUki3xjXtoLr7RsWb`（`http://127.0.0.1:3002`）和后端 JAR SHA-256 `09BF09404F1F29A2110306E773C31529D3D1F835B04FAC5C34175FF8B467B66D`（`http://127.0.0.1:8110`）；MySQL 为 `nexion_acceptance_20260729_114336`。全程 `workers=1`、真实用户名密码与 MFA 登录，未改候选源码、未覆盖历史 H8 证据。

### 已通过的 Owner 证据

- H 前后端及 App OTP carrier 静态合同 `37/37 PASS`：含 H1–H8 合同、受限 OTP sink、过期/错 run/malformed row 失败关闭、无凭据泄漏和已移除 `GET /last` 的防回归。
- 从真实登录页和可见 H 侧栏的全量浏览器波次为 `20` 例，其中 `19` 例通过：H1 `4/4`、H2 `4/4`、H3 首次用户可见链 `1/1`、H4 `1/1`、H5/H7 `2/2`、H8 可见/刷新/退出重登/未认证边界 `1/1`、五层权限 `3/3`，以及 H1–H8 畸形 200、500、超时失败关闭 `3/3`。无已关闭的产品 P0–P3。
- H8 App 真实链 `PASS`：inviter 注册、取得 canonical referral code、invitee 经投递到受限 OTP sink 的 OTP 注册并归因、双方退出均完成；凭据和测试身份只写入受限清理清单。
- H8 App 测试数据已 exact cleanup：用户、session、wallet、security、registration OTP 五类哨兵均为 `0`。本轮临时 B1 reserve 仅为 `id=146`、marker `RSV-ACC-H8-3B64655E656CE388/ACC-H8-3B64655E656CE388`；已精确删除，marker `0`，confirmed reserve 恢复为 `4` 行、净额 `0.000000`。`B1_COVERAGE_FINAL11_H8.lck` 已释放。

### 阻断与定性

1. `H-FINAL11-CARRIER-001`（P3 验收载具）：H3 双运营员 CAS 的旧 `secondWriter` 无法登录。按现有可见 A1/A6/A2 setup/recovery 重建独立 secondWriter 时，角色创建和 A2 批准成功，但由当前 A maker 创建账户并分配该角色被真实后端拒绝为 `403 ROLE_ASSIGNMENT_FORBIDDEN`。因此新 secondWriter 未生成，不能用旧身份、SuperAdmin 或历史 CAS 代替；H3 本轮 CAS/结果未知闭环未重跑。
2. `H-FINAL11-CARRIER-002`（P3 验收载具）：H8 settlement runner 有两项隔离缺陷：一是环境变量中的 invited/inviter 身份可泄漏，首次 progress 与本轮 App 身份不一致；二是可见结算仅提交 `limit=1`，在共享库中会结算更早的待处理关系，而非本轮 App 邀请对。实际 A2 批准后，本轮 App 对的 settlement 和 wallet ledger 均为 `0`，不能把另一关系的 settled 计数增加登记为 H8 通过。该结论不登记为 H8 产品缺陷。

### Final11 结论与交接

**H 域 Owner：HOLD。** 初审评分 `93.0/100`，未达到通过门槛，因此不触发通过性复审。需由独立非 Owner 修复并隔离上述 P3 载具后，在同一锁定候选上重新从登录/侧栏完整跑 H1–H5、H7、H8 与 H3 双运营员 CAS；不得仅补点重测。

Final11 受限证据：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\H\final11-owner\`。其中含浏览器 trace/截图、H8 App carrier 结果、H8 A2 尝试、B1 锁与 exact cleanup 记录；敏感清单不得上传或摘录。

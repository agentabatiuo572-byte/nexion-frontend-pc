# B 域 Owner 验收报告

## Final11 Owner 全量验收（2026-08-01，Owner 初审签发）

- 运行锁：`pc-full-acceptance-20260729-114336 / Final11`；主候选 PC `http://127.0.0.1:3002`（BUILD_ID `xwL3BUki3xjXtoLr7RsWb`）、后端 `8110`、隔离库 `nexion_acceptance_20260729_114336`。运行锁 SHA-256：`FB43D1BCC47A5EA371562E3B87CF7C9FF0B4BEDD0A9D7160A3FC255C7E280E07`；冻结 JAR SHA-256：`09BF09404F1F29A2110306E773C31529D3D1F835B04FAC5C34175FF8B467B66D`。
- 真实浏览器（Chromium、`workers=1`）使用 MFA，从登录页和可见侧栏完成 B1→B5、逐页刷新、B5→B4 返回、退出重登，以及 B5 首访/刷新/重登 SSE 与断线降级：写后完整重跑 `5 passed, 2 scoped skips`。两个角色隔离项均由下列独立角色套件写后实跑补齐，未删除覆盖。
- 独立权限套件：readonly、nowrite、nomenu 的菜单、直链、读取、按钮、写接口、刷新和重登全部通过，`3/3 PASS`。B5 无菜单角色的快照和 SSE 读取均为 `403`，独立实跑 `1/1 PASS`。
- 独立 checker 核对 B1/B2/B5 资金事实、B4/H1 八个 dial、B5/J1 五闸同源，`1/1 PASS`。B1 真实 `reserveUsd=0` 且负债大于零时只显示红线告警和建议，未自动注资、降红线或开闸。匿名、非法路由/参数、畸形 200、500、超时/断网均失败关闭。
- B 域静态合同：按 Final11 分组口径 `39/39 PASS`（原 B 合同 `36` 项 + 参数化写载具合同 `3` 项）。参数化初接入时曾出现 `36/37`：运行载具已改为 `EXPECTED_CANDIDATE`，但静态断言仍查找旧的 `"Final10"` 字面量；已同步断言并复跑全绿。这是验收载具合同差异，未进入产品链路，未形成未关闭 P0–P3。B1 注资为入账储备、B2 零到期不伪造覆盖天数、B3 A4 漏斗与失败关闭、B4 H1 权威、B5 中文映射/固定 e(t) 均在合同内锁定。

### B2/B3 写链、单例恢复与共享幂等韧性

- 主控已以 `B_EXPECTED_CANDIDATE=Final11` 锁定本候选，使用两个独立 MFA 运营员从可见侧栏打开 B2/B3 后执行写链：B2 同版本并发为 `200 + 409 D3_FORECAST_CONFIG_VERSION_CONFLICT`；赢家同键同载荷回放 `200`，同键异载荷 `409 IDEMPOTENCY_KEY_PAYLOAD_MISMATCH`；服务端提交后客户端断连，使用同键恢复为 `200` 且返回严格相同结果。B3 保存视图为 `200`、同键回放 `200`、异载荷冲突 `409 IDEMPOTENCY_KEY_PAYLOAD_MISMATCH`。
- 数据侧在写入窗口核对：A2 审计 `2`、A4/outbox `2`、成功幂等 `3`、保存视图 `1`。写链 finally 收口后：`treasury.d3.forecast-config*` 精确恢复为 `8` 行（active version `8`、pending 值/版本均为空、配置 JSON 恢复到写前），运行视图 `0`；审计、outbox 和已完成幂等按不可变审计边界保留。
- 共享幂等韧性：本 case 的 `PROCESSING=0`、`UNKNOWN=0`、`SUCCEEDED=3`、`FAILED=1`（预期同键异载荷冲突）。断连场景实际为已提交 `SUCCEEDED` 后同键回读，并非遗留 PROCESSING 或未决 UNKNOWN；未观察到 MySQL deadlock、5xx 或接口降级。故 `markExpiredProcessingUnknownBatch` 的已知死锁风险未在本 B case 触发，也没有本 case 残留需要转 UNKNOWN。
- B1 的 0% 覆盖率资金前置和 B2 单例变更均未触发自动注资/红线下降/开闸；写后从登录侧栏全量重跑 B1–B5、权限和跨域同源均通过。
- 收口复核：本 case 的可变视图为 `0`、配置单例已恢复，`coordination/locks` 中无 B 域锁。主控交付的 maker/secondWriter 夹具是运行前既有受限夹具，本 case 未创建新账号、角色、菜单或 MFA 残留；其全局生命周期由夹具 Owner 统一收口，不将其他仍在运行域的锁误删。

### Final11 原始证据与哈希

- 证据根目录：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\B\final11-owner\`。
- 写链 JSON：`main-write/b-final10-main-write-final11-owner-r1.json`，SHA-256 `D3A21EE96D1CF53CF02DB6E6B676FC6F66AB280A8A500D7D1EFDA7506EE396BB`；双运营员 B2/B3 trace SHA-256 `939E0002DED7F46CD94BBA6318DC56AFBBCCCEBC86C4644C687506ADDC8464D2`。
- 写后可见入口与生命周期 trace：`post-write-owner/...B1-B5-从登录页和可见侧栏完成首轮、刷新、返回、退出重登.../trace.zip`，SHA-256 `D0FB2329664EE69A5D1EDC9253571821DD26C85146F034701B358A4C7823B181`；B5 SSE trace SHA-256 `1A43E955969F2CFE1E2D71B9695FF67C3E1EEFC35D3787642D09BDB6F5F8F332`。
- 失败关闭 trace：畸形 200/500/超时 SHA-256 `E5FC3182EF77577FF4ED6A7B6F069CB57B4069ED3018D1BAE10CBF6022D667AA`；匿名/非法边界 SHA-256 `4F454E54453827F840D33E1D3DEB80B3717321B91B0FE843341060E70D2731F6`；B1 0% 覆盖红线 JSON SHA-256 `8D3F76397CF91E5B4C4F8E3F9CFC57ED3B3EF41E9F6CDADC2C5DF91E20D2CEF7`。
- 写后权限 trace：readonly SHA-256 `51E172D74D6FC50A869D6DA83289074641CA3AF0F29ABBD0FC0DAEE5B37A52FC`、nowrite `1A8E1F45E4EE8B2FD7461B995BDCB12292AF97E4DF289255C623591DC03E1AFC`、nomenu `904C667AB4C5FC004A7F3D8381E5E82143D65EECB75B9712E407A698BC2F24BA`；B5 无菜单 SSE JSON SHA-256 `C091707ADCD3FA7832FAFBF6174EE4CC4BCE717636623F87A27BCDF8120C9BCB`，trace `FA9C8B74581059357AF874907752B9564AA03DDB613F58FF6E2CF03EFF3C2968`。
- 写后跨域 checker trace SHA-256 `0015CD280E5472FE7FC23070EB41CAD144593383C1910717E8857319DB8CA07D`，同源快照 JSON SHA-256 `887FA85A1779B2DD3360D265E371E080A8CD025196BE6F024EE312778EB19B72`。

### Owner 评分

- 初审：**99.0/100，PASS**（严格大于 96）。B1–B5 全量范围均有当前 Final11 浏览器、写链、DB、权限、失败关闭和跨域证据；未关闭 P0/P1/P2/P3 为 `0`。
- 复审：待非 Owner 独立 Agent 按同一 Final11 候选执行，不可由 Owner 自评替代。

## Final7 Owner 复跑（待写链补验，不签域通过）

- 本次锁定候选：PC Build `AQh7aBmA0B3cWFXbKfIIn`（`http://127.0.0.1:3002`）；后端 JAR SHA-256 `476E6C77BCDC39935865A656EED1399EB3EA56A760E0645D0949790A919D70E2`（`8110`）；主隔离库 `nexion_acceptance_20260729_114336`、Redis DB 13、运行 bucket `nexion-acceptance-20260729-114336`。
- 真实浏览器（单 worker、真实 MFA 登录、可见侧栏）完成 B1–B5 首访、逐页刷新、B5→B4 返回、退出重登、B5 SSE 首访/刷新/重登/断线降级、B1 的真实 0% 覆盖率失败关闭、匿名和非法参数边界、B1–B5 畸形 200/500/超时失败关闭：`5/5 PASS`，未观察到 pageerror、非预期 console error 或管理接口 5xx。
- 权限五层：`readonly`、`nowrite`、`nomenu` 分别从登录入口执行 B1–B5 菜单、路由、读取、按钮、写接口、刷新及重登：`3/3 PASS`；nomenu 对 B5 快照与 SSE 均为 `403`：`1/1 PASS`。
- 独立 checker 复核 B1/B2/B5 资金事实、B4/H1 八项 dial、B5/J1 五个 gate 同源：`1/1 PASS`。B1–B5 静态合同 `29/29 PASS`。
- 原始证据：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\B\final7-owner\`（`core-rerun`、`playwright-core`、`playwright-permission`、`cross-domain`、`playwright-cross`、`stream-forbidden`、`playwright-stream-forbidden`）。
- **不签 Owner 分数、不得标记 B 域通过。** B2/B3 的双运营员 CAS、同键回放/异载荷冲突、结果未知恢复、DB/A2/A4/outbox 和精确清理，只存在于受限 R7 child 的旧候选证据；Final7 没有新建的可写 child 候选及未消费运行令牌。按本轮“不得复用旧绿结论”约束，此项必须在 Final7 隔离 child 上补验后，才能签发全量 Owner 结论。

## 最终签发结论（R7 / xNJR）

- Run ID：`pc-full-acceptance-20260729-114336`。
- 本域锁定候选：PC Build `xNJR-cEeID2fPRwrRvOrb`（`3303`）；后端冻结 JAR SHA-256 `B426C1ED9CFCE970F247D041A28DC7EDAFAC927C112AC0089755ACB70F954B3B`（`18120`）；隔离库 `nexion_acceptance_20260729_114336_d`、Redis DB 14、MinIO bucket `nexion-acc-20260729-114336-d`。
- 范围：B1 双账本总览、B2 资金池水位、B3 转化漏斗、B4 节奏状态、B5 风险雷达。
- **Owner 初审：99.0/100，PASS（严格大于 96）**。
- **A 域非 Owner 墨菲复审：99.0/100，PASS（严格大于 98）**。
- 未关闭缺陷：P0/P1/P2/P3 均为 `0`；硬性不通过项为 `0`。本轮发现的 R5 Build 锁路径、R6 幂等命名空间碰撞和旧 B5 失败注入未隔离 SSE，均为验收载具问题，已修正载具、重跑并关闭，不作为产品缺陷。

### 首次用户浏览器走查

- 使用真实密码、MFA 和可见侧栏，从登录入口完成 B1→B5 首轮、每页刷新、B5→B4 返回、退出重登后再次 B1→B5，`1/1` 通过；`pageerror=0`、非预期 `console error=0`、管理接口非预期 `5xx=0`。
- 最终 maker 角色套件为 `5/5 PASS`，另有 `2` 项按身份隔离门禁跳过；这两项分别由无菜单角色和 B/H1/J1 专用 checker 独立实跑通过，不是覆盖删除。最终可见入口 trace SHA-256：`278FB89A69D4FE2A5C67E3100BFC54166EFD03625A2770457A526D81F476A1B9`。
- B1 在真实 `reserveUsd=0`、负债大于 `0`、覆盖率 `0%` 前置下，明确显示“已跌破红线”“立即冻结放大流出”“不自动执行”，未通过注资、降红线或自动开闸掩盖失败前置。trace SHA-256：`B92CA37D957857CEA830AD205731A06F284EC7AB06155EE3B5F7AA223A9330D3`。
- B1/B2/B5 资金事实、B4/H1 节奏和 B5/J1 五个闸使用独立跨域 checker 核对同源，`1/1` 通过，trace SHA-256 `D16463AD8FF1AA04CEDF4CB97A402F9D7A48B8C1A6BC66289D985FC3A7580D09`。B 域 maker 对 H1/J1 的 `403` 是最小权限合同，未误授跨域权限。

### B2/B3 写链、并发和结果未知

- B2 两运营员基于同一版本并发提交：一笔 `200`、一笔 `409`；赢家使用同一 Idempotency-Key 和同载荷回放为 `200`，同 key 异载荷为 `409 IDEMPOTENCY_KEY_PAYLOAD_MISMATCH`；结果未知场景服务端实际完成，恢复查询为 `200` 且未重复执行。
- B3 保存隔离命名视图：首次及同 key 同载荷回放均为 `200`，同 key 异载荷为 `409`；同名冲突为 `409 B3_VIEW_NAME_CONFLICT`；结果未知场景服务端实际完成，恢复查询为 `200` 且未重复创建。
- 业务证据：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\B\child-write-r7-xNJR\b-child-write-lifecycle.json`，SHA-256 `3D691D41282C56063CEA2DA6CF1D968A1CE0DBDD2C3D79D576EBAFDD14358527`。最终刷新重登读取证据 SHA-256 `67317FAE4A821B3E9EB0776C9639A4E621538752DCFC5EE5D0A9636CD3AF1988`；业务 trace SHA-256 `4C0BDF02459FE2EDC7CAAB11FED5CEB130643F95515A700D17DAB61692CC4D6F`。
- 数据侧核对：目标 B2/B3 审计各 `4` 条、outbox 各 `2` 条、R7 幂等记录 `6` 条；A2 待办 `0`。写前后 forecast config 精确恢复，Run 视图归零；不可变审计、outbox 和幂等证据按审计边界保留。

### 权限、失败关闭和 SSE

- maker 的 J1 写入前后均为 `403`；secondWriter 只允许 B2/B3，B1/B4/B5/J1 在刷新重登前后均为 `403`。只读、无写、无菜单角色覆盖菜单、路由、按钮、接口和数据五层边界。
- 匿名 B1–B5 及 B5 stream 均为 `401`；无菜单、无权限角色对 B5 快照和 SSE 均为 `403`。匿名边界 trace SHA-256 `DA7B6BA747A32C35F65DE362F6D251A3D215FCB2D8A5BB6D6B6B8150410F10BF`；B5 403 证据 SHA-256 `C091707ADCD3FA7832FAFBF6174EE4CC4BCE717636623F87A27BCDF8120C9BCB`，trace SHA-256 `BDA9F400B389B499AE14E1112BC88B8256DDDDD4BDE4168B89D931137BE7B66B`。
- B5 首次进入、刷新、退出重登三次 SSE 握手均为 `200`；SSE 断线时页面显示重连告警并保留已由成功 GET 确认的快照。证据 SHA-256 `D87B314D382294807056B6007A56A8D32CBC4B5CE7A5AB2504D0C42224AED627`，trace SHA-256 `4E6FFD36D0AED98587924359FA3EC2166B70EE45E247841B89F88E41EC224AD1`。
- 在 SSE 同时失败的条件下，B5 GET 畸形 `200` 和 `500` 均清空数据、只显示加载失败且不渲染“挤兑预警”；B1–B4 畸形 `200`、B2 超时同样失败关闭。trace SHA-256 `93A1963181216CE190BAD9E9D3E2C0A725924952103CE650375EBFFA87ADD870`。

### 清理与载具封存

- R7 secondWriter 角色已禁用且删除权限/菜单绑定；secondWriter、bootstrap、closeout bootstrap 账号均禁用、解绑且无 TFA；pending 工单 `0`、对象锁 `0`、R7 可变视图 `0`。
- 受限 manifest 已置为 `invalidated-by-failure-cleanup` 且不保留凭据，SHA-256 `1ABF1CE110367EC722987D3349F03F996BDB7BF6521E4D7AEBC854CAB741B167`。closeout 结果 SHA-256 `00126267DFDAF9FD6904BB4F29D4303ACA88475576C2FC1332DC78DEE2B3BF37`。
- R7 closeout 载具已无条件封存，源码中不存在可用 closeout token 入口，不能重复触发清理写。TypeScript `npx tsc --noEmit` 通过；相关 `git diff --check` 通过。
- 本域未修改产品代码，未提交、未推送。后续统一最终候选重建后，B1–B5 仍须纳入 75 模块串行终验；该全局门禁由主智能体签发。

---

## 历史候选与未签分记录

## J_2lEoPlAOsQpy_5AFCCk 最终候选无写复验（2026-07-29）

- 候选基线：PC Build `J_2lEoPlAOsQpy_5AFCCk`（3002 / PID 19132）；后端 JAR SHA-256 `A0F6D48002B8C45DDFD12D1A84FBFADE829A5C224B3D62754919D604F325FCC0`（8110 / PID 3160）。本节原始证据目录：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\B\final-J_2lEoPlAOsQpy_5AFCCk\`。
- readonly 使用真实 MFA 登录，从可见侧栏完成 B1–B5、逐页刷新、B5→B4 返回及退出重登：`1/1` 通过；B1 真实 `0%` 覆盖率仅展示红线告警和建议、未触发资金或闸写入：`1/1` 通过；B1–B5 畸形 `200`、B2 超时和 B5 精确注入 `500` 均失败关闭：`1/1` 通过（`owner-core-failure-closure.log`）。
- 权限矩阵 `3/3` 通过（`permission-matrix.log`）：readonly、nowrite 的 B1–B5 菜单/路由/读取正常，所有受测写接口严格 `403` 且无可用写按钮；nomenu 的菜单、直链、读写接口均拒绝，刷新和退出重登后不漂移。全程未执行成功业务写。
- **SHARED-002 当前复验通过**：真实 maker（99544）→登出→readonly（99545）在同一浏览器中完成会话切换；完整 `adminShellSessionKey` 哈希从 `1393a12d…fa9c4` 切至 `7de8ca06…c8afe`，权限 `20→5`、菜单均为 `6`。在所有匹配的 B-domain GET（`intercepted=2`）均未放行的窗口，页面为 loading、`hasData=false`、不显示旧“双账本对照”或 `0.0%`；放行后才呈现 readonly 权威数据。证据：`shared-002-all-requests-held-final.json`、同名 PNG、trace 与 log。
- 早先仅挂起第 1 个请求时，另一个合法 readonly GET 已被放行，造成“0.0%/双账本对照”的载具误判；该记录保留在受限证据中，但已由全匹配挂起 Green 取代，**不构成产品缺陷**。
- 结论：本候选的无写 B Owner 范围通过；仍不签初审分或域通过。B2/B3 的令牌受控成功写、CAS/幂等/结果未知、A2/A4/outbox/DB 及指定非 Owner 对抗复审仍未完成。

## GSgKO 最终候选无写复验（进行中，2026-07-29）

- 候选基线：PC Build `GSgKO-mrx-pT4mYudCVgb`；后端 JAR SHA-256 `C61C0121714B7746C834E95DBE39D96C951E94BF3138ABBAE348523F9CE73C1D`。证据目录：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\B\final-GSgKO\`。
- A-003 真实 BFF/后端边界已通过：空 body 为 `400 REQUEST_BODY_REQUIRED`，显式 `text/plain` 为 `415 UNSUPPORTED_MEDIA_TYPE`，畸形 JSON 为 `400 REQUEST_BODY_INVALID`；MySQL 核对三条 probe 的幂等、A2 审计和目标账号变更均为 `0`。证据：`a003-runtime-boundary.json`。
- readonly 真实登录从可见侧栏完成 B1–B5 首轮、逐页刷新、返回、退出重登（`1/1`）；B1 真实 0% 失败关闭（`1/1`）；B1–B5 畸形 200、B2 超时及 B5 精确 `500` 注入（路由已更正为 `**/api/admin/risk/radar*`）均失败关闭（`1/1`）。readonly 权限矩阵完整通过（`1/1`）。这些均未产生成功业务写。
- **SHARED-002 / P2 未通过**：maker 登出后 readonly 登录，在首个 `/api/admin/treasury/b-domain*` 请求被挂起、尚未放行时，B1 已渲染旧的“0.0% / 双账本对照”数据且未显示同步态，构成跨账号 B 快照泄漏。两会话的 adminId/权限和菜单计数均不同，session key 哈希亦不同，故不是 key 碰撞；待共享缓存状态修复后必须从登录入口完整重跑。
- 此后 B maker 登录接口返回 401，而 readonly 仍正常；按“验收环境受阻”记录，不将夹具认证漂移计为 B 产品缺陷。maker 恢复前不可签 Owner 初审，也不可完成 maker 的最终全域重跑。
- B 域结论：不签分、不宣告通过。阻塞项为 SHARED-002 修复及 maker 夹具恢复后的完整 Owner 重跑；B2/B3 成功写、CAS/幂等/结果未知与非 Owner 复审也仍待令牌阶段。

## ODaNTve 统一候选最终无写重跑（2026-07-29）

- 候选基线：PC Build `ODaNTve-ln2-d4L6DPMKG`；后端 JAR SHA-256 `55B9E011...82CE6`；PC `3002`、后端 `8110`。本节证据目录：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\B\final-ODaNTve\`。
- 从 B.json 的专属 maker 真实登录 + MFA + 可见侧栏完成 B1→B5、逐页刷新、B5→B4 返回、退出重登后逐页进入：`1/1` 通过（`maker-core-r4-playwright`）。readonly、nowrite、nomenu 三组权限走查均为 `1/1` 通过，分别留存于 `permission-readonly`、`permission-nowrite`、`permission-nomenu`；未产生成功业务写入。
- B1 真实 0% 覆盖率失败关闭、匿名/非法路由/非法参数边界均通过（`maker-b1-failclosed`、`maker-boundary`）；`shared-shell-authority-prefetch-contract.test.mjs` 为 `5/5`，`npx tsc --noEmit` 通过。
- SHARED-002 同一浏览器 maker→readonly 的动态会话切换探针未形成有效证据：旧探针等待侧栏链接时超时，不能据此推断页面缓存是否泄漏，也不得把静态合同替代真实双账号运行时结论。该探针须以重建的可见侧栏定位和 B 域请求挂起/放行记录补跑。
- B5 的 500 注入旧用例未捕获实际请求（页面仍显示正常数据），因此该一项不能签为“B5 失败关闭已通过”；仅 B1 的 0% 失败关闭可作为本候选已验证事实。跨域旧用例以 B 最小权限 maker 读取 J1/H1 而收到 403，属于越出 B 角色授权的陈旧用例假设，未记产品缺陷。
- 结论：本节不签分、不宣告 B 域通过。B2/B3 的令牌受控成功写、CAS/幂等/结果未知及指定非 Owner 复审仍未完成；同时 SHARED-002 双账号运行时证据和 B5 精确 500 拦截补验仍为阻塞项。

- Run ID：`pc-full-acceptance-20260729-114336`
- 最终候选：PC Build `sgca8V_8FEA8-6ai3edh9`；后端 JAR SHA-256 `BFFCE45D...A9F43F`；PC `3002`、后端 `8110`。
- 范围：B1 双账本总览、B2 资金池水位、B3 转化漏斗、B4 节奏状态、B5 风险雷达。
- 执行方式：`workers=1`、Playwright Chromium；使用新重建的本 Run 受限 `B.json` 专属 maker / readonly / nowrite / nomenu / checker 夹具，均从登录页及可见侧栏开始。证据目录：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\B\final-candidate-sgca8V-owner-r2\`。
- 写入约束：未取得 `B_WRITE_TOKEN`；本轮没有任何成功的 B2/B3 业务写入、注资、红线调整或共享闸操作。

## Owner 真实走查结果

- maker 核心走查 `b-domain-owner-20260728.spec.ts`（排除无需授予 H1 读取权的跨域 checker 场景）：`4/4` 通过。maker 完成密码 + MFA 登录，从侧栏逐页 B1→B5，逐页刷新，B5 返回 B4，退出并重新登录后再次逐页进入；主流程无 pageerror、未处理 console error 或管理接口 5xx。
- B1 真实 0% 前置：`1/1` 通过。权威快照为 `reserveUsd=0`、`liabilitiesUsd=887989.56`、`coverageRatio=0`；页面明确显示“已跌破红线”“立即冻结放大流出”，并保留“仅建议、不自动执行”边界。未注资、未降低红线、未操作共享闸。原始快照：`playwright-core-maker/b1-zero-coverage-fail-closed.json`。
- 跨域同源：checker 使用 B.json 的独立精确角色执行 `1/1` 通过。B1/B2/B5 的储备、负债、覆盖率一致；B4 与 H1 的 8 个 dial 一致；B5 与 J1 的 5 个 gate 一致。maker 对 `/api/admin/growth/phases` 为 403，符合其 B 域最小权限，不记为缺陷。原始快照：`playwright-cross-domain-checker/cross-domain-authoritative-check.json`。
- 安全失败：`1/1` 通过。匿名 B1–B5 读取为 401；非法路由/参数为预期 4xx；B1–B5 对畸形 200、500、网络超时均清空陈旧数据并失败关闭。403 由精确角色权限矩阵覆盖；B2/B3 成功写入受 `B_WRITE_TOKEN` 约束，409 的真实并发 CAS 留待令牌阶段，不以成功业务写绕过。
- 权限矩阵 `b-domain-permission-fixtures-20260728.spec.ts`：`3/3` 通过（readonly/nowrite `2/2`，nomenu `1/1`）。readonly、nowrite 均可见 B1–B5 且读取均为 200；各模块按钮均不可用、写接口均为 403；新 nomenu 会话快照为无 B authority 且无 B menu，故菜单、直链、读接口和写接口均为 403，刷新和退出重登后均不恢复缓存。此前载具把 nomenu 错误预期为“读 200”，已按新清单精确角色语义修正，不记产品缺陷。
- 静态/合同：B1–B5 合计 `32/32` 通过；`npx tsc --noEmit` 通过；本次改动 `git diff --check` 通过。

## 数据溯源

| 页面 | 前端入口 | 权威接口/服务 | 本轮核对 |
|---|---|---|---|
| B1 | `/overview/dual-ledger` | `OpsTreasuryController` → `OpsTreasuryService` | D3 储备/负债、B5 覆盖率同源；0% 时仅建议、无自动闸操作 |
| B2 | `/overview/liquidity` | `OpsTreasuryController` → `OpsTreasuryService` | D3 储备、8 类负债、forecast config；失败时清空 |
| B3 | `/overview/funnel` | `OpsFunnelController` → `OpsFunnelService` | A4-backed 漏斗与保存视图合同；畸形结果失败关闭 |
| B4 | `/overview/rhythm` | `/api/admin/phase/overview` | H1 权威 8 dial 同源 |
| B5 | `/overview/risk-radar` | `OpsRiskRadarController` | 覆盖率、风险维度与 J1 5 gate 同源 |

## B_WRITE_TOKEN 到位后必须补跑（不在本轮执行）

1. B2：两个运营员对同一 forecast config 使用同一初始版本并发提交；验证仅一笔 200、另一笔 409 CAS 冲突，刷新后使用新版本完成可逆恢复；同 key 同载荷回放同结果、同 key 异载荷拒绝；保存前后快照、A2、A4/outbox、幂等记录均需核对。
2. B3：以隔离命名视图完成保存、同 key 回放、同 key 异载荷 409、结果未知后用原 key 查询/恢复；删除或恢复可变夹具，核对 A2/A4/outbox 与幂等记录。
3. 补跑后由 B Owner 从登录入口重跑完整 B1–B5；再交给指定非 Owner 进行对抗复审。未完成上述写链与复审前，本 Owner 记录不签分、不宣告域通过。

## 边界结论

本轮 B1 的 0% 覆盖率是隔离环境真实业务前置不达标，页面与 J1 均正确失败关闭；它不是通过注资、降低红线或解除闸门应被掩盖的条件。本记录仅陈述 Owner 重跑事实，不签初审分或通过结论。

---

## Final10 Owner 全量重跑（2026-08-01，当前有效）

- 候选锁：PC Build `zGL97cq44U6qzzAKmh415`（`3002`），后端 JAR SHA-256 `ED80116D6B7D7C025490C4EEC180D53F135D712DB0A4D5C89D6FA4D8D9A9F947`（`8110`），主验收库 `nexion_acceptance_20260729_114336`。运行锁、Build、JAR 和进程均在写前校验。
- 原始证据根：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\B\final10-owner\`。所有 Playwright 输出均使用该目录下独立 `--output`。
- 首次用户 maker 从登录页、MFA 和可见侧栏完成 B1→B5、逐页刷新、B5→B4 返回、退出重登：`5/5` 通过；B5 SSE 首次进入/刷新/重登/断线失败关闭通过；B1 的真实 `0%` 覆盖率只显示红线与建议、未自动注资或开闸。
- 失败边界：匿名及非法参数 `1/1` 通过；B1–B5 畸形 `200`、B2 超时、B5 畸形/`500` 全部失败关闭 `1/1` 通过；无菜单账号 B5 快照与 SSE 均 `403`，`1/1` 通过。
- 五层权限：readonly、nowrite、nomenu 分别独立登录、刷新、重登并覆盖 B1–B5 菜单、路由、按钮、接口、数据边界，`3/3` 通过。首次合并运行因单命令时限中止，已以三个独立、互不覆盖的 trace 重新执行完毕。
- 关联域权威核对：Final10 专属 checker 从真实登录进入后，B1/B2/B5 的储备、负债和覆盖率一致；B4/H1 的 8 个 dial 一致；B5/J1 的 5 个 gate 一致，`1/1` 通过。
- 成功写闭环：Final10 专属 maker 与 secondWriter 从可见登录/侧栏进入 B2/B3 后执行。B2 同版本并发得到 `200/409`，同 key 回放一致、异载荷 `409 IDEMPOTENCY_KEY_PAYLOAD_MISMATCH`，真实提交后客户端断连的结果未知以原 key 恢复为同一 `200`；B3 保存、同 key 回放、异载荷拒绝均通过。写入证据 `write-lifecycle\b-final10-main-write-final10-b-1944.json`：B2 最终读取 `200`、B3 首次保存 `200`、A2 审计 `2`、A4/outbox `2`、成功幂等记录 `3`、可变 B3 视图剩余 `0`、forecast config 精确恢复为 `true`。
- B1/J4 联合恢复未写 B1：当时 B1 权威快照为 reserve `0`、liability `887989.56`、coverage `0%`，而红线最低 `80%`；唯一可见“登记储备注入”为 append-only 事实且无可逆 UI/API。故拒绝以不可精确恢复的注入伪造 J4 回滚前置，保持失败关闭；J 域随后按写前快照完成最小环境恢复。此为验收环境恢复约束，不作为 B 产品缺陷，也未遗留 B1 可变状态。
- 技术门禁：B 静态/合同（含 Final10 主库写载体）`29/29` 通过；后端 B 相关 Maven 定向测试 `78/78` 通过；`npx tsc --noEmit` 通过。

**Owner 初审：99/100，PASS。** B1–B5 未关闭 P0/P1/P2/P3 为 `0`。本结论只覆盖 Owner 初审；指定非 Owner 墨菲复审和全局 75 模块终验尚未签发，不能替代总体验收结论。

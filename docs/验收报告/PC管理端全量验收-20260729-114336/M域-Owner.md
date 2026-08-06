# M 域 Owner 初审报告（Final11 全量复跑）

Run ID：`pc-full-acceptance-20260729-114336`  
范围：M1 客服总览、M2 工单台、M3 即时会话台、M4 知识库与 SLA、M5 话术与模板配置。  
结论：**HOLD，Final11 Owner 初审不通过，不能签发 M 域通过。** M-005 与 M-006 在新候选上仍未闭环，并新增 M-FINAL11-001；三项均为未关闭 P2。发现确定性阻断后未继续制造可变业务对象，历史 Final10/Final7 证据不替代 Final11 完整生命周期复跑。

## Final11 锁定候选与门禁（2026-08-01）

- PC Build ID：`xwL3BUki3xjXtoLr7RsWb`，生产运行于 `3002`；后端 JAR SHA-256：`09BF09404F1F29A2110306E773C31529D3D1F835B04FAC5C34175FF8B467B66D`，运行于 `8110`。锁定信息来自 `coordination/FINAL11_RUNTIME_LOCK.json`，Owner 未重建、替换或修改候选源码和服务。
- 冻结候选的 M 定向静态合同为 `90/90 PASS`，`npx tsc --noEmit` 通过。合同确认 M2 候选控制器只需 `service_m2_read`、响应投影只有 `adminId/name`；服务只调用 `listTicketAssigneeCandidates()`；Mapper 是单条 `SELECT DISTINCT`，不含 `CREATE/ALTER/INSERT/UPDATE/DELETE/FOR UPDATE`；M1 `/support-agents` 仍要求 `service_m1_read`；严格 schema、401/403/500、Abort 有界重试和 auth epoch 均有合同覆盖。
- 浏览器全部使用真实 MFA、可见侧栏、`workers=1` 和 Final11 独立目录。精确 M2 maker 具有 `service_m2_read/write` 且无 `service_m1_read`；精确 checker、只读、无写、无菜单角色均使用既有隔离夹具，没有通过隐藏 URL、mock 状态或 localStorage 注入取得权限。

## Final11 未关闭缺陷

### M-005 / P2：M1 可见首访的坐席读取仍被浏览器取消

- 精确 M reviewer 从登录和可见侧栏进入 M1 后，`GET /api/admin/content/support-agents` 在 `2026-08-01T13:26:16.326Z`、`13:26:20.766Z` 和 `13:26:33.390Z` 三次均以 `net::ERR_ABORTED` 结束，没有任何成功 HTTP 响应；页面只显示“坐席数据暂不可用”，不能形成权威 M1 坐席总览。
- 同凭证新 context 的直接 GET 可返回 `200`；结合 `/tickets/load-config` 正常与静态的两次有界 Abort 重试，后验归因仍落在 M1 共享读取任务的导航/加载代际取消与恢复竞态，而非账号权限、MFA、后端不可达或无数据。Final11 没有提供可重复恢复的首次用户闭环，故 M-005 不得关闭。
- 证据：`M/final11-owner/full-read-fault/read-m1.png`、`M/final11-owner/pw-output-full-read-fault/**/trace.zip`。

### M-006 / P2：M2 专用候选端点已最小化，但真实合法同名坐席导致整批失败关闭

- 精确 M2 maker 从可见侧栏进入 M2 时，只发出 **1 次** `GET /api/admin/content/tickets/assignee-candidates`，状态 `200`；没有读取 M1 `/support-agents`，没有请求失败或内容写请求。直接探针证明相同 actor 对 M1 `/support-agents` 仍为 `403`，权限边界正确。
- 响应共有 9 条，逐条都严格只有 `{adminId,name}`，正整数 ID、非空名称且 `adminId` 唯一；其中 `adminId=99755` 与 `99756` 合法同名 `FINAL M-only maker`。前端 `parseTicketAssigneeCandidates` 在两个字段和 ID 唯一之外又要求 **name 全局唯一**，因合法同名把整批判为畸形；页面显示“坐席候选数据暂时无法同步”，`support-ticket-create` 数量为 `0`。因此 M-006 的后端最小纯读边界已落实，但精确 M2 角色的真实创建/转交生命周期仍确定性阻断。
- DB 前后指纹完全相同：`nx_support_agent_profile` 为 `142 / 6b7af5...91969`，`nx_support_agent_user_assignment` 为 `9 / f83443...76e4`。结合静态单 SELECT 合同，证明 M2 候选读取没有触发 M1 overview、ensure/seed、DDL 或 DML。
- 证据：`M/final11-owner/m2-candidate-pure-read-r3/m2-candidate-pure-read-result.json`、`01-m2-after-candidate-response.png`、`trace.zip`、`db-m2-pure-read-before-after.safe.json`。

### M-FINAL11-001 / P2：M5 只读角色仍看见写按钮

- 精确只读角色的 M1–M5 读取成功，写 API 探针均为 `403`；M1–M4 写控件隐藏符合预期。但 M5 仍渲染 `[data-proof=session-script-new]` 与 `[data-proof=session-tpl-new]` 两个写按钮，只是设置 `disabled`，实测 `count=2`，验收标准要求无写权限时 `count=0`。
- 页面虽提示“当前账号只有查看权限”，服务端也拒绝写入，但按钮层权限未关闭，五层权限矩阵不通过。源码映射位于冻结候选 `app/components/domain-views/m-tabs/m5-scripts.tsx`：`canWriteM5` 只进入 `disabled`，按钮本身未按权限条件隐藏。
- 证据：`M/final11-owner/pw-output-permissions/**/test-failed-1.png`、同目录 `trace.zip`。

## Final11 已执行覆盖

- **M1：HOLD。** 页面、返回、刷新、退出重登路径执行，但权威坐席读取出现 M-005，不能签发。
- **M2：HOLD。** 专用候选端点的最小权限、单次真实 GET、严格两字段、零 M1 读取、零 DDL/DML、根 401、慢/超时详情隔离和失败关闭均被验证；但合法同名坐席触发 M-006，创建/转交入口未开放，故不能完成本轮完整生命周期。
- **M3：通过本轮只读/失败关闭范围。** 可见首访、返回、刷新、退出重登及对应真实读取已执行；没有发现新增缺陷。本轮未重复制造生命周期对象。
- **M4：通过本轮只读/失败关闭范围。** 可见首访、返回、刷新、退出重登及对应真实读取已执行；没有发现新增缺陷。本轮未重复制造生命周期对象。
- **M5：HOLD。** 精确 checker 的读取、刷新重登和业务身份写门 `403` 正常，但只读按钮层因 M-FINAL11-001 不通过。
- 故障矩阵独立 `1/1 PASS`：覆盖 `401/403/404/409/422/500`、超时、断网/Abort、畸形 200、结果未知、失败关闭与可见恢复；业务门独立 `1/1 PASS`，M checker 的 M1/M5 受控写均为 `403`、成功业务写为 `0`。
- 无菜单角色独立 `1/1 PASS`：菜单、路由、读取、写入均拒绝，刷新和退出重登后保持；M2 progressive 首屏隔离与超时用例换新 TOTP 时间窗后 `1/1 PASS`。首次重跑的 MFA 失败是服务端同时间步防重放，未产生业务请求，不计产品缺陷。

## Final11 数据恢复、锁与残留

- Final11 Owner 没有执行任何成功产品业务写，没有创建 M1–M5 可变对象，也没有取得 `B1`、`GLOBAL` 或任何 M 域单例写锁，因此没有锁需要释放、没有可变业务夹具需要恢复。
- M2 纯读前后两张相关表的行数和 SHA-256 完全一致；浏览器记录的 `contentMutations=[]`、`pageErrors=[]`。本轮仅新增受限 trace、截图、结果 JSON 和本报告，不清理既有 Final10 复审夹具或不可变审计/outbox 证据。

## Final11 评分

- Owner 初审：**91.0 / 100，不通过**（要求严格大于 96）。未关闭缺陷：P0=0、P1=0、P2=3、P3=0。
- 复审：**未触发**。需由轮换修复者修复 M-005、M-006、M-FINAL11-001，重建并锁定新候选；原 Owner 再从真实登录入口完整重跑 M1–M5 生命周期、权限、故障、双运营员、幂等/CAS、跨域和清理，全部关闭后才可交 L 域非 Owner 对抗复审。
- 血量：沿用 Final10 报告累计值 `90/100`，本次初审不通过扣 10，当前 **80/100**；未冒充完成，不执行完成恢复。

---

# M 域 Owner 初审报告（Final10 全量复跑，历史）

Run ID：`pc-full-acceptance-20260729-114336`  
范围：M1 客服总览、M2 工单台、M3 即时会话台、M4 知识库与 SLA、M5 话术与模板配置。  
结论：**HOLD，Final10 Owner 初审不通过，不能签发 M 域通过。** M-004 已在 Final10 关闭，但新发现的 M-005、M-006 均为未关闭 P2；Final7 的历史 GREEN 只保留作载具和覆盖参考，不能代替本轮独立证据。

## Final10 当前结论（2026-08-01）

- 锁定候选：PC Build ID `zGL97cq44U6qzzAKmh415`（`3002` PID `3520`）；后端 JAR SHA-256 `ED80116D6B7D7C025490C4EEC180D53F135D712DB0A4D5C89D6FA4D8D9A9F947`（`8110` PID `23136`）。运行锁证据 SHA-256 为 `5CBC4E4155FE45394BC7FA4D348E1156BE11F02B8B189E2E2EABCE784849E0F3`；所有浏览器证据均使用真实 MFA、可见侧栏和 Final10 独立证据目录。
- **M-004 已关闭。** Final10 浏览器注入证明 M2 根请求 `401/403/500/畸形 200` 时会及时清空旧快照并关闭写入口；超时和慢详情隔离重跑通过。安全整数 `code === 0`、严格分页记录数/唯一 `ticketNo` 合同由新增 5 项回归与 M1–M5 定向合同合计 `70/70`、`npx tsc --noEmit` 共同锁定。首次第二用例失败是同一 TOTP 时间步重放保护，换新时间窗独立重跑通过，不计产品缺陷。
- **M-005 / P2 未关闭。** 客服主管首次从可见侧栏进入 M1 时，`/api/admin/content/support-agents` 四次均在浏览器端以 `net::ERR_ABORTED` 结束且没有 HTTP 响应，而 `/tickets/load-config` 返回 `200`；页面只显示“坐席名单”未同步并把禁用原因错误表达为“只有总管理员或客服主管可以调整”。同账号、同 Cookie 的两个全新上下文直接 GET 均为 `200`（约 `1.5–1.8s`、数值 `code=0`、10 个坐席、主管权威资料正确），页面稳定 30 秒且 M1 完整重跑恢复通过。后端未启用可对应的 access log，运行日志中没有该路径；现有证据把问题收敛到前端导航/加载代际取消与恢复链路，不能因偶发恢复而关闭。
- **M-006 / P2 未关闭。** 精确 M2 maker 具有 `service_m2_read/write` 且可见菜单为 A2、M2–M4，但 M2 页面读取必需坐席目录时，`GET /api/admin/content/support-agents` 确定返回 `403`（`93.151ms`），导致“当前没有可接单的客服坐席”并彻底移除“新建工单”。后端 `OpsSupportAgentController.overview()` 固定要求 `service_m1_read`；前端 `fetchMContentData` 却把该 M1 读取结果写入共享 `I.support.agents`，M2 再按“启用 + 可转交 + support 服务类型”生成创建/转交候选。客服主管对相同 GET 为 `200`，证明不是账号、MFA、服务可达性或夹具缺失。修复边界应是最小只读依赖或 M2 专用候选端点，不得给 M2 整包 M1 写权限。

## Final10 Owner 覆盖结果

- **M1：HOLD。** 主管全生命周期重跑通过，包含结果未知、同幂等键恢复、负载策略恢复、刷新重登；但首次用户真实进入触发 M-005，故模块不能签发。
- **M2：HOLD。** M-004 失败关闭回归通过；两运营员后端真值覆盖结果未知、同键恢复、异载荷 `409`、CAS、刷新重登和 `RESOLVED+ARCHIVED` 清理均通过；但精确 M2 角色的可见生命周期被 M-006 确定阻断，故不能用 checker/supervisor 的更宽权限替代。
- **M3：通过本轮已执行范围。** 两个独立 SUPPORT 坐席覆盖可见发起、稳定 ID 转交、自转交 `422`、非目标 `403`、目标接入、回复、转 M2、刷新重登及精确清理；结果文件 `errors=[]`。
- **M4：通过本轮已执行范围。** 两运营员覆盖可见 FAQ 创建、未知结果同键恢复、异载荷 `409`、CAS、刷新重登和 `DELETED` 清理；结果文件 `errors=[]`。
- **M5：通过本轮已执行范围。** `36/36` 检查通过：匿名拒绝、真实侧栏、主管业务门、类别 `500` 失败关闭和同键重试、策略/受众恢复、CAS/422、话术与模板未知结果单行约束、发布、刷新重登、M3 消费、归档不可复活、M1 联动、共享主管账号完全不变、会话关闭。中断 R7 遗留的话术、模板和两条 I6 镜像已按前缀精确归档，恢复 `errors=[]`。
- 精确权限门禁通过：maker 与 checker 均真实 MFA，权限/菜单精确；checker 跨域读取 `403`，M1/M5 业务门探针 `403`，业务成功写为 `0`。独立只读与故障矩阵 `3/3` 通过，累计 32 项检查，覆盖五模块首访、返回、刷新、退出重登、`401/403/404/409/422/500`、超时、畸形 200、结果未知和业务门，`businessMutations=[]`、`pageErrors=[]`。

## Final10 数据回读、恢复与证据

- `M-FINAL10` 前缀只读数据库回查：A2 `nx_audit_log` 57 条（含 6 条明确拒绝动作）；A4/outbox `nx_event_outbox` 24 条，`FAILED=0`。隔离运行未启 outbox 发布消费者，24 条 `PENDING` 作为不可变验收证据保留，不作为可变夹具删除。
- 可变业务对象已恢复：M234 工单为 `RESOLVED+ARCHIVED`、FAQ 为 `DELETED`；M3 会话与关联工单清理 `errors=[]`；M5 R8 话术/模板均 `archived`、关联会话 `CLOSED`、策略恢复原值、共享主管账号角色/状态/版本不变；中断 R7 话术/模板及 I6 镜像已精确归档。Final10 共享主管夹具按非 Owner 复审边界保留，不在 Owner 阶段删除。
- M 域单例临界区在上述恢复和只读回查完成后释放；Final10 PC/后端锁定进程仍存活，未重建、未替换、未修改产品源码或运行服务。
- 核心证据：`M/final10-owner/m005-diagnostic/support-agents-diagnostic.safe.json`（SHA-256 `1914B02FE5E9442D57DE8049A521BD4CAFD8B91C13D0793A6760B1D190F7A244`）；`m006-m2-support-directory-rbac.safe.json`；`m234-two-operator-result.restricted.json`（`8FA9DE956C91058647F2927078A408B6783C20DAEC221FB54A4928D7E3A6150A`）；`m3-final3-transfer-result.restricted.json`（`7A34F16EA551222CCC64230A89D160D618562816E4E12655DA20080B4C8DE78A`）；`m5-lifecycle-r8/runtime-result.json`（`A5A422DBF3DD5776BE2FBD13356D76EC44919380AF8D481721C457AFD41A33C3`）；`permission-gate/m-final2-owner-gate-safe.json`（`F6124CAF98F4A5B779071E5ADF5799F2DB3E2A2BC35444E717323A647AD2D7A1`）；`full-read-fault-r2/runtime-result.json`（`76D817E257E07C1C2AEB868E096BD8DA3288A95AEE1825EBCCCED7B632CCD832`）；`db-a2-a4-outbox-readback.safe.json`（`80746D279B9B73929447BF3F2CBD97C0E4550E774B7A8EE065CDCD9156A36C71`）。完整列表见 `M/final10-owner/evidence-hashes.safe.json`。

## Final10 评分

- Owner 初审：**93.8 / 100，不通过**（要求严格大于 96）。未关闭缺陷：P0=0、P1=0、P2=2、P3=0。
- 复审：**未触发**。按规则，初审未达到门槛时不得进入非 Owner 复审或签发通过；需由轮换修复者修复 M-005/M-006、重建候选后，由原 Owner 从登录入口完整重跑，再交 L 域非 Owner 对抗复审。
- 血量：初审不通过扣 10，当前 **90/100**；本轮未冒充完成，不执行完成恢复。

## Final9 历史结论（2026-08-01）

- 锁定候选：PC Build ID `WF2Bg3fIWMQRSwSJCTh5E`（`3002` PID `3068`）；后端 JAR SHA-256 `AD3EE7ED47E02C2DCCB842F5E74D44641B26E2032F8329BFEC1CE03223021215`（`8110` PID `21252`）。所有新证据均以真实 MFA 和可见侧栏取得。
- **P2 未关闭：M2 的权威工单读取被注入 `401` 后，页面持续显示“正在加载 M 客服中心真实数据...”，未在验收时限内进入“工单数据暂时无法同步”的失败关闭态。** 截图、视频和 trace 位于 `D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\M\final9-owner\readonly-permission\` 与对应的独占 Playwright 输出；修复、重新构建候选和整域重跑前不得引用 Final9 为通过。
- **验收环境受阻：M1/M5 专属 SUPPORT supervisor manifest 已失去“客服主管”业务身份。** 虽真实登录会话仍有 SUPPORT、M1 读写权限，但 M1 “调整负载”按钮被业务门禁禁用；按隔离规则未创建或修改 A1 账号/角色/岗位。该项需全局 fixture 锁下恢复后补验，不冒充产品通过。
- 已通过的 Final9 子证据（均已清理）：M2/M4 两运营员未知结果同键恢复、幂等回放/异载荷 `409`、CAS、刷新重登和终态清理；M3 双 SUPPORT 坐席真实发起、稳定目标转交、自转交 `422`、非目标 `403`、接入、转 M2、刷新重登和清理；M1–M5 精确菜单/接口权限、跨域 `403`、退出重登和页面错误检查。
- Final9 原始受限证据哈希：`m234-two-operator-result.restricted.json` `92136A065D5D6AC2747DD78EE2314961A70D6AF6CFDB51907FE7F51113ECDE87`；`m3-final3-transfer-result.restricted.json` `92CB90D44E6554D8AB06590181611903778EC5D654F2A3C9D59F9870248783F6`；`m-final2-owner-gate-safe.json` `325A97E30A8A584888E67AF9AB80E264A3DD430DF2888BC6CCCA7959F69D9D55`。

## M-004 轮换修复记录（待 Final10）

- A 域轮换修复者以 TDD 重现并修复 Final9 P2；M Owner 未参与修复，也不得以本节替代整域复验。稳定 RED 证明：工单根请求返回 `401` 且无关 session-template 请求保持挂起时，旧候选在 3 秒内不能呈现 M2 专属失败关闭；证据位于 `D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\M\repair-p2\red-final9-r2-output\`。
- `fetchMContentData` 已拆为 M1–M5 独立任务并渐进发布各分区权威状态。M2 根请求、分页或任一明细失败只关闭 M2，不再等待无关域内请求；重新加载先清除旧 `mData`，使用加载代际忽略迟到旧请求，禁止旧快照伪装当前权威。
- 内容 GET 统一增加 8 秒有界超时；HTTP 200 仅当响应为对象、`code` 为安全整数且严格等于 `0`、GET 含 `data` 时才接受。M2 tickets 分页最终必须满足 `records.length===total`、每个 `ticketNo` 非空且全局唯一，否则以 `M2_TICKET_PAGE_INCOMPLETE` 失败关闭。401/403/500、断网/超时、畸形 200、缺页、重叠页、超额页和明细失败均不会开放写入口。
- RED→GREEN 门禁：新增渐进失败关闭合同 `5/5`；M1–M5 定向合同合计 `65/65`；`npx tsc --noEmit` 通过；新 Playwright 回归载具 `2/2` 可发现；隔离 `NEXT_DIST_DIR=.next-m-repair-p2` production build 完成编译、TypeScript 与 20 页静态生成。临时 build 目录已删除，Next 对 `tsconfig.json` 的临时 include 已撤销，目标 diff-check 通过。
- 当前状态仍为 **HOLD / 待复验**：不得把静态 GREEN 或旧候选 RED 当成 Final10 运行时通过。新候选构建后须由 M Owner 从真实登录和可见侧栏完整重跑 M1–M5（含 401/403/500/超时/畸形 200、旧快照隔离、权限、双运营员、幂等/CAS、刷新重登与清理），再由 L 非 Owner 对抗复审。

## 锁定候选与门禁

- PC Build ID：`AQh7aBmA0B3cWFXbKfIIn`，`3002`，PID `4316`。
- 后端 JAR SHA-256：`476E6C77BCDC39935865A656EED1399EB3EA56A760E0645D0949790A919D70E2`，`8110`，PID `472`。
- 全部从真实登录和可见侧栏开始，MFA bypass 为 `false`。
- M-only maker 精确菜单为 A2、M2–M4；checker 精确菜单为 A2、M1–M5。两者刷新和退出重登稳定，页面错误为空；checker 的受控 M1/M5 写探针均被 `403` 拒绝，未发生越权写。

## 全量 Owner 走查

- **M1：通过。** 客服主管以真实侧栏进入；覆盖结果未知后表单保留、同幂等键重试、M5 摘要依赖失败隔离、刷新与退出重登回读。临时主管岗位在测试结束后精确恢复。
- **M2：通过。** 两运营员覆盖可见创建、结果未知同键恢复、同键同载荷回放、异载荷 `409`、CAS 竞争（一个成功、一个 `409`）、刷新重登，工单终态为 `RESOLVED+ARCHIVED`，清理错误为空。
- **M3：通过。** 两个独立 SUPPORT 坐席从可见会话台发起、选择同名目标时按可见稳定坐席 ID 转交；自转交 `422`、非目标接入 `403`、目标接入成功、回复、转 M2、刷新与退出重登、归档均通过。会话和关联工单精确清理，错误为空。
- **M4：通过。** 两运营员覆盖可见 FAQ 创建、结果未知同键恢复、同键回放、异载荷 `409`、CAS `409`、刷新重登；FAQ 最终为 `DELETED`，清理错误为空。
- **M5：通过。** 覆盖匿名拒绝、真实侧栏、客服主管写入、类别 500 失败关闭与同键重试、策略/受众、CAS `409`、`422` 边界、话术/模板的结果未知同键恢复与单行约束、发布、刷新重登、M3 消费、归档不可复活 `409`、M1 联动、角色/状态不变和关联会话归档。M5 成功生成的 36 项检查全部通过。

## 载具恢复与清理

- M3 首次运行在同一 TOTP 时间窗内重登被服务端一次性验证码重放保护拒绝 `401`；其 `finally` 已精确清理会话/工单，`errors=[]`。等待新时间窗后以新前缀完整重跑，通过，不计产品缺陷。
- M5 首轮达到默认 180 秒 Playwright 文件超时，仅留下无业务写的共享坐席截图；以 `480s` 有界超时和新前缀完整重跑，实际 6.4 分钟通过。不是产品断言失败。
- 客服主管临时岗位从“客服主管”精确恢复为“通用客服”；服务类型 `[support]`、标签 `[KYC, 提现, 账户]`、最大并发 `12`、启用/可转交 `true`、busy `false`、状态 `enabled` 均与快照一致。M2/M3/M4/M5 可变对象均已进入其既定终态；不可变 A2/A4/outbox 按审计边界保留。
- 对 `M-FINAL7-` 前缀做只读数据库回查：A2 审计 56 条，覆盖 M1、M2、M4、M5、I6 和 M3 转工单动作；A4/outbox 22 条，覆盖类别、主动推送策略、话术/模板发布和 FAQ 更新事件。

## 证据

- `D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\M\final7-owner\gate\m-final2-owner-gate-safe.json`
- `...\M\final7-owner\m1\`（首访、未知结果、同键、依赖失败隔离、重登截图）
- `...\M\final7-owner\m234\m234-two-operator-result.restricted.json`
- `...\M\final7-owner\m3-r2\m3-final3-transfer-result.restricted.json`
- `...\M\final7-owner\m5-r2\runtime-result.json`（36 项检查）
- `...\M\final7-owner\support-profile\m-final2-support-restore-safe.json`
- `...\M\final7-owner\m-a2-a4-outbox-readback.json`

## 评分

- Owner 初审：**99.3 / 100，通过**（阈值 >96）。
- 依据：Final7 锁定候选上 M1–M5 均从可见入口完成真实 MFA、生命周期、权限、失败关闭、幂等/CAS、刷新重登、双运营员、跨域和精确清理验证；无未关闭 M 域 P0–P3。
- 非 Owner 复审：待 L 域执行；Owner 不参与。

# F 域 Owner 初审报告（Final11 HOLD：F2-F5 清理一致性 P2）

## Final11 Owner 全量验收（2026-08-01）

- 锁定候选：PC Build `xwL3BUki3xjXtoLr7RsWb`（`3002`）、后端 JAR SHA-256 `09BF09404F1F29A2110306E773C31529D3D1F835B04FAC5C34175FF8B467B66D`（`8110`），隔离库 `nexion_acceptance_20260729_114336`、Redis `13`、`workers=1`，管理员 MFA bypass=`false`。每个 PC 套件均以运行时 Build/JAR 双硬校验开始。
- 真实浏览器无写走查：F1–F5 从登录页与可见「分销与团队」侧栏进入；服务端权威读取、空态/取消/跨域入口、逐页刷新、返回、退出重登和匿名读写 `401` 为 `4/4 PASS`。
- 权限五层：readonly、nowrite、maker、nomenu 覆盖菜单、直达路由、按钮、接口与数据；前 3 个角色可读且写精确 `403`，nomenu 对菜单/路由/读写失败关闭且刷新、重登不恢复，`4/4 PASS`。
- 墨菲与失败关闭：F2 `500`、F3 超时/结果未知、真实 `404/422`、F1–F5 畸形 `200` 全部失败关闭且服务恢复后可重试，`8/8 PASS`。
- F1 受控写：真实 maker/checker/A6 隔离、maker 自批 `403`、A6 跨域 `403`、对象锁 `409`、同键回放、异载荷 `409`、CAS 恰一终态、响应中断后的同键结果未知重试、DB/A2 审计和 A4/D4/B1/L4 不应发生边界均通过；独立 finally 恢复 `F.prize.name=Nexion V-Rank`。
- F2–F5 可见成功生命周期的主链已实际产生并核对 `30→31→30`、`已启用→已关闭→已启用`、`100→101→100`；6 张 F 域 A2 票均 `approved` 且每张有 `3–4` 条审计；两条 F5 `ANOMALY_CONFIG/SUCCESS` 均各有 1 条审计和 1 条 canonical A4 outbox。
- **P2（验收载具/并发一致性，未认定为产品逻辑缺陷）**：F2–F5 的独立 cleanup 复查瞬间对已存在的 `team.ui.F.leaderboard.minUsd` 读到 0 行，导致最终闭环断言失败。执行前物理快照为 id=`4473`、值 `100`；结束后同一 id/值已恢复，未发现 G/H 同键写入。该轮不能将 F2–F5 成功链计为通过，须在共享 P1 修复重建后，从登录入口完整重跑。
- 最终精确恢复：按前快照删除本轮两条 F5 临时物理配置（各影响 1 行）；本轮 F1 的 5 条可变幂等记录已软删除。复核 F pending=`0`、F object lock=`0`、本轮幂等 residual=`0`，F2/F3/F4=`30/已启用/100`，F5 两项物理配置恢复缺失；不可变 A2/audit/outbox/commission operation 保留。F 专属单例写锁已释放。
- App F003：显式绑定隔离 App 候选 `D:\workspace\.acceptance\pc-full-acceptance-20260729-114336-app-master` 的权威消费/失败关闭合同 `1/1 PASS`；动态 App 注册走查不作为本轮 F 最终签发替代证据。
- 原始证据：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\F\final11-owner\`（read、permissions-rerun、faults、f1、f25 及对应 Playwright trace）；F003 静态合同输出为 `f003-static-contract.txt`。
- **结论：HOLD，不签发。** Owner 初审 `94/100`（未达 `>96`），复审不触发；未关闭项：产品 P0/P1/P2/P3=`0/0/0/0`，验收载具/并发 P2=`1`。待共享 P1 修复重建后，必须重新执行 F1–F5 全域，不得以本轮分项拼接为通过。

# 历史轮次

## Final10 Owner 闭环复验（2026-08-01，替代下节 HOLD）

- 载具修复：`F-FINAL10-HARNESS-001` 已由非 Owner 在 `SOURCE_LOCK_F_TEST` 内修复；所有载具自有 approve/reject/CAS/幂等键纳入进程唯一 `CASE_NONCE`，同键重放与异载荷 `409` 断言未被放宽，F1/F2–F5 在写入前先只读确认该 nonce 前缀的 idempotency residual=`0`。此变更不触碰产品源码或产品断言。
- 锁定候选未变：PC Build `zGL97cq44U6qzzAKmh415`，后端 JAR SHA-256 `ED80116D6B7D7C025490C4EEC180D53F135D712DB0A4D5C89D6FA4D8D9A9F947`，主载具 `3002/8110`，MySQL `nexion_acceptance_20260729_114336`、Redis `13`，MFA bypass=`false`。
- F1 受控成功闭环 `1/1 PASS`：真实 maker/checker 分离、maker 自批 `403`、A6 跨域 `403`、对象锁 `409`、同键回放、异载荷 `409`、CAS 恰一成功、上游提交后响应中断的结果未知与稳定 key 重试、DB/A2 审计及 A4/outbox/D4/B1/L4 边界、独立 finally 和精确恢复均通过。最终变更/恢复票为 `WO-260801205753517-200`、`WO-260801205755765-0`；F1 配置恢复 `Nexion V-Rank`，关联 pending/锁/可变业务记录均为 `0`。
- F2–F5 受控成功闭环 `1/1 PASS`：从可见侧栏完成 `30→31→30`、`已启用→已关闭→已启用`、`100→101→100`，由专属 checker 真实 A2 批准；F5 两个 `ANOMALY_CONFIG` operation 均有 audit 和 canonical A4 outbox。独立上下文精确清理两条临时物理配置，API 默认值、F5 物理缺失状态及非目标 fingerprint 全部恢复，immutable audit/outbox 保留。
- 完整无写复跑：首次用户 `4/4 PASS`，权限五层 `4/4 PASS`，失败关闭/畸形成功包 `8/8 PASS`；均从登录页及可见侧栏执行，覆盖刷新、返回、退出重登、匿名 `401`、readonly/nowrite/maker/nomenu、`500`、timeout、真实 `404/422` 和 F1–F5 malformed `200`。pageerror、非预期 console error、管理接口非预期 `5xx` 均为 `0`。
- 技术合同复跑：F 前后端/权限/失败关闭/F1-F5 闭环 `39/39 PASS`；显式绑定隔离 App 候选的 F003 `1/1 PASS`。
- 最终清理：F 策略单例持锁期间，F1 本次 `CASE_NONCE` 的 5 条临时 idempotency 软删除；F1/F2–F5 两个 nonce 前缀 residual=`0`，F pending=`0`、F object lock=`0`，精确恢复已由独立上下文完成，随后释放策略单例。不可变审计、A4 outbox 和业务 operation 依审计边界保留。
- 原始受限证据：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\F\final10-owner\`。F1 `result.json` SHA-256 `CCECC5A102C75117466575E1A3A15F18A816C6E7652219965EAC8B286DE4B0A3`，trace `E80B6F5AFE72D229189A5AE6FD2703BAD6EA8F973244B6794ACC5340F0CDA451`；F2–F5 清理结果 `B07D000B7F0750E85878BA8FEB9E3BF419BE07C244C709F15A6CDD3A3C12B93D`，trace `20EDF0B3C29DE6E2355E3637BF875C24F25210BED32E1386FA305C90816D2A52`；首次用户 trace 示例 `3B163D111F3CC49C57C0186E4294103B830057AB4740A010D887C2D35F3C9245`；权限示例 `F052114893C62433D978E101AC5649D401EF6D32171897509EE1FFED8A139219`；故障示例 `22D43E44A384D72B930C16EE32BD5B7254C9F4662E406A3ADAAFF204839ED855`。
- **Owner 结论：初审 `99/100`，执行复审 `99/100`，均通过；新产品 P0/P1/P2/P3=`0/0/0/0`。** Final10 F 域可移交非 Owner 对抗复审；在非 Owner 复审完成前，不得并入全量最终签发。

## Final10 锁定候选 Owner 复跑（2026-08-01，HOLD）

- 锁定运行时：PC Build `zGL97cq44U6qzzAKmh415`，后端 JAR SHA-256 `ED80116D6B7D7C025490C4EEC180D53F135D712DB0A4D5C89D6FA4D8D9A9F947`，主载具 `3002/8110`，MySQL `nexion_acceptance_20260729_114336`、Redis `13`，MFA temporary-superadmin bypass=`false`。所有套件启动时均对实际 BUILD_ID 与 JAR SHA-256 硬校验。
- 首次用户真实 Chromium 无写走查 `4/4 PASS`：从真实登录与可见侧栏进入 F1–F5，覆盖服务端权威读取、空态/取消/跨域 CTA、刷新/返回/退出重登、匿名读写 `401`。未观察到 pageerror、非预期 console error 或管理接口 `5xx`。
- 权限五层 `4/4 PASS`：readonly、nowrite 的 F1–F5 菜单/路由/数据读取可用而写入精确 `403`；maker 本轮仅读取；nomenu 的菜单、直达路由、读取与写入均失败关闭，刷新及重登不恢复。
- 故障与畸形成功包 `8/8 PASS`：F2 `500`、F3 timeout/结果未知、真实 `404/422` 与 F1–F5 畸形 `200` 都失败关闭；恢复上游后可重新加载，`422` 未产生副作用。
- 技术合同 `39/39 PASS`；App F003（显式绑定隔离 App 候选）`1/1 PASS`。覆盖 F1/F3/F4/F5 前后端合同、运行时包、稳定幂等、权限与 App 权威快照失败关闭。
- F1 受控成功链在专属 F 策略单例临界区内完成真实 maker 提案、checker 批准和精确恢复；maker 自批与 A6 跨域决策均为 `403`，同对象锁为 `409`，本轮变更与恢复两张新 A2 票据均为 `approved`。但 CAS 子步骤不可计为通过：载具把稳定 Run ID 直接拼入 `f-cas-approve/reject` 幂等键，两个键在 `2026-07-29 22:52:37` 已存在；本轮请求体不同，后端按约返回两次 `409 IDEMPOTENCY_KEY_PAYLOAD_MISMATCH`。所引用 `WO-260801145537741-0` 是 `13:55` 已批准的旧票，并非本轮 `18:45` 的新变更/恢复票。这是 **F-FINAL10-HARNESS-001（P2，验收载具隔离/幂等键重复）**，不是产品 CAS 原子性缺陷；必须改为 Final10 专属唯一键并从登录入口重新取得 F1 CAS、结果未知和完整 F2–F5 成功写证据。
- 清理：精确恢复后，F 域 pending=`0`、对象锁=`0`。在短时 F 策略单例临界区中软删除本 Run `f-*` 临时幂等记录 `28` 条，随后复核 scoped idempotency residual=`0`、pending=`0`、lock=`0`，并释放 `F_POLICY_SINGLETON.lck`；不可变 A2/audit 证据保留。
- 原始证据：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\F\final10-owner\`。首次用户 trace 示例 SHA-256 `85FDA5AEE1E8189C37D0F2E23042CF8DB9622FB245F994C9019390B38AA302DE`；权限 trace 示例 `62BAB207404239352D042BA4F14501EEBCEC3AA759B28CB69E1361703604A3CD`；故障 trace 示例 `6ADB19B2AAEBFEA7E34154AC37175FF6166CB3522742DCAD556E9CDCB185CE05`；F1 载具碰撞 trace `FC38CB67DF151516CC7ABA2C0B01A926A1580F2709E0488CABB71F53794BD2B1`，结果摘要 `result.json` SHA-256 `462D22F7D09CE0A67C214ED8A3817B1C3D7375334E022EDE74D4CC710626941F`。
- **结论：HOLD，不评分、不签发。** 产品新 P0/P1/P2/P3=`0/0/0/0`；但 Final10 的 F1 CAS/结果未知和 F2–F5 成功生命周期因验收载具 P2 未能获得独立、唯一幂等键的本候选全量证据，不能以历史轮次替代。

## Final9 锁定候选 Owner 无写全域复跑（2026-08-01）

- 锁定运行时：PC Build `WF2Bg3fIWMQRSwSJCTh5E`，后端 JAR SHA-256 `AD3EE7ED47E02C2DCCB842F5E74D44641B26E2032F8329BFEC1CE03223021215`，主载具 `3002/8110`，MySQL `nexion_acceptance_20260729_114336`、Redis `13`。测试前由运行时实际 BUILD_ID 与 JAR 哈希硬校验，MFA temporary-superadmin bypass 为 `false`。
- 首次用户真实 Chromium 走查 `4/4 PASS`：从登录页完成真实 MFA，经可见侧栏进入 F1–F5；每页服务端权威 GET 为 `200`、数据域分别为 F1–F5。核对 F1 13 阶、F2 七层费率、F3 结算集合、F4 票权、F5 六类佣金；空态/确认取消/跨域 CTA、逐页刷新、退出重登、浏览器历史、匿名五个读写端点 `401` 均通过。观察到的 pageerror、console error、管理接口 `5xx` 均为 `0`。
- 权限五层 `4/4 PASS`：readonly、nowrite 在 F1–F5 可见菜单/路由/数据读取并对每一预期拒绝写精确返回 `403`；maker 可读且无写入；nomenu 会话菜单为空，直达路由、读和写均为 `403`，刷新及重登后不恢复权限。该波次仅使用非法对象/key 的拒绝探针；完成后 F 域对象锁为 `0`。
- 失败关闭 `8/8 PASS`：浏览器载具注入 F2 `500`、F3 timeout、F1–F5 畸形 `200` 时页面清空权威快照并禁用写入口；取消注入后重试恢复。真实 `404` 和 `F.cooldown=-1` 的 `422` 均明确失败，随后服务器费率快照未包含 `-1`。
- 技术合同：F 域前后端、响应未知、UI 权限和 F1/F3/F4/F5 闭环共 `39/39` PASS；App F003 在隔离 App 候选 `D:\workspace\.acceptance\pc-full-acceptance-20260729-114336-app-master` 显式绑定后 `1/1 PASS`。未绑定该候选时 F003 会误取原始 `D:\workspace\NX1.0` 并找不到 `src/api/runtime.ts`；这是测试载具路径未显式指定，不是候选产品失败，已用 `NEXION_APP_ROOT` 纠正。
- 只读数据库核对：`nx_v_rank_config=13`；`nx_commission_event=7`、`nx_commission_operation=12`；F 域 A2 票据 `90`（approved `74`，rejected `16`），无 F 域对象锁。F5 canonical A4 outbox 为 `ADMIN_COMMISSION/admin.commission_anomaly_config_changed` 共 `12` 条、均 `PENDING` 且 `last_error` 为空；本轮无写探针不新增业务记录。
- 原始证据：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\F\final9-owner\`。服务端快照 SHA-256 `A6836A038E503FDAD79BF45E9024A2A88789494929093CAA88C9A1F46FD37209`；四份可复现 Playwright trace SHA-256 分别为 `0C1D20250A58ADBF5715D0B80DDF21D1F37A46BDD87CCCCD0F9C71EEFDDD3471`、`8A08F64BE69EDBA7A2AFED55A0D05012A16143A5130818890D7904CC9A7D9F6F`、`1E5AB9CD2E7CA63945556BA8818336F03ACB8A22ED6780912732328ADF2486E2`、`8C1E2C882EF676B240A3C04C3E726C1A000CBC3F7366DDBC0EE87E14FA12E293`。
- 当前状态：**HOLD，尚未签发 Final9 Owner 通过。** F1 成功写的 maker/checker、结果未知、幂等/CAS 与 F2–F5 成功写的 A2/A4/outbox/精确恢复需要本候选的受限专属角色 manifest 和主控写锁；这些尚未下发。Final7 成功写证据不能替代 Final9。当前无新 P0–P3，但范围尚未完整，暂不评分。

## Final7 锁定候选 Owner 全量复跑（2026-08-01）

- 候选身份：PC Build `AQh7aBmA0B3cWFXbKfIIn`；后端 JAR SHA-256 `476E6C77BCDC39935865A656EED1399EB3EA56A760E0645D0949790A919D70E2`；MySQL `nexion_acceptance_20260729_114336`、Redis DB `13`。所有浏览器套件均为 Chromium `workers=1`，从登录页与可见侧栏开始，`F_WRITE_BYPASS=false`。
- PC 完整复跑 `18/18 PASS`，并以 `--trace=on` 留存 18 份 trace：F1–F5 首访与服务端权威读取、空态/确认取消/跨域入口、逐页刷新、退出重登、浏览器前进后退、匿名读写 `401`；readonly/nowrite/maker/nomenu 四角色菜单、路由、按钮、接口、数据五层权限；F2 `500`、F3 超时、真实 `404/422` 及 F1–F5 畸形成功包的失败关闭与恢复，均通过且没有 pageerror、非预期 console error 或管理接口 `5xx`。
- F1 写链已从可见页面完成 maker/checker 分离和精确恢复：maker 自批、A6 跨域决策均为 `403`；同对象并发为 `409`；同键重放回到同一 operation、异载荷为 `409`；CAS 恰一成功。上游已提交后中断浏览器响应，页面明确显示“结果暂不确定”，重试复用同一 Idempotency-Key 并回放同一 operation；独立 finally 后 `F.prize.name=Nexion V-Rank`、pending 为 `0`。DB/A2 审计闭环成立，F1 未写 A4/L4、D4 或 B1 边界表。
- F2–F5 写链完成临时与恢复：`F.cooldown 30→31→30`、`F.binary.spillover 已启用→已关闭→已启用`、`F.leaderboard.minUsd 100→101→100`；六条 A2 operation 均为 approved 且逐条有审计。F5 两条 `ANOMALY_CONFIG` operation 均有审计与 canonical A4 outbox。独立 finally 精确删除本轮两条默认配置物理行，API 回到 `3/20`，非目标配置 fingerprint 前后一致，不可变 operation/audit/outbox 保留。
- 静态合同 `40/40 PASS`，覆盖 F1/F3/F4/F5 前后端闭环、运行时包校验、权限、稳定幂等键、App F1/F3 的拆分 API 链路。原先 F003 载具把旧聚合文件 `src/api/remote-api.ts` 当成必需文件，已判为陈旧架构断言；隔离 App 候选的真实链路为 `api/runtime.ts`、`auth-api.ts`、`v-rank-api.ts`、`commission-config-api.ts`。独立复核另发现真实 F1 旧权威快照泄漏（远端读取失败后仍显示旧等级/进度）；该修复已由非 Owner 完成静态回归，但尚未获得真实 App 浏览器动态证据。
- **结论：PC F1–F5 Owner 初审 `99/100`、执行复核 `99/100`；但 F 域整体为 HOLD，不能签发。** 原因是 App F1/F3 权威消费的真实登录、远端请求、失败清空与跨端可见结果尚受浏览器/OTP 环境阻断，只能记录“验收环境受阻，待补验”，不能用静态合同替代；非 Owner E 对抗复审也尚未在 Final7 修复候选完成。
- 原始受限证据：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\F\final7-owner\`。关键 JSON SHA-256：F1 `93800DD223FD791D6BD1D346CCDF0C6A9ACBB6094BA4C1DD03DED0A130056F95`，F2–F5 `AB181273EC53052EF6A5C1172E2F923277451274628AC0B74D78CF001BB39A2B`，首次读取快照 `E946317A337287AC21C81B02E40EADD67ACAB2029F54727C7D93C75296B18DA5`；18 份 trace 位于 `final-playwright`（示例 SHA-256：`31B596A5AAD5CDCC16985C1676F144B69876818045C6D79B765DE1C07CD77DBC`）。

## Final6-r3 锁定候选完整 Owner 复跑（2026-07-30）

- 候选身份：PC Build `njacAG-OYV84-mfOdWA9v`、后端 JAR SHA-256 `93A9B39EB8C3F1F9C425D34F6D68ECBCEEF87744794A0F7D684C14F0307AF92C`；MySQL `nexion_acceptance_20260729_114336`、Redis DB `13`，MFA bypass 与 `F_WRITE_BYPASS` 均为 `false`。Final5 后的 A5 共享后端修复已包含在此候选，不能将 Final5 证据当作最终签发依据。
- F1 从登录页和可见 F1 入口完成 maker/checker 分离、maker 自批 `403`、A6 跨域决策 `403`、同对象并发 `409`、同键重放同 operation、异载荷 `409`、CAS 恰一终态成功；真实上游已提交后中断浏览器响应时，页面明确提示结果未知，重试复用同一 Idempotency-Key，返回同一 operation `WO-260730030605395-200`。相关 F1 票据由独立上下文精确拒绝，最终 `F.prize.name=Nexion V-Rank`、pending `0`，且该文案配置没有伪造 A4/L4 事件、D4 钱包账本或 B1 储备账本写入。
- F2–F4 完成受控临时变更与恢复：`F.cooldown 30→31→30`、`F.binary.spillover 已启用→已关闭→已启用`、`F.leaderboard.minUsd 100→101→100`；六个 A2 operation 均为 `approved`，每个 operation 有 `3–4` 条 A2 审计。F5 生成临时与恢复各一个 `SUCCESS/ANOMALY_CONFIG` operation，二者都有 1 条 A2 审计和 1 条 canonical A4 outbox；说明 F-002 schema 修复在最终候选上实际生效。
- F5 独立 finally 精确删除本轮产生的两条默认配置物理行（`commission/anomaly-sigma` 与 `commission/layer-ratio-anomaly-pct`），API 回到 `3/20`，非目标配置 fingerprint 保持 `66a6454010c489760d962b251e22c83c8a1cef371abf63adeb6cfe5cf9b22147`，不可变 commission operation、审计与 outbox 依审计边界保留；F1 也在独立上下文后确认 pending=`0`、测试票据/可变幂等无残留。
- 无写及负向波次最终重跑 `16/16 PASS`：F1–F5 首访/可见侧栏、空态与确认取消、跨域入口、逐页刷新、返回、退出重登、匿名读写 `401`；readonly、nowrite、maker、nomenu 的菜单/路由/按钮/接口/数据五层权限；F1–F5 畸形成功包失败关闭、F2 `500`、F3 超时/结果未知、`404/422` 无副作用与恢复均通过。此前 r1 载具失败未计为通过，已从登录入口以 r2 全量重跑并 `passed`；最终快照 pageerror、非预期 console error、非预期管理接口 `5xx` 均为 `0`。
- 原始证据：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\F\final6-r3-f1\result.json`（SHA-256 `6D1889E2AC2EC3EAF816B80250EBCACE3F7D9CE24E6218CE7A2D33DA44D8FBD2`）、`...\F\final6-r3-f25\f25-success-cleanup.json`（SHA-256 `C12488E7D9EDAAC9349FA646BBE74795CDCF4D8C8EC995B5A46B158CF6548B91`）及 `...\F\final6-r3-owner-readnegative-r2\`（服务端快照 SHA-256 `6323FCD7914BAC05612DDE8573D34538A06F6A30C747FA19DE8CFE6B337D3DA2`）。三份 Playwright `.last-run.json` 均为 `passed`。
- Owner 结论：新发现产品 RED=`0`，未关闭 P0/P1/P2/P3=`0/0/0/0`；初审 `99/100`，Owner 执行复核 `99/100`，均超过门槛。F 域仍须由未参与修复的 E 域智能体进行非 Owner 对抗复审，完成前不并入全量最终签发。

## Final5 F1–F5 完整轮测（2026-07-30）

- 候选身份：PC Build `nvegdtsZGU8r34QGqTZeI`、PID `3396`；后端 JAR SHA-256 `234271C49DADE516C125ED9C22B5E234117B0BF5B608FC4D6FA3C39BCE4114C2`、PID `26632`；MySQL `nexion_acceptance_20260729_114336`、Redis DB `13`，`F_WRITE_BYPASS=false`。每个运行套件均重新读取本地 Build ID、计算实际 JAR 哈希并与锁定值比对。
- F1 受控写与 F001 response-unknown 为 `1/1 PASS`。maker、F-only checker、A6 reviewer 分别完成真实 MFA；maker 自批 `403`，A6 reviewer 对 F 工单跨域决策 `403`，同对象并发提案 `409 OBJECT_ALREADY_PENDING`。普通变更和恢复 operation 分别为 `WO-260730023510839-800`、`WO-260730023515918-600`，均由可见 A2 完成。
- F1 幂等/CAS/未知结果闭环通过：API 同键同载荷重放同一 operation、异载荷 `409`；两个并发终态请求严格一个 HTTP/code `200/0`、另一个 `409/409`。真实浏览器链中上游已提交 operation `WO-260730023517561-600` 后仅中断响应，弹窗明确显示“结果暂不确定”，重试 Idempotency-Key 与初始 key 完全相同，返回 HTTP/code `200/0` 并回放同一 operation，violations=`[]`。独立 finally 将 no-op 工单置为 `rejected`，`F.prize.name=Nexion V-Rank`、F pending=`0`；A2 审计存在，F1 文案变更不伪造 A4/L4 analytics，不写 D4/B1。
- F2–F4 受控写为 GREEN：从登录页和可见侧栏分别完成 `F.cooldown 30→31→30`、`F.binary.spillover 已启用→已关闭→已启用`、`F.leaderboard.minUsd 100→101→100`；maker 自批均为 `403`，专属 F2–F5 checker 从可见 A2 批准。六个工单均为 canonical `source_domain=F` 且保留精确叶对象，状态全为 `approved`；每个 operation 有 `3–4` 条 A2 审计。
- F002 F5 修复已在真实产品路径关闭：启动库中 canonical `admin.commission_anomaly_config_changed` 为 revision `303`、`ACTIVE`、6 个 required 属性。从可见 F5 调整临时阈值并精确恢复，生成 `F5-CFG-710412e5a5fa4ebc84d9`、`F5-CFG-e4f2b1dbf5e2401ba49f` 两个 `SUCCESS/ANOMALY_CONFIG` operation；每个 A2 审计 `1`、A4 outbox `1`。两条 outbox 均为 `event_name=admin.commission_anomaly_config_changed`、`schema_revision=303`、`schema_registered=1`、`analytics_event=1`。
- 精确清理通过：F5 验收前两项配置物理不存在、API 默认 `3/20`。独立新上下文先经产品接口恢复默认值，再仅以精确 `id + config_key + config_value + created_at + updated_at + is_deleted=0` 删除本轮新建的两行；各影响恰好 `1` 行。最终两项物理行均不存在、API 仍为 `3/20`，非目标配置 fingerprint 前后均为 `46113a9099399cf32fe78534f600511a8805ce72d6cc5df2e92396e54d3527b8`；immutable commission operation、审计和 outbox 保留。F1/F2/F3/F4 最终值为 `Nexion V-Rank/30/已启用/100`，F pending=`0`。
- 全域无写/负向波次为 `16/16 PASS`：F1–F5 登录/可见侧栏、服务端权威读取、空态、确认取消、跨域入口、逐页刷新、退出重登、浏览器历史、匿名读写 `401`；readonly、nowrite、maker、nomenu 的菜单/路由/按钮/接口/数据五层权限；F1–F5 畸形 `200` 失败关闭；F2 `500` 恢复、F3 网络超时恢复、真实 `404/422` 无副作用均通过。pageerror、非预期 console error、非预期管理接口 `5xx` 为 `0`。
- 静态门禁：F 域 8 组合同共 `39/39 PASS`，覆盖 canonical 端点与幂等、runtime payload 严格校验、response-unknown、UI 权限、F1/F3/F4/F5 跨域闭环；`npx tsc --noEmit`、`git diff --check` 通过。
- 原始证据：
  - `D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\F\final5-f1-r1`：`result.json` SHA-256 `43B1AB6252CCEEADBEF6E7784ED4041E7481E8F6FCA8E755210335D271CA9224`；trace SHA-256 `2C8BE1372AAD6CC4496E1B094C9CB6B65CE858181271485418DD5B75EF4BA3D1`。
  - `...\F\final5-f25-r1`：`f25-success-cleanup.json` SHA-256 `1DB4FF6F684FE16343F11F5B0C433ED3F736ED6FEB21FAF70DE4A9A55152501E`；trace SHA-256 `36F710B20CF72686E5698CBCB895F268E12BD7651FA7F2555DFACB4DD179A161`。
  - `...\F\final5-owner-readnegative-r1`：服务端快照 SHA-256 `C538B3572B6A2EE15C59F08E9164BD1D4408316882FF810BD769848D53F78B0F`；16 份 trace 哈希清单聚合 SHA-256 `093FFB6DFA5C195B5364373DDFBC22F59099FCEECC7AE09AC05FD2AD52B6B4AC`。
- Final5 域内结果：P0/P1/P2/P3=`0/0/0/0`，Owner 初审 `99/100`、Owner 执行复核 `99/100`。但本轮完成后 A5 暴露新的共享后端缺陷并产生后端源码修复，Final5 已被取代；上述 PASS 只作为修复前完整证据，**不得签发为最终候选**。主控锁定 Final6 后必须从登录入口再次完整执行 F1–F5，不能只补共享变更或抽查 F5。

## Final4 锁定候选结论（2026-07-30）

- 候选身份：PC Build `1znYVcf5Jn3HxNvPctH1v`、进程 `7040`；后端 JAR SHA-256 `76D17B09663DBE435D92D0ED129CDABBDA7FE93F0B40F2090669739F01466DBB`、进程 `21360`。所有套件均由载具重新读取 `.next/BUILD_ID`、计算实际 JAR 哈希并要求 `F_WRITE_BYPASS=false`；Playwright Chromium 全程 `workers=1`。
- F1 已在 Final4 独立 GREEN `1/1`：从登录页完成真实 MFA，经可见侧栏进入 F1；maker 自批 `403`、A6 reviewer 跨域决策 `403`、对象锁 `409`、同键同载荷重放同一 operation、异载荷 `409`、CAS 恰一成功、A4 最小权限拒绝、DB/A2/A4/outbox/D4/B1/L4 关联边界均通过。真实“上游已提交、浏览器响应中断”后页面出现结果未知告警，重试复用相同 Idempotency-Key `f-domain-action-1785342653973-2:F1:F.prize.name` 并以 HTTP/code `200/0` 回放同一 operation `WO-260730013054161-0`。独立 finally 将该 no-op ticket 精确拒绝，`F.prize.name=Nexion V-Rank`、F pending=`0`。
- F2–F4 可见成功生命周期已完成：F maker 从可见侧栏分别操作 `F.cooldown 30→31→30`、`F.binary.spillover 已启用→已关闭→已启用`、`F.leaderboard.minUsd 100→101→100`；专属 `{A2,F2,F3,F4,F5}` checker 从可见 A2 批准，maker 自批均为 `403`。六个 operation 均为 `approved`，逐 operation 的 A2 审计为 `3–4` 条；该三类 UI 参数不产生 A4 analytics outbox，最终 API/DB 精确恢复。
- F5 在首次真实成功写入口稳定 RED：专属 checker 从可见 F5 点击“调整阈值”，`PUT /api/admin/teams/commissions/anomaly-config` 返回 HTTP/code `422/422`、`A4_SCHEMA_NOT_REGISTERED`。根因是 `F5CommissionService` 发布 canonical `admin.commission_anomaly_config_changed`，Final4 验收库没有对应 A4 schema 注册；这是产品缺陷 `F002/P1`，不是载具或环境故障。
- F5 失败事务未留下半写：验收前 `commission/anomaly-sigma`、`commission/layer-ratio-anomaly-pct` 物理行均不存在，API 默认分别为 `3/20`；RED 后物理行仍为 `0`、`ANOMALY_CONFIG` operation 新增为 `0`，说明配置、operation、审计与 outbox 同事务回滚。F pending=`0`，F2–F4 仍为 `30/已启用/100`。本轮未删除不可变审计，也未使用超管或宽泛 SQL 清理。
- Final4 无写/负向整域波次 GREEN `16/16`：F1–F5 从登录页和可见侧栏读取、空态、确认取消、跨域入口、刷新、退出重登、浏览器历史、匿名 401；readonly/nowrite/maker/nomenu 四角色菜单、路由、按钮、接口、数据五层权限；F1–F5 畸形 `200` 失败关闭；F2 `500` 恢复、F3 超时/结果未知恢复、真实 `404/422` 无副作用均通过。pageerror、非预期 console error、非预期管理接口 `5xx` 为 `0`。
- 原始证据：F1 为 `D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\F\final4-f1-r1`，`result.json` SHA-256 `2E75265ACBEE6F4E6EBF329D22512C7F958EF74385CCDE135E52F4E8060B628D`；F2–F5 RED 为 `...\F\final4-f25-r4`，汇总 SHA-256 `BDF7811A2E550E349ED7F9FE7BFF8DB019C295A5117C08D4D596C8A7D20BABF4`、trace SHA-256 `C5FECB1B47B69069078FF2D7643020E4D3BC00EF7A86A3AE3824EAD9FE164AE5`、事后 DB 清理核验 SHA-256 `6EFF0489AB5AE5B803976DB65CCB925B1BD7778C3C46C324F8D91F9A2341E6D5`；无写/负向波次为 `...\F\final4-owner-readnegative-r1`，服务端快照 SHA-256 `AE5C83AD538F0BD97002E6C3011EF1E638BDC9F2A81CECC8C8EBDB5C053C0E8E`，16 份 trace 哈希清单聚合 SHA-256 `3392DC4782DB4A2FA0297C55EFD7BF2778889326375AF7EFC4A55C350294B6BD`。
- 处置：按修复轮换，F Owner 不修改本域产品代码；`F002` 已移交 G 修复。Final4 写令牌作废，不再执行成功写。待主控应用 schema、重建并锁定 Final5 后，必须从登录入口完整重跑 F1–F5、精确恢复、DB/A2/A4/outbox/关联域、权限和故障矩阵，不能只重测 F5。
- Final4 初审 `88/100`，复审 `90/100`；未关闭缺陷 P0/P1/P2/P3=`0/1/0/0`。结论：**不通过，不签发。**

## Final3 F1 响应未知真实 RED（2026-07-30）

- 候选身份：PC Build `B9Ondo82Dj7NKNNE6ZcgB`；后端 JAR SHA-256 `54B25D49CC36BAB02E1E36627CE5D9296AE92717FBACEFD5F222EE04528E59E4`。运行前由载具对 `.next/BUILD_ID` 与实际 JAR 重新计算并硬校验，`F_WRITE_BYPASS=false`。
- 首次用户链路：F maker 从登录页完成真实 MFA，经可见侧栏进入 F1，在“修改奖品名”弹窗对 `F.prize.name` 提交 no-op 目标 `Nexion V-Rank`。首个 `POST /api/admin/platform/audit/operations` 已在上游真实提交，生成 operation `WO-260730000111604-0`，随后仅中断浏览器响应。
- 实际 RED：响应中断后确认弹窗仍保留，但没有 `role=alert`，用户无法知道“结果未知”；立即重试时前端生成新的 Idempotency-Key，后端返回 HTTP/code `409/409 OBJECT_ALREADY_PENDING`，没有回放首次 operation。稳定失败合同为 `UNKNOWN_OUTCOME_ALERT_MISSING`、`RETRY_COMMAND_KEY_CHANGED`、`RETRY_NOT_IDEMPOTENT_SUCCESS:409/409`、`RETRY_OPERATION_ID_CHANGED_OR_MISSING`。
- 数据权威证据：`nx_admin_idempotency_record` 中首次 key 的 scope/status 为 `A2_COMMAND/SUCCEEDED`，响应指向上述 pending operation；重试 key 为另一条 `A2_COMMAND/FAILED`，错误为 `BizException: OBJECT_ALREADY_PENDING`。因此这是“服务端已提交、客户端无法确认、同一用户动作不能安全重试”的真实产品缺陷，不是载具或环境故障。
- 同轮先行 GREEN：maker 自批 `403`；A6 reviewer 对 F operation 跨域决策 `403`；同对象并发提案 `409 OBJECT_ALREADY_PENDING`；普通可见 maker/checker 临时变更及恢复成功；API 同键同载荷重放返回同一 operation、异载荷 `409`；CAS 仅一个终态请求成功，另一请求 `409`；F-only checker 访问 A4 页面接口 `403`。
- 独立清理：主流程结束后新建 checker 上下文，将结果未知 operation 精确拒绝并释放对象锁。最终 `F.prize.name=Nexion V-Rank`、pending 数 `0`、未知 operation 为 `rejected`、A2 审计 `2` 条；关联 A4 outbox、D4 钱包账本、B1 储备账本、L4 分析 outbox 增量均为 `0`。此前载具竞争产生的孤儿 pending 也已由独立受限 checker 清理并单独通过 `1/1`，没有使用超管兜底。
- 原始证据：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\F\final3-response-unknown-red-r7`，完整摘要见同目录 `SHA256SUMS.txt`。`result.json` SHA-256 `C272E1BBE18B9806223887D0983FD6575DB5470AE2E881D5D4EA30834E3016CD`；响应未知截图 SHA-256 `DB50D5D41691719D3A363056200082E92ACE96E2EBF936E2B38146952E041454`；`trace.zip` SHA-256 `EA774AB67D53ED9CA1F1D9B695A820CA59A77D6F208E5595889BFD62FE225DCE`。
- 处置：依计划停止 F2–F5，不把未执行范围计为通过，也不由 F Owner 修改产品代码。证据已移交轮换修复 Owner G；待最小修复进入新锁定候选后，F Owner 必须从登录入口重新执行完整 F1，再继续 F2–F5 与整域回归。
- 轮换修复静态状态：G 已将一次弹窗意图的稳定 command key 保留到成功或取消，结果未知后的同弹窗重试复用原 key，并将提交异常重新抛给 `OperationConfirmModal` 的 `role=alert`；多字段参数使用确定性子 key，避免同一意图内部冲突。新增合同由 RED `0/3` 转为 GREEN `3/3`，F Owner 独立复核该合同 `3/3` 与全仓 `npx tsc --noEmit` 均通过。该结果仍不是运行时通过；需要 PC-only 重建并锁定新 Build 后才能复验。

## 下一候选受控写载具静态就绪（尚未执行，不评分）

- 本节只记录载具静态准备；当前未取得主控对 `F_WRITE_BYPASS=false`、最终四角色 manifest 与新 `F_WRITE_TOKEN` 的联合确认，因此**没有启动任何主库成功写**，也没有用静态检查替代 Owner 结论。
- 统一账号边界：Owner、权限矩阵、畸形包、异常恢复四个套件已移除 password-only `superadmin` 依赖，统一从本 Run 的 `A/domain-permission-fixtures/F.json` 读取账号并强制完成真实 MFA；受控写套件只接受 A 主控受限 manifest 的固定 `finalAccounts.a6_reviewer`、`finalAccounts.f1_checker` 与 `finalAccounts.f25_checker`，每项直接读取 `{roleCode,username,password,totpSecret}`，不接受 legacy/nested account、环境变量角色兜底或第二份敏感 adapter。F maker、F1 checker、F2–F5 checker、A6 reviewer 四名写流程账号必须互不相同，并校验 Run ID、角色码和 authority domain；候选身份不信任 manifest 文本，而由 `F_EXPECTED_BUILD_ID`/`F_EXPECTED_JAR_SHA256` 对本地 `.next/BUILD_ID` 与实际后端 JAR 重新计算硬校验。
- SHARED-003 运行门禁：A6 reviewer 只能持 A2/A6 决策权限且不得带业务域 authority；F-only checker 必须持 A2 read/approve 与 F1 read/write，业务域集合严格等于 `F`。最终菜单合同只接收叶子：reviewer 的 session menuCodes 必须精确为 `{A2,A6}`，checker 必须精确为 `{A2,F1}`；不要求 session 带 A/F 父 code，但真实侧栏必须由 PC 派生出对应父分组，并且遍历 `CONSOLE_NAV` 后只能看见各自这两个叶链接。稳定执行入口为 `f-shared-003-runtime-gate-20260729.spec.ts --grep "new JAR:"`；A6 no-op、F checker 跨域/未知 operationId 拒绝、F ticket 可见 list/detail/decision 和 finally 均在同一闭环。
- F1 maker/checker 载具已去除第三个 password-only superadmin 上下文；对象锁由第二个并发请求验证，CAS 由同一 F-only checker 的两个并发终态请求验证，A6 reviewer 对 F ticket 必须 `403`。新增真实 `route.fetch()` 上游提交成功后中断浏览器响应、同一 Idempotency-Key 重放返回同一 operation 的 response-unknown 探针。
- DB/A4/outbox/关联域：受控写要求只读 DB 令牌和独立 MySQL 凭据，核对 `nx_config_item`、`nx_audit_operation_ticket`、`nx_audit_log`、`nx_event_outbox`，并证明 F1 奖品文案 no-op/恢复不伪造 A4/L4 analytics event、不写 D4 `nx_wallet_ledger`、不写 B1 `nx_treasury_reserve_ledger`。F-only checker 对 A4 页面接口继续按最小权限 `403`，A4/outbox 边界由 DB 权威表核对。
- 权限矩阵重新纳入本候选完整 Owner 波次：readonly、nowrite、maker、nomenu 均使用 F.json 的真实 MFA。所有拒绝写探针都改为服务端必定无副作用的非法 rank/key；即使权限层发生回归，业务校验也只能返回 4xx，不能意外触发 F3 结算、F4 奖池结算或真实参数修改。该波次同样要求 `F_NEGATIVE_WRITE_PROBE_TOKEN=1`、`F_WRITE_BYPASS=false` 以及候选 Build/JAR 实体硬校验。
- 独立 finally：主流程浏览器上下文先关闭，再新建独立 F maker/F-only checker 上下文；拒绝所有尚未终态的 F tickets，按验收前 API/DB 快照新建并审批精确恢复，最终要求 pending 集合为空且 `team.ui.F.prize.name` API/DB 双重一致。任何清理错误聚合抛出，禁止静默吞掉。
- F2–F5 成功载具：新增 `f25-f2-f5-success-cleanup-20260729.spec.ts`。F2 使用 Partner Status 权益门槛、F3 使用自动安置策略、F4 使用榜单最小额，均从可见 F 侧栏提交临时值，经 `{A2,F2,F3,F4,F5}` 专属 checker 从可见 A2 审批，再提交并审批原始值恢复；maker 自批必须 `403`。F5 使用同一专属 checker 从可见页面调整异常阈值并恢复，核对 `nx_commission_operation`、A2 审计和 A4/outbox。主流程关闭后再以新 maker/checker 上下文拒绝残留 pending、按 API/DB 快照恢复并复验菜单/权限边界；任何清理失败聚合抛出。所有变更都要求隔离环境、主控写令牌和 `F_WRITE_BYPASS=false`。
- 静态门禁：F 受控写 spec 与共享 helper 已通过全仓 `npx tsc --noEmit` 和 `git diff --check`；一次性固定 schema manifest 下，F1、SHARED-003 与新增 F2–F5 载具完成 Playwright discovery `5/5`，随后已删除该静态文件。正式专属 manifest 尚未下发，未执行登录、接口或业务写，也未伪造运行结果。
- 预期 RED 风险（待真实载具确认）：F1 `proposeFConfig` 当前未向 `createA2OperationProposal` 提供稳定 `commandKey`；A2 client 只有在 `commandKey` 存在时才把 transport failure 分类为结果未知并复用同键。因此真实“上游已提交、浏览器响应中断”用例预计会在保留弹窗、明确结果未知或同键重试处失败。不得用 API 直调替代此首次用户可见链路；若运行复现，按产品缺陷进入主控修复与整域重跑。
- 完整签发边界：A 主控已把最终最小权限合同扩展为 `f1_checker={A2,F1}` 与 `f25_checker={A2,F2,F3,F4,F5}`；载具静态就绪不等于运行通过。只有最终 manifest、固定候选哈希和主控写令牌全部下发后，F1 response-unknown 先稳定复现并由轮换 G 修复，再从登录入口完整运行 F1–F5、独立 finally 和整域重跑，才可签发。

## 统一候选 ODaNTve-ln2-d4L6DPMKG 无写复跑（2026-07-29）

- 候选：PC `ODaNTve-ln2-d4L6DPMKG`；后端 JAR SHA-256 `55B9E011...82CE6`。本节仅记录这一次统一候选的真实浏览器复跑，不复用历史结论。
- 静态合同：`f-domain-contract`、`f-overview-runtime-contract`、`f-ui-permission-contract`、F1/F3/F4/F5 closure 共 `36/36` 通过；`npx tsc --noEmit` 通过。
- Owner 无写可见路径：`f-domain-owner` 以登录页和可见“分销与团队”侧栏完成 F1–F5 服务端读取、主流程空态、确认取消、跨域入口、逐页刷新、浏览器返回/前进、退出重登及匿名读写失败关闭，`4/4` 通过；未提交成功业务写。
- 专属四账号权限矩阵：readonly、nowrite、maker、nomenu 均从真实登录/MFA 与可见侧栏执行。readonly/nowrite 的 F1–F5 读取均 `200`、所有写探针均 `403` 且无可用写按钮；maker 的 F1–F5 读取、刷新、退出重登均通过且不执行写；nomenu 的 authority/menu 均为空、侧栏和直接路由拒绝，F1–F5 读写均 `403`，刷新与重登后仍拒绝，`4/4` 通过。
- 读取异常与 F-001：对 F1–F5 各自 BFF 读取分别注入畸形 HTTP `200 {code:0,data:{}}`，五页均失败关闭；F5 显示 `F5_OVERVIEW_RESPONSE_INVALID` 与“佣金权威快照不可用，批量补发已暂停”，写入口为 `0`，撤销注入并重试后恢复真实读取，`5/5` 通过。
- 原始证据：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\F\final-ODaNTve\owner`（截图与服务端快照）及 `...\final-ODaNTve\playwright`（13 个单 worker trace）。
- 结果未知边界：本轮明确禁止成功业务写；因此未向后端发送真实可变命令，F3/F4/F5 的“写后网络中断、同键查询/重放、CAS”未知结果闭环仍属于受控写阶段，不能以本轮无写结果冒充已验收。读取侧异常已由五模块畸形成功包失败关闭覆盖。

## 运行基线

- Run ID：`pc-full-acceptance-20260729-114336`
- 任务载体与执行器：PC 管理端；Playwright Chromium headless，`workers=1`。内置交互浏览器不可用，已按《页面业务逻辑通顺性验收方法》使用命令行 Chromium 降级执行。
- 最终候选前端/后端：`http://127.0.0.1:3002` / `http://127.0.0.1:8110`；PC Build `sgca8V_8FEA8-6ai3edh9`；后端 JAR `BFFCE45D...A9F43F`。
- 隔离环境：MySQL `nexion_acceptance_20260729_114336`、Redis DB `13`、MinIO `nexion-acceptance-20260729-114336`。
- 原始受限证据：[F 证据目录](D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\F)。

## 已完成证据

- 首次用户以 `superadmin` 从登录页、可见“分销与团队”侧栏进入 F1–F5；五页标题可见、BFF 读取均为 HTTP 200 / `code=0`，逐页刷新成功，退出并重登后 F5 恢复服务端事实。
- 匿名 F1–F5 读取以及 F3 结算、F4 提前结算、F5 补发三条写请求均为 HTTP 401（8/8），未发生越权写入。
- F2、F3 的确认对话框可从用户可见按钮打开并取消，未提交业务写入。
- 对 F1–F5 分别注入畸形 HTTP 200 `{code:0,data:{}}`：均显示可理解的加载失败提示，F1–F4 均无数据行和可写按钮；页面错误为 0。完整截图、trace、清单及失败注入结果均在受限证据目录。
- 静态链路：页面 → `f1-client` → 严格 BFF → `OpsTeamController`/F5 Controller → Service/Mapper → 业务表、A2/A4/outbox 已盘点。F1、F3、F4、F5 closure contracts 共 15/15 通过；覆盖 F1 一步晋升/奖励、F3 mutex/CAS/`commission.paid`、F4 A2/D4/A4、F5 RBAC/冲正/补发/暂停。F2 的 `/rates` 读取及结构化费率模型已做源码溯源。
- 最终 Owner 无写重跑：从登录页和可见“分销与团队”侧栏进入 F1–F5，逐页刷新均成功；F5 退出重登后恢复。F-001（原 P2）回归中，将 F5 BFF 读取替换为畸形 HTTP 200 `{code:0,data:{}}`，页面显示 `F5_OVERVIEW_RESPONSE_INVALID:domain` 与“佣金权威快照不可用”，`批量补发`按钮为 `0`；失败关闭成立。证据位于 `restricted/F/final-owner-rerun`。
- 非 Owner G 已修复并复验随 F-001 陈旧的 UI 权限合同；本 Owner 复跑 F 域定向合同 `32/32` 通过。
- 当前候选权限无写证据：使用当前专属 `F.json`、单 worker，四账号矩阵 `4/4` 通过（readonly、nowrite、maker、nomenu）。readonly/nowrite：F1–F5 菜单、路由与读取可用，写入均 403，刷新/重登稳定；maker：从登录入口、可见侧栏读取 F1–F5，逐页刷新与重登均通过且本轮未执行业务写入；nomenu：`unassigned`、authority/menu 双空、F 菜单为 0、直接路由不可达，F1–F5 读写均为 403，刷新/重登后仍拒绝。证据：`restricted/F/final-owner-r4-permissions/playwright`。
- 最终候选 Owner 可见路径重跑：以专属 maker 账号从登录页和可见侧栏进入 F1–F5，逐页刷新及 F5 退出重登均通过、无读取失败面；证据：`restricted/F/final-candidate-owner`。F-001 定向复验独立等待错误面：畸形 200 后显示 `F5_OVERVIEW_RESPONSE_INVALID:domain` 与“佣金权威快照不可用”，批量补发按钮为 `0`；证据：`restricted/F/final-candidate-f001`。
- 本轮 Owner 完整无写重跑：`f-domain-owner` 从登录页和可见侧栏完成 F1–F5 真实读取、空态/确认取消/跨域入口、逐页刷新/退出重登/浏览器前进后退、匿名读写 401，`4/4` 通过；证据：`restricted/F/final-owner-r4-visible`。随后以新独立浏览器上下文对 F-001 注入畸形 200，错误面可见且“批量补发”按钮为 0，`1/1` 通过；证据：`restricted/F/final-owner-r4-f001/playwright`。F UI 权限合同 `5/5` 与 TypeScript 均通过。

## 缺陷

### [P2][已关闭] F5 畸形权威快照后仍保留无反馈的可点击“批量补发”

- 复现：以真实登录态从可见侧栏进入 F5；仅对其 BFF 读取注入畸形 200；页面出现 `F5_OVERVIEW_RESPONSE_INVALID` 后点击“批量补发 (0)”。
- 历史实际：按钮可见且 `disabled=false`；点击后无对话框、无提示、无非 GET 请求。
- 正确：失败关闭时应隐藏或禁用所有写入口，并明确提示“当前数据加载失败，无法执行补发”；不得留下无反馈死操作。
- 影响：运营人员在服务端数据协议异常时会误以为可处置佣金，违反失败关闭与过程反馈要求；未发现资金、账本或 outbox 写入。
- 证据：`failure-injection/F5-malformed-200-batch-reissue-entry.png`、`failure-injection/F5-malformed-200-batch-reissue-result.json`。
- 修复与回归：以 F5 权威读取状态作为按钮守卫；错误态隐藏“批量补发”并显示不可操作原因。G 修复后，Owner 已从登录入口重跑 F1–F5 并完成畸形 200 回归，按钮数为 0。

### [P1][共享修复已落地，待专属两角色运行复验] A2 自定义 checker 看不到 F 提案，但可按已知 operationId 决策

- 写令牌：主控已发放 `F_WRITE_TOKEN`，范围仅限 F 专属策略/团队/佣金测试对象；本次只启动首个 F1 成功写生命周期，未触碰 B/D/J/K/H 全局单例或真实资金余额。
- 真实路径：独立 maker 从登录页、可见“分销与团队 → F1”打开修改弹窗，提交 `F.prize.name` 临时变更，生成 A2 operation `WO-260729180933288-600`。maker 自批返回 403；第二运营员同对象并发提案返回 409 `OBJECT_ALREADY_PENDING`，两项保护均正确。
- 阻塞现象：独立 checker `ACC_CHECKER_114336` 具 `platform_a2_read`、`platform_a2_operation_approve` 和 A2 菜单，从可见侧栏进入 A2 并刷新后仍显示待确认 0，operation 行不存在，无法完成真实 UI maker/checker 成功闭环。
- 权限矛盾：清理阶段同一 checker 以已知 operationId 直接调用 reject 成功。也就是说，该角色在读层被行级过滤，却能在写层决策同一不可见对象，违反菜单、路由、按钮、接口、数据五层权限一致性。
- 根因证据：后端 `A2AccessPolicy.current()` 只识别 `SUPER_ADMIN/AUDITOR/FINANCE/RISK/GROWTH/CONTENT/SUPPORT`；其他自定义 RBAC role code 固定映射到 `allowedDomains=["__NONE__"]`。`approve/reject` endpoint 仅检查 `platform_a2_operation_approve`，没有复用该行级 scope。
- 停写与清理：发现后依照令牌规则立即停止全部 F 写，未继续 F2–F5、结果未知、F3 CAS、幂等或双运营员写探针，也未修改 F 或共享产品代码。finally 将 operation 精确置为 `rejected` 并释放对象锁；只读 Playwright 复核 `1/1` 通过，F.prize.name 仍为验收前 `Nexion V-Rank`，superadmin 可见 rejected operation，checker 仍不可见，A2 日志按 operationId 匹配 3 行。
- 证据：`restricted/F/final-ODaNTve/write-owner/f1-maker-checker/`。失败 trace、A2 页面截图、请求结果和清理复核均在受限目录；`result.json` SHA-256 `F9BA5B1293C40CA5A6BC6447FEE347A50B7802D992FBE4D627F611ACC989FF1D`，`cleanup-readonly.json` SHA-256 `D09F46E4E315EF6158EDBD5526092B9D13551A8ECDF00D2DADE266E834E7D93B`。两份可汇总 JSON 不含账号密码、TOTP secret 或会话令牌；原始登录 trace 仅保留于 `.restricted`，不得复制到报告或公开工件。
- F checker 夹具锁：依主控令牌，仅从真实登录与可见 A6 为 `ACC_CHECKER_114336` 增加一次 `network_f1_write`，其余 83 个权限和 88 个菜单原样保留。旧 JAR 上，目标 F checker 对 A6 提案 `WO-260729183503301-200` 的跨域审批意外返回成功并使夹具达到目标状态；这是 `SHARED-003` 的第二个真实 RED，**不是合规授权 GREEN**，也没有继续任何 F 业务审批。
- 会话清理与重签：内置超管从可见 A1 提交强制登出，独立超管从可见 A2 审批；最终清理 operation 为 `WO-260729184424772-300`。撤销前可见会话数 `1`，旧会话探针 `401`，A1 可见会话数归零；随后 checker 真实 MFA 重登并刷新，session 与 A6 角色精确一致（84 权限、88 菜单，`network_f1_write` 恰好 1 次，A2 read/approve 保留）。首次清理尝试 `WO-260729184333176-600` 已被后端接受，载具因错误假设“已执行行会从表中消失”而 RED；修正为校验“执行按钮消失”后完整复跑通过，两次均仅为会话清理、没有产品业务写。
- A2/A4 证据：旧 A6 RED operation 在 A2 中为 `approved`，按 operationId 核对到 7 条脱敏审计记录；A4 overview 不含该 operationId 或 role code，因此按 A6 的 A2 审计边界记录为 `N/A`，未伪造事件中心命中。证据目录 `restricted/F/final-ODaNTve/fixture-lock-checker-f1-write/`；`post-red-cleanup-evidence.json` SHA-256 `4FDFAFB7B9F583C501764B9867C2B8466838A6040D23A266E5D916204FAE1FA2`，全目录摘要见 `sha256.json`。汇总 JSON 不含账号密码、TOTP secret 或会话令牌。

## 当前结论

- Final5 F 域结论：**候选内 PASS，但不签发为最终候选。** F001、F002 均由真实浏览器完整整域轮测关闭；受控写 `2/2`、无写/负向 `16/16`、F 合同 `39/39`、TypeScript 均通过，清理残留为 `0`。
- Final5 Owner 初审 `99/100`、Owner 执行复核 `99/100`；F 域未关闭产品缺陷 P0/P1/P2/P3=`0/0/0/0`。该复核不是计划要求的非 Owner 对抗复审。
- 待完成：A5 后续共享后端源码修复使 Final5 候选被取代。主控锁定 Final6 后，F Owner 必须从登录入口重新执行 F1–F5 全部受控写、权限、故障态、刷新重登、DB/A2/A4/outbox/关联域和精确恢复，再由 E 域完成非 Owner 对抗复审；不得复用 Final5 分数直接签发。

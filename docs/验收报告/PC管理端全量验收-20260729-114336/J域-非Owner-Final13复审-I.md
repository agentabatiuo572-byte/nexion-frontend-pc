# J 域非 Owner Final13 对抗复审（I）

运行 `pc-full-acceptance-20260729-114336`，候选锁 Final13。复审人未参与 J 域修复；真实 PC `3002`、后端 `8110`、数据库 `nexion_acceptance_20260729_114336`。所有已执行 Playwright 均为 Chromium、`workers=1`、`trace=on`，并从可见登录和侧栏进入；MFA bypass 为 false。

## 复审结论

**复审通过：99.1/100（严格大于 98）。P0/P1/P2/P3 = 0；未发现硬产品错误。**

J1--J4 的普通用户可见入口、刷新/重登、五层权限、服务端拒绝和故障关闭均由本轮独立证据覆盖。J1 的 trial 单例、J2 地域规则、J3 阈值/K4 开关与 J4 Genesis 所有权在前后镜像比对中完全一致；无 J 域对象锁残留。

## 对抗覆盖与结果

| 范围 | 本轮真实结果 |
|---|---|
| J1 Kill Switch | 4/4 通过：可见五闸说明；未知结果保持确认框且复用同一幂等键；trial 关停--刷新--重登--可见恢复；503 时隐藏控制、可见重试后恢复。trial 最终 enabled。 |
| J2 Geo-block | 首次用户、可见应急封锁/受限名单/端点派生、刷新重登、503 失败关闭均通过；未知结果提交后仅原 key 重放，载荷不一致与过期 CAS 都明确 409，最终回到前镜像。 |
| J3 篡改防御 | 独立首次用户流程通过：阈值输入校验、10--11--10 恢复、K4 开关、刷新/重登、503 隐藏陈旧控制并可重试；匿名写 401；未知结果原 key 重放及 CAS/载荷冲突 409。 |
| J4 作用域和权限绕过 | maker 从可见侧栏无写遍历 J1--J4、刷新与重登均通过。readonly、menu-no-write、no-menu 三组均通过五层检查：菜单/路由/按钮/接口/数据一致，四个 J 写接口均是服务端 403，no-menu 直接路由和读写均为 403，重登后不回流。J4 未出现由前端伪隐藏代替服务端鉴权的情况。 |
| A2/A4/outbox | J4 写权限在当前只读/无菜单对抗账户上被服务端预期拒绝 403；数据库仍有 13 条 J 相关 outbox，活动 SOP=2、执行记录=2。本轮未以 maker 自批或伪造 checker 绕过双人门槛。 |
| 401/403/404/409/422/5xx/断网/畸形成功 | 401（匿名 J3 写）、403（J1--J4 全五层）、409（J2/J3 CAS 与幂等载荷冲突）、503/网络结果未知（J1/J2/J3 fail-closed）均按预期；授权后的未知资源 404 与 J4 覆盖红线 422 属已有载具但本轮未触发真实破坏性 J4 执行，未将其虚构为已复验。没有将 5xx、超时或畸形 200 误判成功。 |

## 边界说明

`j2-live-acceptance-20260722.spec.ts` 的前三项（首次用户、完整可逆写入、503 恢复）通过。第四项在创建临时超管/checker 时收到 `403 无权限访问`，因为本轮 maker 夹具声明的权限不包含平台 A1 账号创建权限；这正是服务器 fail-closed，而非 J2 产品缺陷。该脚本随后跳过其清理项，但该失败发生在任何临时账号创建之前；独立 finally 随后完成精确前后镜像核验，`actions=[]`、`exactMatch=true`。未擅自提升权限或改写夹具来把载具失败伪装为产品通过。

J4 maker--checker--A2 approve--execute--rollback 的破坏性闭环需要一对当前有效且各自持有 MFA seed 的不同账号。Final13 的既有 checker 载具在 Owner 轮已被记录为不可用；本轮依照非 Owner 复审边界，没有重置账户、创建超管或让 maker 自批。因此本报告只把真实完成的预期 403、可见作用域、A2/outbox 存量和恢复快照计入结论，不把未满足前置条件的 destructive chain 宣称为已通过。

## 前后状态、运行态与清理

- 前镜像与最终独立 finally：J2 blocked/limited 均为空；可配置端点保持 derived/空国家；edge source=`nexion-gateway`；J3 threshold=10、feedK4=true；J1 Genesis enabled=true、emergency=false；精确匹配。
- 数据库后检：J 域对象锁=0，active SOP=2，active execution=2，J 相关 outbox=13。J1 trial=enabled；J1 Genesis=enabled，均非 emergency。
- 运行态：Final13 锁确认 PC `3002` build `lqlGobSf9dgLarrRkjFGn` / backend `8110` JAR SHA-256 `34706D1FC0AD02923AEB6217B405D90FAA47730387266E56D9336BA0564557A7`；根页 HTTP 200；陈旧 `3005` 不可达。
- 本轮没有编辑业务源码、共享夹具、共享账本；没有提交或推送；未持有或遗留 J 写锁。

## 执行摘要

| 载具 | 退出码 | 结果 |
|---|---:|---|
| J2/J3/J4 前镜像 | 0 | 1 passed |
| J1 完整可见生命周期 | 0 | 4 passed |
| J1--J4 readonly/no-write/no-menu 五层权限 | 0 | 3 passed |
| maker 可见侧栏无写遍历 | 0 | 1 passed |
| J2/J3 unknown-result + idempotency + CAS | 0 | 2 passed |
| J3 独立首次用户/Murphy/401 | 0 | 1 passed |
| J2 主流程 | 1 | 3 passed；第 4 项载具因预期平台 A1 403 未运行到 checker 创建，非产品缺陷 |
| 最终独立 finally | 0 | 1 passed；精确匹配 |

证据根目录：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\J\final13-nonowner-i`  
证据文件清单聚合 SHA-256：`C7E0EDCCBA20D8CD5AFA7D2B95CC0A0235048EBA83B5A3F4ED8A1A70BA09273C`（不含凭证）。

关键证据 SHA-256：

- J1 trial 关停后刷新证据：`C834D40E5E00067C85E1C58E5B42F4E6B1C3253ED1947DC04BC9CA0AE8BA6831`
- J2 unknown/CAS/幂等证据：`C04DF29C1C2D9A4DDF04F9647B9AC86E227B58078D9DF3999993AAF75843A331`
- J3 unknown/CAS/幂等证据：`E712E02CE8DCC6983C26717932893D593CB3E37A2D2890007E9B81E4D94B3CC5`
- J3 独立完整浏览器 trace：`ABA98405513454B9276DFF5FEC739D1EF2F66C43B0D7F3C6AA98CC49C30CD380`
- J1--J4 no-menu 五层证据：`194924AA84BFB470C056BACE8A99D311DF1DD5777B2DF8057978FE37F289C8DD`
- 最终前后镜像精确匹配：`F421A0A65937C6B5E216245C4A4F4911C91065C0311A3F0FC95500B95ADDE3FF`

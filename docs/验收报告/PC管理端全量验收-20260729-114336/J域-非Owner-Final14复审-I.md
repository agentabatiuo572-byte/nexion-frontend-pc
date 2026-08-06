# J 域非 Owner Final14 对抗复审（I）

运行 `pc-full-acceptance-20260729-114336`、候选锁 Final14。复审人未参与 J 域修复。真实 PC `3002`（build `0OZ66wYtIYX6qJHhZUvQK`）、后端 `8110`（JAR SHA-256 `F54932E72C272E14247439DC32ECC9165FD741E7A25C7E3D60464FB4FACA7399`）、数据库 `nexion_acceptance_20260729_114336`。全部 Playwright 运行均为 Chromium、`workers=1`、`trace=on`，从真实 MFA 登录和可见侧栏进入，MFA bypass=false。

## 结论

**复审通过：99.3/100（严格大于 98）。P0/P1/P2/P3=0，硬产品错误=0。**

J1--J4 的首次用户入口、刷新/重登、权限五层、unknown-result 幂等、CAS、失败关闭和精确恢复都由本轮独立执行验证。没有使用 mock、隐藏路由、localStorage 权威或 maker 自批来替代真实链路。

## 覆盖结果

| 模块 | 真实对抗结果 |
|---|---|
| J1 Kill Switch | 4/4 通过：五闸首次用户理解、未知结果保持确认框并复用同一命令键、trial 关停--刷新--重登--恢复、503 时 fail-closed 并经可见“重新读取”恢复。最终 trial=enabled。 |
| J2 Geo-block | 3/3 主流程通过：可见登录/侧栏、权威状态与刷新重登；黑名单/受限名单/端点派生真实可逆写入；503 断网式故障关闭与恢复。另一个独立载具验证提交后响应丢失只能同 key 重放，payload mismatch 和 stale CAS 均为 409，最终恢复。 |
| J3 篡改防御 | 独立首次用户/Murphy 通过：阈值输入校验、配置持久化、刷新/重登、503 隐藏陈旧操作与可见重试；匿名写=401。unknown-result 重放、CAS 与幂等载荷冲突均 fail-closed 409，最终恢复 threshold=10、feedK4=true。 |
| J4 SOP | Final14 V4 可见入口和真实调用范围、刷新、重新登录不降级通过。maker 无写遍历 J1--J4 通过，未发出业务写命令。J4 的 readonly/menu-no-write/no-menu 对抗角色均证实按钮、路由、接口、数据一致；写接口是服务端 403，不是前端伪隐藏。 |
| 五层权限 | 3/3 通过：readonly、menu-no-write、no-menu。四个 J 模块在菜单、路由、按钮、读取接口和写接口五层一致；无菜单角色直达、读、写均 403，刷新/重登后不漂移。 |
| A2/A4/outbox | 当前 J 源 A2 工单=1、pending=0；A4 无遗留 J 历史；J 相关 outbox=13。未满足独立 checker 的情况下没有伪造 A2 批准或让 maker 自批。 |

## 墨菲与状态码证据

- 401：J3 匿名写入被拒绝。
- 403：J1--J4 的只读/无写/无菜单角色 API 写入均由服务端拒绝。
- 409：J2/J3 的相同 key 载荷冲突、过期 CAS 被拒绝；未知结果只允许原 key 重放。
- 503、断网/超时语义：J1、J2、J3 都隐藏无法确认的控制项，显示可见重试，不把不确定结果当成功。
- 404 和 422：本轮未捏造不存在资源或触发真实破坏性 J4 回滚红线；它们不作为“已通过”虚报。所有已触发的非 2xx 都按预期失败关闭，没有畸形 200。

## 恢复与后检

- Final14 前镜像与最终独立 finally 精确相等：blocked/limited 均为空；可配置端点保持 derived/空国家；edge source=`nexion-gateway`；J3 threshold=10、feedK4=true；J1 Genesis enabled=true、emergency=false；`actions=[]`、`exactMatch=true`。
- 数据库后检：J 对象锁=0，active SOP=2，active execution=2，J A2 pending=0，trial=enabled、genesis=enabled。
- 运行态后检：根页 HTTP 200；陈旧 `3005` 不可达。
- 未改业务源码、共享夹具或共享账本；未提交、未推送；无 J 写锁残留。

## 执行摘要

| 载具 | 退出码 | 结果 |
|---|---:|---|
| J2/J3/J4 前镜像 | 0 | 1 passed |
| J1 完整可见生命周期 | 0 | 4 passed |
| J1--J4 五层权限 + maker 无写 | 0 | 4 passed |
| J2/J3 unknown-result、幂等、CAS | 0 | 2 passed |
| J3 独立首次用户/Murphy/401 | 0 | 1 passed |
| J2 主流程与 503 fail-closed | 0 | 3 passed |
| J4 Final14 V4 可见范围/刷新/重登 | 0 | 1 passed |
| 最终独立 finally | 0 | 1 passed，精确匹配 |

证据根目录：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\J\final14-nonowner-i`  
证据清单聚合 SHA-256：`AAF2DD35DC31AF725C0EB7D37A365AC5BA2BBB627A456B0D4BB1D4CD23C8B510`（不含凭证）。

关键证据 SHA-256：

- J1 关停--刷新--重登--恢复：`30A54454737F34EAC18EF7E11EBA5DB4E34811188128EE5490C7B98855F783F2`
- J2 unknown/CAS/幂等：`04F61D667F5A634E87881EA108FD8D394FB855D15FFEDF01BAF3ED859B7F3300`
- J3 unknown/CAS/幂等：`D96F75F63935AED8E4B59370FCC0F8BA4706E3B6804816306D648912C2B9A5A4`
- J3 独立浏览器 trace：`34AF0AA6550BADB50840375C8886EB30B2F06E6C9D5A158EC368AB473C82E912`
- J1--J4 no-menu 五层权限：`194924AA84BFB470C056BACE8A99D311DF1DD5777B2DF8057978FE37F289C8DD`
- 最终前后镜像精确匹配：`5BBD3F2297B816661D055FB2D35537004A674C101002496F51E2DFB026C6030F`

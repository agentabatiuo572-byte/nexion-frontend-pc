# L 域 Owner Final12 初审验收报告

运行：`pc-full-acceptance-20260729-114336`  
候选锁：`Final12`（PC `http://127.0.0.1:3002`，后端 `http://127.0.0.1:8110`，库 `nexion_acceptance_20260729_114336`，Redis DB 13，MinIO `nexion-acceptance-20260729-114336`）  
执行时间：2026-08-02 01:16–01:57（Asia/Tokyo）  
范围：L1 KPI、L2 漏斗/Cohort/留存、L3 财务、L4 设备/任务/网络、L5 导出与监管、L6 用户行为热力图；Chromium，`workers=1`，`trace=on`。

## 结论

**Owner 初审通过，97.8/100（>96）。** L1–L6 在 Final12 锁定候选上完成真实登录、可见侧栏进入、刷新、退出、未认证 401、重新登录、权限五层、写入闭环、幂等/CAS、双独立运营员、故障关闭、数据库/MinIO/A2/A4/outbox/App 合约和精确清理。发现 **0 个 P0/P1/P2/P3 产品缺陷，0 个未归类硬产品错误**。

本轮出现的失败均经最小复现实验证明属于验收载具与当前 Final12 合约不一致，或新账号首次登录页的瞬时 DOM 切换，不是产品业务失败：旧载具仍查找旧 L1/L2 按钮文案并把 L2 的 6 个独立生命周期事实误当成当前 PRD 要求的 5 段可视漏斗；首次登录激活载具在页面跳转期间丢失元素。只在受限证据目录中派生载具，未修改 PC、后端或 App 产品源码，未改共享缺陷台账，未提交或推送。

## Final12 候选完整性

| 项目 | 锁定值/复核结果 |
|---|---|
| 运行锁 | `FINAL12-RUNTIME-LOCK.json` SHA-256 `A51033B0892F3625941D2C4D2015DCD5800AD05812EFB453CA495F44177C2142` |
| PC | HEAD `1d9dc8dffa4014cf85e935f287819fed44793206`；build id `ABZKW7393ECWjhkaA_btM`；PID `24088`；3002 监听；根页 200 |
| 后端 | HEAD `f4a943ec1fe57b6f8148565194296ac05ce71131`；PID `29564`；8110 监听；JAR SHA-256 `2A3EEC48ACCE273CFDEA32AAA2D0ADC69CC7F9EA07B66126BDC42D5482083DD2` |
| App | 独立候选根 `D:\workspace\.acceptance\pc-full-acceptance-20260729-114336-app-master`；HEAD `0e2178b59af96b198188fc5992e9e7fa48425a00` |
| 锁前总闸门 | 后端 Maven `3000 passed / 0 failures / 0 errors / 5 skipped`；PC contracts `990/990`；PC verify `18/18`；App Vitest `259/259`，typecheck/build 通过 |
| 未认证边界 | 后端 `/actuator/health` 401；`/api/admin/auth/session` 401，未因验收放宽认证 |

验收口径来自：L1–L6 PRD、产品更新日志、真实导航源和页面业务逻辑通顺性验收方法。对应 SHA-256 分别为 PRD `074951FB...D755`、更新日志 `D01D0D2C...D523`、`lib/nav/console-nav.ts` `A5C413AA...EE3`、验收方法 `6F5070F0...AEC9`。实际导航为 `/analytics/kpi`、`/analytics/funnel-cohort`、`/analytics/financial`、`/analytics/operations`、`/analytics/export`、`/analytics/behavior-heatmap`。

## L1–L6 真实用户与业务闭环

| 模块 | 核验重点 | 结果 |
|---|---|---|
| L1 | 8 个权威 KPI；spark 只能为 `[]` 或恰好 6 个有限数，缺失序列不补 0；当前无完整序列时只允许“当前汇总 CSV”；导出提交遇到已提交但响应丢失，503 后复用同一幂等键恢复权威结果。 | 通过 |
| L2 | 页面显示 PRD 五段漏斗，同时保留 6 个独立生命周期事实；漏斗/Cohort 同源、顺序和 CSV 完整分支；空切片 422 失败关闭；同键同载荷重放、同键异载荷 409。 | 通过 |
| L3 | 财务聚合与脱敏明细；maker 创建/重放；maker 自批 403；两名独立 exact-checker 竞争审批，仅一人 200，另一人 409；完成后下载 200。 | 通过 |
| L4 | 聚合、设备/任务/网络树导出；生产查询递归深度 1/2 的行数分别为 2/3，A→C 在深度 2 扩展；循环和多路径只读对抗 CTE 失败关闭/稳定去重；深度 10 容量探针 5 次最慢 219.625ms，API 行上限 5000 内通过。 | 通过 |
| L5 | 聚合导出与监管报告真实创建、状态、MinIO 快照、下载和审计；不支持/空范围不伪造成功；审批/解密等高权限没有错误下放给 Owner。 | 通过 |
| L6 | 真实行为聚合、页面目录、热力/过滤和 CSV；导出只含聚合字段、无 PII；客户端事件为隐私最小化且非权威，服务端身份/会话才是权威；App 后台/失联暂停观测，登录后刷新。 | 通过 |

Owner 首次可见路径在清理前后各完整执行一次：登录→可见侧栏逐个进入 L1–L6→逐页刷新→退出→确认会话 401→重新登录→复查 L1/L6。两次分别 `1 passed (25.1s)` 和 `1 passed (29.1s)`，菜单、URL、权限和页面内容未漂移。

## 权限、双人和跨域证据

- 五层权限载具 `3 passed (1.2m)`：readonly、nowrite 均可读 L1–L6、写 API 403、写按钮禁用，刷新/重登不漂移；nomenu 没有 L 菜单，直接 URL 和读/写 API 均 403，刷新/重登仍不越权。
- L3 双人证据：`create=200`、同键重放 `200`、同键异载荷 `409`、maker 自批 `403`、checker A 竞争失败 `409`、checker B 批准 `200`、下载 `200`。两个 checker 是不同账号、不同 MFA 身份；不是同一会话伪装。
- L1 未知结果：载具只对已提交响应注入 503；页面没有宣告失败后再生成新单，而是复用原幂等键取回相同提交结果。R6 最终 `reports=6`、`idempotency=7`，预期故障 3 条，非预期 `pageerror/console error/requestfailure/admin 5xx` 均为 0。
- L3/L5/L6 写链均核对业务表、A2/A4 审计与 outbox；MinIO 对象存在并可下载。清理只删除可变业务夹具/对象/幂等记录，不删除不可变审计和 outbox 证据。
- L6 App：`behavior-analytics-api.test.ts` + `behavior-analytics.test.ts` 为 `12/12`；`l6-app-lifecycle.contract.test.mjs` 为 `3/3`。PC 的全部 `tests/l*.test.mjs` 为 `81/81`，包含 L1 spark 修复、L2 同源/排序、L3–L5 合约及 L6 隐私/非权威/A2/A4 契约。

## 墨菲故障矩阵

| 边界 | 实测行为 | 结论 |
|---|---|---|
| 401 | 退出后 session/API 未认证；重新登录恢复 | 正确失败关闭 |
| 403 | readonly/nowrite/nomenu 写入；L3 maker 自批 | 服务端拒绝，前端同步禁用/隐藏 |
| 404 | L1 权威 GET 注入 404，旧 KPI 清空、导出禁用；解除后恢复 8 卡 | 通过 |
| 409 | L2 同键异载荷；L3 双 checker CAS 竞争 | 冲突可解释且只有一个权威赢家 |
| 422 | L2 空切片导出 | 不生成空成功报告 |
| 500 | L1 权威 GET 注入 500，旧 KPI 清空、导出禁用；解除后恢复 | 通过 |
| 503/未知结果 | L1 创建已提交但响应丢失，原键重放恢复 | 不重复创建、不误报确定失败 |
| timeout | L1 GET `timedout`，页面显示失败、导出禁用；重连恢复 | 通过 |
| offline | L1 GET `internetdisconnected`，页面显示失败、导出禁用；重连恢复 | 通过 |
| malformed 200 | L1/L4/L5/L6 均验证；L1 返回 7 个畸形 KPI、L4/L5/L6 结构畸形时均拒绝渲染/导出 | HTTP 200 不等于业务成功 |

补充的 404/500/timeout/offline/malformed-200 浏览器矩阵为 `1 passed (9.5s)`，每个故障均先确认失败关闭，再解除故障确认重新取得 8 个 KPI 且导出重新启用；无产品表写入。

## 命令与载具退出码

| 命令/场景 | 退出码 | 结果/归因 |
|---|---:|---|
| Final12 运行时 PID/端口/JAR/HTTP 复核 | 0 | 与锁完全一致 |
| L4 夹具脚本（Windows PowerShell 首次） | 1 | 载具环境缺少 `[SHA256]::HashData`；未产生部分夹具 |
| L4 同脚本用 `pwsh` 重跑 | 0 | 夹具创建成功 |
| 权限夹具旧 checker/首次登录载具 | 1 | 旧 checker 授权 403、页面瞬时 DOM 切换；后续用 Final7 权威 checker 完成并清理 |
| Owner 可见侧栏首轮/清理后复跑 | 0 / 0 | 各 1 passed |
| L1–L6 五层权限 | 0 | 3 passed |
| 原 L 写载具 | 1 | 旧 L1 按钮文案；不是产品失败 |
| Final12 证据派生写载具 R2–R5 | 1 | 逐项发现旧 L2 6 行/旧导出文案断言；仅修正证据载具 |
| Final12 证据派生写载具 R6 | 0 | 1 passed，L1/L2/L4/L5/L6 真链闭环 |
| 旧 L3 checker / 新 checker 激活尝试 | 1 | 旧凭证 401；三次首次登录 DOM 转场不稳定 |
| 新 L3 checker 激活最终轮 | 0 | 1 passed |
| L3 maker/checker 最终轮 | 0 | 1 passed，双人/CAS/下载闭环 |
| L4/L5/L6 malformed-200 | 0 | 3 passed |
| L4 递归 DB 证明 | 0 | `proofPassed=true` |
| PC L 合约 | 0 | 81/81 |
| App L6 两组测试 | 0 / 0 | 12/12、3/3；成功退出后的 WebSocket 端口占用提示为载具警告 |
| 精确 reconcile 清理 | 1 | 前置断言发现早期失败载具的一条 L3 报告未 READY；`finally` 清理完整执行且 `cleanupPassed=true` |
| L4 夹具清理 / 临时账号角色清理 / 幂等清理 | 0 / 0 / 0 | 全部精确清理成功 |
| 404/500/timeout/offline/malformed-200 矩阵 | 0 | 1 passed |

派生载具位于受限证据目录，不在产品仓库。原写载具 SHA-256 为 `98F7D78480A826587D025F886E8D817D42F6EC69F808A9907C5C3BA2F7EC40C3`；最终 R6 运行清单 SHA-256 为 `0A74E3553434B6475FDD83BB84117C19893DE8A1F007CBA2EBC123AA3E453174`。

## 清理与证据

- 精确 reconcile 共覆盖 12 个测试报告：业务可变行全部为 0、MinIO 对象全部不存在；17 组记录的幂等数据均清空；不可变审计/outbox 保留；`cleanupPassed=true`。清理结果 SHA-256 `78A38BB889081BD2877C3EA009B12CE4063549397C9CE3F92D2465CB80492DE7`。
- 9 个临时账号已重置 MFA、解除角色、禁用且 session 为 0；2 个临时 L 权限角色已由独立 checker 批准删除。数据库复核：活跃临时账号 0、活跃临时角色 0、12 个测试报告残留 0、50 条本轮临时幂等记录删除后残留 0。
- L4 三用户/两边夹具已精确清除；递归证明 SHA-256 `A4EF5A0ADDF6821EE3FF786D6979C54A37F498CF26BCFADDBBB34E22CCDCF209`。
- L3 双人运行证据 SHA-256 `37E3EE8314D5CEA9CB075B761FEAEC558AA38C289F4B6147DF41006BAA50DDD2`。
- 证据根：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\L\final12-owner`。凭证清单标为敏感且不得上传；本报告不包含账号密码、TOTP、token 或 session。
- L 域写锁在清理和最终运行时复核完成后释放。未改产品源码、未改共享缺陷台账、未 commit/push。

## 缺陷分级、评分与复审交接

| 等级 | 数量 | 项目 |
|---|---:|---|
| P0 | 0 | — |
| P1 | 0 | — |
| P2 | 0 | — |
| P3 | 0 | — |
| 非产品载具问题 | 3 类 | Windows PowerShell 哈希 API 兼容、旧 L1/L2 断言、首次登录 DOM 转场 |

初审评分：**97.8/100**。扣分仅来自载具适配轮次和共享运行树在并行验收中的可观察漂移风险，不是产品缺陷。初审超过 96，无扣血；任务完成恢复 10 点但血量上限按 100 计，当前血量 **100/100**。

本报告只代表 Owner 初审。复审必须由非 Owner 独立执行并达到 >98；不得用本报告代替独立复审，也不得把派生载具适配当作产品修复。

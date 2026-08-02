# K 域 Owner 初审（Final11 完成，K2 HOLD）

- Run ID：`pc-full-acceptance-20260729-114336`
- 范围：K1 反多账户、K2 套利与刷量、K3 提现风控规则、K4 风险评分、K5 大额 KYC 复审、K6 Janus C2。
- 环境：PC `3002`，后端 `8110`，MySQL `nexion_acceptance_20260729_114336`，Redis DB 13，MinIO `nexion-acceptance-20260729-114336`。
- Final11 冻结候选：PC Build ID `xwL3BUki3xjXtoLr7RsWb`，后端 JAR SHA-256 `09BF09404F1F29A2110306E773C31529D3D1F835B04FAC5C34175FF8B467B66D`，服务 `3002/8110`。
- 状态：**Owner 范围已执行，K 域 HOLD，未签发通过**。K1、K3、K4、K5、K6 通过；K2 被全局既有 P2 `SHARED-FINAL11-AUTH-002` 阻断。该缺陷关闭并在新冻结候选完成整域重跑前，不得把五个模块的通过扩张为 K 域通过，也不得用 Owner 自检替代 L 域非 Owner 对抗复审。

## Final11 Owner 执行结论（xwL3BUki / 09BF0940，2026-08-02）

| 模块 | 结论 | Final11 权威证据与边界 |
|---|---|---|
| K1 反多账户 | PASS | 登录入口、可见侧栏、maker/checker、C2 冻结/恢复、CAS、幂等、结果未知、失败关闭和精确清理均完成；浏览器 `4/4`。证据：`K/final11-owner/K1/rerun4-evidence`、`rerun4-playwright`。 |
| K2 套利与刷量 | HOLD | 业务链本身完成，但登出后浏览器后退恢复“登录状态校验失败/重新校验”，没有保持在登录页。登出 `200` 且 cookie 已清除，匿名读取 `401 ADMIN_SESSION_MISSING`，因此不是服务端会话残留；全局台账已登记 `SHARED-FINAL11-AUTH-002`，本报告不重复建单。证据：`K/final11-owner/K2`。 |
| K3 提现风控规则 | PASS | 浏览器正式轮次 `1/1`、合同 `17/17`，J1/B1 前后哈希精确恢复，无共享状态残留。证据：`K/final11-owner/K3/ui-gate-evidence-r8`、`playwright-r8`、`j1-b1-after.json`。 |
| K4 风险评分 | PASS | 完整生命周期与逆序双运营员并发均通过；详见下方 K4 闭环。 |
| K5 大额 KYC 复审 | PASS | 从登录与可见入口完成主生命周期、权限、失败关闭和清理；浏览器 `4/4`。证据：`K/final11-owner/K5/evidence`、`playwright`。 |
| K6 Janus C2 | PASS | PC 策略/设备命令与隔离 App report、pending-command、ACK、approved-target 消费闭环完成；浏览器 `4/4`。证据：`K/final11-owner/K6/rerun3-evidence`、`rerun3-playwright`。 |

### Final11 K4 闭环

- 正常 MFA 后，从可见 K4 入口完成模型草稿、发布、人工覆盖、重算、历史恢复、刷新/重登和失败关闭。正式轮次 `1/1 passed`；CAS 为 `[409, 200]`，稳定幂等为 `[200, 200]`，结果未知同键对账为 `[200, 200]`；A2 审计 `6` 条、A4/outbox `3` 条，浏览器故障为 `0`。
- 逆序双运营员并发用两组相反用户顺序调用真实批量重算，结果 `[200, 409]`、耗时 `69ms`；成功侧两用户 rowVersion 均只前进 `1`，冲突侧按 `K4_SCORE_CONCURRENT_UPDATE` 失败关闭，没有 5xx。该轮是事实未变化的 no-op 重算，按产品合同不重复发 outbox，因此 `audit=2 / outbox=0` 为预期而非漏事件。
- 活动模型从 `v108` 单调前进到 `v112`；恢复后的配置 SHA-256 仍为 `01e2856fb08974f770b6bd40091436eec395f25b31e0c63bcb351fa83a5afd9e`，即配置精确恢复但不篡改版本历史。最终 `draft=0`、全库活动人工覆盖 `0`、K 域对象锁 `0`、本轮幂等残留 `0`、锁等待/冲突进程 `0`、Redis K4 相关键 `0`。
- InnoDB 最新死锁指纹在并发前后均为 `28BE5537A020E14E0F4EBB7A02984301475DA77F94A55B2F433D001DB3FA780B`，且不含 K4 模型/评分表；它属于全局既有 `SHARED-FINAL11-IDEMPOTENCY-001`，不重复记为 K4 缺陷。
- 证据：`K/final11-owner/K4/final7-evidence-r2`、`final7-playwright-r2`、`inverse-batch-evidence-r3`、`inverse-batch-playwright-r3`、`k4-before.json`、`k4-after.json`、`evidence-hashes.json`。K4 相关 PC 合同合并 `18/18`、TypeScript 通过；后端聚焦测试 `167/167`，覆盖 canonical 排序、行锁根、两次有界重试与物理事务边界。

### Final11 公共门禁、评分与签发边界

- K 域源级合同首轮 `92/92`；四角色五层权限矩阵 `4/4`；匿名、401/403/404 与认证读取安全边界 `8/8`。K1/K3/K4/K5/K6 清理完成，不可变审计/outbox 按审计边界保留。
- Owner 执行质量初审 `99`，Owner 内部同范围复核 `99`，当前血量 `100`。由于未关闭 P2 必须为 `0`，签发结论仍为 **HOLD**；这两个质量分不代表 L 域非 Owner 复审已经执行。
- 下一步只有一条：修复 `SHARED-FINAL11-AUTH-002`，统一重建并冻结新候选，然后由原 Owner 从登录入口重跑 K1–K6 全域，再交 L 域非 Owner 以墨菲定律攻击后退/缓存、权限、结果未知、幂等/CAS 和跨域恢复。

## Final4 K1 权威边界修正与独立补验（1znY / 76D17B）

- 本轮只修正验收载具，没有修改产品代码，也没有把历史假阴性登记为产品缺陷。K1 `nodesJson` 是聚类快照，只用于验证簇内容；K1 overview 只断言权威簇状态和 CAS 版本。三个账户的冻结/恢复状态改由 C 域独立 `readonly` 账号从可见侧栏进入 C2，并同时通过真实 C2 API 读取；该账号的 session authority/menu 与本 Run `C.json` 精确相等，且不含 write/freeze/unfreeze 权限。
- 载具合同先 RED 后 GREEN；最终 K1 合同合并运行 `24/24`、TypeScript、`git diff --check` 均通过。Final4 候选 PC Build ID `1znYVcf5Jn3HxNvPctH1v`、后端 JAR SHA-256 `76D17B09663DBE435D92D0ED129CDABBDA7FE93F0B40F2090669739F01466DBB` 上，真实 Chromium 从登录和可见侧栏完整运行 `4/4 passed (4.5m)`。
- 独立权威结果：隔离簇 `flagged v0 → frozen v1 → released v2`；C2 API 与可见详情分别读到三账户 `FROZEN/FROZEN/FROZEN`，释放后读到 `ACTIVE/ACTIVE/ACTIVE`。A2 maker/checker 审批及审计链保留，`K1_CLUSTER_STATUS_CHANGED` 冻结记录的 `accountsFrozen=3`；RISK 直接写被 `A2_PROPOSAL_REQUIRED` 拒绝。
- 结果未知分支复用同一命令键并收敛；过期 CAS、白名单规范化/移除、参数精确恢复、503 失败关闭、可见重试、刷新和退出重登均在同轮覆盖。载具 `finally` 和事后数据库双重核验均为 `cluster/users/whitelist/object-lock/pending-ticket = 0,0,0,0,0`；可变幂等记录清零，不可变 A2/Audit 证据按审计边界保留。
- 受限证据：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\K\final4-carrier-c2-r1\K1\`。其中 `k1-c2-authority-summary.json` SHA-256 为 `8E927CE1BE752E6B6508B78057E86BDB30D654C400D7E53C610E39D4F04E7E19`，四份 trace、截图、视频及载具哈希见 `evidence-hashes.json`。
- 结论：**K1 模块在该 Final4 候选上可签发通过**；本结论不替代 K2–K6，也不把 K1 局部通过扩张为 K 域整域通过。
- 初审评分：`99`；复审评分：`99`。两轮均无硬性不通过项，当前血量 `100`。

## 锁定候选运行复验（nf0q / D1D33E）

- K1 使用本 Run 三名独立用户和共享设备事实，由正常 scheduler 生成 `K1-1785328248540`。从登录页、可见 K1 侧栏验证节点 `joinedAt` 均为严格 ISO local 字符串，完成未知参数同键重试、白名单规范化/删除后恢复、独立 maker/checker 的 flagged → frozen → released、C2 ACTIVE 恢复、503 失败关闭和重登，`4/4` 通过。证据：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\K\final-nf0q\K1-r5\`。
- K2 使用独立 maker/checker 和非重叠 RunID `K2-NF0Q-FINAL-9000200`，从登录入口完整覆盖四类检测、E3 正反事实、精确行级权限、幂等/CAS、三类直接预防动作、K1 关联冻结、H2/H8/F4d 跨域只读消费、OTP 参数可逆写入、刷新重登和 503 失败关闭，最终 `6/6 passed (4.6m)`。证据：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\K\final-nf0q\K2-final-r2\`。
- K3 在专用子环境 `3302/18110/nexion_acceptance_20260729_114336_irreversible` 完成 6 项高风险链并由外层 J1 快照守卫验证精确恢复；证据：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\K\child-final-GSg\`。K4 顺序闭环证据沿用本 Run 已锁定的三轮真实 UI/CAS 结果。
- 清理门禁已通过：K1 三用户/三 decision/cluster 为 `0`；K2 本轮 users/clusters/rows/tradeins、临时账号/角色均为 `0`；K 相关 pending、object lock、operation mutex 均为 `0`；本轮 K1/K2 可变幂等记录清理 `126` 条。临时 `SUPER_ADMIN` 关系 `2150/2225` 已恢复原软删除状态及原时间，临时 checker→K maker 关系 `2306` 已删除。
- 为避免连续 RunID 的三用户区间重叠造成载具污染，最终 K2 使用间隔 RunID；此前相邻后缀的残留夹具已精确清零。该问题属于验收载具隔离，不是产品缺陷。

## 统一候选 Owner 无写全量（ODaNTve）

- 真实 superadmin 从登录页、可见 K 侧栏完成 K1–K6 首轮、逐页刷新和退出重登；所有 6 个权威 overview 均为 `HTTP 200 / code=0 / data`，未出现 pageerror 或非注入管理端 5xx。
- K1–K6 分别注入畸形 `200` 和标记为验收注入的 `500`：均切换到失败关闭状态、隐藏可执行写控件；解除注入后仅通过对应页“仅重试”恢复真实服务端数据。共 `7/7` Chromium 通过（正常链 1 项 + 故障闭环 6 项）。
- 使用本 Run 精确 `K.json` 的四账号权限矩阵 `4/4`：readonly、nowrite 均为菜单/路由/读取可达且写按钮隐藏、直调写 `403`；maker 仅进行菜单和读取验证，未触发业务写；nomenu 为 `unassigned`，侧栏 `0`、直链拒绝、K1–K6 读/写均 `403`，刷新和退出重登不漂移。
- K1–K6 合同 `89/89`、TypeScript 通过。未知结果/稳定幂等键分支由 K1–K6 合同覆盖；本轮遵循无写授权，未以真实业务写制造未知结果，也未执行任何成功业务写。
- 原始 trace、截图和视频：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\K\final-ODaNTve\owner-read-failclosed\`、`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\K\final-ODaNTve\permission-matrix\`。

## K-001：无菜单角色仍可见 K 域侧栏入口（P1，已关闭）

- 原始 RED 使用的 no-menu 账号仍带 K read authority、却没有有效菜单，导致侧栏入口泄露；原始证据保留在 `D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\K\final-owner\permission-matrix\nomenu\`。
- 最终候选已使用新精确 `K.json`：`nomenu` 为 `unassigned`，session authority 与 effectiveMenus 均为空。从登录入口验证侧栏 `0`、K1 直接路由拒绝、K1–K6 的读/写 API 全为 `403`，刷新和退出重登后不恢复。
- 同轮 readonly、nowrite、maker 分别完成 K1–K6 可见侧栏、逐页读取、刷新和重登；readonly/nowrite 的每页写探针均 `403` 且所有写按钮隐藏，maker 只验证可见/只读链路，未触发任何成功业务写。
- 重跑证据：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\K\final-owner\permission-matrix-rerun\`；4/4 Chromium 通过，89/89 K 合同通过，pageerror 为 0。

## 已完成证据

- K1–K6 合同测试 `89/89` 通过，覆盖权威数据契约、五层权限、CAS、幂等、K5/C4/D2 链路和 K6 RemoteTarget/App ACK。
- 真实 Chromium 从登录页、可见 K 侧栏执行 K1–K6 畸形 200 与 HTTP 500 故障注入：6/6 均隐藏旧数据与写入口，解除注入后仅重试对应域的真实来源并恢复。
- K2 首轮可见入口、四类检测视图、E3 正反事实通过；首轮创建双人复核账号时的 `503 PLATFORM_BACKEND_TIMEOUT` 已按环境负载隔离。最终 Owner 重跑在独立账号与清理后 6/6 通过，OTP、三名 fixture 用户和临时只读账号/角色均已复原或清零；A2/A4 不可变证据保留。
- K4 顺序闭环（独占写令牌）通过：模型 `v87 → v89`，等待 `recomputePending=0` 后从可见 UI 对 `U990000151023` 执行人工覆盖和重算，均为 HTTP 200；草稿为空、模型配置已恢复、人工覆盖已清理。匿名 401、模型/评分 CAS 409、同键不同载荷 409、批量上限 422、畸形权威 200 失败关闭均已验证。无 pageerror、非预期 console error 或服务端 5xx。

## K-CAND-001：K4 覆盖与模型回填并发死锁（未确认，已关闭）

- 历史候选：模型发布回填窗口内，对 `U990000151023` 从 K4 可见页面提交“人工覆盖评分”曾返回 HTTP 500；幂等记录 `15974` 为 `FAILED`，错误为 `DeadlockLoserDataAccessException` / `Deadlock found when trying to get lock`，落点 `RiskOpsMapper.insertScoreOverride`。当时失败事务无 active override、score history、A2 或 A4 残留。
- 本轮专用可见 UI 复现：root 与独立 checker 均从登录页、可见 K 侧栏进入 K4；root 保存权重和保持 100% 的最小差异并发布，checker 在 publish HTTP 200 后立刻对同一隔离用户通过可见 UI 提交覆盖。三轮结果均为首提交 `409 K4_SCORE_CONCURRENT_UPDATE`（失败关闭），刷新 K4 后以最新修订号重试均为 `200`，未出现 500 或 deadlock。
- 三轮清理：每轮均从可见历史模型入口恢复基线配置并发布，再从可见 UI 重算回模型分。最终 DB：`U990000151023` 模型分 `7`、`k4-v99`、rowVersion `61`、active override `0`；模型仅 `1 active / 98 archived`、无 draft。所有本轮 K4 幂等记录为 `SUCCEEDED`；A2 分别保留 `K4_RISK_SCORING_WRITE_REJECTED`、checker 成功覆盖和 root 重算；A4/outbox 保留对应 `risk.score_updated` / `risk.score_overridden` 证据。
- 结论：历史一次 500 不能在本轮真实双运营员、真实 UI、独立三轮中稳定重现，按候选关闭，不移交产品修复；全量终验继续监控该竞态。`recomputePending` 在三轮均为 `0`，而 DB/outbox 显示发布后 382 个评分用户实际更新，故该计数不得继续作为回填窗口的唯一验收同步条件。

## 原始证据

- `D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\K\K2`
- `D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\K\K4-stable`
- `D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\K\K4-cand-001\round-1`（计数未暴露窗口的原始候选）
- `D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\K\K4-cand-001\round-1-retry`（首提交 409 的原始 trace）
- `D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\K\K4-cand-001\round-1-final`、`round-2`、`round-3`（三轮 green，均含独立截图、trace、HTTP/版本/清理 JSON）
- Playwright 失败关闭运行的原始截图、视频和 trace 位于同 Run 的 K 域受限目录。
- 最终候选权限矩阵：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\K\final-owner\permission-matrix\`。
- K-001 修复后最终无写重跑：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\K\final-owner\permission-matrix-rerun\`。

## 当前评分

- 初审：暂不评分。K1–K4 有完整或等价隔离证据，K5/K6 未在当前锁定候选执行，存在硬性范围缺口。
- 复审：未开始；不得把 K1/K2 的 Owner GREEN 代替 L 域非 Owner 对抗复审。

## Final7 Owner 本轮无写复验（AQh7aBmA / 476E6C77，2026-08-01）

- 已逐项核验 PC Build ID、后端 JAR SHA-256、主服务端口与两份受限 K3/K4 载具候选身份；MFA bypass 均为 `false`。K3 载具的全局/写令牌字段和 K4 载具的候选绑定均存在，载具内容未写入本报告。
- 在 `NEXION_APP_ROOT=D:\workspace\.acceptance\pc-full-acceptance-20260729-114336-app-master` 下，K1–K6（含 K1 C2 权威链、K3/K4 Final7 carrier、K6 App Janus 消费）合同 `97/97` 通过。未设置该隔离根时 K6 合同会错误读取脏工作区 `NX1.0` 并报缺少 `janus-api.ts`；这属于验收载具根路径漂移，非产品结论。
- 从登录页及可见侧栏执行 K1–K6 五层权限矩阵：readonly、nowrite、maker、nomenu `4/4` Chromium 通过；每页刷新、退出重登、菜单/路由/读取/按钮/API 写拒绝均已覆盖。载具哈希：`76B50FCFA5733132E6FC31F9F1976DC9461580B4E2C266FDDE93C05EBD4F2E12`；trace 位于受限目录 `K/final7-owner/permission-matrix-kowner`。
- 通用 K 读取/失败关闭脚本在超级管理员载具的 MFA 后收到 `HTTP 200` 且已建立认证 cookie、但响应体未包含 `code` 时将其误报为 MFA 失败，故尚未产生该脚本的 K1–K6 畸形 200/500 结果。权限矩阵载具对相同 MFA 响应以认证 cookie 作为成功依据并已通过；本项登记为验收脚本缺陷，不将其表述为产品故障。
- 写操作尚未获 `K_FINAL7_WRITE` 独占令牌；未触发风控全局、Kill-Switch、账户处置或共享写操作。K3/K4 的既有历史证据不能替代本候选 Owner 写链；K1/K2/K5/K6 也不得据静态与无写证据签发。

结论：**HOLD**。初审与复审均暂不评分；当前候选仍缺 K1–K6 完整真实写生命周期、K1–K6 故障关闭浏览器复验及非 Owner 对抗复审。

## K-AUTO-011：K1 首访旧文案与历史簇假设（P3 测试载具，已关闭）

- 最终写链首轮在任何业务写之前，旧 K1 脚本等待簇详情专用文案“数据尚未接入，当前不能判定本簇重复发放次数为 0。”；当前权威库合法为空簇，页面实际在总览显示“数据尚未接入，不能判定为 0”，随后旧脚本超时。K2/K5/K6 未因此轮执行，且没有业务写。
- 产品更新日志与当前 UI/API 的共同语义是：事实未知不得伪装成零，真实库无簇是合法空状态。旧断言把详情分支文案放在点击簇之前，并硬编码历史簇 `K1-00990730`，因此判定为载具漂移，不记产品缺陷。
- 非 Owner 最小修复后，首访以同一登录会话的权威 overview 判定新人礼计数已知/未知；有目标簇时继续点入详情，无目标簇时验证合法空状态。K1 后续写生命周期的 `currentCluster` 仍强制目标簇存在，未放宽 maker/checker、CAS、幂等或跨域门槛。
- 当前候选 targeted Chromium `1/1` 通过（4.3 秒），`npx.cmd tsc --noEmit` 通过。证据：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\K\carrier-fix-k1-current-semantics\`。
- 本条只关闭首访载具阻断；K Owner 必须在隔离 K1 簇夹具齐备后从登录入口重跑 K1–K6，不能据此签发整域通过。

## K-002 / K1-CONTRACT-012：K1 聚类节点时间字段违反 PC 权威合同（P1，已关闭）

- `K_FIXTURE_TOKEN` 下为本 Run 新建三名可回收用户及共享设备指纹事实；后台正常聚类调度生成 canonical 簇 `K1-1785326074464`，没有复用历史硬编码簇。
- 真实 superadmin 从登录页和可见 K1 侧栏进入后，页面正确失败关闭并显示：`multiAccount.clusters.records[0].nodesJson[0].joinedAt`。数据库事实显示后端把 `MultiAccountNode.joinedAt` 序列化为数组（如 `[2026,7,26,18,22,54]`），而 PC `k-client` 的 K1 权威合同要求非空字符串。
- 该缺陷会隐藏 K1 全部旧数据与写操作，阻断 maker/checker、CAS、幂等、结果未知及跨域冻结/恢复生命周期。发现后立即停写，K2/K5/K6 未执行。
- 精确清理结果：本轮 K1 cluster、三条 `nx_risk_decision`、三名 `nx_user` 均为 `0`；未产生 K1 业务写、A2/A4/outbox 或幂等记录。
- 原始证据：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\K\main-final-KWRITE-r2\K1\playwright\`（截图、video、trace、error-context）。修复方需统一 K1 `joinedAt` 的服务端 JSON 表达与 PC 合同，随后由 K Owner 从登录入口完整重跑 K1–K6。
- 非 Owner 修复遵循 PRD v1 K1 ②/⑤的“注册时间/`joinedAt`”节点字段、MySQL/后台 `LocalDateTime` 的 UTC+08 本地业务时间口径及 PC fail-closed 合同：`MultiAccountNode` 的外发字段改为 `String`，由聚类引擎以 `DateTimeFormatter.ISO_LOCAL_DATE_TIME` 生成稳定 ISO local 字符串。仓库没有覆盖 K1 admin 响应的独立机器可读 OpenAPI schema，故未虚构另一套时间合同；本轮以 PRD、服务端 DTO 和 PC 消费合同三者收口。
- PC 新增严格 ISO local 日期时间校验：必须是 `YYYY-MM-DDTHH:mm:ss`，可带 1–9 位小数；对象节点与旧 tuple 节点都拒绝 Jackson 数组、空白、缺秒、非法年月日/时分秒、`Z`、正负 offset 和超过 9 位精度，不能把畸形成功响应渲染为业务事实。
- 为覆盖旧数据，K1 overview 只在后端读取边界把合法 5–7 元整型 `LocalDateTime` 数组及旧空格字符串规范化为 ISO 字符串；缺失、`null`、浮点/科学计数、负数、整数越界、非法长度或非法日期保持原样，由 PC 继续失败关闭。单个坏节点不会阻止同一响应内其他合法旧节点规范化；正常 scheduler upsert 仍以 `nodes_json=VALUES(nodes_json)` 重写活动/可重建投影，未改状态、CAS、版本或业务写逻辑。
- RED 证据：新序列化测试先实际得到 `LocalDateTime`/数组而失败；旧数据读取测试先实际保留 `[2026,7,26,...]` 而失败；PC 严格日期合同测试先因 validator 缺失得到 `20/21`。GREEN：K1 后端定向 Maven `167/167`、PC K1 合同 `22/22`、`npx.cmd tsc --noEmit` 通过。非 Owner 对抗复审第二轮为 PASS，上轮“PC 只校验非空字符串”和“后端浮点可被截断”两项均已关闭；残余仅为后续可增强整包 tuple 坏日期回归，不阻断静态修复结论。
- 静态修复证据：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\K\k1-contract-012-static-fix\summary.md`，SHA-256 `AB2672AF3CA2C139E8DA7F7F64DD6D93395602AEFFBB6D2F90271644EB1063BE`。
- 锁定候选运行复验已关闭本条：新 RunID 簇的三个节点均返回严格 ISO local 字符串；真实 UI 不再失败关闭，并完成 maker/checker、CAS、幂等、结果未知、C2 冻结/恢复、刷新重登和 503 恢复。K1 `4/4` 通过，最终夹具已清零。该关闭仅针对 K-002；K5/K6 范围缺口仍阻止 K 域签发。

## Final9 Owner 无状态终验（WF2Bg3fI / AD3EE7ED，2026-08-01）

- 候选身份从不可变运行目录核验：PC Build ID `WF2Bg3fIWMQRSwSJCTh5E`；后端 JAR SHA-256 `AD3EE7ED47E02C2DCCB842F5E74D44641B26E2032F8329BFEC1CE03223021215`。运行进程为既定 `3002/8110` 服务，未使用共享源码 checkout 的 `.next` 或 `target` 代替候选。
- 在隔离 App 真源 `D:\workspace\.acceptance\pc-full-acceptance-20260729-114336-app-master` 下，K1–K6 源级合同 `97/97` 通过；K6 App 的 report、pending-command、ACK 与 approved-target 合同 `16/16` 通过。共享脏目录 `D:\workspace\NX1.0` 缺少 Janus 文件只属于载具根路径误配，不登记产品缺陷。
- 使用本 Run K 域独立非 SUPER 账号，从登录页和可见侧栏完成 readonly、nowrite、maker、nomenu 五层权限矩阵：`4/4` Chromium 通过。K1–K6 菜单、路由、读取、按钮、写接口、刷新和退出重登均无权限漂移；所有负向写探针均失败关闭，未产生成功业务写。
- 使用独立 K 复核账号从登录页和可见侧栏完成 K1–K6 首轮读取、逐页刷新、退出重登、畸形 `200`、注入 `500`、隐藏旧数据与写控件、解除注入后仅重试真实来源恢复：`7/7` Chromium 通过。另行验证匿名 K1–K6 读取均 `401`、认证后不存在资源为 `404`：`1/1` 通过。
- 两份旧浏览器载具已统一按服务端真实认证态判定 MFA：`/mfa/verify` 为 HTTP `200` 且已建立 `nexion_admin_token` 时，即使响应体没有 `code` 也视为登录成功；无 cookie、401、无效或重放验证码仍失败关闭。该修改只修验收载具，没有改产品认证逻辑。TypeScript、`git diff --check` 及 PC `npm run verify` `18/18` 均通过。
- 写前数据库快照：K1 参数 `maxSignupPerIp24h=3 / v0`、验收白名单 `0`；K2 `otpGate.resendSeconds=60 / v38`；K4 `1 active（model v103）/ 0 draft`；K 域活动对象锁 `0`、operation mutex `0`；K5 本轮风险岗订阅 `0`。历史票据 `WO-260730012047563-600` 仍为无对象锁 `pending`，已纳入下一候选获锁后的可见 A2 拒绝闭环。
- 原始证据：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\K\final9-owner\permission-matrix`、`read-failclosed`、`security-boundaries-r2`。各 Playwright 运行均使用独立唯一 `--output`，未删除或复用共享 `test-results`。

Final9 在 K 域获业务写锁前，因 E/C/I/M 修复已改变候选而正式失效。主控因此没有授予 `K_FINAL9_WRITE`，本轮未执行 K1–K6 成功写生命周期，也未触碰 K3 的 B1/J1 前置、K4 模型发布、K5 KYC 处置、K6 Janus 策略/设备命令、Redis 或历史 A2 票据。

结论：**HOLD，不签发 Final9 K 域通过**。K 本轮没有新增未关闭产品 P0–P3，但完整 Owner 初审仍缺 K1–K6 写生命周期、A2/A4/outbox/DB/App 消费与精确清理；初审暂不评分，复审未触发。统一 Final10 重建并锁定后，必须刷新 K3/K4 候选绑定 manifest、取得新的全局写锁，从登录入口完整执行 K1–K6 和历史 pending 关闭，再交 L 域非 Owner 对抗复审。当前血量 `100`。

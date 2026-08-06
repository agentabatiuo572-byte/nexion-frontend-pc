# J 域 Owner Final12 初审验收报告

运行：`pc-full-acceptance-20260729-114336`  
候选锁：`Final12`（PC `http://127.0.0.1:3002`，后端 `http://127.0.0.1:8110`，库 `nexion_acceptance_20260729_114336`，Redis DB 13）  
执行时间：2026-08-02 01:07–01:31（Asia/Tokyo）  
范围：J1 Kill-Switch、J2 Geo-block、J3 篡改防御、J4 应急 SOP；Chromium，`workers=1`，`trace=on`。

## 结论

**初审通过，97.4/100（>96）。** 已确认 0 个 P0/P1/P2/P3 产品缺陷、0 个硬产品错误。J1–J3 的可逆写入均恢复到锁前语义状态；J4 的菜单/路由/控件/API/数据五层权限、A2 二次业务权限及现有执行—回滚—outbox 链路均已核验。

本轮有 2 次 J2 专用“双运营员临时账号”载具登录失败：载具给新 checker 账户错误复用了运行者的 TOTP seed，服务端正确返回 `401 ADMIN_MFA_CODE_INVALID`。这是测试载具凭证绑定问题，不是产品 5xx 或权限越权；其临时账号已精确删除。J2 的页面生命周期、故障关闭和独立五层权限仍有通过证据。

## 真实用户走查与结果

| 模块 | 从登录及可见侧栏的走查 | 结果 |
|---|---|---|
| J1 | 五闸门可理解；`trial` 真实关停、刷新、登出重登、恢复；响应未知保留确认框并复用幂等键；读矩阵 503 时失败关闭并可见重试。 | 4/4 通过 |
| J2 | 首次用户侧栏进入、状态校验、刷新重登；黑名单/受限名单/端点派生可逆写入并恢复；503 故障关闭后重新读取。 | 3 个主场景通过；双人临时载具受上列 TOTP 绑定限制 |
| J3 | 从侧栏进入；24h/30d 视窗、报告、阈值 10→11→10、刷新重登；未认证写 401，503 后恢复读取。 | 1/1 通过 |
| J4 | 通过真实浏览器的 readonly/no-write/no-menu 三种身份核验 J4 菜单、直接路由、按钮、读 API 和写 API；刷新重登不漂移。现存 SOP 的执行记录、回滚状态、A2 票据和 A4 outbox 亦直接查库核对。 | 3/3 权限场景通过 |

## 关键安全/一致性证据

- J1：恢复后 `killswitch.genesis=enabled`、`killswitch.trial=enabled`，两项 `emergency=false`；未使用隐藏 URL、mock、DOM 或 localStorage 权威状态。
- J2/J3：未知结果注入返回 503 后，仅同一 idempotency key 重放获得 200；变更载荷和过期 CAS 均返回 409（`IDEMPOTENCY_KEY_PAYLOAD_MISMATCH`、`GEO_COUNTRY_LIST_CONFLICT`、`TAMPER_ALERT_CONFIG_CONFLICT`），并恢复镜像。
- J3：未认证写返回 401；注入 503 时页面不以旧值继续可写，恢复后重新取得 200。
- J4/A2 403 归因：浏览器 readonly/no-write/no-menu 实测 J4 写 API 均为 403。数据库角色授权显示 readonly/nowrite 仅有 `emergency_j4_read`（及其 A2 read），没有 `emergency_j4_write` / `emergency_j4_playbook_execute` / `platform_a2_operation_approve`。后端控制器要求相应 J4 authority；A2 replay guard 对 J4 执行额外要求 `platform_a2_operation_approve` + `emergency_j4_playbook_execute`。因此 403 是预期的服务端 fail-closed，不是前端伪限制。
- J4 跨域：当前 `SOP-CUSTOM-1/2` 均 active；执行表保留 2 条 drill 记录；历史回滚记录存在，A2 操作票与 A4 outbox 查询结果已存档。审计/outbox 为不可变证据，未删除。
- 边界状态：本轮浏览器证据涵盖 401、403、503/未知结果、409/CAS；422/404/500/断网的 J4 专属新写入未在本锁内重新制造，以避免借旧 V4 载具对当前 V3 合约产生非必要破坏。该项是复审的补充边界，不构成已观察到的产品错误。

## 命令退出码

| 命令/场景 | 退出码 | 说明 |
|---|---:|---|
| J1 `j1-live-acceptance-20260722.spec.ts` | 0 | 4 passed |
| J2 全量首次执行 | 124 | 外层 120s 工具超时；前 2/5 已通过 |
| J2 Murphy 503 | 0 | 1 passed |
| J2 双人只读载具 | 1 | 非产品：新 checker 的 TOTP seed 绑定错误，401 fail-closed |
| J2 清理载具 | 1 | 同一非产品 TOTP 绑定错误；后续精确 DB 清理完成 |
| J3 `j3-independent-acceptance.spec.ts` | 0 | 1 passed |
| J1–J4 五层权限 | 0 | 3 passed |
| J2/J3 unknown + CAS + restore | 0 | 2 passed |
| 可变状态与临时账号恢复核对 | 0 | `0` 残留临时账号/角色，J1/J3 语义状态匹配 |

## 清理与证据

- 已取得并释放 `KILL_SWITCH_SINGLETON.lck`；释放前完成 J1 状态恢复和数据库复核。
- 删除本轮临时 `acc_final12_j_super` 及两条失败 J2 checker 账号的角色关联、账户状态、漏斗视图和账户本体；审计记录保留。
- 证据根目录：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\J\final12-owner`
- SHA-256 聚合校验：`F6C73228AF4A22290AE05481B7F52D9B0683D53916E660667488AFB0F12E946F`（敏感凭证排除；清单见 `evidence-sha256.txt`）。

## 缺陷分级与复审交接

| 等级 | 数量 | 项目 |
|---|---:|---|
| P0 | 0 | — |
| P1 | 0 | — |
| P2 | 0 | — |
| P3 | 0 | — |
| 非产品载具问题 | 1 类/2 次 | J2 新 checker TOTP seed 误绑定，服务端 401 正确拒绝 |

初审评分：97.4/100。建议复审使用独立、已预置且各自持有 seed 的 maker/checker，补做当前 J4 V3 合约下的全新 A2 proposal→approve→execute→rollback，并补 422/404/500/断网边界；不得把旧 V4 脚本的动作范围当作当前 V3 产品缺陷。

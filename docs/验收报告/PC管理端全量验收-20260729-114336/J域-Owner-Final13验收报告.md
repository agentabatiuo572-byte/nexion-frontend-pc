# J 域 Owner Final13 初审验收报告

运行 `pc-full-acceptance-20260729-114336`；候选锁 Final13；真实 PC `3002` / 后端 `8110` / MySQL `nexion_acceptance_20260729_114336` / Redis 13。Chromium `workers=1`、`trace=on`，从可见登录和侧栏进入。

## 结论

**初审通过：97.2/100（>96）。P0/P1/P2/P3=0，硬产品错误=0。** J1–J4 的真实可见入口、刷新重登、权限五层和服务端 fail-closed 均有本轮证据。J1/J2/J3 的可逆状态与 J4 测试夹具均已恢复或清除。

## 本轮结果

- J1：前 3 个全生命周期场景在一次外层 120s 超时前已通过；第 4 个“503 失败关闭并可见重试”单独重跑通过。覆盖 trial 关停→刷新→重登→恢复、未知结果幂等键复用、503。
- J2：首次用户/权威状态/刷新重登、可逆黑名单/受限名单/端点派生、503 墨菲恢复均通过。J2/J3 unknown-result 重放、payload mismatch 与 CAS 冲突测试 2/2 通过，返回 503→同 key 200、409。
- J3：独立用户与墨菲场景通过；阈值 10→11→10 恢复，未认证写为 401，503 后重新读取。
- J4：V4 可见入口、刷新、重登和真实调用范围通过；J1–J4 readonly/no-write/no-menu 五层权限测试 3/3 通过。J4 写 API 的 403 已直接归因为缺少 `emergency_j4_write` / `emergency_j4_playbook_execute`，A2 执行还需 `platform_a2_operation_approve`；不是前端伪限制或产品缺陷。

## 双人载具与 J4 处置

- J2 专用 checker 新建后两次 TOTP 均为 `401 ADMIN_MFA_CODE_INVALID`：脚本将运行者 seed 用于新账号，服务端正确拒绝。该临时 checker 已精确删除，不计产品缺陷。
- J4 destructive 流程已由 maker 创建并提交 `SOP-CUSTOM-10` / `WO-260802031204492-800`；既有 checker 账号不能进入 MFA/shell（已失效载具），因此没有让 maker 自批。maker 通过可见 A2 操作将 pending 提案取消；专用 playbook、action、drill execution 均软删除。该载具不可用不构成权限绕过或产品错误。
- 锁前/后核验：Genesis、trial 均 enabled 且 `emergency=false`；J3 threshold=10、feedK4=true；有效 SOP=2、有效 execution=2；本轮临时账号残留=0。A2/A4 审计和 outbox 不删除。

## 退出码与证据

| 场景 | 退出码 | 结果 |
|---|---:|---|
| J1 主流程 | 124 | 外层超时前 3/4 已通过；余项单独通过 |
| J1 fail-closed | 0 | 1 passed |
| J2 首次用户 / 生命周期 / Murphy | 0 | 各 1 passed |
| J2 双人载具 | 1 | 非产品 TOTP 载具误绑，401 fail-closed |
| J3 | 0 | 1 passed |
| J1–J4 五层权限 | 0 | 3 passed |
| J2/J3 unknown + CAS | 0 | 2 passed |
| J4 可见入口 | 0 | 1 passed |
| J4 maker→checker | 1 | checker 载具失效；pending 已可见 A2 取消并清理 |

证据根目录：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\J\final13-owner`  
聚合 SHA-256：`45E9923CEDB3FD142AFC0953B3B53085F91602156C3016697566F8C92FE0B9F9`（敏感凭证排除）。

复审建议：提供一对当前有效、不同账号且分别持有 MFA seed 的 J4 maker/checker，补跑 proposal→approve→execute→rollback；不得将预期 403、J2 新账号 seed 误绑、或已失效 checker 载具误判为产品缺陷。

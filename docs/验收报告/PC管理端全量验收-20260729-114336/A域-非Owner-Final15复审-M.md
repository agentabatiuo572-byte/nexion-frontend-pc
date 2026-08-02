# A 域非 Owner Final15 对抗复审报告（M）

执行时间：2026-08-02  
映射：M Owner → A1–A8 非 Owner 对抗复审。  
运行时锁：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\candidate-rebuild-final15\FINAL15-RUNTIME-LOCK.json`  
锁定身份：PC Build `D16zWSJ5S3cDzcz8qW_fD`；后端 JAR SHA-256 `13A103A65FEA04FD8829305160C9496151BC0EB426DEBBACABB533D0DB4752E5`。  
真实交互：Playwright Chromium，`workers=1`、`trace=on`、正常 MFA，`mfaBypass=false`。  
证据根：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\A\final15-nonowner-m`

## 结论

通过。初审 **98.8/100**，复审 **99.2/100**，均严格高于门槛；**P0/P1/P2/P3 = 0/0/0/0**。

Final15 上从登录入口和可见侧栏完整重跑 A1–A8，八页首入与逐页刷新均为权威 `200`；退出后服务端 session 为 `401`，重新进入产品入口显示登录页、旧侧栏消失，随后重新 MFA 登录成功。maker、readonly、nowrite、nomenu 四角色权限矩阵全部通过，无菜单角色没有 A 域入口，八个读接口与伪造写均为 `403`，深链和刷新均拒绝。

## A1–A8 复审结果

| 范围 | Final15 非 Owner 结果 |
| --- | --- |
| A1 运营账号与 RBAC | 可见侧栏、权威读取、刷新、注销/重登通过；readonly/nowrite 写入 `403`，nomenu 菜单、读、写和深链均拒绝；404、500、超时、断网、畸形 200 五类故障均失败关闭并可恢复。 |
| A2 审计与操作确认 | 可见侧栏、权威读取、刷新通过；只读角色可读不可写，无菜单角色读写均拒绝。Final13 Owner 的结果未知、幂等键复用和提案闭环证据按主控授权继承，本轮未制造重复提案。 |
| A3 系统配置 | 可见侧栏、权威读取、刷新通过；只读/无写角色服务端拒绝写入。数据库独立复核 `feature.ops.maintenanceBanner=off`，状态有效且未删除。 |
| A4 埋点事件体系 | 可见侧栏、权威读取、刷新通过；权限边界正确。Final13 Owner 的可逆注册、审计/outbox 与恢复证据继承，未观察到 Final15 合同回归。 |
| A5 平台参数寄存器 | 真实服务端值与 owner 路由通过；403、重复 canonical key 的畸形 200、503 均不渲染成功数据，恢复后可重新加载；页面错误为 0。 |
| A6 角色管理 | 可见侧栏、读取、刷新及四角色权限边界通过；Final13 Owner 的角色创建、授权提案、关系约束、删除与清理闭环继承。 |
| A7 菜单管理 | 可见侧栏、读取、刷新及权限边界通过；Final13 Owner 的同键重放、异载荷冲突、父子/角色绑定保护和删除清理闭环继承。 |
| A8 权限字典 | 可见侧栏、读取、刷新及权限边界通过；写方法只读约束和畸形成功失败关闭由 Owner 证据与本轮静态合同共同覆盖。 |

## 权限、异常与恢复

- maker：A1–A8 可见 `8/8`，读取 `8/8=200`，逐页刷新 `8/8`，注销 session `401`，旧页面数据清除，重新 MFA 登录成功。
- readonly、nowrite：各自可见 `8/8`、读取 `8/8=200`、伪造 A1 状态写入 `403`。
- nomenu：可见 `0/8`、读取 `8/8=403`、写入 `8/8=403`，直接路由与刷新均拒绝。
- A1 故障矩阵：`404/500/timeout/disconnect/malformed-200` 共 `5/5` 失败关闭，移除故障后 `5/5` 恢复至权威 `200`。
- A5 故障矩阵：`403`、数据一致性破坏、`503` 共 `3/3` 失败关闭，恢复后重新加载成功。
- A 域专项静态合同：`58/58` 通过，覆盖 MFA/session、A1 安全边界、A2 结果未知、A3 CAS、A4 schema、A5 canonical registry 与 A6–A8 RBAC 合同。

## 状态与清理复核

本轮仅执行读取、被服务端拒绝的权限探针和浏览器网络故障注入，没有成功业务写入。独立数据库复核：A3 维护横幅仍为 `off`；Final13 临时角色 `RTMSAP2GXN`、菜单 `ZRTMSAP2GXN` 和三个临时账号的活动残留均为 `0`。四个锁定复审账号继续保留为本轮受控验收夹具，不属于遗漏清理。

## 载具校正

首轮载具使用 Playwright 的 APIRequestContext 调用注销后，未触发页面自动导航，却立即断言登录框，因而失败。该行为不是产品缺陷。载具只增加“session 已为 401 后从产品入口重新进入”的真实用户步骤，未修改产品代码；随后从登录入口完整重跑并通过。首轮失败 trace/video 与 R2 通过 trace 均保留，未覆盖证据。

## 原始证据

- `no-write/a004-final-owner.json`：A1–A8、刷新/重登与四角色矩阵，SHA-256 `A262E66C78212C6CEC417C4AA694B22EBF7D5FFE122C5A51A39E49D0355BC055`。
- `output-r2/.../trace.zip`：完整通过 trace，SHA-256 `EB70488E9A3459EE3763AD318165A5A8FC52F424017EC5A0F1463D11FCF53FF1`。
- `a5-output/.../trace.zip`：A5 真实浏览器与失败关闭 trace，SHA-256 `8F1CEF83A72A1CFF5BB56CECA0BAEEFBDBE193B8A3362261F93707B3D6BE972D`。
- `fault-matrix/summary.json`：A1 五类故障与恢复，SHA-256 `75D28F22654ADE211839B81ED7E6795D4B09552D6C83060F9B878FA0A0491BF2`。
- `fault-matrix/fault-matrix-trace.zip`：故障矩阵 trace，SHA-256 `1112F839E32A6580FCA8F61B6D6513DA4116F71E322443177B571E4AA33941FE`。
- `db-restoration.json`、`static-contract-result.json`、`evidence-index.json`：恢复态、58 项合同与证据索引。

## 复审签发

按墨菲定律重点攻击“API 注销但旧页面仍可见、无菜单深链绕过、只读角色伪造写、畸形 200 伪成功、404/500/超时/断网恢复失败、共享配置未恢复”。除已修正且完整重跑的验收载具问题外，未发现产品缺陷；Final15 A 域非 Owner 复审签发通过。

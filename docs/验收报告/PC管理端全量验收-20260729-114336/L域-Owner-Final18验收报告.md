# L 域 Owner Final18 验收报告

## 结论

**Owner 初审通过：97.4 / 100。** 本报告仅签发 L 域 Owner 结论；仍须由指定的非 Owner 对抗复审与全局 75/75 终验共同构成全量签发结论。

L1–L6 均由 MFA 真实账号从登录页、可见侧栏进入；逐页刷新和退出重登均未漂移。L3 对 Final18 的两项修复已完成真实浏览器和服务端闭环：`momDelta=-100` 可用、`<-100` 畸形 200 失败关闭且恢复后可再次导出；L3 专用 Treasury 快照为 200，而通用 Treasury 路由继续 403。

## 锁定基线

| 项目 | 值 |
| --- | --- |
| Run ID | `pc-full-acceptance-20260729-114336` |
| PC | `http://127.0.0.1:3002`，Build `9mltIBkb8GykArkvwXDY1`，PID `3888` |
| 后端 | PID `21696`，JAR SHA-256 `77DABEDE10CCA3AD3D82AA506A09A706724679CB703172725BB3C0CBECF85E70` |
| 隔离数据 | MySQL `nexion_acceptance_20260729_114336`、Redis DB 13、MinIO `nexion-acceptance-20260729-114336` |
| MFA bypass | `false` |

基线来源：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\candidate-rebuild-final18\FINAL18-RUNTIME-LOCK.json`。

## 已执行证据

| 范围 | 真实结果 | 原始证据 |
| --- | --- | --- |
| Owner 可见入口、L1–L6、逐页刷新、退出重登 | 1/1 通过 | `L\final18-owner\pw-owner-visible\...\trace.zip` |
| readonly / no-write / no-menu 的菜单、路由、按钮、接口、数据五层权限 | 3/3 通过；无菜单角色直链、读写均拒绝，刷新重登不从缓存恢复 | `L\final18-owner\pw-permissions\...\trace.zip` |
| L3 `momDelta` 边界 | `-100` 正常渲染；`-100.1` 触发失败关闭、导出禁用；返回有效响应后恢复 | `L\final18-owner\l3-mom-delta\01-negative-100-valid.png`、`02-below-negative-100-fail-closed.png`、`03-valid-recovery.png`、`pw-l3-mom-r2\...\trace.zip` |
| L3 Treasury 最小授权 | L3 `/api/admin/bi/finance/treasury-snapshot`=200；通用 `/api/admin/treasury/liabilities?breakdown=true`=403、`/api/admin/treasury/maturity-forecast?window=7d`=403 | `L\final18-owner\l3-permission-boundary.json`（SHA-256 `07379DDC8ABEA02E5DAA624E32D487495A2DDF447419FA71D3A871AC89AC4F56`） |
| L3 敏感导出全闭环 | create=200、同键 replay=200、同键异载荷=409、maker 自批=403、两 checker CAS=`200/409`、下载=200 | `L\final18-owner\l3-maker-checker-r2\runtime-evidence.json`（SHA-256 `266203878259A60AE94680C954DD43B562DC27F2AC53D032EC6F1742C94A2B5F`）及 trace `8EBEFED0F5D1D20337FB23CA8B69122F1B2D8EC99D2AB0DE8516ECA6B1BCF8B2` |
| L3 DB / A2 / A4 / MinIO 对账与清理 | 报表可变行、MinIO 对象、4 个幂等键均为 0；保留 A2=3、outbox=1 | `L\final18-owner\l3-maker-checker-cleanup\exact-cleanup-result.json`（SHA-256 `CDA828EAD2DC801F2450D9EA99C610F82059D5232E41500FEC630BA36C557C28`） |
| L4 隔离网络夹具 | 建立后精确清除 3 用户、2 sponsorship、5 team、3 KYC；非夹具指纹恢复，A2/A4 保留 | `L\final18-owner\l4-fixture-cleanup\exact-fixture-cleanup-result.json`（SHA-256 `D9F9057BC8950B4694C50730D67DB0D50B1E906811EAF2949124E0362C0C061B`） |
| L 权限夹具清理 | 4 个账号、2 个角色均已禁用/软删除；活跃账号、角色、关系、会话均为 0 | 隔离库精确清理事务输出：`after_admin_active=0`、`after_role_active=0`、`after_relation_active=0`、`after_session_active=0` |

## 缺陷与处置

发现一项 **验收 carrier 失配**，不是产品缺陷：`l-domain-final-write-20260729.spec.ts` 将 L1 固定为“导出 KPI 序列 CSV”，但 Final18 在当前不完整 KPI 数据下按产品真实状态显示“导出 KPI 当前汇总 CSV”。该 carrier 在点击前失败，未产生写入。失败 trace 与截图已保留在 `L\final18-owner\pw-owner-write\`；本轮未改动产品或测试源码。后续统一终验应采用已兼容两种真实标签的 `l-bi-human-flow.spec.ts` 语义重新驱动。

另有一次 Maker-checker 启动失败，原因为测试环境变量给了不存在的旧 JAR 文件名；未进入业务路径。改用 Final18 锁定 JAR 后重跑通过，首次失败证据保留在 `pw-l3-maker-checker\`，有效结果为 `pw-l3-maker-checker-r2\`。

## 清理与保留

L Owner/权限夹具、L4 网络夹具、L3 报表对象和幂等记录均已清理；A2 审计和 A4/outbox 保留。非 Owner K 创建并管理的独立 checker 夹具未由 Owner 越权清除，供其复审证据链使用。

## 评分

- 初审：**97.4 / 100，通过**。
- 复审：待指定非 Owner 完整对抗复审；本报告不替代复审签发。
- 血量：**100**。

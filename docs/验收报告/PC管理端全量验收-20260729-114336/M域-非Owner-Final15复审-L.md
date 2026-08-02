# M 域非 Owner Final15 对抗复审报告（L）

执行日期：2026-08-02  
映射：L Owner → M1–M5 非 Owner 对抗复审。  
运行时锁：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\candidate-rebuild-final15\FINAL15-RUNTIME-LOCK.json`  
锁定身份：PC Build `D16zWSJ5S3cDzcz8qW_fD`；后端 JAR SHA-256 `13A103A65FEA04FD8829305160C9496151BC0EB426DEBBACABB533D0DB4752E5`。  
真实交互：Playwright Chromium，`workers=1`、`trace=on`、正常 MFA，`mfaBypass=false`。  
证据根：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\M\final15-nonowner-a`

## 结论

通过。初审 **98.7/100**，复审 **99.1/100**，均严格高于门槛；**P0/P1/P2/P3 = 0/0/0/0**。

非 Owner 使用独立 M-only maker 与三类最小权限账号，从登录入口和可见侧栏重新执行 M1–M5、返回、刷新、退出重登、五层权限、异常失败关闭、M2 渐进加载、M3 跨席位、authEpoch 变化和精确回收。最终有效签发用例全部通过，未观察到 Final15 产品回归。

## 复审结果

| 范围 | Final15 非 Owner 结果 |
| --- | --- |
| M1–M5 首次用户走查 | 五页均从可见侧栏进入；浏览器返回、权威刷新、退出及重新 MFA 登录后仍按权限显示。 |
| 读取与失败关闭 | `32/32` 检查通过，覆盖 M1 500；M2 401/403/404/409/422；M3 500、畸形 200、超时；M4 畸形 200；M5 500 和读取结果未知，故障移除后均恢复到新鲜权威 200。 |
| 五层权限 | readonly、nowrite 对 M1–M5 可读但写入被服务端拒绝；nomenu 无菜单，直链、刷新、读写均拒绝；三账号退出重登后权限不漂移。 |
| M2 渐进加载 | 同一 authEpoch 下，兄弟请求缓慢或悬挂时仍保持失败关闭；旧快照不能恢复写控件；释放故障后以新鲜权威读取恢复。 |
| M3 跨席位 | 继承 Owner 的真实跨席位业务对象，非 Owner 从独立 M-only 入口重新核对稳定 adminId、目标候选、自转拒绝、目标接受、转工单与终态。 |
| authEpoch | authEpoch 变化后旧的席位/转接快照被清空；重新授权读取只恢复当前身份的权威状态。测试产生的两条 401 是刻意会话失效，不计为非预期错误。 |
| Owner 写链继承 | M1 CAS/结果未知、M2 幂等与 CAS、M4 FAQ/SLA 并发、M5 发布/归档的可变写链已由 M Owner 在同一锁定候选完整执行并恢复；非 Owner 聚焦独立权限、失败关闭、渐进态和跨域合同，不重复制造已清理的单例写。 |

## Murphy 对抗重点

- 旧列表可能在新请求失败后继续暴露可写按钮：失败关闭通过。
- 同权限集、同名显示文本可能把当前席位误当转接目标：按稳定 adminId 的跨席位链通过。
- 401/403/畸形 200/超时可能被当成空数据或成功：均未渲染成功态，恢复必须依赖新权威 200。
- 只读、无写和无菜单角色可能通过直链或伪造请求绕过：菜单、路由、按钮、接口、数据五层均拒绝。
- 刷新、退出重登或 authEpoch 变化可能复活旧授权：未发生。

## 载具校正与失败披露

保留的首轮失败均为验收载具问题，不是产品缺陷：独立 reviewer 初始化时角色权限漂移；部分载具重复使用同一 TOTP step；登录后立即深链造成 UI 会话建立竞态。修正方式仅为创建精确 M-only 权限集、等待可见登录完成并从产品入口进入，未修改产品代码或放宽断言。修正后 `read-failclosed-r3`、`permission-setup-r6`、`permissions-r2`、`progressive-r2`、`auth-epoch` 全部通过；失败 trace 继续保留，未覆盖。

## 清理与证据

- 独立 M-only reviewer `99970`：disabled、角色关系清空、MFA 清空、session=0、幂等记录=0。
- 三个权限账号 `99971`–`99973`：全部 disabled、角色关系清空、MFA 清空、session=0、幂等记录=0。
- 独立临时角色：活动角色、菜单、权限关系均为 0。
- 不可变 audit/outbox 按审计边界保留。

关键结果文件：

- `read-failclosed-r3/runtime-result.json`：32 项首次用户、异常和恢复检查。
- `pw-permissions-r2/.last-run.json`：三类最小权限矩阵通过。
- `pw-progressive-r2/.last-run.json`：M2 渐进失败关闭通过。
- `auth-epoch/runtime-result.json` 与 `pw-auth-epoch/.last-run.json`：authEpoch 对抗通过。
- `cleanup-full-reviewer/result.json`、`cleanup-permissions/result.json`、`pw-cleanup-role/.last-run.json`：账号、角色、MFA、会话、Redis 权限缓存和幂等记录精确回收通过。
- 各通过目录的 `trace.zip`：真实浏览器轨迹，首轮失败轨迹另行保留。

## 复审签发

L→M 非 Owner 对抗复审达到 **99.1/100**，硬性不通过项为 0，P0–P3 清零。M 域 Final15 签发通过，可进入 75 模块统一终验。

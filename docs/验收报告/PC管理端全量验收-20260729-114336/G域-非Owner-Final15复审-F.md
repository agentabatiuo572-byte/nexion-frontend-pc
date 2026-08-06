# G 域非 Owner Final15 对抗复审报告

执行时间：2026-08-02  
映射：F Owner → G1/G2/G3/G4/G7 非 Owner 对抗复审。  
运行时锁：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\candidate-rebuild-final15\FINAL15-RUNTIME-LOCK.json`  
锁定身份：PC Build `D16zWSJ5S3cDzcz8qW_fD`；后端 JAR SHA-256 `13A103A65FEA04FD8829305160C9496151BC0EB426DEBBACABB533D0DB4752E5`。  
真实交互：Playwright Chromium，全部 `workers=1`、`trace=on`。  
证据根：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\G\final15-nonowner-f`

## 初审

结论：通过。得分：98.6/100。P0–P3：0。

- G1/G2/G3/G4/G7 最小权限五层：readonly、nowrite、nomenu 覆盖可见菜单、直接路由、权威读、写接口、可操作控件、刷新和退出重登，4/4 通过。匿名管理面读写均为 401；五个 App 公共投影均为 canonical 200，缺可信边缘国家时均 503 fail-closed，匿名用户命令均 401。
- G1/G2/G3/G4/G7 畸形 200 均隐藏写控件并显示失败关闭；真实上游恢复后可重新加载。G7 500 与 G3 超时/结果未知也均失败关闭并恢复，6/6 通过。
- G2 在主控签发的独占 D-child 租约中运行，仅使用 `3304/18120` 与 `nexion_acceptance_20260729_114336_d`：真实可见手续费收紧、同键重放 200、异载荷冲突 409、B1 保护的放松回滚 422、可信边缘投影一致，1/1 通过。主运行时 `3002/8110` 未用于 G2 可变路径；租约已书面释放给主控。
- G3/G4/G7 由独立 maker、second writer 与审计只读员走真实侧栏：可逆成功写、同键幂等、异载荷冲突、G3 双运营员 CAS `[409,200]`、App 投影和精确恢复全部通过，1/1 通过。G1 在共享 B1 红线候选上仍保持只读/失败关闭：其恢复会放松覆盖，未伪造不安全写入。

### G7 审计—Outbox 精确复核

本复审独立按 idempotency key 关联数据库。临时写和恢复各恰有一条审计与一条 outbox；审计 `sourceDomain=G7`，而已注册 outbox payload 按合同不含该字段。

| 阶段 | 审计 ID | outbox ID | eventType | aggregateId |
| --- | ---: | ---: | --- | --- |
| 临时 `90 → 91` | 81939 | 12800 | `admin.repurchase_config_changed` | `lockDays` |
| 恢复 `91 → 90` | 81940 | 12801 | `admin.repurchase_config_changed` | `lockDays` |

详细关联键与字段见 `write-main-rerun/g7-independent-audit-outbox-closure.json`。

### 载具校正

首轮匿名权限探针观察到控制台认证 fetch 包装器将预期 401 提前转换为 `ADMIN_AUTH_EPOCH_CHANGED` 异常，未暴露 HTTP 状态。该行为不代表 401 绕过；为保持浏览器真实网络验证，载具改用带相同凭据策略的 XHR 读取响应状态，不触及产品认证逻辑。完整权限矩阵随后重跑 4/4 通过。

## 复审

结论：通过。得分：99.1/100。P0–P3：0。

按墨菲视角复核“成功提示但事件漏投/重复投递、异载荷伪重放、双写 CAS、匿名或无菜单越权、错误成功载荷、主子环境串写、恢复遗漏”均未发现缺陷。G2 的红线保护被保留，G3/G4/G7 的状态已精确恢复，G7 的审计和事件按现行 schema 一对一闭环。

## 证据索引

- `g-permissions-rerun.log`、`permissions-rerun-trace/`：G1/G2/G3/G4/G7 权限、匿名、App 投影与刷新重登。
- `g-failclosed.log`、`failclosed-trace/`：畸形 200、500、超时/结果未知失败关闭与恢复。
- `g-write-main-rerun.log`、`write-main-rerun/`、`write-main-rerun-trace/`：G3/G4/G7 幂等、冲突、CAS、投影和精确恢复。
- `write-main-rerun/g7-independent-audit-outbox-closure.json`：G7 audit/outbox 独立一对一证据。
- `g-write-child.log`、`write-child-trace/`、`g2-lease/`：G2 独占 child 可变闭环与租约释放。

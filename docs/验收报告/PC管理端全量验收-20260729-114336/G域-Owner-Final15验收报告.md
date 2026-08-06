# G 域 Owner Final15 验收报告

## 结论

通过。G1、G2、G3、G4、G7 均从真实登录和可见侧栏起点完成了锁定范围内的 Owner 验收；G2 在 Final15 独占 D-child 中执行，子运行时保留给主控后续处置，未触碰共享 `3002/8110` 数据。

运行时锁定：PC Build `D16zWSJ5S3cDzcz8qW_fD`，后端 JAR SHA-256 `13A103A65FEA04FD8829305160C9496151BC0EB426DEBBACABB533D0DB4752E5`，运行时锁 SHA-256 `8C8D6FCB1BFFCE4355D1CF600700F47AE01E5C32C80DB367768C3E6537DE278C`。

## 覆盖与结果

| 范围 | 结果 | 关键证据 |
| --- | --- | --- |
| G1 | 通过（只读与安全边界） | 真实登录侧栏/读取、B1 预检和无副作用探针均通过。共享库当前低于 B1 红线，任何“先放大再直接回滚”的 G1 写入会把恢复本身变为不安全动作，因此没有伪造可逆写入；这是红线保护而非漏测。 |
| G2 | 通过（独占子库写入） | `3304/18120`、子库 `nexion_acceptance_20260729_114336_d`、Redis 14、MinIO child bucket 与 Final15 资源清单一致。手续费收紧 UI 200/canonical；同键重放 200、异载荷 409、受 B1 保护的放松回滚 422 `COVERAGE_BELOW_REDLINE`；管理端和可信边缘 App 投影一致。 |
| G3 | 通过 | 可见页面写入 200/canonical、同键 200、异载荷 409、并发 CAS 为 `[200,409]`，最终精确恢复。 |
| G4 | 通过 | 可见页面写入 200/canonical、同键 200、异载荷 409、最终精确恢复。 |
| G7 | 通过 | lockDays `90 -> 91 -> 90`；UI 200/canonical，receipt `1edbb00c747248619c3074f3e0abc182`，同键 200、异载荷 409、精确恢复。 |
| A2/A4/App | 通过 | 专用审计只读员可读 A2/A4（200）且跨域用户概览 403；匿名管理端五条 G 路径均 401；五个可信边缘 App 投影均 200/canonical，未解析国家均 503 fail-closed。 |

## G7 审计与 Outbox 合同复核

此前“outbox payload 必须带 `sourceDomain=G7`”不是现行合同，不能作为产品缺陷：PRD 中的 `sourceDomain` 是 A2 pending 提案字段，而 G7 的成功合同是 `admin.repurchase_config_changed` 事件和审计；后端单测也明确要求 event payload **不**含 `sourceDomain`，audit detail 含 `sourceDomain=G7`。

Final15 对本次写入和恢复逐一核对：

| audit id | outbox id | eventType | aggregateId | 关联键 | audit sourceDomain | payload sourceDomain |
| --- | --- | --- | --- | --- | --- | --- |
| 81777 | 12778 | `admin.repurchase_config_changed` | `lockDays` | `g7-param-lockDays-1785613511481-1` | `G7` | 不存在 |
| 81778 | 12779 | `admin.repurchase_config_changed` | `lockDays` | `pc-full-acceptance-20260729-114336-g7-restore-1785613511600` | `G7` | 不存在 |

关联键在 audit `detailJson.idempotencyKey` 与 outbox `payload.idempotency_key` 完全相等；`paramKey/param_key` 与 aggregateId 均为 `lockDays`。因此每一个 G7 操作都有且只有一条对应 A2 审计和 A4 outbox，且仍符合注册 schema；没有向 outbox 塞入未注册字段。

## 已执行的真实走查

- `g-final7-owner-read-20260729.spec.ts`：正常 MFA、首次用户可见侧栏/刷新/重新登录、匿名边界与 App 投影、B1 只读预检、专用审计员权限边界、Murphy 非法参数 fail-closed，均通过。
- `g-domain-nonowner-f-write-20260728.spec.ts --grep 'G1/G3/G4/G7 maker'`：G3/G4/G7 主运行时真实写入、幂等、冲突、CAS、恢复、A2/A4 通过；载具已改为核验 audit 的 `sourceDomain=G7`，不再错误要求 A4 payload 重复该字段。
- `g-domain-nonowner-f-write-20260728.spec.ts --grep 'G2 swap'`：Final15 D-child 独占写入通过；资源清单 SHA-256 为 `FB107698EEC3EBD1A2B674C0059AB9207A40999769899D7CF52317283310D409`。

证据目录：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\G\final15-owner\`。其中 `read-retry` 包含 G1/G2/G3/G4/G7 可见页面截图和刷新/重新登录诊断；`write-main-contract` 是 G3/G4/G7 完整写入与恢复；`g2-lease` 是 D-child 的锁定资源与交接；`anonymous-app`、`audit-reader`、`b1-preflight`、`murphy` 分别保留边界证据。

## 评分

初审：99/100，通过。复审：99/100，通过。允许进入 G 域非 Owner 对抗复核。

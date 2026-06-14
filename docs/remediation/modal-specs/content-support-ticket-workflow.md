# content-support-ticket-workflow

| 字段 | 值 |
|---|---|
| 归属 | I8 `/content/support` |
| 关联 spec | `SPEC-L3a01-support-admin-surface` |
| 业务对象 | Help/FAQ content、ticket category SLA、support ticket |
| 操作类型 | inline business panel + audit reason |

## 业务动作契约

1. **新增 FAQ**：必须填写分类、问题、回答、可见状态、审计理由；保存后写入 `I.support.faqs` 并刷新仍在。
2. **更新分类 SLA**：必须选择 ticket 分类、输入首响/解决 SLA、负责人队列、审计理由；保存后写入 `I.support.sla`。
3. **打开工单详情**：从列表选择 ticket 后展示完整 thread、用户侧字段镜像、owner、priority、status、lastReplyAt。
4. **分配/改状态**：必须选择 owner、priority、目标 status、填写审计理由；保存后写入 `I.support.tickets`。
5. **运营回复**：必须填写回复正文和审计理由；保存后追加 agent message、更新 `lastReplyAt/updatedAt`、状态转 `pending_user`。
6. **关闭/重开**：必须填写审计理由；关闭写 `closed`，重开写 `open`，均持久化并留 A2 审计。

## 反摆设要求

- 不允许只有“查看详情”弹窗或只有 toast。
- 每个写动作必须至少有一个业务字段 + 一个审计理由字段。
- 工单字段必须与 UniApp mock 镜像：`id/category/subject/status/priority/messages/owner/lastReplyAt`。
- 运行时验收必须证明 create FAQ、reply ticket、close ticket 三个动作刷新后仍在。

## 机器哨兵

- `node scripts/admin-support-surface-audit.mjs`
- `node scripts/admin-support-surface-proof.mjs`
- `node scripts/remediation-feature-map-operability.mjs`

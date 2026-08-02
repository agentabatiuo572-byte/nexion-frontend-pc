# F域 Final14 非 Owner 对抗复审

## 结论

**通过。初审 99/100；复审 99/100。** 基于 Final14 锁定 PC 构建 `0OZ66wYtIYX6qJHhZUvQK` 与后端 JAR `F54932E72C272E14247439DC32ECC9165FD741E7A25C7E3D60464FB4FACA7399`，独立从登录和可见侧栏执行 F1-F5。未发现 P0-P3 产品缺陷。

## 对抗性覆盖

- F1 maker/checker 全生命周期通过：自批和跨域审批 403，对象锁 409，同键幂等返回同一工单，异载荷 409，CAS 仅一个终态胜者，真实响应丢失后使用同键重放得到同一工单；变更、恢复和独立 finally 后原值精确恢复。
- F2-F5 专属 checker 成功链通过：四个模块可见页面操作、A2 审批、A4/数据库核验和独立 finally 通过；F5 的两项临时物理配置行已精确删除，非目标配置指纹未变化。
- 本轮新增的 F2/F3/F4 outbox 合同通过严格复核。六张批准工单（每模块临时+恢复各一张）全部 `approved`，每张均有 A4 审计且 **A2_OPERATION outbox 精确等于 1**；重放没有额外 outbox。
- F1 四类权限夹具（readonly、nowrite、maker、nomenu）五层边界通过；刷新、退出重登后权限不漂移。匿名读写失败关闭。
- F2 500、F3 超时/结果未知、404/422，以及 F1-F5 畸形 200 均失败关闭并恢复，16/16 浏览器测试通过。

## 本轮独立写入证据

`bug-pic/.restricted/pc-full-acceptance-20260729-114336/F/final14-nonowner-e/f25/f25-success-cleanup.json` 记录：

- F2/F3/F4 六张 A2 工单均为 approved；`a2OutboxByOperation` 对六个 operationId 全部为 `1`。
- F5 两笔配置操作各有审计和 outbox 一条；API 默认值恢复、物理行不存在、非目标指纹一致。
- `pendingAtExit=[]`。

`.../F/final14-nonowner-e/f1/result.json` 记录 F1 的幂等、CAS、响应未知、A2/A4/outbox 和关联域隔离；批准操作各一条 outbox，结果未知的 rejected 清理不伪造 outbox，最后原始配置恢复。

数据库只读复核：F 域 pending A2 工单为 **0**。本轮所有写路径的 finally 已运行，无额外 Final14 批次启动。

## 工件

- F1 trace：`F/final14-nonowner-e/f1-trace`
- F2-F5 trace：`F/final14-nonowner-e/f25-trace`
- 可见入口、权限、异常和畸形响应 trace：`F/final14-nonowner-e/surface-permission-fault-trace`（16/16 通过）

`DOMAIN_F_REVIEW_FINAL14_E.lck` 已在验证和恢复完成后释放。未改源码、未提交、未推送。

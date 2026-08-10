# C 域不合理删除恢复验收报告

## 结论

**PASS（C3 撤回能力为显式 HOLD）。** C1 导出确认/理由和 C3 服务端分页已经恢复并通过真实链路；历史设计中的“撤回待放行申请”因现行后端没有状态转换契约，保留失败关闭能力位，不伪造按钮和成功结果。

## C1 导出

- 运营必须在确认框填写导出理由，才能按当前有效筛选导出脱敏 CSV。
- 服务端记录筛选哈希、理由、行数和操作者；幂等请求哈希固定为 64 位，不再超出数据库字段。
- 实际 POST 返回 200，响应包含 CSV 和下载文件名，页面显示完成提示。
- 未登录读取返回 401。

## C3 分页与收缩边界

- 待放行队列改为服务端分页，不再固定只显示前 5 条。
- 真实写入 6 条一次性待放行夹具：第 1 页显示 5 条、可进入第 2 页。
- 在第 2 页删除全部夹具并点击“刷新队列”后，页面先读取当前第 2 页，再自动纠正到第 1 页，最终显示 0 条；没有出现“第 2 / 1 页”。
- 验收结束后账号、角色、权限、缓存和业务夹具清理计数为 0。

## HOLD 项

`data-restored-capability="c3-pending-request-withdrawal"` 保留“撤回待放行申请”能力位和缺失条件说明。放行条件是后端提供明确的可撤回状态、权限、CAS/幂等、审计和并发冲突语义；在此之前不得启用前端假操作。

## 证据

- `bug-pic/unreasonable-deletion-restoration-20260808/live-20260808-final7-r5/acceptance.json`
- `bug-pic/unreasonable-deletion-restoration-20260808/live-20260808-final7-boundaries-r4/boundaries.json`
- `test-results-restoration-live-final7-r5`：2/2 PASS。
- `test-results-restoration-boundaries-final7-r4`：4/4 PASS，并记录与主链逐值相同的构建身份和关键源文件哈希。

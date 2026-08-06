# L 域非 Owner Final16 复审（K→L）

- 候选：PC `WHtnx71HibGEUaMlXb3rk` / PID 7444；Backend PID 22996 / JAR SHA-256 `13A103A65FEA04FD8829305160C9496151BC0EB426DEBBACABB533D0DB4752E5`
- 环境：`http://127.0.0.1:3002`、`http://127.0.0.1:8110`、数据库 `nexion_acceptance_20260729_114336`、MFA bypass=false
- 复审角色：K 域映射到 L 域的独立非 Owner；使用独立 L Owner/readonly/no-write/no-menu 夹具与独立 checker
- 结论：**不通过，不得签署 Final16 L 域 >98 分/零缺陷结论**

## 对抗性结果

| 检查项 | 结果 | 证据 |
|---|---:|---|
| L 契约测试（含 L3 `-100` / `-100.1`、L1-L6 跨域契约） | 83/83 通过 | `L/final16-nonowner-k/pc-l-contracts.junit.xml` |
| L1-L6 可见侧栏进入、逐页刷新、退出重登 | 1/1 通过 | `L/final16-nonowner-k/owner-visible` |
| readonly/no-write/no-menu 五层权限、直链、接口、刷新重登 | 3/3 通过 | `L/final16-nonowner-k/permission-five-layer` |
| L4/L5/L6 畸形 HTTP 200 失败关闭 | 3/3 通过 | `L/final16-nonowner-k/malformed-matrix` |
| L3 动态边界：恰好 `-100` 可用、低于 `-100` 失败关闭、恢复 | **失败** | `L/final16-nonowner-k/L3-boundary-playwright-r3/.../trace.zip` |
| L1 404/500/timeout/offline/malformed-200 故障载体 | 未形成产品判定 | 载体在 MFA 登录阶段失败；未将环境/账号载体失败计为产品缺陷 |

## 阻断缺陷

### P1 — L3 页面与跨域权限契约不闭合

独立 L Owner 的菜单、角色与 `bi_l3_read` 权限均存在，L3 财务接口 `/api/admin/bi/finance/revenue?period=month` 返回 200；但同一 L3 页面同时直连：

- `/api/admin/treasury/liabilities?breakdown=true` → 403
- `/api/admin/treasury/maturity-forecast?window=7d` → 403
- `/api/admin/treasury/maturity-forecast?window=30d` → 403

因此页面显示“L3 数据加载失败 · 无权限访问”，两个导出按钮均禁用。测试注入的 `momDelta=-100` 已进入 revenue 响应，但整页因 treasury 跨域权限失败而不能呈现“收入结构报表”和 `-100.0%`；这也使低于 `-100` 的动态失败关闭及恢复链无法在真实 L Owner 权限模型下闭环。

这是五层权限载体的覆盖盲区：该载体只检查 `/api/admin/bi/finance/overview` 可读，没有检查 L3 页面实际依赖的 treasury 请求全部成功。修复方向应在“L3 聚合接口以 `bi_l3_read` 提供所需只读事实”与“正式 L Owner 明确获得最小 treasury 只读权限”之间选定唯一权威契约，并同步页面、RBAC、后端鉴权和验收载体。

缺陷统计：P0=0，P1=1，P2=0，P3=0。

## 精确恢复

- 独立账号 99974–99977：全部停用、角色关系解除、MFA 清除、会话撤销。
- 隔离角色 4568/4569：角色、菜单关系、权限关系全部退役；活动关系计数为 0。
- 本轮 `F16NK0802` / `final16-nonowner-k` 幂等记录：0。
- 本轮角色相关 pending A2 工单：0；既有审计/历史记录保留。
- 未修改产品源码，未提交、未推送；临时 Playwright 外部配置已删除。

## 评分

- 候选产品初审：92.0/100，不通过（P1 阻断）。
- 候选产品复审：92.0/100，不通过；不能伪造 >98 分或 P0–P3=0。
- 本次复审执行质量初审：97.4/100；复审：98.6/100。对静态通过、真实权限失效和载体登录失败进行了分层归因，并完成精确恢复。

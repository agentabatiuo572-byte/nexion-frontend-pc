# Final13 D 域非 Owner 对抗复审 C

运行：`pc-full-acceptance-20260729-114336`；候选：Final13；范围：D1–D6；执行者未承担 D 域 Owner 或修复工作。环境限定为 child PC `3304`、child backend `18120`、child DB `nexion_acceptance_20260729_114336_d`；正常账号密码加 MFA 登录，不使用 MFA bypass。

## 复审结论

**通过，复审 99/100；P0–P3 = 0。**

本复审以真实 Chromium、`workers=1`、trace 开启执行。所有可逆资金写只作用于 child 数据库，并已精确恢复；未修改产品源码，未提交或推送。

## 可见用户路径、权限与异常

- 从登录后的可见「资金与财务」侧栏依次进入 D1–D6；六个目标标题和六条权威读接口均为 `200`。
- 同一组六条未登录读接口均为 `401`；D3/D5/D6 的资金写入均通过服务端权限、理由、幂等及 CAS 契约，而非前端本地状态。
- D1–D6 的核心 500/畸形响应/超时关闭路径中，D3 的 `forecast-config` 注入 `500` 后清空旧态、显示数据异常，并由显式重新加载恢复。无 pageerror、无非预期 request failure。
- D5 生命周期在重新登录后读取到精确恢复值；D6 在后端已 `200`、浏览器响应被中断时停止展示旧牌价，同键重放仅返回原结果，再以新键精确恢复。

## D3 对抗重点

| 检查 | 结果 |
| --- | --- |
| 90 天负历史净流入 | 90 条均保留负净敞口；`reserveUsdt >= 0` |
| 净敞口缺口 | 每条保持 `reserve - liabilities`，未以负储备掩盖缺口 |
| 响应代际竞争 | 暂挂旧 7d 响应并先完成 90d；释放旧响应后页面仍为 90d |
| 资金生命周期 | 非法输入 `400`、创建/同键重放/冲突为 `200/200/409`；追加等额 OUT 补偿 |
| D5 CAS/幂等 | 更新、重放、键冲突、陈旧版本、精确恢复均验证；冲突/CAS 为 `409` |
| D6 未知结果 | 后端已提交 `200`，UI fail-closed；同键重放后精确恢复 |

## RSC 严格处理

本轮捕获 2 条 `/platform/events` 的 RSC `ERR_ABORTED`。每条均以同一完整 RSC 请求获得 `200` 替代响应，并在独立已登录页面确认「今日事件量」渲染；两条均有逐条证据，未作无证豁免。其余导航取消为 0。

## DB / A2 / A4 / App 关联

- D3 本轮 voucher 成对保留 2 行，净额为 0；没有待确认资金记录。
- 关联的 A2 审计明细 11 条、A4 outbox 7 条；D5 与 D6 的历史写入可回查，当前 D6 基准价恢复为 `26000`。
- Final13 运行锁已记录 App Vitest `57 files / 265 tests`、typecheck 与 H5 build 均通过。本轮使用的受限 child 凭据仅覆盖后台 MFA，未额外取得或输出 App 用户凭据；因此该 App 门槛作为锁定构建交叉证据，不替代 PC 的真实走查。

## 命令与证据

- `node D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\D\final13-nonowner-c\d-final13-nonowner-c.cjs`：exit `0`。
- `d-child-owner-write-20260729.spec.ts`：D3+D5 以独立输出目录复跑 exit `0`，2 passed；D6 单独复跑 exit `0`，1 passed。
- [核心证据](D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\D\final13-nonowner-c\nonowner-core.json) 与 trace：侧栏、D3 历史/竞态/故障关闭、RSC 等价验证。
- `write-lifecycle-r5/`：D3 补偿与 D5 CAS/重登恢复；`write-lifecycle-r2/`：D6 未知结果、重放及恢复。

扣 1 分：本轮所授受限凭据为 child 后台 MFA 凭据，App 仅能复核锁定构建门槛，未新增独立 App 登录会话；该限制没有发现产品缺陷，也不影响本复审的 P0–P3 结论。

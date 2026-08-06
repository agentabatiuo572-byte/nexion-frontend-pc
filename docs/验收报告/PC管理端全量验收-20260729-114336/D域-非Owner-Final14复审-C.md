# Final14 D 域非 Owner 复审 C

运行：`pc-full-acceptance-20260729-114336`；候选：Final14；范围：D1–D6；执行者未承担 D 域 Owner 或修复工作。运行时锁定为 PC Build `0OZ66wYtIYX6qJHhZUvQK`、backend JAR `F54932E72C272E14247439DC32ECC9165FD741E7A25C7E3D60464FB4FACA7399`。全程使用 child `3304/18120` 与 child DB `nexion_acceptance_20260729_114336_d`，正常 MFA 登录，无 bypass。

## 复审结论

**通过，99/100；P0–P3 = 0。**

真实 Chromium、`workers=1`、trace 开启。未修改产品源码、未提交或推送；所有资金写已做可审计的精确恢复。

## D1–D6 用户路径与权限

- 从登录后的可见「资金与财务」侧栏依次进入 D1–D6；六个页面均完成目标渲染，六条权威读接口均为 `200`。
- 未登录的六条相同读接口均为 `401`。资金写入仅经服务端权限、理由、幂等键与版本 CAS 生效，不依赖前端本地状态。
- D3 注入 `forecast-config` 500 后停止展示旧权威态，显式重新加载恢复；无 pageerror、无未预期请求失败。
- D5 的更新、重放、键冲突、陈旧 CAS、精确恢复、刷新和正常 MFA 重登均通过。D6 后端已提交但浏览器响应中断时明确失败关闭，同键重放不重复落地，随后精确恢复。

## D3 红线与竞态

| 检查 | 结果 |
| --- | --- |
| 90 天历史 | 90 条储备均非负；90 条负净敞口保留 |
| 缺口口径 | 每条严格保留 `reserveUsdt - liabilitiesUsdt`，未把储备改为负数掩盖缺口 |
| 响应代际 | 暂挂 7d 后先完成 90d，释放旧响应仍保持 90d |
| 生命周期 | 非法输入 `400`，创建/同键重放/键冲突 `200/200/409` |
| 恢复 | 成功 IN 后追加等额 OUT，账本净额为 `0.000000` |

## RSC、DB 与跨域证据

- 本轮 RSC `ERR_ABORTED` 为 0，因此无豁免条目；零条非 RSC 导航取消。
- Final14 D3 voucher 成对 2 行、无待确认记录；A2 审计明细 5 条、A4 outbox 3 条；D6 写历史 2 条，当前基准价恢复 `26000`。
- Final14 锁定门槛：App Vitest `58 files / 267 tests`、typecheck、H5 build 全部通过。受限 child 凭据仅用于后台 MFA，未输出或扩展 App 用户凭据。

## 命令与证据

- 非 Owner 核心走查：exit `0`。
- `d-child-owner-write-20260729.spec.ts`：D3+D5 exit `0`（2 passed）；D6 exit `0`（1 passed）。
- [核心 JSON](D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\D\final14-nonowner-c\nonowner-core.json) 与 trace：侧栏、权限、D3 历史/竞态/fail-closed、RSC 信号。
- `write-lifecycle-r1/`：D3 补偿、D5 CAS/重登恢复；`write-lifecycle-r2/`：D6 unknown-result、稳定重放和恢复。

扣 1 分：本轮新增 App 侧仅能复核锁定构建门槛，child 受限凭据不包含独立 App 登录身份；该限制未发现产品缺陷，不影响 P0–P3 结论。

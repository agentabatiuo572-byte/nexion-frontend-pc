# Final13 D 域 Owner 初审验收报告

运行：`pc-full-acceptance-20260729-114336`；候选：`Final13`；范围：D1–D6；执行：Owner；浏览器：Chromium、`workers=1`、trace 开启。

## 初审结论

**通过，初审 97/100。**

验收始终使用锁定的 child PC、child backend 与 child 数据库；未触碰主库资金。真实账号密码 + MFA 登录后，均从可见侧栏进入 D1–D6，而非直达路由或静态替代。最终 Owner 专用命令以 exit 0 结束：D1–D6 目标标题均渲染，六个权威读接口均为 200，页面异常为 0。

## RSC 取消审计

早先通用核心包的信号收集器曾记录 Next RSC `net::ERR_ABORTED`（包含 `/finance/ledger`、`/platform/events`）；其严格规则要求同路径替代 200 才能豁免。因此本 Owner 不以该失败包直接签发，而是重新执行专用的串行侧栏走查。

专用走查通过 CDP 逐请求记录 `_rsc` 请求的 method、完整 path、initiator、时间戳和取消信号，并对每个取消额外要求等价 RSC 200 与目标标题已渲染才允许 exit 0。本次最终运行中没有产生任何 RSC 取消，因此没有可豁免条目；D4 与 A4 页面均在稳定 200 后显示数据，命令 exit 0。原失败包的 trace/视频仍保留，不把旧失败改写为通过。

| 检查 | 结果 |
| --- | --- |
| 最终串行 Owner 命令 | exit 0 |
| D1–D6 真实侧栏与标题 | 全部通过 |
| D1–D6 权威 BFF 读 | 全部 200 |
| RSC 取消 | 0 条 |
| RSC 替代 200 豁免 | 不适用（无取消） |
| pageerror | 0 条 |

## D3 重点验收

| 项目 | 结果 | 事实 |
| --- | --- | --- |
| 历史负净流入 | 通过 | 90 天每一条 `reserveUsdt >= 0` |
| 净敞口缺口 | 通过 | 每条 `netExposureUsdt = reserveUsdt - liabilitiesUsdt`；90 条负缺口保留，不以负资产掩盖 |
| 前端加载代际 | 通过 | 暂挂旧 7d 响应，先完成 90d 后释放旧响应；页面最终保留 90d，无回退或异常态 |
| 失败关闭与恢复 | 通过 | forecast-config 500 时停止展示旧态，显式重新加载后恢复 |
| 写链与补偿 | 通过 | 非法负数 400；创建/重放/键冲突为 200/200/409；追加等额 OUT，净资金影响为 0 |

## 生命周期、权限与可恢复性

- FINAL75 最小读角色：D1–D6 读均 200，D6 写为 403，未扩大权限。
- D5：放大、同键重放、键冲突、陈旧版本、精确恢复依次验证；重登后仍为恢复值。
- D6：后端已提交但浏览器响应中断时，页面失败关闭；同键重放单次落地并精确恢复。
- DB/A2/A4/outbox：本轮 D3 IN/OUT 各一笔等额；D3 A2=1、A4=1；D5 A2=2、D6 A2=2；运行幂等记录=6，均保留。
- App：Final13 锁定门槛中的 App Vitest 265 项、typecheck 与 H5 build 均通过；本轮 PC 走查未用该静态门槛替代用户路径。

## 503 复核

首轮 FINAL75 会话出现一次 `/api/admin/platform/audit/overview` 503。随后同一 MFA 会话连续三读为 200（348/170/74 ms），新上下文重登后再读为 200（110 ms）；child backend 日志无对应 ERROR/Exception，MySQL 无 data lock/wait，Redis 14 PONG。该现象未复现，记为并发载体观察，未作为 D 域产品缺陷或资金风险签发依据。

## 证据

- `D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\D\final13-owner\final13-rsc-equivalence.json`：最终 Owner 串行命令，SHA-256 `2919FB1AF0ACE05508D9AB435348760FDB711896A4CBAC3CF662BF86B38A712C`。
- `D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\D\final13-owner\final13-rsc-equivalence-trace.zip`：最终 Owner trace，SHA-256 `5081710EA3D8EBBC664EBDD30C4BD0905A6711C5D256C3940CAB62FFBF8815DB`。
- `final13-d-owner-evidence.json`：D3 历史不变量、代际隔离与 500 恢复，SHA-256 `96B083A879BF85C86F96F0AB374B2B6531256157FF86ECC8799CC519ADA0DDD5`。
- `write-lifecycle/`：D3/D5/D6 生命周期、补偿、未知结果与 trace；原始证据保留于同一 restricted 目录。

## 扣分与后续

扣 3 分：通用核心包仍会在非串行路由切换中暴露 RSC 取消；虽然最终 Owner 串行走查无取消并 exit 0，公共信号采集的取消关联规则仍应统一收敛。该项不改变本次 D 域初审通过结论。

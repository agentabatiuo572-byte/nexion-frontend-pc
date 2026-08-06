# C 域 Owner 初审报告（Final12）

Run ID：`pc-full-acceptance-20260729-114336`  
候选：`Final12`；PC `http://127.0.0.1:3002`；后端 `http://127.0.0.1:8110`；隔离库 `nexion_acceptance_20260729_114336`。  
范围：C1 检索与画像、C2 账户操作、C3 余额与资产调整、C4 KYC 合规台账、C5 安全与会话、C6 注册/登录风控。  
结论：**不通过（HOLD）**。C3 的独立复核员已被实际授予 `user_c3_adjust_approve`、`user_c3_adjust_reverse`，但对真实调整执行 approve 返回 `403`；完整资金生命周期和其后的关联 App/跨域签发不能成立。

## 锁定环境与执行器

- 运行时锁：`candidate-rebuild-final12/FINAL12-RUNTIME-LOCK.json`，SHA-256 `A51033B0892F3625941D2C4D2015DCD5800AD05812EFB453CA495F44177C2142`。
- 锁中 Build ID：`ABZKW7393ECWjhkaA_btM`；后端 JAR SHA-256：`2A3EEC48ACCE273CFDEA32AAA2D0ADC69CC7F9EA07B66126BDC42D5482083DD2`；`mfaBypass=false`。
- 任务载体：真实 Chromium / Playwright，`workers=1 --trace=on`。所有账号均从登录页输入账号密码与正常 MFA 后开始，C1–C6 从可见「用户与账户」侧栏逐项点击；未使用隐藏 URL、mock 登录、DOM 或 localStorage 作为权威态。
- 初审脚本：`C/final12-owner/c-final12-owner.spec.ts`，SHA-256 `3B324BDCB43EA4FF68DD8D6AD2102E3EEDBA44124860AF40AA0DC4B19A5B1D7B`。

## 已完成的真实证据

- maker 正常 MFA 登录后 C1–C6 均可从侧栏进入、标题可见并在刷新后仍可见；逐页截图为 `C/final12-owner/C1-visible.png` 至 `C6-visible.png`。
- 未认证对六个 C 读取接口均为 `401`；无菜单角色的 C1–C6 菜单、路由页面标题均不可见，六个读取接口均为 `403`；退出后重新 normal-MFA 登录仍保持六个 `403`，无缓存越权。
- 无写权限角色 C3 写入返回 `403`；无 Idempotency-Key 返回 `400`；C5 非法复核动作返回 `422`；不存在用户返回 `404`。
- C3 maker 成功创建可逆 `USDT DEBIT 0.01`，同键回放 `200`、异载荷 `409`、maker 自审 `403`。创建后实际数据库状态却已为 `APPROVED`，并将 `checker` 写为 maker；独立 checker 的 `approve` 请求返回 `403`。

## 缺陷

### [P1] C3 授权的独立复核员不能审批真实资产调整

- 复现：正常 MFA 登录 maker，从可见 C3 页面确认可达后，创建 `ADJ-E0DC00CFD6E14D4B`；maker approve 为 `403`（预期拒绝）；以拥有 C3 菜单、`user_c3_adjust_approve` 与 `user_c3_adjust_reverse` 的独立 checker 正常 MFA 登录，调用同一调整的 `approve`，实际 `403`。
- 当前行为：调整创建即 `APPROVED`，数据库 `checker=ffix.cm.final7.e5a56c2fd0`（maker）；独立 checker 审批被拒绝，并产生 A2 `C3_ASSET_ADJUSTMENT_REJECTED`。
- 正确行为：需要 maker/checker 的 C3 高风险调整应进入可审核状态；具备精确审批权限且不是 maker 的独立 checker 应能审批，随后才允许冲正。若产品明确采用单人即时执行，前端、角色权限、API 和 PRD 不得继续呈现/授予独立审批契约。
- 影响：C3 全生命周期、双运营员并发/CAS、冲正的权限闭环，以及 D4/A2/A4/outbox 与 App 余额投影的最终签发。
- 建议修复：统一 Controller 权限、Service 角色资格和状态机。禁止 create 自行落 `APPROVED` 或写 maker 为 checker；以服务端原子 CAS 实现 `PENDING → APPROVED`，仅非 maker 的有权 checker 可执行；再从可见入口重新跑 C1–C6、App 余额刷新与完整异常矩阵。

## 数据、审计、outbox 与恢复

- 失败后的安全恢复由正常 MFA 的 superadmin 真实执行：对 `ADJ-E0DC00CFD6E14D4B` 创建反向 `ADJ-2FB63DF5013D498C`；首次与同键回放均 `200`。清理脚本结果 SHA-256 `75E71652078FED628A2BC803FEA2BD41A4E2C2A9060369D46E1B96D85B6BAFCA`。
- DB 恢复快照：`nx_user_wallet(user_id=990000151023)` 为 `usdt_available=100.000000`、`nex_available=500.000000`、`version=22`。原 debit 与反向 credit 均 `APPROVED`，账本分别为 `395120/395121`。
- A2：原调整 `C3_ASSET_ADJUSTMENT_EXECUTED`、失败审批 `C3_ASSET_ADJUSTMENT_REJECTED`、恢复 `C3_ASSET_ADJUSTMENT_REVERSED` 均存在。A4/outbox：两笔各有 `admin.balance_adjusted` 和 `admin.bill_adjusted`，状态均 `PUBLISHED`。`nx_admin_operation_mutex` 对本 Run/调整残留为 `0`。
- 未继续在 App 写入或断言余额投影：P1 已使 C3 真实 maker/checker 生命周期无效；不得将恢复后的单笔反向分录伪报为 App 关联域通过。

## 异常、未知结果与覆盖状态

- C4 畸形 HTTP 200、C5 注入 500、C6 timeout/断网的 fail-closed 用例已写入初审脚本，但本轮在 C3 P1 前终止，未执行到这些断言；不能作为通过证据。
- C2 冻结/解冻、C4/K5 复审、C5 高敏安全动作、C6 CAS 双写、跨域 App 刷新，以及完整的 409/500/timeout/畸形 200/未知结果闭环均因 P1 未签发；不得补记为已覆盖。

## 命令、退出码、原始证据与评分

| 命令 | 退出码 | 结果 |
|---|---:|---|
| `npx playwright test -c ...C/final12-owner/playwright.config.ts --workers=1 --trace=on` | `1` | 真实发现 P1：checker approve `403` |
| 同命令（cleanup spec，workers=1，trace=on） | `0` | C3 精确反向恢复与同键回放通过 |
| MySQL 隔离库状态/A2/outbox/mutex 查询 | `0` | 恢复、审计、outbox 和无锁残留已核对 |

- 原始结果：`C/final12-owner/c-final12-owner-result.json`，SHA-256 `8B351918471E8B851238ABBF253FA3A96FDE99F456981E102104076472A3ADFE`；trace、失败截图和视频位于 `C/final12-owner/playwright-output/`。
- 硬错误计数：`1`（开放 P1）；页面 `pageerror`：`0`；未归因的 admin 5xx：`0`。
- 初审评分：**92/100，不满足 >96 门槛，未通过**。不得虚构 >96 分或触发复审。

## 初审处置

修复前不允许上线 C 域。修复后须使用干净夹具重新执行：首次 MFA 登录→可见侧栏 C1–C6→刷新/返回/退出重登→三类角色五层权限→C2/C3/C4/C5/C6 全生命周期→C3 双运营员 CAS/幂等/冲正→401/403/404/409/422/500/timeout/畸形 200/未知结果→DB/A2/A4/outbox/D4/关联 App 投影；然后由非 Owner 进行墨菲复审。

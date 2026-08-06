# D 域 Owner 初审报告（Final10 HOLD）

- Run ID：`pc-full-acceptance-20260729-114336`
- 审查范围：D1 入金对账、D2 提现审核、D3 资金池、D4 资金账本、D5 提现参数、D6 汇率牌价。
- 当前结论：**HOLD，不评分，不签发通过。** Final10 的 PC 与后端 D1、D3–D6 以及 D2 的管理端读取、权限和失败关闭均已完成且未发现 D 域产品缺陷；但同一锁定候选的 App H5 缺少 HTTPS API base，真实 App 在发出 D2 请求之前即以 `API_HTTPS_REQUIRED` 失败，D2 法定 App→K4/J1→PC 审核成功链无法执行。该候选打包环境受阻必须留待 Final11 补验，不能用 PC/API 局部结果替代。

## 冻结候选

| 项目 | Final10 值 |
|---|---|
| PC 主候选 | `http://127.0.0.1:3002`，PID `3520`，Build ID `zGL97cq44U6qzzAKmh415` |
| 后端主候选 | `http://127.0.0.1:8110`，PID `23136` |
| 后端 JAR | SHA-256 `ED80116D6B7D7C025490C4EEC180D53F135D712DB0A4D5C89D6FA4D8D9A9F947` |
| 主数据库 / Redis | `nexion_acceptance_20260729_114336` / DB `13` |
| 可销毁 child | PC `3304`（PID `18616`）→后端 `18120`（PID `3108`）→`nexion_acceptance_20260729_114336_d` / Redis DB `14` |
| App carrier | HTTPS `5176` / proxy `18116` / OTP `18111`；Final10 H5 包缺少可用 HTTPS API base |
| 运行时锁 | `candidate-rebuild-final10/final10-runtime-lock.json`；本域未停止或重启任何 Final10 服务 |

## Owner 完成范围

### 1. 真实浏览器与首次用户路径

- 主候选核心走查 `3/3` 通过；主候选 readonly、no-write、no-menu 权限矩阵 `3/3` 通过。
- 使用正确的 `ADMIN_BASE_URL=http://127.0.0.1:3304` 后，child 核心 `4/4` 通过：
  - 从真实登录页和可见侧栏发现 D1 五视图、D3 九类科目，刷新、退出重登均可恢复；
  - D2、D4、D5 权威读取与匿名拒绝通过，D4 七类账本可见；
  - D1 与 D6 成功写、幂等重放、稳定键冲突、CAS、中文冲突指引、审计历史、重登持久化和精确恢复通过；
  - D6 `500`、畸形 `200`、匿名访问与读取恢复均失败关闭。
- child 五层权限 `3/3` 通过：readonly、no-write、no-menu 的菜单、路由、按钮、接口和数据层边界均符合夹具声明。maker/checker D2 用例因本轮未提供合法隔离提现单而如实跳过，未拼成通过结论。

### 2. D3 / D5 / D6 高风险写闭环

- D3 corrected child `1/1` 通过：非法负数 `400`；真实 IN `200`；同键同载荷回放 `200` 且无二次写；同键异载荷 `409`；覆盖率从红线下提升至约 `105%`。
- D5 corrected child `1/1` 通过：覆盖率恢复后 `balanceMaxRatio 0.80→0.81` 成功；同键回放版本不二增；异载荷键冲突与陈旧版本均 `409`；随后精确恢复 `0.80`，刷新和重登不漂移。
- D6 corrected child `1/1` 通过：后端已提交但浏览器响应被中断时页面停止展示旧牌价；稳定键重放只落一次；最终恢复 `26000 / 1.5 / 30`。
- D3 最终追加等额 OUT 补偿，保留不可变 IN、A2 审计及 A4/outbox 证据；补偿后从可见侧栏重新执行 D2/D4/D5 `1/1`，低覆盖下 D5 放大仍为 `422` 且原值未变。

### 3. 权限、合同与故障矩阵

- 覆盖 401、403、409、422、500、畸形 200、请求超时/中断、结果未知、幂等键复用和 CAS 冲突；写入口在权威数据不可用时失败关闭。
- D 域静态合同 `46/46` 通过：D1/D3/D4/D5/D6 前后端合同、权限夹具兼容、会话菜单与跨域预取约束均为绿。
- `npx tsc --noEmit` 通过。
- 本阶段没有修改产品源码、构建产物或运行中服务。

## D2 未完成项与严格 HOLD 处理

Final10 App H5 在 HTTPS `5176` 打开后停留空白骨架，控制台出现 `API_HTTPS_REQUIRED`；`/api/config/platform`、`/api/orders`、`/api/devices/earnings` 均没有发出请求。这证明失败发生在 App API client 的 HTTPS base 门禁之前，而不是 D2 业务 API 返回失败。

因此本轮只接受以下 D2 证据：管理端权威队列读取、匿名拒绝、五层权限和读失败关闭。以下必验链未执行，不得计分：

1. 普通 App 用户合法发起提现；
2. K4 风险投影与 J1 Kill-Switch 前置被真实消费；
3. PC maker 从可见 D2 提交，独立 checker 审核；
4. 重复提交、状态冲突、结果未知恢复；
5. 钱包、D4 账本、A2 审计、A4/outbox 与 App 终态消费核对。

本域不为 Final10 额外制造 K4/J1 跨域状态，也不修改锁定 App 包。待 Final11 修复同一 App 打包问题后，必须以新候选从真实 App 入口完整补跑 D1–D6，再决定是否评分。

## 验收载具偏差与闭环

首轮命令错误使用 `PLAYWRIGHT_BASE_URL=3304`，而 `playwright.config.ts` 只读取 `ADMIN_BASE_URL`，所以标注为 child 的 D3/D5/D6 实际落到主 PC `3002` 与主库。该批结果全部排除出 child 评分，并登记为已关闭的测试载具 P3 `D-AUTO-F10-001`，不是产品路由缺陷。

- `routing-probe.json` 以 child-only 账号证明 `3304→18120→child DB` 正常；同账号访问 `3002` 返回 `401`。
- 主库误写 D3 IN `932389.04` 已追加等额 OUT，目标净额 `0`；D5 恢复为 `0.80`，D6 恢复为 `26000 / 1.5 / 30`。
- 改用正确变量后，child D3/D5/D6 与补偿后回归全部重新执行并通过。

## 数据恢复与清理

| 核对项 | 主库 | child 库 |
|---|---:|---:|
| D 目标储备行 | `2` | `2` |
| IN / OUT | `932389.04 / 932389.04` | `932389.04 / 932389.04` |
| D 目标净储备 | `0` | `0` |
| D5 `balanceMaxRatio` / version | `0.80 / 5` | `0.80 / 9` |
| D6 base / spread / window | `26000 / 1.5 / 30` | `26000 / 1.5 / 30` |
| D 目标 object lock | `0` | `0` |
| Final10 D 幂等记录 | `13→0` | `13→0` |
| D3 immutable audit / outbox | `1 / 1` | `1 / 1` |

`B1_COVERAGE_SINGLETON.lck` 由本域在 `20:43:23` 原子取得，完成核验后于 `20:47:59` 验证 owner 并释放；释放后物理不存在，已通知后续 K3 使用者。可变 D 夹具和幂等记录已清理，不可变 audit/outbox 按审计边界保留。

## 原始证据

- `D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\D\final10-owner\core-main`
- `D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\D\final10-owner\permissions-main`
- `D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\D\final10-owner\child-core-corrected`
- `D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\D\final10-owner\permissions-child-corrected-artifacts`
- `D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\D\final10-owner\child-write-d3-corrected`
- `D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\D\final10-owner\child-write-d5-corrected`
- `D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\D\final10-owner\child-write-d6-corrected`
- `D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\D\final10-owner\post-compensation-child-corrected`
- `D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\D\final10-owner\routing-probe.json`
- `D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\D\final10-owner\terminal-integrity.json`
- App 打包阻断复用同一缺陷证据：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\E\final10-owner\app-e456-packaging-proof.json`、`app-e456\app-e456-failure.json`。

错误变量生成的 `child-core`、`child-write-d3`、`child-write-d5`、`child-write-d6` 与 `post-compensation` 目录仅保留为载具偏差和主库恢复证据，不计入 child 通过范围。

Final10 D Owner 受限证据共 `91` 个文件；按相对路径排序后对 `relativePath=SHA256` 清单文本计算的聚合 SHA-256 为 `0CEB776DB8021537DA519349C0093FFAA9CCF276E32BFAE5502C05E29026FA85`。

## 评分

- D 域初审：**HOLD，不评分**（D2 法定 App 成功链被 Final10 打包环境阻断）。
- D 域复审：未触发；不得在 Owner HOLD 时交由 E 签发通过。
- 本阶段执行自检：初审 `99/100`，复审 `99/100`；当前血量 `100`。

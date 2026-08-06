# G 域 Owner 初审报告（Final10；Final11 追加结论）

## Final11 追加结论（2026-08-01）

- 候选：PC Build `xwL3BUki3xjXtoLr7RsWb`（`3002`），后端 JAR `09BF09404F1F29A2110306E773C31529D3D1F835B04FAC5C34175FF8B467B66D`（`8110`）。
- G1–G4/G7 首次用户可见侧栏、刷新/重登、五层权限、匿名 401、畸形 200/500/超时、未知结果、确定性拒绝以及 G1 最小额下降红线补丁均已按 Final11 候选复验；G1 页面禁用 `20→19`，直调 API 返回 `422 COVERAGE_BELOW_REDLINE`，两个投影仍为 `20`。
- **HOLD，不签发分数。** 新发现 P1 候选 `G-FINAL11-001`：范围真源 App `D:\workspace\NX1.0\src\store\staking.ts` 明示 `MOCK-ONLY`，保留本地硬编码 APY/penalty/min 与 account-scoped storage；G1 跨端合同 `5/6`，因为 `src/api/staking-api.ts` 不存在。PC 与匿名公共投影成功不能替代真正 App 质押生命周期，因此 P0–P3 不为 0。
- 本轮所有可变 G 写均在金融产品单例锁内执行并经 finally/postflight 恢复；G1 min=`20`、活跃 G 对象锁=`0`。A2 审计 `77901–77908`、A4/outbox 及测试证据在受限目录 `bug-pic/.restricted/pc-full-acceptance-20260729-114336/G/final11-owner/`。未修改候选源码、未停止 `3002/8110`。

## 结论

- Run ID：`pc-full-acceptance-20260729-114336`
- 范围：G1 Staking、G2 兑换、G3 NEX 行情、G4 Genesis、G7 复投；范围真源为 `lib/nav/console-nav.ts`，共 5 个可见侧栏模块。
- 候选：PC `main@1d9dc8d` / Build ID `zGL97cq44U6qzzAKmh415`；后端 `main@f4a943e` / JAR SHA-256 `ED80116D6B7D7C025490C4EEC180D53F135D712DB0A4D5C89D6FA4D8D9A9F947`；App 使用不可变 `master@0e2178b` checkout。
- 当前状态：**HOLD，不签发领域通过分。** Final10 确认未关闭 P1 `G-FINAL10-001`，违反“P0–P3=0”硬门禁；轮换修复方为 H，修复后须由 G Owner 从登录入口完整重跑 G1–G4/G7，再交 F 以外的非 Owner 对抗复审。
- 本轮未修改共享产品源码、未停止主服务、未提交或推送 Git。

## 验收结果

| 验收面 | Final10 结果 | 结论 |
|---|---:|---|
| G1/G2/G3/G4/G7 PC→BFF→后端→App 静态闭环合同 | `23/23` | 通过 |
| readonly / nowrite / nomenu | `3/3` | 真实密码、正常 MFA、侧栏/路由/API/按钮/数据五层失败关闭 |
| 匿名管理面、受控 trusted-edge App 投影、B1 只读预检 | `2/2` | 管理面 401；无可信地域 fail-closed；受控 JP 投影为服务端权威 200 |
| 专属 A2/A4 reader 与跨域 C 拒绝 | `1/1` | A2/A4 200，越权 C 为 403 |
| 401/403/404/422、非法输入、重复提交、无菜单 | 通过 | 无成功主库业务写 |
| 畸形 200、G7 500、G3 超时/断网/结果未知及真实恢复 | `6/6` | 全部失败关闭 |
| 五模块结果未知同键保留 / 确定性 422 释放键 | `10/10` | G1/G2/G3/G4/G7 各 2 项 |
| G1/G2 隔离环境真实 UI、独立第二运营员、同键回放、异载荷冲突、App/A2/A4 | `1/1` | 测试本身通过；同时对抗路径确认 P1 |
| G3/G4/G7 可逆写、G3 双运营员 CAS、管理/App 投影和恢复 | `1/1` | 通过 |
| pageerror / 非预期 console error / 非预期 5xx / 真实 request failure | 绿色用例均为 0 | 缺陷复现中的受控 connection reset 不计为绿色零失败 |

首次用户载具两次从登录页经可见侧栏遍历五模块并逐页刷新；其最后一次同页退出重登受全局 `ADMIN_LOGOUT_IN_PROGRESS` 载具状态影响。该步骤未被冒充通过，已由独立权限载具的正常 MFA 退出重登覆盖。匿名载具同类 logout carrier 也由独立 request context 覆盖。

## `G-FINAL10-001`：G1 红线 API 可绕过

- 级别：**P1**。
- 前置：Final10 权威 G1 响应为 `redlineBreached=true`。
- 页面行为：`g1-staking.tsx` 的最小额编辑明确设置 `amplifiesWhen: "decrease"`。先将 `usdt30d.minStake` 从 20 收紧到 21 后，再输入 20，真实确认按钮保持 disabled；UI 正确把下降识别为 B1 红线下的放大操作。
- API 行为：同一身份直接向 `PATCH /api/admin/market/staking/pools/usdt30d/params/min` 提交 20，Final10 后端返回 HTTP 200 / `code=0` 并落库。`OpsNexMarketService.stakingParamLoosens()` 仅处理 APY 上升与 penalty 下降，漏掉 min 下降；因此绕过 UI 即可越过红线门禁。
- 数据证据：A2 audit `76829–76831` 记录 20→21→22→20，最后一次红线“恢复保护”仍为 SUCCESS；实际响应中断场景 audit `76853–76854` 再次记录 20→21 与直接 API 21→20。最终 `G.staking.min.usdt30d=20`，仅隔离库发生变更，主库保持 20。
- 对照：penalty 上调成功后，红线下尝试下调正确返回 `422 COVERAGE_BELOW_REDLINE`；说明覆盖率事实有效，缺口局限在 min 的后端放大判定，不是 B1 环境失效。
- 影响：脚本、被篡改客户端或直接 API 调用可绕过页面门禁，降低 G1 最小锁仓额；资金红线的页面层与服务层合同不一致。
- 原始证据：`G/final10-owner/disposable/results/.../trace.zip`（SHA-256 `99914B3779AE94FF86A2A4AD2860676932402792F3F2962397EB1BFFAB7B4F75`）、失败截图（`1DF7E949...494442`）、`snapshot-before.json`、`snapshot-after.json`、`g1-g2-disposable-lifecycle.json`。

## 隔离写入与数据核对

- 原子持有 `G_DB_CLONE_SINGLETON.lck`，并在 `B1_COVERAGE_SINGLETON` 不存在时执行 `mysqldump --single-transaction`；dump SHA-256 为 `B60BA1089DD75BA20A44E3BCBD61F4FB70FFE0A6D2EEAA12BF571EBD0F2E1832`。一致性 dump 完成后精确释放 G 锁。
- 隔离资源：数据库 `nexion_acceptance_20260729_114336_g_final10`、Redis `127.0.0.1:6391/0`、MinIO bucket `nexion-acc-20260729-114336-g-final10`、后端 `18130`、PC `3310`。资源清单同时绑定 Final10 Build/JAR 哈希与 `mfaBypass=false`。
- G1：min 由真实 UI 完成 maker 写、同键回放 200、异载荷 409、独立 secondWriter 写；最终经直接 API 回到 20，正是本轮 P1 复现。penalty 收紧成功，放松恢复 422。
- G2：fee 由 maker 与 secondWriter 连续收紧；同键回放 200、异载荷 409、红线下放松 422，管理/App 投影一致。隔离库销毁前值为 0.05。
- G3：非 active frame 可逆写与恢复通过；两个独立浏览器会话形成 CAS `200 + 409`，随后恢复。
- G4：royalty 可逆写、幂等冲突、管理/App 投影及恢复通过。
- G7：lockDays 可逆写、幂等冲突、管理/App 投影及恢复通过。
- 本轮新增 G 审计 26 条、canonical server-authoritative outbox 26 条，覆盖 staking、exchange、NEX curve、Genesis 与 repurchase。不可变 A2/A4/outbox 证据保留在受限快照；可变隔离库整体销毁。
- 11 张资金/钱包/账本表中 10 张前后行数与 checksum 一致。`nx_wallet_asset_adjustment` 出现 0→36，但 36 行均是克隆后出现的历史 C3 对象（旧创建时间、`c3-*` 幂等键），无 G actor、G Run 写或 G 账务副作用，且 checksum 未变；作为隔离载具观察记录，不计入 G 绿色不变量。

## 载具事件

1. clone attempt-1 因受限验收脚本 PowerShell 把 `$targetDatabase?useUnicode` 解析成错误变量名，导致 JDBC 库名异常；未启动 PC，已精确停止 Redis、删除空 bucket 和目标库，并保留失败日志。脚本副本改为 `${targetDatabase}?useUnicode` 后 attempt-2 成功。此项不是产品缺陷。
2. Final9 专用载具仍使用旧字段 `coverage.breached`，Final10 合同字段为 `coverage.redlineBreached`；已只修受限证据副本。A2 纯 reader 只有 A2/A4 权限，按行级策略不能查看 G 行；G maker 持 G 权限和 A2 read，改由 maker 验证 G 行，纯 reader 继续验证 A4 与跨域拒绝。两项均未改产品源码。
3. 上述载具修正没有放宽产品断言；反而保留并稳定复现了 min 下降应 422、实际 200 的产品 RED。

## 清理与证据

- 仅停止 G 专属 PID：后端 `25676`、PC `28796`、Redis `22044`；确认 `18130/3310/6391` 均无监听。主 `8110/3002` 未停止。
- 删除前确认目标库连接数为 0；随后仅删除 `nexion_acceptance_20260729_114336_g_final10`。MinIO bucket 删除前对象数为 0，删除后确认不存在；Redis runtime 和含凭据的临时 MinIO client config 已删除。
- cleanup 结果：`G/final10-owner/disposable/cleanup-final10.json`。证据哈希清单 `G/final10-owner/evidence-sha256.txt` 已复算 `10/10` 存在且匹配。
- `snapshot-before.json` SHA-256 `8DA13D9A44EF8A27045C02DA692A903B83721BD60FC3447918983CE6D71941FD`；`snapshot-after.json` SHA-256 `462F32DC1D29711841A2D0EE3D111E34E50935D72C86819E23601A1B508006F1`。

## 评分

- G 域 Owner 初审：**HOLD，不评分**；未关闭 P1 数量 `1`，不能达到“初审 >96 且 P0–P3=0”的签发条件。
- 本轮执行质量自评：初审 `99/100`，复核 `99/100`；该自评不替代领域验收分，也不构成非 Owner 复审。
- 当前血量：`100`。

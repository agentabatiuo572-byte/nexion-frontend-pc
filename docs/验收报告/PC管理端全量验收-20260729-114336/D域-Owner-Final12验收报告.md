# Final12 D 域 Owner 初审报告

运行：`pc-full-acceptance-20260729-114336`；候选：`Final12`；范围：D1–D6；执行：Owner；浏览器：Chromium、`workers=1`、trace 开启。

## 初审结论

**不通过，待修复验收载具后完整复验；初审 88/100。**

不是产品资金数据写错：已使用锁定 child 环境 `http://127.0.0.1:3304` → `18120` → `nexion_acceptance_20260729_114336_d`，确认 D1–D6 全部可由登录后可见侧栏到达，六个权威读接口均为 200。D5 在覆盖率红线下将放大方向写入正确拒绝为 422，且权威值未改变；D6 的真实 `PATCH`、同键重放、异载荷冲突和精确恢复分别为 `200/200/409/200`。

但完整锁定范围无法签发：五层权限、双运营员、D1/D2/D3 写链、A4/outbox 消费、App 真正授权链和结果未知完整复验没有重新完成。两条当前运行态 carrier 失败意味着不能用旧证据补齐。

## 必经资料与锁

- 已完整审阅：`D:\nexion\页面业务逻辑通顺性验收方法.md`、D 域 PRD（v1 第 6 章，D1–D5；D6 依最新产品更新日志与导航注册表）、`docs/后台产品更新日志.md`、`lib/nav/console-nav.ts`。
- `FINAL12-RUNTIME-LOCK.json`：PC child `3304`、backend child `18120`、MySQL child、Redis 14、App root `D:\workspace\.acceptance\pc-full-acceptance-20260729-114336-app-master` 均与任务一致。
- 写前创建并持有 `coordination\locks\FINANCE_SINGLETON.lck`。未触碰来源库 `nexion_acceptance_20260729_114336`。

## 已验证链路

| 项目 | 结果 | 原始证据 |
| --- | --- | --- |
| 首次用户可见侧栏 D1–D6 + 六个真实读接口 | 通过，均 200 | `03-d1-d6-superadmin-lifecycle.json` |
| D5 覆盖率红线 | 422、失败关闭、配置未变 | 同上 |
| D6 CAS / 幂等 / 精确恢复 | 200 / 200 / 409 / 200；牌价恢复 | 同上、trace |
| D1–D5 静态闭环合同 | 34/34 | `05-d1-d5-contracts.log` |
| 资金净额、D5 配置、D6 语义字段 | 写前后相同；D6 version 44→48 仅反映不可变审计/事件写入 | `00-prewrite-db-snapshot.json` 与 child DB 后查 |

当前 child DB 后查：净准备金 `0`、D5 `withdrawal.max_balance_pct=0.8`、D6 `26000/1.50/30`；活动对象锁 `1`，与写前相同。当前 Run 可定位 A2 留痕 4 条；不可变证据不删除。

## 缺陷 / 阻断

| 编号 | 级别 | 复现与影响 | 处置 |
| --- | --- | --- | --- |
| D-FINAL12-CARRIER-001 | P1 验收载具 | `d-child-owner-write-20260729.spec.ts` 登录函数在 superadmin 登录页等待 OTP/aside 竞争超时，页面仍停在账号密码页，D5/D6 原锁定写用例未执行。 | 修正用例：等待登录响应，再顺序判断 MFA 或壳层；禁止绕过 MFA。 |
| D-FINAL12-CARRIER-002 | P1 验收夹具 | `d-domain-nonowner-c-final6-core` 的 `final75_readonly` 在 child 返回 `401 ADMIN_CREDENTIAL_INVALID`，其余首次用户、故障矩阵与五层权限用例未运行。 | 重新发放/恢复 child 的 readonly、no-menu、no-write、maker、checker 与 final75 夹具后从登录页全量重跑。 |
| D-FINAL12-CARRIER-003 | P2 验收脚本 | D3 旧固定 voucher `PCRUN-D-RESERVE-114336` 已在 child 不可变账本存在，重跑返回 `409 VOUCHER_ALREADY_REGISTERED`。 | 每轮生成唯一 Run voucher，并在成功注入后经产品补偿路径追加 OUT 分录，再核对 A2/A4/D4/App。 |
| D-FINAL12-CARRIER-004 | P2 验收脚本 | D6 UI 结果未知探针未捕获 PATCH；其直接 D6 CAS 已闭环，但“后端已提交、响应中断→同键重放”未能重新取证。 | 先锁定实际确认按钮/请求，重新跑断响应探针；不得以直接 API 成功替代。 |

硬错误计数：**4**（均为 P1/P2 验收载具或夹具；本轮未证实产品 P0/P1 资金缺陷）。页面异常：`0`；已归档生命周期 JSON 中 console error：`1`，未含敏感凭据。

## 后续 Carrier 修复复验（Final12，未改写 Owner 初审结论）

本段记录在同一 child (`3304 → 18120 → nexion_acceptance_20260729_114336_d`) 内的载具修复结果；它不把上文的 Owner 初审 88 分改写为通过，也不以局部成功替代 D1–D6 全域复验。

| 原编号 | 修复与复验事实 | 当前状态 |
| --- | --- | --- |
| D-FINAL12-CARRIER-001 | `d-child-owner-write` 改为等待账号密码登录响应后顺序处理 MFA/壳层；同一账号每次 MFA 使用新的 TOTP 窗口，避免并发挑战复用。D3、D5、D6 在 Chromium/`workers=1`/trace 下完整通过（3/3）。 | 已修复 |
| D-FINAL12-CARRIER-002 | 使用受限 child superadmin 凭据，经真实 MFA 重新发放 FINAL75 normal-MFA fixture；fixture provision 通过（1/1）。原始 401 不再出现。 | 已修复 |
| D-FINAL12-CARRIER-003 | D3 voucher、Run 前缀和幂等键全部改为每次运行新值；成功 IN 后在隔离 child 账本追加等额 OUT fixture 补偿。复验行 IN/OUT 均为 `931146.43`，净额 `0`，无 `PROCESSING` 幂等残留。不可变 IN/A2/A4 证据不删除。 | 已修复 |
| D-FINAL12-CARRIER-004 | D6 路由探针限定同一路径 PATCH，真实后端 200 后中断浏览器响应；页面进入“写入结果未确认”，同键重放仅落一次，并用 CAS 精确恢复。导航取消豁免现要求失败后同路径替代 200，且替代响应序号必须晚于失败。 | 已修复 |

修复后的 Final75 D1–D6 核心包没有再因凭据 401 停止，但在 D3 `/finance/pool` 出现新的产品级阻断：已确认 session 含 `finance_d3_read`、菜单和路由均可见，页面仍进入“D3 数据异常”并不渲染“应付负债 · 9 类科目”。这不是登录、fixture 或导航取消豁免；按只读跨域合同，记为 **D-FINAL12-PRODUCT-001（P1）**。因此首次用户、故障矩阵、五层权限、双运营员、D1/D2、A2/A4/D4/C/K/J/App 的完整尾段不能被签发为通过，必须先修复该真实 D3 读页故障，再从登录页重跑锁定的 D1–D6 全范围。

修复证据：`D/final12-carrier-repair-e/owner-write-rerun2/`（D3/D5/D6 3/3）、`D/final12-carrier-repair-e/core/`、`D/final12-carrier-repair-e/playwright-final75-fixture-rerun/`、`D/final12-carrier-repair-e/playwright-core/`。类型与信号合同 `tests/d-nonowner-c-final6-signal-contract.test.mjs` 通过；`tsc --noEmit` 通过。

### D-FINAL12-PRODUCT-001 源码修复（待主控统一构建后复验）

根因已定位到 D3 的 `net-exposure` 读模型，而非 FINAL75 权限：当前 child 返回的 `series.reserveUsdt` 会在“当前储备倒推历史净流入”时成为负数。PC 正确把负资产当作协议非法并失败关闭，因而清空 D3 页面；把它转为空数据、放宽 normalizer 或给 FINAL75 额外权限都会掩盖根因。

修复将历史储备资产下限限制为 `0`，但继续以 `netExposureUsdt = reserveUsdt - liabilitiesUsdt` 暴露真实缺口；同时 D3 前端为并发加载加入 generation guard，旧响应不能覆盖较新的权威快照。新增后端回归先 RED 后 GREEN；`OpsTreasuryServiceTest`、B1/B2 controller 授权测试共 55/55 通过，D3 PC 合同与 typecheck 通过。真实 BFF 探针确认匿名读 `401`、FINAL75 写预测配置 `403`、FINAL75 读 `200`，未增加权限。

受限证据：`D/final12-product001-repair-e/repair-summary.md` 与 `d3-final75-raw-model.json`。锁定 child 仍为修复前 JAR/PC 构建，因此本段只记录源码与定向测试，不能替代主控统一构建后的 superadmin/最小 read、401/403/500/畸形 200、刷新重登、旧响应隔离及完整 D1–D6 Owner 复验。

## 命令与证据哈希

- `npm exec playwright test d-child-owner-write... --workers=1 --trace=on`：exit `1`，SHA-256 `D98276075F3DA2A9083BF70D5EE3FF7491D6B6F05E0290AEAFF15C113BFC4214`。
- 同脚本 D5/D6 筛选：exit `1`，SHA-256 `6B30CFC0C22986E73A079BE4CDAF1C865F8DBCD7F80D16FB274CFA33DF778C58`。
- superadmin 真实侧栏/D5/D6 生命周期：第一次成功产生 JSON；后续 D6 结果未知 carrier 复跑 exit `1`，trace SHA-256 `DDD28815530EE08253E48170935AB9E60E61C712172EEBF4256D5DE99E161D88`，成功生命周期 JSON SHA-256 `DE7949BFD9A8742231CE2D32A3789E114F2BE722D1CF85B3D7C395CBF6AEE883`。
- `d-domain-nonowner-c-final6-core... --workers=1 --trace=on`：exit `1`，SHA-256 `4E11B66B4163805D5978793A18AADB62760DF3C0BDF2E201B3AF998D5629993E`。
- D1–D5 contract：exit `0`，34/34，SHA-256 `68473658E2272BF8FB128AE99C9042A96EA506382F0598AF262FF86890A18282`。
- 写前 DB snapshot SHA-256 `1249D42D8E07E78A8FE17FA3E0009E618B4E26AC5D0AFA6C2B97E137E2B03605`；可见侧栏刷新截图 SHA-256 `8CC0FE6D213B66839F80969927F89E8FA239C2AE1EC8CE06503964D4867CD2BF`。

## 复验门槛

修复四项 carrier 后，在同一 child 锁和新唯一 Run 标识下，从登录页/侧栏完整重跑 D1–D6：权限五层、readonly/no-menu/no-write、双运营员、D1/D2/D3 成功写与补偿、D5/D6 CAS+结果未知、401/403/404/409/422/500/超时/畸形 200、A2/A4/outbox/消费者、D4、C/K/J、App、刷新/重登。完成后才可触发复审；本次不虚构大于 96 的通过分。

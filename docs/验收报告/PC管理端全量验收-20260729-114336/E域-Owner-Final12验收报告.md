# E 域 Owner Final12 初审验收报告

- Run ID：`pc-full-acceptance-20260729-114336`
- 候选锁：`Final12`，PC build `ABZKW7393ECWjhkaA_btM`，后端 JAR SHA-256 `2A3EEC48ACCE273CFDEA32AAA2D0ADC69CC7F9EA07B66126BDC42D5482083DD2`
- 运行面：PC `http://127.0.0.1:3002`，后端 `http://127.0.0.1:8110`，App 候选根 `D:\workspace\.acceptance\pc-full-acceptance-20260729-114336-app-master`
- 范围：E1 商品目录、E2 任务定价、E3 生命周期与 Trade-in、E4 订单、E5 运维、E6 算力配置；首次用户可见入口、刷新/退出重登、权限五层、失败关闭、幂等/CAS、双运营员、A2 审计、数据库、App 消费。
- 执行方式：Playwright Chromium，`--workers=1 --trace=on`。未使用隐藏 URL、mock 权威态、DOM 改写或 localStorage 作为业务权威。

## 初审结论

**不通过，82/100，不允许上线。** 初审阈值为 96；发现 1 个 P1。PC E1–E6 的首次用户与主要失败关闭、权限、E3/E6 写入-恢复链路均通过，但指定 App 候选在真实 H5 预览入口白屏，30 秒内没有发出 `/api/config/platform` 请求，无法证明 E6 配置被 App 实际消费。

硬错误计数：`1`（P1=1，P0=0，P2=1，P3=0）。

## 已通过的闭环

1. **首次用户 PC 可达性（E1–E6）**：带 MFA 的 E 域 maker 从可见“设备与商城 E”侧栏依次进入六个页面；全部读取为 HTTP 200，刷新和退出重登通过，浏览器错误为 0。
2. **故障与未知结果**：E1/E4/E5/E6 畸形 200 均显示失败态，撤销注入后由可见重试或刷新恢复；E2/E3 对 401、404、409、422、500、超时、断网和畸形 200 均失败关闭。E3 结果未知时保留弹窗，同载荷同命令键重试且未触碰真实配置。
3. **五层权限**：readonly/menu-no-write 对 E1–E6 均为读 200、写 403；no-menu 的菜单、直链、服务端读写均拒绝。权限会话刷新与重新登录后仍保持同一边界。
4. **E3 生命周期/CAS**：maker 可见入口创建 A2 提案，第二运营员直写 409、checker 直写 403、maker 自批 403、终态重放 409；同幂等键同载荷返回同工单、异载荷 409。批准后 E3 值 `30→31`，随后通过独立 checker 精确恢复 `31→30`。
5. **E6 写入/审计/恢复**：maker 和独立 checker 使用独立浏览器上下文；驳回探针无副作用，批准临时双语文案变更后可观察到变更，pending 时 writer 409/checker 403/self-approve 403，终态重放 409；恢复工单批准后原值精确恢复。A2 查询状态 200。
6. **DB 后核对**：E 域 pending/processing A2 工单为 0；E6 `nx_config_item` 9 行、E3 `nx_compute_e3_config` 44 行；设备订单 2、SKU 91、任务 1352。E3/E6 的测试内原值快照均已验证精确恢复。

## 缺陷

### [P1] App H5 指定候选白屏，E6 配置没有可观测的真实消费

- 复现：真实 Chromium 打开 `http://127.0.0.1:5175/?nx_device=off#/pages/login/login`。
- 实际：页面全白；等待 30 秒，网络记录中没有 `/api/config/platform`，故 `h5BaseFactor` 无法在 App 页面消费链路中被证明。
- 正确：首次打开应呈现登录/加载或可恢复错误界面，并实际请求、校验和消费 `GET /api/config/platform` 中的 E6 `onlineBonus.h5BaseFactor`。
- 影响：用户无法进入 App；E6→App 消费闭环缺失，阻断本轮验收。
- 原始证据：`E/final12-owner/test-results-app-e6-consumer/.../test-failed-1.png`，SHA-256 `06142729DCC990A95F65AFC66929C5298D309433961DCEBF22D8653972232587`；trace 和 video 同目录。
- 建议修复：定位 H5 预览的启动/路由初始化异常，修复后从同一入口复验页面可见性、`/api/config/platform` 200、响应 `h5BaseFactor` 与 E6/DB 同源，并完成刷新与重登复验。

### [P2] A4 outbox 没有本轮 E 域可消费事件，不能把 A2 工单成功推断成 A4/App 已消费

- 实际：`nx_event_outbox` 最近 30 分钟 E 事件计数为 0；E3/E6 测试同时记录 checker 对 A4 的跨域访问为 403。A2 工单、E3/E6 数据库恢复和 PC 页面均可证明，但不能替代 A4 outbox/App 消费证据。
- 正确：若产品承诺 E 配置变更驱动 A4/App，应产生可追踪的授权事件并由 App 实际消费；若不承诺，应在规格和页面中明确边界。

## 关键原始命令与退出码

| 命令 | 退出码 | 结果 |
|---|---:|---|
| `npx.cmd playwright test tests/e2e/e-domain-final-nowrite-owner-20260729.spec.ts --project=chromium --workers=1 --trace=on` | 0 | 5/5 passed |
| `npx.cmd playwright test tests/e2e/e6-maker-checker-20260728.spec.ts --project=chromium --workers=1 --trace=on` | 0 | 1/1 passed |
| `npx.cmd playwright test tests/e2e/e-domain-nonowner-d-20260728.spec.ts --project=chromium --workers=1 --trace=on` | 0 | 2/2 passed |
| `npx.cmd playwright test final12-e1-e4-e5-e6-mfa-fault.spec.ts --config ...playwright.final12-e.config.ts --workers=1 --trace=on` | 0 | 1/1 passed |
| `npx.cmd playwright test tests/e2e/e-domain-owner-20260728.spec.ts --project=chromium --workers=1 --trace=on` | 1 | 旧脚本只支持密码登录，Final12 主账号 MFA 后无法进入；不计产品缺陷，已由 MFA 真实可见侧栏脚本替代 |
| `npx.cmd playwright test final12-app-e6-consumer.spec.ts --config ...playwright.final12-e.config.ts --workers=1 --trace=on` | 1 | P1：H5 白屏且未观察到平台配置请求 |

## 证据索引与 SHA-256

- Final12 运行锁：`candidate-rebuild-final12/FINAL12-RUNTIME-LOCK.json` — `A51033B0892F3625941D2C4D2015DCD5800AD05812EFB453CA495F44177C2142`
- E1–E6 无写走查结果：`E/final12-owner/pc-nowrite/owner-nowrite-result.json` — `36C055CC0533FC399EAA9CEEDC3096A80AF45FFAC9AB986171FB4EC51975B1A9`
- E6 maker/checker 结果：`E/final12-owner/e6-maker-checker/result.json` — `39A151A6C646BEA7B5D0907F568822B54BD6FD3E280E23BC546CCA53C3B60342`
- E3 CAS/恢复结果：`E/final12-owner/e3-cas/e006-result.json` — `24ED831ECA3F5606242813DA00EA4790C0E850014B83D0B42525B41459CF4C1E`
- E3 未知结果保护：`E/final12-owner/e3-cas/e3-unknown-result.json` — `382B73FD5A5054300647E6A7BC3E325B35BA1BBFC28B8ED8EDADA98FF2A82CD9`
- MFA E1/E4/E5/E6 故障关闭：`E/final12-owner/e1-e4-e5-e6-mfa/final12-mfa-fault-result.json` — `47B11FDFA9ED1EB0DE7AC19D43449D4AEF53A8E7712FBD4311EF0A7D767F4929`

## 评分

| 维度 | 分数 | 说明 |
|---|---:|---|
| 页面定位与业务对象 | 9/10 | E1–E6 入口和对象可辨识 |
| 数据来源与一致性 | 12/15 | PC/DB 已证，App 消费未证 |
| 操作闭环 | 13/15 | E3/E6 写入、A2、恢复闭环；E4 无本轮写单全生命周期 |
| 真实用户走查与路径可达性 | 7/10 | PC 通过，App 白屏 |
| 状态机 | 9/10 | E3/E4 可读，E3 CAS 已证 |
| 权限与安全 | 10/10 | 五层边界和匿名 401 已证 |
| 表单及控件合理性 | 7/8 | 失败关闭与结构化校验已证 |
| 文案、状态反馈与多语言 | 6/7 | PC 反馈可理解；App 未呈现 |
| 异常处理 | 4/5 | PC 完整，App 无可恢复出口 |
| 审计、幂等和回滚 | 5/10 | A2/幂等/CAS/恢复已证；A4 outbox/App 消费未证 |
| **初审总分** | **82/100** | **低于 96，FAIL** |

## 快照与清理

E3、E6 写入均以读取到的原始值作为测试内快照；两条恢复工单均终态批准且 `restoredExact=true`。后核对 E 域无 pending/processing 工单。没有修改产品源码、共享台账或提交推送。

## 复验前置条件

1. 修复 App H5 白屏并使指定 App 候选从真实入口发出并消费 E6 平台配置。
2. 明确并落实 E→A4 outbox→App 的消费合同，或明确其不属于该链路；前者必须提供同一事件的 outbox、后端和 App 真实浏览器证据。
3. 修复后由独立复审重新从可见入口执行完整 E1–E6 与 App 流程，不得复用本轮通过结论。

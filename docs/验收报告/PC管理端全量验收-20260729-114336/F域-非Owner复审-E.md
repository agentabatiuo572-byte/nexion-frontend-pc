# F 域非 Owner 对抗复审报告（E → F，Final6）

## 结论

**不通过，不签发。** Final6 上 PC 管理端 F1–F5 的真实浏览器、受控写、权限与失败关闭证据均通过；但关联 App 消费链路的两项锁定合同失败，说明 App 未实际消费 F1/F3 的服务端权威事实。该问题属于产品缺陷而非验收环境故障，登记为 `F003/P1`；在轮换修复并从最终候选重新完整复审前，不能给出大于 98 分的复审结论。

## 锁定候选与边界

- Run ID：`pc-full-acceptance-20260729-114336`；PC `http://127.0.0.1:3002`，Build `njacAG-OYV84-mfOdWA9v`、PID `22220`；后端 `http://127.0.0.1:8110`，JAR SHA-256 `93A9B39EB8C3F1F9C425D34F6D68ECBCEEF87744794A0F7D684C14F0307AF92C`、PID `24648`。
- 使用主隔离 MySQL `nexion_acceptance_20260729_114336`、Redis DB `13`；启动时复核了 Build、JAR 与两个进程均匹配。前端 HTTP `200`；无认证 health 请求按后端策略返回 `401/AUTH_REQUIRED`，没有被误记为可用性失败。
- 专属 actor manifest：`A/final-fixture-admin-window/final-domain-checkers.json`；权限夹具：`A/domain-permission-fixtures/F.json`。F maker、F1 checker、F2–F5 checker、A6 reviewer 的四个身份必须互异，运行中的角色/叶菜单/authority 断言通过；`F_WRITE_BYPASS=false`。
- 写操作仅限 F 受控配置与验收前快照恢复；未触碰非 F 配置、资金单例或非 F 业务对象。所有 Playwright 包均为 `workers=1` 且通过独立 `--output` 写入本域受限证据目录。

## 已通过的对抗性验证

- 首次用户从登录页、可见“分销与团队”侧栏逐一进入 F1–F5，服务端读取、空态、确认取消、跨域入口、刷新、浏览器返回、退出重登、匿名读写拒绝均通过：`4/4`。
- 墨菲失败关闭：F2 上游 `500`、F3 超时、F API `404/422` 均显示可恢复的失败面、无副作用并能恢复：`3/3`。
- 五层权限：readonly、nowrite 对 F1–F5 均可读但按钮和接口写均 `403`；maker 可读、刷新、重登；nomenu 无侧栏且路由/API 读写均 `403`：`4/4`。
- F1 真正的 maker/checker/A6 对抗闭环通过：maker 自批 `403`、A6 reviewer 跨域决定 `403`、同对象锁 `409`、同键重放、异载荷 `409`、CAS 恰一终态成功；上游已提交后中断响应时显示“结果暂不确定”，以相同 Idempotency-Key 重试并回放同一 operation。A2 有审计，F1 文案操作对 A4/D4/B1/L4 的不应发生边界均为 `0`，独立 finally 后 pending `0`、原值精确恢复：`1/1`。
- F2–F5 可见成功生命周期通过：F2 `30→31→30`、F3 `已启用→已关闭→已启用`、F4 `100→101→100`；F5 两个 `ANOMALY_CONFIG/SUCCESS` 操作各有一条审计和一条 A4 outbox。两项 F5 临时物理配置行经精确匹配删除恢复为不存在，非目标配置 fingerprint 不变，immutable 审计/outbox/commission operation 保留：`1/1`。

## F003 / P1：App 未消费 F1/F3 服务端权威事实

- 复现：运行 F 域 8 组锁定合同，结果 `37/39 PASS`、`2 FAIL`。
- F1 合同 `App remote mode reads V-Rank ladder and member progress from backend` 失败：`D:\workspace\NX1.0\src\api\v-rank-api.ts` 不存在。
- F3 合同 `App remote F3 consumes the authenticated server snapshot and clears stale account facts` 失败：`D:\workspace\NX1.0\src\api\commission-config-api.ts` 不存在。
- 只读源码核对确认 `D:\workspace\NX1.0\src\api` 目录不存在；`src/store/v-rank.ts` 只保留生产接口说明注释，未发现 `remoteApiEnabled` 或权威 ladder/current 调用；同样未发现 F3 的 `refreshCanonicalBinary`、`binarySnapshot` 或 `/api/team/binary` 远端消费与失效清空实现。
- 影响：PC/A2 成功操作不能闭环证明 App 展示的是后端真实 F1/F3 状态；账号切换或失败时存在继续展示本地/陈旧事实的风险。该问题不应以放宽合同、伪造响应或静态 mock 掩盖。
- 处置：由轮换修复 Owner G 在 App 中补齐严格响应校验、登录态权威读取、账号切换/失败清空及关联页面消费；随后运行 App type-check/H5 build、F 合同 `39/39`，并以新的锁定候选完整重跑本报告所有 F1–F5 非 Owner 波次。

## 受限原始证据

- `F/final6-nonowner-e/f1/result.json`：SHA-256 `658C9BCA99581A248371718D2C82A5817F7712D5829CDCEF0D11EF24B4814278`；F1 trace：`BE64B96735A3CFB8CB77CAA56772AFCE4FC6F3485BA057CCA79E3756727F62E6`。
- `F/final6-nonowner-e/f25/f25-success-cleanup.json`：SHA-256 `61D537D130D6C70CCD8CC77497B65562B8396B6D6D841A8C73F07995AE79CC66`；F2–F5 trace：`612CA622587B71EB37002129B3EA59EE2C914C67554EA0597ED2870D730579F3`。
- 可见侧栏/刷新/重登/匿名 trace：`D122D06EAF71D6DE87DA5A3A860F2B1C3E191ABFB3FA4A0374887F224D464C8D`、`C6DBE3C9F82329E52A3D705EB821C51897B384F7A74F4B6772E94EC20463647F`、`9C5F77E6446E5E6E6D5B38036347281EC7CC22DA4C14F9C52E8D540CE3EE61C6`。
- 失败关闭 trace：`DF97816861EA20AC5FAE560FE37CEC0B98F2E7E3CA5371C23E4660B1A65D9FC0`、`23BCF9C822CC64D09DF5768FC943DB5CFCC58182087D99134A5201BC79BDD96F`、`F09A9ED5E2BE968173D65814D3B63204E046832D8AE7E2AE7DCFE04698849587`。
- 权限 trace：readonly `94D3F9540FC58A936754A614474263893CAACBA1B55D0AE9FC10FABB694806DB`、nowrite `C77F9C7777CBE77BA0612706BAE9D0FD6A977571087E57D3DBF5C28E02B3F8C9`、maker `69B33E545BDD8EC945FED0D6185CD002B0E22D37BD427BE2504944586FC62EA6`、nomenu `736145163F1E26204EC03725003B36EE0F10984B8D44409765F3D618A4F1BEE4`。

原始 trace、截图、视频及认证材料仅保留于 `D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\F\final6-nonowner-e`，本公开报告不复制凭据、TOTP、Cookie、Authorization 或原始请求体。

## 评分

- 非 Owner 初审：`94/100`，未达到 `>96`；扣分原因仅为 F003/P1，未关闭 P0/P1/P2/P3=`0/1/0/0`。
- 非 Owner 复审：**未触发**。必须先完成轮换修复与从登录入口的完整重跑；不得将本轮通过的浏览器子项拼接成最终通过结论。

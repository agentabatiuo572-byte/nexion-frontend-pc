# F 域 A2 提交接稳定命令号(pending store)

状态:Implemented(待主人确认)· 分支 pkg/restore-mid-tiers · 定级 M(钱路径)

## Why

restore-mid-tiers 包 skeptic 审计记档项(P2,「记档不修 · 另开任务」):F 域 propose 调用不传
commandKey,幂等号在 a2-client 每次现铸。outcome-uncertain(网络断 / 503)后重试 = 换新号新建
提案,后端目标锁只能挡「第一笔已落库且票仍在途」的情形;票被快速执行后重试即重复动作
(重发派发单 = 双倍打款)。K1 / i3 / i4 / j3 / k4 / k5 已有成熟范式(共享 pending store,
sessionStorage + 24h TTL)。

## What changes

- `app/components/domain-views/f-view.tsx`:
  - 模块级 `createSlotAttemptStore({ storageKey: "nexion-admin-f-commands-v1" })`。
  - 新增咽喉 `proposeStable(slot, inputFingerprint, spec)`:resolve 复用/铸号 → propose 带
    commandKey → 成功 forget;catch 里非 outcome-uncertain(鸭型守卫 `isA2OutcomeUncertainError`,
    对齐 propose-or-execute/k2 判据,防双 bundle 类身份分裂)才 forget。
  - **四个 A2 提交口全部改走咽喉**(任务原点只点名 proposeFConfig,回源发现同文件另有三处直调
    propose 的资金动作,同病同修——审计原文本就是「整域接 pending store」):
    | 提交口 | 槽位 | 输入指纹 |
    |---|---|---|
    | proposeFConfig(F1-F5 调参 + dispose 共用) | `f-config:{key}` | [value, reason] |
    | proposeVRankOverride(F1 晋降级) | `f-vrank-override:{userId}` | [targetV, direction, reason] |
    | proposePayoutAction(F1 重发/冲正) | `f-payout-action:{payoutId}` | [action, reason] |
    | proposeF4Settlement(F4 池结算) | `f4-settle:current-week` | [reason, 日键] |
  - f4 指纹带**日键**(skeptic 裁决采纳):结算是周期性重复意图,上一周期已决议的票被 24h 幂等
    回放会把新结算静默吞掉;日键把窗口压到当日,在途期间由后端 current-week 目标锁兜底。
  - onConfirm 兜底 catch 对 outcome-uncertain 不再冠「提交失败」(skeptic 裁决采纳):提案可能
    已生效,冠失败会诱导操作员换渠道重做造成重复动作;非 uncertain 失败话术不变。
- **为什么 SlotAttemptStore 而非 K1 朴素 store**(对派单修法的一处偏离):F 域调参带自由输入值;
  朴素 store 按槽位无条件复用,会把「同槽位新输入」(改值重提;同一佣金事件先冻结后解冻)当成
  上一次的重复提交,复用可能已被后端消费的号 → 真操作被静默吞。SlotAttemptStore 语义 = 同槽同
  输入才复用,换输入铸新号弃旧号,正是 i3/i4/j3/k4/k5 现行范式。K1 不踩此坑是因为其槽位钉了
  version 且动作目标态固定。
- `scripts/pending-idempotency-key-sentinel.mjs`:MIGRATED += f-view.tsx(钉 import + 调用**存在性**
  (子串级);表达式级接线由下面的契约门钉——哨兵子串判据可被注释满足是全舰队 29 条共有形态,
  硬化另行记档)。
- `tests/f-pending-store-contract.test.mjs`(新,自足只读本仓)+ `scripts/verify.mjs` 挂齿轮
  「F pending-store contract」:
  - 静态半钉**表达式级接线**(对齐 B5 现行标准):resolve 接线 / spread commandKey / 鸭型守卫 /
    四族「槽位+指纹」完整调用表达式 / `await propose(` 直调计数恒 1;判定跑在剥注释文本上
    (先归一 CRLF——JS 正则 `.` 不匹配 \r,行尾 \r 会让行注释剥除静默失效,红测探针实测抓到)。
  - 运行时半用**真 store 代码**跑 F 槽位/指纹形态:uncertain 同号重试 / 成功清槽 / 冻结→解冻
    换号弃旧号 / 异事件异派发单不撞号 / f4 日键轮换。
  - 与 f-domain-contract 分家的原因:后者混有 4 条硬读兄弟仓的 FE-BE 用例,进 verify 会被
    「缺仓即跳」机制整齿跳过,门就空转了。

## 对抗审计裁决(两 skeptic:接线正确性 / 全仓范式 parity;main 回源逐条裁决)

**当场已修**:
- 契约门只钉字面量不钉 resolve 接线与指纹构成——「现铸不复用」原样回退时 9 项判定全绿
  (parity skeptic P1,probe 实测)→ 重焊为表达式级 + 三条 probe 路径(resolve 旁路 / 换槽注释
  走私 / 桩+注释)进红测清单,14 变异全部按预期红/绿。
- 行注释剥除器在 CRLF 文件上从未生效(`.` 不匹配 \r)→ 归一后修复,红测复验。
- 门的四类合法重构误红(i4 同款多行排版 / 花括号守卫 / 局部变量名 / 块注释字面量)→ 针对性放宽
  (\s* 容排版、块注释纳入剥除),3 条反误红绿测钉住;局部变量名仍钉死(响亮方向,对齐 B5)。
- f4-settle 槽位/指纹无周期身份 → 指纹加日键(见上)。
- 咽喉 instanceof → 鸭型守卫;onConfirm 兜底 catch uncertain 话术(见上)。
- 文档表述「哨兵回退即红」过强 → 改为如实分层(哨兵=存在性;契约门=表达式接线)。

**记档不修(既有面/共享设计,另开任务)**:
- F 域 **f1-client 直写通道**不在稳定命令号保护下(与本次 propose 面平行的另一族):
  `reverseF5Commission` / `reissueF5Commissions`(重发=打款)/ `suspendF5UserCommissions` /
  `updateF5AnomalyConfig` / F1 阈值与奖励 CRUD / `executeF3Settlement`(`stableIdempotencyKey`
  形参存在但全仓 0 调用方=烂尾)——每次现铸号,且 f1Request 网络错误不包装。后端对部分 scope 有
  requestHash 去重(本机缺仓不可验证),f5 reverse/reissue/suspend 不在已证清单。
  另:`updateF*TeamConfig` 5 函数全仓 0 调用方 = 死代码兼潜在旁路。
- F 域契约无 version 字段(f1-client 全文 0 处 version)→「基于旧快照的同输入重提被误判为重试」
  残留(冻结→他人解冻→同理由再冻结被幂等回放吞);铁律「并发≠重复:要 CAS 不是幂等键」的下一个
  未覆盖面,需后端供 version 后另开任务(同分支 G4 已按此补 expectedTiersVersion 可作范本)。
- 多字段调参(param-multi 循环)mid-loop uncertain 后重试,已成功字段会重复提案或被目标锁卡断
  ——循环无「已成功字段跳过」记忆,属该弹窗流程既有结构,改法越出本包。
- a2 家族对「结构化 5xx JSON(无 unknown 头)」归确定性失败,与 stable-mutation 家族(5xx=unknown)
  口径不一致——a2 全家族既有语义(K1/i4 同暴露),统一分类需动共享层。
- 共享 store:SlotAttemptStore.resolve 只读 sessionStorage,隐私模式/配额满时内存 fallback 对
  槽位式调用方是死代码(同会话重试也铸新号且无告警);`remember` 滑动续期可存活超过后端 24h 窗;
  登出/换操作员不清 sessionStorage 命令记录(B 复用 A 的号,审计归属错位)——全部为 29 个迁移面
  共有设计,硬化归平台专项。
- 哨兵 MIGRATED 子串判据可被注释满足(全舰队形态)——F 面已由表达式级契约门补位,其余面硬化另计。
- 指纹含自由文本 reason:uncertain 重试前改一字理由 = 弃号铸新(方向性取舍,toast 已明示「保留
  当前弹窗与输入」;排除 reason 会反过来吞掉理由修订)。
- 提案被驳回后 24h 内同输入重提会被幂等回放吞掉(需后端 replay 带状态透传/对账面,平台级)。
- storageKey 命名 `nexion-admin-f-commands-v1` 为全域一把(舰队惯例是 L2 模块粒度)——多族共用
  一把键靠槽位前缀分命名空间符合 store 头注释与 c3/i4 先例,无撞名,不改。

## Out of scope(完整清单)

- 上节「记档不修」全部条目(F 直写通道族 / version-CAS / param-multi 循环 / a2 5xx 分类 /
  共享 store 三项 / 哨兵硬化 / 驳回回放 / 命名)。
- 后端按 Idempotency-Key 的去重实现(契约既有,本改动只保证客户端稳定供号)。
- E 域(28 处 propose 经自有包装,弹窗态现铸号,刷新即丢)与 H8(同款半措施)——同病相邻域,
  与 F 直写通道族合并为后续专项。

## Done-when(全部已回测)

1. ✅ 四个 A2 提交口全经咽喉,直调计数=1;接线钉到表达式级 —— f-pending-store-contract 静态半绿。
2. ✅ uncertain 保留同号 / 成功收敛清槽 / 换输入换号弃旧号 / 异目标不撞号 / f4 日键轮换 ——
   运行时半用真 store 代码验绿(非 needle)。
3. ✅ F5 dispose(paramKey=`F.commission.{eventId}.status`)复用同门、eventId 入槽不跨流水撞号 ——
   f5-commission-hold-contract 6/6 + 契约门槽位表达式断言;两 skeptic 均未证伪该链。
4. ✅ 门会真咬人:红测 14 变异(7 基础 + resolve 旁路 / 注释走私 / 桩+注释 3 条 probe + 日键 +
   3 条反误红)全部按预期红/绿,还原字节一致,终态复绿。
5. ✅ tsc 0 错;幂等哨兵 PASS(已迁 29 文件);f5-commission-hold 6/6、f-ui-permission 5/5 绿;
   `npm run verify` 全绿(新齿轮「F pending-store contract」入列;缺兄弟仓齿轮如实标注跳过)。
6. ✅ 「网络断」头号场景闭环:a2-client 仅在带 commandKey 时把 fetch 抛错/响应不可读/代理
   unknown 头升为 outcome-uncertain——改动前 F 不传号该分类从不生效,改动后传号+保留+同号重试
   全链打通(接线 skeptic 五问直答第 3 问,代码证据 a2-client.ts:328-353 + 代理 route.ts:191-194)。

已知环境边界:本机无 nexion-backend(仓与服务均缺)→ 浏览器端全栈「断网重试同号」实景只能在
有后端的环境自验:F 域改任一参数 → 断网提交 → toast 含「同一命令号」→ 恢复网络原样重试 →
A2 队列应只有一张票;devtools Session Storage 的 `nexion-admin-f-commands-v1` 成功后消失。

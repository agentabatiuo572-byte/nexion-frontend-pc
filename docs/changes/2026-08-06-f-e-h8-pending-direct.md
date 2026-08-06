# F 直写通道 + E/H8 迁稳定命令号 store(2026-08-06)

**状态:Aligned**(主人 2026-08-06 拍板:新开 `pkg/f-pending-direct` 分支 + 按 9 步大纲开工)
**出处**:pkg/restore-mid-tiers 交接存档第四节「任务 A」(`2026-08-06-f-pending-store.md` 记档不修项)

## Why

三族高敏写路径的 Idempotency-Key 仍是「每次现铸 / 弹窗态半措施」:提交结果未知(断网 / 响应丢失)后
刷新重试会铸新命令号,后端无法去重 → 重复打款(F5 重发)/ 重复处置 / 重复提案。
前一轮存量清仓(65f87bc)已迁 29 面,这三族是剩余欠账。

## What changes

1. **F 域直写通道**(`lib/admin/f1-client.ts`):新建零依赖咽喉 `lib/admin/f1-stable-write.ts`
   (SlotAttemptStore,storageKey `nexion-admin-f-direct-commands-v1`),**9 个**写函数全部接线
   (F5 冲正 / 重发 / 暂停 / 异常配置、F3 结算、F1 阈值、F1 奖励增删改),槽位带目标对象 id;
   `f1Request` 补 outcome-uncertain 分类(网络断 / 响应不可读 / 上游 unknown 头或 message /
   **5xx** / 「200+code=0 但 data 缺失」→ 结果未知保号;4xx 与 200-但业务码非 0 → 确定性失败弃号;
   401 照常触发登出且排除在未知之外);写路径无稳定号直接拒绝(`F1_WRITE_REQUIRES_STABLE_KEY`);
   删 `idempotencyPrefix` 现铸后门、`updateF*TeamConfig`×5 死函数、`executeF3Settlement` 零调用死形参。
2. **E 域**(`e-view.tsx`):propose 包装咽喉接 store(slot=动作|目标,指纹=[after,command,target]),
   28 处调用点零改动;弹窗打开时现铸删除。storageKey `nexion-admin-e-domain-commands-v1`。
3. **H8**(`h8-referral-rewards.tsx`):现铸挪进提交回调内走 store(指纹带 expectedVersion);
   「执行真实结算」按钮同病顺手接上;`h-client` 补 H8 uncertain 分类(含 5xx,与 F 域同口径)。
   storageKey `nexion-admin-h8-commands-v1`。
4. **弹窗文案**(`operation-confirm-error.ts`):泛化 `*OutcomeUncertainError` 族通用「结果未知,
   先核对审计再决定是否重试」文案(A2 专属文案保留)。**刻意不承诺「系统自动复用命令号」**——
   A3/A1 也带 commandKey 却每次现铸,对全族承诺就是骗运营去重试。

### 三族共同不变量(审计后收敛)

- **指纹一律不含 reason**:理由是审计元数据不是意图。运营在「结果未知」后补一句理由再点是极自然的
  动作,理由进指纹会换新号 → 同一笔动作执行两次。改理由复用旧号最坏只是审计记原措辞。
- **确定性失败只在「本次是全新尝试」时弃号**:复用来的号说明上次结果未知,这次的 4xx/409 证明不了
  那次没落地(范式同 `d-client` / `user360-client` 的 `!pendingKeyBeforeRequest` 守卫)。
- **鸭型判据不用裸 `instanceof`**:打包边界下失真方向恰好是「该保号却弃号」。
- **命令号原样出手**:resolve 出的号必须逐字进 `Idempotency-Key`,任何加工都让后端按别的号去重。
5. **哨兵**:MIGRATED += `f1-stable-write.ts` / `e-view.tsx` / `h8-referral-rewards.tsx`。
6. **契约门 ×3** 挂 verify(静态半 CRLF 归一 + 剥注释后表达式级;运行时半真 import 咽喉 / store 替身)。

### 与派单的偏离(回源事实驱动,已获主人确认)

- 范式参照 `f-view.tsx proposeStable` + `f-pending-store-contract.test.mjs` 在未合并的 restore 分支;
  改用主线同构参照(i4-trust + pending-mutation-migration-contract),并从 restore 分支读到参照原文。
- H8 结算按钮同病顺手接上(派单只点名 editParam)。
- H 域 client 无 uncertain 分类,H8 提交函数补最小分类(不动 H 域全家)。
- 不复用 `stable-mutation.ts` 通用执行器:它是「指纹拼 key」朴素形态,改回原值会复活旧号,
  正是派单点名要避开的坑。

### Out of scope(记档不修 · 主人 2026-08-06 拍板留任务 B)

**共享基建**(交接存档任务 B):① 全仓 5xx 口径四套(本次把 F/H8 修成「5xx 保号」,与 stable-mutation
一致;a2-client / k-client / k6-client 仍是「5xx 弃号」)· ② `SlotAttemptStore.resolve` 只读
sessionStorage 不读内存 Map,隐私模式 / 配额满时静默退化成每次现铸且无告警 · ③ 同槽位并发提交
互相抹号(要 CAS 不是幂等键)· ④ TTL 滑动续期可超后端 24h 窗 · ⑤ 登出不清 sessionStorage 命令号 ·
⑥ 哨兵 MIGRATED 判据是「文件里至少有一处用了 store」而非「文件已无内存态命令号」——
`k1-multiaccount.tsx` 已在名单里却仍有三个 draft 的组件态命令号(`useState<T | null>(null)` 在词表盲区)。

**同类未覆盖的写面**(审计全仓扫出,均非本次引入):
- **E5 直写通道**:`e5-ops.tsx` 的「激活 / 取消激活 / 暂停该用户」走 `e5-client` 的现铸通道
  (同一行界面上「强制激活 / 解绑」走提案通道已覆盖)。同族还有 e1(14)/e2(11)/e3(4)/e4(7)/e6(5)。
- **F 域 A2 提案通道**:`f-view.tsx` 的 `proposeFConfig`(覆盖 F1–F5 配置)与 `proposeF4Settlement`
  (资金/放大)不传 commandKey,连带 a2-client 四处 uncertain 判据全部未启用 ——
  **正是未合并的 `pkg/restore-mid-tiers` 包在修的东西**,不能在此重复动。
- 其余 usePropose 无稳定号的面:c2-actions / h1-phase / h2-trial / h5-daily-milestones / i6-i18n。
- `d-client.ts` 的 storageKey 拼成 `nexgrid-admin-*`(全仓其余 20 个都是 `nexion-admin-*`)。

**verify 齿轮位次**:齿轮表是 fail-fast,缺兄弟仓 `nexion-backend` 的机器上第 14 齿硬崩,其后 21 齿
(含本次三个新齿与既有的 A2/幂等哨兵/两个 pending 契约门)全部不执行。这不是「跳过」是「硬停」。
本轮门结果由逐齿单跑取得,已如实记录;是否重排齿轮表(把零外部依赖的齿全部前移)留待主人拍板。

## Impact

- 页面:F1/F3/F5 tab、E 域全部 tab、H8;行为仅在「提交结果未知后重试」路径变化(复用同号被后端去重)。
- store:新增 3 个 sessionStorage 键,`nexion-admin-*` 命名空间。
- PRD:无产品规则变化,不动 PRD;完工后追产品更新日志一条(待主人确认)。
- 不变量:高敏动作确认 + 理由 + 审计 + 24h 幂等 —— 本任务强化幂等一环;mock 可接真(命令号协议后端同款)。

## Done-when(P6 逐条回测)

1. F5 冲正在网络错(fetch reject)后重试,发出的 `Idempotency-Key` 与首次一致;成功后同输入再提是新号。
   (契约门运行时半 + 红测证)
2. E 域任一 propose 在 A2 结果未知后**刷新页面**重开同弹窗同输入提交,命令号与刷新前一致。
   (契约门静态半钉接线 + store 运行时半证;组件不可 node-import,浏览器实景受缺兄弟仓限制,报告说明)
3. H8 调参指纹含 expectedVersion:version 变了同值提交必换新号。(契约门运行时半证)
4. `updateF*TeamConfig`×5 与 `idempotencyPrefix` 后门在 f1-client 中出现次数 = 0。(契约门静态半证)
5. 红测:resolve 旁路 / 半措施回退 / 注释走私 / storageKey 撞名等 ≥10 变异逐条使门变红,还原后全绿。
6. `npx tsc --noEmit` 0 错;`npm run verify` 全绿(缺兄弟仓 5 齿跳过属既有环境)。

## 实施拆解

- [x] T1 提案文件落盘(本文件)
- [x] T2 F 族:f1-stable-write.ts + f1Request 分类 + 9 函数接线 + 死代码清理
- [x] T3 E 族:propose 包装咽喉迁移
- [x] T4 H8:editParam + settle 迁移 + h-client 分类
- [x] T5 弹窗文案泛化 + 哨兵 MIGRATED
- [x] T6 契约门 ×3 + verify 齿轮
- [x] T7 红测 + tsc/verify 全绿
- [x] T8 独立审计三轮(接线正确性 / 全仓 parity / 修复复核)+ 裁决落地 + done-review

## 审计裁决要点(三轮 skeptic,逐条回源后)

**采纳并修复**:reason 移出指纹 · 全新尝试才弃号 · 鸭型判据 · 401 顺序与登出 · data==null 守卫 ·
5xx 归未知(F 与 H8 两族)· 写路径无稳定号硬拒 · F5 批量 id 移入指纹**且 body 同步排序**(后端幂等
payload-bound,指纹排序而 body 不排序会 409)· E 槽位改用结构化动作标识(展示文案含输入值)·
SKU 预览链接踢出指纹(预签名 URL 会自动续签)· 铸号加随机段(命令号已持久化,跨标签页会撞)·
弹窗文案不承诺自动去重 · PAYLOAD_MISMATCH 文案改为可执行指引 · 三个被本包改红的既有契约门更新并
挂进 verify · 齿轮表按「是否依赖兄弟仓」重排(主人 2026-08-06 拍板)。

**回源后驳回**:第三轮把「reason 移出指纹」判为 P0,理由是后端幂等 payload-bound、改理由重试会
409。证据成立但结论反了 —— 409「内容已变化,本次未执行」正是后端在**阻止重复执行**;若 reason 留在
指纹,改理由会铸新号并真的执行第二次。运营恢复原输入即可重试(文案已改为这样指引),不是死锁。
第五轮复核同意此驳回。

### 五轮审计的收敛曲线

| 轮 | 发现 | 主题 |
|---|---|---|
| 1+2 | 4 P0 + 15 P1 | 指纹语义(reason)、错误分类(5xx / 401 / data==null)、鸭型判据、弃号时机 |
| 3 | 1 P0(驳回)+ 8 P1 | 后端 payload-bound 的连带约束:数组排序对称、槽位不用展示串、预签名 URL |
| 4 | 1 P0 + 8 P1 | A2 腿缺 5xx(把存量无害变有害)、载荷对称、铸号兜底、齿轮位次 |
| 5 | 0 P0 + 6 P1 | 提案信封漏进指纹、proxy 不回抄、齿轮重复;其余为范围外既有面 |

**贯穿全程的单一根因**:后端幂等 payload-bound —— 命令号只是钥匙,锁是「键 + 完整请求体」。
凡是「指纹 ⊊ body」的地方都会 409 死锁,凡是「指纹 ⊋ body」的地方都会铸新号重复执行。
本包最终把这条不变量焊进了三族的契约门(逐条钉表达式 + 57 条红测变异)。

### 第五轮列出、判定为范围外的既有欠账(未修,建议归后续专项)

- `stable-mutation.ts` 的共享执行器缺 `mintedFresh` 守卫 → 5 个 G 域 client 仍是「任何确定性失败即弃号」;
  `d-client` / `user360-client` 早有同款守卫,唯独覆盖面最广的这个没有。
- 全仓 15 处 `crypto.randomUUID` 裸调(B1 双账本调账 / B5 风控阈值 / J3 篡改告警等),
  局域网 http 演示下会直接抛错;本包只补了自己碰到的 3 处。
- 5 处 propose 完全不传 commandKey(h1-phase / h2-trial / h5-daily-milestones / c2-actions / i6-i18n)
  → a2Request 的全部未知分类(含本轮新增的 5xx)因 `if (init?.commandKey)` 短路对它们无效。
- 持久化命令号无「放弃」出口:提案被驳回后重新提案会复用已消费的号 → 后端回放首次响应 →
  前端报「已写入队列」而队列里没有新票(**静默无操作**,比重复执行更难发现)。24h TTL 是唯一上界。

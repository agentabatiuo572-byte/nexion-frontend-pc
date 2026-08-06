# F 直写通道 + E/H8 迁稳定命令号 store(2026-08-06)

**状态:Aligned**(主人 2026-08-06 拍板:新开 `pkg/f-pending-direct` 分支 + 按 9 步大纲开工)
**出处**:pkg/restore-mid-tiers 交接存档第四节「任务 A」(`2026-08-06-f-pending-store.md` 记档不修项)

## Why

三族高敏写路径的 Idempotency-Key 仍是「每次现铸 / 弹窗态半措施」:提交结果未知(断网 / 响应丢失)后
刷新重试会铸新命令号,后端无法去重 → 重复打款(F5 重发)/ 重复处置 / 重复提案。
前一轮存量清仓(65f87bc)已迁 29 面,这三族是剩余欠账。

## What changes

1. **F 域直写通道**(`lib/admin/f1-client.ts`):新建零依赖咽喉 `lib/admin/f1-stable-write.ts`
   (SlotAttemptStore,storageKey `nexion-admin-f1-direct-commands-v1`),10 个写函数全部接线
   (F5 冲正 / 重发 / 暂停 / 异常配置、F3 结算、F1 阈值、F1 奖励增删改),槽位带目标对象 id;
   `f1Request` 补 outcome-uncertain 分类(K 范式:网络断 / 响应不可读 / 显式 unknown 头 → 结果未知;
   结构化回包失败 → 确定性失败);删 `idempotencyPrefix` 现铸后门、`updateF*TeamConfig`×5 死函数、
   `executeF3Settlement` 零调用死形参(稳定号通道改焊在请求层)。
2. **E 域**(`e-view.tsx`):propose 包装咽喉接 store(slot=动作|目标,指纹=[after,command,reason]),
   28 处调用点零改动;弹窗打开时现铸删除。storageKey `nexion-admin-e-domain-commands-v1`。
3. **H8**(`h8-referral-rewards.tsx`):现铸挪进提交回调内走 store(指纹带 expectedVersion);
   「执行真实结算」按钮同病顺手接上;`h-client` 补 H8 提交函数的最小 uncertain 分类。
   storageKey `nexion-admin-h8-commands-v1`。
4. **弹窗文案**(`operation-confirm-error.ts`):泛化 `*OutcomeUncertainError` 族通用「结果未知请原样重试」
   文案(A2 专属文案保留)。
5. **哨兵**:MIGRATED += `f1-stable-write.ts` / `e-view.tsx` / `h8-referral-rewards.tsx`。
6. **契约门 ×3** 挂 verify(静态半 CRLF 归一 + 剥注释后表达式级;运行时半真 import 咽喉 / store 替身)。

### 与派单的偏离(回源事实驱动,已获主人确认)

- 范式参照 `f-view.tsx proposeStable` + `f-pending-store-contract.test.mjs` 在未合并的 restore 分支;
  改用主线同构参照(i4-trust + pending-mutation-migration-contract),并从 restore 分支读到参照原文。
- H8 结算按钮同病顺手接上(派单只点名 editParam)。
- H 域 client 无 uncertain 分类,H8 提交函数补最小分类(不动 H 域全家)。
- 不复用 `stable-mutation.ts` 通用执行器:它是「指纹拼 key」朴素形态,改回原值会复活旧号,
  正是派单点名要避开的坑。

### Out of scope(记档不修)

- H 域其他写函数(H3/H4 创建等)无 uncertain 分类 —— 同病,不在派单。
- 交接存档任务 B 六项共享基建弱点(口径统一 / 登出清 store / resolve 绕内存 / TTL 滑动续期 /
  哨兵子串判据 / F 域无 version CAS)。
- 其他域走 usePropose 无稳定 key 的面(useState 弹窗态形态,哨兵词表盲区)。

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

- [ ] T1 提案文件落盘(本文件)
- [ ] T2 F 族:f1-stable-write.ts + f1Request 分类 + 10 函数接线 + 死代码清理
- [ ] T3 E 族:propose 包装咽喉迁移
- [ ] T4 H8:editParam + settle 迁移 + h-client 分类
- [ ] T5 弹窗文案泛化 + 哨兵 MIGRATED
- [ ] T6 契约门 ×3 + verify 齿轮
- [ ] T7 红测 + tsc/verify 全绿
- [ ] T8 独立审计(接线正确性 / 全仓 parity 双 skeptic)+ done-review + 收尾报告

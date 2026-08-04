# 内存态幂等键存量清仓 —— 红测留痕(2026-08-04)

承接 `2026-08-04-idem-store-redtest.md`(commit 3b9f4d2)。上一轮抽出共享模块 + 焊哨兵,
本轮把哨兵台账里的存量欠账全部迁完。

## 修的是什么

高敏动作的 Idempotency-Key(命令号)只活在组件 `useRef` / 模块级 `Map` 里,**刷新页面即清零**。
运营在「结果未知」后重试会铸出新命令号,后端无法去重 → **重复入账 / 重复处置**。

| 波次 | 处数 | 面 |
|---|---|---|
| 台账登记的存量欠账 | 17 | C5 C6 · D2 D3 · I3 I4 · J3 · K1 K2 K3 K4 K5 · M · i-client k6-client |
| 哨兵盲区(见下)新捞出的同族 | 9 | B2 B3 B5 · C1(昵称 / 支付方式)· J3 报表导出 · K3 沙盒模拟 |
| 通用执行器(单独评估、单独提交) | 1 | `stable-mutation.ts` → G1 G2 G3 G4 G7 |

## 判据自身的漏洞(本轮最重要的发现)

哨兵原来只认 `new Map` 形态。**单槽位命令号根本不用 Map** —— `useRef<string|null>(null)`、
`useRef<{fingerprint,key}|null>(null)`、`useRef<Record<string,string>>({})` 这三种写法整片扫不到。
B2 预测配置 / B3 保存视图 / B5 挤兑阈值 / C1 昵称重置与支付方式解绑 / J3 阈值与报表导出 /
K3 沙盒模拟全在盲区里,台账却显示「全仓已扫」。

已补三条形态判据(`useRef-slot` / `useRef-record` / `module-record`,按标识符词表收敛),
红测靶 I 证明补丁生效。**教训与上一轮同型**:判据的「形态假设」和「前缀假设」一样是漏检高发区。

## 迁移中发现并修掉的既有缺陷(不是迁移引入的)

1. **`stable-mutation` 指纹不带 path** —— 指纹 = `JSON.stringify(body)`,而目标对象 id 只在 path 里。
   G1 三个动作的 `tierKey`(质押档)、G2 取消/复核的 `exchangeNo`(兑换单)因此**完全没进指纹**:
   两个质押档改成同一个值、写同一条理由,就会共用一个命令号,后端按幂等去重 → **第二档静默没改**。
   已加 `stableMutationFingerprint(method, path, body)`,五个 G 客户端全部改用。
2. **C1 昵称重置槽位不带用户 ID** —— 内存态下无所谓(每次进详情页都是新 ref),一旦跨刷新存活就会
   在切到下一个用户时复用上一个用户的命令号。已补 `nickname-reset|${userId}`。
3. **B5 挤兑阈值 / 告警订阅没有输入指纹** —— 同理,持久化后改了阈值仍复用旧号 → 新阈值被吞。
   已补「提交值 + 版本」作输入指纹。

## 迁移引入的新风险与对策

槽位式调用点(`Map<槽位, {fingerprint, commandKey}>`)迁移前的语义是「输入变了就丢掉旧命令号」。
直接把输入指纹拼进 fingerprint 会让旧尝试留到 TTL 到期 —— 运营改了值再**改回原值**时会复用那个
可能已被后端消费掉的命令号,让一次真实的新操作被当成重复提交静默吞掉。

对策:`createSlotAttemptStore` 保留「一个槽位一次在途尝试,换指纹即丢弃旧号」的原语义。
红测靶 C 专门验这条。

## 自查发现的一处语义微差(M 域,判定为可接受,不改)

迁移前 M 域用两张表:`pendingIdempotencyKeys`(按「参数键+值+理由」存)与 `pendingMCommandAttempts`
(按逻辑命令 id 存)。合并成一条记录后,**回落查找的命中顺序变了**:

- 旧:`pendingIdempotencyKeys[fingerprint]` 是单槽,后写覆盖先写 → 回落拿到的是**最近**一次;
- 新:同一 `paramFingerprint` 可能对应多条(不同逻辑命令 id 各一条),`find` 返回**最早**一条。

判定可接受:两者都是「同一参数写入、仍未收敛」的命令号,复用任一条都不会造成重复写入;拿最早
那条反而更贴近「最老的未确认尝试优先收敛」。且该回落只在按逻辑命令 id 查不到时才触发。
记在这里是为了**不让它只活在当时的脑子里** —— 日后若 M 域出现「命令号复用了预期之外的那条」,
先回来看这一段。

## 红测方法

逐条注入破坏 → 跑四道门 → 记录哪道变红 → 用 `cp` 备份原文还原(**不用 `git checkout`**,本仓有并发
未提交内容)→ 还原后复跑全绿。注入靶点若未命中 / 未落盘 / 注入后仍全绿则立即终止,
不允许「注入没生效却报绿」。驱动脚本一次性放 scratchpad,备份落 `.redtest-backup/`。

四道门:
- `store-tests` = `node --test tests/pending-mutation-store-contract.test.mjs`
- `migration-tests` = `node --test tests/pending-mutation-migration-contract.test.mjs`
- `sentinel` = `node scripts/pending-idempotency-key-sentinel.mjs`
- `g-tests` = `node --test tests/g-overview-runtime-contract.test.mjs`

## 逐靶结果(baseline 四门全绿)

| 靶 | 注入的破坏 | 变红的门 | 还原 |
|---|---|---|---|
| A | 共享 store 不再写 sessionStorage(持久化空壳) | store-tests + migration-tests + sentinel + g-tests | OK |
| B | TTL 判定 `expiresAt > now` → `> 0` | store-tests + migration-tests + sentinel | OK |
| C | 槽位换指纹时不再丢弃旧命令号 | migration-tests + sentinel | OK |
| D | D2 逐笔审核指纹去掉动作类型 | migration-tests | OK |
| E | C1 昵称重置槽位去掉用户 ID | migration-tests | OK |
| F | B5 挤兑阈值不再把提交值当输入指纹 | migration-tests | OK |
| G | G1 指纹退回裸 body(不同质押档撞命令号) | g-tests | OK |
| H | G1 执行器不传 storageKey(退回内存态) | migration-tests + sentinel + g-tests | OK |
| I | 新增单槽位 ref 形态的内存态幂等键(**原判据盲区**) | sentinel | OK |
| J | 台账加一条代码里不存在的条目 | sentinel | OK |
| K | 扫描目录改成不存在的路径(空集全过) | sentinel | OK |

还原后复跑:四门 **全部 PASS**。

说明两点,不粉饰:
- **A、B、H 会同时红多项**:被破坏的是共享原语本身,下游断言必然连坐;这不是判据串味。
  真正要验的「只红对应项」在 C/D/E/F/G/I/J/K 上成立。
- **靶 I 是本轮的核心**:同一个注入在补形态判据之前是**全绿**的 —— 这正是上面那 9 处能长期
  躲过哨兵的原因。

## 环境说明(与本次改动无关)

本轮在 git worktree 内执行,`npm run verify` 全表 31 齿中 8 齿因**工作区外的兄弟仓 / 目录缺位**而断:
`interaction audit`、`M support surface audit`(硬读 `<workspace>/PRD`,worktree 里解析到别处)与
`channel-parity` / `App storage-key parity` / `FE-BE mapping` / `J1` / `J2` / `K2`
(硬读缺位的 `nexion-backend`,memory: nexion-backend-not-in-workspace)。
其余 23 齿全绿,含 typecheck、生产构建、A2 覆盖哨兵、本轮三道幂等门。
逐个跑全部 `tests/*.test.mjs` 后,**没有一条失败可归因于本次改动**(逐条核到 ENOENT 的绝对路径)。

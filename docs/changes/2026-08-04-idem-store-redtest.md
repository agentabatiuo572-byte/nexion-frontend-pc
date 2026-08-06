# 幂等键持久化抽共享模块 —— 红测留痕(2026-08-04)

## 修的是什么

高敏动作的 Idempotency-Key(命令号)原来只活在内存里,**刷新页面即清零**。运营在「结果未知」
后重试时会铸出新命令号,后端无法去重 → **重复入账 / 重复操作**。

| 位置 | 改前 | 改后 |
|---|---|---|
| `lib/admin/user360-client.ts` | 模块级 `new Map()`,5 类动作共用 | 共享 store(sessionStorage + 24h TTL) |
| `app/components/domain-views/c-tabs/c3-adjust.tsx` | `useState<{fingerprint}>` + 2 个 `useRef(new Map())` | 共享 store,3 个 fingerprint 命名空间共用 1 张表 |
| `lib/admin/d-client.ts` | 自带一份 sessionStorage 实现(正确但是第 3 份拷贝) | 改引用共享 store,**对外行为不变** |
| 新增 `lib/admin/pending-mutation-store.ts` | — | 单源实现 |
| 新增 `scripts/pending-idempotency-key-sentinel.mjs` | — | 全仓扫内存态幂等键 + 台账,未登记一律红 |

## 红测方法

逐条注入破坏 → 跑四道门 → 记录哪道变红 → 用备份原文还原(**不用 `git checkout`**,本仓有并发
未提交内容)→ 还原后复跑全绿。注入靶点若未命中 / 未落盘则立即终止,不允许「注入没生效却报绿」。

驱动脚本(一次性,放 scratchpad):`redtest-idem.mjs`;备份落 `redtest-idem-backup/`。

四道门:
- `store-tests` = `node --test tests/pending-mutation-store-contract.test.mjs`
- `sentinel` = `node scripts/pending-idempotency-key-sentinel.mjs`
- `c3-contract` = `node --test tests/c3-adjustment-closure-contract.test.mjs`
- `d1-parity` = `node --test tests/d1-channel-parity-contract.test.mjs`

## 逐靶结果(baseline 四门全绿)

| 靶 | 注入的破坏 | 变红的门 | 还原 |
|---|---|---|---|
| A | 共享 store 不再写 sessionStorage(持久化空壳) | store-tests ①②③④ 全红 + sentinel(判据4:store 没落盘) | OK |
| B | TTL 判定 `expiresAt > now` → `> 0`(过期命令号永远有效) | store-tests ② + sentinel(判据4:缺 TTL 判定) | OK |
| C | c3 review 命名空间去掉 approve/reject 区分 | store-tests ③(c3 命名空间隔离) | OK |
| D | user360 fingerprint 去掉 `${path}` | store-tests ③(五类动作 fingerprint) | OK |
| E | d-client 存储键 v1 → v2 | store-tests ④ + d1-parity(uncertain command keys survive refresh) | OK |
| F | 新增一个未登记的 `new Map<string,string>()` 幂等键 | sentinel(判据1:未登记) | OK |
| G | 台账加一条代码里不存在的条目 | sentinel(判据2:台账失真) | OK |
| H | 已迁移文件不再调用 `createPendingMutationStore` | sentinel(判据3:回退成内存态) | OK |
| I | 扫描目录改成不存在的路径(空集全过) | sentinel(判据0:扫描器自检) | OK |

还原后复跑:store-tests / sentinel / c3-contract / d1-parity 四门 **全部 PASS**。

说明两点,不粉饰:
- **A、B 会同时红多项**:被破坏的是共享原语本身,下游断言必然连坐;这不是判据串味,是「一处坏
  多处红」的正常表现。真正要验的「只红对应项」在 C/D/F/G/H/I 上成立(各自只红一处)。
- **`c3-contract` 全程没被任一注入红过**:它是本轮的对照组(证明不是「随便改点什么都全红」)。

## 判据本身的红测(哨兵会假绿)

哨兵开发过程中,台账反查(判据2)当场抓出了**判据自身的漏洞**:`scoped-command-map` 正则要求
标识符关键词前至少有一个字符,导致 `pendingKeys` 这种**以关键词开头**的名字被整条漏掉
(`lib/admin/stable-mutation.ts` 因此一度扫不到)。已改成「先宽匹配任意 `const x = new Map`,
再按名字筛」。教训:判据的「前缀假设」是漏检高发区,靠双向台账(代码↔台账互查)才照得出来。

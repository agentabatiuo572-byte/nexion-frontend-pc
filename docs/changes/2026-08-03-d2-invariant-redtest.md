# 2026-08-03 D2 提现单据财务不变量补齐 · 红测留痕

范围:`lib/admin/d-client.ts` `normalizeWithdrawal` 财务不变量(2×P1+1×P2);用例在
`tests/wd02-network-confirm-fee-contract.test.mjs`(行为固定靶,type-strip 真跑)。

## 修了什么

| 条目 | 分支 | 新增判据 |
|---|---|---|
| P1-A | confirm + legacy | `\|netReceive − (amount − actualFee)\| ≤ 0.0001`(双形态同式) |
| P1-B | legacy | `\|actualFee − (grossFee − feeWaived)\| ≤ 0.0001`(与新单等式对称) |
| P2 | confirm + legacy | 上界 `netReceive > amount` → `netReceive > amount + 0.0001`(严格比较会把合法舍入冻成整页崩 —— `normalizeD2Page` 是 `.map`) |

**公式权威源**:PRD_v1 D5「提现手续费模型(本子模块权威定义)」:`actualFee = grossFee − feeWaived`、
`netReceive = 提现额 − actualFee`(双形态同式;uniapp `src/store/nex-faucet.ts` L268 同款)。
派单原文写旧单 `netReceive = amount − grossFee`,仅在 `feeWaived = 0` 时与 PRD 公式重合;按字面实现会误杀
NEX 抵扣旧单(grossFee 21 / feeWaived 8 / actualFee 13 / netReceive 87 合法却被拒)→ 按 PRD 公式实现,
判别靶已写进 P1-B 用例(feeWaived > 0 旧单必须过)。

## 红测(逐合取项注入破坏 → 对应用例必红 → cp 还原 → 复绿)

还原方式:`cp` 备份(scratchpad `d-client.ts.bak`,96204 bytes),**未用 git checkout**(本仓有并发未提交内容)。
每条反例按合取项隔离:除被测等式外其余不变量全自洽,删那一条 → 恰好该用例红(fail=1)。

| # | 注入 | 预期红用例 | 结果 |
|---|---|---|---|
| R1 | 删 confirm 分支 netReceive 等式 | P1-A confirm(费 5 报到账 80,应 95) | 红 ✓ fail=1 |
| R2 | confirm netReceive 容差改宽 0.0001→1000 | 同上 | 红 ✓ fail=1 |
| R3 | 删 legacy 分支 netReceive 等式 | P1-A legacy(应 79 报 90) | 红 ✓ fail=1 |
| R4 | 删 legacy 分支 actualFee 等式 | P1-B(grossFee 21/feeWaived 0/actualFee 1,netReceive 给 99 隔离) | 红 ✓ fail=1 |
| R5 | confirm 上界回退严格比较 | P2(netReceive 100.00005 合法舍入被冻) | 红 ✓ fail=1 |
| R6 | legacy 上界回退严格比较 | P2(legacy 全免单 100.00005 被冻) | 红 ✓ fail=1 |

每次注入均回读磁盘自证已落盘;还原后与原文逐字节一致;复跑
`node --test tests/wd02-network-confirm-fee-contract.test.mjs` → 13/13 绿;
`node --test tests/d2-*.mjs tests/wd02-*.mjs` 全绿;`npx tsc --noEmit` 0 错。

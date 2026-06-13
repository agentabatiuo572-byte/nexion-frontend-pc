# PRD Sync Dry Run — 2026-06-13

> 状态: applied-with-owner-confirmation
> 边界: 本报告记录 `scripts/prd-sync-l5-draft.mjs` 的 dry-run 结果;未修改 `D:\WORKS\PLAN\PRD\...` canonical PRD 正文。

## 1. 执行命令

```powershell
cd D:\WORKS\PLAN\Nexion-admin-prototype
node --check scripts\prd-sync-l5-draft.mjs
node scripts\prd-sync-l5-draft.mjs
node scripts\prd-sync-l5-draft.mjs --patch-file=docs\remediation\PRD-SYNC-PREVIEW-2026-06-13.patch --apply-check
```

## 2. dry-run 结果

```text
# PRD Sync L5 dry-run
targetRoot: D:\WORKS\PLAN\PRD
operations: 23
planned: 23
alreadyPresent: 0
missingAnchors: 0
patchFile: D:\WORKS\PLAN\Nexion-admin-prototype\docs\remediation\PRD-SYNC-PREVIEW-2026-06-13.patch
patchBytes: 20165
applyCheck: passed
- planned: product.route.uniappCoverage (product)
- planned: product.kyc.topupLoop (product)
- planned: product.wallet.topupWriteRules (product)
- planned: product.wallet.withdrawClosure (product)
- planned: product.team.financeControls (product)
- planned: product.wallet.exchangeConfirmation (product)
- planned: product.wallet.repurchaseConfirmation (product)
- planned: product.wallet.stakingConfirmation (product)
- planned: product.params.canonUnderBackendParams (product)
- planned: product.rules.canonLock (product)
- planned: product.i18n.heading.15_1 (product)
- planned: product.i18n.heading.15_2 (product)
- planned: product.i18n.heading.15_3 (product)
- planned: product.i18n.heading.15_4 (product)
- planned: product.i18n.acceptance (product)
- planned: opsDev.modal.businessContract (opsDev)
- planned: opsDev.list.baseline (opsDev)
- planned: opsDev.support.surface (opsDev)
- planned: opsDev.params.ownerLink (opsDev)
- planned: opsDev.prd.governance (opsDev)
- planned: opsV4.support.surface (opsV4)
- planned: opsV4.prd.governance (opsV4)
- planned: opsConfirm.modal.businessContract (opsConfirm)
```

## 3. 安全约束

- 默认执行是 dry-run,只读 canonical PRD。
- 写入必须显式传入 `--apply --owner-confirmed`。
- `--apply` 缺少 `--owner-confirmed` 会直接抛错并拒绝写入。
- 若任一锚点缺失,脚本会以 exit code `2` 退出;apply 模式下会拒绝写入。
- `--patch-file` 只生成预览 patch,不写入 canonical PRD。
- patch 头部已规范为 `a/PRD/...` / `b/PRD/...`,并通过临时路径泄漏哨兵检查。
- `--apply-check` 会把 canonical PRD 复制到工作区临时目录,对生成 patch 跑 `git apply --check`,最后清理临时目录;当前结果为 `passed`。
- 若主人确认同步后 23 条正文均已存在,再次运行 `--apply-check` 会返回 `applyCheck=not-needed`、`alreadyPresent=23`,用于后置复验而非失败。
- `--apply-check` 不允许与 `--apply` 同时使用,避免把预检查和正式写入混在一次命令里。

安全拒绝测试:

```powershell
node scripts\prd-sync-l5-draft.mjs --apply
```

结果:拒绝写入,错误为 `Refusing to edit canonical PRD without --owner-confirmed.`

确认后执行:

```powershell
cd D:\WORKS\PLAN\Nexion-admin-prototype
node scripts\remediation-finalize-after-owner-confirmed.mjs --apply-prd --owner-confirmed
```

## 4. PRD 文件未修改证明

dry-run 后 canonical PRD 文件时间保持原状:

| File | LastWriteTime |
|---|---|
| `Nexion_产品功能架构设计文档_v3.7.md` | `2026/6/8 11:57:54` |
| `Nexion_运营控制后台PRD_v4.md` | `2026/6/12 14:32:43` |
| `Nexion_运营控制后台_开发落地规格.md` | `2026/6/12 10:13:13` |
| `Nexion_运营后台_交互与确认机制改写SPEC.md` | `2026/6/12 10:21:29` |

## 5. 同步后复验

确认并 apply 后必须运行:

```powershell
cd D:\WORKS\PLAN\Nexion-admin-prototype
npm run remediation:preflight
```

通过标准:

- `status=passed`
- finalizer step `l5-final-sweep=passed`
- finalizer step `owner-review-readiness=passed`
- Admin verify `148 checks, 0 failed`
- Next reference verify `230 passed, 0 failed`
- UniApp verify `16 pass, 0 fail`

## 6. 剩余硬门禁

| Gate | Status | Required Action |
|---|---|---|
| Canonical PRD sync | waiting-owner-confirmation | 主人确认后才允许运行 `node scripts\remediation-finalize-after-owner-confirmed.mjs --apply-prd --owner-confirmed` |
| Owner product acceptance | accepted-by-owner | 主人已明确接受最终产品验收 |

# SPEC-L2c01-admin-c-domain-2fa-persist

| 字段 | 值 |
|---|---|
| 状态 | verified |
| 层/工作流 | L2c 替换后残留缺陷 / C 域账户安全 |
| 端 | admin |
| 模型层级 | spec=T0; 实现=T1 |
| 关联缺陷 id | INIT-004 |
| 关联规格卡 | `modal-specs/c5-security-2fa-disable.md` |

## 1. 背景与问题

`INIT-004` 记录 C 域 2FA 操作曾是 toast-only fake write: 操作反馈显示成功, 但没有证明状态真写、刷新持久、跨 360 HUB 同用户同步。

## 2. 目标与非目标

目标: `/users/security` 的 `关闭 2FA(操作确认 + 实名二验)` 必须是可运行的账户安全处置: 走操作确认、要求操作理由、不得出现密码/验证码输入框、提交后同时写 `C.twofa.<uid>` 与 `useUserOps.twoFactorReset`, 刷新后页面仍显示人工关闭, `/users/search/U-88421` 360 HUB 同用户显示 `待重设`。专项 proof 统一使用 `U-88421`, 先在 C5 查询该用户再处置, 防止 `usr_*` 与 `U-*` 两套 mock id 混淆。

非目标: 不接真实认证后端; 不新增用户端 2FA 自助恢复; 不改变 A 域运营账号强制 2FA 铁律。

## 3. 改动文件面声明

- `D:\WORKS\PLAN\Nexion-admin-prototype\app\components\domain-views\c-tabs\c5-security.tsx`
- `D:\WORKS\PLAN\Nexion-admin-prototype\app\components\domain-views\design-kit.tsx`
- `D:\WORKS\PLAN\Nexion-admin-prototype\lib\store\admin\user-ops-store.ts`
- `D:\WORKS\PLAN\Nexion-admin-prototype\app\components\hub\account-section.tsx`
- `D:\WORKS\PLAN\Nexion-admin-prototype\scripts\admin-c-domain-security-proof.mjs`
- `D:\WORKS\PLAN\Nexion-admin-prototype\docs\audit\admin-c-domain-security-runtime-evidence.md`
- `D:\WORKS\PLAN\Nexion-admin-prototype\docs\audit\ledger.ndjson`
- `D:\WORKS\PLAN\Nexion-admin-prototype\docs\audit\LEDGER.md`
- `D:\WORKS\PLAN\Nexion-admin-prototype\docs\remediation\MASTER-PLAN.md`

## 4. 方案

1. 回源确认 C5 关闭 2FA handler 是否已经双写 `C.twofa.<uid>` 与 `useUserOps.resetTwoFactor(uid)`。
2. 若缺任一写入或 UI 不读持久态, 修复 C5 / user-ops store。
3. 新增 runtime proof: 清空本地 store -> 打开 `/users/security` -> 点击关闭 2FA -> 验证 modal 只有审计理由, 无密码/验证码输入 -> 提交 -> 刷新 -> 验证 C5 页面、platform params、user-ops store、360 HUB 同步。
4. 将 INIT-004 从 seed evidence 升级为 runtime verified。

## 5. 同形全站扫描范围

- `rg -n "2FA|twoFactor|resetTwoFactor|C.twofa|twoFactorReset|重置 2FA|关闭 2FA" app lib docs/ops-actions.manifest.json`
- 确认 A 域运营账号强制 2FA 仍为 server-canonical 不可关; C5 用户安全恢复和 360 HUB 重置 2FA 同源。

## 6. 验收断言（机器可测）

1. `node scripts/admin-c-domain-security-proof.mjs` 通过: C5 查询 `U-88421` 并关闭 2FA 后, 刷新仍显示 `已关闭(人工)`。
2. proof 读取 `localStorage["nexion-admin-platform-v1"].state.params["C.twofa.U-88421"] === "disabled"`。
3. proof 读取 `localStorage["nexion-admin-ops-v1"].state.users["U-88421"].twoFactorReset === true`。
4. proof 打开 `/users/search/U-88421`, 页面出现 `待重设` 或 `待重设(运营已重置)`。
5. 操作确认弹窗内不得出现密码、验证码、secret、TOTP code 等凭据输入框; 只能填写操作理由。
6. `npm run verify` 通过; 浏览器实景 console error=0。

## 7. 拟新增哨兵

- `scripts/admin-c-domain-security-proof.mjs` 作为 C 域 2FA fake-write 回归哨兵。
- 完成后在 `ledger.ndjson` 的 `INIT-004.sentinel` 绑定该脚本 + `npm run verify`。

---

## 完成回执（实现完成时回填）

- 验证证据：
  - `node scripts/admin-c-domain-security-proof.mjs` PASS: 4/4。证明 C5 查询 `U-88421` 后, 关闭 2FA 弹窗含账号安全摘要、实名二验提示、唯一操作理由 textarea、无密码/验证码/secret/TOTP 输入; 提交后 `C.twofa.U-88421=disabled` 与 `nexion-admin-ops-v1.users.U-88421.twoFactorReset=true` 双写, 刷新仍显示 `已关闭(人工)`, `/users/search/U-88421` 显示 `待重设`。
  - Browser live proof: `http://localhost:3002/users/security` 清空 store 后查询 `U-88421`, 打开弹窗, DOM 证据 `hasSecuritySummary=true`, `hasRealName=true`, `hasWrongGeoSummary=false`, controls=1 textarea, confirm disabled until reason; 提交后刷新 C5 与 360 HUB 均同步, console error=0。
  - `npx --no-install tsc --noEmit` PASS。
  - `node scripts/admin-modal-contract-audit.mjs` PASS (`checkedRequired=7`, `checkedForbidden=9`)。
  - `node scripts/admin-modal-contract-proof.mjs` PASS 7/7。
  - `npm run build` PASS。
  - `npm run verify` PASS 143 checks / 0 failed。
- 同形扫描结果：
  - C5 原 handler 已双写 platform params 与 user-ops; 本次补强弹窗标题和 `OperationConfirmModal` 摘要分类顺序, 防止 2FA 文案被 `恢复` 误归入应急/地区管控摘要。
  - `admin-modal-contract-*` 哨兵复跑通过, 证明共享 OperationConfirmModal 的业务表单契约未退化。
- 哨兵：
  - `scripts/admin-c-domain-security-proof.mjs`
  - `docs/audit/shards/c-domain-security-2fa-proof.ndjson`
- PR：本地整改批次, 未创建远端 PR。
- 台账更新：`INIT-004` 已转 `verified`。

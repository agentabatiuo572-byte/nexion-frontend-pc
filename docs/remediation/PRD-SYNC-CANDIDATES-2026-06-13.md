# PRD Sync Candidates — 2026-06-13 L5 Closure

> 状态: waiting-owner-confirmation
> 原则: 本文件只整理候选,不直接改 canonical PRD。按 `nexion-prd-sync` 规则,必须主人确认后才同步到 `D:\WORKS\PLAN\PRD\...` 正文。

## 1. 当前已验证基线

- Admin verify: `148 checks, 0 failed`
- Next reference verify: `230 passed, 0 failed`
- UniApp verify: `16 pass, 0 fail`
- L5 final sweep: `12/12 passed`
- Runtime route counts: Admin 66 / Next 80 / UniApp 81
- Runtime blockers: `runtimeBad=0`, `actionBad=0`
- Ledger: 38 rows, open=0
- Feature mapping: 18/18 `provisionally-operable`, gap=0, blocked=0, needsTaskWalkthrough=0

Evidence:

- `D:\WORKS\PLAN\Nexion-admin-prototype\docs\audit\l5-final-sweep-report.md`
- `D:\WORKS\PLAN\Nexion-admin-prototype\docs\remediation\specs\SPEC-L5a01-final-sweep-gate.md`
- `D:\WORKS\PLAN\Nexion-admin-prototype\docs\remediation\specs\SPEC-L5a02-next-reference-build-cleanup.md`
- `D:\WORKS\PLAN\Nexion-admin-prototype\docs\remediation\PRD-SYNC-DRAFT-2026-06-13.md`
- `D:\WORKS\PLAN\Nexion-admin-prototype\docs\remediation\PRD-SYNC-ANCHOR-AUDIT-2026-06-13.md`
- `D:\WORKS\PLAN\Nexion-admin-prototype\docs\remediation\PRD-SYNC-DRY-RUN-2026-06-13.md`

## 2. 建议同步到产品 PRD v3.7 的候选

Target: `D:\WORKS\PLAN\PRD\Nexion_产品功能架构设计文档_v3.7.md`

| 候选 | 建议章节 | 同步内容 | 证据 |
|---|---|---|---|
| UniApp 全路由迁移完成 | §3.3 路由清单 / §19 附录 | Next 80 reference routes 已映射到 UniApp 81 pages,唯一额外页为 onboarding terms;将 UniApp 作为交付主体的路由清单补齐 | `SPEC-L3c01`; `uniapp-port-coverage-audit` |
| Wallet 充值/KYC/提现闭环 | §9 Wallet / §4 KYC-Express | Top-up regular channel + KYC Express 同页状态、提现 KYC 后提交、tracking/bill/points 写入规则 | `SPEC-L3c03` FM-004; `SPEC-L3c02` FT-013 |
| Exchange + Repurchase + Staking 资金动作 | §9 Wallet / §13 业务规则 | NEX→USDT 兑换确认、v3 cap、双 bill;回购写 points/stake/bill;staking 开仓写 active position + bill | `SPEC-L3c02` FT-014; `SPEC-L3c03` FM-005 |
| Team finance 四入口 | §8 Team | commissions / rank / binary / leadership-pool 四个 finance 入口必须真导航并有业务内容 | `SPEC-L3c02` FT-015 |
| i18n 双语完整性 | §15 i18n | en/zh key mirror 作为验收标准;语言切换需跨 top-up/staking/team 页面改变可见 copy | `SPEC-L3c03` FM-013; UniApp `i18n-key-mirror` |
| 核心数字口径 | §13.3 关键参数集 | staking APY/罚金、Genesis slots/royalty/dividend、设备生命周期、商品价格/收益、提现 min/fee/cap 锁为三端同源参数 | `SPEC-L5a01`; `canon-numbers.json`; `canon-sentinel.mjs` |

## 3. 建议同步到运营后台 PRD / 开发规格的候选

Possible targets:

- `D:\WORKS\PLAN\PRD\Nexion_运营控制后台PRD_v4.md`
- `D:\WORKS\PLAN\PRD\Nexion_运营控制后台_开发落地规格.md`
- `D:\WORKS\PLAN\PRD\Nexion_运营后台_交互与确认机制改写SPEC.md`

| 候选 | 建议章节 | 同步内容 | 证据 |
|---|---|---|---|
| 业务弹窗契约 | 操作确认 / 弹窗规范 | 弹窗不得只是通用壳;必须有触发点、业务目标、业务字段/选择控件、diff/影响摘要、审计理由、确认后写入与回显。改角色必须有角色选择;改授权必须有权限 diff;内容弹窗必须有 zh/en 或对应业务字段 | `SPEC-L2a01`; `SPEC-L2a02`; `SPEC-L2a03`; `admin-modal-contract-audit` |
| 列表能力五件套 | 全后台列表规范 | 数据列表必须有分页原语或明确小表豁免;同时保留搜索、筛选、排序/状态、空态语义 | `SPEC-L2d01`; `SPEC-L2d02`; `admin-list-capability-global-audit` |
| 支持后台 FM-018 | 内容/客服支持 CMS | `/content/support` 必须覆盖 FAQ、Ticket 分类/SLA、工单回复、状态/owner/priority 调整、关闭/重开,并写审计理由 | `SPEC-L3a01`; `admin-support-surface-audit` |
| 平台参数寄存器 owner-link | 平台参数 / 模块开关 | 参数寄存器只索引回源真值,具体调参跳 owner module;G1 staking owner link 能进入 owner 页面并完成停售/APY 等业务操作 | `SPEC-L3c03` FM-016 |
| PRD 唯一性 gate | 文档治理 / 开发流程 | canonical PRD 路径固定在 `D:\WORKS\PLAN\PRD\...`;hook 与 gate 只认 canonical 文件,备份不参与唯一性判断 | `SPEC-L2e01` |

## 4. 不建议同步到 PRD 的技术清理

这些属于实现/验收机制,不应写进产品 PRD 正文:

- `l5-final-sweep.mjs` 总闸脚本与 `l5-*.log` 日志。
- Windows/WSL `node` / `curl.exe` fallback。
- Next `middleware.ts` -> `proxy.ts` 迁移。
- Next `metadataBase` 与 route handler runtime 清理。
- zustand SSR no-op storage。
- build/verify 脚本具体命令。

这些内容已保留在 remediation specs、MASTER-PLAN、PORT-PITFALLS 中。

## 5. 建议同步方式

若主人确认同步,建议分两批:

1. **产品 PRD v3.7**:只同步 App/UniApp 用户端业务闭环、Team/Wallet/i18n/canon 参数。
2. **运营后台 PRD/规格**:同步后台弹窗契约、列表能力、支持后台、参数寄存器 owner-link、PRD 唯一性治理。

同步时按 PRD 风格直接改正文,不加 changelog,不写“本次改动”。

可执行正文片段已整理在 `PRD-SYNC-DRAFT-2026-06-13.md`;同步锚点已由 `PRD-SYNC-ANCHOR-AUDIT-2026-06-13.md` 验证齐备。`PRD-SYNC-DRY-RUN-2026-06-13.md` 记录 `scripts/prd-sync-l5-draft.mjs` dry-run 为 23 planned / 0 missingAnchors,预览 patch 已生成在 `PRD-SYNC-PREVIEW-2026-06-13.patch`。确认后按该草案分批落入 canonical PRD。

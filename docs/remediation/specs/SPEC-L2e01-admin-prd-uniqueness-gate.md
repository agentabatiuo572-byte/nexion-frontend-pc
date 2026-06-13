# SPEC-L2e01-admin-prd-uniqueness-gate

| 字段 | 值 |
|---|---|
| 状态 | verified |
| 层/工作流 | L2e 既有 gate 纠偏 |
| 端 | cross |
| 模型层级 | spec=T0; 实现=T1 |
| 关联缺陷 id | SD-004 |
| 关联规格卡 | - |

## 1. 背景与问题

`SD-004` 记录 `scripts/admin-interaction-audit.mjs` 的 F 类 PRD 唯一性 gate 输出: `前端 PRD 文件应唯一,实测 0 个`。真实 canonical 前端 PRD 已迁入 `D:\WORKS\PLAN\PRD\Nexion_产品功能架构设计文档_v3.7.md`,而脚本仍只扫 `D:\WORKS\PLAN` 根目录。

同根因还影响 `Nexion-prototype/.claude/hooks/prd-guard.mjs`:hook 仍守旧根目录路径,可能放过真实 canonical PRD 的直接编辑。

## 2. 目标与非目标

目标:

1. F 类 gate 只认 `D:\WORKS\PLAN\PRD\Nexion_产品功能架构设计文档_v*.md` 顶层 canonical 文件。
2. 备份目录、历史导出目录、`node_modules` 等旧副本不计入唯一性。
3. gate 校验 `prd-guard.mjs` 的版本和路径都指向 canonical PRD。
4. 更新 `source-d-existing-gates.md` 证据,并把 `SD-004` 转 verified。

非目标:

1. 不批量重写历史文档中的旧路径引用。
2. 不编辑 PRD 正文内容。
3. 不改变 PRD 同步流程,仍需用户确认后走 `nexion-prd-sync`。

## 3. 改动文件面声明

- `D:\WORKS\PLAN\Nexion-admin-prototype\scripts\admin-interaction-audit.mjs`
- `D:\WORKS\PLAN\Nexion-prototype\.claude\hooks\prd-guard.mjs`
- `D:\WORKS\PLAN\Nexion-admin-prototype\docs\audit\source-d-existing-gates.md`
- `D:\WORKS\PLAN\Nexion-admin-prototype\docs\audit\ledger.ndjson`
- `D:\WORKS\PLAN\Nexion-admin-prototype\docs\audit\LEDGER.md`
- `D:\WORKS\PLAN\Nexion-admin-prototype\docs\remediation\MASTER-PLAN.md`

## 4. 方案

- 将 PRD 唯一性扫描根目录从 `PLAN` 改为 `PLAN/PRD`,只读取顶层文件。
- 从 `prd-guard.mjs` 中解析 `const PRD = normalize('...')`,与 canonical PRD 绝对路径归一化后比较。
- 保留版本号比较,确保文件名版本和 hook 版本一致。
- 修正 hook 内 PRD 常量和提示文案为 `D:/WORKS/PLAN/PRD/Nexion_产品功能架构设计文档_v3.7.md`。

## 5. 同形全站扫描范围

- `Get-ChildItem ..\PRD -File -Filter "Nexion_产品功能架构设计文档_v*.md"` 必须返回 1 个。
- `rg -n "const PRD = normalize|Nexion_产品功能架构设计文档_v" ..\Nexion-prototype\.claude\hooks\prd-guard.mjs` 必须指向 `PRD/` 路径。
- `node scripts/admin-interaction-audit.mjs` 不再输出 F 类 finding。

## 6. 验收断言

1. `node scripts/admin-interaction-audit.mjs`: `发现 0 项(HIGH 0)`。
2. `npm run verify`: PASS,且交互完整性 gate 不再显示 `F 版本漂移`。
3. `node scripts/ledger-validate.mjs`: PASS。
4. `npm run build`: PASS。

## 7. 拟新增哨兵

既有 `admin-interaction-audit.mjs` F 类 gate 就是哨兵;本单修正其 canonical PRD 发现口径并新增 hook path 校验。

---

## 完成回执

- Canonical PRD: `D:\WORKS\PLAN\PRD\Nexion_产品功能架构设计文档_v3.7.md`,顶层唯一。
- `Nexion-prototype/.claude/hooks/prd-guard.mjs` 已改守 `D:/WORKS/PLAN/PRD/Nexion_产品功能架构设计文档_v3.7.md`。
- `node scripts\admin-interaction-audit.mjs`: PASS, `发现 0 项(HIGH 0)`。
- `npm run verify`: PASS, 144 checks / 0 failed。
- `npm run build`: PASS。
- `SD-004` ledger 已转 verified。

# CGM — Control Granularity Matrix(字段级控制矩阵)

运营后台「最细 1:1」控制的**驱动 + 验收**单一真源。三层控制文档中的**字段级第三层**:

| 层 | 文档 | 粒度 |
|---|---|---|
| 路由级 | `FRONTEND-LEVER-MAP.md` | 前端路由 ↔ 后台域 |
| 模块级 | `CONTROL-MAP.md` | 67 模块 ↔ 控制 archetype |
| **字段级** | **`cgm/CGM-{domain}.md` + `cgm/cgm.manifest.json`** | **每个运营数据字段 / 功能 ↔ query + 增删改查** |

## 判定标准(纳入 CGM 的门槛)
> **运营为保证业务正常运转,是否需要查 / 增删改查它?** 是 → 必须有一行 CGM + 对应后台细控。

覆盖两层:**L1 平台运营面**(SKU/定价/任务计价/金融产品/佣金规则/phase dial/CMS/风控/资金/RBAC…)+ **L2 per-user 账户面**(投入/提现/邀请/设备/收益/用户+V级)。

## 行 schema(`cgm.manifest.json` 的 `rows[]` 元素)
| 字段 | 说明 |
|---|---|
| `id` | `CGM-{domain}-{nnn}` 稳定主键(coverage gate 引用) |
| `domain` | A-L(对齐 12 域 admin) |
| `scope` | `platform` / `per-user` |
| `controlType` | `data-CRUD`(逐条数据增删改查)/ `function-action`(运营功能动作)/ `param-config`(规则·参数配置) |
| `frontendField` | 精确路径:`store.field` 或 功能名(如 `useApp.user.cumulativeDepositUsdt`、`useApp.devices[].activatedAt`、`useVRank.directRefs`、`submitWithdrawal()`) |
| `frontendSource` | `文件:符号锚`(如 `lib/store/index.ts:recordDeposit`)— **禁裸行号**(行会漂) |
| `frontendAnchor` | 前端 PRD v3.7 §锚点;无则 `none·派生自代码` |
| `opsPurpose` | 枚举≥1:`fund_safety` / `payout_pacing` / `conversion` / `risk` / `network_growth` / `phase_12mo` / `content_compliance` / `platform_integrity` |
| `querySurface` | 运营要**看到**什么(值 / 聚合 / 趋势 / 下钻) |
| `crudActions` | 运营要**改**什么 + 目标态(`view`/`adjust`/`freeze`/`credit`/`debit`/`add`/`edit`/`delete`/`approve`/`toggle`/`export`/`reverse`…) |
| `operationConfirm` | bool;**资金 / 资产 / 收益 / 规则参数 / kill-switch 一律 true** |
| `serverCanonical` | server 权威约束一句话(抄前端 store 头注的 `PRODUCTION:` 行) |
| `endpoint` | 读端 + 写端 `<VERB> /api/...`(取自 store 注 / `Nexion-prototype/lib/v3/_config/README.md`);无则 `TBD·建议<path>` |
| `adminTarget` | `registry:<path>`(archetype 条目)/ `page:<route>`(旗舰)/ `hub:<section>`(360 区块) |
| `coverage` | `built`(已实现且回源核实)/ `spec_only`(PRD 已写未实现)/ `gap`(都没有)/ `waived:<理由>` |
| `batch` | `B0..` 排期 |

## 不变量(硬规则,对齐 nexion-admin-prd SKILL)
1. **高敏写**(资金/资产/收益/规则/kill-switch)= `operationConfirm:true` + 操作理由必填 + server-canonical + Idempotency-Key + append-only(红冲不真删)。
2. **endpoint 必填**(真或 `TBD·建议`):每控制对应一个真后端端点,mock 结构 backend-replaceable。
3. **可追溯**:每行有 `frontendSource`;`frontendAnchor=none` 须注「派生自代码」。
4. **中性运营语言**:`querySurface`/`crudActions` 禁庞氏/割韭菜/scam;per-user 资产/收益 CRUD 正当性 = 补发/调整/红冲/对账差异处置。
5. **只落 admin**:`adminTarget` 只指 admin 路由,控制永不回灌前端(前端铁律:产品内禁 admin/meta)。

## 覆盖 gate(`scripts/cgm-coverage.mjs`)
读 manifest:`batch≤$CGM_BATCH` 且 `coverage∈{gap,spec_only}` → FAIL(exit 1);`built` 行反查 `adminTarget` 真存在(`findModuleEntry` / nav grep)+ 对应 PRD 卷 grep 到 `endpoint`;`waived:*` 须非空理由。

## 生成方式
Batch 0 多-agent fan-out 扫全前端源 → 提取事实层行(frontendField/source/anchor/serverCanonical/endpoint,**抄码不臆造**)→ main 聚合写本 manifest + 各域 `CGM-{domain}.md`。后续每批刷新该域行 + 更新 coverage。

## 复用模式 & 教训(进化台账)
- **manifest 驱动旗舰页**:平台参数寄存器 `/platform/params-registry` 与 per-user 360 HUB 不复制 CGM 数据,直接 `import cgm.manifest.json` 渲染(server component)→ 零重复、永与覆盖门同步。新增/改 CGM 行,页面自动反映。**任何"控制索引/目录"页都应这样直接读 manifest,不手抄。**
- **"颗粒度太粗"的真因常是忠实度而非缺失**:平台 config 模块(如 G staking)早有字段级 ConfigSpec,但值是示意值,与前端真常量(`STAKING_APY` 等)不符。寄存器层 = 回源真值 + 跳各域 config 编辑,补的是"忠实绑定"而非"新建控制"。审平台控制先比对真常量,别只看"有没有页面"。
- **coverage flip 必按精确行 id / domain+scope 过滤,严禁宽 regex**:`creditBalance|deposit...` 类宽匹配会误翻引用该字段的他域行(E-004 trade-in / H-011 quest 被误判)。flip 脚本用显式 id 清单或 `domain===X && scope===Y`。
- **覆盖门默认 B9**:`cgm-coverage.mjs` 与 `verify.sh` 均默认 `CGM_BATCH=B9`(全 185 行)→ 任何新增 gap 行立即令 verify 失败,逼迫"建控制或显式 waived"。暂存未完成新批次时临时降批跑。
- **waived 须带理由**:运行时模拟主循环(tick)、内部 append(bills.add)、dev-only demo 开关(replay-tour phase override)非运营控制点,`coverage: "waived: <理由>"` 显式豁免,门会校验理由非空。
- **中性语言门曾有缺口(2026-06-04 §锚点收口审计带出)**:`admin-prd-lint` 旧 BANNED 正则缺 `拉盘|砸盘|跑路|操纵骗局`,致 admin PRD「拉盘曲线」与 CGM-G-030「庄家拉盘」混过门。已:① 补全 lint 正则;② **`cgm-coverage.mjs` 新增中性语言门**(扫 manifest + `CGM-*.md`,命中即 FAIL)。重构约定:`拉盘曲线→做市价格曲线`、`拉盘→做市/上行触发`、`砸盘→抛压`。教训:覆盖门 ≠ 语言门,二者都要自动化;收尾必跑 banned 正则(SKILL §收尾审计)。

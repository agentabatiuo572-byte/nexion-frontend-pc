# ⚠️ 本文件已退役 —— 内容不在这里

> **当前客服 M 域合同归本项目：[M 专属客服中心功能契约](M-专属客服中心功能契约.md)，端点索引见[开发落地规格域 M](Nexion_运营控制后台_开发落地规格.md#域-m--客服中心)。本文件继续退役，不恢复其他 V4 业务正文。**
> 最后更新：2026-10-09

> 以下旧指针及合并说明是历史记录，不作为客服 M 域当前维护入口。

> **2026-08-07 当时裁决的旧权威路径：**
>
> ## `D:\WORKS\PLAN\PRD\NexGrid_运营控制后台PRD_v4.md`
>
> 该路径及下文保留作历史指针；客服 M 域到本项目当前合同入口读、改。**本文件不再承载正文。**

## 为什么退役

这份仓内副本与权威副本**双向分叉**了:权威侧有 117 行它没有,它有 110 行权威侧没有。
不是「谁更新覆盖谁」的问题——两边都在各自往前走:

- **仓内副本**更新的是**已落地实现面**(文案版本模型 / 真实事件池 / 客服独立成域 / 应急端点与并发语义),有 8 个提交对应,在代码里逐条核到实物。
- **权威副本**更新的是**全局治理与 K6 专项**。

更糟的是,这份副本里「PRD canonical 治理」那一节**整段出现了两次、还紧挨着**:
一处声明权威是 `Nexion_*`,另一处声明是 `NexGrid_*` —— 同一份文档同时声明两套互斥权威。
而磁盘事实早已把答案定死:`PLAN\PRD\` 下**只存在 `NexGrid_` 那套**,
第一段指向的 `Nexion_*` 文件根本不存在(那是改名前的残留)。

## 两份已合并,一条没丢

2026-08-07 做了三向合并,两份的实质内容**全部并入权威副本**:
17 条冲突逐条裁决,决策依据就近写在权威副本的 `<!-- 冲突 #N · 已裁决 -->` 注释里。

- 完整两版原文、推理与条目守恒核对 → `docs/changes/2026-08-07-prd-v4-merge-report.md`
- 合并稿(等同权威副本正文)→ `docs/changes/2026-08-07-prd-v4-merged-draft.md`
- 本文件退役前的原文 → `git log -- docs/PRD/Nexion_运营控制后台PRD_v4.md`(历史完整保留),
  另有一份拷贝在 `.trash/20260807-prd-repo-copy/`

## 🔴 给以后的人

**不要恢复本文件的旧 V4 副本。** 副本每多活一天就多攒一天分叉,而「靠人记得同步」已经
被实测证伪一次(这次分叉就是这么来的)。要在仓里引用 PRD,写**路径引用**,别拷内容。

⚠️ 另注:本仓那道 PRD 措辞检查是**按文件名模式**匹配的(`运营控制后台prd.*\.md`),
对两份副本一视同仁 —— 所以权威副本里那句「hook 与门只认 canonical 文件」对它并不成立。
真要让门只认权威副本,得改门的判据,不能只写在文档里。

### 2026-11-15 J1 B38 受控核查

直接 J1 scopes 与 A2 恢复提案受 `AdminCommandOrigin.supported:77–82` 支持。发出前保存原 method/path/adminId/readAuthority，重试保留原来源，不从后来账号重建；查询纯读 `commands/investigations/by-command-key`，证据可交同一 `checkInvestigation`。仅 `SUCCEEDED/CONFIRMED_SUCCEEDED` 或后端允许新操作的 `CONFIRMED_NOT_EXECUTED` 且未锁终态清记录并重读 J1。NOT_FOUND/FAILED/UNKNOWN/PROCESSING/错误均保留。旧记录缺 origin 不猜。依据 backend `04d11022` AdminCommandInvestigationService.discover/investigate/requireReader。现有解除说明、核查表单与独立恢复原请求重试入口由视觉补齐。

### 2026-11-15 K1 B38 核查

K1 direct scopes 与处置提案 A2_COMMAND 均支持，初发保原method/path/adminId/readAuthority，重试不覆盖。checkInvestigation(record,evidence?) 查询/提交同一原命令，只认已证明成功或已确认未执行且允许新操作的未锁终态；其余保留，旧无origin不能核。终态后重读账户组/收益。现有本地解除改查询，证据/结果/交接人显示及 direct 常驻查询入口交视觉。出处 backend `04d11022` AdminCommandOrigin:57–82、AdminCommandInvestigationService.discover/investigate；OpsRiskService.idempotentK1。

K1范围补核：`OpsRiskController.updateK1RegistrationParam:142–147` 委托 `OpsPlatformConfigService.updateK1RegistrationParam:119–122/updateParam:214–215`，真实scope为A3_PLATFORM_PARAM，不在supported。该类不连接受控核查，原本地处理保留。RiskReleaseParamsService.update:87为K1_RELEASE_PARAM、EarningsReleaseService.manualRelease:387为K1_EARNINGS_MANUAL_RELEASE，二者属于已支持K1前缀，但成功审计是否被allowedFact接受仍以服务端为准。

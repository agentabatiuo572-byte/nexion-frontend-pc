---
name: project-nexion-remediation
description: 落地级原型整改长线任务——方案已落地 MASTER-PLAN.md，状态⏸暂存，待主人完成剩余域设计稿替换后下令启动
metadata: 
  node_type: memory
  type: project
  originSessionId: e408ef9a-7553-41b8-87e6-ce09566cbe71
---

**Nexion 落地级原型整改**（2026-06-12 方案定稿落地，任务⏸暂存）。

- **总纲（单一事实源）**：`D:\WORKS\PLAN\Nexion-admin-prototype\docs\remediation\MASTER-PLAN.md`——六层方案（L0 盘点→L1 五源发现→L2 修复→L3 建设→L4 哨兵→L5 终验 12 条）+ spec 模板已就位（specs/_TEMPLATE.md）。启动后任何会话**先读 MASTER-PLAN 再干活**。
- **启动条件**：主人先自行完成剩余域（C/A/G/H/I/B）新设计稿替换，之后下令「启动整改任务 / 按 MASTER-PLAN 开始」。启动后第一步 = M0（L0 五张全集清单 + 台账 schema）→ L1 五源发现 22 分片。
- **关键决策**（详见 MASTER-PLAN §12 决策记录）：前端 UniApp 优先全量迁移（~80 路由），Next.js 原型降参考源只修逻辑/铁律级（打磨类标 fix-in-port 在迁移中落地）；后台与前端**功能点一一对应**（feature-mapping 矩阵，不做真实运行时联动）；P0-P2 全修 P3 逐项裁决；弹窗按操作语义六分类逐个出规格卡重构；列表分页/筛选五件套是一等检查维度；模型分工 T0 Fable/T1 Opus/T2 Sonnet/T3 Haiku（质量门与模型无关）。
- **已纠侦察误报**：Genesis $24.08 与衰减曲线双端已对齐处方，只需上锁；后台参数面板比初报全（E3/G1/G4/F2/D5 均有入口）。
- 关联：[[project-nexion-admin-prototype]] [[project-nexion-uniapp]] [[feedback-retro-evolve-loop]]

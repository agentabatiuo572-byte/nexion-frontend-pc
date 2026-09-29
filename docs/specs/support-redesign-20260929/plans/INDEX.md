# 机器计划草案索引

四个文件均为schemaVersion2、未激活、未执行。结构校验不代表功能或命令已通过。repo是为校验来源文件使用的可解析占位，禁止在原树执行；激活要求见每个文件activation和IMPLEMENTATION-PLAN。

| 阶段 | 计划 | 必须先通过 |
|---|---|---|
| S3 | backend-s3.plan.json | S1业务/API审阅 |
| S4 | backend-s4.plan.json | S3真实提交/迁移/接口证据；新树base改到该提交 |
| S5 | admin-s5.plan.json | S1+S2汇合、S3+S4真实交付；新树不可复用S1写入树 |
| S6 | client-s6.plan.json | S3+S4真实交付；与S5可并行 |

S1为文档检查与独立语义审查，不借实施计划假报代码完成。S2机器计划由设计阶段以真实图稿、交互原型和检查命令建立，S1不编造其产物。

S7是协调会话的跨仓独立集成：冻结三仓SHA及运行配置，逐条AC01–AC14出真实runtime证据和coverageReview；重跑各仓当前计划integration，分别留各仓snapshotHash，再用三仓提交清单绑定跨仓报告。当前跨仓运行器/APP验收尚未交付，不能伪造一个仓hash代表全部。S7激活时须按三仓各自scope生成验收计划/record，并附全局AC映射；本S1不声称S7机器计划已可执行。

待实现命令都在activation.missingCommands：脚本必须实际执行相应AC场景及失败反例、传递真实测试退出码，报告带WORKFLOW_*绑定，不能只生成JSON。新测试路径与脚本须入本阶段scope；报告位于仓外，独立审查逐项核对场景证据。超过600秒的工程门应由阶段按真实运行耗时拆成有意义检查，不能扩大通过声明或绕过门。

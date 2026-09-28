# 运营后台手机规则交接

E6 /devices/compute-config 编辑硬件与分界，E2 /devices/tasks 编辑分界，A2 /platform/audit 审批完整提案，A5 /platform/config 读取版本摘要。功能契约见 docs/PRD/Nexion_运营控制后台PRD_v2.md 的 E6a。

完整配置顺序与同事验收提示词见 [后端交接](https://github.com/agentabatiuo572-byte/nexion-backend/blob/test/docs/phone-calibration-handoff.md)。本地真实组件测试使用隔离 fixture；远端双管理员事务联调待执行，不等于已部署当前服务器。

# 手机绑定运营配置交付边界

## 操作入口与契约

E6「算力与设备配置」新增「手机绑定与换机」，分别设置是否允许更换绑定手机、最短换机间隔。0 天表示不限制间隔；禁止换机时仍可调整间隔。每次提交沿用现有 A2 理由、确认、权限与审计机制。

服务端保存到既有配置中心，字段为 `E.compute.phoneBinding.allowReplacement` 与 `E.compute.phoneBinding.minReplacementIntervalDays`。E6 读取接口和 `/api/config/platform` 均返回 `phoneBinding`，供客户端读取；读取配置并不等于已经完成真实设备身份验证或任务执行权校验。

新系统默认禁止换机，间隔默认 0；首次明确开启时补齐尚不存在的间隔配置。非法存量不能被默认值掩盖后放行。两项配置不依赖电脑客户端下载地址。

旧 `E.compute.h5BaseFactor` 退出可写白名单，拒绝新写和旧审批回放；公共投影固定为 0。A5 保留历史识别并标记退役，不再提供编辑入口。已有账单、普通注册礼包和已购设备数据不做追溯修改。

## 验证边界

本仓测试覆盖响应校验、精确键白名单、输入与权限分支。浏览器脚本挂载真实 E6 页面组件及确认弹窗，通过隔离 HTTP 夹具检验提交、失败重试、读回和刷新；夹具不是生产数据库，也不替代真实 A2 全链联调。

服务端行为测试覆盖配置持久化接口调用、读回、公共投影、首次开启、非法值、A2 重放权限及旧 H5 参数拒绝；使用现有测试存储，不声称已经验证线上数据库。

真实手机安装身份、跨设备换绑裁决、原生后台运行与任务调度，以及 APP/H5 原型切换到真实接口，仍须独立联调。此次没有部署线上服务，也没有制作额外可点演示。

最终测试结果和推送提交以本次交付报告与机器检查记录为准。

## 当前工程检查依赖

本轮跨仓检查输入显式指定：`NEXION_APP_ROOT=D:/WORKS/PLAN/nexion-frontend-pc/.verify-cache/phone-app-remote`（正式 APP 远端提交 `a7313520e05ff9c192fbe4185e6c45305bf80349` 的只读源码导出）、`NEXION_JANUS_ROOT=D:/WORKS/PLAN/nexion-frontend-janus`、`NEXION_BACKEND_ROOT=D:/WORKS/PLAN/nexion-backend`、`NEXION_PRD_ROOT=D:/WORKS/PLAN/nexion-frontend-pc/docs/PRD`。重现时应准备对应版本源码；APP 原型不能代替正式 APP 跨仓输入。

Janus 当前不启用，不做其运行验收，现有可执行源码检查保留。主人确认已清理的历史验收文件不再作为当前发布依赖，原 SHA256 清单继续保留及校验记录完整性。全检 86/86 通过；本轮证据和生产联调边界见 `phone-binding-validation.md`。

/**
 * 域 K 已 port 视图注册表。
 * 真渲染面在 k-view.tsx / k-tabs/*;本文件只保留路由 summary。
 * content 固定为空,避免 ModulePage 复活旧静态/样本业务数据。
 */
import type { ModuleEntry } from "@/lib/admin/module-content";
import { PORTED_EMPTY_CONTENT } from "./ported-content";
export const DOMAIN_K: ModuleEntry[] = [
  {
    path: "/risk/multi-account",
    summary: "反多账户引擎(K1)。从 IP、设备指纹、支付工具三层去重,把疑似同一人的账户聚成「关联群」；关联强度达到当前服务端冻结建议阈值时标红。批量冻结、解除误判、判为正常都要确认,冻结记录落到 C2;IP 白名单以 K1 为准。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/risk/abuse",
    summary: "套利 & 刷量检测(K2)。按命中层级分级判定(命中 ≥2 层转人工、3 层全中判定为套利闭环):试用循环、换新套利(门槛在 E3、本页只读)、刷新人礼、刷排行榜(处置归 F8)。K2 只负责标记 + 产出信号,真正批量冻结走 K1 那套流程。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/risk/withdrawal-rules",
    summary: "提现风控规则引擎(K3)。从金额、速度、新账户、收款地址信誉四个维度判定,给出放行 / 延迟 / 冻结 / 转人工四种结果;D2 照这个结果执行,而且优先级高于小额快速通道。增删改规则、启停规则都要确认;规则一旦归档就是终态(不能再激活),「放行」结果不另产事件。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/risk/scoring",
    summary: "风险评分模型(K4)。六个维度按权重(加起来等于 1、两端都校验)合成 0–100 分:低危 <40、中危 40–69、高危 ≥70,≥85 自动建议转人工。这是全平台唯一的评分来源(D2/C1/B5 只引用、不各自重算),每个分都能解释来由;改权重或分档要超级管理员才能执行。",
    content: PORTED_EMPTY_CONTENT,
  },
];

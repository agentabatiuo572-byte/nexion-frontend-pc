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
    summary: "按同 IP、同设备、同支付方式找出疑似同一人的多个账户，关联度高的标红。可批量冻结、解除误判或判为正常。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/risk/abuse",
    summary: "识别反复薅试用、频繁换设备、刷新人奖励和刷榜等异常获利行为并标记。冻结去「多账户风险排查」，刷榜处理去「奖励池、名额与排行榜」。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/risk/withdrawal-rules",
    summary: "按金额、频率、新账户、收款地址四个维度判断提现是放行、延迟、冻结还是转人工。提现审核按这里的结果执行，优先于小额免审；只有已启用规则的维度才参与判断。规则归档后不能再启用。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/risk/scoring",
    summary: "五个维度按权重算出用户风险分（0–100）。权重、打分细则、风险分档和自动升级线均可配置，以生效模型为准。有评分规则修改权限的人可起草，拥有该权限的超级管理员可发布；手动改分、恢复系统评分（含批量）分别按各自权限开放。",
    content: PORTED_EMPTY_CONTENT,
  },
];

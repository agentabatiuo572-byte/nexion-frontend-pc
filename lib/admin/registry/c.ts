/**
 * 域 C 已 port 视图注册表。
 * 真渲染面在 c-view.tsx / c-tabs/*;本文件只保留路由 summary。
 * content 固定为空,避免 ModulePage 复活旧静态/样本业务数据。
 */
import type { ModuleEntry } from "@/lib/admin/module-content";
import { PORTED_EMPTY_CONTENT } from "./ported-content";
export const DOMAIN_C: ModuleEntry[] = [
  {
    path: "/users/search",
    summary: "按条件查找用户，一屏看全分层、设备、风险分、余额和状态。这里只能查看：冻结去「账户操作」，调余额去「余额与资产调整」，安全问题去「安全与登录设备」。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/users/actions",
    summary: "冻结或解冻账户、强制下线、以用户身份只读查看、管理信任和禁入名单。冻结后，该用户进行中的提现会一并冻结并强制下线；只读查看最长 30 分钟。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/users/assets",
    summary: "补偿或纠错时手动增减用户的 USDT / UVT 余额，每笔都要填原因和凭证，由另一位同事复核批准后才生效。超过 500 USDT 等值需财务主管或超级管理员处理。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/users/security",
    summary: "处理用户的账户安全：两步验证、登录设备、重置密码、解除锁定。关闭两步验证和重置密码前务必核实是本人，防止被骗夺号。锁定规则在「注册与登录风险」设置。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/users/reg-risk",
    summary: "防止批量试密码和短信轰炸：设置 App 用户输错锁定规则和人机验证开关。验证码相关设置在「异常套利与刷量排查」，同 IP、同设备、同支付方式的限制在「多账户风险排查」，解锁用户去「安全与登录设备」。",
    content: PORTED_EMPTY_CONTENT,
  },
];

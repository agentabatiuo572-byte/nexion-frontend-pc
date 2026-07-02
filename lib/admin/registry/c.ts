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
    summary: "C 域入口和用户查找页(C1):用多个条件找到人,一屏看全用户的分层、实名、设备、风险分、余额、状态。这里只能查、不能改——数字都是从各域取来的真实值、不在本页重算;要处置去对应页面(冻结去 C2、资产去 C3、实名去 C4、安全去 C5)。用户分层 L0–L5 和会员等级 V0–V12 只有运营看得到,用户端永远看不到。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/users/actions",
    summary: "单个用户的账户处置入口(C2):冻结/解冻、强制退出登录、模拟登录排查问题、信任/禁入名单。冻结记录以本页为准(K1 批量冻结最终也落在这)。冻结确认生效后,服务器会一气呵成连带处理:进行中的提现转为冻结(D2)+ 踢掉该用户全部登录(C5)。模拟登录有三道锁:先授权确认、全程只能看不能改、最多 30 分钟自动断开,而且全程留痕。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/users/assets",
    summary: "客服补偿、系统纠错时手工调用户余额的页面(C3):USDT/NEX 都能加或减,每一笔都要确认 + 填原因和凭证。每笔调整都和账本(D4)在同一笔事务里记一条「人工调整」账单。加钱(往外发)在确认放行那一刻会实时校验备付金覆盖率红线,低于红线就转为挂起(7 天内有效);单笔超过 $500 自动升一级确认。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/users/kyc",
    summary: "全平台实名状态的唯一权威台账(C4):用 $1 钱包配对来验证(这 $1 会进用户余额,等于免费)。提现门槛(D2)、兑换门槛(G2)、大额复审(K5)都统一从这里读真实状态,不各存一份。人工标记或撤销实名属于合规高风险操作,要确认;需要复审时只发一张 K5 工单、最终裁决由 K5 写回;触发复审的阈值在本页只能看(累计线归 K5、兑换额度归 G2 管)。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/users/security",
    summary: "单个用户的账户安全处置页(C5):两步验证、登录会话、重置密码、解除锁定。核心是防止骗子套话夺号:关掉两步验证、重置密码都要先确认 + 先过实名二次核验;密码只存加密后的、谁都看不到明文。锁定分两档解锁:15 分钟短锁过一次二次核验就能解、24 小时长锁要走确认。解锁的处置权都在本页,而「什么情况下锁」的阈值在 C6 配。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/users/reg-risk",
    summary: "注册登录入口的防爆破、防短信轰炸参数页(C6):验证码有效期和发送频次、连续输错锁定的两档阈值、人机验证开关(关闭时必须填恢复时间,到点自动恢复)。和 K1 的分工:这里管「同一个手机号试得太频繁」;同 IP、同设备、同银行卡的去重归 K1 管,在本页提交那三类参数会被服务器打回。解锁不在这页(去 C5),增长角色只能看。",
    content: PORTED_EMPTY_CONTENT,
  },
];

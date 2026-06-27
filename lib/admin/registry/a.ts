/**
 * 域 A 平台基础 — 注册表。accent=--admin-domain-a。
 * ⚠️ A1-A4 ∈ PORTED_DOMAINS:本文件 A1-A4 条目 content 为死代码(真渲染面 = a-view.tsx + a-tabs/),
 * 仅 summary 经 DomainHeader 渲染(design_handoff_a_domain f-desc 压缩版,2026-06-11)。
 * A5 平台参数寄存器有独立旗舰页(/platform/params-registry/page.tsx)覆盖 catch-all,不入 a-view FOLD。
 */
import type { ModuleEntry } from "@/lib/admin/module-content";

const placeholder = { kind: "dashboard" as const };

export const DOMAIN_A: ModuleEntry[] = [
  {
    path: "/platform/rbac",
    summary: "管后台账号、以及每个角色能做哪些操作(谁做过什么记在 A2)。三条不能改的硬规矩:① 所有人登录都要两步验证,关不掉;② 新开的账号默认没有任何权限,要手动分配;③ 平台随时至少保留 2 个超级管理员,免得没人能管。开户、停用、启用、改角色、重置两步验证——只有超级管理员能做,且必须写明原因;强制把账号踢下线只有超管或风控能做,不能踢自己,也不能踢超管账号。改权限表要确认后才发布,系统会自动拦下越权的搭配。",
    content: placeholder,
  },
  {
    path: "/platform/audit",
    summary: "审计与操作确认中心(A2):后台所有高风险操作都在这里留痕,执行前必须填写原因。这本日志只能往里加、谁也改不了删不了(超级管理员也不行),至少保留 13 个月。三条铁规矩:① 只增不改不删;② 必须填原因(服务器强制);③ 确认即执行,而且同一笔操作重复点不会重复执行(网络重试也不会做两次,中途失败时对目标业务零影响)。原因至少写 8 个字,确认后立即写入对应业务和这本审计。",
    content: placeholder,
  },
  {
    path: "/platform/config",
    summary: "系统配置(A3):管整个平台通用的底层开关。① 灰度发布台——新功能先小范围放给一部分人试,放给谁由服务器决定、前端只能拿到结果;② 熔断开关的状态存在这里(开关本身的操作已搬到应急域 J1/J2,本页只能看);③ 系统健康面板——服务端关键依赖的实时状态,只读。",
    content: placeholder,
  },
  {
    path: "/platform/events",
    summary: "数据事件中台(A4):整个后台的数据地基。驾驶舱、资金对账、风控信号、BI 看板和八项 KPI 里的每个数字,都是从这条事件流算出来的,没有临时拍脑袋的查询。资金和 KPI 只认服务器正式发出的事件;界面点击这类事件丢了或重复都不影响资金账。事件里禁止放用户隐私明文(身份证、手机号等),一律转成不可还原的编码或 ID。数据口径的登记和调整(如首日接入按 90 秒判定、留存看第 1/7/30 天、数据留存 13 个月、普通事件抽样 10%、资金事件 100% 全采)以及各业务的分批接入,都由超级管理员走确认弹窗操作。",
    content: placeholder,
  },
  {
    path: "/platform/params-registry",
    summary: "平台参数总览(A5):把全平台运营能调的字段汇成一张索引——88 个平台参数都能在这里查到回源真值(也就是服务器上的当前真实值);A1-A4 和各业务域改过的参数都能在这里反查、一键跳到它所在的页面、或直接发起确认修改。本页是独立页面,不在 A 域标签里切换。",
    content: placeholder,
  },
];

export default DOMAIN_A;

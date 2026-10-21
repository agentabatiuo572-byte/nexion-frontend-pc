/**
 * 域 A 已 port 视图注册表。
 * 真渲染面在 a-view.tsx / a-tabs/*;本文件只保留路由 summary。
 * content 固定为空,避免 ModulePage 复活旧静态/样本业务数据。
 */
import type { ModuleEntry } from "@/lib/admin/module-content";
import { PORTED_EMPTY_CONTENT } from "./ported-content";
export const DOMAIN_A: ModuleEntry[] = [
  {
    path: "/platform/rbac",
    summary: "管后台账号、以及每个角色能做哪些操作。登录安全、最小权限、超级管理员保护、开户、停用、启用、改角色、重置两步验证和强制登出都以服务端返回为准,所有敏感动作都必须写明原因并进入审计。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/platform/audit",
    summary: "审计与操作确认中心(A2):后台所有高风险操作都在这里留痕,执行前必须填写原因。审计不可改写,确认动作由服务器执行时防止重复生效,重复提交不会重复影响目标业务。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/platform/config",
    summary: "系统配置(A3):管整个平台通用的底层开关。① 分批开放设置——新功能先小范围放给一部分人试,放给谁由服务器决定、前端只能拿到结果;② 紧急停止开关的状态存在这里(开关本身的操作已搬到应急域 J1/J2,本页只能看);③ 系统健康面板——服务端关键依赖的实时状态,只读。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/platform/events",
    summary: "数据事件管理(A4):运营总览、资金对账、风控信号和分析报表都以服务端事件流为准。统计规则登记、调整和业务接入都走确认流程,事件里禁止放用户隐私明文。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/platform/params-registry",
    summary: "平台参数总览(A5):把全平台运营能调的字段汇成索引,从服务端读取当前真实值;A1-A4 和各业务域改过的参数都能在这里反查、一键跳到所在页面、或发起确认修改。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/platform/roles",
    summary: "角色管理(A6):配置各类管理员的角色权限。管理角色(8 内置 + 自定义),为每个角色绑定权限码(操作权)与菜单(可见性)。改授权走操作确认 + 审计,并即时失效该角色下账号的权限缓存。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/platform/menus",
    summary: "菜单管理(A7):运营后台导航菜单树(13 域 → 页)的增删改、排序、显隐。仅已部署的页面可加入导航。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/platform/permissions",
    summary: "权限清单(A8):浏览全平台查询、修改及敏感操作的权限。按域/类型筛选 + 搜索 + 分页,查看每个权限点所属菜单、是否放大资金流出、已绑定角色数。权限标识由系统维护，本页不能新增或删除。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/platform/developer-access",
    summary: "开发者访问审批(A9):查看开发者访问申请，批准、驳回或撤销申请。提交时填写备注，系统会检查状态是否变化、防止重复执行并保存操作记录。",
    content: PORTED_EMPTY_CONTENT,
  },
];

export default DOMAIN_A;

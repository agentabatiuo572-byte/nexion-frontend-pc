import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router'
import Layout from '@/views/layout/Layout.vue'
import { useAuthStore } from '@/store/auth'

export const constantRoutes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/login/index.vue'),
    meta: { title: '登录' }
  },
  {
    path: '/',
    component: Layout,
    redirect: '/home',
    children: [
      {
        path: 'home',
        name: 'home',
        component: () => import('@/views/home/index.vue'),
        meta: { title: '首页', icon: 'HomeFilled' }
      }
    ]
  },
  {
    path: '/ums',
    component: Layout,
    redirect: '/ums/admin',
    meta: { title: '权限', icon: 'Lock' },
    children: [
      { path: 'admin', name: 'admin', component: () => import('@/views/ums/admin/index.vue'), meta: { title: '管理员列表', icon: 'User' } },
      { path: 'role', name: 'role', component: () => import('@/views/ums/role/index.vue'), meta: { title: '角色列表', icon: 'UserFilled' } },
      { path: 'menu', name: 'menu', component: () => import('@/views/ums/menu/index.vue'), meta: { title: '菜单管理', icon: 'Menu' } },
      { path: 'permission', name: 'permission', component: () => import('@/views/ums/permission/index.vue'), meta: { title: 'API 权限', icon: 'Key' } }
    ]
  },
  {
    path: '/commerce',
    component: Layout,
    redirect: '/commerce/products',
    meta: { title: '商城交易', icon: 'ShoppingCart' },
    children: [
      { path: 'products', name: 'commerceProducts', component: () => import('@/views/commerce/index.vue'), props: { defaultTab: 'products' }, meta: { title: '商品 SKU', icon: 'Goods' } },
      { path: 'orders', name: 'commerceOrders', component: () => import('@/views/commerce/index.vue'), props: { defaultTab: 'orders' }, meta: { title: '订单管理', icon: 'Tickets' } },
      { path: 'payments', name: 'commercePayments', component: () => import('@/views/commerce/index.vue'), props: { defaultTab: 'payments' }, meta: { title: '支付对账', icon: 'CreditCard' } },
      { path: 'tradeins', name: 'commerceTradeins', component: () => import('@/views/commerce/index.vue'), props: { defaultTab: 'tradeins' }, meta: { title: 'Trade-in', icon: 'Refresh' } }
    ]
  },
  {
    path: '/genesis',
    component: Layout,
    redirect: '/genesis/series',
    meta: { title: 'Genesis', icon: 'Star' },
    children: [
      { path: 'series', name: 'genesisSeries', component: () => import('@/views/genesis/index.vue'), props: { defaultTab: 'series' }, meta: { title: '系列配置', icon: 'Collection' } },
      { path: 'orders', name: 'genesisOrders', component: () => import('@/views/genesis/index.vue'), props: { defaultTab: 'orders' }, meta: { title: 'Genesis 订单', icon: 'Tickets' } },
      { path: 'holdings', name: 'genesisHoldings', component: () => import('@/views/genesis/index.vue'), props: { defaultTab: 'holdings' }, meta: { title: 'Genesis 持仓', icon: 'Medal' } }
    ]
  },
  {
    path: '/compute',
    component: Layout,
    redirect: '/compute/devices',
    meta: { title: '设备算力', icon: 'Cpu' },
    children: [
      { path: 'devices', name: 'computeDevices', component: () => import('@/views/compute/index.vue'), props: { defaultTab: 'devices' }, meta: { title: '设备实例', icon: 'Cpu' } },
      { path: 'lifecycle', name: 'computeLifecycle', component: () => import('@/views/compute/index.vue'), props: { defaultTab: 'lifecycle' }, meta: { title: '生命周期', icon: 'Timer' } },
      { path: 'tasks', name: 'computeTasks', component: () => import('@/views/compute/index.vue'), props: { defaultTab: 'tasks' }, meta: { title: '计算任务', icon: 'Operation' } },
      { path: 'receipts', name: 'computeReceipts', component: () => import('@/views/compute/index.vue'), props: { defaultTab: 'receipts' }, meta: { title: 'Receipt', icon: 'DocumentChecked' } },
      { path: 'node-map', name: 'computeNodeMap', component: () => import('@/views/compute/index.vue'), props: { defaultTab: 'node-map' }, meta: { title: '节点地图', icon: 'MapLocation' } }
    ]
  },
  {
    path: '/wallet',
    component: Layout,
    redirect: '/wallet/overview',
    meta: { title: '钱包运营', icon: 'Wallet' },
    children: [
      { path: 'overview', name: 'walletOverview', component: () => import('@/views/wallet/index.vue'), props: { defaultTab: 'overview' }, meta: { title: '钱包概览', icon: 'Wallet' } },
      { path: 'ledgers', name: 'walletLedgers', component: () => import('@/views/wallet/index.vue'), props: { defaultTab: 'ledgers' }, meta: { title: '钱包流水', icon: 'Tickets' } },
      { path: 'deposits', name: 'walletDeposits', component: () => import('@/views/wallet/index.vue'), props: { defaultTab: 'deposits' }, meta: { title: '充值记录', icon: 'Download' } },
      { path: 'withdrawals', name: 'walletWithdrawals', component: () => import('@/views/wallet/index.vue'), props: { defaultTab: 'withdrawals' }, meta: { title: '提现广播', icon: 'Upload' } }
    ]
  },
  {
    path: '/compliance',
    component: Layout,
    redirect: '/compliance/kyc',
    meta: { title: '合规风控', icon: 'Checked' },
    children: [
      { path: 'kyc', name: 'complianceKyc', component: () => import('@/views/compliance/index.vue'), props: { defaultTab: 'kyc' }, meta: { title: 'KYC', icon: 'UserFilled' } },
      { path: 'risk-decisions', name: 'complianceRisk', component: () => import('@/views/compliance/index.vue'), props: { defaultTab: 'risk' }, meta: { title: '风险决策', icon: 'DataAnalysis' } },
      { path: 'review', name: 'complianceReview', component: () => import('@/views/compliance/index.vue'), props: { defaultTab: 'review' }, meta: { title: '人工复核', icon: 'Warning' } },
      { path: 'blacklists', name: 'complianceBlacklists', component: () => import('@/views/compliance/index.vue'), props: { defaultTab: 'blacklists' }, meta: { title: '黑名单', icon: 'CircleClose' } },
      { path: 'proof-assets', name: 'complianceProof', component: () => import('@/views/compliance/index.vue'), props: { defaultTab: 'proof' }, meta: { title: 'Proof 资产', icon: 'Files' } }
    ]
  },
  {
    path: '/system',
    component: Layout,
    redirect: '/system/configs',
    meta: { title: '系统配置', icon: 'Setting' },
    children: [
      { path: 'configs', name: 'systemConfigs', component: () => import('@/views/system/index.vue'), props: { defaultTab: 'configs' }, meta: { title: '后台配置', icon: 'Setting' } },
      { path: 'public-config', name: 'systemPublicConfig', component: () => import('@/views/system/index.vue'), props: { defaultTab: 'public' }, meta: { title: '公共配置', icon: 'View' } },
      { path: 'i18n', name: 'systemI18n', component: () => import('@/views/system/index.vue'), props: { defaultTab: 'i18n' }, meta: { title: '多语言', icon: 'ChatLineSquare' } },
      { path: 'content', name: 'systemContent', component: () => import('@/views/system/index.vue'), props: { defaultTab: 'content' }, meta: { title: '内容页', icon: 'Document' } },
      { path: 'help', name: 'systemHelp', component: () => import('@/views/system/index.vue'), props: { defaultTab: 'help' }, meta: { title: '帮助中心', icon: 'QuestionFilled' } }
    ]
  },
  {
    path: '/openapi',
    component: Layout,
    redirect: '/openapi/apps',
    meta: { title: 'OpenAPI', icon: 'Connection' },
    children: [
      { path: 'apps', name: 'openapiApps', component: () => import('@/views/openapi/index.vue'), props: { defaultTab: 'apps' }, meta: { title: '应用管理', icon: 'Key' } },
      { path: 'call-audits', name: 'openapiCallAudits', component: () => import('@/views/openapi/index.vue'), props: { defaultTab: 'call-audits' }, meta: { title: '调用审计', icon: 'DataLine' } },
      { path: 'webhooks', name: 'openapiWebhooks', component: () => import('@/views/openapi/index.vue'), props: { defaultTab: 'webhooks' }, meta: { title: 'Webhook', icon: 'Position' } }
    ]
  },
  {
    path: '/audit',
    component: Layout,
    redirect: '/audit/logs',
    meta: { title: '审计', icon: 'DataLine' },
    children: [
      { path: 'logs', name: 'auditLogs', component: () => import('@/views/audit/index.vue'), props: { defaultTab: 'logs' }, meta: { title: '审计日志', icon: 'Document' } },
      { path: 'stats', name: 'auditStats', component: () => import('@/views/audit/index.vue'), props: { defaultTab: 'stats' }, meta: { title: '审计统计', icon: 'DataAnalysis' } }
    ]
  },
  {
    path: '/team',
    component: Layout,
    redirect: '/team/rank-config',
    meta: { title: '团队', icon: 'Connection' },
    children: [
      { path: 'rank-config', name: 'rankConfig', component: () => import('@/views/team/rank/config.vue'), meta: { title: '等级配置', icon: 'Medal' } },
      { path: 'rank-evaluate', name: 'rankEvaluate', component: () => import('@/views/team/rank/evaluate.vue'), meta: { title: '等级评估', icon: 'Aim' } },
      { path: 'commission-records', name: 'commissionRecords', component: () => import('@/views/team/commission/records.vue'), meta: { title: '佣金记录', icon: 'Tickets' } },
      { path: 'commission-settle', name: 'commissionSettle', component: () => import('@/views/team/commission/settle.vue'), meta: { title: '佣金结算', icon: 'Money' } }
    ]
  },
  { path: '/ops/device', redirect: '/compute/devices' },
  { path: '/ops/wallet', redirect: '/wallet/overview' },
  { path: '/ops/config', redirect: '/system/configs' },
  {
    path: '/:pathMatch(.*)*',
    redirect: '/home'
  }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes: constantRoutes
})

router.beforeEach(async (to) => {
  const authStore = useAuthStore()
  if (to.path === '/login') {
    return authStore.isLoggedIn ? '/home' : true
  }
  if (!authStore.isLoggedIn) {
    return { path: '/login', query: { redirect: to.fullPath } }
  }
  if (!authStore.admin) {
    try {
      await authStore.loadCurrentAdmin()
    } catch {
      authStore.logout()
      return { path: '/login', query: { redirect: to.fullPath } }
    }
  }
  return true
})

export default router

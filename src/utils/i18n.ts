import { computed } from 'vue'
import { useAppStore } from '@/store/app'

export type AdminLocale = 'zh-CN' | 'en-US'

const messages = {
  'zh-CN': {
    'app.name': '后台管理系统',
    'common.language': '语言',
    'common.zh': '中文',
    'common.en': 'English',
    'common.profile': '个人资料',
    'common.password': '修改密码',
    'common.logout': '退出登录',
    'common.cancel': '取消',
    'common.save': '保存',
    'common.confirmChange': '确认修改',
    'common.username': '用户名',
    'common.nickname': '昵称',
    'common.phone': '手机号',
    'common.email': '邮箱',
    'common.oldPassword': '原密码',
    'common.newPassword': '新密码',
    'common.confirmPassword': '确认密码',
    'message.profileUpdated': '个人资料已更新',
    'message.passwordUpdated': '密码已更新',
    'message.logoutSuccess': '已退出登录',
    'message.passwordRequired': '请输入原密码和新密码',
    'message.passwordMismatch': '两次输入的新密码不一致',
    'confirm.logout': '确认退出当前账号?',
    'title.logout': '退出登录'
  },
  'en-US': {
    'app.name': 'Admin Console',
    'common.language': 'Language',
    'common.zh': '中文',
    'common.en': 'English',
    'common.profile': 'Profile',
    'common.password': 'Change Password',
    'common.logout': 'Log Out',
    'common.cancel': 'Cancel',
    'common.save': 'Save',
    'common.confirmChange': 'Confirm',
    'common.username': 'Username',
    'common.nickname': 'Nickname',
    'common.phone': 'Phone',
    'common.email': 'Email',
    'common.oldPassword': 'Old Password',
    'common.newPassword': 'New Password',
    'common.confirmPassword': 'Confirm Password',
    'message.profileUpdated': 'Profile updated',
    'message.passwordUpdated': 'Password updated',
    'message.logoutSuccess': 'Logged out',
    'message.passwordRequired': 'Please enter old and new passwords',
    'message.passwordMismatch': 'The new passwords do not match',
    'confirm.logout': 'Log out of the current account?',
    'title.logout': 'Log Out'
  }
} as const

const enumMessages = {
  'zh-CN': {
    ACTIVE: '启用',
    FROZEN: '冻结',
    INACTIVE: '禁用',
    ENABLED: '启用',
    DISABLED: '禁用',
    ADMIN: '后台可见',
    PUBLIC: '公开可见',
    ON_SALE: '上架',
    OFF_SALE: '下架',
    SOLD_OUT: '售罄',
    ARCHIVED: '归档',
    RELEASED: '已释放',
    LEASED: '已租约',
    RUNNING: '运行中',
    DEAD: '死信',
    TIMEOUT: '超时',
    CREATED: '已创建',
    QUOTED: '已报价',
    SUBMITTED: '已提交',
    ONLINE: '在线',
    OFFLINE: '离线',
    BUSY: '忙碌',
    PENDING: '待处理',
    APPROVED: '已通过',
    REJECTED: '已拒绝',
    VERIFIED: '已验证',
    PROCESSING: '处理中',
    COMPLETED: '已完成',
    SUCCESS: '成功',
    SUCCEEDED: '成功',
    FAILED: '失败',
    CANCELLED: '已取消',
    CLOSED: '已关闭',
    OPEN: '打开',
    WAITING_AGENT: '待客服处理',
    WAITING_USER: '待用户回复',
    RESOLVED: '已解决',
    PAID: '已支付',
    UNPAID: '未支付',
    EXPIRED: '已过期',
    REFUNDED: '已退款',
    WAITING_PAYMENT: '待支付',
    PAYMENT_PENDING: '待支付',
    PAYMENT_SUCCESS: '支付成功',
    PAYMENT_FAILED: '支付失败',
    CREDIT: '入账',
    DEBIT: '出账',
    ACTIVATED: '已激活',
    DEACTIVATED: '已停用',
    DEVICE: '设备',
    HARDWARE: '硬件',
    NEXION_BOX: 'Nexion Box',
    NEXION_RACK: 'Nexion Rack',
    MOBILE: '移动端',
    CLOUD_SHARE: '云共享',
    GENESIS: 'Genesis',
    DEFAULT: '默认',
    PRODUCT_TYPE: '商品类型',
    TIER: '档位',
    PRODUCT_ID: '商品 ID',
    POINTS: '积分',
    NEX: 'NEX',
    USDT: 'USDT',
    SPIN: '抽奖次数',
    BADGE: '徽章',
    HIGH: '高',
    MEDIUM: '中',
    LOW: '低',
    URGENT: '紧急',
    NORMAL: '普通',
    GENERAL: '通用',
    ACCOUNT: '账号',
    PAYMENT: '支付',
    WALLET: '钱包',
    WITHDRAWAL: '提现',
    WITHDRAWAL_REFUND: '提现退款',
    EXCHANGE: '兑换',
    OPS: '运营',
    RISK_RULE: '风控规则',
    CHAIN_RISK: '链上风险',
    MANUAL: '人工',
    KYC: 'KYC',
    OTHER: '其他',
    PASSPORT: '护照',
    ID_CARD: '身份证',
    DRIVER_LICENSE: '驾照',
    COMPUTE_RECEIPT: '算力凭证',
    KYC_DOCUMENT: 'KYC 文档',
    WALLET_TRANSACTION: '钱包流水',
    GENESIS_ORDER: 'Genesis 订单',
    MANUAL_REVIEW: '人工复核',
    POC_RECEIPT: '算力凭证',
    AI_INFERENCE: 'AI 推理',
    BENCHMARK: '基准测试',
    ACCESSORY: '配件',
    REGISTERED: '已注册',
    PHONE_COMPUTE_CONNECTED: '算力已连接',
    FIRST_EARNING_RECEIVED: '已获得首笔收益',
    STORE_VIEWED: '已浏览商城',
    TEAM_VOLUME_CHANGED: '团队业绩变化',
    ORDER_PAID: '订单已支付',
    APPROVE: '通过',
    REJECT: '拒绝',
    REVIEW: '复核',
    ALLOW: '放行',
    BLOCK: '拦截',
    DIRECT: '直推',
    INDIRECT: '间推'
  },
  'en-US': {
    ACTIVE: 'Active',
    FROZEN: 'Frozen',
    INACTIVE: 'Inactive',
    ENABLED: 'Enabled',
    DISABLED: 'Disabled',
    ADMIN: 'Admin Visible',
    PUBLIC: 'Public Visible',
    ON_SALE: 'On Sale',
    OFF_SALE: 'Off Sale',
    SOLD_OUT: 'Sold Out',
    ARCHIVED: 'Archived',
    RELEASED: 'Released',
    LEASED: 'Leased',
    RUNNING: 'Running',
    DEAD: 'Dead',
    TIMEOUT: 'Timeout',
    CREATED: 'Created',
    QUOTED: 'Quoted',
    SUBMITTED: 'Submitted',
    ONLINE: 'Online',
    OFFLINE: 'Offline',
    BUSY: 'Busy',
    PENDING: 'Pending',
    APPROVED: 'Approved',
    REJECTED: 'Rejected',
    VERIFIED: 'Verified',
    PROCESSING: 'Processing',
    COMPLETED: 'Completed',
    SUCCESS: 'Success',
    SUCCEEDED: 'Succeeded',
    FAILED: 'Failed',
    CANCELLED: 'Cancelled',
    CLOSED: 'Closed',
    OPEN: 'Open',
    WAITING_AGENT: 'Waiting Agent',
    WAITING_USER: 'Waiting User',
    RESOLVED: 'Resolved',
    PAID: 'Paid',
    UNPAID: 'Unpaid',
    EXPIRED: 'Expired',
    REFUNDED: 'Refunded',
    WAITING_PAYMENT: 'Waiting Payment',
    PAYMENT_PENDING: 'Payment Pending',
    PAYMENT_SUCCESS: 'Payment Success',
    PAYMENT_FAILED: 'Payment Failed',
    CREDIT: 'Credit',
    DEBIT: 'Debit',
    ACTIVATED: 'Activated',
    DEACTIVATED: 'Deactivated',
    DEVICE: 'Device',
    HARDWARE: 'Hardware',
    NEXION_BOX: 'Nexion Box',
    NEXION_RACK: 'Nexion Rack',
    MOBILE: 'Mobile',
    CLOUD_SHARE: 'Cloud Share',
    GENESIS: 'Genesis',
    DEFAULT: 'Default',
    PRODUCT_TYPE: 'Product Type',
    TIER: 'Tier',
    PRODUCT_ID: 'Product ID',
    POINTS: 'Points',
    NEX: 'NEX',
    USDT: 'USDT',
    SPIN: 'Spin',
    BADGE: 'Badge',
    HIGH: 'High',
    MEDIUM: 'Medium',
    LOW: 'Low',
    URGENT: 'Urgent',
    NORMAL: 'Normal',
    GENERAL: 'General',
    ACCOUNT: 'Account',
    PAYMENT: 'Payment',
    WALLET: 'Wallet',
    WITHDRAWAL: 'Withdrawal',
    WITHDRAWAL_REFUND: 'Withdrawal Refund',
    EXCHANGE: 'Exchange',
    OPS: 'Ops',
    RISK_RULE: 'Risk Rule',
    CHAIN_RISK: 'Chain Risk',
    MANUAL: 'Manual',
    KYC: 'KYC',
    OTHER: 'Other',
    PASSPORT: 'Passport',
    ID_CARD: 'ID Card',
    DRIVER_LICENSE: 'Driver License',
    COMPUTE_RECEIPT: 'Compute Receipt',
    KYC_DOCUMENT: 'KYC Document',
    WALLET_TRANSACTION: 'Wallet Transaction',
    GENESIS_ORDER: 'Genesis Order',
    MANUAL_REVIEW: 'Manual Review',
    POC_RECEIPT: 'PoC Receipt',
    AI_INFERENCE: 'AI Inference',
    BENCHMARK: 'Benchmark',
    ACCESSORY: 'Accessory',
    REGISTERED: 'Registered',
    PHONE_COMPUTE_CONNECTED: 'Phone Compute Connected',
    FIRST_EARNING_RECEIVED: 'First Earning Received',
    STORE_VIEWED: 'Store Viewed',
    TEAM_VOLUME_CHANGED: 'Team Volume Changed',
    ORDER_PAID: 'Order Paid',
    APPROVE: 'Approve',
    REJECT: 'Reject',
    REVIEW: 'Review',
    ALLOW: 'Allow',
    BLOCK: 'Block',
    DIRECT: 'Direct',
    INDIRECT: 'Indirect'
  }
} as const

function currentLocale(): AdminLocale {
  const locale = localStorage.getItem('nexion_admin_locale') || 'zh-CN'
  return locale.toLowerCase().startsWith('en') ? 'en-US' : 'zh-CN'
}

function humanize(value: string) {
  return value
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export function t(key: keyof typeof messages['zh-CN'] | string) {
  const locale = currentLocale()
  return (messages[locale] as Record<string, string>)[key] || (messages['zh-CN'] as Record<string, string>)[key] || key
}

export function enumLabel(value: unknown) {
  if (value == null || value === '') return '-'
  if (typeof value === 'boolean') return value ? (currentLocale() === 'zh-CN' ? '启用' : 'Enabled') : (currentLocale() === 'zh-CN' ? '禁用' : 'Disabled')
  if (Number(value) === 1 && String(value) === '1') return currentLocale() === 'zh-CN' ? '启用' : 'Enabled'
  if (Number(value) === 0 && String(value) === '0') return currentLocale() === 'zh-CN' ? '禁用' : 'Disabled'
  const raw = String(value)
  const locale = currentLocale()
  return (enumMessages[locale] as Record<string, string>)[raw] || (locale === 'en-US' ? humanize(raw) : raw)
}

export function enumOptions(values: Array<string | number>) {
  return values.map((value) => ({ value, label: enumLabel(value) }))
}

export function localeText(zh: string, en: string) {
  return currentLocale() === 'en-US' ? en : zh
}

export function enumTableFormatter(_row: unknown, _column: unknown, cellValue: unknown) {
  return enumLabel(cellValue)
}

export function useAdminI18n() {
  const appStore = useAppStore()
  const locale = computed(() => (appStore.locale.toLowerCase().startsWith('en') ? 'en-US' : 'zh-CN') as AdminLocale)
  return {
    locale,
    t,
    localeText,
    enumLabel,
    enumOptions,
    setLocale: appStore.setLocale
  }
}

import http, { type NexionRequestConfig } from '@/utils/http'
import type { AnyRecord, CommonPage, Id, PageParam } from '@/types/common'

export interface Product {
  id?: Id
  productNo?: string
  name?: string
  productType?: string
  tier?: string
  status?: string
  priceUsdt?: string | number
  hashrate?: string | number
  estimatedDailyUsdt?: string | number
  dailyNex?: string | number
  stock?: number
  coverUrl?: string
  createdAt?: string
  updatedAt?: string
  [key: string]: unknown
}

export interface ProductQuery extends PageParam {
  keyword?: string
  productType?: string
  status?: string
}

export interface GenesisSeries {
  id?: Id
  seriesCode?: string
  name?: string
  totalSupply?: number
  soldSupply?: number
  priceUsdt?: string | number
  status?: string
  saleStartAt?: string
  saleEndAt?: string
  royaltyBps?: number
  coverUrl?: string
  metadataJson?: string
  [key: string]: unknown
}

export interface UserDevice {
  id?: Id
  userId?: Id
  sourceOrderNo?: string
  productId?: Id
  productTier?: string
  instanceNo?: string
  name?: string
  deviceType?: string
  status?: string
  hashrate?: string | number
  dailyUsdt?: string | number
  dailyNex?: string | number
  lastSeenAt?: string
  purchasedAt?: string
  activatedAt?: string
  pendingDeactivate?: number
  monthsOwned?: number
  currentEfficiency?: string | number
  effectiveDailyUsdt?: string | number
  effectiveDailyNex?: string | number
  [key: string]: unknown
}

export interface DeviceLifecycleRule {
  id?: Id
  scopeType?: string
  scopeValue?: string
  startMonth?: number
  endMonth?: number | null
  monthlyDecayRate?: string | number
  floorEfficiency?: string | number
  exempt?: number
  status?: number
  sortOrder?: number
  [key: string]: unknown
}

export interface DeviceLifecycle {
  userDeviceId?: Id
  monthsOwned?: number
  currentEfficiency?: string | number
  effectiveDailyUsdt?: string | number
  effectiveDailyNex?: string | number
  floorEfficiency?: string | number
  exempt?: boolean
  [key: string]: unknown
}

export interface ConfigItem {
  id?: Id
  configKey?: string
  configValue?: string
  valueType?: string
  configGroup?: string
  visibility?: string
  remark?: string
  status?: number
  createdAt?: string
  updatedAt?: string
  [key: string]: unknown
}

export interface SupportTicketMessage {
  id?: Id
  ticketNo?: string
  senderId?: Id
  senderType?: string
  senderName?: string
  content?: string
  createdAt?: string
  attachments?: AnyRecord[]
  [key: string]: unknown
}

export interface SupportTicket {
  id?: Id
  ticketNo?: string
  userId?: Id
  category?: string
  priority?: string
  status?: string
  title?: string
  lastMessage?: string
  assignedAdminId?: Id
  assignedAdminName?: string
  userUnreadCount?: number
  opsUnreadCount?: number
  messageCount?: number
  lastMessageAt?: string
  closedAt?: string
  createdAt?: string
  updatedAt?: string
  messages?: SupportTicketMessage[]
  [key: string]: unknown
}

export interface SupportTicketQuery extends PageParam {
  status?: string
  category?: string
  priority?: string
  userId?: Id | ''
  assignedAdminId?: Id | ''
}

export interface MonthlyChallenge {
  id?: Id
  challengeId?: Id
  challengeCode?: string
  challengeName?: string
  description?: string
  theme?: string
  monthsFrom?: number
  monthsTo?: number
  targetType?: string
  targetValue?: number
  progressValue?: number
  progressPercent?: number
  rewardType?: string
  rewardAmount?: string | number
  rewardName?: string
  badgeAchievementCode?: string
  sortOrder?: number
  status?: number | string
  claimedAt?: string
  createdAt?: string
  updatedAt?: string
  [key: string]: unknown
}

export interface EventQuest {
  id?: Id
  questId?: Id
  questCode?: string
  questName?: string
  description?: string
  startsAt?: string
  endsAt?: string
  targetType?: string
  targetValue?: number
  progressValue?: number
  progressPercent?: number
  rewardType?: string
  rewardAmount?: string | number
  rewardName?: string
  badgeAchievementCode?: string
  sortOrder?: number
  status?: number | string
  claimedAt?: string
  createdAt?: string
  updatedAt?: string
  [key: string]: unknown
}

export interface LimitQuery {
  limit?: number
  [key: string]: unknown
}

function pageParams(params?: PageParam) {
  if (!params) return undefined
  const { current, size, ...rest } = params
  return {
    ...rest,
    pageNum: params.pageNum ?? current,
    pageSize: params.pageSize ?? size
  }
}

export function getProducts(params?: ProductQuery, config?: NexionRequestConfig) {
  return http<CommonPage<Product>>({ url: '/commerce/products', method: 'get', params: pageParams(params), ...config })
}

export function createProduct(data: Product) {
  return http<Product>({ url: '/commerce/products', method: 'post', data })
}

export function updateProduct(id: Id, data: Product) {
  return http<Product>({ url: `/commerce/products/${id}`, method: 'patch', data })
}

export function getGenesisSeries(params?: { status?: string; current?: number; size?: number }, config?: NexionRequestConfig) {
  return http<CommonPage<GenesisSeries>>({
    url: '/genesis/series',
    method: 'get',
    params: pageParams({ current: params?.current ?? 1, size: params?.size ?? 20, status: params?.status }),
    ...config
  })
}

export function createGenesisSeries(data: GenesisSeries) {
  return http<GenesisSeries>({ url: '/genesis/series', method: 'post', data })
}

export function updateGenesisSeries(id: Id, data: GenesisSeries) {
  return http<GenesisSeries>({ url: `/genesis/series/${id}`, method: 'patch', data })
}

export function getGenesisOrders(params: PageParam, config?: NexionRequestConfig) {
  return http<CommonPage<AnyRecord>>({ url: '/genesis/orders', method: 'get', params: pageParams(params), ...config })
}

export function getGenesisHoldings(params: PageParam, config?: NexionRequestConfig) {
  return http<CommonPage<AnyRecord>>({ url: '/genesis/holdings', method: 'get', params: pageParams(params), ...config })
}

export function getComputeDevices(params: PageParam, config?: NexionRequestConfig) {
  return http<CommonPage<UserDevice>>({ url: '/compute/devices', method: 'get', params: pageParams(params), ...config })
}

export function activateDevice(id: Id) {
  return http<UserDevice>({ url: `/compute/devices/${id}/activate`, method: 'post' })
}

export function deactivateDevice(id: Id) {
  return http<UserDevice>({ url: `/compute/devices/${id}/deactivate`, method: 'post' })
}

export function scheduleDeviceDeactivation(id: Id) {
  return http<UserDevice>({ url: `/compute/devices/${id}/deactivation-schedule`, method: 'post' })
}

export function getDeviceLifecycle(id: Id, config?: NexionRequestConfig) {
  return http<DeviceLifecycle>({ url: `/compute/devices/${id}/lifecycle`, method: 'get', ...config })
}

export function getDeviceFleetConfig(config?: NexionRequestConfig) {
  return http<{ maxActiveSlots: number }>({ url: '/config/device-fleet', method: 'get', ...config })
}

export function getDeviceLifecycleConfig(config?: NexionRequestConfig) {
  return http<{ rules: DeviceLifecycleRule[] }>({ url: '/config/device-lifecycle', method: 'get', ...config })
}

export function getDeviceLifecycleRules(params?: { status?: number | string }, config?: NexionRequestConfig) {
  return http<DeviceLifecycleRule[]>({ url: '/compute/device-lifecycle/rules', method: 'get', params, ...config })
}

export function createDeviceLifecycleRule(data: DeviceLifecycleRule) {
  return http<DeviceLifecycleRule>({ url: '/compute/device-lifecycle/rules', method: 'post', data })
}

export function updateDeviceLifecycleRule(id: Id, data: DeviceLifecycleRule) {
  return http<DeviceLifecycleRule>({ url: `/compute/device-lifecycle/rules/${id}`, method: 'patch', data })
}

export function getTradeinConfig(config?: NexionRequestConfig) {
  return http<{ rules: AnyRecord[] }>({ url: '/config/tradein', method: 'get', ...config })
}

export function getSystemConfigs(params?: { query?: string; status?: number | string; limit?: number }, config?: NexionRequestConfig) {
  return http<ConfigItem[]>({ url: '/system/configs', method: 'get', params, ...config })
}

export function createSystemConfig(data: ConfigItem) {
  return http<ConfigItem>({ url: '/system/configs', method: 'post', data })
}

export function updateSystemConfig(id: Id, data: ConfigItem) {
  return http<ConfigItem>({ url: `/system/configs/${id}`, method: 'patch', data })
}

export function getDayOneConfig(config?: NexionRequestConfig) {
  return http<AnyRecord>({ url: '/config/day-one', method: 'get', ...config })
}

export function getFeatureConfig(config?: NexionRequestConfig) {
  return http<AnyRecord>({ url: '/config/features', method: 'get', ...config })
}

export function getBffOpsDashboard(days = 7, config?: NexionRequestConfig) {
  return http<AnyRecord>({ url: '/bff/ops/dashboard', method: 'get', params: { days }, ...config })
}

export function getMissionOpsOverview(config?: NexionRequestConfig) {
  return http<AnyRecord>({ url: '/missions/ops/overview', method: 'get', ...config })
}

export function getMonthlyChallenges(params?: PageParam & { status?: string | number }, config?: NexionRequestConfig) {
  return http<CommonPage<MonthlyChallenge>>({
    url: '/missions/ops/monthly-challenges',
    method: 'get',
    params: pageParams(params),
    ...config
  })
}

export function createMonthlyChallenge(data: MonthlyChallenge) {
  return http<MonthlyChallenge>({ url: '/missions/ops/monthly-challenges', method: 'post', data })
}

export function updateMonthlyChallenge(id: Id, data: MonthlyChallenge) {
  return http<MonthlyChallenge>({ url: `/missions/ops/monthly-challenges/${id}`, method: 'patch', data })
}

export function updateMonthlyChallengeProgress(challengeCode: string, userId: Id, progressValue: number) {
  return http<MonthlyChallenge>({
    url: `/missions/ops/monthly-challenges/${challengeCode}/users/${userId}/progress`,
    method: 'patch',
    data: { progressValue }
  })
}

export function getEventQuests(params?: PageParam & { status?: string | number }, config?: NexionRequestConfig) {
  return http<CommonPage<EventQuest>>({
    url: '/missions/ops/event-quests',
    method: 'get',
    params: pageParams(params),
    ...config
  })
}

export function createEventQuest(data: EventQuest) {
  return http<EventQuest>({ url: '/missions/ops/event-quests', method: 'post', data })
}

export function updateEventQuest(id: Id, data: EventQuest) {
  return http<EventQuest>({ url: `/missions/ops/event-quests/${id}`, method: 'patch', data })
}

export function updateEventQuestProgress(questCode: string, userId: Id, progressValue: number) {
  return http<EventQuest>({
    url: `/missions/ops/event-quests/${questCode}/users/${userId}/progress`,
    method: 'patch',
    data: { progressValue }
  })
}

export function getMissionConsumerSummary(params?: { consumerGroup?: string }, config?: NexionRequestConfig) {
  return http<AnyRecord[]>({ url: '/missions/outbox/consumer/summary', method: 'get', params, ...config })
}

export function getMissionConsumerDead(params?: { consumerGroup?: string; limit?: number }, config?: NexionRequestConfig) {
  return http<AnyRecord[]>({ url: '/missions/outbox/consumer/dead', method: 'get', params, ...config })
}

export function getMissionConsumerEvent(eventId: string, params?: { consumerGroup?: string }, config?: NexionRequestConfig) {
  return http<AnyRecord | null>({ url: `/missions/outbox/consumer/events/${eventId}`, method: 'get', params, ...config })
}

export function getMissionConsumerAggregate(
  aggregateType: string,
  aggregateId: string,
  params?: { limit?: number },
  config?: NexionRequestConfig
) {
  return http<AnyRecord[]>({
    url: `/missions/outbox/consumer/aggregates/${aggregateType}/${aggregateId}`,
    method: 'get',
    params,
    ...config
  })
}

export function getNotificationOpsOverview(config?: NexionRequestConfig) {
  return http<AnyRecord>({ url: '/notifications/ops/overview', method: 'get', ...config })
}

export function pushPendingNotifications(limit = 20) {
  return http<AnyRecord>({ url: '/notifications/ops/push-pending', method: 'post', params: { limit } })
}

export function getNotificationConsumerSummary(params?: { consumerGroup?: string }, config?: NexionRequestConfig) {
  return http<AnyRecord[]>({ url: '/notifications/outbox/consumer/summary', method: 'get', params, ...config })
}

export function getNotificationConsumerDead(params?: { consumerGroup?: string; limit?: number }, config?: NexionRequestConfig) {
  return http<AnyRecord[]>({ url: '/notifications/outbox/consumer/dead', method: 'get', params, ...config })
}

export function getNotificationConsumerEvent(eventId: string, params?: { consumerGroup?: string }, config?: NexionRequestConfig) {
  return http<AnyRecord | null>({ url: `/notifications/outbox/consumer/events/${eventId}`, method: 'get', params, ...config })
}

export function getNotificationConsumerAggregate(
  aggregateType: string,
  aggregateId: string,
  params?: { limit?: number },
  config?: NexionRequestConfig
) {
  return http<AnyRecord[]>({
    url: `/notifications/outbox/consumer/aggregates/${aggregateType}/${aggregateId}`,
    method: 'get',
    params,
    ...config
  })
}

export function getCommerceOpsStats(days = 7, config?: NexionRequestConfig) {
  return http<AnyRecord>({ url: '/commerce/ops/stats', method: 'get', params: { days }, ...config })
}

export function getCommerceOrders(params: PageParam, config?: NexionRequestConfig) {
  return http<CommonPage<AnyRecord>>({ url: '/commerce/orders', method: 'get', params: pageParams(params), ...config })
}

export function getCommerceOrder(orderNo: string, config?: NexionRequestConfig) {
  return http<AnyRecord>({ url: `/commerce/orders/${orderNo}`, method: 'get', ...config })
}

export function getCommercePayments(params: PageParam, config?: NexionRequestConfig) {
  return http<CommonPage<AnyRecord>>({ url: '/commerce/payments', method: 'get', params: pageParams(params), ...config })
}

export function getCommercePayment(paymentNo: string, config?: NexionRequestConfig) {
  return http<AnyRecord>({ url: `/commerce/payments/${paymentNo}`, method: 'get', ...config })
}

export function expirePendingPayments(limit = 20) {
  return http<AnyRecord>({ url: '/commerce/payments/ops/expire-pending', method: 'post', params: { limit } })
}

export function reconcilePayment(paymentNo: string) {
  return http<AnyRecord>({ url: `/commerce/payments/ops/reconcile/${paymentNo}`, method: 'post' })
}

export function reconcileDuePayments(limit = 20) {
  return http<AnyRecord>({ url: '/commerce/payments/ops/reconcile-due', method: 'post', params: { limit } })
}

export function getPaymentAnomalies(limit = 20, config?: NexionRequestConfig) {
  return http<AnyRecord[]>({ url: '/commerce/payments/ops/anomalies', method: 'get', params: { limit }, ...config })
}

export function getTradeins(params: PageParam, config?: NexionRequestConfig) {
  return http<CommonPage<AnyRecord>>({ url: '/commerce/tradeins', method: 'get', params: pageParams(params), ...config })
}

export function getTradein(tradeinNo: string, config?: NexionRequestConfig) {
  return http<AnyRecord>({ url: `/commerce/tradeins/${tradeinNo}`, method: 'get', ...config })
}

export function getGenesisOverview(params?: { userId?: Id }, config?: NexionRequestConfig) {
  return http<AnyRecord>({ url: '/genesis/overview', method: 'get', params, ...config })
}

export function getComputeTasks(params: PageParam, config?: NexionRequestConfig) {
  return http<CommonPage<AnyRecord>>({ url: '/compute/tasks', method: 'get', params: pageParams(params), ...config })
}

export function dispatchComputeTask(data: AnyRecord) {
  return http<AnyRecord>({ url: '/compute/tasks/dispatch', method: 'post', data })
}

export function processComputeTaskTimeouts(limit = 20) {
  return http<AnyRecord>({ url: '/compute/tasks/maintenance/timeouts', method: 'post', params: { limit } })
}

export function retryDueComputeTasks(limit = 20) {
  return http<AnyRecord>({ url: '/compute/tasks/maintenance/retries', method: 'post', params: { limit } })
}

export function getComputeReceipts(params: PageParam, config?: NexionRequestConfig) {
  return http<CommonPage<AnyRecord>>({ url: '/compute/receipts', method: 'get', params: pageParams(params), ...config })
}

export function getComputeNodeMap(limit = 100, config?: NexionRequestConfig) {
  return http<AnyRecord>({ url: '/compute/devices/node-map', method: 'get', params: { limit }, ...config })
}

export function getComplianceOpsStats(days = 7, config?: NexionRequestConfig) {
  return http<AnyRecord>({ url: '/compliance/ops/stats', method: 'get', params: { days }, ...config })
}

export function getKycProfiles(params?: LimitQuery, config?: NexionRequestConfig) {
  return http<AnyRecord[]>({ url: '/compliance/kyc-profiles', method: 'get', params, ...config })
}

export function submitKycProfile(data: AnyRecord) {
  return http<AnyRecord>({ url: '/compliance/kyc-profiles', method: 'post', data })
}

export function approveKycProfile(userId: Id, data: AnyRecord) {
  return http<AnyRecord>({ url: `/compliance/kyc-profiles/${userId}/approve`, method: 'post', data })
}

export function rejectKycProfile(userId: Id, data: AnyRecord) {
  return http<AnyRecord>({ url: `/compliance/kyc-profiles/${userId}/reject`, method: 'post', data })
}

export function expireKycProfile(userId: Id, data: AnyRecord) {
  return http<AnyRecord>({ url: `/compliance/kyc-profiles/${userId}/expire`, method: 'post', data })
}

export function expireApprovedKycProfiles(limit = 50, reviewer = 'ops-kyc-expiry') {
  return http<AnyRecord>({ url: '/compliance/kyc-profiles/maintenance/expire-approved', method: 'post', params: { limit, reviewer } })
}

export function getRiskDecisions(params?: LimitQuery, config?: NexionRequestConfig) {
  return http<AnyRecord[]>({ url: '/compliance/risk-decisions', method: 'get', params, ...config })
}

export function getRiskDecisionSummary(days = 7, config?: NexionRequestConfig) {
  return http<AnyRecord>({ url: '/compliance/risk-decisions/summary', method: 'get', params: { days }, ...config })
}

export function getRiskDecisionReview(limit = 20, config?: NexionRequestConfig) {
  return http<AnyRecord[]>({ url: '/compliance/risk-decisions/review', method: 'get', params: { limit }, ...config })
}

export function approveRiskDecision(decisionNo: string, data: AnyRecord) {
  return http<AnyRecord>({ url: `/compliance/risk-decisions/${decisionNo}/approve`, method: 'post', data })
}

export function rejectRiskDecision(decisionNo: string, data: AnyRecord) {
  return http<AnyRecord>({ url: `/compliance/risk-decisions/${decisionNo}/reject`, method: 'post', data })
}

export function getRiskBlacklists(params?: LimitQuery, config?: NexionRequestConfig) {
  return http<AnyRecord[]>({ url: '/compliance/blacklists', method: 'get', params, ...config })
}

export function upsertRiskBlacklist(data: AnyRecord) {
  return http<AnyRecord>({ url: '/compliance/blacklists', method: 'post', data })
}

export function releaseRiskBlacklist(userId: Id, data: AnyRecord) {
  return http<AnyRecord>({ url: `/compliance/blacklists/${userId}/release`, method: 'post', data })
}

export function getProofAssets(params?: LimitQuery, config?: NexionRequestConfig) {
  return http<AnyRecord[]>({ url: '/compliance/proof-assets', method: 'get', params, ...config })
}

export function createProofAsset(data: AnyRecord) {
  return http<AnyRecord>({ url: '/compliance/proof-assets', method: 'post', data })
}

export function verifyProofAsset(proofNo: string, data: AnyRecord) {
  return http<AnyRecord>({ url: `/compliance/proof-assets/${proofNo}/verify`, method: 'post', data })
}

export function rejectProofAsset(proofNo: string, data: AnyRecord) {
  return http<AnyRecord>({ url: `/compliance/proof-assets/${proofNo}/reject`, method: 'post', data })
}

export function archiveProofAsset(proofNo: string) {
  return http<AnyRecord>({ url: `/compliance/proof-assets/${proofNo}`, method: 'delete' })
}

export function getEvidenceDownloadUrl(params: { objectKey: string; expiresInSeconds?: number }, config?: NexionRequestConfig) {
  return http<AnyRecord>({ url: '/compliance/evidence/download-url', method: 'get', params, ...config })
}

export function getWalletOpsStats(days = 7, config?: NexionRequestConfig) {
  return http<AnyRecord>({ url: '/wallet/ops/stats', method: 'get', params: { days }, ...config })
}

export function getWalletUser(userId: Id, config?: NexionRequestConfig) {
  return http<AnyRecord>({ url: `/wallet/users/${userId}`, method: 'get', ...config })
}

export function getWalletLedgers(params: PageParam, config?: NexionRequestConfig) {
  return http<CommonPage<AnyRecord>>({ url: '/wallet/ledgers', method: 'get', params: pageParams(params), ...config })
}

export function getWithdrawalBroadcastSummary(config?: NexionRequestConfig) {
  return http<AnyRecord>({ url: '/wallet/withdrawals/broadcast/summary', method: 'get', ...config })
}

export function getWithdrawalBroadcastPending(limit = 20, config?: NexionRequestConfig) {
  return http<AnyRecord[]>({ url: '/wallet/withdrawals/broadcast/pending', method: 'get', params: { limit }, ...config })
}

export function getWithdrawalBroadcastDead(limit = 20, config?: NexionRequestConfig) {
  return http<AnyRecord[]>({ url: '/wallet/withdrawals/broadcast/dead', method: 'get', params: { limit }, ...config })
}

export function publishWithdrawalBroadcast(limit = 20) {
  return http<AnyRecord>({ url: '/wallet/withdrawals/broadcast/publish', method: 'post', params: { limit } })
}

export function getDepositRecords(params?: { chainTxHash?: string; asset?: string }, config?: NexionRequestConfig) {
  return http<AnyRecord[]>({ url: '/wallet/deposits/records', method: 'get', params, ...config })
}

export function getDepositPending(limit = 20, config?: NexionRequestConfig) {
  return http<AnyRecord[]>({ url: '/wallet/deposits/pending', method: 'get', params: { limit }, ...config })
}

export function getDepositDead(limit = 20, config?: NexionRequestConfig) {
  return http<AnyRecord[]>({ url: '/wallet/deposits/dead', method: 'get', params: { limit }, ...config })
}

export function getDepositDetail(depositNo: string, config?: NexionRequestConfig) {
  return http<AnyRecord>({ url: `/wallet/ops/deposits/${depositNo}`, method: 'get', ...config })
}

export function manualDeposit(data: AnyRecord) {
  return http<AnyRecord>({ url: '/wallet/ops/deposits/manual', method: 'post', data })
}

export function retryDeposit(depositNo: string, reason?: string) {
  return http<AnyRecord>({ url: `/wallet/ops/deposits/${depositNo}/retry`, method: 'post', data: { reason } })
}

export function getWithdrawalDetail(withdrawalNo: string, config?: NexionRequestConfig) {
  return http<AnyRecord>({ url: `/wallet/ops/withdrawals/${withdrawalNo}`, method: 'get', ...config })
}

export function retryWithdrawalBroadcast(withdrawalNo: string, reason?: string) {
  return http<AnyRecord>({ url: `/wallet/ops/withdrawals/${withdrawalNo}/retry-broadcast`, method: 'post', data: { reason } })
}

export function markWithdrawalSucceeded(withdrawalNo: string, data: { chainTxHash?: string; reason?: string }) {
  return http<AnyRecord>({ url: `/wallet/ops/withdrawals/${withdrawalNo}/mark-succeeded`, method: 'post', data })
}

export function markWithdrawalFailed(withdrawalNo: string, data: { reason: string }) {
  return http<AnyRecord>({ url: `/wallet/ops/withdrawals/${withdrawalNo}/mark-failed`, method: 'post', data })
}

export function getSystemOpsDashboard(days = 7, config?: NexionRequestConfig) {
  return http<AnyRecord>({ url: '/system/ops/dashboard', method: 'get', params: { days }, ...config })
}

export function getSupportTickets(params: SupportTicketQuery, config?: NexionRequestConfig) {
  return http<CommonPage<SupportTicket>>({
    url: '/system/support/ops/tickets',
    method: 'get',
    params: pageParams(params),
    ...config
  })
}

export function getSupportTicket(ticketNo: string, config?: NexionRequestConfig) {
  return http<SupportTicket>({ url: `/system/support/ops/tickets/${ticketNo}`, method: 'get', ...config })
}

export function replySupportTicket(ticketNo: string, content: string) {
  return http<SupportTicket>({ url: `/system/support/ops/tickets/${ticketNo}/messages`, method: 'post', data: { content } })
}

export function updateSupportTicket(ticketNo: string, data: Partial<SupportTicket>) {
  return http<SupportTicket>({ url: `/system/support/ops/tickets/${ticketNo}`, method: 'patch', data })
}

export function getI18nMessages(params?: LimitQuery, config?: NexionRequestConfig) {
  return http<AnyRecord[]>({ url: '/system/i18n/messages', method: 'get', params, ...config })
}

export function createI18nMessage(data: AnyRecord) {
  return http<AnyRecord>({ url: '/system/i18n/messages', method: 'post', data })
}

export function updateI18nMessage(id: Id, data: AnyRecord) {
  return http<AnyRecord>({ url: `/system/i18n/messages/${id}`, method: 'patch', data })
}

export function getContentPages(params?: LimitQuery, config?: NexionRequestConfig) {
  return http<AnyRecord[]>({ url: '/system/content/pages', method: 'get', params, ...config })
}

export function createContentPage(data: AnyRecord) {
  return http<AnyRecord>({ url: '/system/content/pages', method: 'post', data })
}

export function updateContentPage(id: Id, data: AnyRecord) {
  return http<AnyRecord>({ url: `/system/content/pages/${id}`, method: 'patch', data })
}

export function getHelpArticles(params?: LimitQuery, config?: NexionRequestConfig) {
  return http<AnyRecord[]>({ url: '/system/help/articles', method: 'get', params, ...config })
}

export function createHelpArticle(data: AnyRecord) {
  return http<AnyRecord>({ url: '/system/help/articles', method: 'post', data })
}

export function updateHelpArticle(id: Id, data: AnyRecord) {
  return http<AnyRecord>({ url: `/system/help/articles/${id}`, method: 'patch', data })
}

export function getOpenApiOpsStats(days = 7, config?: NexionRequestConfig) {
  return http<AnyRecord>({ url: '/openapi/ops/stats', method: 'get', params: { days }, ...config })
}

export function getOpenApiApps(params?: LimitQuery, config?: NexionRequestConfig) {
  return http<AnyRecord[]>({ url: '/openapi/ops/apps', method: 'get', params, ...config })
}

export function enableOpenApiApp(appId: Id) {
  return http<AnyRecord>({ url: `/openapi/ops/apps/${appId}/enable`, method: 'post' })
}

export function disableOpenApiApp(appId: Id) {
  return http<AnyRecord>({ url: `/openapi/ops/apps/${appId}/disable`, method: 'post' })
}

export function updateOpenApiAppQuotas(appId: Id, data: AnyRecord) {
  return http<AnyRecord>({ url: `/openapi/ops/apps/${appId}/quotas`, method: 'patch', data })
}

export function getOpenApiCallAudits(params?: LimitQuery, config?: NexionRequestConfig) {
  return http<AnyRecord[]>({ url: '/openapi/ops/call-audits', method: 'get', params, ...config })
}

export function getWebhookDeliveries(params?: LimitQuery, config?: NexionRequestConfig) {
  return http<AnyRecord[]>({ url: '/openapi/webhooks/deliveries', method: 'get', params, ...config })
}

export function getWebhookDeliverySummary(config?: NexionRequestConfig) {
  return http<AnyRecord>({ url: '/openapi/webhooks/deliveries/summary', method: 'get', ...config })
}

export function publishWebhookDeliveries(limit = 20) {
  return http<AnyRecord>({ url: '/openapi/webhooks/deliveries/publish', method: 'post', params: { limit } })
}

export function getAuditLogs(params?: LimitQuery, config?: NexionRequestConfig) {
  return http<AnyRecord[]>({ url: '/audit/logs', method: 'get', params, ...config })
}

export function getAuditTrace(traceId: string, config?: NexionRequestConfig) {
  return http<AnyRecord[]>({ url: `/audit/logs/trace/${traceId}`, method: 'get', ...config })
}

export function getAuditStatsSummary(params?: LimitQuery, config?: NexionRequestConfig) {
  return http<AnyRecord>({ url: '/audit/stats/summary', method: 'get', params, ...config })
}

export function getAuditStatsActions(params?: LimitQuery, config?: NexionRequestConfig) {
  return http<AnyRecord[]>({ url: '/audit/stats/actions', method: 'get', params, ...config })
}

export function getAuditStatsServices(params?: LimitQuery, config?: NexionRequestConfig) {
  return http<AnyRecord[]>({ url: '/audit/stats/services', method: 'get', params, ...config })
}

export function getAuditStatsUsers(params?: LimitQuery, config?: NexionRequestConfig) {
  return http<AnyRecord[]>({ url: '/audit/stats/users', method: 'get', params, ...config })
}

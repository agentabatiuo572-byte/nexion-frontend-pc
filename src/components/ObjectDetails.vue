<script setup lang="ts">
import { computed } from 'vue'
import { formatDateTime } from '@/utils/date'
import { enumLabel, localeText } from '@/utils/i18n'

type DetailField = {
  key: string
  label: string
  value: unknown
  span: number
}

type ArraySection = {
  key: string
  title: string
  rows: Record<string, unknown>[]
  columns: string[]
}

const props = withDefaults(defineProps<{
  data?: unknown
  emptyText?: string
}>(), {
  emptyText: ''
})

const labelMap: Record<string, { zh: string; en: string }> = {
  id: { zh: 'ID', en: 'ID' },
  no: { zh: '编号', en: 'No.' },
  index: { zh: '序号', en: 'Index' },
  value: { zh: '值', en: 'Value' },
  total: { zh: '总数', en: 'Total' },
  count: { zh: '数量', en: 'Count' },
  days: { zh: '统计天数', en: 'Days' },
  success: { zh: '成功', en: 'Success' },
  failed: { zh: '失败', en: 'Failed' },
  pending: { zh: '待处理', en: 'Pending' },
  dead: { zh: '死信', en: 'Dead' },
  processing: { zh: '处理中', en: 'Processing' },
  records: { zh: '记录', en: 'Records' },
  userId: { zh: '用户 ID', en: 'User ID' },
  actorId: { zh: '操作者 ID', en: 'Actor ID' },
  username: { zh: '用户名', en: 'Username' },
  nickname: { zh: '昵称', en: 'Nickname' },
  phone: { zh: '手机号', en: 'Phone' },
  status: { zh: '状态', en: 'Status' },
  result: { zh: '结果', en: 'Result' },
  riskLevel: { zh: '风险等级', en: 'Risk Level' },
  createdAt: { zh: '创建时间', en: 'Created At' },
  updatedAt: { zh: '更新时间', en: 'Updated At' },
  creditedAt: { zh: '入账时间', en: 'Credited At' },
  paidAt: { zh: '支付时间', en: 'Paid At' },
  expiresAt: { zh: '过期时间', en: 'Expires At' },
  nextRetryAt: { zh: '下次重试', en: 'Next Retry At' },
  deadAt: { zh: '死信时间', en: 'Dead At' },
  broadcastDeadAt: { zh: '广播死信时间', en: 'Broadcast Dead At' },
  amount: { zh: '金额', en: 'Amount' },
  amountUsdt: { zh: '金额 USDT', en: 'Amount USDT' },
  balance: { zh: '余额', en: 'Balance' },
  availableBalance: { zh: '可用余额', en: 'Available Balance' },
  frozenBalance: { zh: '冻结余额', en: 'Frozen Balance' },
  pendingWithdraw: { zh: '待提现金额', en: 'Pending Withdrawal' },
  balanceAfter: { zh: '变动后余额', en: 'Balance After' },
  priceUsdt: { zh: '价格 USDT', en: 'Price USDT' },
  asset: { zh: '资产', en: 'Asset' },
  direction: { zh: '方向', en: 'Direction' },
  bizNo: { zh: '业务号', en: 'Biz No.' },
  bizType: { zh: '业务类型', en: 'Biz Type' },
  orderNo: { zh: '订单号', en: 'Order No.' },
  paymentNo: { zh: '支付单号', en: 'Payment No.' },
  withdrawalNo: { zh: '提现单号', en: 'Withdrawal No.' },
  depositNo: { zh: '充值单号', en: 'Deposit No.' },
  deposits: { zh: '充值统计', en: 'Deposit Stats' },
  deposit: { zh: '充值', en: 'Deposit' },
  withdrawals: { zh: '提现统计', en: 'Withdrawal Stats' },
  withdrawal: { zh: '提现', en: 'Withdrawal' },
  ledger: { zh: '流水统计', en: 'Ledger Stats' },
  ledgers: { zh: '流水记录', en: 'Ledger Records' },
  broadcast: { zh: '广播', en: 'Broadcast' },
  broadcastSummary: { zh: '广播汇总', en: 'Broadcast Summary' },
  published: { zh: '已发布', en: 'Published' },
  retried: { zh: '已重试', en: 'Retried' },
  processed: { zh: '已处理', en: 'Processed' },
  expired: { zh: '已过期', en: 'Expired' },
  reconciled: { zh: '已对账', en: 'Reconciled' },
  credited: { zh: '已入账', en: 'Credited' },
  confirmations: { zh: '确认数', en: 'Confirmations' },
  fee: { zh: '手续费', en: 'Fee' },
  currency: { zh: '币种', en: 'Currency' },
  chain: { zh: '链', en: 'Chain' },
  chainTxHash: { zh: '链上哈希', en: 'Chain Tx Hash' },
  targetAddress: { zh: '目标地址', en: 'Target Address' },
  chainBroadcastAttempts: { zh: '广播尝试次数', en: 'Broadcast Attempts' },
  chainSubmittedAt: { zh: '链上提交时间', en: 'Chain Submitted At' },
  chainSucceededAt: { zh: '链上成功时间', en: 'Chain Succeeded At' },
  reason: { zh: '原因', en: 'Reason' },
  remark: { zh: '备注', en: 'Remark' },
  error: { zh: '错误', en: 'Error' },
  lastError: { zh: '最后错误', en: 'Last Error' },
  lastBroadcastError: { zh: '最后广播错误', en: 'Last Broadcast Error' },
  message: { zh: '消息', en: 'Message' },
  topic: { zh: 'Topic', en: 'Topic' },
  consumerGroup: { zh: 'Consumer Group', en: 'Consumer Group' },
  eventId: { zh: 'Event ID', en: 'Event ID' },
  eventType: { zh: '事件类型', en: 'Event Type' },
  aggregateType: { zh: '聚合类型', en: 'Aggregate Type' },
  aggregateId: { zh: '聚合 ID', en: 'Aggregate ID' },
  traceId: { zh: 'Trace ID', en: 'Trace ID' },
  serviceName: { zh: '服务', en: 'Service' },
  action: { zh: '操作', en: 'Action' },
  resourceType: { zh: '资源类型', en: 'Resource Type' },
  resourceId: { zh: '资源 ID', en: 'Resource ID' },
  appId: { zh: 'App ID', en: 'App ID' },
  appKey: { zh: 'App Key', en: 'App Key' },
  apiPath: { zh: 'API 路径', en: 'API Path' },
  responseCode: { zh: '响应码', en: 'Response Code' },
  costMs: { zh: '耗时 ms', en: 'Cost ms' },
  taskNo: { zh: '任务号', en: 'Task No.' },
  taskType: { zh: '任务类型', en: 'Task Type' },
  receiptNo: { zh: '凭证号', en: 'Receipt No.' },
  deviceId: { zh: '设备 ID', en: 'Device ID' },
  userDeviceId: { zh: '用户设备 ID', en: 'User Device ID' },
  seriesCode: { zh: '系列编码', en: 'Series Code' },
  holdingNo: { zh: '持仓号', en: 'Holding No.' },
  tokenNo: { zh: 'Token No', en: 'Token No' }
}

const enumKeys = new Set([
  'status',
  'result',
  'riskLevel',
  'direction',
  'bizType',
  'type',
  'eventType',
  'asset',
  'category',
  'priority',
  'visibility',
  'scopeType',
  'rewardType',
  'targetType',
  'productType',
  'paymentStatus',
  'orderStatus',
  'activationStatus',
  'settlementStatus',
  'deviceType',
  'taskType'
])

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === '[object Object]'
}

function lastKey(path: string) {
  return path.split('.').at(-1) || path
}

function labelOf(path: string) {
  const key = lastKey(path)
  const mapped = labelMap[key]
  if (mapped) return localeText(mapped.zh, mapped.en)
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, (char) => char.toUpperCase())
}

function isDateKey(key: string) {
  return /(At|Time|Date)$/.test(key) || key.toLowerCase().includes('time')
}

function formatValue(key: string, value: unknown) {
  if (value == null || value === '') return '-'
  if (typeof value === 'boolean') return enumLabel(value)
  if (enumKeys.has(lastKey(key))) return enumLabel(value)
  if (typeof value === 'string' && isDateKey(key)) return formatDateTime(value)
  return String(value)
}

function isLongField(key: string, value: unknown) {
  const text = String(value ?? '')
  return text.length > 64 || /(hash|address|error|message|reason|remark|url|json|metadata|payload|request|response)/i.test(key)
}

function fieldOf(key: string, value: unknown): DetailField {
  return {
    key,
    label: labelOf(key),
    value,
    span: isLongField(key, value) ? 2 : 1
  }
}

function primitiveFields(record: Record<string, unknown>, prefix = '') {
  return Object.entries(record)
    .filter(([, value]) => !isPlainObject(value) && !Array.isArray(value))
    .map(([key, value]) => fieldOf(prefix ? `${prefix}.${key}` : key, value))
}

function nestedObjectFields(record: Record<string, unknown>, prefix = ''): DetailField[] {
  return Object.entries(record).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key
    if (isPlainObject(value)) return nestedObjectFields(value, path)
    if (Array.isArray(value)) return []
    return [fieldOf(path, value)]
  })
}

function arrayRows(value: unknown[]) {
  if (value.every((item) => isPlainObject(item))) return value as Record<string, unknown>[]
  return value.map((item, index) => ({ index: index + 1, value: item }))
}

function arrayColumns(rows: Record<string, unknown>[]) {
  const keys = Array.from(new Set(rows.flatMap((row) => Object.keys(row).filter((key) => {
    const value = row[key]
    return !isPlainObject(value) && !Array.isArray(value)
  }))))
  return keys.slice(0, 8)
}

const rootRecord = computed(() => {
  if (isPlainObject(props.data)) return props.data
  return null
})

const rootArray = computed(() => {
  if (Array.isArray(props.data)) return arrayRows(props.data)
  return []
})

const summaryFields = computed(() => {
  if (rootRecord.value) return primitiveFields(rootRecord.value)
  if (props.data == null || props.data === '') return []
  if (Array.isArray(props.data)) return []
  return [fieldOf('value', props.data)]
})

const objectSections = computed(() => {
  if (!rootRecord.value) return []
  return Object.entries(rootRecord.value)
    .filter(([, value]) => isPlainObject(value))
    .map(([key, value]) => ({
      key,
      title: labelOf(key),
      fields: nestedObjectFields(value as Record<string, unknown>, key)
    }))
    .filter((section) => section.fields.length)
})

const arraySections = computed<ArraySection[]>(() => {
  if (!rootRecord.value) return []
  return Object.entries(rootRecord.value)
    .filter(([, value]) => Array.isArray(value))
    .map(([key, value]) => {
      const rows = arrayRows(value as unknown[])
      return {
        key,
        title: labelOf(key),
        rows,
        columns: arrayColumns(rows)
      }
    })
    .filter((section) => section.rows.length)
})

const rootArrayColumns = computed(() => arrayColumns(rootArray.value))

const hasContent = computed(() => {
  return summaryFields.value.length || objectSections.value.length || arraySections.value.length || rootArray.value.length
})
</script>

<template>
  <el-empty v-if="!hasContent" :description="emptyText || localeText('暂无数据', 'No Data')" />
  <div v-else class="object-details">
    <el-descriptions v-if="summaryFields.length" :column="2" border class="detail-section">
      <el-descriptions-item v-for="field in summaryFields" :key="field.key" :label="field.label" :span="field.span">
        <span class="detail-value">{{ formatValue(field.key, field.value) }}</span>
      </el-descriptions-item>
    </el-descriptions>

    <el-card v-for="section in objectSections" :key="section.key" shadow="never" class="detail-section">
      <template #header>{{ section.title }}</template>
      <el-descriptions :column="2" border>
        <el-descriptions-item v-for="field in section.fields" :key="field.key" :label="field.label" :span="field.span">
          <span class="detail-value">{{ formatValue(field.key, field.value) }}</span>
        </el-descriptions-item>
      </el-descriptions>
    </el-card>

    <el-card v-for="section in arraySections" :key="section.key" shadow="never" class="detail-section">
      <template #header>{{ section.title }}</template>
      <el-table :data="section.rows" border size="small">
        <el-table-column v-for="column in section.columns" :key="column" :prop="column" :label="labelOf(column)" min-width="130">
          <template #default="{ row }">
            <span class="detail-value">{{ formatValue(column, row[column]) }}</span>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-table v-if="rootArray.length" :data="rootArray" border size="small" class="detail-section">
      <el-table-column v-for="column in rootArrayColumns" :key="column" :prop="column" :label="labelOf(column)" min-width="130">
        <template #default="{ row }">
          <span class="detail-value">{{ formatValue(column, row[column]) }}</span>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>

<style scoped>
.object-details {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.detail-section {
  width: 100%;
}

.detail-value {
  white-space: pre-wrap;
  word-break: break-word;
}
</style>

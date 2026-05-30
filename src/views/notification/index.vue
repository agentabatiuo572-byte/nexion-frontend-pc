<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  getNotificationConsumerAggregate,
  getNotificationConsumerDead,
  getNotificationConsumerEvent,
  getNotificationConsumerSummary,
  getNotificationOpsOverview,
  pushPendingNotifications
} from '@/apis/operation'
import type { AnyRecord } from '@/types/common'
import { formatNow, formatTableDateTime } from '@/utils/date'
import { localeText as lt, enumLabel } from '@/utils/i18n'
import ObjectDetails from '@/components/ObjectDetails.vue'

const props = withDefaults(defineProps<{ defaultTab?: string }>(), { defaultTab: 'overview' })

const activeTab = ref(props.defaultTab)
const loading = ref(false)
const actionLoading = ref(false)
const overview = ref<AnyRecord | null>(null)
const summary = ref<AnyRecord[]>([])
const deadRows = ref<AnyRecord[]>([])
const aggregateRows = ref<AnyRecord[]>([])
const eventRecord = ref<AnyRecord | null>(null)
const detailVisible = ref(false)
const detailTitle = ref(lt('详情', 'Details'))
const detailRecord = ref<unknown>(null)
const lastAction = ref('')

const consumerQuery = reactive({
  consumerGroup: 'nexion-notification-earning-generated',
  limit: 20,
  eventId: '',
  aggregateType: '',
  aggregateId: ''
})
const pushForm = reactive({ limit: 20 })

const responsibilities = computed(() => {
  const values = overview.value?.responsibilities
  return Array.isArray(values) ? values.join(' / ') : '-'
})

function valueOf(record: AnyRecord | null | undefined, key: string) {
  const value = key.split('.').reduce<unknown>((current, part) => {
    return current && typeof current === 'object' ? (current as AnyRecord)[part] : undefined
  }, record || undefined)
  return value == null || value === '' ? '-' : String(value)
}

function compactParams(params: AnyRecord) {
  return Object.fromEntries(Object.entries(params).filter(([, value]) => value !== '' && value != null))
}

function summaryTotal(status: string) {
  return summary.value
    .filter((item) => String(item.status || '').toUpperCase() === status)
    .reduce((total, item) => total + Number(item.total || 0), 0)
}

function statusType(status: unknown) {
  const value = String(status || '').toUpperCase()
  if (value === 'SUCCESS') return 'success'
  if (value === 'DEAD') return 'danger'
  if (value === 'FAILED') return 'warning'
  if (value === 'PROCESSING') return 'primary'
  return 'info'
}

function showDetail(title: string, row: unknown) {
  detailTitle.value = title
  detailRecord.value = row
  detailVisible.value = true
}

async function loadOverview() {
  overview.value = await getNotificationOpsOverview({ silentError: true }).catch(() => null)
}

async function loadConsumer() {
  const params = compactParams({ consumerGroup: consumerQuery.consumerGroup, limit: consumerQuery.limit })
  const [summaryRes, deadRes] = await Promise.allSettled([
    getNotificationConsumerSummary(compactParams({ consumerGroup: consumerQuery.consumerGroup }), { silentError: true }),
    getNotificationConsumerDead(params, { silentError: true })
  ])
  summary.value = summaryRes.status === 'fulfilled' ? summaryRes.value : []
  deadRows.value = deadRes.status === 'fulfilled' ? deadRes.value : []
}

async function queryEvent() {
  if (!consumerQuery.eventId) return
  eventRecord.value = await getNotificationConsumerEvent(
    consumerQuery.eventId,
    compactParams({ consumerGroup: consumerQuery.consumerGroup }),
    { silentError: true }
  ).catch(() => null)
  showDetail(lt('事件详情', 'Event Details'), eventRecord.value)
}

async function queryAggregate() {
  if (!consumerQuery.aggregateType || !consumerQuery.aggregateId) return
  aggregateRows.value = await getNotificationConsumerAggregate(
    consumerQuery.aggregateType,
    consumerQuery.aggregateId,
    { limit: consumerQuery.limit },
    { silentError: true }
  ).catch(() => [])
}

async function pushPending() {
  await ElMessageBox.confirm(`${lt('确认处理待推送通知? 本次最多', 'Confirm processing pending push notifications? Up to')} ${pushForm.limit} ${lt('条', 'items')}`, lt('通知推送', 'Notification Push'), { type: 'warning' })
  actionLoading.value = true
  try {
    const result = await pushPendingNotifications(Number(pushForm.limit || 20))
    const count = result?.processed ?? result?.pushed ?? result?.count ?? result?.total ?? '-'
    ElMessage.success(lt('待推送处理完成', 'Pending push processed'))
    lastAction.value = `${lt('待推送处理完成', 'Pending push processed')}: ${count} ${lt('条', 'items')}, ${formatNow()}`
    await loadConsumer()
  } finally {
    actionLoading.value = false
  }
}

async function loadData() {
  loading.value = true
  try {
    await Promise.all([loadOverview(), loadConsumer()])
  } finally {
    loading.value = false
  }
}

watch(() => props.defaultTab, (value) => {
  activeTab.value = value
})

watch(activeTab, loadData)

onMounted(loadData)
</script>

<template>
  <div>
    <el-row :gutter="16" class="app-card">
      <el-col :xs="24" :sm="12" :md="6">
        <el-card shadow="never" class="stat-card">
          <div class="table-toolbar"><span>{{ lt('服务', 'Service') }}</span><el-icon color="#409eff" :size="24"><Bell /></el-icon></div>
          <div class="small-value">{{ valueOf(overview, 'service') }}</div>
        </el-card>
      </el-col>
      <el-col :xs="24" :sm="12" :md="6">
        <el-card shadow="never" class="stat-card">
          <div class="table-toolbar"><span>{{ lt('数据库', 'Database') }}</span><el-icon color="#67c23a" :size="24"><Coin /></el-icon></div>
          <div class="small-value">{{ valueOf(overview, 'database') }}</div>
        </el-card>
      </el-col>
      <el-col :xs="24" :sm="12" :md="6">
        <el-card shadow="never" class="stat-card">
          <div class="table-toolbar"><span>SUCCESS</span><el-icon color="#67c23a" :size="24"><CircleCheck /></el-icon></div>
          <div class="value">{{ summaryTotal('SUCCESS') }}</div>
        </el-card>
      </el-col>
      <el-col :xs="24" :sm="12" :md="6">
        <el-card shadow="never" class="stat-card">
          <div class="table-toolbar"><span>DEAD</span><el-icon color="#f56c6c" :size="24"><Warning /></el-icon></div>
          <div class="value">{{ summaryTotal('DEAD') }}</div>
        </el-card>
      </el-col>
    </el-row>

    <el-card shadow="never">
      <div class="table-toolbar">
        <span>{{ lt('通知触达', 'Notification Ops') }}</span>
        <el-button :icon="'Refresh'" @click="loadData">{{ lt('刷新', 'Refresh') }}</el-button>
      </div>
      <el-alert v-if="lastAction" :title="lastAction" type="success" show-icon :closable="false" class="operation-alert" />

      <el-tabs v-model="activeTab">
        <el-tab-pane :label="lt('概览', 'Overview')" name="overview">
          <el-descriptions v-loading="loading" :column="2" border>
            <el-descriptions-item :label="lt('服务', 'Service')">{{ valueOf(overview, 'service') }}</el-descriptions-item>
            <el-descriptions-item :label="lt('数据库', 'Database')">{{ valueOf(overview, 'database') }}</el-descriptions-item>
            <el-descriptions-item :label="lt('职责', 'Responsibilities')" :span="2">{{ responsibilities }}</el-descriptions-item>
          </el-descriptions>
        </el-tab-pane>

        <el-tab-pane :label="lt('待推送处理', 'Pending Push')" name="push">
          <el-form :inline="true" :model="pushForm" class="filter-form">
            <el-form-item :label="lt('条数', 'Limit')"><el-input-number v-model="pushForm.limit" :min="1" :max="200" /></el-form-item>
            <el-form-item>
              <el-button type="primary" :loading="actionLoading" @click="pushPending">{{ lt('处理待推送', 'Process Pending Push') }}</el-button>
            </el-form-item>
          </el-form>
          <el-table v-loading="loading" :data="summary" border>
            <el-table-column prop="consumerGroup" label="Consumer Group" min-width="220" />
            <el-table-column prop="topic" label="Topic" min-width="220" />
            <el-table-column prop="status" :label="lt('状态', 'Status')" width="120">
              <template #default="{ row }"><el-tag :type="statusType(row.status)">{{ enumLabel(row.status) }}</el-tag></template>
            </el-table-column>
            <el-table-column prop="total" :label="lt('总数', 'Total')" width="100" />
            <el-table-column prop="attempts" :label="lt('尝试', 'Attempts')" width="100" />
            <el-table-column prop="lastUpdatedAt" :label="lt('最后更新', 'Last Updated')" min-width="170" :formatter="formatTableDateTime" />
          </el-table>
        </el-tab-pane>

        <el-tab-pane :label="lt('消费事件', 'Consumer Events')" name="consumer">
          <el-form :inline="true" :model="consumerQuery" class="filter-form">
            <el-form-item label="Consumer Group"><el-input v-model="consumerQuery.consumerGroup" clearable /></el-form-item>
            <el-form-item :label="lt('条数', 'Limit')"><el-input-number v-model="consumerQuery.limit" :min="1" :max="200" /></el-form-item>
            <el-form-item><el-button type="primary" @click="loadConsumer">{{ lt('查询', 'Search') }}</el-button></el-form-item>
          </el-form>

          <el-table v-loading="loading" :data="summary" border class="app-card">
            <el-table-column prop="consumerGroup" label="Consumer Group" min-width="220" />
            <el-table-column prop="topic" label="Topic" min-width="220" />
            <el-table-column prop="status" :label="lt('状态', 'Status')" width="120">
              <template #default="{ row }"><el-tag :type="statusType(row.status)">{{ enumLabel(row.status) }}</el-tag></template>
            </el-table-column>
            <el-table-column prop="total" :label="lt('总数', 'Total')" width="100" />
            <el-table-column prop="attempts" :label="lt('尝试', 'Attempts')" width="100" />
            <el-table-column prop="lastUpdatedAt" :label="lt('最后更新', 'Last Updated')" min-width="170" :formatter="formatTableDateTime" />
          </el-table>

          <el-table v-loading="loading" :data="deadRows" border class="app-card">
            <el-table-column prop="eventId" label="DEAD Event" min-width="220" />
            <el-table-column prop="consumerGroup" label="Consumer Group" min-width="220" />
            <el-table-column prop="eventType" :label="lt('事件类型', 'Event Type')" width="150" />
            <el-table-column prop="attemptCount" :label="lt('尝试', 'Attempts')" width="90" />
            <el-table-column prop="lastError" :label="lt('错误', 'Error')" min-width="240" />
            <el-table-column prop="deadAt" label="Dead At" min-width="170" :formatter="formatTableDateTime" />
            <el-table-column :label="lt('操作', 'Actions')" width="90" fixed="right">
              <template #default="{ row }"><el-button link type="primary" @click="showDetail('DEAD 详情', row)">{{ lt('详情', 'Details') }}</el-button></template>
            </el-table-column>
          </el-table>

          <el-form :inline="true" :model="consumerQuery" class="filter-form">
            <el-form-item label="Event ID"><el-input v-model="consumerQuery.eventId" clearable /></el-form-item>
            <el-form-item><el-button type="primary" :disabled="!consumerQuery.eventId" @click="queryEvent">{{ lt('查事件', 'Query Event') }}</el-button></el-form-item>
            <el-form-item label="Aggregate Type"><el-input v-model="consumerQuery.aggregateType" clearable /></el-form-item>
            <el-form-item label="Aggregate ID"><el-input v-model="consumerQuery.aggregateId" clearable /></el-form-item>
            <el-form-item>
              <el-button type="primary" :disabled="!consumerQuery.aggregateType || !consumerQuery.aggregateId" @click="queryAggregate">
                {{ lt('查聚合', 'Query Aggregate') }}
              </el-button>
            </el-form-item>
          </el-form>

          <el-table v-loading="loading" :data="aggregateRows" border>
            <el-table-column prop="eventId" label="Event ID" min-width="220" />
            <el-table-column prop="consumerGroup" label="Consumer Group" min-width="220" />
            <el-table-column prop="status" :label="lt('状态', 'Status')" width="120">
              <template #default="{ row }"><el-tag :type="statusType(row.status)">{{ enumLabel(row.status) }}</el-tag></template>
            </el-table-column>
            <el-table-column prop="eventType" :label="lt('事件类型', 'Event Type')" width="150" />
            <el-table-column prop="updatedAt" :label="lt('更新时间', 'Updated At')" min-width="170" :formatter="formatTableDateTime" />
            <el-table-column :label="lt('操作', 'Actions')" width="90" fixed="right">
              <template #default="{ row }"><el-button link type="primary" @click="showDetail('聚合事件详情', row)">{{ lt('详情', 'Details') }}</el-button></template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
      </el-tabs>
    </el-card>

    <el-dialog v-model="detailVisible" :title="detailTitle" width="760px">
      <ObjectDetails :data="detailRecord" />
    </el-dialog>
  </div>
</template>

<style scoped>
.small-value {
  margin-top: 12px;
  font-size: 16px;
  font-weight: 600;
  line-height: 1.35;
  word-break: break-word;
}
</style>

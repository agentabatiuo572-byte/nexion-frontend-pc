<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import {
  getMissionConsumerAggregate,
  getMissionConsumerDead,
  getMissionConsumerEvent,
  getMissionConsumerSummary,
  getMissionOpsOverview
} from '@/apis/operation'
import type { AnyRecord } from '@/types/common'

const props = withDefaults(defineProps<{ defaultTab?: string }>(), { defaultTab: 'overview' })

const activeTab = ref(props.defaultTab)
const loading = ref(false)
const overview = ref<AnyRecord | null>(null)
const summary = ref<AnyRecord[]>([])
const deadRows = ref<AnyRecord[]>([])
const aggregateRows = ref<AnyRecord[]>([])
const eventRecord = ref<AnyRecord | null>(null)
const detailVisible = ref(false)
const detailTitle = ref('详情')
const detailRecord = ref<unknown>(null)

const consumerQuery = reactive({
  consumerGroup: 'nexion-mission-earning-generated',
  limit: 20,
  eventId: '',
  aggregateType: '',
  aggregateId: ''
})

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
  overview.value = await getMissionOpsOverview({ silentError: true }).catch(() => null)
}

async function loadConsumer() {
  const params = compactParams({ consumerGroup: consumerQuery.consumerGroup, limit: consumerQuery.limit })
  const [summaryRes, deadRes] = await Promise.allSettled([
    getMissionConsumerSummary(compactParams({ consumerGroup: consumerQuery.consumerGroup }), { silentError: true }),
    getMissionConsumerDead(params, { silentError: true })
  ])
  summary.value = summaryRes.status === 'fulfilled' ? summaryRes.value : []
  deadRows.value = deadRes.status === 'fulfilled' ? deadRes.value : []
}

async function queryEvent() {
  if (!consumerQuery.eventId) return
  eventRecord.value = await getMissionConsumerEvent(
    consumerQuery.eventId,
    compactParams({ consumerGroup: consumerQuery.consumerGroup }),
    { silentError: true }
  ).catch(() => null)
  showDetail('事件详情', eventRecord.value)
}

async function queryAggregate() {
  if (!consumerQuery.aggregateType || !consumerQuery.aggregateId) return
  aggregateRows.value = await getMissionConsumerAggregate(
    consumerQuery.aggregateType,
    consumerQuery.aggregateId,
    { limit: consumerQuery.limit },
    { silentError: true }
  ).catch(() => [])
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
          <div class="table-toolbar"><span>服务</span><el-icon color="#409eff" :size="24"><Flag /></el-icon></div>
          <div class="small-value">{{ valueOf(overview, 'service') }}</div>
        </el-card>
      </el-col>
      <el-col :xs="24" :sm="12" :md="6">
        <el-card shadow="never" class="stat-card">
          <div class="table-toolbar"><span>数据库</span><el-icon color="#67c23a" :size="24"><Coin /></el-icon></div>
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
        <span>任务运营</span>
        <el-button :icon="'Refresh'" @click="loadData">刷新</el-button>
      </div>

      <el-tabs v-model="activeTab">
        <el-tab-pane label="概览" name="overview">
          <el-descriptions v-loading="loading" :column="2" border>
            <el-descriptions-item label="服务">{{ valueOf(overview, 'service') }}</el-descriptions-item>
            <el-descriptions-item label="数据库">{{ valueOf(overview, 'database') }}</el-descriptions-item>
            <el-descriptions-item label="职责" :span="2">{{ responsibilities }}</el-descriptions-item>
          </el-descriptions>
        </el-tab-pane>

        <el-tab-pane label="消费事件" name="consumer">
          <el-form :inline="true" :model="consumerQuery" class="filter-form">
            <el-form-item label="Consumer Group"><el-input v-model="consumerQuery.consumerGroup" clearable /></el-form-item>
            <el-form-item label="条数"><el-input-number v-model="consumerQuery.limit" :min="1" :max="200" /></el-form-item>
            <el-form-item><el-button type="primary" @click="loadConsumer">查询</el-button></el-form-item>
          </el-form>

          <el-table v-loading="loading" :data="summary" border class="app-card">
            <el-table-column prop="consumerGroup" label="Consumer Group" min-width="220" />
            <el-table-column prop="topic" label="Topic" min-width="220" />
            <el-table-column prop="status" label="状态" width="120">
              <template #default="{ row }"><el-tag :type="statusType(row.status)">{{ row.status }}</el-tag></template>
            </el-table-column>
            <el-table-column prop="total" label="总数" width="100" />
            <el-table-column prop="attempts" label="尝试" width="100" />
            <el-table-column prop="lastUpdatedAt" label="最后更新" min-width="170" />
          </el-table>

          <el-table v-loading="loading" :data="deadRows" border class="app-card">
            <el-table-column prop="eventId" label="DEAD Event" min-width="220" />
            <el-table-column prop="consumerGroup" label="Consumer Group" min-width="220" />
            <el-table-column prop="eventType" label="事件类型" width="150" />
            <el-table-column prop="attemptCount" label="尝试" width="90" />
            <el-table-column prop="lastError" label="错误" min-width="240" />
            <el-table-column prop="deadAt" label="Dead At" min-width="170" />
            <el-table-column label="操作" width="90" fixed="right">
              <template #default="{ row }"><el-button link type="primary" @click="showDetail('DEAD 详情', row)">详情</el-button></template>
            </el-table-column>
          </el-table>

          <el-form :inline="true" :model="consumerQuery" class="filter-form">
            <el-form-item label="Event ID"><el-input v-model="consumerQuery.eventId" clearable /></el-form-item>
            <el-form-item><el-button type="primary" :disabled="!consumerQuery.eventId" @click="queryEvent">查事件</el-button></el-form-item>
            <el-form-item label="Aggregate Type"><el-input v-model="consumerQuery.aggregateType" clearable /></el-form-item>
            <el-form-item label="Aggregate ID"><el-input v-model="consumerQuery.aggregateId" clearable /></el-form-item>
            <el-form-item>
              <el-button type="primary" :disabled="!consumerQuery.aggregateType || !consumerQuery.aggregateId" @click="queryAggregate">
                查聚合
              </el-button>
            </el-form-item>
          </el-form>

          <el-table v-loading="loading" :data="aggregateRows" border>
            <el-table-column prop="eventId" label="Event ID" min-width="220" />
            <el-table-column prop="consumerGroup" label="Consumer Group" min-width="220" />
            <el-table-column prop="status" label="状态" width="120">
              <template #default="{ row }"><el-tag :type="statusType(row.status)">{{ row.status }}</el-tag></template>
            </el-table-column>
            <el-table-column prop="eventType" label="事件类型" width="150" />
            <el-table-column prop="updatedAt" label="更新时间" min-width="170" />
            <el-table-column label="操作" width="90" fixed="right">
              <template #default="{ row }"><el-button link type="primary" @click="showDetail('聚合事件详情', row)">详情</el-button></template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
      </el-tabs>
    </el-card>

    <el-dialog v-model="detailVisible" :title="detailTitle" width="760px">
      <pre class="json-preview">{{ JSON.stringify(detailRecord, null, 2) }}</pre>
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

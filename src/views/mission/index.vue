<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import {
  createEventQuest,
  createMonthlyChallenge,
  getEventQuests,
  getMissionConsumerAggregate,
  getMissionConsumerDead,
  getMissionConsumerEvent,
  getMissionConsumerSummary,
  getMissionOpsOverview,
  getMonthlyChallenges,
  updateEventQuest,
  updateEventQuestProgress,
  updateMonthlyChallenge,
  updateMonthlyChallengeProgress,
  type EventQuest,
  type MonthlyChallenge
} from '@/apis/operation'
import type { AnyRecord, Id } from '@/types/common'

const props = withDefaults(defineProps<{ defaultTab?: string }>(), { defaultTab: 'overview' })

const activeTab = ref(props.defaultTab)
const loading = ref(false)
const campaignLoading = ref(false)
const saving = ref(false)
const overview = ref<AnyRecord | null>(null)
const summary = ref<AnyRecord[]>([])
const deadRows = ref<AnyRecord[]>([])
const aggregateRows = ref<AnyRecord[]>([])
const eventRecord = ref<AnyRecord | null>(null)
const detailVisible = ref(false)
const detailTitle = ref('详情')
const detailRecord = ref<unknown>(null)
const lastAction = ref('')

const monthlyRows = ref<MonthlyChallenge[]>([])
const monthlyTotal = ref(0)
const monthlyDialogVisible = ref(false)
const monthlyDialogTitle = ref('创建月度挑战')
const monthlyFormRef = ref<FormInstance>()
const monthlyQuery = reactive({ current: 1, size: 20, status: '' })
const monthlyForm = reactive<MonthlyChallenge>(defaultMonthlyForm())

const eventRows = ref<EventQuest[]>([])
const eventTotal = ref(0)
const eventDialogVisible = ref(false)
const eventDialogTitle = ref('创建活动任务')
const eventFormRef = ref<FormInstance>()
const eventQuery = reactive({ current: 1, size: 20, status: '' })
const eventForm = reactive<EventQuest>(defaultEventForm())

const progressDialogVisible = ref(false)
const progressTitle = ref('进度维护')
const progressType = ref<'monthly' | 'event'>('monthly')
const progressCode = ref('')
const progressForm = reactive({ userId: '' as Id | '', progressValue: 0 })

const consumerQuery = reactive({
  consumerGroup: 'nexion-mission-earning-generated',
  limit: 20,
  eventId: '',
  aggregateType: '',
  aggregateId: ''
})

const statusOptions = [
  { label: '启用', value: 1 },
  { label: '禁用', value: 0 }
]
const rewardOptions = ['POINTS', 'NEX', 'USDT', 'SPIN', 'BADGE']
const targetOptions = ['CHECK_IN_DAYS', 'MISSION_COUNT', 'EARNING_COUNT', 'DEVICE_COUNT', 'GENESIS_COUNT', 'CUSTOM']

const monthlyRules: FormRules = {
  challengeCode: [{ required: true, message: '请输入挑战编码', trigger: 'blur' }],
  challengeName: [{ required: true, message: '请输入挑战名称', trigger: 'blur' }],
  targetType: [{ required: true, message: '请选择目标类型', trigger: 'change' }],
  targetValue: [{ required: true, message: '请输入目标值', trigger: 'blur' }],
  rewardType: [{ required: true, message: '请选择奖励类型', trigger: 'change' }],
  rewardAmount: [{ required: true, message: '请输入奖励数量', trigger: 'blur' }],
  rewardName: [{ required: true, message: '请输入奖励名称', trigger: 'blur' }]
}

const eventRules: FormRules = {
  questCode: [{ required: true, message: '请输入任务编码', trigger: 'blur' }],
  questName: [{ required: true, message: '请输入任务名称', trigger: 'blur' }],
  targetType: [{ required: true, message: '请选择目标类型', trigger: 'change' }],
  targetValue: [{ required: true, message: '请输入目标值', trigger: 'blur' }],
  rewardType: [{ required: true, message: '请选择奖励类型', trigger: 'change' }],
  rewardAmount: [{ required: true, message: '请输入奖励数量', trigger: 'blur' }],
  rewardName: [{ required: true, message: '请输入奖励名称', trigger: 'blur' }]
}

const responsibilities = computed(() => {
  const values = overview.value?.responsibilities
  return Array.isArray(values) ? values.join(' / ') : '-'
})

function defaultMonthlyForm(): MonthlyChallenge {
  return {
    challengeCode: '',
    challengeName: '',
    description: '',
    theme: '',
    monthsFrom: 0,
    monthsTo: 999,
    targetType: 'CHECK_IN_DAYS',
    targetValue: 1,
    rewardType: 'POINTS',
    rewardAmount: 100,
    rewardName: 'Mission points',
    badgeAchievementCode: '',
    sortOrder: 100,
    status: 1
  }
}

function defaultEventForm(): EventQuest {
  return {
    questCode: '',
    questName: '',
    description: '',
    startsAt: '',
    endsAt: '',
    targetType: 'MISSION_COUNT',
    targetValue: 1,
    rewardType: 'POINTS',
    rewardAmount: 100,
    rewardName: 'Mission points',
    badgeAchievementCode: '',
    sortOrder: 100,
    status: 1
  }
}

function valueOf(record: AnyRecord | null | undefined, key: string) {
  const value = key.split('.').reduce<unknown>((current, part) => {
    return current && typeof current === 'object' ? (current as AnyRecord)[part] : undefined
  }, record || undefined)
  return value == null || value === '' ? '-' : String(value)
}

function compactParams(params: AnyRecord) {
  return Object.fromEntries(Object.entries(params).filter(([, value]) => value !== '' && value != null))
}

function resetRecord<T extends object>(target: T, source: T) {
  Object.keys(target).forEach((key) => delete (target as AnyRecord)[key])
  Object.assign(target, source)
}

function statusType(status: unknown) {
  const value = String(status ?? '').toUpperCase()
  if (value === '1' || value === 'ACTIVE' || value === 'SUCCESS') return 'success'
  if (value === '0' || value === 'DISABLED' || value === 'DEAD') return 'danger'
  if (value === 'FAILED') return 'warning'
  if (value === 'PROCESSING') return 'primary'
  return 'info'
}

function statusLabel(status: unknown) {
  const value = String(status ?? '')
  if (value === '1') return '启用'
  if (value === '0') return '禁用'
  return value || '-'
}

function summaryTotal(status: string) {
  return summary.value
    .filter((item) => String(item.status || '').toUpperCase() === status)
    .reduce((total, item) => total + Number(item.total || 0), 0)
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

async function loadMonthly() {
  campaignLoading.value = true
  try {
    const page = await getMonthlyChallenges(compactParams(monthlyQuery) as typeof monthlyQuery)
    monthlyRows.value = page.records || []
    monthlyTotal.value = Number(page.total || 0)
  } finally {
    campaignLoading.value = false
  }
}

async function loadEvents() {
  campaignLoading.value = true
  try {
    const page = await getEventQuests(compactParams(eventQuery) as typeof eventQuery)
    eventRows.value = page.records || []
    eventTotal.value = Number(page.total || 0)
  } finally {
    campaignLoading.value = false
  }
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

function openCreateMonthly() {
  monthlyDialogTitle.value = '创建月度挑战'
  resetRecord(monthlyForm, defaultMonthlyForm())
  monthlyDialogVisible.value = true
}

function openEditMonthly(row: MonthlyChallenge) {
  monthlyDialogTitle.value = '编辑月度挑战'
  resetRecord(monthlyForm, { ...defaultMonthlyForm(), ...row, id: row.id || row.challengeId })
  monthlyDialogVisible.value = true
}

function openCreateEvent() {
  eventDialogTitle.value = '创建活动任务'
  resetRecord(eventForm, defaultEventForm())
  eventDialogVisible.value = true
}

function openEditEvent(row: EventQuest) {
  eventDialogTitle.value = '编辑活动任务'
  resetRecord(eventForm, { ...defaultEventForm(), ...row, id: row.id || row.questId })
  eventDialogVisible.value = true
}

function normalizeCampaignPayload<T extends MonthlyChallenge | EventQuest>(record: T) {
  const payload = compactParams(record as AnyRecord) as T
  delete (payload as AnyRecord).id
  delete (payload as AnyRecord).challengeId
  delete (payload as AnyRecord).questId
  delete (payload as AnyRecord).progressValue
  delete (payload as AnyRecord).progressPercent
  delete (payload as AnyRecord).claimedAt
  delete (payload as AnyRecord).createdAt
  delete (payload as AnyRecord).updatedAt
  return payload
}

async function saveMonthly() {
  try {
    await monthlyFormRef.value?.validate()
  } catch {
    return
  }
  const isEdit = Boolean(monthlyForm.id || monthlyForm.challengeId)
  await ElMessageBox.confirm(isEdit ? `确认更新月度挑战 ${monthlyForm.challengeCode}?` : '确认创建月度挑战?', '月度挑战', { type: 'warning' })
  saving.value = true
  try {
    const id = monthlyForm.id || monthlyForm.challengeId
    if (isEdit && id) await updateMonthlyChallenge(id, normalizeCampaignPayload(monthlyForm))
    else await createMonthlyChallenge(normalizeCampaignPayload(monthlyForm))
    monthlyDialogVisible.value = false
    lastAction.value = `${isEdit ? '已更新' : '已创建'}月度挑战 ${monthlyForm.challengeCode}，${new Date().toLocaleString()}`
    ElMessage.success(isEdit ? '月度挑战已更新' : '月度挑战已创建')
    await loadMonthly()
  } finally {
    saving.value = false
  }
}

async function saveEvent() {
  try {
    await eventFormRef.value?.validate()
  } catch {
    return
  }
  const isEdit = Boolean(eventForm.id || eventForm.questId)
  await ElMessageBox.confirm(isEdit ? `确认更新活动任务 ${eventForm.questCode}?` : '确认创建活动任务?', '活动任务', { type: 'warning' })
  saving.value = true
  try {
    const id = eventForm.id || eventForm.questId
    if (isEdit && id) await updateEventQuest(id, normalizeCampaignPayload(eventForm))
    else await createEventQuest(normalizeCampaignPayload(eventForm))
    eventDialogVisible.value = false
    lastAction.value = `${isEdit ? '已更新' : '已创建'}活动任务 ${eventForm.questCode}，${new Date().toLocaleString()}`
    ElMessage.success(isEdit ? '活动任务已更新' : '活动任务已创建')
    await loadEvents()
  } finally {
    saving.value = false
  }
}

async function toggleMonthly(row: MonthlyChallenge) {
  const nextStatus = String(row.status) === '1' ? 0 : 1
  const id = row.id || row.challengeId
  if (!id) return
  await ElMessageBox.confirm(`确认${nextStatus === 1 ? '启用' : '禁用'}月度挑战 ${row.challengeCode}?`, '月度挑战状态', { type: 'warning' })
  await updateMonthlyChallenge(id, { status: nextStatus })
  ElMessage.success('状态已更新')
  await loadMonthly()
}

async function toggleEvent(row: EventQuest) {
  const nextStatus = String(row.status) === '1' ? 0 : 1
  const id = row.id || row.questId
  if (!id) return
  await ElMessageBox.confirm(`确认${nextStatus === 1 ? '启用' : '禁用'}活动任务 ${row.questCode}?`, '活动任务状态', { type: 'warning' })
  await updateEventQuest(id, { status: nextStatus })
  ElMessage.success('状态已更新')
  await loadEvents()
}

function openProgress(type: 'monthly' | 'event', row: MonthlyChallenge | EventQuest) {
  progressType.value = type
  progressCode.value = type === 'monthly' ? String((row as MonthlyChallenge).challengeCode || '') : String((row as EventQuest).questCode || '')
  progressTitle.value = type === 'monthly' ? `月度挑战进度: ${progressCode.value}` : `活动任务进度: ${progressCode.value}`
  Object.assign(progressForm, { userId: '', progressValue: Number(row.targetValue || 1) })
  progressDialogVisible.value = true
}

async function saveProgress() {
  if (!progressForm.userId || !progressCode.value) {
    ElMessage.warning('请填写用户 ID 和进度值')
    return
  }
  await ElMessageBox.confirm(`确认维护用户 ${progressForm.userId} 的进度为 ${progressForm.progressValue}?`, '进度维护', { type: 'warning' })
  saving.value = true
  try {
    if (progressType.value === 'monthly') {
      await updateMonthlyChallengeProgress(progressCode.value, progressForm.userId, Number(progressForm.progressValue))
      await loadMonthly()
    } else {
      await updateEventQuestProgress(progressCode.value, progressForm.userId, Number(progressForm.progressValue))
      await loadEvents()
    }
    progressDialogVisible.value = false
    lastAction.value = `已维护 ${progressCode.value} 用户 ${progressForm.userId} 进度，${new Date().toLocaleString()}`
    ElMessage.success('进度已更新')
  } finally {
    saving.value = false
  }
}

async function loadData() {
  loading.value = true
  try {
    await Promise.all([loadOverview(), loadConsumer(), loadMonthly(), loadEvents()])
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
          <div class="table-toolbar"><span>月度挑战</span><el-icon color="#67c23a" :size="24"><Calendar /></el-icon></div>
          <div class="value">{{ monthlyTotal }}</div>
        </el-card>
      </el-col>
      <el-col :xs="24" :sm="12" :md="6">
        <el-card shadow="never" class="stat-card">
          <div class="table-toolbar"><span>活动任务</span><el-icon color="#e6a23c" :size="24"><Promotion /></el-icon></div>
          <div class="value">{{ eventTotal }}</div>
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
      <el-alert v-if="lastAction" :title="lastAction" type="success" show-icon :closable="false" class="operation-alert" />

      <el-tabs v-model="activeTab">
        <el-tab-pane label="概览" name="overview">
          <el-descriptions v-loading="loading" :column="2" border>
            <el-descriptions-item label="服务">{{ valueOf(overview, 'service') }}</el-descriptions-item>
            <el-descriptions-item label="数据库">{{ valueOf(overview, 'database') }}</el-descriptions-item>
            <el-descriptions-item label="职责" :span="2">{{ responsibilities }}</el-descriptions-item>
          </el-descriptions>
        </el-tab-pane>

        <el-tab-pane label="月度挑战" name="monthly">
          <div class="table-toolbar">
            <el-form :inline="true" :model="monthlyQuery" class="filter-form compact-filter">
              <el-form-item label="状态">
                <el-select v-model="monthlyQuery.status" clearable style="width: 130px">
                  <el-option v-for="item in statusOptions" :key="item.value" :label="item.label" :value="item.value" />
                </el-select>
              </el-form-item>
              <el-form-item><el-button type="primary" @click="loadMonthly">查询</el-button></el-form-item>
            </el-form>
            <el-button type="primary" :icon="'Plus'" @click="openCreateMonthly">创建月度挑战</el-button>
          </div>

          <el-table v-loading="campaignLoading" :data="monthlyRows" border>
            <el-table-column prop="challengeCode" label="编码" min-width="180" />
            <el-table-column prop="challengeName" label="名称" min-width="180" show-overflow-tooltip />
            <el-table-column prop="theme" label="主题" min-width="120" />
            <el-table-column label="月龄" width="120">
              <template #default="{ row }">{{ row.monthsFrom }} - {{ row.monthsTo }}</template>
            </el-table-column>
            <el-table-column prop="targetType" label="目标类型" min-width="150" />
            <el-table-column prop="targetValue" label="目标值" width="90" />
            <el-table-column prop="rewardType" label="奖励类型" width="110" />
            <el-table-column prop="rewardAmount" label="奖励数量" width="110" />
            <el-table-column prop="rewardName" label="奖励名称" min-width="150" show-overflow-tooltip />
            <el-table-column prop="status" label="状态" width="90">
              <template #default="{ row }"><el-tag :type="statusType(row.status)">{{ statusLabel(row.status) }}</el-tag></template>
            </el-table-column>
            <el-table-column prop="sortOrder" label="排序" width="80" />
            <el-table-column prop="updatedAt" label="更新时间" min-width="170" />
            <el-table-column label="操作" width="220" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" @click="openEditMonthly(row)">编辑</el-button>
                <el-button link type="primary" @click="openProgress('monthly', row)">进度</el-button>
                <el-button link :type="String(row.status) === '1' ? 'danger' : 'success'" @click="toggleMonthly(row)">
                  {{ String(row.status) === '1' ? '禁用' : '启用' }}
                </el-button>
              </template>
            </el-table-column>
          </el-table>

          <div class="pagination-wrap">
            <el-pagination
              v-model:current-page="monthlyQuery.current"
              v-model:page-size="monthlyQuery.size"
              layout="total, sizes, prev, pager, next"
              :page-sizes="[10, 20, 50, 100]"
              :total="monthlyTotal"
              @current-change="loadMonthly"
              @size-change="loadMonthly"
            />
          </div>
        </el-tab-pane>

        <el-tab-pane label="活动任务" name="events">
          <div class="table-toolbar">
            <el-form :inline="true" :model="eventQuery" class="filter-form compact-filter">
              <el-form-item label="状态">
                <el-select v-model="eventQuery.status" clearable style="width: 130px">
                  <el-option v-for="item in statusOptions" :key="item.value" :label="item.label" :value="item.value" />
                </el-select>
              </el-form-item>
              <el-form-item><el-button type="primary" @click="loadEvents">查询</el-button></el-form-item>
            </el-form>
            <el-button type="primary" :icon="'Plus'" @click="openCreateEvent">创建活动任务</el-button>
          </div>

          <el-table v-loading="campaignLoading" :data="eventRows" border>
            <el-table-column prop="questCode" label="编码" min-width="180" />
            <el-table-column prop="questName" label="名称" min-width="180" show-overflow-tooltip />
            <el-table-column prop="startsAt" label="开始时间" min-width="170" />
            <el-table-column prop="endsAt" label="结束时间" min-width="170" />
            <el-table-column prop="targetType" label="目标类型" min-width="150" />
            <el-table-column prop="targetValue" label="目标值" width="90" />
            <el-table-column prop="rewardType" label="奖励类型" width="110" />
            <el-table-column prop="rewardAmount" label="奖励数量" width="110" />
            <el-table-column prop="rewardName" label="奖励名称" min-width="150" show-overflow-tooltip />
            <el-table-column prop="status" label="状态" width="90">
              <template #default="{ row }"><el-tag :type="statusType(row.status)">{{ statusLabel(row.status) }}</el-tag></template>
            </el-table-column>
            <el-table-column prop="sortOrder" label="排序" width="80" />
            <el-table-column prop="updatedAt" label="更新时间" min-width="170" />
            <el-table-column label="操作" width="220" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" @click="openEditEvent(row)">编辑</el-button>
                <el-button link type="primary" @click="openProgress('event', row)">进度</el-button>
                <el-button link :type="String(row.status) === '1' ? 'danger' : 'success'" @click="toggleEvent(row)">
                  {{ String(row.status) === '1' ? '禁用' : '启用' }}
                </el-button>
              </template>
            </el-table-column>
          </el-table>

          <div class="pagination-wrap">
            <el-pagination
              v-model:current-page="eventQuery.current"
              v-model:page-size="eventQuery.size"
              layout="total, sizes, prev, pager, next"
              :page-sizes="[10, 20, 50, 100]"
              :total="eventTotal"
              @current-change="loadEvents"
              @size-change="loadEvents"
            />
          </div>
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

    <el-dialog v-model="monthlyDialogVisible" :title="monthlyDialogTitle" width="760px">
      <el-form ref="monthlyFormRef" :model="monthlyForm" :rules="monthlyRules" label-width="120px">
        <el-row :gutter="16">
          <el-col :span="12"><el-form-item label="编码" prop="challengeCode"><el-input v-model="monthlyForm.challengeCode" :disabled="!!monthlyForm.id" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="名称" prop="challengeName"><el-input v-model="monthlyForm.challengeName" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="主题"><el-input v-model="monthlyForm.theme" /></el-form-item></el-col>
          <el-col :span="6"><el-form-item label="起始月龄"><el-input-number v-model="monthlyForm.monthsFrom" :min="0" /></el-form-item></el-col>
          <el-col :span="6"><el-form-item label="结束月龄"><el-input-number v-model="monthlyForm.monthsTo" :min="0" /></el-form-item></el-col>
          <el-col :span="12">
            <el-form-item label="目标类型" prop="targetType">
              <el-select v-model="monthlyForm.targetType" filterable allow-create>
                <el-option v-for="item in targetOptions" :key="item" :label="item" :value="item" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12"><el-form-item label="目标值" prop="targetValue"><el-input-number v-model="monthlyForm.targetValue" :min="1" /></el-form-item></el-col>
          <el-col :span="12">
            <el-form-item label="奖励类型" prop="rewardType">
              <el-select v-model="monthlyForm.rewardType" filterable allow-create>
                <el-option v-for="item in rewardOptions" :key="item" :label="item" :value="item" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12"><el-form-item label="奖励数量" prop="rewardAmount"><el-input-number v-model="monthlyForm.rewardAmount" :min="0.000001" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="奖励名称" prop="rewardName"><el-input v-model="monthlyForm.rewardName" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="Badge"><el-input v-model="monthlyForm.badgeAchievementCode" clearable /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="排序"><el-input-number v-model="monthlyForm.sortOrder" :min="0" /></el-form-item></el-col>
          <el-col :span="12">
            <el-form-item label="状态">
              <el-select v-model="monthlyForm.status">
                <el-option v-for="item in statusOptions" :key="item.value" :label="item.label" :value="item.value" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="24"><el-form-item label="描述"><el-input v-model="monthlyForm.description" type="textarea" :rows="3" maxlength="512" show-word-limit /></el-form-item></el-col>
        </el-row>
      </el-form>
      <template #footer>
        <el-button @click="monthlyDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveMonthly">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="eventDialogVisible" :title="eventDialogTitle" width="760px">
      <el-form ref="eventFormRef" :model="eventForm" :rules="eventRules" label-width="120px">
        <el-row :gutter="16">
          <el-col :span="12"><el-form-item label="编码" prop="questCode"><el-input v-model="eventForm.questCode" :disabled="!!eventForm.id" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="名称" prop="questName"><el-input v-model="eventForm.questName" /></el-form-item></el-col>
          <el-col :span="12">
            <el-form-item label="开始时间">
              <el-date-picker v-model="eventForm.startsAt" type="datetime" value-format="YYYY-MM-DDTHH:mm:ss" placeholder="选择开始时间" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="结束时间">
              <el-date-picker v-model="eventForm.endsAt" type="datetime" value-format="YYYY-MM-DDTHH:mm:ss" placeholder="选择结束时间" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="目标类型" prop="targetType">
              <el-select v-model="eventForm.targetType" filterable allow-create>
                <el-option v-for="item in targetOptions" :key="item" :label="item" :value="item" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12"><el-form-item label="目标值" prop="targetValue"><el-input-number v-model="eventForm.targetValue" :min="1" /></el-form-item></el-col>
          <el-col :span="12">
            <el-form-item label="奖励类型" prop="rewardType">
              <el-select v-model="eventForm.rewardType" filterable allow-create>
                <el-option v-for="item in rewardOptions" :key="item" :label="item" :value="item" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12"><el-form-item label="奖励数量" prop="rewardAmount"><el-input-number v-model="eventForm.rewardAmount" :min="0.000001" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="奖励名称" prop="rewardName"><el-input v-model="eventForm.rewardName" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="Badge"><el-input v-model="eventForm.badgeAchievementCode" clearable /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="排序"><el-input-number v-model="eventForm.sortOrder" :min="0" /></el-form-item></el-col>
          <el-col :span="12">
            <el-form-item label="状态">
              <el-select v-model="eventForm.status">
                <el-option v-for="item in statusOptions" :key="item.value" :label="item.label" :value="item.value" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="24"><el-form-item label="描述"><el-input v-model="eventForm.description" type="textarea" :rows="3" maxlength="512" show-word-limit /></el-form-item></el-col>
        </el-row>
      </el-form>
      <template #footer>
        <el-button @click="eventDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveEvent">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="progressDialogVisible" :title="progressTitle" width="520px">
      <el-form :model="progressForm" label-width="120px">
        <el-form-item label="用户 ID"><el-input v-model="progressForm.userId" /></el-form-item>
        <el-form-item label="进度值"><el-input-number v-model="progressForm.progressValue" :min="0" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="progressDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveProgress">保存进度</el-button>
      </template>
    </el-dialog>

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

.compact-filter {
  margin-bottom: 0;
}
</style>

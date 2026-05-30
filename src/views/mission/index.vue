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
import { formatNow, formatTableDateTime } from '@/utils/date'
import { localeText as lt, enumLabel } from '@/utils/i18n'
import UserSelect from '@/components/UserSelect.vue'
import ObjectDetails from '@/components/ObjectDetails.vue'

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
const detailTitle = ref(lt('详情', 'Details'))
const detailRecord = ref<unknown>(null)
const lastAction = ref('')

const monthlyRows = ref<MonthlyChallenge[]>([])
const monthlyTotal = ref(0)
const monthlyDialogVisible = ref(false)
const monthlyDialogTitle = ref(lt('创建月度挑战', 'Create Monthly Challenge'))
const monthlyFormRef = ref<FormInstance>()
const monthlyQuery = reactive({ current: 1, size: 20, status: '' })
const monthlyForm = reactive<MonthlyChallenge>(defaultMonthlyForm())

const eventRows = ref<EventQuest[]>([])
const eventTotal = ref(0)
const eventDialogVisible = ref(false)
const eventDialogTitle = ref(lt('创建活动任务', 'Create Event Quest'))
const eventFormRef = ref<FormInstance>()
const eventQuery = reactive({ current: 1, size: 20, status: '' })
const eventForm = reactive<EventQuest>(defaultEventForm())

const progressDialogVisible = ref(false)
const progressTitle = ref(lt('进度维护', 'Progress Update'))
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

const statusOptions = computed(() => [
  { label: lt('启用', 'Enabled'), value: 1 },
  { label: lt('禁用', 'Disabled'), value: 0 }
])
const rewardOptions = ['POINTS', 'NEX', 'USDT', 'SPIN', 'BADGE']
const targetOptions = ['CHECK_IN_DAYS', 'MISSION_COUNT', 'EARNING_COUNT', 'DEVICE_COUNT', 'GENESIS_COUNT', 'CUSTOM']

const monthlyRules: FormRules = {
  challengeCode: [{ required: true, message: lt('请输入挑战编码', 'Please enter challenge code'), trigger: 'blur' }],
  challengeName: [{ required: true, message: lt('请输入挑战名称', 'Please enter challenge name'), trigger: 'blur' }],
  targetType: [{ required: true, message: lt('请选择目标类型', 'Please select target type'), trigger: 'change' }],
  targetValue: [{ required: true, message: lt('请输入目标值', 'Please enter target value'), trigger: 'blur' }],
  rewardType: [{ required: true, message: lt('请选择奖励类型', 'Please select reward type'), trigger: 'change' }],
  rewardAmount: [{ required: true, message: lt('请输入奖励数量', 'Please enter reward amount'), trigger: 'blur' }],
  rewardName: [{ required: true, message: lt('请输入奖励名称', 'Please enter reward name'), trigger: 'blur' }]
}

const eventRules: FormRules = {
  questCode: [{ required: true, message: lt('请输入任务编码', 'Please enter quest code'), trigger: 'blur' }],
  questName: [{ required: true, message: lt('请输入任务名称', 'Please enter quest name'), trigger: 'blur' }],
  targetType: [{ required: true, message: lt('请选择目标类型', 'Please select target type'), trigger: 'change' }],
  targetValue: [{ required: true, message: lt('请输入目标值', 'Please enter target value'), trigger: 'blur' }],
  rewardType: [{ required: true, message: lt('请选择奖励类型', 'Please select reward type'), trigger: 'change' }],
  rewardAmount: [{ required: true, message: lt('请输入奖励数量', 'Please enter reward amount'), trigger: 'blur' }],
  rewardName: [{ required: true, message: lt('请输入奖励名称', 'Please enter reward name'), trigger: 'blur' }]
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
  if (value === '1') return lt('启用', 'Enabled')
  if (value === '0') return lt('禁用', 'Disabled')
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
  showDetail(lt('事件详情', 'Event Details'), eventRecord.value)
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
  monthlyDialogTitle.value = lt('创建月度挑战', 'Create Monthly Challenge')
  resetRecord(monthlyForm, defaultMonthlyForm())
  monthlyDialogVisible.value = true
}

function openEditMonthly(row: MonthlyChallenge) {
  monthlyDialogTitle.value = lt('编辑月度挑战', 'Edit Monthly Challenge')
  resetRecord(monthlyForm, { ...defaultMonthlyForm(), ...row, id: row.id || row.challengeId })
  monthlyDialogVisible.value = true
}

function openCreateEvent() {
  eventDialogTitle.value = lt('创建活动任务', 'Create Event Quest')
  resetRecord(eventForm, defaultEventForm())
  eventDialogVisible.value = true
}

function openEditEvent(row: EventQuest) {
  eventDialogTitle.value = lt('编辑活动任务', 'Edit Event Quest')
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
  await ElMessageBox.confirm(isEdit ? `确认更新月度挑战 ${monthlyForm.challengeCode}?` : '确认创建月度挑战?', lt('月度挑战', 'Monthly Challenge'), { type: 'warning' })
  saving.value = true
  try {
    const id = monthlyForm.id || monthlyForm.challengeId
    if (isEdit && id) await updateMonthlyChallenge(id, normalizeCampaignPayload(monthlyForm))
    else await createMonthlyChallenge(normalizeCampaignPayload(monthlyForm))
    monthlyDialogVisible.value = false
    lastAction.value = `${isEdit ? lt('已更新', 'Updated') : lt('已创建', 'Created')} ${lt('月度挑战', 'monthly challenge')} ${monthlyForm.challengeCode}, ${formatNow()}`
    ElMessage.success(isEdit ? lt('月度挑战已更新', 'Monthly challenge updated') : lt('月度挑战已创建', 'Monthly challenge created'))
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
  await ElMessageBox.confirm(isEdit ? `确认更新活动任务 ${eventForm.questCode}?` : '确认创建活动任务?', lt('活动任务', 'Event Quest'), { type: 'warning' })
  saving.value = true
  try {
    const id = eventForm.id || eventForm.questId
    if (isEdit && id) await updateEventQuest(id, normalizeCampaignPayload(eventForm))
    else await createEventQuest(normalizeCampaignPayload(eventForm))
    eventDialogVisible.value = false
    lastAction.value = `${isEdit ? lt('已更新', 'Updated') : lt('已创建', 'Created')} ${lt('活动任务', 'event quest')} ${eventForm.questCode}, ${formatNow()}`
    ElMessage.success(isEdit ? lt('活动任务已更新', 'Event quest updated') : lt('活动任务已创建', 'Event quest created'))
    await loadEvents()
  } finally {
    saving.value = false
  }
}

async function toggleMonthly(row: MonthlyChallenge) {
  const nextStatus = String(row.status) === '1' ? 0 : 1
  const id = row.id || row.challengeId
  if (!id) return
  await ElMessageBox.confirm(`${lt('确认', 'Confirm')} ${nextStatus === 1 ? lt('启用', 'enabling') : lt('禁用', 'disabling')} ${lt('月度挑战', 'monthly challenge')} ${row.challengeCode}?`, lt('月度挑战状态', 'Monthly Challenge Status'), { type: 'warning' })
  await updateMonthlyChallenge(id, { status: nextStatus })
  ElMessage.success(lt('状态已更新', 'Status updated'))
  await loadMonthly()
}

async function toggleEvent(row: EventQuest) {
  const nextStatus = String(row.status) === '1' ? 0 : 1
  const id = row.id || row.questId
  if (!id) return
  await ElMessageBox.confirm(`${lt('确认', 'Confirm')} ${nextStatus === 1 ? lt('启用', 'enabling') : lt('禁用', 'disabling')} ${lt('活动任务', 'event quest')} ${row.questCode}?`, lt('活动任务状态', 'Event Quest Status'), { type: 'warning' })
  await updateEventQuest(id, { status: nextStatus })
  ElMessage.success(lt('状态已更新', 'Status updated'))
  await loadEvents()
}

function openProgress(type: 'monthly' | 'event', row: MonthlyChallenge | EventQuest) {
  progressType.value = type
  progressCode.value = type === 'monthly' ? String((row as MonthlyChallenge).challengeCode || '') : String((row as EventQuest).questCode || '')
  progressTitle.value = type === 'monthly' ? `${lt('月度挑战进度', 'Monthly Challenge Progress')}: ${progressCode.value}` : `${lt('活动任务进度', 'Event Quest Progress')}: ${progressCode.value}`
  Object.assign(progressForm, { userId: '', progressValue: Number(row.targetValue || 1) })
  progressDialogVisible.value = true
}

async function saveProgress() {
  if (!progressForm.userId || !progressCode.value) {
    ElMessage.warning(lt('请选择用户并填写进度值', 'Please select user and enter progress value'))
    return
  }
  await ElMessageBox.confirm(`确认维护用户 ${progressForm.userId} 的进度为 ${progressForm.progressValue}?`, lt('进度维护', 'Progress Update'), { type: 'warning' })
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
    lastAction.value = `${lt('已维护', 'Updated')} ${progressCode.value} ${lt('用户', 'user')} ${progressForm.userId} ${lt('进度', 'progress')}, ${formatNow()}`
    ElMessage.success(lt('进度已更新', 'Progress updated'))
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
          <div class="table-toolbar"><span>{{ lt('服务', 'Service') }}</span><el-icon color="#409eff" :size="24"><Flag /></el-icon></div>
          <div class="small-value">{{ valueOf(overview, 'service') }}</div>
        </el-card>
      </el-col>
      <el-col :xs="24" :sm="12" :md="6">
        <el-card shadow="never" class="stat-card">
          <div class="table-toolbar"><span>{{ lt('月度挑战', 'Monthly Challenges') }}</span><el-icon color="#67c23a" :size="24"><Calendar /></el-icon></div>
          <div class="value">{{ monthlyTotal }}</div>
        </el-card>
      </el-col>
      <el-col :xs="24" :sm="12" :md="6">
        <el-card shadow="never" class="stat-card">
          <div class="table-toolbar"><span>{{ lt('活动任务', 'Event Quests') }}</span><el-icon color="#e6a23c" :size="24"><Promotion /></el-icon></div>
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
        <span>{{ lt('任务运营', 'Mission Ops') }}</span>
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

        <el-tab-pane :label="lt('月度挑战', 'Monthly Challenges')" name="monthly">
          <div class="table-toolbar">
            <el-form :inline="true" :model="monthlyQuery" class="filter-form compact-filter">
              <el-form-item :label="lt('状态', 'Status')">
                <el-select v-model="monthlyQuery.status" clearable style="width: 130px">
                  <el-option v-for="item in statusOptions" :key="item.value" :label="item.label" :value="item.value" />
                </el-select>
              </el-form-item>
              <el-form-item><el-button type="primary" @click="loadMonthly">{{ lt('查询', 'Search') }}</el-button></el-form-item>
            </el-form>
            <el-button type="primary" :icon="'Plus'" @click="openCreateMonthly">{{ lt('创建月度挑战', 'Create Monthly Challenge') }}</el-button>
          </div>

          <el-table v-loading="campaignLoading" :data="monthlyRows" border>
            <el-table-column prop="challengeCode" :label="lt('编码', 'Code')" min-width="180" />
            <el-table-column prop="challengeName" :label="lt('名称', 'Name')" min-width="180" show-overflow-tooltip />
            <el-table-column prop="theme" :label="lt('主题', 'Theme')" min-width="120" />
            <el-table-column :label="lt('月龄', 'Months')" width="120">
              <template #default="{ row }">{{ row.monthsFrom }} - {{ row.monthsTo }}</template>
            </el-table-column>
            <el-table-column prop="targetType" :label="lt('目标类型', 'Target Type')" min-width="150" />
            <el-table-column prop="targetValue" :label="lt('目标值', 'Target Value')" width="90" />
            <el-table-column prop="rewardType" :label="lt('奖励类型', 'Reward Type')" width="110" />
            <el-table-column prop="rewardAmount" :label="lt('奖励数量', 'Reward Amount')" width="110" />
            <el-table-column prop="rewardName" :label="lt('奖励名称', 'Reward Name')" min-width="150" show-overflow-tooltip />
            <el-table-column prop="status" :label="lt('状态', 'Status')" width="90">
              <template #default="{ row }"><el-tag :type="statusType(row.status)">{{ statusLabel(row.status) }}</el-tag></template>
            </el-table-column>
            <el-table-column prop="sortOrder" :label="lt('排序', 'Sort Order')" width="80" />
            <el-table-column prop="updatedAt" :label="lt('更新时间', 'Updated At')" min-width="170" :formatter="formatTableDateTime" />
            <el-table-column :label="lt('操作', 'Actions')" width="220" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" @click="openEditMonthly(row)">{{ lt('编辑', 'Edit') }}</el-button>
                <el-button link type="primary" @click="openProgress('monthly', row)">{{ lt('进度', 'Progress') }}</el-button>
                <el-button link :type="String(row.status) === '1' ? 'danger' : 'success'" @click="toggleMonthly(row)">
                  {{ String(row.status) === '1' ? lt('禁用', 'Disable') : lt('启用', 'Enable') }}
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

        <el-tab-pane :label="lt('活动任务', 'Event Quests')" name="events">
          <div class="table-toolbar">
            <el-form :inline="true" :model="eventQuery" class="filter-form compact-filter">
              <el-form-item :label="lt('状态', 'Status')">
                <el-select v-model="eventQuery.status" clearable style="width: 130px">
                  <el-option v-for="item in statusOptions" :key="item.value" :label="item.label" :value="item.value" />
                </el-select>
              </el-form-item>
              <el-form-item><el-button type="primary" @click="loadEvents">{{ lt('查询', 'Search') }}</el-button></el-form-item>
            </el-form>
            <el-button type="primary" :icon="'Plus'" @click="openCreateEvent">{{ lt('创建活动任务', 'Create Event Quest') }}</el-button>
          </div>

          <el-table v-loading="campaignLoading" :data="eventRows" border>
            <el-table-column prop="questCode" :label="lt('编码', 'Code')" min-width="180" />
            <el-table-column prop="questName" :label="lt('名称', 'Name')" min-width="180" show-overflow-tooltip />
            <el-table-column prop="startsAt" :label="lt('开始时间', 'Start Time')" min-width="170" :formatter="formatTableDateTime" />
            <el-table-column prop="endsAt" :label="lt('结束时间', 'End Time')" min-width="170" :formatter="formatTableDateTime" />
            <el-table-column prop="targetType" :label="lt('目标类型', 'Target Type')" min-width="150" />
            <el-table-column prop="targetValue" :label="lt('目标值', 'Target Value')" width="90" />
            <el-table-column prop="rewardType" :label="lt('奖励类型', 'Reward Type')" width="110" />
            <el-table-column prop="rewardAmount" :label="lt('奖励数量', 'Reward Amount')" width="110" />
            <el-table-column prop="rewardName" :label="lt('奖励名称', 'Reward Name')" min-width="150" show-overflow-tooltip />
            <el-table-column prop="status" :label="lt('状态', 'Status')" width="90">
              <template #default="{ row }"><el-tag :type="statusType(row.status)">{{ statusLabel(row.status) }}</el-tag></template>
            </el-table-column>
            <el-table-column prop="sortOrder" :label="lt('排序', 'Sort Order')" width="80" />
            <el-table-column prop="updatedAt" :label="lt('更新时间', 'Updated At')" min-width="170" :formatter="formatTableDateTime" />
            <el-table-column :label="lt('操作', 'Actions')" width="220" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" @click="openEditEvent(row)">{{ lt('编辑', 'Edit') }}</el-button>
                <el-button link type="primary" @click="openProgress('event', row)">{{ lt('进度', 'Progress') }}</el-button>
                <el-button link :type="String(row.status) === '1' ? 'danger' : 'success'" @click="toggleEvent(row)">
                  {{ String(row.status) === '1' ? lt('禁用', 'Disable') : lt('启用', 'Enable') }}
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

    <el-dialog v-model="monthlyDialogVisible" :title="monthlyDialogTitle" width="760px">
      <el-form ref="monthlyFormRef" :model="monthlyForm" :rules="monthlyRules" label-width="120px">
        <el-row :gutter="16">
          <el-col :span="12"><el-form-item :label="lt('编码', 'Code')" prop="challengeCode"><el-input v-model="monthlyForm.challengeCode" :disabled="!!monthlyForm.id" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item :label="lt('名称', 'Name')" prop="challengeName"><el-input v-model="monthlyForm.challengeName" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item :label="lt('主题', 'Theme')"><el-input v-model="monthlyForm.theme" /></el-form-item></el-col>
          <el-col :span="6"><el-form-item :label="lt('起始月龄', 'Start Month Age')"><el-input-number v-model="monthlyForm.monthsFrom" :min="0" /></el-form-item></el-col>
          <el-col :span="6"><el-form-item :label="lt('结束月龄', 'End Month Age')"><el-input-number v-model="monthlyForm.monthsTo" :min="0" /></el-form-item></el-col>
          <el-col :span="12">
            <el-form-item :label="lt('目标类型', 'Target Type')" prop="targetType">
              <el-select v-model="monthlyForm.targetType" filterable allow-create>
                <el-option v-for="item in targetOptions" :key="item" :label="item" :value="item" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12"><el-form-item :label="lt('目标值', 'Target Value')" prop="targetValue"><el-input-number v-model="monthlyForm.targetValue" :min="1" /></el-form-item></el-col>
          <el-col :span="12">
            <el-form-item :label="lt('奖励类型', 'Reward Type')" prop="rewardType">
              <el-select v-model="monthlyForm.rewardType" filterable allow-create>
                <el-option v-for="item in rewardOptions" :key="item" :label="item" :value="item" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12"><el-form-item :label="lt('奖励数量', 'Reward Amount')" prop="rewardAmount"><el-input-number v-model="monthlyForm.rewardAmount" :min="0.000001" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item :label="lt('奖励名称', 'Reward Name')" prop="rewardName"><el-input v-model="monthlyForm.rewardName" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="Badge"><el-input v-model="monthlyForm.badgeAchievementCode" clearable /></el-form-item></el-col>
          <el-col :span="12"><el-form-item :label="lt('排序', 'Sort Order')"><el-input-number v-model="monthlyForm.sortOrder" :min="0" /></el-form-item></el-col>
          <el-col :span="12">
            <el-form-item :label="lt('状态', 'Status')">
              <el-select v-model="monthlyForm.status">
                <el-option v-for="item in statusOptions" :key="item.value" :label="item.label" :value="item.value" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="24"><el-form-item :label="lt('描述', 'Description')"><el-input v-model="monthlyForm.description" type="textarea" :rows="3" maxlength="512" show-word-limit /></el-form-item></el-col>
        </el-row>
      </el-form>
      <template #footer>
        <el-button @click="monthlyDialogVisible = false">{{ lt('取消', 'Cancel') }}</el-button>
        <el-button type="primary" :loading="saving" @click="saveMonthly">{{ lt('保存', 'Save') }}</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="eventDialogVisible" :title="eventDialogTitle" width="760px">
      <el-form ref="eventFormRef" :model="eventForm" :rules="eventRules" label-width="120px">
        <el-row :gutter="16">
          <el-col :span="12"><el-form-item :label="lt('编码', 'Code')" prop="questCode"><el-input v-model="eventForm.questCode" :disabled="!!eventForm.id" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item :label="lt('名称', 'Name')" prop="questName"><el-input v-model="eventForm.questName" /></el-form-item></el-col>
          <el-col :span="12">
            <el-form-item :label="lt('开始时间', 'Start Time')">
              <el-date-picker v-model="eventForm.startsAt" type="datetime" format="YYYY-MM-DD HH:mm:ss" value-format="YYYY-MM-DD HH:mm:ss" :placeholder="lt('选择开始时间', 'Select start time')" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item :label="lt('结束时间', 'End Time')">
              <el-date-picker v-model="eventForm.endsAt" type="datetime" format="YYYY-MM-DD HH:mm:ss" value-format="YYYY-MM-DD HH:mm:ss" :placeholder="lt('选择结束时间', 'Select end time')" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item :label="lt('目标类型', 'Target Type')" prop="targetType">
              <el-select v-model="eventForm.targetType" filterable allow-create>
                <el-option v-for="item in targetOptions" :key="item" :label="item" :value="item" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12"><el-form-item :label="lt('目标值', 'Target Value')" prop="targetValue"><el-input-number v-model="eventForm.targetValue" :min="1" /></el-form-item></el-col>
          <el-col :span="12">
            <el-form-item :label="lt('奖励类型', 'Reward Type')" prop="rewardType">
              <el-select v-model="eventForm.rewardType" filterable allow-create>
                <el-option v-for="item in rewardOptions" :key="item" :label="item" :value="item" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12"><el-form-item :label="lt('奖励数量', 'Reward Amount')" prop="rewardAmount"><el-input-number v-model="eventForm.rewardAmount" :min="0.000001" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item :label="lt('奖励名称', 'Reward Name')" prop="rewardName"><el-input v-model="eventForm.rewardName" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="Badge"><el-input v-model="eventForm.badgeAchievementCode" clearable /></el-form-item></el-col>
          <el-col :span="12"><el-form-item :label="lt('排序', 'Sort Order')"><el-input-number v-model="eventForm.sortOrder" :min="0" /></el-form-item></el-col>
          <el-col :span="12">
            <el-form-item :label="lt('状态', 'Status')">
              <el-select v-model="eventForm.status">
                <el-option v-for="item in statusOptions" :key="item.value" :label="item.label" :value="item.value" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="24"><el-form-item :label="lt('描述', 'Description')"><el-input v-model="eventForm.description" type="textarea" :rows="3" maxlength="512" show-word-limit /></el-form-item></el-col>
        </el-row>
      </el-form>
      <template #footer>
        <el-button @click="eventDialogVisible = false">{{ lt('取消', 'Cancel') }}</el-button>
        <el-button type="primary" :loading="saving" @click="saveEvent">{{ lt('保存', 'Save') }}</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="progressDialogVisible" :title="progressTitle" width="520px">
      <el-form :model="progressForm" label-width="120px">
        <el-form-item :label="lt('用户', 'User')"><UserSelect v-model="progressForm.userId" width="100%" /></el-form-item>
        <el-form-item :label="lt('进度值', 'Progress Value')"><el-input-number v-model="progressForm.progressValue" :min="0" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="progressDialogVisible = false">{{ lt('取消', 'Cancel') }}</el-button>
        <el-button type="primary" :loading="saving" @click="saveProgress">{{ lt('保存进度', 'Save Progress') }}</el-button>
      </template>
    </el-dialog>

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

.compact-filter {
  margin-bottom: 0;
}
</style>

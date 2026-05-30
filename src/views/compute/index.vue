<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import {
  activateDevice,
  createDeviceLifecycleRule,
  deactivateDevice,
  dispatchComputeTask,
  getComputeDevices,
  getComputeNodeMap,
  getComputeReceipts,
  getComputeTasks,
  getDeviceFleetConfig,
  getDeviceLifecycleRules,
  processComputeTaskTimeouts,
  retryDueComputeTasks,
  scheduleDeviceDeactivation,
  updateDeviceLifecycleRule,
  type DeviceLifecycleRule,
  type UserDevice
} from '@/apis/operation'
import type { AnyRecord, Id } from '@/types/common'
import { formatNow, formatTableDateTime } from '@/utils/date'
import { localeText as lt, enumLabel, enumOptions, enumTableFormatter } from '@/utils/i18n'
import UserSelect from '@/components/UserSelect.vue'
import ObjectDetails from '@/components/ObjectDetails.vue'

const props = withDefaults(defineProps<{ defaultTab?: string }>(), { defaultTab: 'devices' })

const activeTab = ref(props.defaultTab)
const loading = ref(false)
const actionLoading = ref(false)
const devices = ref<UserDevice[]>([])
const deviceTotal = ref(0)
const lifecycleRules = ref<DeviceLifecycleRule[]>([])
const maxActiveSlots = ref<number | null>(null)
const tasks = ref<AnyRecord[]>([])
const taskTotal = ref(0)
const receipts = ref<AnyRecord[]>([])
const receiptTotal = ref(0)
const nodeMap = ref<AnyRecord | null>(null)
const detailVisible = ref(false)
const detailRecord = ref<AnyRecord | null>(null)
const lastComputeAction = ref('')

const deviceQuery = reactive({ current: 1, size: 10, userId: '', sourceOrderNo: '', status: '' })
const lifecycleQuery = reactive({ status: '' })
const taskQuery = reactive({ current: 1, size: 10, userId: '', userDeviceId: '', taskType: '', status: '' })
const receiptQuery = reactive({ current: 1, size: 10, userId: '', userDeviceId: '', taskType: '' })
const nodeLimit = ref(100)
const maintenanceLimit = ref(20)
const deviceStatusOptions = ['ONLINE', 'BUSY', 'INACTIVE', 'OFFLINE']
const lifecycleScopeOptions = ['DEFAULT', 'PRODUCT_TYPE', 'TIER', 'PRODUCT_ID']
const taskTypeOptions = ['POC_RECEIPT', 'AI_INFERENCE', 'BENCHMARK']
const taskStatusOptions = ['PENDING', 'LEASED', 'RUNNING', 'SUCCESS', 'FAILED', 'DEAD', 'TIMEOUT']

const lifecycleDialogVisible = ref(false)
const lifecycleSaving = ref(false)
const lifecycleFormRef = ref<FormInstance>()
const lastLifecycleAction = ref('')
const lifecycleForm = reactive({
  id: undefined as Id | undefined,
  scopeType: 'DEFAULT',
  scopeValue: '',
  startMonth: 1,
  endMonth: undefined as number | undefined,
  monthlyDecayRate: 0,
  floorEfficiency: 0.22,
  exempt: 0,
  status: 0,
  sortOrder: 100
})
const lifecycleRulesFormRules: FormRules = {
  scopeType: [{ required: true, message: lt('请选择范围', 'Please select scope'), trigger: 'change' }],
  startMonth: [{ required: true, message: lt('请填写起始月', 'Please enter start month'), trigger: 'blur' }],
  monthlyDecayRate: [{ required: true, message: lt('请填写月衰减', 'Please enter monthly decay'), trigger: 'blur' }],
  floorEfficiency: [{ required: true, message: lt('请填写效率下限', 'Please enter floor efficiency'), trigger: 'blur' }]
}

const taskDialogVisible = ref(false)
const taskSaving = ref(false)
const taskFormRef = ref<FormInstance>()
const taskForm = reactive({
  userId: undefined as number | undefined,
  preferredDeviceId: undefined as number | undefined,
  taskType: 'POC_RECEIPT',
  clientName: 'ops-console',
  maxAttempts: 3,
  leaseSeconds: 300
})
const taskRules: FormRules = {
  taskType: [{ required: true, message: lt('请填写任务类型', 'Please enter task type'), trigger: 'blur' }],
  clientName: [{ required: true, message: lt('请填写客户端名称', 'Please enter client name'), trigger: 'blur' }]
}

function pageIndex(query: { current: number; size: number }, index: number) {
  return (query.current - 1) * query.size + index + 1
}

function percent(value: unknown) {
  const num = Number(value ?? 0)
  return Number.isFinite(num) ? `${(num * 100).toFixed(1)}%` : '-'
}

function showDetail(row: AnyRecord) {
  detailRecord.value = row
  detailVisible.value = true
}

function resetLifecycleForm() {
  Object.assign(lifecycleForm, {
    id: undefined,
    scopeType: 'DEFAULT',
    scopeValue: '',
    startMonth: 1,
    endMonth: undefined,
    monthlyDecayRate: 0,
    floorEfficiency: 0.22,
    exempt: 0,
    status: 0,
    sortOrder: 100
  })
}

function openLifecycleDialog(row?: DeviceLifecycleRule) {
  resetLifecycleForm()
  if (row) {
    Object.assign(lifecycleForm, {
      id: row.id,
      scopeType: row.scopeType || 'DEFAULT',
      scopeValue: row.scopeValue || '',
      startMonth: Number(row.startMonth ?? 1),
      endMonth: row.endMonth == null ? undefined : Number(row.endMonth),
      monthlyDecayRate: Number(row.monthlyDecayRate ?? 0),
      floorEfficiency: Number(row.floorEfficiency ?? 0),
      exempt: Number(row.exempt ?? 0),
      status: Number(row.status ?? 1),
      sortOrder: Number(row.sortOrder ?? 100)
    })
  }
  lifecycleDialogVisible.value = true
}

async function validateLifecycleForm() {
  try {
    await lifecycleFormRef.value?.validate()
    return true
  } catch {
    return false
  }
}

async function saveLifecycleRule() {
  if (!(await validateLifecycleForm())) {
    return
  }
  if (lifecycleForm.scopeType !== 'DEFAULT' && !lifecycleForm.scopeValue) {
    ElMessage.warning(lt('非默认规则需要填写范围值', 'Scope value is required for non-default rules'))
    return
  }
  if (lifecycleForm.endMonth != null && lifecycleForm.endMonth < lifecycleForm.startMonth) {
    ElMessage.warning(lt('结束月不能小于起始月', 'End month cannot be less than start month'))
    return
  }
  if (Number(lifecycleForm.monthlyDecayRate) < 0 || Number(lifecycleForm.monthlyDecayRate) > 1) {
    ElMessage.warning(lt('月衰减必须在 0 到 1 之间', 'Monthly decay must be between 0 and 1'))
    return
  }
  if (Number(lifecycleForm.floorEfficiency) < 0 || Number(lifecycleForm.floorEfficiency) > 1) {
    ElMessage.warning(lt('效率下限必须在 0 到 1 之间', 'Floor efficiency must be between 0 and 1'))
    return
  }
  lifecycleSaving.value = true
  try {
    const payload = {
      scopeType: lifecycleForm.scopeType,
      scopeValue: lifecycleForm.scopeValue,
      startMonth: lifecycleForm.startMonth,
      endMonth: lifecycleForm.endMonth,
      monthlyDecayRate: lifecycleForm.monthlyDecayRate,
      floorEfficiency: lifecycleForm.floorEfficiency,
      exempt: lifecycleForm.exempt,
      status: lifecycleForm.status,
      sortOrder: lifecycleForm.sortOrder
    }
    if (lifecycleForm.id) {
      await updateDeviceLifecycleRule(lifecycleForm.id, payload)
      ElMessage.success(lt('生命周期规则已更新', 'Lifecycle rule updated'))
      lastLifecycleAction.value = `已更新生命周期规则 ${lifecycleForm.id}，状态 ${enumLabel(lifecycleForm.status)}，${formatNow()}`
    } else {
      const created = await createDeviceLifecycleRule(payload)
      ElMessage.success(lt('生命周期规则已创建', 'Lifecycle rule created'))
      lastLifecycleAction.value = `已创建生命周期规则 ${created.id}，状态 ${enumLabel(created.status)}，${formatNow()}`
    }
    lifecycleDialogVisible.value = false
    await loadLifecycleRules()
  } finally {
    lifecycleSaving.value = false
  }
}

async function changeLifecycleStatus(row: DeviceLifecycleRule, status: number) {
  if (!row.id) return
  await ElMessageBox.confirm(`确认将生命周期规则 ${row.id} 状态改为 ${status === 1 ? '启用' : '停用'}?`, lt('生命周期规则状态变更', 'Lifecycle Rule Status Change'), { type: 'warning' })
  lifecycleSaving.value = true
  try {
    await updateDeviceLifecycleRule(row.id, { status })
    ElMessage.success(lt('生命周期规则状态已更新', 'Lifecycle rule status updated'))
    lastLifecycleAction.value = `已将生命周期规则 ${row.id} 状态改为 ${enumLabel(status)}，${formatNow()}`
    await loadLifecycleRules()
  } finally {
    lifecycleSaving.value = false
  }
}

async function saveTask() {
  try {
    await taskFormRef.value?.validate()
  } catch {
    return
  }
  await ElMessageBox.confirm(
    `${lt('确认派发', 'Confirm dispatching')} ${taskForm.taskType} ${lt('任务', 'task')}?${taskForm.preferredDeviceId ? ` ${lt('设备', 'device')} ${taskForm.preferredDeviceId}` : ''}`,
    lt('派发计算任务', 'Dispatch Compute Task'),
    { type: 'warning' }
  )
  taskSaving.value = true
  try {
    const result = await dispatchComputeTask({
      userId: taskForm.userId,
      preferredDeviceId: taskForm.preferredDeviceId,
      taskType: taskForm.taskType,
      clientName: taskForm.clientName,
      maxAttempts: taskForm.maxAttempts,
      leaseSeconds: taskForm.leaseSeconds
    })
    ElMessage.success(lt('任务已派发', 'Task dispatched'))
    lastComputeAction.value = `任务已派发: ${result.taskNo || taskForm.taskType}，${formatNow()}`
    taskDialogVisible.value = false
    await loadTasks()
  } finally {
    taskSaving.value = false
  }
}

async function runDeviceAction(id: Id | undefined, action: 'activate' | 'deactivate' | 'schedule') {
  if (!id) return
  const actionName = action === 'activate' ? '激活' : action === 'deactivate' ? '立即停用' : '排队停用'
  await ElMessageBox.confirm(`确认${actionName}设备 ${id}?`, lt('设备操作', 'Device Action'), { type: 'warning' })
  actionLoading.value = true
  try {
    if (action === 'activate') await activateDevice(id)
    if (action === 'deactivate') await deactivateDevice(id)
    if (action === 'schedule') await scheduleDeviceDeactivation(id)
    ElMessage.success(lt('设备状态已提交', 'Device status submitted'))
    lastComputeAction.value = `设备操作已提交: ${actionName} deviceId=${id}，${formatNow()}`
    await loadDevices()
  } finally {
    actionLoading.value = false
  }
}

async function runMaintenance(action: 'timeouts' | 'retries') {
  const title = action === 'timeouts' ? '处理超时任务' : '重试到期任务'
  await ElMessageBox.confirm(`确认${title}? 本次最多 ${maintenanceLimit.value} 条`, lt('任务维护', 'Task Maintenance'), { type: 'warning' })
  actionLoading.value = true
  try {
    const result = action === 'timeouts'
      ? await processComputeTaskTimeouts(maintenanceLimit.value)
      : await retryDueComputeTasks(maintenanceLimit.value)
    const count = result?.processed ?? result?.retried ?? result?.count ?? result?.total ?? '-'
    ElMessage.success(lt('任务维护完成', 'Task maintenance completed'))
    lastComputeAction.value = `任务维护完成: ${count} 条，${formatNow()}`
    await loadTasks()
  } finally {
    actionLoading.value = false
  }
}

async function loadFleet() {
  const fleet = await getDeviceFleetConfig({ silentError: true }).catch(() => null)
  maxActiveSlots.value = fleet?.maxActiveSlots ?? null
}

async function loadDevices() {
  const page = await getComputeDevices(deviceQuery)
  devices.value = page.records
  deviceTotal.value = page.total
}

async function loadLifecycleRules() {
  lifecycleRules.value = await getDeviceLifecycleRules({ status: lifecycleQuery.status }, { silentError: true }).catch(() => [])
}

async function loadTasks() {
  const page = await getComputeTasks(taskQuery)
  tasks.value = page.records
  taskTotal.value = page.total
}

async function loadReceipts() {
  const page = await getComputeReceipts(receiptQuery)
  receipts.value = page.records
  receiptTotal.value = page.total
}

async function loadNodeMap() {
  nodeMap.value = await getComputeNodeMap(nodeLimit.value, { silentError: true }).catch(() => null)
}

async function loadActiveTab() {
  if (activeTab.value === 'devices') await loadDevices()
  if (activeTab.value === 'lifecycle') await loadLifecycleRules()
  if (activeTab.value === 'tasks') await loadTasks()
  if (activeTab.value === 'receipts') await loadReceipts()
  if (activeTab.value === 'node-map') await loadNodeMap()
}

async function loadData() {
  loading.value = true
  try {
    await Promise.all([loadFleet(), loadActiveTab()])
  } finally {
    loading.value = false
  }
}

function resetDevices() {
  Object.assign(deviceQuery, { current: 1, userId: '', sourceOrderNo: '', status: '' })
  loadData()
}

function resetTasks() {
  Object.assign(taskQuery, { current: 1, userId: '', userDeviceId: '', taskType: '', status: '' })
  loadData()
}

function resetReceipts() {
  Object.assign(receiptQuery, { current: 1, userId: '', userDeviceId: '', taskType: '' })
  loadData()
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
          <div class="table-toolbar"><span>{{ lt('最大激活槽位', 'Max Active Slots') }}</span><el-icon color="#409eff" :size="24"><Grid /></el-icon></div>
          <div class="value">{{ maxActiveSlots ?? '-' }}</div>
        </el-card>
      </el-col>
      <el-col :xs="24" :sm="12" :md="6">
        <el-card shadow="never" class="stat-card">
          <div class="table-toolbar"><span>{{ lt('设备实例', 'Device Instances') }}</span><el-icon color="#67c23a" :size="24"><Cpu /></el-icon></div>
          <div class="value">{{ deviceTotal }}</div>
        </el-card>
      </el-col>
      <el-col :xs="24" :sm="12" :md="6">
        <el-card shadow="never" class="stat-card">
          <div class="table-toolbar"><span>{{ lt('生命周期规则', 'Lifecycle Rules') }}</span><el-icon color="#e6a23c" :size="24"><Timer /></el-icon></div>
          <div class="value">{{ lifecycleRules.length }}</div>
        </el-card>
      </el-col>
      <el-col :xs="24" :sm="12" :md="6">
        <el-card shadow="never" class="stat-card">
          <div class="table-toolbar"><span>{{ lt('任务总数', 'Tasks') }}</span><el-icon color="#f56c6c" :size="24"><Operation /></el-icon></div>
          <div class="value">{{ taskTotal }}</div>
        </el-card>
      </el-col>
    </el-row>

    <el-card shadow="never">
      <div class="table-toolbar">
        <span>{{ lt('设备算力', 'Compute Devices') }}</span>
        <el-button :icon="'Refresh'" @click="loadData">{{ lt('刷新', 'Refresh') }}</el-button>
      </div>
      <el-alert v-if="lastComputeAction" :title="lastComputeAction" type="success" show-icon :closable="false" class="operation-alert" />

      <el-tabs v-model="activeTab">
        <el-tab-pane :label="lt('设备实例', 'Device Instances')" name="devices">
          <el-form :inline="true" :model="deviceQuery" class="filter-form">
            <el-form-item :label="lt('用户', 'User')"><UserSelect v-model="deviceQuery.userId" /></el-form-item>
            <el-form-item :label="lt('来源订单', 'Source Order')"><el-input v-model="deviceQuery.sourceOrderNo" clearable /></el-form-item>
            <el-form-item :label="lt('状态', 'Status')">
              <el-select v-model="deviceQuery.status" clearable style="width: 150px">
                <el-option v-for="status in enumOptions(deviceStatusOptions)" :key="status.value" :label="status.label" :value="status.value" />
              </el-select>
            </el-form-item>
            <el-form-item>
              <el-button type="primary" @click="deviceQuery.current = 1; loadData()">{{ lt('查询', 'Search') }}</el-button>
              <el-button @click="resetDevices">{{ lt('重置', 'Reset') }}</el-button>
            </el-form-item>
          </el-form>
          <el-table v-loading="loading" :data="devices" border>
            <el-table-column type="index" :index="(index: number) => pageIndex(deviceQuery, index)" :label="lt('编号', 'No.')" width="80" />
            <el-table-column prop="userId" :label="lt('用户ID', 'User ID')" width="100" />
            <el-table-column prop="instanceNo" :label="lt('实例编号', 'Instance No.')" min-width="170" />
            <el-table-column prop="name" :label="lt('名称', 'Name')" min-width="150" />
            <el-table-column prop="productTier" :label="lt('档位', 'Tier')" width="90" />
            <el-table-column prop="deviceType" :label="lt('类型', 'Type')" width="120" :formatter="enumTableFormatter" />
            <el-table-column prop="status" :label="lt('状态', 'Status')" width="110" :formatter="enumTableFormatter" />
            <el-table-column prop="monthsOwned" :label="lt('持有月', 'Months Owned')" width="90" />
            <el-table-column :label="lt('当前效率', 'Current Efficiency')" width="110"><template #default="{ row }">{{ percent(row.currentEfficiency) }}</template></el-table-column>
            <el-table-column prop="effectiveDailyUsdt" :label="lt('有效 USDT/日', 'Effective USDT/Day')" width="140" />
            <el-table-column prop="effectiveDailyNex" :label="lt('有效 NEX/日', 'Effective NEX/Day')" width="140" />
            <el-table-column prop="sourceOrderNo" :label="lt('来源订单', 'Source Order')" min-width="160" />
            <el-table-column :label="lt('操作', 'Actions')" width="250" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" @click="showDetail(row)">{{ lt('详情', 'Details') }}</el-button>
                <el-button link type="success" :disabled="row.status !== 'INACTIVE' || actionLoading" @click="runDeviceAction(row.id, 'activate')">{{ lt('激活', 'Activate') }}</el-button>
                <el-button link type="warning" :disabled="row.status === 'INACTIVE' || actionLoading" @click="runDeviceAction(row.id, 'schedule')">{{ lt('排队停用', 'Schedule Stop') }}</el-button>
                <el-button link type="danger" :disabled="row.status === 'INACTIVE' || actionLoading" @click="runDeviceAction(row.id, 'deactivate')">{{ lt('停用', 'Disabled') }}</el-button>
              </template>
            </el-table-column>
          </el-table>
          <div class="pagination-wrap">
            <el-pagination v-model:current-page="deviceQuery.current" v-model:page-size="deviceQuery.size" layout="total, sizes, prev, pager, next" :total="deviceTotal" @current-change="loadData" @size-change="loadData" />
          </div>
        </el-tab-pane>

        <el-tab-pane :label="lt('生命周期', 'Lifecycle')" name="lifecycle">
          <div class="table-toolbar">
            <span>{{ lt('设备生命周期规则', 'Device Lifecycle Rules') }}</span>
            <el-button type="primary" :icon="'Plus'" @click="openLifecycleDialog()">{{ lt('新增规则', 'New Rule') }}</el-button>
          </div>
          <el-form :inline="true" :model="lifecycleQuery" class="filter-form">
            <el-form-item :label="lt('状态', 'Status')">
              <el-select v-model="lifecycleQuery.status" clearable style="width: 120px">
                <el-option :label="enumLabel(1)" :value="1" />
                <el-option :label="enumLabel(0)" :value="0" />
              </el-select>
            </el-form-item>
            <el-form-item><el-button type="primary" @click="loadData">{{ lt('查询', 'Search') }}</el-button></el-form-item>
          </el-form>
          <el-alert v-if="lastLifecycleAction" :title="lastLifecycleAction" type="success" show-icon :closable="false" class="operation-alert" />
          <el-table v-loading="loading" :data="lifecycleRules" border>
            <el-table-column prop="scopeType" :label="lt('范围', 'Scope')" width="140" :formatter="enumTableFormatter" />
            <el-table-column prop="scopeValue" :label="lt('范围值', 'Scope Value')" min-width="150" />
            <el-table-column prop="startMonth" :label="lt('起始月', 'Start Month')" width="100" />
            <el-table-column prop="endMonth" :label="lt('结束月', 'End Month')" width="100" />
            <el-table-column prop="monthlyDecayRate" :label="lt('月衰减', 'Monthly Decay')" width="120" />
            <el-table-column prop="floorEfficiency" :label="lt('效率下限', 'Floor Efficiency')" width="120" />
            <el-table-column prop="exempt" :label="lt('豁免', 'Exempt')" width="90" :formatter="enumTableFormatter" />
            <el-table-column prop="sortOrder" :label="lt('排序', 'Sort Order')" width="90" />
            <el-table-column :label="lt('状态', 'Status')" width="90">
              <template #default="{ row }"><el-tag :type="Number(row.status) === 1 ? 'success' : 'info'">{{ enumLabel(row.status) }}</el-tag></template>
            </el-table-column>
            <el-table-column :label="lt('操作', 'Actions')" width="170" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" @click="openLifecycleDialog(row)">{{ lt('编辑', 'Edit') }}</el-button>
                <el-button v-if="Number(row.status) !== 1" link type="success" :disabled="lifecycleSaving" @click="changeLifecycleStatus(row, 1)">{{ lt('启用', 'Enabled') }}</el-button>
                <el-button v-else link type="warning" :disabled="lifecycleSaving" @click="changeLifecycleStatus(row, 0)">{{ lt('停用', 'Disabled') }}</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>

        <el-tab-pane :label="lt('计算任务', 'Compute Tasks')" name="tasks">
          <div class="table-toolbar">
            <span>{{ lt('任务队列', 'Task Queue') }}</span>
            <div>
              <el-input-number v-model="maintenanceLimit" :min="1" :max="200" style="width: 118px; margin-right: 10px" />
              <el-button :loading="actionLoading" @click="runMaintenance('timeouts')">{{ lt('处理超时', 'Handle Timeouts') }}</el-button>
              <el-button :loading="actionLoading" @click="runMaintenance('retries')">{{ lt('重试到期', 'Retry Due') }}</el-button>
              <el-button type="primary" :icon="'Plus'" @click="taskDialogVisible = true">{{ lt('派发任务', 'Dispatch Task') }}</el-button>
            </div>
          </div>
          <el-form :inline="true" :model="taskQuery" class="filter-form">
            <el-form-item :label="lt('用户', 'User')"><UserSelect v-model="taskQuery.userId" /></el-form-item>
            <el-form-item :label="lt('设备ID', 'Device ID')"><el-input v-model="taskQuery.userDeviceId" clearable /></el-form-item>
            <el-form-item :label="lt('任务类型', 'Task Type')">
              <el-select v-model="taskQuery.taskType" clearable style="width: 150px">
                <el-option v-for="type in enumOptions(taskTypeOptions)" :key="type.value" :label="type.label" :value="type.value" />
              </el-select>
            </el-form-item>
            <el-form-item :label="lt('状态', 'Status')">
              <el-select v-model="taskQuery.status" clearable style="width: 140px">
                <el-option v-for="status in enumOptions(taskStatusOptions)" :key="status.value" :label="status.label" :value="status.value" />
              </el-select>
            </el-form-item>
            <el-form-item>
              <el-button type="primary" @click="taskQuery.current = 1; loadData()">{{ lt('查询', 'Search') }}</el-button>
              <el-button @click="resetTasks">{{ lt('重置', 'Reset') }}</el-button>
            </el-form-item>
          </el-form>
          <el-table v-loading="loading" :data="tasks" border>
            <el-table-column type="index" :index="(index: number) => pageIndex(taskQuery, index)" :label="lt('编号', 'No.')" width="80" />
            <el-table-column prop="taskNo" :label="lt('任务号', 'Task No.')" min-width="170" />
            <el-table-column prop="userId" :label="lt('用户ID', 'User ID')" width="100" />
            <el-table-column prop="userDeviceId" :label="lt('设备ID', 'Device ID')" width="100" />
            <el-table-column prop="taskType" :label="lt('类型', 'Type')" width="130" />
            <el-table-column prop="status" :label="lt('状态', 'Status')" width="110" :formatter="enumTableFormatter" />
            <el-table-column prop="attemptCount" :label="lt('尝试', 'Attempts')" width="80" />
            <el-table-column prop="maxAttempts" :label="lt('上限', 'Max')" width="80" />
            <el-table-column prop="leasedBy" :label="lt('租约方', 'Leased By')" min-width="130" />
            <el-table-column prop="nextRetryAt" :label="lt('下次重试', 'Next Retry')" min-width="170" :formatter="formatTableDateTime" />
            <el-table-column :label="lt('操作', 'Actions')" width="90" fixed="right">
              <template #default="{ row }"><el-button link type="primary" @click="showDetail(row)">{{ lt('详情', 'Details') }}</el-button></template>
            </el-table-column>
          </el-table>
          <div class="pagination-wrap">
            <el-pagination v-model:current-page="taskQuery.current" v-model:page-size="taskQuery.size" layout="total, sizes, prev, pager, next" :total="taskTotal" @current-change="loadData" @size-change="loadData" />
          </div>
        </el-tab-pane>

        <el-tab-pane label="Receipt" name="receipts">
          <el-form :inline="true" :model="receiptQuery" class="filter-form">
            <el-form-item :label="lt('用户', 'User')"><UserSelect v-model="receiptQuery.userId" /></el-form-item>
            <el-form-item :label="lt('设备ID', 'Device ID')"><el-input v-model="receiptQuery.userDeviceId" clearable /></el-form-item>
            <el-form-item :label="lt('任务类型', 'Task Type')">
              <el-select v-model="receiptQuery.taskType" clearable style="width: 150px">
                <el-option v-for="type in enumOptions(taskTypeOptions)" :key="type.value" :label="type.label" :value="type.value" />
              </el-select>
            </el-form-item>
            <el-form-item>
              <el-button type="primary" @click="receiptQuery.current = 1; loadData()">{{ lt('查询', 'Search') }}</el-button>
              <el-button @click="resetReceipts">{{ lt('重置', 'Reset') }}</el-button>
            </el-form-item>
          </el-form>
          <el-table v-loading="loading" :data="receipts" border>
            <el-table-column type="index" :index="(index: number) => pageIndex(receiptQuery, index)" :label="lt('编号', 'No.')" width="80" />
            <el-table-column prop="receiptNo" :label="lt('凭证号', 'Receipt No.')" min-width="170" />
            <el-table-column prop="taskNo" :label="lt('任务号', 'Task No.')" min-width="170" />
            <el-table-column prop="userId" :label="lt('用户ID', 'User ID')" width="100" />
            <el-table-column prop="userDeviceId" :label="lt('设备ID', 'Device ID')" width="100" />
            <el-table-column prop="taskType" :label="lt('类型', 'Type')" width="130" />
            <el-table-column prop="usdtAmount" label="USDT" width="120" />
            <el-table-column prop="nexAmount" label="NEX" width="120" />
            <el-table-column prop="settlementStatus" :label="lt('结算状态', 'Settlement Status')" width="120" :formatter="enumTableFormatter" />
            <el-table-column prop="createdAt" :label="lt('创建时间', 'Created At')" min-width="170" :formatter="formatTableDateTime" />
            <el-table-column :label="lt('操作', 'Actions')" width="90" fixed="right">
              <template #default="{ row }"><el-button link type="primary" @click="showDetail(row)">{{ lt('详情', 'Details') }}</el-button></template>
            </el-table-column>
          </el-table>
          <div class="pagination-wrap">
            <el-pagination v-model:current-page="receiptQuery.current" v-model:page-size="receiptQuery.size" layout="total, sizes, prev, pager, next" :total="receiptTotal" @current-change="loadData" @size-change="loadData" />
          </div>
        </el-tab-pane>

        <el-tab-pane :label="lt('节点地图', 'Node Map')" name="node-map">
          <div class="table-toolbar">
            <span>{{ lt('节点地图', 'Node Map') }}</span>
            <div>
              <el-input-number v-model="nodeLimit" :min="1" :max="1000" style="width: 118px; margin-right: 10px" />
              <el-button type="primary" @click="loadData">{{ lt('查询', 'Search') }}</el-button>
            </div>
          </div>
          <ObjectDetails :data="nodeMap" :empty-text="lt('暂无节点地图数据', 'No node map data')" />
        </el-tab-pane>
      </el-tabs>
    </el-card>

    <el-dialog v-model="lifecycleDialogVisible" :title="lifecycleForm.id ? lt('编辑生命周期规则', 'Edit Lifecycle Rule') : lt('新增生命周期规则', 'New Lifecycle Rule')" width="720px">
      <el-form ref="lifecycleFormRef" :model="lifecycleForm" :rules="lifecycleRulesFormRules" label-width="118px">
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item :label="lt('范围', 'Scope')" prop="scopeType">
              <el-select v-model="lifecycleForm.scopeType" style="width: 100%">
                <el-option v-for="scope in enumOptions(lifecycleScopeOptions)" :key="scope.value" :label="scope.label" :value="scope.value" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12"><el-form-item :label="lt('范围值', 'Scope Value')"><el-input v-model="lifecycleForm.scopeValue" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item :label="lt('起始月', 'Start Month')" prop="startMonth"><el-input-number v-model="lifecycleForm.startMonth" :min="0" style="width: 100%" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item :label="lt('结束月', 'End Month')"><el-input-number v-model="lifecycleForm.endMonth" :min="0" style="width: 100%" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item :label="lt('月衰减', 'Monthly Decay')" prop="monthlyDecayRate"><el-input-number v-model="lifecycleForm.monthlyDecayRate" :min="0" :max="1" :precision="4" style="width: 100%" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item :label="lt('效率下限', 'Floor Efficiency')" prop="floorEfficiency"><el-input-number v-model="lifecycleForm.floorEfficiency" :min="0" :max="1" :precision="4" style="width: 100%" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item :label="lt('豁免', 'Exempt')"><el-switch v-model="lifecycleForm.exempt" :active-value="1" :inactive-value="0" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item :label="lt('状态', 'Status')"><el-switch v-model="lifecycleForm.status" :active-value="1" :inactive-value="0" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item :label="lt('排序', 'Sort Order')"><el-input-number v-model="lifecycleForm.sortOrder" style="width: 100%" /></el-form-item></el-col>
        </el-row>
      </el-form>
      <template #footer>
        <el-button @click="lifecycleDialogVisible = false">{{ lt('取消', 'Cancel') }}</el-button>
        <el-button type="primary" :loading="lifecycleSaving" @click="saveLifecycleRule">{{ lt('保存', 'Save') }}</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="taskDialogVisible" :title="lt('派发计算任务', 'Dispatch Compute Task')" width="620px">
      <el-form ref="taskFormRef" :model="taskForm" :rules="taskRules" label-width="118px">
        <el-form-item :label="lt('用户', 'User')"><UserSelect v-model="taskForm.userId" width="100%" /></el-form-item>
        <el-form-item :label="lt('优先设备ID', 'Preferred Device ID')"><el-input-number v-model="taskForm.preferredDeviceId" :min="1" style="width: 100%" /></el-form-item>
        <el-form-item :label="lt('任务类型', 'Task Type')" prop="taskType">
          <el-select v-model="taskForm.taskType" style="width: 100%">
            <el-option v-for="type in enumOptions(taskTypeOptions)" :key="type.value" :label="type.label" :value="type.value" />
          </el-select>
        </el-form-item>
        <el-form-item :label="lt('客户端', 'Client')" prop="clientName"><el-input v-model="taskForm.clientName" /></el-form-item>
        <el-form-item :label="lt('最大尝试', 'Max Attempts')"><el-input-number v-model="taskForm.maxAttempts" :min="1" :max="20" style="width: 100%" /></el-form-item>
        <el-form-item :label="lt('租约秒', 'Lease Seconds')"><el-input-number v-model="taskForm.leaseSeconds" :min="1" :max="86400" style="width: 100%" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="taskDialogVisible = false">{{ lt('取消', 'Cancel') }}</el-button>
        <el-button type="primary" :loading="taskSaving" @click="saveTask">{{ lt('派发', 'Dispatch') }}</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="detailVisible" :title="lt('详情', 'Details')" width="760px">
      <ObjectDetails :data="detailRecord" />
    </el-dialog>
  </div>
</template>

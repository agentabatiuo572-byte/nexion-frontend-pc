<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
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

const deviceQuery = reactive({ current: 1, size: 10, userId: '', sourceOrderNo: '', status: '' })
const lifecycleQuery = reactive({ status: '' })
const taskQuery = reactive({ current: 1, size: 10, userId: '', userDeviceId: '', taskType: '', status: '' })
const receiptQuery = reactive({ current: 1, size: 10, userId: '', userDeviceId: '', taskType: '' })
const nodeLimit = ref(100)
const maintenanceLimit = ref(20)

const lifecycleDialogVisible = ref(false)
const lifecycleSaving = ref(false)
const lifecycleForm = reactive({
  id: undefined as Id | undefined,
  scopeType: 'DEFAULT',
  scopeValue: '',
  startMonth: 1,
  endMonth: undefined as number | undefined,
  monthlyDecayRate: 0,
  floorEfficiency: 0.22,
  exempt: 0,
  status: 1,
  sortOrder: 100
})

const taskDialogVisible = ref(false)
const taskSaving = ref(false)
const taskForm = reactive({
  userId: undefined as number | undefined,
  preferredDeviceId: undefined as number | undefined,
  taskType: 'POC_RECEIPT',
  clientName: 'ops-console',
  maxAttempts: 3,
  leaseSeconds: 300
})

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
    status: 1,
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

async function saveLifecycleRule() {
  if (!lifecycleForm.scopeType) {
    ElMessage.warning('请选择规则范围')
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
      ElMessage.success('生命周期规则已更新')
    } else {
      await createDeviceLifecycleRule(payload)
      ElMessage.success('生命周期规则已创建')
    }
    lifecycleDialogVisible.value = false
    await loadLifecycleRules()
  } finally {
    lifecycleSaving.value = false
  }
}

async function saveTask() {
  if (!taskForm.taskType || !taskForm.clientName) {
    ElMessage.warning('请填写任务类型和客户端名称')
    return
  }
  taskSaving.value = true
  try {
    await dispatchComputeTask({
      userId: taskForm.userId,
      preferredDeviceId: taskForm.preferredDeviceId,
      taskType: taskForm.taskType,
      clientName: taskForm.clientName,
      maxAttempts: taskForm.maxAttempts,
      leaseSeconds: taskForm.leaseSeconds
    })
    ElMessage.success('任务已派发')
    taskDialogVisible.value = false
    await loadTasks()
  } finally {
    taskSaving.value = false
  }
}

async function runDeviceAction(id: Id | undefined, action: 'activate' | 'deactivate' | 'schedule') {
  if (!id) return
  const actionName = action === 'activate' ? '激活' : action === 'deactivate' ? '立即停用' : '排队停用'
  await ElMessageBox.confirm(`确认${actionName}设备 ${id}?`, '设备操作', { type: 'warning' })
  actionLoading.value = true
  try {
    if (action === 'activate') await activateDevice(id)
    if (action === 'deactivate') await deactivateDevice(id)
    if (action === 'schedule') await scheduleDeviceDeactivation(id)
    ElMessage.success('设备状态已提交')
    await loadDevices()
  } finally {
    actionLoading.value = false
  }
}

async function runMaintenance(action: 'timeouts' | 'retries') {
  const title = action === 'timeouts' ? '处理超时任务' : '重试到期任务'
  await ElMessageBox.confirm(`确认${title}? 本次最多 ${maintenanceLimit.value} 条`, '任务维护', { type: 'warning' })
  actionLoading.value = true
  try {
    const result = action === 'timeouts'
      ? await processComputeTaskTimeouts(maintenanceLimit.value)
      : await retryDueComputeTasks(maintenanceLimit.value)
    ElMessage.success(`操作完成: ${JSON.stringify(result)}`)
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
          <div class="table-toolbar"><span>最大激活槽位</span><el-icon color="#409eff" :size="24"><Grid /></el-icon></div>
          <div class="value">{{ maxActiveSlots ?? '-' }}</div>
        </el-card>
      </el-col>
      <el-col :xs="24" :sm="12" :md="6">
        <el-card shadow="never" class="stat-card">
          <div class="table-toolbar"><span>设备实例</span><el-icon color="#67c23a" :size="24"><Cpu /></el-icon></div>
          <div class="value">{{ deviceTotal }}</div>
        </el-card>
      </el-col>
      <el-col :xs="24" :sm="12" :md="6">
        <el-card shadow="never" class="stat-card">
          <div class="table-toolbar"><span>生命周期规则</span><el-icon color="#e6a23c" :size="24"><Timer /></el-icon></div>
          <div class="value">{{ lifecycleRules.length }}</div>
        </el-card>
      </el-col>
      <el-col :xs="24" :sm="12" :md="6">
        <el-card shadow="never" class="stat-card">
          <div class="table-toolbar"><span>任务总数</span><el-icon color="#f56c6c" :size="24"><Operation /></el-icon></div>
          <div class="value">{{ taskTotal }}</div>
        </el-card>
      </el-col>
    </el-row>

    <el-card shadow="never">
      <div class="table-toolbar">
        <span>设备算力</span>
        <el-button :icon="'Refresh'" @click="loadData">刷新</el-button>
      </div>

      <el-tabs v-model="activeTab">
        <el-tab-pane label="设备实例" name="devices">
          <el-form :inline="true" :model="deviceQuery" class="filter-form">
            <el-form-item label="用户ID"><el-input v-model="deviceQuery.userId" clearable /></el-form-item>
            <el-form-item label="来源订单"><el-input v-model="deviceQuery.sourceOrderNo" clearable /></el-form-item>
            <el-form-item label="状态"><el-input v-model="deviceQuery.status" clearable /></el-form-item>
            <el-form-item>
              <el-button type="primary" @click="deviceQuery.current = 1; loadData()">查询</el-button>
              <el-button @click="resetDevices">重置</el-button>
            </el-form-item>
          </el-form>
          <el-table v-loading="loading" :data="devices" border>
            <el-table-column type="index" :index="(index: number) => pageIndex(deviceQuery, index)" label="编号" width="80" />
            <el-table-column prop="userId" label="用户ID" width="100" />
            <el-table-column prop="instanceNo" label="实例编号" min-width="170" />
            <el-table-column prop="name" label="名称" min-width="150" />
            <el-table-column prop="productTier" label="档位" width="90" />
            <el-table-column prop="deviceType" label="类型" width="120" />
            <el-table-column prop="status" label="状态" width="110" />
            <el-table-column prop="monthsOwned" label="持有月" width="90" />
            <el-table-column label="当前效率" width="110"><template #default="{ row }">{{ percent(row.currentEfficiency) }}</template></el-table-column>
            <el-table-column prop="effectiveDailyUsdt" label="有效 USDT/日" width="140" />
            <el-table-column prop="effectiveDailyNex" label="有效 NEX/日" width="140" />
            <el-table-column prop="sourceOrderNo" label="来源订单" min-width="160" />
            <el-table-column label="操作" width="250" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" @click="showDetail(row)">详情</el-button>
                <el-button link type="success" :disabled="row.status !== 'INACTIVE' || actionLoading" @click="runDeviceAction(row.id, 'activate')">激活</el-button>
                <el-button link type="warning" :disabled="row.status === 'INACTIVE' || actionLoading" @click="runDeviceAction(row.id, 'schedule')">排队停用</el-button>
                <el-button link type="danger" :disabled="row.status === 'INACTIVE' || actionLoading" @click="runDeviceAction(row.id, 'deactivate')">停用</el-button>
              </template>
            </el-table-column>
          </el-table>
          <div class="pagination-wrap">
            <el-pagination v-model:current-page="deviceQuery.current" v-model:page-size="deviceQuery.size" layout="total, sizes, prev, pager, next" :total="deviceTotal" @current-change="loadData" @size-change="loadData" />
          </div>
        </el-tab-pane>

        <el-tab-pane label="生命周期" name="lifecycle">
          <div class="table-toolbar">
            <span>设备生命周期规则</span>
            <el-button type="primary" :icon="'Plus'" @click="openLifecycleDialog()">新增规则</el-button>
          </div>
          <el-form :inline="true" :model="lifecycleQuery" class="filter-form">
            <el-form-item label="状态">
              <el-select v-model="lifecycleQuery.status" clearable style="width: 120px">
                <el-option label="启用" :value="1" />
                <el-option label="停用" :value="0" />
              </el-select>
            </el-form-item>
            <el-form-item><el-button type="primary" @click="loadData">查询</el-button></el-form-item>
          </el-form>
          <el-table v-loading="loading" :data="lifecycleRules" border>
            <el-table-column prop="scopeType" label="范围" width="140" />
            <el-table-column prop="scopeValue" label="范围值" min-width="150" />
            <el-table-column prop="startMonth" label="起始月" width="100" />
            <el-table-column prop="endMonth" label="结束月" width="100" />
            <el-table-column prop="monthlyDecayRate" label="月衰减" width="120" />
            <el-table-column prop="floorEfficiency" label="效率下限" width="120" />
            <el-table-column prop="exempt" label="豁免" width="90" />
            <el-table-column prop="sortOrder" label="排序" width="90" />
            <el-table-column prop="status" label="状态" width="90" />
            <el-table-column label="操作" width="100" fixed="right">
              <template #default="{ row }"><el-button link type="primary" @click="openLifecycleDialog(row)">编辑</el-button></template>
            </el-table-column>
          </el-table>
        </el-tab-pane>

        <el-tab-pane label="计算任务" name="tasks">
          <div class="table-toolbar">
            <span>任务队列</span>
            <div>
              <el-input-number v-model="maintenanceLimit" :min="1" :max="200" style="width: 118px; margin-right: 10px" />
              <el-button :loading="actionLoading" @click="runMaintenance('timeouts')">处理超时</el-button>
              <el-button :loading="actionLoading" @click="runMaintenance('retries')">重试到期</el-button>
              <el-button type="primary" :icon="'Plus'" @click="taskDialogVisible = true">派发任务</el-button>
            </div>
          </div>
          <el-form :inline="true" :model="taskQuery" class="filter-form">
            <el-form-item label="用户ID"><el-input v-model="taskQuery.userId" clearable /></el-form-item>
            <el-form-item label="设备ID"><el-input v-model="taskQuery.userDeviceId" clearable /></el-form-item>
            <el-form-item label="任务类型"><el-input v-model="taskQuery.taskType" clearable /></el-form-item>
            <el-form-item label="状态"><el-input v-model="taskQuery.status" clearable /></el-form-item>
            <el-form-item>
              <el-button type="primary" @click="taskQuery.current = 1; loadData()">查询</el-button>
              <el-button @click="resetTasks">重置</el-button>
            </el-form-item>
          </el-form>
          <el-table v-loading="loading" :data="tasks" border>
            <el-table-column type="index" :index="(index: number) => pageIndex(taskQuery, index)" label="编号" width="80" />
            <el-table-column prop="taskNo" label="任务号" min-width="170" />
            <el-table-column prop="userId" label="用户ID" width="100" />
            <el-table-column prop="userDeviceId" label="设备ID" width="100" />
            <el-table-column prop="taskType" label="类型" width="130" />
            <el-table-column prop="status" label="状态" width="110" />
            <el-table-column prop="attempts" label="尝试" width="80" />
            <el-table-column prop="maxAttempts" label="上限" width="80" />
            <el-table-column prop="leasedBy" label="租约方" min-width="130" />
            <el-table-column prop="nextRetryAt" label="下次重试" min-width="170" />
            <el-table-column label="操作" width="90" fixed="right">
              <template #default="{ row }"><el-button link type="primary" @click="showDetail(row)">详情</el-button></template>
            </el-table-column>
          </el-table>
          <div class="pagination-wrap">
            <el-pagination v-model:current-page="taskQuery.current" v-model:page-size="taskQuery.size" layout="total, sizes, prev, pager, next" :total="taskTotal" @current-change="loadData" @size-change="loadData" />
          </div>
        </el-tab-pane>

        <el-tab-pane label="Receipt" name="receipts">
          <el-form :inline="true" :model="receiptQuery" class="filter-form">
            <el-form-item label="用户ID"><el-input v-model="receiptQuery.userId" clearable /></el-form-item>
            <el-form-item label="设备ID"><el-input v-model="receiptQuery.userDeviceId" clearable /></el-form-item>
            <el-form-item label="任务类型"><el-input v-model="receiptQuery.taskType" clearable /></el-form-item>
            <el-form-item>
              <el-button type="primary" @click="receiptQuery.current = 1; loadData()">查询</el-button>
              <el-button @click="resetReceipts">重置</el-button>
            </el-form-item>
          </el-form>
          <el-table v-loading="loading" :data="receipts" border>
            <el-table-column type="index" :index="(index: number) => pageIndex(receiptQuery, index)" label="编号" width="80" />
            <el-table-column prop="receiptNo" label="凭证号" min-width="170" />
            <el-table-column prop="taskNo" label="任务号" min-width="170" />
            <el-table-column prop="userId" label="用户ID" width="100" />
            <el-table-column prop="userDeviceId" label="设备ID" width="100" />
            <el-table-column prop="taskType" label="类型" width="130" />
            <el-table-column prop="usdtAmount" label="USDT" width="120" />
            <el-table-column prop="nexAmount" label="NEX" width="120" />
            <el-table-column prop="settlementStatus" label="结算状态" width="120" />
            <el-table-column prop="createdAt" label="创建时间" min-width="170" />
            <el-table-column label="操作" width="90" fixed="right">
              <template #default="{ row }"><el-button link type="primary" @click="showDetail(row)">详情</el-button></template>
            </el-table-column>
          </el-table>
          <div class="pagination-wrap">
            <el-pagination v-model:current-page="receiptQuery.current" v-model:page-size="receiptQuery.size" layout="total, sizes, prev, pager, next" :total="receiptTotal" @current-change="loadData" @size-change="loadData" />
          </div>
        </el-tab-pane>

        <el-tab-pane label="节点地图" name="node-map">
          <div class="table-toolbar">
            <span>节点地图</span>
            <div>
              <el-input-number v-model="nodeLimit" :min="1" :max="1000" style="width: 118px; margin-right: 10px" />
              <el-button type="primary" @click="loadData">查询</el-button>
            </div>
          </div>
          <pre class="json-preview">{{ JSON.stringify(nodeMap, null, 2) }}</pre>
        </el-tab-pane>
      </el-tabs>
    </el-card>

    <el-dialog v-model="lifecycleDialogVisible" :title="lifecycleForm.id ? '编辑生命周期规则' : '新增生命周期规则'" width="720px">
      <el-form :model="lifecycleForm" label-width="118px">
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="范围">
              <el-select v-model="lifecycleForm.scopeType" style="width: 100%">
                <el-option label="DEFAULT" value="DEFAULT" />
                <el-option label="PRODUCT_TYPE" value="PRODUCT_TYPE" />
                <el-option label="TIER" value="TIER" />
                <el-option label="PRODUCT_ID" value="PRODUCT_ID" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12"><el-form-item label="范围值"><el-input v-model="lifecycleForm.scopeValue" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="起始月"><el-input-number v-model="lifecycleForm.startMonth" :min="0" style="width: 100%" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="结束月"><el-input-number v-model="lifecycleForm.endMonth" :min="0" style="width: 100%" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="月衰减"><el-input-number v-model="lifecycleForm.monthlyDecayRate" :min="0" :max="1" :precision="4" style="width: 100%" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="效率下限"><el-input-number v-model="lifecycleForm.floorEfficiency" :min="0" :max="1" :precision="4" style="width: 100%" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="豁免"><el-switch v-model="lifecycleForm.exempt" :active-value="1" :inactive-value="0" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="状态"><el-switch v-model="lifecycleForm.status" :active-value="1" :inactive-value="0" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="排序"><el-input-number v-model="lifecycleForm.sortOrder" style="width: 100%" /></el-form-item></el-col>
        </el-row>
      </el-form>
      <template #footer>
        <el-button @click="lifecycleDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="lifecycleSaving" @click="saveLifecycleRule">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="taskDialogVisible" title="派发计算任务" width="620px">
      <el-form :model="taskForm" label-width="118px">
        <el-form-item label="用户ID"><el-input-number v-model="taskForm.userId" :min="1" style="width: 100%" /></el-form-item>
        <el-form-item label="优先设备ID"><el-input-number v-model="taskForm.preferredDeviceId" :min="1" style="width: 100%" /></el-form-item>
        <el-form-item label="任务类型"><el-input v-model="taskForm.taskType" /></el-form-item>
        <el-form-item label="客户端"><el-input v-model="taskForm.clientName" /></el-form-item>
        <el-form-item label="最大尝试"><el-input-number v-model="taskForm.maxAttempts" :min="1" :max="20" style="width: 100%" /></el-form-item>
        <el-form-item label="租约秒"><el-input-number v-model="taskForm.leaseSeconds" :min="1" :max="86400" style="width: 100%" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="taskDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="taskSaving" @click="saveTask">派发</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="detailVisible" title="详情" width="760px">
      <pre class="json-preview">{{ JSON.stringify(detailRecord, null, 2) }}</pre>
    </el-dialog>
  </div>
</template>

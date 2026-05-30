<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import {
  disableOpenApiApp,
  enableOpenApiApp,
  getOpenApiApps,
  getOpenApiCallAudits,
  getOpenApiOpsStats,
  getWebhookDeliveries,
  getWebhookDeliverySummary,
  publishWebhookDeliveries,
  updateOpenApiAppQuotas
} from '@/apis/operation'
import type { AnyRecord, Id } from '@/types/common'
import { formatNow, formatTableDateTime } from '@/utils/date'
import { localeText as lt, enumOptions, enumTableFormatter } from '@/utils/i18n'
import ObjectDetails from '@/components/ObjectDetails.vue'

const props = withDefaults(defineProps<{ defaultTab?: string }>(), { defaultTab: 'apps' })

const activeTab = ref(props.defaultTab)
const loading = ref(false)
const actionLoading = ref(false)
const stats = ref<AnyRecord | null>(null)
const webhookSummary = ref<AnyRecord | null>(null)
const apps = ref<AnyRecord[]>([])
const callAudits = ref<AnyRecord[]>([])
const deliveries = ref<AnyRecord[]>([])
const detailVisible = ref(false)
const detailRecord = ref<AnyRecord | null>(null)
const lastOpenApiAction = ref('')

const appQuery = reactive({ status: '', appKey: '', ownerUserId: '', limit: 20 })
const auditQuery = reactive({ appId: '', appKey: '', apiPath: '', responseCode: '', limit: 20 })
const deliveryQuery = reactive({ status: '', appId: '', eventType: '', limit: 20 })
const appStatusOptions = ['ACTIVE', 'DISABLED']
const deliveryStatusOptions = ['PENDING', 'SUCCESS', 'FAILED', 'DEAD']

const quotaDialogVisible = ref(false)
const quotaFormRef = ref<FormInstance>()
const quotaForm = reactive({
  appId: undefined as Id | undefined,
  qpsLimit: 10,
  dailyLimit: 10000,
  remark: ''
})
const quotaRules: FormRules = {
  appId: [{ required: true, message: lt('AppID 缺失', 'AppID is missing'), trigger: 'blur' }],
  qpsLimit: [{ required: true, message: lt('请填写 QPS', 'Please enter QPS'), trigger: 'blur' }],
  dailyLimit: [{ required: true, message: lt('请填写 Daily', 'Please enter daily limit'), trigger: 'blur' }],
  remark: [{ required: true, message: lt('请填写调整说明', 'Please enter adjustment remark'), trigger: 'blur' }]
}

function valueOf(record: AnyRecord | null, key: string) {
  const value = key.split('.').reduce<unknown>((current, part) => {
    return current && typeof current === 'object' ? (current as AnyRecord)[part] : undefined
  }, record || undefined)
  return value == null || value === '' ? '-' : String(value)
}

function compactParams(params: AnyRecord) {
  return Object.fromEntries(Object.entries(params).filter(([, value]) => value !== '' && value != null))
}

function showDetail(row: AnyRecord) {
  detailRecord.value = row
  detailVisible.value = true
}

function openQuota(row: AnyRecord) {
  Object.assign(quotaForm, {
    appId: row.id,
    qpsLimit: Number(row.qpsLimit ?? 10),
    dailyLimit: Number(row.dailyLimit ?? 10000),
    remark: String(row.remark || row.opsRemark || '')
  })
  quotaDialogVisible.value = true
}

async function saveQuota() {
  try {
    await quotaFormRef.value?.validate()
  } catch {
    return
  }
  const appId = quotaForm.appId
  if (!appId) {
    ElMessage.warning(lt('AppID 缺失', 'AppID is missing'))
    return
  }
  await ElMessageBox.confirm(`确认调整 OpenAPI App ${appId} 配额?`, lt('调整 App 配额', 'Adjust App Quota'), { type: 'warning' })
  actionLoading.value = true
  try {
    await updateOpenApiAppQuotas(appId, {
      qpsLimit: quotaForm.qpsLimit,
      dailyLimit: quotaForm.dailyLimit,
      remark: quotaForm.remark
    })
    ElMessage.success(lt('配额已更新', 'Quota updated'))
    lastOpenApiAction.value = `App 配额已更新: appId=${appId}, qps=${quotaForm.qpsLimit}, daily=${quotaForm.dailyLimit}，${formatNow()}`
    quotaDialogVisible.value = false
    await loadApps()
  } finally {
    actionLoading.value = false
  }
}

async function switchApp(row: AnyRecord, enabled: boolean) {
  const appId = row.id as Id | undefined
  if (!appId) return
  await ElMessageBox.confirm(`${lt('确认', 'Confirm')} ${enabled ? lt('启用', 'enabling') : lt('停用', 'disabling')} OpenAPI App ${appId}?`, 'OpenAPI App', { type: 'warning' })
  actionLoading.value = true
  try {
    if (enabled) await enableOpenApiApp(appId)
    else await disableOpenApiApp(appId)
    ElMessage.success(lt('状态已更新', 'Status updated'))
    lastOpenApiAction.value = `App 状态已更新: appId=${appId} -> ${enabled ? 'ACTIVE' : 'DISABLED'}，${formatNow()}`
    await loadApps()
  } finally {
    actionLoading.value = false
  }
}

async function publishDeliveries() {
  await ElMessageBox.confirm(`确认发布 Webhook 投递? 本次最多 ${deliveryQuery.limit} 条`, lt('Webhook 投递', 'Webhook Delivery'), { type: 'warning' })
  actionLoading.value = true
  try {
    const result = await publishWebhookDeliveries(Number(deliveryQuery.limit || 20))
    const count = result?.published ?? result?.count ?? result?.total ?? '-'
    ElMessage.success(lt('Webhook 投递发布完成', 'Webhook deliveries published'))
    lastOpenApiAction.value = `Webhook 投递发布完成: ${count} 条，${formatNow()}`
    await loadDeliveries()
    await loadSummary()
  } finally {
    actionLoading.value = false
  }
}

async function loadSummary() {
  const [statsRes, summaryRes] = await Promise.allSettled([
    getOpenApiOpsStats(7, { silentError: true }),
    getWebhookDeliverySummary({ silentError: true })
  ])
  stats.value = statsRes.status === 'fulfilled' ? statsRes.value : null
  webhookSummary.value = summaryRes.status === 'fulfilled' ? summaryRes.value : null
}

async function loadApps() {
  apps.value = await getOpenApiApps(compactParams(appQuery), { silentError: true }).catch(() => [])
}

async function loadAudits() {
  callAudits.value = await getOpenApiCallAudits(compactParams(auditQuery), { silentError: true }).catch(() => [])
}

async function loadDeliveries() {
  deliveries.value = await getWebhookDeliveries(compactParams(deliveryQuery), { silentError: true }).catch(() => [])
}

async function loadActiveTab() {
  if (activeTab.value === 'apps') await loadApps()
  if (activeTab.value === 'call-audits') await loadAudits()
  if (activeTab.value === 'webhooks') await loadDeliveries()
}

async function loadData() {
  loading.value = true
  try {
    await Promise.all([loadSummary(), loadActiveTab()])
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
          <div class="table-toolbar"><span>Apps</span><el-icon color="#409eff" :size="24"><Key /></el-icon></div>
          <div class="value">{{ valueOf(stats, 'apps.total') }}</div>
        </el-card>
      </el-col>
      <el-col :xs="24" :sm="12" :md="6">
        <el-card shadow="never" class="stat-card">
          <div class="table-toolbar"><span>Calls</span><el-icon color="#67c23a" :size="24"><Connection /></el-icon></div>
          <div class="value">{{ valueOf(stats, 'calls.total') }}</div>
        </el-card>
      </el-col>
      <el-col :xs="24" :sm="12" :md="6">
        <el-card shadow="never" class="stat-card">
          <div class="table-toolbar"><span>Webhook Pending</span><el-icon color="#e6a23c" :size="24"><Upload /></el-icon></div>
          <div class="value">{{ valueOf(webhookSummary, 'pending') }}</div>
        </el-card>
      </el-col>
      <el-col :xs="24" :sm="12" :md="6">
        <el-card shadow="never" class="stat-card">
          <div class="table-toolbar"><span>Webhook Dead</span><el-icon color="#f56c6c" :size="24"><Warning /></el-icon></div>
          <div class="value">{{ valueOf(webhookSummary, 'dead') }}</div>
        </el-card>
      </el-col>
    </el-row>

    <el-card shadow="never">
      <div class="table-toolbar">
        <span>{{ lt('OpenAPI 运营', 'OpenAPI Ops') }}</span>
        <el-button :icon="'Refresh'" @click="loadData">{{ lt('刷新', 'Refresh') }}</el-button>
      </div>
      <el-alert v-if="lastOpenApiAction" :title="lastOpenApiAction" type="success" show-icon :closable="false" class="operation-alert" />
      <el-tabs v-model="activeTab">
        <el-tab-pane :label="lt('应用', 'Apps')" name="apps">
          <el-form :inline="true" :model="appQuery" class="filter-form">
            <el-form-item :label="lt('状态', 'Status')">
              <el-select v-model="appQuery.status" clearable style="width: 130px">
                <el-option v-for="status in enumOptions(appStatusOptions)" :key="status.value" :label="status.label" :value="status.value" />
              </el-select>
            </el-form-item>
            <el-form-item label="AppKey"><el-input v-model="appQuery.appKey" clearable /></el-form-item>
            <el-form-item label="Owner"><el-input v-model="appQuery.ownerUserId" clearable /></el-form-item>
            <el-form-item :label="lt('条数', 'Limit')"><el-input-number v-model="appQuery.limit" :min="1" :max="200" /></el-form-item>
            <el-form-item><el-button type="primary" @click="loadData">{{ lt('查询', 'Search') }}</el-button></el-form-item>
          </el-form>
          <el-table v-loading="loading" :data="apps" border>
            <el-table-column prop="id" label="ID" width="90" />
            <el-table-column prop="appKey" label="AppKey" min-width="180" />
            <el-table-column prop="ownerUserId" label="Owner" width="110" />
            <el-table-column prop="status" :label="lt('状态', 'Status')" width="110" :formatter="enumTableFormatter" />
            <el-table-column prop="qpsLimit" label="QPS" width="90" />
            <el-table-column prop="dailyLimit" label="Daily" width="110" />
            <el-table-column prop="createdAt" :label="lt('创建时间', 'Created At')" min-width="170" :formatter="formatTableDateTime" />
            <el-table-column :label="lt('操作', 'Actions')" width="240" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" @click="showDetail(row)">{{ lt('详情', 'Details') }}</el-button>
                <el-button link type="success" :disabled="row.status === 'ACTIVE' || actionLoading" @click="switchApp(row, true)">{{ lt('启用', 'Enabled') }}</el-button>
                <el-button link type="danger" :disabled="row.status === 'DISABLED' || actionLoading" @click="switchApp(row, false)">{{ lt('停用', 'Disabled') }}</el-button>
                <el-button link type="warning" @click="openQuota(row)">{{ lt('配额', 'Quota') }}</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>

        <el-tab-pane :label="lt('调用审计', 'Call Audit')" name="call-audits">
          <el-form :inline="true" :model="auditQuery" class="filter-form">
            <el-form-item label="AppID"><el-input v-model="auditQuery.appId" clearable /></el-form-item>
            <el-form-item label="AppKey"><el-input v-model="auditQuery.appKey" clearable /></el-form-item>
            <el-form-item label="API Path"><el-input v-model="auditQuery.apiPath" clearable /></el-form-item>
            <el-form-item :label="lt('状态码', 'Status Code')"><el-input v-model="auditQuery.responseCode" clearable /></el-form-item>
            <el-form-item :label="lt('条数', 'Limit')"><el-input-number v-model="auditQuery.limit" :min="1" :max="200" /></el-form-item>
            <el-form-item><el-button type="primary" @click="loadData">{{ lt('查询', 'Search') }}</el-button></el-form-item>
          </el-form>
          <el-table v-loading="loading" :data="callAudits" border>
            <el-table-column prop="appId" label="AppID" width="90" />
            <el-table-column prop="appKey" label="AppKey" min-width="180" />
            <el-table-column prop="apiPath" label="API Path" min-width="220" />
            <el-table-column prop="responseCode" :label="lt('状态码', 'Status Code')" width="100" />
            <el-table-column prop="costMs" :label="lt('耗时 ms', 'Cost ms')" width="100" />
            <el-table-column prop="createdAt" :label="lt('创建时间', 'Created At')" min-width="170" :formatter="formatTableDateTime" />
            <el-table-column :label="lt('操作', 'Actions')" width="90" fixed="right">
              <template #default="{ row }"><el-button link type="primary" @click="showDetail(row)">{{ lt('详情', 'Details') }}</el-button></template>
            </el-table-column>
          </el-table>
        </el-tab-pane>

        <el-tab-pane :label="lt('Webhook', 'Webhook')" name="webhooks">
          <div class="table-toolbar">
            <span>{{ lt('Webhook 投递', 'Webhook Deliveries') }}</span>
            <el-button type="primary" :loading="actionLoading" @click="publishDeliveries">{{ lt('发布投递', 'Publish Deliveries') }}</el-button>
          </div>
          <el-form :inline="true" :model="deliveryQuery" class="filter-form">
            <el-form-item :label="lt('状态', 'Status')">
              <el-select v-model="deliveryQuery.status" clearable style="width: 130px">
                <el-option v-for="status in enumOptions(deliveryStatusOptions)" :key="status.value" :label="status.label" :value="status.value" />
              </el-select>
            </el-form-item>
            <el-form-item label="AppID"><el-input v-model="deliveryQuery.appId" clearable /></el-form-item>
            <el-form-item :label="lt('事件', 'Event')"><el-input v-model="deliveryQuery.eventType" clearable /></el-form-item>
            <el-form-item :label="lt('条数', 'Limit')"><el-input-number v-model="deliveryQuery.limit" :min="1" :max="200" /></el-form-item>
            <el-form-item><el-button type="primary" @click="loadData">{{ lt('查询', 'Search') }}</el-button></el-form-item>
          </el-form>
          <el-table v-loading="loading" :data="deliveries" border>
            <el-table-column prop="deliveryNo" :label="lt('投递号', 'Delivery No.')" min-width="170" />
            <el-table-column prop="appId" label="AppID" width="90" />
            <el-table-column prop="eventType" :label="lt('事件', 'Event')" width="150" />
            <el-table-column prop="status" :label="lt('状态', 'Status')" width="110" :formatter="enumTableFormatter" />
            <el-table-column prop="attempts" :label="lt('尝试', 'Attempts')" width="90" />
            <el-table-column prop="nextRetryAt" :label="lt('下次重试', 'Next Retry')" min-width="170" :formatter="formatTableDateTime" />
            <el-table-column prop="lastError" :label="lt('错误', 'Error')" min-width="220" />
            <el-table-column :label="lt('操作', 'Actions')" width="90" fixed="right">
              <template #default="{ row }"><el-button link type="primary" @click="showDetail(row)">{{ lt('详情', 'Details') }}</el-button></template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
      </el-tabs>
    </el-card>

    <el-dialog v-model="quotaDialogVisible" :title="lt('调整 App 配额', 'Adjust App Quota')" width="560px">
      <el-form ref="quotaFormRef" :model="quotaForm" :rules="quotaRules" label-width="110px">
        <el-form-item label="AppID" prop="appId"><el-input v-model="quotaForm.appId" disabled /></el-form-item>
        <el-form-item label="QPS" prop="qpsLimit"><el-input-number v-model="quotaForm.qpsLimit" :min="1" :max="1000" style="width: 100%" /></el-form-item>
        <el-form-item label="Daily" prop="dailyLimit"><el-input-number v-model="quotaForm.dailyLimit" :min="1" :max="10000000" style="width: 100%" /></el-form-item>
        <el-form-item :label="lt('说明', 'Remark')" prop="remark"><el-input v-model="quotaForm.remark" type="textarea" :rows="3" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="quotaDialogVisible = false">{{ lt('取消', 'Cancel') }}</el-button>
        <el-button type="primary" :loading="actionLoading" @click="saveQuota">{{ lt('保存', 'Save') }}</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="detailVisible" :title="lt('详情', 'Details')" width="760px">
      <ObjectDetails :data="detailRecord" />
    </el-dialog>
  </div>
</template>

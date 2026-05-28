<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
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

const appQuery = reactive({ status: '', appKey: '', ownerUserId: '', limit: 20 })
const auditQuery = reactive({ appId: '', appKey: '', apiPath: '', responseCode: '', limit: 20 })
const deliveryQuery = reactive({ status: '', appId: '', eventType: '', limit: 20 })

const quotaDialogVisible = ref(false)
const quotaForm = reactive({
  appId: undefined as Id | undefined,
  qpsLimit: 10,
  dailyLimit: 10000,
  remark: ''
})

function valueOf(record: AnyRecord | null, key: string) {
  const value = record?.[key]
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
  if (!quotaForm.appId || !quotaForm.remark) {
    ElMessage.warning('请填写 appId 和调整说明')
    return
  }
  actionLoading.value = true
  try {
    await updateOpenApiAppQuotas(quotaForm.appId, {
      qpsLimit: quotaForm.qpsLimit,
      dailyLimit: quotaForm.dailyLimit,
      remark: quotaForm.remark
    })
    ElMessage.success('配额已更新')
    quotaDialogVisible.value = false
    await loadApps()
  } finally {
    actionLoading.value = false
  }
}

async function switchApp(row: AnyRecord, enabled: boolean) {
  const appId = row.id as Id | undefined
  if (!appId) return
  await ElMessageBox.confirm(`确认${enabled ? '启用' : '停用'} OpenAPI App ${appId}?`, 'OpenAPI App', { type: 'warning' })
  actionLoading.value = true
  try {
    if (enabled) await enableOpenApiApp(appId)
    else await disableOpenApiApp(appId)
    ElMessage.success('状态已更新')
    await loadApps()
  } finally {
    actionLoading.value = false
  }
}

async function publishDeliveries() {
  await ElMessageBox.confirm(`确认发布 Webhook 投递? 本次最多 ${deliveryQuery.limit} 条`, 'Webhook 投递', { type: 'warning' })
  actionLoading.value = true
  try {
    const result = await publishWebhookDeliveries(Number(deliveryQuery.limit || 20))
    ElMessage.success(`发布完成: ${JSON.stringify(result)}`)
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
          <div class="value">{{ valueOf(stats, 'apps') }}</div>
        </el-card>
      </el-col>
      <el-col :xs="24" :sm="12" :md="6">
        <el-card shadow="never" class="stat-card">
          <div class="table-toolbar"><span>Calls</span><el-icon color="#67c23a" :size="24"><Connection /></el-icon></div>
          <div class="value">{{ valueOf(stats, 'calls') }}</div>
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
        <span>OpenAPI 运营</span>
        <el-button :icon="'Refresh'" @click="loadData">刷新</el-button>
      </div>
      <el-tabs v-model="activeTab">
        <el-tab-pane label="应用" name="apps">
          <el-form :inline="true" :model="appQuery" class="filter-form">
            <el-form-item label="状态"><el-input v-model="appQuery.status" clearable /></el-form-item>
            <el-form-item label="AppKey"><el-input v-model="appQuery.appKey" clearable /></el-form-item>
            <el-form-item label="Owner"><el-input v-model="appQuery.ownerUserId" clearable /></el-form-item>
            <el-form-item label="条数"><el-input-number v-model="appQuery.limit" :min="1" :max="200" /></el-form-item>
            <el-form-item><el-button type="primary" @click="loadData">查询</el-button></el-form-item>
          </el-form>
          <el-table v-loading="loading" :data="apps" border>
            <el-table-column prop="id" label="ID" width="90" />
            <el-table-column prop="appKey" label="AppKey" min-width="180" />
            <el-table-column prop="ownerUserId" label="Owner" width="110" />
            <el-table-column prop="status" label="状态" width="110" />
            <el-table-column prop="qpsLimit" label="QPS" width="90" />
            <el-table-column prop="dailyLimit" label="Daily" width="110" />
            <el-table-column prop="createdAt" label="创建时间" min-width="170" />
            <el-table-column label="操作" width="240" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" @click="showDetail(row)">详情</el-button>
                <el-button link type="success" @click="switchApp(row, true)">启用</el-button>
                <el-button link type="danger" @click="switchApp(row, false)">停用</el-button>
                <el-button link type="warning" @click="openQuota(row)">配额</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>

        <el-tab-pane label="调用审计" name="call-audits">
          <el-form :inline="true" :model="auditQuery" class="filter-form">
            <el-form-item label="AppID"><el-input v-model="auditQuery.appId" clearable /></el-form-item>
            <el-form-item label="AppKey"><el-input v-model="auditQuery.appKey" clearable /></el-form-item>
            <el-form-item label="API Path"><el-input v-model="auditQuery.apiPath" clearable /></el-form-item>
            <el-form-item label="状态码"><el-input v-model="auditQuery.responseCode" clearable /></el-form-item>
            <el-form-item label="条数"><el-input-number v-model="auditQuery.limit" :min="1" :max="200" /></el-form-item>
            <el-form-item><el-button type="primary" @click="loadData">查询</el-button></el-form-item>
          </el-form>
          <el-table v-loading="loading" :data="callAudits" border>
            <el-table-column prop="appId" label="AppID" width="90" />
            <el-table-column prop="appKey" label="AppKey" min-width="180" />
            <el-table-column prop="apiPath" label="API Path" min-width="220" />
            <el-table-column prop="responseCode" label="状态码" width="100" />
            <el-table-column prop="latencyMs" label="耗时 ms" width="100" />
            <el-table-column prop="createdAt" label="创建时间" min-width="170" />
            <el-table-column label="操作" width="90" fixed="right">
              <template #default="{ row }"><el-button link type="primary" @click="showDetail(row)">详情</el-button></template>
            </el-table-column>
          </el-table>
        </el-tab-pane>

        <el-tab-pane label="Webhook" name="webhooks">
          <div class="table-toolbar">
            <span>Webhook 投递</span>
            <el-button type="primary" :loading="actionLoading" @click="publishDeliveries">发布投递</el-button>
          </div>
          <el-form :inline="true" :model="deliveryQuery" class="filter-form">
            <el-form-item label="状态"><el-input v-model="deliveryQuery.status" clearable /></el-form-item>
            <el-form-item label="AppID"><el-input v-model="deliveryQuery.appId" clearable /></el-form-item>
            <el-form-item label="事件"><el-input v-model="deliveryQuery.eventType" clearable /></el-form-item>
            <el-form-item label="条数"><el-input-number v-model="deliveryQuery.limit" :min="1" :max="200" /></el-form-item>
            <el-form-item><el-button type="primary" @click="loadData">查询</el-button></el-form-item>
          </el-form>
          <el-table v-loading="loading" :data="deliveries" border>
            <el-table-column prop="deliveryNo" label="投递号" min-width="170" />
            <el-table-column prop="appId" label="AppID" width="90" />
            <el-table-column prop="eventType" label="事件" width="150" />
            <el-table-column prop="status" label="状态" width="110" />
            <el-table-column prop="attempts" label="尝试" width="90" />
            <el-table-column prop="nextRetryAt" label="下次重试" min-width="170" />
            <el-table-column prop="lastError" label="错误" min-width="220" />
            <el-table-column label="操作" width="90" fixed="right">
              <template #default="{ row }"><el-button link type="primary" @click="showDetail(row)">详情</el-button></template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
      </el-tabs>
    </el-card>

    <el-dialog v-model="quotaDialogVisible" title="调整 App 配额" width="560px">
      <el-form :model="quotaForm" label-width="110px">
        <el-form-item label="AppID"><el-input v-model="quotaForm.appId" disabled /></el-form-item>
        <el-form-item label="QPS"><el-input-number v-model="quotaForm.qpsLimit" :min="1" :max="1000" style="width: 100%" /></el-form-item>
        <el-form-item label="Daily"><el-input-number v-model="quotaForm.dailyLimit" :min="1" :max="10000000" style="width: 100%" /></el-form-item>
        <el-form-item label="说明"><el-input v-model="quotaForm.remark" type="textarea" :rows="3" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="quotaDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="actionLoading" @click="saveQuota">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="detailVisible" title="详情" width="760px">
      <pre class="json-preview">{{ JSON.stringify(detailRecord, null, 2) }}</pre>
    </el-dialog>
  </div>
</template>

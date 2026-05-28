<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue'
import {
  getAuditLogs,
  getAuditStatsActions,
  getAuditStatsServices,
  getAuditStatsSummary,
  getAuditStatsUsers,
  getAuditTrace
} from '@/apis/operation'
import type { AnyRecord } from '@/types/common'

const props = withDefaults(defineProps<{ defaultTab?: string }>(), { defaultTab: 'logs' })

const activeTab = ref(props.defaultTab)
const loading = ref(false)
const logs = ref<AnyRecord[]>([])
const summary = ref<AnyRecord | null>(null)
const actions = ref<AnyRecord[]>([])
const services = ref<AnyRecord[]>([])
const users = ref<AnyRecord[]>([])
const detailVisible = ref(false)
const detailRecord = ref<AnyRecord | null>(null)

const logQuery = reactive({
  traceId: '',
  serviceName: '',
  action: '',
  resourceType: '',
  resourceId: '',
  bizNo: '',
  userId: '',
  actorId: '',
  result: '',
  riskLevel: '',
  limit: 20
})
const statsQuery = reactive({ days: 7, serviceName: '', action: '', riskLevel: '', result: '', userId: '', actorId: '', limit: 10 })

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

async function loadLogs() {
  if (logQuery.traceId && Object.values({ ...logQuery, traceId: '' }).every((value) => value === '' || value === 20)) {
    logs.value = await getAuditTrace(logQuery.traceId, { silentError: true }).catch(() => [])
    return
  }
  logs.value = await getAuditLogs(compactParams(logQuery), { silentError: true }).catch(() => [])
}

async function loadStats() {
  const params = compactParams(statsQuery)
  const [summaryRes, actionRes, serviceRes, userRes] = await Promise.allSettled([
    getAuditStatsSummary(params, { silentError: true }),
    getAuditStatsActions(params, { silentError: true }),
    getAuditStatsServices(params, { silentError: true }),
    getAuditStatsUsers(params, { silentError: true })
  ])
  summary.value = summaryRes.status === 'fulfilled' ? summaryRes.value : null
  actions.value = actionRes.status === 'fulfilled' ? actionRes.value : []
  services.value = serviceRes.status === 'fulfilled' ? serviceRes.value : []
  users.value = userRes.status === 'fulfilled' ? userRes.value : []
}

async function loadData() {
  loading.value = true
  try {
    if (activeTab.value === 'logs') await loadLogs()
    if (activeTab.value === 'stats') await loadStats()
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
    <el-card shadow="never">
      <div class="table-toolbar">
        <span>审计日志</span>
        <el-button :icon="'Refresh'" @click="loadData">刷新</el-button>
      </div>

      <el-tabs v-model="activeTab">
        <el-tab-pane label="日志查询" name="logs">
          <el-form :inline="true" :model="logQuery" class="filter-form">
            <el-form-item label="Trace"><el-input v-model="logQuery.traceId" clearable /></el-form-item>
            <el-form-item label="服务"><el-input v-model="logQuery.serviceName" clearable /></el-form-item>
            <el-form-item label="Action"><el-input v-model="logQuery.action" clearable /></el-form-item>
            <el-form-item label="业务号"><el-input v-model="logQuery.bizNo" clearable /></el-form-item>
            <el-form-item label="用户ID"><el-input v-model="logQuery.userId" clearable /></el-form-item>
            <el-form-item label="风险"><el-input v-model="logQuery.riskLevel" clearable /></el-form-item>
            <el-form-item label="条数"><el-input-number v-model="logQuery.limit" :min="1" :max="200" /></el-form-item>
            <el-form-item><el-button type="primary" @click="loadData">查询</el-button></el-form-item>
          </el-form>
          <el-table v-loading="loading" :data="logs" border>
            <el-table-column prop="traceId" label="Trace" min-width="180" />
            <el-table-column prop="serviceName" label="服务" min-width="160" />
            <el-table-column prop="action" label="Action" min-width="180" />
            <el-table-column prop="resourceType" label="资源" width="130" />
            <el-table-column prop="bizNo" label="业务号" min-width="170" />
            <el-table-column prop="userId" label="用户ID" width="100" />
            <el-table-column prop="actorId" label="操作者" width="100" />
            <el-table-column prop="result" label="结果" width="100" />
            <el-table-column prop="riskLevel" label="风险" width="100" />
            <el-table-column prop="createdAt" label="时间" min-width="170" />
            <el-table-column label="操作" width="90" fixed="right">
              <template #default="{ row }"><el-button link type="primary" @click="showDetail(row)">详情</el-button></template>
            </el-table-column>
          </el-table>
        </el-tab-pane>

        <el-tab-pane label="统计" name="stats">
          <el-form :inline="true" :model="statsQuery" class="filter-form">
            <el-form-item label="天数"><el-input-number v-model="statsQuery.days" :min="1" :max="90" /></el-form-item>
            <el-form-item label="服务"><el-input v-model="statsQuery.serviceName" clearable /></el-form-item>
            <el-form-item label="Action"><el-input v-model="statsQuery.action" clearable /></el-form-item>
            <el-form-item label="风险"><el-input v-model="statsQuery.riskLevel" clearable /></el-form-item>
            <el-form-item label="结果"><el-input v-model="statsQuery.result" clearable /></el-form-item>
            <el-form-item label="Top"><el-input-number v-model="statsQuery.limit" :min="1" :max="50" /></el-form-item>
            <el-form-item><el-button type="primary" @click="loadData">查询</el-button></el-form-item>
          </el-form>
          <el-row :gutter="16" class="app-card">
            <el-col :xs="24" :sm="12" :md="6">
              <el-card shadow="never" class="stat-card">
                <div class="table-toolbar"><span>总量</span><el-icon color="#409eff" :size="24"><DataLine /></el-icon></div>
                <div class="value">{{ valueOf(summary, 'total') }}</div>
              </el-card>
            </el-col>
            <el-col :xs="24" :sm="12" :md="6">
              <el-card shadow="never" class="stat-card">
                <div class="table-toolbar"><span>成功</span><el-icon color="#67c23a" :size="24"><CircleCheck /></el-icon></div>
                <div class="value">{{ valueOf(summary, 'success') }}</div>
              </el-card>
            </el-col>
            <el-col :xs="24" :sm="12" :md="6">
              <el-card shadow="never" class="stat-card">
                <div class="table-toolbar"><span>失败</span><el-icon color="#f56c6c" :size="24"><CircleClose /></el-icon></div>
                <div class="value">{{ valueOf(summary, 'failed') }}</div>
              </el-card>
            </el-col>
            <el-col :xs="24" :sm="12" :md="6">
              <el-card shadow="never" class="stat-card">
                <div class="table-toolbar"><span>高风险</span><el-icon color="#e6a23c" :size="24"><Warning /></el-icon></div>
                <div class="value">{{ valueOf(summary, 'highRisk') }}</div>
              </el-card>
            </el-col>
          </el-row>
          <el-row :gutter="16">
            <el-col :xs="24" :md="8">
              <el-table v-loading="loading" :data="actions" border>
                <el-table-column prop="name" label="Action" />
                <el-table-column prop="count" label="次数" width="100" />
              </el-table>
            </el-col>
            <el-col :xs="24" :md="8">
              <el-table v-loading="loading" :data="services" border>
                <el-table-column prop="name" label="服务" />
                <el-table-column prop="count" label="次数" width="100" />
              </el-table>
            </el-col>
            <el-col :xs="24" :md="8">
              <el-table v-loading="loading" :data="users" border>
                <el-table-column prop="name" label="用户" />
                <el-table-column prop="count" label="次数" width="100" />
              </el-table>
            </el-col>
          </el-row>
        </el-tab-pane>
      </el-tabs>
    </el-card>

    <el-dialog v-model="detailVisible" title="详情" width="760px">
      <pre class="json-preview">{{ JSON.stringify(detailRecord, null, 2) }}</pre>
    </el-dialog>
  </div>
</template>

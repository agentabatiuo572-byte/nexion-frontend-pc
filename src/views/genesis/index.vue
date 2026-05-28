<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import {
  createGenesisSeries,
  getFeatureConfig,
  getGenesisHoldings,
  getGenesisOrders,
  getGenesisOverview,
  getGenesisSeries,
  updateGenesisSeries,
  type GenesisSeries
} from '@/apis/operation'
import type { AnyRecord, Id } from '@/types/common'

const props = withDefaults(defineProps<{ defaultTab?: string }>(), { defaultTab: 'series' })

const activeTab = ref(props.defaultTab)
const loading = ref(false)
const overview = ref<AnyRecord | null>(null)
const features = ref<AnyRecord>({})
const series = ref<GenesisSeries[]>([])
const seriesTotal = ref(0)
const orders = ref<AnyRecord[]>([])
const orderTotal = ref(0)
const holdings = ref<AnyRecord[]>([])
const holdingTotal = ref(0)
const detailVisible = ref(false)
const detailRecord = ref<AnyRecord | null>(null)

const seriesQuery = reactive({ current: 1, size: 10, status: '' })
const orderQuery = reactive({ current: 1, size: 10, userId: '', status: '' })
const holdingQuery = reactive({ current: 1, size: 10, userId: '', seriesCode: '' })

const seriesDialogVisible = ref(false)
const seriesSaving = ref(false)
const seriesFormRef = ref<FormInstance>()
const lastSeriesAction = ref('')
const seriesStatusOptions = ['ACTIVE', 'INACTIVE', 'SOLD_OUT', 'ARCHIVED']
const seriesForm = reactive({
  id: undefined as Id | undefined,
  seriesCode: '',
  name: '',
  totalSupply: 1,
  priceUsdt: 0,
  status: 'INACTIVE',
  saleStartAt: '',
  saleEndAt: '',
  royaltyBps: 0,
  coverUrl: '',
  metadataJson: ''
})
const seriesRules: FormRules = {
  seriesCode: [{ required: true, message: '请填写系列编码', trigger: 'blur' }],
  name: [{ required: true, message: '请填写系列名称', trigger: 'blur' }],
  totalSupply: [{ required: true, message: '请填写发行总量', trigger: 'blur' }],
  priceUsdt: [{ required: true, message: '请填写发行价格', trigger: 'blur' }],
  status: [{ required: true, message: '请选择状态', trigger: 'change' }]
}

function pageIndex(query: { current: number; size: number }, index: number) {
  return (query.current - 1) * query.size + index + 1
}

function valueOf(record: AnyRecord | null, key: string) {
  const value = record?.[key]
  return value == null || value === '' ? '-' : String(value)
}

function showDetail(row: AnyRecord) {
  detailRecord.value = row
  detailVisible.value = true
}

function resetSeriesForm() {
  Object.assign(seriesForm, {
    id: undefined,
    seriesCode: '',
    name: '',
    totalSupply: 1,
    priceUsdt: 0,
    status: 'INACTIVE',
    saleStartAt: '',
    saleEndAt: '',
    royaltyBps: 0,
    coverUrl: '',
    metadataJson: ''
  })
}

function openSeriesDialog(row?: GenesisSeries) {
  resetSeriesForm()
  if (row) {
    Object.assign(seriesForm, {
      id: row.id,
      seriesCode: row.seriesCode || '',
      name: row.name || '',
      totalSupply: Number(row.totalSupply ?? 1),
      priceUsdt: Number(row.priceUsdt ?? 0),
      status: row.status || 'ACTIVE',
      saleStartAt: row.saleStartAt || '',
      saleEndAt: row.saleEndAt || '',
      royaltyBps: Number(row.royaltyBps ?? 0),
      coverUrl: row.coverUrl || '',
      metadataJson: row.metadataJson || ''
    })
  }
  seriesDialogVisible.value = true
}

async function validateSeriesForm() {
  try {
    await seriesFormRef.value?.validate()
    return true
  } catch {
    return false
  }
}

async function saveSeries() {
  if (!(await validateSeriesForm())) {
    return
  }
  if (Number(seriesForm.totalSupply) < 1) {
    ElMessage.warning('发行总量必须大于 0')
    return
  }
  if (Number(seriesForm.priceUsdt) <= 0) {
    ElMessage.warning('发行价格必须大于 0')
    return
  }
  if (seriesForm.metadataJson) {
    try {
      JSON.parse(seriesForm.metadataJson)
    } catch {
      ElMessage.warning('元数据 JSON 格式不合法')
      return
    }
  }
  seriesSaving.value = true
  try {
    const payload = {
      seriesCode: seriesForm.seriesCode,
      name: seriesForm.name,
      totalSupply: seriesForm.totalSupply,
      priceUsdt: seriesForm.priceUsdt,
      status: seriesForm.status,
      saleStartAt: seriesForm.saleStartAt || undefined,
      saleEndAt: seriesForm.saleEndAt || undefined,
      royaltyBps: seriesForm.royaltyBps,
      coverUrl: seriesForm.coverUrl,
      metadataJson: seriesForm.metadataJson
    }
    if (seriesForm.id) {
      const { seriesCode: _seriesCode, ...updatePayload } = payload
      await updateGenesisSeries(seriesForm.id, updatePayload)
      ElMessage.success('Genesis 系列已更新')
      lastSeriesAction.value = `已更新系列 ${seriesForm.seriesCode}，状态 ${seriesForm.status}，${new Date().toLocaleString()}`
    } else {
      await createGenesisSeries(payload)
      ElMessage.success('Genesis 系列已创建')
      lastSeriesAction.value = `已创建系列 ${seriesForm.seriesCode}，默认状态 ${seriesForm.status}，${new Date().toLocaleString()}`
    }
    seriesDialogVisible.value = false
    await loadSeries()
    await loadOverview()
  } finally {
    seriesSaving.value = false
  }
}

async function changeSeriesStatus(row: GenesisSeries, status: string) {
  if (!row.id) return
  await ElMessageBox.confirm(`确认将 Genesis 系列 ${row.seriesCode} 状态改为 ${status}?`, 'Genesis 系列状态变更', { type: 'warning' })
  seriesSaving.value = true
  try {
    await updateGenesisSeries(row.id, { status })
    ElMessage.success('Genesis 系列状态已更新')
    lastSeriesAction.value = `已将系列 ${row.seriesCode} 状态改为 ${status}，${new Date().toLocaleString()}`
    await loadSeries()
    await loadOverview()
  } finally {
    seriesSaving.value = false
  }
}

async function loadOverview() {
  const [overviewRes, featureRes] = await Promise.allSettled([
    getGenesisOverview(undefined, { silentError: true }),
    getFeatureConfig({ silentError: true })
  ])
  overview.value = overviewRes.status === 'fulfilled' ? overviewRes.value : null
  features.value = featureRes.status === 'fulfilled' ? featureRes.value : {}
}

async function loadSeries() {
  const page = await getGenesisSeries(seriesQuery)
  series.value = page.records
  seriesTotal.value = page.total
}

async function loadOrders() {
  const page = await getGenesisOrders(orderQuery)
  orders.value = page.records
  orderTotal.value = page.total
}

async function loadHoldings() {
  const page = await getGenesisHoldings(holdingQuery)
  holdings.value = page.records
  holdingTotal.value = page.total
}

async function loadActiveTab() {
  if (activeTab.value === 'series') await loadSeries()
  if (activeTab.value === 'orders') await loadOrders()
  if (activeTab.value === 'holdings') await loadHoldings()
}

async function loadData() {
  loading.value = true
  try {
    await Promise.all([loadOverview(), loadActiveTab()])
  } finally {
    loading.value = false
  }
}

function resetOrders() {
  Object.assign(orderQuery, { current: 1, userId: '', status: '' })
  loadData()
}

function resetHoldings() {
  Object.assign(holdingQuery, { current: 1, userId: '', seriesCode: '' })
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
          <div class="table-toolbar"><span>购买开关</span><el-icon color="#409eff" :size="24"><Switch /></el-icon></div>
          <div class="value">{{ features.genesisEnabled ?? features['genesis.enabled'] ?? '-' }}</div>
        </el-card>
      </el-col>
      <el-col :xs="24" :sm="12" :md="6">
        <el-card shadow="never" class="stat-card">
          <div class="table-toolbar"><span>系列</span><el-icon color="#67c23a" :size="24"><Collection /></el-icon></div>
          <div class="value">{{ seriesTotal }}</div>
        </el-card>
      </el-col>
      <el-col :xs="24" :sm="12" :md="6">
        <el-card shadow="never" class="stat-card">
          <div class="table-toolbar"><span>当前价格</span><el-icon color="#e6a23c" :size="24"><Money /></el-icon></div>
          <div class="value">{{ valueOf(overview, 'priceUsdt') }}</div>
        </el-card>
      </el-col>
      <el-col :xs="24" :sm="12" :md="6">
        <el-card shadow="never" class="stat-card">
          <div class="table-toolbar"><span>用户持仓</span><el-icon color="#f56c6c" :size="24"><Star /></el-icon></div>
          <div class="value">{{ valueOf(overview, 'holdingCount') }}</div>
        </el-card>
      </el-col>
    </el-row>

    <el-card shadow="never">
      <div class="table-toolbar">
        <span>Genesis 运营</span>
        <el-button :icon="'Refresh'" @click="loadData">刷新</el-button>
      </div>

      <el-tabs v-model="activeTab">
        <el-tab-pane label="系列配置" name="series">
          <div class="table-toolbar">
            <span>Genesis 发行系列</span>
            <el-button type="primary" :icon="'Plus'" @click="openSeriesDialog()">新增系列</el-button>
          </div>
          <el-form :inline="true" :model="seriesQuery" class="filter-form">
            <el-form-item label="状态">
              <el-select v-model="seriesQuery.status" clearable style="width: 150px">
                <el-option v-for="status in seriesStatusOptions" :key="status" :label="status" :value="status" />
              </el-select>
            </el-form-item>
            <el-form-item><el-button type="primary" @click="seriesQuery.current = 1; loadData()">查询</el-button></el-form-item>
          </el-form>
          <el-alert v-if="lastSeriesAction" :title="lastSeriesAction" type="success" show-icon :closable="false" class="operation-alert" />
          <el-table v-loading="loading" :data="series" border>
            <el-table-column type="index" :index="(index: number) => pageIndex(seriesQuery, index)" label="编号" width="80" />
            <el-table-column prop="seriesCode" label="系列编码" min-width="150" />
            <el-table-column prop="name" label="名称" min-width="160" />
            <el-table-column prop="priceUsdt" label="价格 USDT" width="130" />
            <el-table-column prop="totalSupply" label="总量" width="100" />
            <el-table-column prop="soldSupply" label="已售" width="100" />
            <el-table-column prop="royaltyBps" label="版税 BPS" width="120" />
            <el-table-column label="状态" width="120">
              <template #default="{ row }"><el-tag :type="row.status === 'ACTIVE' ? 'success' : 'info'">{{ row.status }}</el-tag></template>
            </el-table-column>
            <el-table-column prop="saleStartAt" label="开始时间" min-width="170" />
            <el-table-column prop="saleEndAt" label="结束时间" min-width="170" />
            <el-table-column label="操作" width="190" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" @click="openSeriesDialog(row)">编辑</el-button>
                <el-button v-if="row.status !== 'ACTIVE'" link type="success" :disabled="seriesSaving" @click="changeSeriesStatus(row, 'ACTIVE')">启用</el-button>
                <el-button v-else link type="warning" :disabled="seriesSaving" @click="changeSeriesStatus(row, 'INACTIVE')">停用</el-button>
              </template>
            </el-table-column>
          </el-table>
          <div class="pagination-wrap">
            <el-pagination v-model:current-page="seriesQuery.current" v-model:page-size="seriesQuery.size" layout="total, sizes, prev, pager, next" :total="seriesTotal" @current-change="loadData" @size-change="loadData" />
          </div>
        </el-tab-pane>

        <el-tab-pane label="订单" name="orders">
          <el-form :inline="true" :model="orderQuery" class="filter-form">
            <el-form-item label="用户ID"><el-input v-model="orderQuery.userId" clearable /></el-form-item>
            <el-form-item label="状态"><el-input v-model="orderQuery.status" clearable /></el-form-item>
            <el-form-item>
              <el-button type="primary" @click="orderQuery.current = 1; loadData()">查询</el-button>
              <el-button @click="resetOrders">重置</el-button>
            </el-form-item>
          </el-form>
          <el-table v-loading="loading" :data="orders" border>
            <el-table-column type="index" :index="(index: number) => pageIndex(orderQuery, index)" label="编号" width="80" />
            <el-table-column prop="orderNo" label="订单号" min-width="170" />
            <el-table-column prop="userId" label="用户ID" width="100" />
            <el-table-column prop="seriesCode" label="系列" width="140" />
            <el-table-column prop="priceUsdt" label="价格 USDT" width="130" />
            <el-table-column prop="status" label="状态" width="110" />
            <el-table-column prop="clientRequestNo" label="幂等号" min-width="170" />
            <el-table-column prop="createdAt" label="创建时间" min-width="170" />
            <el-table-column label="操作" width="90" fixed="right">
              <template #default="{ row }"><el-button link type="primary" @click="showDetail(row)">详情</el-button></template>
            </el-table-column>
          </el-table>
          <div class="pagination-wrap">
            <el-pagination v-model:current-page="orderQuery.current" v-model:page-size="orderQuery.size" layout="total, sizes, prev, pager, next" :total="orderTotal" @current-change="loadData" @size-change="loadData" />
          </div>
        </el-tab-pane>

        <el-tab-pane label="持仓" name="holdings">
          <el-form :inline="true" :model="holdingQuery" class="filter-form">
            <el-form-item label="用户ID"><el-input v-model="holdingQuery.userId" clearable /></el-form-item>
            <el-form-item label="系列"><el-input v-model="holdingQuery.seriesCode" clearable /></el-form-item>
            <el-form-item>
              <el-button type="primary" @click="holdingQuery.current = 1; loadData()">查询</el-button>
              <el-button @click="resetHoldings">重置</el-button>
            </el-form-item>
          </el-form>
          <el-table v-loading="loading" :data="holdings" border>
            <el-table-column type="index" :index="(index: number) => pageIndex(holdingQuery, index)" label="编号" width="80" />
            <el-table-column prop="holdingNo" label="持仓号" min-width="170" />
            <el-table-column prop="userId" label="用户ID" width="100" />
            <el-table-column prop="seriesCode" label="系列" width="140" />
            <el-table-column prop="tokenNo" label="Token No" width="120" />
            <el-table-column prop="status" label="状态" width="110" />
            <el-table-column prop="sourceOrderNo" label="来源订单" min-width="170" />
            <el-table-column prop="createdAt" label="创建时间" min-width="170" />
            <el-table-column label="操作" width="90" fixed="right">
              <template #default="{ row }"><el-button link type="primary" @click="showDetail(row)">详情</el-button></template>
            </el-table-column>
          </el-table>
          <div class="pagination-wrap">
            <el-pagination v-model:current-page="holdingQuery.current" v-model:page-size="holdingQuery.size" layout="total, sizes, prev, pager, next" :total="holdingTotal" @current-change="loadData" @size-change="loadData" />
          </div>
        </el-tab-pane>
      </el-tabs>
    </el-card>

    <el-dialog v-model="seriesDialogVisible" :title="seriesForm.id ? '编辑 Genesis 系列' : '新增 Genesis 系列'" width="760px">
      <el-form ref="seriesFormRef" :model="seriesForm" :rules="seriesRules" label-width="118px">
        <el-row :gutter="16">
          <el-col :span="12"><el-form-item label="系列编码" prop="seriesCode"><el-input v-model="seriesForm.seriesCode" :disabled="!!seriesForm.id" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="名称" prop="name"><el-input v-model="seriesForm.name" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="总量" prop="totalSupply"><el-input-number v-model="seriesForm.totalSupply" :min="1" style="width: 100%" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="价格 USDT" prop="priceUsdt"><el-input-number v-model="seriesForm.priceUsdt" :min="0" :precision="6" style="width: 100%" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="版税 BPS"><el-input-number v-model="seriesForm.royaltyBps" :min="0" style="width: 100%" /></el-form-item></el-col>
          <el-col :span="12">
            <el-form-item label="状态" prop="status">
              <el-select v-model="seriesForm.status" style="width: 100%">
                <el-option v-for="status in seriesStatusOptions" :key="status" :label="status" :value="status" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12"><el-form-item label="开始时间"><el-date-picker v-model="seriesForm.saleStartAt" type="datetime" value-format="YYYY-MM-DDTHH:mm:ss" style="width: 100%" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="结束时间"><el-date-picker v-model="seriesForm.saleEndAt" type="datetime" value-format="YYYY-MM-DDTHH:mm:ss" style="width: 100%" /></el-form-item></el-col>
          <el-col :span="24"><el-form-item label="封面 URL"><el-input v-model="seriesForm.coverUrl" /></el-form-item></el-col>
          <el-col :span="24"><el-form-item label="元数据 JSON"><el-input v-model="seriesForm.metadataJson" type="textarea" :rows="4" /></el-form-item></el-col>
        </el-row>
      </el-form>
      <template #footer>
        <el-button @click="seriesDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="seriesSaving" @click="saveSeries">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="detailVisible" title="详情" width="760px">
      <pre class="json-preview">{{ JSON.stringify(detailRecord, null, 2) }}</pre>
    </el-dialog>
  </div>
</template>

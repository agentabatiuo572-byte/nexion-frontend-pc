<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import {
  createSystemConfig,
  createGenesisSeries,
  getFeatureConfig,
  getGenesisHoldings,
  getGenesisOrders,
  getGenesisOverview,
  getGenesisSeries,
  getSystemConfigs,
  updateGenesisSeries,
  updateSystemConfig,
  type ConfigItem,
  type GenesisSeries
} from '@/apis/operation'
import type { AnyRecord, Id } from '@/types/common'
import ObjectImageUpload from '@/components/ObjectImageUpload.vue'
import UserSelect from '@/components/UserSelect.vue'
import ObjectDetails from '@/components/ObjectDetails.vue'
import { formatNow, formatTableDateTime } from '@/utils/date'
import { localeText as lt, enumLabel, enumOptions, enumTableFormatter } from '@/utils/i18n'

const props = withDefaults(defineProps<{ defaultTab?: string }>(), { defaultTab: 'series' })
const activeTab = ref(props.defaultTab)
const loading = ref(false)
const overview = ref<AnyRecord | null>(null)
const features = ref<AnyRecord>({})
const genesisSwitchConfig = ref<ConfigItem | null>(null)
const genesisSwitchSaving = ref(false)
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
const genesisOrderStatusOptions = ['CREATED', 'PAID', 'COMPLETED', 'CANCELLED', 'FAILED']

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
  seriesCode: [{ required: true, message: lt('请填写系列编码', 'Please enter series code'), trigger: 'blur' }],
  name: [{ required: true, message: lt('请填写系列名称', 'Please enter series name'), trigger: 'blur' }],
  totalSupply: [{ required: true, message: lt('请填写发行总量', 'Please enter total supply'), trigger: 'blur' }],
  priceUsdt: [{ required: true, message: lt('请填写发行价格', 'Please enter issue price'), trigger: 'blur' }],
  status: [{ required: true, message: lt('请选择状态', 'Please select status'), trigger: 'change' }]
}

function pageIndex(query: { current: number; size: number }, index: number) {
  return (query.current - 1) * query.size + index + 1
}

function valueOf(record: AnyRecord | null, key: string) {
  const value = record?.[key]
  return value == null || value === '' ? '-' : String(value)
}

function overviewSeries() {
  return Array.isArray(overview.value?.series) ? overview.value.series as AnyRecord[] : []
}

function activeGenesisSeries() {
  return overviewSeries().filter((item) => item.status === 'ACTIVE')
}

function activeGenesisPriceLabel() {
  const prices = Array.from(new Set(activeGenesisSeries()
    .map((item) => Number(item.priceUsdt))
    .filter((price) => Number.isFinite(price))))
    .sort((left, right) => left - right)
  if (!prices.length) return '-'
  if (prices.length <= 3) return prices.map((price) => String(price)).join(' / ')
  const min = prices[0]
  const max = prices[prices.length - 1]
  return `${min} - ${max} (${prices.length} ${lt('档', 'tiers')})`
}

function activeGenesisSeriesCount() {
  return activeGenesisSeries().length
}

function soldGenesisSupply() {
  const total = overviewSeries().reduce((sum, item) => sum + Number(item.soldSupply ?? 0), 0)
  return Number.isFinite(total) ? total : '-'
}

function genesisPurchaseEnabled() {
  return features.value.genesisEnabled ?? features.value['genesis.enabled']
}

function toBoolean(value: unknown) {
  return value === true || String(value).toLowerCase() === 'true' || String(value) === '1'
}

function genesisPurchaseEnabledBool() {
  return toBoolean(genesisPurchaseEnabled())
}

function genesisPurchaseSwitchLabel() {
  const enabled = genesisPurchaseEnabled()
  if (enabled == null || enabled === '') return '-'
  return toBoolean(enabled) ? lt('已开启', 'Enabled') : lt('已关闭', 'Disabled')
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
    ElMessage.warning(lt('发行总量必须大于 0', 'Total supply must be greater than 0'))
    return
  }
  if (Number(seriesForm.priceUsdt) <= 0) {
    ElMessage.warning(lt('发行价格必须大于 0', 'Issue price must be greater than 0'))
    return
  }
  if (seriesForm.metadataJson) {
    try {
      JSON.parse(seriesForm.metadataJson)
    } catch {
      ElMessage.warning(lt('元数据 JSON 格式不合法', 'Metadata JSON is invalid'))
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
      ElMessage.success(lt('Genesis 系列已更新', 'Genesis series updated'))
      lastSeriesAction.value = `${lt('已更新系列', 'Updated series')} ${seriesForm.seriesCode}, ${lt('状态', 'status')} ${enumLabel(seriesForm.status)}, ${formatNow()}`
    } else {
      await createGenesisSeries(payload)
      ElMessage.success(lt('Genesis 系列已创建', 'Genesis series created'))
      lastSeriesAction.value = `${lt('已创建系列', 'Created series')} ${seriesForm.seriesCode}, ${lt('默认状态', 'default status')} ${enumLabel(seriesForm.status)}, ${formatNow()}`
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
  await ElMessageBox.confirm(`${lt('确认将 Genesis 系列', 'Confirm changing Genesis series')} ${row.seriesCode} ${lt('状态改为', 'status to')} ${enumLabel(status)}?`, lt('Genesis 系列状态变更', 'Genesis Series Status Change'), { type: 'warning' })
  seriesSaving.value = true
  try {
    await updateGenesisSeries(row.id, { status })
    ElMessage.success(lt('Genesis 系列状态已更新', 'Genesis series status updated'))
    lastSeriesAction.value = `${lt('已将系列', 'Changed series')} ${row.seriesCode} ${lt('状态改为', 'status to')} ${enumLabel(status)}, ${formatNow()}`
    await loadSeries()
    await loadOverview()
  } finally {
    seriesSaving.value = false
  }
}

async function loadOverview() {
  const [overviewRes, featureRes, configRes] = await Promise.allSettled([
    getGenesisOverview(undefined, { silentError: true }),
    getFeatureConfig({ silentError: true }),
    getSystemConfigs({ query: 'feature.genesis.enabled', limit: 20 }, { silentError: true })
  ])
  overview.value = overviewRes.status === 'fulfilled' ? overviewRes.value : null
  features.value = featureRes.status === 'fulfilled' ? featureRes.value : {}
  genesisSwitchConfig.value = configRes.status === 'fulfilled'
    ? configRes.value.find((item) => item.configKey === 'feature.genesis.enabled') || null
    : null
}

async function changeGenesisPurchaseSwitch(enabled: boolean | string | number) {
  const nextEnabled = toBoolean(enabled)
  await ElMessageBox.confirm(
    nextEnabled ? lt('确认开启 Genesis 新购买入口?', 'Enable new Genesis purchases?') : lt('确认关闭 Genesis 新购买入口? 历史订单和持仓仍可查询。', 'Disable new Genesis purchases? Historical orders and holdings remain queryable.'),
    lt('Genesis 购买开关', 'Genesis Purchase Switch'),
    { type: 'warning' }
  )
  genesisSwitchSaving.value = true
  try {
    const payload: ConfigItem = {
      configValue: String(nextEnabled),
      valueType: 'BOOLEAN',
      configGroup: 'feature',
      visibility: 'PUBLIC',
      status: 1,
      remark: 'Genesis purchase kill switch'
    }
    if (genesisSwitchConfig.value?.id) {
      await updateSystemConfig(genesisSwitchConfig.value.id, payload)
    } else {
      await createSystemConfig({
        ...payload,
        configKey: 'feature.genesis.enabled'
      })
    }
    ElMessage.success(nextEnabled ? lt('Genesis 购买已开启', 'Genesis purchase enabled') : lt('Genesis 购买已关闭', 'Genesis purchase disabled'))
    await loadOverview()
  } finally {
    genesisSwitchSaving.value = false
  }
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
          <div class="table-toolbar"><span>{{ lt('购买开关', 'Purchase Switch') }}</span><el-icon color="#409eff" :size="24"><Switch /></el-icon></div>
          <div class="value switch-value">
            <el-switch
              :model-value="genesisPurchaseEnabledBool()"
              :loading="genesisSwitchSaving"
              :disabled="genesisSwitchSaving"
              inline-prompt
              size="large"
              :active-text="lt('开', 'ON')"
              :inactive-text="lt('关', 'OFF')"
              :aria-label="genesisPurchaseSwitchLabel()"
              @change="changeGenesisPurchaseSwitch"
            />
          </div>
        </el-card>
      </el-col>
      <el-col :xs="24" :sm="12" :md="6">
        <el-card shadow="never" class="stat-card">
          <div class="table-toolbar"><span>{{ lt('启用系列', 'Active Series') }}</span><el-icon color="#67c23a" :size="24"><Collection /></el-icon></div>
          <div class="value">{{ activeGenesisSeriesCount() }}</div>
        </el-card>
      </el-col>
      <el-col :xs="24" :sm="12" :md="6">
        <el-card shadow="never" class="stat-card">
          <div class="table-toolbar"><span>{{ lt('启用价格档位', 'Active Price Tiers') }}</span><el-icon color="#e6a23c" :size="24"><Money /></el-icon></div>
          <div class="value">{{ activeGenesisPriceLabel() }}</div>
        </el-card>
      </el-col>
      <el-col :xs="24" :sm="12" :md="6">
        <el-card shadow="never" class="stat-card">
          <div class="table-toolbar"><span>{{ lt('已售份额', 'Sold Supply') }}</span><el-icon color="#f56c6c" :size="24"><Star /></el-icon></div>
          <div class="value">{{ soldGenesisSupply() }}</div>
        </el-card>
      </el-col>
    </el-row>

    <el-card shadow="never">
      <div class="table-toolbar">
        <span>{{ lt('Genesis 运营', 'Genesis Ops') }}</span>
        <el-button :icon="'Refresh'" @click="loadData">{{ lt('刷新', 'Refresh') }}</el-button>
      </div>

      <el-tabs v-model="activeTab">
        <el-tab-pane :label="lt('系列配置', 'Series Config')" name="series">
          <div class="table-toolbar">
            <span>{{ lt('Genesis 发行系列', 'Genesis Series') }}</span>
            <el-button type="primary" :icon="'Plus'" @click="openSeriesDialog()">{{ lt('新增系列', 'New Series') }}</el-button>
          </div>
          <el-form :inline="true" :model="seriesQuery" class="filter-form">
            <el-form-item :label="lt('状态', 'Status')">
              <el-select v-model="seriesQuery.status" clearable style="width: 150px">
                <el-option v-for="status in enumOptions(seriesStatusOptions)" :key="status.value" :label="status.label" :value="status.value" />
              </el-select>
            </el-form-item>
            <el-form-item><el-button type="primary" @click="seriesQuery.current = 1; loadData()">{{ lt('查询', 'Search') }}</el-button></el-form-item>
          </el-form>
          <el-alert v-if="lastSeriesAction" :title="lastSeriesAction" type="success" show-icon :closable="false" class="operation-alert" />
          <el-table v-loading="loading" :data="series" border>
            <el-table-column type="index" :index="(index: number) => pageIndex(seriesQuery, index)" :label="lt('编号', 'No.')" width="80" />
            <el-table-column prop="seriesCode" :label="lt('系列编码', 'Series Code')" min-width="150" />
            <el-table-column prop="name" :label="lt('名称', 'Name')" min-width="160" />
            <el-table-column prop="priceUsdt" :label="lt('价格 USDT', 'Price USDT')" width="130" />
            <el-table-column prop="totalSupply" :label="lt('总量', 'Total')" width="100" />
            <el-table-column prop="soldSupply" :label="lt('已售', 'Sold')" width="100" />
            <el-table-column prop="royaltyBps" :label="lt('版税 BPS', 'Royalty BPS')" width="120" />
            <el-table-column :label="lt('状态', 'Status')" width="120">
              <template #default="{ row }"><el-tag :type="row.status === 'ACTIVE' ? 'success' : 'info'">{{ enumLabel(row.status) }}</el-tag></template>
            </el-table-column>
            <el-table-column prop="saleStartAt" :label="lt('开始时间', 'Start Time')" min-width="170" :formatter="formatTableDateTime" />
            <el-table-column prop="saleEndAt" :label="lt('结束时间', 'End Time')" min-width="170" :formatter="formatTableDateTime" />
            <el-table-column :label="lt('操作', 'Actions')" width="190" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" @click="openSeriesDialog(row)">{{ lt('编辑', 'Edit') }}</el-button>
                <el-button v-if="row.status !== 'ACTIVE'" link type="success" :disabled="seriesSaving" @click="changeSeriesStatus(row, 'ACTIVE')">{{ lt('启用', 'Enable') }}</el-button>
                <el-button v-else link type="warning" :disabled="seriesSaving" @click="changeSeriesStatus(row, 'INACTIVE')">{{ lt('停用', 'Disable') }}</el-button>
              </template>
            </el-table-column>
          </el-table>
          <div class="pagination-wrap">
            <el-pagination v-model:current-page="seriesQuery.current" v-model:page-size="seriesQuery.size" layout="total, sizes, prev, pager, next" :total="seriesTotal" @current-change="loadData" @size-change="loadData" />
          </div>
        </el-tab-pane>

        <el-tab-pane :label="lt('订单', 'Orders')" name="orders">
          <el-form :inline="true" :model="orderQuery" class="filter-form">
            <el-form-item :label="lt('用户', 'User')"><UserSelect v-model="orderQuery.userId" /></el-form-item>
            <el-form-item :label="lt('状态', 'Status')">
              <el-select v-model="orderQuery.status" clearable style="width: 140px">
                <el-option v-for="status in enumOptions(genesisOrderStatusOptions)" :key="status.value" :label="status.label" :value="status.value" />
              </el-select>
            </el-form-item>
            <el-form-item>
              <el-button type="primary" @click="orderQuery.current = 1; loadData()">{{ lt('查询', 'Search') }}</el-button>
              <el-button @click="resetOrders">{{ lt('重置', 'Reset') }}</el-button>
            </el-form-item>
          </el-form>
          <el-table v-loading="loading" :data="orders" border>
            <el-table-column type="index" :index="(index: number) => pageIndex(orderQuery, index)" :label="lt('编号', 'No.')" width="80" />
            <el-table-column prop="orderNo" :label="lt('订单号', 'Order No.')" min-width="170" />
            <el-table-column prop="userId" :label="lt('用户ID', 'User ID')" width="100" />
            <el-table-column prop="seriesCode" :label="lt('系列', 'Series')" width="140" />
            <el-table-column prop="priceUsdt" :label="lt('价格 USDT', 'Price USDT')" width="130" />
            <el-table-column prop="status" :label="lt('状态', 'Status')" width="110" :formatter="enumTableFormatter" />
            <el-table-column prop="clientRequestNo" :label="lt('幂等号', 'Idempotency No.')" min-width="170" />
            <el-table-column prop="createdAt" :label="lt('创建时间', 'Created At')" min-width="170" :formatter="formatTableDateTime" />
            <el-table-column :label="lt('操作', 'Actions')" width="90" fixed="right">
              <template #default="{ row }"><el-button link type="primary" @click="showDetail(row)">{{ lt('详情', 'Details') }}</el-button></template>
            </el-table-column>
          </el-table>
          <div class="pagination-wrap">
            <el-pagination v-model:current-page="orderQuery.current" v-model:page-size="orderQuery.size" layout="total, sizes, prev, pager, next" :total="orderTotal" @current-change="loadData" @size-change="loadData" />
          </div>
        </el-tab-pane>

        <el-tab-pane :label="lt('持仓', 'Holdings')" name="holdings">
          <el-form :inline="true" :model="holdingQuery" class="filter-form">
            <el-form-item :label="lt('用户', 'User')"><UserSelect v-model="holdingQuery.userId" /></el-form-item>
            <el-form-item :label="lt('系列', 'Series')"><el-input v-model="holdingQuery.seriesCode" clearable /></el-form-item>
            <el-form-item>
              <el-button type="primary" @click="holdingQuery.current = 1; loadData()">{{ lt('查询', 'Search') }}</el-button>
              <el-button @click="resetHoldings">{{ lt('重置', 'Reset') }}</el-button>
            </el-form-item>
          </el-form>
          <el-table v-loading="loading" :data="holdings" border>
            <el-table-column type="index" :index="(index: number) => pageIndex(holdingQuery, index)" :label="lt('编号', 'No.')" width="80" />
            <el-table-column prop="holdingNo" :label="lt('持仓号', 'Holding No.')" min-width="170" />
            <el-table-column prop="userId" :label="lt('用户ID', 'User ID')" width="100" />
            <el-table-column prop="seriesCode" :label="lt('系列', 'Series')" width="140" />
            <el-table-column prop="tokenNo" label="Token No" width="120" />
            <el-table-column prop="status" :label="lt('状态', 'Status')" width="110" :formatter="enumTableFormatter" />
            <el-table-column prop="sourceOrderNo" :label="lt('来源订单', 'Source Order')" min-width="170" />
            <el-table-column prop="createdAt" :label="lt('创建时间', 'Created At')" min-width="170" :formatter="formatTableDateTime" />
            <el-table-column :label="lt('操作', 'Actions')" width="90" fixed="right">
              <template #default="{ row }"><el-button link type="primary" @click="showDetail(row)">{{ lt('详情', 'Details') }}</el-button></template>
            </el-table-column>
          </el-table>
          <div class="pagination-wrap">
            <el-pagination v-model:current-page="holdingQuery.current" v-model:page-size="holdingQuery.size" layout="total, sizes, prev, pager, next" :total="holdingTotal" @current-change="loadData" @size-change="loadData" />
          </div>
        </el-tab-pane>
      </el-tabs>
    </el-card>

    <el-dialog v-model="seriesDialogVisible" :title="seriesForm.id ? lt('编辑 Genesis 系列', 'Edit Genesis Series') : lt('新增 Genesis 系列', 'New Genesis Series')" width="760px">
      <el-form ref="seriesFormRef" :model="seriesForm" :rules="seriesRules" label-width="118px">
        <el-row :gutter="16">
          <el-col :span="12"><el-form-item :label="lt('系列编码', 'Series Code')" prop="seriesCode"><el-input v-model="seriesForm.seriesCode" :disabled="!!seriesForm.id" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item :label="lt('名称', 'Name')" prop="name"><el-input v-model="seriesForm.name" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item :label="lt('总量', 'Total')" prop="totalSupply"><el-input-number v-model="seriesForm.totalSupply" :min="1" style="width: 100%" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item :label="lt('价格 USDT', 'Price USDT')" prop="priceUsdt"><el-input-number v-model="seriesForm.priceUsdt" :min="0" :precision="6" style="width: 100%" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item :label="lt('版税 BPS', 'Royalty BPS')"><el-input-number v-model="seriesForm.royaltyBps" :min="0" style="width: 100%" /></el-form-item></el-col>
          <el-col :span="12">
            <el-form-item :label="lt('状态', 'Status')" prop="status">
              <el-select v-model="seriesForm.status" style="width: 100%">
                <el-option v-for="status in enumOptions(seriesStatusOptions)" :key="status.value" :label="status.label" :value="status.value" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12"><el-form-item :label="lt('开始时间', 'Start Time')"><el-date-picker v-model="seriesForm.saleStartAt" type="datetime" format="YYYY-MM-DD HH:mm:ss" value-format="YYYY-MM-DD HH:mm:ss" style="width: 100%" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item :label="lt('结束时间', 'End Time')"><el-date-picker v-model="seriesForm.saleEndAt" type="datetime" format="YYYY-MM-DD HH:mm:ss" value-format="YYYY-MM-DD HH:mm:ss" style="width: 100%" /></el-form-item></el-col>
          <el-col :span="24">
            <el-form-item :label="lt('系列封面', 'Series Cover')">
              <ObjectImageUpload
                v-model="seriesForm.coverUrl"
                media-type="GENESIS_COVER"
                :empty-title="lt('上传系列封面', 'Upload Series Cover')"
                :empty-description="lt('拖拽或点击上传 Genesis 系列封面，支持 PNG/JPG/WebP', 'Drag or click to upload Genesis series cover. PNG/JPG/WebP supported')"
              />
            </el-form-item>
          </el-col>
          <el-col :span="24"><el-form-item :label="lt('元数据 JSON', 'Metadata JSON')"><el-input v-model="seriesForm.metadataJson" type="textarea" :rows="4" /></el-form-item></el-col>
        </el-row>
      </el-form>
      <template #footer>
        <el-button @click="seriesDialogVisible = false">{{ lt('取消', 'Cancel') }}</el-button>
        <el-button type="primary" :loading="seriesSaving" @click="saveSeries">{{ lt('保存', 'Save') }}</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="detailVisible" :title="lt('详情', 'Details')" width="760px">
      <ObjectDetails :data="detailRecord" />
    </el-dialog>
  </div>
</template>

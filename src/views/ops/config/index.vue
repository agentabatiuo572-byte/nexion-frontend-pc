<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import {
  createDeviceLifecycleRule,
  createGenesisSeries,
  createSystemConfig,
  getDayOneConfig,
  getDeviceFleetConfig,
  getDeviceLifecycleRules,
  getFeatureConfig,
  getGenesisSeries,
  getSystemConfigs,
  getTradeinConfig,
  updateDeviceLifecycleRule,
  updateGenesisSeries,
  updateSystemConfig,
  type ConfigItem,
  type DeviceLifecycleRule,
  type GenesisSeries
} from '@/apis/operation'
import type { AnyRecord, Id } from '@/types/common'
import { formatTableDateTime } from '@/utils/date'
import { localeText as lt, enumLabel, enumOptions, enumTableFormatter } from '@/utils/i18n'
import ObjectImageUpload from '@/components/ObjectImageUpload.vue'

const loading = ref(false)
const activeTab = ref('public')
const dayOne = ref<AnyRecord>({})
const features = ref<AnyRecord>({})
const fleetConfig = ref<AnyRecord>({})
const systemConfigs = ref<ConfigItem[]>([])
const genesisSeries = ref<GenesisSeries[]>([])
const genesisTotal = ref(0)
const lifecycleRules = ref<DeviceLifecycleRule[]>([])
const tradeinRules = ref<AnyRecord[]>([])

const configQuery = reactive({ query: '', status: '', limit: 50 })
const genesisQuery = reactive({ current: 1, size: 20, status: '' })
const lifecycleQuery = reactive({ status: '' })
const genesisStatusOptions = ['ACTIVE', 'INACTIVE', 'SOLD_OUT', 'ARCHIVED']
const lifecycleScopeOptions = ['DEFAULT', 'PRODUCT_TYPE', 'TIER', 'PRODUCT_ID']

const configDialogVisible = ref(false)
const configSaving = ref(false)
const configForm = reactive({
  id: undefined as Id | undefined,
  configKey: '',
  configValue: '',
  valueType: 'STRING',
  configGroup: '',
  visibility: 'ADMIN',
  remark: '',
  status: 1
})

const genesisDialogVisible = ref(false)
const genesisSaving = ref(false)
const genesisForm = reactive({
  id: undefined as Id | undefined,
  seriesCode: '',
  name: '',
  totalSupply: 1,
  priceUsdt: 0,
  status: 'ACTIVE',
  saleStartAt: '',
  saleEndAt: '',
  royaltyBps: 0,
  coverUrl: '',
  metadataJson: ''
})

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

function formatJson(value: unknown) {
  return JSON.stringify(value || {}, null, 2)
}

function statusTag(status: unknown) {
  return Number(status) === 1 || status === 'ACTIVE' ? 'success' : 'info'
}

function yesNo(value: unknown) {
  return Number(value) === 1 || value === true ? lt('是', 'Yes') : lt('否', 'No')
}

function resetConfigForm() {
  Object.assign(configForm, {
    id: undefined,
    configKey: '',
    configValue: '',
    valueType: 'STRING',
    configGroup: '',
    visibility: 'ADMIN',
    remark: '',
    status: 1
  })
}

function openConfigDialog(row?: ConfigItem) {
  resetConfigForm()
  if (row) {
    Object.assign(configForm, {
      id: row.id,
      configKey: row.configKey || '',
      configValue: row.configValue || '',
      valueType: row.valueType || 'STRING',
      configGroup: row.configGroup || '',
      visibility: row.visibility || 'ADMIN',
      remark: row.remark || '',
      status: row.status ?? 1
    })
  }
  configDialogVisible.value = true
}

function validateJsonConfig() {
  if (configForm.valueType === 'JSON' && configForm.configValue) {
    JSON.parse(configForm.configValue)
  }
}

async function saveConfig() {
  if (!configForm.configKey && !configForm.id) {
    ElMessage.warning(lt('请填写配置键', 'Please enter config key'))
    return
  }
  try {
    validateJsonConfig()
  } catch {
    ElMessage.warning(lt('JSON 配置值格式不合法', 'Invalid JSON config value'))
    return
  }
  configSaving.value = true
  try {
    const payload = {
      configValue: configForm.configValue,
      valueType: configForm.valueType,
      configGroup: configForm.configGroup,
      visibility: configForm.visibility,
      remark: configForm.remark,
      status: configForm.status
    }
    if (configForm.id) {
      await updateSystemConfig(configForm.id, payload)
      ElMessage.success(lt('配置已更新', 'Config updated'))
    } else {
      await createSystemConfig({ ...payload, configKey: configForm.configKey })
      ElMessage.success(lt('配置已创建', 'Config created'))
    }
    configDialogVisible.value = false
    await loadData()
  } finally {
    configSaving.value = false
  }
}

function resetGenesisForm() {
  Object.assign(genesisForm, {
    id: undefined,
    seriesCode: '',
    name: '',
    totalSupply: 1,
    priceUsdt: 0,
    status: 'ACTIVE',
    saleStartAt: '',
    saleEndAt: '',
    royaltyBps: 0,
    coverUrl: '',
    metadataJson: ''
  })
}

function openGenesisDialog(row?: GenesisSeries) {
  resetGenesisForm()
  if (row) {
    Object.assign(genesisForm, {
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
  genesisDialogVisible.value = true
}

async function saveGenesis() {
  if (!genesisForm.name || (!genesisForm.id && !genesisForm.seriesCode)) {
    ElMessage.warning(lt('请补全系列编码和名称', 'Please complete series code and name'))
    return
  }
  genesisSaving.value = true
  try {
    const payload = {
      seriesCode: genesisForm.seriesCode,
      name: genesisForm.name,
      totalSupply: genesisForm.totalSupply,
      priceUsdt: genesisForm.priceUsdt,
      status: genesisForm.status,
      saleStartAt: genesisForm.saleStartAt || undefined,
      saleEndAt: genesisForm.saleEndAt || undefined,
      royaltyBps: genesisForm.royaltyBps,
      coverUrl: genesisForm.coverUrl,
      metadataJson: genesisForm.metadataJson
    }
    if (genesisForm.id) {
      const { seriesCode: _seriesCode, ...updatePayload } = payload
      await updateGenesisSeries(genesisForm.id, updatePayload)
      ElMessage.success(lt('Genesis 系列已更新', 'Genesis series updated'))
    } else {
      await createGenesisSeries(payload)
      ElMessage.success(lt('Genesis 系列已创建', 'Genesis series created'))
    }
    genesisDialogVisible.value = false
    await loadData()
  } finally {
    genesisSaving.value = false
  }
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
    ElMessage.warning(lt('请选择规则范围', 'Please select rule scope'))
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
    } else {
      await createDeviceLifecycleRule(payload)
      ElMessage.success(lt('生命周期规则已创建', 'Lifecycle rule created'))
    }
    lifecycleDialogVisible.value = false
    await loadData()
  } finally {
    lifecycleSaving.value = false
  }
}

async function loadData() {
  loading.value = true
  try {
    const [dayOneRes, featureRes, fleetRes, configRes, seriesRes, lifecycleRes, tradeinRes] = await Promise.allSettled([
      getDayOneConfig({ silentError: true }),
      getFeatureConfig({ silentError: true }),
      getDeviceFleetConfig({ silentError: true }),
      getSystemConfigs({
        query: configQuery.query,
        status: configQuery.status,
        limit: configQuery.limit
      }, { silentError: true }),
      getGenesisSeries(genesisQuery, { silentError: true }),
      getDeviceLifecycleRules({ status: lifecycleQuery.status }, { silentError: true }),
      getTradeinConfig({ silentError: true })
    ])
    dayOne.value = dayOneRes.status === 'fulfilled' ? dayOneRes.value : {}
    features.value = featureRes.status === 'fulfilled' ? featureRes.value : {}
    fleetConfig.value = fleetRes.status === 'fulfilled' ? fleetRes.value : {}
    systemConfigs.value = configRes.status === 'fulfilled' ? configRes.value : []
    genesisSeries.value = seriesRes.status === 'fulfilled' ? seriesRes.value.records : []
    genesisTotal.value = seriesRes.status === 'fulfilled' ? seriesRes.value.total : 0
    lifecycleRules.value = lifecycleRes.status === 'fulfilled' ? lifecycleRes.value : []
    tradeinRules.value = tradeinRes.status === 'fulfilled' ? tradeinRes.value.rules : []
  } finally {
    loading.value = false
  }
}

onMounted(loadData)
</script>

<template>
  <div>
    <el-card shadow="never">
      <div class="table-toolbar">
        <span>{{ lt('配置管理', 'Config Management') }}</span>
        <el-button :icon="'Refresh'" @click="loadData">{{ lt('刷新', 'Refresh') }}</el-button>
      </div>
      <el-tabs v-model="activeTab">
        <el-tab-pane :label="lt('公共配置', 'Public Config')" name="public">
          <el-row :gutter="16" class="app-card">
            <el-col :xs="24" :md="8">
              <el-descriptions title="Day 0" :column="1" border>
                <el-descriptions-item :label="lt('首笔目标秒', 'First Receipt Target Seconds')">{{ dayOne.firstReceiptTargetSeconds || '-' }}</el-descriptions-item>
                <el-descriptions-item :label="lt('首笔 USDT', 'First Receipt USDT')">{{ dayOne.firstReceiptUsdt || '-' }}</el-descriptions-item>
                <el-descriptions-item :label="lt('欢迎奖励', 'Welcome Bonus')">{{ dayOne.welcomeBonusAmount || '-' }} {{ dayOne.welcomeBonusAsset || '' }}</el-descriptions-item>
              </el-descriptions>
            </el-col>
            <el-col :xs="24" :md="8">
              <el-descriptions :title="lt('功能开关', 'Feature Flags')" :column="1" border>
                <el-descriptions-item v-for="(value, key) in features" :key="key" :label="String(key)">
                  {{ enumLabel(value) }}
                </el-descriptions-item>
              </el-descriptions>
            </el-col>
            <el-col :xs="24" :md="8">
              <el-descriptions :title="lt('设备池', 'Device Fleet')" :column="1" border>
                <el-descriptions-item :label="lt('最大激活槽位', 'Max Active Slots')">{{ fleetConfig.maxActiveSlots || '-' }}</el-descriptions-item>
              </el-descriptions>
            </el-col>
          </el-row>

          <div class="table-toolbar">
            <span>{{ lt('系统配置项', 'System Config Items') }}</span>
            <el-button type="primary" :icon="'Plus'" @click="openConfigDialog()">{{ lt('新增配置', 'New Config') }}</el-button>
          </div>
          <el-form :inline="true" :model="configQuery" class="filter-form">
            <el-form-item :label="lt('关键词', 'Keyword')"><el-input v-model="configQuery.query" clearable /></el-form-item>
            <el-form-item :label="lt('状态', 'Status')">
              <el-select v-model="configQuery.status" clearable style="width: 120px">
                <el-option :label="lt('启用', 'Enabled')" :value="1" />
                <el-option :label="lt('停用', 'Disabled')" :value="0" />
              </el-select>
            </el-form-item>
            <el-form-item :label="lt('条数', 'Limit')"><el-input-number v-model="configQuery.limit" :min="1" :max="200" /></el-form-item>
            <el-form-item><el-button type="primary" @click="loadData">{{ lt('查询', 'Search') }}</el-button></el-form-item>
          </el-form>
          <el-table v-loading="loading" :data="systemConfigs" border>
            <el-table-column prop="configKey" :label="lt('配置键', 'Config Key')" min-width="220" />
            <el-table-column prop="configGroup" :label="lt('分组', 'Group')" width="120" />
            <el-table-column prop="valueType" :label="lt('类型', 'Type')" width="110" />
            <el-table-column prop="visibility" :label="lt('可见性', 'Visibility')" width="110" :formatter="enumTableFormatter" />
            <el-table-column prop="configValue" :label="lt('配置值', 'Config Value')" min-width="260" show-overflow-tooltip />
            <el-table-column :label="lt('状态', 'Status')" width="90">
              <template #default="{ row }"><el-tag :type="statusTag(row.status)">{{ enumLabel(row.status) }}</el-tag></template>
            </el-table-column>
            <el-table-column prop="remark" :label="lt('备注', 'Remark')" min-width="160" />
            <el-table-column :label="lt('操作', 'Actions')" width="100" fixed="right">
              <template #default="{ row }"><el-button link type="primary" @click="openConfigDialog(row)">{{ lt('编辑', 'Edit') }}</el-button></template>
            </el-table-column>
          </el-table>
        </el-tab-pane>

        <el-tab-pane label="Genesis" name="genesis">
          <div class="table-toolbar">
            <span>{{ lt('Genesis 系列', 'Genesis Series') }}</span>
            <el-button type="primary" :icon="'Plus'" @click="openGenesisDialog()">{{ lt('新增系列', 'New Series') }}</el-button>
          </div>
          <el-form :inline="true" :model="genesisQuery" class="filter-form">
            <el-form-item :label="lt('状态', 'Status')">
              <el-select v-model="genesisQuery.status" clearable style="width: 140px">
                <el-option v-for="status in enumOptions(genesisStatusOptions)" :key="status.value" :label="status.label" :value="status.value" />
              </el-select>
            </el-form-item>
            <el-form-item><el-button type="primary" @click="genesisQuery.current = 1; loadData()">{{ lt('查询', 'Search') }}</el-button></el-form-item>
          </el-form>
          <el-table v-loading="loading" :data="genesisSeries" border>
            <el-table-column prop="seriesCode" :label="lt('系列编码', 'Series Code')" min-width="150" />
            <el-table-column prop="name" :label="lt('名称', 'Name')" min-width="160" />
            <el-table-column prop="priceUsdt" :label="lt('价格 USDT', 'Price USDT')" width="130" />
            <el-table-column prop="totalSupply" :label="lt('总量', 'Total')" width="100" />
            <el-table-column prop="soldSupply" :label="lt('已售', 'Sold')" width="100" />
            <el-table-column prop="royaltyBps" :label="lt('版税 BPS', 'Royalty BPS')" width="120" />
            <el-table-column prop="status" :label="lt('状态', 'Status')" width="110" :formatter="enumTableFormatter" />
            <el-table-column prop="saleStartAt" :label="lt('开始时间', 'Start Time')" min-width="170" :formatter="formatTableDateTime" />
            <el-table-column prop="saleEndAt" :label="lt('结束时间', 'End Time')" min-width="170" :formatter="formatTableDateTime" />
            <el-table-column :label="lt('操作', 'Actions')" width="100" fixed="right">
              <template #default="{ row }"><el-button link type="primary" @click="openGenesisDialog(row)">{{ lt('编辑', 'Edit') }}</el-button></template>
            </el-table-column>
          </el-table>
          <div class="pagination-wrap">
            <el-pagination
              v-model:current-page="genesisQuery.current"
              v-model:page-size="genesisQuery.size"
              layout="total, sizes, prev, pager, next"
              :total="genesisTotal"
              @current-change="loadData"
              @size-change="loadData"
            />
          </div>
        </el-tab-pane>

        <el-tab-pane :label="lt('设备生命周期', 'Device Lifecycle')" name="lifecycle">
          <div class="table-toolbar">
            <span>{{ lt('生命周期规则', 'Lifecycle Rules') }}</span>
            <el-button type="primary" :icon="'Plus'" @click="openLifecycleDialog()">{{ lt('新增规则', 'New Rule') }}</el-button>
          </div>
          <el-form :inline="true" :model="lifecycleQuery" class="filter-form">
            <el-form-item :label="lt('状态', 'Status')">
              <el-select v-model="lifecycleQuery.status" clearable style="width: 120px">
                <el-option :label="lt('启用', 'Enabled')" :value="1" />
                <el-option :label="lt('停用', 'Disabled')" :value="0" />
              </el-select>
            </el-form-item>
            <el-form-item><el-button type="primary" @click="loadData">{{ lt('查询', 'Search') }}</el-button></el-form-item>
          </el-form>
          <el-table v-loading="loading" :data="lifecycleRules" border>
            <el-table-column prop="scopeType" :label="lt('范围', 'Scope')" width="140" />
            <el-table-column prop="scopeValue" :label="lt('范围值', 'Scope Value')" min-width="150" />
            <el-table-column prop="startMonth" :label="lt('起始月', 'Start Month')" width="100" />
            <el-table-column prop="endMonth" :label="lt('结束月', 'End Month')" width="100" />
            <el-table-column prop="monthlyDecayRate" :label="lt('月衰减', 'Monthly Decay')" width="120" />
            <el-table-column prop="floorEfficiency" :label="lt('效率下限', 'Floor Efficiency')" width="120" />
            <el-table-column :label="lt('豁免', 'Exempt')" width="90"><template #default="{ row }">{{ yesNo(row.exempt) }}</template></el-table-column>
            <el-table-column prop="sortOrder" :label="lt('排序', 'Sort Order')" width="90" />
            <el-table-column :label="lt('状态', 'Status')" width="90">
              <template #default="{ row }"><el-tag :type="statusTag(row.status)">{{ enumLabel(row.status) }}</el-tag></template>
            </el-table-column>
            <el-table-column :label="lt('操作', 'Actions')" width="100" fixed="right">
              <template #default="{ row }"><el-button link type="primary" @click="openLifecycleDialog(row)">{{ lt('编辑', 'Edit') }}</el-button></template>
            </el-table-column>
          </el-table>
        </el-tab-pane>

        <el-tab-pane label="Trade-in" name="tradein">
          <el-table v-loading="loading" :data="tradeinRules" border>
            <el-table-column prop="sourceProductNo" :label="lt('来源 SKU', 'Source SKU')" min-width="150" />
            <el-table-column prop="sourceTier" :label="lt('来源档位', 'Source Tier')" width="120" />
            <el-table-column prop="targetTier" :label="lt('目标档位', 'Target Tier')" width="120" />
            <el-table-column prop="discountUsdt" :label="lt('折扣 USDT', 'Discount USDT')" width="130" />
            <el-table-column prop="salvageRate" :label="lt('残值率', 'Salvage Rate')" width="110" />
            <el-table-column prop="minHoldingMonths" :label="lt('最短持有月', 'Min Holding Months')" width="120" />
            <el-table-column prop="sortOrder" :label="lt('排序', 'Sort Order')" width="90" />
            <el-table-column :label="lt('状态', 'Status')" width="90">
              <template #default="{ row }"><el-tag :type="statusTag(row.status)">{{ enumLabel(row.status) }}</el-tag></template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
      </el-tabs>
    </el-card>

    <el-dialog v-model="configDialogVisible" :title="configForm.id ? lt('编辑配置', 'Edit Config') : lt('新增配置', 'New Config')" width="720px">
      <el-form :model="configForm" label-width="106px">
        <el-row :gutter="16">
          <el-col :span="12"><el-form-item :label="lt('配置键', 'Config Key')"><el-input v-model="configForm.configKey" :disabled="!!configForm.id" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item :label="lt('分组', 'Group')"><el-input v-model="configForm.configGroup" /></el-form-item></el-col>
          <el-col :span="12">
            <el-form-item :label="lt('类型', 'Type')">
              <el-select v-model="configForm.valueType" style="width: 100%">
                <el-option label="STRING" value="STRING" />
                <el-option label="NUMBER" value="NUMBER" />
                <el-option label="BOOLEAN" value="BOOLEAN" />
                <el-option label="JSON" value="JSON" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item :label="lt('可见性', 'Visibility')">
              <el-select v-model="configForm.visibility" style="width: 100%">
                <el-option label="ADMIN" value="ADMIN" />
                <el-option label="PUBLIC" value="PUBLIC" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12"><el-form-item :label="lt('状态', 'Status')"><el-switch v-model="configForm.status" :active-value="1" :inactive-value="0" /></el-form-item></el-col>
          <el-col :span="24"><el-form-item :label="lt('配置值', 'Config Value')"><el-input v-model="configForm.configValue" type="textarea" :rows="5" /></el-form-item></el-col>
          <el-col :span="24"><el-form-item :label="lt('备注', 'Remark')"><el-input v-model="configForm.remark" /></el-form-item></el-col>
        </el-row>
      </el-form>
      <template #footer>
        <el-button @click="configDialogVisible = false">{{ lt('取消', 'Cancel') }}</el-button>
        <el-button type="primary" :loading="configSaving" @click="saveConfig">{{ lt('保存', 'Save') }}</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="genesisDialogVisible" :title="genesisForm.id ? lt('编辑 Genesis 系列', 'Edit Genesis Series') : lt('新增 Genesis 系列', 'New Genesis Series')" width="760px">
      <el-form :model="genesisForm" label-width="118px">
        <el-row :gutter="16">
          <el-col :span="12"><el-form-item :label="lt('系列编码', 'Series Code')"><el-input v-model="genesisForm.seriesCode" :disabled="!!genesisForm.id" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item :label="lt('名称', 'Name')"><el-input v-model="genesisForm.name" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item :label="lt('总量', 'Total')"><el-input-number v-model="genesisForm.totalSupply" :min="1" style="width: 100%" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item :label="lt('价格 USDT', 'Price USDT')"><el-input-number v-model="genesisForm.priceUsdt" :min="0" :precision="6" style="width: 100%" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item :label="lt('版税 BPS', 'Royalty BPS')"><el-input-number v-model="genesisForm.royaltyBps" :min="0" style="width: 100%" /></el-form-item></el-col>
          <el-col :span="12">
            <el-form-item :label="lt('状态', 'Status')">
              <el-select v-model="genesisForm.status" style="width: 100%">
                <el-option v-for="status in enumOptions(genesisStatusOptions)" :key="status.value" :label="status.label" :value="status.value" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item :label="lt('开始时间', 'Start Time')"><el-date-picker v-model="genesisForm.saleStartAt" type="datetime" format="YYYY-MM-DD HH:mm:ss" value-format="YYYY-MM-DD HH:mm:ss" style="width: 100%" /></el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item :label="lt('结束时间', 'End Time')"><el-date-picker v-model="genesisForm.saleEndAt" type="datetime" format="YYYY-MM-DD HH:mm:ss" value-format="YYYY-MM-DD HH:mm:ss" style="width: 100%" /></el-form-item>
          </el-col>
          <el-col :span="24">
            <el-form-item :label="lt('系列封面', 'Series Cover')">
              <ObjectImageUpload
                v-model="genesisForm.coverUrl"
                media-type="GENESIS_COVER"
                empty-:title="lt('上传系列封面', 'Upload Series Cover')"
                :empty-description="lt('拖拽或点击上传 Genesis 系列封面，支持 PNG/JPG/WebP', 'Drag or click to upload Genesis cover, PNG/JPG/WebP supported')"
              />
            </el-form-item>
          </el-col>
          <el-col :span="24"><el-form-item :label="lt('元数据 JSON', 'Metadata JSON')"><el-input v-model="genesisForm.metadataJson" type="textarea" :rows="4" /></el-form-item></el-col>
        </el-row>
      </el-form>
      <template #footer>
        <el-button @click="genesisDialogVisible = false">{{ lt('取消', 'Cancel') }}</el-button>
        <el-button type="primary" :loading="genesisSaving" @click="saveGenesis">{{ lt('保存', 'Save') }}</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="lifecycleDialogVisible" :title="lifecycleForm.id ? lt('编辑生命周期规则', 'Edit Lifecycle Rule') : lt('新增生命周期规则', 'New Lifecycle Rule')" width="720px">
      <el-form :model="lifecycleForm" label-width="118px">
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item :label="lt('范围', 'Scope')">
              <el-select v-model="lifecycleForm.scopeType" style="width: 100%">
                <el-option v-for="scope in enumOptions(lifecycleScopeOptions)" :key="scope.value" :label="scope.label" :value="scope.value" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12"><el-form-item :label="lt('范围值', 'Scope Value')"><el-input v-model="lifecycleForm.scopeValue" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item :label="lt('起始月', 'Start Month')"><el-input-number v-model="lifecycleForm.startMonth" :min="0" style="width: 100%" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item :label="lt('结束月', 'End Month')"><el-input-number v-model="lifecycleForm.endMonth" :min="0" style="width: 100%" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item :label="lt('月衰减', 'Monthly Decay')"><el-input-number v-model="lifecycleForm.monthlyDecayRate" :min="0" :max="1" :precision="4" style="width: 100%" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item :label="lt('效率下限', 'Floor Efficiency')"><el-input-number v-model="lifecycleForm.floorEfficiency" :min="0" :max="1" :precision="4" style="width: 100%" /></el-form-item></el-col>
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
  </div>
</template>

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
    ElMessage.warning('请填写配置键')
    return
  }
  try {
    validateJsonConfig()
  } catch {
    ElMessage.warning('JSON 配置值格式不合法')
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
      ElMessage.success('配置已更新')
    } else {
      await createSystemConfig({ ...payload, configKey: configForm.configKey })
      ElMessage.success('配置已创建')
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
    ElMessage.warning('请补全系列编码和名称')
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
      ElMessage.success('Genesis 系列已更新')
    } else {
      await createGenesisSeries(payload)
      ElMessage.success('Genesis 系列已创建')
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
        <span>配置管理</span>
        <el-button :icon="'Refresh'" @click="loadData">刷新</el-button>
      </div>
      <el-tabs v-model="activeTab">
        <el-tab-pane label="公共配置" name="public">
          <el-row :gutter="16" class="app-card">
            <el-col :xs="24" :md="8">
              <el-descriptions title="Day 0" :column="1" border>
                <el-descriptions-item label="首笔目标秒">{{ dayOne.firstReceiptTargetSeconds || '-' }}</el-descriptions-item>
                <el-descriptions-item label="首笔 USDT">{{ dayOne.firstReceiptUsdt || '-' }}</el-descriptions-item>
                <el-descriptions-item label="欢迎奖励">{{ dayOne.welcomeBonusAmount || '-' }} {{ dayOne.welcomeBonusAsset || '' }}</el-descriptions-item>
              </el-descriptions>
            </el-col>
            <el-col :xs="24" :md="8">
              <el-descriptions title="功能开关" :column="1" border>
                <el-descriptions-item v-for="(value, key) in features" :key="key" :label="String(key)">
                  {{ value }}
                </el-descriptions-item>
              </el-descriptions>
            </el-col>
            <el-col :xs="24" :md="8">
              <el-descriptions title="设备池" :column="1" border>
                <el-descriptions-item label="最大激活槽位">{{ fleetConfig.maxActiveSlots || '-' }}</el-descriptions-item>
              </el-descriptions>
            </el-col>
          </el-row>

          <div class="table-toolbar">
            <span>系统配置项</span>
            <el-button type="primary" :icon="'Plus'" @click="openConfigDialog()">新增配置</el-button>
          </div>
          <el-form :inline="true" :model="configQuery" class="filter-form">
            <el-form-item label="关键词"><el-input v-model="configQuery.query" clearable /></el-form-item>
            <el-form-item label="状态">
              <el-select v-model="configQuery.status" clearable style="width: 120px">
                <el-option label="启用" :value="1" />
                <el-option label="停用" :value="0" />
              </el-select>
            </el-form-item>
            <el-form-item label="条数"><el-input-number v-model="configQuery.limit" :min="1" :max="200" /></el-form-item>
            <el-form-item><el-button type="primary" @click="loadData">查询</el-button></el-form-item>
          </el-form>
          <el-table v-loading="loading" :data="systemConfigs" border>
            <el-table-column prop="configKey" label="配置键" min-width="220" />
            <el-table-column prop="configGroup" label="分组" width="120" />
            <el-table-column prop="valueType" label="类型" width="110" />
            <el-table-column prop="visibility" label="可见性" width="110" />
            <el-table-column prop="configValue" label="配置值" min-width="260" show-overflow-tooltip />
            <el-table-column label="状态" width="90">
              <template #default="{ row }"><el-tag :type="statusTag(row.status)">{{ row.status }}</el-tag></template>
            </el-table-column>
            <el-table-column prop="remark" label="备注" min-width="160" />
            <el-table-column label="操作" width="100" fixed="right">
              <template #default="{ row }"><el-button link type="primary" @click="openConfigDialog(row)">编辑</el-button></template>
            </el-table-column>
          </el-table>
        </el-tab-pane>

        <el-tab-pane label="Genesis" name="genesis">
          <div class="table-toolbar">
            <span>Genesis 系列</span>
            <el-button type="primary" :icon="'Plus'" @click="openGenesisDialog()">新增系列</el-button>
          </div>
          <el-form :inline="true" :model="genesisQuery" class="filter-form">
            <el-form-item label="状态"><el-input v-model="genesisQuery.status" clearable /></el-form-item>
            <el-form-item><el-button type="primary" @click="genesisQuery.current = 1; loadData()">查询</el-button></el-form-item>
          </el-form>
          <el-table v-loading="loading" :data="genesisSeries" border>
            <el-table-column prop="seriesCode" label="系列编码" min-width="150" />
            <el-table-column prop="name" label="名称" min-width="160" />
            <el-table-column prop="priceUsdt" label="价格 USDT" width="130" />
            <el-table-column prop="totalSupply" label="总量" width="100" />
            <el-table-column prop="soldSupply" label="已售" width="100" />
            <el-table-column prop="royaltyBps" label="版税 BPS" width="120" />
            <el-table-column prop="status" label="状态" width="110" />
            <el-table-column prop="saleStartAt" label="开始时间" min-width="170" />
            <el-table-column prop="saleEndAt" label="结束时间" min-width="170" />
            <el-table-column label="操作" width="100" fixed="right">
              <template #default="{ row }"><el-button link type="primary" @click="openGenesisDialog(row)">编辑</el-button></template>
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

        <el-tab-pane label="设备生命周期" name="lifecycle">
          <div class="table-toolbar">
            <span>生命周期规则</span>
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
            <el-table-column label="状态" width="90">
              <template #default="{ row }"><el-tag :type="statusTag(row.status)">{{ row.status }}</el-tag></template>
            </el-table-column>
            <el-table-column label="操作" width="100" fixed="right">
              <template #default="{ row }"><el-button link type="primary" @click="openLifecycleDialog(row)">编辑</el-button></template>
            </el-table-column>
          </el-table>
        </el-tab-pane>

        <el-tab-pane label="Trade-in" name="tradein">
          <el-table v-loading="loading" :data="tradeinRules" border>
            <el-table-column prop="sourceProductNo" label="来源 SKU" min-width="150" />
            <el-table-column prop="sourceTier" label="来源档位" width="120" />
            <el-table-column prop="targetTier" label="目标档位" width="120" />
            <el-table-column prop="discountUsdt" label="折扣 USDT" width="130" />
            <el-table-column prop="salvageRate" label="残值率" width="110" />
            <el-table-column prop="minHoldingMonths" label="最短持有月" width="120" />
            <el-table-column prop="sortOrder" label="排序" width="90" />
            <el-table-column label="状态" width="90">
              <template #default="{ row }"><el-tag :type="statusTag(row.status)">{{ row.status }}</el-tag></template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
      </el-tabs>
    </el-card>

    <el-dialog v-model="configDialogVisible" :title="configForm.id ? '编辑配置' : '新增配置'" width="720px">
      <el-form :model="configForm" label-width="106px">
        <el-row :gutter="16">
          <el-col :span="12"><el-form-item label="配置键"><el-input v-model="configForm.configKey" :disabled="!!configForm.id" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="分组"><el-input v-model="configForm.configGroup" /></el-form-item></el-col>
          <el-col :span="12">
            <el-form-item label="类型">
              <el-select v-model="configForm.valueType" style="width: 100%">
                <el-option label="STRING" value="STRING" />
                <el-option label="NUMBER" value="NUMBER" />
                <el-option label="BOOLEAN" value="BOOLEAN" />
                <el-option label="JSON" value="JSON" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="可见性">
              <el-select v-model="configForm.visibility" style="width: 100%">
                <el-option label="ADMIN" value="ADMIN" />
                <el-option label="PUBLIC" value="PUBLIC" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12"><el-form-item label="状态"><el-switch v-model="configForm.status" :active-value="1" :inactive-value="0" /></el-form-item></el-col>
          <el-col :span="24"><el-form-item label="配置值"><el-input v-model="configForm.configValue" type="textarea" :rows="5" /></el-form-item></el-col>
          <el-col :span="24"><el-form-item label="备注"><el-input v-model="configForm.remark" /></el-form-item></el-col>
        </el-row>
      </el-form>
      <template #footer>
        <el-button @click="configDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="configSaving" @click="saveConfig">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="genesisDialogVisible" :title="genesisForm.id ? '编辑 Genesis 系列' : '新增 Genesis 系列'" width="760px">
      <el-form :model="genesisForm" label-width="118px">
        <el-row :gutter="16">
          <el-col :span="12"><el-form-item label="系列编码"><el-input v-model="genesisForm.seriesCode" :disabled="!!genesisForm.id" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="名称"><el-input v-model="genesisForm.name" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="总量"><el-input-number v-model="genesisForm.totalSupply" :min="1" style="width: 100%" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="价格 USDT"><el-input-number v-model="genesisForm.priceUsdt" :min="0" :precision="6" style="width: 100%" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="版税 BPS"><el-input-number v-model="genesisForm.royaltyBps" :min="0" style="width: 100%" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="状态"><el-input v-model="genesisForm.status" /></el-form-item></el-col>
          <el-col :span="12">
            <el-form-item label="开始时间"><el-date-picker v-model="genesisForm.saleStartAt" type="datetime" value-format="YYYY-MM-DDTHH:mm:ss" style="width: 100%" /></el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="结束时间"><el-date-picker v-model="genesisForm.saleEndAt" type="datetime" value-format="YYYY-MM-DDTHH:mm:ss" style="width: 100%" /></el-form-item>
          </el-col>
          <el-col :span="24"><el-form-item label="封面 URL"><el-input v-model="genesisForm.coverUrl" /></el-form-item></el-col>
          <el-col :span="24"><el-form-item label="元数据 JSON"><el-input v-model="genesisForm.metadataJson" type="textarea" :rows="4" /></el-form-item></el-col>
        </el-row>
      </el-form>
      <template #footer>
        <el-button @click="genesisDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="genesisSaving" @click="saveGenesis">保存</el-button>
      </template>
    </el-dialog>

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
  </div>
</template>

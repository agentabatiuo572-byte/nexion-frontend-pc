<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import {
  activateDevice,
  createProduct,
  deactivateDevice,
  getComputeDevices,
  getDeviceFleetConfig,
  getDeviceLifecycleConfig,
  getProducts,
  scheduleDeviceDeactivation,
  updateProduct,
  type DeviceLifecycleRule,
  type Product,
  type UserDevice
} from '@/apis/operation'
import type { Id } from '@/types/common'
import { formatTableDateTime } from '@/utils/date'
import { localeText as lt, enumLabel, enumOptions, enumTableFormatter } from '@/utils/i18n'
import ObjectImageUpload from '@/components/ObjectImageUpload.vue'
import UserSelect from '@/components/UserSelect.vue'

const loading = ref(false)
const products = ref<Product[]>([])
const productTotal = ref(0)
const devices = ref<UserDevice[]>([])
const deviceTotal = ref(0)
const maxActiveSlots = ref<number | null>(null)
const lifecycleRules = ref<DeviceLifecycleRule[]>([])

const productQuery = reactive({ current: 1, size: 10, keyword: '', productType: '', status: '' })
const deviceQuery = reactive({ current: 1, size: 10, userId: '', sourceOrderNo: '', status: '' })
const productStatusOptions = ['ACTIVE', 'INACTIVE']
const productTypeOptions = ['DEVICE', 'GENESIS', 'ACCESSORY']
const deviceStatusOptions = ['ONLINE', 'BUSY', 'INACTIVE', 'OFFLINE']

const productDialogVisible = ref(false)
const productSaving = ref(false)
const productForm = reactive({
  id: undefined as Id | undefined,
  productNo: '',
  name: '',
  productType: 'DEVICE',
  tier: '',
  status: 'ACTIVE',
  priceUsdt: 0,
  hashrate: 0,
  estimatedDailyUsdt: 0,
  dailyNex: 0,
  stock: 0,
  coverUrl: ''
})

function productIndex(index: number) {
  return (productQuery.current - 1) * productQuery.size + index + 1
}

function deviceIndex(index: number) {
  return (deviceQuery.current - 1) * deviceQuery.size + index + 1
}

function percent(value: unknown) {
  const num = Number(value ?? 0)
  return Number.isFinite(num) ? `${(num * 100).toFixed(1)}%` : '-'
}

function resetProductForm() {
  Object.assign(productForm, {
    id: undefined,
    productNo: '',
    name: '',
    productType: 'DEVICE',
    tier: '',
    status: 'ACTIVE',
    priceUsdt: 0,
    hashrate: 0,
    estimatedDailyUsdt: 0,
    dailyNex: 0,
    stock: 0,
    coverUrl: ''
  })
}

function openProductDialog(row?: Product) {
  resetProductForm()
  if (row) {
    Object.assign(productForm, {
      id: row.id,
      productNo: row.productNo || '',
      name: row.name || '',
      productType: row.productType || 'DEVICE',
      tier: row.tier || '',
      status: row.status || 'ACTIVE',
      priceUsdt: Number(row.priceUsdt ?? 0),
      hashrate: Number(row.hashrate ?? 0),
      estimatedDailyUsdt: Number(row.estimatedDailyUsdt ?? 0),
      dailyNex: Number(row.dailyNex ?? 0),
      stock: Number(row.stock ?? 0),
      coverUrl: row.coverUrl || ''
    })
  }
  productDialogVisible.value = true
}

function productPayload() {
  return {
    productNo: productForm.productNo,
    name: productForm.name,
    productType: productForm.productType,
    tier: productForm.tier,
    status: productForm.status,
    priceUsdt: productForm.priceUsdt,
    hashrate: productForm.hashrate,
    estimatedDailyUsdt: productForm.estimatedDailyUsdt,
    dailyNex: productForm.dailyNex,
    stock: productForm.stock,
    coverUrl: productForm.coverUrl
  }
}

async function saveProduct() {
  if (!productForm.name || !productForm.productType || !productForm.status) {
    ElMessage.warning(lt('请补全商品名称、类型和状态', 'Please complete product name, type, and status'))
    return
  }
  if (!productForm.id && !productForm.productNo) {
    ElMessage.warning(lt('请填写商品编号', 'Please enter product no.'))
    return
  }
  productSaving.value = true
  try {
    if (productForm.id) {
      const { productNo: _productNo, ...payload } = productPayload()
      await updateProduct(productForm.id, payload)
      ElMessage.success(lt('SKU 已更新', 'SKU updated'))
    } else {
      await createProduct(productPayload())
      ElMessage.success(lt('SKU 已创建', 'SKU created'))
    }
    productDialogVisible.value = false
    await loadData()
  } finally {
    productSaving.value = false
  }
}

async function runDeviceAction(id: Id | undefined, action: 'activate' | 'deactivate' | 'schedule') {
  if (!id) return
  if (action === 'activate') await activateDevice(id)
  if (action === 'deactivate') await deactivateDevice(id)
  if (action === 'schedule') await scheduleDeviceDeactivation(id)
  ElMessage.success(lt('设备状态已提交', 'Device status submitted'))
  await loadData()
}

async function loadData() {
  loading.value = true
  try {
    const [productRes, deviceRes, fleetRes, lifecycleRes] = await Promise.allSettled([
      getProducts(productQuery),
      getComputeDevices(deviceQuery),
      getDeviceFleetConfig({ silentError: true }),
      getDeviceLifecycleConfig({ silentError: true })
    ])
    products.value = productRes.status === 'fulfilled' ? productRes.value.records : []
    productTotal.value = productRes.status === 'fulfilled' ? productRes.value.total : 0
    devices.value = deviceRes.status === 'fulfilled' ? deviceRes.value.records : []
    deviceTotal.value = deviceRes.status === 'fulfilled' ? deviceRes.value.total : 0
    maxActiveSlots.value = fleetRes.status === 'fulfilled' ? fleetRes.value.maxActiveSlots : null
    lifecycleRules.value = lifecycleRes.status === 'fulfilled' ? lifecycleRes.value.rules : []
  } finally {
    loading.value = false
  }
}

function resetProductQuery() {
  Object.assign(productQuery, { current: 1, keyword: '', productType: '', status: '' })
  loadData()
}

function resetDeviceQuery() {
  Object.assign(deviceQuery, { current: 1, userId: '', sourceOrderNo: '', status: '' })
  loadData()
}

onMounted(loadData)
</script>

<template>
  <div>
    <el-row :gutter="16" class="app-card">
      <el-col :xs="24" :sm="12" :md="8">
        <el-card shadow="never" class="stat-card">
          <div class="table-toolbar">
            <span>{{ lt('最大激活槽位', 'Max Active Slots') }}</span>
            <el-icon color="#409eff" :size="24"><Grid /></el-icon>
          </div>
          <div class="value">{{ maxActiveSlots ?? '-' }}</div>
        </el-card>
      </el-col>
      <el-col :xs="24" :sm="12" :md="8">
        <el-card shadow="never" class="stat-card">
          <div class="table-toolbar">
            <span>{{ lt('生命周期规则', 'Lifecycle Rules') }}</span>
            <el-icon color="#67c23a" :size="24"><Timer /></el-icon>
          </div>
          <div class="value">{{ lifecycleRules.length }}</div>
        </el-card>
      </el-col>
      <el-col :xs="24" :sm="12" :md="8">
        <el-card shadow="never" class="stat-card">
          <div class="table-toolbar">
            <span>{{ lt('设备实例', 'Device Instances') }}</span>
            <el-icon color="#e6a23c" :size="24"><Cpu /></el-icon>
          </div>
          <div class="value">{{ deviceTotal }}</div>
        </el-card>
      </el-col>
    </el-row>

    <el-card class="app-card" shadow="never">
      <div class="table-toolbar">
        <span>{{ lt('商品 SKU', 'Product SKU') }}</span>
        <div>
          <el-button :icon="'Refresh'" @click="loadData">{{ lt('刷新', 'Refresh') }}</el-button>
          <el-button type="primary" :icon="'Plus'" @click="openProductDialog()">{{ lt('新增 SKU', 'New SKU') }}</el-button>
        </div>
      </div>
      <el-form :inline="true" :model="productQuery" class="filter-form">
        <el-form-item :label="lt('关键词', 'Keyword')"><el-input v-model="productQuery.keyword" clearable /></el-form-item>
        <el-form-item :label="lt('类型', 'Type')">
          <el-select v-model="productQuery.productType" clearable style="width: 140px">
            <el-option v-for="type in enumOptions(productTypeOptions)" :key="type.value" :label="type.label" :value="type.value" />
          </el-select>
        </el-form-item>
        <el-form-item :label="lt('状态', 'Status')">
          <el-select v-model="productQuery.status" clearable style="width: 140px">
            <el-option v-for="status in enumOptions(productStatusOptions)" :key="status.value" :label="status.label" :value="status.value" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="productQuery.current = 1; loadData()">{{ lt('查询', 'Search') }}</el-button>
          <el-button @click="resetProductQuery">{{ lt('重置', 'Reset') }}</el-button>
        </el-form-item>
      </el-form>
      <el-table v-loading="loading" :data="products" border>
        <el-table-column type="index" :index="productIndex" :label="lt('编号', 'No.')" width="80" />
        <el-table-column prop="productNo" label="SKU" min-width="150" />
        <el-table-column prop="name" :label="lt('名称', 'Name')" min-width="160" />
        <el-table-column prop="productType" :label="lt('类型', 'Type')" width="130" :formatter="enumTableFormatter" />
        <el-table-column prop="tier" :label="lt('档位', 'Tier')" width="110" />
        <el-table-column prop="priceUsdt" :label="lt('价格 USDT', 'Price USDT')" width="130" />
        <el-table-column prop="estimatedDailyUsdt" :label="lt('日收益 USDT', 'Daily USDT')" width="140" />
        <el-table-column prop="dailyNex" :label="lt('日收益 NEX', 'Daily NEX')" width="130" />
        <el-table-column prop="stock" :label="lt('库存', 'Stock')" width="90" />
        <el-table-column :label="lt('状态', 'Status')" width="110">
          <template #default="{ row }"><el-tag :type="row.status === 'ACTIVE' ? 'success' : 'info'">{{ enumLabel(row.status) }}</el-tag></template>
        </el-table-column>
        <el-table-column :label="lt('操作', 'Actions')" width="110" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" :icon="'Edit'" @click="openProductDialog(row)">{{ lt('编辑', 'Edit') }}</el-button>
          </template>
        </el-table-column>
      </el-table>
      <div class="pagination-wrap">
        <el-pagination
          v-model:current-page="productQuery.current"
          v-model:page-size="productQuery.size"
          layout="total, sizes, prev, pager, next"
          :total="productTotal"
          @current-change="loadData"
          @size-change="loadData"
        />
      </div>
    </el-card>

    <el-card class="app-card" shadow="never">
      <template #header>{{ lt('用户设备实例', 'User Device Instances') }}</template>
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
          <el-button @click="resetDeviceQuery">{{ lt('重置', 'Reset') }}</el-button>
        </el-form-item>
      </el-form>
      <el-table v-loading="loading" :data="devices" border>
        <el-table-column type="index" :index="deviceIndex" :label="lt('编号', 'No.')" width="80" />
        <el-table-column prop="userId" :label="lt('用户ID', 'User ID')" width="100" />
        <el-table-column prop="instanceNo" :label="lt('实例编号', 'Instance No.')" min-width="170" />
        <el-table-column prop="name" :label="lt('名称', 'Name')" min-width="150" />
        <el-table-column prop="productTier" :label="lt('档位', 'Tier')" width="90" />
        <el-table-column prop="deviceType" :label="lt('类型', 'Type')" width="120" :formatter="enumTableFormatter" />
        <el-table-column prop="status" :label="lt('状态', 'Status')" width="110" :formatter="enumTableFormatter" />
        <el-table-column :label="lt('待停用', 'Pending Stop')" width="90">
          <template #default="{ row }">
            <el-tag :type="row.pendingDeactivate ? 'warning' : 'info'" effect="plain">
              {{ row.pendingDeactivate ? lt('是', 'Yes') : lt('否', 'No') }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="monthsOwned" :label="lt('持有月', 'Months Owned')" width="90" />
        <el-table-column :label="lt('当前效率', 'Current Efficiency')" width="110">
          <template #default="{ row }">{{ percent(row.currentEfficiency) }}</template>
        </el-table-column>
        <el-table-column prop="effectiveDailyUsdt" :label="lt('有效 USDT/日', 'Effective USDT/Day')" width="140" />
        <el-table-column prop="effectiveDailyNex" :label="lt('有效 NEX/日', 'Effective NEX/Day')" width="140" />
        <el-table-column prop="sourceOrderNo" :label="lt('来源订单', 'Source Order')" min-width="160" />
        <el-table-column prop="purchasedAt" :label="lt('购买时间', 'Purchased At')" min-width="170" :formatter="formatTableDateTime" />
        <el-table-column prop="activatedAt" :label="lt('激活时间', 'Activated At')" min-width="170" :formatter="formatTableDateTime" />
        <el-table-column :label="lt('操作', 'Actions')" width="210" fixed="right">
          <template #default="{ row }">
            <el-button link type="success" :disabled="row.status !== 'INACTIVE'" @click="runDeviceAction(row.id, 'activate')">
              {{ lt('激活', 'Activate') }}
            </el-button>
            <el-button link type="warning" :disabled="row.status === 'INACTIVE'" @click="runDeviceAction(row.id, 'schedule')">
              {{ lt('排队停用', 'Schedule Stop') }}
            </el-button>
            <el-button link type="danger" :disabled="row.status === 'INACTIVE'" @click="runDeviceAction(row.id, 'deactivate')">
              {{ lt('停用', 'Deactivate') }}
            </el-button>
          </template>
        </el-table-column>
      </el-table>
      <div class="pagination-wrap">
        <el-pagination
          v-model:current-page="deviceQuery.current"
          v-model:page-size="deviceQuery.size"
          layout="total, sizes, prev, pager, next"
          :total="deviceTotal"
          @current-change="loadData"
          @size-change="loadData"
        />
      </div>
    </el-card>

    <el-dialog v-model="productDialogVisible" :title="productForm.id ? lt('编辑 SKU', 'Edit SKU') : lt('新增 SKU', 'New SKU')" width="720px">
      <el-form :model="productForm" label-width="118px">
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item :label="lt('商品编号', 'Product No.')"><el-input v-model="productForm.productNo" :disabled="!!productForm.id" /></el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item :label="lt('商品名称', 'Product Name')"><el-input v-model="productForm.name" /></el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item :label="lt('商品类型', 'Product Type')">
              <el-select v-model="productForm.productType" style="width: 100%">
                <el-option v-for="type in enumOptions(productTypeOptions)" :key="type.value" :label="type.label" :value="type.value" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item :label="lt('档位', 'Tier')"><el-input v-model="productForm.tier" /></el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item :label="lt('状态', 'Status')">
              <el-select v-model="productForm.status" style="width: 100%">
                <el-option v-for="status in enumOptions(productStatusOptions)" :key="status.value" :label="status.label" :value="status.value" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item :label="lt('库存', 'Stock')"><el-input-number v-model="productForm.stock" :min="0" style="width: 100%" /></el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item :label="lt('价格 USDT', 'Price USDT')"><el-input-number v-model="productForm.priceUsdt" :min="0" :precision="6" style="width: 100%" /></el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item :label="lt('算力', 'Hashrate')"><el-input-number v-model="productForm.hashrate" :min="0" :precision="6" style="width: 100%" /></el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item :label="lt('日收益 USDT', 'Daily USDT')"><el-input-number v-model="productForm.estimatedDailyUsdt" :min="0" :precision="6" style="width: 100%" /></el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item :label="lt('日收益 NEX', 'Daily NEX')"><el-input-number v-model="productForm.dailyNex" :min="0" :precision="6" style="width: 100%" /></el-form-item>
          </el-col>
          <el-col :span="24">
            <el-form-item :label="lt('商品封面', 'Product Cover')">
              <ObjectImageUpload
                v-model="productForm.coverUrl"
                media-type="COVER"
                empty-:title="lt('上传商品封面', 'Upload Product Cover')"
                :empty-description="lt('拖拽或点击上传商品封面，支持 PNG/JPG/WebP', 'Drag or click to upload product cover, PNG/JPG/WebP supported')"
              />
            </el-form-item>
          </el-col>
        </el-row>
      </el-form>
      <template #footer>
        <el-button @click="productDialogVisible = false">{{ lt('取消', 'Cancel') }}</el-button>
        <el-button type="primary" :loading="productSaving" @click="saveProduct">{{ lt('保存', 'Save') }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

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

const loading = ref(false)
const products = ref<Product[]>([])
const productTotal = ref(0)
const devices = ref<UserDevice[]>([])
const deviceTotal = ref(0)
const maxActiveSlots = ref<number | null>(null)
const lifecycleRules = ref<DeviceLifecycleRule[]>([])

const productQuery = reactive({ current: 1, size: 10, keyword: '', productType: '', status: '' })
const deviceQuery = reactive({ current: 1, size: 10, userId: '', sourceOrderNo: '', status: '' })

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
    ElMessage.warning('请补全商品名称、类型和状态')
    return
  }
  if (!productForm.id && !productForm.productNo) {
    ElMessage.warning('请填写商品编号')
    return
  }
  productSaving.value = true
  try {
    if (productForm.id) {
      const { productNo: _productNo, ...payload } = productPayload()
      await updateProduct(productForm.id, payload)
      ElMessage.success('SKU 已更新')
    } else {
      await createProduct(productPayload())
      ElMessage.success('SKU 已创建')
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
  ElMessage.success('设备状态已提交')
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
            <span>最大激活槽位</span>
            <el-icon color="#409eff" :size="24"><Grid /></el-icon>
          </div>
          <div class="value">{{ maxActiveSlots ?? '-' }}</div>
        </el-card>
      </el-col>
      <el-col :xs="24" :sm="12" :md="8">
        <el-card shadow="never" class="stat-card">
          <div class="table-toolbar">
            <span>生命周期规则</span>
            <el-icon color="#67c23a" :size="24"><Timer /></el-icon>
          </div>
          <div class="value">{{ lifecycleRules.length }}</div>
        </el-card>
      </el-col>
      <el-col :xs="24" :sm="12" :md="8">
        <el-card shadow="never" class="stat-card">
          <div class="table-toolbar">
            <span>设备实例</span>
            <el-icon color="#e6a23c" :size="24"><Cpu /></el-icon>
          </div>
          <div class="value">{{ deviceTotal }}</div>
        </el-card>
      </el-col>
    </el-row>

    <el-card class="app-card" shadow="never">
      <div class="table-toolbar">
        <span>商品 SKU</span>
        <div>
          <el-button :icon="'Refresh'" @click="loadData">刷新</el-button>
          <el-button type="primary" :icon="'Plus'" @click="openProductDialog()">新增 SKU</el-button>
        </div>
      </div>
      <el-form :inline="true" :model="productQuery" class="filter-form">
        <el-form-item label="关键词"><el-input v-model="productQuery.keyword" clearable /></el-form-item>
        <el-form-item label="类型"><el-input v-model="productQuery.productType" clearable /></el-form-item>
        <el-form-item label="状态">
          <el-select v-model="productQuery.status" clearable style="width: 140px">
            <el-option label="ACTIVE" value="ACTIVE" />
            <el-option label="INACTIVE" value="INACTIVE" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="productQuery.current = 1; loadData()">查询</el-button>
          <el-button @click="resetProductQuery">重置</el-button>
        </el-form-item>
      </el-form>
      <el-table v-loading="loading" :data="products" border>
        <el-table-column type="index" :index="productIndex" label="编号" width="80" />
        <el-table-column prop="productNo" label="SKU" min-width="150" />
        <el-table-column prop="name" label="名称" min-width="160" />
        <el-table-column prop="productType" label="类型" width="130" />
        <el-table-column prop="tier" label="档位" width="110" />
        <el-table-column prop="priceUsdt" label="价格 USDT" width="130" />
        <el-table-column prop="estimatedDailyUsdt" label="日收益 USDT" width="140" />
        <el-table-column prop="dailyNex" label="日收益 NEX" width="130" />
        <el-table-column prop="stock" label="库存" width="90" />
        <el-table-column prop="status" label="状态" width="110" />
        <el-table-column label="操作" width="110" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" :icon="'Edit'" @click="openProductDialog(row)">编辑</el-button>
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
      <template #header>用户设备实例</template>
      <el-form :inline="true" :model="deviceQuery" class="filter-form">
        <el-form-item label="用户ID"><el-input v-model="deviceQuery.userId" clearable /></el-form-item>
        <el-form-item label="来源订单"><el-input v-model="deviceQuery.sourceOrderNo" clearable /></el-form-item>
        <el-form-item label="状态">
          <el-select v-model="deviceQuery.status" clearable style="width: 150px">
            <el-option label="ONLINE" value="ONLINE" />
            <el-option label="BUSY" value="BUSY" />
            <el-option label="INACTIVE" value="INACTIVE" />
            <el-option label="OFFLINE" value="OFFLINE" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="deviceQuery.current = 1; loadData()">查询</el-button>
          <el-button @click="resetDeviceQuery">重置</el-button>
        </el-form-item>
      </el-form>
      <el-table v-loading="loading" :data="devices" border>
        <el-table-column type="index" :index="deviceIndex" label="编号" width="80" />
        <el-table-column prop="userId" label="用户ID" width="100" />
        <el-table-column prop="instanceNo" label="实例编号" min-width="170" />
        <el-table-column prop="name" label="名称" min-width="150" />
        <el-table-column prop="productTier" label="档位" width="90" />
        <el-table-column prop="deviceType" label="类型" width="120" />
        <el-table-column prop="status" label="状态" width="110" />
        <el-table-column label="待停用" width="90">
          <template #default="{ row }">
            <el-tag :type="row.pendingDeactivate ? 'warning' : 'info'" effect="plain">
              {{ row.pendingDeactivate ? '是' : '否' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="monthsOwned" label="持有月" width="90" />
        <el-table-column label="当前效率" width="110">
          <template #default="{ row }">{{ percent(row.currentEfficiency) }}</template>
        </el-table-column>
        <el-table-column prop="effectiveDailyUsdt" label="有效 USDT/日" width="140" />
        <el-table-column prop="effectiveDailyNex" label="有效 NEX/日" width="140" />
        <el-table-column prop="sourceOrderNo" label="来源订单" min-width="160" />
        <el-table-column prop="purchasedAt" label="购买时间" min-width="170" />
        <el-table-column prop="activatedAt" label="激活时间" min-width="170" />
        <el-table-column label="操作" width="210" fixed="right">
          <template #default="{ row }">
            <el-button link type="success" :disabled="row.status !== 'INACTIVE'" @click="runDeviceAction(row.id, 'activate')">
              激活
            </el-button>
            <el-button link type="warning" :disabled="row.status === 'INACTIVE'" @click="runDeviceAction(row.id, 'schedule')">
              排队停用
            </el-button>
            <el-button link type="danger" :disabled="row.status === 'INACTIVE'" @click="runDeviceAction(row.id, 'deactivate')">
              停用
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

    <el-dialog v-model="productDialogVisible" :title="productForm.id ? '编辑 SKU' : '新增 SKU'" width="720px">
      <el-form :model="productForm" label-width="118px">
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="商品编号"><el-input v-model="productForm.productNo" :disabled="!!productForm.id" /></el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="商品名称"><el-input v-model="productForm.name" /></el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="商品类型"><el-input v-model="productForm.productType" /></el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="档位"><el-input v-model="productForm.tier" /></el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="状态">
              <el-select v-model="productForm.status" style="width: 100%">
                <el-option label="ACTIVE" value="ACTIVE" />
                <el-option label="INACTIVE" value="INACTIVE" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="库存"><el-input-number v-model="productForm.stock" :min="0" style="width: 100%" /></el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="价格 USDT"><el-input-number v-model="productForm.priceUsdt" :min="0" :precision="6" style="width: 100%" /></el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="算力"><el-input-number v-model="productForm.hashrate" :min="0" :precision="6" style="width: 100%" /></el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="日收益 USDT"><el-input-number v-model="productForm.estimatedDailyUsdt" :min="0" :precision="6" style="width: 100%" /></el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="日收益 NEX"><el-input-number v-model="productForm.dailyNex" :min="0" :precision="6" style="width: 100%" /></el-form-item>
          </el-col>
          <el-col :span="24">
            <el-form-item label="封面 URL"><el-input v-model="productForm.coverUrl" /></el-form-item>
          </el-col>
        </el-row>
      </el-form>
      <template #footer>
        <el-button @click="productDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="productSaving" @click="saveProduct">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

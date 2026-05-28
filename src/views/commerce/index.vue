<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  createProduct,
  expirePendingPayments,
  getCommerceOpsStats,
  getCommerceOrders,
  getCommercePayments,
  getPaymentAnomalies,
  getProducts,
  getTradeins,
  reconcileDuePayments,
  reconcilePayment,
  updateProduct,
  type Product
} from '@/apis/operation'
import type { AnyRecord, Id } from '@/types/common'

const props = withDefaults(defineProps<{ defaultTab?: string }>(), { defaultTab: 'products' })

const activeTab = ref(props.defaultTab)
const loading = ref(false)
const actionLoading = ref(false)
const stats = ref<AnyRecord | null>(null)
const products = ref<Product[]>([])
const productTotal = ref(0)
const orders = ref<AnyRecord[]>([])
const orderTotal = ref(0)
const payments = ref<AnyRecord[]>([])
const paymentTotal = ref(0)
const anomalies = ref<AnyRecord[]>([])
const tradeins = ref<AnyRecord[]>([])
const tradeinTotal = ref(0)
const detailVisible = ref(false)
const detailTitle = ref('详情')
const detailRecord = ref<AnyRecord | null>(null)

const productQuery = reactive({ current: 1, size: 10, keyword: '', productType: '', status: '' })
const orderQuery = reactive({ current: 1, size: 10, userId: '', orderNo: '', paymentStatus: '', orderStatus: '' })
const paymentQuery = reactive({ current: 1, size: 10, userId: '', orderNo: '', paymentNo: '', provider: '', paymentStatus: '' })
const tradeinQuery = reactive({ current: 1, size: 10, userId: '', status: '' })
const opsLimit = ref(20)

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

function valueOf(record: AnyRecord | null, key: string) {
  const value = record?.[key]
  return value == null || value === '' ? '-' : String(value)
}

function pageIndex(query: { current: number; size: number }, index: number) {
  return (query.current - 1) * query.size + index + 1
}

function showDetail(title: string, row: AnyRecord) {
  detailTitle.value = title
  detailRecord.value = row
  detailVisible.value = true
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
    ElMessage.warning('请填写 SKU 编号')
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
    await loadProducts()
  } finally {
    productSaving.value = false
  }
}

async function loadStats() {
  stats.value = await getCommerceOpsStats(7, { silentError: true }).catch(() => null)
}

async function loadProducts() {
  const page = await getProducts(productQuery)
  products.value = page.records
  productTotal.value = page.total
}

async function loadOrders() {
  const page = await getCommerceOrders(orderQuery)
  orders.value = page.records
  orderTotal.value = page.total
}

async function loadPayments() {
  const [page, anomalyRows] = await Promise.all([
    getCommercePayments(paymentQuery),
    getPaymentAnomalies(opsLimit.value, { silentError: true }).catch(() => [])
  ])
  payments.value = page.records
  paymentTotal.value = page.total
  anomalies.value = anomalyRows
}

async function loadTradeins() {
  const page = await getTradeins(tradeinQuery)
  tradeins.value = page.records
  tradeinTotal.value = page.total
}

async function loadActiveTab() {
  if (activeTab.value === 'products') await loadProducts()
  if (activeTab.value === 'orders') await loadOrders()
  if (activeTab.value === 'payments') await loadPayments()
  if (activeTab.value === 'tradeins') await loadTradeins()
}

async function loadData() {
  loading.value = true
  try {
    await Promise.all([loadStats(), loadActiveTab()])
  } finally {
    loading.value = false
  }
}

async function runPaymentAction(action: 'expire' | 'reconcileDue' | 'reconcileOne', paymentNo?: string) {
  if (action === 'reconcileOne' && !paymentNo) return
  const message = action === 'reconcileOne'
    ? `确认对账支付单 ${paymentNo}?`
    : action === 'expire'
      ? `确认批量过期待支付记录? 本次最多 ${opsLimit.value} 条`
      : `确认批量对账到期支付记录? 本次最多 ${opsLimit.value} 条`
  await ElMessageBox.confirm(message, '支付运营操作', { type: 'warning' })
  actionLoading.value = true
  try {
    const result = action === 'expire'
      ? await expirePendingPayments(opsLimit.value)
      : action === 'reconcileDue'
        ? await reconcileDuePayments(opsLimit.value)
        : await reconcilePayment(paymentNo as string)
    ElMessage.success(`操作完成: ${JSON.stringify(result)}`)
    await loadPayments()
    await loadStats()
  } finally {
    actionLoading.value = false
  }
}

function resetProducts() {
  Object.assign(productQuery, { current: 1, keyword: '', productType: '', status: '' })
  loadData()
}

function resetOrders() {
  Object.assign(orderQuery, { current: 1, userId: '', orderNo: '', paymentStatus: '', orderStatus: '' })
  loadData()
}

function resetPayments() {
  Object.assign(paymentQuery, { current: 1, userId: '', orderNo: '', paymentNo: '', provider: '', paymentStatus: '' })
  loadData()
}

function resetTradeins() {
  Object.assign(tradeinQuery, { current: 1, userId: '', status: '' })
  loadData()
}

watch(() => props.defaultTab, (value) => {
  activeTab.value = value
})

watch(activeTab, () => {
  loadData()
})

onMounted(loadData)
</script>

<template>
  <div>
    <el-row :gutter="16" class="app-card">
      <el-col :xs="24" :sm="12" :md="6">
        <el-card shadow="never" class="stat-card">
          <div class="table-toolbar"><span>订单数</span><el-icon color="#409eff" :size="24"><Tickets /></el-icon></div>
          <div class="value">{{ valueOf(stats, 'orders') }}</div>
        </el-card>
      </el-col>
      <el-col :xs="24" :sm="12" :md="6">
        <el-card shadow="never" class="stat-card">
          <div class="table-toolbar"><span>支付数</span><el-icon color="#67c23a" :size="24"><CreditCard /></el-icon></div>
          <div class="value">{{ valueOf(stats, 'payments') }}</div>
        </el-card>
      </el-col>
      <el-col :xs="24" :sm="12" :md="6">
        <el-card shadow="never" class="stat-card">
          <div class="table-toolbar"><span>Trade-in</span><el-icon color="#e6a23c" :size="24"><Refresh /></el-icon></div>
          <div class="value">{{ valueOf(stats, 'tradeins') }}</div>
        </el-card>
      </el-col>
      <el-col :xs="24" :sm="12" :md="6">
        <el-card shadow="never" class="stat-card">
          <div class="table-toolbar"><span>Genesis</span><el-icon color="#f56c6c" :size="24"><Star /></el-icon></div>
          <div class="value">{{ valueOf(stats, 'genesisOrders') }}</div>
        </el-card>
      </el-col>
    </el-row>

    <el-card shadow="never">
      <div class="table-toolbar">
        <span>商城交易</span>
        <el-button :icon="'Refresh'" @click="loadData">刷新</el-button>
      </div>

      <el-tabs v-model="activeTab">
        <el-tab-pane label="商品 SKU" name="products">
          <div class="table-toolbar">
            <span>SKU 价格、收益基线、库存与状态</span>
            <el-button type="primary" :icon="'Plus'" @click="openProductDialog()">新增 SKU</el-button>
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
              <el-button @click="resetProducts">重置</el-button>
            </el-form-item>
          </el-form>
          <el-table v-loading="loading" :data="products" border>
            <el-table-column type="index" :index="(index: number) => pageIndex(productQuery, index)" label="编号" width="80" />
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
              <template #default="{ row }"><el-button link type="primary" @click="openProductDialog(row)">编辑</el-button></template>
            </el-table-column>
          </el-table>
          <div class="pagination-wrap">
            <el-pagination v-model:current-page="productQuery.current" v-model:page-size="productQuery.size" layout="total, sizes, prev, pager, next" :total="productTotal" @current-change="loadData" @size-change="loadData" />
          </div>
        </el-tab-pane>

        <el-tab-pane label="订单" name="orders">
          <el-form :inline="true" :model="orderQuery" class="filter-form">
            <el-form-item label="用户ID"><el-input v-model="orderQuery.userId" clearable /></el-form-item>
            <el-form-item label="订单号"><el-input v-model="orderQuery.orderNo" clearable /></el-form-item>
            <el-form-item label="支付状态"><el-input v-model="orderQuery.paymentStatus" clearable /></el-form-item>
            <el-form-item label="订单状态"><el-input v-model="orderQuery.orderStatus" clearable /></el-form-item>
            <el-form-item>
              <el-button type="primary" @click="orderQuery.current = 1; loadData()">查询</el-button>
              <el-button @click="resetOrders">重置</el-button>
            </el-form-item>
          </el-form>
          <el-table v-loading="loading" :data="orders" border>
            <el-table-column type="index" :index="(index: number) => pageIndex(orderQuery, index)" label="编号" width="80" />
            <el-table-column prop="orderNo" label="订单号" min-width="170" />
            <el-table-column prop="userId" label="用户ID" width="100" />
            <el-table-column prop="productId" label="商品ID" width="100" />
            <el-table-column prop="quantity" label="数量" width="80" />
            <el-table-column prop="amountUsdt" label="金额 USDT" width="130" />
            <el-table-column prop="paymentStatus" label="支付状态" width="120" />
            <el-table-column prop="activationStatus" label="激活状态" width="120" />
            <el-table-column prop="paymentNo" label="支付单号" min-width="170" />
            <el-table-column prop="createdAt" label="创建时间" min-width="170" />
            <el-table-column label="操作" width="90" fixed="right">
              <template #default="{ row }"><el-button link type="primary" @click="showDetail('订单详情', row)">详情</el-button></template>
            </el-table-column>
          </el-table>
          <div class="pagination-wrap">
            <el-pagination v-model:current-page="orderQuery.current" v-model:page-size="orderQuery.size" layout="total, sizes, prev, pager, next" :total="orderTotal" @current-change="loadData" @size-change="loadData" />
          </div>
        </el-tab-pane>

        <el-tab-pane label="支付与对账" name="payments">
          <div class="table-toolbar">
            <span>支付记录与异常</span>
            <div>
              <el-input-number v-model="opsLimit" :min="1" :max="200" style="width: 118px; margin-right: 10px" />
              <el-button :loading="actionLoading" @click="runPaymentAction('expire')">过期待支付</el-button>
              <el-button type="primary" :loading="actionLoading" @click="runPaymentAction('reconcileDue')">对账到期</el-button>
            </div>
          </div>
          <el-form :inline="true" :model="paymentQuery" class="filter-form">
            <el-form-item label="用户ID"><el-input v-model="paymentQuery.userId" clearable /></el-form-item>
            <el-form-item label="订单号"><el-input v-model="paymentQuery.orderNo" clearable /></el-form-item>
            <el-form-item label="支付单号"><el-input v-model="paymentQuery.paymentNo" clearable /></el-form-item>
            <el-form-item label="Provider"><el-input v-model="paymentQuery.provider" clearable /></el-form-item>
            <el-form-item label="状态"><el-input v-model="paymentQuery.paymentStatus" clearable /></el-form-item>
            <el-form-item>
              <el-button type="primary" @click="paymentQuery.current = 1; loadData()">查询</el-button>
              <el-button @click="resetPayments">重置</el-button>
            </el-form-item>
          </el-form>
          <el-table v-loading="loading" :data="payments" border>
            <el-table-column type="index" :index="(index: number) => pageIndex(paymentQuery, index)" label="编号" width="80" />
            <el-table-column prop="paymentNo" label="支付单号" min-width="170" />
            <el-table-column prop="orderNo" label="订单号" min-width="170" />
            <el-table-column prop="userId" label="用户ID" width="100" />
            <el-table-column prop="provider" label="Provider" width="110" />
            <el-table-column prop="amountUsdt" label="金额 USDT" width="130" />
            <el-table-column prop="currency" label="币种" width="90" />
            <el-table-column prop="paymentStatus" label="状态" width="120" />
            <el-table-column prop="expiresAt" label="过期时间" min-width="170" />
            <el-table-column label="操作" width="150" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" @click="showDetail('支付详情', row)">详情</el-button>
                <el-button link type="warning" @click="runPaymentAction('reconcileOne', String(row.paymentNo))">对账</el-button>
              </template>
            </el-table-column>
          </el-table>
          <div class="pagination-wrap">
            <el-pagination v-model:current-page="paymentQuery.current" v-model:page-size="paymentQuery.size" layout="total, sizes, prev, pager, next" :total="paymentTotal" @current-change="loadData" @size-change="loadData" />
          </div>
          <el-divider />
          <el-table v-loading="loading" :data="anomalies" border>
            <el-table-column prop="paymentNo" label="异常支付单" min-width="170" />
            <el-table-column prop="orderNo" label="订单号" min-width="170" />
            <el-table-column prop="reason" label="原因" min-width="220" />
            <el-table-column prop="paymentStatus" label="支付状态" width="120" />
            <el-table-column prop="orderPaymentStatus" label="订单支付状态" width="140" />
          </el-table>
        </el-tab-pane>

        <el-tab-pane label="Trade-in" name="tradeins">
          <el-form :inline="true" :model="tradeinQuery" class="filter-form">
            <el-form-item label="用户ID"><el-input v-model="tradeinQuery.userId" clearable /></el-form-item>
            <el-form-item label="状态"><el-input v-model="tradeinQuery.status" clearable /></el-form-item>
            <el-form-item>
              <el-button type="primary" @click="tradeinQuery.current = 1; loadData()">查询</el-button>
              <el-button @click="resetTradeins">重置</el-button>
            </el-form-item>
          </el-form>
          <el-table v-loading="loading" :data="tradeins" border>
            <el-table-column type="index" :index="(index: number) => pageIndex(tradeinQuery, index)" label="编号" width="80" />
            <el-table-column prop="tradeinNo" label="Trade-in 单号" min-width="170" />
            <el-table-column prop="userId" label="用户ID" width="100" />
            <el-table-column prop="sourceDeviceId" label="来源设备" width="120" />
            <el-table-column prop="sourceProductNo" label="来源 SKU" min-width="150" />
            <el-table-column prop="targetProductNo" label="目标 SKU" min-width="150" />
            <el-table-column prop="salvageUsdt" label="残值 USDT" width="130" />
            <el-table-column prop="discountUsdt" label="折扣 USDT" width="130" />
            <el-table-column prop="netUpgradeCostUsdt" label="升级净价" width="130" />
            <el-table-column prop="status" label="状态" width="110" />
            <el-table-column prop="createdAt" label="创建时间" min-width="170" />
            <el-table-column label="操作" width="90" fixed="right">
              <template #default="{ row }"><el-button link type="primary" @click="showDetail('Trade-in 详情', row)">详情</el-button></template>
            </el-table-column>
          </el-table>
          <div class="pagination-wrap">
            <el-pagination v-model:current-page="tradeinQuery.current" v-model:page-size="tradeinQuery.size" layout="total, sizes, prev, pager, next" :total="tradeinTotal" @current-change="loadData" @size-change="loadData" />
          </div>
        </el-tab-pane>
      </el-tabs>
    </el-card>

    <el-dialog v-model="productDialogVisible" :title="productForm.id ? '编辑 SKU' : '新增 SKU'" width="720px">
      <el-form :model="productForm" label-width="118px">
        <el-row :gutter="16">
          <el-col :span="12"><el-form-item label="SKU 编号"><el-input v-model="productForm.productNo" :disabled="!!productForm.id" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="商品名称"><el-input v-model="productForm.name" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="商品类型"><el-input v-model="productForm.productType" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="档位"><el-input v-model="productForm.tier" /></el-form-item></el-col>
          <el-col :span="12">
            <el-form-item label="状态">
              <el-select v-model="productForm.status" style="width: 100%">
                <el-option label="ACTIVE" value="ACTIVE" />
                <el-option label="INACTIVE" value="INACTIVE" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12"><el-form-item label="库存"><el-input-number v-model="productForm.stock" :min="0" style="width: 100%" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="价格 USDT"><el-input-number v-model="productForm.priceUsdt" :min="0" :precision="6" style="width: 100%" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="算力"><el-input-number v-model="productForm.hashrate" :min="0" :precision="6" style="width: 100%" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="日收益 USDT"><el-input-number v-model="productForm.estimatedDailyUsdt" :min="0" :precision="6" style="width: 100%" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="日收益 NEX"><el-input-number v-model="productForm.dailyNex" :min="0" :precision="6" style="width: 100%" /></el-form-item></el-col>
          <el-col :span="24"><el-form-item label="封面 URL"><el-input v-model="productForm.coverUrl" /></el-form-item></el-col>
        </el-row>
      </el-form>
      <template #footer>
        <el-button @click="productDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="productSaving" @click="saveProduct">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="detailVisible" :title="detailTitle" width="760px">
      <pre class="json-preview">{{ JSON.stringify(detailRecord, null, 2) }}</pre>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules, type UploadRequestOptions, type UploadUserFile } from 'element-plus'
import {
  createProduct,
  expirePendingPayments,
  getCommerceOpsStats,
  getCommerceOrders,
  getProductMediaPreviewUrl,
  getCommercePayments,
  getPaymentAnomalies,
  getProducts,
  getTradeins,
  reconcileDuePayments,
  reconcilePayment,
  updateProduct,
  uploadProductMedia,
  type Product
} from '@/apis/operation'
import type { AnyRecord, Id } from '@/types/common'
import { formatNow, formatTableDateTime } from '@/utils/date'
import { localeText as lt, enumLabel, enumOptions, enumTableFormatter } from '@/utils/i18n'
import UserSelect from '@/components/UserSelect.vue'
import ObjectDetails from '@/components/ObjectDetails.vue'

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
const detailTitle = ref(lt('详情', 'Details'))
const detailRecord = ref<AnyRecord | null>(null)

const productQuery = reactive({ current: 1, size: 10, keyword: '', productType: '', status: '' })
const orderQuery = reactive({ current: 1, size: 10, userId: '', orderNo: '', paymentStatus: '', orderStatus: '' })
const paymentQuery = reactive({ current: 1, size: 10, userId: '', orderNo: '', paymentNo: '', provider: '', paymentStatus: '' })
const tradeinQuery = reactive({ current: 1, size: 10, userId: '', status: '' })
const opsLimit = ref(20)
const paymentStatusOptions = ['PENDING', 'SUCCESS', 'FAILED', 'EXPIRED', 'REFUNDED']
const orderStatusOptions = ['CREATED', 'PAID', 'CANCELLED', 'EXPIRED', 'REFUNDED']
const tradeinStatusOptions = ['QUOTED', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED']

const productDialogVisible = ref(false)
const productSaving = ref(false)
const productMediaUploading = ref(false)
const productMediaPreviewUrls = reactive<Record<string, string>>({})
const productFormRef = ref<FormInstance>()
const lastProductAction = ref('')
const lastPaymentAction = ref('')
const productTypeOptions = ['NEXION_BOX', 'NEXION_RACK', 'MOBILE', 'CLOUD_SHARE', 'GENESIS']
const productStatusOptions = ['ON_SALE', 'OFF_SALE', 'SOLD_OUT', 'ARCHIVED']
const coverUploadTip = computed(() => lt('拖拽或点击上传封面图，支持 PNG/JPG/WebP，最大 5MB', 'Drag or click to upload cover image. PNG/JPG/WebP, max 5MB'))
const detailUploadTip = computed(() => lt('上传详情页图片，可上传多张，按展示顺序保存', 'Upload multiple detail images and save them in display order'))
const productForm = reactive({
  id: undefined as Id | undefined,
  productNo: '',
  name: '',
  productType: 'NEXION_BOX',
  tier: '',
  status: 'OFF_SALE',
  priceUsdt: 0,
  hashrate: 0,
  estimatedDailyUsdt: 0,
  dailyNex: 0,
  stock: 0,
  coverUrl: '',
  detailImageUrls: [] as string[]
})
const productRules: FormRules = {
  productNo: [{ required: true, message: lt('请填写 SKU 编号', 'Please enter SKU no.'), trigger: 'blur' }],
  name: [{ required: true, message: lt('请填写商品名称', 'Please enter product name'), trigger: 'blur' }],
  productType: [{ required: true, message: lt('请选择商品类型', 'Please select product type'), trigger: 'change' }],
  status: [{ required: true, message: lt('请选择状态', 'Please select status'), trigger: 'change' }],
  priceUsdt: [{ required: true, message: lt('请填写价格', 'Please enter price'), trigger: 'blur' }],
  stock: [{ required: true, message: lt('请填写库存', 'Please enter stock'), trigger: 'blur' }]
}

function valueOf(record: AnyRecord | null, key: string) {
  const value = key.split('.').reduce<unknown>((current, part) => {
    return current && typeof current === 'object' ? (current as AnyRecord)[part] : undefined
  }, record || undefined)
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
    productType: 'NEXION_BOX',
    tier: '',
    status: 'OFF_SALE',
    priceUsdt: 0,
    hashrate: 0,
    estimatedDailyUsdt: 0,
    dailyNex: 0,
    stock: 0,
    coverUrl: '',
    detailImageUrls: []
  })
}

function parseDetailImageUrls(value?: unknown) {
  if (!value) return []
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean)
  if (typeof value !== 'string') return []
  const trimmed = value.trim()
  if (!trimmed) return []
  try {
    const parsed = JSON.parse(trimmed)
    return Array.isArray(parsed) ? parsed.map((item) => String(item)).filter(Boolean) : []
  } catch {
    return trimmed.split(',').map((item) => item.trim()).filter(Boolean)
  }
}

function stringifyDetailImageUrls(values: string[]) {
  const normalized = values.map((item) => item.trim()).filter(Boolean)
  return JSON.stringify(normalized)
}

function productMediaName(objectKey: string) {
  return objectKey.split('/').pop() || objectKey
}

function mediaFileList(objectKeys: string[]): UploadUserFile[] {
  return objectKeys.map((objectKey, index) => ({
    name: productMediaName(objectKey) || `image-${index + 1}`,
    url: objectKey,
    status: 'success',
    uid: index + 1
  }))
}

function removeDetailImage(file: UploadUserFile) {
  const objectKey = String(file.url || '')
  if (!objectKey) return
  productForm.detailImageUrls = productForm.detailImageUrls.filter((item) => item !== objectKey)
}

function removeDetailImageByKey(objectKey: string) {
  productForm.detailImageUrls = productForm.detailImageUrls.filter((item) => item !== objectKey)
  delete productMediaPreviewUrls[objectKey]
}

function clearCoverImage() {
  if (productForm.coverUrl) {
    delete productMediaPreviewUrls[productForm.coverUrl]
  }
  productForm.coverUrl = ''
}

async function loadProductMediaPreviewUrl(objectKey: string) {
  if (!objectKey || productMediaPreviewUrls[objectKey]) return
  try {
    const response = await getProductMediaPreviewUrl(objectKey)
    if (response.downloadUrl) {
      productMediaPreviewUrls[objectKey] = response.downloadUrl
    }
  } catch {
    // 图片预览 URL 获取失败不影响 SKU 表单保存。
  }
}

function refreshProductMediaPreviews() {
  const objectKeys = [productForm.coverUrl, ...productForm.detailImageUrls].filter(Boolean)
  objectKeys.forEach((objectKey) => {
    void loadProductMediaPreviewUrl(objectKey)
  })
}

async function uploadProductImage(options: UploadRequestOptions, mediaType: 'COVER' | 'DETAIL') {
  productMediaUploading.value = true
  try {
    const response = await uploadProductMedia(mediaType, options.file)
    const objectKey = response.objectKey
    if (mediaType === 'COVER') {
      productForm.coverUrl = objectKey
    } else if (!productForm.detailImageUrls.includes(objectKey)) {
      productForm.detailImageUrls.push(objectKey)
    }
    if (response.downloadUrl) {
      productMediaPreviewUrls[objectKey] = response.downloadUrl
    }
    ElMessage.success(lt('图片已上传', 'Image uploaded'))
    options.onSuccess?.(response)
  } catch (error) {
    options.onError?.(error as never)
  } finally {
    productMediaUploading.value = false
  }
}

function uploadCoverImage(options: UploadRequestOptions) {
  return uploadProductImage(options, 'COVER')
}

function uploadDetailImage(options: UploadRequestOptions) {
  return uploadProductImage(options, 'DETAIL')
}

async function openMediaPreview(objectKey: string) {
  if (!objectKey) return
  try {
    const response = await getProductMediaPreviewUrl(objectKey)
    if (response.downloadUrl) {
      window.open(response.downloadUrl, '_blank', 'noopener,noreferrer')
    }
  } catch {
    ElMessage.error(lt('预览链接生成失败', 'Failed to create preview URL'))
  }
}

function openProductDialog(row?: Product) {
  resetProductForm()
  if (row) {
    Object.assign(productForm, {
      id: row.id,
      productNo: row.productNo || '',
      name: row.name || '',
      productType: row.productType || 'NEXION_BOX',
      tier: row.tier || '',
      status: row.status || 'OFF_SALE',
      priceUsdt: Number(row.priceUsdt ?? 0),
      hashrate: Number(row.hashrate ?? 0),
      estimatedDailyUsdt: Number(row.estimatedDailyUsdt ?? 0),
      dailyNex: Number(row.dailyNex ?? 0),
      stock: Number(row.stock ?? 0),
      coverUrl: row.coverUrl || '',
      detailImageUrls: parseDetailImageUrls(row.detailImageUrls)
    })
  }
  refreshProductMediaPreviews()
  productDialogVisible.value = true
}

async function validateProductForm() {
  try {
    await productFormRef.value?.validate()
    return true
  } catch {
    return false
  }
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
    coverUrl: productForm.coverUrl,
    detailImageUrls: stringifyDetailImageUrls(productForm.detailImageUrls)
  }
}

async function saveProduct() {
  if (!(await validateProductForm())) {
    return
  }
  if (Number(productForm.priceUsdt) <= 0) {
    ElMessage.warning(lt('价格必须大于 0', 'Price must be greater than 0'))
    return
  }
  if (Number(productForm.stock) < 0) {
    ElMessage.warning(lt('库存不能为负数', 'Stock cannot be negative'))
    return
  }
  productSaving.value = true
  try {
    if (productForm.id) {
      const { productNo: _productNo, ...payload } = productPayload()
      await updateProduct(productForm.id, payload)
      ElMessage.success(lt('SKU 已更新', 'SKU updated'))
      lastProductAction.value = `${lt('已更新 SKU', 'Updated SKU')} ${productForm.productNo}, ${lt('状态', 'status')} ${enumLabel(productForm.status)}, ${formatNow()}`
    } else {
      await createProduct(productPayload())
      ElMessage.success(lt('SKU 已创建', 'SKU created'))
      lastProductAction.value = `${lt('已创建 SKU', 'Created SKU')} ${productForm.productNo}, ${lt('默认状态', 'default status')} ${enumLabel(productForm.status)}, ${formatNow()}`
    }
    productDialogVisible.value = false
    await loadProducts()
  } finally {
    productSaving.value = false
  }
}

async function changeProductStatus(row: Product, status: string) {
  if (!row.id) return
  await ElMessageBox.confirm(`${lt('确认将 SKU', 'Confirm changing SKU')} ${row.productNo} ${lt('状态改为', 'status to')} ${enumLabel(status)}?`, lt('SKU 状态变更', 'SKU Status Change'), { type: 'warning' })
  actionLoading.value = true
  try {
    await updateProduct(row.id, { status })
    ElMessage.success(lt('SKU 状态已更新', 'SKU status updated'))
    lastProductAction.value = `${lt('已将 SKU', 'Changed SKU')} ${row.productNo} ${lt('状态改为', 'status to')} ${enumLabel(status)}, ${formatNow()}`
    await loadProducts()
  } finally {
    actionLoading.value = false
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
    ? `${lt('确认对账支付单', 'Confirm reconciling payment')} ${paymentNo}?`
    : action === 'expire'
      ? `${lt('确认批量过期待支付记录? 本次最多', 'Confirm expiring pending payments? Max')} ${opsLimit.value} ${lt('条', 'items')}`
      : `${lt('确认批量对账到期支付记录? 本次最多', 'Confirm reconciling due payments? Max')} ${opsLimit.value} ${lt('条', 'items')}`
  await ElMessageBox.confirm(message, lt('支付运营操作', 'Payment Ops Action'), { type: 'warning' })
  actionLoading.value = true
  try {
    const result = action === 'expire'
      ? await expirePendingPayments(opsLimit.value)
      : action === 'reconcileDue'
        ? await reconcileDuePayments(opsLimit.value)
        : await reconcilePayment(paymentNo as string)
    const count = result?.processed ?? result?.reconciled ?? result?.expired ?? result?.count ?? result?.total ?? '-'
    ElMessage.success(lt('支付运营操作完成', 'Payment ops action completed'))
    lastPaymentAction.value = `${lt('支付运营操作完成', 'Payment ops action completed')}: ${count} ${lt('条', 'items')}, ${formatNow()}`
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
          <div class="table-toolbar"><span>{{ lt('订单数', 'Orders') }}</span><el-icon color="#409eff" :size="24"><Tickets /></el-icon></div>
          <div class="value">{{ valueOf(stats, 'orders.total') }}</div>
        </el-card>
      </el-col>
      <el-col :xs="24" :sm="12" :md="6">
        <el-card shadow="never" class="stat-card">
          <div class="table-toolbar"><span>{{ lt('支付数', 'Payments') }}</span><el-icon color="#67c23a" :size="24"><CreditCard /></el-icon></div>
          <div class="value">{{ valueOf(stats, 'payments.total') }}</div>
        </el-card>
      </el-col>
      <el-col :xs="24" :sm="12" :md="6">
        <el-card shadow="never" class="stat-card">
          <div class="table-toolbar"><span>Trade-in</span><el-icon color="#e6a23c" :size="24"><Refresh /></el-icon></div>
          <div class="value">{{ valueOf(stats, 'tradeins.total') }}</div>
        </el-card>
      </el-col>
      <el-col :xs="24" :sm="12" :md="6">
        <el-card shadow="never" class="stat-card">
          <div class="table-toolbar"><span>Genesis</span><el-icon color="#f56c6c" :size="24"><Star /></el-icon></div>
          <div class="value">{{ valueOf(stats, 'genesis.orders.total') }}</div>
        </el-card>
      </el-col>
    </el-row>

    <el-card shadow="never">
      <div class="table-toolbar">
        <span>{{ lt('商城交易', 'Commerce') }}</span>
        <el-button :icon="'Refresh'" @click="loadData">{{ lt('刷新', 'Refresh') }}</el-button>
      </div>

      <el-tabs v-model="activeTab">
        <el-tab-pane :label="lt('商品 SKU', 'Product SKU')" name="products">
          <div class="table-toolbar">
            <span>{{ lt('SKU 价格、收益基线、库存与状态', 'SKU price, yield baseline, stock, and status') }}</span>
            <el-button type="primary" :icon="'Plus'" @click="openProductDialog()">{{ lt('新增 SKU', 'New SKU') }}</el-button>
          </div>
          <el-form :inline="true" :model="productQuery" class="filter-form">
            <el-form-item :label="lt('关键词', 'Keyword')"><el-input v-model="productQuery.keyword" clearable /></el-form-item>
            <el-form-item :label="lt('类型', 'Type')"><el-input v-model="productQuery.productType" clearable /></el-form-item>
            <el-form-item :label="lt('状态', 'Status')">
              <el-select v-model="productQuery.status" clearable style="width: 140px">
                <el-option v-for="status in enumOptions(productStatusOptions)" :key="status.value" :label="status.label" :value="status.value" />
              </el-select>
            </el-form-item>
            <el-form-item>
              <el-button type="primary" @click="productQuery.current = 1; loadData()">{{ lt('查询', 'Search') }}</el-button>
              <el-button @click="resetProducts">{{ lt('重置', 'Reset') }}</el-button>
            </el-form-item>
          </el-form>
          <el-alert v-if="lastProductAction" :title="lastProductAction" type="success" show-icon :closable="false" class="operation-alert" />
          <el-table v-loading="loading" :data="products" border>
            <el-table-column type="index" :index="(index: number) => pageIndex(productQuery, index)" :label="lt('编号', 'No.')" width="80" />
            <el-table-column prop="productNo" label="SKU" min-width="150" />
            <el-table-column prop="name" :label="lt('名称', 'Name')" min-width="160" />
            <el-table-column prop="productType" :label="lt('类型', 'Type')" width="130" :formatter="enumTableFormatter" />
            <el-table-column prop="tier" :label="lt('档位', 'Tier')" width="110" />
            <el-table-column prop="priceUsdt" :label="lt('价格 USDT', 'Price USDT')" width="130" />
            <el-table-column prop="estimatedDailyUsdt" :label="lt('日收益 USDT', 'Daily USDT')" width="140" />
            <el-table-column prop="dailyNex" :label="lt('日收益 NEX', 'Daily NEX')" width="130" />
            <el-table-column prop="stock" :label="lt('库存', 'Stock')" width="90" />
            <el-table-column :label="lt('状态', 'Status')" width="120">
              <template #default="{ row }"><el-tag :type="row.status === 'ON_SALE' ? 'success' : 'info'">{{ enumLabel(row.status) }}</el-tag></template>
            </el-table-column>
            <el-table-column :label="lt('操作', 'Actions')" width="190" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" @click="openProductDialog(row)">{{ lt('编辑', 'Edit') }}</el-button>
                <el-button v-if="row.status !== 'ON_SALE'" link type="success" :disabled="actionLoading" @click="changeProductStatus(row, 'ON_SALE')">{{ lt('上架', 'Publish') }}</el-button>
                <el-button v-else link type="warning" :disabled="actionLoading" @click="changeProductStatus(row, 'OFF_SALE')">{{ lt('下架', 'Unpublish') }}</el-button>
              </template>
            </el-table-column>
          </el-table>
          <div class="pagination-wrap">
            <el-pagination v-model:current-page="productQuery.current" v-model:page-size="productQuery.size" layout="total, sizes, prev, pager, next" :total="productTotal" @current-change="loadData" @size-change="loadData" />
          </div>
        </el-tab-pane>

        <el-tab-pane :label="lt('订单', 'Orders')" name="orders">
          <el-form :inline="true" :model="orderQuery" class="filter-form">
            <el-form-item :label="lt('用户', 'User')"><UserSelect v-model="orderQuery.userId" /></el-form-item>
            <el-form-item :label="lt('订单号', 'Order No.')"><el-input v-model="orderQuery.orderNo" clearable /></el-form-item>
            <el-form-item :label="lt('支付状态', 'Payment Status')">
              <el-select v-model="orderQuery.paymentStatus" clearable style="width: 140px">
                <el-option v-for="status in enumOptions(paymentStatusOptions)" :key="status.value" :label="status.label" :value="status.value" />
              </el-select>
            </el-form-item>
            <el-form-item :label="lt('订单状态', 'Order Status')">
              <el-select v-model="orderQuery.orderStatus" clearable style="width: 140px">
                <el-option v-for="status in enumOptions(orderStatusOptions)" :key="status.value" :label="status.label" :value="status.value" />
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
            <el-table-column prop="productId" :label="lt('商品ID', 'Product ID')" width="100" />
            <el-table-column prop="quantity" :label="lt('数量', 'Quantity')" width="80" />
            <el-table-column prop="amountUsdt" :label="lt('金额 USDT', 'Amount USDT')" width="130" />
            <el-table-column prop="paymentStatus" :label="lt('支付状态', 'Payment Status')" width="120" :formatter="enumTableFormatter" />
            <el-table-column prop="activationStatus" :label="lt('激活状态', 'Activation Status')" width="120" :formatter="enumTableFormatter" />
            <el-table-column prop="paymentNo" :label="lt('支付单号', 'Payment No.')" min-width="170" />
            <el-table-column prop="createdAt" :label="lt('创建时间', 'Created At')" min-width="170" :formatter="formatTableDateTime" />
            <el-table-column :label="lt('操作', 'Actions')" width="90" fixed="right">
              <template #default="{ row }"><el-button link type="primary" @click="showDetail(lt('订单详情', 'Order Details'), row)">{{ lt('详情', 'Details') }}</el-button></template>
            </el-table-column>
          </el-table>
          <div class="pagination-wrap">
            <el-pagination v-model:current-page="orderQuery.current" v-model:page-size="orderQuery.size" layout="total, sizes, prev, pager, next" :total="orderTotal" @current-change="loadData" @size-change="loadData" />
          </div>
        </el-tab-pane>

        <el-tab-pane :label="lt('支付与对账', 'Payments & Reconciliation')" name="payments">
          <div class="table-toolbar">
            <span>{{ lt('支付记录与异常', 'Payment Records & Anomalies') }}</span>
            <div>
              <el-input-number v-model="opsLimit" :min="1" :max="200" style="width: 118px; margin-right: 10px" />
              <el-button :loading="actionLoading" @click="runPaymentAction('expire')">{{ lt('过期待支付', 'Expire Pending') }}</el-button>
              <el-button type="primary" :loading="actionLoading" @click="runPaymentAction('reconcileDue')">{{ lt('对账到期', 'Reconcile Due') }}</el-button>
            </div>
          </div>
          <el-alert v-if="lastPaymentAction" :title="lastPaymentAction" type="success" show-icon :closable="false" class="operation-alert" />
          <el-form :inline="true" :model="paymentQuery" class="filter-form">
            <el-form-item :label="lt('用户', 'User')"><UserSelect v-model="paymentQuery.userId" /></el-form-item>
            <el-form-item :label="lt('订单号', 'Order No.')"><el-input v-model="paymentQuery.orderNo" clearable /></el-form-item>
            <el-form-item :label="lt('支付单号', 'Payment No.')"><el-input v-model="paymentQuery.paymentNo" clearable /></el-form-item>
            <el-form-item label="Provider"><el-input v-model="paymentQuery.provider" clearable /></el-form-item>
            <el-form-item :label="lt('状态', 'Status')">
              <el-select v-model="paymentQuery.paymentStatus" clearable style="width: 140px">
                <el-option v-for="status in enumOptions(paymentStatusOptions)" :key="status.value" :label="status.label" :value="status.value" />
              </el-select>
            </el-form-item>
            <el-form-item>
              <el-button type="primary" @click="paymentQuery.current = 1; loadData()">{{ lt('查询', 'Search') }}</el-button>
              <el-button @click="resetPayments">{{ lt('重置', 'Reset') }}</el-button>
            </el-form-item>
          </el-form>
          <el-table v-loading="loading" :data="payments" border>
            <el-table-column type="index" :index="(index: number) => pageIndex(paymentQuery, index)" :label="lt('编号', 'No.')" width="80" />
            <el-table-column prop="paymentNo" :label="lt('支付单号', 'Payment No.')" min-width="170" />
            <el-table-column prop="orderNo" :label="lt('订单号', 'Order No.')" min-width="170" />
            <el-table-column prop="userId" :label="lt('用户ID', 'User ID')" width="100" />
            <el-table-column prop="provider" label="Provider" width="110" />
            <el-table-column prop="amountUsdt" :label="lt('金额 USDT', 'Amount USDT')" width="130" />
            <el-table-column prop="currency" :label="lt('币种', 'Currency')" width="90" />
            <el-table-column prop="paymentStatus" :label="lt('状态', 'Status')" width="120" :formatter="enumTableFormatter" />
            <el-table-column prop="expiresAt" :label="lt('过期时间', 'Expires At')" min-width="170" :formatter="formatTableDateTime" />
            <el-table-column :label="lt('操作', 'Actions')" width="150" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" @click="showDetail(lt('支付详情', 'Payment Details'), row)">{{ lt('详情', 'Details') }}</el-button>
                <el-button link type="warning" @click="runPaymentAction('reconcileOne', String(row.paymentNo))">{{ lt('对账', 'Reconcile') }}</el-button>
              </template>
            </el-table-column>
          </el-table>
          <div class="pagination-wrap">
            <el-pagination v-model:current-page="paymentQuery.current" v-model:page-size="paymentQuery.size" layout="total, sizes, prev, pager, next" :total="paymentTotal" @current-change="loadData" @size-change="loadData" />
          </div>
          <el-divider />
          <el-table v-loading="loading" :data="anomalies" border>
            <el-table-column prop="paymentNo" :label="lt('异常支付单', 'Anomaly Payment')" min-width="170" />
            <el-table-column prop="orderNo" :label="lt('订单号', 'Order No.')" min-width="170" />
            <el-table-column prop="reason" :label="lt('原因', 'Reason')" min-width="220" />
            <el-table-column prop="paymentStatus" :label="lt('支付状态', 'Payment Status')" width="120" :formatter="enumTableFormatter" />
            <el-table-column prop="orderPaymentStatus" :label="lt('订单支付状态', 'Order Payment Status')" width="140" :formatter="enumTableFormatter" />
          </el-table>
        </el-tab-pane>

        <el-tab-pane label="Trade-in" name="tradeins">
          <el-form :inline="true" :model="tradeinQuery" class="filter-form">
            <el-form-item :label="lt('用户', 'User')"><UserSelect v-model="tradeinQuery.userId" /></el-form-item>
            <el-form-item :label="lt('状态', 'Status')">
              <el-select v-model="tradeinQuery.status" clearable style="width: 140px">
                <el-option v-for="status in enumOptions(tradeinStatusOptions)" :key="status.value" :label="status.label" :value="status.value" />
              </el-select>
            </el-form-item>
            <el-form-item>
              <el-button type="primary" @click="tradeinQuery.current = 1; loadData()">{{ lt('查询', 'Search') }}</el-button>
              <el-button @click="resetTradeins">{{ lt('重置', 'Reset') }}</el-button>
            </el-form-item>
          </el-form>
          <el-table v-loading="loading" :data="tradeins" border>
            <el-table-column type="index" :index="(index: number) => pageIndex(tradeinQuery, index)" :label="lt('编号', 'No.')" width="80" />
            <el-table-column prop="tradeinNo" :label="lt('Trade-in 单号', 'Trade-in No.')" min-width="170" />
            <el-table-column prop="userId" :label="lt('用户ID', 'User ID')" width="100" />
            <el-table-column prop="sourceDeviceId" :label="lt('来源设备', 'Source Device')" width="120" />
            <el-table-column prop="sourceProductNo" :label="lt('来源 SKU', 'Source SKU')" min-width="150" />
            <el-table-column prop="targetProductNo" :label="lt('目标 SKU', 'Target SKU')" min-width="150" />
            <el-table-column prop="salvageUsdt" :label="lt('残值 USDT', 'Salvage USDT')" width="130" />
            <el-table-column prop="discountUsdt" :label="lt('折扣 USDT', 'Discount USDT')" width="130" />
            <el-table-column prop="netUpgradeCostUsdt" :label="lt('升级净价', 'Net Upgrade Cost')" width="130" />
            <el-table-column prop="status" :label="lt('状态', 'Status')" width="110" :formatter="enumTableFormatter" />
            <el-table-column prop="createdAt" :label="lt('创建时间', 'Created At')" min-width="170" :formatter="formatTableDateTime" />
            <el-table-column :label="lt('操作', 'Actions')" width="90" fixed="right">
              <template #default="{ row }"><el-button link type="primary" @click="showDetail(lt('Trade-in 详情', 'Trade-in Details'), row)">{{ lt('详情', 'Details') }}</el-button></template>
            </el-table-column>
          </el-table>
          <div class="pagination-wrap">
            <el-pagination v-model:current-page="tradeinQuery.current" v-model:page-size="tradeinQuery.size" layout="total, sizes, prev, pager, next" :total="tradeinTotal" @current-change="loadData" @size-change="loadData" />
          </div>
        </el-tab-pane>
      </el-tabs>
    </el-card>

    <el-dialog v-model="productDialogVisible" :title="productForm.id ? lt('编辑 SKU', 'Edit SKU') : lt('新增 SKU', 'New SKU')" width="720px">
      <el-form ref="productFormRef" :model="productForm" :rules="productRules" label-width="118px">
        <el-row :gutter="16">
          <el-col :span="12"><el-form-item :label="lt('SKU 编号', 'SKU No.')" prop="productNo"><el-input v-model="productForm.productNo" :disabled="!!productForm.id" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item :label="lt('商品名称', 'Product Name')" prop="name"><el-input v-model="productForm.name" /></el-form-item></el-col>
          <el-col :span="12">
            <el-form-item :label="lt('商品类型', 'Product Type')" prop="productType">
              <el-select v-model="productForm.productType" allow-create filterable style="width: 100%">
                <el-option v-for="type in enumOptions(productTypeOptions)" :key="type.value" :label="type.label" :value="type.value" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12"><el-form-item :label="lt('档位', 'Tier')"><el-input v-model="productForm.tier" /></el-form-item></el-col>
          <el-col :span="12">
            <el-form-item :label="lt('状态', 'Status')" prop="status">
              <el-select v-model="productForm.status" style="width: 100%">
                <el-option v-for="status in enumOptions(productStatusOptions)" :key="status.value" :label="status.label" :value="status.value" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12"><el-form-item :label="lt('库存', 'Stock')" prop="stock"><el-input-number v-model="productForm.stock" :min="0" style="width: 100%" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item :label="lt('价格 USDT', 'Price USDT')" prop="priceUsdt"><el-input-number v-model="productForm.priceUsdt" :min="0" :precision="6" style="width: 100%" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item :label="lt('算力', 'Hashrate')"><el-input-number v-model="productForm.hashrate" :min="0" :precision="6" style="width: 100%" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item :label="lt('日收益 USDT', 'Daily USDT')"><el-input-number v-model="productForm.estimatedDailyUsdt" :min="0" :precision="6" style="width: 100%" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item :label="lt('日收益 NEX', 'Daily NEX')"><el-input-number v-model="productForm.dailyNex" :min="0" :precision="6" style="width: 100%" /></el-form-item></el-col>
          <el-col :span="24">
            <el-form-item :label="lt('商品封面', 'Product Cover')">
              <div class="media-panel">
                <el-upload
                  class="media-uploader media-uploader-cover"
                  accept="image/png,image/jpeg,image/webp"
                  drag
                  :limit="1"
                  :show-file-list="false"
                  :file-list="mediaFileList(productForm.coverUrl ? [productForm.coverUrl] : [])"
                  :http-request="uploadCoverImage"
                  :on-preview="(file: UploadUserFile) => openMediaPreview(String(file.url || ''))"
                  :on-remove="clearCoverImage"
                >
                  <div class="cover-upload-card" :class="{ 'has-media': !!productForm.coverUrl }">
                    <template v-if="productForm.coverUrl && productMediaPreviewUrls[productForm.coverUrl]">
                      <img class="cover-media-image" :src="productMediaPreviewUrls[productForm.coverUrl]" :alt="productMediaName(productForm.coverUrl)" />
                      <el-button class="media-remove-button" circle plain type="danger" @click.stop="clearCoverImage">
                        ×
                      </el-button>
                    </template>
                    <template v-else>
                      <el-icon class="media-upload-icon"><Plus /></el-icon>
                      <div class="media-upload-title">{{ productForm.coverUrl ? lt('替换商品封面', 'Replace Product Cover') : lt('上传商品封面', 'Upload Product Cover') }}</div>
                      <div class="media-upload-desc">{{ productForm.coverUrl ? productMediaName(productForm.coverUrl) : coverUploadTip }}</div>
                    </template>
                  </div>
                </el-upload>
              </div>
            </el-form-item>
          </el-col>
          <el-col :span="24">
            <el-form-item :label="lt('详情页图片', 'Detail Images')">
              <div class="detail-media-panel">
                <div v-for="objectKey in productForm.detailImageUrls" :key="objectKey" class="detail-media-card">
                  <div class="detail-media-thumb" @click="openMediaPreview(objectKey)">
                    <img v-if="productMediaPreviewUrls[objectKey]" class="detail-media-image" :src="productMediaPreviewUrls[objectKey]" :alt="productMediaName(objectKey)" />
                    <el-icon v-else><Picture /></el-icon>
                  </div>
                  <div class="detail-media-actions">
                    <el-button class="media-remove-button" circle plain type="danger" @click="removeDetailImageByKey(objectKey)">
                      ×
                    </el-button>
                  </div>
                </div>
                <el-upload
                  class="detail-upload-card"
                  accept="image/png,image/jpeg,image/webp"
                  multiple
                  drag
                  :show-file-list="false"
                  :file-list="mediaFileList(productForm.detailImageUrls)"
                  :http-request="uploadDetailImage"
                  :on-preview="(file: UploadUserFile) => openMediaPreview(String(file.url || ''))"
                  :on-remove="removeDetailImage"
                >
                  <div class="detail-upload-inner">
                    <el-icon class="media-upload-icon"><Plus /></el-icon>
                    <div class="media-upload-title">{{ lt('上传详情图', 'Upload Detail Image') }}</div>
                    <div class="media-upload-desc">{{ detailUploadTip }}</div>
                  </div>
                </el-upload>
              </div>
            </el-form-item>
          </el-col>
        </el-row>
      </el-form>
      <template #footer>
        <el-button @click="productDialogVisible = false">{{ lt('取消', 'Cancel') }}</el-button>
        <el-button type="primary" :loading="productSaving" @click="saveProduct">{{ lt('保存', 'Save') }}</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="detailVisible" :title="detailTitle" width="760px">
      <ObjectDetails :data="detailRecord" />
    </el-dialog>
  </div>
</template>

<style scoped>
.media-panel {
  display: block;
  width: 100%;
}

.media-uploader-cover {
  display: block;
  width: min(100%, 360px);
}

.cover-upload-card,
.detail-upload-inner {
  display: flex;
  min-height: 116px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 16px;
  text-align: center;
}

.cover-upload-card.has-media {
  position: relative;
  overflow: hidden;
  min-height: 188px;
  padding: 0;
  background: var(--el-fill-color-light);
}

.cover-media-image,
.detail-media-image {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.media-remove-button {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 2;
  width: 24px;
  height: 24px;
  min-height: 24px;
  padding: 0;
  border-color: rgb(255 255 255 / 78%);
  background: rgb(0 0 0 / 52%);
  color: #fff;
  font-size: 18px;
  line-height: 20px;
}

.media-upload-icon {
  margin-bottom: 8px;
  color: var(--el-color-primary);
  font-size: 28px;
}

.media-upload-title {
  color: var(--el-text-color-primary);
  font-size: 14px;
  font-weight: 600;
  line-height: 22px;
}

.media-upload-desc {
  max-width: 220px;
  margin-top: 4px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 18px;
}

.detail-media-card {
  min-width: 0;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  background: var(--el-fill-color-blank);
}

.media-file-name,
.media-object-key {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.media-file-name {
  color: var(--el-text-color-primary);
  font-size: 13px;
  font-weight: 600;
  line-height: 20px;
}

.media-object-key {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 18px;
}

.media-actions {
  margin-top: 10px;
}

.detail-media-panel {
  display: grid;
  width: 100%;
  grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
  gap: 12px;
}

.detail-media-card {
  position: relative;
  overflow: hidden;
}

.detail-media-thumb {
  display: flex;
  height: 92px;
  align-items: center;
  justify-content: center;
  background: var(--el-fill-color-light);
  color: var(--el-text-color-secondary);
  cursor: pointer;
  font-size: 28px;
}

.detail-media-actions {
  position: absolute;
  top: 0;
  right: 0;
}

.detail-upload-card {
  min-width: 210px;
}

:deep(.media-uploader .el-upload),
:deep(.detail-upload-card .el-upload) {
  width: 100%;
}

:deep(.media-uploader .el-upload-dragger),
:deep(.detail-upload-card .el-upload-dragger) {
  width: 100%;
  padding: 0;
  border-radius: 6px;
}

@media (max-width: 768px) {
  .media-uploader-cover {
    width: 100%;
  }
}
</style>

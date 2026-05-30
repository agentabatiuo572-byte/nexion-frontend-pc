<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import {
  getDepositDead,
  getDepositPending,
  getDepositRecords,
  getWalletLedgers,
  getWalletOpsStats,
  getWalletUser,
  getWithdrawalBroadcastDead,
  getWithdrawalBroadcastPending,
  getWithdrawalBroadcastSummary,
  manualDeposit,
  markWithdrawalFailed,
  markWithdrawalSucceeded,
  publishWithdrawalBroadcast,
  retryDeposit,
  retryWithdrawalBroadcast
} from '@/apis/operation'
import type { AnyRecord } from '@/types/common'
import { formatNow, formatTableDateTime } from '@/utils/date'
import { enumLabel, enumOptions, enumTableFormatter, localeText as lt } from '@/utils/i18n'
import UserSelect from '@/components/UserSelect.vue'
import ObjectDetails from '@/components/ObjectDetails.vue'

const props = withDefaults(defineProps<{ defaultTab?: string }>(), { defaultTab: 'overview' })

const activeTab = ref(props.defaultTab)
const loading = ref(false)
const actionLoading = ref(false)
const stats = ref<AnyRecord | null>(null)
const broadcastSummary = ref<AnyRecord | null>(null)
const walletUser = ref<AnyRecord | null>(null)
const ledgers = ref<AnyRecord[]>([])
const ledgerTotal = ref(0)
const deposits = ref<AnyRecord[]>([])
const pendingWithdrawals = ref<AnyRecord[]>([])
const deadWithdrawals = ref<AnyRecord[]>([])
const detailVisible = ref(false)
const detailRecord = ref<AnyRecord | null>(null)
const lastWalletAction = ref('')

const walletUserId = ref('')
const ledgerQuery = reactive({ current: 1, size: 10, userId: '', bizNo: '', asset: '', direction: '', status: '' })
const depositQuery = reactive({ status: 'records', asset: '', chainTxHash: '', limit: 20 })
const withdrawalLimit = ref(20)
const ledgerDirectionOptions = ['CREDIT', 'DEBIT']
const assetOptions = ['USDT', 'NEX']
const chainOptions = ['TRON', 'ETH', 'BSC']
const ledgerStatusOptions = ['SUCCESS', 'PENDING', 'FAILED', 'CANCELLED']

const manualDepositVisible = ref(false)
const manualDepositFormRef = ref<FormInstance>()
const manualDepositForm = reactive({
  userId: undefined as number | undefined,
  chain: 'TRON',
  chainTxHash: '',
  asset: 'USDT',
  amount: 0,
  confirmations: 1,
  reason: ''
})
const manualDepositRules: FormRules = {
  userId: [{ required: true, message: lt('请选择用户', 'Please select a user'), trigger: 'change' }],
  chain: [{ required: true, message: lt('请填写链', 'Please enter chain'), trigger: 'blur' }],
  chainTxHash: [{ required: true, message: lt('请填写链上交易哈希', 'Please enter chain tx hash'), trigger: 'blur' }],
  asset: [{ required: true, message: lt('请填写资产', 'Please enter asset'), trigger: 'blur' }],
  amount: [{ required: true, message: lt('请填写金额', 'Please enter amount'), trigger: 'blur' }],
  reason: [{ required: true, message: lt('请填写操作原因', 'Please enter operation reason'), trigger: 'blur' }]
}

const withdrawalDialogVisible = ref(false)
const withdrawalFormRef = ref<FormInstance>()
const withdrawalForm = reactive({
  withdrawalNo: '',
  mode: 'success' as 'success' | 'failed',
  chainTxHash: '',
  reason: ''
})
const withdrawalRules: FormRules = {
  withdrawalNo: [{ required: true, message: lt('提现单号缺失', 'Withdrawal no. is missing'), trigger: 'blur' }],
  reason: [{ required: true, message: lt('请填写操作原因', 'Please enter operation reason'), trigger: 'blur' }]
}

function valueOf(record: AnyRecord | null, key: string) {
  const value = key.split('.').reduce<unknown>((current, part) => {
    return current && typeof current === 'object' ? (current as AnyRecord)[part] : undefined
  }, record || undefined)
  return value == null || value === '' ? '-' : String(value)
}

function pageIndex(index: number) {
  return (ledgerQuery.current - 1) * ledgerQuery.size + index + 1
}

function showDetail(row: AnyRecord) {
  detailRecord.value = row
  detailVisible.value = true
}

async function loadOverview() {
  const [statsRes, summaryRes] = await Promise.allSettled([
    getWalletOpsStats(7, { silentError: true }),
    getWithdrawalBroadcastSummary({ silentError: true })
  ])
  stats.value = statsRes.status === 'fulfilled' ? statsRes.value : null
  broadcastSummary.value = summaryRes.status === 'fulfilled' ? summaryRes.value : null
}

async function lookupWalletUser() {
  if (!walletUserId.value) {
    walletUser.value = null
    return
  }
  walletUser.value = await getWalletUser(walletUserId.value)
}

async function loadLedgers() {
  const page = await getWalletLedgers(ledgerQuery)
  ledgers.value = page.records
  ledgerTotal.value = page.total
}

async function loadDeposits() {
  if (depositQuery.status === 'pending') {
    deposits.value = await getDepositPending(depositQuery.limit)
    return
  }
  if (depositQuery.status === 'dead') {
    deposits.value = await getDepositDead(depositQuery.limit)
    return
  }
  deposits.value = await getDepositRecords({ asset: depositQuery.asset, chainTxHash: depositQuery.chainTxHash })
}

async function loadWithdrawals() {
  const [pendingRes, deadRes, summaryRes] = await Promise.allSettled([
    getWithdrawalBroadcastPending(withdrawalLimit.value),
    getWithdrawalBroadcastDead(withdrawalLimit.value),
    getWithdrawalBroadcastSummary({ silentError: true })
  ])
  pendingWithdrawals.value = pendingRes.status === 'fulfilled' ? pendingRes.value : []
  deadWithdrawals.value = deadRes.status === 'fulfilled' ? deadRes.value : []
  broadcastSummary.value = summaryRes.status === 'fulfilled' ? summaryRes.value : null
}

async function loadActiveTab() {
  if (activeTab.value === 'overview') await loadOverview()
  if (activeTab.value === 'ledgers') await loadLedgers()
  if (activeTab.value === 'deposits') await loadDeposits()
  if (activeTab.value === 'withdrawals') await loadWithdrawals()
}

async function loadData() {
  loading.value = true
  try {
    await Promise.all([loadOverview(), loadActiveTab()])
  } finally {
    loading.value = false
  }
}

async function submitManualDeposit() {
  try {
    await manualDepositFormRef.value?.validate()
  } catch {
    return
  }
  if (!manualDepositForm.userId || !manualDepositForm.chainTxHash || Number(manualDepositForm.amount) < 0.000001 || !manualDepositForm.reason) {
    ElMessage.warning(lt('请补全用户、交易哈希、金额和原因，金额至少 0.000001', 'Please complete user, tx hash, amount, and reason; amount must be at least 0.000001'))
    return
  }
  await ElMessageBox.confirm(
    `${lt('确认给用户', 'Confirm crediting user')} ${manualDepositForm.userId} ${lt('人工入账', 'manually with')} ${manualDepositForm.amount} ${manualDepositForm.asset}?`,
    lt('人工充值入账', 'Manual Deposit Credit'),
    { type: 'warning' }
  )
  actionLoading.value = true
  try {
    const result = await manualDeposit(manualDepositForm)
    ElMessage.success(lt('人工充值已提交', 'Manual deposit submitted'))
    lastWalletAction.value = `人工充值已提交: ${result.depositNo || manualDepositForm.chainTxHash}，${manualDepositForm.amount} ${manualDepositForm.asset}，${formatNow()}`
    manualDepositVisible.value = false
    await loadDeposits()
    await loadOverview()
  } finally {
    actionLoading.value = false
  }
}

async function runDepositRetry(row: AnyRecord) {
  const depositNo = String(row.depositNo || '')
  if (!depositNo) return
  const { value } = await ElMessageBox.prompt(`${lt('确认重试充值', 'Confirm retrying deposit')} ${depositNo}?`, lt('充值重试原因', 'Deposit Retry Reason'), {
    inputType: 'textarea',
    inputPlaceholder: lt('请输入操作原因', 'Please enter operation reason'),
    inputValidator: (input) => !!input || lt('操作原因必填', 'Operation reason is required')
  })
  actionLoading.value = true
  try {
    await retryDeposit(depositNo, value)
    ElMessage.success(lt('充值已重试', 'Deposit retry submitted'))
    lastWalletAction.value = `${lt('充值重试已提交', 'Deposit retry submitted')}: ${depositNo}, ${formatNow()}`
    await loadDeposits()
  } finally {
    actionLoading.value = false
  }
}

async function publishBroadcast() {
  await ElMessageBox.confirm(`${lt('确认发布提现广播? 本次最多', 'Confirm publishing withdrawal broadcasts? Up to')} ${withdrawalLimit.value} ${lt('条', 'items')}`, lt('提现广播', 'Withdrawal Broadcast'), { type: 'warning' })
  actionLoading.value = true
  try {
    const result = await publishWithdrawalBroadcast(withdrawalLimit.value)
    const count = result?.published ?? result?.count ?? result?.total ?? '-'
    ElMessage.success(lt('提现广播已提交', 'Withdrawal broadcast submitted'))
    lastWalletAction.value = `${lt('提现广播已提交', 'Withdrawal broadcast submitted')}: ${count} ${lt('条', 'items')}, ${formatNow()}`
    await loadWithdrawals()
    await loadOverview()
  } finally {
    actionLoading.value = false
  }
}

async function runWithdrawalRetry(row: AnyRecord) {
  const withdrawalNo = String(row.withdrawalNo || '')
  if (!withdrawalNo) return
  const { value } = await ElMessageBox.prompt(`${lt('确认重试广播', 'Confirm retrying broadcast')} ${withdrawalNo}?`, lt('提现重试原因', 'Withdrawal Retry Reason'), {
    inputType: 'textarea',
    inputPlaceholder: lt('请输入操作原因', 'Please enter operation reason'),
    inputValidator: (input) => !!input || lt('操作原因必填', 'Operation reason is required')
  })
  actionLoading.value = true
  try {
    await retryWithdrawalBroadcast(withdrawalNo, value)
    ElMessage.success(lt('提现广播已重试', 'Withdrawal broadcast retry submitted'))
    lastWalletAction.value = `${lt('提现广播重试已提交', 'Withdrawal broadcast retry submitted')}: ${withdrawalNo}, ${formatNow()}`
    await loadWithdrawals()
  } finally {
    actionLoading.value = false
  }
}

function openWithdrawalManual(row: AnyRecord, mode: 'success' | 'failed') {
  Object.assign(withdrawalForm, {
    withdrawalNo: String(row.withdrawalNo || ''),
    mode,
    chainTxHash: String(row.chainTxHash || ''),
    reason: ''
  })
  withdrawalDialogVisible.value = true
}

async function submitWithdrawalManual() {
  try {
    await withdrawalFormRef.value?.validate()
  } catch {
    return
  }
  if (!withdrawalForm.withdrawalNo || !withdrawalForm.reason) {
    ElMessage.warning(lt('提现单号和原因必填', 'Withdrawal no. and reason are required'))
    return
  }
  if (withdrawalForm.mode === 'success' && !withdrawalForm.chainTxHash) {
    ElMessage.warning(lt('标记成功必须填写链上哈希', 'Chain tx hash is required when marking success'))
    return
  }
  await ElMessageBox.confirm(
    `${lt('确认将提现', 'Confirm marking withdrawal')} ${withdrawalForm.withdrawalNo} ${lt('标记为', 'as')} ${withdrawalForm.mode === 'success' ? lt('成功', 'success') : lt('失败', 'failed')}?`,
    lt('提现人工处理', 'Withdrawal Manual Processing'),
    { type: 'warning' }
  )
  actionLoading.value = true
  try {
    if (withdrawalForm.mode === 'success') {
      await markWithdrawalSucceeded(withdrawalForm.withdrawalNo, {
        chainTxHash: withdrawalForm.chainTxHash,
        reason: withdrawalForm.reason
      })
    } else {
      await markWithdrawalFailed(withdrawalForm.withdrawalNo, { reason: withdrawalForm.reason })
    }
    ElMessage.success(lt('人工处理已提交', 'Manual processing submitted'))
    lastWalletAction.value = `提现人工处理已提交: ${withdrawalForm.withdrawalNo} -> ${withdrawalForm.mode}，${formatNow()}`
    withdrawalDialogVisible.value = false
    await loadWithdrawals()
    await loadOverview()
  } finally {
    actionLoading.value = false
  }
}

function resetLedgers() {
  Object.assign(ledgerQuery, { current: 1, userId: '', bizNo: '', asset: '', direction: '', status: '' })
  loadData()
}

function resetDeposits() {
  Object.assign(depositQuery, { status: 'records', asset: '', chainTxHash: '', limit: 20 })
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
          <div class="table-toolbar"><span>{{ lt('充值数', 'Deposits') }}</span><el-icon color="#409eff" :size="24"><Wallet /></el-icon></div>
          <div class="value">{{ valueOf(stats, 'deposits.total') }}</div>
        </el-card>
      </el-col>
      <el-col :xs="24" :sm="12" :md="6">
        <el-card shadow="never" class="stat-card">
          <div class="table-toolbar"><span>{{ lt('流水数', 'Ledger Entries') }}</span><el-icon color="#67c23a" :size="24"><Tickets /></el-icon></div>
          <div class="value">{{ valueOf(stats, 'ledger.total') }}</div>
        </el-card>
      </el-col>
      <el-col :xs="24" :sm="12" :md="6">
        <el-card shadow="never" class="stat-card">
          <div class="table-toolbar"><span>{{ lt('待广播', 'Pending Broadcast') }}</span><el-icon color="#e6a23c" :size="24"><Upload /></el-icon></div>
          <div class="value">{{ valueOf(broadcastSummary, 'pending') }}</div>
        </el-card>
      </el-col>
      <el-col :xs="24" :sm="12" :md="6">
        <el-card shadow="never" class="stat-card">
          <div class="table-toolbar"><span>{{ lt('广播死信', 'Broadcast DLQ') }}</span><el-icon color="#f56c6c" :size="24"><Warning /></el-icon></div>
          <div class="value">{{ valueOf(broadcastSummary, 'dead') }}</div>
        </el-card>
      </el-col>
    </el-row>

    <el-card shadow="never">
      <div class="table-toolbar">
        <span>{{ lt('钱包运营', 'Wallet Ops') }}</span>
        <el-button :icon="'Refresh'" @click="loadData">{{ lt('刷新', 'Refresh') }}</el-button>
      </div>
      <el-alert v-if="lastWalletAction" :title="lastWalletAction" type="success" show-icon :closable="false" class="operation-alert" />
      <el-tabs v-model="activeTab">
        <el-tab-pane :label="lt('概览', 'Overview')" name="overview">
          <el-form :inline="true" class="filter-form">
            <el-form-item :label="lt('用户', 'User')"><UserSelect v-model="walletUserId" /></el-form-item>
            <el-form-item><el-button type="primary" @click="lookupWalletUser">{{ lt('查询用户钱包', 'Lookup User Wallet') }}</el-button></el-form-item>
          </el-form>
          <ObjectDetails :data="walletUser || stats" :empty-text="lt('请选择用户或刷新概览', 'Select a user or refresh overview')" />
        </el-tab-pane>

        <el-tab-pane :label="lt('流水', 'Ledger')" name="ledgers">
          <el-form :inline="true" :model="ledgerQuery" class="filter-form">
            <el-form-item :label="lt('用户', 'User')"><UserSelect v-model="ledgerQuery.userId" /></el-form-item>
            <el-form-item :label="lt('业务号', 'Biz No.')"><el-input v-model="ledgerQuery.bizNo" clearable /></el-form-item>
            <el-form-item :label="lt('资产', 'Asset')">
              <el-select v-model="ledgerQuery.asset" clearable style="width: 120px">
                <el-option v-for="asset in assetOptions" :key="asset" :label="asset" :value="asset" />
              </el-select>
            </el-form-item>
            <el-form-item :label="lt('方向', 'Direction')">
              <el-select v-model="ledgerQuery.direction" clearable style="width: 130px">
                <el-option v-for="direction in enumOptions(ledgerDirectionOptions)" :key="direction.value" :label="direction.label" :value="direction.value" />
              </el-select>
            </el-form-item>
            <el-form-item :label="lt('状态', 'Status')">
              <el-select v-model="ledgerQuery.status" clearable style="width: 130px">
                <el-option v-for="status in enumOptions(ledgerStatusOptions)" :key="status.value" :label="status.label" :value="status.value" />
              </el-select>
            </el-form-item>
            <el-form-item>
              <el-button type="primary" @click="ledgerQuery.current = 1; loadData()">{{ lt('查询', 'Search') }}</el-button>
              <el-button @click="resetLedgers">{{ lt('重置', 'Reset') }}</el-button>
            </el-form-item>
          </el-form>
          <el-table v-loading="loading" :data="ledgers" border>
            <el-table-column type="index" :index="pageIndex" :label="lt('编号', 'No.')" width="80" />
            <el-table-column prop="userId" :label="lt('用户ID', 'User ID')" width="100" />
            <el-table-column prop="bizNo" :label="lt('业务号', 'Biz No.')" min-width="170" />
            <el-table-column prop="bizType" :label="lt('业务类型', 'Biz Type')" width="130" />
            <el-table-column prop="asset" :label="lt('资产', 'Asset')" width="90" />
            <el-table-column prop="direction" :label="lt('方向', 'Direction')" width="100" :formatter="enumTableFormatter" />
            <el-table-column prop="amount" :label="lt('金额', 'Amount')" width="130" />
            <el-table-column prop="balanceAfter" :label="lt('变动后余额', 'Balance After')" width="140" />
            <el-table-column prop="status" :label="lt('状态', 'Status')" width="110" :formatter="enumTableFormatter" />
            <el-table-column prop="createdAt" :label="lt('创建时间', 'Created At')" min-width="170" :formatter="formatTableDateTime" />
          </el-table>
          <div class="pagination-wrap">
            <el-pagination v-model:current-page="ledgerQuery.current" v-model:page-size="ledgerQuery.size" layout="total, sizes, prev, pager, next" :total="ledgerTotal" @current-change="loadData" @size-change="loadData" />
          </div>
        </el-tab-pane>

        <el-tab-pane :label="lt('充值', 'Deposits')" name="deposits">
          <div class="table-toolbar">
            <span>{{ lt('充值记录', 'Deposit Records') }}</span>
            <el-button type="primary" :icon="'Plus'" @click="manualDepositVisible = true">{{ lt('人工充值', 'Manual Deposit') }}</el-button>
          </div>
          <el-form :inline="true" :model="depositQuery" class="filter-form">
            <el-form-item :label="lt('状态', 'Status')">
              <el-radio-group v-model="depositQuery.status" @change="loadData">
                <el-radio-button label="records">{{ lt('全部', 'All') }}</el-radio-button>
                <el-radio-button label="pending">{{ lt('待入账', 'Pending Credit') }}</el-radio-button>
                <el-radio-button label="dead">{{ lt('死信', 'DLQ') }}</el-radio-button>
              </el-radio-group>
            </el-form-item>
            <el-form-item :label="lt('资产', 'Asset')">
              <el-select v-model="depositQuery.asset" clearable :disabled="depositQuery.status !== 'records'" style="width: 120px">
                <el-option v-for="asset in assetOptions" :key="asset" :label="asset" :value="asset" />
              </el-select>
            </el-form-item>
            <el-form-item :label="lt('交易哈希', 'Tx Hash')"><el-input v-model="depositQuery.chainTxHash" clearable :disabled="depositQuery.status !== 'records'" /></el-form-item>
            <el-form-item :label="lt('条数', 'Limit')"><el-input-number v-model="depositQuery.limit" :min="1" :max="200" /></el-form-item>
            <el-form-item>
              <el-button type="primary" @click="loadData">{{ lt('查询', 'Search') }}</el-button>
              <el-button @click="resetDeposits">{{ lt('重置', 'Reset') }}</el-button>
            </el-form-item>
          </el-form>
          <el-table v-loading="loading" :data="deposits" border>
            <el-table-column prop="depositNo" :label="lt('充值单号', 'Deposit No.')" min-width="170" />
            <el-table-column prop="userId" :label="lt('用户ID', 'User ID')" width="100" />
            <el-table-column prop="chain" :label="lt('链', 'Chain')" width="110" />
            <el-table-column prop="asset" :label="lt('资产', 'Asset')" width="90" />
            <el-table-column prop="amount" :label="lt('金额', 'Amount')" width="130" />
            <el-table-column prop="confirmations" :label="lt('确认数', 'Confirmations')" width="100" />
            <el-table-column prop="status" :label="lt('状态', 'Status')" width="110" :formatter="enumTableFormatter" />
            <el-table-column prop="chainTxHash" :label="lt('交易哈希', 'Tx Hash')" min-width="220" />
            <el-table-column prop="creditedAt" :label="lt('入账时间', 'Credited At')" min-width="170" :formatter="formatTableDateTime" />
            <el-table-column :label="lt('操作', 'Actions')" width="150" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" @click="showDetail(row)">{{ lt('详情', 'Details') }}</el-button>
                <el-button link type="warning" :disabled="actionLoading || row.status === 'SUCCESS'" @click="runDepositRetry(row)">{{ lt('重试', 'Retry') }}</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>

        <el-tab-pane :label="lt('提现', 'Withdrawals')" name="withdrawals">
          <div class="table-toolbar">
            <span>{{ lt('提现广播队列', 'Withdrawal Broadcast Queue') }}</span>
            <div>
              <el-input-number v-model="withdrawalLimit" :min="1" :max="200" style="width: 118px; margin-right: 10px" />
              <el-button type="primary" :loading="actionLoading" :icon="'Upload'" @click="publishBroadcast">{{ lt('发布广播', 'Publish Broadcast') }}</el-button>
            </div>
          </div>
          <el-tabs>
            <el-tab-pane :label="lt('待广播', 'Pending Broadcast')">
              <el-table v-loading="loading" :data="pendingWithdrawals" border>
                <el-table-column prop="withdrawalNo" :label="lt('提现单号', 'Withdrawal No.')" min-width="170" />
                <el-table-column prop="userId" :label="lt('用户ID', 'User ID')" width="100" />
                <el-table-column prop="asset" :label="lt('资产', 'Asset')" width="90" />
                <el-table-column prop="amount" :label="lt('金额', 'Amount')" width="120" />
                <el-table-column prop="fee" :label="lt('手续费', 'Fee')" width="110" />
                <el-table-column prop="status" :label="lt('状态', 'Status')" width="120" :formatter="enumTableFormatter" />
                <el-table-column prop="chainBroadcastAttempts" :label="lt('尝试次数', 'Attempts')" width="110" />
                <el-table-column prop="targetAddress" :label="lt('目标地址', 'Target Address')" min-width="220" />
                <el-table-column :label="lt('操作', 'Actions')" width="250" fixed="right">
                  <template #default="{ row }">
                    <el-button link type="primary" @click="showDetail(row)">{{ lt('详情', 'Details') }}</el-button>
                    <el-button link type="success" @click="openWithdrawalManual(row, 'success')">{{ lt('标记成功', 'Mark Success') }}</el-button>
                    <el-button link type="danger" @click="openWithdrawalManual(row, 'failed')">{{ lt('标记失败', 'Mark Failed') }}</el-button>
                  </template>
                </el-table-column>
              </el-table>
            </el-tab-pane>
            <el-tab-pane :label="lt('死信', 'DLQ')">
              <el-table v-loading="loading" :data="deadWithdrawals" border>
                <el-table-column prop="withdrawalNo" :label="lt('提现单号', 'Withdrawal No.')" min-width="170" />
                <el-table-column prop="userId" :label="lt('用户ID', 'User ID')" width="100" />
                <el-table-column prop="asset" :label="lt('资产', 'Asset')" width="90" />
                <el-table-column prop="amount" :label="lt('金额', 'Amount')" width="120" />
                <el-table-column prop="status" :label="lt('状态', 'Status')" width="120" :formatter="enumTableFormatter" />
                <el-table-column prop="lastBroadcastError" :label="lt('广播错误', 'Broadcast Error')" min-width="240" />
                <el-table-column prop="broadcastDeadAt" :label="lt('死信时间', 'DLQ At')" min-width="170" :formatter="formatTableDateTime" />
                <el-table-column :label="lt('操作', 'Actions')" width="260" fixed="right">
                  <template #default="{ row }">
                    <el-button link type="primary" @click="showDetail(row)">{{ lt('详情', 'Details') }}</el-button>
                    <el-button link type="warning" @click="runWithdrawalRetry(row)">{{ lt('重播', 'Rebroadcast') }}</el-button>
                    <el-button link type="success" @click="openWithdrawalManual(row, 'success')">{{ lt('标记成功', 'Mark Success') }}</el-button>
                    <el-button link type="danger" @click="openWithdrawalManual(row, 'failed')">{{ lt('标记失败', 'Mark Failed') }}</el-button>
                  </template>
                </el-table-column>
              </el-table>
            </el-tab-pane>
          </el-tabs>
        </el-tab-pane>
      </el-tabs>
    </el-card>

    <el-dialog v-model="manualDepositVisible" :title="lt('人工充值入账', 'Manual Deposit Credit')" width="620px">
      <el-form ref="manualDepositFormRef" :model="manualDepositForm" :rules="manualDepositRules" label-width="108px">
        <el-form-item :label="lt('用户', 'User')" prop="userId"><UserSelect v-model="manualDepositForm.userId" width="100%" /></el-form-item>
        <el-form-item :label="lt('链', 'Chain')" prop="chain">
          <el-select v-model="manualDepositForm.chain" style="width: 100%">
            <el-option v-for="chain in chainOptions" :key="chain" :label="chain" :value="chain" />
          </el-select>
        </el-form-item>
        <el-form-item :label="lt('交易哈希', 'Tx Hash')" prop="chainTxHash"><el-input v-model="manualDepositForm.chainTxHash" /></el-form-item>
        <el-form-item :label="lt('资产', 'Asset')" prop="asset">
          <el-select v-model="manualDepositForm.asset" style="width: 100%">
            <el-option v-for="asset in assetOptions" :key="asset" :label="asset" :value="asset" />
          </el-select>
        </el-form-item>
        <el-form-item :label="lt('金额', 'Amount')" prop="amount"><el-input-number v-model="manualDepositForm.amount" :min="0.000001" :precision="6" style="width: 100%" /></el-form-item>
        <el-form-item :label="lt('确认数', 'Confirmations')"><el-input-number v-model="manualDepositForm.confirmations" :min="0" style="width: 100%" /></el-form-item>
        <el-form-item :label="lt('原因', 'Reason')" prop="reason"><el-input v-model="manualDepositForm.reason" type="textarea" :rows="3" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="manualDepositVisible = false">{{ lt('取消', 'Cancel') }}</el-button>
        <el-button type="primary" :loading="actionLoading" @click="submitManualDeposit">{{ lt('提交', 'Submit') }}</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="withdrawalDialogVisible" :title="withdrawalForm.mode === 'success' ? lt('标记提现成功', 'Mark Withdrawal Succeeded') : lt('标记提现失败', 'Mark Withdrawal Failed')" width="620px">
      <el-form ref="withdrawalFormRef" :model="withdrawalForm" :rules="withdrawalRules" label-width="108px">
        <el-form-item :label="lt('提现单号', 'Withdrawal No.')" prop="withdrawalNo"><el-input v-model="withdrawalForm.withdrawalNo" disabled /></el-form-item>
        <el-form-item v-if="withdrawalForm.mode === 'success'" :label="lt('链上哈希', 'Chain Tx Hash')"><el-input v-model="withdrawalForm.chainTxHash" /></el-form-item>
        <el-form-item :label="lt('原因', 'Reason')" prop="reason"><el-input v-model="withdrawalForm.reason" type="textarea" :rows="3" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="withdrawalDialogVisible = false">{{ lt('取消', 'Cancel') }}</el-button>
        <el-button type="primary" :loading="actionLoading" @click="submitWithdrawalManual">{{ lt('提交', 'Submit') }}</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="detailVisible" :title="lt('详情', 'Details')" width="760px">
      <ObjectDetails :data="detailRecord" />
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
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

const walletUserId = ref('')
const ledgerQuery = reactive({ current: 1, size: 10, userId: '', bizNo: '', asset: '', direction: '', status: '' })
const depositQuery = reactive({ status: 'records', asset: '', chainTxHash: '', limit: 20 })
const withdrawalLimit = ref(20)

const manualDepositVisible = ref(false)
const manualDepositForm = reactive({
  userId: undefined as number | undefined,
  chain: 'TRON',
  chainTxHash: '',
  asset: 'USDT',
  amount: 0,
  confirmations: 1,
  reason: ''
})

const withdrawalDialogVisible = ref(false)
const withdrawalForm = reactive({
  withdrawalNo: '',
  mode: 'success' as 'success' | 'failed',
  chainTxHash: '',
  reason: ''
})

function valueOf(record: AnyRecord | null, key: string) {
  const value = record?.[key]
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
  if (!manualDepositForm.userId || !manualDepositForm.chainTxHash || !manualDepositForm.amount || !manualDepositForm.reason) {
    ElMessage.warning('请补全用户、交易哈希、金额和原因')
    return
  }
  actionLoading.value = true
  try {
    await manualDeposit(manualDepositForm)
    ElMessage.success('人工充值已提交')
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
  const { value } = await ElMessageBox.prompt(`确认重试充值 ${depositNo}?`, '充值重试原因', {
    inputType: 'textarea',
    inputPlaceholder: '请输入操作原因',
    inputValidator: (input) => !!input || '操作原因必填'
  })
  actionLoading.value = true
  try {
    await retryDeposit(depositNo, value)
    ElMessage.success('充值已重试')
    await loadDeposits()
  } finally {
    actionLoading.value = false
  }
}

async function publishBroadcast() {
  await ElMessageBox.confirm(`确认发布提现广播? 本次最多 ${withdrawalLimit.value} 条`, '提现广播', { type: 'warning' })
  actionLoading.value = true
  try {
    const result = await publishWithdrawalBroadcast(withdrawalLimit.value)
    ElMessage.success(`已提交广播: ${JSON.stringify(result)}`)
    await loadWithdrawals()
    await loadOverview()
  } finally {
    actionLoading.value = false
  }
}

async function runWithdrawalRetry(row: AnyRecord) {
  const withdrawalNo = String(row.withdrawalNo || '')
  if (!withdrawalNo) return
  const { value } = await ElMessageBox.prompt(`确认重试广播 ${withdrawalNo}?`, '提现重试原因', {
    inputType: 'textarea',
    inputPlaceholder: '请输入操作原因',
    inputValidator: (input) => !!input || '操作原因必填'
  })
  actionLoading.value = true
  try {
    await retryWithdrawalBroadcast(withdrawalNo, value)
    ElMessage.success('提现广播已重试')
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
  if (!withdrawalForm.withdrawalNo || !withdrawalForm.reason) {
    ElMessage.warning('提现单号和原因必填')
    return
  }
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
    ElMessage.success('人工处理已提交')
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
          <div class="table-toolbar"><span>钱包数</span><el-icon color="#409eff" :size="24"><Wallet /></el-icon></div>
          <div class="value">{{ valueOf(stats, 'wallets') }}</div>
        </el-card>
      </el-col>
      <el-col :xs="24" :sm="12" :md="6">
        <el-card shadow="never" class="stat-card">
          <div class="table-toolbar"><span>流水数</span><el-icon color="#67c23a" :size="24"><Tickets /></el-icon></div>
          <div class="value">{{ valueOf(stats, 'ledgers') }}</div>
        </el-card>
      </el-col>
      <el-col :xs="24" :sm="12" :md="6">
        <el-card shadow="never" class="stat-card">
          <div class="table-toolbar"><span>待广播</span><el-icon color="#e6a23c" :size="24"><Upload /></el-icon></div>
          <div class="value">{{ valueOf(broadcastSummary, 'pending') }}</div>
        </el-card>
      </el-col>
      <el-col :xs="24" :sm="12" :md="6">
        <el-card shadow="never" class="stat-card">
          <div class="table-toolbar"><span>广播死信</span><el-icon color="#f56c6c" :size="24"><Warning /></el-icon></div>
          <div class="value">{{ valueOf(broadcastSummary, 'dead') }}</div>
        </el-card>
      </el-col>
    </el-row>

    <el-card shadow="never">
      <div class="table-toolbar">
        <span>钱包运营</span>
        <el-button :icon="'Refresh'" @click="loadData">刷新</el-button>
      </div>
      <el-tabs v-model="activeTab">
        <el-tab-pane label="概览" name="overview">
          <el-form :inline="true" class="filter-form">
            <el-form-item label="用户ID"><el-input v-model="walletUserId" clearable /></el-form-item>
            <el-form-item><el-button type="primary" @click="lookupWalletUser">查询用户钱包</el-button></el-form-item>
          </el-form>
          <pre class="json-preview">{{ JSON.stringify(walletUser || stats, null, 2) }}</pre>
        </el-tab-pane>

        <el-tab-pane label="流水" name="ledgers">
          <el-form :inline="true" :model="ledgerQuery" class="filter-form">
            <el-form-item label="用户ID"><el-input v-model="ledgerQuery.userId" clearable /></el-form-item>
            <el-form-item label="业务号"><el-input v-model="ledgerQuery.bizNo" clearable /></el-form-item>
            <el-form-item label="资产"><el-input v-model="ledgerQuery.asset" clearable /></el-form-item>
            <el-form-item label="方向">
              <el-select v-model="ledgerQuery.direction" clearable style="width: 130px">
                <el-option label="CREDIT" value="CREDIT" />
                <el-option label="DEBIT" value="DEBIT" />
              </el-select>
            </el-form-item>
            <el-form-item label="状态"><el-input v-model="ledgerQuery.status" clearable /></el-form-item>
            <el-form-item>
              <el-button type="primary" @click="ledgerQuery.current = 1; loadData()">查询</el-button>
              <el-button @click="resetLedgers">重置</el-button>
            </el-form-item>
          </el-form>
          <el-table v-loading="loading" :data="ledgers" border>
            <el-table-column type="index" :index="pageIndex" label="编号" width="80" />
            <el-table-column prop="userId" label="用户ID" width="100" />
            <el-table-column prop="bizNo" label="业务号" min-width="170" />
            <el-table-column prop="bizType" label="业务类型" width="130" />
            <el-table-column prop="asset" label="资产" width="90" />
            <el-table-column prop="direction" label="方向" width="100" />
            <el-table-column prop="amount" label="金额" width="130" />
            <el-table-column prop="balanceAfter" label="变动后余额" width="140" />
            <el-table-column prop="status" label="状态" width="110" />
            <el-table-column prop="createdAt" label="创建时间" min-width="170" />
          </el-table>
          <div class="pagination-wrap">
            <el-pagination v-model:current-page="ledgerQuery.current" v-model:page-size="ledgerQuery.size" layout="total, sizes, prev, pager, next" :total="ledgerTotal" @current-change="loadData" @size-change="loadData" />
          </div>
        </el-tab-pane>

        <el-tab-pane label="充值" name="deposits">
          <div class="table-toolbar">
            <span>充值记录</span>
            <el-button type="primary" :icon="'Plus'" @click="manualDepositVisible = true">人工充值</el-button>
          </div>
          <el-form :inline="true" :model="depositQuery" class="filter-form">
            <el-form-item label="状态">
              <el-radio-group v-model="depositQuery.status" @change="loadData">
                <el-radio-button label="records">全部</el-radio-button>
                <el-radio-button label="pending">待入账</el-radio-button>
                <el-radio-button label="dead">死信</el-radio-button>
              </el-radio-group>
            </el-form-item>
            <el-form-item label="资产"><el-input v-model="depositQuery.asset" clearable :disabled="depositQuery.status !== 'records'" /></el-form-item>
            <el-form-item label="交易哈希"><el-input v-model="depositQuery.chainTxHash" clearable :disabled="depositQuery.status !== 'records'" /></el-form-item>
            <el-form-item label="条数"><el-input-number v-model="depositQuery.limit" :min="1" :max="200" /></el-form-item>
            <el-form-item>
              <el-button type="primary" @click="loadData">查询</el-button>
              <el-button @click="resetDeposits">重置</el-button>
            </el-form-item>
          </el-form>
          <el-table v-loading="loading" :data="deposits" border>
            <el-table-column prop="depositNo" label="充值单号" min-width="170" />
            <el-table-column prop="userId" label="用户ID" width="100" />
            <el-table-column prop="chain" label="链" width="110" />
            <el-table-column prop="asset" label="资产" width="90" />
            <el-table-column prop="amount" label="金额" width="130" />
            <el-table-column prop="confirmations" label="确认数" width="100" />
            <el-table-column prop="status" label="状态" width="110" />
            <el-table-column prop="chainTxHash" label="交易哈希" min-width="220" />
            <el-table-column prop="creditedAt" label="入账时间" min-width="170" />
            <el-table-column label="操作" width="150" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" @click="showDetail(row)">详情</el-button>
                <el-button link type="warning" :disabled="actionLoading" @click="runDepositRetry(row)">重试</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>

        <el-tab-pane label="提现" name="withdrawals">
          <div class="table-toolbar">
            <span>提现广播队列</span>
            <div>
              <el-input-number v-model="withdrawalLimit" :min="1" :max="200" style="width: 118px; margin-right: 10px" />
              <el-button type="primary" :loading="actionLoading" :icon="'Upload'" @click="publishBroadcast">发布广播</el-button>
            </div>
          </div>
          <el-tabs>
            <el-tab-pane label="待广播">
              <el-table v-loading="loading" :data="pendingWithdrawals" border>
                <el-table-column prop="withdrawalNo" label="提现单号" min-width="170" />
                <el-table-column prop="userId" label="用户ID" width="100" />
                <el-table-column prop="asset" label="资产" width="90" />
                <el-table-column prop="amount" label="金额" width="120" />
                <el-table-column prop="fee" label="手续费" width="110" />
                <el-table-column prop="status" label="状态" width="120" />
                <el-table-column prop="chainBroadcastAttempts" label="尝试次数" width="110" />
                <el-table-column prop="targetAddress" label="目标地址" min-width="220" />
                <el-table-column label="操作" width="250" fixed="right">
                  <template #default="{ row }">
                    <el-button link type="primary" @click="showDetail(row)">详情</el-button>
                    <el-button link type="success" @click="openWithdrawalManual(row, 'success')">标记成功</el-button>
                    <el-button link type="danger" @click="openWithdrawalManual(row, 'failed')">标记失败</el-button>
                  </template>
                </el-table-column>
              </el-table>
            </el-tab-pane>
            <el-tab-pane label="死信">
              <el-table v-loading="loading" :data="deadWithdrawals" border>
                <el-table-column prop="withdrawalNo" label="提现单号" min-width="170" />
                <el-table-column prop="userId" label="用户ID" width="100" />
                <el-table-column prop="asset" label="资产" width="90" />
                <el-table-column prop="amount" label="金额" width="120" />
                <el-table-column prop="status" label="状态" width="120" />
                <el-table-column prop="lastBroadcastError" label="广播错误" min-width="240" />
                <el-table-column prop="broadcastDeadAt" label="死信时间" min-width="170" />
                <el-table-column label="操作" width="260" fixed="right">
                  <template #default="{ row }">
                    <el-button link type="primary" @click="showDetail(row)">详情</el-button>
                    <el-button link type="warning" @click="runWithdrawalRetry(row)">重播</el-button>
                    <el-button link type="success" @click="openWithdrawalManual(row, 'success')">标记成功</el-button>
                    <el-button link type="danger" @click="openWithdrawalManual(row, 'failed')">标记失败</el-button>
                  </template>
                </el-table-column>
              </el-table>
            </el-tab-pane>
          </el-tabs>
        </el-tab-pane>
      </el-tabs>
    </el-card>

    <el-dialog v-model="manualDepositVisible" title="人工充值入账" width="620px">
      <el-form :model="manualDepositForm" label-width="108px">
        <el-form-item label="用户ID"><el-input-number v-model="manualDepositForm.userId" :min="1" style="width: 100%" /></el-form-item>
        <el-form-item label="链"><el-input v-model="manualDepositForm.chain" /></el-form-item>
        <el-form-item label="交易哈希"><el-input v-model="manualDepositForm.chainTxHash" /></el-form-item>
        <el-form-item label="资产"><el-input v-model="manualDepositForm.asset" /></el-form-item>
        <el-form-item label="金额"><el-input-number v-model="manualDepositForm.amount" :min="0" :precision="6" style="width: 100%" /></el-form-item>
        <el-form-item label="确认数"><el-input-number v-model="manualDepositForm.confirmations" :min="0" style="width: 100%" /></el-form-item>
        <el-form-item label="原因"><el-input v-model="manualDepositForm.reason" type="textarea" :rows="3" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="manualDepositVisible = false">取消</el-button>
        <el-button type="primary" :loading="actionLoading" @click="submitManualDeposit">提交</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="withdrawalDialogVisible" :title="withdrawalForm.mode === 'success' ? '标记提现成功' : '标记提现失败'" width="620px">
      <el-form :model="withdrawalForm" label-width="108px">
        <el-form-item label="提现单号"><el-input v-model="withdrawalForm.withdrawalNo" disabled /></el-form-item>
        <el-form-item v-if="withdrawalForm.mode === 'success'" label="链上哈希"><el-input v-model="withdrawalForm.chainTxHash" /></el-form-item>
        <el-form-item label="原因"><el-input v-model="withdrawalForm.reason" type="textarea" :rows="3" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="withdrawalDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="actionLoading" @click="submitWithdrawalManual">提交</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="detailVisible" title="详情" width="760px">
      <pre class="json-preview">{{ JSON.stringify(detailRecord, null, 2) }}</pre>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import {
  getDepositDead,
  getDepositPending,
  getDepositRecords,
  getWalletLedgers,
  getWalletOpsStats,
  getWithdrawalBroadcastDead,
  getWithdrawalBroadcastPending,
  getWithdrawalBroadcastSummary,
  publishWithdrawalBroadcast
} from '@/apis/operation'
import type { AnyRecord } from '@/types/common'
import { formatTableDateTime } from '@/utils/date'
import { localeText as lt, enumTableFormatter } from '@/utils/i18n'
import UserSelect from '@/components/UserSelect.vue'

const loading = ref(false)
const actionLoading = ref(false)
const stats = ref<AnyRecord | null>(null)
const broadcastSummary = ref<AnyRecord | null>(null)
const ledgers = ref<AnyRecord[]>([])
const ledgerTotal = ref(0)
const deposits = ref<AnyRecord[]>([])
const withdrawals = ref<AnyRecord[]>([])
const deadWithdrawals = ref<AnyRecord[]>([])
const activeDepositStatus = ref('records')

const ledgerQuery = reactive({ current: 1, size: 10, userId: '', bizNo: '', asset: '', direction: '', status: '' })
const depositQuery = reactive({ asset: '', chainTxHash: '', limit: 20 })
const withdrawalLimit = ref(20)
const assetOptions = ['USDT', 'NEX']
const ledgerStatusOptions = ['SUCCESS', 'PENDING', 'FAILED', 'CANCELLED']

function valueOf(record: AnyRecord | null, key: string) {
  const value = record?.[key]
  return value == null || value === '' ? '-' : String(value)
}

function ledgerIndex(index: number) {
  return (ledgerQuery.current - 1) * ledgerQuery.size + index + 1
}

async function loadDeposits() {
  if (activeDepositStatus.value === 'pending') {
    deposits.value = await getDepositPending(depositQuery.limit)
    return
  }
  if (activeDepositStatus.value === 'dead') {
    deposits.value = await getDepositDead(depositQuery.limit)
    return
  }
  deposits.value = await getDepositRecords({ asset: depositQuery.asset, chainTxHash: depositQuery.chainTxHash })
}

async function loadData() {
  loading.value = true
  try {
    const [statsRes, ledgerRes, summaryRes, pendingRes, deadRes] = await Promise.allSettled([
      getWalletOpsStats(7),
      getWalletLedgers(ledgerQuery),
      getWithdrawalBroadcastSummary({ silentError: true }),
      getWithdrawalBroadcastPending(withdrawalLimit.value, { silentError: true }),
      getWithdrawalBroadcastDead(withdrawalLimit.value, { silentError: true })
    ])
    stats.value = statsRes.status === 'fulfilled' ? statsRes.value : null
    ledgers.value = ledgerRes.status === 'fulfilled' ? ledgerRes.value.records : []
    ledgerTotal.value = ledgerRes.status === 'fulfilled' ? ledgerRes.value.total : 0
    broadcastSummary.value = summaryRes.status === 'fulfilled' ? summaryRes.value : null
    withdrawals.value = pendingRes.status === 'fulfilled' ? pendingRes.value : []
    deadWithdrawals.value = deadRes.status === 'fulfilled' ? deadRes.value : []
    await loadDeposits()
  } finally {
    loading.value = false
  }
}

async function publishBroadcast() {
  actionLoading.value = true
  try {
    const result = await publishWithdrawalBroadcast(withdrawalLimit.value)
    const count = result?.published ?? result?.count ?? result?.total ?? '-'
    ElMessage.success(`${lt('提现广播已提交', 'Withdrawal broadcast submitted')}: ${count} ${lt('条', 'items')}`)
    await loadData()
  } finally {
    actionLoading.value = false
  }
}

function resetLedgerQuery() {
  Object.assign(ledgerQuery, { current: 1, userId: '', bizNo: '', asset: '', direction: '', status: '' })
  loadData()
}

function resetDepositQuery() {
  Object.assign(depositQuery, { asset: '', chainTxHash: '', limit: 20 })
  loadData()
}

onMounted(loadData)
</script>

<template>
  <div>
    <el-row :gutter="16" class="app-card">
      <el-col :xs="24" :sm="12" :md="6">
        <el-card shadow="never" class="stat-card">
          <div class="table-toolbar"><span>{{ lt('钱包数', 'Wallets') }}</span><el-icon color="#409eff" :size="24"><Wallet /></el-icon></div>
          <div class="value">{{ valueOf(stats, 'wallets') }}</div>
        </el-card>
      </el-col>
      <el-col :xs="24" :sm="12" :md="6">
        <el-card shadow="never" class="stat-card">
          <div class="table-toolbar"><span>{{ lt('流水数', 'Ledger Entries') }}</span><el-icon color="#67c23a" :size="24"><Tickets /></el-icon></div>
          <div class="value">{{ valueOf(stats, 'ledgers') }}</div>
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

    <el-card class="app-card" shadow="never">
      <template #header>{{ lt('钱包流水', 'Wallet Ledger') }}</template>
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
            <el-option label="CREDIT" value="CREDIT" />
            <el-option label="DEBIT" value="DEBIT" />
          </el-select>
        </el-form-item>
        <el-form-item :label="lt('状态', 'Status')">
          <el-select v-model="ledgerQuery.status" clearable style="width: 130px">
            <el-option v-for="status in ledgerStatusOptions" :key="status" :label="status" :value="status" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="ledgerQuery.current = 1; loadData()">{{ lt('查询', 'Search') }}</el-button>
          <el-button @click="resetLedgerQuery">{{ lt('重置', 'Reset') }}</el-button>
        </el-form-item>
      </el-form>
      <el-table v-loading="loading" :data="ledgers" border>
        <el-table-column type="index" :index="ledgerIndex" :label="lt('编号', 'No.')" width="80" />
        <el-table-column prop="userId" :label="lt('用户ID', 'User ID')" width="100" />
        <el-table-column prop="bizNo" :label="lt('业务号', 'Biz No.')" min-width="170" />
        <el-table-column prop="bizType" :label="lt('业务类型', 'Biz Type')" width="130" />
        <el-table-column prop="asset" :label="lt('资产', 'Asset')" width="90" />
        <el-table-column prop="direction" :label="lt('方向', 'Direction')" width="100" :formatter="enumTableFormatter" />
        <el-table-column prop="amount" :label="lt('金额', 'Amount')" width="130" />
        <el-table-column prop="balanceAfter" :label="lt('变动后余额', 'Balance After')" width="140" />
        <el-table-column prop="status" :label="lt('状态', 'Status')" width="110" :formatter="enumTableFormatter" />
        <el-table-column prop="remark" :label="lt('备注', 'Remark')" min-width="180" />
        <el-table-column prop="createdAt" :label="lt('创建时间', 'Created At')" min-width="170" :formatter="formatTableDateTime" />
      </el-table>
      <div class="pagination-wrap">
        <el-pagination
          v-model:current-page="ledgerQuery.current"
          v-model:page-size="ledgerQuery.size"
          layout="total, sizes, prev, pager, next"
          :total="ledgerTotal"
          @current-change="loadData"
          @size-change="loadData"
        />
      </div>
    </el-card>

    <el-card class="app-card" shadow="never">
      <div class="table-toolbar">
        <span>{{ lt('提现广播队列', 'Withdrawal Broadcast Queue') }}</span>
        <div>
          <el-input-number v-model="withdrawalLimit" :min="1" :max="200" style="width: 120px; margin-right: 10px" />
          <el-button :icon="'Refresh'" @click="loadData">{{ lt('刷新', 'Refresh') }}</el-button>
          <el-button type="primary" :loading="actionLoading" :icon="'Upload'" @click="publishBroadcast">{{ lt('发布广播', 'Publish Broadcast') }}</el-button>
        </div>
      </div>
      <el-tabs>
        <el-tab-pane :label="lt('待广播', 'Pending Broadcast')">
          <el-table v-loading="loading" :data="withdrawals" border>
            <el-table-column prop="withdrawalNo" :label="lt('提现单号', 'Withdrawal No.')" min-width="170" />
            <el-table-column prop="userId" :label="lt('用户ID', 'User ID')" width="100" />
            <el-table-column prop="asset" :label="lt('资产', 'Asset')" width="90" />
            <el-table-column prop="amount" :label="lt('金额', 'Amount')" width="120" />
            <el-table-column prop="fee" :label="lt('手续费', 'Fee')" width="110" />
            <el-table-column prop="status" :label="lt('状态', 'Status')" width="110" :formatter="enumTableFormatter" />
            <el-table-column prop="chainBroadcastAttempts" :label="lt('尝试次数', 'Attempts')" width="110" />
            <el-table-column prop="nextBroadcastAt" :label="lt('下次广播', 'Next Broadcast')" min-width="170" :formatter="formatTableDateTime" />
            <el-table-column prop="targetAddress" :label="lt('目标地址', 'Target Address')" min-width="220" />
          </el-table>
        </el-tab-pane>
        <el-tab-pane :label="lt('死信', 'DLQ')">
          <el-table v-loading="loading" :data="deadWithdrawals" border>
            <el-table-column prop="withdrawalNo" :label="lt('提现单号', 'Withdrawal No.')" min-width="170" />
            <el-table-column prop="userId" :label="lt('用户ID', 'User ID')" width="100" />
            <el-table-column prop="asset" :label="lt('资产', 'Asset')" width="90" />
            <el-table-column prop="amount" :label="lt('金额', 'Amount')" width="120" />
            <el-table-column prop="status" :label="lt('状态', 'Status')" width="110" :formatter="enumTableFormatter" />
            <el-table-column prop="lastBroadcastError" :label="lt('广播错误', 'Broadcast Error')" min-width="240" />
            <el-table-column prop="broadcastDeadAt" :label="lt('死信时间', 'DLQ At')" min-width="170" :formatter="formatTableDateTime" />
          </el-table>
        </el-tab-pane>
      </el-tabs>
    </el-card>

    <el-card shadow="never">
      <template #header>{{ lt('充值记录', 'Deposit Records') }}</template>
      <el-form :inline="true" :model="depositQuery" class="filter-form">
        <el-form-item :label="lt('状态', 'Status')">
          <el-radio-group v-model="activeDepositStatus" @change="loadData">
            <el-radio-button label="records">{{ lt('全部', 'All') }}</el-radio-button>
            <el-radio-button label="pending">{{ lt('待入账', 'Pending Credit') }}</el-radio-button>
            <el-radio-button label="dead">{{ lt('死信', 'DLQ') }}</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item :label="lt('资产', 'Asset')">
          <el-select v-model="depositQuery.asset" clearable :disabled="activeDepositStatus !== 'records'" style="width: 120px">
            <el-option v-for="asset in assetOptions" :key="asset" :label="asset" :value="asset" />
          </el-select>
        </el-form-item>
        <el-form-item :label="lt('交易哈希', 'Tx Hash')"><el-input v-model="depositQuery.chainTxHash" clearable :disabled="activeDepositStatus !== 'records'" /></el-form-item>
        <el-form-item :label="lt('条数', 'Limit')"><el-input-number v-model="depositQuery.limit" :min="1" :max="200" /></el-form-item>
        <el-form-item>
          <el-button type="primary" @click="loadData">{{ lt('查询', 'Search') }}</el-button>
          <el-button @click="resetDepositQuery">{{ lt('重置', 'Reset') }}</el-button>
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
      </el-table>
    </el-card>
  </div>
</template>

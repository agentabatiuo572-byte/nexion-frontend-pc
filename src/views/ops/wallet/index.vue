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
    ElMessage.success(`已提交广播: ${JSON.stringify(result)}`)
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

    <el-card class="app-card" shadow="never">
      <template #header>钱包流水</template>
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
          <el-button @click="resetLedgerQuery">重置</el-button>
        </el-form-item>
      </el-form>
      <el-table v-loading="loading" :data="ledgers" border>
        <el-table-column type="index" :index="ledgerIndex" label="编号" width="80" />
        <el-table-column prop="userId" label="用户ID" width="100" />
        <el-table-column prop="bizNo" label="业务号" min-width="170" />
        <el-table-column prop="bizType" label="业务类型" width="130" />
        <el-table-column prop="asset" label="资产" width="90" />
        <el-table-column prop="direction" label="方向" width="100" />
        <el-table-column prop="amount" label="金额" width="130" />
        <el-table-column prop="balanceAfter" label="变动后余额" width="140" />
        <el-table-column prop="status" label="状态" width="110" />
        <el-table-column prop="remark" label="备注" min-width="180" />
        <el-table-column prop="createdAt" label="创建时间" min-width="170" />
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
        <span>提现广播队列</span>
        <div>
          <el-input-number v-model="withdrawalLimit" :min="1" :max="200" style="width: 120px; margin-right: 10px" />
          <el-button :icon="'Refresh'" @click="loadData">刷新</el-button>
          <el-button type="primary" :loading="actionLoading" :icon="'Upload'" @click="publishBroadcast">发布广播</el-button>
        </div>
      </div>
      <el-tabs>
        <el-tab-pane label="待广播">
          <el-table v-loading="loading" :data="withdrawals" border>
            <el-table-column prop="withdrawalNo" label="提现单号" min-width="170" />
            <el-table-column prop="userId" label="用户ID" width="100" />
            <el-table-column prop="asset" label="资产" width="90" />
            <el-table-column prop="amount" label="金额" width="120" />
            <el-table-column prop="fee" label="手续费" width="110" />
            <el-table-column prop="status" label="状态" width="110" />
            <el-table-column prop="chainBroadcastAttempts" label="尝试次数" width="110" />
            <el-table-column prop="nextBroadcastAt" label="下次广播" min-width="170" />
            <el-table-column prop="targetAddress" label="目标地址" min-width="220" />
          </el-table>
        </el-tab-pane>
        <el-tab-pane label="死信">
          <el-table v-loading="loading" :data="deadWithdrawals" border>
            <el-table-column prop="withdrawalNo" label="提现单号" min-width="170" />
            <el-table-column prop="userId" label="用户ID" width="100" />
            <el-table-column prop="asset" label="资产" width="90" />
            <el-table-column prop="amount" label="金额" width="120" />
            <el-table-column prop="status" label="状态" width="110" />
            <el-table-column prop="lastBroadcastError" label="广播错误" min-width="240" />
            <el-table-column prop="broadcastDeadAt" label="死信时间" min-width="170" />
          </el-table>
        </el-tab-pane>
      </el-tabs>
    </el-card>

    <el-card shadow="never">
      <template #header>充值记录</template>
      <el-form :inline="true" :model="depositQuery" class="filter-form">
        <el-form-item label="状态">
          <el-radio-group v-model="activeDepositStatus" @change="loadData">
            <el-radio-button label="records">全部</el-radio-button>
            <el-radio-button label="pending">待入账</el-radio-button>
            <el-radio-button label="dead">死信</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="资产"><el-input v-model="depositQuery.asset" clearable :disabled="activeDepositStatus !== 'records'" /></el-form-item>
        <el-form-item label="交易哈希"><el-input v-model="depositQuery.chainTxHash" clearable :disabled="activeDepositStatus !== 'records'" /></el-form-item>
        <el-form-item label="条数"><el-input-number v-model="depositQuery.limit" :min="1" :max="200" /></el-form-item>
        <el-form-item>
          <el-button type="primary" @click="loadData">查询</el-button>
          <el-button @click="resetDepositQuery">重置</el-button>
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
      </el-table>
    </el-card>
  </div>
</template>

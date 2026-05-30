<script setup lang="ts">
import { ref } from 'vue'
import { getCommissionEvents } from '@/apis/team'
import type { AnyRecord } from '@/types/common'
import { formatTableDateTime } from '@/utils/date'
import { enumTableFormatter, localeText as lt } from '@/utils/i18n'
import UserSelect from '@/components/UserSelect.vue'

const loading = ref(false)
const rows = ref<AnyRecord[]>([])
const userId = ref('')

async function loadList() {
  loading.value = true
  try {
    const page = userId.value ? await getCommissionEvents(userId.value) : null
    rows.value = page?.records || []
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <el-card shadow="never">
    <div class="table-toolbar">
      <span>{{ lt('佣金记录', 'Commission Records') }}</span>
      <div>
        <UserSelect v-model="userId" width="260px" />
        <el-button type="primary" @click="loadList">{{ lt('查询', 'Search') }}</el-button>
      </div>
    </div>
    <el-table v-loading="loading" :data="rows" border>
      <el-table-column type="index" :label="lt('编号', 'No.')" width="90" />
      <el-table-column prop="commissionType" :label="lt('类型', 'Type')" width="140" :formatter="enumTableFormatter" />
      <el-table-column prop="sourceUserName" :label="lt('来源用户', 'Source User')" width="140" />
      <el-table-column prop="layerNo" :label="lt('层级', 'Layer')" width="90" />
      <el-table-column prop="orderNo" :label="lt('订单号', 'Order No.')" min-width="160" />
      <el-table-column prop="orderAmountUsd" :label="lt('订单金额', 'Order Amount')" width="120" />
      <el-table-column prop="amountUsdt" label="USDT" width="110" />
      <el-table-column prop="amountNex" label="NEX" width="110" />
      <el-table-column prop="status" :label="lt('状态', 'Status')" width="100" :formatter="enumTableFormatter" />
      <el-table-column prop="createdAt" :label="lt('创建时间', 'Created At')" min-width="180" :formatter="formatTableDateTime" />
    </el-table>
  </el-card>
</template>

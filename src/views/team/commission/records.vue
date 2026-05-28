<script setup lang="ts">
import { ref } from 'vue'
import { getCommissionEvents } from '@/apis/team'
import type { AnyRecord } from '@/types/common'

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
      <span>佣金记录</span>
      <div>
        <el-input v-model="userId" placeholder="用户ID" style="width: 180px; margin-right: 10px" />
        <el-button type="primary" @click="loadList">查询</el-button>
      </div>
    </div>
    <el-table v-loading="loading" :data="rows" border>
      <el-table-column type="index" label="编号" width="90" />
      <el-table-column prop="commissionType" label="类型" width="140" />
      <el-table-column prop="sourceUserName" label="来源用户" width="140" />
      <el-table-column prop="layerNo" label="层级" width="90" />
      <el-table-column prop="orderNo" label="订单号" min-width="160" />
      <el-table-column prop="orderAmountUsd" label="订单金额" width="120" />
      <el-table-column prop="amountUsdt" label="USDT" width="110" />
      <el-table-column prop="amountNex" label="NEX" width="110" />
      <el-table-column prop="status" label="状态" width="100" />
      <el-table-column prop="createdAt" label="创建时间" min-width="180" />
    </el-table>
  </el-card>
</template>

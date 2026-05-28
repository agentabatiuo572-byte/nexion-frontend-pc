<script setup lang="ts">
import { reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { settleCommission } from '@/apis/team'
import type { AnyRecord } from '@/types/common'

const result = ref<AnyRecord | null>(null)
const activeType = ref('unlock')
const forms = reactive<Record<string, AnyRecord>>({
  unlock: { limit: 100, orderNo: '', unlockBefore: '' },
  binary: { settlementDate: '', limit: 100 },
  peer: { settlementDate: '', limit: 100 },
  cultivation: { fromDate: '', limit: 100 },
  leadership: { weekStart: '', platformVolumeUsdt: 0, limit: 100 }
})

function cleanParams(data: AnyRecord) {
  return Object.fromEntries(Object.entries(data).filter(([, value]) => value !== '' && value !== null && value !== undefined))
}

async function submit() {
  result.value = await settleCommission(activeType.value, cleanParams(forms[activeType.value]))
  ElMessage.success('结算任务已提交')
}
</script>

<template>
  <el-card shadow="never">
    <template #header>佣金结算</template>
    <el-tabs v-model="activeType">
      <el-tab-pane label="解锁待结佣金" name="unlock" />
      <el-tab-pane label="二元碰撞奖" name="binary" />
      <el-tab-pane label="同级奖" name="peer" />
      <el-tab-pane label="培育奖" name="cultivation" />
      <el-tab-pane label="领导奖" name="leadership" />
    </el-tabs>

    <el-form label-width="130px" style="max-width: 760px">
      <template v-if="activeType === 'unlock'">
        <el-form-item label="处理条数"><el-input-number v-model="forms.unlock.limit" :min="1" :max="1000" style="width: 100%" /></el-form-item>
        <el-form-item label="订单号"><el-input v-model="forms.unlock.orderNo" clearable /></el-form-item>
        <el-form-item label="解锁截止">
          <el-date-picker v-model="forms.unlock.unlockBefore" type="datetime" value-format="YYYY-MM-DDTHH:mm:ss" style="width: 100%" />
        </el-form-item>
      </template>

      <template v-if="activeType === 'binary'">
        <el-form-item label="结算日期"><el-date-picker v-model="forms.binary.settlementDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" /></el-form-item>
        <el-form-item label="处理条数"><el-input-number v-model="forms.binary.limit" :min="1" :max="1000" style="width: 100%" /></el-form-item>
      </template>

      <template v-if="activeType === 'peer'">
        <el-form-item label="结算日期"><el-date-picker v-model="forms.peer.settlementDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" /></el-form-item>
        <el-form-item label="处理条数"><el-input-number v-model="forms.peer.limit" :min="1" :max="1000" style="width: 100%" /></el-form-item>
      </template>

      <template v-if="activeType === 'cultivation'">
        <el-form-item label="起始日期"><el-date-picker v-model="forms.cultivation.fromDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" /></el-form-item>
        <el-form-item label="处理条数"><el-input-number v-model="forms.cultivation.limit" :min="1" :max="1000" style="width: 100%" /></el-form-item>
      </template>

      <template v-if="activeType === 'leadership'">
        <el-form-item label="周起始日"><el-date-picker v-model="forms.leadership.weekStart" type="date" value-format="YYYY-MM-DD" style="width: 100%" /></el-form-item>
        <el-form-item label="平台业绩 USDT"><el-input-number v-model="forms.leadership.platformVolumeUsdt" :min="0" :precision="6" style="width: 100%" /></el-form-item>
        <el-form-item label="处理条数"><el-input-number v-model="forms.leadership.limit" :min="1" :max="1000" style="width: 100%" /></el-form-item>
      </template>

      <el-form-item><el-button type="primary" @click="submit">提交结算</el-button></el-form-item>
    </el-form>

    <pre v-if="result" class="json-preview">{{ JSON.stringify(result, null, 2) }}</pre>
  </el-card>
</template>

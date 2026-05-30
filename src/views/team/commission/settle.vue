<script setup lang="ts">
import { reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { settleCommission } from '@/apis/team'
import type { AnyRecord } from '@/types/common'
import ObjectDetails from '@/components/ObjectDetails.vue'
import { localeText as lt } from '@/utils/i18n'

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
  ElMessage.success(lt('结算任务已提交', 'Settlement task submitted'))
}
</script>

<template>
  <el-card shadow="never">
    <template #header>{{ lt('佣金结算', 'Commission Settlement') }}</template>
    <el-tabs v-model="activeType">
      <el-tab-pane :label="lt('解锁待结佣金', 'Unlock Pending')" name="unlock" />
      <el-tab-pane :label="lt('二元碰撞奖', 'Binary Bonus')" name="binary" />
      <el-tab-pane :label="lt('同级奖', 'Peer Bonus')" name="peer" />
      <el-tab-pane :label="lt('培育奖', 'Cultivation Bonus')" name="cultivation" />
      <el-tab-pane :label="lt('领导奖', 'Leadership Bonus')" name="leadership" />
    </el-tabs>

    <el-form label-width="130px" style="max-width: 760px">
      <template v-if="activeType === 'unlock'">
        <el-form-item :label="lt('处理条数', 'Limit')"><el-input-number v-model="forms.unlock.limit" :min="1" :max="1000" style="width: 100%" /></el-form-item>
        <el-form-item :label="lt('订单号', 'Order No.')"><el-input v-model="forms.unlock.orderNo" clearable /></el-form-item>
        <el-form-item :label="lt('解锁截止', 'Unlock Before')">
          <el-date-picker v-model="forms.unlock.unlockBefore" type="datetime" format="YYYY-MM-DD HH:mm:ss" value-format="YYYY-MM-DD HH:mm:ss" style="width: 100%" />
        </el-form-item>
      </template>

      <template v-if="activeType === 'binary'">
        <el-form-item :label="lt('结算日期', 'Settlement Date')"><el-date-picker v-model="forms.binary.settlementDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" /></el-form-item>
        <el-form-item :label="lt('处理条数', 'Limit')"><el-input-number v-model="forms.binary.limit" :min="1" :max="1000" style="width: 100%" /></el-form-item>
      </template>

      <template v-if="activeType === 'peer'">
        <el-form-item :label="lt('结算日期', 'Settlement Date')"><el-date-picker v-model="forms.peer.settlementDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" /></el-form-item>
        <el-form-item :label="lt('处理条数', 'Limit')"><el-input-number v-model="forms.peer.limit" :min="1" :max="1000" style="width: 100%" /></el-form-item>
      </template>

      <template v-if="activeType === 'cultivation'">
        <el-form-item :label="lt('起始日期', 'From Date')"><el-date-picker v-model="forms.cultivation.fromDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" /></el-form-item>
        <el-form-item :label="lt('处理条数', 'Limit')"><el-input-number v-model="forms.cultivation.limit" :min="1" :max="1000" style="width: 100%" /></el-form-item>
      </template>

      <template v-if="activeType === 'leadership'">
        <el-form-item :label="lt('周起始日', 'Week Start')"><el-date-picker v-model="forms.leadership.weekStart" type="date" value-format="YYYY-MM-DD" style="width: 100%" /></el-form-item>
        <el-form-item :label="lt('平台业绩 USDT', 'Platform Volume USDT')"><el-input-number v-model="forms.leadership.platformVolumeUsdt" :min="0" :precision="6" style="width: 100%" /></el-form-item>
        <el-form-item :label="lt('处理条数', 'Limit')"><el-input-number v-model="forms.leadership.limit" :min="1" :max="1000" style="width: 100%" /></el-form-item>
      </template>

      <el-form-item><el-button type="primary" @click="submit">{{ lt('提交结算', 'Submit Settlement') }}</el-button></el-form-item>
    </el-form>

    <ObjectDetails v-if="result" :data="result" />
  </el-card>
</template>

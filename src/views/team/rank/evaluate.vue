<script setup lang="ts">
import { reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { evaluateRank } from '@/apis/team'
import type { AnyRecord } from '@/types/common'
import UserSelect from '@/components/UserSelect.vue'
import ObjectDetails from '@/components/ObjectDetails.vue'
import { enumOptions, localeText as lt } from '@/utils/i18n'

const eventTypeOptions = ['REGISTERED', 'PHONE_COMPUTE_CONNECTED', 'FIRST_EARNING_RECEIVED', 'STORE_VIEWED', 'TEAM_VOLUME_CHANGED', 'ORDER_PAID']

const result = ref<AnyRecord | null>(null)
const form = reactive({
  userId: '',
  eventType: 'TEAM_VOLUME_CHANGED',
  registered: true,
  phoneComputeConnected: true,
  firstEarningReceived: true,
  viewedStore: true,
  lifetimeEarnedUsdt: 0,
  selfBuyUsd: 0,
  purchasedDeviceCount: 0,
  directRefs: 0,
  teamVolumeUsd: 0,
  downlineRankCounts: '{"V1":0,"V2":0}'
})

async function submitEvaluate() {
  result.value = await evaluateRank({
    ...form,
    userId: Number(form.userId),
    downlineRankCounts: JSON.parse(form.downlineRankCounts || '{}')
  })
  ElMessage.success(lt('评估完成', 'Evaluation completed'))
}
</script>

<template>
  <el-card shadow="never">
    <template #header>{{ lt('等级评估', 'Rank Evaluation') }}</template>
    <el-form :model="form" label-width="130px">
      <el-row :gutter="16">
        <el-col :span="8"><el-form-item :label="lt('用户', 'User')"><UserSelect v-model="form.userId" width="100%" /></el-form-item></el-col>
        <el-col :span="8">
          <el-form-item :label="lt('事件类型', 'Event Type')">
            <el-select v-model="form.eventType" style="width: 100%">
              <el-option v-for="item in enumOptions(eventTypeOptions)" :key="item.value" :label="item.label" :value="item.value" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="8"><el-form-item :label="lt('累计收益', 'Lifetime Earnings')"><el-input-number v-model="form.lifetimeEarnedUsdt" :min="0" style="width: 100%" /></el-form-item></el-col>
        <el-col :span="8"><el-form-item :label="lt('自购金额', 'Self Purchase')"><el-input-number v-model="form.selfBuyUsd" :min="0" style="width: 100%" /></el-form-item></el-col>
        <el-col :span="8"><el-form-item :label="lt('购买设备数', 'Purchased Devices')"><el-input-number v-model="form.purchasedDeviceCount" :min="0" style="width: 100%" /></el-form-item></el-col>
        <el-col :span="8"><el-form-item :label="lt('直推人数', 'Direct Referrals')"><el-input-number v-model="form.directRefs" :min="0" style="width: 100%" /></el-form-item></el-col>
        <el-col :span="8"><el-form-item :label="lt('团队业绩', 'Team Volume')"><el-input-number v-model="form.teamVolumeUsd" :min="0" style="width: 100%" /></el-form-item></el-col>
        <el-col :span="16"><el-form-item :label="lt('下级等级 JSON', 'Downline Rank JSON')"><el-input v-model="form.downlineRankCounts" /></el-form-item></el-col>
        <el-col :span="24">
          <el-form-item :label="lt('成长事件', 'Growth Events')">
            <el-checkbox v-model="form.registered">{{ lt('已注册', 'Registered') }}</el-checkbox>
            <el-checkbox v-model="form.phoneComputeConnected">{{ lt('算力已连接', 'Compute Connected') }}</el-checkbox>
            <el-checkbox v-model="form.firstEarningReceived">{{ lt('已获得首笔收益', 'First Earning Received') }}</el-checkbox>
            <el-checkbox v-model="form.viewedStore">{{ lt('已浏览商城', 'Store Viewed') }}</el-checkbox>
          </el-form-item>
        </el-col>
      </el-row>
      <el-button type="primary" @click="submitEvaluate">{{ lt('提交评估', 'Submit Evaluation') }}</el-button>
    </el-form>
    <ObjectDetails v-if="result" :data="result" />
  </el-card>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { evaluateRank } from '@/apis/team'
import type { AnyRecord } from '@/types/common'

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
  ElMessage.success('评估完成')
}
</script>

<template>
  <el-card shadow="never">
    <template #header>等级评估</template>
    <el-form :model="form" label-width="130px">
      <el-row :gutter="16">
        <el-col :span="8"><el-form-item label="用户ID"><el-input v-model="form.userId" /></el-form-item></el-col>
        <el-col :span="8"><el-form-item label="事件类型"><el-input v-model="form.eventType" /></el-form-item></el-col>
        <el-col :span="8"><el-form-item label="累计收益"><el-input-number v-model="form.lifetimeEarnedUsdt" :min="0" style="width: 100%" /></el-form-item></el-col>
        <el-col :span="8"><el-form-item label="自购金额"><el-input-number v-model="form.selfBuyUsd" :min="0" style="width: 100%" /></el-form-item></el-col>
        <el-col :span="8"><el-form-item label="购买设备数"><el-input-number v-model="form.purchasedDeviceCount" :min="0" style="width: 100%" /></el-form-item></el-col>
        <el-col :span="8"><el-form-item label="直推人数"><el-input-number v-model="form.directRefs" :min="0" style="width: 100%" /></el-form-item></el-col>
        <el-col :span="8"><el-form-item label="团队业绩"><el-input-number v-model="form.teamVolumeUsd" :min="0" style="width: 100%" /></el-form-item></el-col>
        <el-col :span="16"><el-form-item label="下级等级JSON"><el-input v-model="form.downlineRankCounts" /></el-form-item></el-col>
        <el-col :span="24">
          <el-form-item label="成长事件">
            <el-checkbox v-model="form.registered">已注册</el-checkbox>
            <el-checkbox v-model="form.phoneComputeConnected">算力已连接</el-checkbox>
            <el-checkbox v-model="form.firstEarningReceived">已获得首笔收益</el-checkbox>
            <el-checkbox v-model="form.viewedStore">已浏览商城</el-checkbox>
          </el-form-item>
        </el-col>
      </el-row>
      <el-button type="primary" @click="submitEvaluate">提交评估</el-button>
    </el-form>
    <pre v-if="result" class="json-preview">{{ JSON.stringify(result, null, 2) }}</pre>
  </el-card>
</template>

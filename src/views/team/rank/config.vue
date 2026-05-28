<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { getMyRank, getTeamSummary, getUserLevels, getVRanks } from '@/apis/team'
import type { AnyRecord } from '@/types/common'

const loading = ref(false)
const userLevels = ref<AnyRecord[]>([])
const vRanks = ref<AnyRecord[]>([])
const myRank = ref<AnyRecord | null>(null)
const teamSummary = ref<AnyRecord | null>(null)

async function loadData() {
  loading.value = true
  try {
    const [levels, ranks, mine, summary] = await Promise.allSettled([getUserLevels(), getVRanks(), getMyRank(), getTeamSummary()])
    userLevels.value = levels.status === 'fulfilled' ? levels.value : []
    vRanks.value = ranks.status === 'fulfilled' ? ranks.value : []
    myRank.value = mine.status === 'fulfilled' ? mine.value : null
    teamSummary.value = summary.status === 'fulfilled' ? summary.value : null
  } finally {
    loading.value = false
  }
}

onMounted(loadData)
</script>

<template>
  <div>
    <el-card class="app-card" shadow="never">
      <div class="table-toolbar">
        <span>等级概览</span>
        <el-button type="primary" @click="loadData">刷新</el-button>
      </div>
      <el-row :gutter="20">
        <el-col :span="12">
          <el-alert title="当前等级" :description="JSON.stringify(myRank || {})" type="info" :closable="false" />
        </el-col>
        <el-col :span="12">
          <el-alert title="团队概要" :description="JSON.stringify(teamSummary || {})" type="success" :closable="false" />
        </el-col>
      </el-row>
    </el-card>

    <el-card class="app-card" shadow="never">
      <template #header>L 等级配置</template>
      <el-table v-loading="loading" :data="userLevels" border>
        <el-table-column prop="levelCode" label="等级" width="100" />
        <el-table-column prop="levelName" label="名称" width="140" />
        <el-table-column prop="entryCondition" label="准入条件" min-width="260" />
        <el-table-column prop="coreGoal" label="核心目标" min-width="260" />
        <el-table-column prop="status" label="状态" width="90" />
      </el-table>
    </el-card>

    <el-card shadow="never">
      <template #header>V 等级配置</template>
      <el-table v-loading="loading" :data="vRanks" border>
        <el-table-column prop="rankCode" label="等级" width="100" />
        <el-table-column prop="titleCn" label="中文名" width="140" />
        <el-table-column prop="selfBuyUsd" label="自购" width="110" />
        <el-table-column prop="directRefs" label="直推" width="90" />
        <el-table-column prop="teamVolumeUsd" label="团队业绩" width="120" />
        <el-table-column prop="requiredDownlineRank" label="下级等级" width="120" />
        <el-table-column prop="requiredDownlineCount" label="下级数量" width="110" />
        <el-table-column prop="leadershipVotes" label="票权" width="90" />
        <el-table-column prop="physicalReward" label="实物奖励" min-width="180" />
      </el-table>
    </el-card>
  </div>
</template>

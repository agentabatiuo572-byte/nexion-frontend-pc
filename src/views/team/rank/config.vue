<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { getTeamSummary, getUserLevels, getUserRank, getVRanks, searchTeamUsers } from '@/apis/team'
import type { AnyRecord } from '@/types/common'
import { enumLabel, localeText as lt } from '@/utils/i18n'

const loading = ref(false)
const userQueryLoading = ref(false)
const userLevels = ref<AnyRecord[]>([])
const vRanks = ref<AnyRecord[]>([])
const selectedRank = ref<AnyRecord | null>(null)
const selectedSummary = ref<AnyRecord | null>(null)
const userOptions = ref<AnyRecord[]>([])
const userSearchLoading = ref(false)
const userQuery = reactive({ keyword: '', userId: undefined as number | undefined })

const enabledUserLevelCount = computed(() => userLevels.value.filter((item) => Number(item.status) === 1).length)
const enabledVRankCount = computed(() => vRanks.value.filter((item) => Number(item.status) === 1).length)
const highestVRank = computed(() => {
  const enabled = vRanks.value.filter((item) => Number(item.status) === 1)
  return enabled.length ? enabled[enabled.length - 1] : null
})
const totalLeadershipVotes = computed(() => vRanks.value.reduce((sum, item) => sum + Number(item.leadershipVotes || 0), 0))
const maxTeamVolume = computed(() => Number(highestVRank.value?.teamVolumeUsd || 0))
const recentCommissionCount = computed(() => Array.isArray(selectedSummary.value?.recentCommissions) ? selectedSummary.value.recentCommissions.length : 0)

function money(value: unknown) {
  return Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })
}

async function loadData() {
  loading.value = true
  try {
    const [levels, ranks] = await Promise.all([getUserLevels(), getVRanks()])
    userLevels.value = levels
    vRanks.value = ranks
  } finally {
    loading.value = false
  }
}

async function queryUser() {
  if (!userQuery.userId) {
    ElMessage.warning(lt('请先搜索并选择用户', 'Please search and select a user first'))
    return
  }
  userQueryLoading.value = true
  try {
    const [rank, summary] = await Promise.all([
      getUserRank(userQuery.userId),
      getTeamSummary({ userId: userQuery.userId }, { silentError: true }).catch(() => null)
    ])
    selectedRank.value = rank
    selectedSummary.value = summary
  } finally {
    userQueryLoading.value = false
  }
}

async function remoteSearchUsers(keyword: string) {
  const normalized = keyword.trim()
  userQuery.keyword = normalized
  if (normalized.length < 2) {
    userOptions.value = []
    return
  }
  userSearchLoading.value = true
  try {
    userOptions.value = await searchTeamUsers(normalized, { silentError: true })
  } finally {
    userSearchLoading.value = false
  }
}

function userOptionLabel(user: AnyRecord) {
  return `${user.nickname || lt('未命名用户', 'Unnamed User')} / ${user.phoneMasked || '-'} / ${user.referralCode || '-'}`
}

onMounted(loadData)
</script>

<template>
  <div>
    <el-card class="app-card" shadow="never">
      <div class="table-toolbar">
        <span>{{ lt('等级运营概览', 'Rank Ops Overview') }}</span>
        <el-button type="primary" @click="loadData">{{ lt('刷新', 'Refresh') }}</el-button>
      </div>
      <el-row :gutter="16" class="metric-row">
        <el-col :span="6">
          <div class="metric-box">
            <span>{{ lt('L 等级', 'L Levels') }}</span>
            <strong>{{ enabledUserLevelCount }} / {{ userLevels.length }}</strong>
          </div>
        </el-col>
        <el-col :span="6">
          <div class="metric-box">
            <span>{{ lt('V 等级', 'V Ranks') }}</span>
            <strong>{{ enabledVRankCount }} / {{ vRanks.length }}</strong>
          </div>
        </el-col>
        <el-col :span="6">
          <div class="metric-box">
            <span>{{ lt('最高等级', 'Highest Rank') }}</span>
            <strong>{{ highestVRank?.rankCode || '-' }}</strong>
          </div>
        </el-col>
        <el-col :span="6">
          <div class="metric-box">
            <span>{{ lt('最高团队业绩', 'Highest Team Volume') }}</span>
            <strong>${{ money(maxTeamVolume) }}</strong>
          </div>
        </el-col>
      </el-row>
    </el-card>

    <el-card class="app-card" shadow="never">
      <template #header>{{ lt('用户等级查询', 'User Rank Lookup') }}</template>
      <el-form :inline="true" :model="userQuery" class="filter-form">
        <el-form-item :label="lt('用户', 'User')">
          <el-select
            v-model="userQuery.userId"
            filterable
            remote
            clearable
            reserve-keyword
            :remote-method="remoteSearchUsers"
            :loading="userSearchLoading"
            :placeholder="lt('输入手机号、昵称或推荐码搜索', 'Search by phone, nickname, or referral code')"
            style="width: 360px"
          >
            <el-option
              v-for="item in userOptions"
              :key="item.userId"
              :label="userOptionLabel(item)"
              :value="Number(item.userId)"
            >
              <div class="user-option">
                <strong>{{ item.nickname || lt('未命名用户', 'Unnamed User') }}</strong>
                <span>{{ item.phoneMasked }} · {{ item.referralCode }} · {{ item.userLevel }}/{{ item.vRank }}</span>
              </div>
            </el-option>
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="userQueryLoading" @click="queryUser">{{ lt('查询', 'Search') }}</el-button>
        </el-form-item>
      </el-form>
      <el-row :gutter="16">
        <el-col :span="12">
          <el-descriptions :title="lt('等级状态', 'Rank Status')" :column="2" border>
            <el-descriptions-item :label="lt('L 等级', 'L Level')">{{ selectedRank?.userLevel || '-' }}</el-descriptions-item>
            <el-descriptions-item :label="lt('L 名称', 'L Name')">{{ selectedRank?.userLevelName || '-' }}</el-descriptions-item>
            <el-descriptions-item :label="lt('V 等级', 'V Rank')">{{ selectedRank?.vRank || '-' }}</el-descriptions-item>
            <el-descriptions-item :label="lt('V 名称', 'V Name')">{{ selectedRank?.vRankTitleCn || selectedRank?.vRankTitleEn || '-' }}</el-descriptions-item>
            <el-descriptions-item :label="lt('直推', 'Direct Referrals')">{{ selectedRank?.directRefs ?? 0 }}</el-descriptions-item>
            <el-descriptions-item :label="lt('团队人数', 'Team Members')">{{ selectedRank?.teamCount ?? 0 }}</el-descriptions-item>
          </el-descriptions>
        </el-col>
        <el-col :span="12">
          <el-descriptions :title="lt('团队概要', 'Team Summary')" :column="2" border>
            <el-descriptions-item :label="lt('直推', 'Direct Referrals')">{{ selectedSummary?.directCount ?? 0 }}</el-descriptions-item>
            <el-descriptions-item :label="lt('团队人数', 'Team Members')">{{ selectedSummary?.teamCount ?? 0 }}</el-descriptions-item>
            <el-descriptions-item :label="lt('佣金笔数', 'Commission Count')">{{ selectedSummary?.commissionCount ?? 0 }}</el-descriptions-item>
            <el-descriptions-item :label="lt('待释放 USDT', 'Pending USDT')">{{ money(selectedSummary?.pendingUsdt) }}</el-descriptions-item>
            <el-descriptions-item :label="lt('待释放 NEX', 'Pending NEX')">{{ money(selectedSummary?.pendingNex) }}</el-descriptions-item>
            <el-descriptions-item :label="lt('近期佣金', 'Recent Commissions')">{{ recentCommissionCount }}</el-descriptions-item>
          </el-descriptions>
        </el-col>
      </el-row>
    </el-card>

    <el-card class="app-card" shadow="never">
      <template #header>{{ lt('L 等级配置', 'L Level Config') }}</template>
      <el-table v-loading="loading" :data="userLevels" border>
        <el-table-column prop="levelCode" :label="lt('等级', 'Level')" width="100" />
        <el-table-column prop="levelName" :label="lt('名称', 'Name')" width="150" />
        <el-table-column prop="entryCondition" :label="lt('准入条件', 'Entry Condition')" min-width="260" />
        <el-table-column prop="coreGoal" :label="lt('核心目标', 'Core Goal')" min-width="260" />
        <el-table-column prop="status" :label="lt('状态', 'Status')" width="90">
          <template #default="{ row }">{{ enumLabel(row.status) }}</template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-card shadow="never">
      <template #header>{{ lt('V 等级配置', 'V Rank Config') }}</template>
      <el-table v-loading="loading" :data="vRanks" border>
        <el-table-column prop="rankCode" :label="lt('等级', 'Rank')" width="100" />
        <el-table-column prop="titleCn" :label="lt('名称', 'Name')" width="140" />
        <el-table-column prop="selfBuyUsd" :label="lt('自购', 'Self Buy')" width="110">
          <template #default="{ row }">${{ money(row.selfBuyUsd) }}</template>
        </el-table-column>
        <el-table-column prop="directRefs" :label="lt('直推', 'Direct')" width="90" />
        <el-table-column prop="teamVolumeUsd" :label="lt('团队业绩', 'Team Volume')" width="130">
          <template #default="{ row }">${{ money(row.teamVolumeUsd) }}</template>
        </el-table-column>
        <el-table-column prop="requiredDownlineRank" :label="lt('下级等级', 'Downline Rank')" width="120" />
        <el-table-column prop="requiredDownlineCount" :label="lt('下级数量', 'Downline Count')" width="110" />
        <el-table-column prop="leadershipVotes" :label="lt('票权', 'Votes')" width="90" />
        <el-table-column prop="physicalReward" :label="lt('实物奖励', 'Physical Reward')" min-width="180" />
      </el-table>
      <div class="table-footer">{{ lt('总票权', 'Total Votes') }}：{{ totalLeadershipVotes }}</div>
    </el-card>
  </div>
</template>

<style scoped>
.metric-row {
  margin-top: 4px;
}

.metric-box {
  min-height: 78px;
  border: 1px solid #ebeef5;
  border-radius: 6px;
  padding: 14px 16px;
  background: #ffffff;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 8px;
}

.metric-box span {
  color: #606266;
  font-size: 13px;
}

.metric-box strong {
  color: #1f2d3d;
  font-size: 22px;
  font-weight: 650;
}

.table-footer {
  margin-top: 12px;
  color: #606266;
  font-size: 13px;
}

.user-option {
  display: flex;
  flex-direction: column;
  line-height: 1.35;
}

.user-option span {
  color: #909399;
  font-size: 12px;
}
</style>

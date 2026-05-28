<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { getAdminPage, getPermissionPage, getRolePage } from '@/apis/auth'
import { getBffOpsDashboard, getDeviceFleetConfig, getGenesisSeries, getProducts } from '@/apis/operation'
import type { AnyRecord } from '@/types/common'

const baseServerUrl = import.meta.env.VITE_BASE_SERVER_URL || '/api'
const dashboard = ref<AnyRecord | null>(null)
const upstreamIcons = ['ShoppingCart', 'Wallet', 'Checked', 'Connection', 'Flag', 'Bell', 'DataLine', 'Setting']
const upstreamColors = ['#409eff', '#67c23a', '#e6a23c', '#626aef', '#f56c6c', '#14b8a6', '#909399', '#8b5cf6']
const stats = reactive([
  { title: '管理员', value: '0', icon: 'User', color: '#409eff' },
  { title: '角色', value: '0', icon: 'UserFilled', color: '#67c23a' },
  { title: 'API 权限', value: '0', icon: 'Key', color: '#e6a23c' },
  { title: '商品 SKU', value: '0', icon: 'Goods', color: '#f56c6c' },
  { title: 'Genesis 系列', value: '0', icon: 'CollectionTag', color: '#626aef' },
  { title: '激活槽位', value: '0', icon: 'Grid', color: '#909399' }
])

function sectionValue(section: unknown, key: string) {
  if (!section || typeof section !== 'object') return '-'
  const value = (section as AnyRecord)[key]
  return value == null || value === '' ? '-' : String(value)
}

const upstreamCards = computed(() => {
  const upstreams = dashboard.value?.upstreams
  if (!upstreams || typeof upstreams !== 'object') return []
  return Object.entries(upstreams as AnyRecord).map(([key, value], index) => {
    const record = value && typeof value === 'object' ? (value as AnyRecord) : {}
    return {
      key,
      title: key,
      service: sectionValue(record, 'service'),
      primary: firstMetric(record),
      icon: upstreamIcons[index % upstreamIcons.length],
      color: upstreamColors[index % upstreamColors.length]
    }
  })
})

function firstMetric(record: AnyRecord) {
  for (const value of Object.values(record)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const nested = value as AnyRecord
      for (const key of ['total', 'pending', 'reviewing', 'dead', 'active', 'success']) {
        if (nested[key] != null) return String(nested[key])
      }
    }
  }
  return '-'
}

async function loadData() {
  const [admins, roles, permissions, products, series, slots, ops] = await Promise.allSettled([
    getAdminPage({ current: 1, size: 1 }),
    getRolePage({ current: 1, size: 1 }),
    getPermissionPage({ current: 1, size: 1 }),
    getProducts({ current: 1, size: 1 }, { silentError: true }),
    getGenesisSeries({ current: 1, size: 1 }, { silentError: true }),
    getDeviceFleetConfig({ silentError: true }),
    getBffOpsDashboard(7, { silentError: true })
  ])
  stats[0].value = admins.status === 'fulfilled' ? String(admins.value.total) : '0'
  stats[1].value = roles.status === 'fulfilled' ? String(roles.value.total) : '0'
  stats[2].value = permissions.status === 'fulfilled' ? String(permissions.value.total) : '0'
  stats[3].value = products.status === 'fulfilled' ? String(products.value.total) : '0'
  stats[4].value = series.status === 'fulfilled' ? String(series.value.total) : '0'
  stats[5].value = slots.status === 'fulfilled' ? String(slots.value.maxActiveSlots) : '0'
  dashboard.value = ops.status === 'fulfilled' ? ops.value : null
}

onMounted(loadData)
</script>

<template>
  <div>
    <el-row :gutter="20">
      <el-col v-for="item in stats" :key="item.title" :xs="24" :sm="12" :md="8" :lg="4">
        <el-card shadow="hover" class="stat-card">
          <div class="table-toolbar">
            <span>{{ item.title }}</span>
            <el-icon :color="item.color" :size="24"><component :is="item.icon" /></el-icon>
          </div>
          <div class="value">{{ item.value }}</div>
        </el-card>
      </el-col>
    </el-row>

    <section class="ops-panel app-card">
      <div class="table-toolbar">
        <span>运营基线</span>
        <el-button :icon="'Refresh'" @click="loadData">刷新</el-button>
      </div>
      <el-descriptions :column="3" border class="app-card">
        <el-descriptions-item label="后端网关">{{ baseServerUrl }}</el-descriptions-item>
        <el-descriptions-item label="统计周期">{{ sectionValue(dashboard, 'days') }} 天</el-descriptions-item>
        <el-descriptions-item label="生成时间">{{ sectionValue(dashboard, 'generatedAt') }}</el-descriptions-item>
      </el-descriptions>
      <el-row :gutter="16">
        <el-col v-for="item in upstreamCards" :key="item.key" :xs="24" :sm="12" :md="6">
          <el-card shadow="never" class="upstream-card">
            <div class="table-toolbar">
              <span>{{ item.title }}</span>
              <el-icon :color="item.color" :size="22"><component :is="item.icon" /></el-icon>
            </div>
            <div class="upstream-card__metric">{{ item.primary }}</div>
            <div class="upstream-card__service">{{ item.service }}</div>
          </el-card>
        </el-col>
      </el-row>
    </section>
  </div>
</template>

<style scoped>
.ops-panel {
  padding: 18px;
  border: 1px solid #ebeef5;
  border-radius: 4px;
  background: #fff;
}

.upstream-card {
  height: 126px;
  margin-bottom: 16px;
}

.upstream-card__metric {
  font-size: 26px;
  font-weight: 700;
  line-height: 1.2;
}

.upstream-card__service {
  margin-top: 8px;
  color: #909399;
  font-size: 13px;
  word-break: break-word;
}
</style>

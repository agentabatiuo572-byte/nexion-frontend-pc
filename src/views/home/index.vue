<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { getAdminPage, getPermissionPage, getRolePage } from '@/apis/auth'
import { getBffOpsDashboard, getDeviceFleetConfig, getGenesisSeries, getProducts } from '@/apis/operation'
import type { AnyRecord } from '@/types/common'

const baseServerUrl = import.meta.env.VITE_BASE_SERVER_URL || '/api'
const dashboard = ref<AnyRecord | null>(null)
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

    <el-card class="app-card" shadow="never">
      <template #header>运营基线</template>
      <el-descriptions :column="3" border>
        <el-descriptions-item label="后端网关">{{ baseServerUrl }}</el-descriptions-item>
        <el-descriptions-item label="统计周期">{{ sectionValue(dashboard, 'days') }} 天</el-descriptions-item>
        <el-descriptions-item label="生成时间">{{ sectionValue(dashboard, 'generatedAt') }}</el-descriptions-item>
        <el-descriptions-item label="Commerce">
          {{ sectionValue((dashboard?.upstreams as AnyRecord | undefined)?.commerce, 'service') }}
        </el-descriptions-item>
        <el-descriptions-item label="Wallet">
          {{ sectionValue((dashboard?.upstreams as AnyRecord | undefined)?.wallet, 'service') }}
        </el-descriptions-item>
        <el-descriptions-item label="OpenAPI">
          {{ sectionValue((dashboard?.upstreams as AnyRecord | undefined)?.openapi, 'service') }}
        </el-descriptions-item>
      </el-descriptions>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import ObjectImageUpload from '@/components/ObjectImageUpload.vue'
import {
  getUserDetail,
  getUserPage,
  updateUser,
  updateUserStatus,
  type CEndUser
} from '@/apis/auth'
import { getProductMediaPreviewUrl } from '@/apis/operation'
import type { Id } from '@/types/common'
import { formatDateTime, formatTableDateTime } from '@/utils/date'
import { enumLabel, enumOptions, localeText as lt } from '@/utils/i18n'

const userStatuses = ['ACTIVE', 'FROZEN', 'DISABLED']
const kycStatuses = ['PENDING', 'APPROVED', 'REJECTED', 'EXPIRED']
const userLevels = ['L0', 'L1', 'L2', 'L3', 'L4', 'L5']
const vRanks = ['V0', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6']
const languages = [
  { label: 'English', value: 'en-US' },
  { label: '中文', value: 'zh-CN' }
]
const timezones = [
  'Asia/Singapore (UTC+8)',
  'Asia/Tokyo (UTC+9)',
  'Asia/Hong_Kong (UTC+8)',
  'Europe/Berlin (UTC+1)',
  'Europe/London (UTC+0)',
  'Asia/Dubai (UTC+4)',
  'America/New_York (UTC-5)'
]

const loading = ref(false)
const saving = ref(false)
const rows = ref<CEndUser[]>([])
const total = ref(0)
const detailVisible = ref(false)
const editVisible = ref(false)
const selected = ref<CEndUser | null>(null)
const avatarPreviewUrls = reactive<Record<string, string>>({})
const query = reactive({
  current: 1,
  size: 10,
  phone: '',
  nickname: '',
  referralCode: '',
  status: '',
  kycStatus: '',
  userLevel: '',
  vRank: ''
})
const form = reactive({
  id: '' as Id | '',
  nickname: '',
  avatarUrl: '',
  language: '',
  region: '',
  bio: '',
  timezone: ''
})

function rowIndex(index: number) {
  return (query.current - 1) * query.size + index + 1
}

function statusTag(status?: string) {
  if (status === 'ACTIVE') return 'success'
  if (status === 'FROZEN') return 'warning'
  if (status === 'DISABLED') return 'danger'
  return 'info'
}

function isAbsoluteUrl(value?: string) {
  return !!value && /^https?:\/\//i.test(value)
}

function isPresetAvatar(value?: string) {
  return !!value && value.startsWith('mech:')
}

async function loadAvatarPreview(avatarUrl?: string) {
  if (!avatarUrl || avatarPreviewUrls[avatarUrl]) return
  if (isPresetAvatar(avatarUrl)) return
  if (isAbsoluteUrl(avatarUrl)) {
    avatarPreviewUrls[avatarUrl] = avatarUrl
    return
  }
  try {
    const response = await getProductMediaPreviewUrl(avatarUrl)
    if (response.downloadUrl) {
      avatarPreviewUrls[avatarUrl] = response.downloadUrl
    }
  } catch {
    // 头像预览失败不影响用户列表和资料编辑。
  }
}

function avatarPreview(avatarUrl?: string) {
  if (!avatarUrl || isPresetAvatar(avatarUrl)) return ''
  return avatarPreviewUrls[avatarUrl] || ''
}

function fallbackInitial(user?: CEndUser | null) {
  return String(user?.nickname || user?.id || 'U').slice(0, 1).toUpperCase()
}

function loadRowAvatars() {
  rows.value.forEach((row) => {
    if (row.avatarUrl) {
      void loadAvatarPreview(row.avatarUrl)
    }
  })
}

async function loadList() {
  loading.value = true
  try {
    const page = await getUserPage(query)
    rows.value = page.records || []
    total.value = Number(page.total || 0)
    loadRowAvatars()
  } finally {
    loading.value = false
  }
}

function resetQuery() {
  Object.assign(query, {
    current: 1,
    phone: '',
    nickname: '',
    referralCode: '',
    status: '',
    kycStatus: '',
    userLevel: '',
    vRank: ''
  })
  loadList()
}

async function openDetail(row: CEndUser) {
  if (!row.id) return
  selected.value = await getUserDetail(row.id)
  await loadAvatarPreview(selected.value.avatarUrl)
  detailVisible.value = true
}

async function openEdit(row: CEndUser) {
  const detail = row.id ? await getUserDetail(row.id) : row
  Object.assign(form, {
    id: detail.id || '',
    nickname: detail.nickname || '',
    avatarUrl: detail.avatarUrl || '',
    language: detail.language || 'en-US',
    region: detail.region || '',
    bio: detail.bio || '',
    timezone: detail.timezone || ''
  })
  editVisible.value = true
}

async function submitEdit() {
  if (!form.id) return
  if (!form.nickname.trim()) {
    ElMessage.warning(lt('昵称不能为空', 'Nickname cannot be blank'))
    return
  }
  saving.value = true
  try {
    await updateUser(form.id, {
      nickname: form.nickname,
      avatarUrl: form.avatarUrl,
      language: form.language,
      region: form.region,
      bio: form.bio,
      timezone: form.timezone
    })
    ElMessage.success(lt('保存成功', 'Saved'))
    editVisible.value = false
    await loadList()
  } finally {
    saving.value = false
  }
}

async function toggleEnabled(row: CEndUser, enabled: boolean | string | number) {
  if (!row.id || row.status === 'FROZEN') return
  const nextStatus = enabled ? 'ACTIVE' : 'DISABLED'
  if (row.status === nextStatus) return
  await ElMessageBox.confirm(
    `${lt('确认将用户', 'Confirm setting user')} ${row.id} ${lt('状态改为', 'status to')} ${enumLabel(nextStatus)}?`,
    lt('启用状态变更', 'Enable Status Change'),
    { type: nextStatus === 'ACTIVE' ? 'success' : 'warning' }
  )
  await updateUserStatus(row.id, nextStatus)
  ElMessage.success(lt('状态已更新', 'Status updated'))
  await loadList()
  if (selected.value?.id === row.id) {
    selected.value = await getUserDetail(row.id)
  }
}

async function toggleFrozen(row: CEndUser) {
  if (!row.id) return
  const nextStatus = row.status === 'FROZEN' ? 'ACTIVE' : 'FROZEN'
  await ElMessageBox.confirm(
    `${lt('确认将用户', 'Confirm setting user')} ${row.id} ${lt('状态改为', 'status to')} ${enumLabel(nextStatus)}?`,
    row.status === 'FROZEN' ? lt('解除冻结', 'Unfreeze User') : lt('冻结用户', 'Freeze User'),
    { type: 'warning' }
  )
  await updateUserStatus(row.id, nextStatus)
  ElMessage.success(lt('状态已更新', 'Status updated'))
  await loadList()
  if (selected.value?.id === row.id) {
    selected.value = await getUserDetail(row.id)
  }
}

onMounted(loadList)
</script>

<template>
  <div class="user-ops-page">
    <el-card class="app-card" shadow="never">
      <el-form :inline="true" :model="query" class="filter-form">
        <el-form-item :label="lt('手机号', 'Phone')"><el-input v-model="query.phone" clearable /></el-form-item>
        <el-form-item :label="lt('昵称', 'Nickname')"><el-input v-model="query.nickname" clearable /></el-form-item>
        <el-form-item :label="lt('推荐码', 'Referral Code')"><el-input v-model="query.referralCode" clearable /></el-form-item>
        <el-form-item :label="lt('状态', 'Status')">
          <el-select v-model="query.status" clearable style="width: 140px">
            <el-option v-for="item in enumOptions(userStatuses)" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
        </el-form-item>
        <el-form-item :label="lt('KYC', 'KYC')">
          <el-select v-model="query.kycStatus" clearable style="width: 140px">
            <el-option v-for="item in enumOptions(kycStatuses)" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
        </el-form-item>
        <el-form-item :label="lt('L 等级', 'L Level')">
          <el-select v-model="query.userLevel" clearable style="width: 110px">
            <el-option v-for="item in userLevels" :key="item" :label="item" :value="item" />
          </el-select>
        </el-form-item>
        <el-form-item :label="lt('V 等级', 'V Rank')">
          <el-select v-model="query.vRank" clearable style="width: 110px">
            <el-option v-for="item in vRanks" :key="item" :label="item" :value="item" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="query.current = 1; loadList()">{{ lt('查询', 'Search') }}</el-button>
          <el-button @click="resetQuery">{{ lt('重置', 'Reset') }}</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card shadow="never">
      <div class="table-toolbar">
        <span>{{ lt('C 端用户', 'C-End Users') }}</span>
        <el-button :icon="'Refresh'" @click="loadList">{{ lt('刷新', 'Refresh') }}</el-button>
      </div>
      <el-table v-loading="loading" :data="rows" border>
        <el-table-column type="index" :index="rowIndex" :label="lt('编号', 'No.')" width="80" />
        <el-table-column :label="lt('用户', 'User')" min-width="190">
          <template #default="{ row }">
            <div class="user-cell">
              <el-avatar :size="36" :src="avatarPreview(row.avatarUrl)">{{ fallbackInitial(row) }}</el-avatar>
              <div>
                <strong>{{ row.nickname || '-' }}</strong>
                <span>ID {{ row.id }} · {{ row.phoneMasked || row.phone || '-' }}</span>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column :label="lt('启用状态', 'Enabled')" width="130">
          <template #default="{ row }">
            <div class="enabled-cell">
              <el-switch
                :model-value="row.status === 'ACTIVE'"
                :disabled="row.status === 'FROZEN'"
                inline-prompt
                :active-text="lt('启', 'On')"
                :inactive-text="lt('禁', 'Off')"
                @change="(value: boolean | string | number) => toggleEnabled(row, value)"
              />
              <span v-if="row.status === 'FROZEN'" class="status-text status-frozen">{{ enumLabel(row.status) }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="referralCode" :label="lt('推荐码', 'Referral Code')" width="120" />
        <el-table-column prop="sponsorCode" :label="lt('上级推荐码', 'Sponsor Code')" width="120" />
        <el-table-column :label="lt('KYC', 'KYC')" width="100">
          <template #default="{ row }"><span class="status-text">{{ enumLabel(row.kycStatus) }}</span></template>
        </el-table-column>
        <el-table-column :label="lt('等级', 'Level')" width="90">
          <template #default="{ row }">{{ row.userLevel || '-' }} / {{ row.vRank || '-' }}</template>
        </el-table-column>
        <el-table-column prop="createdAt" :label="lt('注册时间', 'Registered At')" min-width="155" :formatter="formatTableDateTime" />
        <el-table-column :label="lt('操作', 'Actions')" width="170" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openDetail(row)">{{ lt('详情', 'Details') }}</el-button>
            <el-button link type="primary" @click="openEdit(row)">{{ lt('编辑', 'Edit') }}</el-button>
            <el-button link type="warning" @click="toggleFrozen(row)">{{ row.status === 'FROZEN' ? lt('解冻', 'Unfreeze') : lt('冻结', 'Freeze') }}</el-button>
          </template>
        </el-table-column>
      </el-table>
      <div class="pagination-wrap">
        <el-pagination
          v-model:current-page="query.current"
          v-model:page-size="query.size"
          layout="total, sizes, prev, pager, next"
          :total="total"
          @current-change="loadList"
          @size-change="loadList"
        />
      </div>
    </el-card>

    <el-drawer v-model="detailVisible" :title="lt('用户详情', 'User Details')" size="720px">
      <template v-if="selected">
        <el-descriptions :title="lt('基础信息', 'Basic Info')" border :column="2">
          <el-descriptions-item :label="lt('用户 ID', 'User ID')">{{ selected.id }}</el-descriptions-item>
          <el-descriptions-item :label="lt('昵称', 'Nickname')">{{ selected.nickname || '-' }}</el-descriptions-item>
          <el-descriptions-item :label="lt('国家区号', 'Country Code')">{{ selected.countryCode || '-' }}</el-descriptions-item>
          <el-descriptions-item :label="lt('手机号', 'Phone')">{{ selected.phone || '-' }}</el-descriptions-item>
          <el-descriptions-item :label="lt('简介', 'Bio')" :span="2">{{ selected.bio || '-' }}</el-descriptions-item>
          <el-descriptions-item :label="lt('头像', 'Avatar')" :span="2">
            <div v-if="selected.avatarUrl && avatarPreview(selected.avatarUrl)" class="avatar-preview-wrap">
              <el-image class="avatar-preview" :src="avatarPreview(selected.avatarUrl)" fit="cover" :preview-src-list="[avatarPreview(selected.avatarUrl)]" preview-teleported />
            </div>
            <span v-else>{{ lt('暂无', 'None') }}</span>
          </el-descriptions-item>
        </el-descriptions>

        <el-descriptions class="detail-section" :title="lt('账户状态', 'Account Status')" border :column="2">
          <el-descriptions-item :label="lt('状态', 'Status')"><el-tag :type="statusTag(selected.status)">{{ enumLabel(selected.status) }}</el-tag></el-descriptions-item>
          <el-descriptions-item :label="lt('语言', 'Language')">{{ selected.language || '-' }}</el-descriptions-item>
          <el-descriptions-item :label="lt('地区', 'Region')">{{ selected.region || '-' }}</el-descriptions-item>
          <el-descriptions-item :label="lt('时区', 'Timezone')">{{ selected.timezone || '-' }}</el-descriptions-item>
          <el-descriptions-item :label="lt('KYC 状态', 'KYC Status')">{{ enumLabel(selected.kycStatus) }}</el-descriptions-item>
        </el-descriptions>

        <el-descriptions class="detail-section" :title="lt('推荐关系', 'Referral')" border :column="2">
          <el-descriptions-item :label="lt('推荐码', 'Referral Code')">{{ selected.referralCode || '-' }}</el-descriptions-item>
          <el-descriptions-item :label="lt('上级用户 ID', 'Sponsor User ID')">{{ selected.sponsorUserId || '-' }}</el-descriptions-item>
          <el-descriptions-item :label="lt('上级推荐码', 'Sponsor Code')">{{ selected.sponsorCode || '-' }}</el-descriptions-item>
        </el-descriptions>

        <el-descriptions class="detail-section" :title="lt('等级信息', 'Level Info')" border :column="2">
          <el-descriptions-item :label="lt('L 等级', 'L Level')">{{ selected.userLevel || '-' }}</el-descriptions-item>
          <el-descriptions-item :label="lt('V 等级', 'V Rank')">{{ selected.vRank || '-' }}</el-descriptions-item>
        </el-descriptions>

        <el-descriptions class="detail-section" :title="lt('时间信息', 'Time Info')" border :column="2">
          <el-descriptions-item :label="lt('创建时间', 'Created At')">{{ formatDateTime(selected.createdAt) }}</el-descriptions-item>
          <el-descriptions-item :label="lt('更新时间', 'Updated At')">{{ formatDateTime(selected.updatedAt) }}</el-descriptions-item>
        </el-descriptions>
      </template>
    </el-drawer>

    <el-dialog v-model="editVisible" :title="lt('编辑用户资料', 'Edit User Profile')" width="560px">
      <el-form :model="form" label-width="100px">
        <el-form-item :label="lt('用户 ID', 'User ID')"><el-input v-model="form.id" disabled /></el-form-item>
        <el-form-item :label="lt('昵称', 'Nickname')"><el-input v-model="form.nickname" maxlength="64" show-word-limit /></el-form-item>
        <el-form-item :label="lt('头像', 'Avatar')">
          <ObjectImageUpload
            v-model="form.avatarUrl"
            media-type="USER_AVATAR"
            :empty-title="lt('上传用户头像', 'Upload User Avatar')"
            :empty-description="lt('拖拽或点击上传头像，支持 PNG/JPG/WebP', 'Drag or click to upload avatar. PNG/JPG/WebP supported')"
          />
        </el-form-item>
        <el-form-item :label="lt('语言', 'Language')">
          <el-select v-model="form.language" clearable style="width: 100%">
            <el-option v-for="item in languages" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
        </el-form-item>
        <el-form-item :label="lt('地区', 'Region')"><el-input v-model="form.region" maxlength="32" /></el-form-item>
        <el-form-item :label="lt('时区', 'Timezone')">
          <el-select v-model="form.timezone" clearable filterable allow-create style="width: 100%">
            <el-option v-for="item in timezones" :key="item" :label="item" :value="item" />
          </el-select>
        </el-form-item>
        <el-form-item :label="lt('简介', 'Bio')"><el-input v-model="form.bio" type="textarea" maxlength="512" show-word-limit :rows="4" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editVisible = false">{{ lt('取消', 'Cancel') }}</el-button>
        <el-button type="primary" :loading="saving" @click="submitEdit">{{ lt('保存', 'Save') }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.user-ops-page {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.user-cell {
  display: flex;
  align-items: center;
  gap: 10px;
}

.user-cell > div {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.user-cell strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.user-cell span {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.detail-section {
  margin-top: 18px;
}

.avatar-preview-wrap {
  display: flex;
  align-items: center;
}

.avatar-preview {
  width: 72px;
  height: 72px;
  overflow: hidden;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 50%;
  background: var(--el-fill-color-light);
}

.enabled-cell {
  display: flex;
  align-items: center;
  gap: 8px;
}

.status-text {
  color: var(--el-text-color-primary);
  font-weight: 500;
}

.status-active {
  color: var(--el-color-success);
}

.status-frozen {
  color: var(--el-color-warning);
}

.status-disabled {
  color: var(--el-color-danger);
}
</style>

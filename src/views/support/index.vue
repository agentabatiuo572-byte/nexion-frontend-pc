<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import {
  getSupportTicket,
  getSupportTickets,
  replySupportTicket,
  updateSupportTicket,
  type SupportTicket
} from '@/apis/operation'
import type { AnyRecord, Id } from '@/types/common'
import { formatDateTime, formatNow, formatTableDateTime } from '@/utils/date'
import { localeText as lt, enumLabel } from '@/utils/i18n'
import UserSelect from '@/components/UserSelect.vue'

const loading = ref(false)
const saving = ref(false)
const detailLoading = ref(false)
const rows = ref<SupportTicket[]>([])
const total = ref(0)
const selected = ref<SupportTicket | null>(null)
const detailVisible = ref(false)
const lastAction = ref('')
const replyFormRef = ref<FormInstance>()

const query = reactive({
  current: 1,
  size: 20,
  status: '',
  category: '',
  priority: '',
  userId: '' as Id | '',
  assignedAdminId: '' as Id | ''
})

const updateForm = reactive({
  status: '',
  priority: '',
  category: '',
  assignedAdminId: '' as Id | '',
  assignedAdminName: ''
})

const replyForm = reactive({ content: '' })

const replyRules: FormRules = {
  content: [
    { required: true, message: lt('请填写客服回复', 'Please enter agent reply'), trigger: 'blur' },
    { min: 2, max: 4000, message: lt('回复内容长度为 2-4000 字符', 'Reply length must be 2-4000 characters'), trigger: 'blur' }
  ]
}

const statusOptions = ['OPEN', 'WAITING_AGENT', 'WAITING_USER', 'PROCESSING', 'RESOLVED', 'CLOSED']
const priorityOptions = ['LOW', 'NORMAL', 'HIGH', 'URGENT']
const categoryOptions = ['GENERAL', 'ACCOUNT', 'PAYMENT', 'WALLET', 'DEVICE', 'GENESIS', 'KYC', 'OTHER']

const summary = computed(() => {
  return rows.value.reduce<Record<string, number>>((acc, row) => {
    const status = String(row.status || 'UNKNOWN')
    acc[status] = (acc[status] || 0) + 1
    return acc
  }, {})
})

function compactParams(record: AnyRecord) {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== '' && value != null))
}

function statusType(status: unknown) {
  const value = String(status || '').toUpperCase()
  if (value === 'OPEN' || value === 'WAITING_AGENT') return 'warning'
  if (value === 'PROCESSING' || value === 'WAITING_USER') return 'primary'
  if (value === 'RESOLVED') return 'success'
  if (value === 'CLOSED') return 'info'
  return 'info'
}

function priorityType(priority: unknown) {
  const value = String(priority || '').toUpperCase()
  if (value === 'URGENT') return 'danger'
  if (value === 'HIGH') return 'warning'
  if (value === 'NORMAL') return 'primary'
  return 'info'
}

function messageSide(senderType: unknown) {
  return String(senderType || '').toUpperCase() === 'USER' ? 'user-message' : 'ops-message'
}

function fillUpdateForm(ticket: SupportTicket) {
  Object.assign(updateForm, {
    status: ticket.status || '',
    priority: ticket.priority || '',
    category: ticket.category || '',
    assignedAdminId: ticket.assignedAdminId || '',
    assignedAdminName: ticket.assignedAdminName || ''
  })
}

async function loadTickets() {
  loading.value = true
  try {
    const page = await getSupportTickets(compactParams(query) as typeof query)
    rows.value = page.records || []
    total.value = Number(page.total || 0)
  } finally {
    loading.value = false
  }
}

async function openDetail(row: SupportTicket) {
  if (!row.ticketNo) return
  detailVisible.value = true
  detailLoading.value = true
  try {
    selected.value = await getSupportTicket(row.ticketNo)
    fillUpdateForm(selected.value)
  } finally {
    detailLoading.value = false
  }
}

async function refreshDetail() {
  if (!selected.value?.ticketNo) return
  const detail = await getSupportTicket(selected.value.ticketNo)
  selected.value = detail
  fillUpdateForm(detail)
}

async function search() {
  query.current = 1
  await loadTickets()
}

async function saveUpdate() {
  if (!selected.value?.ticketNo) return
  const payload = compactParams(updateForm)
  if (!Object.keys(payload).length) {
    ElMessage.warning(lt('没有可提交的变更', 'No changes to submit'))
    return
  }
  await ElMessageBox.confirm(`确认更新工单 ${selected.value.ticketNo}?`, lt('工单维护', 'Ticket Update'), { type: 'warning' })
  saving.value = true
  try {
    selected.value = await updateSupportTicket(selected.value.ticketNo, payload)
    fillUpdateForm(selected.value)
    lastAction.value = `已更新工单 ${selected.value.ticketNo}，${formatNow()}`
    ElMessage.success(lt('工单已更新', 'Ticket updated'))
    await loadTickets()
  } finally {
    saving.value = false
  }
}

async function sendReply() {
  if (!selected.value?.ticketNo) return
  try {
    await replyFormRef.value?.validate()
  } catch {
    return
  }
  await ElMessageBox.confirm(`确认回复工单 ${selected.value.ticketNo}? 回复后用户会收到通知`, lt('客服回复', 'Agent Reply'), { type: 'warning' })
  saving.value = true
  try {
    selected.value = await replySupportTicket(selected.value.ticketNo, replyForm.content)
    fillUpdateForm(selected.value)
    lastAction.value = `已回复工单 ${selected.value.ticketNo}，${formatNow()}`
    replyForm.content = ''
    ElMessage.success(lt('回复已发送', 'Reply sent'))
    await loadTickets()
  } finally {
    saving.value = false
  }
}

onMounted(loadTickets)
</script>

<template>
  <div>
    <el-row :gutter="16" class="app-card">
      <el-col :xs="24" :sm="12" :md="6">
        <el-card shadow="never" class="stat-card">
          <div class="table-toolbar"><span>{{ lt('当前页工单', 'Tickets On Page') }}</span><el-icon color="#409eff" :size="24"><Service /></el-icon></div>
          <div class="value">{{ rows.length }}</div>
        </el-card>
      </el-col>
      <el-col :xs="24" :sm="12" :md="6">
        <el-card shadow="never" class="stat-card">
          <div class="table-toolbar"><span>{{ lt('待客服', 'Waiting Agent') }}</span><el-icon color="#e6a23c" :size="24"><Warning /></el-icon></div>
          <div class="value">{{ (summary.OPEN || 0) + (summary.WAITING_AGENT || 0) }}</div>
        </el-card>
      </el-col>
      <el-col :xs="24" :sm="12" :md="6">
        <el-card shadow="never" class="stat-card">
          <div class="table-toolbar"><span>{{ lt('处理中', 'Processing') }}</span><el-icon color="#409eff" :size="24"><Operation /></el-icon></div>
          <div class="value">{{ summary.PROCESSING || 0 }}</div>
        </el-card>
      </el-col>
      <el-col :xs="24" :sm="12" :md="6">
        <el-card shadow="never" class="stat-card">
          <div class="table-toolbar"><span>{{ lt('已关闭', 'Closed') }}</span><el-icon color="#909399" :size="24"><CircleClose /></el-icon></div>
          <div class="value">{{ summary.CLOSED || 0 }}</div>
        </el-card>
      </el-col>
    </el-row>

    <el-card shadow="never">
      <div class="table-toolbar">
        <span>{{ lt('客服工单', 'Support Tickets') }}</span>
        <el-button :icon="'Refresh'" @click="loadTickets">{{ lt('刷新', 'Refresh') }}</el-button>
      </div>
      <el-alert v-if="lastAction" :title="lastAction" type="success" show-icon :closable="false" class="operation-alert" />

      <el-form :inline="true" :model="query" class="filter-form">
        <el-form-item :label="lt('状态', 'Status')">
          <el-select v-model="query.status" clearable filterable style="width: 170px">
            <el-option v-for="item in statusOptions" :key="item" :label="item" :value="item" />
          </el-select>
        </el-form-item>
        <el-form-item :label="lt('分类', 'Category')">
          <el-select v-model="query.category" clearable filterable style="width: 150px">
            <el-option v-for="item in categoryOptions" :key="item" :label="item" :value="item" />
          </el-select>
        </el-form-item>
        <el-form-item :label="lt('优先级', 'Priority')">
          <el-select v-model="query.priority" clearable filterable style="width: 140px">
            <el-option v-for="item in priorityOptions" :key="item" :label="item" :value="item" />
          </el-select>
        </el-form-item>
        <el-form-item :label="lt('用户', 'User')"><UserSelect v-model="query.userId" /></el-form-item>
        <el-form-item :label="lt('处理人 ID', 'Assignee ID')"><el-input v-model="query.assignedAdminId" clearable style="width: 130px" /></el-form-item>
        <el-form-item>
          <el-button type="primary" @click="search">{{ lt('查询', 'Search') }}</el-button>
          <el-button @click="() => Object.assign(query, { current: 1, status: '', category: '', priority: '', userId: '', assignedAdminId: '' })">{{ lt('重置', 'Reset') }}</el-button>
        </el-form-item>
      </el-form>

      <el-table v-loading="loading" :data="rows" border>
        <el-table-column prop="ticketNo" :label="lt('工单号', 'Ticket No.')" min-width="170" />
        <el-table-column prop="title" :label="lt('标题', 'Title')" min-width="220" show-overflow-tooltip />
        <el-table-column prop="userId" :label="lt('用户 ID', 'User ID')" width="100" />
        <el-table-column prop="category" :label="lt('分类', 'Category')" width="120" />
        <el-table-column prop="priority" :label="lt('优先级', 'Priority')" width="110">
          <template #default="{ row }"><el-tag :type="priorityType(row.priority)">{{ row.priority }}</el-tag></template>
        </el-table-column>
        <el-table-column prop="status" :label="lt('状态', 'Status')" width="140">
          <template #default="{ row }"><el-tag :type="statusType(row.status)">{{ enumLabel(row.status) }}</el-tag></template>
        </el-table-column>
        <el-table-column prop="assignedAdminName" :label="lt('处理人', 'Assignee')" width="140" />
        <el-table-column prop="opsUnreadCount" :label="lt('未读', 'Unread')" width="80" />
        <el-table-column prop="messageCount" :label="lt('消息', 'Messages')" width="80" />
        <el-table-column prop="lastMessageAt" :label="lt('最后消息', 'Last Message')" min-width="170" :formatter="formatTableDateTime" />
        <el-table-column :label="lt('操作', 'Actions')" width="90" fixed="right">
          <template #default="{ row }"><el-button link type="primary" @click="openDetail(row)">{{ lt('处理', 'Handle') }}</el-button></template>
        </el-table-column>
      </el-table>

      <div class="pagination-wrap">
        <el-pagination
          v-model:current-page="query.current"
          v-model:page-size="query.size"
          layout="total, sizes, prev, pager, next"
          :page-sizes="[10, 20, 50, 100]"
          :total="total"
          @current-change="loadTickets"
          @size-change="loadTickets"
        />
      </div>
    </el-card>

    <el-drawer v-model="detailVisible" size="760px" :title="lt('工单处理', 'Ticket Handling')">
      <div v-loading="detailLoading">
        <template v-if="selected">
          <el-descriptions :column="2" border class="app-card">
            <el-descriptions-item :label="lt('工单号', 'Ticket No.')">{{ selected.ticketNo }}</el-descriptions-item>
            <el-descriptions-item :label="lt('用户 ID', 'User ID')">{{ selected.userId }}</el-descriptions-item>
            <el-descriptions-item :label="lt('标题', 'Title')" :span="2">{{ selected.title }}</el-descriptions-item>
            <el-descriptions-item :label="lt('分类', 'Category')">{{ selected.category }}</el-descriptions-item>
            <el-descriptions-item :label="lt('优先级', 'Priority')"><el-tag :type="priorityType(selected.priority)">{{ selected.priority }}</el-tag></el-descriptions-item>
            <el-descriptions-item :label="lt('状态', 'Status')"><el-tag :type="statusType(selected.status)">{{ enumLabel(selected.status) }}</el-tag></el-descriptions-item>
            <el-descriptions-item :label="lt('处理人', 'Assignee')">{{ selected.assignedAdminName || '-' }} / {{ selected.assignedAdminId || '-' }}</el-descriptions-item>
            <el-descriptions-item :label="lt('创建时间', 'Created At')">{{ formatDateTime(selected.createdAt) }}</el-descriptions-item>
            <el-descriptions-item :label="lt('最后消息', 'Last Message')">{{ formatDateTime(selected.lastMessageAt) }}</el-descriptions-item>
          </el-descriptions>

          <el-card shadow="never" class="app-card">
            <div class="table-toolbar">
              <span>{{ lt('状态维护', 'Status Maintenance') }}</span>
              <el-button :icon="'Refresh'" @click="refreshDetail">{{ lt('刷新详情', 'Refresh Detail') }}</el-button>
            </div>
            <el-form :inline="true" :model="updateForm" class="filter-form maintenance-form">
              <el-form-item :label="lt('状态', 'Status')">
                <el-select v-model="updateForm.status" clearable style="width: 170px">
                  <el-option v-for="item in statusOptions" :key="item" :label="item" :value="item" />
                </el-select>
              </el-form-item>
              <el-form-item :label="lt('优先级', 'Priority')">
                <el-select v-model="updateForm.priority" clearable style="width: 140px">
                  <el-option v-for="item in priorityOptions" :key="item" :label="item" :value="item" />
                </el-select>
              </el-form-item>
              <el-form-item :label="lt('分类', 'Category')">
                <el-select v-model="updateForm.category" clearable filterable style="width: 150px">
                  <el-option v-for="item in categoryOptions" :key="item" :label="item" :value="item" />
                </el-select>
              </el-form-item>
              <el-form-item :label="lt('处理人 ID', 'Assignee ID')"><el-input v-model="updateForm.assignedAdminId" clearable style="width: 130px" /></el-form-item>
              <el-form-item :label="lt('处理人', 'Assignee')"><el-input v-model="updateForm.assignedAdminName" clearable style="width: 160px" /></el-form-item>
              <el-form-item><el-button type="primary" :loading="saving" @click="saveUpdate">{{ lt('保存维护', 'Save Update') }}</el-button></el-form-item>
            </el-form>
          </el-card>

          <el-card shadow="never" class="app-card">
            <div class="table-toolbar"><span>{{ lt('消息线程', 'Message Thread') }}</span><span>{{ selected.messageCount || 0 }} 条</span></div>
            <div class="message-thread">
              <div v-for="message in selected.messages || []" :key="message.id" class="message-row" :class="messageSide(message.senderType)">
                <div class="message-meta">
                  <strong>{{ message.senderName || message.senderType }}</strong>
                  <span>{{ message.senderType }} · {{ formatDateTime(message.createdAt) }}</span>
                </div>
                <div class="message-content">{{ message.content }}</div>
                <div v-if="message.attachments?.length" class="attachment-list">
                  <el-tag v-for="attachment in message.attachments" :key="String(attachment.id || attachment.objectKey)" size="small">
                    {{ attachment.fileName || attachment.objectKey }}
                  </el-tag>
                </div>
              </div>
            </div>
          </el-card>

          <el-card shadow="never">
            <div class="table-toolbar"><span>{{ lt('客服回复', 'Agent Reply') }}</span></div>
            <el-form ref="replyFormRef" :model="replyForm" :rules="replyRules">
              <el-form-item prop="content">
                <el-input v-model="replyForm.content" type="textarea" :rows="5" maxlength="4000" show-word-limit />
              </el-form-item>
              <el-form-item>
                <el-button type="primary" :loading="saving" @click="sendReply">{{ lt('发送回复', 'Send Reply') }}</el-button>
              </el-form-item>
            </el-form>
          </el-card>
        </template>
      </div>
    </el-drawer>
  </div>
</template>

<style scoped>
.message-thread {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.message-row {
  max-width: 78%;
  padding: 12px;
  border: 1px solid #ebeef5;
  border-radius: 6px;
  background: #f8fafc;
}

.user-message {
  margin-right: auto;
}

.ops-message {
  margin-left: auto;
  background: #ecf5ff;
  border-color: #d9ecff;
}

.message-meta {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
  color: #606266;
  font-size: 12px;
}

.message-content {
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.5;
}

.attachment-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}

.maintenance-form {
  display: flex;
  flex-wrap: wrap;
  gap: 0 12px;
}
</style>

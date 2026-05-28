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
    { required: true, message: '请填写客服回复', trigger: 'blur' },
    { min: 2, max: 4000, message: '回复内容长度为 2-4000 字符', trigger: 'blur' }
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
    ElMessage.warning('没有可提交的变更')
    return
  }
  await ElMessageBox.confirm(`确认更新工单 ${selected.value.ticketNo}?`, '工单维护', { type: 'warning' })
  saving.value = true
  try {
    selected.value = await updateSupportTicket(selected.value.ticketNo, payload)
    fillUpdateForm(selected.value)
    lastAction.value = `已更新工单 ${selected.value.ticketNo}，${new Date().toLocaleString()}`
    ElMessage.success('工单已更新')
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
  await ElMessageBox.confirm(`确认回复工单 ${selected.value.ticketNo}? 回复后用户会收到通知`, '客服回复', { type: 'warning' })
  saving.value = true
  try {
    selected.value = await replySupportTicket(selected.value.ticketNo, replyForm.content)
    fillUpdateForm(selected.value)
    lastAction.value = `已回复工单 ${selected.value.ticketNo}，${new Date().toLocaleString()}`
    replyForm.content = ''
    ElMessage.success('回复已发送')
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
          <div class="table-toolbar"><span>当前页工单</span><el-icon color="#409eff" :size="24"><Service /></el-icon></div>
          <div class="value">{{ rows.length }}</div>
        </el-card>
      </el-col>
      <el-col :xs="24" :sm="12" :md="6">
        <el-card shadow="never" class="stat-card">
          <div class="table-toolbar"><span>待客服</span><el-icon color="#e6a23c" :size="24"><Warning /></el-icon></div>
          <div class="value">{{ (summary.OPEN || 0) + (summary.WAITING_AGENT || 0) }}</div>
        </el-card>
      </el-col>
      <el-col :xs="24" :sm="12" :md="6">
        <el-card shadow="never" class="stat-card">
          <div class="table-toolbar"><span>处理中</span><el-icon color="#409eff" :size="24"><Operation /></el-icon></div>
          <div class="value">{{ summary.PROCESSING || 0 }}</div>
        </el-card>
      </el-col>
      <el-col :xs="24" :sm="12" :md="6">
        <el-card shadow="never" class="stat-card">
          <div class="table-toolbar"><span>已关闭</span><el-icon color="#909399" :size="24"><CircleClose /></el-icon></div>
          <div class="value">{{ summary.CLOSED || 0 }}</div>
        </el-card>
      </el-col>
    </el-row>

    <el-card shadow="never">
      <div class="table-toolbar">
        <span>客服工单</span>
        <el-button :icon="'Refresh'" @click="loadTickets">刷新</el-button>
      </div>
      <el-alert v-if="lastAction" :title="lastAction" type="success" show-icon :closable="false" class="operation-alert" />

      <el-form :inline="true" :model="query" class="filter-form">
        <el-form-item label="状态">
          <el-select v-model="query.status" clearable filterable style="width: 170px">
            <el-option v-for="item in statusOptions" :key="item" :label="item" :value="item" />
          </el-select>
        </el-form-item>
        <el-form-item label="分类">
          <el-select v-model="query.category" clearable filterable style="width: 150px">
            <el-option v-for="item in categoryOptions" :key="item" :label="item" :value="item" />
          </el-select>
        </el-form-item>
        <el-form-item label="优先级">
          <el-select v-model="query.priority" clearable filterable style="width: 140px">
            <el-option v-for="item in priorityOptions" :key="item" :label="item" :value="item" />
          </el-select>
        </el-form-item>
        <el-form-item label="用户 ID"><el-input v-model="query.userId" clearable style="width: 130px" /></el-form-item>
        <el-form-item label="处理人 ID"><el-input v-model="query.assignedAdminId" clearable style="width: 130px" /></el-form-item>
        <el-form-item>
          <el-button type="primary" @click="search">查询</el-button>
          <el-button @click="() => Object.assign(query, { current: 1, status: '', category: '', priority: '', userId: '', assignedAdminId: '' })">重置</el-button>
        </el-form-item>
      </el-form>

      <el-table v-loading="loading" :data="rows" border>
        <el-table-column prop="ticketNo" label="工单号" min-width="170" />
        <el-table-column prop="title" label="标题" min-width="220" show-overflow-tooltip />
        <el-table-column prop="userId" label="用户 ID" width="100" />
        <el-table-column prop="category" label="分类" width="120" />
        <el-table-column prop="priority" label="优先级" width="110">
          <template #default="{ row }"><el-tag :type="priorityType(row.priority)">{{ row.priority }}</el-tag></template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="140">
          <template #default="{ row }"><el-tag :type="statusType(row.status)">{{ row.status }}</el-tag></template>
        </el-table-column>
        <el-table-column prop="assignedAdminName" label="处理人" width="140" />
        <el-table-column prop="opsUnreadCount" label="未读" width="80" />
        <el-table-column prop="messageCount" label="消息" width="80" />
        <el-table-column prop="lastMessageAt" label="最后消息" min-width="170" />
        <el-table-column label="操作" width="90" fixed="right">
          <template #default="{ row }"><el-button link type="primary" @click="openDetail(row)">处理</el-button></template>
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

    <el-drawer v-model="detailVisible" size="760px" title="工单处理">
      <div v-loading="detailLoading">
        <template v-if="selected">
          <el-descriptions :column="2" border class="app-card">
            <el-descriptions-item label="工单号">{{ selected.ticketNo }}</el-descriptions-item>
            <el-descriptions-item label="用户 ID">{{ selected.userId }}</el-descriptions-item>
            <el-descriptions-item label="标题" :span="2">{{ selected.title }}</el-descriptions-item>
            <el-descriptions-item label="分类">{{ selected.category }}</el-descriptions-item>
            <el-descriptions-item label="优先级"><el-tag :type="priorityType(selected.priority)">{{ selected.priority }}</el-tag></el-descriptions-item>
            <el-descriptions-item label="状态"><el-tag :type="statusType(selected.status)">{{ selected.status }}</el-tag></el-descriptions-item>
            <el-descriptions-item label="处理人">{{ selected.assignedAdminName || '-' }} / {{ selected.assignedAdminId || '-' }}</el-descriptions-item>
            <el-descriptions-item label="创建时间">{{ selected.createdAt }}</el-descriptions-item>
            <el-descriptions-item label="最后消息">{{ selected.lastMessageAt }}</el-descriptions-item>
          </el-descriptions>

          <el-card shadow="never" class="app-card">
            <div class="table-toolbar">
              <span>状态维护</span>
              <el-button :icon="'Refresh'" @click="refreshDetail">刷新详情</el-button>
            </div>
            <el-form :inline="true" :model="updateForm" class="filter-form maintenance-form">
              <el-form-item label="状态">
                <el-select v-model="updateForm.status" clearable style="width: 170px">
                  <el-option v-for="item in statusOptions" :key="item" :label="item" :value="item" />
                </el-select>
              </el-form-item>
              <el-form-item label="优先级">
                <el-select v-model="updateForm.priority" clearable style="width: 140px">
                  <el-option v-for="item in priorityOptions" :key="item" :label="item" :value="item" />
                </el-select>
              </el-form-item>
              <el-form-item label="分类">
                <el-select v-model="updateForm.category" clearable filterable style="width: 150px">
                  <el-option v-for="item in categoryOptions" :key="item" :label="item" :value="item" />
                </el-select>
              </el-form-item>
              <el-form-item label="处理人 ID"><el-input v-model="updateForm.assignedAdminId" clearable style="width: 130px" /></el-form-item>
              <el-form-item label="处理人"><el-input v-model="updateForm.assignedAdminName" clearable style="width: 160px" /></el-form-item>
              <el-form-item><el-button type="primary" :loading="saving" @click="saveUpdate">保存维护</el-button></el-form-item>
            </el-form>
          </el-card>

          <el-card shadow="never" class="app-card">
            <div class="table-toolbar"><span>消息线程</span><span>{{ selected.messageCount || 0 }} 条</span></div>
            <div class="message-thread">
              <div v-for="message in selected.messages || []" :key="message.id" class="message-row" :class="messageSide(message.senderType)">
                <div class="message-meta">
                  <strong>{{ message.senderName || message.senderType }}</strong>
                  <span>{{ message.senderType }} · {{ message.createdAt }}</span>
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
            <div class="table-toolbar"><span>客服回复</span></div>
            <el-form ref="replyFormRef" :model="replyForm" :rules="replyRules">
              <el-form-item prop="content">
                <el-input v-model="replyForm.content" type="textarea" :rows="5" maxlength="4000" show-word-limit />
              </el-form-item>
              <el-form-item>
                <el-button type="primary" :loading="saving" @click="sendReply">发送回复</el-button>
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

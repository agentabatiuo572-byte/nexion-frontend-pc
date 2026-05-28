<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  assignAdminRoles,
  createAdmin,
  deleteAdmin,
  getAdminPage,
  getAdminRoleIds,
  getRolePage,
  updateAdmin,
  type Admin,
  type Role
} from '@/apis/auth'
import type { Id } from '@/types/common'

const ROOT_ADMIN_ID = 1

const loading = ref(false)
const roleLoading = ref(false)
const rows = ref<Admin[]>([])
const total = ref(0)
const roleOptions = ref<Role[]>([])
const dialogVisible = ref(false)
const dialogTitle = ref('新增管理员')
const roleDialogVisible = ref(false)
const query = reactive({ current: 1, size: 10, username: '', phone: '', status: '', superAdmin: '' })
const form = reactive<Admin>({ username: '', password: '', nickname: '', email: '', phone: '', superAdmin: 0, status: 1 })
const roleForm = reactive<{ adminId: Id | ''; roleIds: Id[] }>({ adminId: '', roleIds: [] })

function isRootAdmin(row: Admin) {
  return Number(row.id) === ROOT_ADMIN_ID
}

function getRowIndex(index: number) {
  return (query.current - 1) * query.size + index + 1
}

async function loadList() {
  loading.value = true
  try {
    const page = await getAdminPage(query)
    rows.value = page.records
    total.value = page.total
  } finally {
    loading.value = false
  }
}

async function loadRoles() {
  roleLoading.value = true
  try {
    const page = await getRolePage({ current: 1, size: 100 })
    roleOptions.value = page.records
  } finally {
    roleLoading.value = false
  }
}

function resetQuery() {
  Object.assign(query, { username: '', phone: '', status: '', superAdmin: '', current: 1 })
  loadList()
}

function resetForm() {
  Object.assign(form, { id: undefined, username: '', password: '', nickname: '', email: '', phone: '', superAdmin: 0, status: 1 })
}

function openCreate() {
  resetForm()
  dialogTitle.value = '新增管理员'
  dialogVisible.value = true
}

function openEdit(row: Admin) {
  if (isRootAdmin(row)) return
  Object.assign(form, row, { password: '' })
  dialogTitle.value = '编辑管理员'
  dialogVisible.value = true
}

async function openRoleDialog(row: Admin) {
  if (isRootAdmin(row)) return
  roleForm.adminId = row.id || ''
  roleForm.roleIds = []
  roleDialogVisible.value = true
  const [roleResult, currentRoleResult] = await Promise.allSettled([
    roleOptions.value.length ? Promise.resolve() : loadRoles(),
    getAdminRoleIds(row.id!)
  ])
  if (roleResult.status === 'rejected') throw roleResult.reason
  if (currentRoleResult.status === 'fulfilled') {
    roleForm.roleIds = currentRoleResult.value
  }
}

async function submitForm() {
  if (form.id) {
    await updateAdmin(form.id, form)
  } else {
    await createAdmin(form)
  }
  ElMessage.success('保存成功')
  dialogVisible.value = false
  loadList()
}

async function handleStatusChange(row: Admin, value: string | number | boolean) {
  const nextStatus = Number(value)
  const previousStatus = nextStatus === 1 ? 0 : 1
  if (isRootAdmin(row)) {
    row.status = previousStatus
    return
  }
  try {
    await updateAdmin(row.id!, { nickname: row.nickname, email: row.email, phone: row.phone, superAdmin: row.superAdmin, status: nextStatus })
    ElMessage.success(nextStatus === 1 ? '已启用' : '已禁用')
  } catch (error) {
    row.status = previousStatus
    throw error
  }
}

async function handleDelete(row: Admin) {
  if (isRootAdmin(row)) return
  await ElMessageBox.confirm(`确认删除管理员 ${row.username}?`, '提示', { type: 'warning' })
  await deleteAdmin(row.id!)
  ElMessage.success('删除成功')
  loadList()
}

async function submitRoles() {
  await assignAdminRoles(roleForm.adminId, roleForm.roleIds)
  ElMessage.success('分配成功')
  roleDialogVisible.value = false
}

onMounted(loadList)
</script>

<template>
  <div>
    <el-card class="app-card" shadow="never">
      <el-form :inline="true" :model="query" class="filter-form">
        <el-form-item label="用户名"><el-input v-model="query.username" clearable /></el-form-item>
        <el-form-item label="手机号"><el-input v-model="query.phone" clearable /></el-form-item>
        <el-form-item label="状态">
          <el-select v-model="query.status" clearable style="width: 120px">
            <el-option label="启用" value="1" />
            <el-option label="禁用" value="0" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="query.current = 1; loadList()">查询</el-button>
          <el-button @click="resetQuery">重置</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card shadow="never">
      <div class="table-toolbar">
        <span>数据列表</span>
        <el-button type="primary" @click="openCreate">添加</el-button>
      </div>
      <el-table v-loading="loading" :data="rows" border>
        <el-table-column type="index" :index="getRowIndex" label="编号" width="90" />
        <el-table-column prop="username" label="用户名" min-width="120" />
        <el-table-column prop="nickname" label="昵称" min-width="120" />
        <el-table-column prop="phone" label="手机号" min-width="130" />
        <el-table-column prop="email" label="邮箱" min-width="180" />
        <el-table-column label="超管" width="90">
          <template #default="{ row }">
            <el-tag :type="row.superAdmin === 1 ? 'danger' : 'info'" effect="plain">
              {{ row.superAdmin === 1 ? '是' : '否' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="120">
          <template #default="{ row }">
            <el-switch
              v-model="row.status"
              inline-prompt
              :active-value="1"
              :inactive-value="0"
              active-text="启"
              inactive-text="禁"
              :disabled="isRootAdmin(row)"
              @change="(value: string | number | boolean) => handleStatusChange(row, value)"
            />
          </template>
        </el-table-column>
        <el-table-column label="操作" width="260" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" :disabled="isRootAdmin(row)" @click="openEdit(row)">编辑</el-button>
            <el-button link type="primary" :disabled="isRootAdmin(row)" @click="openRoleDialog(row)">分配角色</el-button>
            <el-button link type="danger" :disabled="isRootAdmin(row)" @click="handleDelete(row)">删除</el-button>
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

    <el-dialog v-model="dialogVisible" :title="dialogTitle" width="520px">
      <el-form :model="form" label-width="96px">
        <el-form-item label="用户名"><el-input v-model="form.username" :disabled="!!form.id" /></el-form-item>
        <el-form-item v-if="!form.id" label="密码"><el-input v-model="form.password" type="password" show-password /></el-form-item>
        <el-form-item label="昵称"><el-input v-model="form.nickname" /></el-form-item>
        <el-form-item label="邮箱"><el-input v-model="form.email" /></el-form-item>
        <el-form-item label="手机号"><el-input v-model="form.phone" /></el-form-item>
        <el-form-item label="是否超管"><el-switch v-model="form.superAdmin" :active-value="1" :inactive-value="0" /></el-form-item>
        <el-form-item label="状态"><el-switch v-model="form.status" :active-value="1" :inactive-value="0" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submitForm">确定</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="roleDialogVisible" title="分配角色" width="520px">
      <el-form label-width="96px">
        <el-form-item label="角色">
          <el-select
            v-model="roleForm.roleIds"
            v-loading="roleLoading"
            multiple
            filterable
            clearable
            placeholder="请选择角色"
            style="width: 100%"
          >
            <el-option
              v-for="role in roleOptions"
              :key="role.id"
              :label="`${role.roleName || '-'}（${role.roleCode || role.id}）`"
              :value="role.id!"
            />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="roleDialogVisible = false">取消</el-button>
        <el-button type="primary" :disabled="!roleForm.adminId" @click="submitRoles">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

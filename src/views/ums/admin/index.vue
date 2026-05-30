<script setup lang="ts">
import { localeText as lt } from '@/utils/i18n'
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
const dialogTitle = ref(lt('新增管理员', 'New Admin'))
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
  dialogTitle.value = lt('新增管理员', 'New Admin')
  dialogVisible.value = true
}

function openEdit(row: Admin) {
  if (isRootAdmin(row)) return
  Object.assign(form, row, { password: '' })
  dialogTitle.value = lt('编辑管理员', 'Edit Admin')
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
  ElMessage.success(lt('保存成功', 'Saved'))
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
    ElMessage.success(nextStatus === 1 ? lt('已启用', 'Enabled') : lt('已禁用', 'Disabled'))
  } catch (error) {
    row.status = previousStatus
    throw error
  }
}

async function handleDelete(row: Admin) {
  if (isRootAdmin(row)) return
  await ElMessageBox.confirm(`确认删除管理员 ${row.username}?`, lt('提示', 'Prompt'), { type: 'warning' })
  await deleteAdmin(row.id!)
  ElMessage.success(lt('删除成功', 'Deleted'))
  loadList()
}

async function submitRoles() {
  await assignAdminRoles(roleForm.adminId, roleForm.roleIds)
  ElMessage.success(lt('分配成功', 'Assigned'))
  roleDialogVisible.value = false
}

onMounted(loadList)
</script>

<template>
  <div>
    <el-card class="app-card" shadow="never">
      <el-form :inline="true" :model="query" class="filter-form">
        <el-form-item :label="lt('用户名', 'Username')"><el-input v-model="query.username" clearable /></el-form-item>
        <el-form-item :label="lt('手机号', 'Phone')"><el-input v-model="query.phone" clearable /></el-form-item>
        <el-form-item :label="lt('状态', 'Status')">
          <el-select v-model="query.status" clearable style="width: 120px">
            <el-option :label="lt('启用', 'Enabled')" value="1" />
            <el-option :label="lt('禁用', 'Disabled')" value="0" />
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
        <span>{{ lt('数据列表', 'Data List') }}</span>
        <el-button type="primary" @click="openCreate">{{ lt('添加', 'Add') }}</el-button>
      </div>
      <el-table v-loading="loading" :data="rows" border>
        <el-table-column type="index" :index="getRowIndex" :label="lt('编号', 'No.')" width="90" />
        <el-table-column prop="username" :label="lt('用户名', 'Username')" min-width="120" />
        <el-table-column prop="nickname" :label="lt('昵称', 'Nickname')" min-width="120" />
        <el-table-column prop="phone" :label="lt('手机号', 'Phone')" min-width="130" />
        <el-table-column prop="email" :label="lt('邮箱', 'Email')" min-width="180" />
        <el-table-column :label="lt('超管', 'Super Admin')" width="90">
          <template #default="{ row }">
            <el-tag :type="row.superAdmin === 1 ? 'danger' : 'info'" effect="plain">
              {{ row.superAdmin === 1 ? lt('是', 'Yes') : lt('否', 'No') }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="lt('状态', 'Status')" width="120">
          <template #default="{ row }">
            <el-switch
              v-model="row.status"
              inline-prompt
              :active-value="1"
              :inactive-value="0"
              :active-text="lt('启', 'On')"
              in:active-text="lt('禁', 'Off')"
              :disabled="isRootAdmin(row)"
              @change="(value: string | number | boolean) => handleStatusChange(row, value)"
            />
          </template>
        </el-table-column>
        <el-table-column :label="lt('操作', 'Actions')" width="260" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" :disabled="isRootAdmin(row)" @click="openEdit(row)">{{ lt('编辑', 'Edit') }}</el-button>
            <el-button link type="primary" :disabled="isRootAdmin(row)" @click="openRoleDialog(row)">{{ lt('分配角色', 'Assign Roles') }}</el-button>
            <el-button link type="danger" :disabled="isRootAdmin(row)" @click="handleDelete(row)">{{ lt('删除', 'Delete') }}</el-button>
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
        <el-form-item :label="lt('用户名', 'Username')"><el-input v-model="form.username" :disabled="!!form.id" /></el-form-item>
        <el-form-item v-if="!form.id" :label="lt('密码', 'Password')"><el-input v-model="form.password" type="password" show-password /></el-form-item>
        <el-form-item :label="lt('昵称', 'Nickname')"><el-input v-model="form.nickname" /></el-form-item>
        <el-form-item :label="lt('邮箱', 'Email')"><el-input v-model="form.email" /></el-form-item>
        <el-form-item :label="lt('手机号', 'Phone')"><el-input v-model="form.phone" /></el-form-item>
        <el-form-item :label="lt('是否超管', 'Super Admin')"><el-switch v-model="form.superAdmin" :active-value="1" :inactive-value="0" /></el-form-item>
        <el-form-item :label="lt('状态', 'Status')"><el-switch v-model="form.status" :active-value="1" :inactive-value="0" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">{{ lt('取消', 'Cancel') }}</el-button>
        <el-button type="primary" @click="submitForm">{{ lt('确定', 'Confirm') }}</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="roleDialogVisible" :title="lt('分配角色', 'Assign Roles')" width="520px">
      <el-form label-width="96px">
        <el-form-item :label="lt('角色', 'Roles')">
          <el-select
            v-model="roleForm.roleIds"
            v-loading="roleLoading"
            multiple
            filterable
            clearable
            :placeholder="lt('请选择角色', 'Select roles')"
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
        <el-button @click="roleDialogVisible = false">{{ lt('取消', 'Cancel') }}</el-button>
        <el-button type="primary" :disabled="!roleForm.adminId" @click="submitRoles">{{ lt('确定', 'Confirm') }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

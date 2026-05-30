<script setup lang="ts">
import { localeText as lt } from '@/utils/i18n'
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { createPermission, deletePermission, getPermissionPage, updatePermission, type Permission } from '@/apis/auth'

const loading = ref(false)
const rows = ref<Permission[]>([])
const total = ref(0)
const dialogVisible = ref(false)
const dialogTitle = ref(lt('新增 API 权限', 'New API Permission'))
const query = reactive({ current: 1, size: 10, permissionCode: '', permissionName: '', resourceType: 'API', status: '' })
const form = reactive<Permission>({ permissionCode: '', permissionName: '', resourceType: 'API', resourcePath: '', remark: '', status: 1 })

async function loadList() {
  loading.value = true
  try {
    const page = await getPermissionPage(query)
    rows.value = page.records
    total.value = page.total
  } finally {
    loading.value = false
  }
}

function getRowIndex(index: number) {
  return (query.current - 1) * query.size + index + 1
}

function resetQuery() {
  Object.assign(query, { permissionCode: '', permissionName: '', resourceType: 'API', status: '', current: 1 })
  loadList()
}

function openCreate() {
  Object.assign(form, { id: undefined, permissionCode: '', permissionName: '', resourceType: 'API', resourcePath: '', remark: '', status: 1 })
  dialogTitle.value = lt('新增 API 权限', 'New API Permission')
  dialogVisible.value = true
}

function openEdit(row: Permission) {
  Object.assign(form, row, { resourceType: 'API' })
  dialogTitle.value = lt('编辑 API 权限', 'Edit API Permission')
  dialogVisible.value = true
}

async function submitForm() {
  const payload = { ...form, resourceType: 'API' }
  if (form.id) await updatePermission(form.id, payload)
  else await createPermission(payload)
  ElMessage.success(lt('保存成功', 'Saved'))
  dialogVisible.value = false
  loadList()
}

async function handleStatusChange(row: Permission, value: string | number | boolean) {
  const nextStatus = Number(value)
  const previousStatus = nextStatus === 1 ? 0 : 1
  try {
    await updatePermission(row.id!, { permissionName: row.permissionName, resourceType: 'API', resourcePath: row.resourcePath, remark: row.remark, status: nextStatus })
    ElMessage.success(nextStatus === 1 ? lt('已启用', 'Enabled') : lt('已禁用', 'Disabled'))
  } catch (error) {
    row.status = previousStatus
    throw error
  }
}

async function handleDelete(row: Permission) {
  await ElMessageBox.confirm(`确认删除 API 权限 ${row.permissionName}?`, lt('提示', 'Prompt'), { type: 'warning' })
  await deletePermission(row.id!)
  ElMessage.success(lt('删除成功', 'Deleted'))
  loadList()
}

onMounted(loadList)
</script>

<template>
  <div>
    <el-card class="app-card" shadow="never">
      <el-form :inline="true" :model="query" class="filter-form">
        <el-form-item :label="lt('权限编码', 'Permission Code')"><el-input v-model="query.permissionCode" clearable /></el-form-item>
        <el-form-item :label="lt('权限名称', 'Permission Name')"><el-input v-model="query.permissionName" clearable /></el-form-item>
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
        <span>{{ lt('API 权限列表', 'API Permission List') }}</span>
        <el-button type="primary" @click="openCreate">{{ lt('添加', 'Add') }}</el-button>
      </div>
      <el-table v-loading="loading" :data="rows" border>
        <el-table-column type="index" :index="getRowIndex" :label="lt('编号', 'No.')" width="90" />
        <el-table-column prop="permissionCode" :label="lt('权限编码', 'Permission Code')" min-width="180" />
        <el-table-column prop="permissionName" :label="lt('权限名称', 'Permission Name')" min-width="150" />
        <el-table-column prop="resourcePath" :label="lt('资源路径', 'Resource Path')" min-width="240" />
        <el-table-column prop="remark" :label="lt('备注', 'Remark')" min-width="180" />
        <el-table-column :label="lt('状态', 'Status')" width="120">
          <template #default="{ row }">
            <el-switch
              v-model="row.status"
              inline-prompt
              :active-value="1"
              :inactive-value="0"
              :active-text="lt('启', 'On')"
              in:active-text="lt('禁', 'Off')"
              @change="(value: string | number | boolean) => handleStatusChange(row, value)"
            />
          </template>
        </el-table-column>
        <el-table-column :label="lt('操作', 'Actions')" width="150" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openEdit(row)">{{ lt('编辑', 'Edit') }}</el-button>
            <el-button link type="danger" @click="handleDelete(row)">{{ lt('删除', 'Delete') }}</el-button>
          </template>
        </el-table-column>
      </el-table>
      <div class="pagination-wrap">
        <el-pagination v-model:current-page="query.current" v-model:page-size="query.size" layout="total, sizes, prev, pager, next" :total="total" @current-change="loadList" @size-change="loadList" />
      </div>
    </el-card>

    <el-dialog v-model="dialogVisible" :title="dialogTitle" width="560px">
      <el-form :model="form" label-width="96px">
        <el-form-item :label="lt('权限编码', 'Permission Code')"><el-input v-model="form.permissionCode" :disabled="!!form.id" /></el-form-item>
        <el-form-item :label="lt('权限名称', 'Permission Name')"><el-input v-model="form.permissionName" /></el-form-item>
        <el-form-item :label="lt('资源路径', 'Resource Path')"><el-input v-model="form.resourcePath" /></el-form-item>
        <el-form-item :label="lt('状态', 'Status')"><el-switch v-model="form.status" :active-value="1" :inactive-value="0" /></el-form-item>
        <el-form-item :label="lt('备注', 'Remark')"><el-input v-model="form.remark" type="textarea" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">{{ lt('取消', 'Cancel') }}</el-button>
        <el-button type="primary" @click="submitForm">{{ lt('确定', 'Confirm') }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

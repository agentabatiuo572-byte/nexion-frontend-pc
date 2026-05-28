<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { createPermission, deletePermission, getPermissionPage, updatePermission, type Permission } from '@/apis/auth'

const loading = ref(false)
const rows = ref<Permission[]>([])
const total = ref(0)
const dialogVisible = ref(false)
const dialogTitle = ref('新增 API 权限')
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
  dialogTitle.value = '新增 API 权限'
  dialogVisible.value = true
}

function openEdit(row: Permission) {
  Object.assign(form, row, { resourceType: 'API' })
  dialogTitle.value = '编辑 API 权限'
  dialogVisible.value = true
}

async function submitForm() {
  const payload = { ...form, resourceType: 'API' }
  if (form.id) await updatePermission(form.id, payload)
  else await createPermission(payload)
  ElMessage.success('保存成功')
  dialogVisible.value = false
  loadList()
}

async function handleStatusChange(row: Permission, value: string | number | boolean) {
  const nextStatus = Number(value)
  const previousStatus = nextStatus === 1 ? 0 : 1
  try {
    await updatePermission(row.id!, { permissionName: row.permissionName, resourceType: 'API', resourcePath: row.resourcePath, remark: row.remark, status: nextStatus })
    ElMessage.success(nextStatus === 1 ? '已启用' : '已禁用')
  } catch (error) {
    row.status = previousStatus
    throw error
  }
}

async function handleDelete(row: Permission) {
  await ElMessageBox.confirm(`确认删除 API 权限 ${row.permissionName}?`, '提示', { type: 'warning' })
  await deletePermission(row.id!)
  ElMessage.success('删除成功')
  loadList()
}

onMounted(loadList)
</script>

<template>
  <div>
    <el-card class="app-card" shadow="never">
      <el-form :inline="true" :model="query" class="filter-form">
        <el-form-item label="权限编码"><el-input v-model="query.permissionCode" clearable /></el-form-item>
        <el-form-item label="权限名称"><el-input v-model="query.permissionName" clearable /></el-form-item>
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
        <span>API 权限列表</span>
        <el-button type="primary" @click="openCreate">添加</el-button>
      </div>
      <el-table v-loading="loading" :data="rows" border>
        <el-table-column type="index" :index="getRowIndex" label="编号" width="90" />
        <el-table-column prop="permissionCode" label="权限编码" min-width="180" />
        <el-table-column prop="permissionName" label="权限名称" min-width="150" />
        <el-table-column prop="resourcePath" label="资源路径" min-width="240" />
        <el-table-column prop="remark" label="备注" min-width="180" />
        <el-table-column label="状态" width="120">
          <template #default="{ row }">
            <el-switch
              v-model="row.status"
              inline-prompt
              :active-value="1"
              :inactive-value="0"
              active-text="启"
              inactive-text="禁"
              @change="(value: string | number | boolean) => handleStatusChange(row, value)"
            />
          </template>
        </el-table-column>
        <el-table-column label="操作" width="150" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
            <el-button link type="danger" @click="handleDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
      <div class="pagination-wrap">
        <el-pagination v-model:current-page="query.current" v-model:page-size="query.size" layout="total, sizes, prev, pager, next" :total="total" @current-change="loadList" @size-change="loadList" />
      </div>
    </el-card>

    <el-dialog v-model="dialogVisible" :title="dialogTitle" width="560px">
      <el-form :model="form" label-width="96px">
        <el-form-item label="权限编码"><el-input v-model="form.permissionCode" :disabled="!!form.id" /></el-form-item>
        <el-form-item label="权限名称"><el-input v-model="form.permissionName" /></el-form-item>
        <el-form-item label="资源路径"><el-input v-model="form.resourcePath" /></el-form-item>
        <el-form-item label="状态"><el-switch v-model="form.status" :active-value="1" :inactive-value="0" /></el-form-item>
        <el-form-item label="备注"><el-input v-model="form.remark" type="textarea" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submitForm">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

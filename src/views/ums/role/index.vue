<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { TreeInstance } from 'element-plus'
import {
  assignRoleApiPermissions,
  assignRoleMenus,
  createRole,
  deleteRole,
  getMenuList,
  getRoleMenuIds,
  getPermissionPage,
  getRolePage,
  getRolePermissionIds,
  updateRole,
  type Menu,
  type Permission,
  type Role
} from '@/apis/auth'
import type { Id } from '@/types/common'

interface MenuTreeRow extends Menu {
  children?: MenuTreeRow[]
}

interface ApiPermissionGroup {
  label: string
  options: Permission[]
}

const superAdminRoleCode = 'SUPER_ADMIN'
const apiGroupNames: Record<string, string> = {
  auth: '权限模块',
  devices: '设备模块',
  device: '设备模块',
  wallet: '钱包模块',
  receipts: '算力凭证',
  notifications: '通知模块',
  notice: '通知模块',
  team: '团队模块',
  store: '商城模块'
}
const loading = ref(false)
const permissionLoading = ref(false)
const rows = ref<Role[]>([])
const total = ref(0)
const permissionOptions = ref<Permission[]>([])
const menuOptions = ref<Menu[]>([])
const menuTreeRef = ref<TreeInstance>()
const dialogVisible = ref(false)
const menuAssignVisible = ref(false)
const apiAssignVisible = ref(false)
const apiAssignRenderKey = ref(0)
const dialogTitle = ref('新增角色')
const query = reactive({ current: 1, size: 10, roleCode: '', roleName: '', status: '' })
const form = reactive<Role>({ roleCode: '', roleName: '', remark: '', status: 1 })
const assignForm = reactive<{ roleId: Id | ''; menuIds: Id[]; apiIds: Id[] }>({ roleId: '', menuIds: [], apiIds: [] })

const apiPermissions = computed(() => permissionOptions.value)
const menuTree = computed(() => buildMenuTree(menuOptions.value))
const apiPermissionGroups = computed<ApiPermissionGroup[]>(() => {
  const groupMap = new Map<string, Permission[]>()
  for (const item of apiPermissions.value) {
    const groupKey = getApiGroupKey(item)
    if (!groupMap.has(groupKey)) groupMap.set(groupKey, [])
    groupMap.get(groupKey)!.push(item)
  }
  return Array.from(groupMap.entries()).map(([key, options]) => ({
    label: apiGroupNames[key] || key || '其他模块',
    options: options.sort(sortByPermissionName)
  }))
})
async function loadList() {
  loading.value = true
  try {
    const page = await getRolePage(query)
    rows.value = page.records
    total.value = page.total
  } finally {
    loading.value = false
  }
}

function getRowIndex(index: number) {
  return (query.current - 1) * query.size + index + 1
}

async function loadPermissions() {
  permissionLoading.value = true
  try {
    const page = await getPermissionPage({ current: 1, size: 300, resourceType: 'API', status: 1 })
    permissionOptions.value = page.records
  } finally {
    permissionLoading.value = false
  }
}

async function loadMenus() {
  permissionLoading.value = true
  try {
    menuOptions.value = await getMenuList({ status: 1 })
  } finally {
    permissionLoading.value = false
  }
}

function buildMenuTree(items: Menu[]) {
  const itemMap = new Map<string, MenuTreeRow>()
  const roots: MenuTreeRow[] = []

  for (const item of items) {
    itemMap.set(String(item.id), { ...item, children: [] })
  }

  for (const row of itemMap.values()) {
    const parent = row.parentId ? itemMap.get(String(row.parentId)) : undefined
    if (parent) parent.children!.push(row)
    else roots.push(row)
  }

  const sortRows = (list: MenuTreeRow[]) => {
    list.sort(sortByMenuOrder)
    for (const item of list) {
      if (item.children?.length) sortRows(item.children)
      else delete item.children
    }
  }
  sortRows(roots)
  return roots
}

function sortByMenuOrder(a: MenuTreeRow, b: MenuTreeRow) {
  return (a.sortOrder || 0) - (b.sortOrder || 0)
}

function sortByPermissionName(a: Permission, b: Permission) {
  return (a.permissionName || a.permissionCode || '').localeCompare(b.permissionName || b.permissionCode || '')
}

function getApiGroupKey(item: Permission) {
  const path = item.resourcePath || item.permissionCode || ''
  const firstSegment = path.split('/').filter(Boolean)[0] || path.split(':')[0]
  return firstSegment.toLowerCase()
}

function getCurrentMenuIds() {
  const checkedMenuKeys = (menuTreeRef.value?.getCheckedKeys(false) || []).map(Number)
  const halfCheckedMenuKeys = (menuTreeRef.value?.getHalfCheckedKeys() || []).map(Number)
  return [...checkedMenuKeys, ...halfCheckedMenuKeys]
    .filter((id) => Number.isFinite(id) && id > 0)
}

async function syncMenuTreeCheckedKeys() {
  await nextTick()
  menuTreeRef.value?.setCheckedKeys(assignForm.menuIds, false)
}

function isSuperAdminRole(row: Role) {
  return row.roleCode === superAdminRoleCode
}

function resetQuery() {
  Object.assign(query, { roleCode: '', roleName: '', status: '', current: 1 })
  loadList()
}

function openCreate() {
  Object.assign(form, { id: undefined, roleCode: '', roleName: '', remark: '', status: 1 })
  dialogTitle.value = '新增角色'
  dialogVisible.value = true
}

function openEdit(row: Role) {
  if (isSuperAdminRole(row)) return
  Object.assign(form, row)
  dialogTitle.value = '编辑角色'
  dialogVisible.value = true
}

async function submitForm() {
  if (form.id) await updateRole(form.id, form)
  else await createRole(form)
  ElMessage.success('保存成功')
  dialogVisible.value = false
  loadList()
}

async function handleStatusChange(row: Role, value: string | number | boolean) {
  const nextStatus = Number(value)
  const previousStatus = nextStatus === 1 ? 0 : 1
  try {
    await updateRole(row.id!, { roleName: row.roleName, remark: row.remark, status: nextStatus })
    ElMessage.success(nextStatus === 1 ? '已启用' : '已禁用')
  } catch (error) {
    row.status = previousStatus
    throw error
  }
}

async function handleDelete(row: Role) {
  if (isSuperAdminRole(row)) return
  await ElMessageBox.confirm(`确认删除角色 ${row.roleName}?`, '提示', { type: 'warning' })
  await deleteRole(row.id!)
  ElMessage.success('删除成功')
  loadList()
}

async function loadRolePermissions(row: Role) {
  assignForm.roleId = row.id || ''
  assignForm.apiIds = []
  const [permissionResult, selectedResult] = await Promise.allSettled([
    permissionOptions.value.length ? Promise.resolve() : loadPermissions(),
    getRolePermissionIds(row.id!)
  ])
  if (permissionResult.status === 'rejected') throw permissionResult.reason
  if (selectedResult.status === 'fulfilled') {
    assignForm.apiIds = selectedResult.value
  }
}

async function openMenuAssign(row: Role) {
  if (isSuperAdminRole(row)) return
  menuAssignVisible.value = true
  assignForm.roleId = row.id || ''
  assignForm.menuIds = []
  const [menuResult, selectedResult] = await Promise.allSettled([
    menuOptions.value.length ? Promise.resolve() : loadMenus(),
    getRoleMenuIds(row.id!)
  ])
  if (menuResult.status === 'rejected') throw menuResult.reason
  if (selectedResult.status === 'fulfilled') assignForm.menuIds = selectedResult.value
  await syncMenuTreeCheckedKeys()
}

async function openApiAssign(row: Role) {
  if (isSuperAdminRole(row)) return
  apiAssignVisible.value = true
  await loadRolePermissions(row)
  apiAssignRenderKey.value += 1
}

async function submitMenuAssign() {
  await assignRoleMenus(assignForm.roleId, [...new Set(getCurrentMenuIds())])
  ElMessage.success('菜单分配成功')
  menuAssignVisible.value = false
}

async function submitApiAssign() {
  await assignRoleApiPermissions(assignForm.roleId, [...new Set(assignForm.apiIds)])
  ElMessage.success('权限分配成功')
  apiAssignVisible.value = false
}

onMounted(loadList)
</script>

<template>
  <div>
    <el-card class="app-card" shadow="never">
      <el-form :inline="true" :model="query" class="filter-form">
        <el-form-item label="角色编码"><el-input v-model="query.roleCode" clearable /></el-form-item>
        <el-form-item label="角色名称"><el-input v-model="query.roleName" clearable /></el-form-item>
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
        <el-table-column prop="roleCode" label="角色编码" min-width="160" />
        <el-table-column prop="roleName" label="角色名称" min-width="140" />
        <el-table-column prop="remark" label="备注" min-width="220" />
        <el-table-column label="状态" width="120">
          <template #default="{ row }">
            <el-switch v-model="row.status" inline-prompt :active-value="1" :inactive-value="0" active-text="启" inactive-text="禁" :disabled="isSuperAdminRole(row)" @change="(value: string | number | boolean) => handleStatusChange(row, value)" />
          </template>
        </el-table-column>
        <el-table-column label="操作" width="300" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" :disabled="isSuperAdminRole(row)" @click="openEdit(row)">编辑</el-button>
            <el-button link type="primary" :disabled="isSuperAdminRole(row)" @click="openMenuAssign(row)">分配菜单</el-button>
            <el-button link type="primary" :disabled="isSuperAdminRole(row)" @click="openApiAssign(row)">分配 API 权限</el-button>
            <el-button link type="danger" :disabled="isSuperAdminRole(row)" @click="handleDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
      <div class="pagination-wrap">
        <el-pagination v-model:current-page="query.current" v-model:page-size="query.size" layout="total, sizes, prev, pager, next" :total="total" @current-change="loadList" @size-change="loadList" />
      </div>
    </el-card>

    <el-dialog v-model="dialogVisible" :title="dialogTitle" width="520px">
      <el-form :model="form" label-width="96px">
        <el-form-item label="角色编码"><el-input v-model="form.roleCode" :disabled="!!form.id" /></el-form-item>
        <el-form-item label="角色名称"><el-input v-model="form.roleName" /></el-form-item>
        <el-form-item label="备注"><el-input v-model="form.remark" type="textarea" /></el-form-item>
        <el-form-item label="状态"><el-switch v-model="form.status" :active-value="1" :inactive-value="0" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submitForm">确定</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="menuAssignVisible" title="分配菜单" width="560px">
      <el-tree
        ref="menuTreeRef"
        v-loading="permissionLoading"
        :default-checked-keys="assignForm.menuIds"
        :data="menuTree"
        node-key="id"
        show-checkbox
        default-expand-all
        :props="{ label: 'menuName', children: 'children' }"
      />
      <template #footer>
        <el-button @click="menuAssignVisible = false">取消</el-button>
        <el-button type="primary" :disabled="!assignForm.roleId" @click="submitMenuAssign">确定</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="apiAssignVisible" title="分配 API 权限" width="760px">
      <el-checkbox-group :key="apiAssignRenderKey" v-model="assignForm.apiIds" v-loading="permissionLoading" class="api-permission-groups">
        <section v-for="group in apiPermissionGroups" :key="group.label" class="api-permission-group">
          <div class="api-permission-group__title">{{ group.label }}</div>
          <div class="api-permission-group__items">
            <el-checkbox v-for="item in group.options" :key="item.id" :value="item.id!">
              {{ item.permissionName || '-' }}（{{ item.permissionCode || item.id }}）
            </el-checkbox>
          </div>
        </section>
      </el-checkbox-group>
      <template #footer>
        <el-button @click="apiAssignVisible = false">取消</el-button>
        <el-button type="primary" :disabled="!assignForm.roleId" @click="submitApiAssign">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.api-permission-groups {
  display: grid;
  gap: 12px;
  max-height: 520px;
  overflow-y: auto;
  padding-right: 4px;
}

.api-permission-group {
  border: 1px solid var(--el-border-color-light);
  border-radius: 6px;
  padding: 12px 14px;
}

.api-permission-group__title {
  color: var(--el-text-color-primary);
  font-weight: 600;
  margin-bottom: 8px;
}

.api-permission-group__items {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px 16px;
}

.api-permission-group__items :deep(.el-checkbox) {
  height: auto;
  margin-right: 0;
  white-space: normal;
}

@media (max-width: 720px) {
  .api-permission-group__items {
    grid-template-columns: 1fr;
  }
}
</style>

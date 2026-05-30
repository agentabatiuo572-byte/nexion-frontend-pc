<script setup lang="ts">
import { localeText as lt } from '@/utils/i18n'
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
  auth: lt('权限模块', 'Auth Module'),
  devices: lt('设备模块', 'Device Module'),
  device: lt('设备模块', 'Device Module'),
  wallet: lt('钱包模块', 'Wallet Module'),
  receipts: lt('算力凭证', 'Compute Receipts'),
  notifications: lt('通知模块', 'Notification Module'),
  notice: lt('通知模块', 'Notification Module'),
  team: lt('团队模块', 'Team Module'),
  store: lt('商城模块', 'Commerce Module')
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
const dialogTitle = ref(lt('新增角色', 'New Role'))
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
    label: apiGroupNames[key] || key || lt('其他模块', 'Other Modules'),
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
  dialogTitle.value = lt('新增角色', 'New Role')
  dialogVisible.value = true
}

function openEdit(row: Role) {
  if (isSuperAdminRole(row)) return
  Object.assign(form, row)
  dialogTitle.value = lt('编辑角色', 'Edit Role')
  dialogVisible.value = true
}

async function submitForm() {
  if (form.id) await updateRole(form.id, form)
  else await createRole(form)
  ElMessage.success(lt('保存成功', 'Saved'))
  dialogVisible.value = false
  loadList()
}

async function handleStatusChange(row: Role, value: string | number | boolean) {
  const nextStatus = Number(value)
  const previousStatus = nextStatus === 1 ? 0 : 1
  try {
    await updateRole(row.id!, { roleName: row.roleName, remark: row.remark, status: nextStatus })
    ElMessage.success(nextStatus === 1 ? lt('已启用', 'Enabled') : lt('已禁用', 'Disabled'))
  } catch (error) {
    row.status = previousStatus
    throw error
  }
}

async function handleDelete(row: Role) {
  if (isSuperAdminRole(row)) return
  await ElMessageBox.confirm(`确认删除角色 ${row.roleName}?`, lt('提示', 'Prompt'), { type: 'warning' })
  await deleteRole(row.id!)
  ElMessage.success(lt('删除成功', 'Deleted'))
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
  ElMessage.success(lt('菜单分配成功', 'Menu assignment saved'))
  menuAssignVisible.value = false
}

async function submitApiAssign() {
  await assignRoleApiPermissions(assignForm.roleId, [...new Set(assignForm.apiIds)])
  ElMessage.success(lt('权限分配成功', 'Permission assignment saved'))
  apiAssignVisible.value = false
}

onMounted(loadList)
</script>

<template>
  <div>
    <el-card class="app-card" shadow="never">
      <el-form :inline="true" :model="query" class="filter-form">
        <el-form-item :label="lt('角色编码', 'Role Code')"><el-input v-model="query.roleCode" clearable /></el-form-item>
        <el-form-item :label="lt('角色名称', 'Role Name')"><el-input v-model="query.roleName" clearable /></el-form-item>
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
        <el-table-column prop="roleCode" :label="lt('角色编码', 'Role Code')" min-width="160" />
        <el-table-column prop="roleName" :label="lt('角色名称', 'Role Name')" min-width="140" />
        <el-table-column prop="remark" :label="lt('备注', 'Remark')" min-width="220" />
        <el-table-column :label="lt('状态', 'Status')" width="120">
          <template #default="{ row }">
            <el-switch v-model="row.status" inline-prompt :active-value="1" :inactive-value="0" :active-text="lt('启', 'On')" in:active-text="lt('禁', 'Off')" :disabled="isSuperAdminRole(row)" @change="(value: string | number | boolean) => handleStatusChange(row, value)" />
          </template>
        </el-table-column>
        <el-table-column :label="lt('操作', 'Actions')" width="300" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" :disabled="isSuperAdminRole(row)" @click="openEdit(row)">{{ lt('编辑', 'Edit') }}</el-button>
            <el-button link type="primary" :disabled="isSuperAdminRole(row)" @click="openMenuAssign(row)">{{ lt('分配菜单', 'Assign Menus') }}</el-button>
            <el-button link type="primary" :disabled="isSuperAdminRole(row)" @click="openApiAssign(row)">{{ lt('分配 API 权限', 'Assign API Permissions') }}</el-button>
            <el-button link type="danger" :disabled="isSuperAdminRole(row)" @click="handleDelete(row)">{{ lt('删除', 'Delete') }}</el-button>
          </template>
        </el-table-column>
      </el-table>
      <div class="pagination-wrap">
        <el-pagination v-model:current-page="query.current" v-model:page-size="query.size" layout="total, sizes, prev, pager, next" :total="total" @current-change="loadList" @size-change="loadList" />
      </div>
    </el-card>

    <el-dialog v-model="dialogVisible" :title="dialogTitle" width="520px">
      <el-form :model="form" label-width="96px">
        <el-form-item :label="lt('角色编码', 'Role Code')"><el-input v-model="form.roleCode" :disabled="!!form.id" /></el-form-item>
        <el-form-item :label="lt('角色名称', 'Role Name')"><el-input v-model="form.roleName" /></el-form-item>
        <el-form-item :label="lt('备注', 'Remark')"><el-input v-model="form.remark" type="textarea" /></el-form-item>
        <el-form-item :label="lt('状态', 'Status')"><el-switch v-model="form.status" :active-value="1" :inactive-value="0" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">{{ lt('取消', 'Cancel') }}</el-button>
        <el-button type="primary" @click="submitForm">{{ lt('确定', 'Confirm') }}</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="menuAssignVisible" :title="lt('分配菜单', 'Assign Menus')" width="560px">
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
        <el-button @click="menuAssignVisible = false">{{ lt('取消', 'Cancel') }}</el-button>
        <el-button type="primary" :disabled="!assignForm.roleId" @click="submitMenuAssign">{{ lt('确定', 'Confirm') }}</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="apiAssignVisible" :title="lt('分配 API 权限', 'Assign API Permissions')" width="760px">
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
        <el-button @click="apiAssignVisible = false">{{ lt('取消', 'Cancel') }}</el-button>
        <el-button type="primary" :disabled="!assignForm.roleId" @click="submitApiAssign">{{ lt('确定', 'Confirm') }}</el-button>
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

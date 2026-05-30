<script setup lang="ts">
import { localeText as lt } from '@/utils/i18n'
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { createMenu, deleteMenu, getMenuList, updateMenu, type Menu } from '@/apis/auth'

interface MenuTreeRow extends Menu {
  children?: MenuTreeRow[]
}

const loading = ref(false)
const rows = ref<Menu[]>([])
const dialogVisible = ref(false)
const dialogTitle = ref(lt('新增菜单', 'New Menu'))
const query = reactive({ menuCode: '', menuName: '', status: '' })
const form = reactive<Menu>({
  menuCode: '',
  menuName: '',
  menuNameZh: '',
  menuNameEn: '',
  parentId: null,
  routePath: '',
  icon: '',
  sortOrder: 0,
  remark: '',
  status: 1
})

const treeRows = computed(() => buildMenuTree(rows.value))
const parentOptions = computed(() => rows.value.filter((item) => item.id !== form.id))

async function loadList() {
  loading.value = true
  try {
    rows.value = await getMenuList(query)
  } finally {
    loading.value = false
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

function resetQuery() {
  Object.assign(query, { menuCode: '', menuName: '', status: '' })
  loadList()
}

function resetForm() {
  Object.assign(form, { id: undefined, menuCode: '', menuName: '', menuNameZh: '', menuNameEn: '', parentId: null, routePath: '', icon: '', sortOrder: 0, remark: '', status: 1 })
}

function openCreate() {
  resetForm()
  dialogTitle.value = lt('新增菜单', 'New Menu')
  dialogVisible.value = true
}

function openEdit(row: MenuTreeRow) {
  Object.assign(form, row, { parentId: row.parentId || null })
  dialogTitle.value = lt('编辑菜单', 'Edit Menu')
  dialogVisible.value = true
}

async function submitForm() {
  if (!form.menuName) {
    form.menuName = form.menuNameZh || form.menuNameEn || ''
  }
  if (form.id) await updateMenu(form.id, form)
  else await createMenu(form)
  ElMessage.success(lt('保存成功', 'Saved'))
  dialogVisible.value = false
  loadList()
}

async function handleStatusChange(row: MenuTreeRow, value: string | number | boolean) {
  const nextStatus = Number(value)
  const previousStatus = nextStatus === 1 ? 0 : 1
  try {
    await updateMenu(row.id!, {
      menuName: row.menuName,
      menuNameZh: row.menuNameZh,
      menuNameEn: row.menuNameEn,
      parentId: row.parentId,
      routePath: row.routePath,
      icon: row.icon,
      sortOrder: row.sortOrder,
      remark: row.remark,
      status: nextStatus
    })
    ElMessage.success(nextStatus === 1 ? lt('已启用', 'Enabled') : lt('已禁用', 'Disabled'))
  } catch (error) {
    row.status = previousStatus
    throw error
  }
}

async function handleDelete(row: MenuTreeRow) {
  await ElMessageBox.confirm(`确认删除菜单 ${row.menuNameZh || row.menuName}?`, lt('提示', 'Prompt'), { type: 'warning' })
  await deleteMenu(row.id!)
  ElMessage.success(lt('删除成功', 'Deleted'))
  loadList()
}

onMounted(loadList)
</script>

<template>
  <div>
    <el-card class="app-card" shadow="never">
      <el-form :inline="true" :model="query" class="filter-form">
        <el-form-item :label="lt('菜单编码', 'Menu Code')"><el-input v-model="query.menuCode" clearable /></el-form-item>
        <el-form-item :label="lt('菜单名称', 'Menu Name')"><el-input v-model="query.menuName" clearable /></el-form-item>
        <el-form-item :label="lt('状态', 'Status')">
          <el-select v-model="query.status" clearable style="width: 120px">
            <el-option :label="lt('启用', 'Enabled')" value="1" />
            <el-option :label="lt('禁用', 'Disabled')" value="0" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="loadList">{{ lt('查询', 'Search') }}</el-button>
          <el-button @click="resetQuery">{{ lt('重置', 'Reset') }}</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card shadow="never">
      <div class="table-toolbar">
        <span>{{ lt('菜单树', 'Menu Tree') }}</span>
        <el-button type="primary" @click="openCreate">{{ lt('添加', 'Add') }}</el-button>
      </div>
      <el-table v-loading="loading" :data="treeRows" row-key="id" border default-expand-all>
        <el-table-column prop="menuNameZh" :label="lt('中文名称', 'Chinese Name')" min-width="160">
          <template #default="{ row }">{{ row.menuNameZh || row.menuName }}</template>
        </el-table-column>
        <el-table-column prop="menuNameEn" :label="lt('英文名称', 'English Name')" min-width="180">
          <template #default="{ row }">{{ row.menuNameEn || row.menuName }}</template>
        </el-table-column>
        <el-table-column prop="menuCode" :label="lt('菜单编码', 'Menu Code')" min-width="190" />
        <el-table-column prop="routePath" :label="lt('路由路径', 'Route Path')" min-width="220" />
        <el-table-column prop="sortOrder" :label="lt('排序', 'Sort Order')" width="90" />
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
    </el-card>

    <el-dialog v-model="dialogVisible" :title="dialogTitle" width="560px">
      <el-form :model="form" label-width="96px">
        <el-form-item :label="lt('菜单编码', 'Menu Code')"><el-input v-model="form.menuCode" :disabled="!!form.id" placeholder="例如 MENU_UMS_ADMIN" /></el-form-item>
        <el-form-item :label="lt('兼容名称', 'Compatible Name')"><el-input v-model="form.menuName" :placeholder="lt('用于旧接口兼容', 'For legacy API compatibility')" /></el-form-item>
        <el-form-item :label="lt('中文名称', 'Chinese Name')"><el-input v-model="form.menuNameZh" placeholder="例如 管理员列表" /></el-form-item>
        <el-form-item :label="lt('英文名称', 'English Name')"><el-input v-model="form.menuNameEn" placeholder="例如 Admins" /></el-form-item>
        <el-form-item :label="lt('上级菜单', 'Parent Menu')">
          <el-select v-model="form.parentId" clearable :placeholder="lt('无上级菜单', 'No Parent Menu')">
            <el-option v-for="item in parentOptions" :key="item.id" :label="item.menuNameZh || item.menuName || item.menuCode" :value="item.id!" />
          </el-select>
        </el-form-item>
        <el-form-item :label="lt('路由路径', 'Route Path')"><el-input v-model="form.routePath" placeholder="例如 /ums/admin" /></el-form-item>
        <el-form-item :label="lt('图标', 'Icon')"><el-input v-model="form.icon" placeholder="例如 User" /></el-form-item>
        <el-form-item :label="lt('排序', 'Sort Order')"><el-input-number v-model="form.sortOrder" :min="0" :step="1" /></el-form-item>
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

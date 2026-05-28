<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { createMenu, deleteMenu, getMenuList, updateMenu, type Menu } from '@/apis/auth'

interface MenuTreeRow extends Menu {
  children?: MenuTreeRow[]
}

const loading = ref(false)
const rows = ref<Menu[]>([])
const dialogVisible = ref(false)
const dialogTitle = ref('新增菜单')
const query = reactive({ menuCode: '', menuName: '', status: '' })
const form = reactive<Menu>({ menuCode: '', menuName: '', parentId: null, routePath: '', icon: '', sortOrder: 0, remark: '', status: 1 })

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
  Object.assign(form, { id: undefined, menuCode: '', menuName: '', parentId: null, routePath: '', icon: '', sortOrder: 0, remark: '', status: 1 })
}

function openCreate() {
  resetForm()
  dialogTitle.value = '新增菜单'
  dialogVisible.value = true
}

function openEdit(row: MenuTreeRow) {
  Object.assign(form, row, { parentId: row.parentId || null })
  dialogTitle.value = '编辑菜单'
  dialogVisible.value = true
}

async function submitForm() {
  if (form.id) await updateMenu(form.id, form)
  else await createMenu(form)
  ElMessage.success('保存成功')
  dialogVisible.value = false
  loadList()
}

async function handleStatusChange(row: MenuTreeRow, value: string | number | boolean) {
  const nextStatus = Number(value)
  const previousStatus = nextStatus === 1 ? 0 : 1
  try {
    await updateMenu(row.id!, { menuName: row.menuName, parentId: row.parentId, routePath: row.routePath, icon: row.icon, sortOrder: row.sortOrder, remark: row.remark, status: nextStatus })
    ElMessage.success(nextStatus === 1 ? '已启用' : '已禁用')
  } catch (error) {
    row.status = previousStatus
    throw error
  }
}

async function handleDelete(row: MenuTreeRow) {
  await ElMessageBox.confirm(`确认删除菜单 ${row.menuName}?`, '提示', { type: 'warning' })
  await deleteMenu(row.id!)
  ElMessage.success('删除成功')
  loadList()
}

onMounted(loadList)
</script>

<template>
  <div>
    <el-card class="app-card" shadow="never">
      <el-form :inline="true" :model="query" class="filter-form">
        <el-form-item label="菜单编码"><el-input v-model="query.menuCode" clearable /></el-form-item>
        <el-form-item label="菜单名称"><el-input v-model="query.menuName" clearable /></el-form-item>
        <el-form-item label="状态">
          <el-select v-model="query.status" clearable style="width: 120px">
            <el-option label="启用" value="1" />
            <el-option label="禁用" value="0" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="loadList">查询</el-button>
          <el-button @click="resetQuery">重置</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card shadow="never">
      <div class="table-toolbar">
        <span>菜单树</span>
        <el-button type="primary" @click="openCreate">添加</el-button>
      </div>
      <el-table v-loading="loading" :data="treeRows" row-key="id" border default-expand-all>
        <el-table-column prop="menuName" label="菜单名称" min-width="180" />
        <el-table-column prop="menuCode" label="菜单编码" min-width="190" />
        <el-table-column prop="routePath" label="路由路径" min-width="220" />
        <el-table-column prop="sortOrder" label="排序" width="90" />
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
    </el-card>

    <el-dialog v-model="dialogVisible" :title="dialogTitle" width="560px">
      <el-form :model="form" label-width="96px">
        <el-form-item label="菜单编码"><el-input v-model="form.menuCode" :disabled="!!form.id" placeholder="例如 MENU_UMS_ADMIN" /></el-form-item>
        <el-form-item label="菜单名称"><el-input v-model="form.menuName" placeholder="例如 管理员列表" /></el-form-item>
        <el-form-item label="上级菜单">
          <el-select v-model="form.parentId" clearable placeholder="无上级菜单">
            <el-option v-for="item in parentOptions" :key="item.id" :label="item.menuName || item.menuCode" :value="item.id!" />
          </el-select>
        </el-form-item>
        <el-form-item label="路由路径"><el-input v-model="form.routePath" placeholder="例如 /ums/admin" /></el-form-item>
        <el-form-item label="图标"><el-input v-model="form.icon" placeholder="例如 User" /></el-form-item>
        <el-form-item label="排序"><el-input-number v-model="form.sortOrder" :min="0" :step="1" /></el-form-item>
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

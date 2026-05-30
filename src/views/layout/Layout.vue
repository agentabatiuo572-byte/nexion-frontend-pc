<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useRoute, useRouter } from 'vue-router'
import { useAppStore } from '@/store/app'
import { useAuthStore } from '@/store/auth'
import { constantRoutes } from '@/router'
import { changeCurrentAdminPassword, updateCurrentAdminProfile } from '@/apis/auth'
import type { Menu } from '@/apis/auth'
import { t } from '@/utils/i18n'

const route = useRoute()
const router = useRouter()
const appStore = useAppStore()
const authStore = useAuthStore()

const profileVisible = ref(false)
const passwordVisible = ref(false)
const currentUser = computed(() => authStore.admin || { username: '', nickname: '管理员', phone: '', email: '' })
const profileForm = reactive({ username: '', nickname: '', phone: '', email: '' })
const passwordForm = reactive({ oldPassword: '', newPassword: '', confirmPassword: '' })
const locale = computed(() => appStore.locale)

interface MenuNode extends Menu {
  title: string
  fullPath: string
  children: MenuNode[]
}

function fullRoutePath(parentPath: string, childPath: string) {
  if (childPath.startsWith('/')) return childPath
  if (parentPath === '/') return `/${childPath}`
  return `${parentPath}/${childPath}`
}

const menuRoutes = computed(() => {
  const backendMenus = authStore.admin?.menus || []
  if (backendMenus.length > 0) {
    return buildBackendMenuTree(backendMenus)
  }
  return buildStaticMenuTree()
})
const menuTitleMap = computed(() => {
  const map = new Map<string, string>()
  const visit = (nodes: MenuNode[]) => {
    nodes.forEach((item) => {
      map.set(item.fullPath, item.title)
      if (item.children?.length) visit(item.children)
    })
  }
  const backendMenus = authStore.admin?.menus || []
  if (backendMenus.length > 0) visit(buildBackendMenuTree(backendMenus))
  return map
})
const defaultActive = computed(() => route.path)
const currentRouteTitle = computed(() => menuTitleMap.value.get(route.path) || String(route.meta.title || ''))
const userInitial = computed(() => (currentUser.value.nickname || currentUser.value.username || 'A').slice(0, 1).toUpperCase())

function localizedMenuName(menu: Menu) {
  if (locale.value.toLowerCase().startsWith('en')) {
    return menu.menuNameEn || menu.menuName || menu.menuNameZh || menu.menuCode || ''
  }
  return menu.menuNameZh || menu.menuName || menu.menuNameEn || menu.menuCode || ''
}

function buildBackendMenuTree(menus: Menu[]) {
  const activeMenus = menus
    .filter((item) => item.status !== 0 && item.routePath)
    .map<MenuNode>((item) => ({
      ...item,
      title: localizedMenuName(item),
      fullPath: item.routePath || '',
      children: []
    }))
    .sort((a, b) => (Number(a.sortOrder || 0) - Number(b.sortOrder || 0)) || (Number(a.id || 0) - Number(b.id || 0)))
  const map = new Map<string, MenuNode>()
  activeMenus.forEach((item) => {
    if (item.id != null) map.set(String(item.id), item)
  })
  const roots: MenuNode[] = []
  activeMenus.forEach((item) => {
    const parent = item.parentId != null ? map.get(String(item.parentId)) : undefined
    if (parent) {
      parent.children.push(item)
    } else {
      roots.push(item)
    }
  })
  return roots
}

function buildStaticMenuTree() {
  const menuPathSet = new Set(authStore.admin?.menuPaths || [])
  const isSuperAdmin = authStore.admin?.superAdmin === 1
  return constantRoutes
    .filter((item) => item.children && item.path !== '/:pathMatch(.*)*' && item.path !== '/login')
    .map<MenuNode | null>((item) => {
      const children = (item.children || [])
        .filter((child) => isSuperAdmin || menuPathSet.has(fullRoutePath(item.path, child.path)))
        .map<MenuNode>((child) => ({
          menuCode: String(child.name || child.path),
          menuName: String(child.meta?.title || child.name || child.path),
          routePath: fullRoutePath(item.path, child.path),
          icon: String(child.meta?.icon || 'Document'),
          title: String(child.meta?.title || child.name || child.path),
          fullPath: fullRoutePath(item.path, child.path),
          children: []
        }))
      if (children.length === 0) return null
      return {
        menuCode: String(item.name || item.path),
        menuName: String(item.meta?.title || item.name || item.path),
        routePath: item.path,
        icon: String(item.meta?.icon || children[0]?.icon || 'Menu'),
        title: String(item.meta?.title || item.name || item.path),
        fullPath: item.path,
        children
      }
    })
    .filter((item): item is MenuNode => item !== null)
}

function openMenu(path: string) {
  router.push(path)
}

function openProfile() {
  Object.assign(profileForm, currentUser.value)
  profileVisible.value = true
}

async function submitProfile() {
  const admin = await updateCurrentAdminProfile({
    nickname: profileForm.nickname,
    email: profileForm.email,
    phone: profileForm.phone
  })
  authStore.setAdmin(admin)
  profileVisible.value = false
  ElMessage.success(t('message.profileUpdated'))
}

function openPassword() {
  Object.assign(passwordForm, { oldPassword: '', newPassword: '', confirmPassword: '' })
  passwordVisible.value = true
}

async function submitPassword() {
  if (!passwordForm.oldPassword || !passwordForm.newPassword) {
    ElMessage.warning(t('message.passwordRequired'))
    return
  }
  if (passwordForm.newPassword !== passwordForm.confirmPassword) {
    ElMessage.warning(t('message.passwordMismatch'))
    return
  }
  await changeCurrentAdminPassword({
    oldPassword: passwordForm.oldPassword,
    newPassword: passwordForm.newPassword
  })
  passwordVisible.value = false
  ElMessage.success(t('message.passwordUpdated'))
}

async function logout() {
  await ElMessageBox.confirm(t('confirm.logout'), t('title.logout'), { type: 'warning' })
  authStore.logout()
  ElMessage.success(t('message.logoutSuccess'))
  router.replace('/login')
}

function changeLocale(value: string) {
  appStore.setLocale(value)
}

function handleUserCommand(command: string) {
  if (command === 'profile') openProfile()
  if (command === 'password') openPassword()
  if (command === 'logout') logout()
}

onMounted(() => {
  authStore.loadCurrentAdmin().catch(() => {
    authStore.logout()
    router.replace('/login')
  })
})
</script>

<template>
  <el-container class="layout-container">
    <el-aside :width="appStore.sidebarCollapsed ? '64px' : '220px'" class="layout-aside">
      <div class="brand" :class="{ collapsed: appStore.sidebarCollapsed }">
        <div class="brand-logo">N</div>
        <div v-if="!appStore.sidebarCollapsed" class="brand-text">
          <strong>Nexion</strong>
          <span>{{ t('app.name') }}</span>
        </div>
      </div>

      <el-menu
        :default-active="defaultActive"
        background-color="#304156"
        text-color="#bfcbd9"
        active-text-color="#ffffff"
        class="side-menu"
        router
        unique-opened
        :collapse="appStore.sidebarCollapsed"
      >
        <template v-for="menu in menuRoutes" :key="menu.fullPath">
          <el-sub-menu v-if="menu.children.length > 1 || (menu.children.length > 0 && menu.fullPath !== '/')" :index="menu.fullPath">
            <template #title>
              <el-icon><component :is="menu.icon || 'Menu'" /></el-icon>
              <span>{{ menu.title }}</span>
            </template>
            <el-menu-item
              v-for="child in menu.children"
              :key="child.fullPath"
              :index="child.fullPath"
              @click="openMenu(child.fullPath)"
            >
              <el-icon><component :is="child.icon || 'Document'" /></el-icon>
              <span>{{ child.title }}</span>
            </el-menu-item>
          </el-sub-menu>
          <el-menu-item
            v-else-if="menu.fullPath && menu.children.length === 0"
            :index="menu.fullPath"
            @click="openMenu(menu.fullPath)"
          >
            <el-icon><component :is="menu.icon || 'HomeFilled'" /></el-icon>
            <span>{{ menu.title }}</span>
          </el-menu-item>
          <el-menu-item
            v-else-if="menu.children?.[0]"
            :index="menu.children[0].fullPath"
            @click="openMenu(menu.children[0].fullPath)"
          >
            <el-icon><component :is="menu.children[0].icon || 'HomeFilled'" /></el-icon>
            <span>{{ menu.children[0].title }}</span>
          </el-menu-item>
        </template>
      </el-menu>
    </el-aside>

    <el-container>
      <el-header class="layout-header">
        <div class="header-left">
          <el-button circle @click="appStore.toggleSidebar">
            <el-icon><Fold v-if="!appStore.sidebarCollapsed" /><Expand v-else /></el-icon>
          </el-button>
          <el-breadcrumb separator="/">
            <el-breadcrumb-item>Nexion</el-breadcrumb-item>
            <el-breadcrumb-item>{{ currentRouteTitle }}</el-breadcrumb-item>
          </el-breadcrumb>
        </div>
        <div class="header-right">
          <el-segmented
            :model-value="locale"
            :options="[
              { label: t('common.zh'), value: 'zh-CN' },
              { label: t('common.en'), value: 'en-US' }
            ]"
            size="small"
            @update:model-value="(value: string | number) => changeLocale(String(value))"
          />
          <el-dropdown trigger="click" @command="handleUserCommand">
            <button class="user-menu" type="button">
              <span class="user-meta">
                <strong>{{ currentUser.nickname }}</strong>
                <span>{{ currentUser.username }}</span>
              </span>
              <el-avatar :size="34">{{ userInitial }}</el-avatar>
              <el-icon><ArrowDown /></el-icon>
            </button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="profile">
                  <el-icon><User /></el-icon>
                  {{ t('common.profile') }}
                </el-dropdown-item>
                <el-dropdown-item command="password">
                  <el-icon><Lock /></el-icon>
                  {{ t('common.password') }}
                </el-dropdown-item>
                <el-dropdown-item divided command="logout">
                  <el-icon><SwitchButton /></el-icon>
                  {{ t('common.logout') }}
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </el-header>

      <div class="tags-view">
        <el-tag closable effect="plain">{{ currentRouteTitle }}</el-tag>
      </div>

      <el-main class="layout-main">
        <router-view />
      </el-main>
    </el-container>

    <el-dialog v-model="profileVisible" :title="t('common.profile')" width="520px">
      <el-form :model="profileForm" label-width="88px">
        <el-form-item :label="t('common.username')"><el-input v-model="profileForm.username" disabled /></el-form-item>
        <el-form-item :label="t('common.nickname')"><el-input v-model="profileForm.nickname" /></el-form-item>
        <el-form-item :label="t('common.phone')"><el-input v-model="profileForm.phone" /></el-form-item>
        <el-form-item :label="t('common.email')"><el-input v-model="profileForm.email" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="profileVisible = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" @click="submitProfile">{{ t('common.save') }}</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="passwordVisible" :title="t('common.password')" width="520px">
      <el-form :model="passwordForm" label-width="96px">
        <el-form-item :label="t('common.oldPassword')"><el-input v-model="passwordForm.oldPassword" type="password" show-password /></el-form-item>
        <el-form-item :label="t('common.newPassword')"><el-input v-model="passwordForm.newPassword" type="password" show-password /></el-form-item>
        <el-form-item :label="t('common.confirmPassword')"><el-input v-model="passwordForm.confirmPassword" type="password" show-password /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="passwordVisible = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" @click="submitPassword">{{ t('common.confirmChange') }}</el-button>
      </template>
    </el-dialog>
  </el-container>
</template>

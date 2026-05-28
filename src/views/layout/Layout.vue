<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useRoute, useRouter } from 'vue-router'
import { useAppStore } from '@/store/app'
import { useAuthStore } from '@/store/auth'
import { constantRoutes } from '@/router'
import { changeCurrentAdminPassword, updateCurrentAdminProfile } from '@/apis/auth'

const route = useRoute()
const router = useRouter()
const appStore = useAppStore()
const authStore = useAuthStore()

const profileVisible = ref(false)
const passwordVisible = ref(false)
const currentUser = computed(() => authStore.admin || { username: '', nickname: '管理员', phone: '', email: '' })
const profileForm = reactive({ username: '', nickname: '', phone: '', email: '' })
const passwordForm = reactive({ oldPassword: '', newPassword: '', confirmPassword: '' })

function fullRoutePath(parentPath: string, childPath: string) {
  if (childPath.startsWith('/')) return childPath
  if (parentPath === '/') return `/${childPath}`
  return `${parentPath}/${childPath}`
}

const menuRoutes = computed(() => {
  const menuPathSet = new Set(authStore.admin?.menuPaths || [])
  const isSuperAdmin = authStore.admin?.superAdmin === 1
  return constantRoutes
    .filter((item) => item.children && item.path !== '/:pathMatch(.*)*' && item.path !== '/login')
    .map((item) => {
      const children = (item.children || []).filter((child) => isSuperAdmin || menuPathSet.has(fullRoutePath(item.path, child.path)))
      return { ...item, children }
    })
    .filter((item) => item.children.length > 0)
})
const defaultActive = computed(() => route.path)
const userInitial = computed(() => (currentUser.value.nickname || currentUser.value.username || 'A').slice(0, 1).toUpperCase())

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
  ElMessage.success('个人资料已更新')
}

function openPassword() {
  Object.assign(passwordForm, { oldPassword: '', newPassword: '', confirmPassword: '' })
  passwordVisible.value = true
}

async function submitPassword() {
  if (!passwordForm.oldPassword || !passwordForm.newPassword) {
    ElMessage.warning('请输入原密码和新密码')
    return
  }
  if (passwordForm.newPassword !== passwordForm.confirmPassword) {
    ElMessage.warning('两次输入的新密码不一致')
    return
  }
  await changeCurrentAdminPassword({
    oldPassword: passwordForm.oldPassword,
    newPassword: passwordForm.newPassword
  })
  passwordVisible.value = false
  ElMessage.success('密码已更新')
}

async function logout() {
  await ElMessageBox.confirm('确认退出当前账号?', '退出登录', { type: 'warning' })
  authStore.logout()
  ElMessage.success('已退出登录')
  router.replace('/login')
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
          <span>后台管理系统</span>
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
        <template v-for="menu in menuRoutes" :key="menu.path">
          <el-sub-menu v-if="menu.children && menu.children.length > 1" :index="menu.path">
            <template #title>
              <el-icon><component :is="menu.meta?.icon || 'Menu'" /></el-icon>
              <span>{{ menu.meta?.title }}</span>
            </template>
            <el-menu-item
              v-for="child in menu.children"
              :key="`${menu.path}/${child.path}`"
              :index="`${menu.path}/${child.path}`"
              @click="openMenu(`${menu.path}/${child.path}`)"
            >
              <el-icon><component :is="child.meta?.icon || 'Document'" /></el-icon>
              <span>{{ child.meta?.title }}</span>
            </el-menu-item>
          </el-sub-menu>
          <el-menu-item
            v-else-if="menu.children?.[0]"
            :index="`/${menu.children[0].path}`"
            @click="openMenu(`/${menu.children[0].path}`)"
          >
            <el-icon><component :is="menu.children[0].meta?.icon || 'HomeFilled'" /></el-icon>
            <span>{{ menu.children[0].meta?.title }}</span>
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
            <el-breadcrumb-item>{{ route.meta.title }}</el-breadcrumb-item>
          </el-breadcrumb>
        </div>
        <div class="header-right">
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
                  个人资料
                </el-dropdown-item>
                <el-dropdown-item command="password">
                  <el-icon><Lock /></el-icon>
                  修改密码
                </el-dropdown-item>
                <el-dropdown-item divided command="logout">
                  <el-icon><SwitchButton /></el-icon>
                  退出登录
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </el-header>

      <div class="tags-view">
        <el-tag closable effect="plain">{{ route.meta.title }}</el-tag>
      </div>

      <el-main class="layout-main">
        <router-view />
      </el-main>
    </el-container>

    <el-dialog v-model="profileVisible" title="个人资料" width="520px">
      <el-form :model="profileForm" label-width="88px">
        <el-form-item label="用户名"><el-input v-model="profileForm.username" disabled /></el-form-item>
        <el-form-item label="昵称"><el-input v-model="profileForm.nickname" /></el-form-item>
        <el-form-item label="手机号"><el-input v-model="profileForm.phone" /></el-form-item>
        <el-form-item label="邮箱"><el-input v-model="profileForm.email" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="profileVisible = false">取消</el-button>
        <el-button type="primary" @click="submitProfile">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="passwordVisible" title="修改密码" width="520px">
      <el-form :model="passwordForm" label-width="96px">
        <el-form-item label="原密码"><el-input v-model="passwordForm.oldPassword" type="password" show-password /></el-form-item>
        <el-form-item label="新密码"><el-input v-model="passwordForm.newPassword" type="password" show-password /></el-form-item>
        <el-form-item label="确认密码"><el-input v-model="passwordForm.confirmPassword" type="password" show-password /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="passwordVisible = false">取消</el-button>
        <el-button type="primary" @click="submitPassword">确认修改</el-button>
      </template>
    </el-dialog>
  </el-container>
</template>

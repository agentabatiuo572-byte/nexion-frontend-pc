<script setup lang="ts">
import { reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/store/auth'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const loading = ref(false)
const form = reactive({ username: 'superadmin', password: '' })

async function submitLogin() {
  if (!form.username || !form.password) {
    ElMessage.warning('请输入用户名和密码')
    return
  }
  loading.value = true
  try {
    await authStore.login(form.username, form.password)
    ElMessage.success('登录成功')
    router.replace((route.query.redirect as string) || '/home')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login-page">
    <section class="login-panel">
      <div class="login-brand">
        <div class="login-logo">N</div>
        <div>
          <h1>Nexion</h1>
          <p>PC 管理端</p>
        </div>
      </div>
      <el-form :model="form" label-position="top" @keyup.enter="submitLogin">
        <el-form-item label="用户名">
          <el-input v-model="form.username" size="large" autocomplete="username" />
        </el-form-item>
        <el-form-item label="密码">
          <el-input v-model="form.password" size="large" type="password" show-password autocomplete="current-password" />
        </el-form-item>
        <el-button type="primary" size="large" class="login-button" :loading="loading" @click="submitLogin">登录</el-button>
      </el-form>
    </section>
  </div>
</template>

<style scoped>
.login-page {
  min-height: 100vh;
  display: grid;
  place-items: center;
  background: #eef2f7;
}

.login-panel {
  width: min(420px, calc(100vw - 32px));
  padding: 34px;
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 18px 45px rgba(38, 52, 69, 0.14);
}

.login-brand {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 30px;
}

.login-logo {
  width: 44px;
  height: 44px;
  border-radius: 8px;
  display: grid;
  place-items: center;
  background: #409eff;
  color: #fff;
  font-size: 24px;
  font-weight: 700;
}

.login-brand h1 {
  margin: 0;
  font-size: 24px;
}

.login-brand p {
  margin: 4px 0 0;
  color: #909399;
}

.login-button {
  width: 100%;
  margin-top: 8px;
}
</style>

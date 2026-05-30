<script setup lang="ts">
import { computed } from 'vue'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import en from 'element-plus/es/locale/lang/en'
import { useAppStore } from '@/store/app'

const appStore = useAppStore()
const elementLocale = computed(() => appStore.locale.toLowerCase().startsWith('en') ? en : zhCn)
</script>

<template>
  <el-config-provider :locale="elementLocale">
    <router-view :key="appStore.locale" />
  </el-config-provider>
</template>

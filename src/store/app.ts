import { defineStore } from 'pinia'

export const useAppStore = defineStore('app', {
  state: () => ({
    sidebarCollapsed: false,
    locale: localStorage.getItem('nexion_admin_locale') || 'zh-CN'
  }),
  actions: {
    toggleSidebar() {
      this.sidebarCollapsed = !this.sidebarCollapsed
    },
    setLocale(locale: string) {
      this.locale = locale
      localStorage.setItem('nexion_admin_locale', locale)
    }
  }
})

import { defineStore } from 'pinia'
import { adminLogin, getCurrentAdmin, type AdminProfile } from '@/apis/auth'

const tokenKey = 'nexion_admin_token'
const adminKey = 'nexion_admin_profile'

function readAdmin() {
  const raw = localStorage.getItem(adminKey)
  if (!raw) return null
  try {
    return JSON.parse(raw) as AdminProfile
  } catch {
    return null
  }
}

export const useAuthStore = defineStore('auth', {
  state: () => ({
    token: localStorage.getItem(tokenKey) || '',
    admin: readAdmin() as AdminProfile | null
  }),
  getters: {
    isLoggedIn: (state) => !!state.token
  },
  actions: {
    setSession(token: string, admin: AdminProfile) {
      this.token = token
      this.admin = admin
      localStorage.setItem(tokenKey, token)
      localStorage.setItem(adminKey, JSON.stringify(admin))
    },
    setAdmin(admin: AdminProfile) {
      this.admin = admin
      localStorage.setItem(adminKey, JSON.stringify(admin))
    },
    async login(username: string, password: string) {
      const result = await adminLogin({ username, password })
      this.setSession(result.token, result.admin)
    },
    async loadCurrentAdmin() {
      const admin = await getCurrentAdmin()
      this.setAdmin(admin)
      return admin
    },
    logout() {
      this.token = ''
      this.admin = null
      localStorage.removeItem(tokenKey)
      localStorage.removeItem(adminKey)
      localStorage.removeItem('token')
      localStorage.removeItem('accessToken')
      sessionStorage.clear()
    }
  }
})

export { tokenKey }

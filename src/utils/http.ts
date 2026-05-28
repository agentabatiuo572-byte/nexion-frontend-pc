import axios, { type AxiosRequestConfig } from 'axios'
import { ElMessage } from 'element-plus'
import type { ApiResult } from '@/types/common'

const tokenKey = 'nexion_admin_token'

export interface NexionRequestConfig extends AxiosRequestConfig {
  silentError?: boolean
}

const service = axios.create({
  baseURL: import.meta.env.VITE_BASE_SERVER_URL || '/api',
  timeout: 15000
})

service.interceptors.request.use((config) => {
  const token = localStorage.getItem(tokenKey)
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

service.interceptors.response.use(
  (response) => {
    const result = response.data as ApiResult<unknown>
    const config = response.config as NexionRequestConfig
    if (typeof result?.code === 'number') {
      if (result.code !== 0) {
        if (!config.silentError) {
          ElMessage.error(result.message || '接口请求失败')
        }
        return Promise.reject(new Error(result.message || '接口请求失败'))
      }
      return result.data
    }
    return response.data
  },
  (error) => {
    const config = error?.config as NexionRequestConfig | undefined
    if (!config?.silentError) {
      ElMessage.error(error?.message || '网络请求失败')
    }
    return Promise.reject(error)
  }
)

export default function http<T = unknown>(config: NexionRequestConfig): Promise<T> {
  return service(config) as Promise<T>
}

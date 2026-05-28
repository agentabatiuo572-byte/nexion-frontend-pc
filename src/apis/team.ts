import http, { type NexionRequestConfig } from '@/utils/http'
import type { AnyRecord, CommonPage, Id } from '@/types/common'

export function getUserLevels(config?: NexionRequestConfig) {
  return http<AnyRecord[]>({ url: '/team/ranks/user-levels', method: 'get', ...config })
}

export function getVRanks(config?: NexionRequestConfig) {
  return http<AnyRecord[]>({ url: '/team/ranks/v-ranks', method: 'get', ...config })
}

export function getMyRank() {
  return http<AnyRecord>({ url: '/team/ranks/mine', method: 'get' })
}

export function evaluateRank(data: AnyRecord) {
  return http<AnyRecord>({ url: '/team/ranks/evaluate', method: 'post', data })
}

export function getTeamSummary(params?: { userId?: Id }, config?: NexionRequestConfig) {
  return http<AnyRecord>({ url: '/team/overview', method: 'get', params, ...config })
}

export function getCommissionEvents(userId: Id) {
  return http<CommonPage<AnyRecord>>({ url: '/team/commissions', method: 'get', params: { userId, pageNum: 1, pageSize: 50 } })
}

export function settleCommission(type: string, data: AnyRecord) {
  return http<AnyRecord>({ url: `/team/commissions/${type}`, method: 'post', params: data })
}

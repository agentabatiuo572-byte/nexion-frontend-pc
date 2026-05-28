export interface ApiResult<T> {
  code: number
  message: string
  data: T
}

export interface CommonPage<T> {
  records: T[]
  total: number
  size?: number
  current?: number
  pages?: number
  pageNum?: number
  pageSize?: number
}

export interface PageParam {
  current: number
  size: number
  pageNum?: number
  pageSize?: number
  [key: string]: unknown
}

export type Id = number | string
export type AnyRecord = Record<string, unknown>

import http from '@/utils/http'
import type { CommonPage, Id, PageParam } from '@/types/common'

export interface Admin {
  id?: Id
  username?: string
  password?: string
  nickname?: string
  email?: string
  phone?: string
  superAdmin?: number
  status?: number
}

export interface AdminProfile extends Omit<Admin, 'password'> {
  roleIds?: Id[]
  authorities?: string[]
  menuPaths?: string[]
  menus?: Menu[]
}

export interface AdminLoginResult {
  token: string
  admin: AdminProfile
}

export function adminLogin(data: { username: string; password: string }) {
  return http<AdminLoginResult>({ url: '/auth/admin/login', method: 'post', data })
}

export function getCurrentAdmin() {
  return http<AdminProfile>({ url: '/auth/admin/me', method: 'get' })
}

export function updateCurrentAdminProfile(data: Pick<AdminProfile, 'nickname' | 'email' | 'phone'>) {
  return http<AdminProfile>({ url: '/auth/admin/profile', method: 'put', data })
}

export function changeCurrentAdminPassword(data: { oldPassword: string; newPassword: string }) {
  return http<void>({ url: '/auth/admin/password', method: 'put', data })
}

export interface Role {
  id?: Id
  roleCode?: string
  roleName?: string
  remark?: string
  status?: number
}

export interface Permission {
  id?: Id
  permissionCode?: string
  permissionName?: string
  resourceType?: string
  resourcePath?: string
  remark?: string
  status?: number
}

export interface Menu {
  id?: Id
  menuCode?: string
  menuName?: string
  menuNameZh?: string
  menuNameEn?: string
  parentId?: Id | null
  routePath?: string
  icon?: string
  sortOrder?: number
  remark?: string
  status?: number
}

export interface CEndUser {
  id?: Id
  countryCode?: string
  phone?: string
  phoneMasked?: string
  nickname?: string
  avatarUrl?: string
  referralCode?: string
  sponsorUserId?: Id
  sponsorCode?: string
  kycStatus?: string
  userLevel?: string
  vRank?: string
  status?: string
  language?: string
  region?: string
  bio?: string
  timezone?: string
  createdAt?: string
  updatedAt?: string
}

export interface UserSearchItem {
  userId: Id
  nickname?: string
  phoneMasked?: string
  referralCode?: string
  userLevel?: string
  vRank?: string
  status?: string
}

export interface MenuQuery {
  menuCode?: string
  menuName?: string
  routePath?: string
  parentId?: Id | null
  status?: number | string
}

export function getAdminPage(params: PageParam) {
  return http<CommonPage<Admin>>({ url: '/auth/admins/page', method: 'get', params })
}

export function createAdmin(data: Admin) {
  return http<Admin>({ url: '/auth/admins', method: 'post', data })
}

export function updateAdmin(id: Id, data: Admin) {
  return http<Admin>({ url: `/auth/admins/${id}`, method: 'put', data })
}

export function deleteAdmin(id: Id) {
  return http<void>({ url: `/auth/admins/${id}`, method: 'delete' })
}

export function getAdminRoleIds(id: Id) {
  return http<Id[]>({ url: `/auth/admins/${id}/roles`, method: 'get' })
}

export function assignAdminRoles(id: Id, roleIds: Id[]) {
  return http<void>({ url: `/auth/admins/${id}/roles`, method: 'put', data: { roleIds } })
}

export function getRolePage(params: PageParam) {
  return http<CommonPage<Role>>({ url: '/auth/access-control/roles/page', method: 'get', params })
}

export function createRole(data: Role) {
  return http<Role>({ url: '/auth/access-control/roles', method: 'post', data })
}

export function updateRole(id: Id, data: Role) {
  return http<Role>({ url: `/auth/access-control/roles/${id}`, method: 'put', data })
}

export function deleteRole(id: Id) {
  return http<void>({ url: `/auth/access-control/roles/${id}`, method: 'delete' })
}

export function getRolePermissionIds(id: Id) {
  return http<Id[]>({ url: `/auth/access-control/roles/${id}/permissions`, method: 'get' })
}

export function getRoleMenuIds(id: Id) {
  return http<Id[]>({ url: `/auth/access-control/roles/${id}/menus`, method: 'get' })
}

export function assignRoleMenus(id: Id, menuIds: Id[]) {
  return http<void>({ url: `/auth/access-control/roles/${id}/menus`, method: 'put', data: { menuIds } })
}

export function assignRoleApiPermissions(id: Id, permissionIds: Id[]) {
  return http<void>({ url: `/auth/access-control/roles/${id}/api-permissions`, method: 'put', data: { permissionIds } })
}

export function getMenuList(params?: MenuQuery) {
  return http<Menu[]>({ url: '/auth/access-control/menus', method: 'get', params })
}

export function createMenu(data: Menu) {
  return http<Menu>({ url: '/auth/access-control/menus', method: 'post', data })
}

export function updateMenu(id: Id, data: Menu) {
  return http<Menu>({ url: `/auth/access-control/menus/${id}`, method: 'put', data })
}

export function deleteMenu(id: Id) {
  return http<void>({ url: `/auth/access-control/menus/${id}`, method: 'delete' })
}

export function getPermissionPage(params: PageParam) {
  return http<CommonPage<Permission>>({ url: '/auth/access-control/permissions/page', method: 'get', params })
}

export function createPermission(data: Permission) {
  return http<Permission>({ url: '/auth/access-control/permissions', method: 'post', data })
}

export function updatePermission(id: Id, data: Permission) {
  return http<Permission>({ url: `/auth/access-control/permissions/${id}`, method: 'put', data })
}

export function deletePermission(id: Id) {
  return http<void>({ url: `/auth/access-control/permissions/${id}`, method: 'delete' })
}

export function getUserPage(params: PageParam) {
  return http<CommonPage<CEndUser>>({ url: '/auth/users/page', method: 'get', params })
}

export function searchUsers(keyword: string, config?: { silentError?: boolean }) {
  return http<UserSearchItem[]>({ url: '/auth/users/search', method: 'get', params: { keyword, limit: 10 }, ...config })
}

export function getUserDetail(id: Id) {
  return http<CEndUser>({ url: `/auth/users/${id}`, method: 'get' })
}

export function updateUser(id: Id, data: Pick<CEndUser, 'nickname' | 'avatarUrl' | 'language' | 'region' | 'bio' | 'timezone'>) {
  return http<CEndUser>({ url: `/auth/users/${id}`, method: 'patch', data })
}

export function updateUserStatus(id: Id, status: string) {
  return http<CEndUser>({ url: `/auth/users/${id}/status`, method: 'patch', data: { status } })
}

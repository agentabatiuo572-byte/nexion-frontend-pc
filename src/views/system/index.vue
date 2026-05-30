<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import {
  createContentPage,
  createHelpArticle,
  createI18nMessage,
  createSystemConfig,
  getContentPages,
  getDayOneConfig,
  getDeviceFleetConfig,
  getDeviceLifecycleConfig,
  getFeatureConfig,
  getHelpArticles,
  getI18nMessages,
  getSystemConfigs,
  getSystemOpsDashboard,
  getTradeinConfig,
  updateContentPage,
  updateHelpArticle,
  updateI18nMessage,
  updateSystemConfig,
  type ConfigItem
} from '@/apis/operation'
import type { AnyRecord, Id } from '@/types/common'
import { formatNow, formatTableDateTime } from '@/utils/date'
import { localeText as lt, enumLabel, enumTableFormatter } from '@/utils/i18n'
import ObjectDetails from '@/components/ObjectDetails.vue'

const props = withDefaults(defineProps<{ defaultTab?: string }>(), { defaultTab: 'configs' })

const activeTab = ref(props.defaultTab)
const loading = ref(false)
const dashboard = ref<AnyRecord | null>(null)
const dayOne = ref<AnyRecord>({})
const features = ref<AnyRecord>({})
const fleetConfig = ref<AnyRecord>({})
const lifecycleConfig = ref<AnyRecord>({})
const tradeinConfig = ref<AnyRecord>({})
const systemConfigs = ref<ConfigItem[]>([])
const i18nMessages = ref<AnyRecord[]>([])
const contentPages = ref<AnyRecord[]>([])
const helpArticles = ref<AnyRecord[]>([])

const dashboardAudit = computed<AnyRecord>(() => (dashboard.value?.audit as AnyRecord) || {})
const dashboardSummary = computed<AnyRecord>(() => (dashboardAudit.value.summary as AnyRecord) || {})
const dashboardTopActions = computed<AnyRecord[]>(() => ((dashboardAudit.value.topActions as AnyRecord[]) || []))
const dashboardTopServices = computed<AnyRecord[]>(() => ((dashboardAudit.value.topServices as AnyRecord[]) || []))
const dashboardTopUsers = computed<AnyRecord[]>(() => ((dashboardAudit.value.topUsers as AnyRecord[]) || []))
const dashboardModules = computed<AnyRecord[]>(() => ((dashboard.value?.modules as AnyRecord[]) || []))
const dashboardRoutes = computed<string[]>(() => ((dashboard.value?.routes as string[]) || []))

const configQuery = reactive({ query: '', status: '', limit: 50 })
const i18nQuery = reactive({ locale: '', query: '', status: '', limit: 50 })
const contentQuery = reactive({ query: '', status: '', limit: 50 })
const helpQuery = reactive({ query: '', status: '', limit: 50 })
const binaryStatusOptions = [
  { label: enumLabel(1), value: 1 },
  { label: enumLabel(0), value: 0 }
]

const configDialogVisible = ref(false)
const configSaving = ref(false)
const configFormRef = ref<FormInstance>()
const lastConfigAction = ref('')
const configForm = reactive({
  id: undefined as Id | undefined,
  configKey: '',
  configValue: '',
  valueType: 'STRING',
  configGroup: '',
  visibility: 'ADMIN',
  remark: '',
  status: 0
})
const configRules: FormRules = {
  configKey: [{ required: true, message: lt('请填写配置键', 'Please enter config key'), trigger: 'blur' }],
  configValue: [{ required: true, message: lt('请填写配置值', 'Please enter config value'), trigger: 'blur' }],
  valueType: [{ required: true, message: lt('请选择类型', 'Please select type'), trigger: 'change' }],
  visibility: [{ required: true, message: lt('请选择可见性', 'Please select visibility'), trigger: 'change' }]
}

const i18nDialogVisible = ref(false)
const i18nSaving = ref(false)
const i18nForm = reactive({
  id: undefined as Id | undefined,
  messageKey: '',
  locale: 'en-US',
  messageValue: '',
  status: 1
})

const contentDialogVisible = ref(false)
const contentSaving = ref(false)
const contentForm = reactive({
  id: undefined as Id | undefined,
  pageCode: '',
  title: '',
  content: '',
  status: 1
})

const helpDialogVisible = ref(false)
const helpSaving = ref(false)
const helpForm = reactive({
  id: undefined as Id | undefined,
  articleCode: '',
  title: '',
  content: '',
  sortOrder: 100,
  status: 1
})

function compactParams(params: AnyRecord) {
  return Object.fromEntries(Object.entries(params).filter(([, value]) => value !== '' && value != null))
}

function statusTag(status: unknown) {
  return Number(status) === 1 || status === 'ACTIVE' ? 'success' : 'info'
}

function bucketName(row: AnyRecord) {
  return row.name || row.key || row.label || row.action || row.service || row.userId || row.userName || '-'
}

function bucketCount(row: AnyRecord) {
  return row.count ?? row.total ?? row.value ?? 0
}

function resetConfigForm() {
  Object.assign(configForm, {
    id: undefined,
    configKey: '',
    configValue: '',
    valueType: 'STRING',
    configGroup: '',
    visibility: 'ADMIN',
    remark: '',
    status: 0
  })
}

function openConfigDialog(row?: ConfigItem) {
  resetConfigForm()
  if (row) {
    Object.assign(configForm, {
      id: row.id,
      configKey: row.configKey || '',
      configValue: row.configValue || '',
      valueType: row.valueType || 'STRING',
      configGroup: row.configGroup || '',
      visibility: row.visibility || 'ADMIN',
      remark: row.remark || '',
      status: row.status ?? 1
    })
  }
  configDialogVisible.value = true
}

function validateJsonValue(valueType: string, value: string) {
  if (valueType === 'JSON' && value) JSON.parse(value)
}

async function validateConfigForm() {
  try {
    await configFormRef.value?.validate()
    return true
  } catch {
    return false
  }
}

async function saveConfig() {
  if (!(await validateConfigForm())) {
    return
  }
  if (!configForm.configValue) {
    ElMessage.warning(lt('请填写配置值', 'Please enter config value'))
    return
  }
  try {
    validateJsonValue(configForm.valueType, configForm.configValue)
  } catch {
    ElMessage.warning(lt('JSON 配置值格式不合法', 'Invalid JSON config value'))
    return
  }
  configSaving.value = true
  try {
    const payload = {
      configValue: configForm.configValue,
      valueType: configForm.valueType,
      configGroup: configForm.configGroup,
      visibility: configForm.visibility,
      remark: configForm.remark,
      status: configForm.status
    }
    if (configForm.id) {
      await updateSystemConfig(configForm.id, payload)
      ElMessage.success(lt('配置已更新', 'Config updated'))
      lastConfigAction.value = `已更新配置 ${configForm.configKey}，状态 ${configForm.status}，${formatNow()}`
    } else {
      await createSystemConfig({ ...payload, configKey: configForm.configKey })
      ElMessage.success(lt('配置已创建', 'Config created'))
      lastConfigAction.value = `已创建配置 ${configForm.configKey}，状态 ${configForm.status}，${formatNow()}`
    }
    configDialogVisible.value = false
    await loadConfigs()
  } finally {
    configSaving.value = false
  }
}

async function changeConfigStatus(row: ConfigItem, status: number) {
  if (!row.id) return
  await ElMessageBox.confirm(`确认将配置 ${row.configKey} 状态改为 ${status === 1 ? '启用' : '停用'}?`, lt('配置状态变更', 'Config Status Change'), { type: 'warning' })
  configSaving.value = true
  try {
    await updateSystemConfig(row.id, { status })
    ElMessage.success(lt('配置状态已更新', 'Config status updated'))
    lastConfigAction.value = `已将配置 ${row.configKey} 状态改为 ${status}，${formatNow()}`
    await loadConfigs()
  } finally {
    configSaving.value = false
  }
}

function openI18nDialog(row?: AnyRecord) {
  Object.assign(i18nForm, {
    id: row?.id,
    messageKey: String(row?.messageKey || ''),
    locale: String(row?.locale || 'en-US'),
    messageValue: String(row?.messageValue || ''),
    status: Number(row?.status ?? 1)
  })
  i18nDialogVisible.value = true
}

async function saveI18n() {
  if (!i18nForm.messageKey && !i18nForm.id) {
    ElMessage.warning(lt('请填写消息键', 'Please enter message key'))
    return
  }
  i18nSaving.value = true
  try {
    if (i18nForm.id) {
      await updateI18nMessage(i18nForm.id, { messageValue: i18nForm.messageValue, status: i18nForm.status })
      ElMessage.success(lt('消息已更新', 'Message updated'))
    } else {
      await createI18nMessage(i18nForm)
      ElMessage.success(lt('消息已创建', 'Message created'))
    }
    i18nDialogVisible.value = false
    await loadI18n()
  } finally {
    i18nSaving.value = false
  }
}

function openContentDialog(row?: AnyRecord) {
  Object.assign(contentForm, {
    id: row?.id,
    pageCode: String(row?.pageCode || ''),
    title: String(row?.title || ''),
    content: String(row?.content || ''),
    status: Number(row?.status ?? 1)
  })
  contentDialogVisible.value = true
}

async function saveContent() {
  if (!contentForm.title || (!contentForm.id && !contentForm.pageCode)) {
    ElMessage.warning(lt('请补全页面编码和标题', 'Please complete page code and title'))
    return
  }
  contentSaving.value = true
  try {
    if (contentForm.id) {
      await updateContentPage(contentForm.id, { title: contentForm.title, content: contentForm.content, status: contentForm.status })
      ElMessage.success(lt('内容页已更新', 'Content page updated'))
    } else {
      await createContentPage(contentForm)
      ElMessage.success(lt('内容页已创建', 'Content page created'))
    }
    contentDialogVisible.value = false
    await loadContent()
  } finally {
    contentSaving.value = false
  }
}

function openHelpDialog(row?: AnyRecord) {
  Object.assign(helpForm, {
    id: row?.id,
    articleCode: String(row?.articleCode || ''),
    title: String(row?.title || ''),
    content: String(row?.content || ''),
    sortOrder: Number(row?.sortOrder ?? 100),
    status: Number(row?.status ?? 1)
  })
  helpDialogVisible.value = true
}

async function saveHelp() {
  if (!helpForm.title || (!helpForm.id && !helpForm.articleCode)) {
    ElMessage.warning(lt('请补全文章编码和标题', 'Please complete article code and title'))
    return
  }
  helpSaving.value = true
  try {
    if (helpForm.id) {
      await updateHelpArticle(helpForm.id, {
        title: helpForm.title,
        content: helpForm.content,
        sortOrder: helpForm.sortOrder,
        status: helpForm.status
      })
      ElMessage.success(lt('帮助文章已更新', 'Help article updated'))
    } else {
      await createHelpArticle(helpForm)
      ElMessage.success(lt('帮助文章已创建', 'Help article created'))
    }
    helpDialogVisible.value = false
    await loadHelp()
  } finally {
    helpSaving.value = false
  }
}

async function loadPublicConfig() {
  const [dayOneRes, featureRes, fleetRes, lifecycleRes, tradeinRes] = await Promise.allSettled([
    getDayOneConfig({ silentError: true }),
    getFeatureConfig({ silentError: true }),
    getDeviceFleetConfig({ silentError: true }),
    getDeviceLifecycleConfig({ silentError: true }),
    getTradeinConfig({ silentError: true })
  ])
  dayOne.value = dayOneRes.status === 'fulfilled' ? dayOneRes.value : {}
  features.value = featureRes.status === 'fulfilled' ? featureRes.value : {}
  fleetConfig.value = fleetRes.status === 'fulfilled' ? fleetRes.value : {}
  lifecycleConfig.value = lifecycleRes.status === 'fulfilled' ? lifecycleRes.value : {}
  tradeinConfig.value = tradeinRes.status === 'fulfilled' ? tradeinRes.value : {}
}

async function loadConfigs() {
  systemConfigs.value = await getSystemConfigs(compactParams(configQuery), { silentError: true }).catch(() => [])
}

async function loadI18n() {
  i18nMessages.value = await getI18nMessages(compactParams(i18nQuery), { silentError: true }).catch(() => [])
}

async function loadContent() {
  contentPages.value = await getContentPages(compactParams(contentQuery), { silentError: true }).catch(() => [])
}

async function loadHelp() {
  helpArticles.value = await getHelpArticles(compactParams(helpQuery), { silentError: true }).catch(() => [])
}

async function loadDashboard() {
  dashboard.value = await getSystemOpsDashboard(7, { silentError: true }).catch(() => null)
}

async function loadActiveTab() {
  if (activeTab.value === 'public') await loadPublicConfig()
  if (activeTab.value === 'configs') await loadConfigs()
  if (activeTab.value === 'i18n') await loadI18n()
  if (activeTab.value === 'content') await loadContent()
  if (activeTab.value === 'help') await loadHelp()
}

async function loadData() {
  loading.value = true
  try {
    await Promise.all([loadDashboard(), loadActiveTab()])
  } finally {
    loading.value = false
  }
}

watch(() => props.defaultTab, (value) => {
  activeTab.value = value
})

watch(activeTab, loadData)

onMounted(loadData)
</script>

<template>
  <div>
    <el-card shadow="never" class="app-card">
      <div class="table-toolbar">
        <span>{{ lt('系统配置', 'System Config') }}</span>
        <el-button :icon="'Refresh'" @click="loadData">{{ lt('刷新', 'Refresh') }}</el-button>
      </div>
      <el-tabs v-model="activeTab">
        <el-tab-pane :label="lt('后台配置', 'Admin Config')" name="configs">
          <div class="table-toolbar">
            <span>{{ lt('配置项', 'Config Items') }}</span>
            <el-button type="primary" :icon="'Plus'" @click="openConfigDialog()">{{ lt('新增配置', 'New Config') }}</el-button>
          </div>
          <el-form :inline="true" :model="configQuery" class="filter-form">
            <el-form-item :label="lt('关键词', 'Keyword')"><el-input v-model="configQuery.query" clearable /></el-form-item>
            <el-form-item :label="lt('状态', 'Status')">
              <el-select v-model="configQuery.status" clearable style="width: 120px">
                <el-option :label="lt('启用', 'Enabled')" :value="1" />
                <el-option :label="lt('停用', 'Disabled')" :value="0" />
              </el-select>
            </el-form-item>
            <el-form-item :label="lt('条数', 'Limit')"><el-input-number v-model="configQuery.limit" :min="1" :max="200" /></el-form-item>
            <el-form-item><el-button type="primary" @click="loadData">{{ lt('查询', 'Search') }}</el-button></el-form-item>
          </el-form>
          <el-alert v-if="lastConfigAction" :title="lastConfigAction" type="success" show-icon :closable="false" class="operation-alert" />
          <el-table v-loading="loading" :data="systemConfigs" border>
            <el-table-column prop="configKey" :label="lt('配置键', 'Config Key')" min-width="220" />
            <el-table-column prop="configGroup" :label="lt('分组', 'Group')" width="120" />
            <el-table-column prop="valueType" :label="lt('类型', 'Type')" width="110" />
            <el-table-column prop="visibility" :label="lt('可见性', 'Visibility')" width="110" :formatter="enumTableFormatter" />
            <el-table-column prop="configValue" :label="lt('配置值', 'Config Value')" min-width="260" show-overflow-tooltip />
            <el-table-column :label="lt('状态', 'Status')" width="90"><template #default="{ row }"><el-tag :type="statusTag(row.status)">{{ enumLabel(row.status) }}</el-tag></template></el-table-column>
            <el-table-column prop="remark" :label="lt('备注', 'Remark')" min-width="160" />
            <el-table-column :label="lt('操作', 'Actions')" width="170" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" @click="openConfigDialog(row)">{{ lt('编辑', 'Edit') }}</el-button>
                <el-button v-if="Number(row.status) !== 1" link type="success" :disabled="configSaving" @click="changeConfigStatus(row, 1)">{{ lt('启用', 'Enabled') }}</el-button>
                <el-button v-else link type="warning" :disabled="configSaving" @click="changeConfigStatus(row, 0)">{{ lt('停用', 'Disabled') }}</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>

        <el-tab-pane :label="lt('公共配置', 'Public Config')" name="public">
          <el-row :gutter="16" class="app-card">
            <el-col :xs="24" :md="8">
              <el-descriptions title="Day 0" :column="1" border>
                <el-descriptions-item :label="lt('首笔目标秒', 'First Receipt Target Seconds')">{{ dayOne.firstReceiptTargetSeconds || '-' }}</el-descriptions-item>
                <el-descriptions-item :label="lt('首笔 USDT', 'First Receipt USDT')">{{ dayOne.firstReceiptUsdt || '-' }}</el-descriptions-item>
                <el-descriptions-item :label="lt('欢迎奖励', 'Welcome Bonus')">{{ dayOne.welcomeBonusAmount || '-' }} {{ dayOne.welcomeBonusAsset || '' }}</el-descriptions-item>
              </el-descriptions>
            </el-col>
            <el-col :xs="24" :md="8">
              <el-descriptions :title="lt('功能开关', 'Feature Flags')" :column="1" border>
                <el-descriptions-item v-for="(value, key) in features" :key="key" :label="String(key)">{{ enumLabel(value) }}</el-descriptions-item>
              </el-descriptions>
            </el-col>
            <el-col :xs="24" :md="8">
              <el-descriptions :title="lt('设备池', 'Device Fleet')" :column="1" border>
                <el-descriptions-item :label="lt('最大激活槽位', 'Max Active Slots')">{{ fleetConfig.maxActiveSlots || '-' }}</el-descriptions-item>
              </el-descriptions>
            </el-col>
          </el-row>
          <el-row :gutter="16">
            <el-col :xs="24" :md="12">
              <el-card shadow="never" :header="lt('设备生命周期配置', 'Device Lifecycle Config')">
                <ObjectDetails :data="lifecycleConfig" />
              </el-card>
            </el-col>
            <el-col :xs="24" :md="12">
              <el-card shadow="never" :header="lt('Trade-in 配置', 'Trade-in Config')">
                <ObjectDetails :data="tradeinConfig" />
              </el-card>
            </el-col>
          </el-row>
        </el-tab-pane>

        <el-tab-pane label="i18n" name="i18n">
          <div class="table-toolbar">
            <span>{{ lt('多语言消息', 'I18n Messages') }}</span>
            <el-button type="primary" :icon="'Plus'" @click="openI18nDialog()">{{ lt('新增消息', 'New Message') }}</el-button>
          </div>
          <el-form :inline="true" :model="i18nQuery" class="filter-form">
            <el-form-item label="Locale"><el-input v-model="i18nQuery.locale" clearable /></el-form-item>
            <el-form-item :label="lt('关键词', 'Keyword')"><el-input v-model="i18nQuery.query" clearable /></el-form-item>
            <el-form-item :label="lt('状态', 'Status')">
              <el-select v-model="i18nQuery.status" clearable style="width: 120px">
                <el-option v-for="item in binaryStatusOptions" :key="item.value" :label="item.label" :value="item.value" />
              </el-select>
            </el-form-item>
            <el-form-item :label="lt('条数', 'Limit')"><el-input-number v-model="i18nQuery.limit" :min="1" :max="200" /></el-form-item>
            <el-form-item><el-button type="primary" @click="loadData">{{ lt('查询', 'Search') }}</el-button></el-form-item>
          </el-form>
          <el-table v-loading="loading" :data="i18nMessages" border>
            <el-table-column prop="messageKey" :label="lt('消息键', 'Message Key')" min-width="220" />
            <el-table-column prop="locale" label="Locale" width="110" />
            <el-table-column prop="messageValue" :label="lt('消息值', 'Message Value')" min-width="260" show-overflow-tooltip />
            <el-table-column prop="status" :label="lt('状态', 'Status')" width="90" :formatter="enumTableFormatter" />
            <el-table-column :label="lt('操作', 'Actions')" width="100" fixed="right">
              <template #default="{ row }"><el-button link type="primary" @click="openI18nDialog(row)">{{ lt('编辑', 'Edit') }}</el-button></template>
            </el-table-column>
          </el-table>
        </el-tab-pane>

        <el-tab-pane :label="lt('内容页', 'Content Pages')" name="content">
          <div class="table-toolbar">
            <span>{{ lt('内容页面', 'Content Pages') }}</span>
            <el-button type="primary" :icon="'Plus'" @click="openContentDialog()">{{ lt('新增页面', 'New Page') }}</el-button>
          </div>
          <el-form :inline="true" :model="contentQuery" class="filter-form">
            <el-form-item :label="lt('关键词', 'Keyword')"><el-input v-model="contentQuery.query" clearable /></el-form-item>
            <el-form-item :label="lt('状态', 'Status')">
              <el-select v-model="contentQuery.status" clearable style="width: 120px">
                <el-option v-for="item in binaryStatusOptions" :key="item.value" :label="item.label" :value="item.value" />
              </el-select>
            </el-form-item>
            <el-form-item :label="lt('条数', 'Limit')"><el-input-number v-model="contentQuery.limit" :min="1" :max="200" /></el-form-item>
            <el-form-item><el-button type="primary" @click="loadData">{{ lt('查询', 'Search') }}</el-button></el-form-item>
          </el-form>
          <el-table v-loading="loading" :data="contentPages" border>
            <el-table-column prop="pageCode" :label="lt('页面编码', 'Page Code')" min-width="180" />
            <el-table-column prop="title" :label="lt('标题', 'Title')" min-width="180" />
            <el-table-column prop="status" :label="lt('状态', 'Status')" width="90" :formatter="enumTableFormatter" />
            <el-table-column prop="updatedAt" :label="lt('更新时间', 'Updated At')" min-width="170" :formatter="formatTableDateTime" />
            <el-table-column :label="lt('操作', 'Actions')" width="100" fixed="right">
              <template #default="{ row }"><el-button link type="primary" @click="openContentDialog(row)">{{ lt('编辑', 'Edit') }}</el-button></template>
            </el-table-column>
          </el-table>
        </el-tab-pane>

        <el-tab-pane :label="lt('帮助中心', 'Help Center')" name="help">
          <div class="table-toolbar">
            <span>{{ lt('帮助文章', 'Help Articles') }}</span>
            <el-button type="primary" :icon="'Plus'" @click="openHelpDialog()">{{ lt('新增文章', 'New Article') }}</el-button>
          </div>
          <el-form :inline="true" :model="helpQuery" class="filter-form">
            <el-form-item :label="lt('关键词', 'Keyword')"><el-input v-model="helpQuery.query" clearable /></el-form-item>
            <el-form-item :label="lt('状态', 'Status')">
              <el-select v-model="helpQuery.status" clearable style="width: 120px">
                <el-option v-for="item in binaryStatusOptions" :key="item.value" :label="item.label" :value="item.value" />
              </el-select>
            </el-form-item>
            <el-form-item :label="lt('条数', 'Limit')"><el-input-number v-model="helpQuery.limit" :min="1" :max="200" /></el-form-item>
            <el-form-item><el-button type="primary" @click="loadData">{{ lt('查询', 'Search') }}</el-button></el-form-item>
          </el-form>
          <el-table v-loading="loading" :data="helpArticles" border>
            <el-table-column prop="articleCode" :label="lt('文章编码', 'Article Code')" min-width="180" />
            <el-table-column prop="title" :label="lt('标题', 'Title')" min-width="180" />
            <el-table-column prop="sortOrder" :label="lt('排序', 'Sort Order')" width="90" />
            <el-table-column prop="status" :label="lt('状态', 'Status')" width="90" :formatter="enumTableFormatter" />
            <el-table-column prop="updatedAt" :label="lt('更新时间', 'Updated At')" min-width="170" :formatter="formatTableDateTime" />
            <el-table-column :label="lt('操作', 'Actions')" width="100" fixed="right">
              <template #default="{ row }"><el-button link type="primary" @click="openHelpDialog(row)">{{ lt('编辑', 'Edit') }}</el-button></template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
      </el-tabs>
    </el-card>

    <el-card shadow="never" class="app-card">
      <template #header>{{ lt('系统运营聚合', 'System Ops Aggregate') }}</template>
      <el-empty v-if="!dashboard" :description="lt('暂无运营聚合数据', 'No ops aggregate data')" />
      <template v-else>
        <el-row :gutter="16" class="ops-summary">
          <el-col :xs="24" :sm="12" :md="6">
            <div class="ops-metric">
              <span>{{ lt('服务', 'Service') }}</span>
              <strong>{{ dashboard.service || '-' }}</strong>
            </div>
          </el-col>
          <el-col :xs="24" :sm="12" :md="6">
            <div class="ops-metric">
              <span>{{ lt('审计总量', 'Audit Total') }}</span>
              <strong>{{ dashboardSummary.total ?? 0 }}</strong>
            </div>
          </el-col>
          <el-col :xs="24" :sm="12" :md="6">
            <div class="ops-metric">
              <span>{{ lt('统计开始', 'Stats From') }}</span>
              <strong>{{ formatTableDateTime(null, null, dashboardSummary.startAt) }}</strong>
            </div>
          </el-col>
          <el-col :xs="24" :sm="12" :md="6">
            <div class="ops-metric">
              <span>{{ lt('生成时间', 'Generated At') }}</span>
              <strong>{{ formatTableDateTime(null, null, dashboard.generatedAt) }}</strong>
            </div>
          </el-col>
        </el-row>

        <el-row :gutter="16">
          <el-col :xs="24" :md="8">
            <el-table :data="dashboardTopActions" border size="small">
              <el-table-column :label="lt('Top 操作', 'Top Actions')" min-width="160">
                <template #default="{ row }">{{ bucketName(row) }}</template>
              </el-table-column>
              <el-table-column :label="lt('次数', 'Count')" width="90" align="right">
                <template #default="{ row }">{{ bucketCount(row) }}</template>
              </el-table-column>
            </el-table>
          </el-col>
          <el-col :xs="24" :md="8">
            <el-table :data="dashboardTopServices" border size="small">
              <el-table-column :label="lt('Top 服务', 'Top Services')" min-width="160">
                <template #default="{ row }">{{ bucketName(row) }}</template>
              </el-table-column>
              <el-table-column :label="lt('次数', 'Count')" width="90" align="right">
                <template #default="{ row }">{{ bucketCount(row) }}</template>
              </el-table-column>
            </el-table>
          </el-col>
          <el-col :xs="24" :md="8">
            <el-table :data="dashboardTopUsers" border size="small">
              <el-table-column :label="lt('Top 用户', 'Top Users')" min-width="160">
                <template #default="{ row }">{{ bucketName(row) }}</template>
              </el-table-column>
              <el-table-column :label="lt('次数', 'Count')" width="90" align="right">
                <template #default="{ row }">{{ bucketCount(row) }}</template>
              </el-table-column>
            </el-table>
          </el-col>
        </el-row>

        <el-table :data="dashboardModules" border class="ops-table">
          <el-table-column prop="service" :label="lt('覆盖服务', 'Covered Service')" min-width="220" />
          <el-table-column prop="domain" :label="lt('运营域', 'Ops Domain')" min-width="260" />
        </el-table>

        <div class="ops-route-list">
          <span v-for="route in dashboardRoutes" :key="route">{{ route }}</span>
        </div>
      </template>
    </el-card>

    <el-dialog v-model="configDialogVisible" :title="configForm.id ? lt('编辑配置', 'Edit Config') : lt('新增配置', 'New Config')" width="720px">
      <el-form ref="configFormRef" :model="configForm" :rules="configRules" label-width="106px">
        <el-row :gutter="16">
          <el-col :span="12"><el-form-item :label="lt('配置键', 'Config Key')" prop="configKey"><el-input v-model="configForm.configKey" :disabled="!!configForm.id" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item :label="lt('分组', 'Group')"><el-input v-model="configForm.configGroup" /></el-form-item></el-col>
          <el-col :span="12">
            <el-form-item :label="lt('类型', 'Type')" prop="valueType">
              <el-select v-model="configForm.valueType" style="width: 100%">
                <el-option label="STRING" value="STRING" />
                <el-option label="NUMBER" value="NUMBER" />
                <el-option label="BOOLEAN" value="BOOLEAN" />
                <el-option label="JSON" value="JSON" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item :label="lt('可见性', 'Visibility')" prop="visibility">
              <el-select v-model="configForm.visibility" style="width: 100%">
                <el-option label="ADMIN" value="ADMIN" />
                <el-option label="PUBLIC" value="PUBLIC" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12"><el-form-item :label="lt('状态', 'Status')"><el-switch v-model="configForm.status" :active-value="1" :inactive-value="0" /></el-form-item></el-col>
          <el-col :span="24"><el-form-item :label="lt('配置值', 'Config Value')" prop="configValue"><el-input v-model="configForm.configValue" type="textarea" :rows="5" /></el-form-item></el-col>
          <el-col :span="24"><el-form-item :label="lt('备注', 'Remark')"><el-input v-model="configForm.remark" /></el-form-item></el-col>
        </el-row>
      </el-form>
      <template #footer>
        <el-button @click="configDialogVisible = false">{{ lt('取消', 'Cancel') }}</el-button>
        <el-button type="primary" :loading="configSaving" @click="saveConfig">{{ lt('保存', 'Save') }}</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="i18nDialogVisible" :title="i18nForm.id ? lt('编辑消息', 'Edit Message') : lt('新增消息', 'New Message')" width="620px">
      <el-form :model="i18nForm" label-width="106px">
        <el-form-item :label="lt('消息键', 'Message Key')"><el-input v-model="i18nForm.messageKey" :disabled="!!i18nForm.id" /></el-form-item>
        <el-form-item label="Locale"><el-input v-model="i18nForm.locale" :disabled="!!i18nForm.id" /></el-form-item>
        <el-form-item :label="lt('消息值', 'Message Value')"><el-input v-model="i18nForm.messageValue" type="textarea" :rows="4" /></el-form-item>
        <el-form-item :label="lt('状态', 'Status')"><el-switch v-model="i18nForm.status" :active-value="1" :inactive-value="0" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="i18nDialogVisible = false">{{ lt('取消', 'Cancel') }}</el-button>
        <el-button type="primary" :loading="i18nSaving" @click="saveI18n">{{ lt('保存', 'Save') }}</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="contentDialogVisible" :title="contentForm.id ? lt('编辑内容页', 'Edit Content Page') : lt('新增内容页', 'New Content Page')" width="760px">
      <el-form :model="contentForm" label-width="106px">
        <el-form-item :label="lt('页面编码', 'Page Code')"><el-input v-model="contentForm.pageCode" :disabled="!!contentForm.id" /></el-form-item>
        <el-form-item :label="lt('标题', 'Title')"><el-input v-model="contentForm.title" /></el-form-item>
        <el-form-item :label="lt('内容', 'Content')"><el-input v-model="contentForm.content" type="textarea" :rows="10" /></el-form-item>
        <el-form-item :label="lt('状态', 'Status')"><el-switch v-model="contentForm.status" :active-value="1" :inactive-value="0" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="contentDialogVisible = false">{{ lt('取消', 'Cancel') }}</el-button>
        <el-button type="primary" :loading="contentSaving" @click="saveContent">{{ lt('保存', 'Save') }}</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="helpDialogVisible" :title="helpForm.id ? lt('编辑帮助文章', 'Edit Help Article') : lt('新增帮助文章', 'New Help Article')" width="760px">
      <el-form :model="helpForm" label-width="106px">
        <el-form-item :label="lt('文章编码', 'Article Code')"><el-input v-model="helpForm.articleCode" :disabled="!!helpForm.id" /></el-form-item>
        <el-form-item :label="lt('标题', 'Title')"><el-input v-model="helpForm.title" /></el-form-item>
        <el-form-item :label="lt('排序', 'Sort Order')"><el-input-number v-model="helpForm.sortOrder" :min="0" style="width: 100%" /></el-form-item>
        <el-form-item :label="lt('内容', 'Content')"><el-input v-model="helpForm.content" type="textarea" :rows="10" /></el-form-item>
        <el-form-item :label="lt('状态', 'Status')"><el-switch v-model="helpForm.status" :active-value="1" :inactive-value="0" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="helpDialogVisible = false">{{ lt('取消', 'Cancel') }}</el-button>
        <el-button type="primary" :loading="helpSaving" @click="saveHelp">{{ lt('保存', 'Save') }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.ops-summary {
  margin-bottom: 16px;
}

.ops-metric {
  display: flex;
  min-height: 86px;
  flex-direction: column;
  justify-content: center;
  gap: 8px;
  padding: 16px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 8px;
  background: var(--el-fill-color-lighter);
}

.ops-metric span {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.ops-metric strong {
  overflow: hidden;
  color: var(--el-text-color-primary);
  font-size: 18px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ops-table {
  margin-top: 16px;
}

.ops-route-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 16px;
}

.ops-route-list span {
  padding: 6px 10px;
  border-radius: 6px;
  background: var(--el-fill-color-light);
  color: var(--el-text-color-regular);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
}
</style>

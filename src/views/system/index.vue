<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
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

const configQuery = reactive({ query: '', status: '', limit: 50 })
const i18nQuery = reactive({ locale: '', query: '', status: '', limit: 50 })
const contentQuery = reactive({ query: '', status: '', limit: 50 })
const helpQuery = reactive({ query: '', status: '', limit: 50 })

const configDialogVisible = ref(false)
const configSaving = ref(false)
const configForm = reactive({
  id: undefined as Id | undefined,
  configKey: '',
  configValue: '',
  valueType: 'STRING',
  configGroup: '',
  visibility: 'ADMIN',
  remark: '',
  status: 1
})

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

function resetConfigForm() {
  Object.assign(configForm, {
    id: undefined,
    configKey: '',
    configValue: '',
    valueType: 'STRING',
    configGroup: '',
    visibility: 'ADMIN',
    remark: '',
    status: 1
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

async function saveConfig() {
  if (!configForm.configKey && !configForm.id) {
    ElMessage.warning('请填写配置键')
    return
  }
  try {
    validateJsonValue(configForm.valueType, configForm.configValue)
  } catch {
    ElMessage.warning('JSON 配置值格式不合法')
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
      ElMessage.success('配置已更新')
    } else {
      await createSystemConfig({ ...payload, configKey: configForm.configKey })
      ElMessage.success('配置已创建')
    }
    configDialogVisible.value = false
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
    ElMessage.warning('请填写消息键')
    return
  }
  i18nSaving.value = true
  try {
    if (i18nForm.id) {
      await updateI18nMessage(i18nForm.id, { messageValue: i18nForm.messageValue, status: i18nForm.status })
      ElMessage.success('消息已更新')
    } else {
      await createI18nMessage(i18nForm)
      ElMessage.success('消息已创建')
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
    ElMessage.warning('请补全页面编码和标题')
    return
  }
  contentSaving.value = true
  try {
    if (contentForm.id) {
      await updateContentPage(contentForm.id, { title: contentForm.title, content: contentForm.content, status: contentForm.status })
      ElMessage.success('内容页已更新')
    } else {
      await createContentPage(contentForm)
      ElMessage.success('内容页已创建')
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
    ElMessage.warning('请补全文章编码和标题')
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
      ElMessage.success('帮助文章已更新')
    } else {
      await createHelpArticle(helpForm)
      ElMessage.success('帮助文章已创建')
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
        <span>系统配置</span>
        <el-button :icon="'Refresh'" @click="loadData">刷新</el-button>
      </div>
      <el-tabs v-model="activeTab">
        <el-tab-pane label="后台配置" name="configs">
          <div class="table-toolbar">
            <span>配置项</span>
            <el-button type="primary" :icon="'Plus'" @click="openConfigDialog()">新增配置</el-button>
          </div>
          <el-form :inline="true" :model="configQuery" class="filter-form">
            <el-form-item label="关键词"><el-input v-model="configQuery.query" clearable /></el-form-item>
            <el-form-item label="状态">
              <el-select v-model="configQuery.status" clearable style="width: 120px">
                <el-option label="启用" :value="1" />
                <el-option label="停用" :value="0" />
              </el-select>
            </el-form-item>
            <el-form-item label="条数"><el-input-number v-model="configQuery.limit" :min="1" :max="200" /></el-form-item>
            <el-form-item><el-button type="primary" @click="loadData">查询</el-button></el-form-item>
          </el-form>
          <el-table v-loading="loading" :data="systemConfigs" border>
            <el-table-column prop="configKey" label="配置键" min-width="220" />
            <el-table-column prop="configGroup" label="分组" width="120" />
            <el-table-column prop="valueType" label="类型" width="110" />
            <el-table-column prop="visibility" label="可见性" width="110" />
            <el-table-column prop="configValue" label="配置值" min-width="260" show-overflow-tooltip />
            <el-table-column label="状态" width="90"><template #default="{ row }"><el-tag :type="statusTag(row.status)">{{ row.status }}</el-tag></template></el-table-column>
            <el-table-column prop="remark" label="备注" min-width="160" />
            <el-table-column label="操作" width="100" fixed="right">
              <template #default="{ row }"><el-button link type="primary" @click="openConfigDialog(row)">编辑</el-button></template>
            </el-table-column>
          </el-table>
        </el-tab-pane>

        <el-tab-pane label="公共配置" name="public">
          <el-row :gutter="16" class="app-card">
            <el-col :xs="24" :md="8">
              <el-descriptions title="Day 0" :column="1" border>
                <el-descriptions-item label="首笔目标秒">{{ dayOne.firstReceiptTargetSeconds || '-' }}</el-descriptions-item>
                <el-descriptions-item label="首笔 USDT">{{ dayOne.firstReceiptUsdt || '-' }}</el-descriptions-item>
                <el-descriptions-item label="欢迎奖励">{{ dayOne.welcomeBonusAmount || '-' }} {{ dayOne.welcomeBonusAsset || '' }}</el-descriptions-item>
              </el-descriptions>
            </el-col>
            <el-col :xs="24" :md="8">
              <el-descriptions title="功能开关" :column="1" border>
                <el-descriptions-item v-for="(value, key) in features" :key="key" :label="String(key)">{{ value }}</el-descriptions-item>
              </el-descriptions>
            </el-col>
            <el-col :xs="24" :md="8">
              <el-descriptions title="设备池" :column="1" border>
                <el-descriptions-item label="最大激活槽位">{{ fleetConfig.maxActiveSlots || '-' }}</el-descriptions-item>
              </el-descriptions>
            </el-col>
          </el-row>
          <el-row :gutter="16">
            <el-col :xs="24" :md="12"><pre class="json-preview">{{ JSON.stringify(lifecycleConfig, null, 2) }}</pre></el-col>
            <el-col :xs="24" :md="12"><pre class="json-preview">{{ JSON.stringify(tradeinConfig, null, 2) }}</pre></el-col>
          </el-row>
        </el-tab-pane>

        <el-tab-pane label="i18n" name="i18n">
          <div class="table-toolbar">
            <span>多语言消息</span>
            <el-button type="primary" :icon="'Plus'" @click="openI18nDialog()">新增消息</el-button>
          </div>
          <el-form :inline="true" :model="i18nQuery" class="filter-form">
            <el-form-item label="Locale"><el-input v-model="i18nQuery.locale" clearable /></el-form-item>
            <el-form-item label="关键词"><el-input v-model="i18nQuery.query" clearable /></el-form-item>
            <el-form-item label="状态"><el-input v-model="i18nQuery.status" clearable /></el-form-item>
            <el-form-item label="条数"><el-input-number v-model="i18nQuery.limit" :min="1" :max="200" /></el-form-item>
            <el-form-item><el-button type="primary" @click="loadData">查询</el-button></el-form-item>
          </el-form>
          <el-table v-loading="loading" :data="i18nMessages" border>
            <el-table-column prop="messageKey" label="消息键" min-width="220" />
            <el-table-column prop="locale" label="Locale" width="110" />
            <el-table-column prop="messageValue" label="消息值" min-width="260" show-overflow-tooltip />
            <el-table-column prop="status" label="状态" width="90" />
            <el-table-column label="操作" width="100" fixed="right">
              <template #default="{ row }"><el-button link type="primary" @click="openI18nDialog(row)">编辑</el-button></template>
            </el-table-column>
          </el-table>
        </el-tab-pane>

        <el-tab-pane label="内容页" name="content">
          <div class="table-toolbar">
            <span>内容页面</span>
            <el-button type="primary" :icon="'Plus'" @click="openContentDialog()">新增页面</el-button>
          </div>
          <el-form :inline="true" :model="contentQuery" class="filter-form">
            <el-form-item label="关键词"><el-input v-model="contentQuery.query" clearable /></el-form-item>
            <el-form-item label="状态"><el-input v-model="contentQuery.status" clearable /></el-form-item>
            <el-form-item label="条数"><el-input-number v-model="contentQuery.limit" :min="1" :max="200" /></el-form-item>
            <el-form-item><el-button type="primary" @click="loadData">查询</el-button></el-form-item>
          </el-form>
          <el-table v-loading="loading" :data="contentPages" border>
            <el-table-column prop="pageCode" label="页面编码" min-width="180" />
            <el-table-column prop="title" label="标题" min-width="180" />
            <el-table-column prop="status" label="状态" width="90" />
            <el-table-column prop="updatedAt" label="更新时间" min-width="170" />
            <el-table-column label="操作" width="100" fixed="right">
              <template #default="{ row }"><el-button link type="primary" @click="openContentDialog(row)">编辑</el-button></template>
            </el-table-column>
          </el-table>
        </el-tab-pane>

        <el-tab-pane label="帮助中心" name="help">
          <div class="table-toolbar">
            <span>帮助文章</span>
            <el-button type="primary" :icon="'Plus'" @click="openHelpDialog()">新增文章</el-button>
          </div>
          <el-form :inline="true" :model="helpQuery" class="filter-form">
            <el-form-item label="关键词"><el-input v-model="helpQuery.query" clearable /></el-form-item>
            <el-form-item label="状态"><el-input v-model="helpQuery.status" clearable /></el-form-item>
            <el-form-item label="条数"><el-input-number v-model="helpQuery.limit" :min="1" :max="200" /></el-form-item>
            <el-form-item><el-button type="primary" @click="loadData">查询</el-button></el-form-item>
          </el-form>
          <el-table v-loading="loading" :data="helpArticles" border>
            <el-table-column prop="articleCode" label="文章编码" min-width="180" />
            <el-table-column prop="title" label="标题" min-width="180" />
            <el-table-column prop="sortOrder" label="排序" width="90" />
            <el-table-column prop="status" label="状态" width="90" />
            <el-table-column prop="updatedAt" label="更新时间" min-width="170" />
            <el-table-column label="操作" width="100" fixed="right">
              <template #default="{ row }"><el-button link type="primary" @click="openHelpDialog(row)">编辑</el-button></template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
      </el-tabs>
    </el-card>

    <el-card shadow="never">
      <template #header>系统运营聚合</template>
      <pre class="json-preview">{{ JSON.stringify(dashboard, null, 2) }}</pre>
    </el-card>

    <el-dialog v-model="configDialogVisible" :title="configForm.id ? '编辑配置' : '新增配置'" width="720px">
      <el-form :model="configForm" label-width="106px">
        <el-row :gutter="16">
          <el-col :span="12"><el-form-item label="配置键"><el-input v-model="configForm.configKey" :disabled="!!configForm.id" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="分组"><el-input v-model="configForm.configGroup" /></el-form-item></el-col>
          <el-col :span="12">
            <el-form-item label="类型">
              <el-select v-model="configForm.valueType" style="width: 100%">
                <el-option label="STRING" value="STRING" />
                <el-option label="NUMBER" value="NUMBER" />
                <el-option label="BOOLEAN" value="BOOLEAN" />
                <el-option label="JSON" value="JSON" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="可见性">
              <el-select v-model="configForm.visibility" style="width: 100%">
                <el-option label="ADMIN" value="ADMIN" />
                <el-option label="PUBLIC" value="PUBLIC" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12"><el-form-item label="状态"><el-switch v-model="configForm.status" :active-value="1" :inactive-value="0" /></el-form-item></el-col>
          <el-col :span="24"><el-form-item label="配置值"><el-input v-model="configForm.configValue" type="textarea" :rows="5" /></el-form-item></el-col>
          <el-col :span="24"><el-form-item label="备注"><el-input v-model="configForm.remark" /></el-form-item></el-col>
        </el-row>
      </el-form>
      <template #footer>
        <el-button @click="configDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="configSaving" @click="saveConfig">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="i18nDialogVisible" :title="i18nForm.id ? '编辑消息' : '新增消息'" width="620px">
      <el-form :model="i18nForm" label-width="106px">
        <el-form-item label="消息键"><el-input v-model="i18nForm.messageKey" :disabled="!!i18nForm.id" /></el-form-item>
        <el-form-item label="Locale"><el-input v-model="i18nForm.locale" :disabled="!!i18nForm.id" /></el-form-item>
        <el-form-item label="消息值"><el-input v-model="i18nForm.messageValue" type="textarea" :rows="4" /></el-form-item>
        <el-form-item label="状态"><el-switch v-model="i18nForm.status" :active-value="1" :inactive-value="0" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="i18nDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="i18nSaving" @click="saveI18n">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="contentDialogVisible" :title="contentForm.id ? '编辑内容页' : '新增内容页'" width="760px">
      <el-form :model="contentForm" label-width="106px">
        <el-form-item label="页面编码"><el-input v-model="contentForm.pageCode" :disabled="!!contentForm.id" /></el-form-item>
        <el-form-item label="标题"><el-input v-model="contentForm.title" /></el-form-item>
        <el-form-item label="内容"><el-input v-model="contentForm.content" type="textarea" :rows="10" /></el-form-item>
        <el-form-item label="状态"><el-switch v-model="contentForm.status" :active-value="1" :inactive-value="0" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="contentDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="contentSaving" @click="saveContent">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="helpDialogVisible" :title="helpForm.id ? '编辑帮助文章' : '新增帮助文章'" width="760px">
      <el-form :model="helpForm" label-width="106px">
        <el-form-item label="文章编码"><el-input v-model="helpForm.articleCode" :disabled="!!helpForm.id" /></el-form-item>
        <el-form-item label="标题"><el-input v-model="helpForm.title" /></el-form-item>
        <el-form-item label="排序"><el-input-number v-model="helpForm.sortOrder" :min="0" style="width: 100%" /></el-form-item>
        <el-form-item label="内容"><el-input v-model="helpForm.content" type="textarea" :rows="10" /></el-form-item>
        <el-form-item label="状态"><el-switch v-model="helpForm.status" :active-value="1" :inactive-value="0" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="helpDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="helpSaving" @click="saveHelp">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

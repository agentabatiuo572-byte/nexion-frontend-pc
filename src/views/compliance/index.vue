<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import {
  approveKycProfile,
  approveRiskDecision,
  archiveProofAsset,
  createProofAsset,
  expireApprovedKycProfiles,
  expireKycProfile,
  getComplianceOpsStats,
  getKycProfiles,
  getProofAssets,
  getRiskBlacklists,
  getRiskDecisionReview,
  getRiskDecisionSummary,
  getRiskDecisions,
  rejectKycProfile,
  rejectProofAsset,
  rejectRiskDecision,
  releaseRiskBlacklist,
  submitKycProfile,
  upsertRiskBlacklist,
  verifyProofAsset
} from '@/apis/operation'
import { formatNow, formatTableDateTime } from '@/utils/date'
import type { AnyRecord } from '@/types/common'
import { localeText as lt, enumLabel, enumOptions, enumTableFormatter } from '@/utils/i18n'
import UserSelect from '@/components/UserSelect.vue'

const props = withDefaults(defineProps<{ defaultTab?: string }>(), { defaultTab: 'kyc' })

const activeTab = ref(props.defaultTab)
const loading = ref(false)
const actionLoading = ref(false)
const stats = ref<AnyRecord | null>(null)
const riskSummary = ref<AnyRecord | null>(null)
const kycProfiles = ref<AnyRecord[]>([])
const riskDecisions = ref<AnyRecord[]>([])
const reviewDecisions = ref<AnyRecord[]>([])
const blacklists = ref<AnyRecord[]>([])
const proofAssets = ref<AnyRecord[]>([])
const detailVisible = ref(false)
const detailRecord = ref<AnyRecord | null>(null)
const lastComplianceAction = ref('')

const kycQuery = reactive({ userId: '', status: '', limit: 20 })
const riskQuery = reactive({ userId: '', bizType: '', decision: '', reason: '', limit: 20 })
const reviewLimit = ref(20)
const blacklistQuery = reactive({ status: '', limit: 20 })
const proofQuery = reactive({ userId: '', proofType: '', status: '', limit: 20 })

const riskBizTypeOptions = enumOptions(['WITHDRAWAL', 'EXCHANGE', 'GENESIS'])
const riskDecisionOptions = enumOptions(['APPROVE', 'REJECT', 'REVIEW'])
const proofTypeOptions = enumOptions(['COMPUTE_RECEIPT', 'KYC_DOCUMENT', 'WALLET_TRANSACTION', 'WITHDRAWAL', 'GENESIS_ORDER', 'MANUAL_REVIEW'])
const proofStatusFilterOptions = enumOptions(['PENDING', 'VERIFIED', 'REJECTED', 'ARCHIVED'])
const proofCreateStatusOptions = enumOptions(['PENDING', 'VERIFIED', 'REJECTED'])
const kycStatusOptions = enumOptions(['PENDING', 'APPROVED', 'REJECTED', 'EXPIRED'])
const documentTypeOptions = enumOptions(['PASSPORT', 'ID_CARD', 'DRIVER_LICENSE'])
const blacklistStatusOptions = enumOptions(['ACTIVE', 'RELEASED', 'EXPIRED'])
const riskLevelOptions = enumOptions(['LOW', 'MEDIUM', 'HIGH'])
const blacklistSourceOptions = enumOptions(['OPS', 'KYC', 'RISK_RULE', 'CHAIN_RISK', 'MANUAL'])
const relatedBizTypeOptions = enumOptions(['KYC', 'WITHDRAWAL', 'EXCHANGE', 'GENESIS', 'COMPUTE_RECEIPT', 'MANUAL_REVIEW'])

const kycSubmitVisible = ref(false)
const kycSubmitFormRef = ref<FormInstance>()
const kycSubmitForm = reactive({
  userId: undefined as number | undefined,
  kycNo: '',
  country: '',
  applicantName: '',
  documentType: '',
  documentLast4: '',
  documentObjectKey: ''
})
const kycSubmitRules: FormRules = {
  userId: [{ required: true, message: lt('请选择用户', 'Please select a user'), trigger: 'change' }],
  country: [{ required: true, message: lt('请填写国家', 'Please enter country'), trigger: 'blur' }],
  documentType: [{ required: true, message: lt('请填写证件类型', 'Please enter document type'), trigger: 'blur' }],
  documentObjectKey: [{ required: true, message: lt('请填写文档对象键', 'Please enter document object key'), trigger: 'blur' }]
}

const reviewDialogVisible = ref(false)
const reviewFormRef = ref<FormInstance>()
const reviewForm = reactive({
  targetType: 'KYC' as 'KYC' | 'RISK' | 'PROOF',
  action: 'approve',
  targetNo: '',
  userId: undefined as number | undefined,
  reviewer: 'ops-reviewer',
  reason: '',
  expiresAt: ''
})
const reviewRules: FormRules = {
  reviewer: [{ required: true, message: lt('请填写 reviewer', 'Please enter reviewer'), trigger: 'blur' }],
  reason: [{ required: true, message: lt('请填写操作原因', 'Please enter operation reason'), trigger: 'blur' }]
}

const blacklistDialogVisible = ref(false)
const blacklistFormRef = ref<FormInstance>()
const blacklistForm = reactive({
  userId: undefined as number | undefined,
  reason: '',
  source: 'OPS',
  riskLevel: 'HIGH',
  operator: 'ops-risk',
  expiresAt: ''
})
const blacklistRules: FormRules = {
  userId: [{ required: true, message: lt('请选择用户', 'Please select a user'), trigger: 'change' }],
  riskLevel: [{ required: true, message: lt('请填写风险等级', 'Please enter risk level'), trigger: 'blur' }],
  source: [{ required: true, message: lt('请填写来源', 'Please enter source'), trigger: 'blur' }],
  operator: [{ required: true, message: lt('请填写操作人', 'Please enter operator'), trigger: 'blur' }],
  reason: [{ required: true, message: lt('请填写原因', 'Please enter reason'), trigger: 'blur' }]
}

const proofDialogVisible = ref(false)
const proofFormRef = ref<FormInstance>()
const proofForm = reactive({
  userId: undefined as number | undefined,
  proofNo: '',
  proofType: '',
  objectKey: '',
  status: 'PENDING',
  fileName: '',
  contentType: '',
  sizeBytes: 0,
  checksum: '',
  relatedBizType: '',
  relatedBizNo: '',
  submittedBy: 'ops',
  metadataJson: ''
})
const proofRules: FormRules = {
  userId: [{ required: true, message: lt('请选择用户', 'Please select a user'), trigger: 'change' }],
  proofType: [{ required: true, message: lt('请选择 Proof 类型', 'Please select Proof type'), trigger: 'change' }],
  objectKey: [{ required: true, message: lt('请填写对象键', 'Please enter object key'), trigger: 'blur' }]
}

const detailLabels: Record<string, { zh: string; en: string }> = {
  id: { zh: 'ID', en: 'ID' },
  userId: { zh: '用户ID', en: 'User ID' },
  kycNo: { zh: 'KYC 编号', en: 'KYC No.' },
  country: { zh: '国家', en: 'Country' },
  applicantName: { zh: '申请人', en: 'Applicant' },
  documentType: { zh: '证件类型', en: 'Document Type' },
  documentLast4: { zh: '证件 Last4', en: 'Document Last4' },
  documentObjectKey: { zh: '证件对象键', en: 'Document Object Key' },
  decisionNo: { zh: '决策号', en: 'Decision No.' },
  bizType: { zh: '业务类型', en: 'Biz Type' },
  bizNo: { zh: '业务号', en: 'Biz No.' },
  region: { zh: '地区', en: 'Region' },
  userLevel: { zh: '用户等级', en: 'User Level' },
  clientIp: { zh: '客户端 IP', en: 'Client IP' },
  deviceFingerprint: { zh: '设备指纹', en: 'Device Fingerprint' },
  decision: { zh: '决策', en: 'Decision' },
  reason: { zh: '原因', en: 'Reason' },
  riskScore: { zh: '风险分', en: 'Risk Score' },
  ruleCodes: { zh: '规则编码', en: 'Rule Codes' },
  ruleSnapshot: { zh: '规则快照', en: 'Rule Snapshot' },
  proofNo: { zh: 'Proof 编号', en: 'Proof No.' },
  proofType: { zh: 'Proof 类型', en: 'Proof Type' },
  objectKey: { zh: '对象键', en: 'Object Key' },
  status: { zh: '状态', en: 'Status' },
  fileName: { zh: '文件名', en: 'File Name' },
  contentType: { zh: 'Content-Type', en: 'Content-Type' },
  sizeBytes: { zh: '大小字节', en: 'Size Bytes' },
  checksum: { zh: 'Checksum', en: 'Checksum' },
  relatedBizType: { zh: '关联业务类型', en: 'Related Biz Type' },
  relatedBizNo: { zh: '关联业务号', en: 'Related Biz No.' },
  submittedBy: { zh: '提交人', en: 'Submitter' },
  reviewedBy: { zh: '审核人', en: 'Reviewer' },
  reviewedAt: { zh: '审核时间', en: 'Reviewed At' },
  rejectReason: { zh: '拒绝原因', en: 'Reject Reason' },
  reviewNote: { zh: '审核备注', en: 'Review Note' },
  metadataJson: { zh: '元数据', en: 'Metadata' },
  riskLevel: { zh: '风险等级', en: 'Risk Level' },
  source: { zh: '来源', en: 'Source' },
  expiresAt: { zh: '过期时间', en: 'Expires At' },
  releasedBy: { zh: '释放人', en: 'Released By' },
  createdAt: { zh: '创建时间', en: 'Created At' },
  updatedAt: { zh: '更新时间', en: 'Updated At' },
  isDeleted: { zh: '删除状态', en: 'Deleted Status' }
}

const enumDetailKeys = new Set([
  'documentType',
  'bizType',
  'decision',
  'proofType',
  'relatedBizType',
  'status',
  'riskLevel',
  'source'
])

const detailFields = computed(() => {
  if (!detailRecord.value) return []
  return Object.entries(detailRecord.value)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => ({
      key,
      label: detailLabels[key] ? lt(detailLabels[key].zh, detailLabels[key].en) : key,
      value: formatDetailValue(key, value)
    }))
})

function valueOf(record: AnyRecord | null, key: string) {
  const value = key.split('.').reduce<unknown>((current, part) => {
    return current && typeof current === 'object' ? (current as AnyRecord)[part] : undefined
  }, record || undefined)
  return value == null || value === '' ? '-' : String(value)
}

function showDetail(row: AnyRecord) {
  detailRecord.value = row
  detailVisible.value = true
}

function formatDetailValue(key: string, value: unknown) {
  if (value == null || value === '') return '-'
  if (key.endsWith('At') || key.endsWith('Time') || key === 'expiresAt') {
    return formatTableDateTime(null, null, value)
  }
  if (enumDetailKeys.has(key)) {
    return enumLabel(value)
  }
  if (typeof value === 'object') {
    return Object.entries(value as AnyRecord)
      .map(([itemKey, itemValue]) => `${itemKey}: ${String(itemValue)}`)
      .join('；')
  }
  return String(value)
}

function compactParams(params: AnyRecord) {
  return Object.fromEntries(Object.entries(params).filter(([, value]) => value !== '' && value != null))
}

function openKycReview(row: AnyRecord, action: 'approve' | 'reject' | 'expire') {
  Object.assign(reviewForm, {
    targetType: 'KYC',
    action,
    targetNo: '',
    userId: Number(row.userId),
    reviewer: 'ops-kyc',
    reason: '',
    expiresAt: ''
  })
  reviewDialogVisible.value = true
}

function openRiskReview(row: AnyRecord, action: 'approve' | 'reject') {
  Object.assign(reviewForm, {
    targetType: 'RISK',
    action,
    targetNo: String(row.decisionNo || ''),
    userId: row.userId == null ? undefined : Number(row.userId),
    reviewer: 'ops-risk',
    reason: '',
    expiresAt: ''
  })
  reviewDialogVisible.value = true
}

function openProofReview(row: AnyRecord, action: 'verify' | 'reject') {
  Object.assign(reviewForm, {
    targetType: 'PROOF',
    action,
    targetNo: String(row.proofNo || ''),
    userId: row.userId == null ? undefined : Number(row.userId),
    reviewer: 'ops-proof',
    reason: '',
    expiresAt: ''
  })
  reviewDialogVisible.value = true
}

async function submitReview() {
  try {
    await reviewFormRef.value?.validate()
  } catch {
    return
  }
  await ElMessageBox.confirm(
    `${lt('确认提交', 'Confirm submitting')} ${reviewForm.targetType} ${reviewForm.action} ${lt('操作', 'action')}?`,
    lt('合规审核操作', 'Compliance Review Action'),
    { type: reviewForm.action === 'approve' || reviewForm.action === 'verify' ? 'warning' : 'error' }
  )
  actionLoading.value = true
  try {
    if (reviewForm.targetType === 'KYC' && reviewForm.userId) {
      const data = { reviewer: reviewForm.reviewer, reason: reviewForm.reason, expiresAt: reviewForm.expiresAt || undefined }
      if (reviewForm.action === 'approve') await approveKycProfile(reviewForm.userId, data)
      if (reviewForm.action === 'reject') await rejectKycProfile(reviewForm.userId, data)
      if (reviewForm.action === 'expire') await expireKycProfile(reviewForm.userId, data)
      await loadKyc()
    }
    if (reviewForm.targetType === 'RISK' && reviewForm.targetNo) {
      const data = { reviewer: reviewForm.reviewer, reason: reviewForm.reason }
      if (reviewForm.action === 'approve') await approveRiskDecision(reviewForm.targetNo, data)
      if (reviewForm.action === 'reject') await rejectRiskDecision(reviewForm.targetNo, data)
      await Promise.all([loadRisk(), loadReview()])
    }
    if (reviewForm.targetType === 'PROOF' && reviewForm.targetNo) {
      const data = { reviewer: reviewForm.reviewer, reason: reviewForm.reason }
      if (reviewForm.action === 'verify') await verifyProofAsset(reviewForm.targetNo, data)
      if (reviewForm.action === 'reject') await rejectProofAsset(reviewForm.targetNo, data)
      await loadProof()
    }
    ElMessage.success(lt('审核操作已提交', 'Review submitted'))
    lastComplianceAction.value = `审核操作已提交: ${reviewForm.targetType} ${reviewForm.action} ${reviewForm.targetNo || reviewForm.userId}，${formatNow()}`
    reviewDialogVisible.value = false
    await loadStats()
  } finally {
    actionLoading.value = false
  }
}

async function submitKyc() {
  try {
    await kycSubmitFormRef.value?.validate()
  } catch {
    return
  }
  actionLoading.value = true
  try {
    await submitKycProfile(kycSubmitForm)
    ElMessage.success(lt('KYC 已提交', 'KYC submitted'))
    lastComplianceAction.value = `KYC 已提交: userId=${kycSubmitForm.userId}，${formatNow()}`
    kycSubmitVisible.value = false
    await loadKyc()
  } finally {
    actionLoading.value = false
  }
}

async function runExpireApproved() {
  await ElMessageBox.confirm('确认执行已审批 KYC 过期维护?', lt('KYC 维护', 'KYC Maintenance'), { type: 'warning' })
  actionLoading.value = true
  try {
    const result = await expireApprovedKycProfiles(50, 'ops-kyc-expiry')
    const count = result?.processed ?? result?.expired ?? result?.count ?? result?.total ?? '-'
    ElMessage.success(lt('KYC 过期维护完成', 'KYC expiration maintenance completed'))
    lastComplianceAction.value = `KYC 过期维护完成: ${count} 条，${formatNow()}`
    await loadKyc()
  } finally {
    actionLoading.value = false
  }
}

async function submitBlacklist() {
  try {
    await blacklistFormRef.value?.validate()
  } catch {
    return
  }
  await ElMessageBox.confirm(`确认新增/激活黑名单用户 ${blacklistForm.userId}?`, lt('黑名单操作', 'Blacklist Operation'), { type: 'error' })
  actionLoading.value = true
  try {
    await upsertRiskBlacklist({ ...blacklistForm, expiresAt: blacklistForm.expiresAt || undefined })
    ElMessage.success(lt('黑名单已保存', 'Blacklist saved'))
    lastComplianceAction.value = `黑名单已保存: userId=${blacklistForm.userId}，${formatNow()}`
    blacklistDialogVisible.value = false
    await loadBlacklists()
  } finally {
    actionLoading.value = false
  }
}

async function runReleaseBlacklist(row: AnyRecord) {
  const userId = row.userId
  if (!userId) return
  const { value } = await ElMessageBox.prompt(`${lt('确认释放黑名单用户', 'Confirm releasing blacklisted user')} ${userId}?`, lt('释放原因', 'Release Reason'), {
    inputType: 'textarea',
    inputPlaceholder: lt('请输入释放原因', 'Please enter release reason'),
    inputValidator: (input) => !!input || lt('释放原因必填', 'Release reason is required')
  })
  actionLoading.value = true
  try {
    await releaseRiskBlacklist(String(userId), { operator: 'ops-risk', reason: value })
    ElMessage.success(lt('黑名单已释放', 'Blacklist released'))
    lastComplianceAction.value = `${lt('黑名单已释放', 'Blacklist released')}: userId=${userId}, ${formatNow()}`
    await loadBlacklists()
  } finally {
    actionLoading.value = false
  }
}

async function submitProof() {
  try {
    await proofFormRef.value?.validate()
  } catch {
    return
  }
  if (proofForm.metadataJson) {
    try {
      JSON.parse(proofForm.metadataJson)
    } catch {
      ElMessage.warning(lt('Metadata JSON 不是合法 JSON', 'Metadata JSON is invalid'))
      return
    }
  }
  actionLoading.value = true
  try {
    await createProofAsset(proofForm)
    ElMessage.success(lt('Proof 资产已创建', 'Proof asset created'))
    lastComplianceAction.value = `Proof 资产已创建: ${proofForm.proofNo || proofForm.objectKey}，${formatNow()}`
    proofDialogVisible.value = false
    await loadProof()
  } finally {
    actionLoading.value = false
  }
}

async function runArchiveProof(row: AnyRecord) {
  const proofNo = String(row.proofNo || '')
  if (!proofNo) return
  await ElMessageBox.confirm(`确认归档 Proof ${proofNo}?`, lt('Proof 归档', 'Proof Archive'), { type: 'warning' })
  actionLoading.value = true
  try {
    await archiveProofAsset(proofNo)
    ElMessage.success(lt('Proof 已归档', 'Proof archived'))
    lastComplianceAction.value = `Proof 已归档: ${proofNo}，${formatNow()}`
    await loadProof()
  } finally {
    actionLoading.value = false
  }
}

async function loadStats() {
  const [statsRes, summaryRes] = await Promise.allSettled([
    getComplianceOpsStats(7, { silentError: true }),
    getRiskDecisionSummary(7, { silentError: true })
  ])
  stats.value = statsRes.status === 'fulfilled' ? statsRes.value : null
  riskSummary.value = summaryRes.status === 'fulfilled' ? summaryRes.value : null
}

async function loadKyc() {
  kycProfiles.value = await getKycProfiles(compactParams(kycQuery), { silentError: true }).catch(() => [])
}

async function loadRisk() {
  riskDecisions.value = await getRiskDecisions(compactParams(riskQuery), { silentError: true }).catch(() => [])
}

async function loadReview() {
  reviewDecisions.value = await getRiskDecisionReview(reviewLimit.value, { silentError: true }).catch(() => [])
}

async function loadBlacklists() {
  blacklists.value = await getRiskBlacklists(compactParams(blacklistQuery), { silentError: true }).catch(() => [])
}

async function loadProof() {
  proofAssets.value = await getProofAssets(compactParams(proofQuery), { silentError: true }).catch(() => [])
}

async function loadActiveTab() {
  if (activeTab.value === 'kyc') await loadKyc()
  if (activeTab.value === 'risk') await loadRisk()
  if (activeTab.value === 'review') await loadReview()
  if (activeTab.value === 'blacklists') await loadBlacklists()
  if (activeTab.value === 'proof') await loadProof()
}

async function loadData() {
  loading.value = true
  try {
    await Promise.all([loadStats(), loadActiveTab()])
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
    <el-row :gutter="16" class="app-card">
      <el-col :xs="24" :sm="12" :md="6">
        <el-card shadow="never" class="stat-card">
          <div class="table-toolbar"><span>KYC</span><el-icon color="#409eff" :size="24"><Checked /></el-icon></div>
          <div class="value">{{ valueOf(stats, 'kyc.total') }}</div>
        </el-card>
      </el-col>
      <el-col :xs="24" :sm="12" :md="6">
        <el-card shadow="never" class="stat-card">
          <div class="table-toolbar"><span>{{ lt('待复核', 'Pending Review') }}</span><el-icon color="#e6a23c" :size="24"><Warning /></el-icon></div>
          <div class="value">{{ valueOf(stats, 'risk.reviewQueue') }}</div>
        </el-card>
      </el-col>
      <el-col :xs="24" :sm="12" :md="6">
        <el-card shadow="never" class="stat-card">
          <div class="table-toolbar"><span>{{ lt('黑名单', 'Blacklist') }}</span><el-icon color="#f56c6c" :size="24"><CircleClose /></el-icon></div>
          <div class="value">{{ valueOf(riskSummary, 'activeBlacklists') }}</div>
        </el-card>
      </el-col>
      <el-col :xs="24" :sm="12" :md="6">
        <el-card shadow="never" class="stat-card">
          <div class="table-toolbar"><span>{{ lt('风险决策', 'Risk Decisions') }}</span><el-icon color="#67c23a" :size="24"><DataAnalysis /></el-icon></div>
          <div class="value">{{ valueOf(riskSummary, 'totalDecisions') }}</div>
        </el-card>
      </el-col>
    </el-row>

    <el-card shadow="never">
      <div class="table-toolbar">
        <span>{{ lt('合规风控', 'Compliance Ops') }}</span>
        <el-button :icon="'Refresh'" @click="loadData">{{ lt('刷新', 'Refresh') }}</el-button>
      </div>
      <el-alert v-if="lastComplianceAction" :title="lastComplianceAction" type="success" show-icon :closable="false" class="operation-alert" />

      <el-tabs v-model="activeTab">
        <el-tab-pane label="KYC" name="kyc">
          <div class="table-toolbar">
            <span>KYC Profile</span>
            <div>
              <el-button :loading="actionLoading" @click="runExpireApproved">{{ lt('过期维护', 'Expire Maintenance') }}</el-button>
              <el-button type="primary" :icon="'Plus'" @click="kycSubmitVisible = true">{{ lt('提交 KYC', 'Submit KYC') }}</el-button>
            </div>
          </div>
          <el-form :inline="true" :model="kycQuery" class="filter-form">
            <el-form-item :label="lt('用户', 'User')"><UserSelect v-model="kycQuery.userId" /></el-form-item>
            <el-form-item :label="lt('状态', 'Status')">
              <el-select v-model="kycQuery.status" clearable :placeholder="lt('请选择状态', 'Select status')" style="width: 130px">
                <el-option v-for="item in kycStatusOptions" :key="item.value" :label="item.label" :value="item.value" />
              </el-select>
            </el-form-item>
            <el-form-item :label="lt('条数', 'Limit')"><el-input-number v-model="kycQuery.limit" :min="1" :max="200" /></el-form-item>
            <el-form-item><el-button type="primary" @click="loadData">{{ lt('查询', 'Search') }}</el-button></el-form-item>
          </el-form>
          <el-table v-loading="loading" :data="kycProfiles" border>
            <el-table-column prop="kycNo" :label="lt('KYC 编号', 'KYC No.')" min-width="170" />
            <el-table-column prop="userId" :label="lt('用户ID', 'User ID')" width="100" />
            <el-table-column prop="country" :label="lt('国家', 'Country')" width="100" />
            <el-table-column prop="documentType" :label="lt('证件类型', 'Document Type')" width="120" :formatter="enumTableFormatter" />
            <el-table-column prop="documentLast4" label="Last4" width="100" />
            <el-table-column prop="status" :label="lt('状态', 'Status')" width="120" :formatter="enumTableFormatter" />
            <el-table-column prop="reviewedBy" :label="lt('审核人', 'Reviewer')" width="130" />
            <el-table-column prop="expiresAt" :label="lt('过期时间', 'Expires At')" min-width="170" :formatter="formatTableDateTime" />
            <el-table-column :label="lt('操作', 'Actions')" width="250" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" @click="showDetail(row)">{{ lt('详情', 'Details') }}</el-button>
                <el-button link type="success" @click="openKycReview(row, 'approve')">{{ lt('通过', 'Approve') }}</el-button>
                <el-button link type="warning" @click="openKycReview(row, 'reject')">{{ lt('拒绝', 'Reject') }}</el-button>
                <el-button link type="danger" @click="openKycReview(row, 'expire')">{{ lt('过期', 'Expire') }}</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>

        <el-tab-pane :label="lt('风险决策', 'Risk Decisions')" name="risk">
          <el-form :inline="true" :model="riskQuery" class="filter-form">
            <el-form-item :label="lt('用户', 'User')"><UserSelect v-model="riskQuery.userId" /></el-form-item>
            <el-form-item :label="lt('业务类型', 'Biz Type')">
              <el-select v-model="riskQuery.bizType" clearable :placeholder="lt('请选择业务类型', 'Select biz type')" style="width: 150px">
                <el-option v-for="item in riskBizTypeOptions" :key="item.value" :label="item.label" :value="item.value" />
              </el-select>
            </el-form-item>
            <el-form-item :label="lt('决策', 'Decision')">
              <el-select v-model="riskQuery.decision" clearable :placeholder="lt('请选择决策', 'Select decision')" style="width: 130px">
                <el-option v-for="item in riskDecisionOptions" :key="item.value" :label="item.label" :value="item.value" />
              </el-select>
            </el-form-item>
            <el-form-item :label="lt('原因', 'Reason')"><el-input v-model="riskQuery.reason" clearable /></el-form-item>
            <el-form-item :label="lt('条数', 'Limit')"><el-input-number v-model="riskQuery.limit" :min="1" :max="200" /></el-form-item>
            <el-form-item><el-button type="primary" @click="loadData">{{ lt('查询', 'Search') }}</el-button></el-form-item>
          </el-form>
          <el-table v-loading="loading" :data="riskDecisions" border>
            <el-table-column prop="decisionNo" :label="lt('决策号', 'Decision No.')" min-width="170" />
            <el-table-column prop="userId" :label="lt('用户ID', 'User ID')" width="100" />
            <el-table-column prop="bizType" :label="lt('业务类型', 'Biz Type')" width="130" :formatter="enumTableFormatter" />
            <el-table-column prop="bizNo" :label="lt('业务号', 'Biz No.')" min-width="170" />
            <el-table-column prop="decision" :label="lt('决策', 'Decision')" width="110" :formatter="enumTableFormatter" />
            <el-table-column prop="riskScore" :label="lt('分数', 'Score')" width="90" />
            <el-table-column prop="reason" :label="lt('原因', 'Reason')" min-width="180" />
            <el-table-column prop="createdAt" :label="lt('创建时间', 'Created At')" min-width="170" :formatter="formatTableDateTime" />
            <el-table-column :label="lt('操作', 'Actions')" width="190" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" @click="showDetail(row)">{{ lt('详情', 'Details') }}</el-button>
                <el-button link type="success" @click="openRiskReview(row, 'approve')">{{ lt('通过', 'Approve') }}</el-button>
                <el-button link type="danger" @click="openRiskReview(row, 'reject')">{{ lt('拒绝', 'Reject') }}</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>

        <el-tab-pane :label="lt('人工复核', 'Manual Review')" name="review">
          <div class="table-toolbar">
            <span>{{ lt('待人工复核风险决策', 'Pending Manual Risk Decisions') }}</span>
            <div>
              <el-input-number v-model="reviewLimit" :min="1" :max="200" style="width: 118px; margin-right: 10px" />
              <el-button type="primary" @click="loadData">{{ lt('查询', 'Search') }}</el-button>
            </div>
          </div>
          <el-table v-loading="loading" :data="reviewDecisions" border>
            <el-table-column prop="decisionNo" :label="lt('决策号', 'Decision No.')" min-width="170" />
            <el-table-column prop="userId" :label="lt('用户ID', 'User ID')" width="100" />
            <el-table-column prop="bizType" :label="lt('业务类型', 'Biz Type')" width="130" :formatter="enumTableFormatter" />
            <el-table-column prop="bizNo" :label="lt('业务号', 'Biz No.')" min-width="170" />
            <el-table-column prop="asset" :label="lt('资产', 'Asset')" width="90" />
            <el-table-column prop="amount" :label="lt('金额', 'Amount')" width="120" />
            <el-table-column prop="riskScore" :label="lt('分数', 'Score')" width="90" />
            <el-table-column prop="ruleCodes" :label="lt('规则', 'Rules')" min-width="180" />
            <el-table-column :label="lt('操作', 'Actions')" width="190" fixed="right">
              <template #default="{ row }">
                <el-button link type="success" @click="openRiskReview(row, 'approve')">{{ lt('通过', 'Approve') }}</el-button>
                <el-button link type="danger" @click="openRiskReview(row, 'reject')">{{ lt('拒绝', 'Reject') }}</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>

        <el-tab-pane :label="lt('黑名单', 'Blacklist')" name="blacklists">
          <div class="table-toolbar">
            <span>{{ lt('风险黑名单', 'Risk Blacklist') }}</span>
            <el-button type="primary" :icon="'Plus'" @click="blacklistDialogVisible = true">{{ lt('新增/激活', 'Add / Activate') }}</el-button>
          </div>
          <el-form :inline="true" :model="blacklistQuery" class="filter-form">
            <el-form-item :label="lt('状态', 'Status')">
              <el-select v-model="blacklistQuery.status" clearable :placeholder="lt('请选择状态', 'Select status')" style="width: 130px">
                <el-option v-for="item in blacklistStatusOptions" :key="item.value" :label="item.label" :value="item.value" />
              </el-select>
            </el-form-item>
            <el-form-item :label="lt('条数', 'Limit')"><el-input-number v-model="blacklistQuery.limit" :min="1" :max="200" /></el-form-item>
            <el-form-item><el-button type="primary" @click="loadData">{{ lt('查询', 'Search') }}</el-button></el-form-item>
          </el-form>
          <el-table v-loading="loading" :data="blacklists" border>
            <el-table-column prop="userId" :label="lt('用户ID', 'User ID')" width="100" />
            <el-table-column prop="status" :label="lt('状态', 'Status')" width="110" :formatter="enumTableFormatter" />
            <el-table-column prop="riskLevel" :label="lt('风险等级', 'Risk Level')" width="120" :formatter="enumTableFormatter" />
            <el-table-column prop="source" :label="lt('来源', 'Source')" width="120" />
            <el-table-column prop="reason" :label="lt('原因', 'Reason')" min-width="220" />
            <el-table-column prop="expiresAt" :label="lt('过期时间', 'Expires At')" min-width="170" :formatter="formatTableDateTime" />
            <el-table-column prop="releasedBy" :label="lt('释放人', 'Released By')" width="130" />
            <el-table-column :label="lt('操作', 'Actions')" width="140" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" @click="showDetail(row)">{{ lt('详情', 'Details') }}</el-button>
                <el-button link type="warning" @click="runReleaseBlacklist(row)">{{ lt('释放', 'Release') }}</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>

        <el-tab-pane :label="lt('Proof 资产', 'Proof Assets')" name="proof">
          <div class="table-toolbar">
            <span>Proof Evidence</span>
            <el-button type="primary" :icon="'Plus'" @click="proofDialogVisible = true">{{ lt('新增 Proof', 'New Proof') }}</el-button>
          </div>
          <el-form :inline="true" :model="proofQuery" class="filter-form">
            <el-form-item :label="lt('用户', 'User')"><UserSelect v-model="proofQuery.userId" /></el-form-item>
            <el-form-item :label="lt('类型', 'Type')">
              <el-select v-model="proofQuery.proofType" clearable :placeholder="lt('请选择 Proof 类型', 'Select Proof type')" style="width: 180px">
                <el-option v-for="item in proofTypeOptions" :key="item.value" :label="item.label" :value="item.value" />
              </el-select>
            </el-form-item>
            <el-form-item :label="lt('状态', 'Status')">
              <el-select v-model="proofQuery.status" clearable :placeholder="lt('请选择状态', 'Select status')" style="width: 130px">
                <el-option v-for="item in proofStatusFilterOptions" :key="item.value" :label="item.label" :value="item.value" />
              </el-select>
            </el-form-item>
            <el-form-item :label="lt('条数', 'Limit')"><el-input-number v-model="proofQuery.limit" :min="1" :max="200" /></el-form-item>
            <el-form-item><el-button type="primary" @click="loadData">{{ lt('查询', 'Search') }}</el-button></el-form-item>
          </el-form>
          <el-table v-loading="loading" :data="proofAssets" border>
            <el-table-column prop="proofNo" :label="lt('Proof 编号', 'Proof No.')" min-width="170" />
            <el-table-column prop="userId" :label="lt('用户ID', 'User ID')" width="100" />
            <el-table-column prop="proofType" :label="lt('类型', 'Type')" width="130" :formatter="enumTableFormatter" />
            <el-table-column prop="status" :label="lt('状态', 'Status')" width="110" :formatter="enumTableFormatter" />
            <el-table-column prop="objectKey" :label="lt('对象键', 'Object Key')" min-width="220" />
            <el-table-column prop="relatedBizNo" :label="lt('关联业务号', 'Related Biz No.')" min-width="160" />
            <el-table-column prop="reviewedBy" :label="lt('审核人', 'Reviewer')" width="130" />
            <el-table-column :label="lt('操作', 'Actions')" width="250" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" @click="showDetail(row)">{{ lt('详情', 'Details') }}</el-button>
                <el-button link type="success" @click="openProofReview(row, 'verify')">{{ lt('验证', 'Verify') }}</el-button>
                <el-button link type="warning" @click="openProofReview(row, 'reject')">{{ lt('拒绝', 'Reject') }}</el-button>
                <el-button link type="danger" @click="runArchiveProof(row)">{{ lt('归档', 'Archive') }}</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
      </el-tabs>
    </el-card>

    <el-dialog v-model="kycSubmitVisible" :title="lt('提交 KYC Profile', 'Submit KYC Profile')" width="660px">
      <el-form ref="kycSubmitFormRef" :model="kycSubmitForm" :rules="kycSubmitRules" label-width="128px">
        <el-form-item :label="lt('用户', 'User')" prop="userId"><UserSelect v-model="kycSubmitForm.userId" width="100%" /></el-form-item>
        <el-form-item :label="lt('KYC 编号', 'KYC No.')"><el-input v-model="kycSubmitForm.kycNo" /></el-form-item>
        <el-form-item :label="lt('国家', 'Country')" prop="country"><el-input v-model="kycSubmitForm.country" /></el-form-item>
        <el-form-item :label="lt('申请人', 'Applicant')"><el-input v-model="kycSubmitForm.applicantName" /></el-form-item>
        <el-form-item :label="lt('证件类型', 'Document Type')" prop="documentType">
          <el-select v-model="kycSubmitForm.documentType" :placeholder="lt('请选择证件类型', 'Select document type')" style="width: 100%">
            <el-option v-for="item in documentTypeOptions" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
        </el-form-item>
        <el-form-item :label="lt('证件 Last4', 'Document Last4')"><el-input v-model="kycSubmitForm.documentLast4" /></el-form-item>
        <el-form-item :label="lt('文档对象键', 'Document Object Key')" prop="documentObjectKey"><el-input v-model="kycSubmitForm.documentObjectKey" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="kycSubmitVisible = false">{{ lt('取消', 'Cancel') }}</el-button>
        <el-button type="primary" :loading="actionLoading" @click="submitKyc">{{ lt('提交', 'Submit') }}</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="reviewDialogVisible" :title="lt('审核操作', 'Review Action')" width="620px">
      <el-form ref="reviewFormRef" :model="reviewForm" :rules="reviewRules" label-width="110px">
        <el-form-item :label="lt('对象', 'Object')"><el-input :model-value="reviewForm.targetNo || reviewForm.userId" disabled /></el-form-item>
        <el-form-item :label="lt('操作', 'Actions')"><el-input :model-value="enumLabel(reviewForm.action)" disabled /></el-form-item>
        <el-form-item label="Reviewer" prop="reviewer"><el-input v-model="reviewForm.reviewer" /></el-form-item>
        <el-form-item v-if="reviewForm.targetType === 'KYC' && reviewForm.action === 'approve'" :label="lt('过期时间', 'Expires At')">
          <el-date-picker v-model="reviewForm.expiresAt" type="datetime" format="YYYY-MM-DD HH:mm:ss" value-format="YYYY-MM-DD HH:mm:ss" style="width: 100%" />
        </el-form-item>
        <el-form-item :label="lt('原因', 'Reason')" prop="reason"><el-input v-model="reviewForm.reason" type="textarea" :rows="3" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="reviewDialogVisible = false">{{ lt('取消', 'Cancel') }}</el-button>
        <el-button type="primary" :loading="actionLoading" @click="submitReview">{{ lt('提交', 'Submit') }}</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="blacklistDialogVisible" :title="lt('新增/激活黑名单', 'Add / Activate Blacklist')" width="620px">
      <el-form ref="blacklistFormRef" :model="blacklistForm" :rules="blacklistRules" label-width="110px">
        <el-form-item :label="lt('用户', 'User')" prop="userId"><UserSelect v-model="blacklistForm.userId" width="100%" /></el-form-item>
        <el-form-item :label="lt('风险等级', 'Risk Level')" prop="riskLevel">
          <el-select v-model="blacklistForm.riskLevel" :placeholder="lt('请选择风险等级', 'Select risk level')" style="width: 100%">
            <el-option v-for="item in riskLevelOptions" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
        </el-form-item>
        <el-form-item :label="lt('来源', 'Source')" prop="source">
          <el-select v-model="blacklistForm.source" :placeholder="lt('请选择来源', 'Select source')" style="width: 100%">
            <el-option v-for="item in blacklistSourceOptions" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
        </el-form-item>
        <el-form-item :label="lt('操作人', 'Operator')" prop="operator"><el-input v-model="blacklistForm.operator" /></el-form-item>
        <el-form-item :label="lt('过期时间', 'Expires At')"><el-date-picker v-model="blacklistForm.expiresAt" type="datetime" format="YYYY-MM-DD HH:mm:ss" value-format="YYYY-MM-DD HH:mm:ss" style="width: 100%" /></el-form-item>
        <el-form-item :label="lt('原因', 'Reason')" prop="reason"><el-input v-model="blacklistForm.reason" type="textarea" :rows="3" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="blacklistDialogVisible = false">{{ lt('取消', 'Cancel') }}</el-button>
        <el-button type="primary" :loading="actionLoading" @click="submitBlacklist">{{ lt('保存', 'Save') }}</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="proofDialogVisible" :title="lt('新增 Proof 资产', 'New Proof Asset')" width="680px">
      <el-form ref="proofFormRef" :model="proofForm" :rules="proofRules" label-width="128px">
        <el-form-item :label="lt('用户', 'User')" prop="userId"><UserSelect v-model="proofForm.userId" width="100%" /></el-form-item>
        <el-form-item :label="lt('Proof 类型', 'Proof Type')" prop="proofType">
          <el-select v-model="proofForm.proofType" :placeholder="lt('请选择 Proof 类型', 'Select Proof type')" style="width: 100%">
            <el-option v-for="item in proofTypeOptions" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
        </el-form-item>
        <el-form-item :label="lt('对象键', 'Object Key')" prop="objectKey"><el-input v-model="proofForm.objectKey" /></el-form-item>
        <el-form-item :label="lt('状态', 'Status')">
          <el-select v-model="proofForm.status" :placeholder="lt('请选择状态', 'Select status')" style="width: 100%">
            <el-option v-for="item in proofCreateStatusOptions" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
        </el-form-item>
        <el-form-item :label="lt('文件名', 'File Name')"><el-input v-model="proofForm.fileName" /></el-form-item>
        <el-form-item label="Content-Type"><el-input v-model="proofForm.contentType" /></el-form-item>
        <el-form-item :label="lt('大小字节', 'Size Bytes')"><el-input-number v-model="proofForm.sizeBytes" :min="0" style="width: 100%" /></el-form-item>
        <el-form-item label="Checksum"><el-input v-model="proofForm.checksum" /></el-form-item>
        <el-form-item :label="lt('关联业务类型', 'Related Biz Type')">
          <el-select v-model="proofForm.relatedBizType" clearable :placeholder="lt('请选择关联业务类型', 'Select related biz type')" style="width: 100%">
            <el-option v-for="item in relatedBizTypeOptions" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
        </el-form-item>
        <el-form-item :label="lt('关联业务号', 'Related Biz No.')"><el-input v-model="proofForm.relatedBizNo" /></el-form-item>
        <el-form-item :label="lt('提交人', 'Submitter')"><el-input v-model="proofForm.submittedBy" /></el-form-item>
        <el-form-item label="Metadata JSON"><el-input v-model="proofForm.metadataJson" type="textarea" :rows="3" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="proofDialogVisible = false">{{ lt('取消', 'Cancel') }}</el-button>
        <el-button type="primary" :loading="actionLoading" @click="submitProof">{{ lt('保存', 'Save') }}</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="detailVisible" :title="lt('详情', 'Details')" width="760px">
      <el-descriptions v-if="detailFields.length" :column="2" border>
        <el-descriptions-item v-for="item in detailFields" :key="item.key" :label="item.label">
          <span class="detail-value">{{ item.value }}</span>
        </el-descriptions-item>
      </el-descriptions>
      <el-empty v-else :description="lt('暂无详情', 'No details')" />
    </el-dialog>
  </div>
</template>

<style scoped>
.detail-value {
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
</style>

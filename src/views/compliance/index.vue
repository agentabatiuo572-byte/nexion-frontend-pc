<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
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
import type { AnyRecord } from '@/types/common'

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

const kycQuery = reactive({ userId: '', status: '', limit: 20 })
const riskQuery = reactive({ userId: '', bizType: '', decision: '', reason: '', limit: 20 })
const reviewLimit = ref(20)
const blacklistQuery = reactive({ status: '', limit: 20 })
const proofQuery = reactive({ userId: '', proofType: '', status: '', limit: 20 })

const kycSubmitVisible = ref(false)
const kycSubmitForm = reactive({
  userId: undefined as number | undefined,
  kycNo: '',
  country: '',
  applicantName: '',
  documentType: '',
  documentLast4: '',
  documentObjectKey: ''
})

const reviewDialogVisible = ref(false)
const reviewForm = reactive({
  targetType: 'KYC' as 'KYC' | 'RISK' | 'PROOF',
  action: 'approve',
  targetNo: '',
  userId: undefined as number | undefined,
  reviewer: 'ops-reviewer',
  reason: '',
  expiresAt: ''
})

const blacklistDialogVisible = ref(false)
const blacklistForm = reactive({
  userId: undefined as number | undefined,
  reason: '',
  source: 'OPS',
  riskLevel: 'HIGH',
  operator: 'ops-risk',
  expiresAt: ''
})

const proofDialogVisible = ref(false)
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

function valueOf(record: AnyRecord | null, key: string) {
  const value = record?.[key]
  return value == null || value === '' ? '-' : String(value)
}

function showDetail(row: AnyRecord) {
  detailRecord.value = row
  detailVisible.value = true
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
  if (!reviewForm.reason || !reviewForm.reviewer) {
    ElMessage.warning('请填写 reviewer 和 reason')
    return
  }
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
    ElMessage.success('审核操作已提交')
    reviewDialogVisible.value = false
    await loadStats()
  } finally {
    actionLoading.value = false
  }
}

async function submitKyc() {
  if (!kycSubmitForm.userId || !kycSubmitForm.country || !kycSubmitForm.documentType || !kycSubmitForm.documentObjectKey) {
    ElMessage.warning('请补全用户、国家、证件类型和对象键')
    return
  }
  actionLoading.value = true
  try {
    await submitKycProfile(kycSubmitForm)
    ElMessage.success('KYC 已提交')
    kycSubmitVisible.value = false
    await loadKyc()
  } finally {
    actionLoading.value = false
  }
}

async function runExpireApproved() {
  await ElMessageBox.confirm('确认执行已审批 KYC 过期维护?', 'KYC 维护', { type: 'warning' })
  actionLoading.value = true
  try {
    const result = await expireApprovedKycProfiles(50, 'ops-kyc-expiry')
    ElMessage.success(`维护完成: ${JSON.stringify(result)}`)
    await loadKyc()
  } finally {
    actionLoading.value = false
  }
}

async function submitBlacklist() {
  if (!blacklistForm.userId || !blacklistForm.reason || !blacklistForm.operator) {
    ElMessage.warning('请补全用户、原因和操作人')
    return
  }
  actionLoading.value = true
  try {
    await upsertRiskBlacklist({ ...blacklistForm, expiresAt: blacklistForm.expiresAt || undefined })
    ElMessage.success('黑名单已保存')
    blacklistDialogVisible.value = false
    await loadBlacklists()
  } finally {
    actionLoading.value = false
  }
}

async function runReleaseBlacklist(row: AnyRecord) {
  const userId = row.userId
  if (!userId) return
  const { value } = await ElMessageBox.prompt(`确认释放黑名单用户 ${userId}?`, '释放原因', {
    inputType: 'textarea',
    inputPlaceholder: '请输入释放原因',
    inputValidator: (input) => !!input || '释放原因必填'
  })
  actionLoading.value = true
  try {
    await releaseRiskBlacklist(String(userId), { operator: 'ops-risk', reason: value })
    ElMessage.success('黑名单已释放')
    await loadBlacklists()
  } finally {
    actionLoading.value = false
  }
}

async function submitProof() {
  if (!proofForm.userId || !proofForm.proofType || !proofForm.objectKey) {
    ElMessage.warning('请补全用户、Proof 类型和对象键')
    return
  }
  actionLoading.value = true
  try {
    await createProofAsset(proofForm)
    ElMessage.success('Proof 资产已创建')
    proofDialogVisible.value = false
    await loadProof()
  } finally {
    actionLoading.value = false
  }
}

async function runArchiveProof(row: AnyRecord) {
  const proofNo = String(row.proofNo || '')
  if (!proofNo) return
  await ElMessageBox.confirm(`确认归档 Proof ${proofNo}?`, 'Proof 归档', { type: 'warning' })
  actionLoading.value = true
  try {
    await archiveProofAsset(proofNo)
    ElMessage.success('Proof 已归档')
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
          <div class="value">{{ valueOf(stats, 'kycProfiles') }}</div>
        </el-card>
      </el-col>
      <el-col :xs="24" :sm="12" :md="6">
        <el-card shadow="never" class="stat-card">
          <div class="table-toolbar"><span>待复核</span><el-icon color="#e6a23c" :size="24"><Warning /></el-icon></div>
          <div class="value">{{ valueOf(stats, 'manualReviews') }}</div>
        </el-card>
      </el-col>
      <el-col :xs="24" :sm="12" :md="6">
        <el-card shadow="never" class="stat-card">
          <div class="table-toolbar"><span>黑名单</span><el-icon color="#f56c6c" :size="24"><CircleClose /></el-icon></div>
          <div class="value">{{ valueOf(riskSummary, 'activeBlacklists') }}</div>
        </el-card>
      </el-col>
      <el-col :xs="24" :sm="12" :md="6">
        <el-card shadow="never" class="stat-card">
          <div class="table-toolbar"><span>风险决策</span><el-icon color="#67c23a" :size="24"><DataAnalysis /></el-icon></div>
          <div class="value">{{ valueOf(riskSummary, 'total') }}</div>
        </el-card>
      </el-col>
    </el-row>

    <el-card shadow="never">
      <div class="table-toolbar">
        <span>合规风控</span>
        <el-button :icon="'Refresh'" @click="loadData">刷新</el-button>
      </div>

      <el-tabs v-model="activeTab">
        <el-tab-pane label="KYC" name="kyc">
          <div class="table-toolbar">
            <span>KYC Profile</span>
            <div>
              <el-button :loading="actionLoading" @click="runExpireApproved">过期维护</el-button>
              <el-button type="primary" :icon="'Plus'" @click="kycSubmitVisible = true">提交 KYC</el-button>
            </div>
          </div>
          <el-form :inline="true" :model="kycQuery" class="filter-form">
            <el-form-item label="用户ID"><el-input v-model="kycQuery.userId" clearable /></el-form-item>
            <el-form-item label="状态"><el-input v-model="kycQuery.status" clearable /></el-form-item>
            <el-form-item label="条数"><el-input-number v-model="kycQuery.limit" :min="1" :max="200" /></el-form-item>
            <el-form-item><el-button type="primary" @click="loadData">查询</el-button></el-form-item>
          </el-form>
          <el-table v-loading="loading" :data="kycProfiles" border>
            <el-table-column prop="kycNo" label="KYC 编号" min-width="170" />
            <el-table-column prop="userId" label="用户ID" width="100" />
            <el-table-column prop="country" label="国家" width="100" />
            <el-table-column prop="documentType" label="证件类型" width="120" />
            <el-table-column prop="documentLast4" label="Last4" width="100" />
            <el-table-column prop="status" label="状态" width="120" />
            <el-table-column prop="reviewedBy" label="审核人" width="130" />
            <el-table-column prop="expiresAt" label="过期时间" min-width="170" />
            <el-table-column label="操作" width="250" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" @click="showDetail(row)">详情</el-button>
                <el-button link type="success" @click="openKycReview(row, 'approve')">通过</el-button>
                <el-button link type="warning" @click="openKycReview(row, 'reject')">拒绝</el-button>
                <el-button link type="danger" @click="openKycReview(row, 'expire')">过期</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>

        <el-tab-pane label="风险决策" name="risk">
          <el-form :inline="true" :model="riskQuery" class="filter-form">
            <el-form-item label="用户ID"><el-input v-model="riskQuery.userId" clearable /></el-form-item>
            <el-form-item label="业务类型"><el-input v-model="riskQuery.bizType" clearable /></el-form-item>
            <el-form-item label="决策"><el-input v-model="riskQuery.decision" clearable /></el-form-item>
            <el-form-item label="原因"><el-input v-model="riskQuery.reason" clearable /></el-form-item>
            <el-form-item label="条数"><el-input-number v-model="riskQuery.limit" :min="1" :max="200" /></el-form-item>
            <el-form-item><el-button type="primary" @click="loadData">查询</el-button></el-form-item>
          </el-form>
          <el-table v-loading="loading" :data="riskDecisions" border>
            <el-table-column prop="decisionNo" label="决策号" min-width="170" />
            <el-table-column prop="userId" label="用户ID" width="100" />
            <el-table-column prop="bizType" label="业务类型" width="130" />
            <el-table-column prop="bizNo" label="业务号" min-width="170" />
            <el-table-column prop="decision" label="决策" width="110" />
            <el-table-column prop="riskScore" label="分数" width="90" />
            <el-table-column prop="reason" label="原因" min-width="180" />
            <el-table-column prop="createdAt" label="创建时间" min-width="170" />
            <el-table-column label="操作" width="190" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" @click="showDetail(row)">详情</el-button>
                <el-button link type="success" @click="openRiskReview(row, 'approve')">通过</el-button>
                <el-button link type="danger" @click="openRiskReview(row, 'reject')">拒绝</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>

        <el-tab-pane label="人工复核" name="review">
          <div class="table-toolbar">
            <span>待人工复核风险决策</span>
            <div>
              <el-input-number v-model="reviewLimit" :min="1" :max="200" style="width: 118px; margin-right: 10px" />
              <el-button type="primary" @click="loadData">查询</el-button>
            </div>
          </div>
          <el-table v-loading="loading" :data="reviewDecisions" border>
            <el-table-column prop="decisionNo" label="决策号" min-width="170" />
            <el-table-column prop="userId" label="用户ID" width="100" />
            <el-table-column prop="bizType" label="业务类型" width="130" />
            <el-table-column prop="bizNo" label="业务号" min-width="170" />
            <el-table-column prop="asset" label="资产" width="90" />
            <el-table-column prop="amount" label="金额" width="120" />
            <el-table-column prop="riskScore" label="分数" width="90" />
            <el-table-column prop="ruleCodes" label="规则" min-width="180" />
            <el-table-column label="操作" width="190" fixed="right">
              <template #default="{ row }">
                <el-button link type="success" @click="openRiskReview(row, 'approve')">通过</el-button>
                <el-button link type="danger" @click="openRiskReview(row, 'reject')">拒绝</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>

        <el-tab-pane label="黑名单" name="blacklists">
          <div class="table-toolbar">
            <span>风险黑名单</span>
            <el-button type="primary" :icon="'Plus'" @click="blacklistDialogVisible = true">新增/激活</el-button>
          </div>
          <el-form :inline="true" :model="blacklistQuery" class="filter-form">
            <el-form-item label="状态"><el-input v-model="blacklistQuery.status" clearable /></el-form-item>
            <el-form-item label="条数"><el-input-number v-model="blacklistQuery.limit" :min="1" :max="200" /></el-form-item>
            <el-form-item><el-button type="primary" @click="loadData">查询</el-button></el-form-item>
          </el-form>
          <el-table v-loading="loading" :data="blacklists" border>
            <el-table-column prop="userId" label="用户ID" width="100" />
            <el-table-column prop="status" label="状态" width="110" />
            <el-table-column prop="riskLevel" label="风险等级" width="120" />
            <el-table-column prop="source" label="来源" width="120" />
            <el-table-column prop="reason" label="原因" min-width="220" />
            <el-table-column prop="expiresAt" label="过期时间" min-width="170" />
            <el-table-column prop="releasedBy" label="释放人" width="130" />
            <el-table-column label="操作" width="140" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" @click="showDetail(row)">详情</el-button>
                <el-button link type="warning" @click="runReleaseBlacklist(row)">释放</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>

        <el-tab-pane label="Proof 资产" name="proof">
          <div class="table-toolbar">
            <span>Proof Evidence</span>
            <el-button type="primary" :icon="'Plus'" @click="proofDialogVisible = true">新增 Proof</el-button>
          </div>
          <el-form :inline="true" :model="proofQuery" class="filter-form">
            <el-form-item label="用户ID"><el-input v-model="proofQuery.userId" clearable /></el-form-item>
            <el-form-item label="类型"><el-input v-model="proofQuery.proofType" clearable /></el-form-item>
            <el-form-item label="状态"><el-input v-model="proofQuery.status" clearable /></el-form-item>
            <el-form-item label="条数"><el-input-number v-model="proofQuery.limit" :min="1" :max="200" /></el-form-item>
            <el-form-item><el-button type="primary" @click="loadData">查询</el-button></el-form-item>
          </el-form>
          <el-table v-loading="loading" :data="proofAssets" border>
            <el-table-column prop="proofNo" label="Proof 编号" min-width="170" />
            <el-table-column prop="userId" label="用户ID" width="100" />
            <el-table-column prop="proofType" label="类型" width="130" />
            <el-table-column prop="status" label="状态" width="110" />
            <el-table-column prop="objectKey" label="对象键" min-width="220" />
            <el-table-column prop="relatedBizNo" label="关联业务号" min-width="160" />
            <el-table-column prop="reviewedBy" label="审核人" width="130" />
            <el-table-column label="操作" width="250" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" @click="showDetail(row)">详情</el-button>
                <el-button link type="success" @click="openProofReview(row, 'verify')">验证</el-button>
                <el-button link type="warning" @click="openProofReview(row, 'reject')">拒绝</el-button>
                <el-button link type="danger" @click="runArchiveProof(row)">归档</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
      </el-tabs>
    </el-card>

    <el-dialog v-model="kycSubmitVisible" title="提交 KYC Profile" width="660px">
      <el-form :model="kycSubmitForm" label-width="128px">
        <el-form-item label="用户ID"><el-input-number v-model="kycSubmitForm.userId" :min="1" style="width: 100%" /></el-form-item>
        <el-form-item label="KYC 编号"><el-input v-model="kycSubmitForm.kycNo" /></el-form-item>
        <el-form-item label="国家"><el-input v-model="kycSubmitForm.country" /></el-form-item>
        <el-form-item label="申请人"><el-input v-model="kycSubmitForm.applicantName" /></el-form-item>
        <el-form-item label="证件类型"><el-input v-model="kycSubmitForm.documentType" /></el-form-item>
        <el-form-item label="证件 Last4"><el-input v-model="kycSubmitForm.documentLast4" /></el-form-item>
        <el-form-item label="文档对象键"><el-input v-model="kycSubmitForm.documentObjectKey" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="kycSubmitVisible = false">取消</el-button>
        <el-button type="primary" :loading="actionLoading" @click="submitKyc">提交</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="reviewDialogVisible" title="审核操作" width="620px">
      <el-form :model="reviewForm" label-width="110px">
        <el-form-item label="对象"><el-input :model-value="reviewForm.targetNo || reviewForm.userId" disabled /></el-form-item>
        <el-form-item label="操作"><el-input v-model="reviewForm.action" disabled /></el-form-item>
        <el-form-item label="Reviewer"><el-input v-model="reviewForm.reviewer" /></el-form-item>
        <el-form-item v-if="reviewForm.targetType === 'KYC' && reviewForm.action === 'approve'" label="过期时间">
          <el-date-picker v-model="reviewForm.expiresAt" type="datetime" value-format="YYYY-MM-DDTHH:mm:ss" style="width: 100%" />
        </el-form-item>
        <el-form-item label="原因"><el-input v-model="reviewForm.reason" type="textarea" :rows="3" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="reviewDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="actionLoading" @click="submitReview">提交</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="blacklistDialogVisible" title="新增/激活黑名单" width="620px">
      <el-form :model="blacklistForm" label-width="110px">
        <el-form-item label="用户ID"><el-input-number v-model="blacklistForm.userId" :min="1" style="width: 100%" /></el-form-item>
        <el-form-item label="风险等级"><el-input v-model="blacklistForm.riskLevel" /></el-form-item>
        <el-form-item label="来源"><el-input v-model="blacklistForm.source" /></el-form-item>
        <el-form-item label="操作人"><el-input v-model="blacklistForm.operator" /></el-form-item>
        <el-form-item label="过期时间"><el-date-picker v-model="blacklistForm.expiresAt" type="datetime" value-format="YYYY-MM-DDTHH:mm:ss" style="width: 100%" /></el-form-item>
        <el-form-item label="原因"><el-input v-model="blacklistForm.reason" type="textarea" :rows="3" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="blacklistDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="actionLoading" @click="submitBlacklist">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="proofDialogVisible" title="新增 Proof 资产" width="680px">
      <el-form :model="proofForm" label-width="128px">
        <el-form-item label="用户ID"><el-input-number v-model="proofForm.userId" :min="1" style="width: 100%" /></el-form-item>
        <el-form-item label="Proof 编号"><el-input v-model="proofForm.proofNo" /></el-form-item>
        <el-form-item label="Proof 类型"><el-input v-model="proofForm.proofType" /></el-form-item>
        <el-form-item label="对象键"><el-input v-model="proofForm.objectKey" /></el-form-item>
        <el-form-item label="状态"><el-input v-model="proofForm.status" /></el-form-item>
        <el-form-item label="文件名"><el-input v-model="proofForm.fileName" /></el-form-item>
        <el-form-item label="Content-Type"><el-input v-model="proofForm.contentType" /></el-form-item>
        <el-form-item label="大小字节"><el-input-number v-model="proofForm.sizeBytes" :min="0" style="width: 100%" /></el-form-item>
        <el-form-item label="Checksum"><el-input v-model="proofForm.checksum" /></el-form-item>
        <el-form-item label="关联业务类型"><el-input v-model="proofForm.relatedBizType" /></el-form-item>
        <el-form-item label="关联业务号"><el-input v-model="proofForm.relatedBizNo" /></el-form-item>
        <el-form-item label="提交人"><el-input v-model="proofForm.submittedBy" /></el-form-item>
        <el-form-item label="Metadata JSON"><el-input v-model="proofForm.metadataJson" type="textarea" :rows="3" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="proofDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="actionLoading" @click="submitProof">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="detailVisible" title="详情" width="760px">
      <pre class="json-preview">{{ JSON.stringify(detailRecord, null, 2) }}</pre>
    </el-dialog>
  </div>
</template>

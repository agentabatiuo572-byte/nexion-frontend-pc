const apiBase = (process.env.NEXION_API_BASE || 'http://127.0.0.1:8090/api').replace(/\/+$/, '')
const username = process.env.NEXION_ADMIN_USERNAME || 'superadmin'
const password = process.env.NEXION_ADMIN_PASSWORD
const runId = new Date().toISOString().replace(/\D/g, '').slice(0, 14)
const prefix = process.env.NEXION_SMOKE_PREFIX || `pc-ops-${runId}`

if (!password) {
  throw new Error('NEXION_ADMIN_PASSWORD is required')
}

let adminToken = ''
let userToken = ''
let smokeUserId
const results = []

async function api(method, path, { query, body, token, optional = false } = {}) {
  const url = new URL(`${apiBase}${path}`)
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value))
      }
    }
  }

  const headers = { Accept: 'application/json' }
  const authToken = token === undefined ? adminToken : token
  if (authToken) headers.Authorization = `Bearer ${authToken}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  const response = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  })

  const text = await response.text()
  const payload = text ? JSON.parse(text) : null
  if (!response.ok) {
    if (optional) return null
    throw new Error(`${method} ${path} HTTP ${response.status}: ${text}`)
  }
  if (payload && typeof payload.code === 'number' && payload.code !== 0) {
    if (optional) return null
    throw new Error(`${method} ${path} code ${payload.code}: ${payload.message || text}`)
  }
  return payload && Object.hasOwn(payload, 'data') ? payload.data : payload
}

function pass(name, detail) {
  results.push({ name, detail })
  console.log(`[PASS] ${name}${detail ? ` - ${detail}` : ''}`)
}

function futureLocalDateTime(days) {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 19)
}

async function loginAdmin() {
  const data = await api('POST', '/auth/admin/login', {
    token: '',
    body: { username, password }
  })
  adminToken = data.token
  pass('admin login', username)
}

async function registerSmokeUser() {
  const phone = runId.slice(-10)
  const data = await api('POST', '/auth/users/register', {
    token: '',
    body: {
      countryCode: '+1',
      phone,
      password: `Smoke@${runId}`
    }
  })
  userToken = data.token
  smokeUserId = data.userId
  pass('smoke user register', `userId=${smokeUserId}`)
}

async function smokeCompliance() {
  const kycNo = `SMK-KYC-${runId}`
  await api('POST', '/compliance/kyc-profiles', {
    body: {
      userId: smokeUserId,
      kycNo,
      country: 'US',
      applicantName: 'PC Ops Smoke',
      documentType: 'PASSPORT',
      documentLast4: '1234',
      documentObjectKey: `smoke/kyc/${runId}.jpg`
    }
  })
  await api('POST', `/compliance/kyc-profiles/${smokeUserId}/approve`, {
    body: {
      reviewer: 'pc-ops-smoke',
      reason: prefix,
      expiresAt: futureLocalDateTime(30)
    }
  })
  pass('compliance kyc submit/approve', kycNo)

  const proofNo = `SMK-PROOF-${runId}`
  await api('POST', '/compliance/proof-assets', {
    body: {
      userId: smokeUserId,
      proofNo,
      proofType: 'POC_RECEIPT',
      objectKey: `smoke/proof/${runId}.json`,
      status: 'PENDING',
      submittedBy: 'pc-ops-smoke',
      metadataJson: JSON.stringify({ smoke: true, runId })
    }
  })
  await api('POST', `/compliance/proof-assets/${proofNo}/verify`, {
    body: { reviewer: 'pc-ops-smoke', reason: prefix }
  })
  pass('compliance proof create/verify', proofNo)

  const rejectedProofNo = `SMK-PROOF-RJ-${runId}`
  await api('POST', '/compliance/proof-assets', {
    body: {
      userId: smokeUserId,
      proofNo: rejectedProofNo,
      proofType: 'OPS_EVIDENCE',
      objectKey: `smoke/proof/rejected-${runId}.json`,
      status: 'PENDING',
      submittedBy: 'pc-ops-smoke'
    }
  })
  await api('POST', `/compliance/proof-assets/${rejectedProofNo}/reject`, {
    body: { reviewer: 'pc-ops-smoke', reason: prefix }
  })
  await api('DELETE', `/compliance/proof-assets/${rejectedProofNo}`)
  pass('compliance proof reject/archive', rejectedProofNo)

  await api('POST', '/compliance/blacklists', {
    body: {
      userId: smokeUserId,
      reason: prefix,
      source: 'SMOKE',
      riskLevel: 'LOW',
      operator: 'pc-ops-smoke'
    }
  })
  await api('POST', `/compliance/blacklists/${smokeUserId}/release`, {
    body: { operator: 'pc-ops-smoke', reason: `${prefix} release` }
  })
  pass('compliance blacklist upsert/release', `userId=${smokeUserId}`)
}

async function smokeWallet() {
  await api('POST', '/wallet/ops/deposits/manual', {
    body: {
      userId: smokeUserId,
      chain: 'TRON',
      chainTxHash: `0xSMOKE${runId}`,
      asset: 'USDT',
      amount: '0.000020',
      confirmations: 20,
      reason: prefix
    }
  })
  pass('wallet manual deposit', `userId=${smokeUserId}`)

  const failedWithdrawalNo = `SMK-WD-F-${runId}`
  await api('POST', '/wallet/withdrawals', {
    body: {
      userId: smokeUserId,
      withdrawalNo: failedWithdrawalNo,
      asset: 'USDT',
      amount: '0.000005',
      fee: '0.000000',
      targetAddress: `TSmokeFailed${runId}`
    }
  })
  await api('POST', `/wallet/ops/withdrawals/${failedWithdrawalNo}/mark-failed`, {
    body: { reason: `${prefix} failed path` }
  })
  pass('wallet withdrawal mark failed', failedWithdrawalNo)

  const successWithdrawalNo = `SMK-WD-S-${runId}`
  await api('POST', '/wallet/withdrawals', {
    body: {
      userId: smokeUserId,
      withdrawalNo: successWithdrawalNo,
      asset: 'USDT',
      amount: '0.000005',
      fee: '0.000000',
      targetAddress: `TSmokeSuccess${runId}`
    }
  })
  await api('POST', `/wallet/ops/withdrawals/${successWithdrawalNo}/mark-succeeded`, {
    body: {
      chainTxHash: `0xSMOKEWDS${runId}`,
      reason: `${prefix} success path`
    }
  })
  pass('wallet withdrawal mark succeeded', successWithdrawalNo)

  await api('GET', '/wallet/withdrawals/broadcast/summary')
  await api('GET', '/wallet/deposits/records', { query: { chainTxHash: `0xSMOKE${runId}` } })
  pass('wallet ops readback', 'broadcast summary + deposit records')
}

async function smokeOpenApi() {
  const app = await api('POST', '/openapi/apps', {
    token: userToken,
    body: {
      appName: `Smoke Ops ${runId}`,
      qpsLimit: 5,
      dailyLimit: 50,
      remark: prefix
    }
  })
  await api('PATCH', `/openapi/ops/apps/${app.id}/quotas`, {
    body: {
      qpsLimit: 5,
      dailyLimit: 50,
      remark: `${prefix} quota`
    }
  })
  await api('POST', `/openapi/ops/apps/${app.id}/disable`)
  await api('POST', `/openapi/ops/apps/${app.id}/enable`)
  await api('POST', '/openapi/webhooks/deliveries/publish', { query: { limit: 1 } })
  pass('openapi quota/disable/enable/webhook publish', `appId=${app.id}`)
}

async function smokeCommerceAndComputeOps() {
  await api('POST', '/commerce/payments/ops/expire-pending', { query: { limit: 1 } })
  await api('POST', '/commerce/payments/ops/reconcile-due', { query: { limit: 1 } })
  await api('GET', '/commerce/payments/ops/anomalies', { query: { limit: 1 } })
  pass('commerce payment ops', 'expire/reconcile/anomalies')

  await api('POST', '/compute/tasks/maintenance/timeouts', { query: { limit: 1 } })
  await api('POST', '/compute/tasks/maintenance/retries', { query: { limit: 1 } })
  const onlineDevices = await api('GET', '/compute/devices', {
    query: { pageNum: 1, pageSize: 1, status: 'ONLINE' },
    optional: true
  })
  const device = onlineDevices?.records?.[0]
  if (device?.id) {
    const task = await api('POST', '/compute/tasks/dispatch', {
      body: {
        userId: device.userId,
        preferredDeviceId: device.id,
        taskType: 'POC_RECEIPT',
        clientName: 'pc-ops-smoke',
        maxAttempts: 3,
        leaseSeconds: 60
      }
    })
    pass('compute dispatch task', task.taskNo)
  } else {
    pass('compute dispatch task skipped', 'no ONLINE device')
  }
  pass('compute task maintenance', 'timeouts/retries')
}

async function main() {
  await loginAdmin()
  await registerSmokeUser()
  await smokeCompliance()
  await smokeWallet()
  await smokeOpenApi()
  await smokeCommerceAndComputeOps()

  console.log(`\nPC admin ops smoke completed: ${results.length} checks`)
}

main().catch((error) => {
  console.error(`\nPC admin ops smoke failed: ${error.message}`)
  process.exitCode = 1
})

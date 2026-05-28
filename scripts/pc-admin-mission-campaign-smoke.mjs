const apiBase = (process.env.NEXION_API_BASE || 'http://127.0.0.1:8090/api').replace(/\/+$/, '')
const username = process.env.NEXION_ADMIN_USERNAME || 'superadmin'
const password = process.env.NEXION_ADMIN_PASSWORD
const runId = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)
const results = []

if (!password) {
  throw new Error('NEXION_ADMIN_PASSWORD is required')
}

let adminToken = ''

async function api(method, path, { query, body, optional = false } = {}) {
  const url = new URL(`${apiBase}${path}`)
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value))
      }
    }
  }

  const headers = { Accept: 'application/json' }
  if (adminToken) headers.Authorization = `Bearer ${adminToken}`
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

function assertObject(name, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name} expected object`)
  }
}

function assertPage(name, value) {
  assertObject(name, value)
  if (!Array.isArray(value.records)) {
    throw new Error(`${name}.records expected array`)
  }
}

async function loginAdmin() {
  const data = await api('POST', '/auth/admin/login', {
    body: { username, password }
  })
  adminToken = data.token
  pass('admin login', username)
}

async function smokeMonthlyChallenge() {
  const page = await api('GET', '/missions/ops/monthly-challenges', {
    query: { pageNum: 1, pageSize: 10 }
  })
  assertPage('monthly challenge page', page)
  pass('monthly challenge page', `${page.records.length} rows`)

  const code = `MONTHLY_PC_${runId}`
  const created = await api('POST', '/missions/ops/monthly-challenges', {
    body: {
      challengeCode: code,
      challengeName: `PC Monthly ${runId}`,
      description: 'PC smoke monthly challenge',
      theme: 'PC_SMOKE',
      monthsFrom: 0,
      monthsTo: 999,
      targetType: 'CHECK_IN_DAYS',
      targetValue: 1,
      rewardType: 'POINTS',
      rewardAmount: 120,
      rewardName: 'PC smoke points',
      sortOrder: 100,
      status: 1
    }
  })
  assertObject('monthly challenge create', created)
  pass('monthly challenge create', code)

  const id = created.id || created.challengeId
  const updated = await api('PATCH', `/missions/ops/monthly-challenges/${id}`, {
    body: {
      challengeName: `PC Monthly ${runId} patched`,
      rewardAmount: 150,
      status: 1
    }
  })
  assertObject('monthly challenge update', updated)
  pass('monthly challenge update', code)

  const progress = await api('PATCH', `/missions/ops/monthly-challenges/${code}/users/10001/progress`, {
    body: { progressValue: 1 }
  })
  assertObject('monthly challenge progress', progress)
  pass('monthly challenge progress', code)
}

async function smokeEventQuest() {
  const page = await api('GET', '/missions/ops/event-quests', {
    query: { pageNum: 1, pageSize: 10 }
  })
  assertPage('event quest page', page)
  pass('event quest page', `${page.records.length} rows`)

  const code = `EVENT_PC_${runId}`
  const created = await api('POST', '/missions/ops/event-quests', {
    body: {
      questCode: code,
      questName: `PC Event ${runId}`,
      description: 'PC smoke event quest',
      startsAt: '2026-01-01T00:00:00',
      endsAt: '2026-12-31T23:59:59',
      targetType: 'MISSION_COUNT',
      targetValue: 1,
      rewardType: 'POINTS',
      rewardAmount: 130,
      rewardName: 'PC smoke points',
      sortOrder: 100,
      status: 1
    }
  })
  assertObject('event quest create', created)
  pass('event quest create', code)

  const id = created.id || created.questId
  const updated = await api('PATCH', `/missions/ops/event-quests/${id}`, {
    body: {
      questName: `PC Event ${runId} patched`,
      rewardAmount: 160,
      status: 1
    }
  })
  assertObject('event quest update', updated)
  pass('event quest update', code)

  const progress = await api('PATCH', `/missions/ops/event-quests/${code}/users/10001/progress`, {
    body: { progressValue: 1 }
  })
  assertObject('event quest progress', progress)
  pass('event quest progress', code)
}

async function main() {
  await loginAdmin()
  await smokeMonthlyChallenge()
  await smokeEventQuest()

  console.log(`\nPC admin Mission Campaign smoke completed: ${results.length} checks`)
}

main().catch((error) => {
  console.error(`\nPC admin Mission Campaign smoke failed: ${error.message}`)
  process.exitCode = 1
})

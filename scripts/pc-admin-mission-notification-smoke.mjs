const apiBase = (process.env.NEXION_API_BASE || 'http://127.0.0.1:8090/api').replace(/\/+$/, '')
const username = process.env.NEXION_ADMIN_USERNAME || 'superadmin'
const password = process.env.NEXION_ADMIN_PASSWORD
const missionConsumerGroup = 'nexion-mission-earning-generated'
const notificationConsumerGroup = 'nexion-notification-earning-generated'
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

function assertArray(name, value) {
  if (!Array.isArray(value)) {
    throw new Error(`${name} expected array`)
  }
}

async function loginAdmin() {
  const data = await api('POST', '/auth/admin/login', {
    body: { username, password }
  })
  adminToken = data.token
  pass('admin login', username)
}

async function smokeMission() {
  const overview = await api('GET', '/missions/ops/overview')
  assertObject('mission overview', overview)
  pass('mission overview', overview.service)

  const summary = await api('GET', '/missions/outbox/consumer/summary', {
    query: { consumerGroup: missionConsumerGroup }
  })
  assertArray('mission consumer summary', summary)
  pass('mission consumer summary', `${summary.length} rows`)

  const dead = await api('GET', '/missions/outbox/consumer/dead', {
    query: { consumerGroup: missionConsumerGroup, limit: 5 }
  })
  assertArray('mission consumer dead', dead)
  pass('mission consumer dead', `${dead.length} rows`)
}

async function smokeNotification() {
  const overview = await api('GET', '/notifications/ops/overview')
  assertObject('notification overview', overview)
  pass('notification overview', overview.service)

  const summary = await api('GET', '/notifications/outbox/consumer/summary', {
    query: { consumerGroup: notificationConsumerGroup }
  })
  assertArray('notification consumer summary', summary)
  pass('notification consumer summary', `${summary.length} rows`)

  const dead = await api('GET', '/notifications/outbox/consumer/dead', {
    query: { consumerGroup: notificationConsumerGroup, limit: 5 }
  })
  assertArray('notification consumer dead', dead)
  pass('notification consumer dead', `${dead.length} rows`)

  const pushed = await api('POST', '/notifications/ops/push-pending', { query: { limit: 1 } })
  assertObject('notification push pending', pushed)
  pass('notification push pending', JSON.stringify(pushed))
}

async function main() {
  await loginAdmin()
  await smokeMission()
  await smokeNotification()

  console.log(`\nPC admin Mission/Notification smoke completed: ${results.length} checks`)
}

main().catch((error) => {
  console.error(`\nPC admin Mission/Notification smoke failed: ${error.message}`)
  process.exitCode = 1
})

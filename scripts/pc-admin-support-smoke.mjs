const apiBase = (process.env.NEXION_API_BASE || 'http://127.0.0.1:8090/api').replace(/\/+$/, '')
const username = process.env.NEXION_ADMIN_USERNAME || 'superadmin'
const password = process.env.NEXION_ADMIN_PASSWORD
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

async function smokeSupportTickets() {
  const page = await api('GET', '/system/support/ops/tickets', {
    query: { pageNum: 1, pageSize: 10 }
  })
  assertPage('support ticket page', page)
  pass('support ticket page', `${page.records.length} rows`)

  const candidate = page.records[0]
  if (!candidate?.ticketNo) {
    pass('support ticket detail skipped', 'no existing ticket')
    pass('support ticket reply skipped', 'no existing ticket')
    pass('support ticket update skipped', 'no existing ticket')
    return
  }

  const detail = await api('GET', `/system/support/ops/tickets/${candidate.ticketNo}`)
  assertObject('support ticket detail', detail)
  pass('support ticket detail', candidate.ticketNo)

  const replied = await api('POST', `/system/support/ops/tickets/${candidate.ticketNo}/messages`, {
    body: { content: `PC support smoke reply ${new Date().toISOString()}` }
  })
  assertObject('support ticket reply', replied)
  pass('support ticket reply', candidate.ticketNo)

  const updated = await api('PATCH', `/system/support/ops/tickets/${candidate.ticketNo}`, {
    body: {
      priority: detail.priority || 'NORMAL',
      category: detail.category || 'GENERAL',
      assignedAdminName: 'pc-smoke'
    }
  })
  assertObject('support ticket update', updated)
  pass('support ticket update', candidate.ticketNo)
}

async function main() {
  await loginAdmin()
  await smokeSupportTickets()

  console.log(`\nPC admin Support smoke completed: ${results.length} checks`)
}

main().catch((error) => {
  console.error(`\nPC admin Support smoke failed: ${error.message}`)
  process.exitCode = 1
})

const apiBase = (process.env.NEXION_API_BASE || 'http://127.0.0.1:8090/api').replace(/\/+$/, '')
const username = process.env.NEXION_ADMIN_USERNAME || 'superadmin'
const password = process.env.NEXION_ADMIN_PASSWORD
const runId = new Date().toISOString().replace(/\D/g, '').slice(0, 14)
const prefix = process.env.NEXION_SMOKE_PREFIX || `pc-smoke-${runId}`

if (!password) {
  throw new Error('NEXION_ADMIN_PASSWORD is required')
}

let token = ''
const results = []

async function api(method, path, { query, body, allow404 = false } = {}) {
  const url = new URL(`${apiBase}${path}`)
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value))
      }
    }
  }

  const headers = { Accept: 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  const response = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  })

  const text = await response.text()
  const payload = text ? JSON.parse(text) : null
  if (!response.ok && !(allow404 && response.status === 404)) {
    throw new Error(`${method} ${path} HTTP ${response.status}: ${text}`)
  }
  if (payload && typeof payload.code === 'number' && payload.code !== 0) {
    if (allow404 && payload.code === 404) return null
    throw new Error(`${method} ${path} code ${payload.code}: ${payload.message || text}`)
  }
  return payload && Object.hasOwn(payload, 'data') ? payload.data : payload
}

function pass(name, detail) {
  results.push({ name, detail })
  console.log(`[PASS] ${name}${detail ? ` - ${detail}` : ''}`)
}

async function login() {
  const data = await api('POST', '/auth/admin/login', {
    body: { username, password }
  })
  token = data.token
  pass('admin login', username)
}

async function smokeProduct() {
  const productNo = `SMK-SKU-${runId}`
  const product = await api('POST', '/commerce/products', {
    body: {
      productNo,
      name: `Smoke SKU ${runId}`,
      productType: 'HARDWARE',
      tier: 'SMOKE',
      status: 'OFF_SALE',
      priceUsdt: '1.000000',
      hashrate: '0',
      estimatedDailyUsdt: '0',
      dailyNex: '0',
      stock: 0
    }
  })
  await api('PATCH', `/commerce/products/${product.id}`, {
    body: {
      name: `Smoke SKU ${runId} patched`,
      status: 'OFF_SALE',
      stock: 0
    }
  })
  pass('commerce product create/update', productNo)
}

async function smokeGenesisSeries() {
  const seriesCode = `SMK-GEN-${runId}`
  const series = await api('POST', '/genesis/series', {
    body: {
      seriesCode,
      name: `Smoke Genesis ${runId}`,
      totalSupply: 1,
      priceUsdt: '1.000000',
      status: 'INACTIVE',
      royaltyBps: 0,
      metadataJson: JSON.stringify({ smoke: true, runId })
    }
  })
  await api('PATCH', `/genesis/series/${series.id}`, {
    body: {
      name: `Smoke Genesis ${runId} patched`,
      status: 'INACTIVE',
      priceUsdt: '1.000000'
    }
  })
  pass('genesis series create/update', seriesCode)
}

async function smokeDeviceLifecycleRule() {
  const rule = await api('POST', '/compute/device-lifecycle/rules', {
    body: {
      scopeType: 'TIER',
      scopeValue: `SMOKE-${runId}`,
      startMonth: 0,
      endMonth: 0,
      monthlyDecayRate: '0.000000',
      floorEfficiency: '1.000000',
      exempt: 0,
      status: 0,
      sortOrder: 900000
    }
  })
  await api('PATCH', `/compute/device-lifecycle/rules/${rule.id}`, {
    body: {
      monthlyDecayRate: '0.000000',
      floorEfficiency: '1.000000',
      status: 0
    }
  })
  pass('compute lifecycle rule create/update', String(rule.id))
}

async function smokeSystemConfig() {
  const configKey = `smoke.pc.${runId}`
  const config = await api('POST', '/system/configs', {
    body: {
      configKey,
      configValue: JSON.stringify({ smoke: true, runId }),
      valueType: 'JSON',
      configGroup: 'smoke',
      visibility: 'ADMIN',
      remark: `${prefix} disabled smoke config`,
      status: 0
    }
  })
  await api('PATCH', `/system/configs/${config.id}`, {
    body: {
      configValue: JSON.stringify({ smoke: true, runId, patched: true }),
      valueType: 'JSON',
      status: 0
    }
  })
  pass('system config create/update', configKey)
}

async function smokeI18n() {
  const messageKey = `smoke.pc.${runId}`
  const message = await api('POST', '/system/i18n/messages', {
    body: {
      messageKey,
      locale: 'en-US',
      messageValue: `Smoke message ${runId}`,
      status: 0
    }
  })
  await api('PATCH', `/system/i18n/messages/${message.id}`, {
    body: {
      messageValue: `Smoke message ${runId} patched`,
      status: 0
    }
  })
  pass('system i18n create/update', messageKey)
}

async function smokeContent() {
  const pageCode = `smoke.pc.${runId}`
  const page = await api('POST', '/system/content/pages', {
    body: {
      pageCode,
      title: `Smoke Page ${runId}`,
      content: `${prefix} content`,
      status: 0
    }
  })
  await api('PATCH', `/system/content/pages/${page.id}`, {
    body: {
      title: `Smoke Page ${runId} patched`,
      content: `${prefix} content patched`,
      status: 0
    }
  })
  pass('system content create/update', pageCode)
}

async function smokeHelp() {
  const articleCode = `smoke.pc.${runId}`
  const article = await api('POST', '/system/help/articles', {
    body: {
      articleCode,
      title: `Smoke Help ${runId}`,
      content: `${prefix} help`,
      sortOrder: 900000,
      status: 0
    }
  })
  await api('PATCH', `/system/help/articles/${article.id}`, {
    body: {
      title: `Smoke Help ${runId} patched`,
      content: `${prefix} help patched`,
      sortOrder: 900000,
      status: 0
    }
  })
  pass('system help create/update', articleCode)
}

async function smokeOpenApiQuota() {
  const appId = process.env.NEXION_SMOKE_OPENAPI_APP_ID
  const apps = appId
    ? [{ id: appId }]
    : await api('GET', '/openapi/ops/apps', { query: { limit: 1 } })
  const app = Array.isArray(apps) ? apps[0] : apps
  if (!app?.id) {
    pass('openapi quota update skipped', 'no app available')
    return
  }
  const qpsLimit = Number(app.qpsLimit || 20)
  const dailyLimit = Number(app.dailyLimit || 10000)
  await api('PATCH', `/openapi/ops/apps/${app.id}/quotas`, {
    body: { qpsLimit, dailyLimit }
  })
  pass('openapi quota same-value update', String(app.id))
}

async function main() {
  await login()
  await smokeProduct()
  await smokeGenesisSeries()
  await smokeDeviceLifecycleRule()
  await smokeSystemConfig()
  await smokeI18n()
  await smokeContent()
  await smokeHelp()
  await smokeOpenApiQuota()

  console.log(`\nPC admin write smoke completed: ${results.length} checks`)
}

main().catch((error) => {
  console.error(`\nPC admin write smoke failed: ${error.message}`)
  process.exitCode = 1
})

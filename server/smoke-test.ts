import 'dotenv/config'

// Minimal, dependency-free smoke test for auth + per-user holdings isolation.
// Auto-starts the API server if it's not already running.

import { spawn } from 'node:child_process'
import path from 'node:path'

type JsonValue = null | boolean | number | string | JsonValue[] | { [k: string]: JsonValue }

type Session = {
  cookie: string
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function isJsonObject(value: JsonValue): value is { [k: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getJsonProp(obj: JsonValue, key: string): JsonValue | undefined {
  if (!isJsonObject(obj)) return undefined
  return obj[key]
}

function getJsonBoolean(obj: JsonValue, key: string): boolean | undefined {
  const v = getJsonProp(obj, key)
  return typeof v === 'boolean' ? v : undefined
}

function getJsonArray(obj: JsonValue, key: string): JsonValue[] | undefined {
  const v = getJsonProp(obj, key)
  return Array.isArray(v) ? v : undefined
}

function randomEmail(prefix: string) {
  const id = Math.random().toString(16).slice(2, 10)
  return `${prefix}_${id}@example.com`
}

function pickSetCookieCookieHeader(setCookie: string[] | null): string {
  if (!setCookie || setCookie.length === 0) return ''
  // Only keep the first cookie-pair ("name=value") from each Set-Cookie entry.
  // The API sets a single cookie: session=<jwt>; ...
  return setCookie
    .map((v) => v.split(';')[0]?.trim())
    .filter(Boolean)
    .join('; ')
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchJsonWithTimeout(url: string, timeoutMs: number) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: controller.signal })
    const text = await res.text()
    const json = text ? (JSON.parse(text) as JsonValue) : null
    return { ok: true as const, status: res.status, json }
  } catch (err) {
    return { ok: false as const, error: err }
  } finally {
    clearTimeout(timeout)
  }
}

async function isApiUp(baseUrl: string): Promise<boolean> {
  // /api/health touches the DB and may take a couple seconds on cold start.
  const r = await fetchJsonWithTimeout(`${baseUrl}/api/health`, 5000)
  return r.ok && r.status === 200 && getJsonBoolean(r.json, 'ok') === true
}

async function startApiServerIfNeeded(baseUrl: string) {
  if (await isApiUp(baseUrl)) {
    return { started: false as const, pid: undefined as number | undefined }
  }

  // Start server/index.ts using the local tsx binary.
  const projectRoot = path.resolve(process.cwd())
  let out = ''
  let err = ''

  // Use Node's built-in loader hook to run TS directly.
  // This avoids spawning platform-specific tsx(.cmd) shims.
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    cwd: projectRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      NODE_ENV: process.env.NODE_ENV ?? 'test',
    },
    windowsHide: true,
  })

  child.stdout?.on('data', (chunk: Buffer) => {
    out += chunk.toString('utf8')
    if (out.length > 8000) out = out.slice(-8000)
  })
  child.stderr?.on('data', (chunk: Buffer) => {
    err += chunk.toString('utf8')
    if (err.length > 8000) err = err.slice(-8000)
  })

  const pid = child.pid
  assert(pid, 'Failed to start API server (no pid)')

  // Wait until the API responds.
  let exited: { code: number | null; signal: NodeJS.Signals | null } | null = null
  child.once('exit', (code, signal) => {
    exited = { code, signal }
  })

  const deadline = Date.now() + 45_000
  while (Date.now() < deadline) {
    if (exited) {
      await stopApiServer(pid)
      const logs = [out.trim(), err.trim()].filter(Boolean).join('\n')
      throw new Error(
        `API process exited early (code=${exited.code}, signal=${exited.signal ?? 'none'})` +
          (logs ? `\n--- server output (last) ---\n${logs}` : ''),
      )
    }
    if (await isApiUp(baseUrl)) {
      return { started: true as const, pid }
    }
    await sleep(250)
  }

  // If it didn't come up, best effort kill.
  await stopApiServer(pid)
  throw new Error('API did not become healthy within 45s')
}

async function stopApiServer(pid: number) {
  // taskkill reliably terminates process trees on Windows.
  await new Promise<void>((resolve) => {
    const child = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    })
    child.on('close', () => resolve())
    child.on('error', () => resolve())
  })
}

async function requestJson(
  baseUrl: string,
  path: string,
  init: RequestInit & { session?: Session } = {},
): Promise<{ status: number; json: JsonValue; session?: Session }> {
  const url = `${baseUrl}${path}`
  const headers = new Headers(init.headers)
  if (!headers.has('content-type') && init.body) headers.set('content-type', 'application/json')
  if (init.session?.cookie) headers.set('cookie', init.session.cookie)

  const res = await fetch(url, {
    ...init,
    headers,
  })

  const text = await res.text()
  const json = text ? (JSON.parse(text) as JsonValue) : null

  const setCookie = res.headers.getSetCookie?.() ?? null
  const cookie = pickSetCookieCookieHeader(setCookie)
  const nextSession = cookie ? ({ cookie } satisfies Session) : undefined

  return { status: res.status, json, session: nextSession }
}

async function main() {
  const baseUrl = process.env.SMOKE_BASE_URL ?? `http://localhost:${process.env.API_PORT ?? '5174'}`

  const api = await startApiServerIfNeeded(baseUrl)

  try {

    // Health
    const health = await requestJson(baseUrl, '/api/health', { method: 'GET' })
    assert(health.status === 200, `health failed: status=${health.status}`)
    assert(getJsonBoolean(health.json, 'ok') === true, 'health payload missing ok=true')

    const password = 'Password!1'

    // Register user1
    const u1 = randomEmail('u1')
    const reg1 = await requestJson(baseUrl, '/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email: u1, password }),
    })
    assert(reg1.status === 201, `register u1 failed: status=${reg1.status} body=${JSON.stringify(reg1.json)}`)
    assert(reg1.session?.cookie, 'register u1 did not set session cookie')

    // Add holding as user1
    const add1 = await requestJson(baseUrl, '/api/holdings', {
      method: 'POST',
      session: reg1.session,
      body: JSON.stringify({ symbol: 'AAPL', shares: 10, annualDividendPerShare: 0.96 }),
    })
    assert(add1.status === 201, `add holding u1 failed: status=${add1.status} body=${JSON.stringify(add1.json)}`)

    // List holdings as user1
    const list1 = await requestJson(baseUrl, '/api/holdings', { method: 'GET', session: reg1.session })
    assert(list1.status === 200, `list holdings u1 failed: status=${list1.status}`)
    const holdings1Json = getJsonArray(list1.json, 'holdings')
    assert(Array.isArray(holdings1Json), 'u1 holdings response missing holdings[]')
    const symbols1 = holdings1Json
      .map((h) => getJsonProp(h, 'symbol'))
      .filter((s): s is string => typeof s === 'string')
    assert(symbols1.includes('AAPL'), 'u1 holdings missing AAPL')
    assert(!symbols1.includes('MSFT'), 'u1 holdings unexpectedly contains MSFT')

    // Register user2
    const u2 = randomEmail('u2')
    const reg2 = await requestJson(baseUrl, '/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email: u2, password }),
    })
    assert(reg2.status === 201, `register u2 failed: status=${reg2.status} body=${JSON.stringify(reg2.json)}`)
    assert(reg2.session?.cookie, 'register u2 did not set session cookie')

    // Add holding as user2
    const add2 = await requestJson(baseUrl, '/api/holdings', {
      method: 'POST',
      session: reg2.session,
      body: JSON.stringify({ symbol: 'MSFT', shares: 5, annualDividendPerShare: 3.0 }),
    })
    assert(add2.status === 201, `add holding u2 failed: status=${add2.status} body=${JSON.stringify(add2.json)}`)

    // List holdings as user2
    const list2 = await requestJson(baseUrl, '/api/holdings', { method: 'GET', session: reg2.session })
    assert(list2.status === 200, `list holdings u2 failed: status=${list2.status}`)
    const holdings2Json = getJsonArray(list2.json, 'holdings')
    assert(Array.isArray(holdings2Json), 'u2 holdings response missing holdings[]')
    const symbols2 = holdings2Json
      .map((h) => getJsonProp(h, 'symbol'))
      .filter((s): s is string => typeof s === 'string')
    assert(symbols2.includes('MSFT'), 'u2 holdings missing MSFT')
    assert(!symbols2.includes('AAPL'), 'u2 holdings unexpectedly contains AAPL')

    console.log(`smoke:test OK`) // keep output stable for CI
    console.log(`- baseUrl: ${baseUrl}`)
    console.log(`- api: ${api.started ? `auto-started (pid ${api.pid})` : 'already running'}`)
    console.log(`- u1: ${u1} (AAPL)`)
    console.log(`- u2: ${u2} (MSFT)`)
  } finally {
    if (api.started && api.pid) {
      await stopApiServer(api.pid)
    }
  }
}

await main()

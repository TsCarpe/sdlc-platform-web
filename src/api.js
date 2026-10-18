// 写令牌（P1-4）：服务端启用 SDLC_WRITE_TOKEN 时，所有非 GET /api 请求须带 X-Token。
// 令牌只存本机浏览器（localStorage），也可由部署方通过 <meta name="sdlc-token"> 注入。
const TOKEN_KEY = 'sdlc.token'

export function getToken() {
  try {
    const stored = localStorage.getItem(TOKEN_KEY)
    if (stored) return stored
    const meta = document.querySelector('meta[name="sdlc-token"]')
    return meta ? (meta.getAttribute('content') || '') : ''
  } catch {
    return ''
  }
}

export function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch { /* 隐私模式/存储不可用时静默降级（写面 401 会给出明确文案） */ }
}

/** 非 GET 请求统一注入 X-Token；GET 不携带（服务端读面不校验，避免无谓暴露）。 */
export function authHeaders(method) {
  const m = (method || 'GET').toUpperCase()
  if (m === 'GET') return {}
  const token = getToken()
  return token ? { 'X-Token': token } : {}
}

async function call(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...authHeaders(method) },
    body: body ? JSON.stringify(body) : undefined
  })
  let data = {}
  try { data = await res.json() } catch { /* 空响应体 */ }
  if (!res.ok) {
    // 响应体与状态码随错误透出（如用例 409 的 conflicts 明细，TaskPanel 据此出裁决横幅）
    const err = new Error(data.error || data.message || ('请求失败 ' + res.status))
    err.data = data
    err.status = res.status
    throw err
  }
  return data
}

export const api = {
  get: (u) => call('GET', u),
  post: (u, b) => call('POST', u, b),
  put: (u, b) => call('PUT', u, b),
  patch: (u, b) => call('PATCH', u, b),
  del: (u) => call('DELETE', u)
}

/** 媒体上传（raw bytes + x-media-mime 头，非 JSON 通道）→ {id, sha256, bytes, name, mime} */
export async function uploadMedia(reqId, file) {
  const res = await fetch(`/api/requirements/${reqId}/media?name=${encodeURIComponent(file.name)}`, {
    method: 'POST',
    headers: { 'x-media-mime': file.type || 'application/octet-stream', ...authHeaders('POST') },
    body: file
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(data.error || data.message || ('上传失败 ' + res.status))
    err.data = data
    err.status = res.status
    throw err
  }
  return data
}

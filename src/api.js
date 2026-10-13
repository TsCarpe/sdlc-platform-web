async function call(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  })
  let data = {}
  try { data = await res.json() } catch { /* 空响应体 */ }
  if (!res.ok) {
    // 响应体与状态码随错误透出（如用例 409 的 conflicts 明细，TaskPanel 据此出裁决横幅）
    const err = new Error(data.error || ('请求失败 ' + res.status))
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
    headers: { 'x-media-mime': file.type || 'application/octet-stream' },
    body: file
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(data.error || ('上传失败 ' + res.status))
    err.data = data
    err.status = res.status
    throw err
  }
  return data
}

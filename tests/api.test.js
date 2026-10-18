// @vitest-environment jsdom
// 写令牌注入（P1-4）：非 GET 请求统一 X-Token，GET 不携带；localStorage 优先于 meta 注入。
import { describe, it, expect, beforeEach } from 'vitest'
import { getToken, setToken, authHeaders } from '../src/api.js'

beforeEach(() => {
  localStorage.clear()
  document.head.innerHTML = ''
})

describe('写令牌读取与注入', () => {
  it('未设置令牌：非 GET 也不携带 X-Token', () => {
    expect(getToken()).toBe('')
    expect(authHeaders('POST')).toEqual({})
    expect(authHeaders('DELETE')).toEqual({})
  })

  it('localStorage 令牌：非 GET 携带，GET 不携带', () => {
    setToken('secret-token')
    expect(getToken()).toBe('secret-token')
    expect(authHeaders('POST')).toEqual({ 'X-Token': 'secret-token' })
    expect(authHeaders('PUT')).toEqual({ 'X-Token': 'secret-token' })
    expect(authHeaders('DELETE')).toEqual({ 'X-Token': 'secret-token' })
    expect(authHeaders('GET')).toEqual({})
    expect(authHeaders()).toEqual({})
  })

  it('meta 注入兜底：无 localStorage 时读 <meta name="sdlc-token">', () => {
    const meta = document.createElement('meta')
    meta.setAttribute('name', 'sdlc-token')
    meta.setAttribute('content', 'meta-token')
    document.head.appendChild(meta)
    expect(getToken()).toBe('meta-token')
    setToken('stored-token')
    expect(getToken()).toBe('stored-token')   // localStorage 优先
  })

  it('清除令牌后不再携带', () => {
    setToken('x')
    setToken('')
    expect(getToken()).toBe('')
    expect(authHeaders('POST')).toEqual({})
  })
})

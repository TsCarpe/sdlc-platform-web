// @vitest-environment jsdom
// 迭代删除（空迭代物理删 / 绑定需求 409 由后端守卫）：入口只对空迭代行渲染。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

vi.mock('../src/confirm.js', () => ({ ask: vi.fn(async () => true) }))
vi.mock('../src/api.js', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() }
}))

const rows = [
  { name: 'feature/0923', note: '', createdAt: '2026-10-15 19:38', reqId: '' },   // 空迭代（名含 /）
  { name: 'v0.1-1019', note: '', createdAt: '2026-10-19 20:32', reqId: 'REQ-2026-1164', reqName: '区域成绩分析', reqStatus: 'clarifying' }
]

beforeEach(async () => {
  vi.clearAllMocks()
  const api = (await import('../src/api.js')).api
  api.get.mockImplementation(async url =>
    String(url).startsWith('/api/iterations') ? rows : [])
  api.del.mockResolvedValue({ ok: true })
})

describe('IterList：空迭代删除入口', () => {
  it('空迭代行渲染删除钮；绑定需求的行不渲染', async () => {
    const { default: IterList } = await import('../src/components/IterList.vue')
    const w = mount(IterList)
    await flushPromises()
    const dels = w.findAll('.row-del')
    expect(dels).toHaveLength(1)
    expect(dels[0].attributes('aria-label')).toBe('删除空迭代')
  })

  it('点击删除：danger 确认 → DELETE（迭代名含 / 编码进 query 参）→ 行移除', async () => {
    const { ask } = await import('../src/confirm.js')
    const api = (await import('../src/api.js')).api
    const { default: IterList } = await import('../src/components/IterList.vue')
    const w = mount(IterList)
    await flushPromises()
    await w.find('.row-del').trigger('click')
    await flushPromises()

    expect(ask).toHaveBeenCalledWith(expect.objectContaining({ danger: true, confirmText: '删除' }))
    expect(api.del).toHaveBeenCalledWith('/api/iterations/detail?name=' + encodeURIComponent('feature/0923'))
    expect(w.findAll('.iter-row')).toHaveLength(1)
    expect(w.find('.iter-row').text()).not.toContain('feature/0923')
  })

  it('确认框取消不发起删除', async () => {
    const { ask } = await import('../src/confirm.js')
    const api = (await import('../src/api.js')).api
    ask.mockResolvedValueOnce(false)
    const { default: IterList } = await import('../src/components/IterList.vue')
    const w = mount(IterList)
    await flushPromises()
    await w.find('.row-del').trigger('click')
    await flushPromises()
    expect(api.del).not.toHaveBeenCalled()
    expect(w.findAll('.iter-row')).toHaveLength(2)
  })

  it('DELETE 失败（如绑定态 409 文案）：toast err 且行保留', async () => {
    const api = (await import('../src/api.js')).api
    api.del.mockRejectedValueOnce(new Error('迭代已绑定需求 REQ-1（迭代与需求 1:1），先删除/移出需求再删迭代'))
    const { default: IterList } = await import('../src/components/IterList.vue')
    const w = mount(IterList)
    await flushPromises()
    await w.find('.row-del').trigger('click')
    await flushPromises()
    expect(w.findAll('.iter-row')).toHaveLength(2)
    expect(w.emitted('toast').at(-1)).toEqual(['迭代已绑定需求 REQ-1（迭代与需求 1:1），先删除/移出需求再删迭代', 'err'])
  })
})

// @vitest-environment jsdom
// P1-7：表单用例人工确认定稿 / 删除入口；sdlc-test 来源只读不显示这两个动作。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

vi.mock('../src/confirm.js', () => ({ ask: vi.fn(async () => true) }))
vi.mock('../src/api.js', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() },
  uploadMedia: vi.fn()
}))

const row = {
  reqId: 'REQ-1', id: 'WEB-001', title: '表单用例', points: '[]', priority: 'P1',
  status: 'draft', owner: 'qa', tool: '表单', version: 1, updatedAt: '', iter: 'it',
  reqName: 'n', caseNo: 1
}
const detail = {
  ...row, points: [], pre: '', steps: 's', expect: 'e', verifyRefs: [], defectRefs: [],
  comments: [], readonly: false
}

beforeEach(async () => {
  vi.clearAllMocks()
  const api = (await import('../src/api.js')).api
  api.get.mockImplementation(async url => {
    if (String(url).startsWith('/api/cases/')) return detail
    if (String(url).startsWith('/api/cases')) return [row]
    return []
  })
  api.patch.mockResolvedValue({ ...detail, status: 'reviewed', version: 2 })
  api.del.mockResolvedValue({ ok: true })
})

describe('CaseList：表单用例定稿与删除（P1-7）', () => {
  it('确认定稿调用 PATCH status=reviewed；删除调用 DELETE', async () => {
    const { default: CaseList } = await import('../src/components/CaseList.vue')
    const w = mount(CaseList, { props: { fixedReqId: 'REQ-1' } })
    await flushPromises()
    await w.find('tbody tr').trigger('click')
    await flushPromises()

    const review = w.findAll('.modal-f button').find(b => b.text().includes('确认定稿'))
    expect(review).toBeTruthy()
    await review.trigger('click')
    await flushPromises()
    const api = (await import('../src/api.js')).api
    expect(api.patch).toHaveBeenCalledWith('/api/cases/REQ-1/WEB-001',
                                           { status: 'reviewed', expectedVersion: 1 })

    const del = w.findAll('.modal-f button').find(b => b.text().includes('删除'))
    expect(del).toBeTruthy()
    await del.trigger('click')
    await flushPromises()
    expect(api.del).toHaveBeenCalledWith('/api/cases/REQ-1/WEB-001')
  })

  it('sdlc-test 只读用例不显示确认定稿/删除', async () => {
    const api = (await import('../src/api.js')).api
    api.get.mockImplementation(async url => {
      if (String(url).startsWith('/api/cases/')) return { ...detail, tool: 'sdlc-test', readonly: true }
      if (String(url).startsWith('/api/cases')) return [{ ...row, tool: 'sdlc-test' }]
      return []
    })
    const { default: CaseList } = await import('../src/components/CaseList.vue')
    const w = mount(CaseList, { props: { fixedReqId: 'REQ-1' } })
    await flushPromises()
    await w.find('tbody tr').trigger('click')
    await flushPromises()
    const footer = w.find('.modal-f').text()
    expect(footer).not.toContain('确认定稿')
    expect(footer).not.toContain('删除')
  })
})

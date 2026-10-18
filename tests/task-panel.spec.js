// @vitest-environment jsdom
// N-1：生命周期取消/作废的任务不显示「重试」（与后端 retry 白名单同源），可重试失败仍可重试。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

vi.mock('../src/confirm.js', () => ({ ask: vi.fn(async () => true) }))
vi.mock('../src/api.js', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() },
  uploadMedia: vi.fn()
}))

const failedTask = (id, type, reason) => ({
  id, reqId: 'REQ-1', type, status: 'failed', payload: '', runner: 'r', attempt: 0,
  createdBy: '', createdAt: '2026-10-01 10:00:00', updatedAt: '2026-10-01 10:00:00',
  result: JSON.stringify({ error: '失败原因', reason })
})

beforeEach(async () => {
  vi.clearAllMocks()
  const api = (await import('../src/api.js')).api
  api.get.mockImplementation(async url => {
    if (String(url).includes('/drafts')) return []
    if (String(url).includes('/tasks')) {
      return [failedTask(1, 'quality_check', 'cancelled'), failedTask(2, 'case_gen', 'agent-exception')]
    }
    return []
  })
})

describe('TaskPanel：终局失败的重试可见性', () => {
  it('cancelled 显示「已取消」且无重试；agent-exception 仍显示重试', async () => {
    const { default: TaskPanel } = await import('../src/components/TaskPanel.vue')
    const w = mount(TaskPanel, {
      props: {
        reqId: 'REQ-1', operator: '冒烟员',
        detail: { card: { id: 'REQ-1', status: 'clarifying' }, items: [], doc: { content: { blocks: [] } } }
      }
    })
    await flushPromises()
    expect(w.find('.taskpanel').classes()).not.toContain('tp-expanded')   // 折叠摘要态不设限高（小屏不被截断）
    // 展开/收起在同一位置：均为行尾（右对齐）最后一个控件
    expect(w.find('.tp-summary').element.lastElementChild)
      .toBe(w.find('.tp-summary .tp-expand').element)
    await w.find('.tp-summary').trigger('click')   // 展开管理（默认折叠摘要态）
    await flushPromises()
    expect(w.find('.taskpanel').classes()).toContain('tp-expanded')       // 展开态限高内部滚动（P1-12 方案2）
    expect(w.find('.tp-row').element.lastElementChild)
      .toBe(w.find('.tp-row .tp-collapse').element)

    const rows = w.findAll('.tp-task')
    const cancelled = rows.find(r => r.text().includes('已取消'))
    expect(cancelled).toBeTruthy()
    expect(cancelled.text()).not.toContain('重试')

    const retryable = rows.find(r => r.text().includes('用例生成'))
    expect(retryable).toBeTruthy()
    expect(retryable.text()).toContain('重试')
  })
})

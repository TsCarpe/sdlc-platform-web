// @vitest-environment jsdom
// v5.x 批3 专心化结构 + N-1：生命周期取消/作废的任务不显示「重试」（与后端 retry 白名单同源），
// 可重试失败仍可重试。历史默认折叠；进行中任务常显在折叠区外。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

vi.mock('../src/confirm.js', () => ({ ask: vi.fn(async () => true) }))
vi.mock('../src/api.js', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() },
  uploadMedia: vi.fn()
}))

const task = (id, type, status, reason = '') => ({
  id, reqId: 'REQ-1', type, status, payload: '', runner: 'r', attempt: 0,
  createdBy: '', createdAt: '2026-10-01 10:00:00', updatedAt: '2026-10-01 10:00:00',
  result: JSON.stringify({ error: '失败原因', reason })
})

beforeEach(() => { vi.clearAllMocks() })

describe('TaskPanel：终局失败的重试可见性（v5.x 批3 专心化结构）', () => {
  it('cancelled 显示「已取消」且无重试；agent-exception 仍显示重试；历史默认折叠、进行中常显', async () => {
    // v5.x：tasks/drafts 由壳层装载经 props 下发；草稿展示已归产物页签（面板无草稿区）
    const { default: TaskPanel } = await import('../src/components/TaskPanel.vue')
    const w = mount(TaskPanel, {
      props: {
        reqId: 'REQ-1', operator: '冒烟员',
        detail: { card: { id: 'REQ-1', status: 'clarifying' }, items: [], doc: { content: { blocks: [] } } },
        tasks: [task(1, 'quality_check', 'failed', 'cancelled'),
                task(2, 'case_gen', 'failed', 'agent-exception'),
                task(3, 'standard_doc', 'running')],
        drafts: {}
      }
    })
    await flushPromises()
    // 状态条常显单行；旧摘要/展开限高形态已移除；面板内不再有草稿区
    expect(w.find('.tp-bar').exists()).toBe(true)
    expect(w.find('.taskpanel').classes()).not.toContain('tp-expanded')
    expect(w.find('.draftbar').exists()).toBe(false)
    // 进行中任务常显（不在历史折叠区内）
    const active = w.findAll('.tp-task').find(r => r.text().includes('执行中'))
    expect(active).toBeTruthy()
    expect(active.element.closest('.tp-hist')).toBeNull()
    // 任务历史默认折叠，终态行收在折叠区
    const hist = w.find('.tp-hist')
    expect(hist.exists()).toBe(true)
    expect(hist.element.open).toBe(false)

    const rows = w.findAll('.tp-task')
    const cancelled = rows.find(r => r.text().includes('已取消'))
    expect(cancelled).toBeTruthy()
    expect(cancelled.text()).not.toContain('重试')

    const retryable = rows.find(r => r.text().includes('用例生成'))
    expect(retryable).toBeTruthy()
    expect(retryable.text()).toContain('重试')
  })

  it('导航型 CTA：待审草稿存在时按依赖顺序引导到对应页签（增量 > 摘要 > 标准文档 > 用例）', async () => {
    const { default: TaskPanel } = await import('../src/components/TaskPanel.vue')
    const draftRow = type => ({ reqId: 'REQ-1', type, md: '', contentJson: '{}', updatedAt: '2026-10-01 10:00:00' })
    const mountP = async (drafts, status) => {
      const w = mount(TaskPanel, {
        props: {
          reqId: 'REQ-1', operator: 't', tasks: [], drafts,
          detail: { card: { id: 'REQ-1', status }, items: [], doc: { content: { blocks: [] } } }
        }
      })
      await flushPromises()
      return w
    }
    const cta = w => w.find('.tp-actions .btn.primary')
    // changed 双草稿并存：增量采纳优先（堵发布）——防 409 反转（review P1-1）
    let w = await mountP({ incremental_bundle: draftRow('incremental_bundle'), standard: draftRow('standard') }, 'changed')
    expect(cta(w).text()).toContain('去变更采纳增量合并')
    await cta(w).trigger('click')
    expect(w.emitted('go-tab')).toEqual([['changes']])
    // 仅标准文档草稿（changed）：重新发布引导
    w = await mountP({ standard: draftRow('standard') }, 'changed')
    expect(cta(w).text()).toContain('去标准文档重新发布')
    // 用例草稿（published 后高发，无更高优先级草稿时）：登记引导补位（review P1-2）
    w = await mountP({ cases: draftRow('cases') }, 'published')
    expect(cta(w).text()).toContain('去用例登记草稿')
  })
})

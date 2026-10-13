// @vitest-environment jsdom
// v4 变更单冒烟：列表/详情呈现 + confirm 四类清单勾选增删（随 body.impact 提交）+ abort 门控
// + lifecycle changed 态（节点/卡点/CTA）。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

vi.mock('../src/confirm.js', () => ({ ask: vi.fn(async () => true) }))
vi.mock('../src/api.js', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() },
  uploadMedia: vi.fn()
}))

const listFixture = () => [
  { id: 3, kind: 'change', title: '口径修订', status: 'confirmed', proposedBy: '张三', confirmedBy: '李四', createdAt: '2026-10-14 09:00:00', confirmedAt: '2026-10-14 10:00:00' },
  { id: 2, kind: 'change', title: '早先单', status: 'draft', proposedBy: '张三', createdAt: '2026-10-13 09:00:00' },
  { id: 1, kind: 'reconcile', title: '存量对账', status: 'aborted', proposedBy: 'system', abortedBy: '李四', createdAt: '2026-10-12 09:00:00', abortedAt: '2026-10-12 10:00:00' }
]
const detailFixture = () => ({
  id: 3, reqId: 'REQ-1', kind: 'change', title: '口径修订', status: 'confirmed',
  proposedBy: '张三', confirmedBy: '李四', createdAt: '2026-10-14 09:00:00', confirmedAt: '2026-10-14 10:00:00',
  blocks: [{ id: 'b1', type: 'paragraph', text: '改后文本' }],
  items: [{ blockId: 'b1', op: 'edit', oldText: '原文', newText: '改后文本', oldAttrs: null, newAttrs: null }],
  counts: { edit: 1, insert: 0, delete: 0, move: 0 }
})
const impactFixture = () => ({
  changeId: 3, status: 'confirmed',
  blocks: ['b1'], sections: [{ headingId: 'h1', path: '背景' }],
  clarifyItems: [{ seq: 'L01', level: 'yellow', question: '口径歧义？', status: 'pending' },
    { seq: 'P1', level: 'blue', question: '另一问', status: 'answered' }],
  frPoints: [{ id: '需求.FR-01', name: '点一' }],
  cases: [{ id: 'TC-1', title: '用例一', frPoints: ['需求.FR-01'] }],
  digestRows: [{ kind: 'feature', anchor: 'b1', summary: '角色·模块：功能' }],
  counts: { blocks: 1, sections: 1, clarify: 2, frPoints: 1, cases: 1, digestRows: 1 }
})

let api
beforeEach(async () => {
  vi.clearAllMocks()
  api = (await import('../src/api.js')).api
})

const mountTab = async (card = { status: 'changed' }) => {
  const { default: ChangesTab } = await import('../src/components/ChangesTab.vue')
  const w = mount(ChangesTab, { props: { reqId: 'REQ-1', card, operator: '测试员', blocks: [] } })
  await flushPromises()
  return w
}

describe('ChangesTab：列表与状态呈现', () => {
  it('列表：类型/状态徽章与行点击进详情（diff 渲染）', async () => {
    api.get.mockImplementation(async url => {
      if (String(url).endsWith('/changes')) return listFixture()
      if (String(url).includes('/changes/3')) return detailFixture()
      return []
    })
    const w = await mountTab()
    expect(w.findAll('tbody tr').length).toBe(3)
    expect(w.text()).toContain('人工变更')
    expect(w.text()).toContain('重质检基准'.replace('重质检基准', '对账'))
    await w.findAll('tbody tr')[0].trigger('click')
    await flushPromises()
    expect(w.find('.bdiff').exists()).toBe(true)
    expect(w.text()).toContain('改后文本')
    // confirmed 单 + card.changed + 最新单 → 放弃按钮可用
    const abortBtn = w.findAll('button').find(b => b.text().includes('放弃变更'))
    expect(abortBtn).toBeTruthy()
  })

  it('aborted 非最新单 / published 卡：放弃按钮不渲染（LIFO + 状态门控）', async () => {
    api.get.mockImplementation(async url => {
      if (String(url).endsWith('/changes')) return listFixture()
      if (String(url).includes('/changes/3')) return detailFixture()
      return []
    })
    const w = await mountTab({ status: 'published' })   // 非 changed → 无 abort
    await w.findAll('tbody tr')[0].trigger('click')
    await flushPromises()
    expect(w.findAll('button').find(b => b.text().includes('放弃变更'))).toBeUndefined()
  })

  it('draft 单：编辑/删除/确认入口齐全', async () => {
    api.get.mockImplementation(async url => {
      if (String(url).endsWith('/changes')) return listFixture()
      if (String(url).includes('/changes/')) return { ...detailFixture(), id: 2, status: 'draft', confirmedBy: '', confirmedAt: null }
      return []
    })
    const w = await mountTab({ status: 'published' })
    await w.findAll('tbody tr')[1].trigger('click')
    await flushPromises()
    expect(w.findAll('button').find(b => b.text().includes('编辑'))).toBeTruthy()
    expect(w.findAll('button').find(b => b.text().includes('删除'))).toBeTruthy()
    expect(w.findAll('button').find(b => b.text().includes('确认变更'))).toBeTruthy()
  })
})

describe('ChangesTab：confirm 界面四类清单勾选', () => {
  const mountConfirm = async () => {
    api.get.mockImplementation(async url => {
      if (String(url).endsWith('/changes')) return listFixture()
      if (String(url).endsWith('/impact')) return impactFixture()
      if (String(url).includes('/changes/3')) {
        return { ...detailFixture(), status: 'draft', confirmedBy: '', confirmedAt: null }
      }
      return []
    })
    const w = await mountTab()
    await w.findAll('tbody tr')[0].trigger('click')
    await flushPromises()
    await w.findAll('button').find(b => b.text().includes('确认变更')).trigger('click')
    await flushPromises()
    return w
  }

  it('四类清单渲染机械预览值；取消勾选随 body.impact 提交', async () => {
    const w = await mountConfirm()
    expect(w.text()).toContain('影响面四类清单')
    expect(w.findAll('.impact-col').length).toBe(4)
    expect(w.text()).toContain('口径歧义？')
    // 取消 L01 勾选 → 提交 impact.clarifyItems 只剩 P1
    const boxes = w.findAll('.impact-row input[type="checkbox"]')
    await boxes[0].setValue(false)   // L01
    await w.findAll('button').find(b => b.text().includes('确认变更（应用块表）')).trigger('click')
    await flushPromises()
    const call = api.post.mock.calls.find(c => String(c[0]).endsWith('/confirm'))
    expect(call).toBeTruthy()
    const submitted = call[1].impact
    expect(submitted.clarifyItems.map(x => x.seq)).toEqual(['P1'])
    expect(submitted.frPoints.map(x => x.id)).toEqual(['需求.FR-01'])
    expect(submitted.counts.clarify).toBe(1)
    expect(call[1].confirmedBy).toBe('测试员')
  })
})

describe('lifecycle：changed 态推导', () => {
  it('nodesFromRow / blockerFromRow', async () => {
    const { nodesFromRow, blockerFromRow } = await import('../src/lifecycle.js')
    const row = { reqStatus: 'changed', designPhase: 'final', caseCount: 2, gateStage: 'active', answeredQ: 1, totalQ: 3 }
    const nodes = nodesFromRow(row)
    expect(nodes[1]).toEqual({ label: '澄清', st: 'doing' })   // 变更后澄清重开
    expect(nodes[2]).toEqual({ label: '发布', st: 'todo' })
    expect(blockerFromRow(row)).toEqual({ text: '变更处理中 · 待增量合并', cls: 'b-amber' })
  })
  it('nextActionCta：changed 未答完 → 澄清；答完 → 去发布', async () => {
    const { nextActionCta } = await import('../src/lifecycle.js')
    const items = n => Array.from({ length: n }, () => ({ status: 'pending' }))
    const done = n => Array.from({ length: n }, () => ({ status: 'answered' }))
    expect(nextActionCta({ card: { status: 'changed' }, items: [...done(2), ...items(1)] }, null, null).go).toBe('tab:checklist')
    const cta = nextActionCta({ card: { status: 'changed' }, items: done(2) }, null, null)
    expect(cta.go).toBe('tab:changes')
  })
})

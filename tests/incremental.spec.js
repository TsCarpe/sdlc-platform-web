// @vitest-environment jsdom
// v4.14 增量合并草稿采纳面冒烟：预览渲染（章节/新行/作废/澄清）+ approve 端点（携带采纳人）。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

vi.mock('../src/confirm.js', () => ({ ask: vi.fn(async () => true) }))
vi.mock('../src/api.js', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() },
  uploadMedia: vi.fn()
}))

const bundle = () => ({
  changeId: 162,
  sections: ['h-1'],
  digestRows: {
    features: [{ anchor: 'g-p1', name: '新功能点甲' }],
    flows: [], states: [],
    auditItems: [{ id: 'P9', level: 'yellow', title: '新增体检项' }],
    frUpserts: [{ id: '需求.FR-09', name: '新需求点', anchor: 'g-p1' }],
    frRemoves: ['需求.FR-02']
  },
  invalidate: { digestAnchors: ['旧锚点-a'], auditIds: ['P2'] },
  clarify: { items: [{ anchor: 'g-p1', level: 'yellow', question: '增量澄清一' }] },
  summary: '按新口径重写第一节',
  riskTier: 'C'
})

const detail = () => ({
  card: { id: 'REQ-1', status: 'changed' },
  items: [{ seq: 'L01', status: 'answered' }],
  doc: { content: { blocks: [{ id: 'h-1', type: 'heading', level: 2, text: '背景与边界' }] } }
})

let api
beforeEach(async () => {
  vi.clearAllMocks()
  api = (await import('../src/api.js')).api
  api.get.mockImplementation(async url => {
    if (String(url).includes('/drafts')) {
      return [{ reqId: 'REQ-1', type: 'incremental_bundle', md: '', contentJson: JSON.stringify(bundle()) }]
    }
    if (String(url).includes('/tasks')) return []
    return []
  })
  api.post.mockResolvedValue({ ok: true, changeId: 162, removedRows: 2, newRows: 3 })
})

const mountPanel = async () => {
  const { default: TaskPanel } = await import('../src/components/TaskPanel.vue')
  const w = mount(TaskPanel, { props: { reqId: 'REQ-1', detail: detail(), operator: '冒烟员' } })
  await flushPromises()
  return w
}

describe('TaskPanel：增量合并草稿', () => {
  it('预览渲染：章节文本解析 / 新行表 / 移除作废 / 新澄清 / 统计', async () => {
    const w = await mountPanel()
    const draft = w.findAll('.tp-draft').find(d => d.text().includes('增量合并草稿'))
    expect(draft).toBeTruthy()
    expect(draft.text()).toContain('变更单 #162')
    expect(draft.text()).toContain('背景与边界')          // sections heading 文本解析
    expect(draft.text()).toContain('按新口径重写第一节')
    expect(draft.text()).toContain('新功能点甲')           // features 行
    expect(draft.text()).toContain('新增体检项')           // auditItems 行
    expect(draft.text()).toContain('增量澄清一')           // clarify
    expect(draft.text()).toContain('需求.FR-02')          // frRemoves
    expect(draft.text()).toContain('旧锚点-a')             // invalidate
  })

  it('采纳：POST approve 携带采纳人；成功 toast 带合并统计', async () => {
    const w = await mountPanel()
    const btn = w.findAll('button').find(b => b.text().includes('采纳（服务端机械合并）'))
    await btn.trigger('click')
    await flushPromises()
    expect(api.post).toHaveBeenCalledWith('/api/requirements/REQ-1/drafts/incremental_bundle/approve', { by: '冒烟员' })
    const toast = w.emitted('toast')[0][0]
    expect(toast).toContain('移除 2 行')
    expect(toast).toContain('写入 3 行')
    expect(w.emitted('refresh')).toBeTruthy()
  })

  it('contentJson 损坏：显示不可解析提示且不炸', async () => {
    api.get.mockImplementation(async url => {
      if (String(url).includes('/drafts')) {
        return [{ reqId: 'REQ-1', type: 'incremental_bundle', md: '', contentJson: '{oops' }]
      }
      return []
    })
    const w = await mountPanel()
    expect(w.text()).toContain('不可解析')
  })
})

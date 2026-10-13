// @vitest-environment jsdom
// v4 P0 编辑器冒烟：BlockEditor 渲染/编辑态/菜单操作/校验 + OriginTab 编辑保存流闭环
// （编辑 → POST blocks/diff 预览 → 确认 → PUT blocks → emit reload）。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

vi.mock('../src/confirm.js', () => ({ ask: vi.fn(async () => true) }))
vi.mock('../src/api.js', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() },
  uploadMedia: vi.fn()
}))

const blocks = () => [
  { id: 'fs-title', type: 'title', text: '需求标题' },
  { id: 'fs-h1', type: 'heading', level: 2, text: '背景' },
  { id: 'fs-p1', type: 'paragraph', text: '一段说明', path: 'x', comments: 'c1' },
  { id: 'fs-li0', type: 'list-item', marker: '•', depth: 0, parent: 'fs-p1', text: '列表项一' },
  { id: 'fs-li1', type: 'list-item', marker: '•', depth: 1, parent: 'fs-li0', text: '嵌套项' }
]

const mountEditor = () => mount(BlockEditor, { props: { reqId: 'REQ-1', blocks: blocks() } })
let BlockEditor
beforeEach(async () => {
  vi.clearAllMocks()
  BlockEditor = (await import('../src/components/BlockEditor.vue')).default
})

describe('BlockEditor：渲染态与单块编辑态', () => {
  it('渲染全量内容块（comment 已滤）；DocBlock 单块渲染带锚点', () => {
    const w = mountEditor()
    expect(w.findAll('.bedit-row')).toHaveLength(5)
    expect(w.find('[data-blk="fs-p1"]').exists()).toBe(true)
  })

  it('点击段落进入编辑态，改动经 focusout 落缓冲，getPayload 输出清洗后的全量数组', async () => {
    const w = mountEditor()
    await w.findAll('.bedit-body')[2].trigger('click')   // fs-p1
    expect(w.find('.bedit-edit textarea').exists()).toBe(true)
    await w.find('.bedit-edit textarea').setValue('改过的说明')
    await w.find('.bedit-edit').trigger('focusout')      // relatedTarget 空 → 提交
    const r = w.vm.getPayload()
    expect(r.ok).toBe(true)
    const p1 = r.blocks.find(b => b.id === 'fs-p1')
    expect(p1.text).toBe('改过的说明')
    expect(p1.path).toBeUndefined()     // 派生键已剥
    expect(p1.comments).toBeUndefined()
    expect(w.vm.isDirty()).toBe(true)
  })

  it('编辑态 Esc 退出；渲染态恢复显示新文本', async () => {
    const w = mountEditor()
    await w.findAll('.bedit-body')[2].trigger('click')
    await w.find('.bedit-edit textarea').setValue('Esc 落盘')
    await w.find('.bedit-edit textarea').trigger('keydown.esc')
    expect(w.find('.bedit-edit').exists()).toBe(false)
    expect(w.find('[data-blk="fs-p1"]').text()).toContain('Esc 落盘')
  })

  it('块菜单删除 list 父项：子项上提进 payload（parent 改指）', async () => {
    const w = mountEditor()
    // fs-li0 行（第 4 块）的「块操作」手柄（第 3 个按钮）
    await w.findAll('.bedit-row')[3].findAll('.bedit-handle button')[2].trigger('click')
    const del = w.findAll('.bedit-menu button').find(b => b.text().includes('删除'))
    await del.trigger('click')
    const r = w.vm.getPayload()
    expect(r.blocks.some(b => b.id === 'fs-li0')).toBe(false)
    expect(r.blocks.find(b => b.id === 'fs-li1').parent).toBe('fs-p1')
  })

  it('本地校验失败：getPayload 不通过且行内标红', async () => {
    const w = mount(BlockEditor, { props: { reqId: 'REQ-1', blocks: [
      { id: 'a', type: 'paragraph', text: 'x' },
      { id: 'b', type: 'list-item', parent: 'ghost', text: '孤儿块' }
    ] } })
    const r = w.vm.getPayload()
    expect(r.ok).toBe(false)
    expect(r.problems[0].msg).toContain('ghost')
    await flushPromises()
    expect(w.find('.bedit-problem').text()).toContain('ghost')
  })
})

describe('OriginTab：编辑入口与保存流闭环', () => {
  const OriginTabFixture = async () => {
    const { default: OriginTab } = await import('../src/components/OriginTab.vue')
    const { api } = await import('../src/api.js')
    return { OriginTab, api }
  }
  const props = (status = 'clarifying') => ({
    card: { id: 'REQ-1', status, sourceType: 'text', sourceText: 'x', sourceUrl: '' },
    snapshot: { md: '# 快照', at: '2026-10-01 10:00:00' },
    doc: { content: { blocks: blocks(), media: [] } }
  })

  it('未发布卡显示编辑入口；changed 显示变更中横幅且无入口', async () => {
    const { OriginTab } = await OriginTabFixture()
    const w = mount(OriginTab, { props: props('clarifying') })
    expect(w.find('.edit-tools').exists()).toBe(true)
    const w2 = mount(OriginTab, { props: props('changed') })
    expect(w2.find('.edit-tools').exists()).toBe(false)
    expect(w2.text()).toContain('变更中')
    const w3 = mount(OriginTab, { props: props('published') })
    expect(w3.find('.edit-tools').exists()).toBe(false)
  })

  it('保存流：diff 预览弹层 → 确认 → PUT blocks → emit reload 退出编辑', async () => {
    const { OriginTab, api } = await OriginTabFixture()
    const { flushPromises } = await import('@vue/test-utils')
    api.post.mockResolvedValue({
      items: [{ blockId: 'fs-p1', op: 'edit', oldText: '一段说明', newText: '新说明', oldAttrs: null, newAttrs: null }],
      counts: { edit: 1, insert: 0, delete: 0, move: 0 }
    })
    api.put.mockResolvedValue({
      items: [{ blockId: 'fs-p1', op: 'edit', oldText: '一段说明', newText: '新说明', oldAttrs: null, newAttrs: null }],
      counts: { edit: 1, insert: 0, delete: 0, move: 0 }
    })
    const w = mount(OriginTab, { props: props() })
    await w.find('.edit-tools button').trigger('click')
    expect(w.find('.bedit-topbar').exists()).toBe(true)
    await w.find('.bedit-topbar input').setValue('测试员')
    await w.findAll('.bedit-body')[2].trigger('click')
    await w.find('.bedit-edit textarea').setValue('新说明')
    await w.find('.bedit-edit').trigger('focusout')
    await w.find('.bedit-topbar .btn.primary').trigger('click')
    await flushPromises()
    expect(api.post).toHaveBeenCalledWith('/api/requirements/REQ-1/blocks/diff',
      expect.objectContaining({ updatedBy: '测试员' }))
    expect(w.find('.bdiff-modal').exists()).toBe(true)
    expect(w.find('.bdiff-modal').text()).toContain('新说明')
    await w.find('.bdiff-modal .btn.primary').trigger('click')
    await flushPromises()
    expect(api.put).toHaveBeenCalledWith('/api/requirements/REQ-1/blocks',
      expect.objectContaining({ updatedBy: '测试员' }))
    expect(w.emitted('reload')).toHaveLength(1)
    expect(w.emitted('toast')[0][0]).toContain('原文已保存')
    expect(w.find('.bedit-topbar').exists()).toBe(false)         // 已退出编辑
    expect(w.find('.banner.amber-t').exists()).toBe(true)        // 质检已过期横幅
  })

  it('diff 为空（无变更）不弹预览且提示', async () => {
    const { OriginTab, api } = await OriginTabFixture()
    const { flushPromises } = await import('@vue/test-utils')
    api.post.mockResolvedValue({ items: [], counts: { edit: 0, insert: 0, delete: 0, move: 0 } })
    const w = mount(OriginTab, { props: props() })
    await w.find('.edit-tools button').trigger('click')
    await w.find('.bedit-topbar input').setValue('测试员')
    await w.find('.bedit-topbar .btn.primary').trigger('click')
    await flushPromises()
    expect(w.find('.bdiff-modal').exists()).toBe(false)
    expect(w.emitted('toast')[0][0]).toContain('无内容变更')
  })
})

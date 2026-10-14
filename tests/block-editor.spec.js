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

// ===== v4.1 行卡片层级数据（parse_doc 0.5 形状）：渲染 / 行编辑 / 行内插入 / mini 表格 =====

// table-row（head 非空、cells 含空串内容格）+ 段落子块（cell:3，1 个 subheading）+ 2 个 li（cell:3）+ image（cell:4）
const rowBlocks = () => [
  { id: 'fs-h1', type: 'heading', level: 2, text: '需求详情' },
  { id: 'r1', type: 'table-row', rowLabel: '1',
    head: ['序号', '优先级', '功能模块', '需求描述', '原型图'], cells: ['1', 'P0', '教研活动', '', ''] },
  { id: 'rp1', type: 'paragraph', parent: 'r1', cell: 3, subheading: true, text: '**活动创建**' },
  { id: 'rp2', type: 'paragraph', parent: 'r1', cell: 3, text: 'PC端' },
  { id: 'rli1', type: 'list-item', parent: 'r1', cell: 3, marker: '1.', text: '条款一' },
  { id: 'rli2', type: 'list-item', parent: 'r1', cell: 3, marker: '2.', text: '条款二' },
  { id: 'rimg1', type: 'image', parent: 'r1', cell: 4, media: 'm-1', caption: '原型图一', text: '' }
]

describe('OriginTab：行卡片层级渲染（v4.1）', () => {
  const mountOrigin = async (blocks) => {
    const { default: OriginTab } = await import('../src/components/OriginTab.vue')
    return mount(OriginTab, { props: {
      card: { id: 'REQ-1', status: 'published', sourceType: 'text', sourceText: 'x', sourceUrl: '' },
      snapshot: null,
      doc: { content: { blocks, media: [] } }
    } })
  }

  it('行卡：卡头轻 chip（P0 优先级变体）+ 内容格组名 + leadgrp 挂靠 + 图廊 + ▍小标题', async () => {
    const w = await mountOrigin(rowBlocks())
    expect(w.find('.rowcard').exists()).toBe(true)
    const chips = w.findAll('.rc-chip')
    expect(chips.map(c => c.text())).toEqual(['P0', '教研活动'])
    expect(chips[0].classes()).toContain('pri')
    expect(chips[0].classes()).toContain('p0')
    expect(w.findAll('.gname').map(g => g.text())).toEqual(['需求描述', '原型图'])
    expect(w.find('.docblk-sub').text()).toContain('活动创建')
    const lead = w.find('.leadgrp')
    expect(lead.text()).toContain('PC端')
    expect(lead.text()).toContain('条款一')
    expect(w.find('.gal .imgcard').exists()).toBe(true)
    expect(w.find('.gal figcaption').text()).toContain('原型图一')
    expect(w.text()).not.toContain('列1')   // 「列N」自造标签兜底已删除
  })

  it('全标量小表聚合为 mini 表格，tr[data-blk] 可 querySelector 命中（锚点/目录定位）', async () => {
    const w = await mountOrigin([
      { id: 'fs-h2', type: 'heading', level: 2, text: '文档变更' },
      { id: 't1', type: 'table-row', rowLabel: '1', head: ['版本', '日期', '内容'], cells: ['V1', '2026年7月9日', '拆分出部分需求'] },
      { id: 't2', type: 'table-row', rowLabel: '2', head: ['版本', '日期', '内容'], cells: ['V2', '2026年10月1日', '优化'] },
      { id: 'p-after', type: 'paragraph', text: '表后段' }
    ])
    expect(w.find('table.mini').exists()).toBe(true)
    expect(w.findAll('table.mini thead th').map(t => t.text())).toEqual(['版本', '日期', '内容'])
    expect(w.element.querySelector('tr[data-blk="t2"]')).not.toBeNull()
    expect(w.find('[data-blk="p-after"]').exists()).toBe(true)   // 表后块照旧渲染
  })
})

describe('BlockEditor：table-row 行编辑（v4.1 内容列只读）', () => {
  const mountRowEditor = async () => {
    const Editor = (await import('../src/components/BlockEditor.vue')).default
    return mount(Editor, { props: { reqId: 'REQ-1', blocks: rowBlocks() } })
  }

  it('标量列 textarea 可编辑；内容列（有段落子块）只读提示 + 删列置灰，cells 值原样保留', async () => {
    const w = await mountRowEditor()
    await w.findAll('.bedit-body')[1].trigger('click')   // r1 行表单
    const ta = w.find('textarea[name="blk-cell-1"]')    // 优先级列（标量）
    expect(ta.exists()).toBe(true)
    expect(w.find('textarea[name="blk-cell-3"]').exists()).toBe(false)   // 需求描述列 = 内容列
    expect(w.findAll('.bedit-cell .cellro')).toHaveLength(2)             // 需求描述 + 原型图
    const roCell = w.findAll('.bedit-cell')[3]
    expect(roCell.text()).toContain('长文内容在下方段落块中编辑')
    expect(roCell.find('button').attributes('disabled')).toBeDefined()
    await ta.setValue('P1')
    await w.find('.bedit-edit').trigger('focusout')
    const r = w.vm.getPayload()
    const r1 = r.blocks.find(b => b.id === 'r1')
    expect(r1.cells).toEqual(['1', 'P1', '教研活动', '', ''])   // 内容列空串原样保留
  })

  it('行内插入 paragraph：payload parent=rowId + 继承锚块 cell 锚', async () => {
    const w = await mountRowEditor()
    await w.findAll('.bedit-row')[2].findAll('.bedit-handle button')[1].trigger('click')   // rp1 的「+」
    const ins = w.findAll('.bedit-menu button').find(b => b.text().includes('插入段落'))
    await ins.trigger('click')
    const r = w.vm.getPayload()
    const nb = r.blocks.find(b => b.id.startsWith('tmp-'))
    expect(nb).toMatchObject({ type: 'paragraph', parent: 'r1', cell: 3 })
    expect(r.ok).toBe(true)
  })

  it('追加列（head/cells 变长）不重排已有子块 cell 锚', async () => {
    const w = await mountRowEditor()
    await w.findAll('.bedit-body')[1].trigger('click')
    await w.find('.bedit-toolbar button').trigger('click')   // + 列
    await w.find('.bedit-edit').trigger('focusout')
    const r = w.vm.getPayload()
    const r1 = r.blocks.find(b => b.id === 'r1')
    expect(r1.head).toHaveLength(6)
    expect(r1.cells).toHaveLength(6)
    expect(r.blocks.find(b => b.id === 'rp1').cell).toBe(3)
    expect(r.blocks.find(b => b.id === 'rimg1').cell).toBe(4)
  })
})

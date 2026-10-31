// @vitest-environment jsdom
// v4.2 阅读形态结构补偿的 OriginTab DOM 级回归：同头无锚点行聚合 mini 表格（长格/空格不限）、
// 锚点宿主行（pendingByBlock/platformByBlock）回落行卡保住 pill/评论角标、连续媒体 run ≥2 图廊、
// 单元格行内 md 渲染。夹具形状对齐 parse_doc 产物（head 非空、cells 与列数等长）。
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import OriginTab from '../src/components/OriginTab.vue'

const blocks = () => ([
  { id: 't1', type: 'title', text: '测试需求' },
  { id: 'h1', type: 'heading', level: 1, text: '一、功能清单' },
  { id: 'r1', type: 'table-row', rowLabel: '教师', head: ['角色', '说明'], cells: ['教师', '**核心**角色'] },
  { id: 'r2', type: 'table-row', rowLabel: '管理员', head: ['角色', '说明'], cells: ['管理员', ''] },
  { id: 'r3', type: 'table-row', rowLabel: '访客', head: ['角色', '说明'], cells: ['访客', '普通'] },
  { id: 'p1', type: 'paragraph', text: '原型图如下' },
  { id: 'img1', type: 'image', media: 'm1' },
  { id: 'img2', type: 'image', media: 'm2' },
  { id: 'img3', type: 'image', media: 'm3' }
])

const mountTab = (extraProps = {}) => mount(OriginTab, {
  props: {
    card: { id: 'REQ-1', sourceType: 'text', status: 'published' },
    doc: { content: { blocks: blocks(), media: [] } },
    ...extraProps
  }
})

describe('OriginTab：v4.2 结构补偿渲染', () => {
  it('同头无锚点行聚合 mini 表格（长格/空格不限），锚点宿主行回落行卡且 pill 在', () => {
    const w = mountTab({ pendingByBlock: { r3: ['P05'] } })
    const tbls = w.findAll('table.mini tbody')
    expect(tbls).toHaveLength(1)
    expect(tbls[0].findAll('tr').map(tr => tr.attributes('data-blk'))).toEqual(['r1', 'r2'])
    // r3 是待澄清锚点宿主 → 行卡形态 + 待澄清 pill（进矩阵表会丢交互入口）
    const r3 = w.find('[data-blk="r3"]')
    expect(r3.classes()).toContain('rowcard')
    expect(r3.find('.ref-pill').exists()).toBe(true)
  })

  it('platformByBlock 宿主行同样回落行卡（评论角标不丢）', () => {
    const w = mountTab({ platformByBlock: { r1: 2 } })
    expect(w.find('[data-blk="r1"]').classes()).toContain('rowcard')
    expect(w.findAll('table.mini tbody')[0].findAll('tr').map(tr => tr.attributes('data-blk'))).toEqual(['r2', 'r3'])
  })

  it('连续媒体 run ≥2 渲染图廊（块 data-blk 与灯箱媒体 URL 保持）', () => {
    const w = mountTab()
    const gals = w.findAll('.docstruct > .gal, .docsec > .gal')
    expect(gals).toHaveLength(1)
    expect(gals[0].findAll('[data-blk]').map(el => el.attributes('data-blk'))).toEqual(['img1', 'img2', 'img3'])
    expect(gals[0].find('img').attributes('src')).toBe('/api/requirements/REQ-1/media/m1')
  })

  it('mini 表格单元格行内 md 渲染（**粗** → <b>），首列含 hover 发评按钮', () => {
    const w = mountTab()
    const td = w.find('table.mini tbody tr[data-blk="r1"] td:last-of-type')
    expect(td.find('strong').text()).toBe('核心')
    const first = w.find('table.mini tbody tr[data-blk="r1"] td:first-child')
    expect(first.find('button.rowc').exists()).toBe(true)
  })
})

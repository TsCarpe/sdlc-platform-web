// docview.js 纯函数单测（v4.1 层级还原渲染层）：全标量小表聚合 / D1 标量分流 / cell 分组 + lead 挂靠。
// 夹具形状对齐 parse_doc 0.5 产物（head 非空、cells 与列数等长、内容格空串、行内子块带 cell 锳）。
import { describe, it, expect } from 'vitest'
import { partitionRows, splitRowScalars, groupRowChildren, mdPlain, docTocOf, tocIndex } from '../src/docview.js'

const row = (id, head, cells, extra = {}) =>
  ({ id, type: 'table-row', rowLabel: id, head, cells, ...extra })

describe('partitionRows：全标量小表聚合', () => {
  it('连续纯标量同 head 行聚合为 table run（head 随 run 携带），其余块照旧', () => {
    const parts = partitionRows([
      { id: 'p0', type: 'paragraph', text: '前言' },
      row('r1', ['版本', '日期'], ['V1', '2026年7月9日']),
      row('r2', ['版本', '日期'], ['V2', '2026年10月1日']),
      { id: 'p1', type: 'paragraph', text: '表后段' }
    ])
    expect(parts).toHaveLength(3)
    expect(parts[0]).toEqual({ kind: 'block', block: { id: 'p0', type: 'paragraph', text: '前言' } })
    expect(parts[1].kind).toBe('table')
    expect(parts[1].head).toEqual(['版本', '日期'])
    expect(parts[1].rows.map(r => r.id)).toEqual(['r1', 'r2'])
    expect(parts[2].block.id).toBe('p1')
  })

  it('head 空数组（旧数据）不断聚合 → 单块回落行卡', () => {
    const parts = partitionRows([
      row('r1', [], ['旧长文本一']),
      row('r2', [], ['旧长文本二'])
    ])
    expect(parts.every(p => p.kind === 'block')).toBe(true)
    expect(parts.map(p => p.block.id)).toEqual(['r1', 'r2'])
  })

  it('cells 含空串（内容格）断开聚合 → 内容行回落行卡，后继行可独立成单行表', () => {
    const parts = partitionRows([
      row('r1', ['a', 'b'], ['x', '']),
      row('r2', ['a', 'b'], ['y', 'z'])
    ])
    expect(parts).toHaveLength(2)
    expect(parts[0].kind).toBe('block')            // r1 有内容格 → 行卡
    expect(parts[1].kind).toBe('table')            // r2 纯标量 → 单行表
    expect(parts[1].rows.map(r => r.id)).toEqual(['r2'])
  })

  it('有行内子块断开聚合（childCountBy 计数）', () => {
    const parts = partitionRows(
      [row('r1', ['a'], ['x']), row('r2', ['a'], ['y'])],
      new Map([['r1', 2]])
    )
    expect(parts).toHaveLength(2)
    expect(parts[0].kind).toBe('block')          // r1 有子块 → 行卡
    expect(parts[1].kind).toBe('table')          // r2 无子块 → 仍可独立成单行表
  })

  it('head 逐项不同断开聚合（相邻两张表各成 run）', () => {
    const parts = partitionRows([
      row('r1', ['版本', '日期'], ['V1', '7月9日']),
      row('r2', ['版本', '时间'], ['V2', '10月1日'])
    ])
    expect(parts).toHaveLength(2)
    expect(parts[0]).toMatchObject({ kind: 'table', head: ['版本', '日期'] })
    expect(parts[1]).toMatchObject({ kind: 'table', head: ['版本', '时间'] })
  })

  it('行块带评论引用不聚合（保持可锚定行卡）', () => {
    const parts = partitionRows([row('r1', ['a'], ['x'], { comments: 'c1 c2' })])
    expect(parts[0].kind).toBe('block')
  })
})

describe('splitRowScalars：D1 标量分流', () => {
  it('第 2 列起连续短标量进 headerVals（至多 2 列只显值），内容格空串不落 meta', () => {
    const r = splitRowScalars(row('1', ['序号', '优先级', '功能模块', '需求描述', '原型图'],
      ['1', 'P0', '教研活动', '', '']))
    expect(r.headerVals).toEqual(['P0', '教研活动'])
    expect(r.metaPairs).toEqual([])
  })

  it('前缀在长值处截断：日期长值落 meta，其后列不再进 headerVals', () => {
    const r = splitRowScalars(row('1', ['序号', '版本', '日期', '内容'],
      ['1', 'V1', '2026年7月9日', '拆分出部分需求']))
    expect(r.headerVals).toEqual(['V1'])
    expect(r.metaPairs).toEqual([
      { label: '日期', value: '2026年7月9日', idx: 2 },
      { label: '内容', value: '拆分出部分需求', idx: 3 }
    ])
  })

  it('2 列上限截断：跳过的短列落 meta（label 为表头）', () => {
    const r = splitRowScalars(row('1', ['序号', '优先级', '模块', '备注'], ['1', 'P0', '教研', '上线']))
    expect(r.headerVals).toEqual(['P0', '教研'])
    expect(r.metaPairs).toEqual([{ label: '备注', value: '上线', idx: 3 }])
  })

  it('head 空数组（旧数据）：全部非空列落 meta 无标签（含第 1 列）', () => {
    const r = splitRowScalars(row('1', [], ['1', '旧长文本格']))
    expect(r.headerVals).toEqual([])
    expect(r.metaPairs).toEqual([
      { label: '', value: '1', idx: 0 },
      { label: '', value: '旧长文本格', idx: 1 }
    ])
  })

  it('第 1 列不进 headerVals/meta（rowLabel 即其值）；head 标签空的列只显值', () => {
    const r = splitRowScalars(row('1', ['序号', '优先级', ''], ['1', 'P1', '无表头值']))
    expect(r.headerVals).toEqual(['P1'])
    expect(r.metaPairs).toEqual([{ label: '', value: '无表头值', idx: 2 }])
  })
})

describe('groupRowChildren：cell 分组 + 尾部图廊 + lead 挂靠', () => {
  const head = ['序号', '优先级', '功能模块', '需求描述', '原型图']

  it('按 cell 键分组（无键归 -1 排最前，其余按列序），label 取列表头', () => {
    const groups = groupRowChildren([
      { id: 'img4', type: 'image', cell: 4 },
      { id: 'old', type: 'list-item', text: '无戳旧块' },
      { id: 'p1', type: 'paragraph', cell: 3, text: 'PC端' }
    ], head)
    expect(groups.map(g => g.cellIdx)).toEqual([-1, 3, 4])
    expect(groups[0].label).toBe('')
    expect(groups[1].label).toBe('需求描述')
    expect(groups[2].label).toBe('原型图')
  })

  it('组内尾部连续媒体块切进 gallery，中间媒体块留在 tree', () => {
    const groups = groupRowChildren([
      { id: 'p1', type: 'paragraph', cell: 3, text: '段' },
      { id: 'imgmid', type: 'image', cell: 3 },
      { id: 'li1', type: 'list-item', cell: 3, text: '条款' },
      { id: 'img1', type: 'image', cell: 3 },
      { id: 'img2', type: 'attachment', cell: 3 }
    ], head)
    expect(groups).toHaveLength(1)
    expect(groups[0].tree.map(it => it.block.id)).toEqual(['p1', 'imgmid', 'li1'])
    expect(groups[0].gallery.map(b => b.id)).toEqual(['img1', 'img2'])
  })

  it('连续 li run 挂靠最近非 subheading 前驱段落（lead 项重组）', () => {
    const groups = groupRowChildren([
      { id: 'sub1', type: 'paragraph', cell: 3, subheading: true, text: '**活动创建**' },
      { id: 'lead1', type: 'paragraph', cell: 3, text: 'PC端' },
      { id: 'li1', type: 'list-item', cell: 3, text: '一' },
      { id: 'li2', type: 'list-item', cell: 3, text: '二' }
    ], head)
    const items = groups[0].tree
    expect(items).toHaveLength(2)
    expect(items[0]).toEqual({ kind: 'block', block: { id: 'sub1', type: 'paragraph', cell: 3, subheading: true, text: '**活动创建**' } })
    expect(items[1].kind).toBe('lead')
    expect(items[1].block.id).toBe('lead1')
    expect(items[1].listChildren.map(b => b.id)).toEqual(['li1', 'li2'])
  })

  it('subheading 段落与列表开头无前驱 → 不做 lead，li 保持独立块', () => {
    const groups = groupRowChildren([
      { id: 'sub1', type: 'paragraph', cell: 3, subheading: true, text: '**小标题**' },
      { id: 'li1', type: 'list-item', cell: 3, text: '紧跟小标题的列表' },
      { id: 'lead1', type: 'paragraph', cell: 3, text: 'H5端' },
      { id: 'img1', type: 'image', cell: 3 }
    ], head)
    const items = groups[0].tree
    expect(items.every(it => it.kind === 'block')).toBe(true)
    expect(items.map(it => it.block.id)).toEqual(['sub1', 'li1', 'lead1'])
  })
})

describe('mdPlain：块文本 md 行内源码 → 纯文本标签', () => {
  it('剥粗体/删除线/行内代码标记，内容保留', () => {
    expect(mdPlain('**顶部按钮图配置**')).toBe('顶部按钮图配置')
    expect(mdPlain('~~废弃说法~~')).toBe('废弃说法')
    expect(mdPlain('字段 `status` 限定')).toBe('字段 status 限定')
    expect(mdPlain('*斜体强调*')).toBe('斜体强调')
  })

  it('链接/图片留锚文本，行内 HTML 标签剥除', () => {
    expect(mdPlain('见[配置说明](https://x.com/a)详情')).toBe('见配置说明详情')
    expect(mdPlain('![登录页截图](https://x.com/i.png)')).toBe('登录页截图')
    expect(mdPlain('换行<br>后的文本')).toBe('换行后的文本')
  })

  it('不成对孤立标记与词内下划线原样保留（snake_case 不误伤）', () => {
    expect(mdPlain('user_id 字段')).toBe('user_id 字段')
    expect(mdPlain('费率上限 0.8*')).toBe('费率上限 0.8*')
  })

  it('空值兜底空串', () => {
    expect(mdPlain('')).toBe('')
    expect(mdPlain(null)).toBe('')
    expect(mdPlain(undefined)).toBe('')
  })
})

describe('docTocOf / tocIndex：目录提取与章节归属（v5.3）', () => {
  const blocks = [
    { id: 'p0', type: 'paragraph', text: '前言段' },
    { id: 't1', type: 'title', text: '**区域成绩分析**v0.1' },
    { id: 'h1', type: 'heading', level: 1, text: '一、修订记录' },
    { id: 'p1', type: 'paragraph', text: '段一' },
    { id: 'h2', type: 'heading', level: 2, text: '1.1 小节' },
    { id: 'r1', type: 'table-row', rowLabel: '补充说明页' },
    { id: 'rv', type: 'table-row', rowLabel: '1.0.1' },          // 版本号形态 → 不入目录
    { id: 'h3', type: 'heading', level: 1, text: '二、需求背景' },
    { id: 'p2', type: 'paragraph', text: '尾段' },
  ]
  const toc = docTocOf(blocks)

  it('heading/title 全收、table-row 入目录、版本号形态 rowLabel 排除', () => {
    expect(toc.map(t => t.id)).toEqual(['t1', 'h1', 'h2', 'r1', 'h3'])
    expect(toc.find(t => t.id === 'r1').level).toBe(3)          // 行卡固定 lv3
    expect(toc.find(t => t.id === 't1').text).toBe('区域成绩分析v0.1')  // md 标记剥除
  })

  it('sectionOf：块前方最近目录项为所属节；首目录项之前 → null', () => {
    const idx = tocIndex(blocks, toc)
    expect(idx.sectionOf('p0')).toBeNull()                      // 前言：首个目录项之前
    expect(idx.sectionOf('p1').id).toBe('h1')
    expect(idx.sectionOf('rv').id).toBe('r1')                   // 版本号行不占目录位
    expect(idx.sectionOf('h2').id).toBe('h2')                   // 目录项自身归自己
    expect(idx.sectionOf('p2').id).toBe('h3')
    expect(idx.sectionOf('ghost')).toBeNull()                   // 失效锚
  })

  it('crumbOf：祖先链 level 严格递减回溯 […, 自身]', () => {
    const idx = tocIndex(blocks, toc)
    expect(idx.crumbOf('r1').map(n => n.id)).toEqual(['h1', 'h2', 'r1'])         // r1(lv3)←h2(lv2)←h1(lv1)；t1 与 h1 同级不入链
    expect(idx.crumbOf('h3').map(n => n.id)).toEqual(['h3'])                     // 与 t1/h1 同级 → 无祖先
    expect(idx.crumbOf('ghost')).toEqual([])
  })
})

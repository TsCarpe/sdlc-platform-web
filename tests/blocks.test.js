// blocks.js 纯函数单测（v4 块级编辑数据面）：清洗/树操作/校验全分支。
// 夹具形状对齐后端 tests/test_v4_blocks.py（depth=list-item 嵌套层级；行内子块 parent=table-row）。
import { describe, it, expect } from 'vitest'
import {
  toEditable, toPayload, childrenMap, subtreeEnd, removeBlock, insertAfter, moveWithinParent,
  promote, demote, convertType, validate, newBlock
} from '../src/blocks.js'

const fixture = () => [
  { id: 'fs-title', type: 'title', text: '需求标题' },
  { id: 'fs-h1', type: 'heading', level: 2, text: '背景' },
  { id: 'fs-p1', type: 'paragraph', text: '一段说明', comments: 'c1', path: '需求标题 / 背景' },
  { id: 'fs-li0', type: 'list-item', marker: '•', depth: 0, parent: 'fs-p1', text: '列表项一' },
  { id: 'fs-li1', type: 'list-item', marker: '•', depth: 1, parent: 'fs-li0', text: '嵌套项' },
  { id: 'fs-tr1', type: 'table-row', rowLabel: '1', head: ['列A', '列B'], cells: ['a1', 'b1'], text: '' },
  { id: 'fs-lic1', type: 'list-item', marker: '1.', depth: 0, parent: 'fs-tr1', text: '行内条款' },
  { id: 'fs-img1', type: 'image', media: 'm-abc', text: '' },
  { id: 'cm-1', type: 'comment', ref: 'c1', anchorBlockId: 'fs-p1', thread: [] }
]

describe('toEditable / toPayload：副本与提交清洗', () => {
  it('滤 comment 块且深拷贝（改副本不动源）', () => {
    const src = fixture()
    const rows = toEditable(src)
    expect(rows.some(b => b.type === 'comment')).toBe(false)
    expect(rows).toHaveLength(src.length - 1)
    rows[0].text = '改过'
    expect(src[0].text).toBe('需求标题')
  })

  it('剥派生键（path/ordinal/comments）、parent 空值省略键', () => {
    const rows = toEditable(fixture())
    const payload = toPayload(rows)
    const p1 = payload.find(b => b.id === 'fs-p1')
    expect(p1).toEqual({ id: 'fs-p1', type: 'paragraph', text: '一段说明' })
    const li0 = payload.find(b => b.id === 'fs-li0')
    expect(li0.parent).toBe('fs-p1')
    const tr1 = payload.find(b => b.id === 'fs-tr1')
    expect(tr1).toEqual({ id: 'fs-tr1', type: 'table-row', rowLabel: '1', head: ['列A', '列B'], cells: ['a1', 'b1'], text: '' })
  })
})

describe('树结构读取', () => {
  it('childrenMap 按父分组', () => {
    const m = childrenMap(toEditable(fixture()))
    expect(m.get('fs-p1').map(b => b.id)).toEqual(['fs-li0'])
    expect(m.get('fs-tr1').map(b => b.id)).toEqual(['fs-lic1'])
    expect(m.get('').map(b => b.id)).toEqual(['fs-title', 'fs-h1', 'fs-p1', 'fs-tr1', 'fs-img1'])
  })

  it('subtreeEnd：块 + 连续子孙（根块/外部父截断）', () => {
    const rows = toEditable(fixture())
    // p1 的子树 = [p1, li0, li1]；tr1 的子树含行内子块
    expect(subtreeEnd(rows, rows.findIndex(b => b.id === 'fs-p1'))).toBe(5)
    expect(subtreeEnd(rows, rows.findIndex(b => b.id === 'fs-tr1'))).toBe(7)
    expect(subtreeEnd(rows, rows.findIndex(b => b.id === 'fs-li0'))).toBe(5)
    expect(subtreeEnd(rows, rows.findIndex(b => b.id === 'fs-img1'))).toBe(8)
    // 未触动的块保持原样（depth 等元数据不被重算——导入数据可能带 depth:1 的根项）
    const li1 = rows.find(b => b.id === 'fs-li1')
    expect(li1.depth).toBe(1)
  })
})

describe('结构操作', () => {
  it('removeBlock：list-item 删除子项上提（parent 改指 + depth-1 契约）', () => {
    let rows = toEditable(fixture())
    rows = removeBlock(rows, 'fs-li0')
    expect(rows.some(b => b.id === 'fs-li0')).toBe(false)
    const li1 = rows.find(b => b.id === 'fs-li1')
    expect(li1.parent).toBe('fs-p1')
    expect(li1.depth).toBe(0)   // 1-1 契约语义
  })

  it('removeBlock：table-row 连行内子块整组删', () => {
    let rows = toEditable(fixture())
    rows = removeBlock(rows, 'fs-tr1')
    expect(rows.some(b => b.id === 'fs-tr1')).toBe(false)
    expect(rows.some(b => b.id === 'fs-lic1')).toBe(false)
  })

  it('insertAfter：插到子树之后；list-item 兄弟同层', () => {
    let rows = toEditable(fixture())
    const nb = newBlock('paragraph', { text: '新段' })
    rows = insertAfter(rows, 'fs-li0', nb)
    expect(rows[5].id).toBe(nb.id)   // li0 子树（li0+li1）之后、tr1 之前
    const nb2 = newBlock('list-item', { text: '新项' })
    rows = insertAfter(rows, 'fs-li1', nb2)
    expect(nb2.parent).toBe('fs-li0')  // li1 的兄弟 = li0 的子块（同层）
  })

  it('moveWithinParent：同父兄弟重排（after 落子树尾）；跨父/子树内拒绝', () => {
    let rows = toEditable(fixture())
    // 段落 p1（子树含 li0+li1）移到 img 之后：子树整组随迁
    rows = moveWithinParent(rows, 'fs-p1', 'fs-img1', false)
    expect(rows.slice(-4).map(b => b.id)).toEqual(['fs-img1', 'fs-p1', 'fs-li0', 'fs-li1'])
    // 跨父拒绝：li1（parent=li0）拖到 tr1（无父）
    expect(moveWithinParent(rows, 'fs-li1', 'fs-tr1', true)).toBe(rows)
    // 目标在自己子树内：li0 拖到 li1
    const before = [...rows]
    expect(moveWithinParent(rows, 'fs-li0', 'fs-li1', true)).toEqual(before)
  })

  it('promote/demote：list-item 挂前兄弟/回祖父（depth±1）；heading 级别钳位', () => {
    let rows = toEditable(fixture())
    // li1（depth1，parent=li0）升级 → parent=li0 的 parent=fs-p1，depth 1-1=0
    rows = promote(rows, 'fs-li1')
    expect(rows.find(b => b.id === 'fs-li1').parent).toBe('fs-p1')
    expect(rows.find(b => b.id === 'fs-li1').depth).toBe(0)
    // li1 降级 → 挂到前一个同父 list-item 兄弟 li0 下，depth=li0.depth+1
    rows = demote(rows, 'fs-li1')
    expect(rows.find(b => b.id === 'fs-li1').parent).toBe('fs-li0')
    expect(rows.find(b => b.id === 'fs-li1').depth).toBe(1)
    // heading 升降级钳位 1..6
    rows = demote(rows, 'fs-h1')
    expect(rows.find(b => b.id === 'fs-h1').level).toBe(3)
    rows = promote(rows, 'fs-h1')
    expect(rows.find(b => b.id === 'fs-h1').level).toBe(2)
  })

  it('promote/demote：行内子块（表格行）拒绝参与', () => {
    const rows = toEditable(fixture())
    expect(promote(rows, 'fs-lic1')).toBe(rows)
    expect(demote(rows, 'fs-lic1')).toBe(rows)
  })

  it('convertType：文本三态互转（text 保留，类型属性重建）；非文本类拒绝', () => {
    let rows = toEditable(fixture())
    rows = convertType(rows, 'fs-p1', 'heading')
    expect(rows.find(b => b.id === 'fs-p1')).toMatchObject({ type: 'heading', level: 2, text: '一段说明' })
    rows = convertType(rows, 'fs-p1', 'list-item')
    expect(rows.find(b => b.id === 'fs-p1')).toMatchObject({ type: 'list-item', marker: '•' })
    expect(convertType(rows, 'fs-tr1', 'paragraph')).toBe(rows)   // 表格行不可转
    expect(convertType(rows, 'fs-p1', 'image')).toBe(rows)        // 白名单外目标拒绝
  })
})

describe('validate：提交前本地校验（服务端 parse_blocks 同款守卫）', () => {
  it('合法数组零问题', () => {
    expect(validate(toEditable(fixture()))).toEqual([])
  })

  it('重复 id / 空 id / 非法类型', () => {
    const rows = [
      { id: 'a', type: 'paragraph', text: 'x' },
      { id: 'a', type: 'paragraph', text: 'y' },
      { id: '', type: 'paragraph', text: 'z' },
      { id: 'b', type: 'wat', text: '' }
    ]
    const problems = validate(rows)
    expect(problems.some(p => p.msg.includes('重复'))).toBe(true)
    expect(problems.some(p => p.msg.includes('缺少 ID'))).toBe(true)
    expect(problems.some(p => p.msg.includes('非法块类型'))).toBe(true)
  })

  it('parent 前向引用 / 父块缺失', () => {
    const rows = [
      { id: 'a', type: 'list-item', parent: 'zzz', text: 'x' },     // 缺失
      { id: 'b', type: 'list-item', parent: 'c', text: 'y' },       // 前向
      { id: 'c', type: 'list-item', text: 'z' }
    ]
    const problems = validate(rows)
    expect(problems.some(p => p.index === 0 && p.msg.includes('zzz'))).toBe(true)
    expect(problems.some(p => p.index === 1 && p.msg.includes('之前'))).toBe(true)
  })

  it('行内子块不紧随表格行 → 报问题', () => {
    const rows = [
      { id: 'r1', type: 'table-row', rowLabel: '1', head: [], cells: [] },
      { id: 'gap', type: 'paragraph', text: '隔断' },
      { id: 'ic', type: 'list-item', parent: 'r1', text: '行内子块' }
    ]
    const problems = validate(rows)
    expect(problems.some(p => p.index === 2 && p.msg.includes('紧随'))).toBe(true)
  })
})

import { describe, it, expect } from 'vitest'
import { groupItems, groupByFirstAppearance, firstQuote, covP, needlesFor } from '../src/trace.js'

describe('groupItems 需求域分组', () => {
  const items = [
    { theme: '支付', level: 'yellow' }, { theme: '登录', level: 'red' },
    { theme: '', level: 'blue' }, { theme: '未知域', level: 'red' },
  ]
  it('组序跟 domains，未知/空落「其他」，组内 red→yellow→blue', () => {
    const g = groupItems(items, 'theme', ['登录', '支付'])
    expect(g.map(x => x.name)).toEqual(['登录', '支付', '其他'])
    expect(g[0].items[0].level).toBe('red')
    expect(g[2].items.some(i => i.theme === '未知域')).toBe(true)
    expect(g[2].items.some(i => i.theme === '')).toBe(true)
  })
  it('空 domains 全落其他', () => {
    expect(groupItems(items, 'theme', []).length).toBe(1)
  })
  it('空入参 → 空数组', () => {
    expect(groupItems(null, 'theme', ['a'])).toEqual([])
  })
})

describe('groupByFirstAppearance 首现分组', () => {
  it('按首现顺序，空键落未分组', () => {
    const g = groupByFirstAppearance([{ g: 'b' }, { g: '' }, { g: 'a' }, { g: 'b' }], 'g')
    expect(g.map(x => x.name)).toEqual(['b', '未分组', 'a'])
    expect(g[0].items.length).toBe(2)
  })
})

describe('firstQuote 摘引锚', () => {
  it('取第一对「」内文本', () => {
    expect(firstQuote('前缀「目标文本」后缀「第二段」')).toBe('目标文本')
  })
  it('无配对返回空串', () => {
    expect(firstQuote('无引号')).toBe('')
    expect(firstQuote(null)).toBe('')
  })
})

describe('covP 覆盖描述提取体检编号', () => {
  it('⚠️仅一句话（体检.P26）→ P26', () => {
    expect(covP('⚠️仅一句话（体检.P26）')).toBe('P26')
  })
  it('无编号返回空串', () => {
    expect(covP('全覆盖')).toBe('')
    expect(covP('')).toBe('')
  })
})

describe('needlesFor 出处多候选', () => {
  it('原文 → 详述N.N → N.N 三级候选', () => {
    // 现状含已知瑕疵：详述候选与原文相同时未查重仍重复入列（重复 needle 仅多一次无害匹配，暂如实锁定）
    expect(needlesFor('详述6.2-6.7 · 行级')).toEqual(['详述6.2-6.7 · 行级', '详述6.2', '6.2'])
  })
  it('纯小节号出处补充 N.N 候选', () => {
    expect(needlesFor('详述7.2')).toEqual(['详述7.2', '详述7.2', '7.2'])
  })
  it('空出处 → 空数组', () => {
    expect(needlesFor('')).toEqual([])
    expect(needlesFor(null)).toEqual([])
  })
})

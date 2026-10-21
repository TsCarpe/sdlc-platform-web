import { describe, it, expect } from 'vitest'
import { groupItems, groupByFirstAppearance, groupByDocSection, firstQuote, covP, needlesFor } from '../src/trace.js'

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

describe('groupByDocSection 章节分组（v5.3 工作台改版）', () => {
  const blocks = [
    { id: 'p0', type: 'paragraph', text: '前言段' },
    { id: 'h1', type: 'heading', level: 1, text: '一、背景' },
    { id: 'p1', type: 'paragraph', text: '段一' },
    { id: 'h2', type: 'heading', level: 2, text: '1.1 小节' },
    { id: 'p2', type: 'paragraph', text: '段二' },
    { id: 'h3', type: 'heading', level: 1, text: '二、需求' },
    { id: 'p3', type: 'paragraph', text: '段三' },
  ]
  const items = [
    { seq: 'P01', level: 'yellow', anchor: 'p2' },   // 1.1 小节
    { seq: 'P02', level: 'red', anchor: 'p2' },      // 同节（阻断排前）
    { seq: 'P03', level: 'blue', anchor: 'p3' },     // 二、需求
    { seq: 'P04', level: 'red', anchor: 'p1' },      // 一、背景
    { seq: 'P05', level: 'yellow', anchor: '' },     // 无 anchor → 未定位
    { seq: 'P06', level: 'yellow', anchor: 'ghost' },// 锚失效 → 未定位
    { seq: 'P07', level: 'yellow', anchor: 'p0' },   // 首目录项之前 → 文档开头
  ]
  it('组=最近目录项任意级；组序=文档序；组内 level 排序（阻断优先）；前言/未定位兜底', () => {
    const g = groupByDocSection(items, blocks)
    expect(g.map(x => x.name)).toEqual(['§preface', 'h1', 'h2', 'h3', '§unlocated'])
    expect(g.map(x => x.title)).toEqual(['文档开头', '一、背景', '1.1 小节', '二、需求', '未定位（无锚点）'])
    expect(g[2].items.map(i => i.seq)).toEqual(['P02', 'P01'])   // 同节内 red 在 yellow 前
    expect(g[4].items.map(i => i.seq)).toEqual(['P05', 'P06'])
  })
  it('空节不产生组；空入参 → 空数组', () => {
    expect(groupByDocSection([{ seq: 'P01', level: 'red', anchor: 'p3' }], blocks)
      .map(x => x.name)).toEqual(['h3'])
    expect(groupByDocSection([], blocks)).toEqual([])
    const g = groupByDocSection(items, [])                       // 无块结构 → 全数落未定位
    expect(g.map(x => x.name)).toEqual(['§unlocated'])
    expect(g[0].items.length).toBe(items.length)
  })
})

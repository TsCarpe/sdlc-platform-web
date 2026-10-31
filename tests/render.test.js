// @vitest-environment jsdom
// #22d linkifyRefs XSS 面收口行为锁定：详述后缀字符类排除 "'<>=/ —— 阻断匹配吞入标签标记
// （</p><p> 整段）与裸引号入 data-ref；ref 过 esc 转义入属性、m 不转义。
// ①② 直调 linkifyRefs 喂裸 HTML 串——真实管线（render 之后）文本里的 " 已被前置转义为
// &quot; 六字面字符，裸引号形态只有直调层可测（走全管线会「怎么改都红」）；③ 走全管线锁常规链接化不回归。
import { describe, it, expect } from 'vitest'
import { render, linkifyRefs, inlineHtml } from '../src/render.js'

describe('inlineHtml：行内 md + 非 string 防御（v4.2 mini 表格单元格用）', () => {
  it('粗体/行内代码/链接行内渲染（无块级语法）', () => {
    const out = inlineHtml('**加粗** 与 `code`')
    expect(out).toContain('<strong>加粗</strong>')
    expect(out).toContain('<code>code</code>')
    expect(inlineHtml('见[说明](https://x.com)')).toContain('<a href="https://x.com"')
  })

  it('空值/非字符串入参不抛错（marked.parseInline 对非 string 直接 throw）', () => {
    expect(inlineHtml('')).toBe('')
    expect(inlineHtml(null)).toBe('')
    expect(inlineHtml(undefined)).toBe('')
    expect(inlineHtml(123)).toBe('123')
  })

  it('script 标签消毒剥除', () => {
    expect(inlineHtml('<script>alert(1)</script>x')).not.toContain('<script')
  })
})

describe('linkifyRefs：#22d XSS 面收口', () => {
  it('① 裸引号切断详述匹配：span 只包引号前段，引号滞留文本不入 data-ref', () => {
    expect(linkifyRefs('详述3·a"b'))
      .toBe('<span class="reflink" data-ref="src:详述3·a">详述3·a</span>"b')
  })

  it('② 含 "> 的串不断属性；ref 内 & 过 esc 入属性、m 不转义（不双重转义既有实体）', () => {
    expect(linkifyRefs('详述3·x">'))
      .toBe('<span class="reflink" data-ref="src:详述3·x">详述3·x</span>">')
    // 管线上 marked 前置转义形态：&quot; 六字面字符均在允许集、会被吞入 ref——esc 防 ref 内 & 二次成实体
    const out = linkifyRefs('详述3·a&quot;b')
    expect(out).toContain('data-ref="src:详述3·a&amp;quot;b"')   // ref 过 esc
    expect(out).toContain('>详述3·a&quot;b</span>')               // m 保持原样
  })

  it('③ 全管线常规链接化不回归：FR / § 章节 / 详述（含多级 · 标题）三形态照常', () => {
    const html = linkifyRefs(render('见需求.FR-1、§ 2.1 与详述2.3·标题'))
    expect(html).toContain('<span class="reflink" data-ref="fr:需求.FR-1">需求.FR-1</span>')
    expect(html).toContain('<span class="reflink" data-ref="sec:§2.1">§ 2.1</span>')
    expect(html).toContain('<span class="reflink" data-ref="src:详述2.3·标题">详述2.3·标题</span>')
  })
})

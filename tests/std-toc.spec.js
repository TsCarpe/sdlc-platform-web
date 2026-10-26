// @vitest-environment jsdom
// 标准文档目录提取通用化（.doc 基排修复配套）：任意标题结构的 markdown 都产出正确层级——
// 首元素 h1 = 文档主标题（跳过）；章节 h1 → lv1、小节 h2 → lv2、子节 h3 → lv3；
// 纯 h2/h3 文档层级归一到 lv1 起；中部 h1 不误判为主标题。headEls 与 stdToc 同口径 1:1。
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'

vi.mock('../src/api.js', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() },
  uploadMedia: vi.fn()
}))

const sleep = ms => new Promise(r => setTimeout(r, ms))

const mountStd = async markdown => {
  const { default: StdTab } = await import('../src/components/StdTab.vue')
  const w = mount(StdTab, { props: { standard: { markdown } } })
  await sleep(140)   // extractToc 的 settle(60) + 渲染余量
  return w
}

describe('StdTab：目录提取通用化', () => {
  it('标准模板（首元素标题 h1 + 章节 h1 + 小节 h2）：标题不进目录，章节 lv1 / 小节 lv2', async () => {
    const w = await mountStd('# 文档标题\n\n# 一、概述\n\n## 1.1 背景\n\n## 1.2 范围\n\n# 二、详述\n\n## 2.1 流程\n')
    const toc = w.findAll('.toc-side-item').map(a => ({ cls: a.classes(), text: a.text() }))
    expect(toc.map(t => t.text)).toEqual(['一、概述', '1.1 背景', '1.2 范围', '二、详述', '2.1 流程'])
    expect(toc[0].cls).toContain('lv1')
    expect(toc[1].cls).toContain('lv2')
    expect(toc[3].cls).toContain('lv1')
  })

  it('纯 h2/h3 文档：层级归一，h2 → lv1 / h3 → lv2（与旧行为对齐）', async () => {
    const w = await mountStd('## 概述\n\n### 背景\n\n## 详述\n')
    const toc = w.findAll('.toc-side-item').map(a => ({ cls: a.classes(), text: a.text() }))
    expect(toc.map(t => t.text)).toEqual(['概述', '背景', '详述'])
    expect(toc[0].cls).toContain('lv1')
    expect(toc[1].cls).toContain('lv2')
  })

  it('中部 h1（无首元素标题）：不误判为主标题，进目录为 lv1', async () => {
    const w = await mountStd('## 概述\n\n# 附录\n\n## 附录A\n')
    const toc = w.findAll('.toc-side-item').map(a => ({ cls: a.classes(), text: a.text() }))
    expect(toc.map(t => t.text)).toEqual(['概述', '附录', '附录A'])
    expect(toc[1].cls).toContain('lv1')
    expect(toc[2].cls).toContain('lv2')
  })

  it('headEls 与 stdToc 同集合同序（标题同跳过，壳层滚动高亮 1:1）', async () => {
    const w = await mountStd('# 文档标题\n\n# 一、概述\n\n## 1.1 背景\n')
    const texts = w.findAll('.toc-side-item').map(a => a.text())
    expect(w.vm.headEls().map(e => e.tagName)).toEqual(['H1', 'H2'])
    expect(w.vm.headEls().map(e => e.textContent.trim())).toEqual(texts)
  })
})

// @vitest-environment jsdom
// 快速上手手册：五步结构与流程总览、目录同源；每步操作序号钉与示意图序号钉一一对应（改文案或改图
// 漏一边即红）；示意图惰性（aria-hidden 且无可聚焦元素——防 Tab 落进假界面、「/」快捷键误聚焦假搜索框）；
// CTA 上抛 go 由壳层切页；/guide 路由可解析。
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'

let w = null
beforeAll(() => { Element.prototype.scrollIntoView = () => {} })
afterEach(() => { w?.unmount(); w = null })

const mountQs = async () => {
  const { default: QuickStart } = await import('../src/components/QuickStart.vue')
  w = mount(QuickStart, { attachTo: document.body })
  return w
}

describe('QuickStart：快速上手手册', () => {
  it('五步按序渲染，流程总览节点与步骤标题同源；目录覆盖全部锚点', async () => {
    await mountQs()
    const titles = w.findAll('.qs-step-ht h2').map(h => h.text())
    expect(titles).toEqual(['提交需求', 'AI 质检', '逐题澄清', '合成定稿', '审阅发布'])
    expect(w.findAll('.qs-flow-node b').map(b => b.text())).toEqual(titles)
    const anchors = w.findAll('.qs-anchor')
    expect(new Set(anchors.map(a => a.attributes('id'))).size).toBe(anchors.length)
    expect(w.findAll('.toc-side-item')).toHaveLength(anchors.length)
  })

  it('每步操作序号钉与示意图序号钉一一对应', async () => {
    await mountQs()
    for (const s of w.findAll('.qs-step')) {
      const ops = s.findAll('.qs-ops .qs-pin').map(p => p.text())
      expect(ops.length).toBeGreaterThan(0)
      expect(ops).toEqual(ops.map((_, i) => String(i + 1)))
      expect(s.findAll('.qs-mock .qs-pin').map(p => p.text()).sort()).toEqual(ops)
    }
  })

  it('示意图惰性：aria-hidden 且不含可聚焦 / 可交互元素', async () => {
    await mountQs()
    const mocks = w.findAll('.qs-mock')
    expect(mocks).toHaveLength(5)
    for (const m of mocks) {
      expect(m.attributes('aria-hidden')).toBe('true')
      expect(m.findAll('button, a, input, textarea, select, details, [tabindex]')).toHaveLength(0)
    }
  })

  it('首尾 CTA 上抛 go=iters（壳层切到迭代列表）', async () => {
    await mountQs()
    await w.find('.qs-hero .btn.primary').trigger('click')
    await w.find('.qs-end .btn.primary').trigger('click')
    expect(w.emitted('go')).toEqual([['iters'], ['iters']])
  })

  it('流程总览节点点击：定位对应步骤标题并闪烁高亮，目录同步高亮', async () => {
    await mountQs()
    await w.findAll('.qs-flow-node')[2].trigger('click')
    expect(document.getElementById('qs-s3').classList.contains('flash')).toBe(true)
    expect(w.find('.toc-side-item.on').text()).toBe('3. 逐题澄清')
  })

  it('路由：/guide 解析为 guide', async () => {
    const { default: router } = await import('../src/router.js')
    expect(router.resolve('/guide').name).toBe('guide')
  })
})

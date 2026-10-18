// @vitest-environment jsdom
// #22b 翻图重置图注展开态：长 AI 图注展开阅读后翻图（index 变更），展开态不跨图残留。
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'

describe('ImgViewer：#22b 翻图重置图注展开', () => {
  it('展开图注后翻图（index 变更）→ capOpen 重置回 2 行折叠', async () => {
    const { default: ImgViewer } = await import('../src/components/ImgViewer.vue')
    const w = mount(ImgViewer, { props: {
      list: [{ url: '/m/1', caption: '第一张的很长图注' }, { url: '/m/2', caption: '第二张图注' }], index: 0 },
      global: { stubs: { teleport: true } } })   // 灯箱 Teleport 挂 body——stub 后内容留在 wrapper 树内可查
    expect(w.find('.iv-cap-txt').classes()).toContain('clamp')      // 默认 2 行折叠
    await w.find('.iv-cap-txt').trigger('click')                    // 展开完整图注
    expect(w.find('.iv-cap-txt').classes()).not.toContain('clamp')
    await w.setProps({ index: 1 })                                  // 翻图（v-model:index 更新）
    expect(w.find('.iv-cap-txt').classes()).toContain('clamp')      // #22b：展开态随翻图重置
  })
})

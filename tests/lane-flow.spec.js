// @vitest-environment jsdom
// #22c gap 断点节点双回退：无 src 的断点渲染「原文未定义」小字（不再空白）；
// src/anchor 双空的断点点击不 emit locate（宿主会弹错误 toast，违背 D18 静默降级）。
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'

describe('LaneFlow：#22c 断点无出处回退', () => {
  it('gap 无 src → 渲染「原文未定义」小字占位（不再空白）', async () => {
    const { default: LaneFlow } = await import('../src/components/LaneFlow.vue')
    const flows = [{ role: '教师', step: '流向未定义', next: '—', gap: true, src: '', anchor: '' }]
    const w = mount(LaneFlow, { props: { flows } })
    expect(w.find('.node .src.na').exists()).toBe(true)
    expect(w.find('.node .src.na').text()).toBe('原文未定义')
  })

  it('src/anchor 双空的 gap 点击不 emit locate（静默降级，不触发宿主错误 toast）', async () => {
    const { default: LaneFlow } = await import('../src/components/LaneFlow.vue')
    const flows = [{ role: '教师', step: '流向未定义', next: '—', gap: true, src: '', anchor: '', pids: [] }]
    const w = mount(LaneFlow, { props: { flows } })
    await w.find('.node.gap').trigger('click')
    expect(w.emitted('locate')).toBeUndefined()
    expect(w.emitted('jump')).toBeUndefined()
  })
})

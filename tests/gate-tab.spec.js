// @vitest-environment jsdom
// P1-9：gate_round.reviewMode=degraded 时显示「降级评审」横幅；external 不显示。
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'

vi.mock('../src/api.js', () => ({ api: {}, uploadMedia: vi.fn() }))

const view = round => ({
  reqId: 'REQ-1', phase: 'deciding', checks: [], issues: [], units: [], rounds: [round], round,
  change: { changed: false }
})

const mountTab = async round => {
  const { default: GateTab } = await import('../src/components/GateTab.vue')
  return mount(GateTab, { props: { reqId: 'REQ-1', view: view(round), operator: '冒烟员' } })
}

describe('GateTab：评审扇出留痕（P1-9）', () => {
  it('reviewMode=degraded 显示降级评审横幅与扇出事实', async () => {
    const w = await mountTab({ id: 1, roundNo: 1, status: 'pending',
                               reviewMode: 'degraded', fanout: 0, contextMode: 'single-session' })
    expect(w.text()).toContain('降级评审')
    expect(w.text()).toContain('fanout=0')
    expect(w.text()).toContain('single-session')
  })

  it('reviewMode=external 不显示降级横幅', async () => {
    const w = await mountTab({ id: 1, roundNo: 1, status: 'pending',
                               reviewMode: 'external', fanout: 4, contextMode: 'fresh' })
    expect(w.text()).not.toContain('降级评审')
  })

  it('存量轮（无留痕字段）不显示降级横幅', async () => {
    const w = await mountTab({ id: 1, roundNo: 1, status: 'pending' })
    expect(w.text()).not.toContain('降级评审')
  })
})

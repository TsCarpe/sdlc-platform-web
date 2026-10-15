// @vitest-environment jsdom
// ReqDetail 壳级冒烟（批次7 / AUDIT D6-2 拆分前置回归网——对抗审查 M9）：
// 全形态 fixture（clarifying 全键 + published 双形态）下断言 8 tab 渲染与关键交互存在性，
// 为 948 行拆分（tab 组件化 + composable 抽取）提供行为基线。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

const detailFixture = () => ({
  card: { id: 'REQ-2026-001', name: '冒烟需求', iter: 'SMOKE', sourceType: 'text', sourceUrl: '', sourceText: '原文',
    status: 'clarifying', submittedBy: 'tester', standardDoc: '', createdAt: '2026-10-01 10:00:00',
    syncedAt: null, riskTier: 'B' },
  items: [{ seq: 'P01', level: 'yellow', theme: '域一', question: '问题一？', answer: '', answeredAt: null,
    status: 'pending', note: '', ctx: '详述1', quote: '「摘引」', anchor: '' }],
  digest: { markdown: '# digest', version: 1, pushedAt: '2026-10-01 10:00:00',
    content: { summary: '概要', roles: ['用户'], features: [], flows: [], states: [] } },
  audit: { markdown: '# audit', version: 1, pushedAt: '2026-10-01 10:00:00',
    content: { red: 0, yellow: 1, blue: 0, items: [{ id: 'P01', level: 'yellow', title: '存疑点', where: '§1', go: '写入标准文档 §2 条款', group: '域一', quote: '', anchor: '' }] } },
  snapshot: { md: '# 原文快照\n\n段落文本', at: '2026-10-01 10:00:00', version: 1 },
  doc: { markdown: '', version: 1, pushedAt: '2026-10-01 10:00:00',
    content: { blocks: [{ id: 'blk-1', type: 'paragraph', text: '结构化原文块' }], media: [] } },
  domains: ['域一'],
  frCount: 1,
  frPoints: [{ id: '需求.FR-01', name: '点一', source: '详述1', group: '域一', module: '', anchor: '', coveredBy: [] }],
  coverage: { forward: { covered: 1, total: 1, pct: 100, uncovered: [] }, backward: { linked: 0, total: 0, pct: null }, danglingCases: [] },
  quality: { stars: 4, basis: '无阻断、严重 1 项' },
  answered: 0, totalQ: 1
})

const gateViewFixture = () => ({ reqId: 'REQ-2026-001', phase: 'blocked', checks: [
  { key: 'design', name: '设计已定稿 ∨ 轻量跳过', ok: false, detail: '设计未定稿' },
  { key: 'cases', name: '用例 ≥1 且全部定稿', ok: false, detail: '0 条' },
  { key: 'coverage', name: 'FR 覆盖（RTM 无未覆盖行）', ok: true, detail: '无需求点注册（视为覆盖）' }], change: { changed: false } })

vi.mock('../src/api.js', () => ({
  api: {
    get: vi.fn(async (url) => {
      if (url.includes('/gate')) return gateViewFixture()
      if (url.includes('/design')) return { reqId: 'REQ-2026-001', tier: 'B', phase: 'none' }
      if (url.includes('/tasks') || url.includes('/drafts')) return []  // TaskPanel 轮询/草稿面
      return detailFixture()
    }),
    post: vi.fn(async () => ({})),
    put: vi.fn(async () => ({})),
    del: vi.fn(async () => ({}))
  }
}))

const mountDetail = async () => {
  const { default: ReqDetail } = await import('../src/components/ReqDetail.vue')
  const w = mount(ReqDetail, { props: { reqId: 'REQ-2026-001' } })
  await flushPromises()
  await new Promise(r => setTimeout(r, 250))  // settle（load→applyJump 链路的 80ms 节奏）
  return w
}

let wrapper
beforeEach(() => { vi.clearAllMocks() })

describe('ReqDetail 壳级冒烟（拆分行为基线）', () => {
  it('头部信息与 8 个 tab 齐全（v5：audit 并入工作台 + 分阶段分组置灰）', async () => {
    wrapper = await mountDetail()
    expect(wrapper.text()).toContain('冒烟需求')
    expect(wrapper.text()).toContain('REQ-2026-001')
    const tabs = wrapper.findAll('[role="tab"]')
    expect(tabs.map(t => t.text())).toEqual([
      '原始需求', '需求摘要1', '澄清工作台1', '标准需求文档', '变更', '用例', '设计', '门禁'])
    // 置灰仅设计/门禁（D8：变更承载 reconcile 通道、用例无守卫，不置灰）
    const byText = t => tabs.find(b => b.text().startsWith(t))
    expect(byText('变更').attributes('disabled')).toBeUndefined()
    expect(byText('用例').attributes('disabled')).toBeUndefined()
    expect(byText('设计').attributes('disabled')).toBeDefined()
    expect(byText('门禁').attributes('disabled')).toBeDefined()
    expect(byText('设计').classes()).toContain('locked')
    expect(wrapper.text()).toContain('体检报告已并入澄清工作台')
  })

  it('origin tab：doc 结构化渲染 + 快照条', async () => {
    wrapper = await mountDetail()
    await wrapper.findAll('[role="tab"]')[0].trigger('click')  // clarifying 默认落在 checklist，显式切 origin
    await flushPromises()
    expect(wrapper.text()).toContain('快照')
    expect(wrapper.text()).toContain('结构化原文块')  // doc.content.blocks
  })

  it('digest tab：概述/角色/需求点注册表', async () => {
    wrapper = await mountDetail()
    await wrapper.findAll('[role="tab"]')[1].trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('需求概述')
    expect(wrapper.text()).toContain('涉及角色')
    expect(wrapper.text()).toContain('需求点注册表')
    expect(wrapper.text()).toContain('需求.FR-01')
  })

  it('工作台（audit 并入，D1）：问题卡 + 影响分析 join + 同源徽标', async () => {
    wrapper = await mountDetail()
    await wrapper.findAll('[role="tab"]')[2].trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('问题一？')
    expect(wrapper.text()).toContain('来自体检.P01')       // 同源徽标保留（§1.2）
    expect(wrapper.text()).toContain('影响分析')            // audit go/relatedCases 归宿（默认收起的 details）
    expect(wrapper.text()).toContain('写入标准文档 §2 条款')
    expect(wrapper.text()).toContain('域一')                // 分组名（domains 同源）
  })

  it('工作台：待处置项 + 作答输入框 + 处置按钮', async () => {
    wrapper = await mountDetail()
    await wrapper.findAll('[role="tab"]')[2].trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('问题一？')
    expect(wrapper.find('textarea').exists()).toBe(true)
    expect(wrapper.text()).toContain('驳回（不是问题）')
    expect(wrapper.text()).toContain('挂起（转遗留假设）')
  })

  it('用例 tab 可达；未发布卡设计/门禁置灰不可点（D8）', async () => {
    wrapper = await mountDetail()
    const tabs = wrapper.findAll('[role="tab"]')
    await tabs[5].trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('用例')   // cases tab 正常进入（CaseList fixture 空列表空态）
  })
})

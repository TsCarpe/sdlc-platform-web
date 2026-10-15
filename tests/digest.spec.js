// @vitest-environment jsdom
// v5 摘要重定位（DESIGN-v5 §3，D6/D9）行为锁定：LaneFlow 泳道布局与断点点击降级 /
// DigestTab 遗留假设独立卡解析与 asm 跳转 / AI 理解摘要卡模块角标降级（D18）。
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'

const FLOWS = [
  { role: '教研组长', step: '创建活动', next: '发出邀请', gap: false, src: '详述1·1', anchor: '' },
  { role: '教研组长', step: '跨校区邀请', next: '被邀方可否拒绝？', gap: false, src: '', anchor: '' },
  { role: '教师', step: '被邀方可否拒绝？', next: '—', gap: true, src: '详述1·2', anchor: 'blk-9' },
]

describe('LaneFlow：主流程泳道（v5 §3/D6）', () => {
  it('role 首现序为泳道、数组序为列；gap 断点节点可点击降级原文定位', async () => {
    const { default: LaneFlow } = await import('../src/components/LaneFlow.vue')
    const w = mount(LaneFlow, { props: { flows: FLOWS } })
    expect(w.findAll('.lane-name').map(t => t.text())).toEqual(['教研组长', '教师'])   // 首现序
    expect(w.findAll('.node').length).toBe(3)
    expect(w.findAll('.lane-arrow').length).toBe(2)                                    // i→i+1 连边
    const gapNode = w.findAll('.node.gap')
    expect(gapNode.length).toBe(1)
    await gapNode[0].trigger('click')
    expect(w.emitted('locate')[0]).toEqual(['详述1·2', 'blk-9'])                       // pids 缺失 → 原文定位降级（D18）
  })

  it('gap 断点带 pids（v1.6）→ 直达工作台对应澄清题', async () => {
    const { default: LaneFlow } = await import('../src/components/LaneFlow.vue')
    const flows = [{ ...FLOWS[2], pids: ['P21'] }]
    const w = mount(LaneFlow, { props: { flows } })
    await w.find('.node.gap').trigger('click')
    expect(w.emitted('jump')[0]).toEqual([{ kind: 'check', id: 'P21' }])
  })
})

describe('DigestTab：遗留假设独立卡与 AI 理解摘要（v5 §3/D9）', () => {
  const mountDigest = async (over = {}) => {
    const { default: DigestTab } = await import('../src/components/DigestTab.vue')
    const { GRP_KEY } = await import('../src/composables/group-collapse.js')
    const grp = { openGrps: new Set(), toggleGrp: () => {}, expandAll: () => {}, collapseAll: () => {}, revealGrpFor: () => {} }
    const digest = {
      markdown: '# 摘要\n\n- 需求.A01：活动与教学计划的强关联规则沿用现行版本\n- 需求.A02：数据看板口径以回收结论为准\n',
      version: 1, pushedAt: '2026-10-01 10:00:00',
      content: { summary: '概要文本', roles: ['教研组长'], features: [], flows: [], states: [] },
      ...over.digest,
    }
    return mount(DigestTab, { props: { digest, frPoints: over.frPoints || [], items: over.items || [] },
      global: { provide: { [GRP_KEY]: grp } } })
  }
  it('markdown 中「需求.Axx」行提为独立卡；点击走 asm 协议', async () => {
    const w = await mountDigest()
    const asm = w.findAll('.asm-item')
    expect(asm.length).toBe(2)
    expect(w.text()).toContain('活动与教学计划的强关联规则沿用现行版本')
    await asm[0].find('button').trigger('click')
    expect(w.emitted('jump')[0]).toEqual([{ kind: 'asm', id: '活动与教学计划的强关联规则沿用现' }])
  })
  it('sdlc-intent §8 假设清单表格行同样提出（真实产物形态）', async () => {
    const w = await mountDigest({ digest: {
      markdown: '## 8. 假设清单\n| A1 | 详述1.1 | 量表与模板按同一对象理解 | 假设 | 此处按同一对象 |\n| A<编号\\> | §8 条目 | … |\n',
      content: { summary: '', roles: [], features: [], flows: [], states: [] },
    } })
    const asm = w.findAll('.asm-item')
    expect(asm.length).toBe(1)                                  // 表头模板行（A<编号>）不误收
    expect(asm[0].find('code').text()).toBe('需求.A1')
    expect(asm[0].text()).toContain('详述1.1')                   // 出处并入展示
    expect(asm[0].text()).toContain('量表与模板按同一对象理解')
  })
  it('模块 chips：无 items[].module（v1.6 前）→ 角标整体隐藏不冒充（D18）', async () => {
    const w = await mountDigest({ frPoints: [{ id: '需求.FR-01', name: 'n', source: '', group: '', module: '教研活动', anchor: '', coveredBy: [] }],
      items: [{ seq: 'P01', status: 'pending', module: '' }] })
    expect(w.findAll('.mchip').length).toBe(1)
    expect(w.find('.mchip .b').exists()).toBe(false)   // 无数据不挂数字
  })
})

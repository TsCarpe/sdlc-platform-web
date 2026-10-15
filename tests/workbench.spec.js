// @vitest-environment jsdom
// v5 选择题化作答（DESIGN-v5 §2.3，D16/D18）行为锁定：点选即 PUT / per-seq 串行发送链
// （最后值胜）/ 全量装配 / 处置互斥 / 重新作答不预选 / 无 options 降级 textarea。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

vi.mock('../src/api.js', () => ({
  api: { get: vi.fn(async () => []), post: vi.fn(async () => ({})), put: vi.fn(async () => ({})), del: vi.fn(async () => ({})) }
}))

const mountWb = async (items, status = 'clarifying') => {
  const { default: WorkbenchTab } = await import('../src/components/WorkbenchTab.vue')
  const { GRP_KEY } = await import('../src/composables/group-collapse.js')
  const grp = { openGrps: new Set(), toggleGrp: () => {}, expandAll: () => {}, collapseAll: () => {}, revealGrpFor: () => {} }
  return mount(WorkbenchTab, { props: { reqId: 'REQ-1', items, status,
    groups: [{ name: '组', items }], audit: null, concludedGroups: [], doc: null, snapshot: null },
    global: { provide: { [GRP_KEY]: grp } } })
}

const OPT_ITEM = {
  seq: 'P01', level: 'yellow', theme: '域', question: 'q？', answer: '', answeredAt: null,
  status: 'pending', note: '', ctx: '', quote: '', anchor: '', origin: 'skill',
  options: [
    { key: 'A', text: '选项A全文', why: '与原文最小语义改动', recommended: true },
    { key: 'B', text: '选项B全文' },
  ]
}

beforeEach(() => vi.clearAllMocks())

describe('WorkbenchTab：选择题化作答（v5 §2.3）', () => {
  it('点选即 PUT：body 显式 {answer, status:answered}，卡转已答快照', async () => {
    const { api } = await import('../src/api.js')
    const items = [{ ...OPT_ITEM }]
    const w = await mountWb(items)
    await w.findAll('.opt')[0].trigger('click')
    await flushPromises()
    expect(api.put).toHaveBeenCalledWith('/api/requirements/REQ-1/answers/P01',
      { answer: '【A】选项A全文', status: 'answered' })
    expect(w.text()).toContain('【A】选项A全文')   // 已答快照
    expect(w.text()).toContain('重新作答')
  })

  it('per-seq 串行链最后值胜：连点 A→B，B 请求排队不丢、终值为 B', async () => {
    const { api } = await import('../src/api.js')
    // 首个 PUT 挂起——制造在途窗口，验证第二个请求排队而非并发（savingSeqs 在途丢弃语义会静默丢答）
    let release
    api.put.mockImplementationOnce(() => new Promise(r => { release = r }))
    const items = [{ ...OPT_ITEM }]
    const w = await mountWb(items)
    await w.findAll('.opt')[0].trigger('click')   // A（在途）
    await w.findAll('.opt')[1].trigger('click')   // B（应排队待 A 完成）
    expect(api.put).toHaveBeenCalledTimes(1)       // B 未并发发出
    release()
    await flushPromises()
    expect(api.put).toHaveBeenCalledTimes(2)       // B 请求必发——排队不丢
    const bodies = api.put.mock.calls.map(c => c[1].answer)
    expect(bodies[0]).toBe('【A】选项A全文')       // 各请求按发送时刻装配
    expect(bodies[1]).toBe('【B】选项B全文')
    expect(items[0].answer).toBe('【B】选项B全文')  // 后到者胜，终值为 B
  })

  it('补充说明与点选全量装配：pending 态展开 extra 输入 → 点选 A → PUT 带（补充：…）', async () => {
    const { api } = await import('../src/api.js')
    const items = [{ ...OPT_ITEM }]
    const w = await mountWb(items)
    await w.find('.more-answer').trigger('click')   // pending 态展开「以上都不对」
    await w.find('.extra-ta').setValue('两校区都要收到')
    await w.findAll('.opt')[0].trigger('click')     // 点选即 PUT——装配含 extra（r4#12 全量装配）
    await flushPromises()
    expect(api.put).toHaveBeenLastCalledWith('/api/requirements/REQ-1/answers/P01',
      { answer: '【A】选项A全文（补充：两校区都要收到）', status: 'answered' })
  })

  it('处置互斥：弹窗打开期间点选被抑制', async () => {
    const { api } = await import('../src/api.js')
    const items = [{ ...OPT_ITEM }]
    const w = await mountWb(items)
    await w.findAll('.ans-ops .btn')[0].trigger('click')   // 驳回（弹窗开）
    expect(w.find('.modal').exists()).toBe(true)
    const calls = api.put.mock.calls.length
    await w.findAll('.opt')[0].trigger('click')            // 点选被吞
    expect(api.put.mock.calls.length).toBe(calls)
    expect(w.findAll('.opt')[0].attributes('disabled')).toBeDefined()   // 选项禁用（互斥条款 ①）
  })

  it('重新作答 = 清空重选不预选（r4#11）：reopen 后选项无选中态', async () => {
    const items = [{ ...OPT_ITEM }]
    const w = await mountWb(items)
    await w.findAll('.opt')[0].trigger('click')
    await flushPromises()
    expect(w.text()).toContain('重新作答')
    await w.find('.redo').trigger('click')
    await flushPromises()
    expect(items[0].status).toBe('pending')
    expect(w.findAll('.opt.picked').length).toBe(0)   // 不预选、不做选中态恢复
  })

  it('无 options 存量卡降级 textarea（D12）', async () => {
    const items = [{ seq: 'P02', level: 'yellow', theme: '域', question: 'q', answer: '', status: 'pending', note: '', origin: 'skill' }]
    const w = await mountWb(items)
    expect(w.find('textarea[name="clf-answer-P02"]').exists()).toBe(true)
    expect(w.findAll('.opt').length).toBe(0)
  })
})

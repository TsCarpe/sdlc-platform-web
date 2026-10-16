// @vitest-environment jsdom
// v5 选择题化作答（DESIGN-V5 §2.3，D16/D18）行为锁定：点选即 PUT / per-seq 串行发送链
// （最后值胜）/ 全量装配 / 处置互斥 / 重新作答不预选 / 无 options 降级 textarea。
// 二期切换（§8）：answer 写结构化 option JSON（D-A/D5）、读侧 answerText（D15）、
// 捕获语义（D-B）、无 options 卡草稿体制（draft/dirty/懒播种/items 替换失效重播种）。
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
  it('点选即 PUT（二期结构化）：body answer 为 kind=option JSON，快照渲染 answerText', async () => {
    const { api } = await import('../src/api.js')
    const items = [{ ...OPT_ITEM }]
    const w = await mountWb(items)
    await w.findAll('.opt')[0].trigger('click')
    await flushPromises()
    expect(api.put).toHaveBeenCalledWith('/api/requirements/REQ-1/answers/P01',
      { answer: '{"kind":"option","optionKey":"A","optionText":"选项A全文"}', status: 'answered' })
    expect(w.text()).toContain('选项A全文')        // 已答快照（answerText 解构文本，无 key 前缀）
    expect(w.text()).toContain('重新作答')
  })

  it('per-seq 串行链最后值胜：连点 A→B，B 请求排队不丢、终值为 B（payload+answerText 各就位）', async () => {
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
    expect(bodies[0]).toBe('{"kind":"option","optionKey":"A","optionText":"选项A全文"}')
    expect(bodies[1]).toBe('{"kind":"option","optionKey":"B","optionText":"选项B全文"}')
    expect(items[0].answer).toBe('{"kind":"option","optionKey":"B","optionText":"选项B全文"}')  // 后到者胜
    expect(items[0].answerText).toBe('选项B全文')   // 本地回写与服务端 answerText 同构（D15）
  })

  it('补充说明与点选全量装配（二期结构化）：extra 进 payload JSON', async () => {
    const { api } = await import('../src/api.js')
    const items = [{ ...OPT_ITEM }]
    const w = await mountWb(items)
    await w.find('.more-answer').trigger('click')   // pending 态展开「以上都不对」
    await w.find('.extra-ta').setValue('两校区都要收到')
    await w.findAll('.opt')[0].trigger('click')     // 点选即 PUT——装配含 extra（r4#12 全量装配）
    await flushPromises()
    expect(api.put).toHaveBeenLastCalledWith('/api/requirements/REQ-1/answers/P01',
      { answer: '{"kind":"option","optionKey":"A","optionText":"选项A全文","extra":"两校区都要收到"}',
        status: 'answered' })
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

  // ===== 二期切换（§8）：answerText 读侧 / 纯文本写侧 / 捕获语义 / 草稿体制 =====

  it('已答快照渲染 answerText 且旧数据回退 answer（D15 读侧双形态）', async () => {
    const items = [
      { ...OPT_ITEM, seq: 'P01', status: 'answered',
        answer: '{"kind":"option","optionKey":"A","optionText":"二期结构化新答"}', answerText: '二期结构化新答' },
      { ...OPT_ITEM, seq: 'P02', status: 'answered', answer: '一期纯文本旧答' },  // 旧数据无 answerText
    ]
    const w = await mountWb(items)
    expect(w.text()).toContain('二期结构化新答')     // 新形态：读 answerText
    expect(w.text()).toContain('一期纯文本旧答')     // 旧数据：回退 answer
    expect(w.text()).not.toContain('{"kind"')        // 裸 JSON 永不外溢展示
  })

  it('extra-only 维持纯文本 PUT（D-A：纯补充不结构化）', async () => {
    const { api } = await import('../src/api.js')
    const items = [{ ...OPT_ITEM }]
    const w = await mountWb(items)
    await w.find('.more-answer').trigger('click')
    await w.find('.extra-ta').setValue('以上都不对，实际口径是 X')
    await w.find('.extra-ta').trigger('blur')        // 失焦保存：无 picked → 纯文本
    await flushPromises()
    expect(api.put).toHaveBeenCalledWith('/api/requirements/REQ-1/answers/P01',
      { answer: '以上都不对，实际口径是 X' })
  })

  it('无 options 卡含 JSON 孤儿行：显示 answerText、未编辑失焦零 PUT、编辑后 PUT 纯文本', async () => {
    const { api } = await import('../src/api.js')
    const items = [{ seq: 'P02', level: 'yellow', theme: '域', question: 'q',
      answer: '{"kind":"option","optionKey":"A","optionText":"选项A全文"}', answerText: '选项A全文',
      status: 'answered', note: '', origin: 'skill' }]
    const w = await mountWb(items)
    const ta = w.find('textarea[name="clf-answer-P02"]')
    expect(ta.element.value).toBe('选项A全文')       // 展示面 = 解构文本（播种自 answerText）
    await ta.trigger('blur')                         // 未编辑：draft === originAnswers（懒播种同值）→ 零 PUT
    expect(api.put).not.toHaveBeenCalled()
    await ta.setValue('改写成纯文本口径')             // 编辑（置 dirty）
    await ta.trigger('blur')
    expect(api.put).toHaveBeenCalledWith('/api/requirements/REQ-1/answers/P02',
      { answer: '改写成纯文本口径' })                 // 无 options 卡 PUT 纯文本（永不结构化）
  })

  it('连点+在途补充：捕获语义回调回写 = 发送值（PUT1 回写不含回调时点新填的 extra）', async () => {
    const { api } = await import('../src/api.js')
    let release
    api.put.mockImplementationOnce(() => new Promise(r => { release = r }))
    const items = [{ ...OPT_ITEM }]
    const w = await mountWb(items)
    await w.findAll('.opt')[0].trigger('click')      // PUT1 挂起——payload 已捕获（JSON 无 extra）
    await w.find('.more-answer').trigger('click')
    await w.find('.extra-ta').setValue('补充口径')
    await w.find('.extra-ta').trigger('blur')        // PUT2：saveExtra 直发（全量 JSON+extra）
    await flushPromises()
    expect(api.put).toHaveBeenCalledTimes(2)
    expect(JSON.parse(api.put.mock.calls[1][1].answer).extra).toBe('补充口径')
    release()                                        // PUT1 完成——回写 = 捕获的发送值
    await flushPromises()
    expect(items[0].answer).toBe('{"kind":"option","optionKey":"A","optionText":"选项A全文"}')
    expect(items[0].answerText).toBe('选项A全文')    // 回写与发送严格一致（零分歧窗口，D-B）
  })

  it('items 整体替换后：未编辑 draft 跟随服务端新值、编辑中不被覆盖（机制#7）', async () => {
    const { api } = await import('../src/api.js')
    const old1 = { seq: 'P02', level: 'yellow', theme: '域', question: 'q1', answer: '', answerText: '服务端旧值', status: 'answered', note: '', origin: 'skill' }
    const old2 = { seq: 'P03', level: 'yellow', theme: '域', question: 'q2', answer: '', answerText: '', status: 'pending', note: '', origin: 'skill' }
    const w = await mountWb([old1, old2])
    const ta1 = w.find('textarea[name="clf-answer-P02"]')
    const ta2 = w.find('textarea[name="clf-answer-P03"]')
    expect(ta1.element.value).toBe('服务端旧值')     // 懒播种
    await ta2.setValue('本地输入中')                  // P03 置 dirty
    // 外部 load() 整体替换 items（新对象同 seq）——groups 同步换新数组
    const new1 = { ...old1, answerText: '服务端新值' }
    const new2 = { ...old2 }
    await w.setProps({ items: [new1, new2], groups: [{ name: '组', items: [new1, new2] }] })
    expect(w.find('textarea[name="clf-answer-P02"]').element.value).toBe('服务端新值')  // 未 dirty：跟随真值
    expect(w.find('textarea[name="clf-answer-P03"]').element.value).toBe('本地输入中')  // dirty：不被覆盖
    // 未编辑卡失焦零 PUT（重播种后 draft===originAnswers）；编辑卡失焦 PUT 本地值
    await w.find('textarea[name="clf-answer-P02"]').trigger('blur')
    expect(api.put).not.toHaveBeenCalled()
    await w.find('textarea[name="clf-answer-P03"]').trigger('blur')
    expect(api.put).toHaveBeenCalledWith('/api/requirements/REQ-1/answers/P03',
      { answer: '本地输入中' })
  })
})

describe('WorkbenchTab：就绪度覆盖地图（v5 §2.2，D3/D12）', () => {
  const LAYER_ITEMS = [
    { seq: 'P01', level: 'red', theme: '域', question: 'q1', answer: '', status: 'answered', note: '', origin: 'skill', layer: 2 },
    { seq: 'P02', level: 'yellow', theme: '域', question: 'q2', answer: '', status: 'pending', note: '', origin: 'skill', layer: 2 },
    { seq: 'P03', level: 'yellow', theme: '域', question: 'q3', answer: '', status: 'pending', note: '', origin: 'skill', layer: 5 },
    { seq: 'P04', level: 'blue', theme: '域', question: 'q4', answer: '', status: 'pending', note: '', origin: 'skill' },  // 无 layer → 未分类桶
  ]
  it('维度条渲染：layer 桶 + 未分类桶（空 layer 计分母）；点击维度过滤左栏（与三态叠加）', async () => {
    const w = await mountWb(LAYER_ITEMS)
    expect(w.findAll('.dim').length).toBe(3)          // L2 / L5 / 未分类
    expect(w.text()).toContain('L2')
    expect(w.text()).toContain('未分类')
    // L2 桶：1/2 已处置 → 1 待澄清
    const l2 = w.findAll('.dim').find(d => d.text().includes('L2'))
    expect(l2.text()).toContain('1')
    await l2.trigger('click')                          // 点维度过滤
    expect(w.findAll('[data-pid]').map(el => el.attributes('data-pid')).sort()).toEqual(['P01', 'P02'])
    await l2.trigger('click')                          // 再点取消
    expect(w.findAll('[data-pid]').length).toBe(4)
  })
  it('无 layer 数据降级：不渲染维度条（D12 降级不冒充——不以 theme 近似维度）', async () => {
    const items = [{ seq: 'P01', level: 'yellow', theme: '教研活动', question: 'q', answer: '', status: 'pending', note: '', origin: 'skill' }]
    const w = await mountWb(items)
    expect(w.find('.readiness').exists()).toBe(false)
    expect(w.find('.wb-prog').exists()).toBe(true)    // 进度卡保留
  })
})

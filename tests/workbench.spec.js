// @vitest-environment jsdom
// v5 选择题化作答（DESIGN-V5 §2.3，D16/D18）行为锁定：点选即 PUT / per-seq 串行发送链
// （最后值胜）/ 全量装配 / 处置互斥 / 重新作答不预选 / 无 options 降级 textarea。
// 二期切换（§8）：answer 写结构化 option JSON（D-A/D5）、读侧 answerText（D15）、
// 捕获语义（D-B）、无 options 卡草稿体制（draft/dirty/懒播种/items 替换失效重播种）。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { reactive } from 'vue'

vi.mock('../src/api.js', () => ({
  api: { get: vi.fn(async () => []), post: vi.fn(async () => ({})), put: vi.fn(async () => ({})), del: vi.fn(async () => ({})) }
}))
// 清空重答二次确认（v5.4）：测试环境不挂 ConfirmDialog，ask 直接按确认结算
vi.mock('../src/confirm.js', () => ({ ask: vi.fn(async () => true) }))

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

// 维度分层夹具（就绪度地图与 #8 批3 用例共用）：L2 两题 / L5 一题 / 未分类一题
const LAYER_ITEMS = [
  { seq: 'P01', level: 'red', theme: '域', question: 'q1', answer: '', status: 'answered', note: '', origin: 'skill', layer: 2 },
  { seq: 'P02', level: 'yellow', theme: '域', question: 'q2', answer: '', status: 'pending', note: '', origin: 'skill', layer: 2 },
  { seq: 'P03', level: 'yellow', theme: '域', question: 'q3', answer: '', status: 'pending', note: '', origin: 'skill', layer: 5 },
  { seq: 'P04', level: 'blue', theme: '域', question: 'q4', answer: '', status: 'pending', note: '', origin: 'skill' },  // 无 layer → 未分类桶
]

// v5.4 作答流开关默认开——作答机制类用例需看完整卡（已答不收成摘要、不自动跳题），默认关闭；
// 开关行为本身在「v5.4 作答流」describe 内显式打开验证
beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  localStorage.setItem('wb.autoCollapse', '0')
  localStorage.setItem('wb.autoNext', '0')
})

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
    expect(w.text()).toContain('清空重答')         // v5.4：原「重新作答」改名（破坏性动作明示）
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

  it('清空重答（v5.4，原重新作答）：二次确认后回待确认、选项无选中态（r4#11）', async () => {
    const { ask } = await import('../src/confirm.js')
    const items = [{ ...OPT_ITEM }]
    const w = await mountWb(items)
    await w.findAll('.opt')[0].trigger('click')
    await flushPromises()
    await w.find('.redo').trigger('click')
    await flushPromises()
    expect(ask).toHaveBeenCalledTimes(1)               // 破坏性动作必经确认
    expect(items[0].status).toBe('pending')
    expect(w.findAll('.opt.picked').length).toBe(0)   // 不预选、不做选中态恢复
  })

  it('清空重答取消确认：不发 PUT、答复保留', async () => {
    const { api } = await import('../src/api.js')
    const { ask } = await import('../src/confirm.js')
    const items = [{ ...OPT_ITEM, status: 'answered',
      answer: '{"kind":"option","optionKey":"A","optionText":"选项A全文"}', answerText: '选项A全文' }]
    const w = await mountWb(items)
    ask.mockResolvedValueOnce(false)
    await w.find('.redo').trigger('click')
    await flushPromises()
    expect(api.put).not.toHaveBeenCalled()
    expect(items[0].status).toBe('answered')
  })

  it('展开即改（v5.4）：已答按选项全文回显高亮；点其他选项直接覆盖并保留已存补充说明', async () => {
    const { api } = await import('../src/api.js')
    const items = [{ ...OPT_ITEM, status: 'answered',
      answer: '{"kind":"option","optionKey":"Z","optionText":"选项A全文","extra":"两校区"}', answerText: '选项A全文（补充：两校区）' }]
    const w = await mountWb(items)
    // 存储 key=Z 已漂移（选项重生成）——按全文匹配回显 A，不以 optionKey 回显（r4#11）
    expect(w.findAll('.opt')[0].classes()).toContain('picked')
    await w.findAll('.opt')[1].trigger('click')
    await flushPromises()
    expect(api.put).toHaveBeenCalledWith('/api/requirements/REQ-1/answers/P01',
      { answer: '{"kind":"option","optionKey":"B","optionText":"选项B全文","extra":"两校区"}', status: 'answered' })
    expect(w.findAll('.opt')[1].classes()).toContain('picked')
  })

  it('全文不匹配任何选项（选项重生成）→ 不高亮，宁缺不错', async () => {
    const items = [{ ...OPT_ITEM, status: 'answered',
      answer: '{"kind":"option","optionKey":"A","optionText":"旧版选项文案"}', answerText: '旧版选项文案' }]
    const w = await mountWb(items)
    expect(w.findAll('.opt.picked').length).toBe(0)
    expect(w.find('.done-ans').text()).toContain('旧版选项文案')
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

  it('#5 乱序消灭：点选在途 + blur 补充——saveExtra 入链排队不并发，终值 = 后到 PUT 含 extra', async () => {
    const { api } = await import('../src/api.js')
    const rel = []
    api.put.mockImplementation(() => new Promise(r => { rel.push(r) }))   // 两个 PUT 挂起可控
    const items = [{ ...OPT_ITEM }]
    const w = await mountWb(items)
    await w.findAll('.opt')[0].trigger('click')      // PUT1 挂起——payload 已捕获（JSON 无 extra）
    await w.find('.more-answer').trigger('click')
    await w.find('.extra-ta').setValue('补充口径')
    await w.find('.extra-ta').trigger('blur')        // PUT2：saveExtra 入链（排队，不直发）
    await flushPromises()
    expect(api.put).toHaveBeenCalledTimes(1)         // 修复前此处已并发直发 PUT2——网络乱序源
    rel[0]()                                          // PUT1 完成——回写 = 捕获的发送值（D-B）
    await flushPromises()
    expect(api.put).toHaveBeenCalledTimes(2)         // PUT1 完成后 PUT2 才发出（串行结构性消灭乱序）
    expect(items[0].answer).toBe('{"kind":"option","optionKey":"A","optionText":"选项A全文"}')  // 中间态=捕获值
    expect(JSON.parse(api.put.mock.calls[1][1].answer).extra).toBe('补充口径')   // 发送时装配=最新值
    rel[1]()                                          // PUT2 完成——终值 = 后到 PUT（最后值胜）
    await flushPromises()
    expect(items[0].answer).toBe('{"kind":"option","optionKey":"A","optionText":"选项A全文","extra":"补充口径"}')
    expect(items[0].answerText).toBe('选项A全文（补充：补充口径）')   // extra 不再静默丢失
  })

  it('#3 点选在途回写切视图：textarea 卸载无 blur——自动替身保存，extra 不滞留、reopen 不丢', async () => {
    const { api } = await import('../src/api.js')
    const rel = []
    api.put.mockImplementation(() => new Promise(r => { rel.push(r) }))
    const items = [{ ...OPT_ITEM }]
    const w = await mountWb(items)
    await w.findAll('.opt')[0].trigger('click')      // PUT1 挂起（捕获 payload 无 extra）
    await w.find('.more-answer').trigger('click')
    await w.find('.extra-ta').setValue('两校区都要收到')   // 输入补充——全程无 blur（Vue 卸载不派发）
    expect(api.put).toHaveBeenCalledTimes(1)
    rel[0]()                                          // PUT1 完成——回写切 answered 视图（textarea 卸载）
    await flushPromises()
    expect(api.put).toHaveBeenCalledTimes(2)         // 替身保存自动补发（#3 修复点）
    expect(JSON.parse(api.put.mock.calls[1][1].answer).extra).toBe('两校区都要收到')
    expect(api.put.mock.calls[1][1].status).toBe('answered')
    rel[1]()
    await flushPromises()
    expect(items[0].answerText).toBe('选项A全文（补充：两校区都要收到）')   // 终值含补充，不滞留本地
  })

  it('#4 处置与在途 blur PUT 串行：驳回 PUT 排队待作答完成，终态驳回、理由不被覆写', async () => {
    const { api } = await import('../src/api.js')
    const rel = []
    api.put.mockImplementation(() => new Promise(r => { rel.push(r) }))
    const items = [{ ...OPT_ITEM }]
    const w = await mountWb(items)
    await w.find('.more-answer').trigger('click')
    await w.find('.extra-ta').setValue('补充口径')
    await w.find('.extra-ta').trigger('blur')        // blur 先于 click——作答 PUT 已入链发出（挂起）
    await flushPromises()
    expect(api.put).toHaveBeenCalledTimes(1)
    await w.findAll('.ans-ops .btn')[0].trigger('click')   // 驳回（弹窗开）
    await w.find('.modal textarea').setValue('原文已在其他条款明确')
    await w.find('.modal-f .primary').trigger('click')     // 确认——处置 PUT 入链（排队）
    await flushPromises()
    expect(api.put).toHaveBeenCalledTimes(1)         // 修复前处置直发竞速——现排队待 blur PUT 完成
    rel[0]()                                          // blur 作答 PUT 完成
    await flushPromises()
    expect(api.put).toHaveBeenCalledTimes(2)         // 处置 PUT 才发出（必然后到——整行覆写语义正确）
    expect(api.put.mock.calls[1][1]).toEqual({ status: 'rejected', note: '原文已在其他条款明确' })
    rel[1]()
    await flushPromises()
    expect(items[0].status).toBe('rejected')        // 终态驳回——理由保留，不被后到作答 PUT 打回 answered
    expect(items[0].note).toBe('原文已在其他条款明确')
  })

  it('在途丢弃语义不回归（§2.3）：blur PUT 在途期间连续 blur 丢弃，完成后下次 blur 发最新值', async () => {
    const { api } = await import('../src/api.js')
    const rel = []
    api.put.mockImplementation(() => new Promise(r => { rel.push(r) }))
    // 无 options 卡：draft 体制下 answered 后 textarea 常驻，可多次 blur
    const items = [{ seq: 'P02', level: 'yellow', theme: '域', question: 'q', answer: '', status: 'pending', note: '', origin: 'skill' }]
    const w = await mountWb(items)
    const ta = w.find('textarea[name="clf-answer-P02"]')
    await ta.setValue('第一版')
    await ta.trigger('blur')                         // PUT1 挂起
    await ta.setValue('第二版')                       // 在途期间继续输入
    await ta.trigger('blur')                         // 连续 blur——丢弃（§2.3 在途丢弃）
    await flushPromises()
    expect(api.put).toHaveBeenCalledTimes(1)
    rel[0]()
    await flushPromises()
    expect(api.put).toHaveBeenCalledTimes(1)         // 丢弃的 blur 不补发（语义未因入链回归）
    await ta.trigger('blur')                         // 下次 blur 发送时装配最新值
    await flushPromises()
    expect(api.put).toHaveBeenCalledTimes(2)
    expect(api.put.mock.calls[1][1]).toEqual({ answer: '第二版' })
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
  it('空态右栏照常渲染（§1.2 r2 C3）：items 空 ∧ audit 无 → EmptyState + ctx-col 并存（review F2）', async () => {
    const { default: WorkbenchTab } = await import('../src/components/WorkbenchTab.vue')
    const { GRP_KEY } = await import('../src/composables/group-collapse.js')
    const grp = { openGrps: new Set(), toggleGrp: () => {}, expandAll: () => {}, collapseAll: () => {}, revealGrpFor: () => {} }
    const w = mount(WorkbenchTab, { props: { reqId: 'REQ-1', items: [], status: 'submitted',
      groups: [], audit: null, concludedGroups: [],
      doc: { content: { blocks: [{ id: 'blk-1', type: 'paragraph', text: '原文段落' }], media: [] } },
      snapshot: { md: '# 原文', at: '', version: 1 } },
      global: { provide: { [GRP_KEY]: grp } } })
    expect(w.text()).toContain('质检产物尚未推送')          // 左栏 EmptyState
    expect(w.find('.ctx-col').exists()).toBe(true)          // 右栏照常渲染（不依赖产物数据）
  })

  it('无 layer 数据降级：不渲染维度条（D12 降级不冒充——不以 theme 近似维度）', async () => {
    const items = [{ seq: 'P01', level: 'yellow', theme: '教研活动', question: 'q', answer: '', status: 'pending', note: '', origin: 'skill' }]
    const w = await mountWb(items)
    expect(w.find('.readiness').exists()).toBe(false)
    expect(w.find('.wb-prog').exists()).toBe(true)    // 进度卡保留
  })
})

describe('WorkbenchTab：V5 review 批3（#7 过滤空组 / #8 过滤联动 / #9 失败清 picked）', () => {
  it('#7 clf=pending 过滤下空组保留：concluded-blk 不消失，组头计「0 题 · 已定论 1 条」', async () => {
    const items = [{ ...OPT_ITEM, status: 'answered', answer: '{"kind":"option","optionKey":"A","optionText":"选项A全文"}', answerText: '选项A全文' }]
    const w = await mountWb(items)
    await w.setProps({ concludedGroups: [
      { name: '已定论·组', raw: '组', items: [{ id: '体检.P01', level: 'yellow', title: '已定论条目', go: '✅ 已明确', where: '', quote: '', anchor: '' }] }] })
    await w.findAll('button').find(b => b.text() === '只看待处置').trigger('click')   // clfFilter: all → pending
    expect(w.find('.concluded-blk').exists()).toBe(true)          // 已定论块是只读参照，不随过滤消失
    expect(w.find('.grp-t').text()).toContain('0 题 · 已定论 1 条')
  })

  it('#8a hasLayers 翻转为 false 清 dimFilter：维度条卸载后唯一取消入口消失——防全栏空死锁', async () => {
    const w = await mountWb(LAYER_ITEMS)
    const l2 = w.findAll('.dim').find(d => d.text().includes('L2'))
    await l2.trigger('click')                                       // dimFilter='2'——左栏只剩 L2 两题
    expect(w.findAll('[data-pid]').map(el => el.attributes('data-pid')).sort()).toEqual(['P01', 'P02'])
    const plain = [
      { seq: 'Q01', level: 'yellow', theme: '域', question: 'a', answer: '', status: 'pending', note: '', origin: 'skill' },
      { seq: 'Q02', level: 'yellow', theme: '域', question: 'b', answer: '', status: 'pending', note: '', origin: 'skill' },
    ]
    await w.setProps({ items: plain, groups: [{ name: '组', items: plain }] })   // items 重拉后无 layer
    await flushPromises()
    expect(w.find('.readiness').exists()).toBe(false)              // 维度条卸载（取消入口随之消失）
    expect(w.findAll('[data-pid]').map(el => el.attributes('data-pid')).sort()).toEqual(['Q01', 'Q02'])   // dimFilter 已清、全部回显
  })

  it('#8b dimFilter 单独变（clf 仍 all）也 expandAll——修复前 watch 只看 clf 首参漏展开', async () => {
    const { default: WorkbenchTab } = await import('../src/components/WorkbenchTab.vue')
    const { GRP_KEY } = await import('../src/composables/group-collapse.js')
    const grp = { openGrps: new Set(), toggleGrp: () => {}, expandAll: vi.fn(), collapseAll: () => {}, revealGrpFor: () => {} }
    const groups = [{ name: '组', items: LAYER_ITEMS }]
    const w = mount(WorkbenchTab, { props: { reqId: 'REQ-1', items: LAYER_ITEMS, status: 'clarifying',
      groups, audit: null, concludedGroups: [], doc: null, snapshot: null },
      global: { provide: { [GRP_KEY]: grp } } })
    const l2 = w.findAll('.dim').find(d => d.text().includes('L2'))
    await l2.trigger('click')                                       // 只动 dimFilter，clfFilter 仍 'all'
    await flushPromises()
    expect(grp.expandAll).toHaveBeenCalledWith(groups)              // 过滤视图下组展开（旧版被 c!=='all' 短路）
  })

  it('#9 点选 PUT 失败清乐观选中：toast 保存失败、无 picked 态、status 仍 pending', async () => {
    const { api } = await import('../src/api.js')
    api.put.mockRejectedValueOnce(new Error('网络中断'))
    const items = [{ ...OPT_ITEM }]
    const w = await mountWb(items)
    await w.findAll('.opt')[0].trigger('click')
    await flushPromises()
    expect(w.emitted('toast').at(-1)).toEqual(['保存失败：网络中断', 'err'])
    expect(w.findAll('.opt.picked').length).toBe(0)                 // 乐观选中清——失败不冒充已选
    expect(items[0].status).toBe('pending')                         // 未被切 answered
  })

  it('#9 失败 settle 时排队新点击不被误清：A 挂起→B 排队→A 拒——B 载荷完整、终值 B（条件清理）', async () => {
    const { api } = await import('../src/api.js')
    let rejectA
    api.put.mockImplementationOnce(() => new Promise((_, rej) => { rejectA = rej }))   // deferred rejection 真正挂起 A
    api.put.mockResolvedValueOnce({})   // B 立即成功（默认实现已被前序用例 mockImplementation 覆盖，不可依赖回落）
    const items = [{ ...OPT_ITEM }]
    const w = await mountWb(items)
    await w.findAll('.opt')[0].trigger('click')                     // A 在途（picked='A'）
    await w.findAll('.opt')[1].trigger('click')                     // B 排队（picked='B' 先于 A 的 catch 写入）
    expect(api.put).toHaveBeenCalledTimes(1)                        // B 排队未并发
    rejectA(new Error('A 失败'))                                    // A 拒——catch 运行时 picked 已是 'B'
    await flushPromises()
    expect(api.put).toHaveBeenCalledTimes(2)                        // 链不断：B 照发
    expect(JSON.parse(api.put.mock.calls[1][1].answer).optionKey).toBe('B')   // 无条件删会把 B 载荷打成空 answer
    expect(items[0].answerText).toBe('选项B全文')                    // 终值 B（后到者胜）
    expect(w.emitted('toast').at(-1)).toEqual(['保存失败：A 失败', 'err'])       // A 的失败仍如实 toast
  })
})

describe('WorkbenchTab：批 E（P1-13 CSS 变量 / U-11 弹窗 Esc）', () => {
  it('P1-13 右栏宽度行走 CSS 变量（--ctx-w），行内不再写 gridTemplateColumns（媒体查询可覆盖）', async () => {
    const { default: WorkbenchTab } = await import('../src/components/WorkbenchTab.vue')
    const { GRP_KEY } = await import('../src/composables/group-collapse.js')
    const grp = { openGrps: new Set(), toggleGrp: () => {}, expandAll: () => {}, collapseAll: () => {}, revealGrpFor: () => {} }
    const items = [{ ...OPT_ITEM }]
    const w = mount(WorkbenchTab, {
      props: { reqId: 'REQ-1', items, status: 'clarifying', groups: [{ name: '组', items }],
        audit: null, concludedGroups: [],
        doc: { content: { blocks: [{ id: 'blk-1', type: 'paragraph', text: '原文段落' }], media: [] } },
        snapshot: { md: '# 原文', at: '', version: 1 } },
      global: { provide: { [GRP_KEY]: grp } }
    })
    const style = w.find('.wb-grid').attributes('style') || ''
    expect(style).toContain('--ctx-w')
    expect(style).not.toContain('grid-template-columns')
  })

  it('U-11 处置弹窗 Esc 关闭（3/4 缺失的补全）', async () => {
    const items = [{ ...OPT_ITEM }]
    const w = await mountWb(items)
    await w.findAll('.ans-ops .btn')[0].trigger('click')   // 驳回 → 弹窗
    await flushPromises()
    expect(w.find('.modal').exists()).toBe(true)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flushPromises()
    expect(w.find('.modal').exists()).toBe(false)
  })
})

describe('WorkbenchTab：v5.3 章节分组 + 活动卡联动', () => {
  const DOC = { content: { blocks: [
    { id: 'h1', type: 'heading', level: 1, text: '一、背景' },
    { id: 'p1', type: 'paragraph', text: '操作权限服从区域平台的统一管理' },
    { id: 'h2', type: 'heading', level: 1, text: '二、需求背景' },
    { id: 'p2', type: 'paragraph', text: '段二' },
  ], media: [] } }
  const SEC_ITEM = { seq: 'P01', level: 'red', theme: '权限', question: '角色矩阵缺失？', answer: '',
    status: 'pending', note: '', ctx: '详述·产品入口说明 2', quote: '「操作权限服从」', anchor: 'p1', origin: 'skill' }

  const mountSec = async (items, groups) => {
    const { default: WorkbenchTab } = await import('../src/components/WorkbenchTab.vue')
    const { GRP_KEY } = await import('../src/composables/group-collapse.js')
    const grp = { openGrps: new Set(['h1']), toggleGrp: () => {}, expandAll: () => {}, collapseAll: () => {}, revealGrpFor: () => {} }
    return mount(WorkbenchTab, { props: { reqId: 'REQ-1', items, status: 'clarifying',
      groups: groups ?? [{ name: 'h1', title: '一、背景', items }], audit: null, concludedGroups: [],
      doc: DOC, snapshot: null },
      global: { provide: { [GRP_KEY]: grp } } })
  }

  it('组头渲染 title 节名（name=锚键不外显）；theme 降为卡上标签', async () => {
    const w = await mountSec([SEC_ITEM])
    expect(w.find('.grp-t').text()).toContain('一、背景')
    expect(w.find('.theme-tag').text()).toBe('权限')
  })

  it('点击卡 → 活动卡描边 + 右栏常驻高亮 + 面包屑 fromTip + TOC 同步/节级徽标', async () => {
    const w = await mountSec([SEC_ITEM])
    await w.find('.check-item').trigger('click')
    await flushPromises()
    expect(w.find('.check-item.active').attributes('data-pid')).toBe('P01')   // 活动卡描边
    expect(w.find('[data-blk="p1"]').classes()).toContain('ctx-hl')           // 右栏常驻高亮
    expect(w.find('.ctx-from').text()).toContain('一、背景')                   // fromTip 节链面包屑
    expect(w.find('.ctx-toc .toc-item.on').text()).toContain('一、背景')       // TOC 同步高亮
    expect(w.find('.toc-pill').text()).toBe('1')                               // 节级待澄清徽标（anchor→节聚合）
  })
})

describe('WorkbenchTab：v5.4 作答流（下一待处置口径 / 自动推进 / 自动收起 / 待处置筛选暂留）', () => {
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView || (() => {})
  // 前序用例以 mockImplementation 永久替换 api.put 为挂起 Promise（clearAllMocks 不复原实现）——本组需真实成功回调
  beforeEach(async () => {
    const { api } = await import('../src/api.js')
    api.put.mockImplementation(async () => ({}))
  })
  const opt = (seq, extra = {}) => ({ ...OPT_ITEM, seq, question: 'q' + seq, ...extra })
  // 显示序（组序）≠ items 原始序：g1=[P03,P01] → g2=[P02]
  const mountG = async (items, order = [['g1', ['P03', 'P01']], ['g2', ['P02']]]) => {
    const { default: WorkbenchTab } = await import('../src/components/WorkbenchTab.vue')
    const { GRP_KEY } = await import('../src/composables/group-collapse.js')
    const grp = { openGrps: new Set(), toggleGrp: () => {}, expandAll: () => {}, collapseAll: () => {}, revealGrpFor: () => {} }
    const by = Object.fromEntries(items.map(i => [i.seq, i]))
    const groups = order.map(([name, seqs]) => ({ name, items: seqs.map(s => by[s]) }))
    return mount(WorkbenchTab, { props: { reqId: 'REQ-1', items, status: 'clarifying', groups,
      audit: null, concludedGroups: [], doc: null, snapshot: null }, global: { provide: { [GRP_KEY]: grp } } })
  }
  const active = w => w.find('.check-item.active').attributes('data-pid')
  const jumpBtn = w => w.findAll('.wb-prog .btn.primary')[0]

  it('下一待处置按页面显示序走、从当前卡往后找、到底绕回第一题（非 items 原始序首个）', async () => {
    const items = [opt('P01'), opt('P02'), opt('P03')]
    const w = await mountG(items)
    await w.find('[data-pid="P01"]').trigger('click')       // 激活 P01（显示序第 2）
    await jumpBtn(w).trigger('click')
    expect(active(w)).toBe('P02')                           // 显示序下一张
    await jumpBtn(w).trigger('click')
    expect(active(w)).toBe('P03')                           // 到底绕回显示序第一题
  })

  it('下一待处置跳过已处置卡；全部答完按钮消失', async () => {
    // reactive：壳层 items 来自 ref（深响应式），字段原地改写才会驱动 computed——夹具同构
    const items = reactive([opt('P01'), opt('P02', { status: 'answered', answerText: 'x', answer: 'x' }), opt('P03')])
    const w = await mountG(items)
    await w.find('[data-pid="P01"]').trigger('click')
    await jumpBtn(w).trigger('click')
    expect(active(w)).toBe('P03')                           // P02 已答被跳过，绕回 P03
    items.forEach(i => { i.status = 'answered' })
    await flushPromises()
    expect(w.find('.wb-prog .btn.primary').exists()).toBe(false)
  })

  it('答完自动下一题：点选保存后 ~400ms 活动卡推进到显示序下一待处置；开关关闭则停留', async () => {
    localStorage.setItem('wb.autoNext', '1')
    const items = [opt('P01'), opt('P02'), opt('P03')]
    const w = await mountG(items)
    await w.find('[data-pid="P03"] .opt').trigger('click')  // 点选冒泡激活 P03 并保存
    await flushPromises()
    expect(active(w)).toBe('P03')
    await new Promise(r => setTimeout(r, 450))
    expect(active(w)).toBe('P01')                           // 显示序 P03 → P01
    await w.findAll('.wb-sw input')[0].setValue(false)     // 关「答完自动下一题」
    await w.find('[data-pid="P01"] .opt').trigger('click')
    await flushPromises()
    await new Promise(r => setTimeout(r, 450))
    expect(active(w)).toBe('P01')                           // 开关关：不推进
    expect(localStorage.getItem('wb.autoNext')).toBe('0')   // 开关记忆
  })

  it('修改已答卡（非待处置）不触发自动推进', async () => {
    localStorage.setItem('wb.autoNext', '1')
    const items = [opt('P01', { status: 'answered', answer: '{"kind":"option","optionKey":"A","optionText":"选项A全文"}', answerText: '选项A全文' }), opt('P02'), opt('P03')]
    const w = await mountG(items)
    await w.findAll('[data-pid="P01"] .opt')[1].trigger('click')
    await flushPromises()
    await new Promise(r => setTimeout(r, 450))
    expect(active(w)).toBe('P01')
  })

  it('答完自动收起：已处置卡（含进页面即已完成的）收成摘要行；点击展开可改，「收起」复原', async () => {
    localStorage.setItem('wb.autoCollapse', '1')
    const items = [opt('P01', { status: 'answered', answer: '{"kind":"option","optionKey":"A","optionText":"选项A全文"}', answerText: '选项A全文' }),
      opt('P02', { status: 'rejected', note: '不是问题' }), opt('P03')]
    const w = await mountG(items)
    expect(w.find('[data-pid="P01"]').classes()).toContain('folded')
    expect(w.find('[data-pid="P01"] .ci-fold').text()).toContain('选项A全文')
    expect(w.find('[data-pid="P02"] .ci-fold').text()).toContain('不是问题')   // 驳回摘要带理由
    expect(w.find('[data-pid="P03"]').classes()).not.toContain('folded')      // 待处置不收
    await w.find('[data-pid="P01"] .ci-fold').trigger('click')
    expect(w.find('[data-pid="P01"]').classes()).not.toContain('folded')
    expect(w.findAll('[data-pid="P01"] .opt').length).toBe(2)                // 展开即改：选项可点
    await w.find('[data-pid="P01"] .fold-back').trigger('click')
    expect(w.find('[data-pid="P01"]').classes()).toContain('folded')
  })

  it('点选作答后卡片即收起（开关开）', async () => {
    localStorage.setItem('wb.autoCollapse', '1')
    const items = [opt('P01'), opt('P02'), opt('P03')]
    const w = await mountG(items)
    await w.find('[data-pid="P01"] .opt').trigger('click')
    await flushPromises()
    expect(w.find('[data-pid="P01"]').classes()).toContain('folded')
  })

  it('「只看待处置」下刚答的卡暂留不消失；切换筛选后才按真实状态隐藏', async () => {
    const items = [opt('P01'), opt('P02'), opt('P03')]
    const w = await mountG(items)
    const flt = () => w.find('.wb-prog .btns .btn:not(.primary)')   // 已处置筛选下无可见待处置，跳题按钮隐藏——不按下标取
    await flt().trigger('click')                              // all → pending
    await w.find('[data-pid="P01"] .opt').trigger('click')
    await flushPromises()
    expect(w.find('[data-pid="P01"]').exists()).toBe(true)    // 暂留
    await flt().trigger('click')                              // → done
    await flt().trigger('click')                              // → all
    await flt().trigger('click')                              // → pending（暂留集已清）
    expect(w.find('[data-pid="P01"]').exists()).toBe(false)
  })
})

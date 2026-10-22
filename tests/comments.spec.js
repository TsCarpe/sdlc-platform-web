// @vitest-environment jsdom
// v4 评论 UI 冒烟：CommentsPanel 线程组装/动作 + ChecklistTab L 系跳回 + ReqList 未解决角标。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

vi.mock('../src/confirm.js', () => ({ ask: vi.fn(async () => true) }))
vi.mock('../src/api.js', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() },
  uploadMedia: vi.fn()
}))

const commentsFixture = () => [
  { id: 1, blockId: '', origin: 'platform', externalId: '', author: '张三', text: '整体边界？',
    replyTo: null, resolved: false, createdAt: '2026-10-14 10:00:00' },
  { id: 2, blockId: '', origin: 'platform', externalId: '', author: '李四', text: '同意',
    replyTo: 1, resolved: false, createdAt: '2026-10-14 10:01:00' },
  { id: 3, blockId: 'v4-p1', origin: 'feishu', externalId: 'cm-1', author: '王五', text: '口径歧义',
    replyTo: null, resolved: true, createdAt: '2026-10-14 09:00:00' }
]

let api
beforeEach(async () => {
  vi.clearAllMocks()
  const mod = await import('../src/api.js')
  api = mod.api
  api.get.mockResolvedValue({ comments: commentsFixture(), unresolvedCount: 2 })
  api.post.mockResolvedValue({})
  api.del.mockResolvedValue({ ok: true })
  api.put.mockResolvedValue({})
})

const mountPanel = async (over = {}) => {
  const { default: CommentsPanel } = await import('../src/components/CommentsPanel.vue')
  return mount(CommentsPanel, {
    props: { reqId: 'REQ-1', comments: commentsFixture(), blockText: { 'v4-p1': '口径有歧义的那段' },
      escalatedIds: [3], ...over }
  })
}

describe('CommentsPanel：线程组装与呈现', () => {
  it('卡片级/块锚定分组 + 未解决计数 + 已解决线程弱化', async () => {
    const w = await mountPanel()
    const secs = w.findAll('.cmts-sec').map(x => x.text())
    expect(secs).toEqual(['整体疑问', '原文块讨论'])
    expect(w.find('.cmts-h .chip').text()).toContain('2 条未解决')
    expect(w.findAll('.cthread-card').length).toBe(2)
    expect(w.findAll('.cthread-card')[0].classes()).not.toContain('resolved')
    expect(w.findAll('.cthread-card')[1].classes()).toContain('resolved')
  })

  it('回复串挂到根；按钮态随 resolved 切换', async () => {
    const w = await mountPanel()
    const card = w.findAll('.cthread-card')[0]
    const msgs = card.findAll('.ct-msg')
    expect(msgs.length).toBe(2)                       // 根 + 回复
    expect(msgs[1].text()).toContain('同意')
    expect(card.find('.ct-ops').text()).toContain('解决')   // 根未解决 → 动作为「解决」
    expect(w.findAll('.cthread-card')[1].find('.ct-ops').text()).toContain('重开')  // 已解决 → 「重开」
  })

  it('escalatedIds 命中 → 升级按钮禁用（重复升级 409 的前端预防）', async () => {
    const w = await mountPanel()
    const blk = w.findAll('.cthread-card')[1]
    const escBtn = blk.findAll('button').find(b => b.text().includes('升级澄清'))
    expect(escBtn.attributes('disabled')).toBeDefined()
  })

  it('解决/回复/发评/删除 打对端点', async () => {
    const w = await mountPanel()
    await w.find('.cmts-row input').setValue('测试员')   // 署名守卫：先填作者
    // 解决线程（根 id=1）
    const resolveBtn = w.findAll('.cthread-card')[0].findAll('button').find(b => ['解决', '重开'].includes(b.text()))
    await resolveBtn.trigger('click')
    expect(api.post).toHaveBeenCalledWith('/api/requirements/REQ-1/comments/1/resolve', { resolved: true })
    // 回复（replyTo=1）
    const replyInp = w.findAll('.cthread-card')[0].find('.ct-ops input')
    await replyInp.setValue('补充一句')
    const replyBtn = w.findAll('.cthread-card')[0].findAll('button').find(b => b.text().trim() === '回复')
    await replyBtn.trigger('click')
    expect(api.post).toHaveBeenCalledWith('/api/requirements/REQ-1/comments',
      expect.objectContaining({ replyTo: 1, text: '补充一句', author: '测试员' }))
    // 删除单条
    await w.findAll('.ct-msg .cdel')[0].trigger('click')
    expect(api.del).toHaveBeenCalledWith('/api/requirements/REQ-1/comments/2')
    expect(w.emitted('refresh')).toBeTruthy()
  })

  it('升级弹层带级别选择，提交打 escalate 端点', async () => {
    const w = await mountPanel({ escalatedIds: [] })
    const escBtn = w.findAll('button').find(b => b.text().includes('升级澄清'))
    await escBtn.trigger('click')
    expect(w.find('.modal').text()).toContain('升级为澄清项')
    w.find('.modal input[type="radio"][value="red"]').setValue()
    await w.find('.modal .btn.primary').trigger('click')
    expect(api.post).toHaveBeenCalledWith('/api/requirements/REQ-1/comments/1/escalate',
      expect.objectContaining({ level: 'red' }))
  })

  it('v5.x feishu 源评论：「来自源文档」标签 + 根与回复均无删除按钮（重导复活防线）', async () => {
    const mixed = [
      { id: 1, blockId: '', origin: 'platform', externalId: '', author: '张三', text: '平台根',
        replyTo: null, resolved: false, createdAt: '2026-10-14 10:00:00' },
      { id: 2, blockId: '', origin: 'platform', externalId: '', author: '李四', text: '平台回复',
        replyTo: 1, resolved: false, createdAt: '2026-10-14 10:01:00' },
      { id: 3, blockId: 'v4-p1', origin: 'feishu', externalId: '7011111111111111111', author: '王五', text: '飞书根',
        replyTo: null, resolved: false, createdAt: '2026-10-14 09:00:00' },
      { id: 4, blockId: 'v4-p1', origin: 'feishu', externalId: '7011111111111111111', author: '赵六', text: '飞书回复',
        replyTo: 3, resolved: false, createdAt: '2026-10-14 09:01:00' }
    ]
    const w = await mountPanel({ comments: mixed, escalatedIds: [] })
    const plat = w.findAll('.cthread-card')[0]   // 根 id=1（id 升序）
    const fs = w.findAll('.cthread-card')[1]     // 根 id=3
    expect(fs.find('.src-chip').text()).toBe('来自源文档')
    expect(plat.find('.src-chip').exists()).toBe(false)
    expect(fs.find('.ct-ops .cdel').exists()).toBe(false)                    // feishu 根不可删
    expect(plat.find('.ct-ops .cdel').exists()).toBe(true)                   // platform 根可删
    expect(fs.findAll('.ct-msg.reply .cdel').length).toBe(0)                 // feishu 回复不可删
    expect(plat.findAll('.ct-msg.reply .cdel').length).toBe(1)               // platform 回复可删
    // 解决/升级仍可用（feishu 行只禁删除）
    expect(fs.find('.ct-ops').text()).toContain('解决')
    expect(fs.find('.ct-ops').text()).toContain('升级澄清')
  })
})

describe('WorkbenchTab（原 ChecklistTab）：L 系 origin 呈现与跳回', () => {
  const mountCheck = async (items, over = {}) => {
    const { default: WorkbenchTab } = await import('../src/components/WorkbenchTab.vue')
    const { GRP_KEY } = await import('../src/composables/group-collapse.js')
    // WorkbenchTab inject 分组折叠协议——孤立挂载需补 provide（壳层 ReqDetail 常规路径已提供）
    const grp = { openGrps: new Set(), toggleGrp: () => {}, expandAll: () => {}, collapseAll: () => {}, revealGrpFor: () => {} }
    return mount(WorkbenchTab, { props: { reqId: 'REQ-1', items, status: 'clarifying',
      groups: [{ name: '组', items }], ...over }, global: { provide: { [GRP_KEY]: grp } } })
  }
  it('L 系行显示「来自评论」并可跳回（携带 srcCommentId；无 doc → 只读回退 view-comment）', async () => {
    const items = [{ seq: 'L01', level: 'yellow', theme: '评论升级', question: 'q', answer: '', status: 'pending', origin: 'local', srcCommentId: 7 }]
    const w = await mountCheck(items)
    const link = w.findAll('.jump-link').find(b => b.text().includes('来自评论'))
    expect(link).toBeTruthy()
    expect(w.text()).not.toContain('来自体检.L01')
    await link.trigger('click')
    expect(w.emitted('view-comment')[0]).toEqual([7])   // 无块结构（无右栏）→ 只读抽屉回退
  })
  it('P 系（默认来源）不再标注「来自体检」（v5.4 卡头精简）；incremental 行显示静态「增量质检」标签', async () => {
    const items = [{ seq: 'P01', level: 'yellow', theme: '域', question: 'q', answer: '', status: 'pending', origin: 'skill' },
      { seq: 'P2', level: 'yellow', theme: '域', question: '增量问', answer: '', status: 'pending', origin: 'incremental' }]
    const w = await mountCheck(items)
    expect(w.text()).not.toContain('来自体检.P01')
    expect(w.find('.origin-tag').text()).toBe('增量质检')   // 非链接样式（不再冒充 jump-link）
    expect(w.text()).not.toContain('来自评论')
  })

  // ===== 出处=评论 → 右栏评论出处卡（只读查看态） =====
  const docOf = () => ({ content: { blocks: [{ id: 'blk-1', type: 'paragraph', text: '正文段落' }] } })
  const cmtRows = () => [
    { id: 7, blockId: 'blk-1', origin: 'platform', externalId: '', author: '张三', text: '这条口径有歧义',
      replyTo: null, resolved: false, createdAt: '2026-10-14 10:00:00' },
    { id: 8, blockId: 'blk-1', origin: 'platform', externalId: '', author: '李四', text: '回复补充',
      replyTo: 7, resolved: false, createdAt: '2026-10-14 10:05:00' }
  ]
  const l01 = srcCommentId => ({ seq: 'L01', level: 'yellow', theme: '评论升级', question: 'q',
    answer: '', status: 'pending', origin: 'local', srcCommentId })

  it('有 doc：来自评论 → 右栏只读评论出处卡（线程+回复链、无任何输入框），不弹抽屉；「打开评论区」转发完整面板', async () => {
    const w = await mountCheck([l01(7)], { doc: docOf(), comments: cmtRows(), blockText: { 'blk-1': '正文段落' } })
    await w.findAll('.jump-link').find(b => b.text().includes('来自评论')).trigger('click')
    await flushPromises()
    const card = w.find('.ctx-cmt')
    expect(card.exists()).toBe(true)
    expect(card.text()).toContain('评论出处 L01')
    expect(card.text()).toContain('张三')
    expect(card.text()).toContain('这条口径有歧义')
    expect(card.text()).toContain('回复补充')                       // 回复链同卡
    expect(card.findAll('input, textarea').length).toBe(0)         // 只读——无回复框/发评框
    expect(w.emitted('open-comment')).toBeUndefined()              // 不经抽屉
    await card.find('.ctx-cmt-f button').trigger('click')
    expect(w.emitted('open-comment')[0]).toEqual([7])              // 打开评论区 → 完整面板（携带根 id）
  })

  it('悬空 srcCommentId（评论已删）→ 回退 view-comment，不渲染空壳卡', async () => {
    const w = await mountCheck([l01(999)], { doc: docOf(), comments: cmtRows() })
    await w.findAll('.jump-link').find(b => b.text().includes('来自评论')).trigger('click')
    await flushPromises()
    expect(w.find('.ctx-cmt').exists()).toBe(false)
    expect(w.emitted('view-comment')[0]).toEqual([999])
  })

  it('卡显示中目标线程被删（comments 变化）→ 卡自动消失；右栏收起态点出处 → 自动展开出卡', async () => {
    const w = await mountCheck([l01(7)], { doc: docOf(), comments: cmtRows(), blockText: { 'blk-1': '正文段落' } })
    // 收起右栏（点 CtxPane「收起」）→ 卡随 v-if 卸载消失
    const collapseBtn = w.findAll('button').find(b => b.text().includes('收起'))
    expect(collapseBtn).toBeTruthy()
    await collapseBtn.trigger('click')
    expect(w.find('.ctx-cmt').exists()).toBe(false)                // 尚未开卡时本来就无卡
    // 收起态点出处 → 自动展开右栏 + 出卡（openCommentInCtx 先置 ctxCollapsed=false）
    await w.findAll('.jump-link').find(b => b.text().includes('来自评论')).trigger('click')
    await flushPromises()
    expect(w.find('.ctx-cmt').exists()).toBe(true)
    expect(w.find('.ctx-cmt').text()).toContain('张三')
    // 目标线程整体被删（comments 清空）→ cmtThread miss → 卡自动消失不留空壳
    await w.setProps({ comments: [] })
    expect(w.find('.ctx-cmt').exists()).toBe(false)
  })
})

describe('ReqList：未解决评论角标（逐卡后台拉取）', () => {
  it('unresolvedCount > 0 的卡显示角标', async () => {
    api.get.mockImplementation(async url => {
      if (url === '/api/requirements') {
        return [{ id: 'REQ-A', name: '有评论', iter: '', sourceType: 'text', status: 'clarifying',
          submittedBy: '', riskTier: '', totalQ: 1, answeredQ: 0, caseCount: 0 },
          { id: 'REQ-B', name: '无评论', iter: '', sourceType: 'text', status: 'submitted',
            submittedBy: '', riskTier: '', totalQ: 0, answeredQ: 0, caseCount: 0 }]
      }
      if (String(url).endsWith('/REQ-A/comments')) return { comments: [{ id: 1 }], unresolvedCount: 3 }
      if (String(url).endsWith('/comments')) return { comments: [], unresolvedCount: 0 }
      return []
    })
    const { default: ReqList } = await import('../src/components/ReqList.vue')
    const w = mount(ReqList)
    await flushPromises()
    const rowA = w.findAll('tbody tr')[0]
    expect(rowA.find('.cmt-chip').exists()).toBe(true)
    expect(rowA.find('.cmt-chip').text()).toContain('3')
    expect(w.findAll('tbody tr')[1].find('.cmt-chip').exists()).toBe(false)
  })
})

describe('GateTab：GR-3 横幅带变更单号点入', () => {
  it('reqChangeIds 渲染 chips，点击 emit jump-change', async () => {
    const { default: GateTab } = await import('../src/components/GateTab.vue')
    const view = {
      reqId: 'REQ-1', phase: 'released', tier: 'A',
      round: { id: 9, roundNo: 1, status: 'released' },
      checks: [{ key: 'design', name: '设计', ok: true, detail: '' }],
      units: [], issues: [], rounds: [],
      change: { changed: true, window: 'released', reasons: ['digest 锚点漂移'], reqChangeIds: [156, 162] }
    }
    const w = mount(GateTab, { props: { reqId: 'REQ-1', view, operator: 'x' } })
    const chips = w.findAll('.chg-chip')
    expect(chips.length).toBe(2)
    expect(chips[0].text()).toContain('变更单 #156')
    await chips[1].trigger('click')
    expect(w.emitted('jump-change')[0]).toEqual([162])
  })
})

describe('OriginTab：飞书冻结提示（v4 §11.5）', () => {
  it('飞书来源 + 块结构：显示冻结横幅；text 来源不显示', async () => {
    const { default: OriginTab } = await import('../src/components/OriginTab.vue')
    const doc = { content: { blocks: [{ id: 'b1', type: 'paragraph', text: '块' }], media: [] } }
    const w = mount(OriginTab, { props: {
      card: { id: 'REQ-F', status: 'published', sourceType: 'feishu', sourceUrl: 'https://feishu.cn/x' },
      snapshot: null, doc } })
    expect(w.text()).toContain('原文已迁入平台')
    expect(w.text()).toContain('不再同步')
    const w2 = mount(OriginTab, { props: {
      card: { id: 'REQ-T', status: 'published', sourceType: 'text', sourceUrl: '', sourceText: 'x' },
      snapshot: null, doc } })
    expect(w2.text()).not.toContain('原文已迁入平台')
  })
})

describe('CommentsPanel：只读查看态（出处=评论经 view-comment / onLocate 进入）', () => {
  it('readonly：藏发评区与全部操作行/删除钮，头部「只读」chip + 「管理评论」emit edit', async () => {
    const w = await mountPanel({ readonly: true })
    expect(w.find('.cmts-compose').exists()).toBe(false)          // 发评区
    expect(w.findAll('.ct-ops').length).toBe(0)                   // 回复/解决/升级/删除操作行
    expect(w.findAll('.ct-msg .cdel').length).toBe(0)             // 回复行删除钮
    expect(w.find('.cmts-h').text()).toContain('只读')
    const btn = w.findAll('button').find(b => b.text() === '管理评论')
    expect(btn).toBeTruthy()
    await btn.trigger('click')
    expect(w.emitted('edit').length).toBe(1)
  })
  it('默认（非 readonly）照常可写：发评区 + 每线程一条操作行', async () => {
    const w = await mountPanel()
    expect(w.find('.cmts-compose').exists()).toBe(true)
    expect(w.findAll('.ct-ops').length).toBe(2)                   // 2 线程各一
    expect(w.find('.cmts-h').text()).not.toContain('只读')
  })
  it('refocus 限定抽屉自身域：文档序更前的同 data-cid 元素（模拟 CtxPane 评论出处卡）不被波及', async () => {
    // jsdom 无 scrollIntoView——stub 后还原
    const si = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = () => {}
    try {
      const outer = document.createElement('div')                 // 面板外同 id 元素（文档序在前）
      outer.setAttribute('data-cid', '3')
      document.body.insertBefore(outer, document.body.firstChild)
      const w = await mountPanel()
      await w.vm.refocus(3)                                       // 直调 expose（绕开 watch 同值不触发）
      await new Promise(r => setTimeout(r, 120))                  // refocus 内 60ms 渲染等待
      expect(outer.classList.contains('cmt-flash')).toBe(false)   // 面板外未被高亮
      const inner = w.find('[data-cid="3"]')
      expect(inner.classes()).toContain('cmt-flash')              // 面板内目标高亮
      outer.remove()
    } finally { Element.prototype.scrollIntoView = si }
  })
})

describe('comments.js：buildThreads / threadOf（面板与评论出处卡共用口径）', () => {
  it('根+回复链组装（悬空回复升根）；threadOf 根/回复 id 皆命中、miss 返 null', async () => {
    const { buildThreads, threadOf } = await import('../src/comments.js')
    const rows = [
      { id: 1, blockId: '', replyTo: null, resolved: false, author: 'a', text: '根', createdAt: '2026-10-14 10:00:00' },
      { id: 2, blockId: '', replyTo: 1, resolved: false, author: 'b', text: '回复', createdAt: '2026-10-14 10:01:00' },
      { id: 3, blockId: '', replyTo: 2, resolved: false, author: 'c', text: '二级回复', createdAt: '2026-10-14 10:02:00' },
      { id: 9, blockId: '', replyTo: 40, resolved: true, author: 'd', text: '悬空回复', createdAt: '2026-10-14 10:03:00' }   // 父不在 → 升根
    ]
    const ts = buildThreads(rows)
    expect(ts.map(t => t.root.id)).toEqual([1, 9])
    expect(ts[0].replies.map(r => r.id)).toEqual([2, 3])          // 深度遍历回复链
    expect(ts[1].replies).toEqual([])
    expect(ts[1].resolved).toBe(true)                             // resolved 看根
    expect(threadOf(ts, 1).root.id).toBe(1)
    expect(threadOf(ts, 3).root.id).toBe(1)                       // 回复 id 兜底到所属线程
    expect(threadOf(ts, 40)).toBe(null)                           // miss
    expect(threadOf(buildThreads([]), 1)).toBe(null)              // 空列表恒 miss
  })
})

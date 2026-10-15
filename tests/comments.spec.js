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
})

describe('WorkbenchTab（原 ChecklistTab）：L 系 origin 呈现与跳回', () => {
  const mountCheck = async items => {
    const { default: WorkbenchTab } = await import('../src/components/WorkbenchTab.vue')
    const { GRP_KEY } = await import('../src/composables/group-collapse.js')
    // WorkbenchTab inject 分组折叠协议——孤立挂载需补 provide（壳层 ReqDetail 常规路径已提供）
    const grp = { openGrps: new Set(), toggleGrp: () => {}, expandAll: () => {}, collapseAll: () => {}, revealGrpFor: () => {} }
    return mount(WorkbenchTab, { props: { reqId: 'REQ-1', items, status: 'clarifying',
      groups: [{ name: '组', items }] }, global: { provide: { [GRP_KEY]: grp } } })
  }
  it('L 系行显示「来自评论」并可跳回（携带 srcCommentId）', async () => {
    const items = [{ seq: 'L01', level: 'yellow', theme: '评论升级', question: 'q', answer: '', status: 'pending', origin: 'local', srcCommentId: 7 }]
    const w = await mountCheck(items)
    const link = w.findAll('.jump-link').find(b => b.text().includes('来自评论'))
    expect(link).toBeTruthy()
    expect(w.text()).not.toContain('来自体检.L01')
    await link.trigger('click')
    expect(w.emitted('open-comment')[0]).toEqual([7])
  })
  it('P 系行保持「来自体检」；incremental 行显示「来自增量质检」', async () => {
    const items = [{ seq: 'P01', level: 'yellow', theme: '域', question: 'q', answer: '', status: 'pending', origin: 'skill' },
      { seq: 'P2', level: 'yellow', theme: '域', question: '增量问', answer: '', status: 'pending', origin: 'incremental' }]
    const w = await mountCheck(items)
    expect(w.text()).toContain('来自体检.P01')
    expect(w.text()).toContain('来自增量质检')
    expect(w.text()).not.toContain('来自评论')
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

// @vitest-environment jsdom
// ReqDetail 壳级冒烟（批次7 / AUDIT D6-2 拆分前置回归网——对抗审查 M9）：
// 全形态 fixture（clarifying 全键 + published 双形态）下断言 8 tab 渲染与关键交互存在性，
// 为 948 行拆分（tab 组件化 + composable 抽取）提供行为基线。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

const detailFixture = () => ({
  card: { id: 'REQ-2026-001', name: '冒烟需求', iter: 'SMOKE', sourceType: 'text', sourceUrl: '', sourceText: '原文',
    status: 'clarifying', submittedBy: 'tester', standardDoc: '', createdAt: '2026-10-01 10:00:00',
    syncedAt: null, riskTier: 'B' },
  items: [{ seq: 'P01', level: 'yellow', theme: '域一', question: '问题一？', answer: '', answeredAt: null,
    status: 'pending', note: '', ctx: '详述1', quote: '「摘引」', anchor: 'blk-1' }],
  digest: { markdown: '# digest', version: 1, pushedAt: '2026-10-01 10:00:00',
    content: { summary: '概要', roles: ['用户'], features: [], flows: [], states: [] } },
  audit: { markdown: '# audit', version: 1, pushedAt: '2026-10-01 10:00:00',
    content: { red: 0, yellow: 1, blue: 0, items: [
      { id: 'P01', level: 'yellow', title: '存疑点', where: '§1', go: '写入标准文档 §2 条款', group: '域一', quote: '', anchor: 'blk-1' },
      // audit-only 已定论（差集 ∧ go✅，D14）：review F1 回归夹具——其宿主是 check 父组内的已定论子折叠块
      { id: 'P02', level: 'blue', title: '已定论条目', where: '§1', go: '✅已确认：按 A 口径', group: '域一', quote: '', anchor: 'blk-1' }] } },
  snapshot: { md: '# 原文快照\n\n段落文本', at: '2026-10-01 10:00:00', version: 1 },
  doc: { markdown: '', version: 1, pushedAt: '2026-10-01 10:00:00',
    content: { blocks: [{ id: 'blk-h', type: 'heading', level: 2, text: '一、概述' },
                        { id: 'blk-1', type: 'paragraph', text: '结构化原文块' }], media: [] } },
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

// jsdom 不实现 scrollIntoView——flashEl/定位协议依赖，测试环境 noop 补丁
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView || (() => {})

const mountDetail = async () => {
  const { default: ReqDetail } = await import('../src/components/ReqDetail.vue')
  const w = mount(ReqDetail, { props: { reqId: 'REQ-2026-001' }, attachTo: document.body })   // attachTo：applyJump 走 document.querySelector 定位 flash
  await flushPromises()
  await new Promise(r => setTimeout(r, 250))  // settle（load→applyJump 链路的 80ms 节奏）
  return w
}

let wrapper
beforeEach(() => { vi.clearAllMocks(); localStorage.clear() })
// 卸载上一条用例的壳：组件存活会累积多份 applyJump watch——旧实例先 consumeJump 把 nonce 清零，
// 新实例的 audit:/check: 协议断言静默失效（真实环境单实例无此竞态）
afterEach(() => { wrapper?.unmount?.(); wrapper = null })

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

  it('digest tab：AI 理解摘要卡（v5 重定位）/需求点注册表', async () => {
    wrapper = await mountDetail()
    await wrapper.findAll('[role="tab"]')[1].trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('AI 理解摘要')          // v5 §3：概述+角色+模块合并卡
    expect(wrapper.text()).toContain('概要')
    expect(wrapper.text()).toContain('角色')
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
    expect(wrapper.text()).toContain('一、概述')              // v5.3：组头 = 文档章节（anchor→最近标题）
    expect(wrapper.text()).toContain('域一')                // theme 降为卡上业务域标签
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

  it('audit: 跳转协议（v5 D1/D19）：audit 编号命中工作台问题卡并 flash', async () => {
    const { pendingJump } = await import('../src/trace.js')
    wrapper = await mountDetail()
    await wrapper.findAll('[role="tab"]')[1].trigger('click')   // 先离开工作台（验证协议会切回）
    await flushPromises()
    Object.assign(pendingJump, { nonce: Date.now(), page: 'reqs', reqId: 'REQ-2026-001', kind: 'audit', id: 'P01', needle: '' })
    await new Promise(r => setTimeout(r, 400))   // settle（80ms）+ flash 窗口内
    const on = [...wrapper.findAll('[role="tab"]')].find(t => t.classes().includes('on'))
    expect(on.text()).toContain('澄清工作台')     // audit tab 已并入——跳转落工作台
    expect(wrapper.find('.q-col [data-pid="P01"].flash').exists()).toBe(true)
  })

  it('audit: 跳转命中 audit-only 已定论卡（父组折叠态）仍可达——revealGrpFor 同步展开父组（review F1）', async () => {
    const { pendingJump } = await import('../src/trace.js')
    // P1-11 后含 pending 的组默认展开——先持久化「手动折叠」制造折叠前提
    localStorage.setItem('wb.grps.REQ-2026-001', JSON.stringify({ 'blk-h': false }))
    wrapper = await mountDetail()
    await wrapper.findAll('[role="tab"]')[2].trigger('click')   // 工作台（「一、概述」被用户折叠）
    await flushPromises()
    // 已定论卡 P02 渲染在「一、概述」父组的子折叠块里；跳转前父组应为 closed（夹具前提自证）
    const grpBefore = wrapper.findAll('.q-col .grp').find(g => g.text().includes('一、概述'))
    expect(grpBefore.classes()).toContain('closed')
    await wrapper.findAll('[role="tab"]')[0].trigger('click')   // 离开工作台再跳（验证协议带切回）
    await flushPromises()
    Object.assign(pendingJump, { nonce: Date.now(), page: 'reqs', reqId: 'REQ-2026-001', kind: 'audit', id: 'P02', needle: '' })
    await new Promise(r => setTimeout(r, 400))
    const grpAfter = wrapper.findAll('.q-col .grp').find(g => g.text().includes('一、概述'))
    expect(grpAfter.classes()).not.toContain('closed')          // 父组已展开（只开子块键时父组仍折 = F1 病灶）
    expect(wrapper.find('.q-col [data-pid="P02"].flash').exists()).toBe(true)
  })

  // ===== P1-11：首屏可见待答问题 + 折叠状态按 reqId 持久化 =====
  it('P1-11 首次进入含 pending 的分组默认展开；手动折叠后按 reqId 持久化，刷新保持', async () => {
    wrapper = await mountDetail()
    const grp = () => wrapper.findAll('.q-col .grp').find(g => g.text().includes('一、概述'))
    expect(grp().classes()).not.toContain('closed')             // 首屏直接可见问题卡（不再是组头）
    expect(wrapper.find('.q-col [data-pid="P01"]').exists()).toBe(true)

    await grp().find('.grp-t').trigger('click')                  // 手动折叠
    expect(grp().classes()).toContain('closed')
    expect(JSON.parse(localStorage.getItem('wb.grps.REQ-2026-001'))).toMatchObject({ 'blk-h': false })

    wrapper.unmount()                                            // 模拟刷新：同 reqId 重新挂载
    wrapper = null
    wrapper = await mountDetail()
    const grpAfter = wrapper.findAll('.q-col .grp').find(g => g.text().includes('一、概述'))
    expect(grpAfter.classes()).toContain('closed')               // 折叠状态保留
  })

  // ===== P1-12（方案2）：原折叠/展开面板保留在页签之前，展开时限高内部滚动 =====
  it('P1-12 流水线完整面板保留在页签之前（不再另造摘要条），正文容器在页签之后', async () => {
    wrapper = await mountDetail()
    const panel = wrapper.find('.taskpanel')
    const tabs = wrapper.find('.tabs')
    const content = wrapper.find('.tabpanel')
    expect(wrapper.find('.tp-mini').exists()).toBe(false)      // 原折叠/展开/收起已够用
    expect(panel.exists()).toBe(true)
    expect(panel.text()).toContain('线上流水线')
    expect(panel.find('.tp-summary').exists()).toBe(true)      // 摘要态由 TaskPanel 自身提供

    // DOM 顺序：完整面板 → tablist → 页签内容
    expect(panel.element.compareDocumentPosition(tabs.element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(tabs.element.compareDocumentPosition(content.element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  // ===== U-10：页签 ARIA + 方向键 roving tabindex =====
  it('U-10 页签具备 tablist/tab/tabpanel ARIA，方向键切换并移动焦点（跳过禁用页签）', async () => {
    wrapper = await mountDetail()
    expect(wrapper.find('[role="tablist"]').attributes('aria-label')).toBeTruthy()
    const tabs = wrapper.findAll('[role="tab"]')
    expect(tabs[2].attributes('aria-selected')).toBe('true')     // clarifying 默认工作台
    expect(tabs[2].attributes('tabindex')).toBe('0')
    expect(tabs[0].attributes('tabindex')).toBe('-1')
    expect(tabs[2].attributes('aria-controls')).toBe('tabpanel-checklist')
    const panel = wrapper.find('[role="tabpanel"]')
    expect(panel.attributes('id')).toBe('tabpanel-checklist')
    expect(panel.attributes('aria-labelledby')).toBe('tab-checklist')

    tabs[2].element.focus()
    await tabs[2].trigger('keydown', { key: 'ArrowRight' })      // 工作台 → 标准需求文档
    await flushPromises()
    expect(wrapper.find('[role="tab"].on').text()).toContain('标准需求文档')
    expect(document.activeElement.id).toBe('tab-std')
    expect(wrapper.find('[role="tabpanel"]').attributes('id')).toBe('tabpanel-std')   // 面板随页签更新

    // 从 std 继续右移：发布前禁用的设计/门禁不参与 roving，前进落到变更
    await document.getElementById('tab-std').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    await flushPromises()
    expect(wrapper.find('[role="tab"].on').text()).toContain('变更')   // 设计/门禁禁用，前进落到变更
    // Home 回首页签
    await document.getElementById('tab-changes').dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))
    await flushPromises()
    expect(wrapper.find('[role="tab"].on').text()).toContain('原始需求')
    expect(document.activeElement.id).toBe('tab-origin')
  })
})

describe('壳层分流：出处=评论 → 只读评论抽屉（v5.x 只读查看态）', () => {
  it('DigestTab 评论锚 locate → CommentsPanel 只读（无发评区/操作行）；「管理评论」一键切回完整', async () => {
    // 局部覆盖 mock：/comments 返回评论形状 + doc 含 comment 合成块（否则形状防御吞掉响应、分流不可达）
    const { api } = await import('../src/api.js')
    const base = api.get.getMockImplementation()
    const detail = () => {
      const d = detailFixture()
      d.doc.content.blocks.push({ id: 'cm-7', type: 'comment', origin: 'platform', text: '这条口径有歧义' })
      d.frPoints[0].anchor = 'cm-7'   // 需求点出处锚 = 评论合成块 → commentAnchorMap 命中
      return d
    }
    api.get.mockImplementation(async url => {
      if (url.includes('/gate')) return gateViewFixture()
      if (url.includes('/design')) return { reqId: 'REQ-2026-001', tier: 'B', phase: 'none' }
      if (url.includes('/tasks') || url.includes('/drafts')) return []
      if (url.includes('/comments')) return {
        comments: [{ id: 7, blockId: 'blk-1', origin: 'platform', externalId: '', author: '张三',
          text: '这条口径有歧义', replyTo: null, resolved: false, createdAt: '2026-10-14 10:00:00' }],
        unresolvedCount: 1 }
      return detail()
    })
    try {
      wrapper = await mountDetail()
      await wrapper.findAll('[role="tab"]')[1].trigger('click')   // digest tab（无右栏 → 只读抽屉回退路径）
      await flushPromises()
      const link = wrapper.findAll('a.cite').find(a => a.find('.anchored-mark').exists())
      expect(link).toBeTruthy()                                   // 评论锚图标（message-square）已分流呈现
      await link.trigger('click')
      await flushPromises()
      const panel = wrapper.find('.cmts-drawer')
      expect(panel.exists()).toBe(true)
      expect(panel.text()).toContain('张三')
      expect(panel.find('.cmts-compose').exists()).toBe(false)    // 只读：无发评区
      expect(panel.findAll('.ct-ops').length).toBe(0)             // 无操作行
      expect(panel.find('.cmts-h').text()).toContain('只读')
      const edit = panel.findAll('button').find(b => b.text() === '管理评论')
      expect(edit).toBeTruthy()
      await edit.trigger('click')
      expect(panel.find('.cmts-compose').exists()).toBe(true)     // emit edit → 壳层翻回完整模式
    } finally { api.get.mockImplementation(base) }
  })
})

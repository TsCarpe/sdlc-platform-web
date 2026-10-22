// @vitest-environment jsdom
// #22a 侧栏死图行不可点：无 media 的图片/画板块点击灯箱必扑空（媒体端点 404）——
// disabled + title 双分支 + hint 隐藏，把「点了没反应」升级为「明确不可点」（D18 降级不冒充可交互）。
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'

describe('CtxPane：#22a 无 media 图片行禁用', () => {
  it('一带 media 一无 media：无 media 行 disabled 且无「查看 ↗」hint，有 media 行照常可点', async () => {
    const { default: CtxPane } = await import('../src/components/CtxPane.vue')
    const doc = { content: { blocks: [
      { id: 'blk-img', type: 'image', media: 'm-1', caption: '正常图' },
      { id: 'blk-dead', type: 'image', caption: '死图（无 media）' },
    ], media: [] } }
    const w = mount(CtxPane, { props: { reqId: 'REQ-1', doc, snapshot: null, pendingByBlock: {} } })
    const rows = w.findAll('.ctx-imgrow')
    expect(rows.length).toBe(2)
    expect(rows[0].attributes('disabled')).toBeUndefined()                    // 有 media：可点
    expect(rows[0].text()).toContain('查看 ↗')
    expect(rows[1].attributes('disabled')).toBeDefined()                      // 无 media：明确不可点
    expect(rows[1].attributes('title')).toBe('媒体文件缺失，不可查看')
    expect(rows[1].text()).not.toContain('查看 ↗')                            // hint 同条件隐藏
  })
})

describe('CtxPane：评论出处卡（locateComment，出处=评论的只读查看态）', () => {
  const cmtRows = () => [
    { id: 7, blockId: 'blk-1', origin: 'platform', externalId: '', author: '张三', text: '这条口径有歧义',
      replyTo: null, resolved: false, createdAt: '2026-10-14 10:00:00' },
    { id: 8, blockId: 'blk-1', origin: 'platform', externalId: '', author: '李四', text: '回复补充',
      replyTo: 7, resolved: false, createdAt: '2026-10-14 10:05:00' },
    { id: 3, blockId: 'blk-2', origin: 'feishu', externalId: 'cm-3', author: '王五', text: '已解决线程',
      replyTo: null, resolved: true, createdAt: '2026-10-14 09:00:00' }
  ]
  const mountCtx = async (over = {}) => {
    const { default: CtxPane } = await import('../src/components/CtxPane.vue')
    const doc = { content: { blocks: [
      { id: 'blk-1', type: 'paragraph', text: '正文段落' },
      { id: 'blk-2', type: 'paragraph', text: '另一段' },
    ], media: [] } }
    return mount(CtxPane, { props: { reqId: 'REQ-1', doc, snapshot: null, pendingByBlock: {},
      comments: cmtRows(), blockText: { 'blk-1': '正文段落', 'blk-2': '另一段' }, ...over } })
  }

  it('命中：插卡渲染目标线程（含回复链与锚定块标签），目标消息 flash；✕ 清除', async () => {
    const w = await mountCtx()
    expect(w.find('.ctx-cmt').exists()).toBe(false)               // 无定位前无卡
    const ok = await w.vm.locateComment({ seq: 'L01', cid: 7 })
    expect(ok).toBe(true)
    await new Promise(r => setTimeout(r, 20))
    const card = w.find('.ctx-cmt')
    expect(card.exists()).toBe(true)
    expect(card.text()).toContain('评论出处 L01')
    expect(card.text()).toContain('张三')
    expect(card.text()).toContain('回复补充')
    expect(card.text()).toContain('锚定：')                        // 根评论锚定块标签
    expect(card.find('[data-cid="7"]').classes()).toContain('cmt-flash')   // 目标消息高亮
    expect(card.findAll('input, textarea').length).toBe(0)        // 只读
    await card.find('.ctx-cmt-h .x').trigger('click')
    expect(w.find('.ctx-cmt').exists()).toBe(false)               // ✕ 清除
  })

  it('已解决线程带徽标；「打开评论区」emit open-comments 携带根 id', async () => {
    const w = await mountCtx()
    await w.vm.locateComment({ seq: 'P3', cid: 3 })
    await new Promise(r => setTimeout(r, 20))
    const card = w.find('.ctx-cmt')
    expect(card.text()).toContain('已解决')
    await card.find('.ctx-cmt-f button').trigger('click')
    expect(w.emitted('open-comments')[0]).toEqual([3])
  })

  it('悬空 cid（已删/列表空）返回 false 不插卡；卡显示中线程被删（comments prop 变化）卡自动消失', async () => {
    const w = await mountCtx()
    expect(await w.vm.locateComment({ seq: 'L01', cid: 999 })).toBe(false)
    expect(w.find('.ctx-cmt').exists()).toBe(false)
    expect(await w.vm.locateComment({ seq: 'L01', cid: 7 })).toBe(true)
    expect(w.find('.ctx-cmt').exists()).toBe(true)
    await w.setProps({ comments: [] })                            // 目标线程被删
    expect(w.find('.ctx-cmt').exists()).toBe(false)               // 不留空壳
  })

  it('locateComment 后 locateCtx（原文定位）可共存：卡不消失', async () => {
    const w = await mountCtx()
    await w.vm.locateComment({ seq: 'L01', cid: 7 })
    await w.vm.locateCtx({ seq: 'P1', anchor: 'blk-2' })
    expect(w.find('.ctx-cmt').exists()).toBe(true)                // 插卡不滚动原文，两者共存
  })
})

describe('CtxPane：活动卡跟随（track——评论出处卡与原文同步切换）', () => {
  const mountCtx = async () => {
    const { default: CtxPane } = await import('../src/components/CtxPane.vue')
    const doc = { content: { blocks: [
      { id: 'blk-1', type: 'paragraph', text: '正文段落' },
      { id: 'blk-2', type: 'paragraph', text: '另一段' },
    ], media: [] } }
    const comments = [
      { id: 7, blockId: 'blk-1', origin: 'platform', externalId: '', author: '张三', text: '口径歧义',
        replyTo: null, resolved: false, createdAt: '2026-10-14 10:00:00' },
      { id: 9, blockId: '', origin: 'platform', externalId: '', author: '赵六', text: '卡片级疑问',
        replyTo: null, resolved: false, createdAt: '2026-10-14 11:00:00' }]
    return mount(CtxPane, { props: { reqId: 'REQ-1', doc, snapshot: null, pendingByBlock: {}, comments, blockText: {} } })
  }
  const hlBlk = w => w.find('.ctx-hl').attributes('data-blk')

  it('评论出处卡随活动卡切换：评论题出卡 + 原文定到评论锚定块；非评论题撤卡', async () => {
    const w = await mountCtx()
    await w.vm.track({ seq: 'P13', anchor: 'cm-7', cid: 7 })
    await new Promise(r => setTimeout(r, 20))
    expect(w.find('.ctx-cmt').text()).toContain('评论出处 P13')
    expect(w.find('.ctx-cmt [data-cid="7"]').classes()).toContain('cmt-hl')   // 目标消息常驻高亮（vnode 绑定，非瞬态 flash）
    expect(hlBlk(w)).toBe('blk-1')                                 // 原文同步到评论讨论的那段
    await w.vm.track({ seq: 'P34', anchor: 'blk-2', cid: null })
    await new Promise(r => setTimeout(r, 20))
    expect(w.find('.ctx-cmt').exists()).toBe(false)                // 旧评论卡撤掉，不与活动卡错配
    expect(hlBlk(w)).toBe('blk-2')
  })

  it('卡片级评论（无锚定块）：出卡、清原文高亮并提示；follow 关闭时整栏不动', async () => {
    const w = await mountCtx()
    await w.vm.track({ seq: 'P01', anchor: 'blk-2', cid: null })
    await w.vm.track({ seq: 'L01', cid: 9 })
    await new Promise(r => setTimeout(r, 20))
    expect(w.find('.ctx-cmt').text()).toContain('卡片级疑问')
    expect(w.find('.ctx-hl').exists()).toBe(false)
    expect(w.find('.ctx-from').text()).toContain('卡片级评论')
    await w.find('.follow').trigger('click')                      // 关闭跟随
    await w.vm.track({ seq: 'P34', anchor: 'blk-2', cid: null })
    expect(w.find('.ctx-cmt').exists()).toBe(true)                 // 总闸关闭：评论卡不被撤
  })
})

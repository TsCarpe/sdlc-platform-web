// v5.x 评论口径单点纯逻辑：threadRoots 根判据 + buildCommentAnchorMap 锚映射
// （出处=评论区的点击分流目标；撞键裁决对齐 resolve_anchors 的 intake 裁决——feishu 优先）
import { describe, it, expect } from 'vitest'
import { threadRoots, buildCommentAnchorMap } from '../src/comments.js'

const row = (id, over = {}) => ({ id, blockId: 'b1', origin: 'platform', externalId: '',
  author: 'a', text: 't', replyTo: null, resolved: false, ...over })

describe('threadRoots：根判据（无 replyTo 或父不在列表=父删悬空回复升根）', () => {
  it('普通根 + 回复链分组', () => {
    const roots = threadRoots([row(1), row(2, { replyTo: 1 }), row(3, { replyTo: 2 })])
    expect(roots.map(r => r.id)).toEqual([1])
  })
  it('父行已删：悬空回复升级为根（与面板渲染/后端 _thread_groups 同口径）', () => {
    const roots = threadRoots([row(2, { replyTo: 1 })])   // 根 1 不在列表
    expect(roots.map(r => r.id)).toEqual([2])
  })
})

describe('buildCommentAnchorMap：评论锚 → 面板定位目标', () => {
  it('常态：feishu 块 id（数字 comment-id）按 externalId 匹配根；platform 块 cm-N → 行 N（恒 Number）', () => {
    const comments = [
      row(1, { origin: 'feishu', externalId: '7011111111111111111' }),
      row(2, { origin: 'feishu', externalId: '7011111111111111111', replyTo: 1 }),  // 回复行——不成为目标
      row(5, { blockId: '' })
    ]
    const blocks = [
      { id: 'b1', type: 'paragraph', text: 'x' },
      { id: '7011111111111111111', type: 'comment', origin: 'feishu' },
      { id: 'cm-5', type: 'comment', origin: 'platform' }
    ]
    const m = buildCommentAnchorMap(blocks, comments)
    expect(m['7011111111111111111']).toBe(1)      // feishu 锚 → 线程根（非回复）
    expect(m['cm-5']).toBe(5)
    expect(typeof m['cm-5']).toBe('number')
    expect(m['b1']).toBeUndefined()               // 内容块不在键域
  })

  it('exotic 撞键：platform 块 cm-1 与飞书 externalId=cm-1 并存 → 取 feishu 侧（对齐 resolve intake 裁决）', () => {
    const comments = [
      row(1, { blockId: '' }),                                                    // 平台根，行 id=1
      row(3, { origin: 'feishu', externalId: 'cm-1' })
    ]
    const blocks = [
      { id: 'cm-1', type: 'comment', origin: 'platform' },
      { id: 'cm-1', type: 'comment', origin: 'feishu' }
    ]
    expect(buildCommentAnchorMap(blocks, comments)['cm-1']).toBe(3)   // feishu 覆盖 platform
  })

  it('origin 缺省块（老卡 artifact 视图）走 externalId 匹配', () => {
    const comments = [row(7, { origin: 'feishu', externalId: '7012222222222222222' })]
    const blocks = [{ id: '7012222222222222222', type: 'comment' }]   // parse_doc 原始块无 origin 键
    expect(buildCommentAnchorMap(blocks, comments)['7012222222222222222']).toBe(7)
  })

  it('守卫：空锚/空 externalId/platform 块行已删/externalId 无匹配行 → 均不入 map', () => {
    const comments = [row(2, { origin: 'feishu', externalId: '' })]   // externalId 空 + 行 1 缺失
    const blocks = [
      { id: '', type: 'comment', origin: 'feishu' },                   // 空锚块
      { id: 'cm-1', type: 'comment', origin: 'platform' },             // 行 1 已删（不在列表）
      { id: '7013', type: 'comment', origin: 'feishu' }                // 表中无该 externalId
    ]
    expect(buildCommentAnchorMap(blocks, comments)).toEqual({})
  })
})

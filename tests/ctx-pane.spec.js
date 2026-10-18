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

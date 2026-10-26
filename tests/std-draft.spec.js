// @vitest-environment jsdom
// v5.x 批2：标准文档草稿态（迁自 TaskPanel 归 StdTab）——渲染分支 / stdText updatedAt 同步守卫 /
// 发布取值（编辑内容优先）/ changed 只读一致流 / isEditingDirty 守卫口径。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

vi.mock('../src/confirm.js', () => ({ ask: vi.fn(async () => true) }))
vi.mock('../src/api.js', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() },
  uploadMedia: vi.fn()
}))

const draftRow = (md, updatedAt = '2026-10-20 10:00:00') => ({
  reqId: 'REQ-1', type: 'standard', md, updatedAt, contentJson: ''
})

const mountStd = async (props = {}) => {
  const { default: StdTab } = await import('../src/components/StdTab.vue')
  const w = mount(StdTab, { props })
  await flushPromises()
  return w
}

let api
beforeEach(async () => {
  vi.clearAllMocks()
  api = (await import('../src/api.js')).api
  api.post.mockResolvedValue({ ok: true })
})

describe('StdTab：草稿态（v5.x 批2）', () => {
  it('clarifying 无定稿有草稿 → 决策条 + 编辑器；发布 POST 以编辑内容为源', async () => {
    const w = await mountStd({ standard: null, status: 'clarifying', draft: draftRow('# 旧稿\n第一段') })
    expect(w.find('.draftbar').exists()).toBe(true)
    expect(w.text()).toContain('待发布')
    expect(w.find('.tp-editor').exists()).toBe(true)
    await w.find('.tp-editor').setValue('# 新稿\n编辑后的内容')
    await w.findAll('button').find(b => b.text().includes('发布（终态锁定）')).trigger('click')
    await flushPromises()
    expect(api.post).toHaveBeenCalledWith('/api/requirements/REQ-1/publish',
      { standardMd: '# 新稿\n编辑后的内容' })
    expect(w.emitted('refresh')).toBeTruthy()
  })

  it('updatedAt 守卫：轮询同版本不冲掉编辑缓冲；外部重写（updatedAt 变）才覆写', async () => {
    const w = await mountStd({ standard: null, status: 'clarifying', draft: draftRow('# 旧稿') })
    await w.find('.tp-editor').setValue('# 用户正在编辑，勿覆盖')
    // 4s 轮询刷新：drafts 对象整体替换但 updatedAt 未变（服务端无改动）→ 缓冲保留
    await w.setProps({ draft: { ...draftRow('# 旧稿') } })   // 新对象、同 updatedAt
    expect(w.find('.tp-editor').element.value).toBe('# 用户正在编辑，勿覆盖')
    // standard_doc 任务重生成：updatedAt 变化 → 覆写为新草稿
    await w.setProps({ draft: draftRow('# 重生成的新稿', '2026-10-20 11:00:00') })
    expect(w.find('.tp-editor').element.value).toBe('# 重生成的新稿')
  })

  it('isEditingDirty：编辑差异为脏（切页签守卫消费）；与草稿一致/changed 态不为脏', async () => {
    const w = await mountStd({ standard: null, status: 'clarifying', draft: draftRow('# 旧稿') })
    expect(w.vm.isEditingDirty()).toBe(false)                  // 初始缓冲=草稿
    await w.find('.tp-editor').setValue('# 改了')
    expect(w.vm.isEditingDirty()).toBe(true)
    const w2 = await mountStd({ standard: null, status: 'changed', draft: draftRow('# x') })
    expect(w2.vm.isEditingDirty()).toBe(false)                 // changed 只读无编辑
  })

  it('changed 态：只读预览 + 从草稿预览发布（草稿逐字节为源，无编辑器）', async () => {
    const w = await mountStd({ standard: null, status: 'changed', draft: draftRow('# 变更后草稿') })
    expect(w.text()).toContain('待重新发布')
    expect(w.find('.tp-editor').exists()).toBe(false)
    expect(w.find('.tp-preview').text()).toContain('变更后草稿')
    await w.findAll('button').find(b => b.text().includes('从草稿预览发布')).trigger('click')
    await flushPromises()
    expect(api.post).toHaveBeenCalledWith('/api/requirements/REQ-1/publish',
      { standardMd: '# 变更后草稿' })
  })

  it('无定稿无草稿 → 空态指回流水的生成入口', async () => {
    const w = await mountStd({ standard: null, status: 'clarifying', draft: null })
    expect(w.text()).toContain('尚未生成')
    expect(w.text()).toContain('回到本页签')
  })
})

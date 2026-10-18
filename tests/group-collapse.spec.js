// @vitest-environment jsdom
// P1-11：工作台分组默认展开含 pending 的组；折叠/展开状态按 reqId 持久化（localStorage）。
// 首次进入 visible pending；手动折叠后刷新（重新挂载）保持；全部展开/收起照常可用。
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { defineComponent, h, ref, nextTick } from 'vue'
import { mount } from '@vue/test-utils'

vi.mock('../src/api.js', () => ({ api: {}, uploadMedia: vi.fn() }))

const mountHarness = async (groups, reqId = 'REQ-1') => {
  const { provideGroupCollapse } = await import('../src/composables/group-collapse.js')
  const check = ref(groups)
  let api = null
  const Host = defineComponent({
    setup() {
      api = provideGroupCollapse({ fr: ref([]), audit: ref([]), check }, { reqId })
      return () => h('div')
    }
  })
  const w = mount(Host)
  await nextTick()
  return { w, api, check }
}

const PENDING = { seq: 'P01', status: 'pending' }
const ANSWERED = { seq: 'P02', status: 'answered' }
const GROUPS = [
  { name: '待答组', items: [PENDING] },
  { name: '已答组', items: [ANSWERED] },
  { name: '空组', items: [] }
]

beforeEach(() => { localStorage.clear() })

describe('group-collapse：P1-11 默认展开与持久化', () => {
  it('首次进入展开所有含 pending 的组；无 pending / 空组保持折叠', async () => {
    const { w, api } = await mountHarness(GROUPS)
    expect(api.openGrps.has('待答组')).toBe(true)
    expect(api.openGrps.has('已答组')).toBe(false)
    expect(api.openGrps.has('空组')).toBe(false)
    w.unmount()
  })

  it('手动折叠后写入 localStorage；按 reqId 重新挂载仍保持折叠', async () => {
    const { w, api } = await mountHarness(GROUPS)
    api.toggleGrp('待答组')                       // 手动折叠
    expect(api.openGrps.has('待答组')).toBe(false)
    const key = 'wb.grps.REQ-1'
    expect(JSON.parse(localStorage.getItem(key))).toEqual({ 待答组: false })

    w.unmount()
    const again = await mountHarness(GROUPS)      // 刷新（同 reqId 重新挂载）
    expect(again.api.openGrps.has('待答组')).toBe(false)
    again.w.unmount()

    const other = await mountHarness(GROUPS, 'REQ-2')   // 另一需求不串状态
    expect(other.api.openGrps.has('待答组')).toBe(true)
    other.w.unmount()
  })

  it('全部展开/收起会持久化；收起后重新挂载保持全收起', async () => {
    const { w, api } = await mountHarness(GROUPS)
    api.expandAll(GROUPS)
    expect([...api.openGrps].sort()).toEqual([...GROUPS.map(g => g.name)].sort())
    api.collapseAll()
    expect(api.openGrps.size).toBe(0)
    expect(JSON.parse(localStorage.getItem('wb.grps.REQ-1'))).toEqual({
      待答组: false, 已答组: false, 空组: false
    })

    w.unmount()
    const again = await mountHarness(GROUPS)
    expect(again.api.openGrps.size).toBe(0)
    again.w.unmount()
  })

  it('跳转 revealGrpFor 展开不写入持久化状态（临时展开不改变用户折叠偏好）', async () => {
    const groups = [{ name: '组A', items: [{ seq: 'P01', status: 'answered' }] }]
    const { w, api } = await mountHarness(groups)
    expect(api.openGrps.has('组A')).toBe(false)
    api.revealGrpFor('check', 'P01')
    expect(api.openGrps.has('组A')).toBe(true)
    expect(localStorage.getItem('wb.grps.REQ-1')).toBeNull()
    w.unmount()
  })
})

// @vitest-environment jsdom
// U-11：业务弹窗焦点圈定 + Esc。Tab/Shift+Tab 在弹窗内循环，Esc 关闭并归还焦点。
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { defineComponent, ref, nextTick } from 'vue'
import { mount } from '@vue/test-utils'

const mounted = []
beforeEach(() => { document.body.innerHTML = '' })
afterEach(() => { mounted.splice(0).forEach(w => w.unmount()) })

const mountHost = async () => {
  const { useModalFocus } = await import('../src/composables/modal-focus.js')
  const Host = defineComponent({
    setup() {
      const open = ref(false)
      const box = ref(null)
      useModalFocus(open, box, () => { open.value = false })
      return { open, box }
    },
    template: `
      <div>
        <button id="outside" @click="open = true">外部按钮</button>
        <div v-if="open" ref="box" class="box" role="dialog" aria-modal="true">
          <button id="first">第一</button>
          <input id="middle">
          <button id="last">最后</button>
        </div>
      </div>`
  })
  const w = mount(Host, { attachTo: document.body })
  mounted.push(w)
  await nextTick()
  return w
}

const press = async (key, opts = {}) => {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...opts })
  document.dispatchEvent(e)
  await nextTick()
}

describe('useModalFocus：焦点陷阱与 Esc', () => {
  it('打开后焦点落入弹窗；Tab 在末项回卷首项，Shift+Tab 在首项回卷末项', async () => {
    const w = await mountHost()
    await w.find('#outside').trigger('click')
    await nextTick()
    expect(document.activeElement.id).toBe('first')

    document.getElementById('last').focus()
    await press('Tab')
    expect(document.activeElement.id).toBe('first')

    document.getElementById('first').focus()
    await press('Tab', { shiftKey: true })
    expect(document.activeElement.id).toBe('last')
  })

  it('Esc 关闭弹窗并归还焦点到打开前元素', async () => {
    const w = await mountHost()
    const outside = document.getElementById('outside')
    outside.focus()
    await w.find('#outside').trigger('click')
    await nextTick()
    expect(w.find('.box').exists()).toBe(true)

    await press('Escape')
    expect(w.find('.box').exists()).toBe(false)
    expect(document.activeElement.id).toBe('outside')
  })
})

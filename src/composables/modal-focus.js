// U-11：业务弹窗共用能力——打开时焦点落入弹窗、Tab/Shift+Tab 在弹窗内循环、Esc 关闭并归还焦点。
// 四个 role="dialog" 业务弹窗（DesignTab/GateTab/WorkbenchTab/CommentsPanel）共用。
// 捕获阶段拦截键盘：Esc 只关最上层弹窗，不再冒泡到 CommentsPanel 的抽屉级 Esc。
import { watch, nextTick, onBeforeUnmount } from 'vue'

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'textarea:not([disabled])',
  'input:not([disabled])', 'select:not([disabled])', '[tabindex]:not([tabindex="-1"])'
].join(',')

export function useModalFocus(open, dialogRef, onClose) {
  let prev = null        // 打开前的焦点元素——关闭时归还

  function focusables() {
    const el = dialogRef.value
    return el ? Array.from(el.querySelectorAll(FOCUSABLE)) : []
  }

  function onKey(e) {
    if (!open.value) return
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()          // 捕获阶段截断：只关弹窗，不连带关抽屉
      onClose()
      return
    }
    if (e.key !== 'Tab') return
    const list = focusables()
    const el = dialogRef.value
    if (!el) return
    if (!list.length) {            // 无可用焦点项：焦点钉在弹窗容器
      e.preventDefault()
      el.focus()
      return
    }
    const first = list[0]
    const last = list[list.length - 1]
    const active = document.activeElement
    const inside = el.contains(active)
    if (e.shiftKey && (active === first || !inside)) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && (active === last || !inside)) {
      e.preventDefault()
      first.focus()
    }
  }

  watch(open, async v => {
    if (v) {
      prev = document.activeElement
      document.addEventListener('keydown', onKey, true)
      await nextTick()
      const list = focusables()
      if (list.length) list[0].focus()
      else dialogRef.value?.focus()
    } else {
      document.removeEventListener('keydown', onKey, true)
      if (prev && typeof prev.focus === 'function' && document.contains(prev)) prev.focus()
      prev = null
    }
  }, { immediate: true })

  onBeforeUnmount(() => document.removeEventListener('keydown', onKey, true))
}

// v2.2 全局确认框（评测 P1-8）：替代原生 confirm()——样式与平台统一、可携带上下文说明、Esc/遮罩=取消。
// 模块级响应式状态：本文件持状态，ConfirmBox.vue（App.vue 根部挂一个实例）消费渲染。
// body 一律纯文本插值（发布 drift 预览等内容含用户输入，不走 v-html）。
import { reactive } from 'vue'

const state = reactive({
  open: false, title: '', body: '', danger: false, confirmText: '确认', cancelText: '取消', _resolve: null
})

/** ask({ title, body, danger, confirmText, cancelText }) → Promise<boolean>（true=确认） */
export function ask({ title, body = '', danger = false, confirmText = '确认', cancelText = '取消' }) {
  return new Promise(resolve => {
    state._resolve?.(false)   // 并发保护：后到的确认框顶掉前一个（前一个按取消结算）
    Object.assign(state, { open: true, title, body, danger, confirmText, cancelText, _resolve: resolve })
  })
}

export function confirmState() { return state }

export function settle(ok) {
  state.open = false
  state._resolve?.(ok)
  state._resolve = null
}

import { createApp } from 'vue'
import App from './App.vue'
import router from './router.js'
import './style.css'

// 旧书签 #/iters 等：进路由前折成 History 路径，避免刷新后丢页
if (location.hash.startsWith('#/')) {
  history.replaceState(null, '', location.hash.slice(1) + location.search)
}

const app = createApp(App)
app.use(router)
router.isReady().then(() => app.mount('#app'))

// ===== v2.3 mermaid 渲染（DESIGN-v2.3，红线豁免）=====
// render() 是同步纯函数（marked→DOMPurify），mermaid.run() 需已挂载 DOM——此处全局监听
// code.language-mermaid 插入惰性渲染，对 render() 六处调用方零侵入；首图才 import（不进首屏 chunk）。
// 安全顺序：marked 输出已过 DOMPurify；mermaid securityLevel:'strict' 自带消毒，其 SVG 不再过
// DOMPurify（默认配置会剥 SVG 内联样式致图破损，勿反序）。
// details 收起时节点 offsetParent 为 null，跳过留待展开后再染（observer 兼听 open 属性变化）。
const pendingMermaid = new Set()
let mermaidReady = null
function drainMermaid() {
  document.querySelectorAll('code.language-mermaid:not([data-mmd])').forEach(n => {
    if (n.offsetParent !== null) pendingMermaid.add(n)
  })
  if (!pendingMermaid.size) return
  mermaidReady = mermaidReady || import('mermaid').then(m => {
    m.default.initialize({ startOnLoad: false, securityLevel: 'strict' })
    return m.default
  })
  mermaidReady.then(mermaid => {
    const nodes = [...pendingMermaid]
    pendingMermaid.clear()
    nodes.forEach(n => n.setAttribute('data-mmd', '1'))
    return mermaid.run({ nodes, suppressErrors: true })
  }).catch(() => {})   // 渲染失败：节点保持 mermaid 原地错误提示，诚实可见
}
new MutationObserver(drainMermaid).observe(document.body, {
  childList: true, subtree: true, attributes: true, attributeFilter: ['open']
})

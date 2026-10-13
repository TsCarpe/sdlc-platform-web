// 长文目录滚动协议（AUDIT D6-2 拆分自 ReqDetail）：origin 块结构 / std 渲染后标题共用。
// 目录点击锁定高亮（定位落点可能进不了滚动阈值窗）+ rAF 节流滚动高亮 + 回顶显隐；window 级监听单例。
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { flashEl } from '../trace.js'

/**
 * @param deps
 *   tab      当前 tab 的 ref（origin/std 才有目录）
 *   headEls  () => Element[] 当前 tab 的标题元素序列（由 tab 组件 expose 提供）
 *   goOrigin (id) => void    origin 目录点击的定位回调（复用壳层 locate 块锚协议）
 */
export function useTocScroll(deps) {
  const { tab, headEls, goOrigin } = deps

  /** 点击即锁定高亮为目标：定位落点可能进不了滚动阈值窗（文档尾滚不到顶 / center 落点临界），
   *  锁定窗口与 flash 2.2s 对齐，期间 onScroll 不重算 */
  let tocLockUntil = 0
  const activeHead = ref('')
  const showTop = ref(false)
  let scrollTick = false

  async function goToc(id) {
    tocLockUntil = Date.now() + 2500
    activeHead.value = id
    if (tab.value === 'origin') { await goOrigin(id); return }
    flashEl(document.getElementById(id))
  }

  /** 滚动高亮当前目录项 + 回顶按钮显隐（rAF 节流） */
  function onScroll() {
    if (scrollTick) return
    scrollTick = true
    requestAnimationFrame(() => {
      scrollTick = false
      if (Date.now() < tocLockUntil) return        // 目录点击后的定位滚动：高亮已锁定为目标，不重算
      showTop.value = window.scrollY > 640
      const els = headEls()
      if (!els.length) { activeHead.value = ''; return }
      let cur = ''
      // 手动滚动阅读时的高亮：取视口 60% 线之上最后一个标题（点击目录的高亮由 tocLock 锁定，不走此判定）
      for (const el of els) if (el.getBoundingClientRect().top < innerHeight * 0.6) cur = el.id || el.dataset.blk || ''
      activeHead.value = cur
    })
  }

  onMounted(() => window.addEventListener('scroll', onScroll, { passive: true }))
  onBeforeUnmount(() => window.removeEventListener('scroll', onScroll))
  watch(tab, () => setTimeout(onScroll, 120))
  function toTop() { window.scrollTo({ top: 0, behavior: 'smooth' }) }

  return { activeHead, showTop, goToc, toTop }
}

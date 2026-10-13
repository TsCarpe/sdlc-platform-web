// v1.1 全程可追溯：跨页跳转协议 + needle 文本定位内核
// 交互基准：platform-demo/index-v11.html（函数一一对应移植）；设计：docs/DESIGN-v1.1-全程可追溯.md §3
//
// 跳转 = 切页/切 tab → 滚动至目标 → 高亮/闪烁（约 2.2s 消退）；定位失败必须诚实提示。
import { reactive, nextTick } from 'vue'

/**
 * 跳转描述符：{ page:'reqs'|'cases', reqId, tab, kind, id, needle }
 * kind → 定位方式：
 *   fr     digest 需求点行     [data-frid="<需求.FR-xx>"]
 *   audit  体检条目           [data-pid="<Pxx>"]
 *   check  澄清条目           [data-pid="<Pxx>"]
 *   asm    digest 原文折叠内假设行（先展开折叠再 needle 定位，id 即 needle）
 *   needle origin 快照文本定位（needle 为原文片段）
 *   case   cases 页打开用例详情弹窗（id=用例编号）
 */
export const pendingJump = reactive({ nonce: 0, page: '', reqId: '', tab: '', kind: '', id: '', needle: '' })

export function jumpTo(desc) {
  Object.assign(pendingJump, desc, { nonce: Date.now() })
}

/** 消费跳转（目标组件执行时调用，防重复应用） */
export function consumeJump() {
  pendingJump.nonce = 0
}

/** 等待 Vue 渲染完成 + 80ms（asm 场景 150ms），与 demo 时序一致 */
export async function settle(ms = 80) {
  await nextTick()
  await new Promise(r => setTimeout(r, ms))
}

const levelRank = { red: 0, yellow: 1, blue: 2 }

function sortByLevel(items) {
  return [...items].sort((a, b) => (levelRank[a.level] ?? 9) - (levelRank[b.level] ?? 9))
}

/** 需求域分组（体检 group / 澄清 theme 共用）：组序 = 全局 domains 常量，未知域落"其他"桶，组内 🔴→🟡→🔵 */
export function groupItems(items, key, domains) {
  const buckets = new Map()
  for (const d of domains || []) buckets.set(d, [])
  const other = []
  for (const it of items || []) {
    const g = String(it[key] || '').trim()
    if (g && buckets.has(g)) buckets.get(g).push(it)
    else other.push(it)
  }
  const out = []
  for (const d of domains || []) {
    if (buckets.get(d)?.length) out.push({ name: d, items: sortByLevel(buckets.get(d)) })
  }
  if (other.length) out.push({ name: '其他', items: sortByLevel(other) })
  return out
}

/** 出处分组（需求点注册表，D2）：按 group 首现顺序，空落"未分组" */
export function groupByFirstAppearance(items, key) {
  const m = new Map()
  for (const it of items || []) {
    const g = String(it[key] || '').trim() || '未分组'
    if (!m.has(g)) m.set(g, [])
    m.get(g).push(it)
  }
  return [...m.entries()].map(([name, its]) => ({ name, items: its }))
}

/** 摘引定位锚：取 quote 中第一对「」内文本 */
export function firstQuote(s) {
  const m = String(s || '').match(/「([^」]+)」/)
  return m ? m[1] : ''
}

/** 体检条目 id（体检.Pxx）→ 澄清编号（Pxx）：同源 P 编号的两侧表示互转 */
export function pidOf(id) { return String(id || '').replace('体检.', '') }

/** 从覆盖描述提取体检编号，如 '⚠️仅一句话（体检.P26）' → 'P26' */
export function covP(cov) {
  const m = String(cov || '').match(/P\d+/)
  return m ? m[0] : ''
}

/** 出处多 needle 候选：原文 → 详述N.N → N.N（处理 详述6.2-6.7 这类区间出处） */
export function needlesFor(src) {
  const s = String(src || '').trim()
  if (!s) return []
  const out = [s]
  const m1 = s.match(/详述\d+(?:\.\d+)*/)
  if (m1) out.push(m1[0])
  const m2 = s.match(/\d+(?:\.\d+)*/)
  if (m2 && m2[0].includes('.') && !out.includes(m2[0])) out.push(m2[0])
  return out
}

/** 清除上一处 needle 高亮（还原文本节点） */
export function clearMark() {
  const mark = document.getElementById('snapshot-hl')
  if (mark && mark.parentNode) {
    mark.parentNode.replaceChild(document.createTextNode(mark.textContent), mark)
    mark.parentNode.normalize()
  }
}

/** TreeWalker 文本节点 needle 匹配 + mark 包裹；跨节点边界失败返回 false */
export function highlightIn(container, needle) {
  if (!container || !needle) return false
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  let node
  while ((node = walker.nextNode())) {
    const idx = node.textContent.indexOf(needle)
    if (idx >= 0) {
      try {
        const range = document.createRange()
        range.setStart(node, idx)
        range.setEnd(node, idx + needle.length)
        const mark = document.createElement('mark')
        mark.id = 'snapshot-hl'
        range.surroundContents(mark)
        return true
      } catch {
        return false
      }
    }
  }
  return false
}

/** UI 改版增量：定位命中被折叠长文本（ClampText 的 .pclamped）时自动展开，保证高亮可见 */
function revealClamped(el) {
  const c = el?.closest?.('.pclamped')
  if (c) c.classList.add('pclamp-open')
}

/** 当前容器内 needle 定位：清旧 mark → 高亮 → 滚动居中；未命中返回 false（调用方诚实 toast） */
export async function flashNeedle(container, needle) {
  clearMark()
  if (!container || !needle) return false
  if (highlightIn(container, needle)) {
    const mark = document.getElementById('snapshot-hl')
    if (mark) {
      revealClamped(mark)
      mark.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return true
    }
  }
  return false
}

/** 元素定位：滚动居中 + flash 闪烁 2.2s；元素不存在返回 false
 *  超高元素（如原文行卡片）滚到顶部——block:center 会落到元素垂直中点，目标脱离视口 */
export function flashEl(el) {
  if (!el) return false
  revealClamped(el)
  const block = el.offsetHeight > window.innerHeight * 0.75 ? 'start' : 'center'
  el.scrollIntoView({ behavior: 'smooth', block })
  el.classList.add('flash')
  setTimeout(() => el.classList.remove('flash'), 2300)
  return true
}

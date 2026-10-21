// v5 原文块结构 composable（DESIGN-v5 §2.1，自 OriginTab 抽出）：doc.content.blocks →
// 渲染所需全套结构（父子索引/章节分组/标量小表切分/目录/媒体清单）。
// OriginTab（全宽阅读）与 CtxPane（工作台侧栏）共享——两处渲染一致性由同源计算保证。
import { computed } from 'vue'
import { partitionRows, docTocOf } from '../docview.js'

/**
 * @param doc      detail.doc（块表权威视图：content.blocks + media）
 * @param reqId    媒体 URL 前缀用（() => string 或 string）
 */
export function useDocStructure(getDoc, getReqId) {
  const docData = computed(() => getDoc()?.content || null)
  const docBlocks = computed(() => docData.value?.blocks || [])
  const childrenByParent = computed(() => {
    const m = {}
    for (const b of docBlocks.value) {
      const p = b.parent || ''
      ;(m[p] = m[p] || []).push(b)
    }
    return m
  })
  const rootBlocks = computed(() => docBlocks.value.filter(b => !b.parent && b.type !== 'comment'))
  // v2.2 原文块章节分组：heading 栈切分（零文本假设）——按 level 弹栈建组，跳级自动压平（h2→h4 = 深度0→1），
  // 非标题块归属栈顶组；首个标题前的内容归前言平铺（无 heading 文档整体退化为平铺，渲染行为不变）
  const docSections = computed(() => {
    const secs = []
    const stack = []
    let preface = null
    const host = () => stack.length ? stack[stack.length - 1]
      : (preface ??= { key: 'preface', heading: null, blocks: [] })
    for (const b of rootBlocks.value) {
      if (b.type === 'heading') {
        const lv = b.level || 2        // 与 DocBlock headingTag 的缺省口径一致
        while (stack.length && stack[stack.length - 1].lv >= lv) stack.pop()
        const sec = { key: b.id, lv, cls: 'd' + Math.min(stack.length, 3), heading: b, blocks: [] }
        stack.push(sec)
        secs.push(sec)
      } else {
        host().blocks.push(b)
      }
    }
    return preface ? [preface, ...secs] : secs
  })
  // v4.1 全标量小表还原：章节块序过 partitionRows——连续纯标量同 head 行聚合为 mini 表格
  const childCountBy = computed(() => {
    const m = new Map()
    for (const b of docBlocks.value) {
      const p = b.parent || ''
      m.set(p, (m.get(p) || 0) + 1)
    }
    return m
  })
  const partitionedSections = computed(() =>
    docSections.value.map(sec => ({ ...sec, parts: partitionRows(sec.blocks, childCountBy.value) })))
  const commentByRef = computed(() => {
    const m = {}
    for (const b of docBlocks.value) if (b.type === 'comment') m[b.ref] = b
    return m
  })
  // v2.2 目录纳入 table-row 行卡片（巨表文档主体在行级，heading 导航不到）；排除版本号形态 rowLabel。
  // v5.3：提取规则移 docview.docTocOf——与原先内联过滤同一口径，工作台章节分组与侧栏共用
  const docToc = computed(() => docTocOf(docBlocks.value))
  // v4.20 灯箱图源：全量块表按文档序取 image/画板缩略图
  const mediaList = computed(() => docBlocks.value
    .filter(b => (b.type === 'image' || b.type === 'whiteboard') && b.media)
    .map(b => ({
      id: b.id,
      url: `/api/requirements/${typeof getReqId === 'function' ? getReqId() : getReqId}/media/${b.media}`,
      caption: b.caption || b.alt || (b.type === 'whiteboard' ? '画板缩略图' : '')
    })))
  return { docData, docBlocks, childrenByParent, rootBlocks, docSections, partitionedSections,
           commentByRef, docToc, mediaList }
}

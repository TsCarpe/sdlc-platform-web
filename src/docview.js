// v4.1 原始需求层级还原（parse_doc 0.5 配套渲染层）：纯函数三件套——
// partitionRows（全标量小表聚合）/ splitRowScalars（行卡头/标签值对分流，D1 通用规则）/
// groupRowChildren（行内子块按 cell 戳分组 + 尾部图廊 + 列表视觉挂靠前导段）。
// 全部结构特征驱动（标量性/长度/位置），不识别列名语义；旧数据（head 空 / 子块无 cell 锚）天然回落现状。

/** 判断行块是否可聚合进真表格——head 非空、格数与列数一致、全格为字符串（长短/空串不限：
 * 长文本格正是矩阵表的正文），且无行内子块、无飞书评论引用、不在锚点排除集。
 * 带子块/评论/锚点的行回落行卡（树与图廊需纵向空间；评论与待澄清 pill 的宿主也是行卡）。 */
function isAggregableRow(b, childCountBy, excludeIds) {
  if (!b || b.type !== 'table-row') return false
  const head = b.head || []
  const cells = b.cells || []
  if (!head.length || cells.length !== head.length) return false
  if (!cells.every(c => typeof c === 'string')) return false
  if (childCountBy.get(b.id)) return false                     // 有行内子块 → 行卡承载
  if (String(b.comments || '').trim()) return false            // 行上有评论引用 → 保持可锚定行卡
  if (excludeIds?.has(b.id)) return false                      // 待澄清/平台评论锚点宿主 → 行卡
  return true
}

const MEDIA_TYPES = ['image', 'attachment', 'whiteboard']

/**
 * 块序列 → [{kind:'block', block} | {kind:'table', head, rows:[…]} | {kind:'gallery', blocks:[…]}]。
 * 连续可聚合行且 head 逐项相等 → 聚合为一张 mini 表格（head 取 run 首行）；
 * 连续媒体块（image/attachment/whiteboard）≥2 → 聚合图廊（封面缩略点击灯箱），单个 → 独立卡（CSS 限高）。
 * childCountBy：父块 id → 子块数（OriginTab 由 childrenByParent 统计传入；缺省空 Map = 全部视为无子块）；
 * excludeIds：锚点宿主块 id 集（OriginTab 传待澄清/平台评论两 map 的键；缺省空集）。
 */
export function partitionRows(blocks, childCountBy = new Map(), excludeIds = new Set()) {
  const out = []
  let run = null       // 当前聚合中的表格 run
  let media = null     // 当前连续媒体 run
  const flushMedia = () => {
    if (!media) return
    if (media.length > 1) out.push({ kind: 'gallery', blocks: media })
    else media.forEach(b => out.push({ kind: 'block', block: b }))
    media = null
  }
  for (const b of blocks || []) {
    if (isAggregableRow(b, childCountBy, excludeIds)) {
      flushMedia()
      const joinable = run && run.head.length === (b.head || []).length
        && run.head.every((h, i) => h === b.head[i])
      if (joinable) { run.rows.push(b); continue }
      run = { kind: 'table', head: [...b.head], rows: [b] }
      out.push(run)
      continue
    }
    run = null
    if (MEDIA_TYPES.includes(b?.type)) { media = [...(media || []), b]; continue }
    flushMedia()
    out.push({ kind: 'block', block: b })
  }
  flushMedia()
  return out
}

/** 值显示长度（码点计）——D1 卡头 chip 的 ≤6 字判定 */
function visLen(s) { return Array.from(String(s || '')).length }

/**
 * 行块标量分流（D1）：{headerVals, metaPairs}。
 * 第 1 列不进（rowLabel 即其值）；第 2 列起取连续标量前缀（cells 非空、head 有标签、显示长度 ≤6 字），
 * 至多 2 列进 headerVals（只显值不显标签）；前缀在首个不满足处截断；截断后所有非空 cells 列
 * （含因 2 列上限跳过的短列）进 metaPairs（label = head[i] || ''，label 空只显值）。
 * head 空数组（旧数据）：全部非空列进 metaPairs 无标签。
 */
export function splitRowScalars(block) {
  const head = block?.head || []
  const cells = block?.cells || []
  const metaPairs = []
  if (!head.length) {
    cells.forEach((c, i) => { if (c) metaPairs.push({ label: '', value: c, idx: i }) })
    return { headerVals: [], metaPairs }
  }
  const headerVals = []
  const used = new Set()   // 已进卡头的列下标（值可能重复，按下标排除）
  for (let i = 1; i < cells.length; i++) {
    const v = cells[i]
    if (typeof v !== 'string' || v === '' || !head[i] || visLen(v) > 6 || headerVals.length >= 2) break
    headerVals.push(v)
    used.add(i)
  }
  cells.forEach((c, i) => {
    if (i === 0 || !c || used.has(i)) return
    metaPairs.push({ label: head[i] || '', value: c, idx: i })
  })
  return { headerVals, metaPairs }
}

/**
 * 行内子块分组：[{cellIdx, label, tree, gallery}]。
 * 按块上的 cell 键分桶（无键归 -1 排最前，其余按 cellIdx 升序，未知顺序保持原序）；
 * label = cellIdx ≥ 0 ? (head[cellIdx] || '') : ''。组内切 {tree, gallery}——尾部连续的
 * image/attachment/whiteboard 进 gallery（图廊），其余进 tree。tree 内再做视觉挂靠：连续
 * list-item run（≥1 个）若紧邻前驱是非 subheading 的 paragraph，重组为 {kind:'lead', block,
 * listChildren}（从属还原在渲染层——数据层 li.parent 仍 = 行块，B1 修正）；其余块为
 * {kind:'block', block}。
 */
export function groupRowChildren(children, head = []) {
  const byCell = new Map()   // cellIdx → blocks（-1 = 无 cell 键的旧数据/未知）
  for (const b of children || []) {
    const ci = Number.isInteger(b?.cell) ? b.cell : -1
    if (!byCell.has(ci)) byCell.set(ci, [])
    byCell.get(ci).push(b)
  }
  const groups = [...byCell.keys()].sort((a, b) => (a < 0 ? -1 : b < 0 ? 1 : a - b))
    .map(ci => {
      const blocks = byCell.get(ci)
      let split = blocks.length                     // gallery = 尾部连续媒体块
      while (split > 0 && ['image', 'attachment', 'whiteboard'].includes(blocks[split - 1].type)) split--
      return { cellIdx: ci, label: ci >= 0 ? (head[ci] || '') : '', tree: blocks.slice(0, split), gallery: blocks.slice(split) }
    })
  for (const g of groups) g.tree = attachLeads(g.tree)
  return groups
}

/**
 * 块文本（md 行内源码）→ 纯文本标签：剥图片/链接（留锚文本）、粗体/斜体/删除线/行内代码标记、行内 HTML 标签。
 * 纯文本插值场景用（评论目标 chip、目录）；v-html 渲染场景不走这里（仍 marked.parseInline）。
 * 单下划线不剥（词内 `_` 常见于 snake_case 标识符，成对才误伤）；不成对的孤立标记原样保留。
 */
export function mdPlain(t) {
  return String(t || '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')            // ![alt](url)/[text](url) → alt/text
    .replace(/(\*\*|__|~~)(?=\S)([\s\S]*?\S)\1/g, '$2')   // **粗**/__粗__/~~删~~ → 内容
    .replace(/\*(?=\S)([\s\S]*?\S)\*/g, '$1')             // *斜* → 内容
    .replace(/`+([^`]*)`+/g, '$1')                        // `code` → 内容
    .replace(/<[^>]*>/g, '')                              // 行内 HTML 标签
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * 目录项提取（doc-structure docToc 同源，v5.3 抽为纯函数供工作台章节分组/侧栏共用）：
 * heading/title 全收；table-row 行卡作导航节点但排除版本号形态 rowLabel（§x.y.z 纯数字行）。
 */
export function docTocOf(blocks) {
  return (blocks || [])
    .filter(b => b.type === 'heading' || b.type === 'title'
      || (b.type === 'table-row' && !/^\d+(\.\d+)+$/.test(String(b.rowLabel || ''))))
    .map(b => ({
      id: b.id,
      level: b.type === 'table-row' ? 3 : (b.level || 1),
      text: b.type === 'table-row' ? (b.rowLabel || '') : mdPlain(b.text)
    }))
}

/**
 * 目录索引（v5.3）：一次建块序与目录项位置，供「块 → 所属章节」与「章节 → 祖先面包屑」。
 * 返回 { posOf, sectionOf, crumbOf, nodes }；nodes 为带文档序的目录项（find/crumb 遍历用）。
 */
export function tocIndex(blocks, toc) {
  const blockIdx = new Map()
  ;(blocks || []).forEach((b, i) => blockIdx.set(b.id, i))
  const nodes = (toc || []).map(t => ({ ...t, pos: blockIdx.get(t.id) ?? -1 }))
  /** blockId → 文档序（不存在 → -1） */
  const posOf = id => blockIdx.get(id) ?? -1
  /** blockId → 所属目录项：其前方最近者（首个目录项之前 → null） */
  function sectionOf(blockId) {
    const i = posOf(blockId)
    if (i < 0) return null
    let hit = null
    for (const n of nodes) {
      if (n.pos < 0) continue
      if (n.pos > i) break
      hit = n
    }
    return hit
  }
  /** entryId → 祖先链 […, 自身]：向前取 level 严格递减的目录项 */
  function crumbOf(entryId) {
    const i = nodes.findIndex(n => n.id === entryId)
    if (i < 0) return []
    const chain = [nodes[i]]
    let minLv = nodes[i].level
    for (let j = i - 1; j >= 0; j--) {
      if (nodes[j].level < minLv) { chain.unshift(nodes[j]); minLv = nodes[j].level }
    }
    return chain
  }
  return { posOf, sectionOf, crumbOf, nodes }
}

/** tree 块序 → 渲染项序（lead 挂靠）：连续 list-item run 挂最近前驱非 subheading 段落 */
function attachLeads(tree) {
  const items = []
  let i = 0
  while (i < tree.length) {
    if (tree[i].type !== 'list-item') { items.push({ kind: 'block', block: tree[i++] }); continue }
    let j = i
    while (j < tree.length && tree[j].type === 'list-item') j++
    const run = tree.slice(i, j)
    const prev = items[items.length - 1]
    if (prev?.kind === 'block' && prev.block.type === 'paragraph' && !prev.block.subheading) {
      items[items.length - 1] = { kind: 'lead', block: prev.block, listChildren: run }
    } else {
      for (const b of run) items.push({ kind: 'block', block: b })
    }
    i = j
  }
  return items
}

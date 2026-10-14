// v4 块级编辑数据面（DESIGN-v4 §14 方案 C）：编辑器的全部树操作与提交清洗集中本模块——
// 组件（BlockEditor.vue）只管交互，逻辑纯函数化便于单测。提交契约见交接文档 §3.2：
// 全量块数组、剥派生键（path/ordinal/comments）、comment 块不入提交、parent:null 省略键；
// 前端预防守卫：parent 前向引用、行内子块（parent=table-row）必须紧随其行。

export const BLOCK_TYPES = ['title', 'heading', 'paragraph', 'list-item', 'table-row', 'image', 'attachment', 'whiteboard']
// 可在「+」菜单插入/参与类型转换的文本类块（table-row 结构重、media 类需上传，不入快捷新建）
export const TEXT_TYPES = ['paragraph', 'heading', 'list-item']

const DERIVED_KEYS = new Set(['path', 'ordinal', 'comments'])

// ---------- 副本与提交 ----------

/** doc.json 块数组 → 编辑副本：深拷贝 + 滤 comment 块（评论不入块表）。派生键保留（渲染态可用），提交时再剥 */
export function toEditable(blocks) {
  return (blocks || []).filter(b => b && b.type !== 'comment').map(b => ({ ...b }))
}

/** 编辑副本 → 提交数组：剥派生键；parent 空值省略键（服务端剥 None 等价）；其余键原样 */
export function toPayload(rows) {
  return rows.map(b => {
    const out = {}
    for (const [k, v] of Object.entries(b)) {
      if (DERIVED_KEYS.has(k)) continue
      if (k === 'parent' && (v === null || v === undefined || v === '')) continue
      out[k] = v
    }
    return out
  })
}

// ---------- 树结构读取 ----------

/** parent → 直接子块（数组序）。parent 为空 = 根 */
export function childrenMap(rows) {
  const m = new Map()
  for (const b of rows) {
    const p = b.parent || ''
    if (!m.has(p)) m.set(p, [])
    m.get(p).push(b)
  }
  return m
}

/** 块的子树终点（排他下标）：从 start 起的连续区段，每块 parent 链均已在区段内出现——
 * 契约只强制 table-row 行内子块紧随，列表嵌套按惯例也连续；非连续子块视作独立块不并入 */
export function subtreeEnd(rows, start) {
  let end = start + 1
  while (end < rows.length) {
    const anc = rows[end].parent
    if (!anc) break
    let covered = false
    for (let i = start; i < end; i++) { if (rows[i].id === anc) { covered = true; break } }
    if (!covered) break
    end++
  }
  return end
}

// ---------- 结构操作（全部返回新数组） ----------
// depth 维护口径（对齐交接 §3.2「上提 = parent 改指 + depth-1」）：只在显式改父的操作里动 depth
// （lift/promote 减一、demote=新父 depth+1），未触动的块一字节不改——导入数据存在 depth 与 parent
// 链不一致的存量（如 depth:1 的根列表项），全局重算会产生伪 edit 差异（服务端 ordinal 推导只认
// parent 链，depth 是装饰性元数据，改动即进 diff/变更面，须谨慎）。

let tmpSeq = 0
export function newTempId() { return `tmp-${Date.now().toString(36)}-${++tmpSeq}` }

/** 新块工厂：type 必填；heading 缺省 level 2；list-item 缺省 marker •；parent/afterId 由调用方接 */
export function newBlock(type, { text = '', parent = '', level = 2 } = {}) {
  const b = { id: newTempId(), type, text }
  if (type === 'heading') b.level = level
  if (type === 'list-item') { b.marker = '•' }
  if (parent) b.parent = parent
  return b
}

/** 行子树内的行内子块插入位（排他下标）：行直接子块必须连续紧随行块（§2.3）——子树尾若挂着
 * 嵌套子树（如 li 的嵌套项），回退到最后一个直接子块之后，防新行内子块隔断连续区 */
function rowChildInsertPos(rows, rowIdx) {
  const rowId = rows[rowIdx].id
  let p = subtreeEnd(rows, rowIdx)
  while (p > rowIdx + 1 && rows[p - 1].parent !== rowId) p--
  return p
}

/** 在某块的子树之后插入新块（兄弟语义：同 parent）——行内子块不会插进行区间中间。
 * v4.1 行内子树感知：锚块自身或其祖先链在 table-row 子树内时，插入统一落行子树内
 * （防行内子块连续区被拦腰截断违紧随约束）；paragraph/list-item 挂行（parent=rowId +
 * 继承锚块 cell 戳，无戳不补）——内容格段落从行内插入不再漂到根块 */
export function insertAfter(rows, afterId, block) {
  const i = rows.findIndex(b => b.id === afterId)
  if (i < 0) return rows
  const host = rows[i]
  let anc = host
  const seen = new Set()
  while (anc && !seen.has(anc.id)) {
    seen.add(anc.id)
    if (anc.type === 'table-row') break
    anc = anc.parent ? rows.find(b => b.id === anc.parent) : null
  }
  if (anc?.type === 'table-row') {
    if (block.type === 'paragraph' || block.type === 'list-item') {
      block.parent = anc.id
      if (host.cell != null) block.cell = host.cell
    }
    const out = [...rows]
    out.splice(rowChildInsertPos(rows, rows.findIndex(b => b.id === anc.id)), 0, block)
    return out
  }
  if (block.type === 'list-item' && host.type === 'list-item') {
    block.parent = host.parent || undefined
    if (!block.parent) delete block.parent
  }
  const out = [...rows]
  out.splice(subtreeEnd(rows, i), 0, block)
  return out
}

/** 删除块：table-row/whiteboard 连子树删（行内子块离行无意义）；其余只删本块、直接子块上提
 * （parent→被删块的 parent）——对齐守卫「删父留子须上提」，heading 删不带章节体（正文块非 parent
 * 挂载自然保留） */
export function removeBlock(rows, id) {
  const i = rows.findIndex(b => b.id === id)
  if (i < 0) return rows
  const host = rows[i]
  const withTree = host.type === 'table-row' || host.type === 'whiteboard'
  const end = withTree ? subtreeEnd(rows, i) : i + 1
  const out = rows.filter((_, k) => k < i || k >= end)
  if (!withTree) {
    for (const b of out) {
      if (b.parent === id) {
        if (host.parent) b.parent = host.parent
        else delete b.parent
        if (b.depth != null && b.depth > 0) b.depth -= 1   // 契约：上提 depth-1（缺失不补）
      }
    }
  }
  return out
}

/** 同父兄弟间拖拽重排：drag 子树整组移到 target 前/后（跨父移动不在此——走升降级菜单）。
 * 目标在 drag 子树内或非同父 → 原样返回 */
export function moveWithinParent(rows, dragId, targetId, beforeTarget) {
  const di = rows.findIndex(b => b.id === dragId)
  const ti = rows.findIndex(b => b.id === targetId)
  if (di < 0 || ti < 0) return rows
  const host = rows[di]
  if ((host.parent || '') !== (rows[ti].parent || '')) return rows
  const dend = subtreeEnd(rows, di)
  if (ti >= di && ti < dend) return rows
  const drag = rows.slice(di, dend)
  const rest = [...rows.slice(0, di), ...rows.slice(dend)]
  const tIndex = rest.findIndex(b => b.id === targetId)
  if (tIndex < 0) return rows
  const at = beforeTarget ? tIndex : subtreeEnd(rest, tIndex)
  return [...rest.slice(0, at), ...drag, ...rest.slice(at)]
}

function isInlineOfRow(rows, b) {
  const p = rows.find(x => x.id === b.parent)
  return !!p && p.type === 'table-row'
}

/** 降级（list-item）：挂到前一个同父 list-item 兄弟之下（depth+1）；heading：level+1（≤6）。
 * 行内子块（父为 table-row）不参与升降级——规避紧随约束违例 */
export function demote(rows, id) {
  const i = rows.findIndex(b => b.id === id)
  if (i < 0) return rows
  const b = rows[i]
  if (isInlineOfRow(rows, b)) return rows
  if (b.type === 'heading') {
    const out = [...rows]
    out[i] = { ...b, level: Math.min((b.level || 2) + 1, 6) }
    return out
  }
  if (b.type !== 'list-item') return rows
  const parent = b.parent || ''
  const prev = [...rows.slice(0, i)].reverse().find(x => (x.parent || '') === parent)
  if (!prev || prev.type !== 'list-item') return rows
  const out = [...rows]
  out[i] = { ...b, parent: prev.id, depth: (prev.depth || 0) + 1 }
  return out
}

/** 升级（list-item）：parent → 祖父块（无祖父=转根块）；heading：level-1（≥1） */
export function promote(rows, id) {
  const i = rows.findIndex(b => b.id === id)
  if (i < 0) return rows
  const b = rows[i]
  if (isInlineOfRow(rows, b)) return rows
  if (b.type === 'heading') {
    const out = [...rows]
    out[i] = { ...b, level: Math.max((b.level || 2) - 1, 1) }
    return out
  }
  if (b.type !== 'list-item' || !b.parent) return rows
  const grand = rows.find(x => x.id === b.parent)?.parent || ''
  const out = [...rows]
  const nb = { ...b }
  if (grand) nb.parent = grand
  else delete nb.parent
  if (nb.depth != null && nb.depth > 0) nb.depth -= 1   // 契约：升层 depth-1
  out[i] = nb
  return out
}

/** 类型转换（文本类三态互转，text 保留）：heading 带 level 2、list-item 带 marker • */
export function convertType(rows, id, newType) {
  if (!TEXT_TYPES.includes(newType)) return rows
  const i = rows.findIndex(b => b.id === id)
  if (i < 0) return rows
  const b = rows[i]
  if (!TEXT_TYPES.includes(b.type)) return rows
  const out = { id: b.id, type: newType, text: b.text }
  if (newType === 'heading') out.level = b.type === 'heading' ? b.level : 2
  if (newType === 'list-item') out.marker = '•'
  // 保持树位置：继承原 parent（depth 原样保留——装饰性元数据不因类型转换漂移）
  if (b.parent) out.parent = b.parent
  if (b.depth != null) out.depth = b.depth
  const next = [...rows]
  next[i] = out
  return next
}

// ---------- 提交前本地校验（前端预防，服务端同款守卫兜底） ----------

/** 返回问题列表 [{index, id, msg}]——空数组 = 可提交。规则对齐 parse_blocks：
 * ①id 非空唯一；②type 白名单；③parent 必须在本块之前出现；④行内子块（parent=table-row）紧随其行或同父子块 */
export function validate(rows) {
  const problems = []
  if (!Array.isArray(rows) || !rows.length) {   // 空块数组（后端 parse_blocks 同拒）
    problems.push({ index: 0, id: '', msg: '块数组为空——原文至少需要一个内容块' })
    return problems
  }
  const seen = new Set()
  const types = new Map()
  rows.forEach((b, i) => {
    const id = String(b.id || '').trim()
    if (!id) problems.push({ index: i, id: '', msg: '块缺少 ID' })
    else if (seen.has(id)) problems.push({ index: i, id, msg: `块 ID 重复：${id}` })
    if (id) { seen.add(id); types.set(id, b.type) }
    if (!BLOCK_TYPES.includes(b.type)) problems.push({ index: i, id, msg: `非法块类型：${b.type}` })
  })
  let prevId = ''
  let prevInlineParent = ''
  rows.forEach((b, i) => {
    const id = String(b.id || '').trim()
    const parent = String(b.parent || '')
    if (parent) {
      const pi = rows.findIndex(x => x.id === parent)
      if (pi < 0 || pi >= i) problems.push({ index: i, id, msg: `父块 ${parent} 不在本块之前（前向引用或缺失）` })
      else if (types.get(parent) === 'table-row' && parent !== prevId && parent !== prevInlineParent) {
        problems.push({ index: i, id, msg: `行内子块必须紧随其表格行 ${parent}` })
      }
      prevInlineParent = types.get(parent) === 'table-row' ? parent : ''
    } else {
      prevInlineParent = ''
    }
    prevId = id
  })
  return problems
}

<script setup>
// 澄清工作台 tab（DESIGN-v5 §1/§2，由 ChecklistTab 升级——D19：tab 键名仍为 'checklist'，仅组件更名）。
// audit 合并（D1/D14）：audit 是 clarify 的超集，差集 ∧ go✅ 条目以「已定论」只读折叠组获得宿主
// （组名带「已定论·」前缀防与 check 组撞名联动，同状态机前缀先例）；audit 字段归宿——去向/关联
// 用例进问题卡「影响分析」折叠，audit.md 原文折叠挪页尾。作答/处置/三态筛选/跳转等既有能力全保留。
// v5.3 扫题零成本上下文改版：分组由「需求域 theme」切「文档章节」（壳层 anchor→最近目录项）；
// 活动卡（点击/侦测激活）联动右栏常驻高亮 + TOC 同步 + 面包屑；theme 降为卡上标签。
import { ref, reactive, computed, watch, nextTick, onBeforeUnmount } from 'vue'
import { api } from '../api.js'
import AppIcon from './AppIcon.vue'
import EmptyState from './EmptyState.vue'
import CtxPane from './CtxPane.vue'
import TocPane from './TocPane.vue'
import { render } from '../render.js'
import ImgViewer from './ImgViewer.vue'
import { firstQuote, flashEl, settle, pidOf } from '../trace.js'
import { isDone, isPending, dispLabel } from '../disposition.js'
import { lvlLabel, lvlCls } from '../levels.js'
import { layerShort, layerFull } from '../layers.js'
import { useGrpCollapse } from '../composables/group-collapse.js'
import { useModalFocus } from '../composables/modal-focus.js'
import { ask } from '../confirm.js'

const props = defineProps({
  reqId: { type: String, required: true },
  items: { type: Array, default: () => [] },
  status: { type: String, default: '' },
  groups: { type: Array, default: () => [] },      // 壳层章节分组（v5.3：anchor→最近目录项；无块回退需求域。revealGrpFor 共用）
  audit: { type: Object, default: null },          // 体检产物（已定论/影响分析/孤儿行数据源）
  concludedGroups: { type: Array, default: () => [] },  // 壳层算好的已定论分组（差集∧✅，name 带「已定论·」前缀）
  doc: { type: Object, default: null },            // detail.doc（右栏原文侧栏数据——非产物，空态照常渲染）
  snapshot: { type: Object, default: null },       // 侧栏「依据版本」展示
  commentAnchorMap: { type: Object, default: () => ({}) },  // v5.x 评论锚 → 面板定位目标（出处=评论区分流）
  comments: { type: Array, default: () => [] },     // 评论行（CtxPane 评论出处卡数据源——壳层持有）
  blockText: { type: Object, default: () => ({}) }, // blockId → 文本摘要（评论出处卡锚定块标签）
  activeHead: { type: String, default: '' },        // 体检报告目录滚动高亮（壳层 toc-scroll 协议）
})
// 事件语义：open-comment = 打开完整评论面板（CtxPane「打开评论区」转发）；view-comment = 只读
// 查看回退（无右栏 / 悬空评论）——壳层分别以完整/只读模式接住
const emit = defineEmits(['locate', 'jump', 'toast', 'open-comment', 'view-comment', 'open-origin', 'go-toc'])

const { openGrps, toggleGrp, expandAll, collapseAll, revealGrpFor } = useGrpCollapse()

const answered = computed(() => props.items.filter(isDone).length)
const totalQ = computed(() => props.items.length)
const prog = computed(() => totalQ.value ? Math.round(answered.value / totalQ.value * 100) : 0)
const allAnswered = computed(() => totalQ.value > 0 && answered.value === totalQ.value)

/** 组头副标题：澄清组带已答进度（模板内联） */
function answeredIn(items) { return (items || []).filter(isDone).length }

// ===== 体检报告原文右栏目录（C7：复用 StdTab 的 TocPane / 壳层 toc-scroll 协议） =====
const auditToc = ref([])
const auditBox = ref(null)
const auditOpen = ref(false)
async function onAuditToggle(e) {
  auditOpen.value = e.target.open
  if (!e.target.open) { auditToc.value = []; return }
  if (!props.audit?.markdown) return
  await settle(60)
  const box = auditBox.value
  if (!box) return
  const hs = [...box.querySelectorAll('h2, h3')]
  hs.forEach((h, i) => { if (!h.id) h.id = 'aud-' + i })
  auditToc.value = hs.map(h => ({ id: h.id, level: h.tagName === 'H2' ? 1 : 2, text: h.textContent.trim().slice(0, 46) }))
  // 展开不产生 scroll 事件、watch(tab) 不触发——主动派发一次让壳层 onScroll 算出初始高亮
  window.dispatchEvent(new Event('scroll'))
}
/** 折叠态必须返回空数组：details 隐藏子树仍在 DOM，隐藏元素 rect.top 恒 0 会被滚动判定误当当前标题 */
function headEls() {
  return auditOpen.value && auditBox.value ? [...auditBox.value.querySelectorAll('h2[id],h3[id]')] : []
}
defineExpose({ headEls })

// ===== v5 audit 合并（§1.2/D14）：已定论 / 影响分析 / 孤儿行 =====
const auditItems = computed(() => props.audit?.content?.items || [])
// 影响分析 join：audit id 过 pidOf 剥「体检.」前缀后按 seq 对齐（§6.2——存量 id 带前缀，消费一律过 pidOf）
const auditByPid = computed(() => {
  const m = {}
  for (const a of auditItems.value) m[pidOf(a.id)] = a
  return m
})
/** 问题卡影响分析数据（去向 + 关联用例；audit join miss → null 不渲染折叠区） */
function impactOf(seq) {
  const a = auditByPid.value[seq]
  return a ? { go: a.go || '', relatedCases: a.relatedCases || [] } : null
}
// 孤儿行（r3 二审#1）：audit 有、clarify 无、且无 ✅ 定论标记——编号权威分叉的疑似行，
// 不渲染成卡（防「同题两卡」），提示条引导查 audit.md 原文
const orphanCount = computed(() => {
  const seqs = new Set(props.items.map(i => i.seq))
  return auditItems.value.filter(a => !seqs.has(pidOf(a.id)) && !String(a.go || '').startsWith('✅')).length
})
// 已定论组挂载（r2 A1：两侧组集分叉——同 check 组名的渲染进组内顶部子折叠块，无匹配的独立顶层组）
const checkGroupNames = computed(() => new Set(props.groups.map(g => g.name)))
const concludedByRaw = computed(() => {
  const m = {}
  for (const g of props.concludedGroups) m[g.raw || g.name] = g
  return m
})
const standaloneConcluded = computed(() =>
  props.concludedGroups.filter(g => !checkGroupNames.value.has(g.raw || g.name)))

// ===== 问题卡「原稿附图」（v1.7 契约 figs）：质检产出 items[].figs=相关图片块 id 数组——
// AI 在产出问题时就标好配图（题级选择，替代前端规则推导）；按 figs 序查块渲染缩略图，
// 引用了缺失/非图块一律跳过（防御——契约宽松字段不做存在性强校验）。无 figs → 不渲染
// （D12 降级不冒充）。点图开灯箱（复用 v4.20 ImgViewer，图源=媒体端点与 CtxPane 同源），
// 图注行可右栏定位原块。
const docBlocksWb = computed(() => props.doc?.content?.blocks || [])
const blkById = computed(() => {
  const m = {}
  for (const b of docBlocksWb.value) m[b.id] = b
  return m
})
function picsOf(it) {
  return (Array.isArray(it.figs) ? it.figs : [])
    .map(id => blkById.value[id])
    .filter(b => b && (b.type === 'image' || b.type === 'whiteboard') && b.media)
    .map(b => ({ id: b.id,
                 url: `/api/requirements/${props.reqId}/media/${b.media}`,
                 caption: (b.caption || b.alt || (b.type === 'whiteboard' ? '画板缩略图' : '原文图片')).trim() }))
}
const picsBySeq = computed(() => {
  const m = {}
  for (const it of props.items) m[it.seq] = picsOf(it)
  return m
})
/** 图注定位：块锚走右栏侧栏定位（不切 tab）；无块结构回退壳层 locate */
function locatePic(p, it) {
  if (!hasDoc.value) return emit('locate', '', p.id)
  if (ctxCollapsed.value) ctxCollapsed.value = false
  nextTick(() => ctxRef.value?.locateCtx({ seq: it.seq, src: '', anchor: p.id, ctxText: p.caption }))
}
// 灯箱：单实例按卡图源开关（ImgViewer 复用 v4.20；list=[{url,caption}]）
const picViewer = ref({ list: [], idx: -1 })
function openPic(pics, i) { picViewer.value = { list: pics, idx: i } }

// ===== v5 双栏原文侧栏（§2.1）：拖宽 320-760 记忆 / 收起恢复 / 摘引联动定位 / 反向角标 =====
const hasDoc = computed(() => !!(props.doc?.content?.blocks || []).length)
// 反向角标数据（§4，仅 anchor 行挂载、仅待处置——全处置后角标自然消失降噪）
const pendingByBlock = computed(() => {
  const m = {}
  for (const it of props.items) {
    if (it.anchor && isPending(it)) (m[it.anchor] = m[it.anchor] || []).push(it.seq)
  }
  return m
})
const ctxRef = ref(null)
const ctxW = ref(Math.min(760, Math.max(320, +localStorage.getItem('wb.ctxW') || 430)))
// P1-13：<1200px 右栏默认收起（抽屉式），宽屏保持既有默认展开
const narrowCtx = typeof window !== 'undefined' && !!window.matchMedia
  && window.matchMedia('(max-width: 1199px)').matches
const ctxCollapsed = ref(narrowCtx)
// P1-13：宽度走 CSS 变量——媒体查询可覆盖（行内 gridTemplateColumns 会压过断点）
const gridStyle = computed(() => hasDoc.value && !ctxCollapsed.value
  ? { '--ctx-w': ctxW.value + 'px' } : null)

let drag = null   // { x0, w0 } —— 拖宽会话（document 级 move/up）
function startDrag(e) {
  e.preventDefault()
  drag = { x0: e.clientX, w0: ctxW.value }
  document.addEventListener('mousemove', onDrag)
  document.addEventListener('mouseup', endDrag)
}
function onDrag(ev) {
  if (!drag) return
  ctxW.value = Math.min(760, Math.max(320, Math.round(drag.w0 + (drag.x0 - ev.clientX))))
}
function endDrag() {
  drag = null
  localStorage.setItem('wb.ctxW', String(ctxW.value))
  document.removeEventListener('mousemove', onDrag)
  document.removeEventListener('mouseup', endDrag)
}
onBeforeUnmount(() => { if (drag) endDrag() })

/** v5.x 评论锚判定：出处=评论区的条目点击开评论面板定位（而非原文侧栏——评论不在块结构里，
 *  locateCtx 必 miss）；map miss（块锚/无锚）走原定位路径 */
const isCmtAnchor = anchor => props.commentAnchorMap[anchor] != null

/** 评论出处分流（v5.x）：出处=评论 → 右栏评论出处卡只读查看（不弹抽屉、不遮右栏原文）；
 *  无块结构（无右栏）或悬空评论（已被删除/列表为空）→ 回退只读抽屉（view-comment）——
 *  只读抽屉至少可见全量评论列表，不做静默无反应 */
async function openCommentInCtx(cid, seq) {
  if (!hasDoc.value) return emit('view-comment', cid)
  ctxCollapsed.value = false   // 右栏收起时先展开（nextTick 后 v-if 挂载完成、ctxRef 可用）
  await nextTick()
  const ok = await ctxRef.value?.locateComment({ seq, cid })
  if (!ok) emit('view-comment', cid)
}

// ===== v5.3 活动卡（扫题零成本上下文）：点击/聚焦/跳题/滚动侦测激活 → 右栏常驻高亮联动 =====
const activeSeq = ref('')
let spyHoldUntil = 0      // 显式激活后的侦测停摆窗：程序性滚动（flash/jump）不抢回活动卡
const qcol = ref(null)    // 左栏容器（侦测取卡域）

/** 激活核心：标记活动卡 + 右栏定位；expand=true 时连带展开收起的右栏（点击/摘引），
 *  滚动侦测（expand=false）尊重收起态只标记不展开。follow 关闭时 CtxPane 内部短路不滚动。 */
function activate(it, expand = false) {
  activeSeq.value = it.seq || pidOf(it.id)
  if (!hasDoc.value) return
  if (ctxCollapsed.value) {
    if (!expand) return
    ctxCollapsed.value = false
  }
  nextTick(() => ctxRef.value?.track({
    seq: it.seq || pidOf(it.id), src: it.ctx || it.where || '', anchor: it.anchor || '',
    quote: it.quote || '', ctxText: it.ctx || it.where || '', cid: cmtIdOf(it)
  }))
}
/** 卡的评论出处 id：评论锚优先，L 系（评论升级）回落 srcCommentId；非评论出处 null */
function cmtIdOf(it) {
  return props.commentAnchorMap[it.anchor] ?? (it.origin === 'local' ? it.srcCommentId ?? null : null)
}
/** 显式点评论出处（出处链接 / L 系「来自评论」）：先出卡（不受 follow 限制、悬空回退只读抽屉），
 *  再走活动卡跟随把原文同步到评论锚定块（track 识别同线程不重插卡） */
async function openCmtFor(it, cid) {
  spyHoldUntil = Date.now() + 800
  activeSeq.value = it.seq || pidOf(it.id)
  await openCommentInCtx(cid, it.seq || pidOf(it.id))
  if (hasDoc.value) activate(it)
}
/** 显式激活（卡面点击/摘引/跳题/反向角标）：800ms 停摆窗——随后的程序性滚动不被侦测误抢 */
function activateExplicit(it) {
  spyHoldUntil = Date.now() + 800
  activate(it, true)
}
/** 摘引/出处点击（左栏问题卡与已定论卡）：评论锚走出处卡，其余走活动卡侧栏联动（不切 tab，§2.1）；
 *  无块结构（快照老卡）回退壳层 locate 协议（切 origin needle 定位） */
function locateInCtx(it) {
  const cid = props.commentAnchorMap[it.anchor]
  if (cid != null) return openCmtFor(it, cid)
  if (!hasDoc.value) return emit('locate', firstQuote(it.quote) || it.ctx || it.title || it.where, it.anchor)
  activateExplicit(it)
}
/** 反向角标点击（CtxPane 上抛）：滚回左栏对应问题并 flash（§4）；同步活动卡与侦测停摆 */
function locateCheck(seq) {
  const it = props.items.find(i => i.seq === seq)
  if (it) { activeSeq.value = it.seq; spyHoldUntil = Date.now() + 800 }
  revealGrpFor('check', seq)
  nextTick(() => {
    const el = document.querySelector(`[data-pid="${seq}"]`)
    if (el) flashEl(el)
    else emit('toast', `未定位到 ${seq}（可能已被过滤隐藏）`, 'err')
  })
}

// 滚动侦测：捕获阶段监听（页面与嵌套容器滚动都收）；右栏内部滚动不反跟随；
// 停止 ~180ms 后取「阅读线」（视口偏上 38%，封顶 420px）下方第一张卡为活动卡。
let spyT = null
function onSpyScroll(e) {
  if (e.target !== document && e.target?.closest?.('.ctx-body, .ctx-toc')) return
  updateMini()   // v5.4 吸顶细条显隐（同步算——不进防抖，滚动中即时出现）
  clearTimeout(spyT)
  spyT = setTimeout(spyActivate, 180)
}
function spyActivate() {
  if (!hasDoc.value || ctxCollapsed.value || Date.now() < spyHoldUntil) return
  const bySeq = new Map(props.items.map(i => [i.seq, i]))
  const line = Math.min(window.innerHeight * 0.38, 420)
  for (const el of qcol.value?.querySelectorAll('.check-item[data-pid]:not(.done)') || []) {
    if (el.closest('.grp.closed')) continue   // 折叠组（0fr 裁剪非 display:none）内卡不可见——跳过防不可见激活
    if (el.getBoundingClientRect().bottom > line) {
      const it = bySeq.get(el.getAttribute('data-pid'))
      if (it && activeSeq.value !== it.seq) activate(it)
      return
    }
  }
}
window.addEventListener('scroll', onSpyScroll, true)
onBeforeUnmount(() => { window.removeEventListener('scroll', onSpyScroll, true); clearTimeout(spyT) })

// ===== v5 就绪度覆盖地图（§2.2，D3/D12）：维度 = items[].layer（1-7，v1.6 可选），
// 分母口径 = clarify 表全量（空 layer 入「未分类」桶——与发布门禁 counts 一致永不分裂；
// 已定论卡不在 clarify 表不计分母）。items 无任何 layer → 不渲染维度条只留进度（降级不冒充，
// 重推质检产出 layer 后自然点亮）。层名待三期 dimensions.md 契约对齐，先 L<n> 标签。
const dimFilter = ref('')   // 选中维度桶 key（'' = 全部）；与三态筛选叠加
const layerStats = computed(() => {
  const buckets = {}
  for (const it of props.items) {
    const k = it.layer ? String(it.layer) : 'na'
    const b = (buckets[k] = buckets[k] || { key: k, layer: it.layer || null, total: 0, done: 0 })
    b.total++
    if (isDone(it)) b.done++
  }
  return Object.values(buckets).sort((a, b) => (a.layer ?? 99) - (b.layer ?? 99))
})
const hasLayers = computed(() => props.items.some(it => it.layer))
const rdyPct = computed(() => totalQ.value ? Math.round(answered.value / totalQ.value * 100) : 0)

// ===== 澄清导航（三态筛选：全部/待处置/已处置；与维度过滤叠加）=====
const clfFilter = ref('all')   // 'all' | 'pending' | 'done'
const visibleCheckGroups = computed(() => {
  let groups = props.groups
  if (dimFilter.value) {
    // #7：过滤后空组保留当且仅当组内有已定论块——已定论卡是只读参照，不随过滤消失
    groups = groups
      .map(g => ({ name: g.name, title: g.title, items: g.items.filter(it => (it.layer ? String(it.layer) : 'na') === dimFilter.value) }))
      .filter(g => g.items.length || concludedByRaw.value[g.name])
  }
  if (clfFilter.value === 'all') return groups
  // v5.4：「只看待处置」下本次刚处置的卡暂留（linger）——答完即消失会让列表整体上跳、选错找不回；
  // 切筛选/维度时清空暂留集，才按真实状态隐藏
  const pred = clfFilter.value === 'pending' ? (it => isPending(it) || linger.has(it.seq)) : isDone
  // #7：三态过滤同口径——done/pending 过滤下已定论块常驻（过滤语义只作用于澄清题）
  return groups
    .map(g => ({ name: g.name, title: g.title, items: g.items.filter(pred) }))
    .filter(g => g.items.length || concludedByRaw.value[g.name])
})
const linger = reactive(new Set())   // 待处置筛选下本次刚处置、暂不隐藏的 seq
// #8：过滤视图下组不再折叠，待处置项直接可见——dimFilter 单独变且 clf='all' 时也要展开（旧版漏）
watch([clfFilter, dimFilter], ([c, d]) => { linger.clear(); if (c !== 'all' || d) expandAll(props.groups) })
// #8：hasLayers 翻转为 false（items 重拉无 layer）→ 维度条卸载、唯一取消入口消失——清残留防全栏空死锁
watch(hasLayers, v => { if (!v) dimFilter.value = '' })

// ===== v5.4 下一待处置：页面卡片显示序（可见组拍平）、当前活动卡之后、到底绕回第一题 =====
const visibleItems = computed(() => visibleCheckGroups.value.flatMap(g => g.items))
const hasPendingVisible = computed(() => visibleItems.value.some(isPending))
/** from 之后（显示序）首个待处置；from 不在可见序（未激活/被过滤）则从头找；全答完返回 null */
function nextPendingAfter(from) {
  const list = visibleItems.value
  const i0 = list.findIndex(it => it.seq === from)
  for (let k = 1; k <= list.length; k++) {
    const it = list[(i0 + k + list.length) % list.length]
    if (isPending(it)) return it
  }
  return null
}
function goToItem(it) {
  revealGrpFor('check', it.seq)   // 目标组在折叠列表内 → 先展开（跳转协议不因折叠失效）
  activateExplicit(it)            // v5.3：跳题同步活动卡（右栏定位+停摆窗防回抢）
  nextTick(() => {
    const el = document.querySelector(`[data-pid="${it.seq}"]`)
    if (!el) return
    flashEl(el)
    el.querySelector('textarea')?.focus({ preventScroll: true })
  })
}
function jumpNextUnanswered() {
  const it = nextPendingAfter(activeSeq.value)
  if (it) goToItem(it)
}

// ===== v5.4 作答流两开关（localStorage 记忆，默认开；大进度卡与吸顶细条共用同一状态） =====
const prefOn = k => localStorage.getItem(k) !== '0'
const autoNext = ref(prefOn('wb.autoNext'))           // 答完自动下一题
const autoCollapse = ref(prefOn('wb.autoCollapse'))   // 答完自动收起
watch(autoNext, v => localStorage.setItem('wb.autoNext', v ? '1' : '0'))
watch(autoCollapse, v => localStorage.setItem('wb.autoCollapse', v ? '1' : '0'))
const expanded = reactive({})   // seq → true：收起开关下手动展开的已处置卡（保持展开直到再答一次）
const editable = computed(() => props.status === 'clarifying' || props.status === 'changed')
/** 收起摘要行判定：作答态 ∧ 开关开 ∧ 已处置 ∧ 未手动展开（含进页面时即已完成的卡） */
function isFolded(it) {
  return editable.value && autoCollapse.value && isDone(it) && !expanded[it.seq]
}
/** 摘要行答复文本：已答取 answerText（回退 answer 非 JSON 形态），驳回/挂起取理由 */
function foldText(it) {
  if (it.status === 'answered') {
    const t = it.answerText ?? it.answer ?? ''
    return t.startsWith('{"kind"') ? '' : t
  }
  return it.note || ''
}
function expandCard(it) {
  expanded[it.seq] = true
  activateExplicit(it)
}
/** 处置成功后的推进：待处置筛选下暂留；开关开且仍停在该卡（用户未切走）→ 400ms 后到下一题 */
function afterDisposed(seq, wasPending) {
  delete expanded[seq]            // 再答一次 → 收起开关下重新收成摘要
  if (clfFilter.value === 'pending') linger.add(seq)
  if (!wasPending || !autoNext.value) return
  setTimeout(() => {
    if (activeSeq.value && activeSeq.value !== seq) return
    const it = nextPendingAfter(seq)
    if (it) goToItem(it)
  }, 400)
}

// ===== v5.4 左栏吸顶细条：顶部大卡滚出（底边越过 tabs 下沿）后显出 =====
const wbTopEl = ref(null)
const showMini = ref(false)
function updateMini() {
  const el = wbTopEl.value
  showMini.value = !!el && el.getBoundingClientRect().bottom < 100
}

// ===== 答复：失焦自动保存 + 行内微状态（保存中/已保存） =====
const originAnswers = ref({})   // seq → 载入时的答复快照，未变更不重复保存
const ansState = ref({})        // seq → 'saving' | 'saved'

function autoGrow(e) {
  const el = e.target
  el.style.height = 'auto'
  el.style.height = el.scrollHeight + 'px'
}

// ===== v5 选择题化作答（§2.3，D16/D18）：点选即 PUT + per-seq 串行发送链（最后值胜） =====
// picked/extra 为独立本地态（textarea 永不直绑 answer，r4#12）；二期结构化上线（§8「二期切换」）：
// 点选项写 kind=option JSON（optionKey+选项全文快照+extra 全量，D-A/D5），无 options 卡与纯补充
// 维持纯文本——下游一律消费服务端 answerText（D15 单一解构出口），本地回写 display 与之同构。
const picked = reactive({})     // seq → optionKey（PUT 载荷内部标识——永不做回显匹配键，r4#11）
const extra = reactive({})      // seq → 补充说明文本（「以上都不对」自由输入）
const extraOpen = reactive({})  // seq → 补充说明 textarea 展开

/** PUT 载荷装配（r4#12 全量装配、来源装配）：点选项 → 结构化 JSON；纯补充/无 options → 纯文本（D-A） */
function assemblePayload(it) {
  const key = picked[it.seq]
  if (key) {
    const opt = (it.options || []).find(o => o.key === key)
    const payload = { kind: 'option', optionKey: key, optionText: opt ? opt.text : '' }
    const ex = (extra[it.seq] || '').trim()
    if (ex) payload.extra = ex
    return JSON.stringify(payload)
  }
  return (extra[it.seq] || '').trim()
}

/** 展示文本装配：与服务端 answer_text_of 同构（optionText[＋（补充：extra）]，无 key 前缀）——
 *  本地回写的 answerText 必须与重拉后服务端解构值逐字一致，否则出现「回写后闪变」 */
function assembleDisplay(it) {
  const key = picked[it.seq]
  if (key) {
    const opt = (it.options || []).find(o => o.key === key)
    const ex = (extra[it.seq] || '').trim()
    const head = opt ? opt.text : ''
    return ex ? `${head}（补充：${ex}）` : head
  }
  return (extra[it.seq] || '').trim()
}

// per-seq 串行发送链（D16）：同 seq 的 PUT 依次排队、前一个完成才发下一个——与 savingSeqs 的
// 「在途丢弃」语义相反（点选即 PUT 沿用会静默丢答）。makeBody 延迟到实际发送时装配：排队等待
// 期间值再变，轮到发送时取最新值（最后值胜）。处置确认与重开同链——防 set_disposition 三元组
// 整行覆写与在途作答 PUT 后到者胜（互斥条款 ③）。
const putChain = {}      // seq → Promise 链尾
const chainDepth = {}    // seq → 链上排队+在途 PUT 数（flushPendingExtra 判重：链上还有后续则最新值必被其捎带）
function enqueuePut(seq, makeBody) {
  chainDepth[seq] = (chainDepth[seq] || 0) + 1
  const run = async () => {
    const body = makeBody()   // 发送时装配（最后值胜）——轮到发送才取值，排队期间值再变也捎带最新
    try {
      await api.put(`/api/requirements/${props.reqId}/answers/${seq}`, body)
      return body             // 透传发送时值——await 方的回写对象 = 实际发送值
    } finally {
      chainDepth[seq]--
    }
  }
  putChain[seq] = (putChain[seq] ?? Promise.resolve()).catch(() => {}).then(run)
  return putChain[seq]
}

/** 点选即 PUT（无 debounce）：body 显式携带 {answer, status:'answered'}，不依赖服务端按非空推断。
 *  发送时捕获（仅此路径，r4）：enqueue 前装配 payload+display 常量，makeBody 与回调共用——
 *  排队等待期间 extra/picked 再变，回写仍是「= 发送值」（零分歧窗口） */
function pickOption(it, key) {
  if (disposeDlg.value) return            // 处置弹窗打开——选项点击抑制（互斥条款 ①）
  if (it.status === 'rejected' || it.status === 'deferred') return
  const wasPending = isPending(it)
  if (!wasPending) seedExtra(it)          // v5.4 展开即改：覆盖已答前先播种已存补充说明——全量装配不丢 extra
  picked[it.seq] = key
  const payload = assemblePayload(it)     // 捕获时点装配（结构化 JSON）
  const display = assembleDisplay(it)     // 与服务端 answerText 同构的展示文本
  ansState.value[it.seq] = 'saving'
  enqueuePut(it.seq, () => ({ answer: payload, status: 'answered' }))
    .then(() => {
      it.answer = payload                 // 已答快照本地回写（= 发送值，捕获语义）
      it.answerText = display
      it.status = 'answered'              // 切 answered 视图——extra textarea 即将卸载且无 blur（#3）
      originAnswers.value[it.seq] = payload
      ansState.value[it.seq] = 'saved'
      setTimeout(() => { if (ansState.value[it.seq] === 'saved') delete ansState.value[it.seq] }, 2500)
      flushPendingExtra(it, payload)
      afterDisposed(it.seq, wasPending)
    })
    .catch(e => { delete ansState.value[it.seq]; if (picked[it.seq] === key) delete picked[it.seq]; emit('toast', '保存失败：' + e.message, 'err') })   // #9：失败清乐观选中——条件化（无条件删会误清串行链上排队后续点击的新乐观态）
}

/** #3：点选 PUT 在途回写切视图——Vue 卸载聚焦中的 textarea 不派发 blur，saveExtra 不会执行，
 *  排队等待期间新填的 extra 滞留本地 reactive（reopen 的 delete extra 会将其彻底丢失）。
 *  回写时发现最新装配 ≠ 捕获值，即替 textarea 补一次链内 PUT（替身 blur：textarea 已/将卸载
 *  不再输入，makeBody 发送时值 = 最终值）。链上还有后续 PUT（连点/已 blur 入链）则不补——
 *  后续 PUT 的 makeBody 发送时装配必然捎带最新值，补发即重复 */
function flushPendingExtra(it, captured) {
  if ((chainDepth[it.seq] || 0) > 0) return
  if (assemblePayload(it) === captured) return
  ansState.value[it.seq] = 'saving'
  let sent = captured, sentDisplay = ''
  enqueuePut(it.seq, () => {
    sent = assemblePayload(it); sentDisplay = assembleDisplay(it)
    return { answer: sent, status: 'answered' }
  }).then(() => {
    it.answer = sent
    it.answerText = sentDisplay
    originAnswers.value[it.seq] = sent
    ansState.value[it.seq] = 'saved'
    setTimeout(() => { if (ansState.value[it.seq] === 'saved') delete ansState.value[it.seq] }, 2500)
  }).catch(e => { delete ansState.value[it.seq]; emit('toast', '补充说明保存失败：' + e.message, 'err') })
}

/** 「以上都不对」补充说明失焦保存：入 per-seq 发送链（#5——直发与链内点选/处置 PUT 网络乱序，
 *  后到旧值胜会静默吞 extra；入链串行 + makeBody 发送时装配 = 最后值胜贯彻到跨路径）。
 *  savingSeqs 去重保留 §2.3 在途丢弃语义：排队/在途期间连续 blur 只挂一个 PUT——丢弃的是
 *  重复请求而非值（排队中的 makeBody 发送时装配自然捎带最新输入）。幂等短路双基准不变
 *  （payload 体制）：originAnswers 存 payload 形态（pickOption 回写）、it.answerText/answer
 *  是已答快照——各形态对齐比较，不做跨形态比对 */
async function saveExtra(it) {
  if (disposeDlg.value) return            // 处置弹窗打开——抑制该题 blur 保存（互斥条款 ②）
  const payload = assemblePayload(it)
  const display = assembleDisplay(it)
  if (payload === (originAnswers.value[it.seq] ?? '')
      || payload === (it.answer || '') || display === (it.answerText ?? '')) return
  if (savingSeqs.has(it.seq)) return
  savingSeqs.add(it.seq)
  ansState.value[it.seq] = 'saving'
  let sent = payload, sentDisplay = display
  try {
    await enqueuePut(it.seq, () => {
      sent = assemblePayload(it); sentDisplay = assembleDisplay(it)   // 发送时装配（最后值胜）
      return { answer: sent }
    })
    it.answer = sent
    it.answerText = sentDisplay
    it.status = sent.trim() ? 'answered' : 'pending'
    originAnswers.value[it.seq] = sent
    ansState.value[it.seq] = 'saved'
    setTimeout(() => { if (ansState.value[it.seq] === 'saved') delete ansState.value[it.seq] }, 2500)
  } catch (e) {
    delete ansState.value[it.seq]
    emit('toast', '保存失败：' + e.message, 'err')
  } finally {
    savingSeqs.delete(it.seq)
  }
}

/** 「以上都不对」开合（#3 同族路径）：收起 = textarea 卸载同样不派发 blur——收起即替身保存
 *  （saveExtra 幂等短路，无变更零 PUT）；展开仅置位 */
function toggleExtra(it) {
  const closing = extraOpen[it.seq]
  if (!closing && it.status === 'answered') seedExtra(it)   // 已答展开补充：带出已存补充文本再改
  extraOpen[it.seq] = !closing
  if (closing) saveExtra(it)
}

// ===== v5.4 已答「展开即改」：选项回显 + 已存 extra 播种 =====
/** 已存答复解析：结构化 JSON → {optionText, extra}；纯文本旧答/纯补充 → {text}；空 → null */
function parsedAnswer(it) {
  const a = it.answer || ''
  if (!a) return null
  try {
    const p = JSON.parse(a)
    if (p && p.kind === 'option') return { optionText: p.optionText || '', extra: p.extra || '' }
  } catch { /* 纯文本形态 */ }
  return { text: a }
}
/** 当前答复对应的选项 key：本次会话点选优先；否则按选项**全文**匹配（r4#11：optionKey 不做回显
 *  匹配键——选项可能重生成，key 漂移会错配；全文不等即不高亮，宁缺不错） */
function curKey(it) {
  if (picked[it.seq]) return picked[it.seq]
  const p = parsedAnswer(it)
  const t = p?.optionText ?? p?.text ?? ''
  return t ? ((it.options || []).find(o => o.text === t)?.key || '') : ''
}
/** 覆盖已答前播种 extra（仅本地无值时）：结构化取 extra；纯文本且非选项全文 = 自由作答，整段视为补充 */
function seedExtra(it) {
  if (extra[it.seq]) return
  const p = parsedAnswer(it)
  if (!p) return
  if (p.optionText !== undefined) { if (p.extra) extra[it.seq] = p.extra; return }
  if (!(it.options || []).some(o => o.text === p.text)) extra[it.seq] = p.text
}
/** 清空重答（原「重新作答」）：清空已存答复回待确认——破坏性，二次确认 */
async function clearAnswer(it) {
  const ok = await ask({ title: `清空 ${it.seq} 的答复？`, body: '已存答复与补充说明将被清空，该题回到待确认状态。若只想换个选项，直接点其他选项即可覆盖。', danger: true, confirmText: '清空重答' })
  if (ok) reopen(it)
}

// ===== 无 options 卡草稿体制（v1.6 二期）：draft/dirty + 懒播种 + items 替换失效重播种 =====
// textarea 不再直绑 it.answer（answer 可能是 JSON 存储态，输入面必须是展示文本）；draft 播种自
// answerText（服务端解构值，旧数据无此键回退 answer 纯文本）。dirty = 本地编辑过——外部
// load() 整体替换 items（新对象同 seq）时，未 dirty 的 draft 跟随服务端真值重播种，dirty 的
// 保留本地编辑（防外部刷新覆盖正在输入；防 UI 长期显示旧值——机制#7）
const drafts = reactive({})     // seq → 草稿文本（无 options 卡作答输入）
const dirty = reactive({})      // seq → true 本地编辑过（@input 置位；保存成功/重开清除）

function seedOf(it) { return it.answerText ?? (it.answer || '') }
function draftOf(it) {          // 懒播种访问器（模板 :value 用——函数式访问器不能 v-model）
  if (!(it.seq in drafts)) drafts[it.seq] = seedOf(it)
  return drafts[it.seq]
}
function onDraftInput(it, e) {
  drafts[it.seq] = e.target.value
  dirty[it.seq] = true
}

// items 整体替换（ReqDetail load() 重建数组）→ 未 dirty 的 draft+originAnswers 一并失效重播种
watch(() => props.items, (items) => {
  for (const it of items) {
    if (!dirty[it.seq]) {
      drafts[it.seq] = seedOf(it)
      originAnswers.value[it.seq] = seedOf(it)
    }
  }
})

const savingSeqs = new Set()   // per-seq 在途/排队集：失焦重入去重（在途丢弃语义，§2.3）
async function saveAnswer(it) {
  if (disposeDlg.value) return            // 处置互斥：弹窗打开期间抑制失焦保存（§2.3）
  if (!(it.seq in originAnswers.value)) originAnswers.value[it.seq] = seedOf(it)
  const draft = drafts[it.seq] ?? ''      // 比较与发送对象一律是 draft（非 it.answer 存储态）
  if (draft === (originAnswers.value[it.seq] ?? '')) return
  if (savingSeqs.has(it.seq)) return
  savingSeqs.add(it.seq)
  let sent = draft   // 发送时值（makeBody 装配）——响应回来时输入已再变则不回写（乱序防旧覆新）
  ansState.value[it.seq] = 'saving'
  try {
    // 入 per-seq 发送链（#4——直发与处置 PUT 竞速，后到作答 PUT 整行覆写驳回/挂起并清理由）
    await enqueuePut(it.seq, () => { sent = drafts[it.seq] ?? ''; return { answer: sent } })
    if ((drafts[it.seq] ?? '') === sent) {
      it.answer = sent                   // 无 options 卡 = 纯文本作答：answer 与 answerText 同值
      it.answerText = sent
      originAnswers.value[it.seq] = sent
      dirty[it.seq] = false
      it.status = sent.trim() ? 'answered' : 'pending'   // 后端同口径回写，本地即时反映
      ansState.value[it.seq] = 'saved'
      setTimeout(() => { if (ansState.value[it.seq] === 'saved') delete ansState.value[it.seq] }, 2500)
    }
  } catch (e) {
    delete ansState.value[it.seq]
    emit('toast', '保存失败：' + e.message, 'err')
  } finally {
    savingSeqs.delete(it.seq)
  }
}

// ===== v2.2 处置通道（DESIGN-v2.2 D21）：驳回/挂起 + 重开 =====
const disposeDlg = ref(null)   // { seq, status, note } —— 理由弹窗状态
const disposeEl = ref(null)    // U-11：焦点圈定 + Esc
useModalFocus(computed(() => !!disposeDlg.value), disposeEl, () => { disposeDlg.value = null })

function askDispose(it, status) {
  disposeDlg.value = { seq: it.seq, status, note: '', title: status === 'rejected' ? '驳回问题（认定不是问题，不进标准文档定稿）' : '挂起问题（转入遗留假设，本期不处理）', required: status === 'rejected' }
}

async function confirmDispose() {
  const dlg = disposeDlg.value
  if (!dlg) return
  if (dlg.required && !dlg.note.trim()) { emit('toast', '驳回必须填写理由', 'err'); return }
  try {
    // 处置 PUT 进 per-seq 发送链（§2.3 互斥条款 ③）：防弹窗确认与在途作答 PUT 后到者胜——
    // set_disposition 是 answer/status/note 三元组整行覆写
    await enqueuePut(dlg.seq, () => ({ status: dlg.status, note: dlg.note.trim() }))
    const it = props.items.find(i => i.seq === dlg.seq)
    const wasPending = it ? isPending(it) : false
    if (it) { it.status = dlg.status; it.note = dlg.note.trim() }
    disposeDlg.value = null
    emit('toast', `已${dlg.status === 'rejected' ? '驳回' : '挂起'}：${dlg.seq}`)
    afterDisposed(dlg.seq, wasPending)
  } catch (e) {
    emit('toast', '处置失败：' + e.message, 'err')
  }
}

/** 重开：驳回/挂起/已答行转回待确认（后端保留已填 answer——PUT body 空串即回填语义）；选项卡清
 *  picked/extra，草稿重置 = 赋新种子值（非删键——删键会让下次访问懒播种读旧快照）+ 本地
 *  it.answer/answerText 清空（「重新作答 = 清空重选，不预选」，r4#11） */
async function reopen(it) {
  try {
    await enqueuePut(it.seq, () => ({ answer: it.answer || '', status: 'pending' }))
    it.status = 'pending'
    it.note = ''
    it.answer = ''
    it.answerText = ''
    delete picked[it.seq]
    delete extra[it.seq]
    drafts[it.seq] = ''
    originAnswers.value[it.seq] = ''
    dirty[it.seq] = false
    emit('toast', `已重开 ${it.seq}，可继续作答`)
  } catch (e) {
    emit('toast', '重开失败：' + e.message, 'err')
  }
}
</script>

<template>
  <!-- 空态（§1.2 r2 C3）：左 EmptyState + 右原文侧栏照常渲染（右栏不依赖产物数据——
      PM 建卡后等产物期间可读原文；无块结构 doc 时随 no-ctx 单栏降级） -->
  <div v-if="!items.length && !audit" class="wb-grid" :class="{ 'no-ctx': !hasDoc || ctxCollapsed }" :style="gridStyle">
    <div class="q-col">
      <EmptyState icon="inbox" title="质检产物尚未推送"
                  desc="推送后此处为澄清工作台（问题作答 + 原文上下文）" />
    </div>
    <div class="ctx-col" v-if="hasDoc && !ctxCollapsed">
      <div class="ctx-resizer" title="拖动调整宽度（320-760px）" @mousedown="startDrag"></div>
      <CtxPane ref="ctxRef" :req-id="reqId" :doc="doc" :snapshot="snapshot"
               :pending-by-block="pendingByBlock" :comments="comments" :block-text="blockText"
               @clarify="locateCheck" @collapse="ctxCollapsed = true"
               @locate="(s, a) => emit('locate', s, a)" @open-origin="emit('open-origin')"
               @open-comments="cid => emit('open-comment', cid)" />
    </div>
    <button class="ctx-restore" v-if="hasDoc && ctxCollapsed" @click="ctxCollapsed = false">‹ 展开原文上下文</button>
  </div>
  <template v-else>
    <!-- v5 工作台顶条（§2.1/§2.2）：就绪度覆盖地图（维度条，v1.6 layer 产出后点亮）+ 澄清进度 -->
    <div class="wb-top" ref="wbTopEl" :class="{ duo: hasLayers }" v-if="status === 'clarifying' || status === 'changed'">
      <div class="readiness" v-if="hasLayers">
        <h3>需求就绪度 <span class="sub">按缺陷维度看缺口，点维度过滤下方问题</span></h3>
        <div class="rdy-body">
          <div class="rdy-score">
            <div class="n">{{ rdyPct }}%</div>
            <div class="l">就绪度</div>
          </div>
          <div class="dims">
            <button v-for="d in layerStats" :key="d.key" class="dim" :class="{ on: dimFilter === d.key }"
                    :title="(d.layer ? layerFull(d.layer) : '未携带分层（v1.6 前存量）') + '｜点击过滤'"
                    @click="dimFilter = dimFilter === d.key ? '' : d.key">
              <span class="dim-name" v-if="d.layer"><span class="ln">L{{ d.layer }}</span>{{ layerShort(d.layer) }}</span>
              <span class="dim-name" v-else>未分类</span>
              <span class="dim-bar"><span class="dim-fill" :style="{ width: (d.total ? Math.round(d.done / d.total * 100) : 0) + '%' }"></span></span>
              <span class="dim-cnt"><template v-if="d.total - d.done"><b>{{ d.total - d.done }}</b> 待澄清</template><template v-else><span class="ok">✓ 澄清完成</span></template></span>
            </button>
          </div>
        </div>
      </div>
      <div class="wb-prog" :class="{ amber: status === 'changed' }">
        <div class="row1">
          <span class="lbl" title="逐题作答（点选即保存）；不是问题可驳回，本期不处理可挂起">
            <AppIcon name="info" :size="13" />
            <b class="ttl">{{ status === 'changed' ? '变更重开项重新处置' : '澄清进度' }}</b>
            <span class="hint">逐题作答 · 点选即保存</span>
          </span>
          <span class="n"><b>{{ answered }}</b><span class="tot">/{{ totalQ }}</span></span>
        </div>
        <div class="bar"><div class="bar-fill" :style="{ width: prog + '%' }"></div></div>
        <div class="btns">
          <button class="btn small primary" v-if="hasPendingVisible" @click="jumpNextUnanswered">
            <AppIcon name="arrow-up-right" :size="11" />跳到下一待处置</button>
          <button class="btn small" :class="{ on: clfFilter !== 'all' }" @click="clfFilter = clfFilter === 'all' ? 'pending' : (clfFilter === 'pending' ? 'done' : 'all')">
            {{ clfFilter === 'all' ? '只看待处置' : (clfFilter === 'pending' ? '只看已处置' : '显示全部') }}</button>
          <span class="sub" v-if="allAnswered"><AppIcon name="check-circle" :size="12" style="color:var(--green)" />全部处置完成，可生成标准文档</span>
        </div>
        <!-- v5.4 作答流开关（与吸顶细条同一状态） -->
        <div class="wb-sw">
          <label class="sw"><input type="checkbox" v-model="autoNext" />答完自动下一题</label>
          <label class="sw"><input type="checkbox" v-model="autoCollapse" />答完自动收起</label>
        </div>
      </div>
    </div>
    <div class="banner" v-if="status === 'published'">
      <AppIcon name="check-circle" :size="14" style="color:var(--green)" />
      <span>澄清已闭环：全部问题已答复，标准需求文档已发布。</span>
    </div>

    <div class="grp-tools" v-if="groups.length">
      <span class="sub">点组名展开 / 收起</span>
      <button class="btn small link" @click="expandAll(groups)">全部展开</button>
      <button class="btn small link" @click="collapseAll()">全部收起</button>
    </div>

    <!-- v5 双栏（§2.1）：左问题流 + 右原文上下文侧栏（可拖宽 320-760 / 可收起；无块结构单栏降级） -->
    <div class="wb-grid" :class="{ 'no-ctx': !hasDoc || ctxCollapsed }" :style="gridStyle">
    <div class="q-col" ref="qcol">
    <!-- v5.4 吸顶细条：零高 sticky 壳 + 绝对定位条（显隐不改文档流高度——v-if 插入 40px 会让滚动中内容整体下跳） -->
    <div class="wb-mini-wrap" v-if="editable">
      <div class="wb-mini" :class="{ on: showMini }" :aria-hidden="!showMini">
        <span class="n"><b>{{ answered }}</b>/{{ totalQ }}</span>
        <span class="bar"><span class="bar-fill" :style="{ width: prog + '%' }"></span></span>
        <button class="btn small primary" v-if="hasPendingVisible" :tabindex="showMini ? 0 : -1" @click="jumpNextUnanswered">
          <AppIcon name="arrow-up-right" :size="11" />下一待处置</button>
        <span class="sub" v-else-if="allAnswered"><AppIcon name="check-circle" :size="12" style="color:var(--green)" />全部处置完成</span>
        <label class="sw"><input type="checkbox" v-model="autoNext" :tabindex="showMini ? 0 : -1" />自动下一题</label>
        <label class="sw"><input type="checkbox" v-model="autoCollapse" :tabindex="showMini ? 0 : -1" />自动收起</label>
      </div>
    </div>
    <!-- 左栏问题流：check 组（v5.3 章节分组：title=节名，name=锚键；组内顶部挂同节已定论子折叠块） -->
    <div class="grp" v-for="g in visibleCheckGroups" :key="g.name" :class="{ closed: !openGrps.has(g.name) }">
      <div class="grp-t" @click="toggleGrp(g.name)">
        <AppIcon name="chevron-right" :size="13" class="grp-chev" />{{ g.title || g.name }}
        <span class="cnt">{{ !g.items.length
          ? `0 题 · 已定论 ${concludedByRaw[g.name].items.length} 条`   // #7：空组存活当且仅当有已定论块——直取安全
          : clfFilter !== 'all'
          ? `${g.items.length} 题（${clfFilter === 'pending' ? '待处置' : '已处置'}）`
          : `${g.items.length} 题 · 已处置 ${answeredIn(g.items)}/${g.items.length}` }}</span>
      </div>
      <div class="grp-body"><div class="grp-inner">
      <!-- 已定论子折叠块（体检 ✅ 项只读卡；独立折叠键不与父组联动） -->
      <div v-if="concludedByRaw[g.name]" class="concluded-blk" :class="{ closed: !openGrps.has(concludedByRaw[g.name].name) }">
        <button class="concluded-t" @click="toggleGrp(concludedByRaw[g.name].name)">
          <AppIcon name="chevron-right" :size="12" class="grp-chev" />
          <AppIcon name="check-circle" :size="12" style="color:var(--green)" />已定论（体检 ✅ 项，只读）<span class="cnt">{{ concludedByRaw[g.name].items.length }} 条</span>
        </button>
        <div class="concluded-body">
          <div v-for="a in concludedByRaw[g.name].items" :key="a.id" class="check-item done" :class="a.level" :data-pid="pidOf(a.id)">
            <div class="ci-head">
              <span class="badge" :class="lvlCls[a.level]">{{ lvlLabel[a.level] }}</span>
              <span class="chip">{{ pidOf(a.id) }}</span>
              <span class="jump-link" title="体检报告已定论条目（未生成澄清题）">来自体检.{{ pidOf(a.id) }}</span>
            </div>
            <div class="q">{{ a.title }}</div>
            <div class="ctx" v-if="a.where || a.quote">出处：<a v-if="a.where" class="cite" :class="{ anchored: a.anchor }" @click="locateInCtx(a)">{{ a.where }}<span v-if="isCmtAnchor(a.anchor)" class="anchored-mark" title="出处为评论区——点击在评论面板查看"><AppIcon name="message-square" :size="10" /></span><span v-else-if="a.anchor" class="anchored-mark" title="块级锚点：点击直达原文条款"><AppIcon name="crosshair" :size="10" /></span></a><a v-if="a.quote" class="cite loc-snap" :class="{ anchored: a.anchor }" :title="'原文摘引：' + a.quote" @click="locateInCtx(a)">在快照中定位<span v-if="isCmtAnchor(a.anchor)" class="anchored-mark"><AppIcon name="message-square" :size="10" /></span><span v-else-if="a.anchor" class="anchored-mark"><AppIcon name="crosshair" :size="10" /></span></a> ｜ 去向：{{ a.go || '—' }}</div>
            <div class="ctx" v-if="(a.relatedCases || []).length" style="margin-top:6px">
              关联用例：<a class="chip linklike real" v-for="c in a.relatedCases" :key="c" @click="emit('jump', { kind: 'case', id: c })">{{ c }}</a>
            </div>
          </div>
        </div>
      </div>

      <div v-for="it in g.items" :key="it.seq" class="check-item" :class="[it.level, { active: activeSeq === it.seq, folded: isFolded(it) }]" :data-pid="it.seq" @click="activateExplicit(it)">
        <!-- v5.4 答完自动收起：已处置卡收成一行摘要，点击展开（展开后可直接改选项） -->
        <div v-if="isFolded(it)" class="ci-fold" :title="'点击展开 ' + it.seq" @click.stop="expandCard(it)">
          <AppIcon name="check-circle" :size="13" class="fold-ok" :class="{ muted: it.status !== 'answered' }" />
          <span class="chip">{{ it.seq }}</span>
          <span class="fold-st" :class="it.status">{{ dispLabel(it) }}</span>
          <span class="fold-q">{{ it.question }}</span>
          <span class="fold-a" v-if="foldText(it)">{{ foldText(it) }}</span>
          <AppIcon name="chevron-down" :size="13" class="fold-x" />
        </div>
        <template v-else>
        <div class="ci-head">
          <span class="badge" :class="lvlCls[it.level]">{{ lvlLabel[it.level] }}</span>
          <span class="chip">{{ it.seq }}</span>
          <!-- v4 origin 三族（§2/§6.3）：L 系来自评论升级（回链原讨论）；incremental 来自增量质检（变更后局部重检）；
               skill（体检报告）为默认来源——v5.4 不再标注（与编号重复且是不可点的假链接） -->
          <button class="jump-link" v-if="it.origin === 'local'"
                  title="由评论升级而来——点击在右栏查看原讨论（只读）" @click="openCmtFor(it, it.srcCommentId)">
            来自评论<span v-if="it.srcCommentId"> #{{ it.srcCommentId }}</span><AppIcon name="arrow-up-right" :size="11" /></button>
          <span class="origin-tag" v-else-if="it.origin === 'incremental'" title="增量质检产生（变更单确认后的局部重检），处置后可重新发布">增量质检</span>
          <button class="btn small link fold-back" v-if="editable && autoCollapse && isDone(it) && expanded[it.seq]"
                  @click.stop="delete expanded[it.seq]">收起</button>
          <!-- v1.6 缺陷分层（可选）：层名待三期 dimensions.md 契约对齐，一期先 L<n> 数字标签 -->
          <span class="lvl-tag sub" v-if="it.layer" title="缺陷分层（v1.6 可选字段）">L{{ it.layer }}</span>
          <!-- v5.3 章节分组后 theme 降为卡上标签（原需求域语义保留，不再组级呈现） -->
          <span class="theme-tag" v-if="it.theme" :title="'需求域：' + it.theme">{{ it.theme }}</span>
        </div>
        <div class="q">{{ it.question }}</div>
        <!-- v5.4 原文摘引块取消（右栏已常驻高亮同段原文）：「在快照中定位」并入出处行，摘引全文进悬停提示 -->
        <div class="ctx" v-if="it.ctx || it.quote">出处：<a v-if="it.ctx" class="cite" :class="{ anchored: it.anchor }" @click="locateInCtx(it)">{{ it.ctx }}<span v-if="isCmtAnchor(it.anchor)" class="anchored-mark" title="出处为评论区——点击在评论面板查看"><AppIcon name="message-square" :size="10" /></span><span v-else-if="it.anchor" class="anchored-mark" title="块级锚点：点击直达原文条款"><AppIcon name="crosshair" :size="10" /></span></a><a v-if="it.quote" class="cite loc-snap" :class="{ anchored: it.anchor }" :title="'原文摘引：' + it.quote" @click="locateInCtx(it)">在快照中定位<span v-if="isCmtAnchor(it.anchor)" class="anchored-mark"><AppIcon name="message-square" :size="10" /></span><span v-else-if="it.anchor" class="anchored-mark"><AppIcon name="crosshair" :size="10" /></span></a></div>
        <!-- 原稿附图（v1.7 figs）：质检 AI 标注的相关图块——缩略图平铺，点开灯箱 -->
        <div class="q-pics" v-if="picsBySeq[it.seq]?.length">
          <div class="q-pic" v-for="(p, pi) in picsBySeq[it.seq]" :key="p.id">
            <button class="thumb" :title="'点击放大查看 · ' + p.caption"
                    @click.stop="openPic(picsBySeq[it.seq], pi)">
              <img :src="p.url" :alt="p.caption" loading="lazy" />
            </button>
            <a class="cap" :title="p.caption + ' · 在原文中定位'" @click.stop="locatePic(p, it)">{{ p.caption }}</a>
          </div>
        </div>
        <!-- 影响分析折叠（audit 字段归宿 §1.2）：去向 + 关联用例，默认收起 -->
        <details class="impact" v-if="impactOf(it.seq) && (impactOf(it.seq).go || impactOf(it.seq).relatedCases.length)">
          <summary><AppIcon name="git-branch" :size="11" />影响分析（去向 / 关联用例）</summary>
          <div class="impact-box">
            <div class="row" v-if="impactOf(it.seq).go"><span class="k">去向</span><span>{{ impactOf(it.seq).go }}</span></div>
            <div class="row" v-if="impactOf(it.seq).relatedCases.length"><span class="k">关联用例</span><span>
              <a class="chip linklike real" v-for="c in impactOf(it.seq).relatedCases" :key="c" @click="emit('jump', { kind: 'case', id: c })">{{ c }}</a></span></div>
          </div>
        </details>
        <div class="ans" v-if="status === 'published'">
          <span class="lb" :class="{ muted: it.status === 'rejected' }">{{ dispLabel(it) }}</span>
          <template v-if="it.status === 'rejected'">
            <span class="sub">{{ it.note || '（无理由记录）' }}</span>
          </template>
          <template v-else-if="it.status === 'deferred'">
            <span class="sub">转遗留假设{{ it.note ? '：' + it.note : '' }}</span>
          </template>
          <template v-else>{{ (it.answerText ?? it.answer) || '（未处置，按原需求执行）' }}</template>
        </div>
        <div class="ans" v-else-if="(status === 'clarifying' || status === 'changed') && (it.status === 'rejected' || it.status === 'deferred')">
          <span class="lb">{{ dispLabel(it) }}<span v-if="it.note" class="sub">（{{ it.note }}）</span></span>
          <span class="sub">
            {{ it.status === 'rejected' ? '已认定不是问题，不进定稿' : '已转遗留假设，合成时记入 需求.Axx' }}
            <button class="btn small link" @click="reopen(it)">重新作答</button>
          </span>
        </div>
        <!-- v5 选择题化作答（§2.3）：pending = 选项区（AI 推荐常显理由）；answered = 全文快照 + 重新作答
             （v5.4 改展开即改：全文匹配回显，仍不以 optionKey 回显，r4#11）；无 options 卡走下方 textarea 降级 -->
        <div class="ans optans" v-else-if="(status === 'clarifying' || status === 'changed') && (it.options || []).length">
          <!-- 变更确认重开的项：原答复在 note——PM 需看到再重新作答 -->
          <div class="sub" v-if="it.status === 'pending' && it.note" style="width:100%;margin:2px 0">{{ it.note }}</div>
          <!-- v5.4 展开即改：已答也渲染选项（全文匹配高亮当前答案），点其他选项直接覆盖保存；
               清空回待确认改为「清空重答」+ 二次确认（原「重新作答」静默清空） -->
          <div class="done-ans" v-if="it.status === 'answered'">
            <span class="lb">当前答复</span>
            <span class="txt">{{ foldText(it) || '（结构化答复）' }}</span>
            <span class="sub">点其他选项直接修改</span>
          </div>
            <div class="opts">
              <button v-for="o in it.options" :key="o.key" class="opt"
                      :class="{ rec: o.recommended, picked: curKey(it) === o.key }"
                      :disabled="!!disposeDlg" @click="pickOption(it, o.key)">
                <span class="radio"></span>
                <span class="body">
                  <span v-if="o.recommended" class="rec-tag">✦ AI 推荐</span>
                  <b>{{ o.key }} · {{ o.text }}</b>
                  <span class="why" v-if="o.why">{{ o.recommended ? '推荐理由：' : '' }}{{ o.why }}</span>
                </span>
              </button>
            </div>
            <div class="ans-ops">
              <button class="btn small link" title="认定不是问题：不进标准文档定稿" @click="askDispose(it, 'rejected')">驳回（不是问题）</button>
              <button class="btn small link" title="本期不处理：合成时转遗留假设" @click="askDispose(it, 'deferred')">挂起（转遗留假设）</button>
              <button class="more-answer" @click="toggleExtra(it)">{{ extraOpen[it.seq] ? '收起补充说明 ▴' : (it.status === 'answered' ? '修改补充说明 ▾' : '以上都不对，我要自己写 ▾') }}</button>
              <button class="btn small link redo" v-if="it.status === 'answered'" title="清空已存答复，回到待确认（二次确认）" @click="clearAnswer(it)">清空重答</button>
              <span class="saved" v-if="ansState[it.seq] === 'saved'"><AppIcon name="check-circle" :size="11" />已保存</span>
              <span class="saved" v-else-if="ansState[it.seq] === 'saving'" style="color:var(--muted)">保存中…</span>
            </div>
            <textarea v-if="extraOpen[it.seq]" v-model="extra[it.seq]" class="extra-ta"
                      :aria-label="it.seq + ' 补充说明'"
                      placeholder="补充说明：选「其他」时填写具体口径，将写入标准文档对应条款…"
                      @blur="saveExtra(it)" @input="autoGrow"></textarea>
        </div>
        <div class="ans" v-else-if="status === 'clarifying' || status === 'changed'">
          <!-- 标签判定读 draft（输入面）——it.answer 是存储态（二期可为 JSON），不反映输入现场 -->
          <span class="lb" :class="{ warn: !draftOf(it) }">{{ draftOf(it) ? '答复（可修改）' : '待答复' }}</span>
          <span class="saved" v-if="ansState[it.seq] === 'saved'"><AppIcon name="check-circle" :size="11" />已保存</span>
          <span class="saved" v-else-if="ansState[it.seq] === 'saving'" style="color:var(--muted)">保存中…</span>
          <!-- 变更确认重开的项：原答复在 note（「因变更单#N 重开，原答复：…」）——PM 需看到再重新作答 -->
          <div class="sub" v-if="it.status === 'pending' && it.note" style="width:100%;margin:2px 0">{{ it.note }}</div>
          <textarea :value="draftOf(it)" :name="'clf-answer-' + it.seq" :aria-label="it.seq + ' 作答'" :placeholder="'PM 在此作答…'"
            @blur="saveAnswer(it)" @input="e => { onDraftInput(it, e); autoGrow(e) }"></textarea>
          <div class="ans-ops">
            <button class="btn small link" title="认定不是问题：不进标准文档定稿" @click="askDispose(it, 'rejected')">驳回（不是问题）</button>
            <button class="btn small link" title="本期不处理：合成时转遗留假设" @click="askDispose(it, 'deferred')">挂起（转遗留假设）</button>
          </div>
        </div>
        <div class="ans" v-else><span class="lb warn">待答复</span></div>
        </template>
      </div>
      </div></div>
    </div>

    <!-- 无匹配 check 组的已定论条目 → 独立顶层组（组集分叉兜底，r2 A1） -->
    <div class="grp concluded-grp" v-for="g in standaloneConcluded" :key="g.name" :class="{ closed: !openGrps.has(g.name) }">
      <div class="grp-t" @click="toggleGrp(g.name)">
        <AppIcon name="chevron-right" :size="13" class="grp-chev" />
        <AppIcon name="check-circle" :size="12" style="color:var(--green)" />{{ g.title || g.raw || g.name }} · 已定论
        <span class="cnt">{{ g.items.length }} 条 · 体检 ✅ 项</span>
      </div>
      <div class="grp-body"><div class="grp-inner">
      <div v-for="a in g.items" :key="a.id" class="check-item done" :class="a.level" :data-pid="pidOf(a.id)">
        <div class="ci-head">
          <span class="badge" :class="lvlCls[a.level]">{{ lvlLabel[a.level] }}</span>
          <span class="chip">{{ pidOf(a.id) }}</span>
          <span class="jump-link" title="体检报告已定论条目（未生成澄清题）">来自体检.{{ pidOf(a.id) }}</span>
        </div>
        <div class="q">{{ a.title }}</div>
        <div class="ctx" v-if="a.where || a.quote">出处：<a v-if="a.where" class="cite" :class="{ anchored: a.anchor }" @click="locateInCtx(a)">{{ a.where }}<span v-if="isCmtAnchor(a.anchor)" class="anchored-mark" title="出处为评论区——点击在评论面板查看"><AppIcon name="message-square" :size="10" /></span><span v-else-if="a.anchor" class="anchored-mark" title="块级锚点：点击直达原文条款"><AppIcon name="crosshair" :size="10" /></span></a><a v-if="a.quote" class="cite loc-snap" :class="{ anchored: a.anchor }" :title="'原文摘引：' + a.quote" @click="locateInCtx(a)">在快照中定位<span v-if="isCmtAnchor(a.anchor)" class="anchored-mark"><AppIcon name="message-square" :size="10" /></span><span v-else-if="a.anchor" class="anchored-mark"><AppIcon name="crosshair" :size="10" /></span></a> ｜ 去向：{{ a.go || '—' }}</div>
        <div class="ctx" v-if="(a.relatedCases || []).length" style="margin-top:6px">
          关联用例：<a class="chip linklike real" v-for="c in a.relatedCases" :key="c" @click="emit('jump', { kind: 'case', id: c })">{{ c }}</a>
        </div>
      </div>
      </div></div>
    </div>

    </div><!-- /q-col -->

    <!-- 右栏：原文上下文（sticky 侧栏；resizer 在 wrapper 左缘） -->
    <div class="ctx-col" v-if="hasDoc && !ctxCollapsed">
      <div class="ctx-resizer" title="拖动调整宽度（320-760px）" @mousedown="startDrag"></div>
      <CtxPane ref="ctxRef" :req-id="reqId" :doc="doc" :snapshot="snapshot"
               :pending-by-block="pendingByBlock" :comments="comments" :block-text="blockText"
               @clarify="locateCheck" @collapse="ctxCollapsed = true"
               @locate="(s, a) => emit('locate', s, a)" @open-origin="emit('open-origin')"
               @open-comments="cid => emit('open-comment', cid)" />
    </div>
    </div><!-- /wb-grid -->
    <button class="ctx-restore" v-if="hasDoc && ctxCollapsed" @click="ctxCollapsed = false">‹ 展开原文上下文</button>

    <!-- 孤儿行提示（r3 二审#1：编号权威分叉疑似行——不渲染卡，引导查原文） -->
    <div class="banner amber-t" v-if="orphanCount">
      <AppIcon name="alert-triangle" :size="14" />
      <span style="flex:1">⚠ {{ orphanCount }} 条体检条目未关联澄清项且无定论标记（可能编号漂移）——点开下方体检报告原文核对。</span>
    </div>

    <!-- 页尾：体检报告 markdown 折叠（自 AuditTab 迁入；C7 展开后右栏目录——里层不加 .card 防卡中卡） -->
    <details class="card" v-if="audit?.markdown" @toggle="onAuditToggle">
      <summary style="cursor:pointer;font-size:13px;color:var(--muted)">查看体检报告原文（markdown）</summary>
      <div class="doc-layout" style="margin-top:10px">
        <div class="doc" ref="auditBox" v-html="render(audit.markdown)"></div>
        <TocPane :items="auditToc" :active-id="activeHead" @go="emit('go-toc', $event)" />
      </div>
    </details>

    <!-- v2.2 处置理由弹窗（DESIGN-v2.2 D21）：驳回必填 / 挂起可选 -->
    <div class="modal-mask" v-if="disposeDlg" @click.self="disposeDlg = null">
      <div ref="disposeEl" class="modal sm" role="dialog" aria-modal="true" tabindex="-1">
        <div class="modal-h">
          <b>{{ disposeDlg.title }}</b>
          <button class="x" @click="disposeDlg = null">✕</button>
        </div>
        <div class="modal-b">
          <div class="sub" style="margin-bottom:8px">{{ disposeDlg.seq }} · 理由{{ disposeDlg.required ? '（必填）' : '（可选）' }}——将随澄清记录流转，合成标准文档时知悉</div>
          <textarea v-model="disposeDlg.note" rows="3" style="width:100%" :placeholder="disposeDlg.required ? '例如：原文已在其他条款明确，不构成缺口' : '例如：待下期原型确认后再处理'"></textarea>
        </div>
        <div class="modal-f">
          <button class="btn" @click="disposeDlg = null">取消</button>
          <button class="btn primary" @click="confirmDispose">确认{{ disposeDlg.status === 'rejected' ? '驳回' : '挂起' }}</button>
        </div>
      </div>
    </div>
  </template>

  <!-- P1-13：<1200px 右栏为抽屉——点遮罩收起（桌面端 CSS 隐藏） -->
  <button class="ctx-backdrop" v-if="hasDoc && !ctxCollapsed" @click="ctxCollapsed = true"
          aria-label="关闭原文上下文"></button>

  <!-- 原稿附图灯箱（图源=问题卡关联图集；Teleport 至 body，z-index 不受布局影响） -->
  <ImgViewer v-if="picViewer.idx >= 0" :list="picViewer.list" v-model:index="picViewer.idx"
             @close="picViewer.idx = -1" />
</template>

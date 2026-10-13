<script setup>
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { api } from '../api.js'
import DocBlock from './DocBlock.vue'
import AppIcon from './AppIcon.vue'
import ClampText from './ClampText.vue'
import ChipList from './ChipList.vue'
import EmptyState from './EmptyState.vue'
import TaskPanel from './TaskPanel.vue'
import TocPane from './TocPane.vue'
import CaseList from './CaseList.vue'
import DesignTab from './DesignTab.vue'
import GateTab from './GateTab.vue'
import { render, linkifyRefs } from '../render.js'
import { fmtRel } from '../time.js'
import { nextActionCta } from '../lifecycle.js'
import {
  pendingJump, jumpTo, consumeJump, settle, flashEl, flashNeedle,
  groupItems, groupByFirstAppearance, firstQuote, covP, needlesFor
} from '../trace.js'
import { isDone, isPending, dispLabel } from '../disposition.js'

const props = defineProps({ reqId: String })
const emit = defineEmits(['back', 'toast', 'loaded'])

const d = ref(null)
const tab = ref('origin')
const digestMdOpen = ref(false)          // digest 原文折叠（假设引用跳入时自动展开）
const snapshotBox = ref(null)            // 快照渲染容器（needle 定位）
const digestMdBox = ref(null)            // digest 原文容器（假设定位）
const loading = ref(true)
const error = ref('')

const statusLabel = { submitted: '已提交', reviewing: '质检中', clarifying: '待澄清', published: '已发布' }
const statusCls = { submitted: 'b-gray', reviewing: 'b-blue', clarifying: 'b-amber', published: 'b-green' }
// v1.3 风险分级徽章（DESIGN-v2.2 D19）：空=未分级不渲染
const tierLabel = { A: 'A级', B: 'B级', C: 'C级' }
const tierCls = { A: 'b-red', B: 'b-amber', C: 'b-gray' }
const tierTip = { A: '风险分级 A：按失败后果缩放验证深度——全管线（体检全维度/评审全扇出）', B: '风险分级 B：轻量管线（裁剪体检路由与评审扇出）', C: '风险分级 C：最轻管线（仅纯展示/文案类改动）' }
const lvlLabel = { red: '阻断', yellow: '存疑', blue: '建议' }
const lvlCls = { red: 'b-red', yellow: 'b-amber', blue: 'b-blue' }

const answered = computed(() => (d.value?.items || []).filter(isDone).length)
const totalQ = computed(() => (d.value?.items || []).length)
const prog = computed(() => totalQ.value ? Math.round(answered.value / totalQ.value * 100) : 0)
const card = computed(() => d.value?.card || {})
const allAnswered = computed(() => totalQ.value > 0 && answered.value === totalQ.value)
const domains = computed(() => d.value?.domains || [])

const auditGroups = computed(() => groupItems(d.value?.audit?.content?.items || [], 'group', domains.value))
const checklistGroups = computed(() => groupItems(d.value?.items || [], 'theme', domains.value))
const frGroups = computed(() => groupByFirstAppearance(d.value?.frPoints || [], 'group'))
const snapshotHtml = computed(() => render(d.value?.snapshot?.md))
const digestMdHtml = computed(() => render(d.value?.digest?.markdown))
const stdHtml = computed(() => (d.value?.standard ? linkifyRefs(render(d.value.standard.markdown)) : ''))

// ===== v1.2 原文块结构（doc）：结构化渲染 + 锚点直达 =====
const docData = computed(() => d.value?.doc?.content || null)
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
const commentByRef = computed(() => {
  const m = {}
  for (const b of docBlocks.value) if (b.type === 'comment') m[b.ref] = b
  return m
})
// v2.2 目录纳入 table-row 行卡片（巨表文档主体在行级，heading 导航不到）；排除版本号形态 rowLabel（修订记录行）
const docToc = computed(() => docBlocks.value
  .filter(b => b.type === 'heading' || b.type === 'title'
    || (b.type === 'table-row' && !/^\d+(\.\d+)+$/.test(String(b.rowLabel || ''))))
  .map(b => ({
    id: b.id,
    level: b.type === 'table-row' ? 3 : (b.level || 1),
    text: b.type === 'table-row' ? (b.rowLabel || '') : (b.text || '')
  })))
const tocOpen = ref(false)

// ===== v2.2 体验优化：分组折叠（默认全收，组头带统计徽标） + 长文右侧目录 + 回顶 =====
// openGrps 跨 audit/checklist/fr 三个分组列表共用（组名同源 domains，不冲突）
const openGrps = reactive(new Set())   // Vue3 对 Set 的 add/delete/clear 均响应式
function toggleGrp(name) { openGrps.has(name) ? openGrps.delete(name) : openGrps.add(name) }
function expandAll(lists) { for (const g of lists) openGrps.add(g.name) }
function collapseAll() { openGrps.clear() }

/** 跳转目标所在组自动展开（折叠不能吞掉 flash 定位协议） */
function revealGrpFor(kind, id) {
  const lists = kind === 'fr' ? frGroups.value : (kind === 'audit' ? auditGroups.value : checklistGroups.value)
  for (const g of lists) {
    const hit = kind === 'fr'
      ? g.items.some(x => x.id === id)
      : g.items.some(x => pidOf(x.id) === id || x.seq === id)
    if (hit) { openGrps.add(g.name); return }
  }
}

// ===== v2.3 流程/状态机上摘要（DESIGN-v2.3，payload v1.4）：flows 单表、states 按对象分组 =====
// 组名加「状态机·」前缀：openGrps 与 audit/checklist/fr 共享，防与 domains 组名撞名联动展开
const digestFlows = computed(() => d.value?.digest?.content?.flows || [])
const digestStates = computed(() => d.value?.digest?.content?.states || [])
const stateGroups = computed(() => groupByFirstAppearance(
  digestStates.value.map(s => ({ ...s, group: '状态机·' + (s.obj || '未命名') })), 'group'))

/** 组头副标题：澄清组带已答进度，体检组带红黄蓝点（模板内联） */
function answeredIn(items) { return (items || []).filter(isDone).length }

// ===== 澄清导航（评测 P1-2；v2.2 D21 三态筛选：全部/待处置/已处置）=====
const clfFilter = ref('all')   // 'all' | 'pending' | 'done'
const visibleCheckGroups = computed(() => {
  if (clfFilter.value === 'all') return checklistGroups.value
  const pred = clfFilter.value === 'pending' ? isPending : isDone
  return checklistGroups.value
    .map(g => ({ name: g.name, items: g.items.filter(pred) }))
    .filter(g => g.items.length)
})
const nextUnanswered = computed(() => (d.value?.items || []).find(isPending) || null)
watch(clfFilter, on => { if (on !== 'all') expandAll(checklistGroups.value) })   // 过滤视图下组不再折叠，待处置项直接可见
function jumpNextUnanswered() {
  const it = nextUnanswered.value
  if (!it) return
  revealGrpFor('check', it.seq)   // 目标组在折叠列表内 → 先展开（跳转协议不因折叠失效）
  nextTick(() => {
    const el = document.querySelector(`[data-pid="${it.seq}"]`)
    if (!el) return
    flashEl(el)
    el.querySelector('textarea')?.focus()
  })
}

// 标准文档目录：渲染后从 DOM 抽 h2/h3（marked 未产 id 时兜底补）
const stdToc = ref([])
const stdBox = ref(null)
watch([stdHtml, tab], async () => {
  if (tab.value !== 'std' || !stdHtml.value) { stdToc.value = []; return }
  await settle(60)
  const box = stdBox.value
  if (!box) return
  const hs = [...box.querySelectorAll('h2, h3')]
  hs.forEach((h, i) => { if (!h.id) h.id = 'stdh-' + i })
  stdToc.value = hs.map(h => ({ id: h.id, level: h.tagName === 'H2' ? 1 : 2, text: h.textContent.trim().slice(0, 46) }))
})

/** 目录点击 → 滚动定位 + flash（origin 复用块锚 locate；std 直接 flashEl）
 *  点击即锁定高亮为目标：定位落点可能进不了滚动阈值窗（文档尾滚不到顶 / center 落点临界），
 *  锁定窗口与 flash 2.2s 对齐，期间 onScroll 不重算 */
let tocLockUntil = 0
async function goToc(id) {
  tocLockUntil = Date.now() + 2500
  activeHead.value = id
  if (tab.value === 'origin') { await locate('', id); return }
  flashEl(document.getElementById(id))
}

/** 滚动高亮当前目录项 + 回顶按钮显隐（rAF 节流） */
const activeHead = ref('')
const showTop = ref(false)
let scrollTick = false
function headElsNow() {
  if (tab.value === 'std') return stdBox.value ? [...stdBox.value.querySelectorAll('h2[id],h3[id]')] : []
  if (tab.value === 'origin') {
    return docToc.value.map(h => document.querySelector(`[data-blk="${h.id}"]`)).filter(Boolean)
  }
  return []
}
function onScroll() {
  if (scrollTick) return
  scrollTick = true
  requestAnimationFrame(() => {
    scrollTick = false
    if (Date.now() < tocLockUntil) return        // 目录点击后的定位滚动：高亮已锁定为目标，不重算
    showTop.value = window.scrollY > 640
    const els = headElsNow()
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

// 标准文档引用链接化 linkifyRefs / markdown 渲染 render 共享自 ../render.js

/** v1.2：原文出处路径（详述N[.N.*]）→ 原文块锚。行号定位表行，小节号/文本匹配行内条款；未命中返回 null */
function resolveDocPath(path) {
  const m = String(path || '').match(/详述(\d+)(?:\.(\d+(?:\.\d+)*))?(?:·([^，。；）)\s]+))?/)
  if (!m) return null
  const rowNum = m[1]
  const sub = m[2] || ''
  const tail = m[3] || ''
  const rows = docBlocks.value.filter(b => b.type === 'table-row' && String(b.rowLabel || '') === rowNum)
  const row = rows.length ? rows[rows.length - 1] : null
  if (!row) return null
  if (!sub && !tail) return row
  const walk = (pid) => {
    for (const c of childrenByParent.value[pid] || []) {
      if (c.type === 'list-item') {
        if (sub && (c.ordinal === sub || c.ordinal?.endsWith('.' + sub))) return c
        if (!sub && tail && (c.text || '').includes(tail.slice(0, 10))) return c
      }
      const hit = walk(c.id)
      if (hit) return hit
    }
    return null
  }
  const hit = walk(row.id)
  if (hit) return hit
  if (tail) {
    const byText = (childrenByParent.value[row.id] || []).find(c => (c.text || '').includes(tail.slice(0, 6)))
    if (byText) return byText
  }
  const firstSeg = sub.split('.')[0]
  return (childrenByParent.value[row.id] || []).find(
    c => (c.text || '').includes(firstSeg)) || row
}

function pidOf(id) { return String(id || '').replace('体检.', '') }
function cnt(items, level) { return (items || []).filter(it => it.level === level).length }

const TABS = ['origin', 'digest', 'audit', 'checklist', 'std', 'cases', 'design', 'gate']

async function load() {
  loading.value = true
  error.value = ''
  try {
    // 操作后刷新（design/gate tab 内 emit refresh）保留当前 tab，不把用户踢回默认页
    const prevTab = d.value ? tab.value : ''
    d.value = await api.get('/api/requirements/' + props.reqId)
    const def = card.value.status === 'submitted' ? 'origin' : (card.value.status === 'published' ? 'std' : 'checklist')
    tab.value = TABS.includes(prevTab) ? prevTab : def
    emit('loaded', card.value.name)
    await loadExt()      // v2.4：设计/门禁读面（发布后），主按钮 CTA 与新 tab 的数据源
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

// ===== v2.4 设计/门禁域（DESIGN-v2.4 D34/D35）：工作台统一取数，tab 组件只消费 view + emit refresh =====
const dv = ref(null)
const gv = ref(null)
const operator = ref(localStorage.getItem('sdlc.op') || '')
watch(operator, v => localStorage.setItem('sdlc.op', v || ''))

async function loadExt() {
  if (card.value.status !== 'published') { dv.value = null; gv.value = null; return }
  const [a, b] = await Promise.all([
    api.get(`/api/requirements/${props.reqId}/design`).catch(() => null),
    api.get(`/api/requirements/${props.reqId}/gate`).catch(() => null)
  ])
  dv.value = a
  gv.value = b
}

// 全链主按钮（demo nextAction 口径）：提交→…→放行→r2 无空窗；动作失败诚实 toast 不吞
const cta = computed(() => nextActionCta(d.value, dv.value, gv.value))
async function runCta() {
  const c = cta.value
  if (!c || c.disabled) return
  const base = `/api/requirements/${props.reqId}`
  try {
    if (c.go === 'design:gen') {
      await api.post(`${base}/tasks`, { type: 'design_gen', note: '技术设计生成（主按钮）' })
      emit('toast', 'design_gen 任务已排队'); tab.value = 'design'
    } else if (c.go === 'design:skip') {
      await api.post(`${base}/design/skip`, { by: operator.value })
      emit('toast', '已声明轻量跳过（自查档）'); tab.value = 'design'
    } else if (c.go === 'gate:open') {
      await api.post(`${base}/gate/open`, { by: operator.value })
      emit('toast', '已开闸（三条件全绿），评审任务排队中'); tab.value = 'gate'
    } else if (c.go === 'gate:ingest') {
      await api.post(`${base}/gate/rounds/${gv.value.round.id}/ingest`, { by: operator.value })
      emit('toast', '评审汇总已入库，进入裁决'); tab.value = 'gate'
    } else if (c.go === 'gate:release') {
      const r = await api.post(`/api/gate/rounds/${gv.value.round.id}/release`, { by: operator.value })
      emit('toast', `已放行 r${r.roundNo}（关卡互认 ${r.casesConfirmed} 条草稿用例置已定稿）`); tab.value = 'gate'
    } else if (c.go === 'gate:reopen') {
      await api.post(`${base}/gate/reopen`, { by: operator.value })
      emit('toast', '已开复审轮（旧轮只读归档）'); tab.value = 'gate'
    } else if (c.go.startsWith('tab:')) {
      tab.value = c.go.slice(4)
      return
    }
    await load()
  } catch (e) { emit('toast', e.message, 'err') }
}

onMounted(async () => {
  await load()
  applyJump()          // 跨页跳入：数据就绪后应用 pending 跳转
})

// ===== 答复：失焦自动保存 + 行内微状态（保存中/已保存） =====
const originAnswers = ref({})   // seq → 载入时的答复快照，未变更不重复保存
const ansState = ref({})        // seq → 'saving' | 'saved'

function autoGrow(e) {
  const el = e.target
  el.style.height = 'auto'
  el.style.height = el.scrollHeight + 'px'
}

async function saveAnswer(it) {
  if ((it.answer || '') === (originAnswers.value[it.seq] ?? '')) return
  ansState.value[it.seq] = 'saving'
  try {
    await api.put(`/api/requirements/${props.reqId}/answers/${it.seq}`, { answer: it.answer })
    originAnswers.value[it.seq] = it.answer
    it.status = it.answer.trim() ? 'answered' : 'pending'   // 后端同口径回写，本地即时反映（D21）
    ansState.value[it.seq] = 'saved'
    setTimeout(() => { if (ansState.value[it.seq] === 'saved') delete ansState.value[it.seq] }, 2500)
  } catch (e) {
    delete ansState.value[it.seq]
    emit('toast', '保存失败：' + e.message, 'err')
  }
}

// ===== v2.2 处置通道（DESIGN-v2.2 D21）：驳回/挂起 + 重开 =====
const disposeDlg = ref(null)   // { seq, status, note } —— 理由弹窗状态

function askDispose(it, status) {
  disposeDlg.value = { seq: it.seq, status, note: '', title: status === 'rejected' ? '驳回问题（认定不是问题，不进标准文档定稿）' : '挂起问题（转入遗留假设，本期不处理）', required: status === 'rejected' }
}

async function confirmDispose() {
  const dlg = disposeDlg.value
  if (!dlg) return
  if (dlg.required && !dlg.note.trim()) { emit('toast', '驳回必须填写理由', 'err'); return }
  try {
    await api.put(`/api/requirements/${props.reqId}/answers/${dlg.seq}`, { status: dlg.status, note: dlg.note.trim() })
    const it = (d.value?.items || []).find(i => i.seq === dlg.seq)
    if (it) { it.status = dlg.status; it.note = dlg.note.trim() }
    disposeDlg.value = null
    emit('toast', `已${dlg.status === 'rejected' ? '驳回' : '挂起'}：${dlg.seq}`)
  } catch (e) {
    emit('toast', '处置失败：' + e.message, 'err')
  }
}

/** 重开：驳回/挂起行转回待确认（后端保留已填 answer），随后正常作答即转 answered */
async function reopen(it) {
  try {
    await api.put(`/api/requirements/${props.reqId}/answers/${it.seq}`, { answer: it.answer || '', status: 'pending' })
    it.status = 'pending'
    it.note = ''
    emit('toast', `已重开 ${it.seq}，可继续作答`)
  } catch (e) {
    emit('toast', '重开失败：' + e.message, 'err')
  }
}

// ===== 追溯跳转（需求域侧的发起与消费） =====

function jumpAudit(pid) { jumpTo({ page: 'reqs', reqId: props.reqId, kind: 'audit', id: pid }) }
function jumpClarify(seq) { jumpTo({ page: 'reqs', reqId: props.reqId, kind: 'check', id: seq }) }
function jumpCase(caseId) { jumpTo({ page: 'cases', reqId: props.reqId, kind: 'case', id: caseId }) }

/**
 * 出处 → 原文定位：v1.2 优先块锚点（anchor=飞书块 ID，按 data-blk 直达），
 * 回退 needle 文本匹配（原文 → 详述N.N → N.N），全失诚实提示。
 */
async function locate(src, anchor) {
  tab.value = 'origin'
  await settle()
  if (anchor) {
    const el = document.querySelector(`[data-blk="${anchor}"]`)
    if (el && flashEl(el)) return
  }
  const needles = needlesFor(src)
  if (!needles.length) { emit('toast', '该条无可定位的原文片段', 'err'); return }
  for (const nd of needles) {
    if (await flashNeedle(snapshotBox.value, nd)) return
  }
  emit('toast', `当前快照未包含「${needles[0]}」；该出处可能位于快照未收录的段落`, 'err')
}

/** 消费本需求的跳转：切 tab → 滚动 → 闪烁 */
async function applyJump() {
  const j = pendingJump
  if (!j.nonce || j.page !== 'reqs' || j.reqId !== props.reqId) return
  consumeJump()
  const miss = () => emit('toast', `未定位到目标「${j.id || j.needle}」：可能尚未推送或编号不存在`, 'err')
  if (j.kind === 'fr') {
    tab.value = 'digest'
    revealGrpFor('fr', j.id)          // 目标组在折叠列表内 → 先展开再定位（协议不因折叠失效）
    await settle()
    if (!flashEl(document.querySelector(`[data-frid="${j.id}"]`))) miss()
  } else if (j.kind === 'audit') {
    tab.value = 'audit'
    revealGrpFor('audit', j.id)
    await settle()
    if (!flashEl(document.querySelector(`[data-pid="${j.id}"]`))) miss()
  } else if (j.kind === 'check') {
    tab.value = 'checklist'
    revealGrpFor('check', j.id)
    await settle()
    if (!flashEl(document.querySelector(`[data-pid="${j.id}"]`))) miss()
  } else if (j.kind === 'asm') {
    tab.value = 'digest'
    digestMdOpen.value = true
    await settle(150)
    if (!(await flashNeedle(digestMdBox.value, j.id))) miss()
  } else if (j.kind === 'needle') {
    tab.value = 'origin'
    await settle()
    if (!(await flashNeedle(snapshotBox.value, j.needle))) miss()
  }
}
watch(() => pendingJump.nonce, () => applyJump())

/** 标准文档引用点击（事件委托，D7 四类引用） */
function stdRefClick(e) {
  const el = e.target.closest('.reflink')
  if (!el) return
  const idx = el.dataset.ref.indexOf(':')
  const kind = el.dataset.ref.slice(0, idx)
  const id = el.dataset.ref.slice(idx + 1)
  if (kind === 'fr') jumpTo({ page: 'reqs', reqId: props.reqId, kind: 'fr', id })
  else if (kind === 'audit') jumpAudit(id)
  else if (kind === 'check') jumpClarify(id)
  else if (kind === 'asm') jumpTo({ page: 'reqs', reqId: props.reqId, kind: 'asm', id })
  else if (kind === 'src') locate(id, resolveDocPath(id)?.id)
  else if (kind === 'sec') {
    // § 章节引用（评测 P2-6）：文档内标题号定位（标题通常为「7.2 xxx」不带 §），未命中诚实提示
    const want = id.replace(/^§/, '').replace(/\s+/g, '')
    const h = [...(stdBox.value?.querySelectorAll('h2,h3') || [])]
      .find(x => x.textContent.replace(/\s+/g, '').startsWith(want))
    if (h) flashEl(h)
    else emit('toast', `未定位到章节 ${id}：标准文档中没有以此开头的标题`, 'err')
  }
}

/** 功能点地图行 → 关联需求点 chips（D3 双向索引） */
function frByModule(m) {
  const key = String(m || '').replace('⭐ ', '')
  return (d.value?.frPoints || []).filter(f => f.module === key)
}
</script>

<template>
  <!-- 单根包装（勿拆）：App.vue 的 Transition(out-in) 要求子组件单根——本组件原为三个条件根的 fragment，
       离场过渡窗口内组件被打断 re-render 时 transitionend 丢失，out-in 死锁 → 内容区永久白屏 -->
  <div>
  <!-- 加载失败 -->
  <EmptyState v-if="error" icon="alert-circle" tone="error" title="需求详情加载失败" :desc="error">
    <button class="btn" @click="load"><AppIcon name="refresh-cw" :size="13" />重试</button>
  </EmptyState>

  <!-- 加载骨架 -->
  <div v-else-if="!d">
    <div class="skel skel-line" style="width:42%;height:18px"></div>
    <div class="skel skel-line" style="width:64%"></div>
    <div class="skel skel-line" style="width:30%;margin-top:22px"></div>
    <div class="card" style="margin-top:10px">
      <div class="skel skel-line" style="width:92%" v-for="i in 7" :key="i"></div>
    </div>
  </div>

  <div v-else>
    <button class="btn link" @click="emit('back')"><AppIcon name="arrow-left" :size="13" />返回列表</button>
    <div class="detail-h">
      <h2>{{ card.name }}</h2>
      <span class="chip">{{ card.id }}</span>
      <span class="chip" v-if="card.iter">{{ card.iter }}</span>
      <span class="badge" :class="statusCls[card.status]">{{ statusLabel[card.status] }}</span>
      <span class="badge" v-if="tierLabel[card.riskTier]" :class="tierCls[card.riskTier]" :title="tierTip[card.riskTier]">{{ tierLabel[card.riskTier] }}</span>
      <span class="badge stars" v-if="d.quality"
            :title="'需求文档质量分：' + d.quality.basis + '。口径：★★★★★=无阻断无严重 / ★★★★=无阻断且严重≤5 / ★★★=阻断≤2 / ★★=阻断≤5 / ★=其余（建议档不计入）'">
        {{ '★'.repeat(d.quality.stars) }}{{ '☆'.repeat(5 - d.quality.stars) }}</span>
    </div>
    <div class="meta">
      <span><AppIcon name="external-link" :size="12" />来源：{{ card.sourceType === 'feishu' ? '飞书文档' : '粘贴文本' }}</span>
      <span v-if="card.submittedBy"><AppIcon name="user" :size="12" />{{ card.submittedBy }} · {{ fmtRel(card.createdAt) }}</span>
      <span v-if="card.syncedAt" :title="card.syncedAt"><AppIcon name="refresh-cw" :size="12" />同步 {{ fmtRel(card.syncedAt) }}</span>
      <span v-if="card.status === 'published'" class="op-inline" title="定稿/裁决/放行动作以此留名（无登录体系的归因方案）">
        <AppIcon name="user" :size="12" />操作人 <input v-model="operator" class="op-input"></span>
      <button class="btn primary cta-btn" v-if="cta" :disabled="cta.disabled" @click="runCta">{{ cta.label }}</button>
    </div>

    <!-- v2.0 线上流水线：质检/标准文档/发布 任务与草稿两态 -->
    <TaskPanel :req-id="card.id" :detail="d" @toast="(m, t) => emit('toast', m, t)" @refresh="load" />

    <div class="tabs" role="tablist">
      <button class="tab" role="tab" :class="{ on: tab === 'origin' }" @click="tab = 'origin'">原始需求</button>
      <button class="tab" role="tab" :class="{ on: tab === 'digest' }" @click="tab = 'digest'">
        需求摘要<span class="n num" v-if="d.digest">{{ d.frPoints.length }}</span></button>
      <button class="tab" role="tab" :class="{ on: tab === 'audit' }" @click="tab = 'audit'">
        体检报告<span class="n num" v-if="d.audit">{{ (d.audit.content?.items || []).length }}</span></button>
      <button class="tab" role="tab" :class="{ on: tab === 'checklist' }" @click="tab = 'checklist'">
        澄清清单<span class="n num" v-if="card.status === 'clarifying'">{{ answered }}/{{ totalQ }}</span><span class="n" v-if="card.status === 'published'">✓</span></button>
      <button class="tab" role="tab" :class="{ on: tab === 'std' }" @click="tab = 'std'">标准需求文档</button>
      <button class="tab" role="tab" :class="{ on: tab === 'cases' }" @click="tab = 'cases'">
        用例<span class="n num" v-if="d.coverage && d.coverage.backward.total">{{ d.coverage.backward.total }}</span></button>
      <button class="tab" role="tab" :class="{ on: tab === 'design' }" @click="tab = 'design'">设计</button>
      <button class="tab" role="tab" :class="{ on: tab === 'gate' }" @click="tab = 'gate'">
        门禁<span class="n num" v-if="gv && gv.round">{{ gv.round.status === 'released' ? '✓' : gv.round.roundNo + '轮' }}</span></button>
    </div>

    <!-- 原始需求：全文快照（D1）；v1.2 有块结构时结构化渲染（不堆叠/图片/锚点），否则 md 渲染降级 -->
    <template v-if="tab === 'origin'">
      <template v-if="d.snapshot">
        <div class="banner blue snap-bar">
          <AppIcon name="clock" :size="14" />
          <span>快照 <b class="num" :title="d.snapshot.at">{{ fmtRel(d.snapshot.at) }}</b> · 本快照是质检与澄清的<b>依据版本</b></span>
          <span>最新修订以<a v-if="card.sourceUrl" :href="card.sourceUrl" target="_blank" rel="noopener">飞书文档 ↗</a><span v-else>原始来源</span>为准</span>
          <span class="sub">重推产物时快照同步刷新；发布后冻结</span>
        </div>
        <div class="doc-layout">
        <div class="card doc docstruct" ref="snapshotBox">
          <template v-if="docData">
            <details class="toc" v-if="docToc.length" :open="tocOpen">
              <summary @click="tocOpen = !tocOpen">
                <AppIcon name="list-tree" :size="13" />文档导航（{{ docToc.length }} 个条目，点击滚动定位）
              </summary>
              <div class="toc-list">
                <a v-for="h in docToc" :key="h.id" class="toc-item" :class="'lv' + (h.level || 1)"
                   @click="locate('', h.id)">{{ h.text }}</a>
              </div>
            </details>
            <!-- 章节分组渲染：heading 标题 + 直属块包裹进 .docsec 容器（缩进+引导线表达归属）；前言组平铺 -->
            <template v-for="sec in docSections" :key="sec.key">
              <section v-if="sec.heading" class="docsec" :class="sec.cls">
                <DocBlock :block="sec.heading" :children-by-parent="childrenByParent"
                          :comment-by-ref="commentByRef" :req-id="card.id" />
                <DocBlock v-for="b in sec.blocks" :key="b.id" :block="b"
                          :children-by-parent="childrenByParent" :comment-by-ref="commentByRef"
                          :req-id="card.id" />
              </section>
              <template v-else>
                <DocBlock v-for="b in sec.blocks" :key="b.id" :block="b"
                          :children-by-parent="childrenByParent" :comment-by-ref="commentByRef"
                          :req-id="card.id" />
              </template>
            </template>
          </template>
          <div v-else v-html="snapshotHtml"></div>
        </div>
        <TocPane :items="docToc.map(h => ({ id: h.id, level: h.level, text: h.text }))"
                 :active-id="activeHead" @go="goToc" />
        </div>
      </template>
      <template v-else>
        <div class="card" v-if="card.sourceType === 'feishu'">
          <h3>飞书需求文档</h3>
          <p style="font-size:13px;color:var(--muted);margin-bottom:12px">
            尚无原文快照——快照将由 sdlc-sync 首次推送产物时生成；在此之前请到飞书查看原文。</p>
          <a :href="card.sourceUrl" target="_blank" rel="noopener">
            <button class="btn"><AppIcon name="external-link" :size="13" />打开飞书文档</button></a>
        </div>
        <div class="card" v-else>
          <h3>粘贴的原始需求文本</h3>
          <pre class="srctext">{{ card.sourceText }}</pre>
        </div>
      </template>
    </template>

    <!-- 结构化 Digest -->
    <template v-if="tab === 'digest'">
      <EmptyState v-if="!d.digest" icon="inbox" title="质检产物尚未推送"
                  desc="本地运行 sdlc-intent 产出三件套后，由 sdlc-sync 推送至此" />
      <template v-else>
        <div class="card">
          <h3>需求概述</h3>
          <p class="summary"><ClampText :text="d.digest.content?.summary || ''" :lines="4" :threshold="140" /></p>
        </div>
        <div class="card" v-if="(d.digest.content?.roles || []).length">
          <h3>涉及角色</h3>
          <span class="chip" v-for="r in d.digest.content?.roles || []" :key="r">{{ r }}</span>
        </div>

        <div class="card" v-if="(d.digest.content?.features || []).length">
          <h3>功能点地图（⭐ 本次关注范围）</h3>
          <div class="tablewrap">
          <table class="table"><thead><tr>
            <th style="width:90px">角色</th><th style="width:150px">页面/模块</th><th style="min-width:280px">功能</th>
            <th style="width:120px">覆盖</th><th style="width:100px">出处</th><th style="width:140px">关联需求点</th>
          </tr></thead>
            <tbody><tr v-for="f in d.digest.content.features" :key="f.m" style="cursor:default">
              <td>{{ f.role }}</td><td>{{ f.m }}</td><td>{{ f.func }}</td>
              <td class="sub">{{ f.cov || '—' }}
                <a class="cite" style="margin-left:4px" v-if="covP(f.cov)" @click="jumpAudit(covP(f.cov))">体检.{{ covP(f.cov) }} ↗</a>
              </td>
              <td class="sub"><a class="cite" :class="{ anchored: f.anchor }" v-if="f.src" @click="locate(f.src, f.anchor)">{{ f.src }}<span v-if="f.anchor" class="anchored-mark" title="块级锚点：点击直达原文条款"><AppIcon name="crosshair" :size="10" /></span></a><span v-else>—</span></td>
              <td>
                <span class="sub" v-if="!frByModule(f.m).length">—</span>
                <ChipList v-else :items="frByModule(f.m).map(f2 => f2.id)" :max="2">
                  <template #default="{ item }">
                    <a class="chip linklike"
                       @click="jumpTo({ page: 'reqs', reqId, kind: 'fr', id: item })">{{ item.replace('需求.', '') }}</a>
                  </template>
                </ChipList>
              </td>
            </tr></tbody>
          </table>
          </div>
        </div>

        <!-- v2.3 主流程投影（DESIGN-v2.3）：digest §5 步骤表，gap 行 = 原文 ❓ 断点 -->
        <div class="card" v-if="digestFlows.length">
          <h3>主流程（§5 步骤投影；❓ = 原文断点）</h3>
          <div class="tablewrap">
          <table class="table"><thead><tr>
            <th style="width:110px">角色</th><th style="min-width:220px">步骤</th><th style="width:150px">去向</th><th style="width:100px">出处</th>
          </tr></thead>
            <tbody><tr v-for="(f, i) in digestFlows" :key="i" :class="{ 'row-gap': f.gap }" style="cursor:default">
              <td>{{ f.role }}</td><td>{{ f.step }}</td>
              <td>{{ f.next }}<span v-if="f.gap" class="gapmark" title="原文未定义去向（❓）"> ❓</span></td>
              <td class="sub"><a class="cite" :class="{ anchored: f.anchor }" v-if="f.src" @click="locate(f.src, f.anchor)">{{ f.src }}<span v-if="f.anchor" class="anchored-mark" title="块级锚点：点击直达原文条款"><AppIcon name="crosshair" :size="10" /></span></a><span v-else>—</span></td>
            </tr></tbody>
          </table>
          </div>
        </div>

        <!-- v2.3 状态机流转投影（DESIGN-v2.3）：digest §6 边表，按对象分组折叠，gap 行 = 原文 ❓ 断点 -->
        <div class="card" v-if="digestStates.length">
          <h3>状态机流转（§6 边表投影，共 {{ digestStates.length }} 条）</h3>
          <div class="grp" v-for="g in stateGroups" :key="g.name" :class="{ closed: !openGrps.has(g.name) }">
            <div class="grp-t" @click="toggleGrp(g.name)">
              <AppIcon name="chevron-right" :size="13" class="grp-chev" />{{ g.name }}<span class="cnt">{{ g.items.length }} 条</span>
            </div>
            <div class="grp-body"><div class="grp-inner">
            <table class="table"><thead><tr>
              <th style="width:120px">从</th><th style="min-width:180px">触发</th><th style="width:120px">至</th><th style="width:100px">出处</th>
            </tr></thead>
              <tbody><tr v-for="(s, i) in g.items" :key="i" :class="{ 'row-gap': s.gap }" style="cursor:default">
                <td>{{ s.from }}</td><td>{{ s.on }}</td>
                <td>{{ s.to }}<span v-if="s.gap" class="gapmark" title="原文未定义去向（❓）"> ❓</span></td>
                <td class="sub"><a class="cite" :class="{ anchored: s.anchor }" v-if="s.src" @click="locate(s.src, s.anchor)">{{ s.src }}<span v-if="s.anchor" class="anchored-mark" title="块级锚点：点击直达原文条款"><AppIcon name="crosshair" :size="10" /></span></a><span v-else>—</span></td>
              </tr></tbody>
            </table>
            </div></div>
          </div>
        </div>

        <!-- RTM 覆盖率（DESIGN-v2.2 D20）：正向 FR→用例 / 反向 用例→FR；「未登记」与「0%」诚实区分 -->
        <div class="card" v-if="d.coverage">
          <h3>用例覆盖（RTM）</h3>
          <div class="cov-stats">
            <span>需求点覆盖
              <b v-if="d.coverage.forward.total">{{ d.coverage.forward.covered }}/{{ d.coverage.forward.total }}
                <span class="sub">（{{ d.coverage.forward.pct }}%）</span></b>
              <b v-else class="sub">未登记需求点</b>
            </span>
            <span>用例追溯
              <b v-if="d.coverage.backward.total">{{ d.coverage.backward.linked }}/{{ d.coverage.backward.total }}
                <span class="sub">（{{ d.coverage.backward.pct }}%）</span></b>
              <b v-else class="sub">未登记用例</b>
            </span>
            <span v-if="d.coverage.forward.uncovered.length" class="sub">
              未覆盖 {{ d.coverage.forward.uncovered.length }} 条：
              <ChipList :items="d.coverage.forward.uncovered.map(u => u.id)" :max="6">
                <template #default="{ item }">
                  <span class="chip linklike" :title="(d.coverage.forward.uncovered.find(u => u.id === item) || {}).name">{{ item.replace('需求.', '') }}</span>
                </template>
              </ChipList>
            </span>
          </div>
          <p class="cov-warn sub" v-if="d.coverage.danglingCases.length">
            ⚠ {{ d.coverage.danglingCases.length }} 条用例未挂需求点或引用了不存在的需求点（{{ d.coverage.danglingCases.join('、') }}）——无法反向追溯，请在用例页补挂或修正
          </p>
        </div>

        <div class="card">
          <h3>需求点注册表（按出处分组，共 {{ d.frPoints.length }} 条）</h3>
          <div class="grp-tools">
            <span class="sub">点组名展开 / 收起</span>
            <button class="btn small link" @click="expandAll(frGroups)">全部展开</button>
            <button class="btn small link" @click="collapseAll()">全部收起</button>
          </div>
          <div class="grp" v-for="g in frGroups" :key="g.name" :class="{ closed: !openGrps.has(g.name) }">
            <div class="grp-t" @click="toggleGrp(g.name)">
              <AppIcon name="chevron-right" :size="13" class="grp-chev" />{{ g.name }}<span class="cnt">{{ g.items.length }} 条</span>
            </div>
            <div class="grp-body"><div class="grp-inner">
            <table class="table"><thead><tr>
              <th style="width:140px">编号</th><th>名称/要点</th>
              <th style="width:140px">行级出处</th><th style="width:120px">归属模块</th><th style="width:170px">被用例覆盖</th>
            </tr></thead>
              <tbody><tr v-for="f in g.items" :key="f.id" style="cursor:default" :data-frid="f.id">
                <td><code>{{ f.id }}</code></td><td>{{ f.name }}</td>
                <td class="sub"><a class="cite" :class="{ anchored: f.anchor }" v-if="f.source" @click="locate(f.source, f.anchor)">{{ f.source }}<span v-if="f.anchor" class="anchored-mark" title="块级锚点：点击直达原文条款"><AppIcon name="crosshair" :size="10" /></span></a><span v-else>—</span></td>
                <td class="sub">{{ f.module || '—' }}</td>
                <td>
                  <span class="sub" v-if="!(f.coveredBy || []).length">—</span>
                  <ChipList v-else :items="f.coveredBy" :max="2">
                    <template #default="{ item }">
                      <a class="chip linklike" :class="{ real: !item.startsWith('WEB-') }"
                         @click="jumpCase(item)">{{ item }}</a>
                    </template>
                  </ChipList>
                </td>
              </tr></tbody>
            </table>
            </div></div>
          </div>
          <p class="sub" style="margin-top:8px">测试用例通过关联这些编号挂到需求点，构成追溯链；点用例编号直达用例详情。</p>
        </div>

        <details class="card" :open="digestMdOpen" v-if="d.digest.markdown">
          <summary style="cursor:pointer;font-size:13px;color:var(--muted)">查看摘要原文（markdown，含假设清单——「需求.Axx」引用的定位落点）</summary>
          <div class="doc" style="margin-top:10px" ref="digestMdBox" v-html="digestMdHtml"></div>
        </details>
      </template>
    </template>

    <!-- 体检报告：需求域分组（D4） + 摘引 + 双向跳转（D5） -->
    <template v-if="tab === 'audit'">
      <EmptyState v-if="!d.audit" icon="inbox" title="体检报告尚未推送"
                  desc="本地运行 sdlc-intent 产出体检报告后，由 sdlc-sync 推送至此" />
      <template v-else>
        <div class="stats inline lv-stats">
          <div class="stat lv-red" :class="{ zero: !(d.audit.content?.red > 0) }">
            <span class="stat-ico ti-red"><AppIcon name="alert-circle" :size="16" /></span>
            <div><div class="n">{{ d.audit.content?.red || 0 }}</div><div class="l">阻断</div></div>
          </div>
          <div class="stat lv-amber" :class="{ zero: !(d.audit.content?.yellow > 0) }">
            <span class="stat-ico ti-amber"><AppIcon name="alert-triangle" :size="16" /></span>
            <div><div class="n">{{ d.audit.content?.yellow || 0 }}</div><div class="l">存疑</div></div>
          </div>
          <div class="stat lv-blue" :class="{ zero: !(d.audit.content?.blue > 0) }">
            <span class="stat-ico ti-lvblue"><AppIcon name="info" :size="16" /></span>
            <div><div class="n">{{ d.audit.content?.blue || 0 }}</div><div class="l">建议</div></div>
          </div>
        </div>
        <div class="banner">
          <AppIcon name="info" :size="14" />
          <span>问题按需求域分组（与澄清清单同序，可对照阅读）；出处与摘引可定位到原始需求快照。</span>
          <span class="grp-tools-in">
            <button class="btn small link" @click="expandAll(auditGroups)">全部展开</button>
            <button class="btn small link" @click="collapseAll()">全部收起</button>
          </span>
        </div>
        <div class="grp" v-for="g in auditGroups" :key="g.name" :class="{ closed: !openGrps.has(g.name) }">
          <div class="grp-t" @click="toggleGrp(g.name)">
            <AppIcon name="chevron-right" :size="13" class="grp-chev" />{{ g.name }}
            <span class="cnt">{{ g.items.length }} 题<template v-for="lv in ['red', 'yellow', 'blue']" :key="lv"><span
              v-if="cnt(g.items, lv)" class="lv-pill" :class="lv"><i class="lvl-dot" :class="lv"></i>{{ lvlLabel[lv] }} {{ cnt(g.items, lv) }}</span></template></span>
          </div>
          <div class="grp-body"><div class="grp-inner">
          <div v-for="it in g.items" :key="it.id" class="check-item" :class="it.level" :data-pid="pidOf(it.id)">
            <div class="ci-head">
              <span class="badge" :class="lvlCls[it.level]">{{ lvlLabel[it.level] }}</span>
              <span class="chip">{{ it.id }}</span>
              <button class="jump-link" @click="jumpClarify(pidOf(it.id))">澄清 {{ pidOf(it.id) }}<AppIcon name="arrow-up-right" :size="11" /></button>
            </div>
            <div class="q">{{ it.title }}</div>
            <div class="ctx">出处：<a class="cite" :class="{ anchored: it.anchor }" @click="locate(firstQuote(it.quote) || it.where, it.anchor)">{{ it.where }}<span v-if="it.anchor" class="anchored-mark" title="块级锚点：点击直达原文条款"><AppIcon name="crosshair" :size="10" /></span></a> ｜ 去向：{{ it.go || '—' }}</div>
            <blockquote class="quote" v-if="it.quote">
              <span class="qlb">原文摘引 · <a class="cite" :class="{ anchored: it.anchor }" @click="locate(firstQuote(it.quote), it.anchor)">在快照中定位<span v-if="it.anchor" class="anchored-mark"><AppIcon name="crosshair" :size="10" /></span></a></span>{{ it.quote }}
            </blockquote>
            <div class="ctx" v-if="(it.relatedCases || []).length" style="margin-top:6px">
              关联用例：<a class="chip linklike real" v-for="c in it.relatedCases" :key="c" @click="jumpCase(c)">{{ c }}</a>
            </div>
          </div>
          </div></div>
        </div>
        <details class="card" v-if="d.audit.markdown">
          <summary style="cursor:pointer;font-size:13px;color:var(--muted)">查看体检报告原文（markdown）</summary>
          <div class="doc" style="margin-top:10px" v-html="render(d.audit.markdown)"></div>
        </details>
      </template>
    </template>

    <!-- 澄清清单：与体检同序分组（D4） + 摘引 + 回跳（D5），答复交互不变 -->
    <template v-if="tab === 'checklist'">
      <EmptyState v-if="!d.items.length" icon="inbox" title="澄清清单尚未推送"
                  desc="体检报告推送时同步生成澄清清单" />
      <template v-else>
        <div class="banner" v-if="card.status === 'published'">
          <AppIcon name="check-circle" :size="14" style="color:var(--green)" />
          <span>澄清已闭环：全部问题已答复，标准需求文档已发布。</span>
        </div>
        <div class="banner blue sticky-clf" v-else-if="card.status === 'clarifying'">
          <AppIcon name="info" :size="14" />
          <div style="flex:1;min-width:200px">
            与体检报告一一对应（同源 P 编号），PM 在本页逐条作答（失焦自动保存）；不是问题可驳回、本期不处理可挂起——处置完即可生成标准文档。
            <div class="prog-row" style="margin-top:8px">
              <div class="bar"><div class="bar-fill" :style="{ width: prog + '%' }"></div></div>
              <span class="num">{{ answered }}/{{ totalQ }} 已处置</span>
              <button class="btn small" v-if="nextUnanswered" @click="jumpNextUnanswered">
                <AppIcon name="arrow-up-right" :size="11" />跳到下一待处置</button>
              <button class="btn small link" @click="clfFilter = clfFilter === 'all' ? 'pending' : (clfFilter === 'pending' ? 'done' : 'all')">
                {{ clfFilter === 'all' ? '只看待处置' : (clfFilter === 'pending' ? '只看已处置' : '显示全部') }}</button>
            </div>
          </div>
        </div>
        <div class="banner" v-else>
          <AppIcon name="clock" :size="14" />
          <span>质检中：产物推送后进入澄清。</span>
        </div>
        <div class="grp-tools" v-if="checklistGroups.length">
          <span class="sub">点组名展开 / 收起</span>
          <button class="btn small link" @click="expandAll(checklistGroups)">全部展开</button>
          <button class="btn small link" @click="collapseAll()">全部收起</button>
        </div>
        <div class="grp" v-for="g in visibleCheckGroups" :key="g.name" :class="{ closed: !openGrps.has(g.name) }">
          <div class="grp-t" @click="toggleGrp(g.name)">
            <AppIcon name="chevron-right" :size="13" class="grp-chev" />{{ g.name }}
            <span class="cnt">{{ clfFilter !== 'all'
              ? `${g.items.length} 题（${clfFilter === 'pending' ? '待处置' : '已处置'}）`
              : `${g.items.length} 题 · 已处置 ${answeredIn(g.items)}/${g.items.length}` }}</span>
          </div>
          <div class="grp-body"><div class="grp-inner">
          <div v-for="it in g.items" :key="it.seq" class="check-item" :class="it.level" :data-pid="it.seq">
            <div class="ci-head">
              <span class="badge" :class="lvlCls[it.level]">{{ lvlLabel[it.level] }}</span>
              <span class="chip">{{ it.seq }}</span>
              <button class="jump-link" @click="jumpAudit(it.seq)">来自体检.{{ it.seq }}<AppIcon name="arrow-up-right" :size="11" /></button>
            </div>
            <div class="q">{{ it.question }}</div>
            <div class="ctx" v-if="it.ctx">出处：<a class="cite" :class="{ anchored: it.anchor }" @click="locate(firstQuote(it.quote) || it.ctx, it.anchor)">{{ it.ctx }}<span v-if="it.anchor" class="anchored-mark" title="块级锚点：点击直达原文条款"><AppIcon name="crosshair" :size="10" /></span></a></div>
            <blockquote class="quote" v-if="it.quote">
              <span class="qlb">原文摘引 · <a class="cite" :class="{ anchored: it.anchor }" @click="locate(firstQuote(it.quote), it.anchor)">在快照中定位<span v-if="it.anchor" class="anchored-mark"><AppIcon name="crosshair" :size="10" /></span></a></span>{{ it.quote }}
            </blockquote>
            <div class="ans" v-if="card.status === 'published'">
              <span class="lb" :class="{ muted: it.status === 'rejected' }">{{ dispLabel(it) }}</span>
              <template v-if="it.status === 'rejected'">
                <span class="sub">{{ it.note || '（无理由记录）' }}</span>
              </template>
              <template v-else-if="it.status === 'deferred'">
                <span class="sub">转遗留假设{{ it.note ? '：' + it.note : '' }}</span>
              </template>
              <template v-else>{{ it.answer || '（未处置，按原需求执行）' }}</template>
            </div>
            <div class="ans" v-else-if="card.status === 'clarifying' && (it.status === 'rejected' || it.status === 'deferred')">
              <span class="lb">{{ dispLabel(it) }}<span v-if="it.note" class="sub">（{{ it.note }}）</span></span>
              <span class="sub">
                {{ it.status === 'rejected' ? '已认定不是问题，不进定稿' : '已转遗留假设，合成时记入 需求.Axx' }}
                <button class="btn small link" @click="reopen(it)">重新作答</button>
              </span>
            </div>
            <div class="ans" v-else-if="card.status === 'clarifying'">
              <span class="lb" :class="{ warn: !it.answer }">{{ it.answer ? '答复（可修改）' : '待答复' }}</span>
              <span class="saved" v-if="ansState[it.seq] === 'saved'"><AppIcon name="check-circle" :size="11" />已保存</span>
              <span class="saved" v-else-if="ansState[it.seq] === 'saving'" style="color:var(--muted)">保存中…</span>
              <textarea v-model="it.answer" :placeholder="'PM 在此作答…'"
                @blur="saveAnswer(it)" @input="autoGrow"></textarea>
              <div class="ans-ops">
                <button class="btn small link" title="认定不是问题：不进标准文档定稿" @click="askDispose(it, 'rejected')">驳回（不是问题）</button>
                <button class="btn small link" title="本期不处理：合成时转遗留假设" @click="askDispose(it, 'deferred')">挂起（转遗留假设）</button>
              </div>
            </div>
            <div class="ans" v-else><span class="lb warn">待答复</span></div>
          </div>
          </div></div>
        </div>
        <div class="banner" v-if="card.status === 'clarifying' && allAnswered">
          <AppIcon name="check-circle" :size="14" style="color:var(--green)" />
          <span>全部答复完成。可在流水线面板点击「生成标准文档」（见上方线上流水线卡），AI 合成草稿预览后发布；本地 sdlc-sync 工具为备用通道。</span>
        </div>
      </template>
    </template>

    <!-- 标准需求文档：重写版（D6），四类引用可点击（D7） -->
    <template v-if="tab === 'std'">
      <template v-if="d.standard">
        <div class="banner blue">
          <AppIcon name="file-text" :size="14" />
          <span>重写版定稿：以原始需求全文为底稿，整合体检定论与澄清答复——开发 / AI 读这一份即可获得需求全貌、边界与逻辑。全文 <b>FR / 体检.P / P / 需求.A</b> 引用可点击跳转。</span>
        </div>
        <div class="doc-layout">
          <div class="card doc" ref="stdBox" v-html="stdHtml" @click="stdRefClick"></div>
          <TocPane :items="stdToc" :active-id="activeHead" @go="goToc" />
        </div>
      </template>
      <EmptyState v-else icon="file-text" title="标准需求文档尚未发布"
                  desc="澄清闭环后在流水线面板生成并发布标准需求文档" />
    </template>

    <!-- v2.4 用例 tab：需求内嵌用例表（与独立用例页同一组件，reqId 固定） -->
    <template v-if="tab === 'cases'">
      <CaseList :fixed-req-id="card.id" @toast="(m, t) => emit('toast', m, t)" />
    </template>

    <!-- v2.4 设计 lane（DESIGN-v2.4 D34） -->
    <template v-if="tab === 'design'">
      <DesignTab v-if="dv" :req-id="card.id" :view="dv" :operator="operator"
                 @toast="(m, t) => emit('toast', m, t)" @refresh="load" />
      <EmptyState v-else icon="pencil-ruler" title="设计 lane 需求发布后开启"
                  desc="澄清闭环并发布标准文档后，这里提供目标仓配置、设计生成与定稿（GR-1：输入冻结）" />
    </template>

    <!-- v2.4 门禁域（DESIGN-v2.4 D35） -->
    <template v-if="tab === 'gate'">
      <GateTab v-if="gv" :req-id="card.id" :view="gv" :operator="operator"
               @toast="(m, t) => emit('toast', m, t)" @refresh="load" />
      <EmptyState v-else icon="shield-check" title="门禁需求发布后开启"
                  desc="发布后开闸三条件（设计定稿∨轻量跳过 / 用例全部定稿 / FR 覆盖）全绿即可开评审" />
    </template>

    <!-- 回到顶部（长文阅读） -->
    <Transition name="fade">
      <button class="to-top" v-if="showTop" @click="toTop" title="回到顶部" aria-label="回到顶部">
        <AppIcon name="arrow-up" :size="15" />
      </button>
    </Transition>

    <!-- v2.2 处置理由弹窗（DESIGN-v2.2 D21）：驳回必填 / 挂起可选 -->
    <div class="modal-mask" v-if="disposeDlg" @click.self="disposeDlg = null">
      <div class="modal" role="dialog" aria-modal="true" style="width:460px">
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
  </div>
  </div>
</template>

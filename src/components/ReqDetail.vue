<script setup>
// 需求详情壳（AUDIT D6-2 拆分后）：数据装载（load/loadExt）+ 全链主按钮 CTA + tab 分发 +
// 三个跨 tab 协议 composable（分组折叠 / 追溯跳转 / 目录滚动）。五个内容 tab 为纯展示子组件
// （Origin/Digest/Audit/Checklist/Std，props + emit + 局部 DOM expose），cases/design/gate 已有子组件。
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { api } from '../api.js'
import AppIcon from './AppIcon.vue'
import EmptyState from './EmptyState.vue'
import TaskPanel from './TaskPanel.vue'
import CaseList from './CaseList.vue'
import DesignTab from './DesignTab.vue'
import GateTab from './GateTab.vue'
import OriginTab from './OriginTab.vue'
import DigestTab from './DigestTab.vue'
import WorkbenchTab from './WorkbenchTab.vue'
import StdTab from './StdTab.vue'
import ChangesTab from './ChangesTab.vue'
import CommentsPanel from './CommentsPanel.vue'
import { fmtRel } from '../time.js'
import { nextActionCta } from '../lifecycle.js'
import { jumpTo, groupItems, groupByFirstAppearance, groupByDocSection, pidOf } from '../trace.js'
import { isDone, isPending } from '../disposition.js'
import { provideGroupCollapse } from '../composables/group-collapse.js'
import { useTraceJump } from '../composables/trace-jump.js'
import { useTocScroll } from '../composables/toc-scroll.js'
import { threadRoots, buildCommentAnchorMap } from '../comments.js'
import { ask } from '../confirm.js'
import { mdPlain } from '../docview.js'

const props = defineProps({ reqId: String })
const emit = defineEmits(['back', 'toast', 'loaded'])

const d = ref(null)
const tab = ref('origin')
const changesRef = ref(null)
/** 统一页签切换（E3 守卫）：从变更单页签切走且草稿编辑未保存 → 先确认（tab 用 v-if 切换，
 * 卸载即丢未保存编辑）；其余方向直切 */
async function switchTab(t) {
  if (t === tab.value) return
  if (tab.value === 'changes' && changesRef.value?.isEditingDirty?.()
      && !await ask({ title: '放弃未保存的编辑？',
                      body: '切换页签将丢弃当前变更单草稿编辑（已保存的草稿不受影响）。',
                      danger: true, confirmText: '放弃并切换' })) return
  // v5.x 批2：标准文档草稿编辑脏态同守卫（StdTab v-if 卸载即丢编辑，同 E3 模式）
  if (tab.value === 'std' && stdTabRef.value?.isEditingDirty?.()
      && !await ask({ title: '放弃未保存的编辑？',
                      body: '切换页签将丢弃标准文档草稿的未保存编辑（已保存的草稿不受影响）。',
                      danger: true, confirmText: '放弃并切换' })) return
  tab.value = t
}
const digestMdOpen = ref(false)          // digest 原文折叠（假设引用跳入时自动展开）
const loading = ref(true)
const error = ref('')

const statusLabel = { submitted: '已提交', reviewing: '质检中', clarifying: '待澄清', published: '已发布', changed: '变更中' }
const statusCls = { submitted: 'b-gray', reviewing: 'b-blue', clarifying: 'b-amber', published: 'b-green', changed: 'b-amber' }
// v1.3 风险分级徽章（DESIGN-v2.2 D19）：空=未分级不渲染
const tierLabel = { A: 'A级', B: 'B级', C: 'C级' }
const tierCls = { A: 'b-red', B: 'b-amber', C: 'b-gray' }
const tierTip = { A: '风险分级 A：按失败后果缩放验证深度——全管线（体检全维度/评审全扇出）', B: '风险分级 B：轻量管线（裁剪体检路由与评审扇出）', C: '风险分级 C：最轻管线（仅纯展示/文案类改动）' }

const answered = computed(() => (d.value?.items || []).filter(isDone).length)
const totalQ = computed(() => (d.value?.items || []).length)
const card = computed(() => d.value?.card || {})
const domains = computed(() => d.value?.domains || [])
// v5（D8）：设计/门禁置灰口径 = 未发布（变更/用例不置灰——reconcile 通道与用例读面放行）
const postLocked = computed(() => !['published', 'changed'].includes(card.value.status))

// v1.2 原文块表（resolveDocPath/cmBlockText/章节分组共用——v5.3 上提，章节分组依赖块序）
const docBlocks = computed(() => d.value?.doc?.content?.blocks || [])

// 分组列表留在壳：revealGrpFor 跳转展开依赖全量表。
// v5.3：check/已定论改按「文档章节」分组（anchor→最近目录项；组内 level 序，阻断优先）——
// 列表顺序=原文顺序，组头即位置信息；无块结构（快照老文档）回退 theme 需求域分组。
const checklistGroups = computed(() =>
  docBlocks.value.length
    ? groupByDocSection(d.value?.items || [], docBlocks.value)
    : groupItems(d.value?.items || [], 'theme', domains.value))
const frGroups = computed(() => groupByFirstAppearance(d.value?.frPoints || [], 'group'))

// v5（D14）已定论分组：audit 差集 ∧ go✅ 条目（audit-only 且已定论的只读卡宿主）。组名带
// 「已定论·」前缀（openGrps 域防与 check 组撞名联动），raw 留原组键供工作台内挂载匹配
const concludedGroups = computed(() => {
  const seqs = new Set((d.value?.items || []).map(i => i.seq))
  const rows = (d.value?.audit?.content?.items || [])
    .filter(a => !seqs.has(pidOf(a.id)) && String(a.go || '').startsWith('✅'))
  return (docBlocks.value.length ? groupByDocSection(rows, docBlocks.value)
                                 : groupItems(rows, 'group', domains.value))
    .map(g => ({ ...g, name: '已定论·' + g.name, raw: g.name }))
})

// ===== 跨 tab 协议：分组折叠（provide 给各 tab inject；audit 键 = 已定论分组——revealGrpFor
// 的 audit 跳转解析域为 check ∪ 已定论，r4 二审#13） =====
// P1-11：reqId 用于按需求持久化用户折叠偏好（首次进入由 composable 展开含 pending 的组）
const grp = provideGroupCollapse({ fr: frGroups, audit: concludedGroups, check: checklistGroups },
                                 { reqId: props.reqId })

// tab 组件 ref：定位/滚动协议需要 tab 内部容器与标题序列（defineExpose）
const originTabRef = ref(null)
const digestTabRef = ref(null)
const stdTabRef = ref(null)
const workbenchTabRef = ref(null)

// ===== 跨 tab 协议：追溯跳转（locate/applyJump 消费 pendingJump） =====
const { locate, applyJump } = useTraceJump({
  reqId: () => props.reqId,
  tab,
  digestMdOpen,
  toast: (m, t) => emit('toast', m, t),
  revealGrpFor: grp.revealGrpFor,
  expandAllGroups: () => grp.expandAll([...checklistGroups.value, ...concludedGroups.value]),
  getOriginBox: () => originTabRef.value?.box ?? null,
  getDigestMdBox: () => digestTabRef.value?.mdBox ?? null
})

/** tab 组件上抛的统一跳转意图 {kind, id}：fr/audit/check/asm → 本需求内；case → 用例页；
 *  src → 出处解析块锚后走 locate（resolveDocPath 依赖 doc 结构） */
function onJump(j) {
  if (j.kind === 'src') return locate(j.id, resolveDocPath(j.id)?.id)
  jumpTo({ page: j.kind === 'case' ? 'cases' : 'reqs', reqId: props.reqId, kind: j.kind, id: j.id })
}

// ===== 跨 tab 协议：长文目录滚动（activeHead 传 origin/std 的 TocPane；回顶按钮在壳） =====
function headElsNow() {
  if (tab.value === 'std') return stdTabRef.value?.headEls() ?? []
  if (tab.value === 'origin') return originTabRef.value?.headEls() ?? []
  // 工作台体检报告目录（C7）：details 折叠态组件自身返回空数组，滚动高亮自然空转
  if (tab.value === 'checklist') return workbenchTabRef.value?.headEls() ?? []
  return []
}
const { activeHead, showTop, goToc, toTop } = useTocScroll({
  tab,
  headEls: headElsNow,
  goOrigin: id => locate('', id)
})

// v5（D19）：audit 并入工作台后 TABS 删 'audit'；'checklist' 键名保留（组件/文案已更名工作台）
const TABS = ['origin', 'digest', 'checklist', 'std', 'changes', 'cases', 'design', 'gate']

// ===== U-10：页签 ARIA + roving tabindex + ←/→/Home/End =====
const tabDisabled = key => (key === 'design' || key === 'gate') && postLocked.value
function enabledTabKeys() { return TABS.filter(k => !tabDisabled(k)) }
async function onTabKey(e, key) {
  const keys = enabledTabKeys()
  const i = keys.indexOf(key)
  if (i < 0) return
  let next = ''
  if (e.key === 'ArrowRight') next = keys[(i + 1) % keys.length]
  else if (e.key === 'ArrowLeft') next = keys[(i - 1 + keys.length) % keys.length]
  else if (e.key === 'Home') next = keys[0]
  else if (e.key === 'End') next = keys[keys.length - 1]
  if (!next) return
  e.preventDefault()
  await switchTab(next)
  await nextTick()
  // 切页签被守卫取消（变更单未保存编辑）时焦点留在原页签
  document.getElementById('tab-' + (tab.value === next ? next : tab.value))?.focus()
}

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
    loadComments()       // v4：评论面（不阻塞主装载；失败静默）
    loadChanges()        // v4：变更单计数（tab 角标）
    loadTasks(); loadDrafts()   // v5.x：流水线面（tasks/drafts 壳层单一数据源）
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

// ===== v4 评论域（DESIGN-v4 §4）：面板常驻壳层（跨 tab）；platformByBlock 供 OriginTab 角标 =====
const cm = ref(null)              // GET /comments → {comments, unresolvedCount}
const cmtsOpen = ref(false)
const cmtsFocus = ref(null)       // 定位高亮的评论 id（L 系跳回协议 + v5.x 角标联动）
const cmtsComposeBlock = ref('')  // 发评目标块（块角标进入预选）
const cmtsPanelRef = ref(null)    // 面板 ref：同值重复点击直调 refocus（watch 同值不触发）
const cmtsReadonly = ref(false)   // 出处=评论的只读查看态（正常评论入口恒 false）

async function loadComments() {
  try {
    const r = await api.get(`/api/requirements/${props.reqId}/comments`)
    cm.value = Array.isArray(r?.comments) ? r : null   // 形状防御（非评论面响应不进渲染）
  } catch { cm.value = null }   // 评论面失败不连累主流程（面板内动作会再次尝试）
}
function openComments(blockId = '', focusId = null, readonly = false) {
  // v5.x 角标联动：块有评论时定位该块首个未解决线程根（全解决取首根；无评论不传——开面板即发评）
  if (blockId && focusId == null) {
    const roots = threadRoots(cm.value?.comments || []).filter(r => r.blockId === blockId)
    const target = roots.find(r => !r.resolved) || roots[0]
    if (target) focusId = target.id
  }
  // 同值快照必须取在赋值前（赋值后判定恒真 + watch/refocus 双重执行）；cmtsOpen 亦须置真前读
  const same = cmtsOpen.value && focusId != null && cmtsFocus.value === focusId
  // 只读标记无条件赋值（true/false 都写）：出处查看与正常发评入口可互相切换——若只在 true 时
  // 置位，「先只读查看、关闭、再点整体疑问」将永远打不回可写面板
  cmtsReadonly.value = readonly
  cmtsComposeBlock.value = blockId || ''
  cmtsFocus.value = focusId
  // 面板已开时再点角标只是换目标——无提示会被当成"点击没反应"，明确反馈一句
  // （null 族专用：focusId 非空族的反馈是 watch/refocus 的滚动+闪烁）
  if (cmtsOpen.value && !focusId) emit('toast', blockId ? '评论目标已切到选中块' : '已切回卡片级评论')
  cmtsOpen.value = true
  if (same) cmtsPanelRef.value?.refocus(focusId)
}
const cmByBlock = computed(() => {
  const m = {}
  for (const c of cm.value?.comments || []) if (c.blockId) m[c.blockId] = (m[c.blockId] || 0) + 1
  return m
})
/** v5.x 评论锚 → 面板定位目标（buildCommentAnchorMap 口径单点）：工作台/摘要页「出处=评论区」
 *  点击分流开面板；块锚/无锚 miss 走原 locate，目录块 id 不在键域不受影响 */
const commentAnchorMap = computed(() => buildCommentAnchorMap(docBlocks.value, cm.value?.comments || []))
/** locate 统一入口（v5.x）：直连 locate 的三处 @locate 改经此分流——评论锚开**只读**评论面板
 *  （不切 tab），否则原 needle/块锚定位。CommentsPanel 的单参 inline locate 绑定不经此（签名不同）。
 *  只读影响面 = DigestTab 的出处=评论点击（摘要页无右栏，无处插评论出处卡）；OriginTab 的 locate
 *  仅来自 TOC（heading/title/table-row，comment 合成块永不入选）、WorkbenchTab 已在组件内拦截
 *  评论锚——都不会走到只读分支。后人若给 OriginTab 加评论锚 locate，此处会静默变只读，慎改。 */
function onLocate(needle, anchor) {
  const cid = commentAnchorMap.value[anchor]
  if (cid != null) return openComments('', cid, true)
  locate(needle, anchor)
}
const cmUnresolved = computed(() => cm.value?.unresolvedCount || 0)
const cmBlockText = computed(() => {
  const m = {}
  for (const b of docBlocks.value) {
    // 可读标签：行卡带行号+首个子块文本、条款带序号，无 text 的块兜底——绝不裸显块 ID；
    // 块 text 是 md 行内源码，纯文本插值前先 mdPlain 剥标记（**/`/[]() 等不再露进 chip）
    let label = mdPlain(b.text)
    if (b.type === 'table-row') {
      const fc = (childrenByParent.value[b.id] || []).find(c => c.text)
      label = `行${b.rowLabel} ${mdPlain(fc?.text || '')}`.trim()
    }
    if (b.type === 'list-item' && b.ordinal) label = `${b.ordinal} ${label}`
    m[b.id] = label || '原文块'
  }
  return m
})
const escalatedIds = computed(() =>
  (d.value?.items || []).filter(i => i.origin === 'local' && i.srcCommentId).map(i => i.srcCommentId))
// v5 §4 原文反向角标数据（OriginTab 全宽阅读与工作台侧栏共用）：anchor → 待澄清 seq[]
const pendingByBlock = computed(() => {
  const m = {}
  for (const it of d.value?.items || []) {
    if (it.anchor && isPending(it)) (m[it.anchor] = m[it.anchor] || []).push(it.seq)
  }
  return m
})
function onCmtsRefresh() { loadComments(); load() }   // 升级会产生 L 行——澄清清单同步重拉

// ===== v4 变更单域：tab 角标计数 + GR-3 点入直达协议 =====
const chgCount = ref(0)
const chgFocus = ref(null)
async function loadChanges() {
  try {
    const rows = await api.get(`/api/requirements/${props.reqId}/changes`)
    chgCount.value = rows.filter(c => c.status !== 'aborted').length
  } catch { chgCount.value = 0 }
}
function openChange(id) { chgFocus.value = id; switchTab('changes') }
defineExpose({ openChange })   // 跨组件跳转协议（GateTab GR-3 横幅点入直达变更单）

// ===== v5.x 流水线域（草稿归 tab）：tasks/drafts 装载与轮询上提壳层单一数据源——面板与各
// 产物 tab 共同消费；轮询/终态联动原 TaskPanel 逻辑迁此（组件 :key 按 reqId 重挂载，无需
// 代次号防 reqId 切换竞态；KNOWN 状态机保留——终态翻转触发草稿刷新与 doc 重拉） =====
const tasks = ref([])
const drafts = ref({})
const KNOWN = {}
async function loadTasks() {
  try { tasks.value = await api.get(`/api/tasks?req_id=${props.reqId}`) }
  catch { /* 轮询失败保旧态，下次 tick 重试 */ }
}
async function loadDrafts() {
  try {
    const list = await api.get(`/api/requirements/${props.reqId}/drafts`)
    const m = {}
    for (const x of list) m[x.type] = x
    drafts.value = m
  } catch { /* 草稿拉取失败保持现状（轮询补齐） */ }
}
function reloadPipe() { loadTasks(); loadDrafts() }   // 排任务/草稿动作后的轻刷新（不动 detail）
/** 轮询单次：页面不可见时跳过（省无效读放大），恢复可见由 visibilitychange 立即补一次 */
async function tick() {
  if (document.hidden) return
  const before = { ...KNOWN }
  try {
    const list = await api.get(`/api/tasks?req_id=${props.reqId}`)
    // 有任务从 queued/running 变为终态 → 刷新草稿；source_import 完成 → 块表已落库，重拉 doc.json
    for (const t of list) {
      if (before[t.id] && before[t.id] !== t.status && (t.status === 'done' || t.status === 'failed')) loadDrafts()
      if (before[t.id] && before[t.id] !== t.status && t.type === 'source_import' && t.status === 'done') load()
      KNOWN[t.id] = t.status
    }
    tasks.value = list
  } catch { /* 轮询失败保旧态，下次 tick 重试 */ }
}
function onVis() { if (!document.hidden) tick() }
let pollTimer = null
onBeforeUnmount(() => {
  clearInterval(pollTimer)
  document.removeEventListener('visibilitychange', onVis)
})
// v5.x 派生迁此（原 TaskPanel）：草稿四类——草稿宿主 tab 的数据源
const digestDraft = computed(() => drafts.value.digest_bundle || null)
const stdDraft = computed(() => drafts.value.standard || null)
const stdDraftVisible = computed(() => !!stdDraft.value && card.value.status !== 'published')   // published 终态无草稿动作
const casesDraft = computed(() => drafts.value.cases || null)
const incDraft = computed(() => drafts.value.incremental_bundle || null)

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
      emit('toast', 'design_gen 任务已排队'); switchTab('design')
    } else if (c.go === 'design:skip') {
      await api.post(`${base}/design/skip`, { by: operator.value })
      emit('toast', '已声明轻量跳过（自查档）'); switchTab('design')
    } else if (c.go === 'gate:open') {
      await api.post(`${base}/gate/open`, { by: operator.value })
      emit('toast', '已开闸（三条件全绿），评审任务排队中'); switchTab('gate')
    } else if (c.go === 'gate:ingest') {
      await api.post(`${base}/gate/rounds/${gv.value.round.id}/ingest`, { by: operator.value })
      emit('toast', '评审汇总已入库，进入裁决'); switchTab('gate')
    } else if (c.go === 'gate:release') {
      const r = await api.post(`/api/gate/rounds/${gv.value.round.id}/release`, { by: operator.value })
      emit('toast', `已放行 r${r.roundNo}（关卡互认 ${r.casesConfirmed} 条草稿用例置已定稿）`); switchTab('gate')
    } else if (c.go === 'gate:reopen') {
      await api.post(`${base}/gate/reopen`, { by: operator.value })
      emit('toast', '已开复审轮（旧轮只读归档）'); switchTab('gate')
    } else if (c.go.startsWith('tab:')) {
      switchTab(c.go.slice(4))
      return
    }
    await load()
  } catch (e) { emit('toast', e.message, 'err') }
}

onMounted(async () => {
  await load()
  applyJump()          // 跨页跳入：数据就绪后应用 pending 跳转
  pollTimer = setInterval(tick, 4000)   // v5.x：流水线轮询（原 TaskPanel 迁此）
  document.addEventListener('visibilitychange', onVis)
})

/** v1.2：原文出处路径（详述N[.N.*]）→ 原文块锚。行号定位表行，小节号/文本匹配行内条款；未命中返回 null */
const childrenByParent = computed(() => {
  const m = {}
  for (const b of docBlocks.value) {
    const p = b.parent || ''
    ;(m[p] = m[p] || []).push(b)
  }
  return m
})
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
      <span v-if="card.submittedBy" class="tnum"><AppIcon name="user" :size="12" />{{ card.submittedBy }} · {{ fmtRel(card.createdAt) }}</span>
      <span v-if="card.syncedAt" class="tnum" :title="card.syncedAt"><AppIcon name="refresh-cw" :size="12" />同步 {{ fmtRel(card.syncedAt) }}</span>
      <span v-if="card.status === 'published' || card.status === 'changed'" class="op-inline" title="定稿/采纳/裁决/放行动作以此留名（无登录体系的归因方案）">
        <AppIcon name="user" :size="12" />操作人 <input type="text" v-model="operator" name="operator" aria-label="操作人" class="op-input"></span>
      <!-- v4 卡片级评论（整体疑问）：常显——零评论也可发第一条（破"有评论才亮"死锁）；有未解决才带计数 -->
      <button class="btn small link" v-if="cm" @click="openComments('')"
              title="卡片级评论（不锚定原文块的整体疑问）">
        <AppIcon name="message-square" :size="12" />整体疑问<template v-if="cmUnresolved">（{{ cmUnresolved }} 未解决）</template></button>
      <!-- v4 contentRev：变更确认次数展示（单调计数，放弃不回退） -->
      <span class="chip" v-if="card.contentRev > 0"
            title="变更单确认次数（content_rev 单调递增；放弃变更不回退此计数）">历史变更 ×{{ card.contentRev }}</span>
      <button class="btn primary cta-btn" v-if="cta" :disabled="cta.disabled" @click="runCta">{{ cta.label }}</button>
    </div>

    <!-- v4 changed 态：顶部提示条（增量合并后重新发布） -->
    <div class="banner amber-t" v-if="card.status === 'changed'">
      <AppIcon name="alert-triangle" :size="14" />
      <span style="flex:1"><b>变更处理中</b>：增量质检完成后在变更页签采纳合并，再到标准文档页签从草稿预览重新发布；期间直接编辑与全量重推已关闭。</span>
      <button class="btn small" @click="switchTab('changes')">查看变更单</button>
    </div>

    <!-- v5.x 批3：流水线面板专心化（任务状态/低频任务/历史）——草稿在对应页签；CTA 经 go-tab 直达 -->
    <TaskPanel :req-id="card.id" :detail="d" :operator="operator"
               :tasks="tasks" :drafts="drafts" @reload="reloadPipe" @go-tab="switchTab"
               @toast="(m, t) => emit('toast', m, t)" @refresh="load" />

    <!-- v5（§1.1/D8）tab 分阶段分组：⁞ 前为发布前页签；置灰仅设计/门禁（变更承载 reconcile 通道、
         用例无守卫，均不置灰）。audit tab 已删除（并入澄清工作台） -->
    <div class="tabs" role="tablist" aria-label="需求页签">
      <button class="tab" role="tab" id="tab-origin" :aria-selected="tab === 'origin' ? 'true' : 'false'"
              aria-controls="tabpanel-origin" :tabindex="tab === 'origin' ? 0 : -1"
              :class="{ on: tab === 'origin' }" @click="switchTab('origin')"
              @keydown="onTabKey($event, 'origin')">原始需求</button>
      <button class="tab" role="tab" id="tab-digest" :aria-selected="tab === 'digest' ? 'true' : 'false'"
              aria-controls="tabpanel-digest" :tabindex="tab === 'digest' ? 0 : -1"
              :class="{ on: tab === 'digest' }" @click="switchTab('digest')"
              @keydown="onTabKey($event, 'digest')">
        需求摘要<span class="n draft" v-if="digestDraft" title="质检三件套草稿待采纳">!</span><span class="n num" v-else-if="d.digest">{{ d.frPoints.length }}</span></button>
      <button class="tab" role="tab" id="tab-checklist" :aria-selected="tab === 'checklist' ? 'true' : 'false'"
              aria-controls="tabpanel-checklist" :tabindex="tab === 'checklist' ? 0 : -1"
              :class="{ on: tab === 'checklist' }" @click="switchTab('checklist')"
              @keydown="onTabKey($event, 'checklist')">
        澄清工作台<span class="n num warn" v-if="totalQ - answered > 0">{{ totalQ - answered }}</span><span class="n" v-else-if="totalQ">✓</span></button>
      <button class="tab" role="tab" id="tab-std" :aria-selected="tab === 'std' ? 'true' : 'false'"
              aria-controls="tabpanel-std" :tabindex="tab === 'std' ? 0 : -1"
              :class="{ on: tab === 'std' }" @click="switchTab('std')"
              @keydown="onTabKey($event, 'std')">标准需求文档<span class="n draft" v-if="stdDraftVisible" title="标准文档草稿待发布">!</span></button>
      <div class="tab-phase" title="以下页签在需求发布后开启" aria-hidden="true"></div>
      <button class="tab" role="tab" id="tab-changes" :aria-selected="tab === 'changes' ? 'true' : 'false'"
              aria-controls="tabpanel-changes" :tabindex="tab === 'changes' ? 0 : -1"
              :class="{ on: tab === 'changes' }" @click="switchTab('changes')"
              @keydown="onTabKey($event, 'changes')">
        变更<span class="n draft" v-if="incDraft" title="增量合并草稿待采纳">!</span><span class="n num" v-if="chgCount">{{ chgCount }}</span></button>
      <button class="tab" role="tab" id="tab-cases" :aria-selected="tab === 'cases' ? 'true' : 'false'"
              aria-controls="tabpanel-cases" :tabindex="tab === 'cases' ? 0 : -1"
              :class="{ on: tab === 'cases' }" @click="switchTab('cases')"
              @keydown="onTabKey($event, 'cases')">
        用例<span class="n draft" v-if="casesDraft" title="测试用例草稿待登记">!</span><span class="n num" v-else-if="d.coverage && d.coverage.backward.total">{{ d.coverage.backward.total }}</span></button>
      <button class="tab" role="tab" id="tab-design" :aria-selected="tab === 'design' ? 'true' : 'false'"
              aria-controls="tabpanel-design" :tabindex="tab === 'design' && !postLocked ? 0 : -1"
              :class="{ on: tab === 'design', locked: postLocked }" :disabled="postLocked"
              :title="postLocked ? '发布后开启' : ''" @click="switchTab('design')"
              @keydown="onTabKey($event, 'design')">
        设计<AppIcon v-if="postLocked" name="lock" :size="11" class="lock-ico" /></button>
      <button class="tab" role="tab" id="tab-gate" :aria-selected="tab === 'gate' ? 'true' : 'false'"
              aria-controls="tabpanel-gate" :tabindex="tab === 'gate' && !postLocked ? 0 : -1"
              :class="{ on: tab === 'gate', locked: postLocked }" :disabled="postLocked"
              :title="postLocked ? '发布后开启' : ''" @click="switchTab('gate')"
              @keydown="onTabKey($event, 'gate')">
        门禁<AppIcon v-if="postLocked" name="lock" :size="11" class="lock-ico" />
        <span class="n num" v-if="!postLocked && gv && gv.round">{{ gv.round.status === 'released' ? '✓' : gv.round.roundNo + '轮' }}</span></button>
      <span class="tab-hint">体检报告已并入澄清工作台</span>
    </div>

    <!-- U-10：tabpanel 容器（id/aria-labelledby 随当前页签） -->
    <div class="tabpanel" role="tabpanel"
         :id="'tabpanel-' + tab" :aria-labelledby="'tab-' + tab">

    <!-- 原始需求：全文快照（D1）；v1.2 有块结构时结构化渲染（不堆叠/图片/锚点），否则 md 渲染降级；
         v4 窗口 1 块级编辑（保存后 @reload 壳层重拉 doc.json 刷新锚点）；平台评论角标 + 面板入口；
         v5 §4 待澄清反向角标（点击经 check: 跳转协议切工作台定位） -->
    <OriginTab v-if="tab === 'origin'" ref="originTabRef"
               :card="card" :snapshot="d.snapshot" :doc="d.doc" :active-head="activeHead"
               :doc-stale="!!d.docStale" :platform-by-block="cmByBlock" :pending-by-block="pendingByBlock"
               @locate="onLocate" @go-toc="goToc" @open-comments="id => openComments(id)"
               @clarify="seq => onJump({ kind: 'check', id: seq })"
               @toast="(m, t) => emit('toast', m, t)" @reload="load" />

    <!-- 结构化 Digest（v5 §3 重定位：AI 理解卡 + 泳道主流程 + 遗留假设独立卡）；
         v5.x 批2：质检三件套草稿态（预览+采纳）也归本页签 -->
    <DigestTab v-if="tab === 'digest'" ref="digestTabRef"
               :digest="d.digest" :fr-points="d.frPoints" :coverage="d.coverage" :fr-groups="frGroups"
               :items="d.items" :comment-anchor-map="commentAnchorMap" :draft="digestDraft"
               v-model:digest-md-open="digestMdOpen"
               @locate="onLocate" @jump="onJump"
               @toast="(m, t) => emit('toast', m, t)" @refresh="load" @reload="reloadPipe" />

    <!-- v5 澄清工作台（audit 已并入，D1）：作答/处置/已定论卡/影响分析/孤儿提示 + 原文侧栏；出处=评论
         → 右栏评论出处卡（组件内分流）；open-comment=打开完整面板（卡上「打开评论区」）；
         view-comment=只读回退（无右栏/悬空评论） -->
    <WorkbenchTab v-if="tab === 'checklist'" ref="workbenchTabRef" :req-id="card.id" :items="d.items" :status="card.status"
                  :active-head="activeHead" @go-toc="goToc"
                  :groups="checklistGroups" :audit="d.audit" :concluded-groups="concludedGroups"
                  :doc="d.doc" :snapshot="d.snapshot" :comment-anchor-map="commentAnchorMap"
                  :comments="cm?.comments || []" :block-text="cmBlockText"
                  @locate="onLocate" @jump="onJump" @open-comment="id => openComments('', id)"
                  @view-comment="id => openComments('', id, true)"
                  @open-origin="switchTab('origin')"
                  @toast="(m, t) => emit('toast', m, t)" />

    <!-- 标准需求文档：重写版（D6），四类引用可点击（D7）；v5.x 批2：草稿编辑与发布归本页签 -->
    <StdTab v-if="tab === 'std'" ref="stdTabRef" :standard="d.standard" :active-head="activeHead"
            :draft="stdDraftVisible ? stdDraft : null" :status="card.status"
            @jump="onJump" @go-toc="goToc" @toast="(m, t) => emit('toast', m, t)"
            @refresh="load" @reload="reloadPipe" />

    <!-- v4 变更单 tab：列表/draft（复用块编辑器）/confirm（diff+四类清单）/abort；
         v5.x 批2：增量合并草稿（采纳=机械合并）归本页签 -->
    <ChangesTab v-if="tab === 'changes'" ref="changesRef" :req-id="card.id" :card="card" :operator="operator"
                :blocks="docBlocks" :focus-id="chgFocus" :draft="incDraft"
                @toast="(m, t) => emit('toast', m, t)" @refresh="load" @reload="reloadPipe" />

    <!-- v2.4 用例 tab：需求内嵌用例表（与独立用例页同一组件，reqId 固定）；
         v5.x 批2：测试用例草稿（采纳登记）归本页签（draft 仅内嵌模式渲染） -->
    <CaseList v-if="tab === 'cases'" :fixed-req-id="card.id" :draft="casesDraft"
              @toast="(m, t) => emit('toast', m, t)" @refresh="load" @reload="reloadPipe" />

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
               @toast="(m, t) => emit('toast', m, t)" @refresh="load" @jump-change="openChange" />
      <EmptyState v-else icon="shield-check" title="门禁需求发布后开启"
                  desc="发布后开闸三条件（设计定稿∨轻量跳过 / 用例全部定稿 / FR 覆盖）全绿即可开评审" />
    </template>
    </div><!-- /tabpanel -->

    <!-- 回到顶部（长文阅读） -->
    <Transition name="fade">
      <button class="to-top" v-if="showTop" @click="toTop" title="回到顶部" aria-label="回到顶部">
        <AppIcon name="arrow-up" :size="15" />
      </button>
    </Transition>

    <!-- v4 评论面板（右侧抽屉，跨 tab 常驻）：locate 事件转发壳层定位协议（切到 origin 并锚块）；
         readonly=出处查看态（DigestTab 评论锚/工作台只读回退入口置位，「管理评论」可切回） -->
    <CommentsPanel v-if="cmtsOpen" ref="cmtsPanelRef" :req-id="card.id" :comments="cm?.comments || []"
                   :block-text="cmBlockText" :escalated-ids="escalatedIds"
                   :focus-id="cmtsFocus" :compose-block-id="cmtsComposeBlock" :readonly="cmtsReadonly"
                   @close="cmtsOpen = false" @refresh="onCmtsRefresh" @edit="cmtsReadonly = false"
                   @locate="id => { locate('', id) }"
                   @toast="(m, t) => emit('toast', m, t)" />
  </div>
  </div>
</template>

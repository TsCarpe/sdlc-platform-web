<script setup>
// 澄清工作台 tab（DESIGN-v5 §1/§2，由 ChecklistTab 升级——D19：tab 键名仍为 'checklist'，仅组件更名）。
// audit 合并（D1/D14）：audit 是 clarify 的超集，差集 ∧ go✅ 条目以「已定论」只读折叠组获得宿主
// （组名带「已定论·」前缀防与 check 组撞名联动，同状态机前缀先例）；audit 字段归宿——去向/关联
// 用例进问题卡「影响分析」折叠，audit.md 原文折叠挪页尾。作答/处置/三态筛选/跳转等既有能力全保留。
import { ref, reactive, computed, watch, nextTick, onBeforeUnmount } from 'vue'
import { api } from '../api.js'
import AppIcon from './AppIcon.vue'
import EmptyState from './EmptyState.vue'
import CtxPane from './CtxPane.vue'
import { render } from '../render.js'
import { firstQuote, flashEl, pidOf } from '../trace.js'
import { isDone, isPending, dispLabel } from '../disposition.js'
import { lvlLabel, lvlCls } from '../levels.js'
import { useGrpCollapse } from '../composables/group-collapse.js'

const props = defineProps({
  reqId: { type: String, required: true },
  items: { type: Array, default: () => [] },
  status: { type: String, default: '' },
  groups: { type: Array, default: () => [] },      // 壳层需求域分组（revealGrpFor 共用）
  audit: { type: Object, default: null },          // 体检产物（已定论/影响分析/孤儿行数据源）
  concludedGroups: { type: Array, default: () => [] },  // 壳层算好的已定论分组（差集∧✅，name 带「已定论·」前缀）
  doc: { type: Object, default: null },            // detail.doc（右栏原文侧栏数据——非产物，空态照常渲染）
  snapshot: { type: Object, default: null },       // 侧栏「依据版本」展示
})
const emit = defineEmits(['locate', 'jump', 'toast', 'open-comment', 'open-origin'])

const { openGrps, toggleGrp, expandAll, collapseAll, revealGrpFor } = useGrpCollapse()

const answered = computed(() => props.items.filter(isDone).length)
const totalQ = computed(() => props.items.length)
const prog = computed(() => totalQ.value ? Math.round(answered.value / totalQ.value * 100) : 0)
const allAnswered = computed(() => totalQ.value > 0 && answered.value === totalQ.value)

/** 组头副标题：澄清组带已答进度（模板内联） */
function answeredIn(items) { return (items || []).filter(isDone).length }

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
const ctxCollapsed = ref(false)
const gridStyle = computed(() => hasDoc.value && !ctxCollapsed.value
  ? { gridTemplateColumns: `minmax(0,1fr) ${ctxW.value}px` } : null)

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

/** 摘引/出处点击（左栏问题卡与已定论卡）：优先侧栏联动（不切 tab，§2.1）；
 *  无块结构（快照老卡）回退壳层 locate 协议（切 origin needle 定位） */
function locateInCtx(it) {
  if (!hasDoc.value) return emit('locate', firstQuote(it.quote) || it.ctx || it.title || it.where, it.anchor)
  ctxCollapsed.value = false
  nextTick(() => ctxRef.value?.locateCtx({
    seq: it.seq || pidOf(it.id), src: it.ctx || it.where || '', anchor: it.anchor || '',
    quote: it.quote || '', ctxText: it.ctx || it.where || ''
  }))
}
/** 反向角标点击（CtxPane 上抛）：滚回左栏对应问题并 flash（§4） */
function locateCheck(seq) {
  revealGrpFor('check', seq)
  nextTick(() => {
    const el = document.querySelector(`[data-pid="${seq}"]`)
    if (el) flashEl(el)
    else emit('toast', `未定位到 ${seq}（可能已被过滤隐藏）`, 'err')
  })
}

// ===== 澄清导航（三态筛选：全部/待处置/已处置）=====
const clfFilter = ref('all')   // 'all' | 'pending' | 'done'
const visibleCheckGroups = computed(() => {
  if (clfFilter.value === 'all') return props.groups
  const pred = clfFilter.value === 'pending' ? isPending : isDone
  return props.groups
    .map(g => ({ name: g.name, items: g.items.filter(pred) }))
    .filter(g => g.items.length)
})
const nextUnanswered = computed(() => props.items.find(isPending) || null)
watch(clfFilter, on => { if (on !== 'all') expandAll(props.groups) })   // 过滤视图下组不再折叠，待处置项直接可见
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

// ===== 答复：失焦自动保存 + 行内微状态（保存中/已保存） =====
const originAnswers = ref({})   // seq → 载入时的答复快照，未变更不重复保存
const ansState = ref({})        // seq → 'saving' | 'saved'

function autoGrow(e) {
  const el = e.target
  el.style.height = 'auto'
  el.style.height = el.scrollHeight + 'px'
}

// ===== v5 选择题化作答（§2.3，D16/D18）：点选即 PUT + per-seq 串行发送链（最后值胜） =====
// picked/extra 为独立本地态（textarea v-model 永不直绑 answer，r4#12）；一期 answer 写纯文本
// 【A】选项全文（+（补充：…））——二期结构化上线前所有下游消费的仍是合法纯文本（D18 零污染）。
const picked = reactive({})     // seq → optionKey（PUT 载荷内部标识——永不做回显匹配键，r4#11）
const extra = reactive({})      // seq → 补充说明文本（「以上都不对」自由输入）
const extraOpen = reactive({})  // seq → 补充说明 textarea 展开

/** PUT 装配（r4#12 全量装配、来源装配）：任一 PUT（点选或 blur）都装配完整 answer */
function assembleAnswer(it) {
  const key = picked[it.seq]
  if (key) {
    const opt = (it.options || []).find(o => o.key === key)
    const head = opt ? `【${key}】${opt.text}` : `【${key}】`
    const ex = (extra[it.seq] || '').trim()
    return ex ? `${head}（补充：${ex}）` : head
  }
  return (extra[it.seq] || '').trim()
}

// per-seq 串行发送链（D16）：同 seq 的 PUT 依次排队、前一个完成才发下一个——与 savingSeqs 的
// 「在途丢弃」语义相反（点选即 PUT 沿用会静默丢答）。makeBody 延迟到实际发送时装配：排队等待
// 期间值再变，轮到发送时取最新值（最后值胜）。处置确认与重开同链——防 set_disposition 三元组
// 整行覆写与在途作答 PUT 后到者胜（互斥条款 ③）。
const putChain = {}   // seq → Promise 链尾
function enqueuePut(seq, makeBody) {
  const run = async () => {
    await api.put(`/api/requirements/${props.reqId}/answers/${seq}`, makeBody())
  }
  putChain[seq] = (putChain[seq] ?? Promise.resolve()).catch(() => {}).then(run)
  return putChain[seq]
}

/** 点选即 PUT（无 debounce）：body 显式携带 {answer, status:'answered'}，不依赖服务端按非空推断 */
function pickOption(it, key) {
  if (disposeDlg.value) return            // 处置弹窗打开——选项点击抑制（互斥条款 ①）
  if (it.status === 'rejected' || it.status === 'deferred') return
  picked[it.seq] = key
  ansState.value[it.seq] = 'saving'
  enqueuePut(it.seq, () => ({ answer: assembleAnswer(it), status: 'answered' }))
    .then(() => {
      it.answer = assembleAnswer(it)      // 已答快照本地回写（与发送值同源装配）
      it.status = 'answered'
      originAnswers.value[it.seq] = it.answer
      ansState.value[it.seq] = 'saved'
      setTimeout(() => { if (ansState.value[it.seq] === 'saved') delete ansState.value[it.seq] }, 2500)
    })
    .catch(e => { delete ansState.value[it.seq]; emit('toast', '保存失败：' + e.message, 'err') })
}

/** 「以上都不对」补充说明失焦保存：沿用 savingSeqs 在途丢弃语义、不进发送链（§2.3）；
 *  装配仍是全量（picked 存在则 【A】…（补充：…）） */
async function saveExtra(it) {
  if (disposeDlg.value) return            // 处置弹窗打开——抑制该题 blur 保存（互斥条款 ②）
  const val = assembleAnswer(it)
  if (val === (originAnswers.value[it.seq] ?? '') || val === (it.answer || '')) return
  if (savingSeqs.has(it.seq)) return
  savingSeqs.add(it.seq)
  ansState.value[it.seq] = 'saving'
  try {
    await api.put(`/api/requirements/${props.reqId}/answers/${it.seq}`, { answer: val })
    it.answer = val
    it.status = val.trim() ? 'answered' : 'pending'
    originAnswers.value[it.seq] = val
    ansState.value[it.seq] = 'saved'
    setTimeout(() => { if (ansState.value[it.seq] === 'saved') delete ansState.value[it.seq] }, 2500)
  } catch (e) {
    delete ansState.value[it.seq]
    emit('toast', '保存失败：' + e.message, 'err')
  } finally {
    savingSeqs.delete(it.seq)
  }
}

const savingSeqs = new Set()   // per-seq 在途集：失焦重入防并发同 seq 双 PUT
async function saveAnswer(it) {
  if (disposeDlg.value) return            // 处置互斥：弹窗打开期间抑制失焦保存（§2.3）
  if ((it.answer || '') === (originAnswers.value[it.seq] ?? '')) return
  if (savingSeqs.has(it.seq)) return
  savingSeqs.add(it.seq)
  const sent = it.answer   // 发送时值快照——响应回来时输入已再变则不回写（乱序防旧覆新）
  ansState.value[it.seq] = 'saving'
  try {
    await api.put(`/api/requirements/${props.reqId}/answers/${it.seq}`, { answer: sent })
    if ((it.answer || '') === sent) {
      originAnswers.value[it.seq] = sent
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
    if (it) { it.status = dlg.status; it.note = dlg.note.trim() }
    disposeDlg.value = null
    emit('toast', `已${dlg.status === 'rejected' ? '驳回' : '挂起'}：${dlg.seq}`)
  } catch (e) {
    emit('toast', '处置失败：' + e.message, 'err')
  }
}

/** 重开：驳回/挂起/已答行转回待确认（后端保留已填 answer）；选项卡清 picked/extra——
 *  「重新作答 = 清空重选，不预选」（r4#11：不做选中态恢复，optionKey 不做回显匹配键） */
async function reopen(it) {
  try {
    await enqueuePut(it.seq, () => ({ answer: it.answer || '', status: 'pending' }))
    it.status = 'pending'
    it.note = ''
    delete picked[it.seq]
    delete extra[it.seq]
    emit('toast', `已重开 ${it.seq}，可继续作答`)
  } catch (e) {
    emit('toast', '重开失败：' + e.message, 'err')
  }
}
</script>

<template>
  <EmptyState v-if="!items.length && !audit" icon="inbox" title="质检产物尚未推送"
              desc="推送后此处为澄清工作台（问题作答 + 原文上下文）" />
  <template v-else>
    <!-- v5 工作台顶条：澄清进度 + 导航（wb-top 右卡形态，就绪度地图随 v1.6 layer 字段点亮） -->
    <div class="wb-top" v-if="status === 'clarifying' || status === 'changed'">
      <div class="wb-prog" :class="{ amber: status === 'changed' }">
        <div class="row1">
          <span class="lbl"><AppIcon name="info" :size="13" />{{ status === 'changed' ? '变更重开项重新处置' : '逐题作答（点选即保存）｜不是问题可驳回、本期不处理可挂起' }}</span>
          <span class="n"><b>{{ answered }}</b>/{{ totalQ }}</span>
        </div>
        <div class="bar"><div class="bar-fill" :style="{ width: prog + '%' }"></div></div>
        <div class="btns">
          <button class="btn small primary" v-if="nextUnanswered" @click="jumpNextUnanswered">
            <AppIcon name="arrow-up-right" :size="11" />跳到下一待处置</button>
          <button class="btn small" :class="{ on: clfFilter !== 'all' }" @click="clfFilter = clfFilter === 'all' ? 'pending' : (clfFilter === 'pending' ? 'done' : 'all')">
            {{ clfFilter === 'all' ? '只看待处置' : (clfFilter === 'pending' ? '只看已处置' : '显示全部') }}</button>
          <span class="sub" v-if="allAnswered"><AppIcon name="check-circle" :size="12" style="color:var(--green)" />全部处置完成，可生成标准文档</span>
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
    <div class="q-col">
    <!-- 左栏问题流：check 组（组内顶部挂同名已定论子折叠块，D14） -->
    <div class="grp" v-for="g in visibleCheckGroups" :key="g.name" :class="{ closed: !openGrps.has(g.name) }">
      <div class="grp-t" @click="toggleGrp(g.name)">
        <AppIcon name="chevron-right" :size="13" class="grp-chev" />{{ g.name }}
        <span class="cnt">{{ clfFilter !== 'all'
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
            <div class="ctx" v-if="a.where">出处：<a class="cite" :class="{ anchored: a.anchor }" @click="locateInCtx(a)">{{ a.where }}<span v-if="a.anchor" class="anchored-mark" title="块级锚点：点击直达原文条款"><AppIcon name="crosshair" :size="10" /></span></a> ｜ 去向：{{ a.go || '—' }}</div>
            <blockquote class="quote" v-if="a.quote">
              <span class="qlb">原文摘引 · <a class="cite" :class="{ anchored: a.anchor }" @click="locateInCtx(a)">在快照中定位<span v-if="a.anchor" class="anchored-mark"><AppIcon name="crosshair" :size="10" /></span></a></span>{{ a.quote }}
            </blockquote>
            <div class="ctx" v-if="(a.relatedCases || []).length" style="margin-top:6px">
              关联用例：<a class="chip linklike real" v-for="c in a.relatedCases" :key="c" @click="emit('jump', { kind: 'case', id: c })">{{ c }}</a>
            </div>
          </div>
        </div>
      </div>

      <div v-for="it in g.items" :key="it.seq" class="check-item" :class="it.level" :data-pid="it.seq">
        <div class="ci-head">
          <span class="badge" :class="lvlCls[it.level]">{{ lvlLabel[it.level] }}</span>
          <span class="chip">{{ it.seq }}</span>
          <!-- v4 origin 三族（§2/§6.3）：L 系来自评论升级（回链原讨论）；incremental 来自增量质检（变更后局部重检）；skill 来自体检报告 -->
          <button class="jump-link" v-if="it.origin === 'local'"
                  title="由评论升级而来——点击回看原讨论" @click="emit('open-comment', it.srcCommentId)">
            来自评论<span v-if="it.srcCommentId"> #{{ it.srcCommentId }}</span><AppIcon name="arrow-up-right" :size="11" /></button>
          <span class="jump-link" v-else-if="it.origin === 'incremental'" title="增量质检产生（变更单确认后的局部重检），处置后可重新发布">来自增量质检</span>
          <span class="jump-link" v-else title="来自体检报告同源条目">来自体检.{{ it.seq }}</span>
          <!-- v1.6 缺陷分层（可选）：层名待三期 dimensions.md 契约对齐，一期先 L<n> 数字标签 -->
          <span class="lvl-tag sub" v-if="it.layer" title="缺陷分层（v1.6 可选字段）">L{{ it.layer }}</span>
        </div>
        <div class="q">{{ it.question }}</div>
        <div class="ctx" v-if="it.ctx">出处：<a class="cite" :class="{ anchored: it.anchor }" @click="locateInCtx(it)">{{ it.ctx }}<span v-if="it.anchor" class="anchored-mark" title="块级锚点：点击直达原文条款"><AppIcon name="crosshair" :size="10" /></span></a></div>
        <blockquote class="quote" v-if="it.quote">
          <span class="qlb">原文摘引 · <a class="cite" :class="{ anchored: it.anchor }" @click="locateInCtx(it)">在快照中定位<span v-if="it.anchor" class="anchored-mark"><AppIcon name="crosshair" :size="10" /></span></a></span>{{ it.quote }}
        </blockquote>
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
          <template v-else>{{ it.answer || '（未处置，按原需求执行）' }}</template>
        </div>
        <div class="ans" v-else-if="(status === 'clarifying' || status === 'changed') && (it.status === 'rejected' || it.status === 'deferred')">
          <span class="lb">{{ dispLabel(it) }}<span v-if="it.note" class="sub">（{{ it.note }}）</span></span>
          <span class="sub">
            {{ it.status === 'rejected' ? '已认定不是问题，不进定稿' : '已转遗留假设，合成时记入 需求.Axx' }}
            <button class="btn small link" @click="reopen(it)">重新作答</button>
          </span>
        </div>
        <!-- v5 选择题化作答（§2.3）：pending = 选项区（AI 推荐常显理由）；answered = 全文快照 + 重新作答
             （清空重选不预选，r4#11）；无 options 卡走下方 textarea 降级 -->
        <div class="ans optans" v-else-if="(status === 'clarifying' || status === 'changed') && (it.options || []).length">
          <!-- 变更确认重开的项：原答复在 note——PM 需看到再重新作答 -->
          <div class="sub" v-if="it.status === 'pending' && it.note" style="width:100%;margin:2px 0">{{ it.note }}</div>
          <template v-if="it.status === 'answered'">
            <span class="lb">已答复（可修改）</span>
            <span class="saved" v-if="ansState[it.seq] === 'saved'"><AppIcon name="check-circle" :size="11" />已保存</span>
            <span class="saved" v-else-if="ansState[it.seq] === 'saving'" style="color:var(--muted)">保存中…</span>
            <div class="done-ans">
              <span class="txt">{{ it.answer }}</span>
              <button class="btn small link redo" @click="reopen(it)">重新作答</button>
            </div>
          </template>
          <template v-else>
            <div class="opts">
              <button v-for="o in it.options" :key="o.key" class="opt"
                      :class="{ rec: o.recommended, picked: picked[it.seq] === o.key }"
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
              <button class="more-answer" @click="extraOpen[it.seq] = !extraOpen[it.seq]">{{ extraOpen[it.seq] ? '收起补充说明 ▴' : '以上都不对，我要自己写 ▾' }}</button>
              <span class="saved" v-if="ansState[it.seq] === 'saved'"><AppIcon name="check-circle" :size="11" />已保存</span>
              <span class="saved" v-else-if="ansState[it.seq] === 'saving'" style="color:var(--muted)">保存中…</span>
            </div>
            <textarea v-if="extraOpen[it.seq]" v-model="extra[it.seq]" class="extra-ta"
                      :aria-label="it.seq + ' 补充说明'"
                      placeholder="补充说明：选「其他」时填写具体口径，将写入标准文档对应条款…"
                      @blur="saveExtra(it)" @input="autoGrow"></textarea>
          </template>
        </div>
        <div class="ans" v-else-if="status === 'clarifying' || status === 'changed'">
          <span class="lb" :class="{ warn: !it.answer }">{{ it.answer ? '答复（可修改）' : '待答复' }}</span>
          <span class="saved" v-if="ansState[it.seq] === 'saved'"><AppIcon name="check-circle" :size="11" />已保存</span>
          <span class="saved" v-else-if="ansState[it.seq] === 'saving'" style="color:var(--muted)">保存中…</span>
          <!-- 变更确认重开的项：原答复在 note（「因变更单#N 重开，原答复：…」）——PM 需看到再重新作答 -->
          <div class="sub" v-if="it.status === 'pending' && it.note" style="width:100%;margin:2px 0">{{ it.note }}</div>
          <textarea v-model="it.answer" :name="'clf-answer-' + it.seq" :aria-label="it.seq + ' 作答'" :placeholder="'PM 在此作答…'"
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

    <!-- 无匹配 check 组的已定论条目 → 独立顶层组（组集分叉兜底，r2 A1） -->
    <div class="grp concluded-grp" v-for="g in standaloneConcluded" :key="g.name" :class="{ closed: !openGrps.has(g.name) }">
      <div class="grp-t" @click="toggleGrp(g.name)">
        <AppIcon name="chevron-right" :size="13" class="grp-chev" />
        <AppIcon name="check-circle" :size="12" style="color:var(--green)" />{{ (g.raw || g.name) }} · 已定论
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
        <div class="ctx" v-if="a.where">出处：<a class="cite" :class="{ anchored: a.anchor }" @click="locateInCtx(a)">{{ a.where }}<span v-if="a.anchor" class="anchored-mark" title="块级锚点：点击直达原文条款"><AppIcon name="crosshair" :size="10" /></span></a> ｜ 去向：{{ a.go || '—' }}</div>
        <blockquote class="quote" v-if="a.quote">
          <span class="qlb">原文摘引 · <a class="cite" :class="{ anchored: a.anchor }" @click="locateInCtx(a)">在快照中定位<span v-if="a.anchor" class="anchored-mark"><AppIcon name="crosshair" :size="10" /></span></a></span>{{ a.quote }}
        </blockquote>
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
               :pending-by-block="pendingByBlock"
               @clarify="locateCheck" @collapse="ctxCollapsed = true"
               @locate="(s, a) => emit('locate', s, a)" @open-origin="emit('open-origin')" />
    </div>
    </div><!-- /wb-grid -->
    <button class="ctx-restore" v-if="hasDoc && ctxCollapsed" @click="ctxCollapsed = false">‹ 展开原文上下文</button>

    <!-- 孤儿行提示（r3 二审#1：编号权威分叉疑似行——不渲染卡，引导查原文） -->
    <div class="banner amber-t" v-if="orphanCount">
      <AppIcon name="alert-triangle" :size="14" />
      <span style="flex:1">⚠ {{ orphanCount }} 条体检条目未关联澄清项且无定论标记（可能编号漂移）——点开下方体检报告原文核对。</span>
    </div>

    <!-- 页尾：体检报告 markdown 折叠（自 AuditTab 迁入） -->
    <details class="card" v-if="audit?.markdown">
      <summary style="cursor:pointer;font-size:13px;color:var(--muted)">查看体检报告原文（markdown）</summary>
      <div class="doc" style="margin-top:10px" v-html="render(audit.markdown)"></div>
    </details>

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
  </template>
</template>

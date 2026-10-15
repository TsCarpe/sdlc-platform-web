<script setup>
// v2.0 任务面板：线上化流水线操作区——开始质检/生成标准文档/发布，任务状态轮询，AI 草稿人审两态
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { api } from '../api.js'
import AppIcon from './AppIcon.vue'
import { render, linkifyRefs } from '../render.js'
import { fmtRel, fmtDur } from '../time.js'
import { ask } from '../confirm.js'
import { isDone } from '../disposition.js'

const props = defineProps({ reqId: String, detail: Object, operator: { type: String, default: '' } })
const emit = defineEmits(['toast', 'refresh'])

const tasks = ref([])
const drafts = ref({})
const busy = ref(false)
const showDigestDraft = ref(false)
const stdMode = ref('edit')            // standard 草稿：edit | preview
const stdText = ref('')               // 编辑缓冲（失焦/切换时写回草稿）
const conflicts = ref(null)           // cases 采纳 409 明细
const casesExpanded = ref(false)       // 用例草稿表：越过限高后可展开全部

// ===== v2.2 状态化收敛：无进行中任务且无待审草稿时折叠为一行摘要（归还阅读空间） =====
const collapsed = ref(true)
const stdDraftVisible = computed(() => !!stdDraft.value && card.value.status !== 'published')
const effectiveCollapsed = computed(() =>
  collapsed.value && !activeTask.value && !digestDraft.value && !stdDraftVisible.value && !casesDraft.value && !incDraft.value)
function stageStatus(type) { return latestByType.value[type]?.status || '' }   // ''|done|failed
// v4 建卡自动导入阶段：仅当存在 source_import 任务记录才入列（老卡走 sdlc-sync 推送，无此环节）
const summaryStages = computed(() =>
  latestByType.value.source_import ? ['source_import', 'quality_check', 'standard_doc', 'case_gen'] : ['quality_check', 'standard_doc', 'case_gen'])
const latestTaskAt = computed(() => tasks.value[0]?.updatedAt || '')

/** 摘要态主操作（评测 P1-2/P1-9）：与展开态按钮的 disabled 条件同源——答完题后的关键动作不再藏进折叠区 */
const nextAction = computed(() => {
  if (busy.value || activeTask.value) return null
  if (card.value.status === 'submitted') {
    return { label: hasDigest.value ? '继续质检' : '开始质检', run: () => createTask('quality_check', hasDigest.value ? '重新质检' : '需求质检') }
  }
  // v4 changed：重开项答完 → 生成标准文档 → 草稿一致流发布
  if ((card.value.status === 'clarifying' || card.value.status === 'changed') && allAnswered.value && !stdDraft.value) {
    return { label: '生成标准文档', run: () => createTask('standard_doc', '标准文档合成') }
  }
  // v4 增量未采纳：发布会被「未消化」守卫堵——引导先采纳
  if (incDraft.value) return { label: '先采纳增量合并', run: () => { collapsed.value = false } }
  // v4 changed 死锁逃生：增量草稿被丢弃/增量任务终局失败后影响面无人消化（无自动重排）——
  // 手动补排增量质检（后端守卫 changed ∧ confirmed 单 ∧ 影响面非空）
  if (card.value.status === 'changed' && !stdDraft.value) {
    return { label: '重排增量质检', run: () => createTask('incremental_check', '增量质检') }
  }
  if (card.value.status === 'changed' && stdDraft.value) {
    return { label: '从草稿预览发布', run: publishStd }
  }
  return null
})

const statusLabel = { queued: '排队中', running: '执行中', done: '已完成', failed: '失败' }
// v4.14 增量质检任务入列呈现；v2.4：设计/门禁任务也经此面板展示（执行态归面板，领域态归 design/gate tab）
const typeLabel = { source_import: '原文导入', quality_check: '需求质检', standard_doc: '标准文档合成', case_gen: '用例生成', design_gen: '技术设计生成', design_rev: '设计修订', gate_review: '门禁评审', incremental_check: '增量质检' }
const draftLabel = { digest_bundle: '质检三件套草稿', standard: '标准需求文档草稿', cases: '测试用例草稿', design: '技术设计草稿', gate_issues: '门禁 issues 草稿', incremental_bundle: '增量合并草稿' }

const card = computed(() => props.detail?.card || {})
const items = computed(() => props.detail?.items || [])
// v2.2 处置口径（DESIGN-v2.2 D25）：驳回/挂起计入已处置——与后端 counts/TaskService 守卫同源，防口径漂移禁用主操作
const answered = computed(() => items.value.filter(isDone).length)
const allAnswered = computed(() => items.value.length > 0 && answered.value === items.value.length)
const hasDigest = computed(() => !!props.detail?.digest)

const activeTask = computed(() => tasks.value.find(t => t.status === 'queued' || t.status === 'running') || null)
const autoBy = t => (t.createdBy || '').startsWith('auto')   // v2.1 L2 自动编排任务标记
const latestByType = computed(() => {
  const m = {}
  for (const t of tasks.value) if (!m[t.type]) m[t.type] = t   // 列表 id 倒序，首个即最新
  return m
})
const digestDraft = computed(() => drafts.value.digest_bundle || null)
const stdDraft = computed(() => drafts.value.standard || null)
const casesDraft = computed(() => drafts.value.cases || null)
// ===== v4.14 增量合并草稿（采纳 = 服务端机械合并；预览 = 受影响章节 + 新旧行对照 + 作废清单） =====
const incDraft = computed(() => drafts.value.incremental_bundle || null)
const incBundle = computed(() => {
  if (!incDraft.value) return null
  try { return JSON.parse(incDraft.value.contentJson || '{}') } catch { return null }
})
/** 章节区块 heading 文本解析（sections 存 heading blockId，禁 seq——§7 注意事项 6） */
const docBlks = computed(() => props.detail?.doc?.content?.blocks || [])
function headingText(id) {
  const b = docBlks.value.find(x => x.id === id)
  return b ? (b.text || id) : id
}
const incStats = computed(() => {
  const p = incBundle.value
  if (!p) return []
  const r = p.digestRows || {}
  const inv = p.invalidate || {}
  const out = [
    ['章节', (p.sections || []).length],
    ['摘要行', (r.features || []).length + (r.flows || []).length + (r.states || []).length],
    ['体检条目', (r.auditItems || []).length],
    ['FR', `+${(r.frUpserts || []).length}/-${(r.frRemoves || []).length}`],
    ['新澄清', (p.clarify?.items || []).length],
    ['作废', (inv.digestAnchors || []).length + (inv.auditIds || []).length]
  ]
  return out
})
/** 增量行展示文本（行形状随产物而异，取惯用键回退） */
function rowText(r) {
  return r.name || r.title || r.text || r.summary || r.question || JSON.stringify(r).slice(0, 60)
}
const ROW_KIND_LABEL = { features: '功能点', flows: '流程', states: '状态', auditItems: '体检', frUpserts: '需求点' }
const incRows = computed(() => {
  const r = incBundle.value?.digestRows || {}
  const out = []
  for (const [key, label] of Object.entries(ROW_KIND_LABEL)) {
    for (const row of r[key] || []) {
      if (key === 'frUpserts') continue   // FR upsert 展示为 id+name 单列（含 anchor）
      out.push({ kindLabel: label, text: rowText(row), anchor: row.anchor || '' })
    }
  }
  return out
})
const frRemoves = computed(() => incBundle.value?.digestRows?.frRemoves || [])
const invalidates = computed(() => [
  ...(incBundle.value?.invalidate?.digestAnchors || []),
  ...(incBundle.value?.invalidate?.auditIds || [])
])
const incClarify = computed(() => incBundle.value?.clarify?.items || [])
async function approveInc() {
  if (!await ask({
    title: '采纳增量合并草稿？',
    body: '服务端机械合并（受影响章节区间整组替换）：digest/体检/FR/机器澄清按区间更新，本地澄清（L 系）永不动；合并完成即可重新发布。',
    confirmText: '采纳（合并）'
  })) return
  busy.value = true
  try {
    const r = await api.post(`/api/requirements/${props.reqId}/drafts/incremental_bundle/approve`,
      { by: props.operator || '增量采纳' })
    emit('toast', `增量合并完成：移除 ${r.removedRows} 行 / 写入 ${r.newRows} 行，digest 已刷新——可重新发布`)
    emit('refresh')
    loadDrafts()
  } catch (e) { emit('toast', '采纳失败：' + e.message, 'err') }
  finally { busy.value = false }
}

// digest 草稿统计：优先任务 result 摘要，回退解析 contentJson
const digestStats = computed(() => {
  if (!digestDraft.value) return []
  const out = []
  try {
    const p = JSON.parse(digestDraft.value.contentJson || '{}')
    out.push(['澄清问题', (p.items || []).length], ['需求点', (p.digest?.fr_points || []).length])
    if (p.snapshot?.md) out.push(['快照', Math.round(p.snapshot.md.length / 1024) + 'KB'])
    if (p.doc) out.push(['原文块', (p.doc.blocks || []).length], ['媒体', (p.doc.media || []).length])
    if (p.audit) out.push(['体检问题', (p.audit.items || []).length])
  } catch { /* contentJson 坏值 → 无统计 */ }
  return out
})
const digestDraftHtml = computed(() => {
  if (!digestDraft.value || !showDigestDraft.value) return ''
  try {
    const p = JSON.parse(digestDraft.value.contentJson || '{}')
    return render(p.digest?.md || digestDraft.value.md || '')
  } catch { return '' }
})
const casesRows = computed(() => {
  try { return JSON.parse(casesDraft.value?.contentJson || '{}').items || [] } catch { return [] }
})
const stdPreviewHtml = computed(() => linkifyRefs(render(stdText.value || stdDraft.value?.md || '')))

let loadGen = 0   // 请求代次号：reqId 切换/整体重装载时自增——迟到的旧响应整体丢弃（防过期回写）
async function loadTasks() {
  const g = loadGen
  try {
    const list = await api.get(`/api/tasks?req_id=${props.reqId}`)
    if (g === loadGen) tasks.value = list
  } catch { /* 轮询失败保旧态，下次 tick 重试 */ }
}
async function loadDrafts() {
  const g = loadGen
  try {
    const list = await api.get(`/api/requirements/${props.reqId}/drafts`)
    if (g !== loadGen) return
    const m = {}
    for (const x of list) m[x.type] = x
    // standard 草稿首次载入或被外部重写时同步编辑缓冲
    if (m.standard && stdText.value !== m.standard.md && (!stdDraft.value || stdDraft.value.updatedAt !== m.standard.updatedAt)) {
      stdText.value = m.standard.md
    }
    drafts.value = m
  } catch { /* 草稿拉取失败保持现状（轮询补齐） */ }
}
function reloadAll() { loadGen++; loadTasks(); loadDrafts() }

let timer = null
const KNOWN = {}
/** 轮询单次：页面不可见时跳过（省无效读放大），恢复可见由 visibilitychange 立即补一次 */
async function tick() {
  if (document.hidden) return
  const g = loadGen
  const before = {}
  for (const [k, t] of Object.entries(KNOWN)) before[k] = t
  try {
    const list = await api.get(`/api/tasks?req_id=${props.reqId}`)
    if (g !== loadGen) return   // 重装载已发起——本轮响应过期
    // 有任务从 queued/running 变为终态 → 刷新草稿；source_import 完成 → 块表已落库，上抛壳层重拉 doc.json
    for (const t of list) {
      if (before[t.id] && before[t.id] !== t.status && (t.status === 'done' || t.status === 'failed')) loadDrafts()
      if (before[t.id] && before[t.id] !== t.status && t.type === 'source_import' && t.status === 'done') emit('refresh')
      KNOWN[t.id] = t.status
    }
    tasks.value = list
  } catch { /* 轮询失败保旧态，下次 tick 重试 */ }
}
function onVis() { if (!document.hidden) tick() }
onMounted(async () => {
  await reloadAll()
  timer = setInterval(tick, 4000)
  document.addEventListener('visibilitychange', onVis)
})
onBeforeUnmount(() => {
  clearInterval(timer)
  document.removeEventListener('visibilitychange', onVis)
})
watch(() => props.reqId, reloadAll)

async function createTask(type, label) {
  if (!await ask({
    title: `创建「${label}」任务`,
    body: 'Runner 将在后台执行，产物以草稿形式回传待你确认。',
    confirmText: '创建任务'
  })) return
  busy.value = true
  try {
    await api.post(`/api/requirements/${props.reqId}/tasks`, { type })
    emit('toast', `${label}任务已创建，等待 Runner 执行`)
    collapsed.value = false
    reloadAll()
  } catch (e) { emit('toast', '创建失败：' + e.message, 'err') }
  finally { busy.value = false }
}
async function retryTask(t) {
  try { await api.post(`/api/tasks/${t.id}/retry`); emit('toast', '任务已重新排队'); reloadAll() }
  catch (e) { emit('toast', '重试失败：' + e.message, 'err') }
}
async function cancelTask(t) {
  try { await api.post(`/api/tasks/${t.id}/cancel`); reloadAll() }
  catch (e) { emit('toast', '取消失败：' + e.message, 'err') }
}

async function approveDigest() {
  if (!await ask({
    title: '采纳质检三件套草稿？',
    body: '采纳后进入「待澄清」，PM 可在平台上作答。（重推将按 P 编号保留已答内容）',
    confirmText: '采纳'
  })) return
  busy.value = true
  try {
    const r = await api.post(`/api/requirements/${props.reqId}/drafts/digest_bundle/approve`)
    emit('toast', `已采纳：${r.items} 问 / ${r.frPoints} 需求点${r.carriedAnswers ? `，保留答复 ${r.carriedAnswers} 条` : ''}`)
    showDigestDraft.value = false
    emit('refresh')
    loadDrafts()
  } catch (e) { emit('toast', '采纳失败：' + e.message, 'err') }
  finally { busy.value = false }
}

async function saveStdDraft() {
  try {
    await api.put(`/api/requirements/${props.reqId}/drafts/standard`, { md: stdText.value })
    emit('toast', '草稿已保存')
    loadDrafts()
  } catch (e) { emit('toast', '保存失败：' + e.message, 'err') }
}
/**
 * 发布（终态）。clarifying 老流（verify-m2 锁死）：无草稿前置可直推编辑内容（软守卫明示差异）。
 * v4 changed 分支（§5 发布双重守卫）：只走「从草稿预览发布」——提交内容 = 草稿逐字节一致
 * （哈希比对守卫），不提供编辑；未消化变更单 409 → 指引增量采纳。
 */
async function publishStd() {
  if (card.value.status === 'changed') {
    if (!stdDraft.value) {
      emit('toast', '变更中发布须先「生成标准文档」并以草稿为准（草稿一致守卫）', 'err')
      return
    }
    if (!await ask({
      title: '从草稿预览发布标准需求文档？',
      body: '变更后的发布以草稿为唯一内容源（逐字节一致校验）；发布前须无未消化变更单、增量草稿已采纳。',
      danger: true, confirmText: '确认发布'
    })) return
    busy.value = true
    try {
      await api.post(`/api/requirements/${props.reqId}/publish`, { standardMd: stdDraft.value.md })
      emit('toast', '已重新发布 ✓ 标准需求文档回终态（content_rev 保留）')
      emit('refresh')
      loadDrafts()
    } catch (e) {
      if ((e.message || '').includes('未消化')) emit('toast', e.message + '——请先在流水线采纳增量合并草稿；若草稿已丢弃，用「增量质检」按钮重排', 'err')
      else emit('toast', '发布失败：' + e.message, 'err')
    } finally { busy.value = false }
    return
  }
  const md = stdText.value || stdDraft.value?.md || ''
  const drift = !!stdDraft.value && !!stdText.value.trim()
    && stdText.value.trim() !== (stdDraft.value.md || '').trim()
  const ok = drift
    ? await ask({
        title: '编辑内容与 AI 草稿存在差异',
        body: `编辑框 ${stdText.value.trim().length} 字 / AI 草稿 ${(stdDraft.value.md || '').trim().length} 字，将以编辑框内容发布。\n首处分歧行：${firstDriftLine(stdText.value, stdDraft.value.md || '')}`,
        confirmText: '仍以编辑内容发布'
      })
    : await ask({
        title: '发布标准需求文档？',
        body: '发布是终态动作：答复将锁定、产物拒绝重推、快照冻结。',
        danger: true,
        confirmText: '确认发布'
      })
  if (!ok) return
  busy.value = true
  try {
    await api.post(`/api/requirements/${props.reqId}/publish`, { standardMd: md })
    emit('toast', '已发布 ✓ 标准需求文档进入终态')
    emit('refresh')
    loadDrafts()
  } catch (e) { emit('toast', '发布失败：' + e.message, 'err') }
  finally { busy.value = false }
}

/** 首处分歧行（简易行 diff：跳过公共前缀行，取编辑侧的第一行）——预览用，非精确 diff */
function firstDriftLine(a, b) {
  const la = a.split('\n'), lb = b.split('\n')
  let i = 0
  while (i < la.length && i < lb.length && la[i] === lb[i]) i++
  const line = (la[i] || '').trim()
  return line ? line.slice(0, 40) : '（空行）'
}

async function approveCases(force) {
  if (!force && !await ask({
    title: '采纳测试用例草稿并登记？',
    body: 'sdlc-test 来源为全量替换语义：不在本次草稿中的 sdlc-test 用例将被同步删除（含评论）。',
    confirmText: '采纳登记'
  })) return
  busy.value = true
  conflicts.value = null
  try {
    const r = await api.post(`/api/requirements/${props.reqId}/drafts/cases/approve`)
    emit('toast', `用例已登记：新增 ${r.inserted} / 更新 ${r.updated}` + (r.idWarnings?.length ? `；⚠ ${r.idWarnings.join('；')}` : ''))
    emit('refresh')
    loadDrafts()
  } catch (e) {
    if (e.data?.conflicts) {
      conflicts.value = e.data.conflicts
      emit('toast', '用例版本冲突：平台上有人更新过，请裁决', 'err')
    } else emit('toast', '登记失败：' + e.message, 'err')
  }
  finally { busy.value = false }
}
async function forceCases() {
  // 覆盖重推：剥掉 expectedVersion 后重写草稿再采纳
  try {
    const p = JSON.parse(casesDraft.value.contentJson)
    for (const it of p.items || []) delete it.expectedVersion
    await api.put(`/api/requirements/${props.reqId}/drafts/cases`, { contentJson: JSON.stringify(p) })
    await approveCases(true)
  } catch (e) { emit('toast', '覆盖失败：' + e.message, 'err') }
}
async function dropDraft(type) {
  // incremental_bundle 专用后果说明（P1 修复配套）：changed 卡丢弃后无自动重排——影响面
  // 未消化堵发布，须手动重排增量质检（本区「增量质检」按钮）
  const warn = type === 'incremental_bundle' && card.value.status === 'changed'
    ? '变更中丢弃增量草稿后影响面仍未消化——须重排「增量质检」重新生成，否则无法重新发布。'
    : ''
  if (!await ask({ title: `丢弃${draftLabel[type]}？`, body: `丢弃后如需该产物须重新生成对应任务。${warn}`, danger: true, confirmText: '丢弃' })) return
  try { await api.del(`/api/requirements/${props.reqId}/drafts/${type}`); conflicts.value = null; emit('toast', '草稿已丢弃'); loadDrafts() }
  catch (e) { emit('toast', '丢弃失败：' + e.message, 'err') }
}

/** 值格式化：对象/嵌套结构序列化展示，避免 [object Object] 直插模板（anchors={"hit":3,"miss":0}） */
function fmtVal(v) { return v !== null && typeof v === 'object' ? JSON.stringify(v) : String(v) }
/** 失败信息结构化读取（评测 P1-1）：error 结论 / hint 下一步 / diag 原始诊断 / reason 机器码；旧格式（纯文本）原样降级 */
function failInfo(t) {
  const plain = String(t.result || '').replace(/\s+/g, ' ').slice(0, 200)
  try {
    const o = JSON.parse(t.result || '{}')
    if (typeof o !== 'object' || o === null) return { error: plain, hint: '', diag: '', reason: '' }
    return {
      error: String(o.error ?? '').replace(/\s+/g, ' ').slice(0, 200) || plain,
      hint: o.hint || '', diag: o.diag || '', reason: o.reason || ''
    }
  } catch { return { error: plain, hint: '', diag: '', reason: '' } }
}
function fmtResult(t) {
  try {
    const o = JSON.parse(t.result || '{}')
    if (typeof o !== 'object' || o === null) return String(t.result || '').slice(0, 110)
    return Object.entries(o).map(([k, v]) => `${k}=${fmtVal(v)}`).join(' · ').slice(0, 110)
  } catch { return String(t.result || '').slice(0, 110) }
}
/** v2.2：title 悬停看全量统计（截断不再吞数据） */
function fmtResultFull(t) {
  try {
    const o = JSON.parse(t.result || '{}')
    if (typeof o !== 'object' || o === null) return String(t.result || '')
    return Object.entries(o).map(([k, v]) => `${k}=${fmtVal(v)}`).join(' · ')
  } catch { return String(t.result || '') }
}
function elapsed(t) {
  if (!t.updatedAt) return ''
  return fmtDur(Date.now() - new Date(t.updatedAt.replace(' ', 'T') + '+08:00').getTime())
}
</script>

<template>
  <div class="card taskpanel">
    <!-- 摘要态：无进行中任务且无待审草稿（点击展开管理）；主操作常驻可达（评测 P1-2/P1-9） -->
    <div class="tp-summary" v-if="effectiveCollapsed" @click="collapsed = false" role="button" tabindex="0"
         @keydown.enter="collapsed = false">
      <div class="tp-title"><AppIcon name="layers" :size="15" />线上流水线</div>
      <div class="tp-stages">
        <span class="tp-stage" v-for="ty in summaryStages" :key="ty">
          <i class="st-dot" :class="stageStatus(ty)"></i>{{ typeLabel[ty] }}
        </span>
      </div>
      <button class="btn small primary tp-next" v-if="nextAction"
              :title="card.status === 'submitted' ? '需求尚未质检——点击启动流水线' : '澄清已全部答完——点击生成标准文档'"
              @click.stop="nextAction.run()"><AppIcon name="play" :size="12" />{{ nextAction.label }}</button>
      <span class="sub" v-if="latestTaskAt" :title="latestTaskAt">最近 {{ fmtRel(latestTaskAt) }}</span>
      <button class="btn small tp-expand"><AppIcon name="chevron-down" :size="13" />展开管理</button>
    </div>

    <template v-else>
    <div class="tp-row">
      <div class="tp-title"><AppIcon name="layers" :size="15" />线上流水线</div>
      <button class="btn small link tp-collapse" v-if="!activeTask && !digestDraft && !stdDraftVisible && !casesDraft"
              @click="collapsed = true" title="无进行中任务与待审草稿，可收起为摘要"><AppIcon name="chevron-right" :size="13" style="transform:rotate(-90deg)" />收起</button>
      <div class="tp-actions">
        <button class="btn" :disabled="busy || !!activeTask || card.status === 'published'"
                @click="createTask('quality_check', hasDigest ? '重新质检' : '需求质检')">
          <AppIcon name="search" :size="13" />{{ hasDigest ? '重新质检' : '开始质检' }}
        </button>
        <button class="btn" :disabled="busy || !!activeTask || (card.status !== 'clarifying' && card.status !== 'changed') || !allAnswered"
                :title="(card.status !== 'clarifying' && card.status !== 'changed') ? '待澄清/变更中状态才可生成' : (!allAnswered ? `尚有 ${items.length - answered} 问未答复` : '')"
                @click="createTask('standard_doc', '标准文档合成')">
          <AppIcon name="file-text" :size="13" />生成标准文档
        </button>
        <button class="btn" :disabled="busy || !!activeTask || !hasDigest"
                title="基于质检产物生成测试用例（发布前后均可）"
                @click="createTask('case_gen', '用例生成')">
          <AppIcon name="clipboard-list" :size="13" />生成用例
        </button>
        <button class="btn" v-if="card.status === 'changed'" :disabled="busy || !!activeTask"
                title="变更后影响面的增量梳理（L2 自动排不上/草稿被丢弃时的人工逃生门）"
                @click="createTask('incremental_check', '增量质检')">
          <AppIcon name="refresh-cw" :size="13" />增量质检
        </button>
      </div>
    </div>

    <!-- 任务状态 -->
    <div class="tp-task tp-empty" v-if="!tasks.length">
      <span class="sub">{{ card.status === 'submitted'
        ? '尚未启动流水线——推送产物（sdlc-sync）或点击上方「开始质检」。'
        : '暂无任务记录。' }}</span>
    </div>
    <div class="tp-task" v-if="activeTask">
      <span class="spin"></span>
      <b>{{ typeLabel[activeTask.type] }}</b><span class="chip" v-if="autoBy(activeTask)">自动</span> {{ statusLabel[activeTask.status] }}
      <span class="sub">{{ activeTask.runner || '' }} · 已 {{ elapsed(activeTask) }}</span>
      <button class="btn small link" v-if="activeTask.status === 'queued'" @click="cancelTask(activeTask)">取消</button>
    </div>
    <div class="tp-task" v-for="t in [latestByType.source_import, latestByType.quality_check, latestByType.standard_doc, latestByType.case_gen].filter(x => x && x.status !== 'queued' && x.status !== 'running')" :key="t.id">
      <span class="badge" :class="t.status === 'done' ? 'b-green' : (failInfo(t).reason === 'superseded-by-publish' ? 'b-gray' : 'b-red')">{{ t.status === 'done' ? statusLabel.done : (failInfo(t).reason === 'superseded-by-publish' ? '已作废' : statusLabel.failed) }}</span>
      <b>{{ typeLabel[t.type] }}</b><span class="chip" v-if="autoBy(t)">自动</span>
      <span class="sub" v-if="t.status === 'done'" :title="fmtResultFull(t)">{{ fmtResult(t).startsWith('drainedBy') ? '（校验用）' : fmtResult(t) }}</span>
      <template v-else>
        <span class="sub err" :title="t.result">{{ failInfo(t).error }}</span>
        <details class="tp-fail-detail" v-if="failInfo(t).hint || failInfo(t).diag">
          <summary>详情</summary>
          <div class="tp-fail-body">
            <p class="hint" v-if="failInfo(t).hint">{{ failInfo(t).hint }}</p>
            <pre class="diag" v-if="failInfo(t).diag">{{ failInfo(t).diag }}</pre>
          </div>
        </details>
      </template>
      <button class="btn small" v-if="t.status === 'failed' && failInfo(t).reason !== 'superseded-by-publish'" @click="retryTask(t)"><AppIcon name="refresh-cw" :size="11" />重试</button>
    </div>

    <!-- 质检草稿 -->
    <div class="tp-draft" v-if="digestDraft">
      <div class="tp-draft-h">
        <span class="badge b-amber">待确认</span><b>{{ draftLabel.digest_bundle }}</b>
        <span class="chip" v-for="[k, v] in digestStats" :key="k">{{ k }} {{ v }}</span>
      </div>
      <details :open="showDigestDraft" @toggle="showDigestDraft = $event.target.open">
        <summary>预览摘要正文</summary>
        <div class="doc tp-preview" v-html="digestDraftHtml"></div>
      </details>
      <div class="tp-btns">
        <button class="btn primary" :disabled="busy" @click="approveDigest"><AppIcon name="check-circle" :size="13" />采纳（进入待澄清）</button>
        <button class="btn danger" :disabled="busy" @click="dropDraft('digest_bundle')">丢弃</button>
      </div>
    </div>

    <!-- v4 增量合并草稿（changed 流程）：章节 + 新旧行对照 + 作废清单 → 采纳机械合并 -->
    <div class="tp-draft" v-if="incDraft">
      <div class="tp-draft-h">
        <span class="badge b-amber">待确认</span><b>{{ draftLabel.incremental_bundle }}</b>
        <span class="chip" v-if="incBundle?.changeId">变更单 #{{ incBundle.changeId }}</span>
        <span class="chip" v-for="[k, v] in incStats" :key="k">{{ k }} {{ v }}</span>
        <span class="chip" v-if="incBundle?.riskTier">风险 {{ incBundle.riskTier }}</span>
      </div>
      <div class="inc-preview" v-if="incBundle">
        <div class="inc-sec" v-if="(incBundle.sections || []).length">
          <span class="lb">受影响章节</span>
          <span class="chip" v-for="s in incBundle.sections" :key="s">{{ headingText(s) }}</span>
        </div>
        <div class="inc-sec" v-if="incBundle.summary">
          <span class="lb">增量摘要</span><span>{{ incBundle.summary }}</span>
        </div>
        <table class="table inc-table" v-if="incRows.length">
          <thead><tr><th style="width:88px">类别</th><th>新增行</th><th style="width:150px">锚点</th></tr></thead>
          <tbody><tr v-for="(r, i) in incRows" :key="i">
            <td><span class="chip">{{ r.kindLabel }}</span></td>
            <td>{{ r.text }}</td>
            <td class="sub"><code>{{ r.anchor || '—' }}</code></td>
          </tr></tbody>
        </table>
        <div class="inc-sec" v-if="frRemoves.length || invalidates.length">
          <span class="lb">移除 / 作废</span>
          <span class="chip warn" v-for="x in frRemoves" :key="'fr' + x">FR {{ x }}</span>
          <span class="chip warn" v-for="x in invalidates" :key="x"><code>{{ x }}</code></span>
        </div>
        <div class="inc-sec" v-if="incClarify.length">
          <span class="lb">新增澄清（机器行，可作答处置）</span>
          <div class="inc-clr" v-for="(c, i) in incClarify" :key="i">
            <span class="chip">{{ c.anchor || '卡' }}</span>{{ c.question || rowText(c) }}
          </div>
        </div>
      </div>
      <div class="sub" v-else style="padding:4px 0">增量包内容不可解析（contentJson 非法）。</div>
      <div class="tp-btns">
        <button class="btn primary" :disabled="busy" @click="approveInc"><AppIcon name="check-circle" :size="13" />采纳（服务端机械合并）</button>
        <button class="btn danger" :disabled="busy" @click="dropDraft('incremental_bundle')">丢弃</button>
      </div>
    </div>

    <!-- 标准文档草稿（published 后隐藏：终态即无草稿动作）；changed 下只读预览发布（草稿一致守卫） -->
    <div class="tp-draft" v-if="stdDraft && card.status !== 'published'">
      <div class="tp-draft-h">
        <span class="badge" :class="card.status === 'changed' ? 'b-blue' : 'b-amber'">{{ card.status === 'changed' ? '待重新发布' : '待发布' }}</span>
        <b>{{ draftLabel.standard }}</b>
        <span class="sub" v-if="card.status === 'changed'">变更中发布以草稿为唯一内容源（逐字节一致），不可手改</span>
      </div>
      <template v-if="card.status === 'changed'">
        <div class="doc tp-preview" v-html="stdPreviewHtml"></div>
        <div class="tp-btns">
          <button class="btn primary" :disabled="busy" @click="publishStd"><AppIcon name="send" :size="13" />从草稿预览发布（终态）</button>
          <button class="btn danger" :disabled="busy" @click="dropDraft('standard')">丢弃</button>
        </div>
      </template>
      <template v-else>
        <div class="tp-modes">
          <button class="btn small" :class="{ 'tp-on': stdMode === 'edit' }" @click="stdMode = 'edit'">编辑</button>
          <button class="btn small" :class="{ 'tp-on': stdMode === 'preview' }" @click="stdMode = 'preview'">渲染预览</button>
          <span class="sub" style="flex:1"></span>
          <button class="btn small" @click="saveStdDraft"><AppIcon name="pencil" :size="11" />保存草稿</button>
        </div>
        <textarea v-if="stdMode === 'edit'" class="tp-editor" v-model="stdText" spellcheck="false"></textarea>
        <div v-else class="doc tp-preview" v-html="stdPreviewHtml"></div>
        <div class="tp-btns">
          <button class="btn primary" :disabled="busy" @click="publishStd"><AppIcon name="send" :size="13" />发布（终态锁定）</button>
          <button class="btn danger" :disabled="busy" @click="dropDraft('standard')">丢弃</button>
        </div>
      </template>
    </div>

    <!-- 用例草稿 -->
    <div class="tp-draft" v-if="casesDraft">
      <div class="tp-draft-h"><span class="badge b-amber">待登记</span><b>{{ draftLabel.cases }}</b><span class="chip">{{ casesRows.length }} 条</span>
        <button class="btn small link" v-if="casesRows.length > 8" @click="casesExpanded = !casesExpanded">
          {{ casesExpanded ? '收起列表' : '展开全部' }}</button>
      </div>
      <div class="tablewrap tp-cases" :class="{ open: casesExpanded }">
        <table class="table"><thead><tr><th style="width:90px">编号</th><th>标题</th><th style="width:200px">关联需求点</th><th style="width:180px">重点验证</th></tr></thead>
          <tbody><tr v-for="c in casesRows" :key="c.id">
            <td><code>{{ c.id }}</code></td><td>{{ c.title }}</td>
            <td class="sub">{{ (c.points || []).join('、') || '—' }}</td>
            <td class="sub">{{ (c.verifyRefs || []).join('、') || '—' }}</td>
          </tr></tbody></table>
      </div>
      <div class="banner" v-if="conflicts" style="margin-top:8px">
        <AppIcon name="alert-triangle" :size="14" />
        <span style="flex:1">版本冲突：{{ conflicts.map(c => `${c.id}（平台 v${c.currentVersion} / 草稿 v${c.expectedVersion}）`).join('、') }}——平台上已有人更新。</span>
        <button class="btn small" :disabled="busy" @click="forceCases">覆盖平台版本</button>
      </div>
      <div class="tp-btns">
        <button class="btn primary" :disabled="busy" @click="approveCases(false)"><AppIcon name="check-circle" :size="13" />采纳登记</button>
        <button class="btn danger" :disabled="busy" @click="dropDraft('cases')">丢弃</button>
      </div>
    </div>
    </template>
  </div>
</template>

<script setup>
// v2.0 任务面板：线上化流水线操作区——开始质检/生成标准文档/发布，任务状态轮询，AI 草稿人审两态
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { api } from '../api.js'
import AppIcon from './AppIcon.vue'
import { render, linkifyRefs } from '../render.js'
import { fmtRel, fmtDur } from '../time.js'
import { ask } from '../confirm.js'
import { isDone } from '../disposition.js'

const props = defineProps({ reqId: String, detail: Object })
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
  collapsed.value && !activeTask.value && !digestDraft.value && !stdDraftVisible.value && !casesDraft.value)
function stageStatus(type) { return latestByType.value[type]?.status || '' }   // ''|done|failed
const latestTaskAt = computed(() => tasks.value[0]?.updatedAt || '')

/** 摘要态主操作（评测 P1-2/P1-9）：与展开态按钮的 disabled 条件同源——答完题后的关键动作不再藏进折叠区 */
const nextAction = computed(() => {
  if (busy.value || activeTask.value) return null
  if (card.value.status === 'submitted') {
    return { label: hasDigest.value ? '继续质检' : '开始质检', run: () => createTask('quality_check', hasDigest.value ? '重新质检' : '需求质检') }
  }
  if (card.value.status === 'clarifying' && allAnswered.value && !stdDraft.value) {
    return { label: '生成标准文档', run: () => createTask('standard_doc', '标准文档合成') }
  }
  return null
})

const statusLabel = { queued: '排队中', running: '执行中', done: '已完成', failed: '失败' }
// v2.4：设计/门禁任务也经此面板展示（执行态归面板，领域态归 design/gate tab）
const typeLabel = { quality_check: '需求质检', standard_doc: '标准文档合成', case_gen: '用例生成', design_gen: '技术设计生成', design_rev: '设计修订', gate_review: '门禁评审' }
const draftLabel = { digest_bundle: '质检三件套草稿', standard: '标准需求文档草稿', cases: '测试用例草稿', design: '技术设计草稿', gate_issues: '门禁 issues 草稿' }

const card = computed(() => props.detail?.card || {})
const items = computed(() => props.detail?.items || [])
// v2.2 处置口径（DESIGN-v2.2 D25）：驳回/挂起计入已处置——与后端 counts/TaskService 守卫同源，防口径漂移禁用主操作
const answered = computed(() => items.value.filter(isDone).length)
const allAnswered = computed(() => items.value.length > 0 && answered.value === items.value.length)
const hasDigest = computed(() => !!props.detail?.digest)
const hasStandard = computed(() => !!props.detail?.standard)

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
  } catch {}
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

async function loadTasks() {
  try { tasks.value = await api.get(`/api/tasks?req_id=${props.reqId}`) } catch {}
}
async function loadDrafts() {
  try {
    const list = await api.get(`/api/requirements/${props.reqId}/drafts`)
    const m = {}
    for (const x of list) m[x.type] = x
    // standard 草稿首次载入或被外部重写时同步编辑缓冲
    if (m.standard && stdText.value !== m.standard.md && (!stdDraft.value || stdDraft.value.updatedAt !== m.standard.updatedAt)) {
      stdText.value = m.standard.md
    }
    drafts.value = m
  } catch {}
}
function reloadAll() { loadTasks(); loadDrafts() }

let timer = null
const KNOWN = {}
/** 轮询单次：页面不可见时跳过（省无效读放大），恢复可见由 visibilitychange 立即补一次 */
async function tick() {
  if (document.hidden) return
  const before = {}
  for (const [k, t] of Object.entries(KNOWN)) before[k] = t
  try {
    const list = await api.get(`/api/tasks?req_id=${props.reqId}`)
    // 有任务从 queued/running 变为终态 → 刷新草稿
    for (const t of list) {
      if (before[t.id] && before[t.id] !== t.status && (t.status === 'done' || t.status === 'failed')) loadDrafts()
      KNOWN[t.id] = t.status
    }
    tasks.value = list
  } catch {}
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
 * 发布（终态）。软守卫（评测 P0-2，用户裁决：不改「预览可编辑直发」设计）：
 * 存在 AI 草稿且编辑内容与其分叉时，发布前明示差异与「以编辑内容为准」；无草稿维持直发。
 */
async function publishStd() {
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
  if (!await ask({ title: `丢弃${draftLabel[type]}？`, body: '丢弃后如需该产物须重新生成对应任务。', danger: true, confirmText: '丢弃' })) return
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
        <span class="tp-stage" v-for="ty in ['quality_check', 'standard_doc', 'case_gen']" :key="ty">
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
        <button class="btn" :disabled="busy || !!activeTask || card.status !== 'clarifying' || !allAnswered"
                :title="card.status !== 'clarifying' ? '待澄清状态才可生成' : (!allAnswered ? `尚有 ${items.length - answered} 问未答复` : '')"
                @click="createTask('standard_doc', '标准文档合成')">
          <AppIcon name="file-text" :size="13" />生成标准文档
        </button>
        <button class="btn" :disabled="busy || !!activeTask || !hasDigest"
                title="基于质检产物生成测试用例（发布前后均可）"
                @click="createTask('case_gen', '用例生成')">
          <AppIcon name="clipboard-list" :size="13" />生成用例
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
    <div class="tp-task" v-for="t in [latestByType.quality_check, latestByType.standard_doc, latestByType.case_gen].filter(x => x && x.status !== 'queued' && x.status !== 'running')" :key="t.id">
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
        <summary>预览 digest 正文</summary>
        <div class="doc tp-preview" v-html="digestDraftHtml"></div>
      </details>
      <div class="tp-btns">
        <button class="btn primary" :disabled="busy" @click="approveDigest"><AppIcon name="check-circle" :size="13" />采纳（进入待澄清）</button>
        <button class="btn danger" :disabled="busy" @click="dropDraft('digest_bundle')">丢弃</button>
      </div>
    </div>

    <!-- 标准文档草稿 -->
    <!-- 标准文档草稿（published 后隐藏：终态即无草稿动作） -->
    <div class="tp-draft" v-if="stdDraft && card.status !== 'published'">
      <div class="tp-draft-h"><span class="badge b-amber">待发布</span><b>{{ draftLabel.standard }}</b></div>
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

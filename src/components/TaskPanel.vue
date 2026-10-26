<script setup>
// 线上流水线面板（v5.x 批3 专心化）：只管任务——状态条（阶段进度 + 主 CTA + 低频任务 ⋯ 菜单）+
// 进行中任务行常显 + 任务历史默认折叠（失败详情/重试在折叠区）。草稿的预览/采纳/发布/登记已归
// 对应产物页签（Digest/Std/Changes/Cases），本面板经导航型 CTA 与 tab 角标把人带到草稿现场。
// 数据源：壳层 ReqDetail 单一装载（tasks/drafts props 下发，4s 轮询在壳层）；排任务后 @reload 轻刷新。
import { ref, computed } from 'vue'
import { api } from '../api.js'
import AppIcon from './AppIcon.vue'
import { fmtRel, fmtDur } from '../time.js'
import { ask } from '../confirm.js'
import { isDone } from '../disposition.js'
import { isTerminalReason, terminalTaskReasons } from '../task-reasons.js'

const props = defineProps({ reqId: String, detail: Object, operator: { type: String, default: '' },
                           tasks: { type: Array, default: () => [] },
                           drafts: { type: Object, default: () => ({}) } })
const emit = defineEmits(['toast', 'refresh', 'reload', 'go-tab'])

const tasks = computed(() => props.tasks || [])
const drafts = computed(() => props.drafts || {})
const busy = ref(false)

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
// 草稿派生（导航型 CTA / 依赖排序用；展示与动作在各产物页签）
const digestDraft = computed(() => drafts.value.digest_bundle || null)
const stdDraft = computed(() => drafts.value.standard || null)
const stdDraftVisible = computed(() => !!stdDraft.value && card.value.status !== 'published')
const casesDraft = computed(() => drafts.value.cases || null)
const incDraft = computed(() => drafts.value.incremental_bundle || null)

function stageStatus(type) { return latestByType.value[type]?.status || '' }   // ''|queued|running|done|failed
// v4 建卡自动导入阶段：仅当存在 source_import 任务记录才入列（老卡走 sdlc-sync 推送，无此环节）
const summaryStages = computed(() =>
  latestByType.value.source_import ? ['source_import', 'quality_check', 'standard_doc', 'case_gen'] : ['quality_check', 'standard_doc', 'case_gen'])

/** 主 CTA（评测 P1-2/P1-9 关键动作常驻；v5.x 批3 重排为「导航型草稿引导 > 任务型主链」）——
 *  顺序即优先级：堵发布的增量采纳 > 质检草稿采纳 > 标准文档发布引导 > 任务型主链 > 用例登记（不堵链，最后） */
const nextAction = computed(() => {
  if (busy.value || activeTask.value) return null
  if (incDraft.value) return { label: '去变更采纳增量合并', go: 'tab:changes' }
  if (digestDraft.value) return { label: '去需求摘要采纳三件套', go: 'tab:digest' }
  if (stdDraftVisible.value) {
    return { label: card.value.status === 'changed' ? '去标准文档重新发布' : '去标准文档发布', go: 'tab:std' }
  }
  if (card.value.status === 'submitted') {
    return { label: hasDigest.value ? '继续质检' : '开始质检', run: () => createTask('quality_check', hasDigest.value ? '重新质检' : '需求质检') }
  }
  if ((card.value.status === 'clarifying' || card.value.status === 'changed') && allAnswered.value && !stdDraft.value) {
    return { label: '生成标准文档', run: () => createTask('standard_doc', '标准文档合成') }
  }
  // v4 changed 死锁逃生：增量草稿被丢弃/增量任务终局失败后影响面无人消化（无自动重排）——手动补排
  if (card.value.status === 'changed' && !stdDraft.value) {
    return { label: '重排增量质检', run: () => createTask('incremental_check', '增量质检') }
  }
  if (casesDraft.value) return { label: '去用例登记草稿', go: 'tab:cases' }
  return null
})
/** CTA 统一入口：go = 页签导航（上抛壳层 switchTab），run = 任务创建 */
function runNext() {
  const c = nextAction.value
  if (!c) return
  if (c.go) emit('go-tab', c.go.slice(4))
  else c.run()
}

const statusLabel = { queued: '排队中', running: '执行中', done: '已完成', failed: '失败' }
const typeLabel = { source_import: '原文导入', quality_check: '需求质检', standard_doc: '标准文档合成', case_gen: '用例生成', design_gen: '技术设计生成', design_rev: '设计修订', gate_review: '门禁评审', incremental_check: '增量质检' }

const moreRef = ref(null)
function closeMore() { if (moreRef.value) moreRef.value.open = false }

// 终态任务行（v5.x 批3 收进「任务历史」折叠区；进行中任务常显在状态条下方）
const doneTasks = computed(() =>
  [latestByType.value.source_import, latestByType.value.quality_check, latestByType.value.standard_doc, latestByType.value.case_gen]
    .filter(x => x && x.status !== 'queued' && x.status !== 'running'))
const failedCount = computed(() => doneTasks.value.filter(t => t.status === 'failed').length)

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
    emit('reload')
  } catch (e) { emit('toast', '创建失败：' + e.message, 'err') }
  finally { busy.value = false }
}
async function retryTask(t) {
  try { await api.post(`/api/tasks/${t.id}/retry`); emit('toast', '任务已重新排队'); emit('reload') }
  catch (e) { emit('toast', '重试失败：' + e.message, 'err') }
}
async function cancelTask(t) {
  try { await api.post(`/api/tasks/${t.id}/cancel`); emit('reload') }
  catch (e) { emit('toast', '取消失败：' + e.message, 'err') }
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
// N-1：生命周期取消/作废为终局——与后端 retry 白名单同源，不再显示无效「重试」
const terminalLabels = terminalTaskReasons
function isTerminalFail(t) { return isTerminalReason(failInfo(t).reason) }
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
    <!-- 状态条（v5.x 批3）：常显单行——阶段进度 + 主 CTA（导航型草稿引导/任务型主链）+ 生成用例 + ⋯ 低频任务 -->
    <div class="tp-bar">
      <div class="tp-title"><AppIcon name="layers" :size="15" />线上流水线</div>
      <div class="tp-stages">
        <span class="tp-stage" v-for="ty in summaryStages" :key="ty">
          <i class="st-dot" :class="stageStatus(ty)"></i>{{ typeLabel[ty] }}
        </span>
      </div>
      <div class="tp-actions">
        <button class="btn small primary" v-if="nextAction" :disabled="nextAction.disabled"
                :title="card.status === 'submitted' ? '需求尚未质检——点击启动流水线' : '待审草稿在对应页签，CTA 直达处理现场'"
                @click="runNext"><AppIcon name="play" :size="12" />{{ nextAction.label }}</button>
        <button class="btn small" :disabled="busy || !!activeTask || !hasDigest"
                title="基于质检产物生成测试用例（发布前后均可）"
                @click="createTask('case_gen', '用例生成')">
          <AppIcon name="clipboard-list" :size="12" />生成用例</button>
        <details class="tp-more" ref="moreRef">
          <summary title="低频流水线任务"><AppIcon name="more-horizontal" :size="13" /></summary>
          <div class="tp-more-panel">
            <button class="tp-more-item" :disabled="busy || !!activeTask || card.status === 'published'"
                    @click="closeMore(); createTask('quality_check', hasDigest ? '重新质检' : '需求质检')">
              <AppIcon name="search" :size="13" />{{ hasDigest ? '重新质检' : '开始质检' }}</button>
            <button class="tp-more-item" :disabled="busy || !!activeTask || (card.status !== 'clarifying' && card.status !== 'changed') || !allAnswered"
                    @click="closeMore(); createTask('standard_doc', '标准文档合成')">
              <AppIcon name="file-text" :size="13" />生成标准文档
              <span class="tp-more-note" v-if="(card.status === 'clarifying' || card.status === 'changed') && !allAnswered">尚有 {{ items.length - answered }} 问未答</span>
            </button>
            <button class="tp-more-item" v-if="card.status === 'changed'" :disabled="busy || !!activeTask"
                    title="变更后影响面的增量梳理（L2 自动排不上/草稿被丢弃时的人工逃生门）"
                    @click="closeMore(); createTask('incremental_check', '增量质检')">
              <AppIcon name="refresh-cw" :size="13" />增量质检</button>
          </div>
        </details>
      </div>
    </div>

    <!-- 空态引导：尚无任何任务记录 -->
    <div class="tp-task tp-empty" v-if="!tasks.length">
      <span class="sub">{{ card.status === 'submitted'
        ? '尚未启动流水线——推送产物（sdlc-sync）或点击右侧「开始质检」。'
        : '暂无任务记录。' }}</span>
    </div>

    <!-- 进行中任务：常显（不进历史折叠区） -->
    <div class="tp-task" v-if="activeTask">
      <span class="spin"></span>
      <b>{{ typeLabel[activeTask.type] }}</b><span class="chip" v-if="autoBy(activeTask)">自动</span> {{ statusLabel[activeTask.status] }}
      <span class="sub">{{ activeTask.runner || '' }} · 已 {{ elapsed(activeTask) }}</span>
      <button class="btn small link" v-if="activeTask.status === 'queued'" @click="cancelTask(activeTask)">取消</button>
    </div>

    <!-- 任务历史：默认折叠（终态行 + 失败详情/重试） -->
    <details class="tp-hist" v-if="doneTasks.length">
      <summary>任务历史 {{ doneTasks.length }}
        <span class="badge b-red" v-if="failedCount">{{ failedCount }} 失败</span>
        <span class="sub tnum" v-if="tasks[0]?.updatedAt" :title="tasks[0].updatedAt">· 最近 {{ fmtRel(tasks[0].updatedAt) }}</span>
      </summary>
      <div class="tp-task" v-for="t in doneTasks" :key="t.id">
        <span class="badge" :class="t.status === 'done' ? 'b-green' : (isTerminalFail(t) ? 'b-gray' : 'b-red')">{{ t.status === 'done' ? statusLabel.done : (isTerminalFail(t) ? terminalLabels[failInfo(t).reason] : statusLabel.failed) }}</span>
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
        <button class="btn small" v-if="t.status === 'failed' && !isTerminalFail(t)" @click="retryTask(t)"><AppIcon name="refresh-cw" :size="11" />重试</button>
      </div>
    </details>
  </div>
</template>

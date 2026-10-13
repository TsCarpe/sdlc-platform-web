<script setup>
// 澄清清单 tab（AUDIT D6-2 拆分自 ReqDetail）：与体检同序分组（D4）+ 摘引 + 回跳（D5），答复交互不变
// （失焦自动保存 + v2.2 三态筛选 D21 + 处置通道弹窗：驳回必填理由/挂起可选 + 重开）。
// 折叠协议 inject 消费；出处/回跳经 emit 上抛壳层。
import { ref, computed, watch, nextTick } from 'vue'
import { api } from '../api.js'
import AppIcon from './AppIcon.vue'
import EmptyState from './EmptyState.vue'
import { firstQuote, flashEl } from '../trace.js'
import { isDone, isPending, dispLabel } from '../disposition.js'
import { lvlLabel, lvlCls } from '../levels.js'
import { useGrpCollapse } from '../composables/group-collapse.js'

const props = defineProps({
  reqId: { type: String, required: true },
  items: { type: Array, default: () => [] },
  status: { type: String, default: '' },
  groups: { type: Array, default: () => [] }      // 壳层需求域分组（revealGrpFor 共用）
})
const emit = defineEmits(['locate', 'jump', 'toast', 'open-comment'])

const { openGrps, toggleGrp, expandAll, collapseAll, revealGrpFor } = useGrpCollapse()

const answered = computed(() => props.items.filter(isDone).length)
const totalQ = computed(() => props.items.length)
const prog = computed(() => totalQ.value ? Math.round(answered.value / totalQ.value * 100) : 0)
const allAnswered = computed(() => totalQ.value > 0 && answered.value === totalQ.value)

/** 组头副标题：澄清组带已答进度（模板内联） */
function answeredIn(items) { return (items || []).filter(isDone).length }

// ===== 澄清导航（评测 P1-2；v2.2 D21 三态筛选：全部/待处置/已处置）=====
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
    const it = props.items.find(i => i.seq === dlg.seq)
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
</script>

<template>
  <EmptyState v-if="!items.length" icon="inbox" title="澄清清单尚未推送"
              desc="体检报告推送时同步生成澄清清单" />
  <template v-else>
    <div class="banner" v-if="status === 'published'">
      <AppIcon name="check-circle" :size="14" style="color:var(--green)" />
      <span>澄清已闭环：全部问题已答复，标准需求文档已发布。</span>
    </div>
    <div class="banner blue sticky-clf" v-else-if="status === 'clarifying'">
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
    <!-- v4 changed：变更确认后受影响澄清重开——重新处置后可重新发布 -->
    <div class="banner amber-t sticky-clf" v-else-if="status === 'changed'">
      <AppIcon name="alert-triangle" :size="14" />
      <div style="flex:1;min-width:200px">
        变更处理中：受影响澄清项已<b>重开</b>（备注带原答复），面对重开与新增项重新处置后可重新发布。
        <div class="prog-row" style="margin-top:8px">
          <div class="bar"><div class="bar-fill" :style="{ width: prog + '%' }"></div></div>
          <span class="num">{{ answered }}/{{ totalQ }} 已处置</span>
          <button class="btn small" v-if="nextUnanswered" @click="jumpNextUnanswered">
            <AppIcon name="arrow-up-right" :size="11" />跳到下一待处置</button>
        </div>
      </div>
    </div>
    <div class="banner" v-else>
      <AppIcon name="clock" :size="14" />
      <span>质检中：产物推送后进入澄清。</span>
    </div>
    <div class="grp-tools" v-if="groups.length">
      <span class="sub">点组名展开 / 收起</span>
      <button class="btn small link" @click="expandAll(groups)">全部展开</button>
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
          <!-- v4 origin 三族（§2/§6.3）：L 系来自评论升级（回链原讨论）；incremental 来自增量质检（变更后局部重检）；skill 来自体检报告 -->
          <button class="jump-link" v-if="it.origin === 'local'"
                  title="由评论升级而来——点击回看原讨论" @click="emit('open-comment', it.srcCommentId)">
            来自评论<span v-if="it.srcCommentId"> #{{ it.srcCommentId }}</span><AppIcon name="arrow-up-right" :size="11" /></button>
          <span class="jump-link" v-else-if="it.origin === 'incremental'" title="增量质检产生（变更单确认后的局部重检），处置后可重新发布">来自增量质检</span>
          <button class="jump-link" v-else @click="emit('jump', { kind: 'audit', id: it.seq })">来自体检.{{ it.seq }}<AppIcon name="arrow-up-right" :size="11" /></button>
        </div>
        <div class="q">{{ it.question }}</div>
        <div class="ctx" v-if="it.ctx">出处：<a class="cite" :class="{ anchored: it.anchor }" @click="emit('locate', firstQuote(it.quote) || it.ctx, it.anchor)">{{ it.ctx }}<span v-if="it.anchor" class="anchored-mark" title="块级锚点：点击直达原文条款"><AppIcon name="crosshair" :size="10" /></span></a></div>
        <blockquote class="quote" v-if="it.quote">
          <span class="qlb">原文摘引 · <a class="cite" :class="{ anchored: it.anchor }" @click="emit('locate', firstQuote(it.quote), it.anchor)">在快照中定位<span v-if="it.anchor" class="anchored-mark"><AppIcon name="crosshair" :size="10" /></span></a></span>{{ it.quote }}
        </blockquote>
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
    <div class="banner" v-if="status === 'clarifying' && allAnswered">
      <AppIcon name="check-circle" :size="14" style="color:var(--green)" />
      <span>全部答复完成。可在流水线面板点击「生成标准文档」（见上方线上流水线卡），AI 合成草稿预览后发布；本地 sdlc-sync 工具为备用通道。</span>
    </div>

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

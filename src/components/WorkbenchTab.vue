<script setup>
// 澄清工作台 tab（DESIGN-v5 §1/§2，由 ChecklistTab 升级——D19：tab 键名仍为 'checklist'，仅组件更名）。
// audit 合并（D1/D14）：audit 是 clarify 的超集，差集 ∧ go✅ 条目以「已定论」只读折叠组获得宿主
// （组名带「已定论·」前缀防与 check 组撞名联动，同状态机前缀先例）；audit 字段归宿——去向/关联
// 用例进问题卡「影响分析」折叠，audit.md 原文折叠挪页尾。作答/处置/三态筛选/跳转等既有能力全保留。
import { ref, computed, watch, nextTick } from 'vue'
import { api } from '../api.js'
import AppIcon from './AppIcon.vue'
import EmptyState from './EmptyState.vue'
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
})
const emit = defineEmits(['locate', 'jump', 'toast', 'open-comment'])

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

const savingSeqs = new Set()   // per-seq 在途集：失焦重入防并发同 seq 双 PUT
async function saveAnswer(it) {
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
            <div class="ctx" v-if="a.where">出处：<a class="cite" :class="{ anchored: a.anchor }" @click="emit('locate', firstQuote(a.quote) || a.where, a.anchor)">{{ a.where }}<span v-if="a.anchor" class="anchored-mark" title="块级锚点：点击直达原文条款"><AppIcon name="crosshair" :size="10" /></span></a> ｜ 去向：{{ a.go || '—' }}</div>
            <blockquote class="quote" v-if="a.quote">
              <span class="qlb">原文摘引 · <a class="cite" :class="{ anchored: a.anchor }" @click="emit('locate', firstQuote(a.quote), a.anchor)">在快照中定位<span v-if="a.anchor" class="anchored-mark"><AppIcon name="crosshair" :size="10" /></span></a></span>{{ a.quote }}
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
        <div class="ctx" v-if="it.ctx">出处：<a class="cite" :class="{ anchored: it.anchor }" @click="emit('locate', firstQuote(it.quote) || it.ctx, it.anchor)">{{ it.ctx }}<span v-if="it.anchor" class="anchored-mark" title="块级锚点：点击直达原文条款"><AppIcon name="crosshair" :size="10" /></span></a></div>
        <blockquote class="quote" v-if="it.quote">
          <span class="qlb">原文摘引 · <a class="cite" :class="{ anchored: it.anchor }" @click="emit('locate', firstQuote(it.quote), it.anchor)">在快照中定位<span v-if="it.anchor" class="anchored-mark"><AppIcon name="crosshair" :size="10" /></span></a></span>{{ it.quote }}
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
        <div class="ctx" v-if="a.where">出处：<a class="cite" :class="{ anchored: a.anchor }" @click="emit('locate', firstQuote(a.quote) || a.where, a.anchor)">{{ a.where }}<span v-if="a.anchor" class="anchored-mark" title="块级锚点：点击直达原文条款"><AppIcon name="crosshair" :size="10" /></span></a> ｜ 去向：{{ a.go || '—' }}</div>
        <blockquote class="quote" v-if="a.quote">
          <span class="qlb">原文摘引 · <a class="cite" :class="{ anchored: a.anchor }" @click="emit('locate', firstQuote(a.quote), a.anchor)">在快照中定位<span v-if="a.anchor" class="anchored-mark"><AppIcon name="crosshair" :size="10" /></span></a></span>{{ a.quote }}
        </blockquote>
        <div class="ctx" v-if="(a.relatedCases || []).length" style="margin-top:6px">
          关联用例：<a class="chip linklike real" v-for="c in a.relatedCases" :key="c" @click="emit('jump', { kind: 'case', id: c })">{{ c }}</a>
        </div>
      </div>
      </div></div>
    </div>

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

<script setup>
// 门禁 tab（DESIGN-v2.4 D35/D37）：三条件亮灯 → 开闸 → 评审 → 汇总入库 → 裁决 → 放行 → r2。
// phase 六态为平台化推导（skill 权威两值落库「待裁决｜已放行」，页面标注）；GR-2/3/4 为平台化机械校验口径。
import { ref, computed } from 'vue'
import { api } from '../api.js'
import AppIcon from './AppIcon.vue'
import { gatePhaseLabel } from '../lifecycle.js'

const props = defineProps({ reqId: String, view: Object, operator: String })
const emit = defineEmits(['toast', 'refresh', 'jump-change'])

const busy = ref(false)
const vd = ref(null)        // 裁决弹层 {issue, verdict, note, revLocation}
const showDraft = ref('')   // 汇总阶段草稿 md 预览

const sevLabel = { high: '高', mid: '中', low: '低' }
const sevCls = { high: 'b-red', mid: 'b-amber', low: 'b-blue' }
const phase = computed(() => props.view?.phase || 'blocked')
const round = computed(() => props.view?.round || null)
const issues = computed(() => props.view?.issues || [])
const units = computed(() => props.view?.units || [])
const undecided = computed(() => units.value.filter(u => !u.verdict).length)
const allDecided = computed(() => units.value.length > 0 && undecided.value === 0)
const checksOk = computed(() => (props.view?.checks || []).every(c => c.ok))
const openIssues = computed(() => issues.value.filter(i => !i.filed))
const filedIssues = computed(() => issues.value.filter(i => i.filed))

async function run(fn, okMsg) {
  busy.value = true
  try { await fn(); if (okMsg) emit('toast', okMsg); emit('refresh') }
  catch (e) { emit('toast', e.message, 'err') } finally { busy.value = false }
}
const openGate = () => run(() => api.post(`/api/requirements/${props.reqId}/gate/open`, { by: props.operator }), '已开闸：评审轮建立，gate_review 任务排队中')
const ingest = () => run(async () => {
  await api.post(`/api/requirements/${props.reqId}/gate/rounds/${round.value.id}/ingest`, { by: props.operator })
  showDraft.value = ''
}, '评审汇总已入库，进入裁决')
const loadDraft = async () => {
  try {
    const d = await api.get(`/api/requirements/${props.reqId}/drafts/gate_issues`)
    showDraft.value = d.md || ''
  } catch (e) { emit('toast', e.message, 'err') }
}
// gate 域落库值英文化（批次6）：显示口径经映射表回到中文
const VERDICT_LABEL = { revise: '落改', reject: '驳回', query: '存疑', filed: '备案' }
const ROUND_LABEL = { pending: '待裁决', released: '已放行' }
const askVerdict = (issue, verdict) => { vd.value = { issue, verdict, note: '', revLocation: '' } }
const confirmVerdict = () => run(async () => {
  const v = vd.value
  await api.post(`/api/gate/issues/${v.issue.id}/verdict`,
    { verdict: v.verdict, note: v.note.trim(), revLocation: v.revLocation.trim(), by: props.operator })
  vd.value = null
}, '裁决已记录（按裁决单元批量生效）')
const markExecuted = issue => run(() => api.post(`/api/gate/issues/${issue.id}/revision`, { revStatus: 'done' }), '落改已执行')
const release = () => run(() => api.post(`/api/gate/rounds/${round.value.id}/release`, { by: props.operator }),
  '已放行（GR-4 全绿）·关卡互认：用例关卡1 视同通过')
const reopen = () => run(() => api.post(`/api/requirements/${props.reqId}/gate/reopen`, { by: props.operator }), '已开复审轮（旧轮只读归档）')
</script>

<template>
  <div v-if="view">
    <div class="banner blue">
      <AppIcon name="shield-check" :size="14" />
      <span><b>门禁评审</b> ｜ 放行唯一口径 = 门禁已放行（GR-4，平台机械校验）。
        <span class="sub">阶段徽标为平台化推导；skill 权威落库仅「待裁决｜已放行」两值</span></span>
      <span class="badge" :class="{ blocked: 'b-gray', running: 'b-blue', summary: 'b-amber', deciding: 'b-amber', released: 'b-green' }[phase] || 'b-gray'">{{ gatePhaseLabel[phase] || phase }}</span>
    </div>

    <!-- GR-3 变更横幅（仅 released 窗口）：原因 + 变更单号点入 diff（reqChangeIds，v4-16） -->
    <div class="banner amber-t" v-if="phase === 'released' && view.change?.changed && view.change?.window === 'released'">
      <AppIcon name="alert-triangle" :size="14" />
      <span style="flex:1"><b>放行后产物实质变更（GR-3 内容变更检测）</b>：{{ (view.change.reasons || []).join('；') }}——确认后开新一轮，旧轮只读归档（不自动烧 token）。
        <span class="chg-chips" v-if="(view.change.reqChangeIds || []).length">
          <a class="chip real chg-chip" v-for="id in view.change.reqChangeIds" :key="id"
             :title="'查看变更单 #' + id + ' 的差异与影响面'" @click="emit('jump-change', id)">变更单 #{{ id }} ↗</a>
        </span></span>
      <button class="btn small primary" :disabled="busy" @click="reopen">开复审轮 r{{ round.roundNo + 1 }}</button>
    </div>

    <!-- 开闸三条件（GR-2 现算） -->
    <div class="card">
      <h3>开闸三条件（GR-2 · 平台化前置重构口径）
        <span class="badge" :class="checksOk ? 'b-green' : 'b-amber'">{{ checksOk ? '全绿' : '未满足' }}</span></h3>
      <div class="gc-item" v-for="c in view.checks" :key="c.key" :class="c.ok ? 'ok' : 'no'">
        <AppIcon :name="c.ok ? 'check-circle' : 'x-circle'" :size="14" />
        <b>{{ c.name }}</b><span class="sub">{{ c.detail }}</span>
      </div>
      <div style="margin-top:10px" v-if="phase === 'blocked'">
        <button class="btn primary" :disabled="busy || !checksOk" @click="openGate"
                :title="checksOk ? null : '三条件全绿才可开闸'">开评审（建立评审轮）</button>
      </div>
    </div>

    <!-- running -->
    <div class="card" v-if="phase === 'running'">
      <h3><span class="spin"></span> 评审执行中</h3>
      <p class="sub">gate_review 任务 {{ view.activeTask?.status === 'queued' ? '排队中' : '执行中' }}（{{ view.tier || 'A' }} 档扇出：A=4 角色 / B=2 / C=自查）。issues 草稿回传后进入「汇总待入库」。</p>
    </div>

    <!-- summary：汇总待入库 -->
    <div class="card" v-if="phase === 'summary'">
      <h3><span class="badge b-amber">汇总待入库</span> 评审草稿已回传，人确认后落库</h3>
      <p class="sub">入库做机械校验（编号前缀 D/A/S/T、场景列非空、md×contentJson 同源），全绿才写 gate_issue。</p>
      <details style="margin:10px 0">
        <summary class="linklike" style="cursor:pointer;font-size:13px;color:var(--muted)" @click.prevent="showDraft ? showDraft = '' : loadDraft()">{{ showDraft ? '收起 issues 预览' : '预览 issues 草稿' }}</summary>
        <pre class="srctext" style="max-height:320px" v-if="showDraft">{{ showDraft }}</pre>
      </details>
      <button class="btn primary" :disabled="busy" @click="ingest">确认入库（进入裁决）</button>
    </div>

    <!-- deciding：裁决 -->
    <template v-if="phase === 'deciding'">
      <div class="card">
        <h3>裁决（人裁决的是裁决单元，不是发现数）</h3>
        <p class="sub">共 {{ units.length }} 个裁决单元 · 待裁决 {{ undecided }} 。三处置：<b>落改</b>（必填落点→执行闭环）/<b>驳回</b>（必填理由，沉淀误报模式）/<b>存疑</b>（必填去向）。</p>
        <div style="margin-top:10px">
          <button class="btn primary" :disabled="busy || !allDecided" @click="release"
                  :title="allDecided ? null : '全部裁决单元裁决完毕才可放行'">放行（GR-4 校验）</button>
        </div>
      </div>
      <div class="issue-card" v-for="i in openIssues" :key="i.id" :data-gate-issue="i.code">
        <div class="issue-h">
          <span class="badge" :class="sevCls[i.sev]">{{ sevLabel[i.sev] }}</span>
          <span class="chip">{{ i.code }}</span>
          <span class="sub">{{ i.theme }}</span>
          <span class="chip" v-if="i.div">分歧</span>
          <span class="chip" v-if="i.tradeoff">权衡</span>
          <span class="sub" style="margin-left:auto">单元 #{{ i.unit }} · {{ i.role }} · 依据 {{ i.basis === 'hard' ? '原文' : '推导' }}</span>
        </div>
        <div class="issue-scene">{{ i.scene }}</div>
        <blockquote class="quote" v-if="i.quote"><span class="qlb">摘引 · {{ i.loc || '—' }}</span>{{ i.quote }}</blockquote>
        <div class="issue-v">
          <template v-if="!i.verdict">
            <button class="btn small primary" @click="askVerdict(i, 'revise')">落改</button>
            <button class="btn small" @click="askVerdict(i, 'reject')">驳回</button>
            <button class="btn small" @click="askVerdict(i, 'query')">存疑</button>
          </template>
          <template v-else>
            <span class="badge" :class="{ revise: 'b-blue', reject: 'b-gray', query: 'b-amber', filed: 'b-gray' }[i.verdict]">{{ VERDICT_LABEL[i.verdict] || i.verdict }}</span>
            <span class="sub" v-if="i.verdictNote">{{ i.verdictNote }}</span>
            <span class="sub" v-if="i.revLocation">落点：{{ i.revLocation }}</span>
            <button class="btn small" v-if="i.verdict === 'revise' && i.revStatus !== 'done'" :disabled="busy" @click="markExecuted(i)">标记已执行</button>
            <span class="badge b-green" v-if="i.verdict === 'revise' && i.revStatus === 'done'">已执行</span>
            <span class="sub" style="margin-left:auto">{{ i.verdictBy }} · {{ i.verdictAt }}</span>
          </template>
        </div>
      </div>
      <div class="card" v-if="filedIssues.length">
        <h3>备案区（{{ filedIssues.length }} 条，不阻塞放行）</h3>
        <div class="issue-scene sub" v-for="i in filedIssues" :key="i.id" style="margin-bottom:6px">
          <span class="chip">{{ i.code }}</span>{{ i.sev }} · {{ i.scene }}
        </div>
      </div>
    </template>

    <!-- released：归档 -->
    <div class="card" v-if="phase === 'released'">
      <h3><span class="badge b-green">已放行</span> r{{ round.roundNo }} · {{ round.releasedBy || '—' }} · {{ round.releasedAt }}</h3>
      <p class="sub">关卡互认已生效：本需求全部 sdlc-test 用例置「已定稿」（放行视同用例关卡1 通过）。旧轮归档只读；放行后产物实质变更将触发 GR-3 横幅。</p>
    </div>

    <!-- 轮次列表（旧轮只读） -->
    <div class="card" v-if="(view.rounds || []).length > 1 || (view.rounds || []).length === 1">
      <h3>评审轮次</h3>
      <div class="gc-item" v-for="r in view.rounds" :key="r.id" :class="r.status === 'released' ? 'ok' : ''">
        <b>r{{ r.roundNo }}</b>
        <span class="badge" :class="r.status === 'released' ? 'b-green' : 'b-amber'">{{ ROUND_LABEL[r.status] || r.status }}</span>
        <span class="sub">开闸 {{ r.openedAt }}<template v-if="r.releasedAt"> · 放行 {{ r.releasedAt }}</template><template v-if="r.id !== round?.id"> · 只读归档</template></span>
      </div>
    </div>
  </div>

  <!-- 裁决弹层 -->
  <div class="modal-mask" v-if="vd" @click.self="vd = null">
    <div class="modal" style="width:500px" role="dialog" aria-modal="true">
      <div class="modal-h">{{ vd.issue.code }} · {{ VERDICT_LABEL[vd.verdict] || vd.verdict }}<button class="x" @click="vd = null">✕</button></div>
      <div class="modal-b">
        <p class="sub" style="margin-bottom:10px">{{ vd.issue.scene }}</p>
        <div class="field" v-if="vd.verdict === 'revise'">
          <label><em>*</em>落点（&lt;文件+位置&gt;）</label>
          <input v-model="vd.revLocation" placeholder="如：§1 数据模型 · idx_publish_at">
        </div>
        <div class="field">
          <label>{{ vd.verdict === 'revise' ? '改动摘要（可选）' : (vd.verdict === 'reject' ? '*驳回理由（沉淀误报模式）' : '*去向（如：拉 PM / 留下轮）') }}</label>
          <textarea v-model="vd.note" rows="3"></textarea>
        </div>
        <div class="field"><label>裁决人</label><input :value="props.operator" disabled placeholder="—"></div>
      </div>
      <div class="modal-f">
        <button class="btn" @click="vd = null">取消</button>
        <button class="btn primary" :disabled="busy" @click="confirmVerdict">确认{{ vd.verdict }}</button>
      </div>
    </div>
  </div>
</template>

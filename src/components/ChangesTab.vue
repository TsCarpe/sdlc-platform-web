<script setup>
// v4 变更单（窗口 2/3 · DESIGN-v4 §5）：列表 → draft 新建/编辑（复用 BlockEditor，仅提交端点
// 不同）→ confirm 界面（块级 diff + 四类清单人可增删，随 body.impact 提交）→ abort（LIFO 仅最新）。
// 状态×通道矩阵（交接 §5）：draft 建议与保存不限状态；confirm 仅 published/changed（reconcile 豁免）；
// abort 仅 changed 下最新 confirmed 单。changed 发布双重守卫见 TaskPanel（草稿一致流）。
import { ref, computed, onMounted, watch } from 'vue'
import { api } from '../api.js'
import AppIcon from './AppIcon.vue'
import EmptyState from './EmptyState.vue'
import BlockDiff from './BlockDiff.vue'
import BlockEditor from './BlockEditor.vue'
import { ask } from '../confirm.js'
import { lvlLabel, lvlCls } from '../levels.js'

const props = defineProps({
  reqId: { type: String, required: true },
  card: { type: Object, default: () => ({}) },     // status 门控（confirm/abort 可用性）
  operator: { type: String, default: '' },
  blocks: { type: Array, default: () => [] },      // doc.json 当前块（新建 draft 的编辑基线）
  focusId: { type: Number, default: null }         // GR-3 横幅点入直达单详情
})
const emit = defineEmits(['toast', 'refresh'])

const list = ref([])
const loading = ref(true)
const mode = ref('list')            // list | detail | create | edit | confirm
const cur = ref(null)               // 当前单 detail（含 items/counts/blocks/impact?）
const busy = ref(false)

// draft 元信息表单
const form = ref({ title: '', detail: '', proposedBy: '' })
const editorRef = ref(null)

const KIND_LABEL = { change: '人工变更', reconcile: '对账', rebaseline: '重质检基准' }
const KIND_CLS = { change: 'b-blue', reconcile: 'b-gray', rebaseline: 'b-gray' }
const ST_LABEL = { draft: '草稿', confirmed: '已确认', aborted: '已放弃' }
const ST_CLS = { draft: 'b-amber', confirmed: 'b-blue', aborted: 'b-gray' }
const ROW_KIND = { feature: '功能点', flow: '流程', state: '状态' }

const canConfirm = computed(() => ['published', 'changed'].includes(props.card.status))
const latestConfirmedId = computed(() => {
  const c = list.value.find(x => x.status === 'confirmed')   // 列表 id 倒序 → 首个 confirmed 即最新
  return c ? c.id : null
})

async function loadList() {
  loading.value = true
  try { list.value = await api.get(`/api/requirements/${props.reqId}/changes`) }
  catch (e) { emit('toast', e.message, 'err') }
  finally { loading.value = false }
}
onMounted(async () => {
  await loadList()
  if (props.focusId != null) openDetail(props.focusId)
})
watch(() => props.focusId, id => { if (id != null) openDetail(id) })

// ===== 详情 / 编辑 / 新建 =====
async function openDetail(id) {
  try {
    cur.value = await api.get(`/api/requirements/${props.reqId}/changes/${id}`)
    mode.value = 'detail'
  } catch (e) { emit('toast', e.message, 'err') }
}
function startCreate() {
  cur.value = null
  form.value = { title: '', detail: '', proposedBy: props.operator || '' }
  mode.value = 'create'
}
function startEdit() {
  form.value = { title: cur.value.title, detail: cur.value.detail, proposedBy: cur.value.proposedBy }
  mode.value = 'edit'
}
async function cancelCompose() {
  if (editorRef.value?.isDirty() && cur.value?.blocks?.length
      && !await ask({ title: '放弃未保存的编辑？', body: cur.value
        ? '草稿已保存的 items 不受影响；本次改动不保存。' : '新建草稿内容将丢失。', danger: true, confirmText: '放弃' })) return
  if (cur.value) await openDetail(cur.value.id)
  else backToList()
}
function backToList() { mode.value = 'list'; cur.value = null; loadList() }

function payloadOrToast() {
  const r = editorRef.value?.getPayload()
  if (!r || !r.ok) {
    emit('toast', '本地校验未通过：' + (r?.problems?.[0]?.msg || '未知问题'), 'err')
    return null
  }
  return r.blocks
}
async function saveDraft() {
  if (!form.value.title.trim()) return emit('toast', '请填写变更单标题', 'err')
  if (!form.value.proposedBy.trim()) return emit('toast', '请填写提单人（留痕必填）', 'err')
  const blocks = payloadOrToast()
  if (!blocks) return
  busy.value = true
  try {
    const body = { title: form.value.title.trim(), detail: form.value.detail.trim(),
      proposedBy: form.value.proposedBy.trim(), blocks }
    const saved = cur.value
      ? await api.put(`/api/requirements/${props.reqId}/changes/${cur.value.id}`, body)
      : await api.post(`/api/requirements/${props.reqId}/changes`, body)
    localStorage.setItem('sdlc.op', form.value.proposedBy.trim())
    cur.value = saved
    mode.value = 'detail'
    emit('toast', `变更单 #${saved.id} 已保存（${fmtCounts(saved.counts)}）——确认后才写入原文`)
    loadList()
  } catch (e) { emit('toast', e.message, 'err') } finally { busy.value = false }
}
async function delDraft() {
  if (!await ask({ title: `删除变更单 #${cur.value.id}？`, body: 'draft 未碰块表，删除零代价（§5.6）。',
    danger: true, confirmText: '删除' })) return
  busy.value = true
  try {
    await api.del(`/api/requirements/${props.reqId}/changes/${cur.value.id}`)
    emit('toast', `变更单 #${cur.value.id} 已删除`)
    backToList()
  } catch (e) { emit('toast', e.message, 'err') } finally { busy.value = false }
}

// ===== confirm：diff + 四类清单（机械值可增删，随 body.impact 提交） =====
const impact = ref(null)            // GET impact 预览（机械值）
const sel = ref(null)               // 四类清单勾选：{ clarify:Set, fr:Set, cases:Set, rows:Set }
const confirmedBy = ref('')
const impactLoading = ref(false)

async function startConfirm() {
  confirmedBy.value = props.operator || ''
  impactLoading.value = true
  mode.value = 'confirm'
  try {
    impact.value = await api.get(`/api/requirements/${props.reqId}/changes/${cur.value.id}/impact`)
    sel.value = {
      clarify: new Set(impact.value.clarifyItems.map(x => x.seq)),
      fr: new Set(impact.value.frPoints.map(x => x.id)),
      cases: new Set(impact.value.cases.map(x => x.id)),
      rows: new Set(impact.value.digestRows.map((x, i) => String(i)))
    }
  } catch (e) { emit('toast', e.message, 'err'); mode.value = 'detail' }
  finally { impactLoading.value = false }
}
/** 四类清单勾选结果 → 提交 impact（blocks/sections 机械值原样，counts 重算） */
function buildImpact() {
  const iv = impact.value
  const keep = {
    clarifyItems: iv.clarifyItems.filter(x => sel.value.clarify.has(x.seq)),
    frPoints: iv.frPoints.filter(x => sel.value.fr.has(x.id)),
    cases: iv.cases.filter(x => sel.value.cases.has(x.id)),
    digestRows: iv.digestRows.filter((x, i) => sel.value.rows.has(String(i)))
  }
  return {
    ...iv,
    ...keep,
    counts: { ...iv.counts, clarify: keep.clarifyItems.length, frPoints: keep.frPoints.length,
      cases: keep.cases.length, digestRows: keep.digestRows.length }
  }
}
const impactEmpty = computed(() => {
  if (!impact.value) return false
  const c = impact.value.counts || {}
  return !c.blocks && !c.sections && !c.clarify && !c.frPoints && !c.cases && !c.digestRows
})
async function doConfirm() {
  if (!confirmedBy.value.trim()) return emit('toast', '请填写确认人（留痕必填）', 'err')
  if (impactEmpty.value && !await ask({
    title: `确认空影响面变更单 #${cur.value.id}？`, body: '影响面为空：confirm 后无增量质检面（仅 content_rev+1 与澄清重开无对象）。', confirmText: '仍要确认' })) return
  if (!await ask({
    title: `确认变更单 #${cur.value.id}？`,
    body: '确认即生效：块表应用、卡片转「变更中（changed）」、受影响澄清项重开（原答复挪入备注）、content_rev+1、增量质检自动排队。',
    danger: true, confirmText: '确认变更' })) return
  busy.value = true
  try {
    await api.post(`/api/requirements/${props.reqId}/changes/${cur.value.id}/confirm`,
      { confirmedBy: confirmedBy.value.trim(), impact: buildImpact() })
    localStorage.setItem('sdlc.op', confirmedBy.value.trim())
    emit('toast', `变更单 #${cur.value.id} 已确认：卡片转「变更中」，增量质检排队中（合并完成后可重新发布）`)
    emit('refresh')
    backToList()
  } catch (e) {
    // §6 关键词分流：未消化 → 指引增量通道；基线漂移 → 刷新重编
    emit('toast', e.message, 'err')
  } finally { busy.value = false }
}

async function doAbort() {
  if (!await ask({
    title: `放弃变更 #${cur.value.id}？`,
    body: '块表与澄清将回滚到变更前（全量逆向），卡片回「已发布」；content_rev 不回退。仅最新 confirmed 单可放弃。',
    danger: true, confirmText: '放弃变更'
  })) return
  const by = props.operator || ''
  if (!by.trim()) return emit('toast', '请先在详情头部填写操作人', 'err')
  busy.value = true
  try {
    await api.post(`/api/requirements/${props.reqId}/changes/${cur.value.id}/abort`, { abortedBy: by.trim() })
    emit('toast', `变更单 #${cur.value.id} 已放弃：块表与澄清已回滚`)
    emit('refresh')
    backToList()
  } catch (e) { emit('toast', e.message, 'err') } finally { busy.value = false }
}

function fmtCounts(c) {
  if (!c) return '无差异'
  return ['edit', 'insert', 'delete', 'move'].map(k => `${({ edit: '变更', insert: '新增', delete: '删除', move: '移动' })[k]} ${c[k] || 0}`).join(' · ')
}
</script>

<template>
  <!-- 列表 -->
  <div v-if="mode === 'list'">
    <div class="card">
      <div class="chg-head">
        <h3>需求内容变更</h3>
        <span class="sub">draft 随时可提（不碰原文）；确认后才写入块表并转「变更中」。</span>
        <span class="spacer"></span>
        <button class="btn primary" @click="startCreate"><AppIcon name="plus" :size="13" />提变更单</button>
      </div>
      <EmptyState v-if="loading" icon="inbox" title="加载中…" />
      <EmptyState v-else-if="!list.length" icon="inbox" title="暂无变更单"
                  desc="已发布后如需修改原文，提变更单 → 确认 → 增量质检合并 → 重新发布" />
      <table class="table" v-else>
        <thead><tr><th style="width:70px">单号</th><th style="width:96px">类型</th><th>标题</th>
          <th style="width:92px">状态</th><th style="width:170px">提单 / 确认</th><th style="width:170px">时间</th></tr></thead>
        <tbody>
          <tr v-for="c in list" :key="c.id" tabindex="0" @click="openDetail(c.id)" @keydown.enter.self.prevent="openDetail(c.id)">
            <td><code>#{{ c.id }}</code></td>
            <td><span class="badge" :class="KIND_CLS[c.kind]">{{ KIND_LABEL[c.kind] || c.kind }}</span></td>
            <td><div class="cell-ell">{{ c.title || '（无标题）' }}</div></td>
            <td><span class="badge" :class="ST_CLS[c.status]">{{ ST_LABEL[c.status] || c.status }}</span></td>
            <td class="sub">{{ c.proposedBy || '—' }}<template v-if="c.confirmedBy"> / {{ c.confirmedBy }}</template><template v-else-if="c.abortedBy"> / 放弃:{{ c.abortedBy }}</template></td>
            <td class="sub">{{ c.confirmedAt || c.abortedAt || c.createdAt }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>

  <!-- 新建 / 编辑 draft：元信息 + 编辑器（与窗口 1 同一组件，仅提交端点不同） -->
  <div v-else-if="mode === 'create' || mode === 'edit'">
    <div class="card">
      <div class="chg-head">
        <h3>{{ mode === 'create' ? '提变更单' : `编辑变更单 #${cur.id}` }}</h3>
        <span class="sub">{{ mode === 'create' ? '基于当前原文起草；保存即算 diff 出四态 items，confirm 才生效。'
          : 'items 全量重算（相对当前块表基线）；已生成的 blk- ID 沿用不漂移。' }}</span>
      </div>
      <div class="field"><label><em>*</em>标题</label><input v-model="form.title" placeholder="如：口径修订——验收标准对齐新边界"></div>
      <div class="field"><label>变更说明</label><textarea v-model="form.detail" rows="2" placeholder="为什么改、影响什么（可选）"></textarea></div>
      <div class="field"><label><em>*</em>提单人</label><input v-model="form.proposedBy" style="max-width:200px" placeholder="手填身份（留痕）"></div>
      <div class="bedit-topbar" style="margin-top:10px">
        <span class="lbl"><AppIcon name="pencil" :size="12" />草案内容（全量块数组）</span>
        <span class="spacer"></span>
        <button class="btn" :disabled="busy" @click="cancelCompose">取消</button>
        <button class="btn primary" :disabled="busy" @click="saveDraft">
          <AppIcon name="check-circle" :size="13" />{{ busy ? '保存中…' : '保存草稿（算 diff）' }}</button>
      </div>
      <BlockEditor ref="editorRef" :req-id="reqId"
                   :blocks="mode === 'edit' ? (cur.blocks || []) : blocks"
                   @error="e => emit('toast', e.message, 'err')" />
    </div>
  </div>

  <!-- 详情 -->
  <div v-else-if="mode === 'detail' && cur">
    <button class="btn link" @click="backToList"><AppIcon name="arrow-left" :size="13" />返回列表</button>
    <div class="card">
      <div class="chg-head">
        <h3><code>#{{ cur.id }}</code> {{ cur.title || '（无标题）' }}
          <span class="badge" :class="KIND_CLS[cur.kind]">{{ KIND_LABEL[cur.kind] || cur.kind }}</span>
          <span class="badge" :class="ST_CLS[cur.status]">{{ ST_LABEL[cur.status] || cur.status }}</span></h3>
        <span class="spacer"></span>
        <template v-if="cur.status === 'draft'">
          <button class="btn" :disabled="busy" @click="startEdit"><AppIcon name="pencil" :size="12" />编辑</button>
          <button class="btn danger" :disabled="busy" @click="delDraft"><AppIcon name="trash" :size="12" />删除</button>
          <button class="btn primary" :disabled="busy" @click="startConfirm"
                  :title="canConfirm ? '应用块表并转变更中' : '仅已发布/变更中卡片可确认（未发布卡的原文修改走窗口 1 直接编辑）'">
            <AppIcon name="check-circle" :size="13" />确认变更…</button>
        </template>
        <button class="btn danger" v-if="cur.status === 'confirmed' && card.status === 'changed' && cur.id === latestConfirmedId"
                :disabled="busy" @click="doAbort"
                title="全量逆向回滚：块表与澄清回变更前，content_rev 不回退">
          <AppIcon name="refresh-cw" :size="12" />放弃变更（回滚）</button>
      </div>
      <div class="meta" style="margin-bottom:10px">
        <span class="sub">提单 {{ cur.proposedBy || '—' }} · {{ cur.createdAt }}</span>
        <span class="sub" v-if="cur.confirmedBy">确认 {{ cur.confirmedBy }} · {{ cur.confirmedAt }}</span>
        <span class="sub" v-if="cur.abortedBy">放弃 {{ cur.abortedBy }} · {{ cur.abortedAt }}</span>
        <span class="chip" v-for="[k, n] in Object.entries(cur.counts || {}).filter(([, n]) => n)" :key="k">{{ ({ edit: '变更', insert: '新增', delete: '删除', move: '移动' })[k] || k }} {{ n }}</span>
      </div>
      <div class="sub" v-if="cur.detail" style="margin-bottom:10px">{{ cur.detail }}</div>
      <BlockDiff :items="cur.items" :counts="cur.counts" />
      <div class="banner" v-if="cur.status === 'draft'" style="margin-top:10px">
        <AppIcon name="info" :size="14" />
        <span>草稿未生效：确认后写入原文块表（published → changed、澄清重开、增量质检自动排队）。</span>
      </div>
      <div class="banner" v-else-if="cur.status === 'confirmed' && card.status === 'changed'" style="margin-top:10px">
        <AppIcon name="clock" :size="14" />
        <span>已生效：等增量质检任务完成并在流水线采纳合并后，即可从草稿预览重新发布。</span>
      </div>
    </div>
  </div>

  <!-- confirm 界面：diff + 四类清单 -->
  <div v-else-if="mode === 'confirm' && cur">
    <button class="btn link" @click="mode = 'detail'"><AppIcon name="arrow-left" :size="13" />返回单详情</button>
    <div class="card">
      <div class="chg-head">
        <h3>确认变更单 #{{ cur.id }} · {{ cur.title }}</h3>
        <span class="badge b-amber">待确认</span>
      </div>
      <div class="banner amber-t" style="margin-bottom:12px">
        <AppIcon name="alert-triangle" :size="14" />
        <span style="flex:1"><b>确认即生效</b>：块表应用 · 卡片转「变更中」· 受影响澄清项重开（原答复挪入备注，需重新处置）· content_rev+1 · 增量质检自动排队。</span>
        <span class="op-inline"><AppIcon name="user" :size="12" />确认人 <input v-model="confirmedBy" class="op-input" placeholder="手填身份"></span>
      </div>
      <EmptyState v-if="impactLoading" icon="inbox" title="计算影响面…" />
      <template v-else>
        <h3 style="margin-bottom:8px">块级差异（{{ fmtCounts(cur.counts) }}）</h3>
        <BlockDiff :items="cur.items" :counts="cur.counts" />
        <h3 style="margin:16px 0 8px">影响面四类清单 <span class="sub">（机械预览值，可取消勾选排除——排除项不随单冻结）</span></h3>
        <div class="impact-grid">
          <div class="impact-col">
            <div class="impact-t">澄清项（{{ sel.clarify.size }}）<span class="sub">将重开</span></div>
            <label class="impact-row" v-for="x in impact.clarifyItems" :key="x.seq">
              <input type="checkbox" v-model="sel.clarify" :value="x.seq">
              <span class="badge" :class="lvlCls[x.level]">{{ lvlLabel[x.level] }}</span>
              <span class="chip">{{ x.seq }}</span>{{ x.question }}
            </label>
            <div class="sub" v-if="!impact.clarifyItems.length" style="padding:4px 2px">无</div>
          </div>
          <div class="impact-col">
            <div class="impact-t">需求点（{{ sel.fr.size }}）</div>
            <label class="impact-row" v-for="x in impact.frPoints" :key="x.id">
              <input type="checkbox" v-model="sel.fr" :value="x.id">
              <code>{{ x.id }}</code>{{ x.name }}
            </label>
            <div class="sub" v-if="!impact.frPoints.length" style="padding:4px 2px">无</div>
          </div>
          <div class="impact-col">
            <div class="impact-t">关联用例（{{ sel.cases.size }}）</div>
            <label class="impact-row" v-for="x in impact.cases" :key="x.id">
              <input type="checkbox" v-model="sel.cases" :value="x.id">
              <code>{{ x.id }}</code>{{ x.title }}
            </label>
            <div class="sub" v-if="!impact.cases.length" style="padding:4px 2px">无</div>
          </div>
          <div class="impact-col">
            <div class="impact-t">摘要行（{{ sel.rows.size }}）</div>
            <label class="impact-row" v-for="(x, i) in impact.digestRows" :key="i">
              <input type="checkbox" v-model="sel.rows" :value="String(i)">
              <span class="chip">{{ ROW_KIND[x.kind] || x.kind }}</span>{{ x.summary }}
            </label>
            <div class="sub" v-if="!impact.digestRows.length" style="padding:4px 2px">无</div>
          </div>
        </div>
        <div class="banner" v-if="impact.sections && impact.sections.length" style="margin-top:10px">
          <AppIcon name="list-tree" :size="14" />
          <span>受影响章节：{{ impact.sections.map(s => s.path || s.headingId).join('、') }}</span>
        </div>
        <div class="tp-btns" style="margin-top:14px">
          <button class="btn" @click="mode = 'detail'">返回修改</button>
          <button class="btn primary" :disabled="busy || impactLoading" @click="doConfirm">
            <AppIcon name="check-circle" :size="13" />{{ busy ? '确认中…' : '确认变更（应用块表）' }}</button>
        </div>
      </template>
    </div>
  </div>
</template>

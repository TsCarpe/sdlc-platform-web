<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { api } from '../api.js'
import { pendingJump, jumpTo, consumeJump } from '../trace.js'
import { fmtRel } from '../time.js'
import AppIcon from './AppIcon.vue'
import Dropdown from './Dropdown.vue'
import ChipList from './ChipList.vue'
import EmptyState from './EmptyState.vue'

const emit = defineEmits(['toast'])
// fixedReqId：工作台内嵌模式（DESIGN-v2.4 D37）——需求固定，隐藏需求/迭代筛选
const props = defineProps({ fixedReqId: String })
const rows = ref([])
const reqs = ref([])
const cq = ref({ iter: '', req: props.fixedReqId || '', status: '', tool: '', q: '' })
const cm = ref(null)          // 用例详情/编辑弹层
const nf = ref(null)          // 表单提交弹层
const cmtText = ref('')
const knownPoints = ref([])
const loading = ref(true)
const error = ref('')
const saving = ref(false)
const savingCmt = ref(false)

const priCls = { P0: 'b-red', P1: 'b-amber', P2: 'b-gray' }
const statusLabel = { draft: '待审核', reviewed: '已定稿' }

const iterations = computed(() => [...new Set(rows.value.map(r => r.iter).filter(Boolean))].sort())

// ===== 自定义下拉选项（Dropdown 替代原生 select，选项面板可统一样式；大列表走 searchable） =====
const iterOpts = computed(() => [{ value: '', label: '全部迭代' }, ...iterations.value.map(i => ({ value: i, label: i }))])
const reqOpts = computed(() => [{ value: '', label: '全部需求' }, ...reqs.value.map(r => ({ value: r.id, label: r.name }))])
const reqIdOpts = computed(() => reqs.value.map(r => ({ value: r.id, label: `${r.name}（${r.id}）` })))
const statusOpts = [{ value: '', label: '全部状态' }, { value: 'draft', label: '待审核' }, { value: 'reviewed', label: '已定稿' }]
const toolOpts = [{ value: '', label: '全部来源' }, { value: 'sdlc-test', label: 'sdlc-test 推送' }, { value: '表单', label: '表单提交' }]
const priOpts = [{ value: 'P0', label: 'P0' }, { value: 'P1', label: 'P1' }, { value: 'P2', label: 'P2' }]

// ===== 列排序（评测 P2-7）：默认服务端顺序，点击表头切换；caseNo 优先于来源编号 =====
const sortKey = ref('')
const sortDir = ref('desc')
function sortBy(k) {
  if (sortKey.value === k) sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  else { sortKey.value = k; sortDir.value = 'desc' }
}
const sorted = computed(() => {
  if (!sortKey.value) return rows.value
  const k = sortKey.value, dir = sortDir.value === 'asc' ? 1 : -1
  return [...rows.value].sort((a, b) => {
    const x = k === 'id' ? (a.caseNo ?? a.id) : (a[k] ?? '')
    const y = k === 'id' ? (b.caseNo ?? b.id) : (b[k] ?? '')
    return (typeof x === 'number' ? x - y : String(x).localeCompare(String(y))) * dir
  })
})

async function load() {
  loading.value = true
  error.value = ''
  try {
    const q = new URLSearchParams()
    Object.entries(cq.value).forEach(([k, v]) => { if (v) q.set(k === 'req' ? 'reqId' : k, v) })
    rows.value = await api.get('/api/cases?' + q.toString())
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

async function loadReqs() {
  try {
    reqs.value = await api.get('/api/requirements')
  } catch { /* 需求下拉失败不阻塞用例列表 */ }
}

// 搜索防抖自动查询；select 变化即查（@change）
let qTimer = null
watch(() => cq.value.q, () => {
  clearTimeout(qTimer)
  qTimer = setTimeout(load, 350)
})
function clearSearch() {
  cq.value.q = ''
  clearTimeout(qTimer)
  load()
}

function parsePoints(s) {
  try { return JSON.parse(s || '[]') } catch { return [] }
}

onMounted(async () => {
  await Promise.all([load(), loadReqs()])
  applyJump()          // 跨页跳入：数据就绪后打开目标用例
})

// ===== v1.1 追溯（R1/R2/R4） =====

/** 用例 → 需求点（R1①）：跳 Digest 需求点行 */
function jumpFr(reqId, frId) {
  jumpTo({ page: 'reqs', reqId, kind: 'fr', id: frId })
}

/** 用例重点验证引用（R2）：体检.Pxx → 体检条目；需求.Axx → digest 假设行 */
function jumpRef(reqId, ref) {
  if (ref.startsWith('体检.')) jumpTo({ page: 'reqs', reqId, kind: 'audit', id: ref.slice(3) })
  else jumpTo({ page: 'reqs', reqId, kind: 'asm', id: ref })
}

/** 缺陷编号引用（R4）：纯文本引用，缺陷本体留在本地 cases.md */
function toastDefect() {
  emit('toast', '缺陷留在本地工作区 cases.md（不上平台）')
}

/** 消费需求域跳入（R1②/R2 反向）：筛选到需求并打开目标用例详情 */
async function applyJump() {
  const j = pendingJump
  if (!j.nonce || j.page !== 'cases' || j.kind !== 'case') return
  consumeJump()
  cq.value.req = j.reqId
  await load()
  const row = rows.value.find(r => r.reqId === j.reqId && r.id === j.id)
  if (row) await openCase(row)
  else emit('toast', `未找到用例 ${j.id}（可能尚未推送或编号有误）`, 'err')
}
watch(() => pendingJump.nonce, () => applyJump())

async function openCase(row) {
  const d = await api.get(`/api/cases/${row.reqId}/${row.id}`)
  cm.value = { mode: 'view', draft: d }
  cmtText.value = ''
}
function closeCase() { cm.value = null }

// 弹窗 ESC 关闭（详情/表单二选一，表单优先）
function escClose(e) {
  if (e.key !== 'Escape') return
  if (nf.value) { nf.value = null; return }
  if (cm.value) closeCase()
}
watch([cm, nf], ([cmv, nfv]) => {
  if (cmv || nfv) window.addEventListener('keydown', escClose)
  else window.removeEventListener('keydown', escClose)
})

async function addComment() {
  const t = cmtText.value && cmtText.value.trim()
  if (!t || savingCmt.value) return
  savingCmt.value = true
  try {
    cm.value.draft = await api.post(`/api/cases/${cm.value.draft.reqId}/${cm.value.draft.id}/comments`, { by: '平台用户', text: t })
    cmtText.value = ''
    emit('toast', '评论已提交，维护人将在本地迭代后重推')
  } catch (e) {
    emit('toast', e.message, 'err')
  } finally {
    savingCmt.value = false
  }
}

function startEdit() { cm.value.mode = 'edit' }

async function saveEdit() {
  const d = cm.value.draft
  try {
    cm.value.draft = await api.patch(`/api/cases/${d.reqId}/${d.id}`, {
      title: d.title, points: d.points, priority: d.priority,
      pre: d.pre, steps: d.steps, expect: d.expect, expectedVersion: d.version
    })
    cm.value.mode = 'view'
    emit('toast', '已保存')
    await load()
  } catch (e) {
    emit('toast', e.message, 'err')
  }
}

function openNewCase() {
  nf.value = { draft: { reqId: '', title: '', pointsStr: '', priority: 'P1', pre: '', steps: '', expect: '', owner: '' } }
}

const vFocus = { mounted: el => el.focus() }

async function validatePoints(reqId, points) {
  if (!points.length) return []
  const res = await api.get('/api/fr-points?req_id=' + encodeURIComponent(reqId))
  knownPoints.value = res.points
  return points.filter(p => !res.points.includes(p))
}

async function submitForm() {
  const d = nf.value.draft
  if (!d.reqId) return emit('toast', '请选择关联需求', 'err')
  if (!d.title.trim()) return emit('toast', '请填写用例标题', 'err')
  if (!d.pointsStr.trim()) return emit('toast', '请填写关联需求点', 'err')
  if (!d.steps.trim() || !d.expect.trim()) return emit('toast', '请填写步骤与预期结果', 'err')
  if (!d.owner.trim()) return emit('toast', '请填写来源人', 'err')
  const points = d.pointsStr.split(/[,，、\s]+/).filter(Boolean)
  saving.value = true
  try {
    const unknown = await validatePoints(d.reqId, points)
    await api.post('/api/cases/form', { ...d, points })
    nf.value = null
    emit('toast', unknown.length
      ? `已提交（${d.priority}）。软校验提醒：未在已发布需求点中找到 ${unknown.join('、')}（仍已登记）`
      : '用例已登记，需求点关联校验通过')
    await load()
  } catch (e) {
    emit('toast', e.message, 'err')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div>
    <details class="cl-note">
      <summary><AppIcon name="info" :size="13" />双来源登记说明</summary>
      <div class="banner blue" style="margin-top:6px">
        <span><b>sdlc-test 推送</b>的用例由维护人经本地工作区迭代（平台只读 + 评论），<b>表单提交</b>的用例提交人可在平台编辑。用例只有审核态，执行结果与缺陷留在本地工作流。</span>
      </div>
    </details>

    <div class="filters">
      <Dropdown v-if="!props.fixedReqId" v-model="cq.iter" :options="iterOpts" searchable
                aria-label="按迭代筛选" @change="load" />
      <Dropdown v-if="!props.fixedReqId" v-model="cq.req" :options="reqOpts" searchable
                aria-label="按需求筛选" @change="load" />
      <Dropdown v-model="cq.status" :options="statusOpts" aria-label="按审核状态筛选" @change="load" />
      <Dropdown v-model="cq.tool" :options="toolOpts" aria-label="按来源筛选" @change="load" />
      <div class="search">
        <AppIcon name="search" :size="13" />
        <input v-model="cq.q" placeholder="搜索用例标题…" @keyup.enter="load">
        <button class="clear" v-if="cq.q" @click="clearSearch" aria-label="清空搜索"><AppIcon name="x" :size="13" /></button>
      </div>
      <div class="spacer"></div>
      <button class="btn primary" @click="openNewCase"><AppIcon name="plus" :size="14" />表单提交用例</button>
    </div>

    <!-- 加载骨架 -->
    <div class="card" v-if="loading && !rows.length">
      <div class="skel skel-line" style="width:90%" v-for="i in 7" :key="i"></div>
    </div>

    <!-- 加载失败 -->
    <EmptyState v-else-if="error" icon="alert-circle" tone="error" title="用例列表加载失败" :desc="error">
      <button class="btn" @click="load"><AppIcon name="refresh-cw" :size="13" />重试</button>
    </EmptyState>

    <table class="table table-fixed" v-else>
      <thead><tr>
        <th style="width:96px" class="sortable" :class="{ on: sortKey === 'id', asc: sortDir === 'asc' }" @click="sortBy('id')">编号</th>
        <th style="width:32%" class="sortable" :class="{ on: sortKey === 'title', asc: sortDir === 'asc' }" @click="sortBy('title')">标题</th>
        <th style="width:220px">关联需求点</th>
        <th style="width:70px" class="sortable" :class="{ on: sortKey === 'priority', asc: sortDir === 'asc' }" @click="sortBy('priority')">优先级</th>
        <th style="width:90px" class="sortable" :class="{ on: sortKey === 'status', asc: sortDir === 'asc' }" @click="sortBy('status')">审核状态</th>
        <th style="width:80px">来源人</th>
        <th style="width:110px" class="sortable" :class="{ on: sortKey === 'tool', asc: sortDir === 'asc' }" @click="sortBy('tool')">来源工具</th>
        <th style="width:110px">需求</th><th class="row-arrow"></th>
      </tr></thead>
      <tbody>
        <tr v-for="c in sorted" :key="c.reqId + '/' + c.id" tabindex="0" @click="openCase(c)"
            @keydown.enter.prevent="openCase(c)">
          <td class="sub"><div>{{ c.id }}</div><div class="caseno" v-if="c.caseNo" title="全局登记序号（跨需求唯一，口头可引用）">#{{ c.caseNo }}</div></td>
          <td><div class="cell-ell" :title="c.title">{{ c.title }}</div></td>
          <td class="cell-pts">
            <span class="sub" v-if="!parsePoints(c.points).length">—</span>
            <ChipList v-else :items="parsePoints(c.points)" :max="2">
              <template #default="{ item }">
                <a class="chip linklike" :class="{ real: !item.startsWith('WEB-') }"
                   @click.stop="jumpFr(c.reqId, item)">{{ item }}</a>
              </template>
            </ChipList>
          </td>
          <td><span class="badge" :class="priCls[c.priority]">{{ c.priority }}</span></td>
          <td><span class="badge" :class="c.status === 'reviewed' ? 'b-green' : 'b-gray'">{{ statusLabel[c.status] }}</span></td>
          <td class="sub">{{ c.owner }}</td>
          <td class="sub">{{ c.tool }}</td>
          <td class="sub"><div class="cell-ell" :title="c.reqName">{{ c.reqName }}</div></td>
          <td class="row-arrow"><AppIcon name="chevron-right" :size="14" /></td>
        </tr>
        <tr v-if="!rows.length"><td colspan="9" class="cell-empty">
          <EmptyState icon="flask" title="当前筛选条件下没有用例"
                      :desc="cq.q || cq.req || cq.iter || cq.status || cq.tool ? '可调整或清空筛选条件' : '由 sdlc-test 推送，或点击右上角「表单提交用例」登记'" />
        </td></tr>
      </tbody>
    </table>

    <!-- 用例详情/编辑弹层 -->
    <div class="modal-mask" v-if="cm" @click.self="closeCase">
      <div class="modal" role="dialog" aria-modal="true">
        <div class="modal-h">
          <AppIcon name="flask" :size="14" style="color:var(--muted)" />
          {{ (cm.mode === 'edit' ? '编辑用例 · ' : '用例详情 · ') + cm.draft.id + (cm.draft.caseNo ? ` · #${cm.draft.caseNo}` : '') }}
          <button class="x" @click="closeCase" aria-label="关闭"><AppIcon name="x" :size="16" /></button>
        </div>
        <div class="modal-b">
          <template v-if="cm.mode === 'view'">
            <div class="banner" v-if="cm.draft.readonly" style="margin-bottom:14px">
              <AppIcon name="lock" :size="14" />
              <span>该用例由 {{ cm.draft.tool }} 从本地工作区推送维护，平台内<b>只读</b>。修改建议请通过评论反馈给维护人 <b>{{ cm.draft.owner }}</b>，由其本地迭代后重推。</span>
            </div>
            <div class="field"><label>标题</label><div>{{ cm.draft.title }}</div></div>
            <div class="field"><label>关联需求点（点击跳转需求点原文上下文）</label>
              <a class="chip linklike" v-for="p in cm.draft.points" :key="p"
                 @click="jumpFr(cm.draft.reqId, p)">{{ p }}</a>
              <span class="sub" v-if="!cm.draft.points.length">—</span></div>
            <div class="field" v-if="(cm.draft.verifyRefs || []).length"><label>重点验证（点击回跳体检问题/假设）</label>
              <a class="chip linklike real" v-for="r in cm.draft.verifyRefs" :key="r"
                 @click="jumpRef(cm.draft.reqId, r)">{{ r }}</a></div>
            <div class="field" v-if="(cm.draft.defectRefs || []).length"><label>产出缺陷（仅编号引用，详情在本地 cases.md）</label>
              <a class="chip linklike warn" v-for="r in cm.draft.defectRefs" :key="r"
                 @click="toastDefect">{{ r }}</a></div>
            <div class="field"><label>优先级 / 审核状态 / 来源</label>
              <div>{{ cm.draft.priority }} · {{ statusLabel[cm.draft.status] }} · {{ cm.draft.tool }} / {{ cm.draft.owner }}</div></div>
            <div class="field"><label>前置条件</label><div>{{ cm.draft.pre || '—' }}</div></div>
            <div class="field"><label>步骤</label><pre class="srctext">{{ cm.draft.steps }}</pre></div>
            <div class="field"><label>预期结果</label><div>{{ cm.draft.expect }}</div></div>
            <div class="comments">
              <h4><AppIcon name="message-square" :size="13" />评论（{{ cm.draft.comments.length }}）</h4>
              <p class="sub" v-if="!cm.draft.comments.length" style="margin-bottom:6px">暂无评论——有修改建议时留给维护人。</p>
              <div class="cmt" v-for="c in cm.draft.comments" :key="c.id">
                <span class="at" :title="c.createdAt">{{ fmtRel(c.createdAt) }}</span><span class="by">{{ c.by }}</span>{{ c.text }}
              </div>
              <div class="cmt-input">
                <textarea v-model="cmtText" rows="2" placeholder="写下修改建议或评审意见…"></textarea>
                <div class="cmt-foot">
                  <span class="cmt-hint"><kbd>⌘/Ctrl</kbd> + <kbd>Enter</kbd> 提交</span>
                  <div class="spacer" style="flex:1"></div>
                  <button class="btn primary small" :disabled="savingCmt" @click="addComment">
                    <AppIcon name="send" :size="12" />{{ savingCmt ? '提交中…' : '评论' }}</button>
                </div>
              </div>
            </div>
          </template>
          <template v-else>
            <div class="field"><label><em>*</em>用例标题</label><input v-model="cm.draft.title" v-focus></div>
            <div class="field"><label><em>*</em>关联需求点（多个用逗号分隔）</label>
              <input :value="cm.draft.points.join(', ')" @input="cm.draft.points = $event.target.value.split(/[,，、\s]+/).filter(Boolean)"></div>
            <div class="field"><label>优先级</label>
              <Dropdown v-model="cm.draft.priority" :options="priOpts" aria-label="优先级" /></div>
            <div class="field"><label>前置条件</label><input v-model="cm.draft.pre"></div>
            <div class="field"><label><em>*</em>步骤（每行一步）</label><textarea v-model="cm.draft.steps"></textarea></div>
            <div class="field"><label><em>*</em>预期结果</label><textarea v-model="cm.draft.expect" style="min-height:46px"></textarea></div>
          </template>
        </div>
        <div class="modal-f" v-if="cm.mode !== 'view'">
          <button class="btn" @click="cm.mode = 'view'">取消</button>
          <button class="btn primary" :disabled="saving" @click="saveEdit">{{ saving ? '保存中…' : '保存修改' }}</button>
        </div>
        <div class="modal-f" v-else>
          <button class="btn" v-if="!cm.draft.readonly" @click="startEdit"><AppIcon name="pencil" :size="12" />编辑</button>
          <button class="btn primary" @click="closeCase">关闭</button>
        </div>
      </div>
    </div>

    <!-- 表单提交弹层 -->
    <div class="modal-mask" v-if="nf" @click.self="nf = null">
      <div class="modal" role="dialog" aria-modal="true">
        <div class="modal-h">表单提交用例
          <button class="x" @click="nf = null" aria-label="关闭"><AppIcon name="x" :size="16" /></button>
        </div>
        <div class="modal-b">
          <div class="field"><label><em>*</em>关联需求</label>
            <Dropdown v-model="nf.draft.reqId" :options="reqIdOpts" searchable autofocus aria-label="关联需求" />
          </div>
          <div class="field"><label><em>*</em>用例标题</label><input v-model="nf.draft.title" placeholder="一句话说清验证什么"></div>
          <div class="field"><label><em>*</em>关联需求点（多个用逗号分隔，保存时软校验）</label>
            <input v-model="nf.draft.pointsStr" placeholder="如 需求.FR-03, 需求.FR-07"></div>
          <div class="field"><label>优先级</label>
            <Dropdown v-model="nf.draft.priority" :options="priOpts" aria-label="优先级" /></div>
          <div class="field"><label>前置条件</label><input v-model="nf.draft.pre"></div>
          <div class="field"><label><em>*</em>步骤（每行一步）</label><textarea v-model="nf.draft.steps"></textarea></div>
          <div class="field"><label><em>*</em>预期结果</label><textarea v-model="nf.draft.expect" style="min-height:46px"></textarea></div>
          <div class="field"><label><em>*</em>来源人（你的名字）</label><input v-model="nf.draft.owner"></div>
        </div>
        <div class="modal-f">
          <button class="btn" @click="nf = null">取消</button>
          <button class="btn primary" :disabled="saving" @click="submitForm">{{ saving ? '提交中…' : '提交用例' }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

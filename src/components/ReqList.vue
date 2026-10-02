<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { api } from '../api.js'
import AppIcon from './AppIcon.vue'
import Dropdown from './Dropdown.vue'
import EmptyState from './EmptyState.vue'
import { fmtRel } from '../time.js'
import { ask } from '../confirm.js'

const emit = defineEmits(['open', 'toast'])
const reqs = ref([])
const fq = ref({ iter: '', status: '' })
const nr = ref(null)
const loading = ref(true)
const error = ref('')
const saving = ref(false)

const statusLabel = { submitted: '已提交', reviewing: '质检中', clarifying: '待澄清', published: '已发布' }
const statusCls = { submitted: 'b-gray', reviewing: 'b-blue', clarifying: 'b-amber', published: 'b-green' }
const sourceLabel = { feishu: '飞书文档', text: '粘贴文本' }
// v1.3 风险分级徽章（DESIGN-v2.2 D19）：紧凑单字符，空=未分级不渲染
const tierCls = { A: 'b-red', B: 'b-amber', C: 'b-gray' }
const tierTip = { A: '风险分级 A：全管线', B: '风险分级 B：轻量管线', C: '风险分级 C：最轻管线' }

const iterations = computed(() => [...new Set(reqs.value.map(r => r.iter).filter(Boolean))].sort())
// 自定义下拉选项（Dropdown 替代原生 select，选项面板可统一样式）
const iterOpts = computed(() => [{ value: '', label: '全部迭代' }, ...iterations.value.map(i => ({ value: i, label: i }))])
const statusOpts = [
  { value: '', label: '全部状态' },
  ...Object.entries(statusLabel).map(([k, v]) => ({ value: k, label: v }))
]
const filtered = computed(() => reqs.value.filter(r =>
  (!fq.value.iter || r.iter === fq.value.iter) && (!fq.value.status || r.status === fq.value.status)))

// ===== 列排序（评测 P2-7）：默认服务端顺序（创建倒序），点击表头切换 =====
const sortKey = ref('')
const sortDir = ref('desc')
function sortBy(k) {
  if (sortKey.value === k) sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  else { sortKey.value = k; sortDir.value = 'desc' }
}
const sorted = computed(() => {
  if (!sortKey.value) return filtered.value
  const k = sortKey.value, dir = sortDir.value === 'asc' ? 1 : -1
  return [...filtered.value].sort((a, b) => {
    const x = a[k] ?? '', y = b[k] ?? ''
    return (typeof x === 'number' ? x - y : String(x).localeCompare(String(y))) * dir
  })
})
const countBy = s => reqs.value.filter(r => r.status === s).length

async function load() {
  loading.value = true
  error.value = ''
  try {
    reqs.value = await api.get('/api/requirements')
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}
onMounted(load)

// 统计卡即筛选：点卡片快速过滤对应状态
function statFilter(s) { fq.value.status = fq.value.status === s ? '' : s }
function clearFilter() { fq.value.status = '' }

/** 删除需求（评测 P0-3 软删除）：行内数据出确认框统计，DELETE 后本地移除 */
async function delReq(r) {
  const ok = await ask({
    title: `删除需求「${r.name.slice(0, 30)}${r.name.length > 30 ? '…' : ''}」？`,
    body: `软删除：列表与详情立即不可见，行与子表保留（恢复仅需一条 SQL，编号不回收）。\n现有澄清 ${r.answeredQ}/${r.totalQ} · 用例 ${r.caseCount} 条。`,
    danger: true,
    confirmText: '删除'
  })
  if (!ok) return
  try {
    await api.del(`/api/requirements/${r.id}`)
    reqs.value = reqs.value.filter(x => x.id !== r.id)
    emit('toast', `已删除 ${r.id}（软删除）`)
  } catch (e) { emit('toast', '删除失败：' + e.message, 'err') }
}

function open(id) { emit('open', id) }

function openNewReq() {
  nr.value = { draft: { name: '', iter: '', type: 'feishu', url: '', text: '', by: '' } }
}

const vFocus = { mounted: el => el.focus() }

function escClose(e) { if (e.key === 'Escape') nr.value = null }
watch(nr, v => {
  if (v) window.addEventListener('keydown', escClose)
  else window.removeEventListener('keydown', escClose)
})

async function saveNewReq() {
  const d = nr.value.draft
  if (!d.name.trim()) return emit('toast', '请填写需求名称', 'err')
  if (d.type === 'feishu' && !d.url.trim()) return emit('toast', '请填写飞书文档链接', 'err')
  if (d.type === 'text' && !d.text.trim()) return emit('toast', '请粘贴需求文本', 'err')
  saving.value = true
  try {
    await api.post('/api/requirements', {
      name: d.name, iter: d.iter, sourceType: d.type,
      sourceUrl: d.url, sourceText: d.text, submittedBy: d.by
    })
    nr.value = null
    emit('toast', '需求已登记（状态：已提交）。可在详情页点「开始质检」线上完成。')
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
    <!-- 加载骨架 -->
    <template v-if="loading && !reqs.length">
      <div class="stats">
        <div class="stat" v-for="i in 4" :key="i"><div class="skel skel-line" style="width:70%;margin:0"></div></div>
      </div>
      <div class="card">
        <div class="skel skel-line" style="width:88%" v-for="i in 6" :key="i"></div>
      </div>
    </template>

    <!-- 加载失败 -->
    <EmptyState v-else-if="error" icon="alert-circle" tone="error" title="需求列表加载失败" :desc="error">
      <button class="btn" @click="load"><AppIcon name="refresh-cw" :size="13" />重试</button>
    </EmptyState>

    <template v-else>
      <div class="stats">
        <div class="stat clickable" @click="clearFilter" title="查看全部需求">
          <span class="stat-ico ti-gray"><AppIcon name="layers" :size="16" /></span>
          <div><div class="n">{{ reqs.length }}</div><div class="l">需求总数</div></div>
        </div>
        <div class="stat clickable" :class="{ on: fq.status === 'clarifying' }" @click="statFilter('clarifying')">
          <span class="stat-ico ti-amber"><AppIcon name="message-square" :size="16" /></span>
          <div><div class="n">{{ countBy('clarifying') }}</div><div class="l">待澄清</div></div>
        </div>
        <div class="stat clickable" :class="{ on: fq.status === 'published' }" @click="statFilter('published')">
          <span class="stat-ico ti-green"><AppIcon name="check-circle" :size="16" /></span>
          <div><div class="n">{{ countBy('published') }}</div><div class="l">已发布标准文档</div></div>
        </div>
        <div class="stat">
          <span class="stat-ico ti-blue"><AppIcon name="flask" :size="16" /></span>
          <div><div class="n">{{ reqs.reduce((s, r) => s + r.caseCount, 0) }}</div><div class="l">登记用例</div></div>
        </div>
      </div>

      <div class="filters">
        <Dropdown v-model="fq.iter" :options="iterOpts" searchable aria-label="按迭代筛选" />
        <Dropdown v-model="fq.status" :options="statusOpts" aria-label="按状态筛选" />
        <div class="spacer"></div>
        <button class="btn primary" @click="openNewReq"><AppIcon name="plus" :size="14" />提交需求</button>
      </div>

      <table class="table table-fixed">
        <thead><tr>
          <th style="width:32%" class="sortable" :class="{ on: sortKey === 'id', asc: sortDir === 'asc' }" @click="sortBy('id')">需求</th>
          <th style="width:106px" class="sortable" :class="{ on: sortKey === 'iter', asc: sortDir === 'asc' }" @click="sortBy('iter')">迭代</th>
          <th style="width:96px" class="sortable" :class="{ on: sortKey === 'sourceType', asc: sortDir === 'asc' }" @click="sortBy('sourceType')">来源</th>
          <th style="width:96px" class="sortable" :class="{ on: sortKey === 'status', asc: sortDir === 'asc' }" @click="sortBy('status')">状态</th>
          <th style="width:150px">澄清进度</th>
          <th style="width:64px" class="num sortable" :class="{ on: sortKey === 'caseCount', asc: sortDir === 'asc' }" @click="sortBy('caseCount')">用例</th>
          <th style="width:100px" class="sortable" :class="{ on: sortKey === 'syncedAt', asc: sortDir === 'asc' }" @click="sortBy('syncedAt')">最近同步</th>
          <th class="row-arrow w-del"></th>
        </tr></thead>
        <tbody>
          <tr v-for="r in sorted" :key="r.id" tabindex="0" @click="open(r.id)"
              @keydown.enter.self.prevent="open(r.id)">
            <td><div class="cell-ell" :title="r.name">{{ r.name }}</div>
              <div class="sub">{{ r.id }}
                <span class="badge" v-if="tierCls[r.riskTier]" :class="tierCls[r.riskTier]" :title="tierTip[r.riskTier]">{{ r.riskTier }}</span>
              </div>
            </td>
            <td class="sub nw" :title="r.iter">{{ r.iter || '—' }}</td>
            <td class="sub nw">{{ sourceLabel[r.sourceType] || r.sourceType }}</td>
            <td><span class="badge" :class="statusCls[r.status]">{{ statusLabel[r.status] }}</span></td>
            <td>
              <span class="prog-inline" v-if="r.status === 'published'">
                <AppIcon name="check-circle" :size="13" style="color:var(--green)" /><span class="ok">已闭环</span>
              </span>
              <span class="prog-inline" v-else-if="r.status === 'clarifying'">
                <span class="bar"><span class="bar-fill" :style="{ width: (r.totalQ ? Math.round(r.answeredQ / r.totalQ * 100) : 0) + '%' }"></span></span>
                <span class="num">{{ r.answeredQ }}/{{ r.totalQ }}</span>
              </span>
              <span class="sub" v-else>—</span>
            </td>
            <td class="num">{{ r.caseCount }}</td>
            <td class="sub nw" :title="r.syncedAt">{{ r.syncedAt ? fmtRel(r.syncedAt) : '—' }}</td>
            <td class="row-arrow w-del">
              <button class="row-del" title="删除需求（软删除）" @click.stop="delReq(r)"><AppIcon name="trash" :size="13" /></button>
              <AppIcon name="chevron-right" :size="14" />
            </td>
          </tr>
          <tr v-if="!filtered.length"><td colspan="8" class="cell-empty">
            <EmptyState icon="inbox" title="暂无需求"
                        :desc="fq.iter || fq.status ? '当前筛选条件下没有需求，可调整筛选或点击统计卡清除' : '点击右上角「提交需求」登记第一张需求卡'" />
          </td></tr>
        </tbody>
      </table>
    </template>

    <!-- 提交需求弹窗 -->
    <div class="modal-mask" v-if="nr" @click.self="nr = null">
      <div class="modal" style="width:560px" role="dialog" aria-modal="true" aria-label="提交需求">
        <div class="modal-h">提交需求
          <button class="x" @click="nr = null" aria-label="关闭"><AppIcon name="x" :size="16" /></button>
        </div>
        <div class="modal-b">
          <p class="sub" style="margin-bottom:14px;font-size:12.5px;color:var(--muted)">
            提交后在详情页点「开始质检」，AI 质检自动执行、产物以草稿回传，确认后进入澄清。</p>
          <div class="field"><label><em>*</em>需求名称</label><input v-model="nr.draft.name" v-focus></div>
          <div class="field"><label>迭代</label><input v-model="nr.draft.iter" placeholder="如 edu-region / 2026-I10"></div>
          <div class="field"><label>提交渠道</label>
            <div class="seg">
              <label class="seg-opt" :class="{ on: nr.draft.type === 'feishu' }">
                <input type="radio" value="feishu" v-model="nr.draft.type">
                <span><span class="seg-t">飞书文档链接</span><br><span class="seg-d">从飞书拉取原文快照</span></span>
              </label>
              <label class="seg-opt" :class="{ on: nr.draft.type === 'text' }">
                <input type="radio" value="text" v-model="nr.draft.type">
                <span><span class="seg-t">粘贴文本</span><br><span class="seg-d">直接粘贴需求原文</span></span>
              </label>
            </div>
          </div>
          <div class="field" v-if="nr.draft.type === 'feishu'">
            <label><em>*</em>飞书文档链接（请确保组织内可阅读）</label><input v-model="nr.draft.url" placeholder="https://…feishu.cn/wiki/…">
          </div>
          <div class="field" v-else><label><em>*</em>需求文本</label><textarea v-model="nr.draft.text"></textarea></div>
          <div class="field"><label>提交人</label><input v-model="nr.draft.by"></div>
        </div>
        <div class="modal-f">
          <button class="btn" @click="nr = null">取消</button>
          <button class="btn primary" :disabled="saving" @click="saveNewReq">
            {{ saving ? '提交中…' : '提交' }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

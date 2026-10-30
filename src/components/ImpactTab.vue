<script setup>
// v6（DESIGN-v6 §3.2）：影响点评估 tab——触发（含补充指引）/草稿预览采纳/采纳后报告+人工矫正。
// 数据口径：产物 detail.impact（_artifact_view：markdown/version/pushedAt/content）；
// 草稿 drafts.impact_eval（壳层 props）；视图一律按 contentJson 渲染（结构化数据为权威，
// md 为同事实的可读快照——编辑保存由服务端机械重建）。
import { ref, computed } from 'vue'
import { api } from '../api.js'
import AppIcon from './AppIcon.vue'
import EmptyState from './EmptyState.vue'
import { render } from '../render.js'
import { fmtRel } from '../time.js'
import { ask } from '../confirm.js'

const props = defineProps({
  reqId: String,
  card: { type: Object, default: () => ({}) },
  impact: { type: Object, default: null },          // 已采纳产物（detail.impact）
  draft: { type: Object, default: null },           // impact_eval 草稿行
  impactTask: { type: Object, default: null },      // 最新 impact_eval 任务（进行中提示）
})
const emit = defineEmits(['toast', 'refresh', 'reload'])

const busy = ref(false)
const hintOpen = ref(false)
const hint = ref('')

const KIND_CN = { add: '新增', modify: '修改', behavior: '行为变更' }
const CONF_CN = { hi: '高', mid: '中', lo: '低' }

// ---------- 产物面（contentJson 权威） ----------
const content = computed(() => props.impact?.content || null)
const items = computed(() => Array.isArray(content.value?.items) ? content.value.items : [])
const uncovered = computed(() => Array.isArray(content.value?.uncoveredRepos) ? content.value.uncoveredRepos : [])
const hours = computed(() => content.value?.hours || null)
const coverage = computed(() => content.value?.coverage || null)

// 置信度筛选（宁多勿漏——默认全选含 lo，筛选只影响展示不改数据）
const confOn = ref({ hi: true, mid: true, lo: true })
const groups = computed(() => {
  const m = new Map()
  for (const it of items.value) {
    const k = it.repo || '未标仓'
    if (!m.has(k)) m.set(k, [])
    m.get(k).push(it)
  }
  return [...m.entries()].map(([repo, rows]) => ({
    repo,
    rows: rows.filter(r => confOn.value[r.confidence] !== false),
    total: rows.length,
  }))
})

// ---------- 草稿面 ----------
const draftContent = computed(() => {
  try { return JSON.parse(props.draft?.contentJson || '{}') } catch { return null }
})
const draftItems = computed(() => Array.isArray(draftContent.value?.items) ? draftContent.value.items : [])
const draftHtml = computed(() => (props.draft?.md ? render(props.draft.md) : ''))
const taskActive = computed(() => props.impactTask && ['queued', 'running'].includes(props.impactTask.status))

// ---------- 动作 ----------
async function trigger() {
  busy.value = true
  try {
    await api.post(`/api/requirements/${props.reqId}/impact-eval`, { hint: hint.value.trim() })
    hintOpen.value = false
    emit('toast', '影响点评估任务已排队（Runner 执行后产物回到本页签）')
    emit('reload')
  } catch (e) { emit('toast', '创建失败：' + e.message, 'err') }
  finally { busy.value = false }
}
async function approveDraft() {
  busy.value = true
  try {
    await api.post(`/api/requirements/${props.reqId}/drafts/impact_eval/approve`)
    emit('toast', '影响点评估已采纳')
    emit('refresh')
  } catch (e) { emit('toast', '采纳失败：' + e.message, 'err') }
  finally { busy.value = false }
}
async function discardDraft() {
  if (!await ask({ title: '放弃影响点评估草稿？', body: '草稿将被删除（不影响已采纳版本）。', danger: true, confirmText: '放弃草稿' })) return
  try { await api.del(`/api/requirements/${props.reqId}/drafts/impact_eval`); emit('toast', '草稿已丢弃'); emit('reload') }
  catch (e) { emit('toast', '操作失败：' + e.message, 'err') }
}

// ---------- 人工矫正（第二档）：行内编辑 → PUT 全量覆写（乐观锁） ----------
const editing = ref(false)
const edit = ref(null)
function startEdit() {
  edit.value = JSON.parse(JSON.stringify(content.value || {}))
  edit.value.items = Array.isArray(edit.value.items) ? edit.value.items : []
  edit.value.uncoveredRepos = Array.isArray(edit.value.uncoveredRepos) ? edit.value.uncoveredRepos : []
  edit.value.hours = edit.value.hours || {}
  editing.value = true
}
function cancelEdit() { editing.value = false; edit.value = null }
function addItem() {
  edit.value.items.push({ repo: edit.value.items[0]?.repo || '', path: '', kind: 'modify', reason: '', confidence: 'mid' })
}
function removeItem(i) { edit.value.items.splice(i, 1) }
const isEditingDirty = () => editing.value
defineExpose({ isEditingDirty })

async function saveEdit() {
  busy.value = true
  try {
    await api.put(`/api/requirements/${props.reqId}/artifacts/impact_eval`,
      { contentJson: JSON.stringify(edit.value), version: props.impact.version })
    editing.value = false; edit.value = null
    emit('toast', '评估结果已更新')
    emit('refresh')
  } catch (e) {
    if (e.status === 409) { emit('toast', '版本冲突：评估已被他人更新，已刷新最新版本', 'err'); editing.value = false; emit('refresh') }
    else emit('toast', '保存失败：' + e.message, 'err')
  } finally { busy.value = false }
}
</script>

<template>
  <div class="card">
    <!-- 头部：标题 + 主操作 -->
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
      <b><AppIcon name="git-branch" :size="15" /> 影响点评估</b>
      <span class="sub" v-if="impact?.pushedAt" :title="impact.pushedAt">v{{ impact.version }} · {{ fmtRel(impact.pushedAt) }}</span>
      <span style="flex:1"></span>
      <button class="btn small" v-if="impact && !editing" :disabled="busy" @click="startEdit">
        <AppIcon name="pencil" :size="12" />人工矫正</button>
      <button class="btn small primary" :disabled="busy || taskActive" @click="hintOpen = !hintOpen">
        <AppIcon name="play" :size="12" />{{ impact || draft ? '重新评估' : '评估影响点' }}</button>
    </div>

    <!-- 补充指引（第一档矫正）：触发/重估时给 AI 指路 -->
    <div class="banner" v-if="hintOpen" style="margin-top:10px">
      <div style="flex:1">
        <div class="sub" style="margin-bottom:6px">补充指引（可选，≤500 字）——告知 AI 重点关注方向，如「重点看订单模块/会员中心」</div>
        <textarea v-model="hint" rows="2" maxlength="500" placeholder="留空 = 无补充指引，直接评估"
                  style="width:100%;box-sizing:border-box"></textarea>
        <div style="margin-top:6px;display:flex;gap:8px">
          <button class="btn small primary" :disabled="busy" @click="trigger">创建评估任务</button>
          <button class="btn small" @click="hintOpen = false">取消</button>
        </div>
      </div>
    </div>

    <!-- 进行中任务提示 -->
    <div class="banner amber-t" v-if="taskActive" style="margin-top:10px">
      <AppIcon name="refresh-cw" :size="14" />
      <span style="flex:1">影响点评估{{ impactTask.status === 'running' ? '执行中' : '排队中' }}——完成后草稿回到本页签</span>
    </div>

    <!-- 草稿态：预览 + 采纳/放弃 -->
    <template v-if="draft && !taskActive">
      <div class="banner amber-t" style="margin-top:10px">
        <AppIcon name="alert-triangle" :size="14" />
        <span style="flex:1"><b>评估草稿待采纳</b>：{{ draftItems.length }} 条影响点——人审确认后成为正式产物（可人工矫正）</span>
        <button class="btn small primary" :disabled="busy" @click="approveDraft"><AppIcon name="check-circle" :size="12" />采纳</button>
        <button class="btn small" :disabled="busy" @click="discardDraft">放弃草稿</button>
      </div>
      <div class="doc" v-if="draftHtml" style="margin-top:10px" v-html="draftHtml"></div>
    </template>

    <!-- 产物态 -->
    <template v-if="impact && !editing">
      <!-- 未覆盖仓警示条（E-9：一等字段，非空即显著） -->
      <div class="banner amber-t" v-if="uncovered.length" style="margin-top:10px">
        <AppIcon name="alert-triangle" :size="14" />
        <span style="flex:1"><b>以下仓库未纳入评估</b>，清单不含其影响点：
          <span class="chip" v-for="u in uncovered" :key="u.ref + u.branch">{{ u.ref }}@{{ u.branch || '默认' }}（{{ u.reason }}）</span>
        </span>
      </div>

      <!-- 工时卡（粗排期参考，非承诺） -->
      <div class="card" v-if="hours" style="margin-top:10px;background:var(--soft,#f7f7f9)">
        <b>总工时 ≈ {{ hours.totalDays ?? '—' }} 人日</b>
        <span class="badge" :class="hours.confidence === 'hi' ? 'b-green' : (hours.confidence === 'lo' ? 'b-amber' : 'b-gray')">置信度{{ CONF_CN[hours.confidence] || hours.confidence || '—' }}</span>
        <span class="sub" v-if="hours.basis">—— {{ hours.basis }}</span>
        <div class="sub" style="margin-top:4px">粗排期参考（未经实际校准），非承诺工时</div>
      </div>

      <!-- 影响点清单：置信度筛选 + 按仓分组 -->
      <div style="margin-top:10px;display:flex;gap:6px;align-items:center" v-if="items.length">
        <span class="sub">影响点 {{ items.length }} 条 · 置信度</span>
        <button v-for="c in ['hi', 'mid', 'lo']" :key="c" class="btn small"
                :class="{ primary: confOn[c] }" @click="confOn[c] = !confOn[c]">{{ CONF_CN[c] }}</button>
      </div>
      <template v-if="items.length">
        <div v-for="g in groups" :key="g.repo" style="margin-top:10px">
          <b class="sub"><AppIcon name="git-branch" :size="12" /> {{ g.repo }}</b>
          <table class="tbl" style="margin-top:4px">
            <thead><tr><th>位置</th><th style="width:70px">类型</th><th style="width:70px">置信度</th><th>原因</th></tr></thead>
            <tbody>
              <tr v-for="(it, i) in g.rows" :key="i">
                <td><code>{{ it.path }}</code></td>
                <td><span class="badge" :class="it.kind === 'add' ? 'b-green' : (it.kind === 'behavior' ? 'b-amber' : 'b-blue')">{{ KIND_CN[it.kind] || it.kind }}</span></td>
                <td><span class="badge" :class="it.confidence === 'hi' ? 'b-green' : (it.confidence === 'lo' ? 'b-amber' : 'b-gray')">{{ CONF_CN[it.confidence] || it.confidence }}</span></td>
                <td class="sub">{{ it.reason }}</td>
              </tr>
              <tr v-if="!g.rows.length"><td colspan="4" class="sub">（全部被置信度筛选隐藏）</td></tr>
            </tbody>
          </table>
        </div>
      </template>
      <div class="sub" v-else style="margin-top:10px">未检出影响点（文档类需求或无命中代码面）。</div>

      <!-- 检索覆盖自报 -->
      <details v-if="coverage" style="margin-top:10px">
        <summary class="sub">检索覆盖自报</summary>
        <div class="sub" style="margin-top:4px">
          <div v-if="coverage.searched?.length">已检索：<code v-for="s in coverage.searched" :key="s" style="margin-right:6px">{{ s }}</code></div>
          <div v-if="coverage.note">{{ coverage.note }}</div>
        </div>
      </details>
    </template>

    <!-- 编辑态：结构化行内编辑（保存 = PUT 全量覆写，服务端重建 md） -->
    <template v-if="editing && edit">
      <div class="banner" style="margin-top:10px">
        <AppIcon name="alert-triangle" :size="14" />
        <span style="flex:1">人工矫正模式：编辑影响点条目与工时，保存后整体覆写（版本+1）；未覆盖仓（{{ edit.uncoveredRepos.length }} 条）不可编辑</span>
      </div>
      <div style="margin-top:10px;display:flex;gap:8px;align-items:center">
        <b class="sub">总工时（人日）</b>
        <input v-model.number="edit.hours.totalDays" type="number" step="0.5" min="0" style="width:90px" />
        <select v-model="edit.hours.confidence"><option value="hi">置信度高</option><option value="mid">置信度中</option><option value="lo">置信度低</option></select>
        <input v-model="edit.hours.basis" placeholder="工时依据（一句话）" style="flex:1" />
      </div>
      <table class="tbl" style="margin-top:10px">
        <thead><tr><th style="width:150px">仓</th><th>位置</th><th style="width:100px">类型</th><th style="width:90px">置信度</th><th>原因</th><th style="width:40px"></th></tr></thead>
        <tbody>
          <tr v-for="(it, i) in edit.items" :key="i">
            <td><input v-model="it.repo" placeholder="仓名" /></td>
            <td><input v-model="it.path" placeholder="文件/模块路径" /></td>
            <td><select v-model="it.kind"><option value="add">新增</option><option value="modify">修改</option><option value="behavior">行为变更</option></select></td>
            <td><select v-model="it.confidence"><option value="hi">高</option><option value="mid">中</option><option value="lo">低</option></select></td>
            <td><input v-model="it.reason" placeholder="影响原因" /></td>
            <td><button class="btn small link" @click="removeItem(i)"><AppIcon name="x-circle" :size="13" /></button></td>
          </tr>
          <tr v-if="!edit.items.length"><td colspan="6" class="sub">无影响点</td></tr>
        </tbody>
      </table>
      <div style="margin-top:8px;display:flex;gap:8px">
        <button class="btn small" @click="addItem"><AppIcon name="plus" :size="12" />添加影响点</button>
        <span style="flex:1"></span>
        <button class="btn small primary" :disabled="busy" @click="saveEdit">保存矫正</button>
        <button class="btn small" @click="cancelEdit">取消</button>
      </div>
    </template>

    <!-- 空态 -->
    <EmptyState v-if="!impact && !draft && !taskActive && !hintOpen" icon="git-branch"
                title="尚未评估影响点"
                desc="AI 将对照本需求的标准文档与各目标仓现有代码，列出实现该需求会动到的代码位置（含粗估工时）。前置：已发布标准文档 ∧ 设计卡已配目标仓。"
                style="margin-top:10px" />
  </div>
</template>

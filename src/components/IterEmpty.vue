<script setup>
// 空迭代页（DESIGN-v2.4 D32/D37）：迭代×需求 1:1 的绑定入口——提交需求后入口收敛，进入工作台。
import { ref, onMounted } from 'vue'
import { api } from '../api.js'
import AppIcon from './AppIcon.vue'
import EmptyState from './EmptyState.vue'

const props = defineProps({ iter: String })
const emit = defineEmits(['back', 'submitted', 'toast'])
const row = ref(null)
const error = ref('')
const draft = ref({ name: '', type: 'text', url: '', text: '', by: '' })
const saving = ref(false)

async function load() {
  error.value = ''
  // 迭代名可含 `/`（如 feature/0923）：走 query 参，路径段会被容器拒 %2F
  try { row.value = await api.get('/api/iterations/detail?name=' + encodeURIComponent(props.iter)) }
  catch (e) { error.value = e.message }
}
onMounted(load)

async function submit() {
  const d = draft.value
  if (!d.name.trim()) return emit('toast', '请填写需求名称', 'err')
  if (d.type === 'feishu' && !d.url.trim()) return emit('toast', '请填写飞书文档链接', 'err')
  if (d.type === 'text' && !d.text.trim()) return emit('toast', '请粘贴需求文本', 'err')
  saving.value = true
  try {
    const out = await api.post('/api/requirements', {
      name: d.name.trim(), iter: props.iter, sourceType: d.type,
      sourceUrl: d.url.trim(), sourceText: d.text, submittedBy: d.by.trim()
    })
    emit('toast', `需求已提交并绑定迭代 ${props.iter}（${out.id}）`)
    emit('submitted', out.id)
  } catch (e) { emit('toast', e.message, 'err') } finally { saving.value = false }
}
</script>

<template>
  <div>
    <button class="btn link" @click="emit('back')"><AppIcon name="arrow-left" :size="13" />返回迭代列表</button>
    <EmptyState v-if="error" icon="alert-circle" tone="error" title="迭代加载失败" :desc="error">
      <button class="btn" @click="load"><AppIcon name="refresh-cw" :size="13" />重试</button>
    </EmptyState>
    <template v-else-if="row">
      <div class="detail-h">
        <h2>{{ row.name }}</h2>
        <span class="badge b-gray">空迭代</span>
        <span class="sub" v-if="row.note">{{ row.note }}</span>
      </div>
      <p class="sub" style="margin-bottom:14px">
        该迭代还没有绑定需求（迭代 × 需求 1:1）。提交下方表单后，需求与迭代绑定，后续质检 / 澄清 / 发布 / 设计 / 门禁全在本迭代内闭环。</p>

      <div class="card" style="max-width:720px">
        <h3><AppIcon name="clipboard-list" :size="14" />提交需求（绑定到 {{ row.name }}）</h3>
        <div class="field"><label><em>*</em>需求名称</label><input v-model="draft.name" placeholder="一句话说清本迭代要做什么"></div>
        <div class="field"><label>提交渠道</label>
          <div class="seg">
            <label class="seg-opt" :class="{ on: draft.type === 'text' }">
              <input type="radio" value="text" v-model="draft.type">
              <span><span class="seg-t">粘贴文本</span><br><span class="seg-d">直接粘贴需求原文</span></span>
            </label>
            <label class="seg-opt" :class="{ on: draft.type === 'feishu' }">
              <input type="radio" value="feishu" v-model="draft.type">
              <span><span class="seg-t">飞书文档链接</span><br><span class="seg-d">从飞书拉取原文快照</span></span>
            </label>
          </div>
        </div>
        <div class="field" v-if="draft.type === 'text'"><label><em>*</em>需求文本</label><textarea v-model="draft.text"></textarea></div>
        <div class="field" v-else><label><em>*</em>飞书文档链接</label><input v-model="draft.url" placeholder="https://…feishu.cn/wiki/…"></div>
        <div class="field"><label>提交人</label><input v-model="draft.by"></div>
        <div style="margin-top:14px">
          <button class="btn primary" :disabled="saving" @click="submit">{{ saving ? '提交中…' : '提交需求并绑定迭代' }}</button>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
// v4 评论面板（DESIGN-v4 §4）：右侧抽屉——卡片级「整体疑问」+ 块锚定线程；线程级解决/重开、
// 单条删除、升级澄清项（L 系，重复升级 409 → escalatedIds 预禁用）。评论任何状态可发（无守卫）。
// 数据面由壳层持有（comments prop），本组件只做动作 + emit refresh 由壳层重拉。
import { ref, computed, watch, nextTick } from 'vue'
import { api } from '../api.js'
import AppIcon from './AppIcon.vue'
import { ask } from '../confirm.js'
import { lvlLabel } from '../levels.js'
import { fmtRel } from '../time.js'

const props = defineProps({
  reqId: { type: String, required: true },
  comments: { type: Array, default: () => [] },       // GET /comments 的 comments 数组
  blockText: { type: Object, default: () => ({}) },   // blockId → 文本摘要（线程上下文）
  escalatedIds: { type: Array, default: () => [] },   // 已升级的评论 id（按钮预禁用）
  focusId: { type: Number, default: null },           // 定位高亮某条评论（跳回协议）
  composeBlockId: { type: String, default: '' }       // 发评目标块（'' = 卡片级）
})
const emit = defineEmits(['close', 'refresh', 'locate', 'toast'])

const author = ref(localStorage.getItem('sdlc.op') || '')
const replyDraft = ref({})        // '__new'=发评框；线程根 id → 回复文本
const escDlg = ref(null)          // 升级弹层 { id, level, theme }
const busy = ref(false)
const composeTarget = ref(props.composeBlockId || '')
watch(() => props.composeBlockId, v => { composeTarget.value = v || '' })

// ===== 线程组装：根（无 replyTo 或父已删）+ 回复链 =====
const threads = computed(() => {
  const byId = new Map(props.comments.map(c => [c.id, c]))
  const children = {}
  for (const c of props.comments) {
    if (c.replyTo != null && byId.has(c.replyTo)) (children[c.replyTo] = children[c.replyTo] || []).push(c)
  }
  const roots = props.comments.filter(c => c.replyTo == null || !byId.has(c.replyTo))
  return roots.map(r => ({
    root: r,
    replies: (function walk(id, acc = [], seen = new Set()) {
      for (const ch of children[id] || []) {
        if (seen.has(ch.id)) continue
        seen.add(ch.id)
        acc.push(ch)
        walk(ch.id, acc, seen)
      }
      return acc
    })(r.id),
    resolved: r.resolved   // resolve 是线程级（根+链同值），看根即可
  }))
})
const cardThreads = computed(() => threads.value.filter(t => !t.root.blockId))
const blockThreads = computed(() => threads.value.filter(t => t.root.blockId))
/** 渲染序列：分组头 + 线程（单循环渲染，避免两段重复模板） */
const display = computed(() => [
  ...(cardThreads.value.length ? [{ header: '整体疑问' }, ...cardThreads.value] : []),
  ...(blockThreads.value.length ? [{ header: '原文块讨论' }, ...blockThreads.value] : [])
])
const unresolved = computed(() => props.comments.filter(c => !c.resolved).length)
const escalated = computed(() => new Set(props.escalatedIds))

function blkText(id) { return (props.blockText[id] || '').slice(0, 60) || id }

// ===== 动作 =====
async function post(rootBlockId, text, replyTo = null) {
  if (!text.trim()) return emit('toast', '评论内容不能为空', 'err')
  if (!author.value.trim()) return emit('toast', '请先填写姓名（署名留痕）', 'err')
  busy.value = true
  try {
    await api.post(`/api/requirements/${props.reqId}/comments`,
      { blockId: rootBlockId || '', author: author.value.trim(), text: text.trim(), replyTo })
    localStorage.setItem('sdlc.op', author.value.trim())
    if (replyTo == null) replyDraft.value.__new = ''
    else replyDraft.value[replyTo] = ''
    emit('refresh')
    emit('toast', replyTo == null ? '评论已发' : '回复已发')
  } catch (e) { emit('toast', e.message, 'err') } finally { busy.value = false }
}
async function toggleResolve(t) {
  busy.value = true
  try {
    await api.post(`/api/requirements/${props.reqId}/comments/${t.root.id}/resolve`, { resolved: !t.resolved })
    emit('refresh')
    emit('toast', t.resolved ? '线程已重开' : '线程已解决')
  } catch (e) { emit('toast', e.message, 'err') } finally { busy.value = false }
}
async function delComment(c) {
  if (!await ask({
    title: '删除这条评论？',
    body: '单条物理删除；其下回复保留（挂到线程根部）。',
    danger: true, confirmText: '删除'
  })) return
  busy.value = true
  try {
    await api.del(`/api/requirements/${props.reqId}/comments/${c.id}`)
    emit('refresh')
    emit('toast', '评论已删除')
  } catch (e) { emit('toast', e.message, 'err') } finally { busy.value = false }
}
function askEscalate(c) { escDlg.value = { id: c.id, level: 'yellow', theme: '' } }
async function confirmEscalate() {
  const d = escDlg.value
  if (!d) return
  busy.value = true
  try {
    const r = await api.post(`/api/requirements/${props.reqId}/comments/${d.id}/escalate`,
      { level: d.level, theme: d.theme.trim() || undefined })
    escDlg.value = null
    emit('refresh')
    emit('toast', `已升级为澄清项 ${r.seq}（${lvlLabel[r.level]}），在澄清清单处置`)
  } catch (e) {
    // 重复升级 409：文案含「只可升级一次」（§6 关键词分流——预禁用漏网时的兜底提示）
    emit('toast', e.message, 'err')
    if ((e.message || '').includes('只可升级一次')) { escDlg.value = null; emit('refresh') }
  } finally { busy.value = false }
}

// ===== 定位高亮（跳回协议：澄清清单 L 系 → 原评论）——immediate：携带 focusId 挂载即定位 =====
watch(() => props.focusId, async id => {
  if (id == null) return
  await nextTick()
  await new Promise(r => setTimeout(r, 60))   // 线程 DOM 随 comments prop 渲染后再锚
  const el = document.querySelector(`[data-cid="${id}"]`)
  if (!el) return
  el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  el.classList.add('cmt-flash')
  setTimeout(() => el.classList.remove('cmt-flash'), 1600)
}, { immediate: true })
</script>

<template>
  <section class="cmts-drawer" aria-label="评论区">
    <div class="cmts-h">
      <b><AppIcon name="message-square" :size="14" />评论</b>
      <span class="chip" v-if="unresolved">{{ unresolved }} 条未解决</span>
      <span class="spacer"></span>
      <button class="x" @click="emit('close')" aria-label="关闭评论面板">✕</button>
    </div>

    <!-- 发评：目标块可切（块角标进入预选该块；卡片级 = 整体疑问） -->
    <div class="cmts-compose">
      <div class="cmts-target">
        <span class="sub">发到：</span>
        <span class="chip" v-if="composeTarget" :title="blkText(composeTarget)">块 · {{ blkText(composeTarget) }}</span>
        <span class="chip" v-else>卡片级（整体疑问）</span>
        <button class="btn small link" v-if="composeTarget" @click="composeTarget = ''">改为卡片级</button>
      </div>
      <div class="cmts-row">
        <input v-model="author" placeholder="姓名（署名）" style="width:110px">
        <input v-model="replyDraft.__new" placeholder="写下评论…（Ctrl+Enter 发送）" style="flex:1"
               @keydown.ctrl.enter.prevent="post(composeTarget, replyDraft.__new || '')">
        <button class="btn small primary" :disabled="busy" @click="post(composeTarget, replyDraft.__new || '')">发送</button>
      </div>
    </div>

    <div class="cmts-body">
      <template v-for="t in display" :key="t.header ?? t.root.id">
        <div class="cmts-sec" v-if="t.header">{{ t.header }}</div>
        <div v-else class="cthread-card" :class="{ resolved: t.resolved }">
          <div class="cmts-blk" v-if="t.root.blockId">
            <a class="linklike" @click="emit('locate', t.root.blockId)"
               :title="'定位到原文块 ' + t.root.blockId">{{ blkText(t.root.blockId) }}</a>
          </div>
          <div class="ct-msgs">
            <div class="ct-msg" :data-cid="t.root.id">
              <b>{{ t.root.author || '匿名' }}</b><span class="sub" :title="t.root.createdAt"> · {{ fmtRel(t.root.createdAt) }}</span>
              <span class="chip" v-if="escalated.has(t.root.id)" title="已升级为澄清项">已升级</span>
              <div class="ct-text">{{ t.root.text }}</div>
            </div>
            <div class="ct-msg reply" v-for="r in t.replies" :key="r.id" :data-cid="r.id">
              <b>{{ r.author || '匿名' }}</b><span class="sub" :title="r.createdAt"> · {{ fmtRel(r.createdAt) }}</span>
              <div class="ct-text">{{ r.text }}</div>
              <button class="btn small link cdel" title="删除本条" @click="delComment(r)"><AppIcon name="trash" :size="11" /></button>
            </div>
          </div>
          <div class="ct-ops">
            <input v-model="replyDraft[t.root.id]" placeholder="回复…" style="flex:1"
                   @keydown.ctrl.enter.prevent="post(t.root.blockId, replyDraft[t.root.id] || '', t.root.id)">
            <button class="btn small" :disabled="busy" @click="post(t.root.blockId, replyDraft[t.root.id] || '', t.root.id)">回复</button>
            <button class="btn small" :disabled="busy" @click="toggleResolve(t)">
              {{ t.resolved ? '重开' : '解决' }}</button>
            <button class="btn small" :disabled="busy || escalated.has(t.root.id)"
                    :title="escalated.has(t.root.id) ? '每条评论只可升级一次' : '升级为澄清项（进入澄清清单处置）'"
                    @click="askEscalate(t.root)">
              <AppIcon name="arrow-up-right" :size="11" />升级澄清</button>
            <button class="btn small link cdel" title="删除根评论" @click="delComment(t.root)"><AppIcon name="trash" :size="11" /></button>
          </div>
        </div>
      </template>

      <div class="cmts-empty sub" v-if="!threads.length">还没有评论——自由讨论随时发；需要正式追踪的，升级为澄清项。</div>
    </div>

    <!-- 升级弹层 -->
    <div class="modal-mask" v-if="escDlg" @click.self="escDlg = null">
      <div class="modal" style="width:420px" role="dialog" aria-modal="true">
        <div class="modal-h">升级为澄清项<button class="x" @click="escDlg = null">✕</button></div>
        <div class="modal-b">
          <p class="sub" style="margin-bottom:10px">评论原文将作为澄清问题（L 系编号），块文本作为摘引、块 ID 作为锚点；升级后到澄清清单处置。</p>
          <div class="field"><label>级别</label>
            <div class="seg">
              <label class="seg-opt" v-for="(lb, lv) in lvlLabel" :key="lv" :class="{ on: escDlg.level === lv }">
                <input type="radio" :value="lv" v-model="escDlg.level"><span><span class="seg-t">{{ lb }}</span></span>
              </label>
            </div>
          </div>
          <div class="field"><label>主题（可选，缺省「评论升级」）</label><input v-model="escDlg.theme" placeholder="如：口径歧义"></div>
        </div>
        <div class="modal-f">
          <button class="btn" @click="escDlg = null">取消</button>
          <button class="btn primary" :disabled="busy" @click="confirmEscalate">升级</button>
        </div>
      </div>
    </div>
  </section>
</template>

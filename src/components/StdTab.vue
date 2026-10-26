<script setup>
// 标准需求文档 tab（AUDIT D6-2 拆分自 ReqDetail）：重写版定稿（D6），四类引用可点击（D7 事件委托）。
// fr/audit/check/asm/src 引用经 emit('jump') 上抛壳层（src 由壳层解析块锚后定位）；§ 章节引用文档内定位。
// 目录渲染后从 DOM 抽 h2/h3（marked 未产 id 时兜底补）；headEls 供壳层滚动高亮。
// v5.x（草稿归 tab·批2）：standard 未发布且草稿已生成时，本页签承载草稿编辑与发布（迁自 TaskPanel）——
// changed 只读「草稿一致流」发布；其余状态可编辑（stdText 与草稿 updatedAt 守卫同步）。
import { ref, computed, watch, onMounted } from 'vue'
import EmptyState from './EmptyState.vue'
import TocPane from './TocPane.vue'
import AppIcon from './AppIcon.vue'
import { api } from '../api.js'
import { ask } from '../confirm.js'
import { render, linkifyRefs } from '../render.js'
import { flashEl, settle } from '../trace.js'

const props = defineProps({
  standard: { type: Object, default: null },
  activeHead: { type: String, default: '' },     // 壳层滚动高亮（目录侧栏）
  draft: { type: Object, default: null },        // v5.x：标准文档草稿行（/drafts 响应项）
  status: { type: String, default: '' }          // v5.x：card.status——changed 分支只读发布
})
const emit = defineEmits(['jump', 'go-toc', 'toast', 'refresh', 'reload'])

const stdHtml = computed(() => (props.standard ? linkifyRefs(render(props.standard.markdown)) : ''))

const stdToc = ref([])
const stdBox = ref(null)
async function extractToc() {
  if (!stdHtml.value) { stdToc.value = []; return }
  await settle(60)
  const box = stdBox.value
  if (!box) return
  const hs = [...box.querySelectorAll('h1, h2, h3')]
  hs.forEach((h, i) => { if (!h.id) h.id = 'stdh-' + i })
  const lv = { H1: 1, H2: 2, H3: 3 }
  const body = box.firstElementChild?.tagName === 'H1' ? hs.slice(1) : hs   // 文档首元素为 h1 才视为标题（与 CSS .doc > h1:first-child 同口径）
  const items = body.map(h => ({ id: h.id, level: lv[h.tagName] || 2, text: h.textContent.trim().slice(0, 46) }))
  const min = Math.min(...items.map(x => x.level))             // 层级归一：文档最深用到的层级决定缩进档
  stdToc.value = items.map(x => ({ ...x, level: x.level - min + 1 }))
}
onMounted(extractToc)
watch(stdHtml, extractToc)

/** 当前目录标题元素序列（壳层 onScroll 高亮计算用）——与 extractToc 同口径收 h1/h2/h3（首元素标题 h1 同跳过） */
function headEls() {
  if (!stdBox.value) return []
  const els = [...stdBox.value.querySelectorAll('h1[id],h2[id],h3[id]')]
  return els[0] && els[0] === stdBox.value.firstElementChild && els[0].tagName === 'H1' ? els.slice(1) : els
}

/** 标准文档引用点击（事件委托，D7 四类引用） */
function stdRefClick(e) {
  const el = e.target.closest('.reflink')
  if (!el) return
  const idx = el.dataset.ref.indexOf(':')
  const kind = el.dataset.ref.slice(0, idx)
  const id = el.dataset.ref.slice(idx + 1)
  if (kind === 'sec') {
    // § 章节引用（评测 P2-6）：文档内标题号定位（标题通常为「7.2 xxx」不带 §），未命中诚实提示
    const want = id.replace(/^§/, '').replace(/\s+/g, '')
    const h = [...(stdBox.value?.querySelectorAll('h2,h3') || [])]
      .find(x => x.textContent.replace(/\s+/g, '').startsWith(want))
    if (h) flashEl(h)
    else emit('toast', `未定位到章节 ${id}：标准文档中没有以此开头的标题`, 'err')
  } else {
    // fr/audit/check/asm 走跳转协议；src 由壳层 resolveDocPath 解析块锚后 locate
    emit('jump', { kind, id })
  }
}

// ===== v5.x 批2 草稿域（迁自 TaskPanel，动作与确认文案原样） =====
const stdMode = ref('edit')            // 草稿编辑态：edit | preview
const stdText = ref('')                // 编辑缓冲
const busy = ref(false)
/** 编辑缓冲 ↔ 草稿同步（updatedAt 守卫，原 TaskPanel loadDrafts 内联逻辑）：4s 轮询不冲掉
 *  编辑中内容；草稿被外部重写/重生成（updatedAt 变）才覆写。 */
let stdSyncedAt = ''
watch(() => props.draft?.updatedAt, at => {
  if (!at) { stdSyncedAt = ''; return }
  if (at !== stdSyncedAt) { stdText.value = props.draft.md || ''; stdSyncedAt = at }
}, { immediate: true })
const stdPreviewHtml = computed(() => linkifyRefs(render(stdText.value || props.draft?.md || '')))

/** E3 守卫配套（同 ChangesTab）：编辑态且与草稿有差异时，切页签前须确认——v-if 卸载即丢未保存编辑 */
function isEditingDirty() {
  return !!props.draft && props.status !== 'changed' && props.status !== 'published'
    && stdText.value.trim() !== (props.draft.md || '').trim()
}
defineExpose({ headEls, isEditingDirty })

async function saveStdDraft() {
  try {
    await api.put(`/api/requirements/${props.draft.reqId}/drafts/standard`, { md: stdText.value })
    emit('toast', '草稿已保存')
    emit('reload')
  } catch (e) { emit('toast', '保存失败：' + e.message, 'err') }
}

/**
 * 发布（终态）。clarifying 老流：无草稿前置可直推编辑内容（软守卫明示差异）。
 * v4 changed 分支（§5 发布双重守卫）：只走「从草稿预览发布」——提交内容 = 草稿逐字节一致
 * （哈希比对守卫），不提供编辑；未消化变更单 409 → 指引去变更页签采纳增量。
 */
async function publishStd() {
  if (props.status === 'changed') {
    if (!await ask({
      title: '从草稿预览发布标准需求文档？',
      body: '变更后的发布以草稿为唯一内容源（逐字节一致校验）；发布前须无未消化变更单、增量草稿已采纳。',
      danger: true, confirmText: '确认发布'
    })) return
    busy.value = true
    try {
      await api.post(`/api/requirements/${props.draft.reqId}/publish`, { standardMd: props.draft.md })
      emit('toast', '已重新发布 ✓ 标准需求文档回终态（content_rev 保留）')
      emit('refresh')
    } catch (e) {
      if ((e.message || '').includes('未消化')) emit('toast', e.message + '——请先去变更页签采纳增量合并草稿；若草稿已丢弃，用流水线「增量质检」重排', 'err')
      else emit('toast', '发布失败：' + e.message, 'err')
    } finally { busy.value = false }
    return
  }
  const md = stdText.value || props.draft?.md || ''
  const drift = !!props.draft && !!stdText.value.trim()
    && stdText.value.trim() !== (props.draft.md || '').trim()
  const ok = drift
    ? await ask({
        title: '编辑内容与 AI 草稿存在差异',
        body: `编辑框 ${stdText.value.trim().length} 字 / AI 草稿 ${(props.draft.md || '').trim().length} 字，将以编辑框内容发布。\n首处分歧行：${firstDriftLine(stdText.value, props.draft.md || '')}`,
        confirmText: '仍以编辑内容发布'
      })
    : await ask({
        title: '发布标准需求文档？',
        body: '发布是终态动作：答复将锁定、产物拒绝重推、快照冻结。',
        danger: true,
        confirmText: '确认发布'
      })
  if (!ok) return
  busy.value = true
  try {
    await api.post(`/api/requirements/${props.draft.reqId}/publish`, { standardMd: md })
    emit('toast', '已发布 ✓ 标准需求文档进入终态')
    emit('refresh')
  } catch (e) { emit('toast', '发布失败：' + e.message, 'err') }
  finally { busy.value = false }
}

/** 首处分歧行（简易行 diff：跳过公共前缀行，取编辑侧的第一行）——预览用，非精确 diff */
function firstDriftLine(a, b) {
  const la = a.split('\n'), lb = b.split('\n')
  let i = 0
  while (i < la.length && i < lb.length && la[i] === lb[i]) i++
  const line = (la[i] || '').trim()
  return line ? line.slice(0, 40) : '（空行）'
}

async function dropStdDraft() {
  if (!await ask({ title: '丢弃标准需求文档草稿？', body: '丢弃后如需该产物须重新生成对应任务。', danger: true, confirmText: '丢弃' })) return
  try { await api.del(`/api/requirements/${props.draft.reqId}/drafts/standard`); emit('toast', '草稿已丢弃'); emit('reload') }
  catch (e) { emit('toast', '丢弃失败：' + e.message, 'err') }
}
</script>

<template>
  <template v-if="standard">
    <div class="banner blue">
      <AppIcon name="file-text" :size="14" />
      <span>重写版定稿：以原始需求全文为底稿，整合体检定论与澄清答复——开发 / AI 读这一份即可获得需求全貌、边界与逻辑。全文 <b>FR / 体检.P / P / 需求.A</b> 引用可点击跳转。</span>
    </div>
    <div class="doc-layout">
      <div class="card doc" ref="stdBox" v-html="stdHtml" @click="stdRefClick"></div>
      <TocPane :items="stdToc" :active-id="activeHead" @go="emit('go-toc', $event)" />
    </div>
  </template>

  <!-- v5.x 批2：草稿态（迁自 TaskPanel）——standard 未发布且草稿已生成，本页签即编辑与发布现场 -->
  <template v-else-if="draft">
    <!-- changed：草稿一致流（只读预览 + 逐字节发布） -->
    <template v-if="status === 'changed'">
      <div class="draftbar blue">
        <span class="badge b-blue">待重新发布</span><b>标准需求文档草稿</b>
        <span class="sub">变更中发布以草稿为唯一内容源（逐字节一致），不可手改</span>
        <span class="tp-act">
          <button class="btn small danger" :disabled="busy" @click="dropStdDraft">丢弃</button>
          <button class="btn primary" :disabled="busy" @click="publishStd"><AppIcon name="send" :size="13" />从草稿预览发布（终态）</button>
        </span>
      </div>
      <div class="doc tp-preview" v-html="stdPreviewHtml"></div>
    </template>
    <!-- 其余状态：编辑 / 渲染预览 -->
    <template v-else>
      <div class="draftbar">
        <span class="badge b-amber">待发布</span><b>标准需求文档草稿</b>
        <span class="tp-act">
          <button class="btn small danger" :disabled="busy" @click="dropStdDraft">丢弃</button>
          <button class="btn primary" :disabled="busy" @click="publishStd"><AppIcon name="send" :size="13" />发布（终态锁定）</button>
        </span>
      </div>
      <div class="tp-modes">
        <button class="btn small" :class="{ 'tp-on': stdMode === 'edit' }" @click="stdMode = 'edit'">编辑</button>
        <button class="btn small" :class="{ 'tp-on': stdMode === 'preview' }" @click="stdMode = 'preview'">渲染预览</button>
        <span class="sub" style="flex:1"></span>
        <button class="btn small" @click="saveStdDraft"><AppIcon name="pencil" :size="11" />保存草稿</button>
      </div>
      <textarea v-if="stdMode === 'edit'" class="tp-editor" v-model="stdText" spellcheck="false"></textarea>
      <div v-else class="doc tp-preview" v-html="stdPreviewHtml"></div>
    </template>
  </template>

  <EmptyState v-else icon="file-text" title="标准需求文档尚未生成"
              desc="澄清全部答完后在流水线面板「生成标准文档」，草稿会回到本页签编辑与发布" />
</template>

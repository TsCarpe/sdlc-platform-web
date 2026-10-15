<script setup>
// 原文上下文侧栏（DESIGN-v5 §2.1 双栏并置）：工作台右栏常驻原文块渲染，点摘引不切 tab 直接
// 联动定位。定位协议：anchor 块直达 → needle 回退 → 全失降级静态出处卡（不弹失败 toast，r2 C1）。
// 跟随开关默认开；关闭后点摘引不打断自由滚动。反向角标（§4）与灯箱复用 DocBlock/ImgViewer 机制。
import { ref, computed, nextTick } from 'vue'
import DocBlock from './DocBlock.vue'
import AppIcon from './AppIcon.vue'
import ImgViewer from './ImgViewer.vue'
import { fmtRel } from '../time.js'
import { firstQuote, flashEl, flashNeedle, needlesFor } from '../trace.js'
import { useDocStructure } from '../composables/doc-structure.js'

const props = defineProps({
  reqId: { type: String, required: true },
  doc: { type: Object, default: null },            // detail.doc（块表权威——非产物数据，空态照常渲染）
  snapshot: { type: Object, default: null },       // 依据版本展示（快照时点）
  pendingByBlock: { type: Object, default: () => ({}) }   // anchor → 待澄清 seq[]（反向角标）
})
const emit = defineEmits(['locate', 'clarify', 'open-origin', 'collapse'])

const { docData, childrenByParent, partitionedSections, commentByRef, docToc, mediaList } =
  useDocStructure(() => props.doc, () => props.reqId)

const box = ref(null)                 // 块渲染容器（needle 定位域）
const follow = ref(true)              // 跟随定位开关（关闭后自由滚动不被打断）
const tocOpen = ref(false)
const fromTip = ref('')               // 顶部「📍 来自 Pxx」sticky 提示（空 = 隐藏）
const missCard = ref(null)            // 定位全失的静态出处卡（r2 C1）：{ seq, src, quote, ctxText }

// 文档标题块（侧栏头展示；无 title 块退 card.name 由宿主传？——保持自治取 title，缺省不显）
const docTitle = computed(() =>
  (props.doc?.content?.blocks || []).find(b => b.type === 'title')?.text || '')

/** 定位入口（宿主 WorkbenchTab 调用）：主动点击摘引/出处 → 侧栏联动；跟随关闭时忽略。
 *  anchor 直达 → needle 回退（摘引→详述出处）→ 全失转静态出处卡（不弹 toast）。 */
async function locateCtx({ seq = '', src = '', anchor = '', quote = '', ctxText = '' }) {
  missCard.value = null
  if (!follow.value) return
  await nextTick()
  if (anchor) {
    const el = box.value?.querySelector(`[data-blk="${anchor}"]`)
    if (el) {
      box.value?.querySelectorAll('.ctx-hl').forEach(x => x.classList.remove('ctx-hl'))
      el.classList.add('ctx-hl')
      flashEl(el)
      el.classList.add('ctx-hl')   // flash 动画类与常驻高亮共存（flash 2.3s 后仅剩 ctx-hl）
      showFrom(seq, el)
      return
    }
  }
  const base = firstQuote(quote) || src
  for (const nd of needlesFor(base)) {
    if (box.value && await flashNeedle(box.value, nd)) { showFrom(seq, null); return }
  }
  missCard.value = { seq, src, quote, ctxText }
}
function showFrom(seq, el) {
  const label = el ? (el.textContent || '').trim().slice(0, 24) : ''
  fromTip.value = `📍 来自 ${seq}${label ? ' · ' + label : ''}（已定位并高亮，前后上下文可继续滚动）`
}
/** 侧栏内目录点击：平滑滚动（不占用壳层 locate 协议——本栏内闭合） */
function goToc(id) {
  box.value?.querySelector(`[data-blk="${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
defineExpose({ locateCtx })

// ===== 灯箱（复用 v4.20 ImgViewer；图源 = 块表文档序） =====
const viewerIdx = ref(-1)
function onDocMedia(id) {
  const i = mediaList.value.findIndex(m => m.id === id)
  if (i >= 0) viewerIdx.value = i
}
</script>

<template>
  <div class="ctx-card">
    <div class="ctx-head">
      <AppIcon name="file-text" :size="14" />
      <div class="ctx-ht">
        <b>{{ docTitle || '原始需求 · 上下文' }}</b>
        <span class="sub" v-if="snapshot">依据版本 {{ fmtRel(snapshot.at) }}</span>
      </div>
      <button class="follow" :class="{ on: follow }" @click="follow = !follow"
              :title="follow ? '开启中：点击左侧摘引自动定位；点击关闭以自由滚动' : '已关闭：点击左侧摘引不再滚动定位'">
        <span class="dot"></span>跟随定位</button>
      <button class="btn small link" title="收起原文面板（大需求全宽阅读时可收起）" @click="emit('collapse')">收起 ›</button>
    </div>

    <!-- 目录（默认收起；巨表文档主体在行级，heading 导航不到时 table-row 也入列） -->
    <details class="toc ctx-toc" :open="tocOpen" v-if="docToc.length">
      <summary @click="tocOpen = !tocOpen"><AppIcon name="list-tree" :size="12" />文档导航（{{ docToc.length }}）</summary>
      <div class="toc-list">
        <a v-for="h in docToc" :key="h.id" class="toc-item" :class="'lv' + (h.level || 1)"
           @click="goToc(h.id)">{{ h.text }}</a>
      </div>
    </details>

    <div class="ctx-from" v-if="fromTip">{{ fromTip }}<button class="x" @click="fromTip = ''">✕</button></div>

    <div class="ctx-body" ref="box">
      <!-- 定位全失的静态出处卡（r2 C1：存量卡空 anchor 边界——给出口不给报错） -->
      <div class="ctx-miss" v-if="missCard">
        <b>📍 {{ missCard.seq }} 的出处未命中块级锚点</b>
        <div class="row" v-if="missCard.ctxText"><span class="k">出处</span><span>{{ missCard.ctxText }}</span></div>
        <div class="row" v-if="missCard.quote"><span class="k">摘引</span><span>「{{ missCard.quote }}」</span></div>
        <button class="btn small" @click="emit('locate', missCard.src || missCard.quote, '')">
          <AppIcon name="crosshair" :size="11" />去原文搜索</button>
      </div>

      <template v-if="docData">
        <template v-for="sec in partitionedSections" :key="sec.key">
          <section v-if="sec.heading" class="docsec" :class="sec.cls">
            <DocBlock :block="sec.heading" :children-by-parent="childrenByParent"
                      :comment-by-ref="commentByRef" :req-id="reqId" :pending-by-block="pendingByBlock"
                      @clarify="seq => emit('clarify', seq)" @view-media="onDocMedia" />
            <template v-for="p in sec.parts" :key="p.kind === 'table' ? 'tbl-' + p.rows[0].id : p.block.id">
              <table v-if="p.kind === 'table'" class="mini">
                <thead><tr><th v-for="(h, hi) in p.head" :key="hi">{{ h }}</th></tr></thead>
                <tbody>
                  <tr v-for="row in p.rows" :key="row.id" :data-blk="row.id">
                    <td v-for="(c, ci) in row.cells" :key="ci">{{ c }}</td>
                  </tr>
                </tbody>
              </table>
              <DocBlock v-else :block="p.block" :children-by-parent="childrenByParent"
                        :comment-by-ref="commentByRef" :req-id="reqId" :pending-by-block="pendingByBlock"
                        @clarify="seq => emit('clarify', seq)" @view-media="onDocMedia" />
            </template>
          </section>
          <template v-else>
            <template v-for="p in sec.parts" :key="p.kind === 'table' ? 'tbl-' + p.rows[0].id : p.block.id">
              <table v-if="p.kind === 'table'" class="mini">
                <thead><tr><th v-for="(h, hi) in p.head" :key="hi">{{ h }}</th></tr></thead>
                <tbody>
                  <tr v-for="row in p.rows" :key="row.id" :data-blk="row.id">
                    <td v-for="(c, ci) in row.cells" :key="ci">{{ c }}</td>
                  </tr>
                </tbody>
              </table>
              <DocBlock v-else :block="p.block" :children-by-parent="childrenByParent"
                        :comment-by-ref="commentByRef" :req-id="reqId" :pending-by-block="pendingByBlock"
                        @clarify="seq => emit('clarify', seq)" @view-media="onDocMedia" />
            </template>
          </template>
        </template>
      </template>
      <div class="ctx-empty" v-else>
        原文以快照形式存在（未导入块结构）——块级定位不可用，可「全宽阅读」查看。
      </div>
    </div>

    <div class="ctx-foot">
      <span class="sub">块级锚点直达 · 前后上下文自由滚动</span>
      <button class="btn small link" @click="emit('open-origin')">全宽阅读 ↗</button>
    </div>

    <ImgViewer v-if="viewerIdx >= 0" :list="mediaList" v-model:index="viewerIdx" @close="viewerIdx = -1" />
  </div>
</template>

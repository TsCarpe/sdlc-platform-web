<script setup>
// 原文上下文侧栏（DESIGN-v5 §2.1 双栏并置）：工作台右栏常驻原文——**侧栏专用简化平铺渲染**
//（v5.1 交互修正：回归 demo 契约——纯文本平铺/列表缩进/图片行，弃用全宽 DocBlock 的
// 评论按钮/条款卡/折叠等交互件与原始尺寸图片，窄栏保持干净；
// v5.2：图片行升级缩略图卡（AI 长图注零区分度），文本块支持链接可点（裸 URL/ md 链接）。
// 定位协议：anchor 块直达 → needle 回退 → 全失降级静态出处卡（不弹失败 toast，r2 C1）。
// 滚动只动侧栏容器自身（原生 scrollIntoView 会连动浏览器窗口）+ 二次校正。
import { ref, reactive, computed, nextTick } from 'vue'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import AppIcon from './AppIcon.vue'
import ImgViewer from './ImgViewer.vue'
import { fmtRel } from '../time.js'
import { firstQuote, needlesFor } from '../trace.js'
import { mdPlain } from '../docview.js'
import { buildThreads, threadOf } from '../comments.js'
import { useDocStructure } from '../composables/doc-structure.js'

const props = defineProps({
  reqId: { type: String, required: true },
  doc: { type: Object, default: null },            // detail.doc（块表权威——非产物数据，空态照常渲染）
  snapshot: { type: Object, default: null },       // 依据版本展示（快照时点）
  pendingByBlock: { type: Object, default: () => ({}) },   // anchor → 待澄清 seq[]（反向角标）
  comments: { type: Array, default: () => [] },    // 评论行（评论出处卡数据源——壳层 GET /comments）
  blockText: { type: Object, default: () => ({}) } // blockId → 文本摘要（根评论锚定块标签）
})
const emit = defineEmits(['locate', 'clarify', 'open-origin', 'collapse', 'open-comments'])

const { docData, docBlocks, docToc, mediaList } = useDocStructure(() => props.doc, () => props.reqId)

const box = ref(null)                 // 平铺渲染容器（定位域）
const follow = ref(true)              // 跟随定位开关（关闭后自由滚动不被打断）
const tocOpen = ref(false)
const fromTip = ref('')               // 顶部「📍 来自 Pxx」sticky 提示（空 = 隐藏）
const missCard = ref(null)            // 定位全失的静态出处卡（r2 C1）：{ seq, src, quote, ctxText }

// ===== 简化平铺渲染（demo 契约）：全量块（除评论）按文档序平铺 =====
const renderBlocks = computed(() =>
  (props.doc?.content?.blocks || []).filter(b => b.type !== 'comment'))
const byId = computed(() => {
  const m = {}
  for (const b of docBlocks.value) m[b.id] = b
  return m
})
/** 列表缩进深度（父链计数，封顶 2 级——demo 口径） */
function depthOf(b) {
  let d = 0, p = b.parent
  while (p && byId.value[p]) { d++; p = byId.value[p].parent }
  return Math.min(d, 2)
}
function isHeading(b) { return b.type === 'title' || b.type === 'heading' }
function isMedia(b) { return b.type === 'image' || b.type === 'whiteboard' }
// ===== v5.2 图片缩略图（占位行升级：AI 长图注零区分度，23 图全是「图片展示的是…」开头） =====
// 缩略图直接走现成媒体端点（与 mediaList 同源），加载失败回退图标占位行（无图块同）
const imgErr = reactive(new Set())   // 加载失败的块 id
// #22a：媒体可用集合（与 mediaList 同源的 media id 集）——无 media 的图片/画板块点击灯箱必扑空，
// disabled + title 双分支把「点了没反应」升级为「明确不可点」（D18 降级不冒充可交互）
const mediaIds = computed(() => new Set(docBlocks.value
  .filter(b => (b.type === 'image' || b.type === 'whiteboard') && b.media).map(b => b.media)))
function thumbUrl(b) {
  return `/api/requirements/${props.reqId}/media/${b.media}`
}
// ===== v5.2 链接可点（正文/行块）：裸 URL 自动 linkify + md 链接语法渲染；无链接块走 mdPlain 快路径 =====
const RICH_RE = /\[[^\]]*\]\([^)]*\)|https?:\/\//
/** 裸 URL → md 链接：一次遍历，已是 md 链接的原样保留（防 (url) 内的 url 被二次包装）；
 *  URL 截止于空白/括号引号/常见中文标点（原型分享链后紧跟中文句读的场景） */
const URL_RE = /(\[[^\]]*\]\([^)]*\))|(https?:\/\/[^\s<>()"'，。；、）】」』]+)/g
function richHtml(b) {
  const raw = b.type === 'table-row' ? rowText(b) : (b.text || '')
  if (!RICH_RE.test(raw)) return ''
  const md = raw.replace(URL_RE, (m, mdLink) => mdLink || `[${m}](${m})`)
  return DOMPurify.sanitize(marked.parseInline(md)).replace(/<a /g, '<a target="_blank" rel="noopener" ')
}
/** 列表序号（ordinal 优先，marker 兜底——两代块数据字段并存） */
function ordinalOf(b) { return (b.ordinal || b.marker || '').replace(/\s+/g, '') }
function imgCaption(b) {
  return (b.caption || b.alt || (b.type === 'whiteboard' ? '画板缩略图' : '原文图片')).trim()
}
function rowText(b) {
  const t = mdPlain(b.text)
  return b.rowLabel && !t ? `§${b.rowLabel}` : (b.rowLabel ? `§${b.rowLabel} ${t}` : t)
}

const docTitle = computed(() => renderBlocks.value.find(b => b.type === 'title')?.text || '')

// ===== 定位协议（v5.1 重写：手动 scrollTop 只滚侧栏 + 二次校正，不连动浏览器窗口） =====
function clearHl() {
  box.value?.querySelectorAll('.ctx-hl').forEach(x => x.classList.remove('ctx-hl'))
  const m = document.getElementById('ctx-needle')
  if (m?.parentNode) { m.parentNode.replaceChild(document.createTextNode(m.textContent), m); m.parentNode.normalize() }
}
function scrollIntoViewCtx(el) {
  const body = box.value
  if (!body || !el) return
  body.scrollTop = Math.max(0, el.offsetTop - (body.clientHeight - el.offsetHeight) / 2)
}
function focusEl(el, seq) {
  clearHl()
  el.classList.add('ctx-hl')
  scrollIntoViewCtx(el)
  el.classList.remove('ctx-flash'); void el.offsetWidth; el.classList.add('ctx-flash')
  setTimeout(() => el.classList.remove('ctx-flash'), 2000)
  showFrom(seq, el)
  // 二次校正：初次滚动后布局仍可能微调（字体/占位行/懒加载）——稳定后再对齐一次
  setTimeout(() => { if (el.isConnected && el.classList.contains('ctx-hl')) scrollIntoViewCtx(el) }, 300)
}
/** 容器内 needle 文本定位：TreeWalker 匹配 + mark 包裹（平铺纯文本单节点，命中率高） */
function needleEl(nd) {
  if (!box.value || !nd) return null
  const walker = document.createTreeWalker(box.value, NodeFilter.SHOW_TEXT)
  let node
  while ((node = walker.nextNode())) {
    const idx = node.textContent.indexOf(nd)
    if (idx >= 0) {
      try {
        const range = document.createRange()
        range.setStart(node, idx)
        range.setEnd(node, idx + nd.length)
        const mark = document.createElement('mark')
        mark.id = 'ctx-needle'
        range.surroundContents(mark)
        return mark
      } catch { return null }
    }
  }
  return null
}

/** 定位入口（宿主 WorkbenchTab 调用）：主动点击摘引/出处 → 侧栏联动；跟随关闭时忽略。
 *  anchor 直达 → needle 回退（摘引→详述出处）→ 全失转静态出处卡（不弹 toast）。 */
async function locateCtx({ seq = '', src = '', anchor = '', quote = '', ctxText = '' }) {
  missCard.value = null
  if (!follow.value) return
  await nextTick()
  if (anchor) {
    const el = box.value?.querySelector(`[data-blk="${anchor}"]`)
    if (el) { focusEl(el, seq); return }
  }
  for (const nd of needlesFor(firstQuote(quote) || src)) {
    const el = needleEl(nd)
    if (el) { focusEl(el, seq); return }
  }
  missCard.value = { seq, src, quote, ctxText }
}
function showFrom(seq, el) {
  const label = el ? (el.textContent || '').trim().slice(0, 24) : ''
  fromTip.value = `📍 来自 ${seq}${label ? ' · ' + label : ''}（已定位并高亮，前后上下文可继续滚动）`
}
/** 侧栏内目录点击：平滑滚动（不占用壳层 locate 协议——本栏内闭合） */
function goToc(id) {
  const el = box.value?.querySelector(`[data-blk="${id}"]`)
  if (el) scrollIntoViewCtx(el)
}

// ===== 评论出处卡（出处=评论的只读查看态）：头部区插卡不动原文滚动，与 locateCtx 可共存 =====
const cmtCard = ref(null)      // { seq, cid } —— null = 无卡；随右栏收起/切 tab 的 v-if 卸载自然消失（与 ✕ 等效）
const cmtEl = ref(null)        // 卡容器（flash 与内滚域）
const cmtThread = computed(() => cmtCard.value ? threadOf(buildThreads(props.comments), cmtCard.value.cid) : null)
/** 根评论锚定块短标签（与 CommentsPanel blkShort 同口径：24 字截断，title 悬停全文） */
function blkLabel(id) {
  const t = (props.blockText[id] || '').slice(0, 60) || id
  return t.length > 24 ? t.slice(0, 24) + '…' : t
}

/** 评论出处定位（WorkbenchTab 出处=评论分流调用）：命中插卡+flash 目标消息；悬空（评论已删/
 *  列表为空）返回 false 由调用方回退只读抽屉。不受 follow 开关限制——插卡不滚动原文，
 *  无「打断阅读」可言（与 locateCtx 的本质差异）。 */
async function locateComment({ seq = '', cid = null }) {
  if (cid == null) return false
  const t = threadOf(buildThreads(props.comments), cid)
  if (!t) return false
  cmtCard.value = { seq, cid }
  missCard.value = null   // 同属出处态：新目标替换旧静态出处卡
  await nextTick()
  const card = cmtEl.value
  const el = card?.querySelector(`[data-cid="${cid}"]`)
  if (card && el) {
    // 手动 scrollTop 只滚卡片容器（原生 scrollIntoView 连动浏览器窗口）；offsetTop 相对卡容器（CSS position:relative）
    card.scrollTop = Math.max(0, el.offsetTop - 20)
    el.classList.add('cmt-flash')
    setTimeout(() => el.classList.remove('cmt-flash'), 1600)
  }
  return true
}
defineExpose({ locateCtx, locateComment })

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

    <!-- 评论出处卡（出处=评论的只读查看态）：线程消息复用全局 .ct-* 样式；miss（评论被删）
         时 cmtThread 为 null 卡自动消失，不留空壳 -->
    <div class="ctx-cmt" v-if="cmtCard && cmtThread" ref="cmtEl">
      <div class="ctx-cmt-h">
        <b><AppIcon name="message-square" :size="13" />评论出处{{ cmtCard.seq ? ' ' + cmtCard.seq : '' }}</b>
        <span class="chip" v-if="cmtThread.resolved">已解决</span>
        <span class="chip" v-if="cmtThread.root.origin === 'feishu'" title="飞书文档导入的历史评论">来自源文档</span>
        <span class="spacer"></span>
        <button class="x" @click="cmtCard = null" aria-label="关闭评论出处卡">✕</button>
      </div>
      <div class="ctx-cmt-blk" v-if="cmtThread.root.blockId">
        锚定：<a class="linklike" @click="locateCtx({ seq: cmtCard.seq, anchor: cmtThread.root.blockId })"
               :title="'定位原文块 ' + cmtThread.root.blockId">{{ blkLabel(cmtThread.root.blockId) }}</a>
      </div>
      <div class="ct-msgs">
        <div class="ct-msg" :data-cid="cmtThread.root.id">
          <b>{{ cmtThread.root.author || '匿名' }}</b><span class="sub" :title="cmtThread.root.createdAt"> · {{ fmtRel(cmtThread.root.createdAt) }}</span>
          <div class="ct-text">{{ cmtThread.root.text }}</div>
        </div>
        <div class="ct-msg reply" v-for="r in cmtThread.replies" :key="r.id" :data-cid="r.id">
          <b>{{ r.author || '匿名' }}</b><span class="sub" :title="r.createdAt"> · {{ fmtRel(r.createdAt) }}</span>
          <div class="ct-text">{{ r.text }}</div>
        </div>
      </div>
      <div class="ctx-cmt-f">
        <button class="btn small" title="打开完整评论区（可回复 / 解决 / 升级）"
                @click="emit('open-comments', cmtThread.root.id)">
          <AppIcon name="arrow-up-right" :size="11" />打开评论区</button>
        <span class="sub">查看态只读</span>
      </div>
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
        <!-- 简化平铺（demo 契约）：标题分级 / 段落与列表纯文本（md 行内标记剥除）/
             图片画板占位行点击灯箱 / 深度缩进。每项带 data-blk 锚点与反向角标。 -->
        <div v-for="b in renderBlocks" :key="b.id" :data-blk="b.id"
             class="ctx-blk" :class="{
               'ctx-h': b.type === 'title',
               'ctx-sec': b.type === 'heading',
               'ctx-li': b.type === 'list-item',
               'ctx-sub': b.type === 'paragraph' && b.subheading,
               ['ctx-d' + depthOf(b)]: b.type === 'list-item',
             }">
          <template v-if="isHeading(b)">{{ mdPlain(b.text) }}</template>
          <template v-else-if="isMedia(b)">
            <button class="ctx-imgrow" :disabled="!mediaIds.has(b.media)"
                    :title="mediaIds.has(b.media) ? '点击灯箱查看' + (b.type === 'whiteboard' ? '画板' : '原图') : '媒体文件缺失，不可查看'"
                    @click="onDocMedia(b.id)">
              <span class="thumb">
                <img v-if="b.media && !imgErr.has(b.id)" :src="thumbUrl(b)" :alt="imgCaption(b)"
                     loading="lazy" @error="imgErr.add(b.id)" />
                <AppIcon v-else :name="b.type === 'whiteboard' ? 'layers' : 'image'" :size="16" />
              </span>
              <span class="cap">{{ imgCaption(b) }}</span>
              <span class="hint" v-if="mediaIds.has(b.media)">查看 ↗</span>
            </button>
          </template>
          <template v-else-if="b.type === 'attachment'">
            <span class="ctx-att"><AppIcon name="paperclip" :size="12" />{{ b.name || '附件' }}<span class="sub" v-if="b.mime"> · {{ b.mime }}</span></span>
          </template>
          <template v-else>
            <b v-if="ordinalOf(b)" class="ord">{{ ordinalOf(b) }}</b><span v-if="ordinalOf(b)"> </span><span v-if="richHtml(b)" class="ctx-rich" v-html="richHtml(b)"></span><template v-else>{{ b.type === 'table-row' ? rowText(b) : (mdPlain(b.text) || '（空块）') }}</template>
          </template>
          <button v-if="(pendingByBlock[b.id] || []).length" class="ref-pill"
                  :title="pendingByBlock[b.id].join(' / ') + ' 待澄清——点击定位左栏对应问题'"
                  @click="emit('clarify', pendingByBlock[b.id][0])">{{ pendingByBlock[b.id].join('/') }} 待澄清</button>
        </div>
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

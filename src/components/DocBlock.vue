<script setup>
// v1.2 原文块结构渲染（递归组件）：格式无关通用块模型 → 结构化视图
// 解决：①巨表堆叠（table-row=行卡片，嵌套 ol=条款树） ②图片（媒体端点） ③锚点（data-blk 直达）
// v1.3 UI 改版：长段落折叠（ClampText，DOM 常驻不影响 needle 定位）、emoji → SVG 图标
import { ref, computed } from 'vue'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import AppIcon from './AppIcon.vue'
import ClampText from './ClampText.vue'

const props = defineProps({
  block: { type: Object, required: true },
  childrenByParent: { type: Object, default: () => ({}) },
  commentByRef: { type: Object, default: () => ({}) },
  reqId: { type: String, default: '' },
  platformCount: { type: Number, default: 0 }   // v4 平台评论数（按 blockId 聚合，OriginTab 传入）
})
const emit = defineEmits(['comments'])   // 平台评论角标点击（壳层开评论面板）

const openComments = ref(false)

const children = computed(() => props.childrenByParent[props.block.id] || [])
const commentRefs = computed(() => String(props.block.comments || '').split(/\s+/).filter(Boolean))
const commentThreads = computed(() =>
  commentRefs.value.map(r => props.commentByRef[r]).filter(Boolean))

const inlineHtml = computed(() => {
  const t = props.block.text || ''
  if (!t) return ''
  return DOMPurify.sanitize(marked.parseInline(t))
})

const mediaUrl = computed(() =>
  props.block.media ? `/api/requirements/${props.reqId}/media/${props.block.media}` : '')

const headingTag = computed(() => {
  const lv = props.block.level || 2
  return 'h' + Math.min(Math.max(lv + 1, 2), 6)   // title/heading 降一级渲染，文档标题让位页面标题
})

const cellPairs = computed(() => {
  const head = props.block.head || []
  const cells = props.block.cells || []
  return cells.map((c, i) => ({
    label: head[i] || ('列' + (i + 1)),
    text: c,
    html: c ? DOMPurify.sanitize(marked.parseInline(c)) : ''
  })).filter(p => p.text)
})

function toggleComments() { openComments.value = !openComments.value }
</script>

<template>
  <!-- 标题 -->
  <component :is="headingTag" v-if="block.type === 'title' || block.type === 'heading'"
             :data-blk="block.id" class="docblk-h" :class="'h' + (block.level || 1)">
    {{ block.text }}
  </component>

  <!-- 段落：长文本默认折叠（CSS line-clamp，DOM 常驻），可展开 -->
  <p v-else-if="block.type === 'paragraph'" class="docblk-p" :data-blk="block.id">
    <ClampText :html="inlineHtml" :lines="4" :threshold="170" />
    <button class="cmbadge" v-if="platformCount" :title="platformCount + ' 条平台评论'"
            @click="emit('comments')"><AppIcon name="message-square" :size="10" />{{ platformCount }}</button>
  </p>

  <!-- 列表项（条款）：最小引用单位 -->
  <div v-else-if="block.type === 'list-item'" class="docblk clause" :data-blk="block.id">
    <div class="clause-line">
      <span class="ordinal" v-if="block.marker">{{ block.marker.replace(/\s+/g, '') }}</span>
      <span class="clause-text" v-html="inlineHtml"></span>
      <button class="cmbadge" v-if="platformCount" :title="platformCount + ' 条平台评论'"
              @click="emit('comments')"><AppIcon name="message-square" :size="10" />{{ platformCount }}</button>
      <button class="cmbadge" v-if="commentThreads.length" @click="toggleComments"
          :title="'评论区：' + commentThreads[0]?.quote">
        <AppIcon name="message-square" :size="10" />{{ commentThreads.length }}</button>
    </div>
    <div class="cthread" v-for="t in (openComments ? commentThreads : [])" :key="t.id">
      <div class="ct-q" v-if="t.quote">「{{ t.quote }}」</div>
      <div class="ct-msg" v-for="(m, i) in t.thread" :key="i"><b>{{ m.user }}</b>：{{ m.text }}</div>
    </div>
    <DocBlock v-for="c in children" :key="c.id" :block="c" :children-by-parent="childrenByParent"
              :comment-by-ref="commentByRef" :req-id="reqId" class="docblk-child" />
  </div>

  <!-- 表格行：行卡片 + 单元格元信息 + 内嵌条款树 -->
  <div v-else-if="block.type === 'table-row'" class="docblk rowcard" :data-blk="block.id">
    <div class="rowcard-h">
      <span class="chip">{{ block.rowLabel }}</span>
      <button class="cmbadge" v-if="platformCount" :title="platformCount + ' 条平台评论'"
              @click="emit('comments')"><AppIcon name="message-square" :size="10" />{{ platformCount }}</button>
      <button class="cmbadge" v-if="commentThreads.length" @click="toggleComments">
        <AppIcon name="message-square" :size="10" />{{ commentThreads.length }}</button>
      <div class="cthread" v-for="t in (openComments ? commentThreads : [])" :key="t.id">
        <div class="ct-msg" v-for="(m, i) in t.thread" :key="i"><b>{{ m.user }}</b>：{{ m.text }}</div>
      </div>
    </div>
    <div class="rowmeta" v-if="cellPairs.length">
      <span v-for="p in cellPairs" :key="p.label" class="cellpair"><b>{{ p.label }}：</b><span class="cp-val" v-html="p.html"></span></span>
    </div>
    <DocBlock v-for="c in children" :key="c.id" :block="c" :children-by-parent="childrenByParent"
              :comment-by-ref="commentByRef" :req-id="reqId" class="docblk-child" />
  </div>

  <!-- 图片 -->
  <figure v-else-if="block.type === 'image'" class="docblk imgcard" :data-blk="block.id">
    <a :href="mediaUrl" target="_blank" rel="noopener">
      <!-- v2.2：渲染数据自带 width/height 固有尺寸——懒加载图片有占位，scrollIntoView 目标位置不被加载过程推移 -->
      <img :src="mediaUrl" :alt="block.alt" loading="lazy" :width="block.width" :height="block.height">
    </a>
    <!-- caption 优先（parse_doc ≥0.4 图片说明），alt 兜底 -->
    <figcaption v-if="block.caption || block.alt"><AppIcon name="image" :size="12" />{{ block.caption || block.alt }}</figcaption>
  </figure>

  <!-- 附件 -->
  <div v-else-if="block.type === 'attachment'" class="docblk mediacard" :data-blk="block.id">
    <span class="mediacard-ico"><AppIcon name="paperclip" :size="15" /></span>
    <div style="flex:1;min-width:0">
      <div style="font-weight:600;font-size:13px">{{ block.name }}</div>
      <div class="sub">{{ block.mime }} · {{ (block.bytes / 1024).toFixed(0) }} KB</div>
    </div>
    <a :href="mediaUrl" target="_blank" rel="noopener"><button class="btn small">查看/下载</button></a>
  </div>

  <!-- 画板（缩略图） -->
  <div v-else-if="block.type === 'whiteboard'" class="docblk imgcard" :data-blk="block.id">
    <img v-if="mediaUrl" :src="mediaUrl" alt="画板缩略图" loading="lazy">
    <div class="sub"><AppIcon name="layers" :size="12" />飞书画板缩略图（原图请到飞书文档查看）</div>
  </div>

  <!-- comment 块在宿主上渲染，不独立显示 -->
  <template v-else-if="block.type === 'comment'"></template>

  <!-- 未知类型兜底 -->
  <div v-else class="docblk-p sub" :data-blk="block.id">{{ block.text || block.type }}</div>
</template>

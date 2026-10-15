<script setup>
// v1.2 原文块结构渲染（递归组件）：格式无关通用块模型 → 结构化视图
// 解决：①巨表堆叠（table-row=行卡片，嵌套 ol=条款树） ②图片（媒体端点） ③锚点（data-blk 直达）
// v1.3 UI 改版：长段落折叠（ClampText，DOM 常驻不影响 needle 定位）、emoji → SVG 图标
import { ref, computed } from 'vue'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import AppIcon from './AppIcon.vue'
import ClampText from './ClampText.vue'
import { splitRowScalars, groupRowChildren } from '../docview.js'

const props = defineProps({
  block: { type: Object, required: true },
  childrenByParent: { type: Object, default: () => ({}) },
  commentByRef: { type: Object, default: () => ({}) },
  reqId: { type: String, default: '' },
  platformByBlock: { type: Object, default: () => ({}) },   // v4 平台评论数 map（blockId → 数量，整 map 下传——子块递归也能查到自己的计数）
  pendingByBlock: { type: Object, default: () => ({}) }     // v5 待澄清反向角标 map（blockId → seq[]，§4——复用评论角标整 map 下传机制）
})
// comments：平台评论角标点击（携块 id 逐层上抛，壳层开评论面板）；
// view-media：图片/画板缩略图点击（携块 id 逐层上抛，宿主开页内灯箱——v4.20 替代新开窗口）；
// clarify：待澄清角标点击（携首个 seq 逐层上抛，宿主定位工作台对应问题——v5 §4）
const emit = defineEmits(['comments', 'view-media', 'clarify'])

const openComments = ref(false)

const children = computed(() => props.childrenByParent[props.block.id] || [])
/** 本块平台评论数（map 直查；任意深度子块同源） */
const platCount = computed(() => props.platformByBlock[props.block.id] || 0)
/** 本块待澄清编号（反向角标；子块递归同源直查） */
const pendingSeqs = computed(() => props.pendingByBlock[props.block.id] || [])
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

// v4.1 D1 标量分流（docview.splitRowScalars）：卡头轻 chip（headerVals，只显值）+ 标签值对
// （metaPairs，label 空只显值）——替代旧 cellPairs 的「列N」自造标签兜底（head 空时全落 meta 无标签）
const scalars = computed(() => splitRowScalars(props.block))

// v4.1 行内子块分组（cell 戳 → 内容格分组树 + 尾部图廊 + 列表视觉挂靠前导段）
const groupedChildren = computed(() =>
  props.block.type === 'table-row' ? groupRowChildren(children.value, props.block.head || []) : [])

/** 卡头 chip 优先级样式：/^P\d/ 形态加 pri（P0 红 / P1 橙 / 其余中性）——纯形态判断，非列名语义识别 */
function chipCls(v) {
  const m = /^P(\d)/.exec(String(v))
  if (!m) return ''
  return m[1] === '0' ? 'pri p0' : m[1] === '1' ? 'pri p1' : 'pri'
}

/** 图廊竖图判定（figure.tall 高版封面）：宽高属性齐全且高>宽（H5 长截图） */
function isPortrait(b) { return !!b.width && !!b.height && b.height > b.width }

function toggleComments() { openComments.value = !openComments.value }
</script>

<template>
  <!-- 标题 -->
  <component :is="headingTag" v-if="block.type === 'title' || block.type === 'heading'"
             :data-blk="block.id" class="docblk-h" :class="'h' + (block.level || 1)">
    {{ block.text }}
    <button v-if="pendingSeqs.length" class="ref-pill" :title="pendingSeqs.join(' / ') + ' 待澄清——点击定位工作台对应问题'"
            @click.prevent="emit('clarify', pendingSeqs[0])">{{ pendingSeqs.join('/') }} 待澄清</button>
  </component>

  <!-- 段落小标题（parse_doc ≥0.5 内容格粗体独占段，subheading）：▍左竖条，短标题不折叠 -->
  <div v-else-if="block.type === 'paragraph' && block.subheading" class="docblk-sub" :data-blk="block.id">
    <span v-html="inlineHtml"></span>
    <button class="cmbadge" :class="{ ghost: !platCount }" :title="platCount ? platCount + ' 条平台评论' : '评论此块'"
            @click="emit('comments', block.id)"><AppIcon name="message-square" :size="11" />{{ platCount || '评论' }}</button>
    <button v-if="pendingSeqs.length" class="ref-pill" :title="pendingSeqs.join(' / ') + ' 待澄清——点击定位工作台对应问题'"
            @click="emit('clarify', pendingSeqs[0])">{{ pendingSeqs.join('/') }} 待澄清</button>
  </div>

  <!-- 段落：长文本默认折叠（CSS line-clamp，DOM 常驻），可展开 -->
  <p v-else-if="block.type === 'paragraph'" class="docblk-p" :data-blk="block.id">
    <ClampText :html="inlineHtml" :lines="4" :threshold="170" />
    <button class="cmbadge" :class="{ ghost: !platCount }" :title="platCount ? platCount + ' 条平台评论' : '评论此块'"
            @click="emit('comments', block.id)"><AppIcon name="message-square" :size="11" />{{ platCount || '评论' }}</button>
    <button v-if="pendingSeqs.length" class="ref-pill" :title="pendingSeqs.join(' / ') + ' 待澄清——点击定位工作台对应问题'"
            @click="emit('clarify', pendingSeqs[0])">{{ pendingSeqs.join('/') }} 待澄清</button>
  </p>

  <!-- 列表项（条款）：最小引用单位 -->
  <div v-else-if="block.type === 'list-item'" class="docblk clause" :data-blk="block.id">
    <div class="clause-line">
      <span class="ordinal" v-if="block.marker">{{ block.marker.replace(/\s+/g, '') }}</span>
      <span class="clause-text" v-html="inlineHtml"></span>
      <button class="cmbadge" :class="{ ghost: !platCount }" :title="platCount ? platCount + ' 条平台评论' : '评论此块'"
              @click="emit('comments', block.id)"><AppIcon name="message-square" :size="11" />{{ platCount || '评论' }}</button>
      <button class="cmbadge" v-if="commentThreads.length" @click="toggleComments"
          :title="'评论区：' + commentThreads[0]?.quote">
        <AppIcon name="message-square" :size="10" />{{ commentThreads.length }}</button>
      <button v-if="pendingSeqs.length" class="ref-pill" :title="pendingSeqs.join(' / ') + ' 待澄清——点击定位工作台对应问题'"
              @click="emit('clarify', pendingSeqs[0])">{{ pendingSeqs.join('/') }} 待澄清</button>
    </div>
    <div class="cthread" v-for="t in (openComments ? commentThreads : [])" :key="t.id">
      <div class="ct-q" v-if="t.quote">「{{ t.quote }}」</div>
      <div class="ct-msg" v-for="(m, i) in t.thread" :key="i"><b>{{ m.user }}</b>：{{ m.text }}</div>
    </div>
    <DocBlock v-for="c in children" :key="c.id" :block="c" :children-by-parent="childrenByParent"
              :comment-by-ref="commentByRef" :req-id="reqId" :platform-by-block="platformByBlock"
              :pending-by-block="pendingByBlock"
              class="docblk-child" @comments="id => emit('comments', id)" @view-media="id => emit('view-media', id)"
              @clarify="seq => emit('clarify', seq)" />
  </div>

  <!-- 表格行：行卡片（卡头 rowLabel chip + 标量轻 chip）+ 标签值对 + 内容格分组树（v4.1 层级还原） -->
  <div v-else-if="block.type === 'table-row'" class="docblk rowcard" :data-blk="block.id">
    <div class="rowcard-h">
      <span class="chip">{{ block.rowLabel }}</span>
      <span v-for="(v, vi) in scalars.headerVals" :key="vi" class="rc-chip" :class="chipCls(v)">{{ v }}</span>
      <button class="cmbadge" :class="{ ghost: !platCount }" :title="platCount ? platCount + ' 条平台评论' : '评论此块'"
              @click="emit('comments', block.id)"><AppIcon name="message-square" :size="11" />{{ platCount || '评论' }}</button>
      <button class="cmbadge" v-if="commentThreads.length" @click="toggleComments">
        <AppIcon name="message-square" :size="10" />{{ commentThreads.length }}</button>
      <button v-if="pendingSeqs.length" class="ref-pill" :title="pendingSeqs.join(' / ') + ' 待澄清——点击定位工作台对应问题'"
              @click="emit('clarify', pendingSeqs[0])">{{ pendingSeqs.join('/') }} 待澄清</button>
      <div class="cthread" v-for="t in (openComments ? commentThreads : [])" :key="t.id">
        <div class="ct-msg" v-for="(m, i) in t.thread" :key="i"><b>{{ m.user }}</b>：{{ m.text }}</div>
      </div>
    </div>
    <div class="rowmeta" v-if="scalars.metaPairs.length">
      <span v-for="p in scalars.metaPairs" :key="p.idx" class="cellpair">
        <b v-if="p.label">{{ p.label }}：</b><span class="cp-val">{{ p.value }}</span>
      </span>
    </div>
    <div class="rowbody" v-if="groupedChildren.length">
      <div v-for="g in groupedChildren" :key="g.cellIdx" class="rowgrp">
        <!-- 多内容格才显组名（组名 = 列表头）；单一内容组/无表头组不显 -->
        <div class="gname" v-if="groupedChildren.length > 1 && g.label">{{ g.label }}</div>
        <template v-for="item in g.tree" :key="item.block.id">
          <!-- lead：连续列表 run 视觉挂靠最近非 subheading 前导段（数据层 parent 仍 = 行块） -->
          <div v-if="item.kind === 'lead'" class="leadgrp">
            <DocBlock :block="item.block" :children-by-parent="childrenByParent"
                      :comment-by-ref="commentByRef" :req-id="reqId" :platform-by-block="platformByBlock"
                      :pending-by-block="pendingByBlock"
                      @comments="id => emit('comments', id)" @view-media="id => emit('view-media', id)"
                      @clarify="seq => emit('clarify', seq)" />
            <DocBlock v-for="li in item.listChildren" :key="li.id" :block="li" :children-by-parent="childrenByParent"
                      :comment-by-ref="commentByRef" :req-id="reqId" :platform-by-block="platformByBlock"
                      :pending-by-block="pendingByBlock"
                      class="docblk-child" @comments="id => emit('comments', id)" @view-media="id => emit('view-media', id)"
                      @clarify="seq => emit('clarify', seq)" />
          </div>
          <DocBlock v-else :block="item.block" :children-by-parent="childrenByParent"
                    :comment-by-ref="commentByRef" :req-id="reqId" :platform-by-block="platformByBlock"
                    :pending-by-block="pendingByBlock"
                    class="docblk-child" @comments="id => emit('comments', id)" @view-media="id => emit('view-media', id)"
                    @clarify="seq => emit('clarify', seq)" />
        </template>
        <!-- 尾部媒体块图廊（image 自带 caption；竖图 tall 高版封面） -->
        <div class="gal" v-if="g.gallery.length">
          <DocBlock v-for="m in g.gallery" :key="m.id" :block="m" :children-by-parent="childrenByParent"
                    :comment-by-ref="commentByRef" :req-id="reqId" :platform-by-block="platformByBlock"
                    :pending-by-block="pendingByBlock"
                    @comments="id => emit('comments', id)" @view-media="id => emit('view-media', id)"
                    @clarify="seq => emit('clarify', seq)"
                    :class="{ tall: m.type === 'image' && isPortrait(m) }" />
        </div>
      </div>
    </div>
  </div>

  <!-- 图片（v4.20 点击页内灯箱放大——替代新开窗口，不再跳出应用） -->
  <figure v-else-if="block.type === 'image'" class="docblk imgcard" :data-blk="block.id">
    <!-- v2.2：渲染数据自带 width/height 固有尺寸——懒加载图片有占位，scrollIntoView 目标位置不被加载过程推移 -->
    <img class="iv-open" :src="mediaUrl" :alt="block.alt" loading="lazy" :width="block.width" :height="block.height"
         role="button" tabindex="0" title="点击放大查看"
         @click="emit('view-media', block.id)" @keydown.enter="emit('view-media', block.id)">
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
    <img v-if="mediaUrl" class="iv-open" :src="mediaUrl" alt="画板缩略图" loading="lazy"
         role="button" tabindex="0" title="点击放大查看"
         @click="emit('view-media', block.id)" @keydown.enter="emit('view-media', block.id)">
    <div class="sub"><AppIcon name="layers" :size="12" />飞书画板缩略图（原图请到飞书文档查看）</div>
  </div>

  <!-- comment 块在宿主上渲染，不独立显示 -->
  <template v-else-if="block.type === 'comment'"></template>

  <!-- 未知类型兜底 -->
  <div v-else class="docblk-p sub" :data-blk="block.id">{{ block.text || block.type }}</div>
</template>

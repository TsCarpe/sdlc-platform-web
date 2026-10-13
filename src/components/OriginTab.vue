<script setup>
// 原始需求 tab（AUDIT D6-2 拆分自 ReqDetail）：全文快照（D1）——v1.2 有块结构时结构化渲染
// （不堆叠/图片/锚点），否则 md 渲染降级；无快照时按来源降级（飞书外链 / 粘贴文本）。
// 目录点击经 emit 上抛壳层 locate 协议；box/headEls 供壳层 needle 定位与滚动高亮。
import { ref, computed } from 'vue'
import DocBlock from './DocBlock.vue'
import AppIcon from './AppIcon.vue'
import TocPane from './TocPane.vue'
import { render } from '../render.js'
import { fmtRel } from '../time.js'

const props = defineProps({
  card: { type: Object, required: true },        // sourceType/sourceUrl/sourceText/id
  snapshot: { type: Object, default: null },
  doc: { type: Object, default: null },
  activeHead: { type: String, default: '' }      // 壳层滚动高亮（目录侧栏）
})
const emit = defineEmits(['locate', 'go-toc'])

const snapshotBox = ref(null)            // 快照渲染容器（needle 定位，expose 给壳）
const tocOpen = ref(false)

const snapshotHtml = computed(() => render(props.snapshot?.md))

// ===== v1.2 原文块结构（doc）：结构化渲染 + 锚点直达 =====
const docData = computed(() => props.doc?.content || null)
const docBlocks = computed(() => docData.value?.blocks || [])
const childrenByParent = computed(() => {
  const m = {}
  for (const b of docBlocks.value) {
    const p = b.parent || ''
    ;(m[p] = m[p] || []).push(b)
  }
  return m
})
const rootBlocks = computed(() => docBlocks.value.filter(b => !b.parent && b.type !== 'comment'))
// v2.2 原文块章节分组：heading 栈切分（零文本假设）——按 level 弹栈建组，跳级自动压平（h2→h4 = 深度0→1），
// 非标题块归属栈顶组；首个标题前的内容归前言平铺（无 heading 文档整体退化为平铺，渲染行为不变）
const docSections = computed(() => {
  const secs = []
  const stack = []
  let preface = null
  const host = () => stack.length ? stack[stack.length - 1]
    : (preface ??= { key: 'preface', heading: null, blocks: [] })
  for (const b of rootBlocks.value) {
    if (b.type === 'heading') {
      const lv = b.level || 2        // 与 DocBlock headingTag 的缺省口径一致
      while (stack.length && stack[stack.length - 1].lv >= lv) stack.pop()
      const sec = { key: b.id, lv, cls: 'd' + Math.min(stack.length, 3), heading: b, blocks: [] }
      stack.push(sec)
      secs.push(sec)
    } else {
      host().blocks.push(b)
    }
  }
  return preface ? [preface, ...secs] : secs
})
const commentByRef = computed(() => {
  const m = {}
  for (const b of docBlocks.value) if (b.type === 'comment') m[b.ref] = b
  return m
})
// v2.2 目录纳入 table-row 行卡片（巨表文档主体在行级，heading 导航不到）；排除版本号形态 rowLabel（修订记录行）
const docToc = computed(() => docBlocks.value
  .filter(b => b.type === 'heading' || b.type === 'title'
    || (b.type === 'table-row' && !/^\d+(\.\d+)+$/.test(String(b.rowLabel || ''))))
  .map(b => ({
    id: b.id,
    level: b.type === 'table-row' ? 3 : (b.level || 1),
    text: b.type === 'table-row' ? (b.rowLabel || '') : (b.text || '')
  })))

/** 当前目录标题元素序列（壳层 onScroll 高亮计算用） */
function headEls() {
  return docToc.value.map(h => document.querySelector(`[data-blk="${h.id}"]`)).filter(Boolean)
}
defineExpose({ box: snapshotBox, headEls })
</script>

<template>
  <template v-if="snapshot">
    <div class="banner blue snap-bar">
      <AppIcon name="clock" :size="14" />
      <span>快照 <b class="num" :title="snapshot.at">{{ fmtRel(snapshot.at) }}</b> · 本快照是质检与澄清的<b>依据版本</b></span>
      <span>最新修订以<a v-if="card.sourceUrl" :href="card.sourceUrl" target="_blank" rel="noopener">飞书文档 ↗</a><span v-else>原始来源</span>为准</span>
      <span class="sub">重推产物时快照同步刷新；发布后冻结</span>
    </div>
    <div class="doc-layout">
    <div class="card doc docstruct" ref="snapshotBox">
      <template v-if="docData">
        <details class="toc" v-if="docToc.length" :open="tocOpen">
          <summary @click="tocOpen = !tocOpen">
            <AppIcon name="list-tree" :size="13" />文档导航（{{ docToc.length }} 个条目，点击滚动定位）
          </summary>
          <div class="toc-list">
            <a v-for="h in docToc" :key="h.id" class="toc-item" :class="'lv' + (h.level || 1)"
               @click="emit('locate', '', h.id)">{{ h.text }}</a>
          </div>
        </details>
        <!-- 章节分组渲染：heading 标题 + 直属块包裹进 .docsec 容器（缩进+引导线表达归属）；前言组平铺 -->
        <template v-for="sec in docSections" :key="sec.key">
          <section v-if="sec.heading" class="docsec" :class="sec.cls">
            <DocBlock :block="sec.heading" :children-by-parent="childrenByParent"
                      :comment-by-ref="commentByRef" :req-id="card.id" />
            <DocBlock v-for="b in sec.blocks" :key="b.id" :block="b"
                      :children-by-parent="childrenByParent" :comment-by-ref="commentByRef"
                      :req-id="card.id" />
          </section>
          <template v-else>
            <DocBlock v-for="b in sec.blocks" :key="b.id" :block="b"
                      :children-by-parent="childrenByParent" :comment-by-ref="commentByRef"
                      :req-id="card.id" />
          </template>
        </template>
      </template>
      <div v-else v-html="snapshotHtml"></div>
    </div>
    <TocPane :items="docToc.map(h => ({ id: h.id, level: h.level, text: h.text }))"
             :active-id="activeHead" @go="emit('go-toc', $event)" />
    </div>
  </template>
  <template v-else>
    <div class="card" v-if="card.sourceType === 'feishu'">
      <h3>飞书需求文档</h3>
      <p style="font-size:13px;color:var(--muted);margin-bottom:12px">
        尚无原文快照——快照将由 sdlc-sync 首次推送产物时生成；在此之前请到飞书查看原文。</p>
      <a :href="card.sourceUrl" target="_blank" rel="noopener">
        <button class="btn"><AppIcon name="external-link" :size="13" />打开飞书文档</button></a>
    </div>
    <div class="card" v-else>
      <h3>粘贴的原始需求文本</h3>
      <pre class="srctext">{{ card.sourceText }}</pre>
    </div>
  </template>
</template>

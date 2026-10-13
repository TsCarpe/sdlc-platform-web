<script setup>
// v4 四态块级 diff 视图（DESIGN-v4 §14.1 编辑器必做件）：数据源 = POST blocks/diff 预览与
// changes/{cid} items 同形状（{blockId,op,oldText,newText,oldAttrs,newAttrs,moved?}）——
// 窗口 1 保存预览与变更单 confirm 界面复用同一渲染层。纯展示：文本一律插值不走 v-html。
import { computed } from 'vue'
import AppIcon from './AppIcon.vue'

const props = defineProps({
  items: { type: Array, default: () => [] },
  counts: { type: Object, default: null },
  // 软删块上的评论（宿主块已删除）——变更单 diff 的「已删块评论」折叠区（交接 §4 P1）
  deletedComments: { type: Array, default: null }
})

const OP_META = {
  edit: { label: '变更', cls: 'edit' },
  insert: { label: '新增', cls: 'insert' },
  delete: { label: '删除', cls: 'delete' },
  move: { label: '移动', cls: 'move' }
}

const countsRow = computed(() => {
  const c = props.counts
    || props.items.reduce((m, it) => { m[it.op] = (m[it.op] || 0) + 1; return m }, { edit: 0, insert: 0, delete: 0, move: 0 })
  return ['edit', 'insert', 'delete', 'move'].map(k => ({ k, label: OP_META[k].label, n: c[k] || 0 })).filter(x => x.n)
})

/** 属性变化摘要（old/new attrs 均非空且不等时展示——文本变化之外的 shape 级差异，如 level/parent/depth） */
function attrsChanged(it) {
  const a = it.oldAttrs, b = it.newAttrs
  if (!a && !b) return false
  return JSON.stringify(a || {}) !== JSON.stringify(b || {})
}
function fmtAttrs(v) { return JSON.stringify(v || {}, null, 1).replace(/\n\s*/g, ' ') }
</script>

<template>
  <div class="bdiff">
    <div class="bdiff-counts" v-if="countsRow.length">
      <span class="chip" v-for="c in countsRow" :key="c.k"><i class="bd-dot" :class="c.k"></i>{{ c.label }} {{ c.n }}</span>
    </div>
    <div class="bdiff-empty sub" v-else>无内容差异（重复提交同一内容为零写入）。</div>

    <div class="bdiff-row" v-for="(it, i) in items" :key="i" :class="'op-' + it.op">
      <div class="bdiff-h">
        <span class="badge bd-op" :class="OP_META[it.op]?.cls || 'move'">{{ OP_META[it.op]?.label || it.op }}</span>
        <span class="chip bd-id" :title="'块锚点 ' + it.blockId">{{ it.blockId || '（新块）' }}</span>
        <span class="chip bd-moved" v-if="it.moved && it.op !== 'move'" title="内容不变，仅位置调整"><AppIcon name="arrow-up-down" :size="10" />位移</span>
      </div>
      <!-- edit：旧 → 新 两栏；delete：旧文删除线；insert/move：单栏 -->
      <div class="bdiff-pair" v-if="it.op === 'edit'">
        <div class="bd-old" v-if="it.oldText">{{ it.oldText }}</div>
        <div class="bd-new" v-if="it.newText">{{ it.newText }}</div>
      </div>
      <div class="bdiff-pair" v-else>
        <div class="bd-old" v-if="it.op === 'delete' && it.oldText">{{ it.oldText }}</div>
        <div class="bd-new" v-else-if="it.newText || it.op === 'move'">{{ it.newText || it.oldText }}</div>
      </div>
      <details class="bdiff-attrs" v-if="attrsChanged(it)">
        <summary>属性变化</summary>
        <div class="bd-attrs-body">
          <div class="bd-old" v-if="it.oldAttrs">{{ fmtAttrs(it.oldAttrs) }}</div>
          <div class="bd-new" v-if="it.newAttrs">{{ fmtAttrs(it.newAttrs) }}</div>
        </div>
      </details>
    </div>

    <!-- 软删块上的评论：不渲染块但信息不丢（§4.3）——diff 折叠区呈现 -->
    <details class="bdiff-dead" v-if="deletedComments && deletedComments.length">
      <summary>已删块上的评论（{{ deletedComments.length }} 条，块已删除、评论保留）</summary>
      <div class="bd-dead-row" v-for="c in deletedComments" :key="c.id">
        <span class="chip bd-id" :title="'原块 ' + c.blockId">{{ c.blockId }}</span>
        <b>{{ c.author || '匿名' }}</b>：{{ c.text }}
      </div>
    </details>
  </div>
</template>

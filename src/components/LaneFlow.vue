<script setup>
// 主流程泳道图（DESIGN-v5 §3/D6）：digest §5 flows 单表的另一 projection——role 首现序为泳道、
// 数组序为列序，i→i+1 连边（同道水平线 / 跨道折线）；gap 断点节点虚线橙样式（🤔）可点击：
// pids 有则直达工作台对应澄清题（v1.6 断点直达），无则降级原文定位（D18 不冒充）。
// 表格保留为「无图模式/复制导出」的降级形态（宿主折叠承载）。
import { computed } from 'vue'

const props = defineProps({ flows: { type: Array, default: () => [] } })
const emit = defineEmits(['locate', 'jump'])

const HEAD_W = 88, COL_W = 134, LANE_H = 98, TOP_PAD = 6, NODE_W = 120, NODE_H = 70, NODE_DY = 14

const lanes = computed(() => {
  const out = []
  for (const f of props.flows) {
    const r = f.role || '未命名'
    if (!out.includes(r)) out.push(r)
  }
  return out
})
const laneIdxOf = computed(() => {
  const m = {}
  lanes.value.forEach((r, i) => { m[r] = i })
  return r => m[r] || 0
})
const nodes = computed(() => props.flows.map((f, i) => ({
  f, i,
  x: HEAD_W + i * COL_W + 6,
  y: TOP_PAD + laneIdxOf.value(f.role || '未命名') * LANE_H + NODE_DY,
})))
const edges = computed(() => nodes.value.slice(0, -1).map((n, k) => {
  const m = nodes.value[k + 1]
  const y1 = n.y + NODE_H / 2
  const y2 = m.y + NODE_H / 2
  const x1 = n.x + NODE_W
  const x2 = m.x
  const d = y1 === y2
    ? `M ${x1} ${y1} H ${x2 - 2}`
    : `M ${x1} ${y1} H ${x1 + (x2 - x1) / 2} V ${y2} H ${x2 - 2}`
  return { d, gap: n.f.gap || m.f.gap }
}))
const svgW = computed(() => HEAD_W + props.flows.length * COL_W + 8)
const svgH = computed(() => TOP_PAD + lanes.value.length * LANE_H + 4)

function onNode(f) {
  if (!f.gap) return
  if ((f.pids || []).length) return emit('jump', { kind: 'check', id: f.pids[0] })   // v1.6 断点直达
  emit('locate', f.src, f.anchor)   // 降级：跳原文定位（不做无数据直达，D18）
}
</script>

<template>
  <div class="lane-wrap">
    <svg class="lane-svg" :viewBox="`0 0 ${svgW} ${svgH}`" :width="svgW" :height="svgH" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <marker id="lane-ah" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0 0L8 4L0 8z" fill="#cfd4dd" />
        </marker>
      </defs>
      <template v-for="(r, li) in lanes" :key="r">
        <rect class="lane-band" :class="{ alt: li % 2 }" x="0" :y="TOP_PAD + li * LANE_H" :width="svgW" :height="LANE_H" />
        <rect class="lane-head" x="0" :y="TOP_PAD + li * LANE_H" :width="HEAD_W - 6" :height="LANE_H" />
        <text class="lane-name" :x="(HEAD_W - 6) / 2" :y="TOP_PAD + li * LANE_H + LANE_H / 2 + 4" text-anchor="middle">{{ r }}</text>
      </template>
      <path v-for="(e, k) in edges" :key="k" class="lane-arrow" :class="{ gapout: e.gap }" :d="e.d" marker-end="url(#lane-ah)" />
      <foreignObject v-for="n in nodes" :key="n.i" :x="n.x" :y="n.y" :width="NODE_W" :height="NODE_H">
        <div class="node" :class="{ gap: n.f.gap }" :role="n.f.gap ? 'button' : undefined"
             :tabindex="n.f.gap ? 0 : undefined" :title="n.f.gap ? '原文未定义断点——点击定位' : n.f.step"
             @click="onNode(n.f)" @keydown.enter="onNode(n.f)">
          <span class="no">{{ n.i + 1 }}<template v-if="n.f.gap"> 🤔</template></span>
          <b>{{ n.f.step }}</b>
          <span class="src" v-if="n.f.src">{{ n.f.src }}</span>
        </div>
      </foreignObject>
    </svg>
  </div>
</template>

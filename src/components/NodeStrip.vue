<script setup>
// 七节点生命周期条（DESIGN-v2.4 D37，demo nodeStrip 移植）：st ∈ done|doing|todo
defineProps({ nodes: { type: Array, required: true } })
</script>

<template>
  <span class="node-strip">
    <template v-for="(n, i) in nodes" :key="i">
      <span class="nd" :class="n.st" :title="n.label + '：' + (n.st === 'done' ? '完成' : n.st === 'doing' ? '进行中' : '未开始')">{{ n.label }}</span>
      <span v-if="i < nodes.length - 1" class="nd-sep"></span>
    </template>
  </span>
</template>

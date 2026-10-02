<script setup>
// v2.2 长文导航：右侧吸顶目录（原始需求块结构 / 标准文档渲染后标题）。
// 点击 → 父组件滚动定位（复用 flash 协议）；activeId 高亮随滚动（父组件监听 scroll 计算）。
import AppIcon from './AppIcon.vue'
defineProps({
  items: { type: Array, default: () => [] },   // [{id, level, text}]
  activeId: { type: String, default: '' }
})
const emit = defineEmits(['go'])
</script>

<template>
  <nav class="toc-side" v-if="items.length">
    <div class="toc-side-t"><AppIcon name="list-tree" :size="12" />本页目录</div>
    <div class="toc-side-list">
      <a v-for="h in items" :key="h.id" class="toc-side-item"
         :class="['lv' + (h.level || 1), { on: h.id === activeId }]"
         :title="h.text" @click="emit('go', h.id)">{{ h.text }}</a>
    </div>
  </nav>
</template>

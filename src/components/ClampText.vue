<script setup>
// 长文本折叠：超阈值默认 CSS line-clamp 收起（DOM 常驻，追溯 needle/data-blk 定位不受影响），
// 「展开全文/收起」切换；跳转定位命中时由 trace.js 的 revealClamped 加 .pclamp-open 兜底展开
import { ref, computed } from 'vue'

const props = defineProps({
  html: { type: String, default: '' },          // 富文本模式（已 sanitize）
  text: { type: String, default: '' },          // 纯文本模式（{{ }} 插值，安全）
  lines: { type: Number, default: 4 },
  threshold: { type: Number, default: 170 }     // 纯文本长度超过此值才可折叠
})

const expanded = ref(false)
const plainLen = computed(() =>
  (props.html ? props.html.replace(/<[^>]+>/g, '') : props.text).length)
const isLong = computed(() => plainLen.value > props.threshold)
</script>

<template>
  <span class="clampwrap">
    <span class="clampbody" :class="{ pclamped: isLong && !expanded }"
          :style="isLong && !expanded ? { '--cl': lines } : null">
      <span v-if="html" v-html="html"></span>
      <template v-else>{{ text }}</template>
    </span>
    <button v-if="isLong" type="button" class="pmore" @click="expanded = !expanded">
      {{ expanded ? '收起' : '展开全文' }}
      <svg v-if="!expanded" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
    </button>
  </span>
</template>

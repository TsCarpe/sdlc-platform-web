<script setup>
// v4.20 页内图片灯箱：原始需求 image/画板缩略图/降级快照 md 图片的页内大图查看（替代新开窗口）。
// 适应窗口与 1:1 原始尺寸点击切换（1:1 舞台滚动看细节）、←→ 文档序翻图、Esc/遮罩关闭；
// 右上角保留「新窗口打开 / 下载」兜底出口（需要浏览器原生缩放或存图时不堵路）。
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import AppIcon from './AppIcon.vue'

const props = defineProps({
  list: { type: Array, required: true },    // [{url, caption}]
  index: { type: Number, required: true }   // v-model:index 当前图下标
})
const emit = defineEmits(['update:index', 'close'])

const cur = computed(() => props.list[props.index] || null)
const single = computed(() => props.list.length < 2)
const fit = ref(true)        // true=适应窗口；false=1:1 原始尺寸（舞台 overflow 滚动）
const loading = ref(true)    // 加载中（img onload 前压暗占位；缓存命中 onload 立即解除）

function step(d) {
  const n = props.index + d
  if (n < 0 || n >= props.list.length) return
  emit('update:index', n)
}
function close() { emit('close') }

function onKey(e) {
  if (e.key === 'Escape') { e.preventDefault(); close() }
  else if (e.key === 'ArrowLeft') step(-1)
  else if (e.key === 'ArrowRight') step(1)
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

watch(() => props.index, () => { fit.value = true; loading.value = true })
</script>

<template>
  <div class="iv-mask" @click.self="close" role="dialog" aria-modal="true" aria-label="图片查看">
    <div class="iv-top">
      <span class="iv-count" v-if="!single">{{ index + 1 }} / {{ list.length }}</span>
      <span class="spacer"></span>
      <a class="btn small" v-if="cur" :href="cur.url" target="_blank" rel="noopener"
         title="浏览器新窗口打开原图"><AppIcon name="external-link" :size="13" />新窗口</a>
      <a class="btn small" v-if="cur" :href="cur.url" download
         title="下载原图"><AppIcon name="download" :size="13" />下载</a>
      <button class="btn small" @click="close" title="关闭（Esc）"><AppIcon name="x" :size="13" />关闭</button>
    </div>
    <button class="iv-nav prev" v-if="!single" :disabled="index === 0" @click="step(-1)"
            aria-label="上一张"><AppIcon name="chevron-left" :size="22" /></button>
    <div class="iv-stage" :class="{ raw: !fit }" @click="fit = !fit"
         :title="fit ? '点击切换 1:1 原始尺寸' : '点击回到适应窗口'">
      <img v-if="cur" :key="cur.url" :src="cur.url" :alt="cur.caption"
           :class="{ loading }" @load="loading = false" @error="loading = false">
    </div>
    <button class="iv-nav next" v-if="!single" :disabled="index === list.length - 1" @click="step(1)"
            aria-label="下一张"><AppIcon name="chevron-right" :size="22" /></button>
    <div class="iv-cap" v-if="cur">
      <AppIcon name="image" :size="12" /><span class="iv-cap-txt">{{ cur.caption || '（无图注）' }}</span>
      <span class="iv-hint" v-if="!single">← → 翻图 · 点击图片切换尺寸 · Esc 关闭</span>
    </div>
  </div>
</template>

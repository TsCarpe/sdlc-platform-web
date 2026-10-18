<script setup>
// v4.20 页内图片灯箱：原始需求 image/画板缩略图/降级快照 md 图片的页内大图查看（替代新开窗口）。
// v5.2 交互修正（澄清侧栏浮窗体检三缺陷）：
// ① Teleport 挂 body——宿主 CtxPane 的 .ctx-card 是 sticky（总是创建层叠上下文），fixed 灯箱
//    被困其中整体按 z:auto 排序、被顶栏 topbar(z:20) 压制，工具条按钮全被盖住点不到（实测命中
//    .topbar/.topbar-toggle）——脱离宿主祖先后 z-index:220 直接在 root 上下文生效；
// ② 点击图片/遮罩空白=关闭（对齐通用灯箱肌肉记忆）；1:1 切换改由工具条按钮承载——高清原图
//    （3828px 实测）点击即巨幅放大曾是失控源；工具条 .spacer 补 flex:1 归位右上角；
// ③ 开箱锁定 body 滚动（滚轮不再连动背景页）；加载期占位提示；长图注默认 2 行折叠可展开。
// 适应窗口与 1:1 原始尺寸能力保留（←→ 文档序翻图、Esc/关闭按钮、新窗口/下载兜底出口不变）。
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import AppIcon from './AppIcon.vue'

const props = defineProps({
  list: { type: Array, required: true },    // [{url, caption}]
  index: { type: Number, required: true }   // v-model:index 当前图下标
})
const emit = defineEmits(['update:index', 'close'])

const cur = computed(() => props.list[props.index] || null)
const single = computed(() => props.list.length < 2)
const fit = ref(true)        // true=适应窗口；false=1:1 原始尺寸（舞台 overflow 滚动看细节）
const loading = ref(true)    // 加载中（img onload 前占位提示；缓存命中 onload 立即解除）
const capOpen = ref(false)   // 图注展开态（长 AI 图注默认 2 行折叠，点击图注切换）

function step(d) {
  const n = props.index + d
  if (n < 0 || n >= props.list.length) return
  emit('update:index', n)
}
function close() { emit('close') }

/** 灯箱内点击统一出口：交互件（工具条/翻图钮/图注）不关，其余（图片/遮罩空白）= 关闭 */
function onClick(e) {
  if (e.target.closest('.iv-top, .iv-nav, .iv-cap')) return
  close()
}

function onKey(e) {
  if (e.key === 'Escape') { e.preventDefault(); close() }
  else if (e.key === 'ArrowLeft') step(-1)
  else if (e.key === 'ArrowRight') step(1)
}
let savedPad = ''
onMounted(() => {
  window.addEventListener('keydown', onKey)
  // 锁定背景滚动（灯箱外滚轮不再连动页面），补偿滚动条宽度防布局抖动
  const sb = window.innerWidth - document.documentElement.clientWidth
  savedPad = document.body.style.paddingRight
  document.body.style.overflow = 'hidden'
  if (sb > 0) document.body.style.paddingRight = sb + 'px'
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  document.body.style.overflow = ''
  document.body.style.paddingRight = savedPad
})

watch(() => props.index, () => { fit.value = true; loading.value = true; capOpen.value = false })   // #22b：翻图重置图注展开态（长图注展开后翻图残留）
</script>

<template>
  <Teleport to="body">
    <div class="iv-mask" @click="onClick" role="dialog" aria-modal="true" aria-label="图片查看">
      <div class="iv-top">
        <span class="iv-count" v-if="!single">{{ index + 1 }} / {{ list.length }}</span>
        <span class="spacer"></span>
        <a class="btn small" v-if="cur" :href="cur.url" target="_blank" rel="noopener"
           title="浏览器新窗口打开原图"><AppIcon name="external-link" :size="13" />新窗口</a>
        <a class="btn small" v-if="cur" :href="cur.url" download
           title="下载原图"><AppIcon name="download" :size="13" />下载</a>
        <button class="btn small" @click="fit = !fit"
                :title="fit ? '切换 1:1 原始尺寸（舞台可滚动看细节）' : '回到适应窗口'">{{ fit ? '1:1' : '适应' }}</button>
        <button class="btn small iv-close" @click="close" title="关闭（Esc）"><AppIcon name="x" :size="13" />关闭</button>
      </div>
      <button class="iv-nav prev" v-if="!single" :disabled="index === 0" @click="step(-1)"
              aria-label="上一张"><AppIcon name="chevron-left" :size="22" /></button>
      <div class="iv-stage" :class="{ raw: !fit }">
        <div class="iv-loading" v-if="loading">图片加载中…</div>
        <img v-if="cur" :key="cur.url" :src="cur.url" :alt="cur.caption"
             :class="{ loading }" @load="loading = false" @error="loading = false">
      </div>
      <button class="iv-nav next" v-if="!single" :disabled="index === list.length - 1" @click="step(1)"
              aria-label="下一张"><AppIcon name="chevron-right" :size="22" /></button>
      <div class="iv-cap" v-if="cur">
        <AppIcon name="image" :size="12" />
        <span class="iv-cap-txt" :class="{ clamp: !capOpen }" :title="capOpen ? '收起图注' : '展开完整图注'"
              @click="capOpen = !capOpen">{{ cur.caption || '（无图注）' }}</span>
        <span class="iv-hint" v-if="!single">← → 翻图 · 点击图片或空白处关闭 · Esc 关闭</span>
      </div>
    </div>
  </Teleport>
</template>

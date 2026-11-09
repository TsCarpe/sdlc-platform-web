<script setup>
// v5.x HTML 附件全屏体验器（对齐飞书文档全屏预览）：
// 顶栏 = 退出 / 文件名·大小 / 安全提示 / 下载；舞台 = 满屏可交互 iframe。
// 安全（与服务端 media.py attachment 红线配套）：fetch 取文本 → iframe.srcdoc → sandbox，
// sandbox 故意不含 allow-same-origin → opaque origin，附件脚本读不到平台存储/写令牌；
// allow-scripts/forms/popups 保原型 demo 可交互（点击/表单/开窗链接）。
// srcdoc 而非 blob: URL——Safari/Firefox 对 sandboxed blob 导航会白屏，srcdoc 全浏览器可用。
// Esc/退出按钮关闭；开箱锁 body 滚动（同 ImgViewer 惯例）。
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import AppIcon from './AppIcon.vue'

const props = defineProps({
  url: { type: String, required: true },   // media 端点 URL（attachment 响应——只用于 fetch 取文本/下载）
  name: { type: String, default: '' },
  bytes: { type: Number, default: 0 }
})
const emit = defineEmits(['close'])

const htmlText = ref('')    // iframe 实际 srcdoc（attachment disposition 不能直接当 iframe src）
const failed = ref(false)
const sizeTxt = computed(() =>
  props.bytes >= 1048576 ? (props.bytes / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(props.bytes / 1024)) + ' KB')

function close() { emit('close') }
function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); close() } }

let savedPad = ''
onMounted(async () => {
  window.addEventListener('keydown', onKey)
  const sb = window.innerWidth - document.documentElement.clientWidth
  savedPad = document.body.style.paddingRight
  document.body.style.overflow = 'hidden'
  if (sb > 0) document.body.style.paddingRight = sb + 'px'
  try {
    const r = await fetch(props.url)
    if (!r.ok) throw new Error('http ' + r.status)
    htmlText.value = await r.text()
  } catch { failed.value = true }
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  document.body.style.overflow = ''
  document.body.style.paddingRight = savedPad
})
</script>

<template>
  <Teleport to="body">
    <div class="hv-mask" role="dialog" aria-modal="true" :aria-label="`HTML 演示预览：${name || '未命名'}`">
      <div class="hv-top">
        <button class="btn small hv-exit" @click="close" title="退出全屏体验（Esc）"><AppIcon name="x" :size="13" />退出</button>
        <AppIcon name="file-text" :size="15" class="hv-ico" />
        <span class="hv-name" :title="name">{{ name || 'HTML 演示' }}</span>
        <span class="hv-size">{{ sizeTxt }}</span>
        <span class="hv-warn"><AppIcon name="alert-triangle" :size="12" />文件内容非平台官方提供，切勿填写敏感信息</span>
        <span class="spacer"></span>
        <a class="btn small" :href="url" target="_blank" rel="noopener" title="下载原文件"><AppIcon name="download" :size="13" />下载</a>
      </div>
      <div class="hv-stage">
        <div v-if="failed" class="hv-loading">HTML 加载失败——可点右上角「下载」获取原文件</div>
        <div v-else-if="!htmlText" class="hv-loading">HTML 加载中…</div>
        <iframe v-else class="hv-frame" :srcdoc="htmlText" sandbox="allow-scripts allow-forms allow-popups"
                title="HTML 演示预览"></iframe>
      </div>
    </div>
  </Teleport>
</template>

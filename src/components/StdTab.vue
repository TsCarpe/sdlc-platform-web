<script setup>
// 标准需求文档 tab（AUDIT D6-2 拆分自 ReqDetail）：重写版定稿（D6），四类引用可点击（D7 事件委托）。
// fr/audit/check/asm/src 引用经 emit('jump') 上抛壳层（src 由壳层解析块锚后定位）；§ 章节引用文档内定位。
// 目录渲染后从 DOM 抽 h2/h3（marked 未产 id 时兜底补）；headEls 供壳层滚动高亮。
import { ref, computed, watch, onMounted } from 'vue'
import EmptyState from './EmptyState.vue'
import TocPane from './TocPane.vue'
import AppIcon from './AppIcon.vue'
import { render, linkifyRefs } from '../render.js'
import { flashEl, settle } from '../trace.js'

const props = defineProps({
  standard: { type: Object, default: null },
  activeHead: { type: String, default: '' }      // 壳层滚动高亮（目录侧栏）
})
const emit = defineEmits(['jump', 'go-toc', 'toast'])

const stdHtml = computed(() => (props.standard ? linkifyRefs(render(props.standard.markdown)) : ''))

const stdToc = ref([])
const stdBox = ref(null)
async function extractToc() {
  if (!stdHtml.value) { stdToc.value = []; return }
  await settle(60)
  const box = stdBox.value
  if (!box) return
  const hs = [...box.querySelectorAll('h2, h3')]
  hs.forEach((h, i) => { if (!h.id) h.id = 'stdh-' + i })
  stdToc.value = hs.map(h => ({ id: h.id, level: h.tagName === 'H2' ? 1 : 2, text: h.textContent.trim().slice(0, 46) }))
}
onMounted(extractToc)
watch(stdHtml, extractToc)

/** 当前目录标题元素序列（壳层 onScroll 高亮计算用） */
function headEls() { return stdBox.value ? [...stdBox.value.querySelectorAll('h2[id],h3[id]')] : [] }
defineExpose({ headEls })

/** 标准文档引用点击（事件委托，D7 四类引用） */
function stdRefClick(e) {
  const el = e.target.closest('.reflink')
  if (!el) return
  const idx = el.dataset.ref.indexOf(':')
  const kind = el.dataset.ref.slice(0, idx)
  const id = el.dataset.ref.slice(idx + 1)
  if (kind === 'sec') {
    // § 章节引用（评测 P2-6）：文档内标题号定位（标题通常为「7.2 xxx」不带 §），未命中诚实提示
    const want = id.replace(/^§/, '').replace(/\s+/g, '')
    const h = [...(stdBox.value?.querySelectorAll('h2,h3') || [])]
      .find(x => x.textContent.replace(/\s+/g, '').startsWith(want))
    if (h) flashEl(h)
    else emit('toast', `未定位到章节 ${id}：标准文档中没有以此开头的标题`, 'err')
  } else {
    // fr/audit/check/asm 走跳转协议；src 由壳层 resolveDocPath 解析块锚后 locate
    emit('jump', { kind, id })
  }
}
</script>

<template>
  <template v-if="standard">
    <div class="banner blue">
      <AppIcon name="file-text" :size="14" />
      <span>重写版定稿：以原始需求全文为底稿，整合体检定论与澄清答复——开发 / AI 读这一份即可获得需求全貌、边界与逻辑。全文 <b>FR / 体检.P / P / 需求.A</b> 引用可点击跳转。</span>
    </div>
    <div class="doc-layout">
      <div class="card doc" ref="stdBox" v-html="stdHtml" @click="stdRefClick"></div>
      <TocPane :items="stdToc" :active-id="activeHead" @go="emit('go-toc', $event)" />
    </div>
  </template>
  <EmptyState v-else icon="file-text" title="标准需求文档尚未发布"
              desc="澄清闭环后在流水线面板生成并发布标准需求文档" />
</template>

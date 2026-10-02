<script setup>
// 零依赖自定义下拉：替代原生 <select>（系统选项面板无法用 CSS 统一样式）。
// - 面板 fixed 定位（视口坐标），不进弹窗 overflow 容器，不被裁剪
// - searchable 时顶部带关键字过滤（大列表如关联需求 200+ 项）
// - 键盘：↑↓ 移动高亮、Enter 选中、Esc 关闭；点击面板外关闭
import { ref, computed, nextTick, onBeforeUnmount } from 'vue'
import AppIcon from './AppIcon.vue'

const props = defineProps({
  modelValue: { type: [String, Number], default: '' },
  options: { type: Array, required: true },   // [{ value, label }]
  placeholder: { type: String, default: '请选择…' },
  searchable: { type: Boolean, default: false },
  autofocus: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
  ariaLabel: { type: String, default: '' }
})
const emit = defineEmits(['update:modelValue', 'change'])

const open = ref(false)
const q = ref('')
const active = ref(-1)                        // 键盘高亮（指向 filtered 下标）
const btn = ref(null), panel = ref(null), searchInp = ref(null)
const style = ref({})

const filtered = computed(() => {
  const kw = q.value.trim().toLowerCase()
  return kw ? props.options.filter(o => o.label.toLowerCase().includes(kw)) : props.options
})
const current = computed(() => props.options.find(o => o.value === props.modelValue))

// 面板贴触发器下沿；下方空间不足且上方更宽裕时向上翻；高度随可用空间收缩
function place() {
  if (!btn.value) return
  const r = btn.value.getBoundingClientRect()
  const below = window.innerHeight - r.bottom
  const up = below < 250 && r.top > below
  style.value = {
    left: r.left + 'px', width: r.width + 'px',
    [up ? 'bottom' : 'top']: (up ? window.innerHeight - r.top + 6 : r.bottom + 6) + 'px',
    maxHeight: Math.min(320, (up ? r.top : below) - 14) + 'px'
  }
}
async function show() {
  if (props.disabled || open.value) return
  open.value = true
  q.value = ''
  active.value = Math.max(0, filtered.value.findIndex(o => o.value === props.modelValue))
  await nextTick()
  place()
  ;(props.searchable ? searchInp.value : panel.value)?.focus()
  window.addEventListener('scroll', place, true)   // 捕获阶段：任意滚动容器内面板跟随
  window.addEventListener('resize', place)
}
function toggle() { open.value ? close() : show() }
function close() {
  if (!open.value) return
  open.value = false
  window.removeEventListener('scroll', place, true)
  window.removeEventListener('resize', place)
}
function pick(o) {
  emit('update:modelValue', o.value)
  emit('change', o.value)
  close()
  btn.value?.focus()
}
function onKeydown(e) {
  if (e.key === 'Escape') { e.stopPropagation(); close(); btn.value?.focus(); return }
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Enter') return
  e.preventDefault()
  const n = filtered.value.length
  if (!n) return
  if (e.key === 'Enter') { if (filtered.value[active.value]) pick(filtered.value[active.value]); return }
  active.value = (active.value + (e.key === 'ArrowDown' ? 1 : -1) + n) % n
  nextTick(() => panel.value?.querySelector('.dd-opt.act')?.scrollIntoView({ block: 'nearest' }))
}
const onDocDown = e => { if (open.value && !e.target.closest('.dd')) close() }
document.addEventListener('mousedown', onDocDown, true)
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocDown, true)
  close()
})
if (props.autofocus) {
  // 弹窗打开后焦点落到触发器（对齐原 v-focus 行为：只聚焦不展开）
  nextTick(() => btn.value?.focus())
}
</script>

<template>
  <div class="dd" :class="{ open }">
    <button ref="btn" type="button" class="dd-ctrl" :disabled="disabled" :aria-label="ariaLabel"
            :aria-expanded="open" aria-haspopup="listbox" @click="toggle"
            @keydown="e => { if (e.key === 'ArrowDown') { e.preventDefault(); show() } }">
      <span class="dd-txt" :class="{ ph: !current }">{{ current ? current.label : placeholder }}</span>
    </button>
    <div v-if="open" ref="panel" class="dd-panel" :style="style" tabindex="-1" role="listbox" @keydown="onKeydown">
      <div v-if="searchable" class="dd-search">
        <input ref="searchInp" v-model="q" placeholder="输入关键字过滤…" @input="active = 0" @keydown="onKeydown">
      </div>
      <div class="dd-list">
        <div v-for="(o, i) in filtered" :key="o.value" class="dd-opt" role="option"
             :class="{ on: o.value === modelValue, act: i === active }"
             :aria-selected="o.value === modelValue"
             @mousedown.prevent @click="pick(o)" @mousemove="active = i">
          <span class="dd-lb">{{ o.label }}</span>
          <span v-if="o.value === modelValue" class="dd-ck"><AppIcon name="check-circle" :size="13" /></span>
        </div>
        <div v-if="!filtered.length" class="dd-empty">无匹配项</div>
      </div>
    </div>
  </div>
</template>

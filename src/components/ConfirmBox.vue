<script setup>
// v2.2 全局确认框渲染体（App.vue 根部挂载一次）：Esc / 遮罩 = 取消。
// 打开时抢焦点到「取消」（危险操作安全默认，review 修复）：后台控件（如编辑 textarea）里的
// Enter 不再误触确认——Enter 仅通过焦点按钮的原生激活生效（取消键上=取消，确认键上=确认）。
import { ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import AppIcon from './AppIcon.vue'
import { confirmState, settle } from '../confirm.js'

const s = confirmState()
const cancelBtn = ref(null)
watch(() => s.open, open => {
  if (open) nextTick(() => cancelBtn.value?.focus())
})
function onKey(e) {
  if (s.open && e.key === 'Escape') settle(false)
}
onMounted(() => document.addEventListener('keydown', onKey))
onBeforeUnmount(() => document.removeEventListener('keydown', onKey))
</script>

<template>
  <Teleport to="body">
    <div class="cb-mask" v-if="s.open" @click.self="settle(false)">
      <div class="cb-box" role="alertdialog" :aria-label="s.title">
        <div class="cb-title">
          <AppIcon :name="s.danger ? 'alert-triangle' : 'alert-circle'" :size="15" :style="{ color: s.danger ? 'var(--red-deep)' : 'var(--blue)' }" />
          {{ s.title }}
        </div>
        <div class="cb-body" v-if="s.body">{{ s.body }}</div>
        <div class="cb-btns">
          <button ref="cancelBtn" class="btn" @click="settle(false)">{{ s.cancelText }}</button>
          <button class="btn" :class="s.danger ? 'danger' : 'primary'" @click="settle(true)">{{ s.confirmText }}</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

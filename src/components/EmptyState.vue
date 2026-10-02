<script setup>
// 统一空态/错误态：图标 + 标题 + 说明 + 可选动作（slot），替代 emoji 空态与 colspan 文案
import AppIcon from './AppIcon.vue'

defineProps({
  icon: { type: String, default: 'inbox' },
  tone: { type: String, default: 'neutral' },   // neutral | error
  title: { type: String, required: true },
  desc: { type: String, default: '' }
})
</script>

<template>
  <div class="empty" :class="'tone-' + tone">
    <span class="empty-ico"><AppIcon :name="icon" :size="22" /></span>
    <div class="empty-t">{{ title }}</div>
    <div class="empty-d" v-if="desc">{{ desc }}</div>
    <div class="empty-a" v-if="$slots.default"><slot /></div>
  </div>
</template>

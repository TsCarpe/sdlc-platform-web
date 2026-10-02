<script setup>
// 目标仓只读 chips（设计 lane draft/final 阶段展示勘察范围；编辑态在 none 阶段的卡片式编辑器）
import AppIcon from './AppIcon.vue'

defineProps({ repos: { type: Array, default: () => [] } })
// 仓地址取末段做短名（路径/URL 皆适用），全地址进 chip 的 title
const shortRef = s => { const t = (s || '').replace(/\/+$/, ''); const i = t.lastIndexOf('/'); return i >= 0 ? t.slice(i + 1) : t }
</script>

<template>
  <div class="rp-readonly">
    <span class="sub">目标仓：</span>
    <span class="rp-chip" v-for="(r, i) in repos" :key="i"
          :title="`${r.role ? r.role + ' · ' : ''}${r.kind === 'github' ? 'GitHub' : '本地仓'} ${r.ref}${r.branch ? ' @' + r.branch : ''}`">
      <AppIcon :name="r.kind === 'github' ? 'github' : 'folder'" :size="11" />
      <b v-if="r.role">{{ r.role }}</b><span v-else class="sub">{{ r.kind === 'github' ? '远程' : '本地' }}</span>
      <i class="rp-sep">·</i><span class="mono">{{ shortRef(r.ref) }}</span>
      <span v-if="r.branch" class="sub">@{{ r.branch }}</span>
    </span>
  </div>
</template>

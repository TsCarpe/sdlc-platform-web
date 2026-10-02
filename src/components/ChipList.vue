<script setup>
// 受控密度 chips：默认只显示前 max 枚，溢出折叠为「+N」，点击在单元格内展开/收起
// 用途：用例表关联需求点、digest 功能点地图、需求点注册表「被用例覆盖」等一切可能爆量的 chips 列
import { ref, computed } from 'vue'

const props = defineProps({
  items: { type: Array, default: () => [] },
  max: { type: Number, default: 2 }
})

const expanded = ref(false)
const shown = computed(() => (expanded.value ? props.items : props.items.slice(0, props.max)))
const overflow = computed(() => Math.max(0, props.items.length - props.max))
</script>

<template>
  <span class="chiplist">
    <template v-for="it in shown" :key="it">
      <slot :item="it" />
    </template>
    <button v-if="overflow > 0" type="button" class="chip chip-more" @click.stop="expanded = !expanded">
      {{ expanded ? '收起' : '+' + overflow }}
    </button>
  </span>
</template>

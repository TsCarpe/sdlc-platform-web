<script setup>
// 体检报告 tab（AUDIT D6-2 拆分自 ReqDetail）：需求域分组（D4）+ 摘引 + 双向跳转（D5）。
// 出处定位与澄清/用例跳转经 emit 上抛壳层；折叠协议 inject 消费。
import AppIcon from './AppIcon.vue'
import EmptyState from './EmptyState.vue'
import { render } from '../render.js'
import { firstQuote, pidOf } from '../trace.js'
import { lvlLabel, lvlCls } from '../levels.js'
import { useGrpCollapse } from '../composables/group-collapse.js'

defineProps({
  audit: { type: Object, default: null },
  groups: { type: Array, default: () => [] }      // 壳层需求域分组（revealGrpFor 共用）
})
const emit = defineEmits(['locate', 'jump'])

const { openGrps, toggleGrp, expandAll, collapseAll } = useGrpCollapse()

function cnt(items, level) { return (items || []).filter(it => it.level === level).length }
</script>

<template>
  <EmptyState v-if="!audit" icon="inbox" title="体检报告尚未推送"
              desc="本地运行 sdlc-intent 产出体检报告后，由 sdlc-sync 推送至此" />
  <template v-else>
    <div class="stats inline lv-stats">
      <div class="stat lv-red" :class="{ zero: !(audit.content?.red > 0) }">
        <span class="stat-ico ti-red"><AppIcon name="alert-circle" :size="16" /></span>
        <div><div class="n">{{ audit.content?.red || 0 }}</div><div class="l">阻断</div></div>
      </div>
      <div class="stat lv-amber" :class="{ zero: !(audit.content?.yellow > 0) }">
        <span class="stat-ico ti-amber"><AppIcon name="alert-triangle" :size="16" /></span>
        <div><div class="n">{{ audit.content?.yellow || 0 }}</div><div class="l">存疑</div></div>
      </div>
      <div class="stat lv-blue" :class="{ zero: !(audit.content?.blue > 0) }">
        <span class="stat-ico ti-lvblue"><AppIcon name="info" :size="16" /></span>
        <div><div class="n">{{ audit.content?.blue || 0 }}</div><div class="l">建议</div></div>
      </div>
    </div>
    <div class="banner">
      <AppIcon name="info" :size="14" />
      <span>问题按需求域分组（与澄清清单同序，可对照阅读）；出处与摘引可定位到原始需求快照。</span>
      <span class="grp-tools-in">
        <button class="btn small link" @click="expandAll(groups)">全部展开</button>
        <button class="btn small link" @click="collapseAll()">全部收起</button>
      </span>
    </div>
    <div class="grp" v-for="g in groups" :key="g.name" :class="{ closed: !openGrps.has(g.name) }">
      <div class="grp-t" @click="toggleGrp(g.name)">
        <AppIcon name="chevron-right" :size="13" class="grp-chev" />{{ g.name }}
        <span class="cnt">{{ g.items.length }} 题<template v-for="lv in ['red', 'yellow', 'blue']" :key="lv"><span
          v-if="cnt(g.items, lv)" class="lv-pill" :class="lv"><i class="lvl-dot" :class="lv"></i>{{ lvlLabel[lv] }} {{ cnt(g.items, lv) }}</span></template></span>
      </div>
      <div class="grp-body"><div class="grp-inner">
      <div v-for="it in g.items" :key="it.id" class="check-item" :class="it.level" :data-pid="pidOf(it.id)">
        <div class="ci-head">
          <span class="badge" :class="lvlCls[it.level]">{{ lvlLabel[it.level] }}</span>
          <span class="chip">{{ it.id }}</span>
          <button class="jump-link" @click="emit('jump', { kind: 'check', id: pidOf(it.id) })">澄清 {{ pidOf(it.id) }}<AppIcon name="arrow-up-right" :size="11" /></button>
        </div>
        <div class="q">{{ it.title }}</div>
        <div class="ctx">出处：<a class="cite" :class="{ anchored: it.anchor }" @click="emit('locate', firstQuote(it.quote) || it.where, it.anchor)">{{ it.where }}<span v-if="it.anchor" class="anchored-mark" title="块级锚点：点击直达原文条款"><AppIcon name="crosshair" :size="10" /></span></a> ｜ 去向：{{ it.go || '—' }}</div>
        <blockquote class="quote" v-if="it.quote">
          <span class="qlb">原文摘引 · <a class="cite" :class="{ anchored: it.anchor }" @click="emit('locate', firstQuote(it.quote), it.anchor)">在快照中定位<span v-if="it.anchor" class="anchored-mark"><AppIcon name="crosshair" :size="10" /></span></a></span>{{ it.quote }}
        </blockquote>
        <div class="ctx" v-if="(it.relatedCases || []).length" style="margin-top:6px">
          关联用例：<a class="chip linklike real" v-for="c in it.relatedCases" :key="c" @click="emit('jump', { kind: 'case', id: c })">{{ c }}</a>
        </div>
      </div>
      </div></div>
    </div>
    <details class="card" v-if="audit.markdown">
      <summary style="cursor:pointer;font-size:13px;color:var(--muted)">查看体检报告原文（markdown）</summary>
      <div class="doc" style="margin-top:10px" v-html="render(audit.markdown)"></div>
    </details>
  </template>
</template>

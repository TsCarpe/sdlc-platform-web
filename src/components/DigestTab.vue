<script setup>
// 需求摘要 tab（AUDIT D6-2 拆分自 ReqDetail）：概述/角色/功能点地图/主流程/状态机/RTM/需求点注册表/摘要原文。
// 出处定位与跨域跳转经 emit 上抛壳层；折叠协议 inject 消费；mdBox 供壳层 asm 假设定位。
import { ref, computed } from 'vue'
import AppIcon from './AppIcon.vue'
import ClampText from './ClampText.vue'
import ChipList from './ChipList.vue'
import EmptyState from './EmptyState.vue'
import { render } from '../render.js'
import { covP, groupByFirstAppearance } from '../trace.js'
import { useGrpCollapse } from '../composables/group-collapse.js'

const props = defineProps({
  digest: { type: Object, default: null },
  frPoints: { type: Array, default: () => [] },
  coverage: { type: Object, default: null },
  frGroups: { type: Array, default: () => [] },        // 壳层按出处分组（revealGrpFor 共用）
  digestMdOpen: { type: Boolean, default: false }      // 摘要原文折叠（asm 跳入时壳层自动展开）
})
const emit = defineEmits(['locate', 'jump', 'update:digestMdOpen'])

const { openGrps, toggleGrp, expandAll, collapseAll } = useGrpCollapse()

const digestMdBox = ref(null)
const digestMdHtml = computed(() => render(props.digest?.markdown))

// ===== v2.3 流程/状态机上摘要（DESIGN-v2.3，payload v1.4）：flows 单表、states 按对象分组 =====
// 组名加「状态机·」前缀：openGrps 与 audit/checklist/fr 共享，防与 domains 组名撞名联动展开
const digestFlows = computed(() => props.digest?.content?.flows || [])
const digestStates = computed(() => props.digest?.content?.states || [])
const stateGroups = computed(() => groupByFirstAppearance(
  digestStates.value.map(s => ({ ...s, group: '状态机·' + (s.obj || '未命名') })), 'group'))

defineExpose({ mdBox: digestMdBox })

/** 功能点地图行 → 关联需求点 chips（D3 双向索引） */
function frByModule(m) {
  const key = String(m || '').replace('⭐ ', '')
  return props.frPoints.filter(f => f.module === key)
}
</script>

<template>
  <EmptyState v-if="!digest" icon="inbox" title="质检产物尚未推送"
              desc="本地运行 sdlc-intent 产出三件套后，由 sdlc-sync 推送至此" />
  <template v-else>
    <div class="card">
      <h3>需求概述</h3>
      <p class="summary"><ClampText :text="digest.content?.summary || ''" :lines="4" :threshold="140" /></p>
    </div>
    <div class="card" v-if="(digest.content?.roles || []).length">
      <h3>涉及角色</h3>
      <span class="chip" v-for="r in digest.content?.roles || []" :key="r">{{ r }}</span>
    </div>

    <div class="card" v-if="(digest.content?.features || []).length">
      <h3>功能点地图（⭐ 本次关注范围）</h3>
      <div class="tablewrap">
      <table class="table"><thead><tr>
        <th style="width:90px">角色</th><th style="width:150px">页面/模块</th><th style="min-width:280px">功能</th>
        <th style="width:120px">覆盖</th><th style="width:100px">出处</th><th style="width:140px">关联需求点</th>
      </tr></thead>
        <tbody><tr v-for="f in digest.content.features" :key="f.m" style="cursor:default">
          <td>{{ f.role }}</td><td>{{ f.m }}</td><td>{{ f.func }}</td>
          <td class="sub">{{ f.cov || '—' }}
            <a class="cite" style="margin-left:4px" v-if="covP(f.cov)" @click="emit('jump', { kind: 'audit', id: covP(f.cov) })">体检.{{ covP(f.cov) }} ↗</a>
          </td>
          <td class="sub"><a class="cite" :class="{ anchored: f.anchor }" v-if="f.src" @click="emit('locate', f.src, f.anchor)">{{ f.src }}<span v-if="f.anchor" class="anchored-mark" title="块级锚点：点击直达原文条款"><AppIcon name="crosshair" :size="10" /></span></a><span v-else>—</span></td>
          <td>
            <span class="sub" v-if="!frByModule(f.m).length">—</span>
            <ChipList v-else :items="frByModule(f.m).map(f2 => f2.id)" :max="2">
              <template #default="{ item }">
                <a class="chip linklike"
                   @click="emit('jump', { kind: 'fr', id: item })">{{ item.replace('需求.', '') }}</a>
              </template>
            </ChipList>
          </td>
        </tr></tbody>
      </table>
      </div>
    </div>

    <!-- v2.3 主流程投影（DESIGN-v2.3）：digest §5 步骤表，gap 行 = 原文 🤔 断点 -->
    <div class="card" v-if="digestFlows.length">
      <h3>主流程（§5 步骤投影；🤔 = 原文断点）</h3>
      <div class="tablewrap">
      <table class="table"><thead><tr>
        <th style="width:110px">角色</th><th style="min-width:220px">步骤</th><th style="width:150px">去向</th><th style="width:100px">出处</th>
      </tr></thead>
        <tbody><tr v-for="(f, i) in digestFlows" :key="i" :class="{ 'row-gap': f.gap }" style="cursor:default">
          <td>{{ f.role }}</td><td>{{ f.step }}</td>
          <td>{{ f.next }}<span v-if="f.gap" class="gapmark" title="原文未定义去向（🤔）"> 🤔</span></td>
          <td class="sub"><a class="cite" :class="{ anchored: f.anchor }" v-if="f.src" @click="emit('locate', f.src, f.anchor)">{{ f.src }}<span v-if="f.anchor" class="anchored-mark" title="块级锚点：点击直达原文条款"><AppIcon name="crosshair" :size="10" /></span></a><span v-else>—</span></td>
        </tr></tbody>
      </table>
      </div>
    </div>

    <!-- v2.3 状态机流转投影（DESIGN-v2.3）：digest §6 边表，按对象分组折叠，gap 行 = 原文 🤔 断点 -->
    <div class="card" v-if="digestStates.length">
      <h3>状态机流转（§6 边表投影，共 {{ digestStates.length }} 条）</h3>
      <div class="grp" v-for="g in stateGroups" :key="g.name" :class="{ closed: !openGrps.has(g.name) }">
        <div class="grp-t" @click="toggleGrp(g.name)">
          <AppIcon name="chevron-right" :size="13" class="grp-chev" />{{ g.name }}<span class="cnt">{{ g.items.length }} 条</span>
        </div>
        <div class="grp-body"><div class="grp-inner">
        <table class="table"><thead><tr>
          <th style="width:120px">从</th><th style="min-width:180px">触发</th><th style="width:120px">至</th><th style="width:100px">出处</th>
        </tr></thead>
          <tbody><tr v-for="(s, i) in g.items" :key="i" :class="{ 'row-gap': s.gap }" style="cursor:default">
            <td>{{ s.from }}</td><td>{{ s.on }}</td>
            <td>{{ s.to }}<span v-if="s.gap" class="gapmark" title="原文未定义去向（🤔）"> 🤔</span></td>
            <td class="sub"><a class="cite" :class="{ anchored: s.anchor }" v-if="s.src" @click="emit('locate', s.src, s.anchor)">{{ s.src }}<span v-if="s.anchor" class="anchored-mark" title="块级锚点：点击直达原文条款"><AppIcon name="crosshair" :size="10" /></span></a><span v-else>—</span></td>
          </tr></tbody>
        </table>
        </div></div>
      </div>
    </div>

    <!-- RTM 覆盖率（DESIGN-v2.2 D20）：正向 FR→用例 / 反向 用例→FR；「未登记」与「0%」诚实区分 -->
    <div class="card" v-if="coverage">
      <h3>用例覆盖（RTM）</h3>
      <div class="cov-stats">
        <span>需求点覆盖
          <b v-if="coverage.forward.total">{{ coverage.forward.covered }}/{{ coverage.forward.total }}
            <span class="sub">（{{ coverage.forward.pct }}%）</span></b>
          <b v-else class="sub">未登记需求点</b>
        </span>
        <span>用例追溯
          <b v-if="coverage.backward.total">{{ coverage.backward.linked }}/{{ coverage.backward.total }}
            <span class="sub">（{{ coverage.backward.pct }}%）</span></b>
          <b v-else class="sub">未登记用例</b>
        </span>
        <span v-if="coverage.forward.uncovered.length" class="sub">
          未覆盖 {{ coverage.forward.uncovered.length }} 条：
          <ChipList :items="coverage.forward.uncovered.map(u => u.id)" :max="6">
            <template #default="{ item }">
              <span class="chip linklike" :title="(coverage.forward.uncovered.find(u => u.id === item) || {}).name">{{ item.replace('需求.', '') }}</span>
            </template>
          </ChipList>
        </span>
      </div>
      <p class="cov-warn sub" v-if="coverage.danglingCases.length">
        ⚠ {{ coverage.danglingCases.length }} 条用例未挂需求点或引用了不存在的需求点（{{ coverage.danglingCases.join('、') }}）——无法反向追溯，请在用例页补挂或修正
      </p>
    </div>

    <div class="card">
      <h3>需求点注册表（按出处分组，共 {{ frPoints.length }} 条）</h3>
      <div class="grp-tools">
        <span class="sub">点组名展开 / 收起</span>
        <button class="btn small link" @click="expandAll(frGroups)">全部展开</button>
        <button class="btn small link" @click="collapseAll()">全部收起</button>
      </div>
      <div class="grp" v-for="g in frGroups" :key="g.name" :class="{ closed: !openGrps.has(g.name) }">
        <div class="grp-t" @click="toggleGrp(g.name)">
          <AppIcon name="chevron-right" :size="13" class="grp-chev" />{{ g.name }}<span class="cnt">{{ g.items.length }} 条</span>
        </div>
        <div class="grp-body"><div class="grp-inner">
        <table class="table"><thead><tr>
          <th style="width:140px">编号</th><th>名称/要点</th>
          <th style="width:140px">行级出处</th><th style="width:120px">归属模块</th><th style="width:170px">被用例覆盖</th>
        </tr></thead>
          <tbody><tr v-for="f in g.items" :key="f.id" style="cursor:default" :data-frid="f.id">
            <td><code>{{ f.id }}</code></td><td>{{ f.name }}</td>
            <td class="sub"><a class="cite" :class="{ anchored: f.anchor }" v-if="f.source" @click="emit('locate', f.source, f.anchor)">{{ f.source }}<span v-if="f.anchor" class="anchored-mark" title="块级锚点：点击直达原文条款"><AppIcon name="crosshair" :size="10" /></span></a><span v-else>—</span></td>
            <td class="sub">{{ f.module || '—' }}</td>
            <td>
              <span class="sub" v-if="!(f.coveredBy || []).length">—</span>
              <ChipList v-else :items="f.coveredBy" :max="2">
                <template #default="{ item }">
                  <a class="chip linklike" :class="{ real: !item.startsWith('WEB-') }"
                     @click="emit('jump', { kind: 'case', id: item })">{{ item }}</a>
                </template>
              </ChipList>
            </td>
          </tr></tbody>
        </table>
        </div></div>
      </div>
      <p class="sub" style="margin-top:8px">测试用例通过关联这些编号挂到需求点，构成追溯链；点用例编号直达用例详情。</p>
    </div>

    <details class="card" :open="digestMdOpen" v-if="digest.markdown">
      <summary style="cursor:pointer;font-size:13px;color:var(--muted)"
               @click.prevent="emit('update:digestMdOpen', !digestMdOpen)">查看摘要原文（markdown，含假设清单——「需求.Axx」引用的定位落点）</summary>
      <div class="doc" style="margin-top:10px" ref="digestMdBox" v-html="digestMdHtml"></div>
    </details>
  </template>
</template>

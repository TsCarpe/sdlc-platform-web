<script setup>
// 需求摘要 tab（AUDIT D6-2 拆分自 ReqDetail；DESIGN-v5 §3 重定位——摘要 = AI 理解了什么，
// 就绪度 = 哪里不清楚，工作台 = 把不清楚变清楚的地方）：AI 理解摘要卡（概述+角色+模块 chips）/
// 功能点地图/主流程泳道图（表格保留降级）/状态机/RTM/需求点注册表/遗留假设独立卡/摘要原文。
// 出处定位与跨域跳转经 emit 上抛壳层；折叠协议 inject 消费；mdBox 供壳层 asm 假设定位。
import { ref, computed } from 'vue'
import LaneFlow from './LaneFlow.vue'
import { isPending } from '../disposition.js'
import AppIcon from './AppIcon.vue'
import ClampText from './ClampText.vue'
import ChipList from './ChipList.vue'
import EmptyState from './EmptyState.vue'
import { api } from '../api.js'
import { ask } from '../confirm.js'
import { render } from '../render.js'
import { covP, groupByFirstAppearance } from '../trace.js'
import { useGrpCollapse } from '../composables/group-collapse.js'

const props = defineProps({
  digest: { type: Object, default: null },
  frPoints: { type: Array, default: () => [] },
  coverage: { type: Object, default: null },
  frGroups: { type: Array, default: () => [] },        // 壳层按出处分组（revealGrpFor 共用）
  digestMdOpen: { type: Boolean, default: false },     // 摘要原文折叠（asm 跳入时壳层自动展开）
  items: { type: Array, default: () => [] },           // v5 澄清 items（模块待澄清角标——v1.6 module 产出前降级隐藏）
  commentAnchorMap: { type: Object, default: () => ({}) },  // v5.x 评论锚 → 面板定位目标（图标语义分流；点击分流在壳层 onLocate）
  draft: { type: Object, default: null }               // v5.x 批2：质检三件套草稿行（digest 采纳前本页签承载预览与采纳）
})
const emit = defineEmits(['locate', 'jump', 'update:digestMdOpen', 'toast', 'refresh', 'reload'])

// ===== v5.x 批2：质检三件套草稿域（迁自 TaskPanel，确认文案原样） =====
const busy = ref(false)
const showDigestDraft = ref(true)   // 草稿预览默认展开——草稿态本页签的主内容就是它
/** 草稿统计：解析 contentJson（原 TaskPanel 逻辑；坏值静默无统计） */
const draftStats = computed(() => {
  const out = []
  try {
    const p = JSON.parse(props.draft?.contentJson || '{}')
    out.push(['澄清问题', (p.items || []).length], ['需求点', (p.digest?.fr_points || []).length])
    if (p.snapshot?.md) out.push(['快照', Math.round(p.snapshot.md.length / 1024) + 'KB'])
    if (p.doc) out.push(['原文块', (p.doc.blocks || []).length], ['媒体', (p.doc.media || []).length])
    if (p.audit) out.push(['体检问题', (p.audit.items || []).length])
  } catch { /* contentJson 坏值 → 无统计 */ }
  return out
})
const draftHtml = computed(() => {
  try {
    const p = JSON.parse(props.draft?.contentJson || '{}')
    return render(p.digest?.md || props.draft?.md || '')
  } catch { return '' }
})
async function approveDigest() {
  if (!await ask({
    title: '采纳质检三件套草稿？',
    body: '采纳后进入「待澄清」，PM 可在平台上作答。（重推将按 P 编号保留已答内容）',
    confirmText: '采纳'
  })) return
  busy.value = true
  try {
    const r = await api.post(`/api/requirements/${props.draft.reqId}/drafts/digest_bundle/approve`)
    emit('toast', `已采纳：${r.items} 问 / ${r.frPoints} 需求点${r.carriedAnswers ? `，保留答复 ${r.carriedAnswers} 条` : ''}`)
    emit('refresh')
  } catch (e) { emit('toast', '采纳失败：' + e.message, 'err') }
  finally { busy.value = false }
}
async function dropDigest() {
  if (!await ask({ title: '丢弃质检三件套草稿？', body: '丢弃后如需该产物须重新质检。', danger: true, confirmText: '丢弃' })) return
  try { await api.del(`/api/requirements/${props.draft.reqId}/drafts/digest_bundle`); emit('toast', '草稿已丢弃'); emit('reload') }
  catch (e) { emit('toast', '丢弃失败：' + e.message, 'err') }
}

/** v5.x 评论锚判定：fr/features/flows/states 出处可为评论区（resolve_anchors 产评论锚）——
 *  cite 图标换 message-square，点击经壳层 onLocate 分流开评论面板 */
const isCmtAnchor = anchor => props.commentAnchorMap[anchor] != null

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

// ===== v5 摘要重定位（§3，D9/D18）=====
/** 模块 chips 数据：fr_points[].module 聚合去重（首现序） */
const modules = computed(() => {
  const out = []
  for (const f of props.frPoints) {
    if (f.module && !out.includes(f.module)) out.push(f.module)
  }
  return out
})
/** 模块待澄清数（依赖 v1.6 items[].module——字段缺失整体隐藏角标，降级不冒充 D18） */
const modulePend = computed(() => {
  if (!props.items.some(it => it.module)) return null
  const m = {}
  for (const it of props.items) {
    if (it.module && isPending(it)) m[it.module] = (m[it.module] || 0) + 1
  }
  return m
})
/** 遗留假设独立卡数据：从摘要 markdown 提出（D9——折叠 md 保留，asm 跳转协议依赖）。
 *  两种产物形态兼容：①sdlc-intent §8 假设清单表格行 |A1| 出处 | 内容 | 类型 | 依据|；
 *  ②列表/段落行「需求.A01：文本」。编号统一按命名空间展示为 需求.Axx。 */
const assumptions = computed(() => {
  const out = []
  for (const ln of String(props.digest?.markdown || '').split('\n')) {
    const t = ln.match(/^\|\s*(?:需求\.)?A(\d+)\s*\|([^|]*)\|([^|]*)\|/)
    if (t) { out.push({ id: '需求.A' + t[1], src: t[2].trim(), text: t[3].trim() }); continue }
    const m = ln.match(/^\s*(?:[-*•]\s*)?(需求\.A\d+)\s*[：:]\s*(.+)$/)
    if (m) out.push({ id: m[1], src: '', text: m[2].trim() })
  }
  return out
})
</script>

<template>
  <!-- v5.x 批2：质检三件套草稿态（迁自 TaskPanel）——digest 采纳前本页签即预览与采纳现场 -->
  <template v-if="draft && !digest">
    <div class="draftbar">
      <span class="badge b-amber">待确认</span><b>质检三件套草稿</b>
      <span class="chip" v-for="[k, v] in draftStats" :key="k">{{ k }} {{ v }}</span>
      <span class="tp-act">
        <button class="btn small danger" :disabled="busy" @click="dropDigest">丢弃</button>
        <button class="btn primary" :disabled="busy" @click="approveDigest"><AppIcon name="check-circle" :size="13" />采纳（进入待澄清）</button>
      </span>
    </div>
    <details class="tp-peek" :open="showDigestDraft" @toggle="showDigestDraft = $event.target.open">
      <summary>摘要正文预览（采纳前可核对）</summary>
      <div class="doc tp-preview" v-html="draftHtml"></div>
    </details>
  </template>
  <EmptyState v-else-if="!digest" icon="inbox" title="质检产物尚未推送"
              desc="质检完成后草稿会回到本页签采纳；或本地 sdlc-intent 产出三件套后由 sdlc-sync 推送" />
  <template v-else>
    <!-- v5 AI 理解摘要卡（§3/D9）：先花 10 秒校验 AI 把需求理解成了什么样——偏了立刻能感知 -->
    <div class="card und-card">
      <h3>AI 理解摘要 <span class="sub">先花 10 秒校验：AI 把你的需求理解成了什么样——偏了立刻能感知</span></h3>
      <p class="summary"><ClampText :text="digest.content?.summary || ''" :lines="5" :threshold="140" /></p>
      <div class="chiprow" v-if="(digest.content?.roles || []).length">
        <span class="lb">角色</span>
        <span class="rolechip" v-for="r in digest.content?.roles || []" :key="r">{{ r }}</span>
      </div>
      <div class="chiprow" v-if="modules.length">
        <span class="lb">模块</span>
        <span class="mchip" v-for="m in modules" :key="m"
              :title="modulePend && modulePend[m] ? m + '：' + modulePend[m] + ' 题待澄清（到澄清工作台处置）' : '模块归属（fr_points[].module）'"
              :class="{ hot: !!(modulePend && modulePend[m]) }">{{ m }} <span class="b" v-if="modulePend && modulePend[m]">{{ modulePend[m] }}</span></span>
      </div>
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
          <td class="sub"><a class="cite" :class="{ anchored: f.anchor }" v-if="f.src" @click="emit('locate', f.src, f.anchor)">{{ f.src }}<span v-if="isCmtAnchor(f.anchor)" class="anchored-mark" title="出处为评论区——点击在评论面板查看"><AppIcon name="message-square" :size="10" /></span><span v-else-if="f.anchor" class="anchored-mark" title="块级锚点：点击直达原文条款"><AppIcon name="crosshair" :size="10" /></span></a><span v-else>—</span></td>
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

    <!-- v5 主流程泳道图（§3/D6）：flows 的另一 projection——角色泳道/时序流动/🤔 虚线断点节点
         （点击直达对应澄清，pids 降级原文定位）；表格保留为「无图模式/复制导出」降级形态 -->
    <div class="card" v-if="digestFlows.length">
      <h3>主流程泳道 <span class="sub">🤔 虚线节点 = 原文未定义断点，点击定位对应澄清</span></h3>
      <LaneFlow :flows="digestFlows" @locate="(s, a) => emit('locate', s, a)" @jump="j => emit('jump', j)" />
      <details style="margin-top:8px">
        <summary style="cursor:pointer;font-size:12px;color:var(--muted)">表格视图（无图模式 / 复制导出）</summary>
        <div class="tablewrap" style="margin-top:8px">
        <table class="table"><thead><tr>
          <th style="width:110px">角色</th><th style="min-width:220px">步骤</th><th style="width:150px">去向</th><th style="width:100px">出处</th>
        </tr></thead>
          <tbody><tr v-for="(f, i) in digestFlows" :key="i" :class="{ 'row-gap': f.gap }" style="cursor:default">
            <td>{{ f.role }}</td><td>{{ f.step }}</td>
            <td>{{ f.next }}<span v-if="f.gap" class="gapmark" title="原文未定义去向（🤔）"> 🤔</span></td>
            <td class="sub"><a class="cite" :class="{ anchored: f.anchor }" v-if="f.src" @click="emit('locate', f.src, f.anchor)">{{ f.src }}<span v-if="isCmtAnchor(f.anchor)" class="anchored-mark" title="出处为评论区——点击在评论面板查看"><AppIcon name="message-square" :size="10" /></span><span v-else-if="f.anchor" class="anchored-mark" title="块级锚点：点击直达原文条款"><AppIcon name="crosshair" :size="10" /></span></a><span v-else>—</span></td>
          </tr></tbody>
        </table>
        </div>
      </details>
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
            <td class="sub"><a class="cite" :class="{ anchored: s.anchor }" v-if="s.src" @click="emit('locate', s.src, s.anchor)">{{ s.src }}<span v-if="isCmtAnchor(s.anchor)" class="anchored-mark" title="出处为评论区——点击在评论面板查看"><AppIcon name="message-square" :size="10" /></span><span v-else-if="s.anchor" class="anchored-mark" title="块级锚点：点击直达原文条款"><AppIcon name="crosshair" :size="10" /></span></a><span v-else>—</span></td>
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
            <td class="sub"><a class="cite" :class="{ anchored: f.anchor }" v-if="f.source" @click="emit('locate', f.source, f.anchor)">{{ f.source }}<span v-if="isCmtAnchor(f.anchor)" class="anchored-mark" title="出处为评论区——点击在评论面板查看"><AppIcon name="message-square" :size="10" /></span><span v-else-if="f.anchor" class="anchored-mark" title="块级锚点：点击直达原文条款"><AppIcon name="crosshair" :size="10" /></span></a><span v-else>—</span></td>
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

    <!-- v5 遗留假设独立卡（§3/D9）：从摘要 markdown 提出——合成标准文档时写入 需求.Axx；
         点击走 asm 协议定位折叠 md 原文（折叠保留，协议依赖） -->
    <div class="card" v-if="assumptions.length">
      <h3>遗留假设 <span class="sub">合成标准文档时将写入 需求.Axx 条目</span></h3>
      <div class="asm-item" v-for="a in assumptions" :key="a.id">
        <code>{{ a.id }}</code>
        <span class="asm-txt">{{ a.text }}<span class="sub" v-if="a.src" style="margin-left:6px">（{{ a.src }}）</span></span>
        <button class="btn small link" title="在摘要原文中定位该假设" @click="emit('jump', { kind: 'asm', id: a.text.slice(0, 16) })">原文 ↗</button>
      </div>
    </div>

    <details class="card" :open="digestMdOpen" v-if="digest.markdown">
      <summary style="cursor:pointer;font-size:13px;color:var(--muted)"
               @click.prevent="emit('update:digestMdOpen', !digestMdOpen)">查看摘要原文（markdown，含假设清单——「需求.Axx」引用的定位落点）</summary>
      <div class="doc" style="margin-top:10px" ref="digestMdBox" v-html="digestMdHtml"></div>
    </details>
  </template>
</template>

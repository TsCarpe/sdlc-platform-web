<script setup>
// 原始需求 tab（AUDIT D6-2 拆分自 ReqDetail）：全文快照（D1）——v1.2 有块结构时结构化渲染
// （不堆叠/图片/锚点），否则 md 渲染降级；无快照时按来源降级（飞书外链 / 粘贴文本）。
// 目录点击经 emit 上抛壳层 locate 协议；box/headEls 供壳层 needle 定位与滚动高亮。
// v4 窗口 1（未发布卡）：块级直接编辑——BlockEditor（方案 C）+ 保存流（POST blocks/diff 预览 →
// PUT blocks → 壳层重拉 doc.json 刷新锚点）；保存后提示「质检已过期」可一键重新质检。
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import DocBlock from './DocBlock.vue'
import AppIcon from './AppIcon.vue'
import TocPane from './TocPane.vue'
import BlockEditor from './BlockEditor.vue'
import BlockDiff from './BlockDiff.vue'
import ImgViewer from './ImgViewer.vue'
import { api } from '../api.js'
import { ask } from '../confirm.js'
import { isTerminalReason, taskFailReason } from '../task-reasons.js'
import { render, inlineHtml } from '../render.js'
import { fmtRel } from '../time.js'
import { useDocStructure } from '../composables/doc-structure.js'

const props = defineProps({
  card: { type: Object, required: true },        // sourceType/sourceUrl/sourceText/id/status
  snapshot: { type: Object, default: null },
  doc: { type: Object, default: null },
  docStale: { type: Boolean, default: false },   // v4.19 服务端机械判定：块表最后编辑 > digest 最近推送
  activeHead: { type: String, default: '' },     // 壳层滚动高亮（目录侧栏）
  platformByBlock: { type: Object, default: () => ({}) },  // v4 blockId → 平台评论数（角标）
  pendingByBlock: { type: Object, default: () => ({}) }    // v5 §4 blockId → 待澄清 seq[]（反向角标）
})
const emit = defineEmits(['locate', 'go-toc', 'toast', 'reload', 'open-comments', 'clarify'])

const snapshotBox = ref(null)            // 快照渲染容器（needle 定位，expose 给壳）
const tocOpen = ref(false)

const snapshotHtml = computed(() => render(props.snapshot?.md))

// ===== v1.2 原文块结构（doc）：结构化渲染 + 锚点直达（v5 抽 useDocStructure，与工作台侧栏共享同源计算） =====
// 第三参：待澄清 + 平台评论锚点宿主块 map——命中行回落行卡（pill/评论角标宿主不进矩阵表）；
// spread 迭代两 map 的 key，评论异步装载换新对象时分区响应式重算
const { docData, docBlocks, childrenByParent, partitionedSections, docToc, mediaList } =
  useDocStructure(() => props.doc, () => props.card.id,
    () => ({ ...props.pendingByBlock, ...props.platformByBlock }))

/** 当前目录标题元素序列（壳层 onScroll 高亮计算用） */
function headEls() {
  return docToc.value.map(h => document.querySelector(`[data-blk="${h.id}"]`)).filter(Boolean)
}
defineExpose({ box: snapshotBox, headEls })
const viewerList = ref([])    // 灯箱当前列表（块结构 = mediaList；降级快照 = 点击时构造的单图）
const viewerIdx = ref(-1)     // -1 = 关闭
function openViewer(list, idx) { viewerList.value = list; viewerIdx.value = idx }
/** 块图片/画板点击（DocBlock 逐层上抛块 id）→ 按文档序定位下标开灯箱 */
function onDocMedia(id) {
  const i = mediaList.value.findIndex(m => m.id === id)
  if (i >= 0) openViewer(mediaList.value, i)
}
/** 降级快照 md 直渲：容器点击委托——点到 img 即单图灯箱（v-html 内无法绑组件事件） */
function onSnapClick(e) {
  const img = e.target.closest('img')
  if (img?.src) openViewer([{ url: img.src, caption: img.alt || '' }], 0)
}

// ===== v4 建卡自动导入可见性（降级态专用）：无块无快照时轮询 source_import 最新任务——
// 该任务不在流水线主三段展示，失败曾在页面无任何出口；导入中/失败就地提示 + 失败重试。
// 完成→块落库的刷新由 TaskPanel 轮询 emit refresh 壳层重拉 doc 驱动，此处仅降态期间轮询 =====
const importTask = ref(null)
const importing = computed(() => !docData.value && !props.snapshot)
async function loadImportTask() {
  try {
    const list = await api.get(`/api/tasks?req_id=${props.card.id}`)
    importTask.value = list.find(t => t.type === 'source_import') || null   // 列表 id 倒序，首个即最新
  } catch { /* 拉取失败保旧态，下轮补齐 */ }
}
const importFail = computed(() => {
  if (!importTask.value || importTask.value.status !== 'failed') return null
  try { return JSON.parse(importTask.value.result || '{}') } catch { return {} }
})
// N-1：封存/生命周作废的导入失败为终局——后端 retry 会 409，不再展示重试按钮
const importTerminal = computed(() =>
  isTerminalReason(importFail.value?.reason || taskFailReason(importTask.value)))
async function retryImport() {
  try {
    await api.post(`/api/tasks/${importTask.value.id}/retry`)
    emit('toast', '原文导入已重新排队')
    loadImportTask()
  } catch (e) { emit('toast', '重试失败：' + e.message, 'err') }
}
let importTimer = null
watch(importing, v => {
  clearInterval(importTimer)
  if (v) { loadImportTask(); importTimer = setInterval(loadImportTask, 5000) }
}, { immediate: true })
onBeforeUnmount(() => clearInterval(importTimer))

// ===== v4 窗口 1：块级直接编辑（未发布卡；changed 关闭走变更单） =====
const canEdit = computed(() =>
  ['submitted', 'reviewing', 'clarifying'].includes(props.card.status) && !!docData.value)
const editing = ref(false)
const saving = ref(false)
const editorRef = ref(null)
const diffPreview = ref(null)     // {items, counts} —— 保存预览弹层
const staleCheck = ref(false)     // 保存成功后「质检已过期」横幅（会话内即时提示）
// v4.19 持久脱节横幅：docStale（服务端判定，刷新/重进不失忆）∨ staleCheck（保存后空窗补位）。
// 忽略 = 本会话静默（dismissed），刷新后 docStale 仍真则横幅回归——持久提醒但不阻断；
// changed 态不显示（digest 落后块态属增量流程中间态，走变更单引导，且重新质检在 changed 被 409）
const staleDismissed = ref(false)
const staleBanner = computed(() =>
  (props.docStale || staleCheck.value) && !staleDismissed.value && !editing.value
  && props.card.status !== 'changed')
const op = ref(localStorage.getItem('sdlc.op') || '')

// diff 预览弹层 Esc 关闭（随开关挂摘监听）
function onDiffKey(e) { if (e.key === 'Escape') diffPreview.value = null }
watch(diffPreview, v => {
  if (v) document.addEventListener('keydown', onDiffKey)
  else document.removeEventListener('keydown', onDiffKey)
})
onBeforeUnmount(() => document.removeEventListener('keydown', onDiffKey))

function requireOp() {
  if (!op.value.trim()) { emit('toast', '请先填写操作人（编辑留痕必填）', 'err'); return false }
  return true
}
const editBaseRev = ref(0)   // 编辑会话基线（P2-3 乐观锁）：进编辑时取 contentRev，保存时携带
function startEdit() {
  if (!canEdit.value) return
  editBaseRev.value = props.card.contentRev || 0
  editing.value = true
}
async function cancelEdit() {
  if (editorRef.value?.isDirty() && !await ask({
    title: '放弃未保存的编辑？', body: '本地改动将丢失（服务端块表未受影响）。', danger: true, confirmText: '放弃改动'
  })) return
  editing.value = false
}
function payloadOrToast() {
  const r = editorRef.value?.getPayload()
  if (!r || !r.ok) {
    const p = r?.problems?.[0]
    emit('toast', '本地校验未通过：' + (p ? p.msg : '未知问题') + (r?.problems?.length > 1 ? `（共 ${r.problems.length} 处，已在原文中标出）` : ''), 'err')
    return null
  }
  return r.blocks
}
async function previewSave() {
  if (!requireOp()) return
  const blocks = payloadOrToast()
  if (!blocks) return
  saving.value = true
  try {
    const r = await api.post(`/api/requirements/${props.card.id}/blocks/diff`, { updatedBy: op.value.trim(), blocks })
    if (!r.items.length) { emit('toast', '无内容变更（与服务端块表一致）'); return }
    diffPreview.value = r
  } catch (e) { emit('toast', e.message, 'err') } finally { saving.value = false }
}
async function confirmSave() {
  if (!requireOp()) { diffPreview.value = null; return }
  const blocks = payloadOrToast()
  if (!blocks) { diffPreview.value = null; return }
  saving.value = true
  try {
    const r = await api.put(`/api/requirements/${props.card.id}/blocks`,
      { updatedBy: op.value.trim(), blocks, baseContentRev: editBaseRev.value })
    localStorage.setItem('sdlc.op', op.value.trim())
    diffPreview.value = null
    editing.value = false
    const c = r.counts || {}
    emit('toast', `原文已保存：变更 ${c.edit || 0} · 新增 ${c.insert || 0} · 删除 ${c.delete || 0} · 移动 ${c.move || 0}（锚点已刷新）`)
    staleCheck.value = true
    emit('reload')   // 壳层重拉：insert 块拿到服务端 blk- ID，本地锚点不漂移
  } catch (e) { emit('toast', e.message, 'err') } finally { saving.value = false }
}
/** 编辑后重新质检（无专用端点——人工创建 quality_check 即重新质检）；
 *  成功后本会话静默横幅（产物待推送期间脱节仍真，docStale 随质检推送自然转 false） */
async function rerunCheck() {
  try {
    await api.post(`/api/requirements/${props.card.id}/tasks`, { type: 'quality_check', note: '原文编辑后重新质检' })
    staleCheck.value = false
    staleDismissed.value = true
    emit('toast', '重新质检任务已排队（可在流水线面板查看进度）')
  } catch (e) { emit('toast', e.message, 'err') }
}
</script>

<template>
  <!-- v4 块表权威：有块结构即结构化渲染（不依赖 snapshot 产物——source_import 直导卡无快照） -->
  <template v-if="docData">
    <!-- v4 飞书冻结提示（§11.5）：块表权威后飞书侧评论不再同步 -->
    <div class="banner" v-if="card.sourceType === 'feishu'">
      <AppIcon name="lock" :size="14" />
      <span>原文已迁入平台（块表权威）：平台内讨论请用评论与澄清；<a v-if="card.sourceUrl" :href="card.sourceUrl" target="_blank" rel="noopener">飞书侧</a>后续新增评论不再同步。</span>
    </div>
    <div class="banner blue snap-bar" v-if="snapshot">
      <AppIcon name="clock" :size="14" />
      <span>快照 <b class="num" :title="snapshot.at">{{ fmtRel(snapshot.at) }}</b> · 本快照是质检与澄清的<b>依据版本</b></span>
      <span>最新修订以<a v-if="card.sourceUrl" :href="card.sourceUrl" target="_blank" rel="noopener">飞书文档 ↗</a><span v-else>原始来源</span>为准</span>
      <span class="sub">重推产物时快照同步刷新；发布后冻结</span>
    </div>
    <!-- 质检过期提示（§4 P0：重新质检入口；v4.19 持久化——服务端 docStale 判定，刷新不失忆） -->
    <div class="banner amber-t" v-if="staleBanner">
      <AppIcon name="alert-triangle" :size="14" />
      <span style="flex:1">原文已修改：既有质检产物与澄清清单基于旧版本块集，建议重新质检让产物锚定新块。</span>
      <button class="btn small primary" @click="rerunCheck"><AppIcon name="refresh-cw" :size="12" />重新质检</button>
      <button class="btn small link" @click="staleDismissed = true">忽略</button>
    </div>
    <div class="doc-layout">
    <div class="card doc docstruct" ref="snapshotBox">
      <!-- changed：直接编辑关闭（引导走变更单通道） -->
      <div class="banner amber-t" v-if="card.status === 'changed'" style="margin-bottom:10px">
        <AppIcon name="alert-triangle" :size="14" />
        <span>原文处于<b>变更中（changed）</b>：直接编辑已关闭——内容修改请通过变更单 draft 进行（confirm 后生效）。</span>
      </div>
      <div class="edit-tools" v-if="canEdit && !editing">
        <button class="btn small" @click="startEdit"><AppIcon name="pencil" :size="12" />编辑原文</button>
      </div>
      <!-- 编辑模式：顶条（操作人 + 保存/取消）+ 块级编辑器 -->
      <template v-if="editing">
        <div class="bedit-topbar">
          <span class="lbl"><AppIcon name="pencil" :size="12" />编辑原文（窗口 1 · 保存即生效）</span>
          <span class="lbl">操作人</span>
          <input type="text" v-model="op" name="edit-op" placeholder="手填身份（留痕）" @keydown.enter="previewSave">
          <span class="spacer"></span>
          <button class="btn" :disabled="saving" @click="cancelEdit">取消</button>
          <button class="btn primary" :disabled="saving" @click="previewSave">
            <AppIcon name="check-circle" :size="13" />{{ saving ? '处理中…' : '保存（先预览差异）' }}</button>
        </div>
        <BlockEditor ref="editorRef" :req-id="card.id" :blocks="docBlocks"
                     @error="e => emit('toast', e.message, 'err')" @view-media="onDocMedia" />
      </template>
      <!-- 阅读模式：目录 + 章节分组渲染 -->
      <template v-else>
        <details class="toc" v-if="docToc.length" :open="tocOpen">
          <summary @click="tocOpen = !tocOpen">
            <AppIcon name="list-tree" :size="13" />文档导航（{{ docToc.length }} 个条目，点击滚动定位）
          </summary>
          <div class="toc-list">
            <a v-for="h in docToc" :key="h.id" class="toc-item" :class="'lv' + (h.level || 1)"
               @click="emit('locate', '', h.id)">{{ h.text }}</a>
          </div>
        </details>
        <!-- 章节分组渲染：heading 标题 + 直属块包裹进 .docsec 容器（缩进+引导线表达归属）；前言组平铺。
             块序先过 partitionRows（v4.2 语义）：同 head 无子块无锚点行 → mini 表格（长格/空格不限，
             单元格行内 md；首列 hover 发评），连续媒体 run ≥2 → 图廊；其余块照旧 DocBlock -->
        <template v-for="sec in partitionedSections" :key="sec.key">
          <section v-if="sec.heading" class="docsec" :class="sec.cls">
            <DocBlock :block="sec.heading" :children-by-parent="childrenByParent"
                      :req-id="card.id" :pending-by-block="pendingByBlock"
                      @clarify="seq => emit('clarify', seq)" />
            <template v-for="p in sec.parts" :key="p.kind === 'table' ? 'tbl-' + p.rows[0].id : p.kind === 'gallery' ? 'gal-' + p.blocks[0].id : p.block.id">
              <table v-if="p.kind === 'table'" class="mini">
                <thead><tr><th v-for="(h, hi) in p.head" :key="hi">{{ h }}</th></tr></thead>
                <tbody>
                  <tr v-for="row in p.rows" :key="row.id" :data-blk="row.id">
                    <td v-for="(c, ci) in row.cells" :key="ci">
                      <span v-html="inlineHtml(c)"></span>
                      <button v-if="ci === 0" class="cmbadge ghost rowc" title="评论此行"
                              @click.stop="emit('open-comments', row.id)"><AppIcon name="message-square" :size="11" /></button>
                    </td>
                  </tr>
                </tbody>
              </table>
              <!-- 连续媒体 run 图廊：封面缩略（.gal 定宽），点击灯箱；竖图 tall 高版封面 -->
              <div v-else-if="p.kind === 'gallery'" class="gal">
                <DocBlock v-for="m in p.blocks" :key="m.id" :block="m" :children-by-parent="childrenByParent"
                          :req-id="card.id" :platform-by-block="platformByBlock" :pending-by-block="pendingByBlock"
                          :class="{ tall: m.type === 'image' && m.height > m.width }"
                          @comments="id => emit('open-comments', id)" @view-media="onDocMedia"
                          @clarify="seq => emit('clarify', seq)" />
              </div>
              <DocBlock v-else :block="p.block"
                        :children-by-parent="childrenByParent"
                        :req-id="card.id"
                        :platform-by-block="platformByBlock" :pending-by-block="pendingByBlock"
                        @comments="id => emit('open-comments', id)" @view-media="onDocMedia"
                        @clarify="seq => emit('clarify', seq)" />
            </template>
          </section>
          <template v-else>
            <template v-for="p in sec.parts" :key="p.kind === 'table' ? 'tbl-' + p.rows[0].id : p.kind === 'gallery' ? 'gal-' + p.blocks[0].id : p.block.id">
              <table v-if="p.kind === 'table'" class="mini">
                <thead><tr><th v-for="(h, hi) in p.head" :key="hi">{{ h }}</th></tr></thead>
                <tbody>
                  <tr v-for="row in p.rows" :key="row.id" :data-blk="row.id">
                    <td v-for="(c, ci) in row.cells" :key="ci">
                      <span v-html="inlineHtml(c)"></span>
                      <button v-if="ci === 0" class="cmbadge ghost rowc" title="评论此行"
                              @click.stop="emit('open-comments', row.id)"><AppIcon name="message-square" :size="11" /></button>
                    </td>
                  </tr>
                </tbody>
              </table>
              <!-- 连续媒体 run 图廊：封面缩略（.gal 定宽），点击灯箱；竖图 tall 高版封面 -->
              <div v-else-if="p.kind === 'gallery'" class="gal">
                <DocBlock v-for="m in p.blocks" :key="m.id" :block="m" :children-by-parent="childrenByParent"
                          :req-id="card.id" :platform-by-block="platformByBlock" :pending-by-block="pendingByBlock"
                          :class="{ tall: m.type === 'image' && m.height > m.width }"
                          @comments="id => emit('open-comments', id)" @view-media="onDocMedia"
                          @clarify="seq => emit('clarify', seq)" />
              </div>
              <DocBlock v-else :block="p.block"
                        :children-by-parent="childrenByParent"
                        :req-id="card.id"
                        :platform-by-block="platformByBlock" :pending-by-block="pendingByBlock"
                        @comments="id => emit('open-comments', id)" @view-media="onDocMedia"
                        @clarify="seq => emit('clarify', seq)" />
            </template>
          </template>
        </template>
      </template>
    </div>
    <TocPane v-if="!editing" :items="docToc.map(h => ({ id: h.id, level: h.level, text: h.text }))"
             :active-id="activeHead" @go="emit('go-toc', $event)" />
    </div>

    <!-- 保存预览弹层：四态 diff（可关闭返回修改） -->
    <div class="modal-mask bdiff-modal" v-if="diffPreview" @click.self="diffPreview = null">
      <div class="modal" role="dialog" aria-modal="true">
        <div class="modal-h">保存预览 · 服务端 diff<button class="x" @click="diffPreview = null">✕</button></div>
        <div class="modal-b">
          <p class="sub" style="margin-bottom:10px">确认后写入原文块表（编辑即生效，留痕操作人）。</p>
          <BlockDiff :items="diffPreview.items" :counts="diffPreview.counts" />
        </div>
        <div class="modal-f">
          <button class="btn" @click="diffPreview = null">返回修改</button>
          <button class="btn primary" :disabled="saving" @click="confirmSave">
            <AppIcon name="check-circle" :size="13" />确认保存</button>
        </div>
      </div>
    </div>
  </template>
  <!-- 降级 1：仅 md 快照（未导入块表的老卡） -->
  <template v-else-if="snapshot">
    <div class="banner blue snap-bar">
      <AppIcon name="clock" :size="14" />
      <span>快照 <b class="num" :title="snapshot.at">{{ fmtRel(snapshot.at) }}</b> · 本快照是质检与澄清的<b>依据版本</b></span>
      <span>最新修订以<a v-if="card.sourceUrl" :href="card.sourceUrl" target="_blank" rel="noopener">飞书文档 ↗</a><span v-else>原始来源</span>为准</span>
      <span class="sub">重推产物时快照同步刷新；发布后冻结</span>
    </div>
    <div class="card doc snap-imgs" ref="snapshotBox" v-html="snapshotHtml" @click="onSnapClick"></div>
  </template>
  <!-- 降级 2：无块表无快照——source_import 导入中/失败就地可见（失败可重试），其余按来源降级 -->
  <template v-else>
    <div class="card" v-if="importTask && importTask.status === 'failed'">
      <h3>原文导入失败</h3>
      <p style="font-size:13px;color:var(--red-deep);margin-bottom:6px;word-break:break-all">{{ importFail?.error || '导入失败' }}</p>
      <p class="sub" style="font-size:12px;margin-bottom:12px" v-if="importFail?.hint">{{ importFail.hint }}</p>
      <div style="display:flex;gap:8px;align-items:center">
        <button class="btn primary" v-if="!importTerminal" @click="retryImport"><AppIcon name="refresh-cw" :size="13" />重试导入</button>
        <span class="sub" v-else style="font-size:12px">该失败为终局（不可重试）——原文变更请走变更单</span>
        <a v-if="card.sourceUrl" :href="card.sourceUrl" target="_blank" rel="noopener">
          <button class="btn"><AppIcon name="external-link" :size="13" />打开飞书文档</button></a>
      </div>
    </div>
    <div class="card" v-else-if="importTask && (importTask.status === 'queued' || importTask.status === 'running')">
      <h3>原文导入中</h3>
      <p style="font-size:13px;color:var(--muted);margin-bottom:12px">
        正在解析来源文档为原文块（{{ importTask.runner || '排队/执行中' }}），完成后自动呈现，无需手动刷新。</p>
    </div>
    <div class="card" v-else-if="card.sourceType === 'feishu'">
      <h3>飞书需求文档</h3>
      <p style="font-size:13px;color:var(--muted);margin-bottom:12px">
        尚无原文快照——v4 建卡自动导入原文（见下方「线上流水线」）；老卡快照由 sdlc-sync 首次推送产物时生成。</p>
      <a :href="card.sourceUrl" target="_blank" rel="noopener">
        <button class="btn"><AppIcon name="external-link" :size="13" />打开飞书文档</button></a>
    </div>
    <div class="card" v-else>
      <h3>粘贴的原始需求文本</h3>
      <pre class="srctext">{{ card.sourceText }}</pre>
    </div>
  </template>

  <!-- v4.20 页内图片灯箱（根级全分支共用：块结构 / 降级快照 / 编辑预览同源入口） -->
  <ImgViewer v-if="viewerIdx >= 0" :list="viewerList" v-model:index="viewerIdx" @close="viewerIdx = -1" />
</template>

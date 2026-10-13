<script setup>
// v4 块级编辑器（方案 C 块级聚焦编辑，DESIGN-v4 §14）：渲染态（DocBlock 单块渲染 + hover 手柄）
// ⇄ 单块编辑态（按类型分控件，Esc/失焦保存退出）。输出契约 = 全量块数组（blocks.js toPayload）——
// 窗口 1 直接编辑（OriginTab：diff 预览 → PUT blocks）与变更单 draft（ChangesTab：POST/PUT changes）
// 共用本组件，仅提交端点不同。拖拽 = HTML5 原生 DnD 仅限同父兄弟（跨层走菜单升降级，规避行内子块
// 紧随约束违例）；不引 contenteditable/dnd 库（§14.2 边界）。编辑控件内的按钮一律 mousedown.prevent
// 防抢焦点触发失焦提交。
import { ref, computed, nextTick, onBeforeUnmount } from 'vue'
import DocBlock from './DocBlock.vue'
import AppIcon from './AppIcon.vue'
import {
  toEditable, toPayload, validate, newBlock, insertAfter, removeBlock, moveWithinParent,
  promote, demote, convertType, subtreeEnd, TEXT_TYPES
} from '../blocks.js'
import { uploadMedia } from '../api.js'

const props = defineProps({
  reqId: { type: String, required: true },
  blocks: { type: Array, default: () => [] }      // doc.json 全量块（含派生键/评论块——内部滤洗）
})
const emit = defineEmits(['error'])               // 媒体上传失败等组件内不可恢复错误（壳层 toast）

const rows = ref(toEditable(props.blocks))
const initialJson = JSON.stringify(toPayload(rows.value))

// ===== 视觉缩进：祖先链长度 =====
const byId = computed(() => new Map(rows.value.map(b => [b.id, b])))
function nestLevel(b) {
  let n = 0
  let p = b.parent
  const seen = new Set()
  while (p && byId.value.has(p) && !seen.has(p)) { seen.add(p); p = byId.value.get(p).parent; n++ }
  return n
}
function isInlineOfRow(b) {
  const p = b.parent && byId.value.get(b.parent)
  return !!p && p.type === 'table-row'
}

// ===== 单块编辑态 =====
const editingId = ref('')
const buf = ref(null)             // 编辑缓冲（按类型形状不同），失焦/Esc 写回
const uploadingId = ref('')       // 媒体替换进行中的块
const focusEl = ref(null)         // 编辑控件首输入元素（进入时聚焦；v-for 内须函数 ref 防 Vue 收集为数组）
const setFocusEl = el => { focusEl.value = el }

function startEdit(b) {
  if (dragId.value || uploadingId.value) return
  commitEdit()   // 兜底：切块前落上一个（正常路径 blur 已提交）
  editingId.value = b.id
  if (b.type === 'table-row') {
    buf.value = { rowLabel: b.rowLabel || '', head: [...(b.head || [])], cells: [...(b.cells || [])] }
  } else if (b.type === 'heading' || b.type === 'title') {
    buf.value = { text: b.text || '', level: b.level || (b.type === 'title' ? 1 : 2) }
  } else if (b.type === 'image') {
    buf.value = { media: b.media || '', alt: b.alt || '' }
  } else if (b.type === 'attachment') {
    buf.value = { media: b.media || '', name: b.name || '', mime: b.mime || '', bytes: b.bytes || 0 }
  } else {
    buf.value = { text: b.text || '' }   // paragraph / list-item
  }
  nextTick(() => {
    const el = focusEl.value
    if (!el) return
    el.focus()
    if (el.setSelectionRange && el.value != null) el.setSelectionRange(el.value.length, el.value.length)
    if (el.tagName === 'TEXTAREA') el.style.height = 'auto', el.style.height = el.scrollHeight + 'px'
  })
}
function commitEdit() {
  const b = rows.value.find(x => x.id === editingId.value)
  const d = buf.value
  if (b && d) {
    if (b.type === 'table-row') {
      Object.assign(b, { rowLabel: d.rowLabel, head: [...d.head], cells: [...d.cells] })
    } else if (b.type === 'image') {
      Object.assign(b, { media: d.media, alt: d.alt, text: '' })
    } else if (b.type === 'attachment') {
      Object.assign(b, { media: d.media, name: d.name, text: '' })
    } else {
      b.text = d.text
      if (b.type === 'heading') b.level = d.level
    }
  }
  editingId.value = ''
  buf.value = null
}
/** 失焦提交（容器级）：焦点在编辑控件间切换（relatedTarget 仍在容器内）或上传窗口期不提交 */
function editFocusOut(e) {
  if (uploadingId.value) return
  if (e.relatedTarget && e.currentTarget.contains(e.relatedTarget)) return
  commitEdit()
}
function autoGrow(e) {
  const el = e.target
  el.style.height = 'auto'
  el.style.height = el.scrollHeight + 'px'
}
/** 行内语法按钮：选中段包标记（B=** / 删除线=~~ / 行内代码=`）；mousedown.prevent 防失焦提交 */
function wrapSel(kind) {
  const el = document.getElementById('betext-' + editingId.value)
  if (!el) return
  const s = el.selectionStart, e2 = el.selectionEnd, v = el.value
  const mark = kind === 'b' ? '**' : kind === 's' ? '~~' : '`'
  const seg = v.slice(s, e2) || '文本'
  buf.value.text = v.slice(0, s) + mark + seg + mark + v.slice(e2)
  nextTick(() => { el.focus(); el.setSelectionRange(s + mark.length, s + mark.length + seg.length) })
}
/** 渲染态点击进编辑：链接（图片/附件下载）preventDefault 拦导航；按钮/summary 让位自身行为 */
function bodyClickCapture(e) { if (e.target.closest('a')) e.preventDefault() }
function bodyClick(b, e) {
  if (editingId.value || dragId.value) return
  if (e.target.closest('button, summary')) return
  startEdit(b)
}

function pickReplace(b) {
  const inp = document.createElement('input')
  inp.type = 'file'
  uploadingId.value = b.id   // 占位含文件选择窗口期（focusout 在此期间不提交编辑态）
  inp.onchange = async () => {
    const f = inp.files?.[0]
    if (!f) { uploadingId.value = ''; return }
    try {
      const m = await uploadMedia(props.reqId, f)
      if (buf.value) {
        buf.value.media = m.id
        if (b.type === 'attachment') { buf.value.name = m.name; buf.value.mime = m.mime; buf.value.bytes = m.bytes }
      }
    } catch (e) { emit('error', e) }
    finally { uploadingId.value = '' }
  }
  inp.oncancel = () => { uploadingId.value = '' }
  inp.click()
}

// ===== 手柄菜单（insert 新块 / block 操作）——外点与 Esc 关闭（对齐 Dropdown 惯例） =====
const menu = ref(null)   // { id, kind: 'block' | 'insert' }
function toggleMenu(id, kind) { menu.value = menu.value?.id === id && menu.value.kind === kind ? null : { id, kind } }
const onDocDown = e => {
  if (!menu.value) return
  if (e.target.closest('.bedit-menu') || e.target.closest('.bedit-handle')) return
  menu.value = null
}
const onDocKey = e => { if (e.key === 'Escape') menu.value = null }
document.addEventListener('mousedown', onDocDown, true)
document.addEventListener('keydown', onDocKey, true)
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocDown, true)
  document.removeEventListener('keydown', onDocKey, true)
})

function opInsert(afterId, type) {
  const nb = newBlock(type)
  rows.value = insertAfter(rows.value, afterId, nb)
  menu.value = null
  const made = rows.value.find(b => b.id === nb.id)
  if (made) nextTick(() => startEdit(made))
}
function opRemove(id) {
  rows.value = removeBlock(rows.value, id)
  if (editingId.value === id) { editingId.value = ''; buf.value = null }
  menu.value = null
}
function opPromote(id) { rows.value = promote(rows.value, id); menu.value = null }
function opDemote(id) { rows.value = demote(rows.value, id); menu.value = null }
function opConvert(id, t) { rows.value = convertType(rows.value, id, t); menu.value = null }

// 菜单可用性（与 blocks.js 操作的静默拒绝对齐——不可用即置灰）
function canPromote(b) {
  if (!b) return false
  if (b.type === 'heading') return (b.level || 2) > 1
  if (b.type === 'list-item') return !!b.parent && !isInlineOfRow(b)
  return false
}
function canDemote(b) {
  if (!b) return false
  if (b.type === 'heading') return (b.level || 2) < 6
  if (b.type === 'list-item') {
    if (isInlineOfRow(b)) return false
    const i = rows.value.findIndex(x => x.id === b.id)
    return i > 0 && rows.value.slice(0, i).some(x => x.type === 'list-item' && (x.parent || '') === (b.parent || ''))
  }
  return false
}

// ===== 拖拽（HTML5 原生，仅同父兄弟；drag 子树内目标无 drop 标记） =====
const dragId = ref('')
const dropAt = ref(null)   // { id, pos: 'top' | 'bottom' }
function onDragStart(b, e) {
  dragId.value = b.id
  e.dataTransfer.effectAllowed = 'move'
  e.dataTransfer.setData('text/plain', b.id)   // Firefox 需要 setData 才启动 DnD
}
function onDragOver(b, e) {
  if (!dragId.value || b.id === dragId.value) return
  const d = byId.value.get(dragId.value)
  if (!d || (d.parent || '') !== (b.parent || '')) { e.dataTransfer.dropEffect = 'none'; return }
  const i = rows.value.findIndex(x => x.id === dragId.value)
  const tIndex = rows.value.findIndex(x => x.id === b.id)
  if (tIndex >= i && tIndex < subtreeEnd(rows.value, i)) { e.dataTransfer.dropEffect = 'none'; return }
  e.preventDefault()
  e.dataTransfer.dropEffect = 'move'
  const r = e.currentTarget.getBoundingClientRect()
  dropAt.value = { id: b.id, pos: (e.clientY - r.top) < r.height / 2 ? 'top' : 'bottom' }
}
function onDrop() {
  if (dragId.value && dropAt.value) {
    rows.value = moveWithinParent(rows.value, dragId.value, dropAt.value.id, dropAt.value.pos === 'top')
  }
  dragId.value = ''
  dropAt.value = null
}
function onDragEnd() { dragId.value = ''; dropAt.value = null }

// ===== 提交面（壳层保存流消费） =====
const problems = ref([])
const problemByIndex = computed(() => {
  const m = {}
  for (const p of problems.value) (m[p.index] = m[p.index] || []).push(p.msg)
  return m
})
function getPayload() {
  problems.value = validate(rows.value)
  if (problems.value.length) return { ok: false, problems: problems.value }
  return { ok: true, blocks: toPayload(rows.value) }
}
function isDirty() { return JSON.stringify(toPayload(rows.value)) !== initialJson }
defineExpose({ getPayload, isDirty })

const TYPE_LABEL = { paragraph: '段落', heading: '标题', 'list-item': '列表项', 'table-row': '表格行', image: '图片', attachment: '附件', whiteboard: '画板', title: '文档标题' }
</script>

<template>
  <div class="bedit">
    <template v-for="(b, i) in rows" :key="b.id">
      <!-- 校验问题行内提示（保存前置检查的前端预防面） -->
      <div class="bedit-problem" v-if="problemByIndex[i]">
        <AppIcon name="alert-triangle" :size="12" />{{ problemByIndex[i].join('；') }}
      </div>
      <div class="bedit-row"
           :class="{ 'is-editing': editingId === b.id, 'handle-open': menu?.id === b.id,
                     dragging: dragId === b.id,
                     'drag-over-top': dropAt?.id === b.id && dropAt.pos === 'top',
                     'drag-over-bottom': dropAt?.id === b.id && dropAt.pos === 'bottom' }"
           :style="{ marginLeft: nestLevel(b) * 18 + 'px' }"
           @dragover="onDragOver(b, $event)" @drop.prevent="onDrop" @dragend="onDragEnd">
        <div class="bedit-handle">
          <button class="bedit-grip" draggable="true" title="拖拽排序（同层级内）"
                  @dragstart="onDragStart(b, $event)"><AppIcon name="grip-vertical" :size="13" /></button>
          <button title="在下方插入块" @click.stop="toggleMenu(b.id, 'insert')"><AppIcon name="plus" :size="13" /></button>
          <button title="块操作" @click.stop="toggleMenu(b.id, 'block')"><AppIcon name="more-horizontal" :size="13" /></button>
        </div>

        <div class="bedit-body" @click.capture="bodyClickCapture" @click="bodyClick(b, $event)">
          <!-- 编辑态：按类型分控件（focusout 容器级提交——控件间切换/按钮点击/上传窗口期不误提交） -->
          <div class="bedit-edit" v-if="editingId === b.id" @click.stop @focusout="editFocusOut">
            <!-- paragraph / list-item：textarea + 行内语法工具条 -->
            <template v-if="b.type === 'paragraph' || b.type === 'list-item'">
              <textarea :id="'betext-' + b.id" :ref="setFocusEl" v-model="buf.text" rows="2" spellcheck="false" name="blk-text"
                        @input="autoGrow" @keydown.esc.prevent="commitEdit"></textarea>
              <div class="bedit-toolbar">
                <button title="加粗（选中段包 **）" @click="wrapSel('b')"><b>B</b></button>
                <button title="删除线（选中段包 ~~）" @click="wrapSel('s')"><s>S</s></button>
                <button title="行内代码（选中段包 `）" @click="wrapSel('c')"
                        style="font-family:ui-monospace,monospace">&lt;&gt;</button>
                <span class="bedit-hint">Esc 或失焦保存退出 · {{ TYPE_LABEL[b.type] }}</span>
              </div>
            </template>
            <!-- heading / title：级别 + 文本 -->
            <template v-else-if="b.type === 'heading' || b.type === 'title'">
              <div class="bedit-fieldrow" v-if="b.type === 'heading'">
                <label>级别</label>
                <select v-model.number="buf.level">
                  <option v-for="lv in [1,2,3,4,5,6]" :key="lv" :value="lv">H{{ lv }}</option>
                </select>
              </div>
              <input type="text" :ref="setFocusEl" v-model="buf.text" name="blk-heading" placeholder="标题文本"
                     @keydown.esc.prevent="commitEdit" @keydown.enter.prevent="commitEdit">
              <div class="bedit-toolbar"><span class="bedit-hint">Esc 或失焦保存退出 · {{ TYPE_LABEL[b.type] }}</span></div>
            </template>
            <!-- table-row：行表单（rowLabel + head/cells，整块替换语义） -->
            <template v-else-if="b.type === 'table-row'">
              <div class="bedit-fieldrow">
                <label>行标识</label>
                <input type="text" v-model="buf.rowLabel" name="blk-rowlabel" style="max-width:220px" @keydown.esc.prevent="commitEdit">
              </div>
              <div class="bedit-cells">
                <div class="bedit-cell" v-for="(c, ci) in buf.cells" :key="ci">
                  <span class="idx">{{ buf.head[ci] || ('列' + (ci + 1)) }}</span>
                  <input type="text" v-model="buf.cells[ci]" :name="'blk-cell-' + ci">
                  <button class="btn small" title="删除该列（行与表头同步收缩）"
                          @click="buf.cells.splice(ci, 1); buf.head.splice(ci, 1)">
                    <AppIcon name="x" :size="11" /></button>
                </div>
              </div>
              <div class="bedit-toolbar">
                <button @click="buf.head.push('新列'); buf.cells.push('')">+ 列</button>
                <span class="bedit-hint">Esc 或失焦保存退出 · 表格行（整块替换）</span>
              </div>
            </template>
            <!-- image / attachment：上传替换（块引用新 mediaId） -->
            <template v-else-if="b.type === 'image' || b.type === 'attachment'">
              <div class="bedit-media">
                <AppIcon :name="b.type === 'image' ? 'image' : 'paperclip'" :size="14" />
                <span class="sub">{{ b.type === 'image' ? (buf.alt || '（无替代文本）') : (buf.name || '（未命名附件）') }}</span>
                <button class="btn small" :disabled="uploadingId === b.id"
                        @mousedown.prevent @click="pickReplace(b)">
                  {{ uploadingId === b.id ? '上传中…' : '上传替换' }}</button>
              </div>
              <div class="bedit-fieldrow" v-if="b.type === 'image'">
                <label>替代文本</label>
                <input type="text" v-model="buf.alt" name="blk-alt" @keydown.esc.prevent="commitEdit">
              </div>
              <div class="bedit-toolbar"><span class="bedit-hint">Esc 或失焦保存退出 · {{ TYPE_LABEL[b.type] }}</span></div>
            </template>
            <!-- whiteboard：只读（平台外产出再替换） -->
            <template v-else>
              <div class="sub" style="padding:6px 0">画板块只读：编辑走平台外产出，再以「上传替换」更新引用。</div>
            </template>
          </div>

          <!-- 渲染态：DocBlock 单块渲染（childrenByParent 置空防递归——树序与缩进由编辑器管理） -->
          <template v-else>
            <DocBlock :block="b" :children-by-parent="{}" :comment-by-ref="{}" :req-id="reqId" />
            <div class="sub" style="padding:0 0 4px 2px"
                 v-if="!b.text && !['image', 'table-row', 'whiteboard'].includes(b.type)">（空块，点击填写）</div>
          </template>
        </div>

        <!-- 弹出菜单：insert（段落/标题/列表项）/ block（升降级/转换/删除） -->
        <div class="bedit-menu" v-if="menu?.id === b.id" style="right:8px; top:26px">
          <template v-if="menu.kind === 'insert'">
            <button v-for="t in TEXT_TYPES" :key="t" @click="opInsert(b.id, t)">
              <AppIcon name="plus" :size="12" />插入{{ TYPE_LABEL[t] }}</button>
          </template>
          <template v-else>
            <button :disabled="!canPromote(b)" @click="opPromote(b.id)">
              <AppIcon name="corner-up-left" :size="12" />{{ b.type === 'heading' ? '升一级' : '升级（外移一层）' }}</button>
            <button :disabled="!canDemote(b)" @click="opDemote(b.id)">
              <AppIcon name="corner-up-right" :size="12" />{{ b.type === 'heading' ? '降一级' : '降级（内嵌一层）' }}</button>
            <template v-if="TEXT_TYPES.includes(b.type)">
              <div class="sep"></div>
              <button v-for="t in TEXT_TYPES.filter(x => x !== b.type)" :key="t" @click="opConvert(b.id, t)">
                <AppIcon name="refresh-cw" :size="12" />转为{{ TYPE_LABEL[t] }}</button>
            </template>
            <div class="sep"></div>
            <button class="danger" @click="opRemove(b.id)">
              <AppIcon name="trash" :size="12" />删除{{ b.type === 'table-row' ? '（连同行内子块）' : '（子项上提）' }}</button>
          </template>
        </div>
      </div>
    </template>
    <div class="sub" style="padding:10px 2px" v-if="!rows.length">无可编辑块（原文未导入）。</div>
  </div>
</template>

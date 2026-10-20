<script setup>
// 平台首页 = 迭代列表（DESIGN-v2.4 D37）：迭代×需求 1:1；每行 = 迭代 + 需求卡 + 七节点条 + 当前卡点。
import { ref, computed, onMounted } from 'vue'
import { api } from '../api.js'
import AppIcon from './AppIcon.vue'
import EmptyState from './EmptyState.vue'
import NodeStrip from './NodeStrip.vue'
import { fmtRel } from '../time.js'
import { nodesFromRow, blockerFromRow } from '../lifecycle.js'
import { ask } from '../confirm.js'

const emit = defineEmits(['open-iter', 'open-empty', 'toast'])
const rows = ref([])
const loading = ref(true)
const error = ref('')
const fq = ref({ q: '', status: '' })
const ni = ref(null)   // 新建迭代弹层

const statusLabel = { submitted: '已提交', reviewing: '质检中', clarifying: '待澄清', published: '已发布' }
const statusCls = { submitted: 'b-gray', reviewing: 'b-blue', clarifying: 'b-amber', published: 'b-green' }
const tierCls = { A: 'b-red', B: 'b-amber', C: 'b-gray' }

const filtered = computed(() => rows.value.filter(r =>
  (!fq.value.q || r.name.includes(fq.value.q) || (r.reqName || '').includes(fq.value.q) || (r.reqId || '').includes(fq.value.q))))
const countBy = key => rows.value.filter(r => {
  if (key === 'empty') return !r.reqId
  if (key === 'released') return r.gateStage === 'released'
  if (key === 'active') return r.reqId && r.gateStage !== 'released'
  return false
}).length

async function load() {
  loading.value = true
  error.value = ''
  try {
    rows.value = await api.get('/api/iterations')
  } catch (e) { error.value = e.message } finally { loading.value = false }
}
onMounted(load)

function openRow(r) {
  if (r.reqId) emit('open-iter', { iter: r.name, reqId: r.reqId })
  else emit('open-empty', r.name)
}

function openNew() { ni.value = { name: '', note: '', saving: false } }
async function saveNew() {
  const d = ni.value
  if (!d.name.trim()) return emit('toast', '请填写迭代名', 'err')
  d.saving = true
  try {
    await api.post('/api/iterations', { name: d.name.trim(), note: d.note.trim() })
    ni.value = null
    emit('toast', `迭代 ${d.name.trim()} 已创建（空迭代，可在页内提交需求）`)
    await load()
  } catch (e) { emit('toast', e.message, 'err') } finally { d.saving = false }
}

// 删除空迭代（后端语义：绑定存活需求 409 拒绝，故入口只对 !reqId 的行渲染）
async function delIter(r) {
  if (!await ask({
    title: `删除空迭代「${r.name}」？`,
    body: '仅未绑定需求的空迭代可删，删除后不可恢复（迭代工作目录不受影响）。',
    danger: true, confirmText: '删除'
  })) return
  try {
    await api.del('/api/iterations/detail?name=' + encodeURIComponent(r.name))
    rows.value = rows.value.filter(x => x.name !== r.name)
    emit('toast', `已删除空迭代「${r.name}」`)
  } catch (e) { emit('toast', e.message, 'err') }
}
</script>

<template>
  <div>
    <template v-if="loading && !rows.length">
      <div class="card"><div class="skel skel-line" style="width:88%" v-for="i in 5" :key="i"></div></div>
    </template>
    <EmptyState v-else-if="error" icon="alert-circle" tone="error" title="迭代列表加载失败" :desc="error">
      <button class="btn" @click="load"><AppIcon name="refresh-cw" :size="13" />重试</button>
    </EmptyState>

    <template v-else>
      <div class="stats">
        <div class="stat clickable" @click="fq.status = ''" title="全部迭代">
          <span class="stat-ico ti-gray"><AppIcon name="layers" :size="16" /></span>
          <div><div class="n">{{ rows.length }}</div><div class="l">迭代总数</div></div>
        </div>
        <div class="stat" :class="{ clickable: fq.status === 'active', on: fq.status === 'active' }" @click="fq.status = fq.status === 'active' ? '' : 'active'">
          <span class="stat-ico ti-amber"><AppIcon name="zap" :size="16" /></span>
          <div><div class="n">{{ countBy('active') }}</div><div class="l">进行中</div></div>
        </div>
        <div class="stat" :class="{ clickable: fq.status === 'released', on: fq.status === 'released' }" @click="fq.status = fq.status === 'released' ? '' : 'released'">
          <span class="stat-ico ti-green"><AppIcon name="check-circle" :size="16" /></span>
          <div><div class="n">{{ countBy('released') }}</div><div class="l">已放行</div></div>
        </div>
        <div class="stat">
          <span class="stat-ico ti-blue"><AppIcon name="inbox" :size="16" /></span>
          <div><div class="n">{{ countBy('empty') }}</div><div class="l">空迭代</div></div>
        </div>
      </div>

      <div class="filters">
        <div class="search">
          <AppIcon name="search" :size="13" />
          <input v-model="fq.q" placeholder="搜索迭代名 / 需求名 / 需求编号（/ 聚焦）">
          <button class="clear" v-if="fq.q" @click="fq.q = ''" aria-label="清空搜索"><AppIcon name="x" :size="13" /></button>
        </div>
        <div class="spacer"></div>
        <button class="btn primary" @click="openNew"><AppIcon name="plus" :size="14" />新建迭代</button>
      </div>

      <div class="banner blue iter-tip">
        <AppIcon name="info" :size="14" />
        <span>平台首页 = 迭代列表；<b>迭代 × 需求 1:1</b>——点迭代进入工作台，全生命周期（提交→质检→澄清→发布→设计→用例→门禁→放行）在迭代内闭环。</span>
      </div>

      <div class="iter-list">
        <div class="iter-row" v-for="r in filtered" :key="r.name" tabindex="0"
             @click="openRow(r)" @keydown.enter.self.prevent="openRow(r)">
          <div class="iter-main">
            <div class="iter-name">
              <b>{{ r.name }}</b>
              <span class="badge" v-if="tierCls[r.riskTier]" :class="tierCls[r.riskTier]">{{ r.riskTier }}</span>
              <span class="sub" v-if="r.note" :title="r.note">{{ r.note }}</span>
            </div>
            <div class="iter-req" v-if="r.reqId">
              <span class="badge" :class="statusCls[r.reqStatus]">{{ statusLabel[r.reqStatus] || r.reqStatus }}</span>
              <span class="cell-ell" :title="r.reqName">{{ r.reqName }}</span>
              <span class="sub nw mono">{{ r.reqId }}</span>
            </div>
            <div class="iter-req" v-else>
              <span class="badge b-gray">空迭代</span>
              <span class="sub">尚未提交需求——进入后可在页内提交（1:1 绑定）</span>
            </div>
          </div>
          <div class="iter-side">
            <NodeStrip :nodes="nodesFromRow(r)" />
            <span class="badge blocker" :class="blockerFromRow(r).cls">{{ blockerFromRow(r).text }}</span>
            <span class="sub nw tnum" :title="r.createdAt">{{ r.createdAt ? fmtRel(r.createdAt) : '' }}</span>
          </div>
          <button class="row-del" v-if="!r.reqId" title="删除空迭代" aria-label="删除空迭代"
                  @click.stop="delIter(r)" @keydown.enter.stop.prevent="delIter(r)">
            <AppIcon name="trash" :size="13" />
          </button>
          <AppIcon name="chevron-right" :size="15" class="iter-chev" />
        </div>
        <EmptyState v-if="!filtered.length" icon="inbox" title="没有匹配的迭代"
                    :desc="fq.q || fq.status ? '调整筛选条件试试' : '点右上角「新建迭代」开始第一个迭代'" />
      </div>
    </template>

    <!-- 新建迭代弹层 -->
    <div class="modal-mask" v-if="ni" @click.self="ni = null">
      <div class="modal sm" role="dialog" aria-modal="true" aria-label="新建迭代">
        <div class="modal-h">新建迭代
          <button class="x" @click="ni = null" aria-label="关闭"><AppIcon name="x" :size="16" /></button>
        </div>
        <div class="modal-b">
          <p class="sub" style="margin-bottom:14px">迭代与需求 1:1：创建后进入空迭代页提交需求；迭代名即全生命周期的工作上下文。</p>
          <div class="field"><label><em>*</em>迭代名</label><input v-model="ni.name" placeholder="如 v3.8.0 / 2026-I11"></div>
          <div class="field"><label>备注</label><input v-model="ni.note" placeholder="可选：本期范围一句话"></div>
        </div>
        <div class="modal-f">
          <button class="btn" @click="ni = null">取消</button>
          <button class="btn primary" :disabled="ni.saving" @click="saveNew">{{ ni.saving ? '创建中…' : '创建' }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

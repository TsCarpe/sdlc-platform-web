<script setup>
// 设计 lane tab（DESIGN-v2.4 D34/D37）：view 由工作台传入（单一数据源），动作后 emit refresh。
// 六态（running/failed）为平台化推导；skill 权威落库仅「已定稿｜轻量跳过」。
import { ref, computed, watch } from 'vue'
import { api } from '../api.js'
import AppIcon from './AppIcon.vue'
import RepoChips from './RepoChips.vue'
import { render } from '../render.js'
import { designPhaseLabel } from '../lifecycle.js'

const props = defineProps({ reqId: String, view: Object, operator: String })
const emit = defineEmits(['toast', 'refresh'])

const busy = ref(false)
const showDoc = ref(false)
const finalizeDlg = ref(null)   // {by}
const docHtml = computed(() => (props.view?.finalized?.md || props.view?.draft?.md) ? render(props.view.finalized?.md || props.view.draft?.md) : '')
const tier = computed(() => props.view?.tier || 'A')
const phase = computed(() => props.view?.phase || 'none')
const task = computed(() => props.view?.activeTask || null)

// ===== D39 多目标仓编辑器（卡片式；全量替换语义：本地草稿 → PUT 整单保存） =====
const reposDraft = ref((props.view?.repos || []).map(r => ({ ...r, branch: r.branch || '' })))
// 工作台每次动作后 loadExt 会换新 view 对象：同步重置编辑草稿（编辑过程中 view 不变，不影响输入）
watch(() => props.view, v => { reposDraft.value = (v?.repos || []).map(r => ({ ...r, branch: r.branch || '' })) })
const addRepo = () => reposDraft.value.push({ role: '', kind: 'local', ref: '', branch: '' })
const rmRepo = i => reposDraft.value.splice(i, 1)
const normRepo = r => [r.role?.trim() || '', r.kind === 'github' ? 'github' : 'local', r.ref?.trim() || '', r.branch?.trim() || ''].join('\u0000')
const savedRepos = computed(() => (props.view?.repos || []).map(normRepo))
const draftRepos = computed(() => reposDraft.value.map(normRepo).filter(s => s.split('\u0000')[2]))
const dirty = computed(() => draftRepos.value.join('|') !== savedRepos.value.join('|'))
const genTitle = computed(() => dirty.value ? '配置有改动，请先保存' : (savedRepos.value.length ? '' : '先保存至少一条目标仓'))
const saveRepos = () => {
  const repos = reposDraft.value.filter(r => r.ref.trim())
    .map(r => ({ role: r.role.trim(), kind: r.kind, ref: r.ref.trim(), branch: r.branch.trim() }))
  run(() => api.put(`/api/requirements/${props.reqId}/target-repos`, { repos }),
    repos.length ? `已保存 ${repos.length} 条目标仓` : '已清空目标仓配置')
}
// 只读展示（draft/final 阶段）由 RepoChips 组件承载

async function run(fn, okMsg) {
  busy.value = true
  try {
    await fn()
    if (okMsg) emit('toast', okMsg)
    emit('refresh')
  } catch (e) { emit('toast', e.message, 'err') } finally { busy.value = false }
}
const gen = () => run(() => api.post(`/api/requirements/${props.reqId}/tasks`, { type: 'design_gen', note: '技术设计生成' }), 'design_gen 任务已排队（草稿回传后在上方流水线面板确认）')
const rev = () => run(() => api.post(`/api/requirements/${props.reqId}/tasks`, { type: 'design_rev', note: '设计修订（GR-4 落改闭环）' }), 'design_rev 任务已排队')
const skip = () => run(() => api.post(`/api/requirements/${props.reqId}/design/skip`, { by: props.operator }), '已声明轻量跳过（留痕可审计）；门禁将以自查档执行')
const retry = () => run(() => api.post(`/api/tasks/${task.value.id}/retry`), '任务已重新排队')
const openFinalize = () => { finalizeDlg.value = { by: props.operator } }
const confirmFinalize = () => {
  if (!String(finalizeDlg.value.by || '').trim()) return emit('toast', '请填写定稿人（留痕必填）', 'err')
  return run(async () => {
    await api.post(`/api/requirements/${props.reqId}/drafts/design/approve`, { by: finalizeDlg.value.by.trim() })
    finalizeDlg.value = null
  }, '设计已定稿（确认点②：定稿 ≠ 放行，放行唯一口径 = 门禁已放行）')
}
</script>

<template>
  <div v-if="view">
    <div class="banner blue">
      <AppIcon name="pencil-ruler" :size="14" />
      <span><b>设计 lane</b> ｜ 输入 = 已发布需求摘要/标准文档（GR-1 冻结）；<b>定稿 ≠ 放行</b>，放行唯一口径 = 门禁已放行（GR-4）。
        <span class="sub">阶段徽标为平台化推导（skill 权威落库仅「已定稿｜轻量跳过」两值）</span></span>
      <span class="badge" :class="{ none: 'b-gray', draft: 'b-amber', final: 'b-green', skipped: 'b-gray' }[phase] || 'b-gray'">{{ designPhaseLabel[phase] || phase }}</span>
    </div>

    <!-- 任务执行态横幅（running/failed 推导自最新任务） -->
    <div class="banner" v-if="task && task.status === 'running'">
      <span class="spin"></span><span>设计任务执行中（{{ task.type }}）——草稿回传后本页出现「草稿待定稿」。</span>
    </div>
    <div class="banner" v-else-if="task && task.status === 'queued'">
      <AppIcon name="clock" :size="14" /><span>设计任务排队中（{{ task.type }}），等待 Runner / 进程内 agent 领取。</span>
    </div>
    <div class="banner" v-else-if="task && task.status === 'failed'">
      <AppIcon name="alert-circle" :size="14" style="color:var(--red)" />
      <span style="flex:1">上一次设计任务失败——诊断见上方流水线面板。</span>
      <button class="btn small" :disabled="busy" @click="retry">重试</button>
    </div>

    <!-- 风险升级提案（tier 只升不降：提案需人确认，不在设计 lane 直接改级） -->
    <div class="banner amber-t" v-if="view.tierProposal">
      <AppIcon name="alert-triangle" :size="14" />
      <span style="flex:1"><b>风险升级提案</b>：{{ view.tierProposal.reason || JSON.stringify(view.tierProposal) }}
        <span class="sub">（{{ view.tierProposal.from || tier }} → {{ view.tierProposal.to || '?' }}，tier 只升不降，请到需求卡确认分级）</span></span>
    </div>

    <!-- none：配置仓 + 生成 / C 级轻量路径 -->
    <template v-if="phase === 'none'">
      <div class="card" v-if="tier !== 'C'">
        <div class="rp-head">
          <h3><AppIcon name="folder" :size="15" /> 目标代码仓</h3>
          <span class="sub">存量勘察输入 · 可多仓</span>
          <span class="badge" :class="savedRepos.length ? 'b-blue' : 'b-gray'" style="margin-left:auto">
            {{ savedRepos.length ? `已配置 ${savedRepos.length} 仓` : '未配置' }}</span>
        </div>
        <p class="sub rp-desc">一个需求可能横跨多个项目（前端 / 后端 / 工具仓…）。本地仓填绝对路径，远程仓填 GitHub 地址；
          design_gen 将逐仓勘察，读不到的仓会如实注明降级。</p>

        <div class="rp-list">
          <div class="rp-empty" v-if="!reposDraft.length">
            <AppIcon name="inbox" :size="18" />
            <div><b>尚未配置目标仓</b><br><span class="sub">点击下方「添加仓库」登记第一个项目</span></div>
          </div>
          <div class="rp-card" v-for="(r, i) in reposDraft" :key="i">
            <div class="rp-top">
              <span class="rp-ico"><AppIcon :name="r.kind === 'github' ? 'github' : 'folder'" :size="15" /></span>
              <input class="rp-role" v-model="r.role" placeholder="角色，如 前端 / 后端" maxlength="20">
              <div class="rp-kind" role="radiogroup" aria-label="仓库类型">
                <button type="button" :class="{ on: r.kind === 'local' }" @click="r.kind = 'local'"><AppIcon name="folder" :size="12" />本地仓</button>
                <button type="button" :class="{ on: r.kind === 'github' }" @click="r.kind = 'github'"><AppIcon name="github" :size="12" />GitHub</button>
              </div>
              <button class="rp-del" @click="rmRepo(i)" title="移除此仓（全部删空并保存 = 清空配置）"><AppIcon name="trash" :size="13" /></button>
            </div>
            <div class="rp-fields">
              <label class="rp-field grow">
                <span class="rp-fico"><AppIcon :name="r.kind === 'github' ? 'external-link' : 'folder'" :size="12" /></span>
                <input v-model="r.ref" maxlength="300" class="mono" spellcheck="false"
                       :placeholder="r.kind === 'local' ? '/绝对路径，如 /Users/me/IdeaProjects/xxx' : 'https://github.com/org/repo'">
              </label>
              <label class="rp-field branch">
                <span class="rp-fico"><AppIcon name="git-branch" :size="12" /></span>
                <input v-model="r.branch" maxlength="100" placeholder="分支（可选）">
              </label>
            </div>
          </div>
          <button class="rp-add" @click="addRepo"><AppIcon name="plus" :size="14" /> 添加仓库</button>
        </div>

        <div class="rp-foot">
          <span class="rp-dirty" v-if="dirty"><span class="dot"></span>有未保存的修改，保存后才能按新配置生成</span>
          <span class="sub" v-else-if="!savedRepos.length">至少保存 1 条目标仓后才能生成设计（空配置会被生成守卫拦截）</span>
          <span style="flex:1"></span>
          <button class="btn" :disabled="busy || (!dirty && !!savedRepos.length)" @click="saveRepos">保存配置（全量替换）</button>
          <button class="btn primary" :disabled="busy || dirty || !savedRepos.length" :title="genTitle" @click="gen">生成技术设计（design_gen）</button>
        </div>
        <p class="sub" style="margin-top:8px">用例 lane 与设计<b>并行独立推导</b>（独立性红线：用例禁读设计）。</p>
      </div>
      <div class="card" v-else>
        <h3>轻量路径（C 级）</h3>
        <p class="sub" style="margin-bottom:10px">C 级需求按方法论不产设计文档，但<b>不免门禁</b>：声明轻量跳过后，门禁以自查档（五问）照常产出 issues → 裁决 → 放行。</p>
        <button class="btn primary" :disabled="busy" @click="skip">声明轻量跳过（留痕，可审计）</button>
      </div>
    </template>

    <!-- draft：预览 + 定稿确认 -->
    <template v-else-if="phase === 'draft'">
      <div class="card">
        <h3><span class="badge b-amber">草稿待定稿</span> AI 设计草稿已回传（{{ view.draft.updatedAt }}）</h3>
        <RepoChips v-if="(view.repos || []).length" :repos="view.repos" />
        <details :open="showDoc">
          <summary class="linklike" style="cursor:pointer;font-size:13px;color:var(--muted)" @click.prevent="showDoc = !showDoc">{{ showDoc ? '收起文档' : '展开文档预览' }}</summary>
          <div class="doc" style="margin-top:10px;max-height:520px;overflow:auto" v-html="docHtml"></div>
        </details>
        <div style="margin-top:12px;display:flex;gap:8px">
          <button class="btn primary" @click="openFinalize">定稿采纳（确认点②）</button>
          <button class="btn" :disabled="busy" @click="rev">重新生成（design_gen）</button>
        </div>
      </div>
    </template>

    <!-- final：终稿 + 修订入口 -->
    <template v-else-if="phase === 'final'">
      <div class="card">
        <h3><span class="badge b-green">已定稿</span> v{{ view.finalized.version }} · {{ view.finalized.by }} · {{ view.finalized.at }}</h3>
        <RepoChips v-if="(view.repos || []).length" :repos="view.repos" />
        <p class="sub">确认点②已过。放行唯一口径 = 门禁已放行；放行后的实质变更将触发 GR-3 重审横幅。</p>
        <details :open="showDoc">
          <summary class="linklike" style="cursor:pointer;font-size:13px;color:var(--muted)" @click.prevent="showDoc = !showDoc">{{ showDoc ? '收起文档' : '展开定稿文档（九节）' }}</summary>
          <div class="doc" style="margin-top:10px;max-height:560px;overflow:auto" v-html="docHtml"></div>
        </details>
        <div style="margin-top:12px">
          <button class="btn" :disabled="busy" @click="rev">发起修订（design_rev）</button>
        </div>
      </div>
    </template>

    <!-- skipped -->
    <div class="card" v-else-if="phase === 'skipped'">
      <h3><span class="badge b-gray">轻量跳过</span> 留痕：{{ view.skipDeclared?.by || '—' }} · {{ view.skipDeclared?.at || '—' }}</h3>
      <p class="sub">开闸条件①以「已声明轻量跳过」满足；门禁以自查档执行。与设计生成交互斥。</p>
    </div>
  </div>

  <!-- 定稿确认弹层 -->
  <div class="modal-mask" v-if="finalizeDlg" @click.self="finalizeDlg = null">
    <div class="modal" style="width:480px" role="dialog" aria-modal="true">
      <div class="modal-h">设计定稿（确认点②）<button class="x" @click="finalizeDlg = null">✕</button></div>
      <div class="modal-b">
        <p class="sub" style="margin-bottom:10px">定稿后将写入正式设计文档（version 递增，承接落改修订）。<b>定稿 ≠ 放行</b>：门禁评审以「已定稿」为开闸条件①。</p>
        <div class="field"><label>定稿人</label><input v-model="finalizeDlg.by"></div>
      </div>
      <div class="modal-f">
        <button class="btn" @click="finalizeDlg = null">取消</button>
        <button class="btn primary" :disabled="busy" @click="confirmFinalize">确认定稿</button>
      </div>
    </div>
  </div>
</template>

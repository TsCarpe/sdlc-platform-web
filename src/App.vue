<script setup>
import { ref, watch, onMounted } from 'vue'
import { api, getToken, setToken } from './api.js'
import { pendingJump } from './trace.js'
import ReqList from './components/ReqList.vue'
import ReqDetail from './components/ReqDetail.vue'
import CaseList from './components/CaseList.vue'
import IterList from './components/IterList.vue'
import IterEmpty from './components/IterEmpty.vue'
import AppIcon from './components/AppIcon.vue'
import ConfirmBox from './components/ConfirmBox.vue'
import Chat from './components/Chat.vue'

// v2.4：平台首页 = 迭代列表（DESIGN-v2.4 D37）；#/reqs 保留为跨迭代需求二级视图
const page = ref('iters')
const currentReqId = ref(null)
const currentIter = ref(null)    // 迭代名（page='iters' 时的二级定位：null=列表，名字=迭代页）
const detailTitle = ref('')
const toast = ref(null)          // { text, type: 'ok' | 'err' }
let toastTimer = null
const counts = ref({ reqs: null, cases: null, iters: null })

// ===== 写令牌（P1-4）：服务端启用 SDLC_WRITE_TOKEN 时写操作需 X-Token；仅存本机浏览器 =====
const tokenInput = ref('')
const tokenSet = ref(!!getToken())
function saveToken() {
  setToken(tokenInput.value.trim())
  tokenSet.value = !!getToken()
  tokenInput.value = ''
  showToast(tokenSet.value ? '写令牌已保存（仅本机浏览器）' : '写令牌已清空')
}
function clearToken() {
  setToken('')
  tokenSet.value = false
  showToast('写令牌已清空')
}

// ===== 侧栏收缩（localStorage 持久化，默认展开） =====
const sideCollapsed = ref(localStorage.getItem('sdlc.side') === 'collapsed')
// P1-13 <900px：侧栏改浮层——顶栏按钮开合浮层（不再切换 230/60 宽度）
const mobileSide = ref(false)
function isNarrow() { return typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(max-width: 899px)').matches }
function toggleSide() {
  if (isNarrow()) { mobileSide.value = !mobileSide.value; return }
  sideCollapsed.value = !sideCollapsed.value
  localStorage.setItem('sdlc.side', sideCollapsed.value ? 'collapsed' : 'expanded')
}
// 导航切换后收起浮层（移动端点击菜单即离开）
watch([page, currentReqId, currentIter], () => { mobileSide.value = false })

// ===== hash 路由（零依赖）：#/iters · #/iters/<name> · #/reqs · #/reqs/<id> · #/cases =====
// 状态 → hash 产生历史条目；前进/后退经 hashchange 回写状态；幂等防循环
function hashFor() {
  if (page.value === 'cases') return '#/cases'
  if (page.value === 'iters') return currentIter.value ? '#/iters/' + encodeURIComponent(currentIter.value) : '#/iters'
  return currentReqId.value ? '#/reqs/' + encodeURIComponent(currentReqId.value) : '#/reqs'
}
function syncHash() {
  const want = hashFor()
  if (location.hash !== want) { lastHash = want; location.hash = want }
}
function resetWork() { currentReqId.value = null; detailTitle.value = '' }
// 同一 hash 只应用一次：syncHash 写入后触发的 hashchange 是异步派发，事件到达时若 hash 未变
// 属迟到重放（会把 openIter 刚设置的 currentReqId 清掉）——幂等跳过
let lastHash = null
function applyHash() {
  const h = location.hash
  if (h === lastHash) return
  lastHash = h
  if (h === '#/cases') {
    page.value = 'cases'; currentIter.value = null; resetWork(); return
  }
  if (h.startsWith('#/iters')) {
    page.value = 'iters'; resetWork()
    currentIter.value = h.startsWith('#/iters/') ? (decodeURIComponent(h.slice(8)) || null) : null
    if (currentIter.value) resolveIterBinding(currentIter.value)
    return
  }
  if (h.startsWith('#/reqs')) {
    page.value = 'reqs'; currentIter.value = null
    const id = h.startsWith('#/reqs/') ? (decodeURIComponent(h.slice(7)) || null) : null
    currentReqId.value = id
    if (!id) detailTitle.value = ''
    return
  }
  syncHash()   // 非法 hash 归位
}
watch([page, currentReqId, currentIter], syncHash)

// 迭代定位：绑定需求 → 工作台；空迭代 → 迭代页（页内提交卡）。
// 绑定关系以服务端为权威，异步幂等解析——直接刷新 / 后退进入 hash 同样走此路径（防刷新丢工作台）。
function openIter(name) {
  page.value = 'iters'
  if (currentIter.value !== name) { resetWork(); currentIter.value = name }
  resolveIterBinding(name)
}
async function resolveIterBinding(name) {
  try {
    const row = await api.get('/api/iterations/detail?name=' + encodeURIComponent(name))
    if (page.value === 'iters' && currentIter.value === name && row.reqId && currentReqId.value !== row.reqId) {
      currentReqId.value = row.reqId
      detailTitle.value = row.reqName || ''
    }
  } catch (e) { showToast('打开迭代失败：' + e.message, 'err') }
}
function onIterSubmitted(reqId) {
  currentReqId.value = reqId   // 留在 #/iters/<name>，内容切换为工作台
}
function backFromIter() {
  currentIter.value = null
  resetWork()
}

function showToast(msg, type = 'ok') {
  toast.value = { text: msg, type }
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toast.value = null }, type === 'err' ? 5000 : 2600)
}

function goPage(p) {
  page.value = p
  currentIter.value = null
  resetWork()
}

function onLoaded(name) { detailTitle.value = name || '' }

async function refreshCounts() {
  try {
    const [rs, cs, is] = await Promise.all([api.get('/api/requirements'), api.get('/api/cases'), api.get('/api/iterations')])
    counts.value = { reqs: rs.length, cases: cs.length, iters: is.length }
  } catch { /* 侧栏计数失败不打扰主流程 */ }
}

onMounted(() => {
  if (!location.hash) history.replaceState(null, '', location.pathname + location.search + '#/iters')
  applyHash()
  window.addEventListener('hashchange', applyHash)
  refreshCounts()
  // 全局快捷键（C7 最小集）：/ 聚焦当前页搜索框（输入态不抢键）；无搜索框的页面 no-op
  window.addEventListener('keydown', e => {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return
    const t = e.target
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
    const inp = document.querySelector('.content .search input')
    if (inp) { e.preventDefault(); inp.focus() }
  })
})

// v1.1 追溯跳转：trace.js 发起，这里只负责切页/开卡；tab 内定位由目标组件消费 nonce 完成
watch(() => pendingJump.nonce, n => {
  if (!n) return
  page.value = pendingJump.page
  currentIter.value = null
  if (pendingJump.page === 'reqs') currentReqId.value = pendingJump.reqId
  else resetWork()   // 跳出工作台（cases 页）：须清 currentReqId，否则 ReqDetail(v-else-if) 挡住目标页
})
</script>

<template>
  <aside class="side" :class="{ collapsed: sideCollapsed, 'mobile-open': mobileSide }">
    <div class="logo">
      <span class="logo-mark"><AppIcon name="clipboard-list" :size="13" /></span>
      <span class="logo-txt">SDLC 产物平台<small>迭代 · 需求 · 用例 · 全程可追溯</small></span>
    </div>
    <button class="nav-item" :class="{ on: page === 'iters' }" :title="sideCollapsed ? '迭代' : null"
            @click="goPage('iters')">
      <AppIcon name="layers" :size="15" /><span class="nav-label">迭代</span>
      <span class="cnt" v-if="counts.iters != null">{{ counts.iters }}</span>
    </button>
    <button class="nav-item" :class="{ on: page === 'reqs' }" :title="sideCollapsed ? '需求质检' : null"
            @click="goPage('reqs')">
      <AppIcon name="clipboard-list" :size="15" /><span class="nav-label">需求</span>
      <span class="cnt" v-if="counts.reqs != null">{{ counts.reqs }}</span>
    </button>
    <button class="nav-item" :class="{ on: page === 'cases' }" :title="sideCollapsed ? '测试用例' : null"
            @click="goPage('cases')">
      <AppIcon name="flask" :size="15" /><span class="nav-label">用例</span>
      <span class="cnt" v-if="counts.cases != null">{{ counts.cases }}</span>
    </button>
    <!-- P5：AI 查询助理（右侧抽屉，只读查询，不切页） -->
    <Chat />
    <div class="side-foot">
      <details>
        <summary><AppIcon name="lock" :size="12" />写令牌{{ tokenSet ? '（已设置）' : '' }}</summary>
        <div class="foot-body">
          服务端启用 <b>SDLC_WRITE_TOKEN</b> 时，建卡/排任务/采纳/上传等写操作需携带 X-Token。令牌仅保存在本机浏览器，不上传。
          <input v-model="tokenInput" type="password" placeholder="粘贴写令牌" style="width:100%;margin:6px 0;box-sizing:border-box"
                 @keydown.enter.prevent="saveToken">
          <button class="btn small" :disabled="!tokenInput.trim()" @click="saveToken">保存</button>
          <button class="btn small" v-if="tokenSet" @click="clearToken">清除</button>
        </div>
      </details>
      <details>
        <summary><AppIcon name="chevron-right" :size="12" />范围约定</summary>
        <div class="foot-body">
          平台首页 = 迭代列表（迭代 × 需求 1:1）；全生命周期（提交→质检→澄清→发布→设计→用例→门禁→放行）在迭代工作台内闭环。<br>
          缺陷与执行态不上平台（本地测试）。无登录（内网约定，防误操作不防故意）。出处/编号/覆盖引用均可点击定位回跳。
        </div>
      </details>
    </div>
  </aside>
  <!-- P1-13：移动端侧栏浮层遮罩（点击关闭；桌面端 CSS 隐藏） -->
  <button class="side-backdrop" v-if="mobileSide" @click="mobileSide = false" aria-label="关闭侧栏"></button>

  <div class="main">
    <div class="topbar">
      <button class="topbar-toggle" @click="toggleSide"
              :title="sideCollapsed ? '展开侧栏' : '收起侧栏'" aria-label="收起/展开侧栏">
        <AppIcon name="panel" :size="15" />
      </button>
      <h1>
        <template v-if="page === 'iters' && !currentIter">迭代列表</template>
        <template v-else-if="page === 'iters'"><span class="crumb">迭代列表 /</span> {{ currentIter }}</template>
        <template v-else-if="page === 'reqs' && !currentReqId">需求（跨迭代视图）</template>
        <template v-else-if="page === 'reqs'"><span class="crumb">需求 /</span> {{ currentReqId || '需求详情' }}</template>
        <template v-else>测试用例登记</template>
      </h1>
      <div class="sync-info" title="产物由本地 sdlc-sync 工具或平台流水线写入，无后台自动同步"><span class="dot"></span>同步服务 · 手动触发</div>
    </div>

    <div class="content">
      <!-- 勿加 mode="out-in"：Vue 3.5 下 leave 后 afterLeave→instance.update() 会以 el=null 的 prevTree patch 抛错，
           渲染 effect 中断 → 内容区永久白屏（迭代工作台→导航必现）。并发淡切规避该路径 -->
      <Transition name="fade">
        <IterList v-if="page === 'iters' && !currentIter" key="iterlist"
                  @open-iter="openIter($event.iter)" @open-empty="openIter($event)" @toast="showToast" />
        <IterEmpty v-else-if="page === 'iters' && currentIter && !currentReqId" key="iterempty"
                   :iter="currentIter" @back="backFromIter" @submitted="onIterSubmitted" @toast="showToast" />
        <!-- key 绑定需求 id：跨需求导航（迭代绑定 → 直达 hash）时强制重挂载，防复用实例残留上一个需求的数据 -->
        <ReqDetail v-else-if="currentReqId" :key="'reqdetail-' + currentReqId" :req-id="currentReqId"
                   @back="page === 'iters' ? backFromIter() : (currentReqId = null, detailTitle = '')"
                   @toast="showToast" @loaded="onLoaded" />
        <ReqList v-else-if="page === 'reqs'" key="reqlist" @open="currentReqId = $event" @toast="showToast" />
        <CaseList v-else key="cases" @toast="showToast" />
      </Transition>
    </div>
  </div>

  <Transition name="fade">
    <div class="toast" :class="{ err: toast.type === 'err' }" v-if="toast" role="status">
      <AppIcon :name="toast.type === 'err' ? 'alert-circle' : 'check-circle'" :size="15" />
      {{ toast.text }}
    </div>
  </Transition>

  <!-- v2.2 全局确认框（评测 P1-8：替代原生 confirm），Teleport 到 body -->
  <ConfirmBox />
</template>

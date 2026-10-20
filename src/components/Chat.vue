<script setup>
// AI 查询助理（P5 新增）：右侧抽屉 + SSE 流式（fetch stream，零新依赖）。
// 只读查询；输出按纯文本渲染（pre-wrap），不走 markdown 注入面。
import { ref, nextTick, onMounted, onUnmounted } from 'vue'
import { authHeaders } from '../api.js'
import AppIcon from './AppIcon.vue'

const open = ref(false)
const msgs = ref([])            // { role: 'user'|'assistant', text }
const input = ref('')
const streaming = ref(false)
const errText = ref('')
const listEl = ref(null)
let sid = localStorage.getItem('sdlc.chat.sid')
if (!sid) { sid = 'chat-' + Date.now().toString(36); localStorage.setItem('sdlc.chat.sid', sid) }
let aborter = null

// Esc 关抽屉（window 冒泡阶段：上层弹窗开启时事件被 modal-focus 捕获截断，到不了这里，天然不抢）
function onKey(e) { if (e.key === 'Escape' && open.value) open.value = false }
onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))

function scrollBottom() {
  nextTick(() => { if (listEl.value) listEl.value.scrollTop = listEl.value.scrollHeight })
}

async function send() {
  const text = input.value.trim()
  if (!text || streaming.value) return
  input.value = ''
  errText.value = ''
  msgs.value.push({ role: 'user', text })
  const reply = ref('')
  msgs.value.push({ role: 'assistant', text: reply })   // 流式占位（引用共享，delta 就地追加）
  streaming.value = true
  scrollBottom()
  aborter = new AbortController()
  try {
    const res = await fetch('/api/assistant/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders('POST') },
      body: JSON.stringify({ sessionId: sid, message: text }),
      signal: aborter.signal
    })
    if (!res.ok || !res.body) {
      const d = await res.json().catch(() => ({}))
      throw new Error(d.error || `HTTP ${res.status}`)
    }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      let idx
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const frame = buf.slice(0, idx); buf = buf.slice(idx + 2)
        const line = frame.split('\n').find(l => l.startsWith('data: '))
        if (!line) continue
        const ev = JSON.parse(line.slice(6))
        if (ev.type === 'delta') { reply.value += ev.text; scrollBottom() }
        else if (ev.type === 'error') { errText.value = ev.message }
      }
    }
  } catch (e) {
    if (e.name !== 'AbortError') errText.value = '助理调用失败：' + e.message
  } finally {
    streaming.value = false
    aborter = null
    if (!reply.value && !errText.value) reply.value = '（无输出）'
  }
}

function stop() { if (aborter) aborter.abort() }

async function clearSession() {
  try {
    await fetch('/api/assistant/sessions/' + encodeURIComponent(sid),
                { method: 'DELETE', headers: authHeaders('DELETE') })
  } catch { /* 幂等 */ }
  msgs.value = []
  errText.value = ''
}
</script>

<template>
  <button class="nav-item chat-toggle" :title="open ? '收起 AI 助理' : 'AI 助理（查询）'"
          :class="{ on: open }" @click="open = !open">
    <AppIcon name="send" :size="15" /><span class="nav-label">AI 助理</span>
  </button>

  <Teleport to="body">
      <section class="drawer chat-drawer" v-if="open" aria-label="AI 查询助理">
        <header class="chat-head">
          <strong>AI 助理</strong>
          <span class="chat-sub">查询平台数据 · 只读 · 会话记忆</span>
          <button class="chat-btn" title="清空会话" @click="clearSession"><AppIcon name="trash" :size="13" /></button>
          <button class="chat-btn" title="收起" @click="open = false"><AppIcon name="x" :size="13" /></button>
        </header>
        <div class="chat-list" ref="listEl">
          <p class="chat-empty" v-if="!msgs.length">
            试试：「现在有多少条需求？」「REQ-2026-001 的门禁到哪一步了？」「列出未处置的澄清问题」
          </p>
          <div v-for="(m, i) in msgs" :key="i" class="chat-msg" :class="m.role">
            <span class="chat-who">{{ m.role === 'user' ? '我' : '助理' }}</span>
            <div class="chat-text">{{ m.text }}<span class="chat-cursor" v-if="streaming && i === msgs.length - 1 && m.role === 'assistant'">▍</span></div>
          </div>
        </div>
        <p class="chat-err" v-if="errText">{{ errText }}</p>
        <footer class="chat-input">
          <textarea v-model="input" rows="2" placeholder="提问…（Enter 发送，Shift+Enter 换行）"
                    :disabled="streaming"
                    @keydown.enter.exact.prevent="send"></textarea>
          <button class="chat-btn send" :disabled="streaming || !input.trim()" @click="send" v-if="!streaming">
            <AppIcon name="send" :size="13" />
          </button>
          <button class="chat-btn send" title="停止" @click="stop" v-else><AppIcon name="x" :size="13" /></button>
        </footer>
      </section>
  </Teleport>
</template>


// 追溯跳转（需求域侧的发起与消费，AUDIT D6-2 拆分自 ReqDetail）：
// locate = 出处 → 原文定位（优先块锚点，回退 needle 文本匹配，全失诚实提示）；
// applyJump = 消费 pendingJump（fr/audit/check/asm/needle 五类协议，先展开目标组再定位）。
import { watch } from 'vue'
import { pendingJump, jumpTo, consumeJump, settle, flashEl, flashNeedle, needlesFor } from '../trace.js'

/**
 * @param deps
 *   reqId         () => string（props 的 getter）
 *   tab           当前 tab 的 ref（定位前切换）
 *   digestMdOpen  digest 原文折叠的 ref（asm 跳入时自动展开）
 *   toast         (msg, tone) => void
 *   revealGrpFor  折叠组展开（group-collapse 协议）
 *   expandAllGroups () => void  展开工作台全部分组（check ∪ 已定论，audit 跳转兜底）
 *   getOriginBox  () => Element|null  origin 快照容器（needle 定位，tab 组件 expose）
 *   getDigestMdBox () => Element|null digest 原文容器（假设定位，tab 组件 expose）
 */
export function useTraceJump(deps) {
  const { reqId, tab, digestMdOpen, toast, revealGrpFor, expandAllGroups, getOriginBox, getDigestMdBox } = deps

  /**
   * 出处 → 原文定位：v1.2 优先块锚点（anchor=飞书块 ID，按 data-blk 直达），
   * 回退 needle 文本匹配（原文 → 详述N.N → N.N），全失诚实提示。
   */
  async function locate(src, anchor) {
    tab.value = 'origin'
    await settle()
    if (anchor) {
      const el = document.querySelector(`[data-blk="${anchor}"]`)
      if (el && flashEl(el)) return
    }
    const needles = needlesFor(src)
    if (!needles.length) { toast('该条无可定位的原文片段', 'err'); return }
    for (const nd of needles) {
      if (await flashNeedle(getOriginBox(), nd)) return
    }
    toast(`当前快照未包含「${needles[0]}」；该出处可能位于快照未收录的段落`, 'err')
  }

  /** 消费本需求的跳转：切 tab →（展开目标组）→ 滚动 → 闪烁 */
  async function applyJump() {
    const j = pendingJump
    if (!j.nonce || j.page !== 'reqs' || j.reqId !== reqId()) return
    consumeJump()
    const miss = () => toast(`未定位到目标「${j.id || j.needle}」：可能尚未推送或编号不存在`, 'err')
    if (j.kind === 'fr') {
      tab.value = 'digest'
      revealGrpFor('fr', j.id)          // 目标组在折叠列表内 → 先展开再定位（协议不因折叠失效）
      await settle()
      if (!flashEl(document.querySelector(`[data-frid="${j.id}"]`))) miss()
    } else if (j.kind === 'audit') {
      // v5（D1/D19）：audit tab 已并入工作台（tab 键名仍 'checklist'）；目标可为问题卡或已定论卡
      // ——组名 miss 时展开全部分组兜底重查（r4 二审#13，只展开 check 列表会让 audit-only 目标
      // 卡困在折叠的已定论组里，scrollIntoView 静默失效）
      tab.value = 'checklist'
      revealGrpFor('audit', j.id)
      await settle()
      let el = document.querySelector(`[data-pid="${j.id}"]`)
      // 兜底扩为「el 不存在 或 折叠态不可见（0fr 高度 DOM 常驻）」——已定论卡宿主在
      // check 父组内的子折叠块里，父组仍折时 el 命中但 flash 不可见（静默失效，review F1）
      if ((!el || el.clientHeight === 0) && expandAllGroups) {
        expandAllGroups()
        await settle()
        el = document.querySelector(`[data-pid="${j.id}"]`)
      }
      if (!flashEl(el)) miss()
    } else if (j.kind === 'check') {
      tab.value = 'checklist'
      revealGrpFor('check', j.id)
      await settle()
      if (!flashEl(document.querySelector(`[data-pid="${j.id}"]`))) miss()
    } else if (j.kind === 'asm') {
      tab.value = 'digest'
      digestMdOpen.value = true
      await settle(150)
      if (!(await flashNeedle(getDigestMdBox(), j.id))) miss()
    } else if (j.kind === 'needle') {
      tab.value = 'origin'
      await settle()
      if (!(await flashNeedle(getOriginBox(), j.needle))) miss()
    }
  }
  watch(() => pendingJump.nonce, () => applyJump())

  return { locate, applyJump, jumpTo }
}

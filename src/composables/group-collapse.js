// v2.2 分组折叠协议（AUDIT D6-2 拆分自 ReqDetail）：openGrps 跨 audit/checklist/fr/状态机
// 四类组列表共用（组名同源 domains，「状态机·」前缀防撞名联动展开）。
// 壳调用 provideGroupCollapse 创建后 provide，各 tab 组件 useGrpCollapse() inject 消费。
// P1-11：首次进入展开所有含 pending 的组；折叠/展开由用户操作后按 reqId 持久化（localStorage），
// 刷新保持。持久化只记「用户显式操作」，跳转 reveal 属临时展开不改偏好。
import { reactive, provide, inject, watchEffect } from 'vue'
import { pidOf } from '../trace.js'
import { isPending } from '../disposition.js'

export const GRP_KEY = Symbol('group-collapse')

/** localStorage 键：折叠状态按需求隔离（跨需求不串） */
export function groupStorageKey(reqId) { return 'wb.grps.' + reqId }

function loadOverrides(key) {
  if (!key) return {}
  try {
    const raw = JSON.parse(localStorage.getItem(key) || '{}')
    return raw && typeof raw === 'object' ? raw : {}
  } catch { return {} }
}

/** 壳侧创建：groups 传 { fr, audit, check } 三个分组的 computed（revealGrpFor 跳转展开用）；
 *  opts.reqId 用于按需求持久化用户折叠偏好。 */
export function provideGroupCollapse(groups, opts = {}) {
  const storageKey = opts.reqId ? groupStorageKey(opts.reqId) : ''
  const overrides = loadOverrides(storageKey)   // 组名 → 用户显式展开(true)/折叠(false)
  const seen = new Set()                        // 已应用默认值的组（后续数据刷新不覆盖用户操作）
  const openGrps = reactive(new Set())          // Vue3 对 Set 的 add/delete/clear 均响应式

  function persist() {
    if (!storageKey) return
    try { localStorage.setItem(storageKey, JSON.stringify(overrides)) } catch { /* 隐私模式静默降级 */ }
  }

  /** 首次见到某组：用户显式偏好优先；否则含 pending 的组默认展开（其余保持折叠） */
  function seedGroup(g) {
    if (!g || !g.name || seen.has(g.name)) return
    seen.add(g.name)
    if (g.name in overrides) {
      overrides[g.name] ? openGrps.add(g.name) : openGrps.delete(g.name)
    } else if ((g.items || []).some(isPending)) {
      openGrps.add(g.name)
    }
  }
  // 数据异步装载：d 到达后 computed 更新 → 逐组播种默认态（已播种组不重复应用）
  watchEffect(() => {
    for (const g of [...groups.check.value, ...groups.audit.value, ...groups.fr.value]) seedGroup(g)
  })

  function toggleGrp(name) {
    const willOpen = !openGrps.has(name)
    willOpen ? openGrps.add(name) : openGrps.delete(name)
    overrides[name] = willOpen                       // 手动操作 → 持久化
    persist()
  }
  function expandAll(lists) {
    for (const g of lists) {
      openGrps.add(g.name)
      overrides[g.name] = true
    }
    persist()
  }
  function collapseAll() {
    for (const name of openGrps) overrides[name] = false
    for (const name of seen) overrides[name] = false
    openGrps.clear()
    persist()
  }

  /** 跳转目标所在组自动展开（折叠不能吞掉 flash 定位协议）。
   *  v5（r4 二审#13）：audit 编号的解析域 = check 组 ∪ 已定论组——audit: 跳转目标可能是
   *  工作台问题卡（同源编号）也可能是已定论只读卡（audit-only），两侧组集因增量质检组分叉。
   *  P1-11：reveal 是临时展开，不写 overrides——刷新后仍尊重用户折叠偏好。 */
  function revealGrpFor(kind, id) {
    const lists = kind === 'fr' ? groups.fr.value
      : (kind === 'audit' ? [...groups.check.value, ...groups.audit.value] : groups.check.value)
    for (const g of lists) {
      const hit = kind === 'fr'
        ? g.items.some(x => x.id === id)
        : g.items.some(x => pidOf(x.id) === id || x.seq === id)
      // 命中已定论组（带 raw 标记）时同步展开同名 check 父组——已定论子折叠块渲染在
      // 父组 grp-body 内，只开子块键父组仍折，目标卡 0 高度不可见（review F1 与兜底双保险）
      if (hit) {
        openGrps.add(g.name)
        seen.add(g.name)          // 已定位的组同样视为已播种，后续刷新不回退
        if (g.raw) { openGrps.add(g.raw); seen.add(g.raw) }
        return
      }
    }
  }

  const api = { openGrps, toggleGrp, expandAll, collapseAll, revealGrpFor }
  provide(GRP_KEY, api)
  return api
}

/** tab 组件侧消费 */
export function useGrpCollapse() {
  return inject(GRP_KEY)
}

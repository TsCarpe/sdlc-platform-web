// v2.2 分组折叠协议（AUDIT D6-2 拆分自 ReqDetail）：openGrps 跨 audit/checklist/fr/状态机
// 四类组列表共用（组名同源 domains，「状态机·」前缀防撞名联动展开）。
// 壳调用 provideGroupCollapse 创建后 provide，各 tab 组件 useGrpCollapse() inject 消费。
import { reactive, provide, inject } from 'vue'
import { pidOf } from '../trace.js'

export const GRP_KEY = Symbol('group-collapse')

/** 壳侧创建：groups 传 { fr, audit, check } 三个分组的 computed（revealGrpFor 跳转展开用） */
export function provideGroupCollapse(groups) {
  const openGrps = reactive(new Set())   // Vue3 对 Set 的 add/delete/clear 均响应式
  function toggleGrp(name) { openGrps.has(name) ? openGrps.delete(name) : openGrps.add(name) }
  function expandAll(lists) { for (const g of lists) openGrps.add(g.name) }
  function collapseAll() { openGrps.clear() }

  /** 跳转目标所在组自动展开（折叠不能吞掉 flash 定位协议）。
   *  v5（r4 二审#13）：audit 编号的解析域 = check 组 ∪ 已定论组——audit: 跳转目标可能是
   *  工作台问题卡（同源编号）也可能是已定论只读卡（audit-only），两侧组集因增量质检组分叉。 */
  function revealGrpFor(kind, id) {
    const lists = kind === 'fr' ? groups.fr.value
      : (kind === 'audit' ? [...groups.check.value, ...groups.audit.value] : groups.check.value)
    for (const g of lists) {
      const hit = kind === 'fr'
        ? g.items.some(x => x.id === id)
        : g.items.some(x => pidOf(x.id) === id || x.seq === id)
      if (hit) { openGrps.add(g.name); return }
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

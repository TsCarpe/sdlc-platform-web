// 缺陷分层（v1.6 layer 字段，七层分类法来源：sdlc-intent/references/dimensions.md）：
// 就绪度覆盖地图的维度名称——short 上标签，full 进 tooltip（层号 1-7，缺省/「补充」类不携带）
const LAYERS = {
  1: { short: '概念', full: '第 1 层 · 概念层：术语定义，概念缺失 / 模糊 / 不一致' },
  2: { short: '状态流程', full: '第 2 层 · 状态机与流程层：状态闭环、触发、流转冲突' },
  3: { short: '数据字段', full: '第 3 层 · 数据与字段层：字段引用、计算口径、约束' },
  4: { short: '规则逻辑', full: '第 4 层 · 规则与逻辑层：规则冲突、权限口径、边界值' },
  5: { short: '角色场景', full: '第 5 层 · 角色与场景覆盖层：角色×功能缺口、异常场景' },
  6: { short: '文档质量', full: '第 6 层 · 文档质量层：自相矛盾、删除不彻底、编号低错' },
  7: { short: '外部参照', full: '第 7 层 · 外部参照层：有录无消、有消无录、数据无源' },
}
export function layerShort(layer) { return LAYERS[String(layer)]?.short || '' }
export function layerFull(layer) { return LAYERS[String(layer)]?.full || '' }

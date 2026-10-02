// 澄清项处置口径（DESIGN-v2.2 D21/D25）——前后端唯一判定源，ReqDetail/TaskPanel 共用。
// 后端显式写入 status（pending/answered/rejected/deferred，存量由 SchemaMigrator 回填），
// 前端直接读 status，不做 answer 降级（与 D22「无读时降级」一致）。
const DONE = ['answered', 'rejected', 'deferred']

/** 已处置（作答/驳回/挂起均计入——不处置完不进 standard_doc，与后端 counts 口径一致） */
export function isDone(it) {
  return DONE.includes(it?.status)
}

/** 待处置（含 status 缺失的异常数据兜底：无 status 视为未处置，宁可多问不可漏问） */
export function isPending(it) {
  return !isDone(it)
}

/** 处置状态徽标文案 */
export function dispLabel(it) {
  if (it?.status === 'answered') return '已答复'
  if (it?.status === 'rejected') return '已驳回'
  if (it?.status === 'deferred') return '已挂起'
  return '待确认'
}

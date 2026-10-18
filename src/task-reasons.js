// 任务失败 reason 的终局语义（N-1）：与后端 TaskService._RETRYABLE_REASONS 同源——
// 生命周期取消/作废/封存产生的 failed 一律不可重试（后端 retry 会 409），UI 不再显示按钮；
// 其余执行失败（timeout / no-draft / agent-exception / import-failed / integrity-failed /
// blocks-empty）仍可重试。
export const terminalTaskReasons = {
  'superseded-by-publish': '已作废',
  'req-deleted': '已作废',
  'change-aborted': '已作废',
  cancelled: '已取消',
  sealed: '已封存'
}

export function isTerminalReason(reason) {
  return !!terminalTaskReasons[reason]
}

/** 解析 task.result 的 reason（纯文本/旧格式归空串）。 */
export function taskFailReason(task) {
  try {
    const o = JSON.parse((task && task.result) || '{}')
    return (o && typeof o === 'object' && o.reason) || ''
  } catch {
    return ''
  }
}

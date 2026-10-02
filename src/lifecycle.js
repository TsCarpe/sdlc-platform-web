// v2.4 生命周期派生单一来源（DESIGN-v2.4 D37）：迭代列表行 / 工作台 / 主按钮 CTA 共用。
// 节点条七段 = 质检→澄清→发布→设计→用例→门禁→放行；六态/节点为平台化 UI 推导（skill 权威两值落库，页面须标注）。

export const NODES = ['质检', '澄清', '发布', '设计', '用例', '门禁', '放行']

export const designPhaseLabel = {
  none: '未开始', draft: '草稿待定稿', final: '已定稿', skipped: '轻量跳过'
}
export const gatePhaseLabel = {
  blocked: '待开闸', running: '评审中', summary: '汇总待入库', deciding: '裁决中', released: '已放行'
}

/** 列表行（GET /api/iterations 平铺行）→ 七节点粗粒度状态（设计/门禁用聚合列 designPhase/gateStage） */
export function nodesFromRow(row) {
  const s = row.reqStatus
  const design = row.designPhase === 'final' || row.designPhase === 'skipped' ? 'done'
    : row.designPhase === 'draft' ? 'doing' : 'todo'
  return [
    { label: '质检', st: s === 'submitted' ? 'todo' : s === 'reviewing' ? 'doing' : 'done' },
    { label: '澄清', st: s === 'published' ? 'done' : s === 'clarifying' ? 'doing' : 'todo' },
    { label: '发布', st: s === 'published' ? 'done' : 'todo' },
    { label: '设计', st: design },
    { label: '用例', st: row.caseCount > 0 ? 'done' : s === 'published' ? 'doing' : 'todo' },
    { label: '门禁', st: row.gateStage === 'released' ? 'done' : row.gateStage === 'active' ? 'doing' : 'todo' },
    { label: '放行', st: row.gateStage === 'released' ? 'done' : 'todo' }
  ]
}

/** 当前卡点徽章（列表行口径） */
export function blockerFromRow(row) {
  const s = row.reqStatus
  if (s === 'submitted') return { text: '已提交 · 启动质检', cls: 'b-gray' }
  if (s === 'reviewing') return { text: '质检进行中', cls: 'b-blue' }
  if (s === 'clarifying') return { text: `继续澄清 ${row.answeredQ}/${row.totalQ}`, cls: 'b-amber' }
  if (s !== 'published') return { text: '—', cls: 'b-gray' }
  if (row.gateStage === 'released') return { text: '已放行归档', cls: 'b-green' }
  if (row.gateStage === 'active') return { text: '评审处理中', cls: 'b-amber' }
  if (row.designPhase === 'draft') return { text: '设计草稿待定稿', cls: 'b-amber' }
  if (row.designPhase === 'final' || row.designPhase === 'skipped') return { text: '可开评审', cls: 'b-blue' }
  if (row.caseCount === 0) return { text: '生成测试用例', cls: 'b-blue' }
  return { text: '生成技术设计', cls: 'b-blue' }
}

/**
 * 工作台全链主按钮（demo nextAction 口径）：发布后链路 发布→设计→用例→门禁→放行→r2 无空窗。
 * 输入 = 需求 detail（d）+ 设计读面（dv）+ 门禁读面（gv）。返回 {label, go, disabled?}；go ∈ tab 切换 | 动作名。
 */
export function nextActionCta(d, dv, gv) {
  if (!d?.card) return null
  const status = d.card.status
  if (status === 'clarifying') {
    const done = (d.items || []).filter(i => i.status === 'answered' || i.status === 'rejected' || i.status === 'deferred').length
    return { label: `继续澄清 ${done}/${(d.items || []).length}`, go: 'tab:checklist' }
  }
  if (status !== 'published' || !dv || !gv) return null
  const gate = gv.phase
  if (gate === 'released') {
    if (gv.change?.changed && gv.change?.window === 'released') return { label: '变更复审（开 r2）', go: 'gate:reopen' }
    return { label: '已放行 · 归档', go: 'tab:gate', done: true }
  }
  if (gate === 'deciding') {
    const units = gv.units || []
    const decided = units.filter(u => u.verdict === '备案' || u.verdict).length
    return decided >= units.length
      ? { label: '放行评审（GR-4 校验）', go: 'gate:release' }
      : { label: `继续裁决 ${decided}/${units.length}`, go: 'tab:gate' }
  }
  if (gate === 'summary') return { label: '确认评审汇总（issues 入库）', go: 'gate:ingest' }
  if (gate === 'running') return { label: '评审执行中…', go: 'tab:gate', disabled: true }
  // blocked：按设计域状态推进
  if (dv.phase === 'draft') return { label: '设计草稿定稿', go: 'tab:design' }
  if (dv.phase === 'skipped') return { label: '开评审（自查档）', go: 'gate:open' }
  if (dv.phase === 'final') {
    const checksOk = (gv.checks || []).every(c => c.ok)
    return checksOk ? { label: '开评审（三条件全绿）', go: 'gate:open' } : { label: '开评审（补齐三条件）', go: 'tab:gate' }
  }
  if (dv.phase === 'none') {
    const tier = d.card.riskTier || 'A'
    return tier === 'C'
      ? { label: '声明轻量跳过（C 级）', go: 'design:skip' }
      : (dv.targetRepo ? { label: '生成技术设计', go: 'design:gen' } : { label: '配置目标代码仓', go: 'tab:design' })
  }
  return { label: '前往门禁', go: 'tab:gate' }
}

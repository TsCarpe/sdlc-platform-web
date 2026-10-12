import { describe, it, expect } from 'vitest'
import { nextActionCta, nodesFromRow, blockerFromRow, designPhaseLabel } from '../src/lifecycle.js'

const d = (card, items = []) => ({ card, items })

describe('nextActionCta 全链状态机', () => {
  it('无卡返回 null', () => {
    expect(nextActionCta(null)).toBeNull()
    expect(nextActionCta({})).toBeNull()
  })

  it('clarifying：未答完 → 继续澄清带进度', () => {
    const c = nextActionCta(d({ status: 'clarifying' }, [{ status: 'answered' }, { status: 'pending' }]))
    expect(c).toEqual({ label: '继续澄清 1/2', go: 'tab:checklist' })
  })

  it('clarifying 全答完 → 仍指路清单（生成按钮归 TaskPanel，CTA 不越权）', () => {
    const c = nextActionCta(d({ status: 'clarifying' }, [{ status: 'answered' }]), {}, {})
    expect(c).toEqual({ label: '继续澄清 1/1', go: 'tab:checklist' })
  })

  it('published 但 dv/gv 未就绪 → null（等待读面）', () => {
    expect(nextActionCta(d({ status: 'published' }), null, null)).toBeNull()
  })

  it('published + blocked + design none：C 级 → 轻量跳过', () => {
    const c = nextActionCta(d({ status: 'published', riskTier: 'C' }), { phase: 'none' }, { phase: 'blocked' })
    expect(c).toEqual({ label: '声明轻量跳过（C 级）', go: 'design:skip' })
  })

  it('published + blocked + design none：A/B 未配仓 → 配置目标仓', () => {
    const c = nextActionCta(d({ status: 'published', riskTier: 'A' }), { phase: 'none' }, { phase: 'blocked' })
    expect(c).toEqual({ label: '配置目标代码仓', go: 'tab:design' })
  })

  it('design 定稿 + 三条件全绿 → 开评审', () => {
    const c = nextActionCta(d({ status: 'published' }), { phase: 'final' },
      { phase: 'blocked', checks: [{ ok: true }, { ok: true }, { ok: true }] })
    expect(c).toEqual({ label: '开评审（三条件全绿）', go: 'gate:open' })
  })

  it('design 定稿 + 条件未齐 → 补齐入口', () => {
    const c = nextActionCta(d({ status: 'published' }), { phase: 'final' },
      { phase: 'blocked', checks: [{ ok: true }, { ok: false }] })
    expect(c).toEqual({ label: '开评审（补齐三条件）', go: 'tab:gate' })
  })

  it('gate deciding 未裁完 → 继续裁决带进度', () => {
    const c = nextActionCta(d({ status: 'published' }), { phase: 'final' },
      { phase: 'deciding', units: [{ verdict: 'revise' }, { verdict: '' }] })
    expect(c.label).toBe('继续裁决 1/2')
  })

  it('gate deciding 全裁决 → 放行评审（GR-4）', () => {
    const c = nextActionCta(d({ status: 'published' }), { phase: 'final' },
      { phase: 'deciding', units: [{ verdict: 'revise' }] })
    expect(c).toEqual({ label: '放行评审（GR-4 校验）', go: 'gate:release' })
  })

  it('released + released 窗口变更 → 开复审 r2', () => {
    const c = nextActionCta(d({ status: 'published' }), { phase: 'final' },
      { phase: 'released', change: { changed: true, window: 'released' } })
    expect(c).toEqual({ label: '变更复审（开 r2）', go: 'gate:reopen' })
  })

  it('released 无变更 → 归档态', () => {
    const c = nextActionCta(d({ status: 'published' }), { phase: 'final' },
      { phase: 'released', change: { changed: false } })
    expect(c).toEqual({ label: '已放行 · 归档', go: 'tab:gate', done: true })
  })
})

describe('nodesFromRow 七节点推导', () => {
  const row = { reqStatus: 'published', designPhase: 'final', caseCount: 3, gateStage: 'released' }
  it('全绿的七节点', () => {
    const st = nodesFromRow(row).map(n => n.st)
    expect(st).toEqual(['done', 'done', 'done', 'done', 'done', 'done', 'done'])
  })
  it('submitted 起点', () => {
    const rows = nodesFromRow({ reqStatus: 'submitted', designPhase: 'none', caseCount: 0, gateStage: 'none' })
    const st = rows.map(n => n.st)
    expect(st.slice(0, 3)).toEqual(['todo', 'todo', 'todo'])
    expect(st[6]).toBe('todo') // 放行
  })
  it('reviewing 质检 doing', () => {
    const rows = nodesFromRow({ reqStatus: 'reviewing', designPhase: 'none', caseCount: 0, gateStage: 'none' })
    expect(rows[0].st).toBe('doing')
  })
})

describe('blockerFromRow 卡点徽章', () => {
  it('clarifying 带进度', () => {
    expect(blockerFromRow({ reqStatus: 'clarifying', answeredQ: 2, totalQ: 5 }).text).toBe('继续澄清 2/5')
  })
  it('published 未开闸链路', () => {
    // designPhase 判定先于 caseCount：已定稿未开闸 → 可开评审
    expect(blockerFromRow({ reqStatus: 'published', gateStage: 'none', designPhase: 'final', caseCount: 0 }).text).toBe('可开评审')
    // designPhase none + 无用例 → 先攒用例（case_gen 发布前后均可，与 CTA 的设计优先口径存在既有微差）
    expect(blockerFromRow({ reqStatus: 'published', gateStage: 'none', designPhase: 'none', caseCount: 0 }).text).toBe('生成测试用例')
    expect(blockerFromRow({ reqStatus: 'published', gateStage: 'none', designPhase: 'none', caseCount: 5 }).text).toBe('生成技术设计')
    expect(blockerFromRow({ reqStatus: 'published', gateStage: 'none', designPhase: 'draft' }).text).toBe('设计草稿待定稿')
  })
  it('已放行归档', () => {
    expect(blockerFromRow({ reqStatus: 'published', gateStage: 'released' }).text).toBe('已放行归档')
  })
})

describe('designPhaseLabel', () => {
  it('四态文案', () => {
    expect(designPhaseLabel.none).toBe('未开始')
    expect(designPhaseLabel.final).toBe('已定稿')
    expect(designPhaseLabel.skipped).toBe('轻量跳过')
  })
})

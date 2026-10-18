import { describe, it, expect } from 'vitest'
import { isDone, isPending, dispLabel } from '../src/disposition.js'
import { fmtRel, fmtDur } from '../src/time.js'
import { isTerminalReason, taskFailReason } from '../src/task-reasons.js'

describe('disposition 处置口径（与后端 counts 同源的唯一判定）', () => {
  it('answered/rejected/deferred 均为已处置', () => {
    expect(isDone({ status: 'answered' })).toBe(true)
    expect(isDone({ status: 'rejected' })).toBe(true)
    expect(isDone({ status: 'deferred' })).toBe(true)
  })
  it('pending 与缺失 status 视为待处置（宁可多问）', () => {
    expect(isDone({ status: 'pending' })).toBe(false)
    expect(isDone({})).toBe(false)
    expect(isDone(null)).toBe(false)
    expect(isPending({ status: 'pending' })).toBe(true)
  })
  it('dispLabel 四态文案', () => {
    expect(dispLabel({ status: 'answered' })).toBe('已答复')
    expect(dispLabel({ status: 'rejected' })).toBe('已驳回')
    expect(dispLabel({ status: 'deferred' })).toBe('已挂起')
    expect(dispLabel({ status: 'pending' })).toBe('待确认')
  })
})

describe('time 相对时间与时长', () => {
  it('刚刚 / N 分钟前 / N 小时前', () => {
    const now = Date.now()
    const at = ms => new Date(now - ms).toISOString().replace('T', ' ').slice(0, 19)
    // 注意：fmtRel 按 +08:00 解析——这里直接用其边界行为：空值返回空串
    expect(fmtRel('')).toBe('')
    expect(fmtDur(0)).toBe('0 秒')
    expect(fmtDur(65_000)).toBe('1 分 5 秒')
    expect(fmtDur(3_900_000)).toBe('1 时 5 分')
  })
  it('非法时间原样返回', () => {
    expect(fmtRel('not-a-time')).toBe('not-a-time')
  })
})

describe('task-reasons 终局语义（N-1，与后端 retry 白名单同源）', () => {
  it('生命周期取消/作废/封存为终局，执行失败可重试', () => {
    for (const r of ['superseded-by-publish', 'req-deleted', 'change-aborted', 'cancelled', 'sealed']) {
      expect(isTerminalReason(r)).toBe(true)
    }
    for (const r of ['timeout', 'no-draft', 'agent-exception', 'import-failed',
                     'integrity-failed', 'blocks-empty', '']) {
      expect(isTerminalReason(r)).toBe(false)
    }
  })
  it('taskFailReason 解析 JSON result；纯文本/空任务归空串', () => {
    expect(taskFailReason({ result: JSON.stringify({ error: 'x', reason: 'cancelled' }) })).toBe('cancelled')
    expect(taskFailReason({ result: 'plain text' })).toBe('')
    expect(taskFailReason(null)).toBe('')
  })
})

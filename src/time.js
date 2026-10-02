// 相对时间（完整值由调用方放 title）："2026-09-22 10:27:55" → "5 分钟前"；超一天去年份（"09-23 13:37"）
export function fmtRel(s) {
  if (!s) return ''
  const t = new Date(String(s).replace(' ', 'T') + '+08:00').getTime()
  if (isNaN(t)) return s
  const diff = Date.now() - t
  if (diff < 60e3) return '刚刚'
  if (diff < 3600e3) return Math.floor(diff / 60e3) + ' 分钟前'
  if (diff < 86400e3) return Math.floor(diff / 3600e3) + ' 小时前'
  return String(s).slice(5, 16)
}

// 时长（任务耗时等）：ms → "3 分 20 秒" / "1 时 5 分"
export function fmtDur(ms) {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s} 秒`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} 分 ${s % 60} 秒`
  return `${Math.floor(m / 60)} 时 ${m % 60} 分`
}

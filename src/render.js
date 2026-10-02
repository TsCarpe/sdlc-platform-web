// markdown 渲染 + 标准文档引用链接化（ReqDetail 与 TaskPanel 共用）
import { marked } from 'marked'
import DOMPurify from 'dompurify'

export function render(md) {
  if (!md) return ''
  return DOMPurify.sanitize(marked.parse(md))
}

// 裸 P 编号收紧为至少两位（P01 起）：避免误伤优先级 P1/P2；v1.2 详述N 出处也链接化；§ 章节引用（评测 P2-6）
export function linkifyRefs(html) {
  return String(html || '').replace(
    /(需求\.FR-\d+)|(体检\.P\d+)|(需求\.A\d+)|\b(P\d{2,})\b|\b(FR-\d+)\b|(§\s?\d+(?:\.\d+)*)|(详述\d+(?:\.\d+)*(?:·[^，。；）)\s]+)?)/g,
    (m, fr, audit, asm, p, bareFr, sec, src) => {
      let ref
      if (fr) ref = 'fr:' + fr
      else if (audit) ref = 'audit:' + audit.slice(3)
      else if (asm) ref = 'asm:' + asm
      else if (p) ref = 'check:' + p
      else if (sec) ref = 'sec:' + sec.replace(/\s+/g, '')
      else if (src) ref = 'src:' + src
      else ref = 'fr:需求.' + bareFr
      return `<span class="reflink" data-ref="${ref}">${m}</span>`
    })
}

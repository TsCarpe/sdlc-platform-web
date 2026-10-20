// v5.x 评论口径单点（入口合并）：线程根判据 + 评论锚 map 构建——面板线程组装、角标联动
// 定位目标、评论锚出处分流三方共用，防口径复制漂移。
// 后端契约：GET /comments 行含 origin('platform'|'feishu')/externalId/replyTo/resolved；
// doc.json 的 comment 合成块 id = external_id（飞书，常态为数字 comment-id）或 cm-<根行id>。

/** 线程根判据（与后端 _thread_groups 同口径）：无 replyTo 或父行不在列表（父删悬空回复升根） */
export function threadRoots(comments) {
  const byId = new Set((comments || []).map(c => c.id))
  return (comments || []).filter(c => c.replyTo == null || !byId.has(c.replyTo))   // 保序 = id 升序
}

/** 评论锚 → 面板定位目标（根行 id，恒 Number）。键域 = docBlocks 的 comment 合成块 id，值映射：
 *  - origin==='platform'：块 id=cm-<n> → 行 n（n 恒为根行 id；行已删不入 map）
 *  - origin==='feishu' 或缺省（老卡 artifact 视图无 origin 键）：块 id（=external_id）→
 *    同 externalId 的 id 升序首根
 *  同 id 冲突时 feishu 优先——resolve_anchors 消费的梳理期 intake doc.json 只含飞书块
 *  （撞键 winner 必为飞书），前端同裁决即与解析侧对齐。映射 miss 一律不入 map（点击回退
 *  原 locate 行为，优雅降级）。 */
export function buildCommentAnchorMap(docBlocks, comments) {
  const m = {}
  const cs = comments || []
  const byId = new Set(cs.map(c => c.id))
  const byExternal = {}
  for (const r of threadRoots(cs)) {
    if (r.externalId) (byExternal[r.externalId] = byExternal[r.externalId] || []).push(r)
  }
  const blocks = (docBlocks || []).filter(b => b && b.type === 'comment' && b.id)
  for (const b of blocks) {           // platform 先写——feishu/缺省支后写，冲突时覆盖即 feishu 优先
    if (b.origin !== 'platform') continue
    const n = /^cm-(\d+)$/.exec(String(b.id))
    const id = n ? Number(n[1]) : null
    if (id != null && byId.has(id)) m[b.id] = id
  }
  for (const b of blocks) {
    if (b.origin === 'platform') continue
    const hit = (byExternal[b.id] || [])[0]
    if (hit) m[b.id] = hit.id
  }
  return m
}

/** 线程组装（CommentsPanel 面板与 CtxPane 评论出处卡共用）：threadRoots 取根 + 回复链
 *  深度遍历（环由 seen 剪），resolved 看根（resolve 是线程级，根+链同值） */
export function buildThreads(comments) {
  const byId = new Map((comments || []).map(c => [c.id, c]))
  const children = {}
  for (const c of comments || []) {
    if (c.replyTo != null && byId.has(c.replyTo)) (children[c.replyTo] = children[c.replyTo] || []).push(c)
  }
  return threadRoots(comments).map(r => ({
    root: r,
    replies: (function walk(id, acc = [], seen = new Set()) {
      for (const ch of children[id] || []) {
        if (seen.has(ch.id)) continue
        seen.add(ch.id)
        acc.push(ch)
        walk(ch.id, acc, seen)
      }
      return acc
    })(r.id),
    resolved: r.resolved
  }))
}

/** 按评论 id 找所属线程（根 id 直取；回复 id 深兜底——调用方给的恒为根 id，miss 返回 null） */
export function threadOf(threads, cid) {
  for (const t of threads || []) {
    if (t.root.id === cid) return t
    if (t.replies.some(r => r.id === cid)) return t
  }
  return null
}

// @vitest-environment jsdom
// v5.x HTML 附件预览/全屏体验（DocBlock.htmlblk + HtmlViewer）：
// ① text/html/.html 附件 → 文件卡 + 内联缩略预览 + 全屏体验入口；其余附件维持原卡片+查看/下载
// ② 预览走 fetch→blob URL→sandbox iframe（无 allow-same-origin——附件脚本读不到平台存储/写令牌）
// ③ 点开全屏器（Esc/退出关闭、下载出口保留）；fetch 失败 → 占位/失败文案不崩
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

const htmlBlk = { type: 'attachment', id: 'b1', name: '成绩分析demo.html', mime: 'text/html', bytes: 2048, media: 'm-1' }
const pdfBlk  = { type: 'attachment', id: 'b2', name: '说明书.pdf',     mime: 'application/pdf', bytes: 4096, media: 'm-2' }

function stubNet(ok = true, body = '<html><body>demo</body></html>') {
  vi.stubGlobal('fetch', vi.fn(async () =>
    ok ? new Response(body, { status: 200 }) : new Response('x', { status: 500 })))
}

async function mountBlock(block) {
  const { default: DocBlock } = await import('../src/components/DocBlock.vue')
  return mount(DocBlock, { props: { block, reqId: 'REQ-1' }, global: { stubs: { teleport: true } } })
}

describe('HTML 附件预览', () => {
  beforeEach(() => stubNet())
  afterEach(() => vi.unstubAllGlobals())

  it('text/html 附件 → 文件卡 + 缩略预览（sandbox iframe 无 allow-same-origin）', async () => {
    const w = await mountBlock(htmlBlk)
    await flushPromises()                                    // onMounted fetch→blobUrl
    expect(w.find('.mediacard').exists()).toBe(true)
    expect(w.find('.htmlprev').exists()).toBe(true)
    const f = w.find('.htmlprev-frame')
    expect(f.attributes('srcdoc')).toContain('demo')         // srcdoc 渲染（不用 blob: URL——Safari/FF sandboxed blob 白屏）
    expect(f.attributes('sandbox')).toBe('allow-scripts')    // 允许脚本渲染原型，但 opaque origin
    expect(fetch).toHaveBeenCalledWith('/api/requirements/REQ-1/media/m-1')
  })

  it('mime 缺失按 .htm 扩展名兜底识别', async () => {
    const w = await mountBlock({ ...htmlBlk, id: 'b3', name: 'demo.htm', mime: '' })
    expect(w.find('.htmlprev').exists()).toBe(true)
  })

  it('非 HTML 附件 → 原卡片 + 查看/下载，不渲染预览、不发 fetch', async () => {
    const w = await mountBlock(pdfBlk)
    await flushPromises()
    expect(w.find('.htmlprev').exists()).toBe(false)
    expect(w.find('.mediacard a').attributes('href')).toBe('/api/requirements/REQ-1/media/m-2')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('点击预览 → 全屏体验器打开（sandbox iframe），Esc 关闭', async () => {
    const w = await mountBlock(htmlBlk)
    await flushPromises()
    await w.find('.htmlprev').trigger('click')
    await flushPromises()                                    // HtmlViewer mount + 内部 fetch→blobUrl
    await flushPromises()
    expect(w.find('.hv-mask').exists()).toBe(true)
    const hf = w.find('.hv-frame')
    expect(hf.attributes('sandbox')).toBe('allow-scripts allow-forms allow-popups')
    expect(hf.attributes('sandbox')).not.toContain('allow-same-origin')
    expect(w.find('.hv-top a[target="_blank"]').exists()).toBe(true)  // 下载出口保留（新标签开 attachment 即下载）
    expect(document.body.style.overflow).toBe('hidden')               // 背景滚动已锁
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(w.find('.hv-mask').exists()).toBe(false)
    expect(document.body.style.overflow).toBe('')
  })

  it('fetch 失败 → 失败文案 + 点击重试可恢复；全屏器显示失败提示不白屏', async () => {
    stubNet(false)
    const w = await mountBlock(htmlBlk)
    await flushPromises()
    expect(w.find('.htmlprev-ph').text()).toContain('预览加载失败')
    stubNet(true)                                            // 服务恢复
    await w.find('.htmlprev').trigger('click')               // 失败态点击 = 重试（不开全屏）
    await flushPromises()
    expect(w.find('.htmlprev-frame').exists()).toBe(true)    // 重试成功出缩略图
    expect(w.find('.hv-mask').exists()).toBe(false)
    // 全屏器内 fetch 失败仍走失败文案（不白屏）
    stubNet(false)
    await w.find('.htmlprev').trigger('click')
    await flushPromises()
    await flushPromises()
    expect(w.find('.hv-loading').text()).toContain('加载失败')
  })
})

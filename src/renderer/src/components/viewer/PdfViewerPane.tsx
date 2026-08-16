// src/renderer/src/components/viewer/PdfViewerPane.tsx
// PDF 查看器（pdfjs-dist 自建，绿色主题）：
// - text layer 开启 → 文字可选中复制（@file-viewer 的 PDF 渲染无法选择且易报错）
// - 按页宽渲染 + 滚动翻页；基础工具栏只保留页码/页数
// - Ctrl+滚轮缩放：两阶段——transform scale 即时缩放（平滑响应）+ 停止 800ms 后 pdfjs 原生 scale
//   清晰重渲染（清晰度不损失），完成后 transform 归 1（视觉连续）
// - 结构与 xlsx 查看器同构（stage 占位层撑开滚动范围 + transform 视觉缩放，用户实测通过的组合）：
//   .pdf-viewer-body > .pdf-zoom-stage(width/height=viewScale%) > .pdf-zoom-scale(transform) > .pdf-pages
// - 1.0 精简：不做搜索按钮（高级功能后评估）

import { useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import { useAppStore } from '../../store/appStore'
import { readPosition } from '../../utils/positionMemory'

// worker 由 vite 打包（new URL 资源引用；dev 同源 http / 生产复制到 out）
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url
).toString()

const PAGE_SCALE = 1.4

/**
 * 手动渲染 text layer（新版 pdfjs-dist 移除了公共 renderTextLayer API）。
 * 关键教训（PDFBUG.png / PDFBUG2.png / 用户反馈）：
 * ① 矩阵已含字号缩放，不能同时设置 font-size + transform（双重放大）；
 * ② PDF 文本 y 是「基线」位置，顶部需减去升部（fontAscent ≈ 0.89×字号）；
 * ③ 按行分组渲染（pdf-text-line 行 div）：选择区域连续（不闪）、行间不重叠（无深绿叠加）；
 * ④ copy 事件拦截：span 是 transparent 色，直接写入纯文本剪贴板（否则粘贴白字）。
 */
function renderTextLayer(
  container: HTMLElement,
  textContent: { items: unknown[] },
  viewport: { transform: number[] }
): void {
  interface SpanInfo {
    span: HTMLElement
    left: number
    top: number
    height: number
  }
  interface LineInfo {
    top: number
    height: number
    spans: SpanInfo[]
  }

  const infos: SpanInfo[] = []
  for (const raw of textContent.items) {
    const item = raw as { str?: string; transform?: number[]; fontAscent?: number }
    if (!item.str || !item.transform) continue
    const tx = pdfjsLib.Util.transform(viewport.transform, item.transform)
    const fontHeight = Math.sqrt(tx[2] ** 2 + tx[3] ** 2)
    const ascent = item.fontAscent ?? 0.89
    const span = document.createElement('span')
    span.textContent = item.str
    if (fontHeight > 0) span.style.fontSize = `${fontHeight}px`
    infos.push({ span, left: tx[4], top: tx[5] - fontHeight * ascent, height: fontHeight })
  }

  // 按 top 聚类成行（容差 0.6×字号；行取最小 top / 最大高度）
  const lines: LineInfo[] = []
  for (const info of infos) {
    const line = lines.find((l) => Math.abs(l.top - info.top) < info.height * 0.6)
    if (line) {
      line.spans.push(info)
      line.height = Math.max(line.height, info.height)
      line.top = Math.min(line.top, info.top)
    } else {
      lines.push({ top: info.top, height: info.height, spans: [info] })
    }
  }
  lines.sort((a, b) => a.top - b.top)

  for (const line of lines) {
    const lineDiv = document.createElement('div')
    lineDiv.className = 'pdf-text-line'
    lineDiv.style.top = `${line.top}px`
    lineDiv.style.height = `${line.height}px`
    for (const info of line.spans) {
      info.span.style.left = `${info.left}px`
      lineDiv.appendChild(info.span)
    }
    container.appendChild(lineDiv)
  }

  // 复制拦截：透明 span 的复制会带 transparent 颜色 → 直接写纯文本（按行换行）
  container.addEventListener('copy', (e) => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed) return
    if (!container.contains(sel.anchorNode) && !container.contains(sel.focusNode)) return
    const parts: string[] = []
    container.querySelectorAll<HTMLElement>('.pdf-text-line').forEach((line) => {
      const lineParts: string[] = []
      line.querySelectorAll<HTMLElement>('span').forEach((s) => {
        if (sel.containsNode(s, true)) lineParts.push(s.textContent ?? '')
      })
      if (lineParts.length > 0) parts.push(lineParts.join(''))
    })
    if (parts.length === 0) return
    e.preventDefault()
    void navigator.clipboard.writeText(parts.join('\n'))
  })
}

export default function PdfViewerPane({ path }: { path: string }): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [state, setState] = useState<{ loading: boolean; error: string | null; total: number }>({
    loading: true,
    error: null,
    total: 0
  })
  // 全局视图缩放（Ctrl+滚轮）
  const viewZoom = useAppStore((s) => s.viewZoom)
  // 解析后的 PDF 文档缓存（只解析一次；缩放仅重渲染页面，不重新读文件/解析）
  const pdfRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null)
  // 渲染代次：新一轮渲染开始后，旧渲染循环检测到代次不符立即放弃（避免并发交错）
  const renderGenRef = useRef(0)
  // transform 缩放层引用（清晰重渲染完成后需"同帧归位"，直接操作 DOM 避免 React 异步渲染的中间帧跳变）
  const scaleRef = useRef<HTMLDivElement | null>(null)
  // 滚动容器引用（水平居中补偿公式需要容器宽度）
  const bodyRef = useRef<HTMLDivElement | null>(null)
  // 页面物理宽度（renderAll 时记录第一页宽度；水平居中补偿：left = max(0, (容器宽 - 页面视觉宽)/2)）
  const [pageWidth, setPageWidth] = useState(0)
  // 页面物理宽度 ref（renderAll 里只写 ref；归 1 时与 setViewScale(1) 同一微任务一起 setState，
  // 避免"新 canvas × 旧 transform"的 React 中间态渲染 → 画面往右闪一下再闪回）
  const pageWidthRef = useRef(0)
  // 窗口 resize 后重算水平居中（版本号触发重渲染）
  const [resizeTick, setResizeTick] = useState(0)
  // 即时缩放比例（transform 布局级缩放，滚轮立刻响应不卡）；停止滚动后按此比例清晰重渲染，完成后归 1
  const [viewScale, setViewScale] = useState(1)
  // canvas 当前渲染对应的缩放倍率（相对 PAGE_SCALE 基准）：
  // transform 视觉 = canvas物理 × transform = 基准×canvasZoom × (viewZoom/canvasZoom) = 基准×viewZoom，
  // 补偿掉"canvas 物理随归 1 重渲染变化"的因子 —— 否则从非 100% 继续缩放时视觉多乘一个旧比例（"识别缩放与实际不符"）
  const canvasZoomRef = useRef(1)
  /** 用给定 scale 渲染全部页到 DocumentFragment，完成后一次性替换（无闪烁/空白） */
  const renderAll = async (pdf: pdfjsLib.PDFDocumentProxy, scale: number): Promise<void> => {
    const gen = ++renderGenRef.current
    const container = containerRef.current
    if (!container) return
    const frag = document.createDocumentFragment()
    for (let i = 1; i <= pdf.numPages; i++) {
      if (gen !== renderGenRef.current) return // 已有更新一轮的渲染，放弃本次
      const page = await pdf.getPage(i)
      const viewport = page.getViewport({ scale })
      if (i === 1) pageWidthRef.current = viewport.width

      const pageDiv = document.createElement('div')
      pageDiv.className = 'pdf-page'
      pageDiv.style.width = `${viewport.width}px`
      pageDiv.style.height = `${viewport.height}px`

      const canvas = document.createElement('canvas')
      canvas.width = viewport.width
      canvas.height = viewport.height
      const ctx = canvas.getContext('2d')
      if (!ctx) continue
      await page.render({ canvas, canvasContext: ctx, viewport }).promise
      if (gen !== renderGenRef.current) return

      const textLayer = document.createElement('div')
      textLayer.className = 'textLayer'
      pageDiv.appendChild(canvas)
      pageDiv.appendChild(textLayer)

      try {
        const textContent = await page.getTextContent()
        renderTextLayer(textLayer, textContent, viewport)
      } catch {
        // 文字层失败不影响阅读
      }

      frag.appendChild(pageDiv)
    }
    if (gen !== renderGenRef.current) return
    // canvas 渲染比例在"完成时"才更新（被放弃的渲染不污染补偿基准，避免 transform 短暂错乱）
    canvasZoomRef.current = scale / PAGE_SCALE
    container.innerHTML = ''
    container.appendChild(frag)
    setState({ loading: false, error: null, total: pdf.numPages })
  }

  // 加载/切换文件：读文件 + 解析 PDF 文档（120ms 防抖），完成后渲染
  // 初始渲染比例 = 该文件记忆的缩放（切换文件时 App 已恢复 viewZoom，直接读取即可），
  // 完成后 transform 归 1（canvas 已按目标尺寸渲染，视觉即最终比例，无双重放大）
  // 用 useLayoutEffect：cleanup 在 DOM 移除/更新前同步执行，保存阅读位置能读到旧容器
  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return
    let cancelled = false
    setViewScale(1)
    const timer = window.setTimeout(() => {
      container.innerHTML = ''
      setState({ loading: true, error: null, total: 0 })
      void (async () => {
        // 释放旧文档：切换文件时先 destroy（pdfjs 文档对象内存较大，反复打开 PDF 会累积）
        if (pdfRef.current) {
          const old = pdfRef.current
          pdfRef.current = null
          void old.loadingTask.destroy().catch(() => {})
        }
        let loadingTask: ReturnType<typeof pdfjsLib.getDocument> | null = null
        try {
          const { buffer: bytes } = await window.api.readFile(path)
          const data = bytes.slice()
          // CID 中文字体（Type0）渲染必需：CMap 资源已复制到 public/cmaps
          loadingTask = pdfjsLib.getDocument({
            data,
            cMapUrl: 'cmaps/',
            cMapPacked: true
          })
          const pdf = await loadingTask.promise
          if (cancelled) {
            void pdf.loadingTask.destroy().catch(() => {})
            return
          }
          pdfRef.current = pdf
          const z = useAppStore.getState().viewZoom || 1
          await renderAll(pdf, PAGE_SCALE * z)
          if (!cancelled) {
            // 与缩放归 1 同理：pageWidth 与 viewScale 同批 setState，避免中间态
            setPageWidth(pageWidthRef.current)
            setViewScale(1)
            // 恢复上次阅读位置（等渲染稳定后双 rAF 设置滚动）
            const pos = readPosition(path)
            if (pos) {
              requestAnimationFrame(() =>
                requestAnimationFrame(() => {
                  if (bodyRef.current) {
                    bodyRef.current.scrollTop = pos.s || 0
                    if (pos.l) bodyRef.current.scrollLeft = pos.l
                  }
                })
              )
            }
          }
        } catch (e) {
          // 解析失败/被取消：销毁 loadingTask（取消后台下载与解析），释放内存
          if (loadingTask) void loadingTask.destroy().catch(() => {})
          if (!cancelled) setState({ loading: false, error: String(e), total: 0 })
        }
      })()
    }, 120)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
      // 切换文件/组件卸载：释放当前文档（与加载路径的旧文档释放一致）
      if (pdfRef.current) {
        const old = pdfRef.current
        pdfRef.current = null
        void old.loadingTask.destroy().catch(() => {})
      }
      // 阅读位置保存已移至 App 注册的 flushPosition 回调（事件驱动）——
      // 卸载 cleanup 保存会被 StrictMode 挂载时模拟卸载污染成 {s:0}（2026-08-14 根因）
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path])

  // 窗口尺寸变化：重算水平居中补偿（left 公式依赖容器宽度）
  useEffect(() => {
    const onResize = (): void => setResizeTick((t) => t + 1)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // 缩放：transform scale 即时缩放（平滑、不卡）→
  // 停止滚动 800ms 后按目标比例清晰重渲染（pdfjs 原生 scale，清晰度不损失）→ 完成后 transform 归 1（视觉连续）
  useEffect(() => {
    // transform = viewZoom / canvasZoom（补偿 canvas 物理尺寸），视觉恒 = 基准 × viewZoom
    setViewScale(viewZoom / canvasZoomRef.current)
    const pdf = pdfRef.current
    if (!pdf) return
    const timer = window.setTimeout(() => {
      void renderAll(pdf, PAGE_SCALE * viewZoom)
        .then(() => {
          const now = useAppStore.getState().viewZoom
          // 渲染期间用户没再缩放 → canvas 已按新比例渲染
          if (now === viewZoom) {
            // 同帧归位：先直接改 DOM（transform 归 1）再同步 React state——
            // 若只 setViewScale(1)，React 异步渲染会留一个中间帧：新 canvas（viewZoom 倍）
            // 仍被旧 transform（viewZoom 倍）再放大 → 画面瞬间跳成 viewZoom² 倍再缩回（"闪一下大小"）
            if (scaleRef.current) scaleRef.current.style.transform = 'scale(1)'
            // pageWidth 与 viewScale 同一微任务一起 setState → React 一次渲染，
            // 避免"新 canvas × 旧 transform/旧 left"的中间态（画面往右闪一下再闪回）
            setPageWidth(pageWidthRef.current)
            setViewScale(1)
          }
        })
        .catch((e) => {
          // 重渲染失败：保持当前 transform 缩放，画面不闪不丢（下次缩放会再尝试）
          console.error('[pdf] 清晰重渲染失败，保持当前缩放:', e)
        })
    }, 800)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewZoom])

  return (
    <div className="pdf-viewer" onContextMenu={(e) => e.preventDefault()}>
      <div className="pdf-viewer-bar">
        {state.loading ? (
          <span>正在加载 PDF…</span>
        ) : state.error ? (
          <span className="pdf-viewer-error">PDF 打开失败：{state.error}</span>
        ) : (
          <span>共 {state.total} 页 · 文字可选中复制</span>
        )}
      </div>
      <div className="pdf-viewer-body" ref={bodyRef}>
        {/* 水平居中补偿方案（[pdf-zoom2] 位置 A 问题定位）：
            页面视觉左边缘必须恒等于"归 1 后 canvas 居中"的位置，否则 transform 缩放阶段与
            清晰重渲染归位阶段几何不一致 → 每次归 1 画面"闪一下"（位置 A ↔ 中间跳动）。
            scale 层 absolute + left 动态补偿：transform-origin top left 下视觉左边缘 = left，
            设 left = max(0, (容器宽 - 页面物理宽×viewScale)/2) —— 归 1 后新 canvas 物理宽 =
            旧物理宽×viewScale，left 公式值相同 → 两个阶段视觉位置完全一致；溢出时 left=0
            页面从左侧展开（左侧可达），滚动范围由 transform 边界框撑开（absolute 元素计入 scrollWidth）。 */}
        <div
          ref={scaleRef}
          className="pdf-zoom-scale"
          data-resize-tick={resizeTick}
          style={{
            transform: `scale(${viewScale})`,
            transformOrigin: 'top left',
            left: `${Math.max(0, ((bodyRef.current?.clientWidth ?? 0) - pageWidth * viewScale) / 2)}px`
          }}
        >
          <div className="pdf-pages" ref={containerRef} />
        </div>
      </div>
    </div>
  )
}

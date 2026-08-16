// src/renderer/src/components/viewer/FileViewerPane.tsx
// 广泛文件查看器：非编辑类型文件在软件内打开
// - 图片 → ImageViewerPane（自建 <img>，百分比布局放大，居中 + 滚动）
// - pdf → PdfViewerPane（pdfjs 原生 scale 重渲染，内容级缩放，清晰不损失）
// - xlsx → XlsxViewerPane（内部占位层 + transform scale，表格内容放大 + 滚动）
// - 其他格式 → @file-viewer（原生 zoomIn/zoomOut，其内部处理缩放/滚动/平移）
// 统一交互：Ctrl+滚轮缩放、Shift+滚轮左右移动（App 全局处理）、状态栏显示缩放

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type JSX } from 'react'
import FileViewer, { type FileViewerHandle } from '@file-viewer/react'
import { findFileViewerZoomProvider } from '@file-viewer/core'
import PdfViewerPane from './PdfViewerPane'
import XlsxViewerPane from './XlsxViewerPane'
import { useAppStore } from '../../store/appStore'
import { readPosition } from '../../utils/positionMemory'

/** 图片扩展名（自建查看器渲染；@file-viewer 的图片渲染器会自适应容器，容器放大后图片重新 fit → 必须自建）。
 *  export 供 App.tsx flushReadingPosition 共用（图片查看器滚动容器识别），避免两处漂移 */
export const IMG_EXTS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.bmp',
  '.svg',
  '.ico',
  '.avif',
  '.tif',
  '.tiff'
])

/** 图片 MIME 映射（Blob 需要正确类型才能被 <img> 渲染） */
const IMG_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.avif': 'image/avif',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff'
}

export default function FileViewerPane({
  path,
  name
}: {
  path: string
  name: string
}): JSX.Element {
  const dot = name.lastIndexOf('.')
  const ext = dot >= 0 ? name.slice(dot).toLowerCase() : ''

  if (IMG_EXTS.has(ext)) {
    return <ImageViewerPane path={path} ext={ext} />
  }

  return (
    <div className="viewer-root" onContextMenu={(e) => e.preventDefault()}>
      {ext === '.pdf' ? (
        <PdfViewerPane path={path} />
      ) : ext === '.xlsx' ? (
        // xlsx 用 HTML DOM 表格（单元格可选中复制）；xls 旧格式 exceljs 不支持，仍走 @file-viewer
        <XlsxViewerPane path={path} />
      ) : (
        // 其余格式（xls/pptx/图片/媒体/html/zip/未收录扩展名）交给 @file-viewer 渲染，原生缩放
        <FileViewerBuffer path={path} name={name} />
      )}
    </div>
  )
}

/** 图片查看器：主进程读文件 → Blob object URL → <img>（object-fit contain 自适应）；
 *  百分比布局放大（width/height = 缩放比例）；flex + margin:auto 居中，放大后滚动条查看全部 */
function ImageViewerPane({ path, ext }: { path: string; ext: string }): JSX.Element {
  const viewZoom = useAppStore((s) => s.viewZoom)
  const [src, setSrc] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // 滚动容器 ref（阅读位置保存/恢复用）
  const viewerRef = useRef<HTMLDivElement | null>(null)

  // 用 useLayoutEffect：cleanup 在 DOM 移除前同步执行，保存阅读位置能读到旧容器
  useLayoutEffect(() => {
    let cancelled = false
    let url: string | null = null
    setSrc(null)
    setError(null)
    void window.api
      .readFile(path)
      .then(({ buffer: bytes }) => {
        if (cancelled) return
        // 复制出独立 ArrayBuffer（避免 Uint8Array 偏移/共享 buffer 的类型问题，与 FileViewerBuffer 一致）
        const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
        const blob = new Blob([ab], {
          type: IMG_MIME[ext] ?? 'application/octet-stream'
        })
        url = URL.createObjectURL(blob)
        setSrc(url)
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(String(e))
      })
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
      // 阅读位置保存已移至 App 注册的 flushPosition 回调（事件驱动）——
      // 卸载 cleanup 保存会被 StrictMode 挂载时模拟卸载污染成 {s:0}（2026-08-14 根因）
    }
  }, [path, ext])

  /** 图片加载完成（尺寸确定、滚动范围就绪）后恢复上次阅读位置 */
  const handleImgLoad = (): void => {
    const cfg = useAppStore.getState().config
    if (!cfg?.settings.rememberPosition) return
    const pos = readPosition(path)
    if (!pos || !viewerRef.current) return
    viewerRef.current.scrollTop = pos.s || 0
    if (pos.l) viewerRef.current.scrollLeft = pos.l
  }

  if (error) {
    return <div className="viewer-message">图片打开失败：{error}</div>
  }
  if (!src) {
    return <div className="viewer-message">正在加载图片…</div>
  }

  return (
    <div className="image-viewer" ref={viewerRef}>
      <img
        className="image-viewer-img"
        src={src}
        alt=""
        draggable={false}
        onLoad={handleImgLoad}
        style={{ width: `${viewZoom * 100}%`, height: `${viewZoom * 100}%` }}
      />
    </div>
  )
}

/** 主进程读文件 → ArrayBuffer → @file-viewer（buffer 直传，无 CSP 问题）；
 *  缩放统一走全局 viewZoom（Ctrl+滚轮 App 全局处理，与图片/PDF/xlsx/编辑器一致）：
 *  viewZoom 变化 → 查找 @file-viewer zoom provider → setZoom(绝对比例) 应用；
 *  打开文件：有记忆缩放 → setZoom 恢复；无记忆 → 保留 @file-viewer 默认 fit，并把 fit 比例同步到状态栏 */
function FileViewerBuffer({ path, name }: { path: string; name: string }): JSX.Element {
  const [buffer, setBuffer] = useState<ArrayBuffer | null>(null)
  const [error, setError] = useState<string | null>(null)
  const handleRef = useRef<FileViewerHandle | null>(null)
  // 打开引导完成前不响应 viewZoom（避免覆盖 fit/记忆恢复逻辑）
  const readyRef = useRef(false)
  // options 稳定引用（useMemo）：FileViewerBuffer 重渲染时若 options 引用变化 →
  // @file-viewer update → 重新 fit → 覆盖 setZoom 应用（缩放无效果的根因）
  const viewerOptions = useMemo(() => ({ theme: 'light' as const, toolbar: false }), [])

  useEffect(() => {
    let cancelled = false
    setBuffer(null)
    setError(null)
    void window.api
      .readFile(path)
      .then(({ buffer: bytes }) => {
        if (cancelled) return
        // Uint8Array（可能有偏移）→ 独立 ArrayBuffer
        const ab = bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength
        ) as ArrayBuffer
        setBuffer(ab)
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(String(e))
      })
    return () => {
      cancelled = true
    }
  }, [path])

  // @file-viewer 加载完成后引导一次：
  // - 该文件有记忆缩放 → setZoom 恢复到记忆比例（与 PDF/图片行为一致）
  // - 无记忆 → 保留默认 fit 布局，把实际 fit 比例同步到状态栏（后续滚轮从 fit 开始平滑缩放）
  useEffect(() => {
    if (!buffer) return
    readyRef.current = false
    const st = useAppStore.getState()
    const saved = st.viewZooms[path]
    const t = window.setTimeout(() => {
      const h = handleRef.current
      if (!h) return
      const provider = findFileViewerZoomProvider(document.documentElement)
      if (saved) {
        provider?.setZoom?.(saved)
        st.setViewZoom(saved)
      } else {
        const zs = h.getZoomState()
        if (zs) st.setViewZoom(zs.scale)
      }
      readyRef.current = true
    }, 400)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buffer, path])

  // 用户缩放（Ctrl+滚轮 → 全局 viewZoom 变化）→ 应用到 @file-viewer（绝对比例，与内部状态机无关）。
  // 用 zustand subscribe 而非 selector：不触发 FileViewerBuffer 重渲染 →
  // FileViewer 组件不 update（options 引用也稳定）→ setZoom 不会被重新 fit 覆盖
  useEffect(() => {
    return useAppStore.subscribe((state, prev) => {
      if (!readyRef.current) return
      if (state.viewZoom !== prev.viewZoom) {
        findFileViewerZoomProvider(document.documentElement)?.setZoom?.(state.viewZoom)
      }
    })
  }, [])

  if (error) {
    return <div className="viewer-message">文件打开失败：{error}</div>
  }
  if (!buffer) {
    return <div className="viewer-message">正在加载文件…</div>
  }

  return (
    <div className="file-viewer-buffer">
      <FileViewer
        ref={handleRef}
        buffer={buffer}
        filename={name}
        options={viewerOptions}
      />
    </div>
  )
}

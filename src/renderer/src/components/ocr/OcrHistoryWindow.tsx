// src/renderer/src/components/ocr/OcrHistoryWindow.tsx
// 截屏记录窗口根组件（#ocr-history 入口，独立窗口，无边框自绘标题栏）：
// 标题栏：截屏统计（图标+文字）+ 最小化/最大化/关闭；
// 左侧：缩略图 + 名字（截屏yyyy_MMdd_HHmm_ss）+ 时间；右侧：选中条目的完整详情（居中）
// 详情显示完整的内容框/译文框（无识别按钮），按记录状态决定可用/禁用

import { useEffect, useRef, useState, type JSX, type MouseEvent as ReactMouseEvent } from 'react'
import { Copy, FileText, Images, Languages, Minus, Pin, PinOff, Square, X } from 'lucide-react'
import { useAppStore } from '../../store/appStore'
import OcrZoomOverlay from './OcrZoomOverlay'
import type { OcrHistoryEntry } from '../../../../shared/types'

/** 列表宽度持久化 key（localStorage，同源共享） */
const LIST_WIDTH_KEY = 'ocrHistoryListWidth'
const LIST_WIDTH_MIN = 200
const LIST_WIDTH_MAX = 480

/** 条目名字：截屏2026_0807_0931_24（精确到秒） */
function formatName(iso: string): string {
  const d = new Date(iso)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `截屏${d.getFullYear()}_${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}_${p(d.getSeconds())}`
}

/** 完整时间显示：2026-08-07 09:31:24 */
function formatTime(iso: string): string {
  const d = new Date(iso)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

export default function OcrHistoryWindow(): JSX.Element {
  const [entries, setEntries] = useState<OcrHistoryEntry[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detailImage, setDetailImage] = useState<string | null>(null)
  // 详情图悬停放大（受全局设置控制）
  const [previewZoom, setPreviewZoom] = useState(false)
  // 窗口置顶状态
  const [pinned, setPinned] = useState(false)
  const setConfig = useAppStore((s) => s.setConfig)
  const zoomEnabled = useAppStore((s) => s.config?.settings.ocrZoomPreview ?? true)

  // 独立窗口加载配置（悬停放大开关等）
  useEffect(() => {
    void window.api.getConfig().then(setConfig)
  }, [setConfig])

  // 左侧列表宽度：可拖右边缘调节，记住上次的宽度（localStorage）
  const [listWidth, setListWidth] = useState<number>(() => {
    const saved = localStorage.getItem(LIST_WIDTH_KEY)
    const w = saved ? parseInt(saved, 10) : 300
    return Number.isFinite(w) ? Math.min(LIST_WIDTH_MAX, Math.max(LIST_WIDTH_MIN, w)) : 300
  })
  const widthRef = useRef(listWidth)
  widthRef.current = listWidth
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null)

  useEffect(() => {
    const onMove = (e: MouseEvent): void => {
      const d = resizeRef.current
      if (!d) return
      const w = Math.min(LIST_WIDTH_MAX, Math.max(LIST_WIDTH_MIN, d.startWidth + (e.clientX - d.startX)))
      setListWidth(w)
    }
    const onUp = (): void => {
      if (resizeRef.current) {
        localStorage.setItem(LIST_WIDTH_KEY, String(widthRef.current))
      }
      resizeRef.current = null
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  const onResizeStart = (e: ReactMouseEvent): void => {
    resizeRef.current = { startX: e.clientX, startWidth: listWidth }
    e.preventDefault()
  }

  useEffect(() => {
    void window.api.ocrList().then((list) => {
      setEntries(list)
      if (list.length > 0) setSelectedId(list[0].id)
    })
  }, [])

  // 选中条目 → 加载原图
  useEffect(() => {
    setDetailImage(null)
    const entry = entries.find((e) => e.id === selectedId)
    if (!entry) return
    let cancelled = false
    void window.api.ocrImage(entry.imageFile).then((dataUrl) => {
      if (!cancelled) setDetailImage(dataUrl)
    })
    return () => {
      cancelled = true
    }
  }, [selectedId, entries])

  const selected = entries.find((e) => e.id === selectedId) ?? null

  const copy = async (content: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(content)
    } catch {
      // 忽略复制失败（独立窗口无 toast，静默即可）
    }
  }

  const hasText = selected?.text !== null && selected?.text !== undefined && selected.text.trim() !== ''
  const hasTranslated =
    selected?.translated !== null && selected?.translated !== undefined && selected.translated.trim() !== ''

  return (
    <div className="ocr-history-window">
      {/* 自绘标题栏（无边框窗口） */}
      <div className="ocr-history-titlebar">
        <span className="ocr-history-title">
          <Images size={16} className="ocr-history-title-icon" />
          截屏统计
        </span>
        <span className="ocr-history-winbtns">
          <button
            className={`win-btn ${pinned ? 'win-btn-pinned' : ''}`}
            data-tip={pinned ? '取消置顶' : '置顶窗口（不被其他窗口遮挡）'}
            onClick={() => {
              setPinned(!pinned)
              window.api.toggleAlwaysOnTop()
            }}
          >
            {pinned ? <PinOff size={14} /> : <Pin size={14} />}
          </button>
          <button className="win-btn" data-tip="最小化" onClick={() => window.api.minimize()}>
            <Minus size={14} />
          </button>
          <button className="win-btn" data-tip="最大化" onClick={() => window.api.toggleMaximize()}>
            <Square size={13} />
          </button>
          <button className="win-btn win-btn-close" data-tip="关闭" onClick={() => window.api.close()}>
            <X size={15} />
          </button>
        </span>
      </div>

      {/* 左侧：记录列表（可拖右边缘调节宽度，宽度被记住） */}
      <div className="ocr-history-body">
        <div className="ocr-history-list" style={{ width: listWidth, minWidth: listWidth }}>
          {entries.length === 0 ? (
            <div className="ocr-history-empty">暂无截屏记录</div>
          ) : (
            entries.map((entry) => (
              <button
                key={entry.id}
                className={`ocr-history-item ${entry.id === selectedId ? 'ocr-history-item-active' : ''}`}
                onClick={() => setSelectedId(entry.id)}
              >
                <img className="ocr-history-thumb" src={entry.thumbnailDataUrl} alt="" />
                <span className="ocr-history-meta">
                  <span className="ocr-history-name">{formatName(entry.createdAt)}</span>
                  <span className="ocr-history-time">{formatTime(entry.createdAt)}</span>
                </span>
              </button>
            ))
          )}
        </div>
        {/* 宽度调节手柄（拖右边缘） */}
        <div className="ocr-history-resizer" onMouseDown={onResizeStart} />

        {/* 右侧：选中条目详情（完整内容框/译文框，按记录状态禁用，整体居中） */}
        <div className="ocr-history-detail">
          {!selected ? (
            <div className="ocr-history-empty">点击左侧记录查看详情</div>
          ) : (
            <div className="ocr-history-detail-inner">
              {detailImage && (
                <img
                  className="ocr-history-image"
                  src={detailImage}
                  alt="截图"
                  data-tip={zoomEnabled ? '悬停放大预览' : undefined}
                  style={zoomEnabled ? undefined : { cursor: 'default' }}
                  onMouseEnter={() => zoomEnabled && setPreviewZoom(true)}
                  onMouseLeave={() => setPreviewZoom(false)}
                />
              )}
              {previewZoom && zoomEnabled && detailImage && <OcrZoomOverlay src={detailImage} />}
              <div className="ocr-block">
                <div className="ocr-block-header">
                  <span className="ocr-result-label">
                    <FileText size={14} className="ocr-result-label-icon" />
                    图片内容
                  </span>
                  <span className="ocr-block-icons">
                    <button
                      className="icon-btn"
                      data-tip="复制全部"
                      disabled={!hasText}
                      onClick={() => hasText && void copy(selected.text ?? '')}
                    >
                      <Copy size={14} />
                    </button>
                  </span>
                </div>
                <div className={`ocr-result-text ${!hasText ? 'ocr-result-text-disabled' : ''}`}>
                  {selected.text === null ? '未识别' : hasText ? selected.text : '无'}
                </div>
              </div>
              <div className="ocr-block">
                <div className="ocr-block-header">
                  <span className="ocr-result-label">
                    <Languages size={14} className="ocr-result-label-icon" />
                    译文
                  </span>
                  <span className="ocr-block-icons">
                    <button
                      className="icon-btn"
                      data-tip="复制译文"
                      disabled={!hasTranslated}
                      onClick={() => hasTranslated && void copy(selected.translated ?? '')}
                    >
                      <Copy size={14} />
                    </button>
                  </span>
                </div>
                <div className={`ocr-result-text ocr-result-translated ${!hasTranslated ? 'ocr-result-text-disabled' : ''}`}>
                  {hasTranslated ? selected.translated : '未翻译'}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

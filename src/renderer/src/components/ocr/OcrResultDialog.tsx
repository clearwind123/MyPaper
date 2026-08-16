// src/renderer/src/components/ocr/OcrResultDialog.tsx
// 识图结果对话框（完整布局）：
// 截图预览 + 识别图片文字/内容按钮 → 图片内容区（可选中复制/翻译）→ 译文区（可选中复制）
// 关闭时自动保存到截屏记录（ocrHistory.json）

import { useEffect, useRef, useState, type JSX, type MouseEvent as ReactMouseEvent } from 'react'
import { Copy, FileText, Languages, ScanText } from 'lucide-react'
import { useAppStore } from '../../store/appStore'
import { useUiStore } from '../../store/uiStore'
import { recognizeImage } from '../../utils/localOcr'
import OcrZoomOverlay from './OcrZoomOverlay'

interface Props {
  imageDataUrl: string
  onClose: () => void
}

export default function OcrResultDialog({ imageDataUrl, onClose }: Props): JSX.Element {
  const showToast = useUiStore((s) => s.showToast)
  const ocrMode = useAppStore((s) => s.config?.settings.ocrMode ?? 'local')
  // 识图可用模型：优先识图模型，未配置时兜底文字模型（与主进程 ai:vision 逻辑一致）
  const visionModel = useAppStore((s) => s.config?.ai.visionModel?.trim() || s.config?.ai.model?.trim() || '')
  // 悬停放大开关（全局设置）
  const zoomEnabled = useAppStore((s) => s.config?.settings.ocrZoomPreview ?? true)

  const [status, setStatus] = useState<'idle' | 'recognizing' | 'done'>('idle')
  /** 识别文字（null = 未识别；'' = 纯图片无文字） */
  const [text, setText] = useState<string | null>(null)
  const [translated, setTranslated] = useState<string | null>(null)
  const [translating, setTranslating] = useState(false)
  // 预览图悬停放大（浮层显示完整大图，鼠标移开预览图即消失）
  const [previewZoom, setPreviewZoom] = useState(false)

  // 标题栏拖拽移动窗口（对话框初始居中，拖动后固定定位）
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const dragRef = useRef<{ startX: number; startY: number; origLeft: number; origTop: number } | null>(null)

  useEffect(() => {
    const onMove = (e: MouseEvent): void => {
      const d = dragRef.current
      if (!d) return
      setPos({ x: d.origLeft + (e.clientX - d.startX), y: d.origTop + (e.clientY - d.startY) })
    }
    const onUp = (): void => {
      dragRef.current = null
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  const onTitleMouseDown = (e: ReactMouseEvent): void => {
    const el = dialogRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    dragRef.current = { startX: e.clientX, startY: e.clientY, origLeft: rect.left, origTop: rect.top }
  }

  // 翻译完成后：仅当内容撑满对话框（达到 90vh 上限）时，两个内容框高度保持一致；
  // 未到上限时保持内容驱动（各自内容高度）
  const [equalH, setEqualH] = useState<number | null>(null)

  useEffect(() => {
    if (translated === null) {
      setEqualH(null)
      return
    }
    const el = dialogRef.current
    if (!el) return
    const texts = el.querySelectorAll<HTMLElement>('.ocr-result-text')
    if (texts.length < 2) return
    const heights = Array.from(texts).map((t) => t.clientHeight)
    const maxH = Math.max(...heights)
    const minH = Math.min(...heights)
    // 两框取等高后，总高是否会触到 90vh 上限
    const dialogH = el.clientHeight
    const maxAllowed = Math.round(window.innerHeight * 0.9)
    if (dialogH + (maxH - minH) >= maxAllowed - 1) setEqualH(maxH)
    else setEqualH(null)
  }, [translated, text])

  // 关闭时自动保存截屏记录（图片 + 识别文字 + 译文，按实际状态）
  const handleClose = (): void => {
    void (async () => {
      try {
        await window.api.ocrSave(imageDataUrl, text, translated)
      } catch {
        // 保存失败不阻塞关闭
      }
    })()
    onClose()
  }

  // 识别：按全局设置决定走 AI 还是本地 OCR
  const recognize = async (kind: 'text' | 'describe'): Promise<void> => {
    if (status === 'recognizing') return
    if (ocrMode === 'local') {
      if (kind === 'describe') {
        showToast('info', '本地 OCR 只能识别文字，描述图片内容仅 AI 支持')
        return
      }
      // 本地 OCR（tesseract.js，chi_sim + eng）
      setStatus('recognizing')
      try {
        const text = await recognizeImage(imageDataUrl)
        setText(text)
        setStatus('done')
        showToast('success', '识别完成')
      } catch (err) {
        showToast('error', `本地识别失败：${String(err)}`)
        setStatus('idle')
      }
      return
    }
    setStatus('recognizing')
    try {
      const prompt =
        kind === 'text'
          ? '请提取图片中的所有文字，不做额外解释。'
          : '请用中文描述这张图片的内容。'
      const res = await window.api.aiVision(imageDataUrl, prompt)
      if (res.ok) {
        setText(res.text ?? '')
        setStatus('done')
        showToast('success', '识别完成')
      } else {
        showToast('error', res.error ?? '识别失败')
        setStatus('idle')
      }
    } catch (err) {
      // IPC 异常（主进程 handler 抛错）：复位状态可重试，避免卡死在"正在识别…"
      showToast('error', `AI 识别失败：${String(err)}`)
      setStatus('idle')
    }
  }

  // 翻译：复用文本模型，含中文译英、否则译中
  const translate = async (): Promise<void> => {
    if (translating || !text) return
    setTranslating(true)
    try {
      const system = /[\u4e00-\u9fff]/.test(text)
        ? '你是专业的翻译助手。将用户提供的文本翻译为英文（学术翻译，术语准确）。只输出译文，不要任何解释。'
        : '你是专业的翻译助手。将用户提供的文本翻译为中文（学术翻译，术语准确）。只输出译文，不要任何解释。'
      const res = await window.api.aiComplete([
        { role: 'system', content: system },
        { role: 'user', content: text }
      ])
      if (res.ok && res.text) {
        setTranslated(res.text)
        showToast('success', '翻译完成')
      } else showToast('error', res.error ?? '翻译失败')
    } catch (err) {
      // IPC 异常：提示用户（finally 负责复位 translating 状态）
      showToast('error', `翻译失败：${String(err)}`)
    } finally {
      setTranslating(false)
    }
  }

  const copy = async (content: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(content)
      showToast('success', '已复制')
    } catch {
      showToast('error', '复制失败')
    }
  }

  // 内容/译文框的可用性：有内容才可复制/翻译
  const hasText = text !== null && text.trim() !== ''
  const hasTranslated = translated !== null && translated.trim() !== ''

  return (
    <div className="dialog-overlay">
      <div
        ref={dialogRef}
        className="dialog ocr-result-dialog"
        style={pos ? { position: 'fixed', left: pos.x, top: pos.y, margin: 0 } : undefined}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') handleClose()
        }}
      >
        <div className="dialog-title ocr-title-drag" onMouseDown={onTitleMouseDown}>
          <span className="ocr-title">
            <ScanText size={15} className="ocr-title-icon" />
            识图结果
          </span>
          <button
            className="icon-btn dialog-close"
            data-tip="关闭（自动保存到截屏记录）"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={handleClose}
          >
            ✕
          </button>
        </div>

        {/* 截图预览（悬停显示放大浮层） */}
        <img
          className="ocr-result-image"
          src={imageDataUrl}
          alt="截图"
          data-tip={zoomEnabled ? '悬停放大预览' : undefined}
          style={zoomEnabled ? undefined : { cursor: 'default' }}
          onMouseEnter={() => zoomEnabled && setPreviewZoom(true)}
          onMouseLeave={() => setPreviewZoom(false)}
        />
        {previewZoom && zoomEnabled && <OcrZoomOverlay src={imageDataUrl} />}

        {/* 未识别：操作按钮区（按全局识图方式控制可用性） */}
        {status === 'idle' && (
          <div className="ocr-actions">
            <button className="ocr-action-btn" onClick={() => void recognize('text')}>
              识别图片文字
            </button>
            <button
              className="ocr-action-btn"
              disabled={ocrMode === 'local'}
              data-tip={ocrMode === 'local' ? '本地 OCR 只能识别文字，描述图片内容仅 AI 支持' : undefined}
              onClick={() => void recognize('describe')}
            >
              识别图片内容
            </button>
          </div>
        )}
        {status === 'idle' && (
          <div className={`ocr-mode-tip ${ocrMode === 'ai' && !visionModel ? 'ocr-mode-tip-error' : ''}`}>
            {ocrMode === 'local'
              ? '本地 OCR 只能识别文字；描述图片内容需在设置中切换 AI 识图'
              : visionModel
                ? 'AI 识图可识别文字与描述图片内容'
                : '未配置模型（右上角 AI 配置 → 文字模型或识图模型），AI 识图不可用'}
          </div>
        )}
        {status === 'recognizing' && <div className="ocr-mode-tip">正在识别…</div>}

        {/* 图片内容区（始终存在，未识别时禁用） */}
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
                onClick={() => hasText && void copy(text)}
              >
                <Copy size={14} />
              </button>
              <button
                className="icon-btn"
                data-tip="翻译"
                disabled={!hasText}
                onClick={() => void translate()}
              >
                <Languages size={14} />
              </button>
            </span>
          </div>
          <div
            className={`ocr-result-text ${!hasText ? 'ocr-result-text-disabled' : ''}`}
            style={equalH !== null ? { height: equalH } : undefined}
          >
            {text === null
              ? '未识别'
              : hasText
                ? text
                : '无'}
          </div>
        </div>

        {/* 译文区（始终存在，未翻译禁用） */}
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
                onClick={() => hasTranslated && void copy(translated)}
              >
                <Copy size={14} />
              </button>
            </span>
          </div>
          <div
            className={`ocr-result-text ocr-result-translated ${!hasTranslated ? 'ocr-result-text-disabled' : ''}`}
            style={equalH !== null ? { height: equalH } : undefined}
          >
            {translating ? '翻译中…' : hasTranslated ? translated : '未翻译'}
          </div>
        </div>
      </div>
    </div>
  )
}

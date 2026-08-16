// src/renderer/src/components/ocr/CaptureSelect.tsx
// 识图选区交互组件（软件识图/全屏识图共用）：
// 拖拽框选（选区内透亮、外部变暗）→ 8 手柄调整 + 框内拖动移动 → 确认/取消（Enter/Esc）

import { useEffect, useRef, useState, type JSX, type MouseEvent as ReactMouseEvent } from 'react'

/** 选区矩形（相对宿主窗口坐标） */
export interface CaptureRect {
  x: number
  y: number
  width: number
  height: number
}

interface Props {
  /** 确认选区（返回相对宿主窗口的矩形，裁剪换算由调用方按模式处理） */
  onConfirm: (rect: CaptureRect) => void
  /** 取消（Esc / 取消按钮） */
  onCancel: () => void
  /** 空闲（未拖拽）时是否暗化全屏（全屏识图模式用；软件识图窗口内保持透亮） */
  dimIdle?: boolean
}

type HandleKey = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

interface DragState {
  kind: 'new' | 'move' | HandleKey
  startX: number
  startY: number
  startRect: CaptureRect
}

const HANDLES: HandleKey[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
const MIN_SIZE = 10

function handlePos(rect: CaptureRect, key: HandleKey): { x: number; y: number } {
  const cx = rect.x + rect.width / 2
  const cy = rect.y + rect.height / 2
  switch (key) {
    case 'nw':
      return { x: rect.x, y: rect.y }
    case 'n':
      return { x: cx, y: rect.y }
    case 'ne':
      return { x: rect.x + rect.width, y: rect.y }
    case 'e':
      return { x: rect.x + rect.width, y: cy }
    case 'se':
      return { x: rect.x + rect.width, y: rect.y + rect.height }
    case 's':
      return { x: cx, y: rect.y + rect.height }
    case 'sw':
      return { x: rect.x, y: rect.y + rect.height }
    case 'w':
      return { x: rect.x, y: cy }
  }
}

function hitHandle(rect: CaptureRect, mx: number, my: number): HandleKey | null {
  for (const key of HANDLES) {
    const p = handlePos(rect, key)
    if (Math.abs(mx - p.x) <= 6 && Math.abs(my - p.y) <= 6) return key
  }
  return null
}

/** 手柄拖拽计算新矩形（最小尺寸保护） */
function applyHandle(start: CaptureRect, key: HandleKey, dx: number, dy: number): CaptureRect {
  let { x, y, width, height } = start
  if (key.includes('w')) {
    x = start.x + dx
    width = start.width - dx
  }
  if (key.includes('e')) width = start.width + dx
  if (key.includes('n')) {
    y = start.y + dy
    height = start.height - dy
  }
  if (key.includes('s')) height = start.height + dy
  if (width < MIN_SIZE) {
    if (key.includes('w')) x -= MIN_SIZE - width
    width = MIN_SIZE
  }
  if (height < MIN_SIZE) {
    if (key.includes('n')) y -= MIN_SIZE - height
    height = MIN_SIZE
  }
  return { x, y, width, height }
}

export default function CaptureSelect({ onConfirm, onCancel, dimIdle = false }: Props): JSX.Element {
  const [rect, setRect] = useState<CaptureRect | null>(null)
  const [phase, setPhase] = useState<'idle' | 'selecting' | 'adjusting'>('idle')
  const dragRef = useRef<DragState | null>(null)

  // Enter 确认 / Esc 取消
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        onCancel()
      } else if (e.key === 'Enter' && phase === 'adjusting' && rect) {
        onConfirm(rect)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, rect, onConfirm, onCancel])

  const onMouseDown = (e: ReactMouseEvent): void => {
    const mx = e.clientX
    const my = e.clientY
    if (phase === 'adjusting' && rect) {
      const h = hitHandle(rect, mx, my)
      if (h) {
        dragRef.current = { kind: h, startX: mx, startY: my, startRect: rect }
        return
      }
      const inside =
        mx >= rect.x && mx <= rect.x + rect.width && my >= rect.y && my <= rect.y + rect.height
      if (inside) {
        dragRef.current = { kind: 'move', startX: mx, startY: my, startRect: rect }
        return
      }
    }
    // 框外点击 = 重新开始选区
    dragRef.current = {
      kind: 'new',
      startX: mx,
      startY: my,
      startRect: { x: mx, y: my, width: 0, height: 0 }
    }
    setRect({ x: mx, y: my, width: 0, height: 0 })
    setPhase('selecting')
  }

  const onMouseMove = (e: ReactMouseEvent): void => {
    const drag = dragRef.current
    if (!drag) return
    const dx = e.clientX - drag.startX
    const dy = e.clientY - drag.startY
    if (drag.kind === 'new') {
      setRect({
        x: Math.min(drag.startX, e.clientX),
        y: Math.min(drag.startY, e.clientY),
        width: Math.abs(e.clientX - drag.startX),
        height: Math.abs(e.clientY - drag.startY)
      })
    } else if (drag.kind === 'move') {
      setRect({
        x: drag.startRect.x + dx,
        y: drag.startRect.y + dy,
        width: drag.startRect.width,
        height: drag.startRect.height
      })
    } else {
      setRect(applyHandle(drag.startRect, drag.kind, dx, dy))
    }
  }

  const onMouseUp = (): void => {
    const drag = dragRef.current
    if (!drag) return
    dragRef.current = null
    if (drag.kind !== 'new') return
    // 新选区位移过小视为误触，重置等待重新拖拽
    if (rect && (rect.width < 3 || rect.height < 3)) {
      setRect(null)
      setPhase('idle')
      return
    }
    setPhase('adjusting')
  }

  return (
    <div
      className={`ocr-overlay ${dimIdle && phase === 'idle' ? 'ocr-overlay-dim' : ''}`}
      style={{ cursor: phase === 'adjusting' ? 'default' : 'crosshair' }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
    >
      {rect && rect.width > 0 && rect.height > 0 && (
        <div
          className="ocr-selection"
          style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
        >
          {phase === 'adjusting' && (
            <>
              {/* 确认/取消 + 尺寸：紧贴选区下边框（阻止 mousedown 冒泡，避免触发重新选区） */}
              <div
                className="ocr-selection-bar"
                onMouseDown={(e) => e.stopPropagation()}
              >
                <span className="ocr-selection-size">
                  {Math.round(rect.width)} × {Math.round(rect.height)}
                </span>
                <button className="ocr-selection-btn" onClick={onCancel}>
                  取消
                </button>
                <button
                  className="ocr-selection-btn ocr-selection-btn-primary"
                  onClick={() => onConfirm(rect)}
                >
                  确认
                </button>
              </div>
              {/* 8 个调整手柄（相对选区定位） */}
              {HANDLES.map((key) => {
                const p = handlePos(rect, key)
                return (
                  <span
                    key={key}
                    className={`ocr-handle ocr-handle-${key}`}
                    style={{ left: p.x - rect.x - 4, top: p.y - rect.y - 4 }}
                  />
                )
              })}
            </>
          )}
        </div>
      )}
    </div>
  )
}

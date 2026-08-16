// src/renderer/src/components/ocr/OcrZoomOverlay.tsx
// 截图预览悬停放大浮层：半透明遮罩 + 完整大图居中显示（不拦截鼠标，由预览图 hover 控制显隐）

import { type JSX } from 'react'

interface Props {
  src: string
}

export default function OcrZoomOverlay({ src }: Props): JSX.Element {
  return (
    <div className="ocr-zoom-overlay">
      <img className="ocr-zoom-image" src={src} alt="放大预览" />
    </div>
  )
}

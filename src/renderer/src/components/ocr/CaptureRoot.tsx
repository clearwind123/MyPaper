// src/renderer/src/components/ocr/CaptureRoot.tsx
// 全屏识图遮罩窗口根组件（#capture?mode=window|fullscreen 入口）：
// window 模式 = 静态压暗层（软件识图时盖住窗口外的屏幕）；
// fullscreen 模式 = 全屏暗化 + 选区交互，确认后清空遮罩 → 截屏 → 裁剪 → 回传主窗口

import { useEffect, useMemo, useState, type JSX } from 'react'
import CaptureSelect, { type CaptureRect } from './CaptureSelect'
import { cropImage } from '../../utils/ocrCapture'

/** 解析 location.hash：#capture?mode=fullscreen */
function parseCaptureMode(): 'window' | 'fullscreen' {
  const hash = window.location.hash
  const query = hash.replace(/^#/, '').split('?')[1] ?? ''
  return new URLSearchParams(query).get('mode') === 'fullscreen' ? 'fullscreen' : 'window'
}

export default function CaptureRoot(): JSX.Element {
  const mode = useMemo(parseCaptureMode, [])
  // 确认后置 true：遮罩 DOM 清空（全屏透亮），延迟截屏避免截到遮罩
  const [confirming, setConfirming] = useState(false)

  // 遮罩窗口需透明背景（transparent BrowserWindow 生效）
  useEffect(() => {
    document.body.style.background = 'transparent'
    return () => {
      document.body.style.background = ''
    }
  }, [])

  // window 模式：静态压暗，无选区交互
  if (mode === 'window') return <div className="ocr-dim-static" />

  const onConfirm = async (rect: CaptureRect): Promise<void> => {
    if (confirming) return
    setConfirming(true)
    try {
      // 等遮罩 DOM 消失后再截屏（否则截图包含暗层）
      await new Promise((r) => setTimeout(r, 150))
      const shot = await window.api.screenshotCapture()
      if (!shot.ok || !shot.imageDataUrl || !shot.display) {
        window.api.captureCancel()
        return
      }
      // 全屏遮罩窗口原点 = 显示器原点（显示器内 DIP 坐标即屏幕坐标）
      const origin = { x: shot.display.x, y: shot.display.y }
      const cropped = await cropImage(shot.imageDataUrl, rect, shot.display, origin)
      window.api.captureResult(cropped)
    } catch {
      window.api.captureCancel()
    }
  }

  return (
    <div className="ocr-dim-host">
      {!confirming && (
        <CaptureSelect
          dimIdle
          onConfirm={(r) => void onConfirm(r)}
          onCancel={() => window.api.captureCancel()}
        />
      )}
    </div>
  )
}

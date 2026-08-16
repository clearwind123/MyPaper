// src/renderer/src/utils/ocrCapture.ts
// 识图裁剪工具：从整屏截图中按选区裁剪（DIP → 物理像素换算，多显示器按显示器原点偏移）

import type { CaptureRect } from '../components/ocr/CaptureSelect'

/**
 * 裁剪整屏截图。
 * @param rect 选区（相对 origin 的 DIP 坐标）
 * @param display 鼠标所在显示器（bounds 原点 + 缩放，主进程截图返回）
 * @param origin 选区坐标系原点（软件识图=主窗口内容区；全屏识图=显示器原点）
 */
export function cropImage(
  imageDataUrl: string,
  rect: CaptureRect,
  display: { x: number; y: number; scaleFactor: number },
  origin: { x: number; y: number }
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      try {
        const scale = display.scaleFactor
        const sx = Math.max(0, (origin.x + rect.x - display.x) * scale)
        const sy = Math.max(0, (origin.y + rect.y - display.y) * scale)
        const sw = Math.min(rect.width * scale, img.width - sx)
        const sh = Math.min(rect.height * scale, img.height - sy)
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(sw))
        canvas.height = Math.max(1, Math.round(sh))
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          reject(new Error('无法创建画布'))
          return
        }
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/png'))
      } catch (err) {
        reject(err)
      }
    }
    img.onerror = () => reject(new Error('截图加载失败'))
    img.src = imageDataUrl
  })
}

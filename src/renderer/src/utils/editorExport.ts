// src/renderer/src/utils/editorExport.ts
// 导出工具：把当前编辑器内容导出为 docx / md / html / pdf（弹系统保存对话框后写入）

import type { Value } from 'platejs'
import { valueToMarkdown } from './editorConvert'
import { sanitizeValue, exportDocxInWorker } from './editorSave'

/** 默认导出的 CSS（与编辑器显示一致；注意：无法直接引用本地 ui.css，这里内联核心样式） */
const EXPORT_CSS = `
body { font-family: 'Microsoft YaHei', 'PingFang SC', sans-serif; font-size: 14px; line-height: 1.7; color: #222; margin: 32px auto; max-width: 760px; padding: 0 24px; }
h1 { font-size: 24px; margin: 20px 0 10px; }
h2 { font-size: 20px; margin: 18px 0 10px; }
h3 { font-size: 17px; margin: 16px 0 8px; }
h4 { font-size: 15px; margin: 14px 0 8px; }
h5, h6 { font-size: 14px; margin: 12px 0 8px; }
blockquote { border-left: 3px solid #55a97c; padding-left: 12px; color: #555; margin: 6px 0; }
pre { background: #f6f6f6; border: 1px solid rgba(0,0,0,0.08); padding: 10px 12px; border-radius: 6px; font-family: Consolas, 'Courier New', monospace; font-size: 13px; overflow-x: auto; white-space: pre-wrap; word-break: break-word; }
code { font-family: Consolas, 'Courier New', monospace; }
table { border-collapse: collapse; margin: 8px 0; }
td, th { border: 1px solid #ccc; padding: 4px 10px; min-width: 20px; }
img { max-width: 100%; height: auto; }
ul, ol { padding-left: 24px; }
.katex-display { margin: 8px 0; overflow-x: auto; }
/* 换行保障：长内容正常换行 */
p, div, span, li, td, th, blockquote { word-wrap: break-word; overflow-wrap: break-word; }
/* 备注导出标签 */
.note-export { display: inline-block; margin-left: 8px; padding: 1px 8px; border-radius: 10px; font-size: 11px; color: #2f7d57; background: #e6f4ec; vertical-align: middle; }
`

/** 把当前编辑器 DOM 内容导出为完整 HTML 字符串（保留表格/图片/公式渲染效果） */
export function valueToHtml(): string {
  // 直接从编辑器 DOM 克隆（渲染效果与所见一致），去掉 slate 的 data 属性
  const content = document.querySelector('.plate-content') as HTMLElement | null
  if (!content) return '<p></p>'
  const clone = content.cloneNode(true) as HTMLElement
  clone.querySelectorAll('[data-slate-node], [contenteditable], [data-slate-void]').forEach((el) => {
    el.removeAttribute('data-slate-node')
    el.removeAttribute('data-slate-void')
    el.removeAttribute('contenteditable')
    el.removeAttribute('spellcheck')
    el.removeAttribute('role')
    el.removeAttribute('aria-label')
    el.removeAttribute('data-placeholder')
    el.removeAttribute('data-slate-leaf')
    el.removeAttribute('data-slate-string')
    el.removeAttribute('data-slate-inline')
  })
  // 去掉空占位（placeholder 文本）
  clone.querySelectorAll('[data-placeholder]').forEach((el) => el.remove())
  // 备注：把可编辑的备注按钮转为只读标签（保留备注文字），编辑浮层/公式输入框/查找面板去掉
  clone.querySelectorAll('.note-badge').forEach((badge) => {
    const noteText = badge.querySelector('.note-text')?.textContent?.trim()
    const label = document.createElement('span')
    label.className = 'note-export'
    label.textContent = noteText ? `📌 ${noteText}` : ''
    if (noteText) badge.replaceWith(label)
    else badge.remove()
  })
  clone.querySelectorAll('.note-edit, .equation-input-wrap, .find-replace-panel').forEach((el) => el.remove())

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>导出文档</title>
<style>${EXPORT_CSS}</style>
</head>
<body>
${clone.innerHTML}
</body>
</html>`
}

/**
 * 导出当前文档。
 * @param format 'docx' | 'md' | 'html' | 'pdf'
 * @param fileName 默认保存文件名（不含扩展名）
 */
export async function exportDocument(
  value: Value,
  format: 'docx' | 'md' | 'html' | 'pdf',
  fileName: string
): Promise<{ ok: boolean; message?: string }> {
  const ext = format === 'docx' ? '.docx' : format === 'md' ? '.md' : format === 'pdf' ? '.pdf' : '.html'
  const filters: { name: string; extensions: string[] }[] =
    format === 'docx'
      ? [{ name: 'Word 文档', extensions: ['docx'] }]
      : format === 'md'
        ? [{ name: 'Markdown', extensions: ['md'] }]
        : format === 'pdf'
          ? [{ name: 'PDF', extensions: ['pdf'] }]
          : [{ name: 'HTML', extensions: ['html'] }]

  const path = await window.api.saveDialog({ defaultName: `${fileName}${ext}`, filters })
  if (!path) return { ok: false, message: '已取消' }

  try {
    if (format === 'docx') {
      // docx：官方方案 exportToDocx + base 插件 + DOCX 专用组件（公式/代码块/图片/表格/引用块，含备注）
      // 导出在 Web Worker 中执行（大文档不冻结 UI）
      const buf = await exportDocxInWorker(value)
      const r = await window.api.exportWrite(path, buf)
      if (!r.ok) return { ok: false, message: r.error ?? '写入失败' }
    } else if (format === 'md') {
      const clean = sanitizeValue(value)
      const r = await window.api.exportWrite(path, valueToMarkdown(clean))
      if (!r.ok) return { ok: false, message: r.error ?? '写入失败' }
    } else if (format === 'html') {
      const r = await window.api.exportWrite(path, valueToHtml())
      if (!r.ok) return { ok: false, message: r.error ?? '写入失败' }
    } else {
      // pdf：主进程隐藏窗口 printToPDF
      const res = await window.api.exportPdf(valueToHtml())
      if (!res.ok || !res.data) {
        return { ok: false, message: res.error ?? 'PDF 导出失败' }
      }
      const r = await window.api.exportWrite(path, res.data)
      if (!r.ok) return { ok: false, message: r.error ?? '写入失败' }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, message: String(err) }
  }
}

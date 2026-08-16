// src/renderer/src/utils/htmlNormalize.ts
// HTML 反序列化前归一化 + 粘贴图片补全：
// ① text-indent 内联样式 → data-slate-text-indent（Plate 反序列化可识别的节点属性）
// ② Word 剪贴板 VML 图片（v:shape/v:imagedata）→ <img>
// ③ file:// 本地图片 → 异步读取文件转 data URL（渲染进程无法直接加载 file://）

import { KEYS } from 'platejs'
import type { Value } from 'platejs'
import { useAppStore } from '../store/appStore'

/** pt → px（96dpi：1pt = 4/3px） */
const PT_TO_PX = 96 / 72
/** Plate TextIndentPlugin 数字基准：1 单位 = 24px */
const PLATE_INDENT_PX = 24

/**
 * 解析 text-indent 样式值为 Plate textIndent 数字（1 = 24px）。
 * 支持 pt/px 单位（含负值，用于悬挂缩进）；无法解析返回 null。
 */
export function textIndentToPlate(textIndent: string): number | null {
  const s = textIndent.trim()
  let px: number | null = null
  const pt = /^(-?[\d.]+)pt$/i.exec(s)
  const pxm = /^(-?[\d.]+)px$/i.exec(s)
  if (pt) px = parseFloat(pt[1]) * PT_TO_PX
  else if (pxm) px = parseFloat(pxm[1])
  if (px === null || !Number.isFinite(px) || px === 0) return null
  const unit = px / PLATE_INDENT_PX
  return Math.round(unit * 100) / 100
}

/**
 * 把 Word 剪贴板 HTML 中的 VML 图片（v:shape > v:imagedata）转为标准 <img>。
 * Word 复制内容到剪贴板时图片常用 VML 描述，html.deserialize 不认这些元素，
 * 会导致图片整体丢失（残留空表格等）。用 tagName 匹配避开选择器冒号转义问题。
 */
export function convertVmlImages(root: ParentNode): void {
  const elements = Array.from(root.querySelectorAll<HTMLElement>('*'))
  for (const el of elements) {
    const tag = el.tagName.toLowerCase()
    if (tag !== 'v:shape' && tag !== 'v:pict' && tag !== 'o:pict' && tag !== 'w:pict') continue
    const imagedata = Array.from(el.querySelectorAll<HTMLElement>('*')).find(
      (c) => c.tagName.toLowerCase() === 'v:imagedata'
    )
    const src = imagedata?.getAttribute('src')
    if (src) {
      const img = document.createElement('img')
      img.src = src
      el.replaceWith(img)
    } else {
      el.remove()
    }
  }
}

/**
 * 解包 Word 图片布局表格：Word 剪贴板 HTML 中，给非 VML 浏览器用的图片
 * 被包在 <span style='mso-ignore:vglayout'><table cellpadding=0 cellspacing=0>...
 * <img>...</table></span> 里（Word 用表格做图片定位）。
 * 反序列化会变成"残缺表格"。特征明确（mso-ignore:vglayout + 表格内含 img），
 * 不会误伤真实表格。把 img 提升到 span 原位置，删除 span/table。
 */
export function unwrapWordImageTables(root: ParentNode): void {
  root
    .querySelectorAll<HTMLElement>('span[style*="vglayout"], span[mso-ignore]')
    .forEach((span) => {
      const table = span.querySelector('table')
      if (!table) return
      const img = table.querySelector('img')
      if (!img) return
      span.replaceWith(img)
    })
}

/** file:// URL → 本地文件路径（Windows：file:///C:/x/y.png → C:/x/y.png） */
function fileUrlToPath(url: string): string {
  return url
    .replace(/^file:\/\//i, '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
}

/** 按扩展名推断 MIME（图片） */
function mimeFromPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'gif':
      return 'image/gif'
    case 'webp':
      return 'image/webp'
    case 'bmp':
      return 'image/bmp'
    case 'svg':
      return 'image/svg+xml'
    default:
      return 'image/png'
  }
}

/** 读取本地文件并转为 data URL（走主进程 fs，渲染进程无法直接读 file://）。
 *  粘贴图片专用通道 file:read-image：放宽到系统任意位置（Word/网页剪贴板的图片不在 usersData 内），
 *  主进程按图片扩展名白名单校验，防任意文件读取。 */
async function fileUrlToDataUrl(url: string): Promise<string | null> {
  try {
    const path = fileUrlToPath(url)
    const res = await window.api.readImageFile(path)
    if (!res.ok || !res.buffer) return null
    const blob = new Blob([res.buffer as BlobPart], { type: mimeFromPath(path) })
    return await new Promise<string | null>((resolve) => {
      const fr = new FileReader()
      fr.onload = () => resolve(fr.result as string)
      fr.onerror = () => resolve(null)
      fr.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}

/** 编辑器实例类型（appStore 中定义的 EditorInstance 同构） */
type PlateEditor = {
  children: unknown[]
  tf: {
    setNodes: (props: Record<string, unknown>, options: { at: unknown[] }) => void
  }
}

/**
 * 延迟扫描编辑器，把 url 以 file: 开头的图片节点替换为 data URL。
 * 粘贴 parser 是同步的（ParserPlugin insertData 不 await），所以插入后延时扫描补图。
 * 去抖：同一编辑器连续粘贴只保留最后一次扫描。
 */
const pendingLoads = new WeakMap<object, number>()

export function queueFileImageLoad(editor?: PlateEditor, delay = 80): void {
  const ed = editor ?? (useAppStore.getState().editor as unknown as PlateEditor)
  if (!ed) return
  const prev = pendingLoads.get(ed)
  if (prev !== undefined) window.clearTimeout(prev)
  const t = window.setTimeout(() => {
    pendingLoads.delete(ed)
    try {
      void loadFileImages(ed)
    } catch {
      // 编辑器可能已卸载：忽略（图片加载失败不影响文档）
    }
  }, delay)
  pendingLoads.set(ed, t)
}

async function loadFileImages(editor: PlateEditor): Promise<void> {
  // 遍历 editor.children（不用 editor.api.nodes({match})——实测插入后 match 匹配不到）
  const targets: { node: { url: string }; path: unknown[] }[] = []
  const collect = (nodes: unknown[], parentPath: unknown[]): void => {
    nodes.forEach((node, i) => {
      const n = node as { type?: string; url?: unknown; children?: unknown[] }
      if (n.type === KEYS.img && typeof n.url === 'string' && n.url.startsWith('file:')) {
        targets.push({ node: n as { url: string }, path: [...parentPath, i] })
      }
      if (Array.isArray(n.children)) collect(n.children, [...parentPath, i])
    })
  }
  collect(editor.children as unknown[], [])
  if (targets.length === 0) return
  const results = await Promise.all(
    targets.map(async (t) => ({ t, dataUrl: await fileUrlToDataUrl(t.node.url) }))
  )
  for (const { t, dataUrl } of results) {
    if (!dataUrl) continue
    try {
      editor.tf.setNodes({ url: dataUrl }, { at: t.path })
    } catch {
      // 节点可能已变化（撤销/切换文件），忽略
    }
  }
}

/** 空 Value 常量（占位导出） */
export const EMPTY_VALUE: Value = [{ type: 'p', children: [{ text: '' }] }]

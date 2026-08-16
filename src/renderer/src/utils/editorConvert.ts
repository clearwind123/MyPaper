// src/renderer/src/utils/editorConvert.ts
// 编辑器内容转换工具：txt ↔ slate 节点、字数统计、markdown 序列化工具编辑器

import type { Value } from 'platejs'
import { createMdTool } from './createMdTool'
import { stripMdMarks, stripMdLiteralTags } from './mdStyleClean'
import { injectNotesForMd, restoreNotesFromMd } from './mdNotes'

/**
 * markdown 序列化专用工具编辑器（headless，仅用于转换，不渲染）。
 * 装配见 createMdTool（与序列化 Worker 共用同一工厂，保证两侧结果一致）。
 */
export const mdTool = createMdTool()

/** 纯文本 → slate 节点（每行一个段落） */
export function txtToNodes(text: string): Value {
  const lines = text.split(/\r?\n/)
  if (lines.length === 1 && lines[0] === '') {
    return [{ type: 'p', children: [{ text: '' }] }]
  }
  return lines.map((line) => ({ type: 'p', children: [{ text: line }] }))
}

function extractText(node: unknown): string {
  if (typeof node === 'object' && node !== null) {
    const n = node as { text?: string; children?: unknown[] }
    if (typeof n.text === 'string') return n.text
    if (Array.isArray(n.children)) return n.children.map(extractText).join('')
  }
  return ''
}

/** slate 节点 → 纯文本（段落间换行） */
export function nodesToTxt(value: Value): string {
  return value.map(extractText).join('\n')
}

/** 统计字数（所有文本字符数） */
export function countWords(value: Value): number {
  let n = 0
  const walk = (nodes: unknown[]): void => {
    for (const node of nodes) {
      const item = node as { text?: string; children?: unknown[] }
      if (typeof item.text === 'string') {
        n += item.text.length
      } else if (Array.isArray(item.children)) {
        walk(item.children)
      }
    }
  }
  walk(value)
  return n
}

/** 根据 value 序列化为 markdown（返回字符串）。
 *  先注入引用块/代码块备注标记（md 无原生备注语法），序列化后备注以「📌 备注：」文本保留。 */
export function valueToMarkdown(value: Value): string {
  mdTool.tf.setValue(injectNotesForMd(value))
  return mdTool.api.markdown.serialize()
}

/** markdown 文本 → slate 节点（识别「📌 备注：」标记并还原为节点 note 属性） */
export function markdownToValue(md: string): Value {
  // withoutMdx: 跳过 htmlToJsx 预处理（它会把反引号代码里的 HTML 标签也改写，
  // 破坏结构导致 deserialize 中途截断——如对话 md 里的 `<span ref={...}>`）。
  // 普通 md 文件不需要 MDX 语法；remarkMdx 仍留在 remarkPlugins 供 serialize 用。
  // stripMdMarks / stripMdLiteralTags: 清理 md 承载不了的残留——
  // 已污染 md 里的 `<span style="...">` 字面量会以纯文本显示，还原不了格式，
  // 留着只会继续在保存时重新序列化成 span 字面量（见 mdStyleClean 头注释）。
  const nodes = mdTool.api.markdown.deserialize(md, { withoutMdx: true })
  return restoreNotesFromMd(stripMdLiteralTags(stripMdMarks(nodes)))
}

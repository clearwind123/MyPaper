// src/renderer/src/utils/valueSanitize.ts
// value 清洗工具（无 window/DOM 依赖，主线程与 docx 导出 Worker 共用）：
// 把 mdx 等 docx-io 无法处理的节点转为普通段落文本，避免保存/导出中断

import type { Value } from 'platejs'

/** 序列化链路不认识的节点类型（docx-io 的 mdx 节点），保存/导出前转普通段落 */
const UNSUPPORTED_NODE_TYPES = new Set([
  'mdxJsxTextElement',
  'mdxJsxFlowElement',
  'mdxTextExpression',
  'mdxFlowExpression',
  'mdxjsEsm'
])

/** 递归提取节点纯文本（含子节点） */
function nodeText(node: unknown): string {
  if (typeof node === 'object' && node !== null) {
    const n = node as { text?: string; children?: unknown[] }
    if (typeof n.text === 'string') return n.text
    if (Array.isArray(n.children)) return n.children.map(nodeText).join('')
  }
  return ''
}

/** 是否存在 docx-io 无法处理的 mdx 节点（找到即停，避免全量遍历） */
function hasUnsupportedNode(nodes: unknown[]): boolean {
  for (const node of nodes) {
    if (typeof node === 'object' && node !== null) {
      const n = node as { type?: string; children?: unknown[] }
      if (typeof n.type === 'string' && UNSUPPORTED_NODE_TYPES.has(n.type)) return true
      if (Array.isArray(n.children) && hasUnsupportedNode(n.children)) return true
    }
  }
  return false
}

/**
 * 清洗 value：把 mdx 等 docx-io 无法处理的节点转为普通段落文本，
 * 避免保存/导出中断（mdxJsxTextElement 等）。
 * 优化：不含 mdx 节点时直接返回原引用（大文档避免一次全量深拷贝）。
 */
export function sanitizeValue(value: Value): Value {
  if (!hasUnsupportedNode(value)) return value
  const walk = (nodes: unknown[]): unknown[] =>
    nodes.map((node) => {
      if (typeof node === 'object' && node !== null) {
        const n = node as { type?: string; children?: unknown[]; text?: string }
        if (typeof n.type === 'string' && UNSUPPORTED_NODE_TYPES.has(n.type)) {
          // mdx 节点 → 普通段落（保留其文本内容）
          return { type: 'p', children: [{ text: nodeText(n) }] }
        }
        if (Array.isArray(n.children)) {
          return { ...n, children: walk(n.children) }
        }
      }
      return node
    })
  return walk(value) as Value
}

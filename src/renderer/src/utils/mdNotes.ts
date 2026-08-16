// src/renderer/src/utils/mdNotes.ts
// md 引用块/代码块备注往返：md 无原生备注语法，序列化时把节点 note 注入为
// 「📌 备注：xxx」标记文本（与 docx 往返 restoreNotesFromDocx 同款前缀），
// 反序列化时识别标记并还原为节点 note 属性、移除标记内容。
// 纯函数、无 DOM/React 依赖，主线程（editorConvert）与序列化 Worker（serializationWorker）共用，保证两侧一致。

import type { Value } from 'platejs'

/** 备注标记前缀（与 docx 往返 docxOpenShared 的 NOTE_PREFIX 一致） */
export const NOTE_PREFIX = '📌 备注：'

/** 递归提取节点纯文本（备注识别用） */
function nodeTextOf(node: unknown): string {
  if (typeof node === 'object' && node !== null) {
    const n = node as { text?: string; children?: unknown[] }
    if (typeof n.text === 'string') return n.text
    if (Array.isArray(n.children)) return n.children.map(nodeTextOf).join('')
  }
  return ''
}

/** 深拷贝节点树（注入备注不能改原 value——它是编辑器实例的引用） */
function cloneNodes(nodes: unknown[]): unknown[] {
  return nodes.map((n) => {
    if (typeof n === 'object' && n !== null) {
      const o = n as Record<string, unknown>
      if (Array.isArray(o.children)) return { ...o, children: cloneNodes(o.children as unknown[]) }
      return { ...o }
    }
    return n
  })
}

/**
 * md 序列化前调用：把引用块/代码块的 note 注入为标记（递归，支持嵌套块）。
 * - blockquote：children 末尾追加段落「📌 备注：xxx」（序列化后为引用块内最后一行，保持现状）
 * - code_block：**不再占用代码行**——改为在代码块后追加独立段落
 *   `<!--📌 备注：xxx-->`（HTML 注释语法，remark 往返自洽：serialize 转义为 \<!--、
 *   deserialize 还原为 <!--）；代码块内容零触碰（修复"保存后第一行变备注/第一行被误删"）
 * 空备注跳过（note 缺省/空白时不注入）。
 */
export function injectNotesForMd(value: Value): Value {
  const next = cloneNodes(value) as Value
  const inject = (nodes: unknown[]): unknown[] => {
    const out: unknown[] = []
    for (const node of nodes) {
      const n = node as { type?: string; note?: string; children?: unknown[] }
      // 递归 children（嵌套块的备注也要注入/还原）
      let processed = node
      if (Array.isArray(n.children)) {
        processed = { ...n, children: inject(n.children) }
      }
      const pn = processed as { type?: string; note?: string; children?: unknown[] }
      // 先输出当前节点（保证注释段落紧跟代码块之后，而不是之前）
      out.push(processed)
      if (pn.note && pn.note.trim()) {
        const note = pn.note.trim()
        if (pn.type === 'blockquote' && Array.isArray(pn.children)) {
          // 引用块备注：保持现状（引用块内最后一行文本）
          ;(pn.children as unknown[]).push({
            type: 'p',
            children: [{ text: `${NOTE_PREFIX}${note}` }]
          })
        } else if (pn.type === 'code_block') {
          // 代码块备注：代码块后追加 HTML 注释段落（不占代码行、不污染代码内容）
          out.push({ type: 'p', children: [{ text: `<!--${NOTE_PREFIX}${note}-->` }] })
        }
      }
    }
    return out
  }
  return inject(next) as Value
}

/** 代码块新格式备注标记（HTML 注释包裹，识别时用） */
const MD_NOTE_RE = /^<!--📌 备注：(.+?)-->$/

/**
 * md 反序列化后调用：识别「📌 备注：」标记并还原为节点 note 属性，移除标记内容（递归，支持嵌套块）。
 * - code_block：**新格式 = 代码块后的注释段落**（`<!--📌 备注：xxx-->`，绑定前一个 code_block 并删除该段落）；
 *   旧格式（代码块第一行「📌 备注：xxx」）**不再识别**——避免用户代码第一行恰好含该前缀被误删（场景 B），
 *   旧文件标记行保留为可见文本
 * - blockquote：最后一段整段是标记 → 提取 note、移除该段；段内拼接（手写/旧文件）→ 仅去掉标记部分
 * 还原顺序：blockquote 先递归子块（嵌套块的标记先还原），再检查本层最后一段——
 * 避免把"标记在嵌套块内"的整段嵌套结构误当标记删掉。
 * 标记后无内容（空备注）不还原，保留原文本。
 */
export function restoreNotesFromMd(value: Value): Value {
  const restore = (nodes: unknown[]): unknown[] => {
    const out: unknown[] = []
    for (const node of nodes) {
      const n = node as { type?: string; children?: unknown[] }
      // 代码块后的备注注释段落（新格式）：绑定前一个 code_block 并删除本段落
      if (n.type === 'p' && out.length > 0) {
        const text = nodeTextOf(n).trim()
        const m = MD_NOTE_RE.exec(text)
        if (m && m[1].trim()) {
          const prev = out[out.length - 1] as { type?: string; note?: string }
          if (prev.type === 'code_block') {
            out[out.length - 1] = { ...prev, note: m[1].trim() }
            continue
          }
        }
      }
      // 递归 children（嵌套引用块/列表等内部的备注先还原）
      let processed = node
      if (Array.isArray(n.children)) {
        processed = { ...n, children: restore(n.children) }
      }
      const pn = processed as { type?: string; note?: string; children?: unknown[] }
      // code_block：不再识别"第一行 📌 备注："（旧格式）——否则用户代码第一行恰好含该前缀
      // 会被误删（场景 B）。旧文件的标记行保留为可见代码文本（不丢数据，只是不再还原为备注）。
      if (pn.type === 'blockquote' && Array.isArray(pn.children) && pn.children.length > 0) {
        const children = pn.children as unknown[]
        const last = children[children.length - 1]
        const text = nodeTextOf(last)
        const idx = text.indexOf(NOTE_PREFIX)
        if (idx >= 0) {
          const note = text.slice(idx + NOTE_PREFIX.length).trim()
          if (note) {
            if (idx === 0) {
              children.pop()
            } else {
              children[children.length - 1] = {
                type: (last as { type?: string }).type ?? 'p',
                children: [{ text: text.slice(0, idx).trimEnd() }]
              } as never
            }
            processed = { ...pn, note, children }
          }
        }
      }
      out.push(processed)
    }
    return out
  }
  return restore(value) as Value
}

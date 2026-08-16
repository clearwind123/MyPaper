// src/renderer/src/utils/docxOpenShared.ts
// docx 打开（导入）共享逻辑：主线程与 docxOpenWorker 共用，保证两侧解析结果完全一致。
// 含：mammoth 转换（styleMap）、HTML 预处理（normalizeDocxHtml）、headless 反序列化
// 装配（base 插件 + TextIndentPlugin 反序列化注入 + HtmlPlugin）、备注还原。
// 本模块无 React 组件依赖、无顶层 DOM 引用，可在 Web Worker 中运行。

import { createSlateEditor, KEYS } from 'platejs'
import { HtmlPlugin } from '@platejs/core'
import { BaseBasicMarksPlugin, BaseHeadingPlugin, BaseBlockquotePlugin } from '@platejs/basic-nodes'
import {
  BaseFontSizePlugin,
  BaseFontColorPlugin,
  BaseTextAlignPlugin,
  BaseTextIndentPlugin,
  BaseLineHeightPlugin,
  BaseFontFamilyPlugin,
  BaseFontWeightPlugin,
  BaseFontBackgroundColorPlugin
} from '@platejs/basic-styles'
import {
  BaseTablePlugin,
  BaseTableRowPlugin,
  BaseTableCellPlugin,
  BaseTableCellHeaderPlugin
} from '@platejs/table'
import { BaseImagePlugin } from '@platejs/media'
import { BaseEquationPlugin, BaseInlineEquationPlugin } from '@platejs/math'
import {
  BaseCodeBlockPlugin,
  BaseCodeLinePlugin,
  BaseCodeSyntaxPlugin
} from '@platejs/code-block'
import {
  BaseListPlugin,
  BaseBulletedListPlugin,
  BaseNumberedListPlugin,
  BaseListItemPlugin,
  BaseListItemContentPlugin
} from '@platejs/list-classic'
import { textIndentToPlate } from './htmlNormalize'
import type { Value } from 'platejs'

/** 递归提取节点纯文本（备注还原用） */
function nodeTextOf(node: unknown): string {
  if (typeof node === 'object' && node !== null) {
    const n = node as { text?: string; children?: unknown[] }
    if (typeof n.text === 'string') return n.text
    if (Array.isArray(n.children)) return n.children.map(nodeTextOf).join('')
  }
  return ''
}

/**
 * docx 导入 HTML 预处理（mammoth 输出 → deserialize 前）：
 * ① <pre> 内 <br> → 换行文本：htmlDeserializerCodeBlock 用 textContent.split('\n') 拆行，
 *    <br> 会被 textContent 丢弃，导致代码块硬换行丢失（备注误吞内容）。
 * ② <blockquote> 内 <br> → 段落分隔：导出端段间插 <br>（docx-io 对 blockquote 内容走 run
 *    拼接，不加分隔会合并成一段），这里还原为多段。
 * 注意：不用全局 document（Worker 无 DOM），用 body.ownerDocument 创建节点。
 */
export function normalizeDocxHtml(body: HTMLElement): void {
  const doc = body.ownerDocument
  body.querySelectorAll('pre').forEach((pre) => {
    pre.querySelectorAll('br').forEach((br) => {
      br.replaceWith(doc.createTextNode('\n'))
    })
  })
  body.querySelectorAll('blockquote').forEach((bq) => {
    const parts: HTMLElement[] = []
    let current: Node[] = []
    const flush = (): void => {
      if (current.length === 0) return
      const p = doc.createElement('p')
      for (const n of current) p.appendChild(n)
      parts.push(p)
      current = []
    }
    for (const node of Array.from(bq.childNodes)) {
      if (node.nodeName === 'BR') flush()
      else current.push(node)
    }
    flush()
    bq.replaceChildren(...parts)
  })
}

/**
 * 还原 docx 往返的引用块/代码块备注：
 * 导出时代码块备注渲染为 **pre 后独立灰色段落**「📌 备注：xxx」（新格式，不再占代码第一行），
 * 引用块备注渲染为末尾段；导入 deserialize 后识别标记 → 提取为节点 note 属性并移除标记。
 * 旧格式（代码块第一行「📌 备注：xxx」）**不再识别**——避免用户代码第一行恰好含该前缀被误删，
 * 旧 docx 文件标记行保留为可见文本。
 */
export function restoreNotesFromDocx(nodes: Value): Value {
  const NOTE_PREFIX = '📌 备注：'
  const restore = (list: unknown[]): unknown[] => {
    const out: unknown[] = []
    for (const node of list) {
      const n = node as { type?: string; children?: unknown[] }
      // 新格式：代码块后的备注段落（绑定前一个 code_block 并删除本段落）
      if (n.type === 'p' && out.length > 0) {
        const text = nodeTextOf(n).trim()
        if (text.startsWith(NOTE_PREFIX)) {
          const note = text.slice(NOTE_PREFIX.length).trim()
          const prev = out[out.length - 1] as { type?: string; note?: string }
          if (note && prev.type === 'code_block') {
            out[out.length - 1] = { ...prev, note }
            continue
          }
        }
      }
      // 递归 children（嵌套块的备注先还原）
      let processed = node
      if (Array.isArray(n.children)) {
        processed = { ...n, children: restore(n.children) }
      }
      const pn = processed as { type?: string; note?: string; children?: unknown[] }
      // code_block：不再识别"第一行 📌 备注："（旧格式）——用户代码第一行恰好含该前缀会被误删。
      // 旧 docx 文件的标记行保留为可见代码文本（不丢数据，只是不再还原为备注）。
      if (pn.type === 'blockquote' && Array.isArray(pn.children) && pn.children.length > 0) {
        // 备注在最后一段文本中（可能整段是备注，也可能在段尾与内容拼接）
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
  return restore(nodes) as Value
}

/** 创建 docx 打开（HTML 反序列化）专用 headless 编辑器（base 插件，无 React 组件） */
export function createDocxOpenTool() {
  return createSlateEditor({
    plugins: [
      BaseBasicMarksPlugin,
      BaseHeadingPlugin,
      BaseBlockquotePlugin,
      BaseFontSizePlugin,
      BaseFontColorPlugin,
      BaseTextAlignPlugin,
      // 首行缩进反序列化：text-indent 内联样式 → textIndent 节点属性（与主线程编辑器一致）
      BaseTextIndentPlugin.configure({
        inject: {
          targetPlugins: [KEYS.p, ...KEYS.heading],
          targetPluginToInject: () => ({
            parsers: {
              html: {
                deserializer: {
                  parse: ({ element, node }: { element: HTMLElement; node: Record<string, unknown> }) => {
                    const ti = element.style?.textIndent
                    if (ti) {
                      const unit = textIndentToPlate(ti)
                      if (unit !== null) node[KEYS.textIndent] = unit
                    }
                  }
                }
              }
            }
          })
        }
      }),
      BaseLineHeightPlugin,
      BaseFontFamilyPlugin,
      BaseFontWeightPlugin,
      BaseFontBackgroundColorPlugin,
      BaseTablePlugin,
      BaseTableRowPlugin,
      BaseTableCellPlugin,
      BaseTableCellHeaderPlugin,
      BaseImagePlugin,
      BaseEquationPlugin,
      BaseInlineEquationPlugin,
      BaseCodeBlockPlugin,
      BaseCodeLinePlugin,
      BaseCodeSyntaxPlugin,
      BaseListPlugin,
      BaseBulletedListPlugin,
      BaseNumberedListPlugin,
      BaseListItemPlugin,
      BaseListItemContentPlugin,
      // HTML 反序列化核心插件（覆盖 core 默认版，配置一致即可）
      HtmlPlugin
    ]
  })
}

/** mammoth styleMap（docx 命名样式 → 语义节点；Worker/主线程共用，保证结果一致） */
export const DOCX_STYLE_MAP = [
  "p[style-name='Quote'] => blockquote:fresh",
  "p[style-name='引用'] => blockquote:fresh",
  "p[style-name='CodeBlock'] => pre:fresh",
  "p[style-name='代码块'] => pre:fresh",
  // 识别本软件导出的 docx（docx-io patch：blockquote/pre 段落带 pStyle Quote/CodeBlock）
  'p.Quote => blockquote:fresh',
  'p.CodeBlock => pre:fresh',
  // mammoth 默认不输出下划线（findHtmlPathForRunProperty 无默认标签），补映射
  'u => u',
  'comment-reference => sup'
]

/** mammoth 模块类型（主线程动态 import 与 Worker 静态 import 都可传入） */
export type MammothModule = { convertToHtml: (input: { arrayBuffer: ArrayBuffer }, options: { styleMap: string[] }) => Promise<{ value: string }> }

/** mammoth 转换（buffer → HTML 字符串） */
export async function mammothToHtml(buffer: ArrayBuffer, mammoth: MammothModule): Promise<string> {
  const result = await mammoth.convertToHtml({ arrayBuffer: buffer }, { styleMap: DOCX_STYLE_MAP })
  return result.value
}

/** mammoth → HTML 字符串 → slate 节点（主线程/Worker 共用解析逻辑） */
export async function docxHtmlToNodes(html: string): Promise<Value> {
  const body = new DOMParser().parseFromString(html, 'text/html').body
  // 预处理：pre 内 <br> → 换行文本；blockquote 内 <br> → 段落分隔
  normalizeDocxHtml(body)
  const tool = createDocxOpenTool()
  const nodes = tool.api.html.deserialize({ element: body }) as unknown as Value
  return restoreNotesFromDocx(nodes)
}

/** 主线程解析入口（Worker 失效时的回退路径，逻辑与 Worker 内完全一致） */
export async function parseDocxMain(buffer: ArrayBuffer): Promise<Value> {
  const mammoth = (await import('mammoth')) as unknown as MammothModule
  const html = await mammothToHtml(buffer, mammoth)
  return docxHtmlToNodes(html)
}
